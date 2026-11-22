/* The page's private route over Nostr (ROUTE, its `carry`), against stand-in relays in place of WebSocket and with every forwarder
   down: the request event is read with the keeper's own reader (dapp/route-nostr.js of the tacit.finance app, which the keeper
   runs), the envelope opened with a gateway key made here, and the answer sent back as the keeper's reply event.

   TACIT=<a checkout of z0r0z/tacit> (default /Users/z/tacit-wt-tacitwei). Run: node test/dapp/route.nostr.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { loadTC } from './tornado-lib.mjs';

const TACIT = process.env.TACIT || '/Users/z/tacit-wt-tacitwei';
if (!fs.existsSync(`${TACIT}/dapp/route-nostr.js`)) { console.log(`no ${TACIT}/dapp/route-nostr.js: set TACIT to a checkout of z0r0z/tacit`); process.exit(1); }
const N = await import(`file://${TACIT}/dapp/route-nostr.js`);

let fail = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); if (!c) fail++; };
const { ROUTE, prim, ctx } = loadTC();
const U8 = vm.runInContext('Uint8Array', ctx), u8 = (b) => U8.from(b);
const { secp, keccak, cat, hex, SN } = prim;
const te = new TextEncoder(), td = new TextDecoder(), TAG = te.encode('tacit-sealed-v2');

// A gateway of the page's own relay's kind, with a key made here; the page's own key stays behind it.
const g = 0x1234567890abcdefn % SN, pub = secp.compress(secp.mulG(g)), kid = hex(keccak(cat(u8(te.encode('tacit-sealed-kid-v1')), pub)).subarray(0, 4));
ROUTE.setGateways([`keeper https://gw.example k ${hex(pub)}`]);
ok(ROUTE.OWN.keeper === 'https://gw.example', 'the gateway made here is the first of the page\'s own relay\'s kind');

// The gateway's side: the request opened, its answer sealed back to the same keys (dapp/page.html, ROUTE's header).
const aes = (k, use) => webcrypto.subtle.importKey('raw', k, 'AES-GCM', false, [use]);
const keyOf = (l, s, E, nonce, extra = new Uint8Array(0)) => keccak(cat(TAG, u8([l]), s, E, nonce, u8(extra)));
async function gateway(bytes, answer) {
  const b = u8(bytes), E = b.subarray(5, 38), nonce = b.subarray(38, 54), s = secp.compress(secp.mul(secp.decompress(E), g));
  const pt = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: keyOf(2, s, E, nonce).subarray(0, 12), additionalData: b.subarray(0, 54), tagLength: 128 }, await aes(keyOf(1, s, E, nonce), 'decrypt'), b.subarray(54)));
  const n = new DataView(pt.buffer).getUint32(0), req = JSON.parse(td.decode(pt.subarray(4, 4 + n)));
  const body = te.encode(JSON.stringify(answer(req))), head = te.encode(JSON.stringify({ s: 200, h: { 'content-type': 'application/json' }, z: 0, l: body.length }));
  const inner = new Uint8Array(Math.max(1024, 4 + head.length + body.length));
  new DataView(inner.buffer).setUint32(0, head.length); inner.set(head, 4); inner.set(body, 4 + head.length);
  const rn = webcrypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: keyOf(4, s, E, nonce, rn).subarray(0, 12), additionalData: cat(u8([2]), u8(rn)), tagLength: 128 }, await aes(keyOf(3, s, E, nonce, rn), 'encrypt'), inner));
  return { req, reply: new Uint8Array([2, ...rn, ...ct]) };
}

// Stand-in relays. `mode`: 'answer' (the keeper answers on this relay, after a reply that does not open), 'quiet' (takes the
// event, nobody answers), 'closed' (the connection closes at once).
const seen = [], opened = [];
let modes = {};
class Relay {
  constructor(url) { this.url = url; opened.push(url); this.subs = new Map(); setTimeout(() => (modes[url] === 'closed' ? this.onclose?.() : this.onopen?.()), 5); }
  close() { this.closed = true; }
  push(sub, ev) { if (!this.closed) setTimeout(() => this.onmessage?.({ data: JSON.stringify(['EVENT', sub, ev]) }), 5); }
  async send(text) {
    const m = JSON.parse(text);
    if (m[0] === 'REQ') return this.subs.set(m[1], m[2]);
    if (m[0] !== 'EVENT') return;
    const ev = m[1];
    seen.push({ url: this.url, ev });
    if (modes[this.url] !== 'answer') return;
    const bytes = N.readRequest(ev, { kidHex: kid });
    if (!bytes) return;
    const { req, reply } = await gateway(bytes, (r) => ({ chainId: 1, relayer: '0x' + '7c'.repeat(20), fee: '77500000000000', asked: `${r.m} ${r.p}` }));
    ev.asked = req;
    for (const [sub, f] of this.subs) {
      if (!f.kinds.includes(N.REP_KIND) || !f['#e'].includes(ev.id)) continue;
      this.push(sub, N.makeReplyEvent(webcrypto.getRandomValues(new Uint8Array(1100)), ev.id));   // anyone can send a reply: one that does not open is passed over
      this.push(sub, N.makeReplyEvent(reply, ev.id));
    }
  }
}
Object.assign(ctx, { WebSocket: Relay, btoa, atob });   // what a browser has
const fetched = [];
ctx.fetch = async (u) => { fetched.push(String(u)); throw new TypeError('Failed to fetch'); };
ROUTE.setNostr(['wss://one.example', 'wss://two.example', 'ws://plain.example', 'https://not.example']);

console.log('every forwarder down: the request goes over Nostr');
modes = { 'wss://one.example': 'quiet', 'wss://two.example': 'answer' };
const t0 = Date.now();
const r = await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/quote?gas=600000', { signal: AbortSignal.timeout(20_000) });
const q = await r.json();
ok(r.status === 200 && q.fee === '77500000000000' && q.asked === 'GET /1/evm-pool/keeper/quote?gas=600000', 'the answer is the gateway\'s, opened by the request\'s own keys', `${Date.now() - t0} ms`);
ok(fetched.length >= 2 && fetched.every((u) => /^https:\/\/tacit-evm-pool-forwarder(-2)?\.onrender\.com\/f\/k$/.test(u)), 'the forwarders were tried first, and nothing went to the relay in the open', fetched.join(' '));
ok(JSON.stringify([...new Set(opened)]) === '["wss://one.example","wss://two.example"]', 'only the wss:// relays the registry may name are used', opened.join(' '));
const ev = seen[0].ev;
ok(seen.length === 2 && seen[0].ev.id === seen[1].ev.id, 'one event, sent to each relay');
ok(!!N.readRequest(ev, { kidHex: kid }), 'the keeper\'s own reader takes it: signed, mined to 12 bits, current, for this gateway\'s key id');
ok(JSON.stringify(ev.tags.map((t) => t[0])) === '["x","t","expiration","nonce"]' && ev.tags[0][1] === kid && ev.kind === N.REQ_KIND && Number(ev.tags[2][1]) - ev.created_at === 300, 'and it carries the key id, the road\'s tag, its five-minute end and its nonce, nothing more');
const env = Buffer.from(ev.content, 'base64');
ok([8192, 16384, 32768].includes(env.length - 70) && env[0] === 2 && hex(env.subarray(1, 5)) === kid, 'its content is the sealed envelope a forwarder is given, padded to a fixed size', String(env.length));

console.log('\nanother request: a key of its own');
seen.length = 0;
await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/head', { signal: AbortSignal.timeout(20_000) });
ok(seen.length && seen[0].ev.pubkey !== ev.pubkey && seen[0].ev.content !== ev.content, 'each event is signed by a key made for it, and its envelope sealed afresh');

console.log('\nno relay answers');
modes = { 'wss://one.example': 'closed', 'wss://two.example': 'closed' };
const t1 = Date.now();
const e = await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/quote', { signal: AbortSignal.timeout(20_000) }).then(() => null, (x) => x);
ok(e && /Failed to fetch|did not answer/.test(e.message) && Date.now() - t1 < 5_000, 'the request fails as the forwarders did, without waiting out the time', `${e?.message} · ${Date.now() - t1} ms`);
modes = { 'wss://one.example': 'quiet', 'wss://two.example': 'quiet' };
const t2 = Date.now();
const e2 = await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/quote', { signal: AbortSignal.timeout(1_500) }).then(() => null, (x) => x);
ok(e2 && Date.now() - t2 < 3_000, 'and a request with a deadline ends at it', `${e2?.name || e2?.message} · ${Date.now() - t2} ms`);

console.log('\nthe wallet-read gateway is not carried over Nostr');
opened.length = 0;
ctx.confirm = () => false;
const b = await ROUTE.bundlerFetch('https://public.pimlico.io/v2/1/rpc', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then(() => null, (x) => x);
ok(b && opened.length === 0, 'a bundler call with no forwarder answering opens no Nostr connection', b?.message);

console.log('\nswitched off under Endpoints: no Nostr connection is opened');
opened.length = 0;
ROUTE.setNostrOff(true);
const off = await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/quote?gas=600000', { signal: AbortSignal.timeout(5_000) }).then(() => null, (x) => x);
ok(off && opened.length === 0, 'with every forwarder down the request fails and nothing is sent to a Nostr relay', `${off?.message} · ${opened.length} connection(s)`);
ROUTE.setNostrOff(false);
opened.length = 0;
modes = { 'wss://one.example': 'answer', 'wss://two.example': 'answer' };
const back = await ROUTE.relayFetch('https://gw.example/1/evm-pool/keeper/quote?gas=600000', { signal: AbortSignal.timeout(20_000) }).then((r) => r.status, (x) => x.message);
ok(back === 200 && opened.length > 0, 'and switched on again it is carried as before', String(back));

console.log(`\n${fail ? fail + ' FAILED' : 'all passed'}`);
process.exit(fail ? 1 : 0);
