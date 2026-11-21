// ── relays: the page's own and those anyone lists ──
// The relay registry on Ethereum (RelayRegistry, 0x0000…a01) holds a stake of TAC for each relay a person lists, made by
// the relay's own key, so the address a spend pins is the one that made the entry. A few entries are drawn at random for a
// visit (no relay is asked by everyone, and a visit's address is not handed to a crowd), next to the page's own relay. A
// spend asks each for a quote and takes among the cheapest: those within 25% of the lowest fee are drawn from with odds
// (lowest / fee)²; the rest follow by fee, for a spend that has to go elsewhere. A relay must quote the address it was
// listed under, and the proof binds it with the fee, so a relay can decline or delay a payment but never redirect it.
const RL = (() => {
  const REGISTRY = '0x00000000000299F48Fb844626ab96c6A20059a01';
  const ASKED = 5, PAGES = 6, ENTRIES = 300, GRACE_MS = 4_000, NEAR_PCT = 25n;
  const LIST = '0xd4d25113';   // list(uint64 chainId, uint256 start, uint256 max) → (address[] relayers, uint256[] stakes, string[] urls, uint256 next)
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  // A reply in the shape the contract returns, or null: a node that lies or fails is not trusted with more than being ignored.
  function decodeList(hexText) {
    if (typeof hexText !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hexText)) return null;
    const h = hexText.slice(2), size = h.length / 2;
    const at = (b) => (b >= 0 && b + 32 <= size ? BigInt(`0x${h.slice(b * 2, b * 2 + 64)}`) : null);
    const num = (b, max) => { const v = at(b); return v !== null && v <= BigInt(max) ? Number(v) : null; };
    const oA = num(0, size), oS = num(32, size), oU = num(64, size), next = at(96);
    if (oA === null || oS === null || oU === null || next === null) return null;
    const n = num(oA, 1000);
    if (n === null || n !== num(oS, 1000) || n !== num(oU, 1000)) return null;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = at(oA + 32 + 32 * i), s = at(oS + 32 + 32 * i), uo = num(oU + 32 + 32 * i, size);
      if (a === null || s === null || uo === null || a >= 1n << 160n) return null;
      const base = oU + 32 + uo, ul = num(base, 1000);
      if (ul === null || base + 32 + ul > size) return null;
      let url = '';
      for (let j = 0; j < ul; j++) url += String.fromCharCode(parseInt(h.slice((base + 32 + j) * 2, (base + 33 + j) * 2), 16));
      out.push({ relayer: `0x${a.toString(16).padStart(40, '0')}`, stake: s, url });
    }
    return { entries: out, next: next > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(next) };
  }
  // Every entry listed for `chainId`, a page at a time; a page that cannot be read ends the read with what came before it.
  async function readRegistry(call, chainId) {
    const out = [];
    let start = 0;
    for (let p = 0; p < PAGES && out.length < ENTRIES; p++) {
      let page = null;
      try { page = decodeList(await call(REGISTRY, `${LIST}${w(chainId)}${w(start)}${w(100)}`)); } catch { page = null; }
      if (!page) break;
      out.push(...page.entries.slice(0, ENTRIES - out.length));
      if (page.next === null || page.next <= start) break;   // a node that does not move on is not followed
      start = page.next;
    }
    return out;
  }
  // A host a listed relay may be at: a public DNS name with a dot, https, ending where the relay software serves.
  const LOCAL_TLD = /\.(?:local|localhost|internal|intranet|lan|home|corp|private|invalid|arpa)$/;
  const usable = (url) => {
    if (typeof url !== 'string' || !/^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/.test(url) || !/\/evm-pool\/keeper$/.test(url)) return false;
    const host = url.slice(8).split('/')[0].replace(/:\d+$/, '').toLowerCase();
    return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(host) && !/\.\d+$/.test(host) && !LOCAL_TLD.test(host);
  };
  // The relays for a spend: the page's own first (its URL and pinned address), then up to ASKED − 1 drawn from the listed
  // ones that are usable, one entry per URL and address, never one for the page's own URL (an entry made by someone else
  // for it cannot pin it to another address).
  function relaysFor(own, listed, random = Math.random) {
    const mine = own ? lc(own.url.replace(/\/+$/, '')) : null, seen = new Set(), pool = [];
    for (const e of listed) {
      const url = String(e.url || '').replace(/\/+$/, '');
      if (!usable(url) || !isAddr(e.relayer) || lc(url) === mine) continue;
      const k = `${lc(url)}|${lc(e.relayer)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push({ url, relayer: e.relayer });
    }
    const out = own ? [{ url: own.url.replace(/\/+$/, ''), relayer: own.relayer, own: true }] : [];
    while (out.length < ASKED && pool.length) out.push(...pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1));
    return out;
  }
  // [{ e, q }] → the one to use first, then the others by fee.
  const feeOf = (x) => BigInt(x.q.fee);
  function orderQuotes(quotes, random = Math.random) {
    if (quotes.length < 2) return [...quotes];
    const byFee = [...quotes].sort((a, b) => (feeOf(a) < feeOf(b) ? -1 : feeOf(a) > feeOf(b) ? 1 : 0)), low = feeOf(byFee[0]);
    const near = byFee.filter((x) => feeOf(x) * 100n <= low * (100n + NEAR_PCT));
    const odds = (x) => { const f = feeOf(x), r = f === 0n ? 1 : Number((low * 1_000_000n) / f) / 1e6; return r * r; };
    let draw = random() * near.reduce((t, x) => t + odds(x), 0), pick = near[near.length - 1];
    for (const x of near) { draw -= odds(x); if (draw < 0) { pick = x; break; } }
    return [pick, ...byFee.filter((x) => x !== pick)];
  }
  // A quote from each relay (`ask(e)` → a quote or null) without waiting on the slowest: those that answered GRACE_MS
  // after the first, or all of them once the last has answered or failed.
  function collectQuotes(entries, ask, graceMs = GRACE_MS) {
    return new Promise((resolve) => {
      const got = [];
      let pending = entries.length, done = false, timer = null;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve([...got]); };
      if (!pending) return finish();
      for (const e of entries) {
        Promise.resolve().then(() => ask(e)).then((q) => { if (q && !done) { got.push({ e, q }); if (!timer) timer = setTimeout(finish, graceMs); } }, () => {})
          .finally(() => { if (--pending === 0) finish(); });
      }
    });
  }
  return { decodeList, readRegistry, relaysFor, orderQuotes, collectQuotes, usable };
})();
