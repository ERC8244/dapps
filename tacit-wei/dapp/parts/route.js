// ── the private route ──
// A request to a relay is sealed to that relay's gateway key and posted to a forwarder, which sees the caller's address and
// an envelope's size, not what is in it; the relay sees the forwarder's address, not the caller's. For the page's own relay
// the gateway key is in the page; for a relay from the registry it comes in a document signed by the relay's own listed
// address (fetched by a forwarder, so the relay never sees who asks), and a key that signature does not vouch for is not
// used. Every message has a key of its own; only the gateway's key opens a request or makes a reply that passes its tag, so a
// forwarder can drop or delay a request but not read, change or answer it. A relay request is never sent in the open: with
// no forwarder answering it fails, and the page offers the wallet. A gasless note withdrawal goes to its bundler through the
// wallet-read gateway the same way, and straight to the bundler when that road fails (a withdrawal must stay possible).
//   request  0x02 ‖ kid (4) ‖ E (33) ‖ nonce (16) ‖ AES-256-GCM(be32(n) ‖ JSON { t, m, p, b } ‖ zeros to 4…64 KiB) ‖ tag
//   reply    0x02 ‖ reply nonce (16) ‖ AES-256-GCM(be32(n) ‖ JSON { s, h, z, l } ‖ body ‖ zeros) ‖ tag
//   s = compress(e·G), key(l) = keccak256("tacit-sealed-v2" ‖ l ‖ s ‖ E ‖ nonce [‖ reply nonce]), iv = key(l + 1)[0..12)
const ROUTE = (() => {
  const OWN = {
    keeper: 'https://tacit-evm-pool-keepers.onrender.com', id: 'k',
    gateway: '03dcc0e9c8f2f3f283831159600a0f1db2f615003a4d939999ff0e911894265a70',
    forwarders: ['https://tacit-evm-pool-forwarder.onrender.com', 'https://tacit-evm-pool-forwarder-2.onrender.com'],
    rpc: { url: 'https://tacit-evm-pool-rpc.onrender.com', id: 'r', gateway: '033b728ecb1b4ff06af1eaf111c0efe54e2cccedcb8febc458842f1f45cd79073a' },
  };
  let extra = [];   // forwarders the registry adds (behind the page's own)
  const forwarders = () => [...new Set([...OWN.forwarders, ...extra])];
  const setForwarders = (list) => { extra = (list || []).filter((u) => /^https:\/\/[\w.-]+(?::\d+)?$/.test(u)).slice(0, 6); };
  const te = new TextEncoder(), td = new TextDecoder();
  const TAG = te.encode('tacit-sealed-v2'), KID_TAG = te.encode('tacit-sealed-kid-v1'), DOC_TAG = te.encode('tacit-relay-gateway-v1');
  const REQUEST_SIZES = [4096, 8192, 16384, 32768, 65536], REPLY_MIN = 1024, MAX_REPLY = 8 << 20;
  const be4 = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const rd4 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const keyOf = (l, s, E, nonce, extraBytes = new Uint8Array(0)) => keccak(cat(TAG, Uint8Array.of(l), s, E, nonce, extraBytes));
  const kidOf = (pub) => keccak(cat(KID_TAG, pub)).subarray(0, 4);
  const subtle = () => { if (!globalThis.crypto?.subtle) throw new Error('The private route needs a page served over https.'); return crypto.subtle; };
  const aes = async (key, usage) => subtle().importKey('raw', key, 'AES-GCM', false, [usage]);
  const scalar = () => { for (;;) { const v = big(randomBytes(32)) % SN; if (v) return v; } };
  // { bytes, open(reply) → { status, headers, body } }
  async function seal(gatewayHex, req) {
    const pub = unhex(gatewayHex), P = secp.decompress(pub), e = scalar();
    const E = secp.compress(secp.mulG(e)), s = secp.compress(secp.mul(P, e)), nonce = randomBytes(16);
    const json = te.encode(JSON.stringify({ t: Math.floor(Date.now() / 1000), m: req.method, p: req.path, b: req.body ?? null }));
    const size = REQUEST_SIZES.find((x) => 4 + json.length <= x);
    if (!size) throw new Error('The request is too large for the private route.');
    const pt = new Uint8Array(size);
    pt.set(be4(json.length)); pt.set(json, 4);
    const head = cat(Uint8Array.of(2), kidOf(pub), E, nonce);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: keyOf(2, s, E, nonce).subarray(0, 12), additionalData: head, tagLength: 128 }, await aes(keyOf(1, s, E, nonce), 'encrypt'), pt));
    const open = async (bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.length < 17 + REPLY_MIN + 16 || bytes.length > MAX_REPLY + 33 || bytes[0] !== 2) throw new Error('not a reply');
      const rn = bytes.subarray(1, 17);
      let out;
      try { out = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: keyOf(4, s, E, nonce, rn).subarray(0, 12), additionalData: bytes.subarray(0, 17), tagLength: 128 }, await aes(keyOf(3, s, E, nonce, rn), 'decrypt'), bytes.subarray(17))); } catch { throw new Error('the reply did not pass its tag'); }
      const n = rd4(out, 0);
      if (4 + n > out.length) throw new Error('not a reply');
      const m = JSON.parse(td.decode(out.subarray(4, 4 + n)));
      if (!m || !Number.isInteger(m.s) || !Number.isInteger(m.l) || m.l < 0 || 4 + n + m.l > out.length) throw new Error('not a reply');
      let body = out.subarray(4 + n, 4 + n + m.l);
      if (m.z) body = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      return { status: m.s, headers: m.h && typeof m.h === 'object' ? m.h : {}, body };
    };
    return { bytes: cat(head, ct), open };
  }
  const shuffled = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // A fetch for requests under `base`, each sealed to `gateway` and posted to a forwarder at `pathOf(forwarder)`, the next
  // one if that fails. Answers like fetch; never sends the request in the open.
  function sealedFetch(base, gateway, pathOf) {
    const root = base.replace(/\/+$/, '');
    return async (url, init = {}) => {
      const u = String(url);
      if (!u.startsWith(root + '/')) throw new Error('The private route carries requests to its own relay only.');
      const req = { method: String(init.method || 'GET').toUpperCase(), path: u.slice(root.length), body: init.body == null ? null : JSON.parse(init.body) };
      let last = new Error('The private route did not answer.');
      for (const fw of shuffled(forwarders())) {
        const env = await seal(gateway, req);
        let r;
        try { r = await fetch(pathOf(fw), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: env.bytes, signal: init.signal }); } catch (e) { if (init.signal?.aborted) throw e; last = e; continue; }
        if (r.status !== 200) { last = new Error(`a forwarder answered ${r.status}`); if (r.status < 500 && r.status !== 429) throw last; continue; }
        try { const o = await env.open(new Uint8Array(await r.arrayBuffer())); return new Response([101, 204, 205, 304].includes(o.status) ? null : o.body, { status: o.status, headers: o.headers }); } catch (e) { last = e; }
      }
      throw last;
    };
  }
  const own = sealedFetch(OWN.keeper, OWN.gateway, (fw) => `${fw}/f/${OWN.id}`);
  // A listed relay's gateway key: a document { relayer, key, kid, sig } its own address signed, over
  // keccak256("tacit-relay-gateway-v1" ‖ relayer ‖ key). null unless it checks out.
  function verifyDoc(doc, relayer) {
    try {
      const H = (n) => new RegExp(`^(?:0x)?[0-9a-fA-F]{${n}}$`), strip = (h) => String(h).replace(/^0x/, '').toLowerCase();
      if (!doc || !H(40).test(String(relayer)) || !H(40).test(String(doc.relayer)) || !H(66).test(String(doc.key)) || !H(8).test(String(doc.kid)) || !H(130).test(String(doc.sig))) return null;
      if (strip(doc.relayer) !== strip(relayer)) return null;
      const key = unhex(strip(doc.key));
      secp.decompress(key);
      if (hex(kidOf(key)) !== strip(doc.kid)) return null;
      const sig = unhex(strip(doc.sig)), v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
      if (v !== 0 && v !== 1) return null;
      const P = secp.affine(secp.recover(keccak(cat(DOC_TAG, unhex(strip(relayer)), key)), big(sig.subarray(0, 32)), big(sig.subarray(32, 64)), v));
      return '0x' + hex(keccak(cat(be(P[0]), be(P[1]))).subarray(12)) === '0x' + strip(relayer) ? strip(doc.key) : null;
    } catch { return null; }
  }
  const LISTED = new Map(), KEYS = new Map();   // url → relayer; relayer → the sealed fetch, once its key is known
  async function gatewayOf(relayer) {
    for (const fw of shuffled(forwarders())) {
      try {
        const r = await fetch(`${fw}/r/1/${relayer}/key`, { signal: timeoutSignal(15_000) });
        if (!r.ok) continue;
        const { docs } = await r.json();
        for (const d of Array.isArray(docs) ? docs : []) { const k = verifyDoc(d, relayer); if (k) return k; }
      } catch { /* the next forwarder */ }
    }
    throw new Error('This relay\'s private route key could not be shown and checked, so it is not reached.');
  }
  function listedFetch(url, relayer) {
    const k = lc(relayer);
    if (!KEYS.has(k)) KEYS.set(k, gatewayOf(relayer).then((g) => sealedFetch(new URL(url).origin, g, (fw) => `${fw}/r/1/${relayer}`)).catch((e) => { KEYS.delete(k); throw e; }));
    return KEYS.get(k);
  }
  // fetch for any relay URL: the page's own through its gateway, a listed one through its own, any other refused.
  function relayFetch(url, init) {
    const u = String(url);
    if (u.startsWith(OWN.keeper + '/')) return own(u, init);
    for (const [base, relayer] of LISTED) if (u.startsWith(base + '/')) return listedFetch(base, relayer).then((f) => f(u, init)).catch((e) => { KEYS.delete(lc(relayer)); throw e; });
    return Promise.reject(new Error('The private route does not reach this relay.'));
  }
  // The registry relays this page may reach, as they are read; their keys are fetched ahead, quietly.
  function listRelays(list) {
    for (const r of list || []) if (!r.own && RL.usable(r.url) && isAddr(r.relayer)) { LISTED.set(r.url, r.relayer); listedFetch(r.url, r.relayer).catch(() => {}); }
  }
  // A bundler call through the wallet-read gateway (it sends to the fixed bundler of the chain); straight to the bundler
  // when that road fails. A user operation sent twice is one: the EntryPoint runs it once.
  const RPC = sealedFetch(OWN.rpc.url, OWN.rpc.gateway, (fw) => `${fw}/f/${OWN.rpc.id}`);
  const BUNDLER_URL = [[/^https:\/\/public\.pimlico\.io\/v2\/1\/rpc$/, 'pimlico'], [/^https:\/\/api\.candide\.dev\/public\/v3\/1$/, 'candide']];
  let bundlerSkip = 0;
  async function bundlerFetch(url, init = {}) {
    const which = BUNDLER_URL.find(([re]) => re.test(String(url)))?.[1];
    if (which && Date.now() >= bundlerSkip) {
      try {
        const r = await RPC(`${OWN.rpc.url}/1/evm-pool/keeper/bundler-${which}`, { method: 'POST', body: init.body, signal: init.signal });
        // a gateway that could not carry the call (404, 403) or was throttled (every caller leaves from its one address) is passed by, for a minute
        if (![403, 404, 429].includes(r.status) && r.status < 500) return r;
        bundlerSkip = Date.now() + 60_000;
      } catch (e) { if (init.signal?.aborted) throw e; bundlerSkip = Date.now() + 60_000; }
    }
    return fetch(url, init);
  }
  return { OWN, forwarders, setForwarders, relayFetch, listRelays, bundlerFetch, verifyDoc, seal };
})();
