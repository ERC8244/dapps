// ── fixed-denomination pools (Tornado Cash) ──
// A fixed pool holds notes of one size (0.1, 1, 10 or 100 ETH), so a note says nothing about the amount beyond that size,
// and its pools are deep. A deposit of a whole note or more puts the whole notes there and the rest into the Tacit pool,
// which takes any amount and sends inside itself; under the smallest note, all of it goes to Tacit and none of this shows.
// Notes come from a seed of the sign-in or of the post-quantum words (no prompt), or from the wallet's signature (the
// wallet keychain's scheme, which other tools read), so each finds them again. A note leaves with its gas paid from the note (the keychain's pool paymaster through a
// public bundler, one ERC-4337 operation from a throwaway account) or from the wallet. Nothing here touches the page: the
// page passes in its node, its wallet and what it shows.
const TC = (() => {
  const ETHER = 10n ** 18n, ZERO = '0x' + '00'.repeat(20);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (n) => '0x' + BigInt(n).toString(16);
  const w32 = (n) => be(BigInt(n));
  const hx = (b) => '0x' + hex(b);
  const hexBytes = (h) => unhex(String(h).replace(/^0x/, ''));
  const addr20 = (a) => unhex(String(a).replace(/^0x/i, '').toLowerCase().padStart(40, '0'));
  const sel = (sig) => hx(selector(sig));
  const leBig = (b) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };

  // ---- the pools ----
  // Canonical pools only: other addresses carry the same code, but nobody deposits there any more, and a note in an empty
  // pool is no cover. The denominations are read back from each pool before a deposit.
  const POOLS = Object.freeze([
    { denomination: ETHER / 10n, address: '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc', deployBlock: 9116966 },
    { denomination: ETHER, address: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936', deployBlock: 9117609 },
    { denomination: 10n * ETHER, address: '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF', deployBlock: 9117720 },
    { denomination: 100n * ETHER, address: '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291', deployBlock: 9161895 },
  ].map(Object.freeze));
  // Newer pools of the same code and verifier (0.01, 0.03, 0.3, 3 and 30 ETH), which other tools deposit into and the
  // paymaster takes: a note made there is found and taken out here, but nothing is deposited there (they hold a handful of
  // deposits, no cover).
  const MORE_POOLS = Object.freeze([
    { denomination: ETHER / 100n, address: '0x199112Eb461ea7eeC1D75B33343542e1d069B41c', deployBlock: 26198980 },
    { denomination: 3n * ETHER / 100n, address: '0x398971a7Ae0FeD4ae435F353eF00D3d4e4c18fD4', deployBlock: 26198980 },
    { denomination: 3n * ETHER / 10n, address: '0xf22487b84A618192aa68C0E1da24e9Bbd892f774', deployBlock: 26198980 },
    { denomination: 3n * ETHER, address: '0x74185A3f30b873c0ce1F4257298D1CdA61be2f9f', deployBlock: 26198980 },
    { denomination: 30n * ETHER, address: '0xC11197f71C7730C8B5dB7C84191E07575F1DB896', deployBlock: 26198983 },
  ].map(Object.freeze));
  const ALL_POOLS = Object.freeze([...POOLS, ...MORE_POOLS]);
  const CHAIN_ID = 1;
  const poolOf = (a) => ALL_POOLS.find((p) => p.address.toLowerCase() === String(a).toLowerCase()) || null;
  // Each note is a deposit of about a million gas; past this many, the rest goes to Tacit.
  const MAX_NOTES = 6;
  const SMALLEST = [10n ** 17n, ETHER, 10n * ETHER];

  // Whole notes for the fixed pools, largest first, and the remainder for Tacit. A denomination below `min` is not used;
  // `maxNotes` caps the deposits and what it leaves out is part of the remainder.
  function planSplit(amountWei, { min = ETHER, maxNotes = MAX_NOTES } = {}) {
    let left = BigInt(amountWei);
    if (left < 0n) throw new Error('amount below zero');
    const pools = POOLS.filter((p) => p.denomination >= BigInt(min)).sort((a, b) => (a.denomination < b.denomination ? 1 : -1));
    const notes = [];
    let budget = maxNotes;
    for (const p of pools) {
      if (budget <= 0) break;
      const fit = left / p.denomination, count = fit < BigInt(budget) ? Number(fit) : budget;
      if (!count) continue;
      notes.push({ denomination: p.denomination, address: p.address, count });
      left -= p.denomination * BigInt(count);
      budget -= count;
    }
    return { notes, remainder: left, noteCount: maxNotes - budget };
  }
  // Whole notes for a withdrawal of `amount`: the largest first, each only if it still fits, so what the notes pay never
  // passes what was asked. `dens` are the sizes held; the picks are indices into it.
  function planExit(amount, dens) {
    const order = dens.map((d, i) => [BigInt(d), i]).sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] < y[0] ? 1 : -1));
    const picks = [];
    let total = 0n;
    for (const [d, i] of order) if (d > 0n && total + d <= amount) { picks.push(i); total += d; }
    return { picks, total };
  }

  // ---- BLAKE-256 (the SHA-3 finalist, not BLAKE2: the Pedersen generators are defined by it) ----
  const BC = new Uint32Array([0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344, 0xa4093822, 0x299f31d0, 0x082efa98, 0xec4e6c89, 0x452821e6, 0x38d01377, 0xbe5466cf, 0x34e90c6c, 0xc0ac29b7, 0xc97c50dd, 0x3f84d5b5, 0xb5470917]);
  const BIV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const SIGMA = ['0123456789abcdef', 'ea489fd61c02b753', 'b8c052fdae367194', '7931dcbe265a40f8', '905724afe1bc683d', '2c6a0b834d75fe19', 'c51fed4a0763928b', 'db7ec13950f4862a', '6fe9b308c2d714a5', 'a2847615fb9e3cd0'].map((s) => [...s].map((c) => parseInt(c, 16)));
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  function blake256(msg) {
    const len = msg.length, total = Math.ceil((len + 9) / 64) * 64, buf = new Uint8Array(total);
    buf.set(msg); buf[len] = 0x80; buf[total - 9] |= 0x01;
    new DataView(buf.buffer).setBigUint64(total - 8, BigInt(len) * 8n, false);
    const h = Uint32Array.from(BIV), m = new Uint32Array(16), v = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
      const dv = new DataView(buf.buffer, off, 64);
      for (let i = 0; i < 16; i++) m[i] = dv.getUint32(i * 4, false);
      // the counter is the message bits seen so far, and zero for a block that holds none of them
      const seen = off >= len ? 0n : BigInt(Math.min(off + 64, len)) * 8n, t0 = Number(seen & 0xffffffffn), t1 = Number(seen >> 32n);
      for (let i = 0; i < 8; i++) v[i] = h[i];
      for (let i = 0; i < 4; i++) v[8 + i] = BC[i];
      v[12] = (t0 ^ BC[4]) >>> 0; v[13] = (t0 ^ BC[5]) >>> 0; v[14] = (t1 ^ BC[6]) >>> 0; v[15] = (t1 ^ BC[7]) >>> 0;
      const G = (r, i, a, b, c, d) => {
        const s = SIGMA[r % 10];
        v[a] = (v[a] + v[b] + (m[s[2 * i]] ^ BC[s[2 * i + 1]])) >>> 0; v[d] = rotr(v[d] ^ v[a], 16);
        v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 12);
        v[a] = (v[a] + v[b] + (m[s[2 * i + 1]] ^ BC[s[2 * i]])) >>> 0; v[d] = rotr(v[d] ^ v[a], 8);
        v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr(v[b] ^ v[c], 7);
      };
      for (let r = 0; r < 14; r++) {
        G(r, 0, 0, 4, 8, 12); G(r, 1, 1, 5, 9, 13); G(r, 2, 2, 6, 10, 14); G(r, 3, 3, 7, 11, 15);
        G(r, 4, 0, 5, 10, 15); G(r, 5, 1, 6, 11, 12); G(r, 6, 2, 7, 8, 13); G(r, 7, 3, 4, 9, 14);
      }
      for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
    return out;
  }

  // ---- Pedersen hash on BabyJubJub (circomlib's construction) ----
  const BJ_A = 168700n, BJ_D = 168696n, HALF = (FR - 1n) / 2n;
  // circomlib's point decoding: the sign bit says "x is in the upper half", and the lower root is taken before it applies.
  function decodePoint(bytes) {
    const w = Uint8Array.from(bytes), sign = (w[31] & 0x80) !== 0;
    w[31] &= 0x7f;
    const y = leBig(w);
    if (y >= FR) return null;
    const y2 = y * y % FR, den = mod(BJ_A - BJ_D * y2 % FR, FR);
    if (!den) return null;
    let x = bj.sqrt(mod((1n - y2) * inv(den, FR), FR));
    if (x === null) return null;
    if (x > HALF) x = mod(-x, FR);
    if (sign) x = mod(-x, FR);
    return [x, y];
  }
  const GENS = [];
  function generator(i) {
    if (GENS[i]) return GENS[i];
    const pad = (n) => String(n).padStart(32, '0');
    let p = null;
    for (let t = 0; !p; t++) { const h = blake256(utf8(`PedersenGenerator_${pad(i)}_${pad(t)}`)); h[31] &= 0b10111111; p = decodePoint(h); }
    return (GENS[i] = bj.mul(p, 8n));   // into the prime-order subgroup
  }
  // Each 25-byte chunk is one scalar: every nibble a signed digit in 1..8, five bits apart.
  function pedersenPoint(msg) {
    let acc = [0n, 1n];
    for (let pos = 0, j = 0; pos < msg.length; pos += 25, j++) {
      let s = 0n, shift = 1n;
      const digit = (n) => { const d = BigInt((n & 7) + 1); return n & 8 ? -d : d; };
      for (const b of msg.subarray(pos, pos + 25)) { s += digit(b & 15) * shift; shift <<= 5n; s += digit(b >>> 4) * shift; shift <<= 5n; }
      acc = bj.add(acc, bj.mul(generator(j), s < 0n ? BJ_L + s : s));
    }
    return acc;
  }

  // ---- secrets, the commitment and the note text ----
  // Wire strings of the note format: other tools check the signature against these, so they stay as they are.
  const DOMAIN_SALT = hx(keccak(utf8('tornado')));
  const noteTypedData = (nonce) => ({
    domain: { name: 'TornadoCash Keychain', version: '1', chainId: CHAIN_ID, salt: DOMAIN_SALT },
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'salt', type: 'bytes32' }],
      TornadoCashNote: [{ name: 'nonce', type: 'uint64' }],
    },
    primaryType: 'TornadoCashNote',
    message: { nonce: String(nonce) },
  });
  // r || s with s in the lower half: two signers that differ only in s or v still agree.
  function canonicalRS(sigHex) {
    const sig = hexBytes(sigHex);
    if (sig.length !== 65) throw new Error('A signature must be 65 bytes.');
    const s = big(sig.subarray(32, 64));
    return cat(sig.subarray(0, 32), be(s > SN / 2n ? SN - s : s));
  }
  const trunc31 = (tag, pool, rs) => keccak(cat(utf8(tag), addr20(pool), rs)).subarray(0, 31);
  // The commitment alone, for looking a note up (its nullifier hash is made once it is found).
  const commitmentOf = (rs, pool) => pedersenPoint(cat(trunc31('nullifier', pool, rs), trunc31('secret', pool, rs)))[0];
  function secretsOf(rs, pool) {
    const nullifier = trunc31('nullifier', pool, rs), secret = trunc31('secret', pool, rs), preimage = cat(nullifier, secret);
    return { nullifier, secret, preimage, commitment: pedersenPoint(preimage)[0], nullifierHash: pedersenPoint(nullifier)[0] };
  }
  const deriveSecrets = (signature, pool) => secretsOf(canonicalRS(signature), pool);
  // A note from a 32-byte seed the page holds (from the Tacit key, or the post-quantum root) with no signature: in place of a
  // signature's r || s, HMAC-SHA256(seed, "tacit-wei-note-v1" || nonce as 32 bytes), through the same two hashes.
  const seedRS = (seed, nonce) => hmac(seed, cat(utf8('tacit-wei-note-v1'), be(nonce)));
  const b32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  const depositCall = (pool, commitment) => ({ to: pool.address, value: pool.denomination, data: '0xb214faa5' + b32(commitment).slice(2) });
  const ethWords = (wei) => { const w = BigInt(wei), f = (w % ETHER).toString().padStart(18, '0').replace(/0+$/, ''); return f ? `${w / ETHER}.${f}` : String(w / ETHER); };
  // <prefix>-eth-<amount>-<chainId>-0x<62-byte preimage>: the single-line format every tool of this kind reads.
  const noteString = (denomination, preimage) => `tornado-eth-${ethWords(denomination)}-${CHAIN_ID}-0x${hex(preimage)}`;
  function parseNote(text) {
    const m = /^[a-z]+-eth-([0-9.]+)-(\d+)-0x([0-9a-fA-F]{124})$/.exec(String(text).trim());
    if (!m) throw new Error('That is not a note.');
    const preimage = unhex(m[3]), nullifier = preimage.slice(0, 31);
    return { amount: m[1], chainId: Number(m[2]), preimage, nullifier, commitment: pedersenPoint(preimage)[0], nullifierHash: pedersenPoint(nullifier)[0] };
  }

  // ---- deposit history ----
  // From a published chunk cache (gzip files of logs, each with a SHA-256 in a manifest) and, for the stretch after it, the
  // page's node. Nothing read here is trusted: the tree built from it must land on a root the pool knows, which is checked
  // before anything is proved. Each cache in turn; with none answering, the node alone (slow on a long history).
  const CACHES = ['https://saga.0000000000.org'];
  const DEPOSIT_TOPIC = hx(keccak(utf8('Deposit(bytes32,uint32,uint256)')));
  const num = (h) => Number(BigInt(h));
  const depositOf = ({ topics, data, blockNumber, address }) => (!topics || lc(topics[0]) !== DEPOSIT_TOPIC || topics.length < 2 || typeof data !== 'string' ? null
    : { index: Number(BigInt('0x' + data.slice(2, 66))), commitment: lc(topics[1]), block: num(blockNumber), pool: lc(address) });
  // A stream read whole, refused past `max` bytes (a host that sends more than any honest file is not read to the end).
  async function capped(stream, max) {
    const reader = stream.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) { reader.cancel().catch(() => {}); throw new Error('a cache file is larger than any should be'); }
      parts.push(value);
    }
    return cat(...parts);
  }
  const MAX_GZ = 64 << 20, MAX_RAW = 256 << 20;
  const gunzip = (bytes, max = MAX_RAW) => capped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), max);
  // `from`: only the files that reach past that block, and `until`: that start before it; `manifest`: the index, when it
  // was read already.
  async function readChunkCache({ base, pool, fetchImpl, onProgress = () => {}, from = 0, until = Infinity, manifest = null }) {
    manifest ||= await (await fetchImpl(`${base}/index.json`)).json();
    const entry = manifest.availableProtocols?.[`tornado-cash-${CHAIN_ID}-eth-${ethWords(pool.denomination)}`];
    if (!entry) throw new Error('the cache has no stream for this pool');
    if (!entry.trackedAddresses?.some((a) => lc(a) === lc(pool.address))) throw new Error('the cache tracks another address for this pool');
    // The files hold the pool's Withdrawal events too, when the index tracks that topic: read here with the deposits.
    const hasW = !!entry.trackedEventTopics?.some((t) => lc(t) === WITHDRAWAL_TOPIC), withdrawals = [];
    const all = [...entry.chunks, ...(entry.hotHead ? [entry.hotHead] : [])], deposits = [];
    // one run of blocks with no gap or overlap, from the first file on
    for (let i = 1; i < all.length; i++) if (num(all[i].fromBlock) !== num(all[i - 1].toBlock)) throw new Error('the cache\'s files are not one run of blocks');
    const parts = all.filter((p) => num(p.toBlock) > from && num(p.fromBlock) < until);
    if (parts.length && num(parts[0].fromBlock) > Math.max(from, pool.deployBlock)) throw new Error('the cache starts after the blocks asked for');
    let upTo = 0, done = 0;
    for (const part of parts) {
      // names are the stream and its block range, e.g. tornado-cash-1-eth-0.1-[0x8b1d26,0xbcb3fb).jsonl.gz: one flat name, sent encoded
      if (typeof part.file !== 'string' || !/^[\w.,()[\]-]+$/.test(part.file) || part.file.includes('..')) throw new Error('a cache file has an odd name');
      const res = await fetchImpl(`${base}/${encodeURIComponent(part.file)}`);
      if (!res.ok) throw new Error(`the cache did not give ${part.file}`);
      const raw = await gunzip(res.body ? await capped(res.body, MAX_GZ) : new Uint8Array(await res.arrayBuffer()));
      if ((globalThis.crypto?.subtle ? '0x' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw))) : hx(sha256(raw))) !== lc(part.digest?.data)) throw new Error(`a cache file does not match its digest (${part.file})`);
      const from = num(part.fromBlock), to = num(part.toBlock);
      let prev = null;
      for (const line of new TextDecoder().decode(raw).split('\n')) {
        if (!line) continue;
        const ev = JSON.parse(line), at = [num(ev.blockNumber), num(ev.logIndex)];
        if (prev && (at[0] < prev[0] || (at[0] === prev[0] && at[1] <= prev[1]))) throw new Error('cache events out of order');
        prev = at;
        if (at[0] < from || at[0] >= to) throw new Error('a cache event is outside its file\'s blocks');
        const ad = ev.address || ev.contractAddress;
        if (ad && lc(ad) !== lc(pool.address)) continue;
        const d = depositOf(ev);
        if (d) deposits.push(d);
        else if (hasW) { const w = withdrawalOf({ ...ev, address: ad || pool.address }); if (w) withdrawals.push(w); }
      }
      upTo = Math.max(upTo, to);
      onProgress({ done: ++done, of: parts.length });
    }
    return { deposits, withdrawals: hasW ? withdrawals : null, upTo: Math.max(upTo, from) };
  }
  // The pool's deposit logs in [from, to), in pieces, halving a piece the node refuses. `address` may list several pools;
  // `topic` and `of` read another event.
  async function readTail({ getLogs, address, from, to, piece = 20000, topic = DEPOSIT_TOPIC, of = depositOf }) {
    const out = [];
    const grab = async (a, b) => {
      try { for (const log of await getLogs({ address, topics: [topic], fromBlock: q(a), toBlock: q(b - 1) })) { const d = of(log); if (d) out.push(d); } } catch (e) {
        if (b - a <= 1) throw e;
        const mid = a + Math.floor((b - a) / 2);
        await grab(a, mid); await grab(mid, b);
      }
    };
    // three pieces at a time
    const starts = [];
    for (let a = from; a < to; a += piece) starts.push(a);
    for (let i = 0; i < starts.length; i += 3) await Promise.all(starts.slice(i, i + 3).map((a) => grab(a, Math.min(a + piece, to))));
    return out;
  }
  // The pool's commitments, 32 bytes each in leaf order. Throws unless the leaf numbers are exactly 0..n-1.
  // A cache whose deposits do not add up (a gap in the leaf numbers, two different deposits at one) is read past: the node alone
  // gives the history then, slower but from the chain itself.
  async function poolLeaves(args) {
    try { return await leavesFrom(args); } catch (e) {
      if (!args.caches?.length && args.caches !== undefined) throw e;
      if (!/leaf \d+ is missing|two different deposits/.test(e.message)) throw e;
      args.onProgress?.({ note: 'cache: its deposits did not add up' });
      return leavesFrom({ ...args, caches: [] });
    }
  }
  async function leavesFrom({ pool, getLogs, blockNumber, caches = CACHES, fetchImpl = (u, i) => fetch(u, i), onProgress = () => {} }) {
    let deposits = [], upTo = pool.deployBlock, why = null, cached = false;
    for (const base of caches) {
      try { ({ deposits, upTo } = await readChunkCache({ base, pool, fetchImpl, onProgress })); why = null; cached = true; break; } catch (e) { deposits = []; upTo = pool.deployBlock; why = e; }
    }
    if (why) onProgress({ note: `cache: ${why.message}` });
    const tip = await blockNumber(), me = lc(pool.address);
    // the stretch after a cache is asked of the node for every pool (the request names none); with no cache, for this pool
    // alone, since every pool from its start is many times the logs
    const tail = (await readTail({ getLogs, address: cached ? ALL_POOLS.map((p) => p.address) : pool.address, from: upTo, to: tip + 1 })).filter((d) => d.pool === me);
    const byIndex = new Map(), blockAt = new Map();
    for (const d of [...deposits, ...tail]) {
      const had = byIndex.get(d.index);
      if (had && had !== d.commitment) throw new Error(`two different deposits read at leaf ${d.index}`);
      byIndex.set(d.index, d.commitment);
      blockAt.set(d.index, d.block);
    }
    const n = byIndex.size, bytes = new Uint8Array(n * 32), blocks = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = byIndex.get(i);
      if (!c) throw new Error(`leaf ${i} is missing from the deposits read`);
      bytes.set(hexBytes(c), i * 32);
      blocks[i] = blockAt.get(i) || 0;
    }
    return { bytes, count: n, blocks };
  }

  // ---- reading the pools without naming a note ----
  // A node asked whether one commitment is in a pool, or one nullifier hash spent, learns which notes are the asker's,
  // and who asks. So deposits and withdrawals are read in bulk instead (each pool's deposits from the published cache,
  // then the node's logs of all the pools at once for a run of blocks) and the notes are looked for here. A reader who
  // runs a node of their own may ask it directly instead (a flow with no book).
  const WITHDRAWAL_TOPIC = hx(keccak(utf8('Withdrawal(address,bytes32,address,uint256)')));
  const withdrawalOf = ({ topics, data, blockNumber, address, transactionHash }) => (!topics || lc(topics[0]) !== WITHDRAWAL_TOPIC || typeof data !== 'string' || data.length < 194 ? null
    : { nh: lc('0x' + data.slice(66, 130)), to: lc('0x' + data.slice(26, 66)), block: num(blockNumber), pool: lc(address), tx: lc(transactionHash) });
  // No note made from a sign-in's seed (or the post-quantum root's) is older than this block: the seeds came after it.
  const NOTES_FROM = 26_198_980;
  // A note's spent check reads at most this many blocks of its pool's withdrawals; an older note's withdrawal says it.
  const SPENT_SPAN = 2_000_000;
  // → { tip(), deposits(pools, from), withdrawals(pools, from), deposit(pool, c), withdrawal(pool, nh) }: what was read is
  // kept, and a later read goes on from where the last stopped.
  // `read`: the node, for each pool's deposit count at the head (the deposits read must run to it with no gap; a pool's
  // that do not are read again from the node alone). `others()`: getLogs of other single nodes, which confirm a withdrawal.
  function poolBook({ getLogs, blockNumber, read = null, others = () => [], caches = CACHES, fetchImpl = (u, i) => fetch(u, i) }) {
    const P = new Map(), manifests = new Map(), wins = new Map();
    const at = (pool) => { const k = lc(pool.address); if (!P.has(k)) P.set(k, { from: Infinity, upTo: 0, byC: new Map(), wFrom: Infinity, wUpTo: 0, byNh: new Map() }); return P.get(k); };
    const manifestOf = (base) => { if (!manifests.has(base)) manifests.set(base, fetchImpl(`${base}/index.json`).then((r) => r.json()).catch((e) => { manifests.delete(base); throw e; })); return manifests.get(base); };
    let tipN = 0, tipAt = 0;
    const tip = async () => { if (Date.now() - tipAt > 4000) { tipN = Number(await blockNumber()); tipAt = Date.now(); } return tipN; };
    // Each request is the same for every reader: all the pools, from a block that names no note (NOTES_FROM for any note
    // made from a seed, else the 100,000-block run it falls in), each read going on from the last (64 blocks back, for a
    // node whose logs lag its head). The pools named in a call only say what is looked for here.
    const pools = ALL_POOLS, edge = (b) => (b >= NOTES_FROM ? NOTES_FROM : Math.max(0, b - (b % 100_000)));
    // Every deposit from block `from` (or each pool's first) to the head. Reads run one at a time, so two callers share
    // what the first fetched; a read from further back fetches only the files before what was read already.
    let queue = Promise.resolve();
    const deposits = (...a) => (queue = queue.catch(() => {}).then(() => depositsNow(...a)));
    async function depositsNow(_, from = NOTES_FROM, onProgress = () => {}) {
      const t = await tip();
      from = edge(from);
      for (const p of pools) {
        const s = at(p), start = Math.max(from, p.deployBlock), until = s.from;
        if (until <= start) continue;
        let got = null;
        for (const base of caches) {
          try { got = await readChunkCache({ base, pool: p, fetchImpl, onProgress, from: start, until, manifest: await manifestOf(base) }); break; } catch (e) { onProgress({ note: `cache: ${e.message}` }); }
        }
        // a file can begin before `start`: only its deposits from `start` on are kept, so the leaf numbers read begin at the
        // pool's count at the block before it
        for (const d of got?.deposits ?? []) if (d.block >= start) s.byC.set(d.commitment, { index: d.index, block: d.block });
        // with no cache, the node reads from the new start; a cache that ends before what was read leaves the gap to the tail
        s.upTo = !got ? start : until === Infinity || got.upTo < until ? got.upTo : s.upTo;
        const joins = got && s.cw && got.upTo >= until;
        if (got?.withdrawals) s.cw = { start, upTo: joins ? Math.max(got.upTo, s.cw.upTo) : got.upTo, list: [...got.withdrawals, ...(joins ? s.cw.list : [])] };
        else if (until === Infinity) s.cw = null;
        s.from = start; delete s.ok; delete s.n0;
      }
      await tail(pools, t);
      const off = [];
      for (const p of pools) if (!(await whole(p, true))) { off.push(p); onProgress({ note: `the ${ethWords(p.denomination)} ETH pool's deposits read did not add up, so they are read from the node` }); }
      if (!off.length) return;
      // the node's deposits of every pool from its first block on, with what was read (a gap must close)
      for (const p of pools) at(p).upTo = at(p).from;
      await tail(pools, t);
      for (const p of off) if (!(await whole(p, false))) throw new Error('The pool\'s deposits read do not add up. Try again in a minute.');
    }
    async function tail(pools, t) {
      const lo = Math.min(...pools.map((p) => Math.max(at(p).from, at(p).upTo - 64)));
      if (lo > t) return;
      for (const d of await readTail({ getLogs, address: pools.map((p) => p.address), from: lo, to: t + 1 })) P.get(d.pool)?.byC.set(d.commitment, { index: d.index, block: d.block });
      for (const p of pools) at(p).upTo = Math.max(at(p).upTo, t + 1);
    }
    // The leaf numbers read run with no gap from the pool's count at the block before the first read (0 from its
    // deployment) to its count at the last block read. That first count needs a node that keeps old state: with none
    // answering, deposits from the cache are read again from the node, and the node's own are taken from their first
    // leaf. A count at the head that cannot be read stops the read (`read` tries the nodes in turn).
    async function whole(p, first) {
      const s = at(p);
      if (!read || s.ok === s.upTo) return true;
      const count = async (b) => Number(BigInt(await read('eth_call', [{ to: p.address, data: '0xfc7e9c6f' }, q(b)])));
      let n, n0 = s.from > p.deployBlock ? null : 0;
      try { n = await count(s.upTo - 1); } catch { throw new Error('Could not read the pool\'s deposit count, so the deposits read are not checked. Try again in a minute.'); }
      if (n0 == null) n0 = s.n0 ?? (s.n0 = await count(s.from - 1).catch(() => null));
      let lo = Infinity, hi = -1;
      for (const d of s.byC.values()) { lo = Math.min(lo, d.index); hi = Math.max(hi, d.index); }
      const ok = n0 != null ? (s.byC.size ? hi === n - 1 && lo === n0 && n - lo === s.byC.size : n === n0)
        : !first && (s.byC.size ? hi === n - 1 && n - lo === s.byC.size : true);
      if (ok) s.ok = s.upTo;
      return ok;
    }
    // Every withdrawal from block `from` to the head: from the cache's files over the blocks they cover (no node is asked),
    // the node for the rest. A far-back read fetches the cache for it; with none that has withdrawals, the node reads it all.
    // The cache's word is one source like a node's (`confirmed` asks others); one that leaves a withdrawal out only makes a
    // note look unspent, and the pool itself refuses that note's withdrawal.
    async function withdrawals(_, from) {
      const t = await tip();
      from = edge(from);
      for (const p of pools) { const s = at(p); if (s.wFrom > from) Object.assign(s, { wFrom: from, wUpTo: from, byNh: new Map() }); }
      if (t - from > 50_000 && pools.some((p) => !at(p).cw && !at(p).wTried)) {
        for (const p of pools) at(p).wTried = true;
        await deposits(pools, from).catch(() => {});
      }
      for (const p of pools) {
        const s = at(p), cw = s.cw;
        if (!cw || cw.start > Math.max(s.wFrom, p.deployBlock) || s.wUpTo >= cw.upTo) continue;
        for (const w of cw.list) s.byNh.set(w.nh, { nh: w.nh, to: w.to, block: w.block, tx: w.tx });
        s.wUpTo = cw.upTo;
      }
      const lo = Math.min(...pools.map((p) => Math.max(at(p).wFrom, at(p).wUpTo - 64)));
      if (lo > t) return;
      for (const w of await readTail({ getLogs, address: pools.map((p) => p.address), from: lo, to: t + 1, topic: WITHDRAWAL_TOPIC, of: withdrawalOf })) P.get(w.pool)?.byNh.set(w.nh, { nh: w.nh, to: w.to, block: w.block, tx: w.tx });
      for (const p of pools) at(p).wUpTo = Math.max(at(p).wUpTo, t + 1);
    }
    // A withdrawal one node served counts only once two others serve it too, asked for every withdrawal of the pools in
    // the run of blocks around it (not for this one): 5,000 blocks, or 100 from a node that takes no more.
    async function confirmed(pool, nh) {
      const w = at(pool).byNh.get(b32(nh)), list = others();
      if (!w || w.ok) return !!w;
      const a = w.block - (w.block % 100), f = { address: ALL_POOLS.map((p) => p.address), topics: [WITHDRAWAL_TOPIC], fromBlock: q(a), toBlock: q(Math.max(w.block, Math.min(a + 99, tipN))) };
      // the run is asked once and shared by the notes in it (all pools, so none is named); a run a node refused is asked again
      let got = wins.get(a);
      if (!got) { got = Promise.all(list.map((g) => g(f).catch(() => null))); wins.set(a, got); got.then((r) => { if (r.includes(null)) wins.delete(a); }); }
      const yes = (await got).map((ls) => !!ls && ls.some((l) => { const x = withdrawalOf(l); return x?.nh === w.nh && x.block === w.block && x.pool === lc(pool.address); }));
      return (w.ok = list.length > 0 && yes.filter(Boolean).length >= Math.min(2, list.length));
    }
    // again(): the next read asks for the head anew (a deposit or withdrawal just made is past the head last read)
    return { tip, again: () => { tipAt = 0; }, deposits, withdrawals, confirmed, deposit: (pool, c) => at(pool).byC.get(b32(c)) ?? null, withdrawal: (pool, nh) => at(pool).byNh.get(b32(nh)) ?? null };
  }

  // ---- the prover ----
  // An 11 MB WebAssembly build of the pool's circuit, prover and proving key (MIT, tools/fixed-pool-prover in the Tacit
  // repo, over kohaku-tornadocash), fetched once from whichever mirror answers and used only when its SHA-256 matches.
  // It runs in a worker made from the source below, which is part of this module and so pinned with it.
  const WASM = { sha256: '6fd8e180318003cc44ddc48c0ed3d37b0f5013f4ac20962f24622dcc97abab59', bytes: 11473654, name: 'fixed-pool-prover_bg.wasm' };
  // Whole-file URLs, each checked by the SHA-256 above: the IPFS pin (Filebase) and two copies of the repo. The registry
  // can add more ("tmirrors"), and the last resort is the onchain copy on Base Sepolia and Sepolia (the page's fromChain).
  const WASM_MIRRORS = ['https://ipfs.filebase.io/ipfs/QmfZgme9jnnCYAE2URB7xt9Lv8n52hfLd3ZWL1VKJqGUzf', 'https://raw.githubusercontent.com/z0r0z/tacit/main/dapp/vendor/fixed-pool-prover_bg.wasm', 'https://raw.githubusercontent.com/src-company/tacit/main/dapp/vendor/fixed-pool-prover_bg.wasm'];
  // The worker: the wasm-bindgen glue of that build, cut to what the prover calls. Strings go in as UTF-8 through the
  // module's allocator; results and errors come back as the build hands them over.
  // (a function in this module, made into the worker's source, so the build minifies it with the rest)
  function workerMain() {
    'use strict';
    let W = null, heap = new Array(128).fill(undefined), next;
    heap.push(undefined, null, true, false); next = heap.length;
    const te = new TextEncoder(), td = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    const mem = () => new Uint8Array(W.memory.buffer), dv = () => new DataView(W.memory.buffer);
    const add = (o) => { if (next === heap.length) heap.push(heap.length + 1); const i = next; next = heap[i]; heap[i] = o; return i; };
    const take = (i) => { const o = heap[i]; if (i >= 132) { heap[i] = next; next = i; } return o; };
    const str = (p, n) => td.decode(mem().subarray(p >>> 0, (p >>> 0) + n));
    const put = (b) => { const p = W.__wbindgen_export2(b.length, 1) >>> 0; mem().set(b, p); return [p, b.length]; };
    const imports = (mod) => {
      const fns = {};
      for (const { name } of WebAssembly.Module.imports(mod)) {
        if (name.startsWith('__wbg_Error_')) fns[name] = (p, n) => add(Error(str(p, n)));
        else if (name.startsWith('__wbg___wbindgen_throw_')) fns[name] = (p, n) => { throw new Error(str(p, n)); };
        else if (name.startsWith('__wbg_getRandomValues_')) fns[name] = (p, n) => { try { crypto.getRandomValues(mem().subarray(p >>> 0, (p >>> 0) + n)); } catch (e) { W.__wbindgen_export(add(e)); } };
        else if (name === '__wbindgen_object_drop_ref') fns[name] = (i) => { take(i); };
        else throw new Error('the prover asks for ' + name);
      }
      return { './fixed-pool-prover_bg.js': fns };
    };
    // The build's three return shapes, read at the stack pointer: 'handle' (r0, or the error r1 when r2 is set), 'string'
    // (r0 and its length r1, no error) and 'result' (a string as r0/r1, or the error r2 when r3 is set). A string is copied
    // out and its memory given back.
    const call = (f, args, shape) => {
      const sp = W.__wbindgen_add_to_stack_pointer(-16);
      let p = 0, n = 0;
      try {
        f(sp, ...args);
        const d = dv(), r0 = d.getInt32(sp, true), r1 = d.getInt32(sp + 4, true);
        if (shape === 'handle') { if (d.getInt32(sp + 8, true)) throw take(r1); return r0 >>> 0; }
        if (shape === 'result' && d.getInt32(sp + 12, true)) throw take(d.getInt32(sp + 8, true));
        p = r0; n = r1;
        return str(r0, r1);
      } finally { W.__wbindgen_add_to_stack_pointer(16); if (n || p) W.__wbindgen_export4(p, n, 1); }
    };
    const s = (x) => put(te.encode(String(x)));
    let tree = 0;
    const free = () => { if (tree) { W.__wbg_tree_free(tree, 0); tree = 0; } };
    self.onmessage = async ({ data }) => {
      const { id, type } = data;
      try {
        let out;
        if (type === 'init') { const mod = await WebAssembly.compile(data.wasm); W = (await WebAssembly.instantiate(mod, imports(mod))).exports; out = {}; }
        else if (!W) throw new Error('the prover is not loaded');
        else if (type === 'tree') { free(); const [p, n] = put(new Uint8Array(data.leaves)); tree = call(W.tree_new, [p, n], 'handle'); out = { root: call(W.tree_root, [tree], 'string'), leaves: W.tree_leaves(tree) >>> 0 }; }
        else if (type === 'prove') {
          if (!tree) throw new Error('load the commitments first');
          const a = [tree, data.chainId, ...s(data.pool), ...s(data.preimageHex), ...s(data.recipient)];
          out = { result: data.relayer ? call(W.tree_prove_relayed, [...a, ...s(data.relayer), ...s(String(data.fee))], 'result') : call(W.tree_prove, a, 'result') };
        } else throw new Error('unknown request ' + type);
        self.postMessage({ id, ok: true, ...out });
      } catch (e) { self.postMessage({ id, ok: false, error: String(e && e.message || e) }); }
    };
  }
  const WORKER = `(${workerMain})()`;
  // A prover in a worker: load(wasmBytes) once, then tree(leafBytes) and prove(args). `wasm()` gives the checked bytes.
  function workerProver(wasm) {
    const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    const waiting = new Map();
    let n = 1, ready = null;
    const fail = (e) => { for (const p of waiting.values()) p.reject(e); waiting.clear(); };
    w.onmessage = ({ data }) => { const p = waiting.get(data.id); if (!p) return; waiting.delete(data.id); if (data.ok) p.resolve(data); else p.reject(new Error(data.error)); };
    w.onerror = (e) => { e.preventDefault?.(); fail(new Error(e.message || 'the prover stopped')); };
    const ask = (msg, transfer = []) => new Promise((resolve, reject) => { const id = n++; waiting.set(id, { resolve, reject }); w.postMessage({ id, ...msg }, transfer); });
    const loaded = () => (ready ||= (async () => { const b = await wasm(); await ask({ type: 'init', wasm: b }); })());
    return {
      async load(bytes) { await loaded(); const leaves = bytes.buffer.byteLength === bytes.length ? bytes : bytes.slice(); const r = await ask({ type: 'tree', leaves }, [leaves.buffer]); return { root: r.root, leaves: r.leaves }; },
      async prove(args) { await loaded(); return JSON.parse((await ask({ type: 'prove', chainId: CHAIN_ID, ...args })).result); },
      close() { fail(new Error('the prover was closed')); w.terminate(); },
    };
  }

  // What a proved withdrawal must say before anything signs or sends it: the pool's own `withdraw` with this root, this
  // nullifier hash and this recipient, relayer and fee, and no refund. The proof came out of code the page did not write.
  const WITHDRAW = sel('withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)');
  function checkWithdrawCall(out, { pool, recipient, root, nullifierHash, relayer = ZERO, fee = 0n }) {
    const fail = (why) => { throw new Error(`The proved withdrawal is not the one asked for (${why}).`); };
    if (lc(out.target) !== lc(pool.address)) fail('pool');
    const data = String(out.input);
    if (data.slice(0, 10) !== WITHDRAW) fail('call');
    const body = data.slice(10), w = (i) => body.slice(i * 64, i * 64 + 64), at = (i) => '0x' + w(i).slice(24);
    if (BigInt('0x' + w(0)) !== 224n) fail('layout');
    if (lc('0x' + w(1)) !== lc(root)) fail('root');
    if (lc('0x' + w(2)) !== b32(nullifierHash)) fail('note');
    if (at(3) !== lc(recipient)) fail('recipient');
    if (at(4) !== lc(relayer)) fail('relayer');
    if (BigInt('0x' + w(5)) !== BigInt(fee) || BigInt('0x' + w(6)) !== 0n) fail('fee');
    if (BigInt('0x' + w(7)) !== 256n) fail('proof size');
    if (body.length !== 8 * 64 + 256 * 2) fail('length');
    if (out.proof !== undefined && lc(out.proof) !== lc('0x' + body.slice(8 * 64))) fail('proof');
    if (lc(out.root) !== lc(root)) fail('root');
    if (lc(out.nullifierHash) !== b32(nullifierHash)) fail('nullifier hash');
  }

  // ---- gas from the note: the pool paymaster, one ERC-4337 operation ----
  // The keychain's own "direct single note" path: the sender is a throwaway account (an EIP-7702 delegation to the
  // standard Simple7702 account, signed by a key made here and dropped) that never holds a thing; the fee in the proof is
  // the least that covers the operation at the bundler's price (held to the page's node's view), and the proof names the
  // paymaster as relayer, so it is good for that operation only. Nothing is signed by, or sent from, the user's wallet.
  // ENTRY_POINT and SIMPLE_7702 are the only two pinned values here, and no registry can change them: the note's one-time
  // account delegates to SIMPLE_7702 and runs its code with the note's ETH in it, so a wrong delegate could take the whole
  // note, and a wrong EntryPoint decides who validates and pays for the operation. Changing either needs a new page version.
  // Everything else is a seed: a paymaster or a bundler the registry lists is vetted and fee-capped, and can do no more
  // than refuse (the proof names it as relayer for one operation, its fee is held to MAX_FEE_PERCENT of the note).
  const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
  const SIMPLE_7702 = '0xe6Cae83BdE06E4c305530e199D7217f42808555B';
  // The seed paymaster (the keychain's pool paymaster), and the interfaces (userOp and paymasterData layouts) this page
  // implements; a registry entry "<address> <interface>" with another tag is ignored.
  const PAYMASTER = '0xB0FfCdC890E969579D348F519a9C3920C2DD04a5';
  const PAYMASTER_IFACES = ['kohaku-v1'];
  const PAYMASTERS = Object.freeze([Object.freeze({ address: PAYMASTER, iface: 'kohaku-v1' })]);
  const BUNDLERS = [`https://public.pimlico.io/v2/${CHAIN_ID}/rpc`, `https://api.candide.dev/public/v3/${CHAIN_ID}`];
  // The seed then the registry's entries ("<address> <interface>"), one each, of an interface this page implements.
  function parsePaymasters(entries = []) {
    const out = [...PAYMASTERS];
    for (const e of Array.isArray(entries) ? entries : []) {
      const m = /^(0x[0-9a-fA-F]{40}) ([\w.-]{1,32})$/.exec(String(e).trim());
      if (m && PAYMASTER_IFACES.includes(m[2]) && !out.some((x) => lc(x.address) === lc(m[1]))) out.push({ address: m[1], iface: m[2] });
      if (out.length >= 9) break;
    }
    return out;
  }
  // Those that hold code now (read through `read`), in order; one whose code cannot be read is passed over.
  async function vetPaymasters(list, read) {
    const ok = [];
    for (const p of list) { try { const c = await read('eth_getCode', [p.address, 'latest']); if (typeof c === 'string' && /^0x[0-9a-f]{2,}$/i.test(c)) ok.push(p); } catch { /* not vetted */ } }
    return ok;
  }
  const BASELINE = Object.freeze({ preVerificationGas: 100_000n, verificationGasLimit: 50_000n, callGasLimit: 0n, paymasterVerificationGasLimit: 450_000n, paymasterPostOpGasLimit: 50_000n });
  const GAS_FIELDS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
  // The fee at which the paymaster breaks even: the EntryPoint's required prefund, a fifth over.
  const minimumViableFee = (g, maxFeePerGas) => ((g.verificationGasLimit + g.callGasLimit + g.paymasterVerificationGasLimit + g.preVerificationGas + g.paymasterPostOpGasLimit) * BigInt(maxFeePerGas) * 12n) / 10n;
  // The most the proof may name as the fee, as a share of the note (a ceiling: what is not used comes back to the recipient).
  const MAX_FEE_PERCENT = 3n;
  // A swap-out's call (zRouter's route, run by the throwaway account) may take up to this much gas.
  const MAX_CALL_GAS = 1_500_000n;
  const WORST_GAS = Object.freeze({ ...BASELINE, verificationGasLimit: 150_000n, paymasterVerificationGasLimit: 650_000n, preVerificationGas: 300_000n });
  const worstCaseFee = (maxFeePerGas) => minimumViableFee(WORST_GAS, maxFeePerGas);
  const withinCeiling = (fee, denomination, percent = MAX_FEE_PERCENT) => BigInt(fee) * 100n <= BigInt(denomination) * BigInt(percent);
  const MIN_TIP_CAP = 2_000_000_000n, MAX_TIP_CAP = 20_000_000_000n, MIN_TIP = 1_000_000n;
  const quantity = (v) => { if (typeof v !== 'string' || !/^0x[0-9a-f]+$/i.test(v)) throw new Error('Invalid node gas price reference'); return BigInt(v); };
  const feeRows = (h) => {
    if (!Array.isArray(h?.reward) || !h.reward.length || h.reward.length > 10 || !Array.isArray(h.baseFeePerGas) || h.baseFeePerGas.length !== h.reward.length + 1) throw new Error('Invalid node fee history');
    let tip = 0n;
    for (const row of h.reward) { if (!Array.isArray(row) || row.length !== 1) throw new Error('Invalid node fee history'); const r = quantity(row[0]); if (r > tip) tip = r; }
    return tip;
  };
  // What the page's node says gas costs: the highest 90th-percentile tip of the last ten blocks and the latest base fee.
  async function gasReference(read) {
    try { const h = await read('eth_feeHistory', ['0xa', 'latest', [90]]); const tip = feeRows(h); return { baseFeePerGas: quantity(h.baseFeePerGas.at(-2)), maxPriorityFeePerGas: tip }; } catch { /* the block and the node's suggestion */ }
    const block = await read('eth_getBlockByNumber', ['latest', false]);
    if (block?.baseFeePerGas == null) throw new Error('Failed to read the latest block base fee');
    const tip = await read('eth_maxPriorityFeePerGas', []).then(quantity).catch(() => 0n);
    return { baseFeePerGas: quantity(block.baseFeePerGas), maxPriorityFeePerGas: tip };
  }
  // A price from the node for when no bundler quotes one: twice the coming base fee (`up` quarters of it) plus the
  // highest median tip.
  async function nodeGasPrice(read, up = 8n) {
    const h = await read('eth_feeHistory', ['0xa', 'latest', [50]]);
    let tip = feeRows(h);
    if (tip < MIN_TIP) tip = MIN_TIP;
    return { maxFeePerGas: quantity(h.baseFeePerGas.at(-1)) * up / 4n + tip, maxPriorityFeePerGas: tip };
  }
  function priceWithinBounds(price, ref) {
    const est = ref.maxPriorityFeePerGas * 3n, tipCap = est < MIN_TIP_CAP ? MIN_TIP_CAP : est > MAX_TIP_CAP ? MAX_TIP_CAP : est, feeCap = ref.baseFeePerGas * 3n + tipCap;
    if (typeof price.maxFeePerGas !== 'bigint' || typeof price.maxPriorityFeePerGas !== 'bigint' || price.maxFeePerGas < 0n || price.maxPriorityFeePerGas < 0n || price.maxPriorityFeePerGas > price.maxFeePerGas) throw new Error('Bundler returned invalid gas prices');
    if (price.maxPriorityFeePerGas > tipCap || price.maxFeePerGas > feeCap) throw new Error(`The bundler's gas price is over what the page's node shows (asked ${price.maxFeePerGas} wei, limit ${feeCap} wei).`);
  }
  function limitsWithinBounds(gas, op) {
    const bytes = op ? BigInt(hexBytes(op.callData).length + hexBytes(op.paymasterData ?? '0x').length) : 0n;
    const caps = { verificationGasLimit: BASELINE.verificationGasLimit * 2n < 250_000n ? 250_000n : BASELINE.verificationGasLimit * 2n, paymasterVerificationGasLimit: BASELINE.paymasterVerificationGasLimit * 2n, paymasterPostOpGasLimit: BASELINE.paymasterPostOpGasLimit * 2n, preVerificationGas: (350_000n + 40n * bytes) * 2n, callGasLimit: MAX_CALL_GAS };
    for (const f of GAS_FIELDS) {
      if (typeof gas[f] !== 'bigint' || gas[f] < 0n) throw new Error(`Invalid paymaster gas limit: ${f}`);
      if (caps[f] !== undefined && gas[f] > caps[f]) throw new Error(`The bundler's ${f} ${gas[f]} is over the ceiling ${caps[f]}.`);
    }
  }
  // The keychain's fixed targets for a direct note, for when no bundler can estimate (and, for a swap-out, half again the
  // call's own estimate).
  function fallbackGas(cur, op, callGas = 0n) {
    const bytes = BigInt(hexBytes(op.callData).length + hexBytes(op.paymasterData ?? '0x').length), extra = bytes > 512n ? bytes - 512n : 0n, pvg = 300_000n + extra * 40n;
    const cg = callGas * 3n / 2n;
    return { ...cur, callGasLimit: cur.callGasLimit > cg ? cur.callGasLimit : cg, verificationGasLimit: cur.verificationGasLimit < 150_000n ? 150_000n : cur.verificationGasLimit, paymasterVerificationGasLimit: cur.paymasterVerificationGasLimit < 650_000n ? 650_000n : cur.paymasterVerificationGasLimit, preVerificationGas: cur.preVerificationGas > pvg ? cur.preVerificationGas : pvg };
  }
  // abi.encode((address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)).
  function paymasterData({ instance, proof, root, nullifierHash, recipient, fee }) {
    const p = hexBytes(proof), padded = new Uint8Array(Math.ceil(p.length / 32) * 32);
    padded.set(p);
    return hx(cat(w32(0x20), w32(BigInt(instance)), w32(0xc0), hexBytes(root), hexBytes(nullifierHash), w32(BigInt(recipient)), w32(fee), w32(p.length), padded));
  }
  const lenBytes = (n) => { const o = []; while (n > 0) { o.unshift(n & 0xff); n = Math.floor(n / 256); } return Uint8Array.from(o); };
  const rlpBytes = (b) => (b.length === 1 && b[0] < 0x80 ? b : cat(b.length < 56 ? Uint8Array.of(0x80 + b.length) : cat(Uint8Array.of(0xb7 + lenBytes(b.length).length), lenBytes(b.length)), b));
  const rlpInt = (n) => { let v = BigInt(n); const o = []; while (v > 0n) { o.unshift(Number(v & 0xffn)); v >>= 8n; } return rlpBytes(Uint8Array.from(o)); };
  const rlpList = (items) => { const body = cat(...items); return body.length < 56 ? cat(Uint8Array.of(0xc0 + body.length), body) : cat(Uint8Array.of(0xf7 + lenBytes(body.length).length), lenBytes(body.length), body); };
  // keccak256(0x05 || rlp([chainId, address, nonce])): what an EIP-7702 authorization signs.
  const authorizationDigest = (chainId, address, nonce) => keccak(cat(Uint8Array.of(0x05), rlpList([rlpInt(chainId), rlpBytes(addr20(address)), rlpInt(nonce)])));
  const pointOf = (key) => secp.affine(secp.mulG(big(key)));
  const addressOf = (key) => { const [x, y] = pointOf(key); return '0x' + hex(keccak(cat(be(x), be(y))).subarray(12)); };
  // A signature with its recovery id: the page's signer gives r || s (low s), and the id is the one that recovers the key.
  function signRecoverable(digest, key) {
    const sig = secp.sign(digest, big(key)), r = big(sig.subarray(0, 32)), s = big(sig.subarray(32)), [x] = pointOf(key);
    for (const rec of [0, 1]) { try { if (secp.affine(secp.recover(digest, r, s, rec))[0] === x) return { r: b32(r), s: b32(s), recovery: rec }; } catch { /* the other */ } }
    throw new Error('A signature did not recover its key.');
  }
  const freshKey = () => { for (;;) { const k = randomBytes(32), v = big(k); if (v > 0n && v < SN) return k; } };
  // A swap-out's account: its key comes from the note itself, so the wallet that can open the note can always open the
  // account too, and send on what the paymaster refunds to it afterwards, or the note's ETH if the swap failed.
  function noteKey(preimage) {
    for (let i = 0; ; i++) { const k = keccak(cat(utf8('tacit-wei note exit v1'), Uint8Array.of(i), preimage)), v = big(k); if (v > 0n && v < SN) return k; }
  }
  // Simple7702Account.execute(target, value, data): the one call a swap-out's account makes.
  const executeCall = (target, value, data) => calldata('execute(address,uint256,bytes)', ['address', 'uint256', 'bytes'], [target, value, data]);
  // Sends what a one-time account holds, less the gas of sending it, to `to`, from the account itself (a plain type-2
  // transaction it signs; the account pays its own gas), at a fee cap of a quarter over the coming base fee, so what the
  // cap holds back and the block does not charge stays small. → tx hash. Refused when what is left would not cover the gas.
  async function sweepThrowaway({ read, key, to }) {
    if (!isAddr(to) || /^0x0{40}$/i.test(to)) throw new Error('Enter the address it goes to.');
    const from = addressOf(key);
    const [bal, nonce, price] = await Promise.all([read('eth_getBalance', [from, 'latest']).then(BigInt), read('eth_getTransactionCount', [from, 'pending']).then(BigInt), nodeGasPrice(read, 5n)]);
    const est = BigInt(await read('eth_estimateGas', [{ from, to, value: '0x1' }]).catch(() => '0x5208'));
    const gas = est * 6n / 5n > 21_000n ? est * 6n / 5n : 21_000n;
    if (gas > 200_000n) throw new Error('That address takes too much gas to receive ETH.');
    const value = bal - gas * price.maxFeePerGas;
    if (value <= 0n) throw new Error('What is there would not cover the gas of sending it.');
    const fields = [rlpInt(CHAIN_ID), rlpInt(nonce), rlpInt(price.maxPriorityFeePerGas), rlpInt(price.maxFeePerGas), rlpInt(gas), rlpBytes(addr20(to)), rlpInt(value), rlpBytes(new Uint8Array(0)), rlpList([])];
    const digest = keccak(cat(Uint8Array.of(2), rlpList(fields))), sig = signRecoverable(digest, key);
    const raw = hx(cat(Uint8Array.of(2), rlpList([...fields, rlpInt(sig.recovery), rlpInt(BigInt(sig.r)), rlpInt(BigInt(sig.s))])));
    const hash = await read('eth_sendRawTransaction', [raw]);
    if (!/^0x[0-9a-f]{64}$/i.test(String(hash))) throw new Error('The node did not take the transaction.');
    return { hash, value, from };
  }
  const pack16 = (a, b) => cat(w32(a).subarray(16), w32(b).subarray(16));
  // The EntryPoint v0.8 hash of an operation (EIP-712, domain ERC4337): what its sender signs.
  function userOpDigest(op, entryPoint = ENTRY_POINT) {
    const pad = cat(addr20(op.paymaster), w32(BigInt(op.paymasterVerificationGasLimit)).subarray(16), w32(BigInt(op.paymasterPostOpGasLimit)).subarray(16), hexBytes(op.paymasterData));
    const domain = keccak(cat(keccak(utf8('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')), keccak(utf8('ERC4337')), keccak(utf8('1')), w32(CHAIN_ID), w32(BigInt(entryPoint))));
    const struct = keccak(cat(keccak(utf8('PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)')),
      w32(BigInt(op.sender)), w32(BigInt(op.nonce)), keccak(new Uint8Array(0)), keccak(hexBytes(op.callData)), pack16(BigInt(op.verificationGasLimit), BigInt(op.callGasLimit)), w32(BigInt(op.preVerificationGas)), pack16(BigInt(op.maxPriorityFeePerGas), BigInt(op.maxFeePerGas)), keccak(pad)));
    return keccak(cat(Uint8Array.of(0x19, 0x01), domain, struct));
  }
  // A signed operation for the throwaway sender. With no call the note pays the recipient; with one (a swap-out), the note
  // pays the sender and the call (Simple7702's execute) spends it.
  function directUserOp({ key, paymasterData: pd, gas, maxFeePerGas, maxPriorityFeePerGas, callData = '0x', paymaster = PAYMASTER }) {
    const op = {
      sender: addressOf(key), nonce: '0x0', callData,
      callGasLimit: q(gas.callGasLimit), verificationGasLimit: q(gas.verificationGasLimit), preVerificationGas: q(gas.preVerificationGas),
      maxFeePerGas: q(maxFeePerGas), maxPriorityFeePerGas: q(maxPriorityFeePerGas),
      paymaster, paymasterVerificationGasLimit: q(gas.paymasterVerificationGasLimit), paymasterPostOpGasLimit: q(gas.paymasterPostOpGasLimit), paymasterData: pd,
    };
    const auth = signRecoverable(authorizationDigest(CHAIN_ID, SIMPLE_7702, 0), key), sig = signRecoverable(userOpDigest(op), key);
    op.signature = sig.r + sig.s.slice(2) + (27 + sig.recovery).toString(16);
    op.eip7702Auth = { address: SIMPLE_7702, chainId: q(CHAIN_ID), nonce: '0x0', r: auth.r, s: auth.s, yParity: q(auth.recovery) };
    return op;
  }

  // The bundlers, in order, as one client. One that cannot be reached, cannot quote a price (Candide has no quote call),
  // says nothing about the operation, or answers an estimate with no gas limits for the paymaster is passed over for the
  // next; a refusal of the operation by the first bundler asked is final. An operation is sent to the first that takes
  // it, which is then asked first about it. A status that says the road is shut (no key, gone, throttled, down) is read
  // as that, whatever its body says, so one public endpoint closing does not close the others.
  const RETRY = new Set([408, 429, 502, 503, 504]);
  const shut = (s) => RETRY.has(s) || s === 401 || s === 403 || s === 404 || s >= 500;
  function bundlerClient(url, fetchImpl) {
    let id = 1;
    return {
      url,
      async request(method, params) {
        let res;
        try { res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }, (k, v) => (typeof v === 'bigint' ? q(v) : v)) }); } catch (e) {
          throw Object.assign(new Error(`the bundler could not be reached: ${e.message}`), { kind: 'network' });
        }
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        if (body?.error && !(!res.ok && shut(res.status))) throw Object.assign(new Error(String(body.error.message || 'the bundler refused the request')), { kind: 'rpc', code: body.error.code, details: typeof body.error.message === 'string' ? body.error.message : '', data: body.error.data });
        if (!res.ok) throw Object.assign(new Error(`the bundler answered ${res.status}${typeof body?.error?.message === 'string' ? ` (${body.error.message.slice(0, 120)})` : ''}`), { kind: 'http', status: res.status });
        return body?.result;
      },
    };
  }
  const READS = new Set(['eth_getUserOperationReceipt', 'eth_getUserOperationByHash']);
  const completeEstimate = (r, op) => !op?.paymaster || (r != null && r.paymasterVerificationGasLimit != null && r.paymasterPostOpGasLimit != null);
  // 'transport-unavailable' or 'bundler-internal' for a failure that says nothing about the operation; undefined for a refusal of it.
  function estimationUnavailable(error, op) {
    if (error?.kind === 'incomplete-estimate') return 'bundler-internal';
    if (error?.kind === 'network') return 'transport-unavailable';
    if (error?.kind === 'http') return shut(error.status) ? 'transport-unavailable' : undefined;
    if (error?.kind === 'rpc') {
      if (op?.callData === '0x' && BigInt(op.callGasLimit) === 0n) {
        for (const v of [error.details, error.message, error.data]) { const m = typeof v === 'string' && /\b0x54107e37([0-9a-f]{64})(?![0-9a-f])/i.exec(v); if (m && BigInt('0x' + m[1]) > 0n) return 'bundler-internal'; }
      }
      return error.code === -32603 && error.data == null && /^Unknown error, could not parse simulate validation result\.?$/i.test(String(error.details ?? error.message)) ? 'bundler-internal' : undefined;
    }
    return undefined;
  }
  function bundlerSet(urls, fetchImpl = (u, i) => fetch(u, i)) {
    const clients = urls.map((u) => bundlerClient(u, fetchImpl));
    let took = null;
    const passable = (method, params, e) => {
      if (READS.has(method)) return true;
      if (method === 'eth_estimateUserOperationGas') return !!estimationUnavailable(e, params?.[0]);
      if (e?.kind === 'network') return true;
      if (e?.kind === 'http') return true;
      return method === 'pimlico_getUserOperationGasPrice' && e?.kind === 'rpc' && (e.code === -32601 || /unsupported method|method not found/i.test(String(e.details ?? e.message)));
    };
    return {
      urls,
      async request(method, params) {
        const order = clients.map((_, i) => i);
        if (took !== null) order.unshift(...order.splice(took, 1));
        let first = null, refusal = null, unknown = false;
        for (const i of order) {
          let r;
          try { r = await clients[i].request(method, params); } catch (e) { if (first === null) { first = e; if (!passable(method, params, e)) throw e; } else if (!refusal && e?.kind === 'rpc' && !(method === 'pimlico_getUserOperationGasPrice' && e.code === -32601)) refusal = e; continue; }
          if (method === 'eth_estimateUserOperationGas' && !completeEstimate(r, params?.[0])) { if (first === null) first = Object.assign(new Error('the bundler gave no gas limits for the paymaster\'s part of the operation'), { kind: 'incomplete-estimate' }); continue; }
          if (method === 'eth_sendUserOperation') took = i;
          if (r == null && READS.has(method)) { unknown = true; if (i === took) return r; continue; }
          return r;
        }
        if (unknown) return null;
        if (first !== null) throw ((first.kind === 'network' || first.kind === 'http') && refusal) || first;
        return null;
      },
    };
  }
  async function estimateRetry(estimate) {
    try { return await estimate(); } catch (e) { if (e?.kind !== 'network' && !(e?.kind === 'http' && RETRY.has(e.status))) throw e; await sleep(250); return estimate(); }
  }
  const parseGas = (r) => ({ callGasLimit: BigInt(r.callGasLimit), verificationGasLimit: BigInt(r.verificationGasLimit), preVerificationGas: BigInt(r.preVerificationGas), paymasterVerificationGasLimit: BigInt(r.paymasterVerificationGasLimit ?? 0), paymasterPostOpGasLimit: BigInt(r.paymasterPostOpGasLimit ?? 0) });
  // The operation, ready to send. `prove(fee)` returns the checked proof fields for a withdrawal naming the paymaster and
  // `fee`. Gas limits and the fee depend on each other, so a change in the limits makes a new proof.
  // `callFor(fee)` (a swap-out) → { callData, gas }: the throwaway account's call, made for what the note leaves it after
  // `fee`; the proof then pays the account itself (`recipient` is its address), and the call's gas is part of the fee.
  async function prepareSponsored({ pool, recipient, prove, bundler, reference, nodePrice = null, key = freshKey(), onStep = () => {}, maxFeePercent = MAX_FEE_PERCENT, priceTries = 12, priceEvery = 10_000, wait = sleep, callFor = null, callGas = 0n, paymaster = PAYMASTER }) {
    const readPrice = async () => {
      let p;
      try {
        const standard = (await bundler.request('pimlico_getUserOperationGasPrice', []))?.standard;
        if (!standard) throw Object.assign(new Error('The bundler gave no gas price.'), { kind: 'no-price' });
        p = { maxFeePerGas: BigInt(standard.maxFeePerGas), maxPriorityFeePerGas: BigInt(standard.maxPriorityFeePerGas) };
      } catch (e) {
        if (!nodePrice) throw e;
        p = await nodePrice();
      }
      priceWithinBounds(p, reference);
      return p;
    };
    let price = await readPrice();
    const worst = (p) => worstCaseFee(p) + (callGas * 3n / 2n) * BigInt(p) * 12n / 10n;
    for (let t = 0; !withinCeiling(worst(price.maxFeePerGas), pool.denomination, maxFeePercent); t++) {
      if (t >= priceTries) throw new Error(`Gas is high right now: the fee could come to over ${maxFeePercent}% of the note. Nothing was sent; try again in a few minutes.`);
      onStep({ step: 'price', waiting: true, price: price.maxFeePerGas });
      await wait(priceEvery);
      price = await readPrice();
    }
    const build = async (gas) => {
      const fee = minimumViableFee(gas, price.maxFeePerGas);
      if (fee >= pool.denomination) throw new Error('The paymaster fee would use up the whole note. Wait for lower gas prices.');
      if (!withinCeiling(fee, pool.denomination, maxFeePercent)) throw new Error(`The fee would come to over ${maxFeePercent}% of the note at the limits the bundler asks for. Nothing was sent; try again in a few minutes.`);
      const call = callFor ? await callFor(fee) : null;
      onStep({ step: 'prove', fee });
      const out = await prove(fee);
      const pd = paymasterData({ instance: pool.address, proof: out.proof, root: out.root, nullifierHash: out.nullifierHash, recipient, fee });
      return { op: directUserOp({ key, paymasterData: pd, gas, ...price, callData: call?.callData ?? '0x', paymaster }), fee, call };
    };
    const atFallback = async (now, op, gasEstimation) => {
      const fb = fallbackGas(now, op, callGas);
      limitsWithinBounds(fb, op);
      const again = await build(fb);
      limitsWithinBounds(fb, again.op);
      if (fallbackGas(fb, again.op, callGas).preVerificationGas > fb.preVerificationGas) throw new Error('The payload changed size while it was prepared.');
      return { ...again, gasEstimation, price };
    };
    let gas = { ...BASELINE, callGasLimit: callFor ? callGas * 13n / 10n : 0n }, last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      limitsWithinBounds(gas);
      const built = await build(gas);
      last = built;
      limitsWithinBounds(gas, built.op);
      onStep({ step: 'estimate' });
      let est;
      try { est = parseGas(await estimateRetry(() => bundler.request('eth_estimateUserOperationGas', [built.op, ENTRY_POINT]))); } catch (e) {
        const reason = estimationUnavailable(e, built.op);
        if (!reason) throw new Error('The bundler would not take the withdrawal. Nothing was sent.');
        return atFallback(gas, built.op, { status: 'fallback', reason });
      }
      if (est.preVerificationGas <= 0n || est.verificationGasLimit <= 0n || GAS_FIELDS.some((f) => est[f] < 0n)) throw new Error('The bundler returned invalid gas estimates.');
      const nextGas = { ...gas };
      let changed = false;
      for (const f of GAS_FIELDS) {
        if (f === 'callGasLimit' && !callFor) continue;   // a direct note's call stays empty
        const buffered = (est[f] * 12n + 9n) / 10n;
        if (buffered > nextGas[f]) { nextGas[f] = buffered; changed = true; }
      }
      if (!changed) return { ...built, gasEstimation: { status: 'estimated' }, price };
      limitsWithinBounds(nextGas, built.op);
      gas = nextGas;
    }
    return atFallback(gas, last.op, { status: 'fallback', reason: 'estimates-not-settling' });
  }
  // Sends the operation and waits for it to be mined. A lost reply to the send is not a refusal: the bundler is asked for the operation first.
  async function sendSponsored({ op, bundler, poll = 2000, timeout = 5 * 60 * 1000, onStep = () => {}, wait = sleep }) {
    const hash = hx(userOpDigest(op));
    let named = null;
    try { named = await bundler.request('eth_sendUserOperation', [op, ENTRY_POINT]); } catch (e) {
      const known = /already known/i.test(e?.details ?? '') || (await bundler.request('eth_getUserOperationByHash', [hash]).then((r) => r != null, () => false));
      if (!known) {
        if (e?.kind === 'rpc') throw Object.assign(new Error('The bundler did not take the withdrawal. Nothing was sent.'), { refused: true, priceMoved: /(maxPriorityFeePerGas|maxFeePerGas) must be at least|underpriced/i.test(String(e.details || e.message)) });
        throw Object.assign(new Error('Could not tell whether the bundler took the withdrawal. It may still go through; the note shows as spent if it did.'), { unsure: true });
      }
    }
    if (typeof named === 'string' && /^0x[0-9a-f]{64}$/i.test(named) && lc(named) !== lc(hash)) throw Object.assign(new Error('The bundler answered with another operation than the one sent, so its answer is not trusted. The withdrawal may still go through; the note shows as spent if it did.'), { unsure: true });
    onStep({ step: 'wait', hash });
    for (const end = Date.now() + timeout; ;) {
      const r = await bundler.request('eth_getUserOperationReceipt', [hash]).catch(() => null);
      if (r) {
        // the note's withdrawal runs in validation, so an operation whose own call then failed has still taken the note out:
        // with a call, its ETH is at the sender (`stranded`), which its key can send on
        if (!r.success) throw Object.assign(new Error(op.callData !== '0x' ? 'The note came out but the swap did not go through, so its ETH is at the note\'s one-time address. Send it on from there.' : `The withdrawal failed on chain${r.reason ? `: ${String(r.reason).slice(0, 200)}` : ''}.`), { stranded: op.callData !== '0x', mined: true, sender: op.sender, txHash: r.receipt?.transactionHash });
        return { hash, txHash: r.receipt?.transactionHash };
      }
      if (Date.now() > end) throw Object.assign(new Error('Not confirmed yet. The withdrawal may still go through; the note shows as spent if it did.'), { unsure: true });
      await wait(poll);
    }
  }

  // ---- the split's one transaction: TacitSplitDeposit ----
  // Every note and the Tacit deposit in one call, all of it or none (deployed, verified on Etherscan, Sourcify and
  // Blockscout, no owner). The page checks it holds code and answers as this contract does before using it; otherwise the
  // deposit goes the old way, the notes and then the rest.
  const FORWARDER = '0x0000000000049541f6582aB13C0b3a8dC35165Ae';
  const NO_TACIT = { pA: [0n, 0n], pB: [[0n, 0n], [0n, 0n]], pC: [0n, 0n], publicInputs: Array(11).fill(0n), recipient: ZERO, extAmount: 0n, relayer: ZERO, fee: 0n, memo0: '0x', memo1: '0x' };
  function splitDepositCall(tx, notes) {
    if (tx && BigInt(tx.extAmount) <= 0n) throw new Error('The Tacit part of a split deposit must be above zero.');
    if (!tx && !notes.length) throw new Error('Nothing to deposit.');
    const ext = tx ? BigInt(tx.extAmount) : 0n, t = tx || NO_TACIT;
    const data = calldata(`splitDeposit(address[],bytes32[],${TX_SIG})`, [{ array: 'address' }, { array: 'bytes32' }, { tuple: TX_TYPES }], [notes.map((n) => n.pool.address), notes.map((n) => b32(n.secrets.commitment)), txValues(t)]);
    return { to: FORWARDER, value: notes.reduce((s, n) => s + n.pool.denomination, 0n) + ext, data };
  }
  async function forwarderOk(read, tacitPool, pools) {
    const code = await read('eth_getCode', [FORWARDER, 'latest']);
    if (typeof code !== 'string' || code === '0x') return false;
    const wired = await read('eth_call', [{ to: FORWARDER, data: sel('TACIT_POOL()') }, 'latest']);
    if (!/^0x[0-9a-f]{64}$/i.test(wired) || lc('0x' + wired.slice(-40)) !== lc(tacitPool)) return false;
    for (const p of pools) {
      const d = await read('eth_call', [{ to: FORWARDER, data: sel('denominationOf(address)') + p.address.toLowerCase().slice(2).padStart(64, '0') }, 'latest']);
      if (!/^0x[0-9a-f]{64}$/i.test(d) || BigInt(d) !== p.denomination) return false;
    }
    return true;
  }

  // ---- the flow: a wallet's notes ----
  // `read(method, params)` is the page's node; `wallet(method, params)` the user's wallet (it signs and sends, nothing else);
  // `session` keeps what the wallet has signed (one signature per note number), shared by every flow of that wallet.
  // With `seed` the notes come from it instead (scheme 'k' from the Tacit key, 'q' from the post-quantum root): no signature
  // is asked for, and the wallet only sends.
  const newSession = () => ({ sigs: new Map(), checked: false });
  const SEL = { commitments: sel('commitments(bytes32)'), isSpent: sel('isSpent(bytes32)'), denomination: sel('denomination()'), isKnownRoot: sel('isKnownRoot(bytes32)'), lastRoot: sel('getLastRoot()') };
  // Several reads in one request where the reader takes a batch (`read.batch`), else one by one: → [{ result } | { error }].
  const many = (read, calls) => (read.batch ? read.batch(calls) : Promise.all(calls.map(([m, p]) => read(m, p).then((result) => ({ result }), (error) => ({ error })))));
  // `book` (poolBook): whether a note is in its pool, or spent, is looked for in what it read, so no node is asked about a
  // note; with none, `noteRead` (the reader's own node) or `read` is asked directly.
  function makeFlow({ read, wallet = null, account = null, session = newSession(), store = null, sendTx = null, waitTx = null, poll = 3000, timeout = 10 * 60 * 1000, seed = null, scheme = seed ? 'k' : 'w', book = null, noteRead = null, onFound = null }) {
    const sigs = session.sigs;
    const asks = (nonce) => !seed && !sigs.has(nonce);
    const rsAt = async (nonce) => (seed ? seedRS(seed, nonce) : canonicalRS(await signNonce(nonce)));
    const call = async (to, data, via = read) => { const r = await via('eth_call', [{ to, data }, 'latest']); if (typeof r !== 'string' || !/^0x[0-9a-f]*$/i.test(r)) throw new Error('A node answered a call with something that is not hex.'); return r === '0x' ? 0n : BigInt(r); };
    const seen = async (pool, c) => (book ? !!book.deposit(pool, c) : (await call(pool.address, SEL.commitments + b32(c).slice(2), noteRead || read)) !== 0n);
    // `from`: the block of the note's deposit, from which a book reads the pool's withdrawals; null (not known) when that
    // is unknown or too far back to read, or when one node says spent and others have not confirmed it
    const spent = async (pool, nh, from = null) => {
      if (!book) return (await call(pool.address, SEL.isSpent + b32(nh).slice(2), noteRead || read)) !== 0n;
      if (from == null || (await book.tip()) - from > SPENT_SPAN) return null;
      await book.withdrawals([pool], from);
      return book.withdrawal(pool, nh) ? (await book.confirmed(pool, nh)) || null : false;
    };
    // Where a note's deposit is (its block and leaf): in what the book read, else from the reader's own node; {} when
    // neither can say.
    const where = async (pool, c) => {
      const d = book?.deposit(pool, c), l = d || book || !noteRead ? null : (await noteRead('eth_getLogs', [{ address: pool.address, topics: [DEPOSIT_TOPIC, b32(c)], fromBlock: q(pool.deployBlock), toBlock: 'latest' }]).catch(() => null))?.[0];
      const x = d || (l && depositOf(l));
      return x ? { block: x.block, index: x.index } : {};
    };
    const knownRoot = async (pool, root) => (await call(pool.address, SEL.isKnownRoot + b32(BigInt(root)).slice(2))) !== 0n;
    // A root the pool knows: its last root, read for every pool at once (the request names none), else asked of the pool.
    const rootOk = async (pool, root) => {
      const r = await many(read, ALL_POOLS.map((p) => ['eth_call', [{ to: p.address, data: SEL.lastRoot }, 'latest']])).catch(() => []);
      return lc(r[ALL_POOLS.indexOf(pool)]?.result) === b32(BigInt(root)) || knownRoot(pool, root);
    };
    const needWallet = () => { if (!wallet || !account) throw new Error('Connect your wallet first.'); };
    const rawSign = (nonce) => { needWallet(); return wallet('eth_signTypedData_v4', [account, JSON.stringify(noteTypedData(nonce))]); };
    // One signature per number, kept for the session. The first is asked for twice: a wallet whose signature changes from
    // one request to the next would make a note that cannot be found again.
    async function signNonce(nonce) {
      if (sigs.has(nonce)) return sigs.get(nonce);
      const sig = await rawSign(nonce);
      canonicalRS(sig);
      if (!session.checked) {
        if (hex(canonicalRS(await rawSign(nonce))) !== hex(canonicalRS(sig))) throw new Error('This wallet signs the same request differently each time, so a note made with it could not be found again.');
        session.checked = true;
      }
      sigs.set(nonce, sig);
      return sig;
    }
    async function probe(nonce) {
      const rs = await rsAt(nonce);
      const hits = await Promise.all(ALL_POOLS.map(async (pool) => { const c = commitmentOf(rs, pool.address); return (await seen(pool, c)) ? { nonce, pool, secrets: secretsOf(rs, pool.address), s: scheme, ...(await where(pool, c)) } : null; }));
      return hits.filter(Boolean);
    }
    // the next free number, kept per wallet for signed notes and per seed (by a hash of it) for the others
    const tag = seed ? `${scheme}:${hex(sha256(seed)).slice(0, 16)}` : null;
    const hintKey = () => `tacit-wei-fixed-next:${tag ?? lc(account)}`;
    const hint = () => { try { return Math.max(0, Number(store?.get(hintKey())) || 0); } catch { return 0; } };
    const remember = (n) => { try { store?.set(hintKey(), String(Math.max(n, hint()))); } catch { /* a convenience only */ } };
    // Numbers from `from` on, until `gap` in a row have no deposit (more of them when looking costs no signature). A book
    // reads the deposits first: since the seeds began for a seed's notes, every pool's whole history for signed ones.
    async function scan({ from = 0, gap = seed ? 5 : 2, onProbe = null, onRead = () => {} } = {}) {
      book?.again();
      await book?.deposits(ALL_POOLS, seed ? NOTES_FROM : 0, onRead);
      const found = [];
      let next = from, empty = 0;
      for (let n = from; empty < gap; n++) {
        onProbe?.(n, asks(n));
        const hits = await probe(n);
        if (hits.length) { found.push(...hits); next = n + 1; empty = 0; } else empty++;
      }
      // with a book, the withdrawals of the pools found in, since the oldest found (each note then checked in what was read)
      const olds = found.map((f) => f.block).filter(Boolean), head = book && olds.length ? await book.tip() : 0;
      if (book && olds.length && head - Math.min(...olds) <= SPENT_SPAN) await book.withdrawals([...new Set(found.filter((f) => f.block).map((f) => f.pool))], Math.min(...olds));
      for (const f of found) {
        f.spent = await spent(f.pool, f.secrets.nullifierHash, f.block ?? null);
        f.own = !book;
        if (book && f.spent === false) f.checked = head + 1;
        f.maybe = f.spent === null && !!book?.withdrawal(f.pool, f.secrets.nullifierHash);
        if (f.spent) f.to = book?.withdrawal(f.pool, f.secrets.nullifierHash)?.to;
      }
      if (found.length) onFound?.(found);
      return { found, next };
    }
    async function checkPool(pool) {
      const code = await read('eth_getCode', [pool.address, 'latest']);
      if (!code || code === '0x') throw new Error(`No pool at ${pool.address}.`);
      const d = await call(pool.address, SEL.denomination);
      if (d !== pool.denomination) throw new Error(`${pool.address} takes ${ethWords(d)} ETH, not ${ethWords(pool.denomination)} ETH.`);
    }
    async function until(fn, what) {
      for (const end = Date.now() + timeout; ;) {
        let r = null;
        try { r = await fn(); } catch { /* a busy node is not an answer */ }
        if (r) return r;
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
        await sleep(poll);
      }
    }
    async function sendOne(c) {
      needWallet();
      const tx = { from: account, to: c.to, value: q(c.value || 0n), data: c.data || '0x' };
      const hash = sendTx ? await sendTx(tx) : await wallet('eth_sendTransaction', [{ ...tx, chainId: q(CHAIN_ID) }]);
      const w = waitTx ? await waitTx(hash) : { rc: await until(() => read('eth_getTransactionReceipt', [hash]), 'the transaction') };
      if (w.replaced) throw new Error('It was replaced in your wallet, by a cancel or another transaction, before it was mined. Nothing was sent.');
      if (!w.rc) throw new Error('Timed out waiting for the transaction.');
      if (!(w.rc.status === '0x1' || Number(w.rc.status) === 1)) throw new Error('The transaction failed on chain.');
      return { hash: w.rc.transactionHash || hash };
    }
    // The notes of `plan`, made but not sent: the next free numbers are found, and each is signed for. The notes of one
    // call share a mark (`g`), kept with them, which says they went in together.
    async function prepareNotes(plan, { onStep = () => {} } = {}) {
      const wanted = plan.notes.flatMap((n) => Array.from({ length: n.count }, () => poolOf(n.address)));
      if (!wanted.length) return [];
      for (const p of new Set(wanted)) await checkPool(p);
      onStep({ step: 'find' });
      const { next } = await scan({ from: hint(), onProbe: (n, signs) => onStep({ step: 'probe', n, signs }) });
      const notes = [], g = hex(randomBytes(4));
      for (let i = 0; i < wanted.length; i++) {
        const nonce = next + i;
        onStep({ step: 'sign', i, of: wanted.length, signs: asks(nonce) });
        const secrets = secretsOf(await rsAt(nonce), wanted[i].address);
        notes.push({ nonce, pool: wanted[i], secrets, s: scheme, g, call: depositCall(wanted[i], secrets.commitment) });
      }
      return notes;
    }
    // The notes whose commitment is in their pool; the next-number hint moves past them.
    async function landedNotes(notes, { wait = true } = {}) {
      const ok = [];
      for (const n of notes) {
        let landed = false;
        for (let t = 0; t < (wait ? 8 : 1) && !landed; t++) { if (t) await sleep(poll); try { book?.again(); await book?.deposits([n.pool]); landed = await seen(n.pool, n.secrets.commitment); } catch { /* not landed yet */ } }
        if (landed) { ok.push(n); Object.assign(n, await where(n.pool, n.secrets.commitment)); }
      }
      if (ok.length) remember(Math.max(...ok.map((n) => n.nonce)) + 1);
      return ok;
    }
    // The notes one transaction at a time from the wallet (no forwarder, or one note and nothing left over).
    async function deposit(plan, { onStep = () => {}, onNotes = () => {} } = {}) {
      const notes = await prepareNotes(plan, { onStep }), done = [];
      if (!notes.length) return { notes: [] };
      onNotes(notes);
      onStep({ step: 'send', count: notes.length });
      try { for (const n of notes) { await sendOne(n.call); done.push(n); onStep({ step: 'sent', i: done.length, of: notes.length }); } } catch (e) { e.done = done; e.notes = notes; throw e; }
      remember(notes[0].nonce + notes.length);
      if ((await landedNotes(notes)).length !== notes.length) throw Object.assign(new Error('A deposit was sent but its note is not in the pool yet. Find shows it in a minute.'), { done, notes });
      return { notes };
    }
    // The same split with ONE sender for all of it: `send(notes)` makes and sends the transaction. A send that throws after
    // the transaction was in fact sent is not a failure if every note is in its pool; if none is, nothing landed.
    async function depositWith(plan, send, { onStep = () => {}, onNotes = () => {} } = {}) {
      const notes = await prepareNotes(plan, { onStep });
      if (!notes.length) return { notes: [] };
      onNotes(notes);
      onStep({ step: 'send', count: notes.length });
      let hash = null;
      try { hash = await send(notes); } catch (e) { if ((await landedNotes(notes, { wait: false })).length !== notes.length) { e.done = []; e.notes = notes; throw e; } }
      if ((await landedNotes(notes)).length !== notes.length) throw Object.assign(new Error('The deposit was sent but its notes are not in their pools yet. Find shows them in a minute.'), { done: notes, notes, hash });
      return { notes, hash };
    }
    // What both withdrawals check before any proof: the note is for this chain and one of the pinned pools, it is unspent
    // and among the deposits, and the tree built from them lands on a root the pool knows. `cache`
    // ({ pools: Map, loaded }) lets a run of notes read each pool and build its tree once.
    async function readyToWithdraw({ noteText, recipient, prover, onStep, leaves, caches, cache = null }) {
      const note = parseNote(noteText);
      if (note.chainId !== CHAIN_ID) throw new Error(`This note is for chain ${note.chainId}, not Ethereum.`);
      const pool = ALL_POOLS.find((p) => ethWords(p.denomination) === note.amount);
      if (!pool) throw new Error('No pool takes this note.');
      if (!isAddr(recipient) || /^0x0{40}$/i.test(recipient)) throw new Error('Enter the address that should receive it.');
      const spentError = () => Object.assign(new Error('This note is already spent.'), { spent: true });
      if (!book && await spent(pool, note.nullifierHash)) throw spentError();
      const mine = hexBytes(b32(note.commitment));
      // the note's leaf number, or -1
      const leafOf = (bytes, count) => { for (let i = 0, o = 0; i < count; i++, o += 32) { let k = 0; while (k < 32 && bytes[o + k] === mine[k]) k++; if (k === 32) return i; } return -1; };
      let src = cache?.pools.get(pool.address) ?? null, reused = false, at = src ? leafOf(src.bytes, src.count) : -1;
      if (at >= 0 && (await rootOk(pool, src.root))) reused = true; else src = null;
      const readLeaves = async (from) => {
        onStep({ step: 'read' });
        const r = await leaves({ pool, caches: from, getLogs: (f) => read('eth_getLogs', [f]), blockNumber: async () => Number(await read('eth_blockNumber', [])), onProgress: (p) => onStep({ step: 'read', ...p }) });
        if ((at = leafOf(r.bytes, r.count)) < 0) throw new Error('This note\'s deposit is not among the pool\'s deposits. Check the note, or try again in a minute if it was just made.');
        return { bytes: r.bytes, count: r.count, blocks: r.blocks };
      };
      let fromNode = false;
      if (!src) src = await readLeaves(caches);
      // with a book, the pool's withdrawals since this note's deposit (a note too old for that is refused by its withdrawal)
      const block = src.blocks?.[at] || null;
      if (book && (await spent(pool, note.nullifierHash, block)) === true) throw spentError();
      let root;
      if (reused) {
        if (cache.loaded !== pool.address) {
          cache.loaded = null;
          if ((await prover.load(src.bytes.slice())).root !== src.root) throw new Error('The deposits read before do not give the same root now. Try again.');
          cache.loaded = pool.address;
        }
        root = src.root;
      } else {
        for (;;) {
          onStep({ step: 'tree', count: src.count });
          const keep = cache ? src.bytes.slice() : null;
          if (cache) cache.loaded = null;
          ({ root } = await prover.load(src.bytes));
          if (await rootOk(pool, root)) { if (cache) { cache.pools.set(pool.address, { bytes: keep, count: src.count, root, blocks: src.blocks }); cache.loaded = pool.address; } break; }
          // a cache whose deposits give another root (a reorganised head, or a host that is wrong) is read past: the node alone, once
          if (fromNode || !caches.length) throw new Error('The deposits read do not add up to a root the pool knows. Try again in a minute.');
          fromNode = true;
          onStep({ step: 'read', note: 'cache: its deposits gave a root the pool does not know' });
          src = await readLeaves([]);
        }
      }
      return { note, pool, root, preimageHex: hex(note.preimage) };
    }
    // `from`: a block before the withdrawal was sent (a book reads the withdrawals since)
    const settled = async (pool, note, from = null) => {
      for (let t = 0; t < 8; t++) { if (t) await sleep(poll); try { book?.again(); if ((await spent(pool, note.nullifierHash, from)) === true) return true; } catch { /* not shown yet */ } }
      return false;
    };
    const head = async () => (book ? book.tip() : null);
    // The note's withdrawal paid `to`, in transaction `tx`: from the book's withdrawals, or the receipt from the reader's node.
    const paid = async (pool, note, to, tx) => {
      if (book) { const w = book.withdrawal(pool, note.nullifierHash); return !!w && w.to === lc(to) && (!w.tx || !tx || w.tx === lc(tx)); }
      const rc = tx ? await (noteRead || read)('eth_getTransactionReceipt', [tx]).catch(() => null) : null;
      return !!rc?.logs?.some((l) => { const x = lc(l.address) === lc(pool.address) && withdrawalOf(l); return x?.nh === b32(note.nullifierHash) && x.to === lc(to); });
    };
    // Sent from the wallet, which pays the gas and shows as the sender; the recipient gets the whole note.
    async function withdraw({ noteText, recipient, prover, onStep = () => {}, leaves = poolLeaves, caches = CACHES, confirm = null, cache = null }) {
      const { note, pool, root, preimageHex } = await readyToWithdraw({ noteText, recipient, prover, onStep, leaves, caches, cache });
      onStep({ step: 'prove' });
      const out = await prover.prove({ pool: pool.address, preimageHex, recipient });
      checkWithdrawCall(out, { pool, recipient, root, nullifierHash: note.nullifierHash });
      if (confirm && !(await confirm({ fee: 0n, receive: pool.denomination, denomination: pool.denomination }))) throw Object.assign(new Error('Cancelled. Nothing was sent.'), { cancelled: true });
      onStep({ step: 'send' });
      const sentAt = await head();
      const { hash } = await sendOne({ to: out.target, value: 0n, data: out.input });
      return { hash, receive: pool.denomination, at: sentAt, spent: (await settled(pool, note, sentAt)) && (await paid(pool, note, recipient, hash)) };
    }
    // Gas from the note through the paymaster: one operation from a throwaway account; the wallet signs and sends nothing.
    // `confirm` is asked once the fee is fixed; a fee that moved up while it was read is asked again.
    // `swap` (a withdrawal that arrives as a token): { route(amountIn) → { to, value, data, out, limit } paying the token to
    // its address, gas }: the note pays its own one-time account (its key from the note), whose call swaps exactly what the
    // note leaves after the fee; `recipient` is then where the token goes, and only for the words shown.
    async function withdrawSponsored({ noteText, recipient, prover, onStep = () => {}, leaves = poolLeaves, caches = CACHES, bundlers = BUNDLERS, fetchImpl, confirm = null, cache = null, maxFeePercent, swap = null, paymasters = PAYMASTERS }) {
      const key = swap ? noteKey(parseNote(noteText).preimage) : freshKey(), payee = swap ? addressOf(key) : recipient;
      if (swap && (!isAddr(recipient) || /^0x0{40}$/i.test(recipient))) throw new Error('Enter the address that should receive it.');
      const { note, pool, root, preimageHex } = await readyToWithdraw({ noteText, recipient: payee, prover, onStep, leaves, caches, cache });
      const client = bundlerSet(bundlers, fetchImpl);
      const callFor = swap ? async (fee) => {
        const amountIn = pool.denomination - fee, r = await swap.route(amountIn);
        if (!r || BigInt(r.value) !== amountIn || lc(r.to) !== lc(swap.router)) throw new Error('No route for that swap right now. Nothing was sent.');
        return { callData: executeCall(r.to, amountIn, r.data), route: r };
      } : null;
      // Each paymaster that holds code, in order (the seed first). One whose bundler refuses before anything was sent is
      // followed by the next, the proof made again for its address; the key and the fee ceiling stay the same.
      const vetted = await vetPaymasters(paymasters, read);
      if (!vetted.length) throw new Error('No paymaster could be reached, so nothing was sent. Try again in a minute, or pay the gas from your wallet.');
      let last = null;
      for (const pm of vetted) {
        try { return { ...(await through(pm.address)), paymaster: pm.address }; } catch (e) {
          if (!(e?.refused || e?.pmFail) || e?.cancelled) throw e;
          last = e; onStep({ step: 'paymaster', failed: pm.address });
        }
      }
      throw last;
      async function through(PM) {
      const prepare = async () => prepareSponsored({
        paymaster: PM, pool, recipient: payee, key, callFor, callGas: swap ? BigInt(swap.gas) : 0n, bundler: client, reference: await gasReference(read), nodePrice: () => nodeGasPrice(read), onStep, maxFeePercent,
        prove: async (fee) => {
          const out = await prover.prove({ pool: pool.address, preimageHex, recipient: payee, relayer: PM, fee: String(fee) });
          checkWithdrawCall(out, { pool, recipient: payee, root, nullifierHash: note.nullifierHash, relayer: PM, fee });
          return out;
        },
      });
      let prepared = null, approved = null;
      try { prepared = await prepare(); } catch (e) { if (/would not take the withdrawal/.test(e?.message || '')) e.pmFail = true; throw e; }
      for (let again = 0; ; again++) {
        const receive = pool.denomination - prepared.fee, route = prepared.call?.route ?? null;
        // a swap-out is asked again when its fee rose or its floor fell
        const ask = !!confirm && (approved == null || prepared.fee > approved.fee || (route && route.limit < approved.limit));
        if (ask || again === 0) onStep({ step: 'quote', fee: prepared.fee, receive, route });
        if (ask) {
          if (!(await confirm({ fee: prepared.fee, receive, denomination: pool.denomination, route }))) throw Object.assign(new Error('Cancelled. Nothing was sent.'), { cancelled: true });
          approved = { fee: prepared.fee, limit: route?.limit ?? 0n };
        }
        const sentAt = await head();
        try {
          const done = await sendSponsored({ op: prepared.op, bundler: client, onStep, poll: 2000 });
          return { fee: prepared.fee, receive, route, at: sentAt, hash: done.txHash, spent: (await settled(pool, note, sentAt)) && (await paid(pool, note, payee, done.txHash)), account: swap ? payee : null };
        } catch (e) {
          if (e?.stranded) await settled(pool, note, sentAt);
          // with no call, the note pays out in the operation's validation: mined and spent is paid, whatever came after
          else if (e?.mined && (await settled(pool, note, sentAt)) && (await paid(pool, note, payee, e.txHash))) return { fee: prepared.fee, receive, route, hash: e.txHash, spent: true, account: null };
          if (!e?.priceMoved || again >= 2) throw e;
          onStep({ step: 'reprice' });
          prepared = await prepare();
        }
      }
      }
    }
    // The note text of a deposit made here: only (nonce, pool, scheme, commitment) is kept; the secrets come from the seed or
    // from signing again, and must give the commitment kept (a note made under another sign-in does not).
    async function noteText({ nonce, pool, s = 'w', c = null }) {
      const p = poolOf(pool);
      if (!p) throw new Error('No pool takes this note.');
      if (s !== scheme) throw new Error(s === 'w' ? 'This note was made with wallet signatures: connect the wallet that made it.' : 'This note was made from a sign-in: sign in with it to take the note out.');
      const secrets = secretsOf(await rsAt(nonce), p.address);
      if (c && b32(secrets.commitment) !== lc(c)) throw new Error(s === 'w' ? 'This note was made by another wallet: connect that one to take it out.' : 'This note was made under another sign-in: sign in with that one to take it out.');
      return noteString(p.denomination, secrets.preimage);
    }
    return { scheme, signNonce, scan, prepareNotes, landedNotes, deposit, depositWith, sendOne, withdraw, withdrawSponsored, noteText, spent, seen, where, knownRoot, checkPool, hint, remember };
  }

  // ---- what the page shows about a note ----
  // How many deposits a pool has had and how many notes are in it now: the crowd a note of that size blends in with.
  const SIZES = new Map(), SIZE_TTL = 5 * 60_000;
  const hexWord = (x) => typeof x === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(x);
  async function poolSize(read, pool, now = Date.now()) {
    const k = lc(pool.address), hit = SIZES.get(k);
    if (hit && now - hit.at < SIZE_TTL) return hit.v;
    const [idx, bal] = await Promise.all([read('eth_call', [{ to: pool.address, data: '0xfc7e9c6f' }, 'latest']), read('eth_getBalance', [pool.address, 'latest'])]);
    if (!hexWord(idx) || !hexWord(bal)) throw new Error('The pool\'s size could not be read.');
    const v = { deposits: Number(BigInt(idx)), held: Number(BigInt(bal) / pool.denomination) };
    if (v.held > v.deposits) throw new Error('The pool\'s size does not add up.');
    SIZES.set(k, { at: now, v });
    return v;
  }
  const cachedSize = (pool, now = Date.now()) => { const hit = SIZES.get(lc(pool.address)); return hit && now - hit.at < SIZE_TTL ? hit.v : null; };
  // When a note went in and how many deposits came after it: from its deposit's block and leaf number, kept with it, the
  // head's number and time, and the pool's deposit count (nothing that names the note is asked).
  const LOW_SINCE = 20;
  // When a block was made, from the head's number and time: a slot every 12 s.
  const timeOf = (block, head) => head.time - Math.max(0, head.number - block) * 12;
  const count = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  const ageWords = (sec) => (sec < 120 ? 'just now' : sec < 5400 ? `${Math.round(sec / 60)} minutes ago` : sec < 129600 ? `${count(Math.round(sec / 3600), 'hour')} ago` : `${count(Math.round(sec / 86400), 'day')} ago`);
  function seenInfo(seen, size, nowSec = Date.now() / 1000) {
    if (!seen) return null;
    if (seen.old) return { text: 'Deposited over a month ago', low: false, old: true };
    if (!Number.isFinite(seen.i) || !Number.isFinite(seen.t)) return null;
    const age = Math.max(0, nowSec - seen.t), since = size && Number.isFinite(size.deposits) ? Math.max(0, size.deposits - 1 - seen.i) : null;
    const low = since != null ? since < LOW_SINCE : age < 3600;
    return { text: `Deposited ${ageWords(age)}${since != null ? ` · ${count(since, 'deposit')} since` : ''}`, low, since, age, t: seen.t, nudge: since != null ? 'Few deposits have come after it. The more do, the better it blends in.' : 'It went in less than an hour ago. Waiting longer hides it better.' };
  }
  function exitWarning(seens) {
    const lows = seens.filter((s) => s?.low);
    if (!lows.length) return '';
    const counted = lows.filter((s) => s.since != null);
    if (counted.length) { const n = Math.min(...counted.map((s) => s.since)); return `Part of this went in recently: the newest note has ${n === 0 ? 'no deposits' : `only ${count(n, 'deposit')}`} after it. Waiting for more makes it blend in better.`; }
    return 'Part of this went in less than an hour ago. Waiting longer hides it better.';
  }
  // Gas of a split deposit from mainnet deposits: about 0.8 million for each note, and 0.48 million for a Tacit part in
  // the same transaction (else 0.1). And of notes made from the private balance: the pool's withdrawal and the deposits.
  const depositGas = (notes, rest) => BigInt(notes) * 800_000n + (rest ? 480_000n : 100_000n);
  const intakeGas = (notes) => 450_000 + 1_040_000 + 850_000 * Math.max(0, notes - 1);
  // Whole notes swapped one after another: each is held so that what the notes so far pay is at least `minRate` (token per
  // wei, x10^18) of what they put in. One note's swap moves the price for the next, which the run as a whole makes up for.
  function runFloor(minRate) {
    let lim = 0n, inp = 0n;
    return {
      ok: (limit, value) => BigInt(limit) > 0n && (minRate == null || (lim + BigInt(limit)) * ETHER >= BigInt(minRate) * (inp + BigInt(value))),
      add: (limit, value) => { lim += BigInt(limit); inp += BigInt(value); },
    };
  }
  // The smallest note by default: 0.1 ETH, raised while the network fee of a note (about a million gas) is over 2% of it.
  const autoSmallest = (gasPrice) => [10n ** 17n, ETHER, 10n * ETHER].find((d) => 1_000_000n * BigInt(gasPrice) * 50n <= d) ?? 10n * ETHER;

  // What is kept of a note in this browser: where it is and what it is called on chain. None of it opens the note.
  // (with the address of its swap-out account, which comes from the note: so Find, on any device, finds what is left there too)
  // A note not made with wallet signatures says which seed scheme it came from (s: 'k' or 'q').
  // Also, when known: the mark of the deposit it was made in (g), its deposit's block and leaf number (b, i), that it is
  // spent (sp), the block up to which its pool's withdrawals were read without finding it (w), and that its swap-out
  // account was paid (left: 1; 0 while nothing worth sending is there).
  const metaOf = (n) => {
    const acct = addressOf(noteKey(n.secrets.preimage));
    return { nonce: n.nonce, pool: n.pool.address, c: b32(n.secrets.commitment), nh: b32(n.secrets.nullifierHash), acct, ...(n.s && n.s !== 'w' ? { s: n.s } : {}), ...(n.g ? { g: n.g } : {}),
      ...(n.block ? { b: n.block, i: n.index } : {}), ...(n.spent === true ? { sp: 1, sv: 1 } : n.spent === false ? { sp: 0, ms: 0, ...(n.own ? { so: 1 } : {}) } : {}), ...(n.maybe ? { ms: 1 } : {}), ...(n.checked ? { w: n.checked } : {}), ...(n.to && lc(n.to) === lc(acct) ? { left: 1 } : {}) };
  };
  const notesKey = (account) => `tacit-wei-fixed-notes:${lc(account)}`;
  const readNotes = (store, account) => { try { const v = JSON.parse(store.get(notesKey(account)) || '[]'); return Array.isArray(v) ? v.filter((n) => n && Number.isInteger(n.nonce) && n.nonce >= 0 && poolOf(n.pool)) : []; } catch { return []; } };
  // One record per note; what any copy of a note knows is kept on the one record (the latest word on spent, on a
  // withdrawal sent but not seen yet (o, at block ob), and on a swap-out's leftover counts). Spent as the chain confirmed
  // it (sv) is undone only by the reader's own node (so); one from before sv, by any check that finds the note unspent.
  const noteKeyOf = (n) => (n.c ? lc(n.c) : `${lc(n.pool)}:${n.s || 'w'}:${n.nonce}`);
  function writeNotes(store, account, list) {
    const keys = new Map(), out = [];
    for (const n of list) {
      const k = noteKeyOf(n), had = keys.get(k);
      if (!had) { const m = { ...n }; keys.set(k, m); out.push(m); continue; }
      for (const f of ['acct', 'b', 'i', 'g']) if (n[f] != null && had[f] == null) had[f] = n[f];
      if (n.sv) had.sv = 1;
      if (n.sp != null && !(had.sv && !n.sp && !n.so)) { had.sp = n.sp; if (!n.sp) had.sv = 0; }
      for (const f of ['o', 'ob', 'left', 'ms']) if (n[f] != null) had[f] = n[f];
      if (n.w > (had.w ?? 0)) had.w = n.w;
    }
    try { store.set(notesKey(account), JSON.stringify(out)); } catch { /* Find brings them back */ }
    return out;
  }

  // How many of `notes` went in together: the most that share a deposit's mark, or whose deposits came within 50 blocks
  // (ten minutes) of one another, one after the next. Either set, taken out together to one address, can be matched.
  function together(notes) {
    const by = new Map(), bs = notes.map((n) => n.b).filter((b) => b != null).sort((x, y) => x - y);
    let most = 0;
    for (const n of notes) if (n.g) most = Math.max(most, by.set(n.g, (by.get(n.g) || 0) + 1).get(n.g));
    for (let i = 0, run = 0; i < bs.length; i++) most = Math.max(most, (run = i && bs[i] - bs[i - 1] <= 50 ? run + 1 : 1));
    return most;
  }
  // What the pools hold, from the balances of the Tacit pool and then the four large pools: the large pools' sum and the
  // whole notes in each (a note is in until it is withdrawn, so a pool's balance over its size is its notes).
  const held = (bals) => ({ tacit: bals[0], tornado: bals.slice(1).reduce((t, b) => t + b, 0n), notes: POOLS.map((p, i) => bals[i + 1] / p.denomination) });

  return {
    ETHER, CHAIN_ID, POOLS, MORE_POOLS, ALL_POOLS, poolOf, together, held, gunzip, commitmentOf, MAX_NOTES, SMALLEST, planSplit, planExit, ethWords,
    blake256, pedersenPoint, noteTypedData, canonicalRS, deriveSecrets, secretsOf, seedRS, depositCall, noteString, parseNote, b32,
    CACHES, poolLeaves, readChunkCache, readTail, poolBook, NOTES_FROM, SPENT_SPAN, WITHDRAWAL_TOPIC,
    WASM, WASM_MIRRORS, WORKER, workerProver, checkWithdrawCall,
    ENTRY_POINT, SIMPLE_7702, PAYMASTER, PAYMASTERS, parsePaymasters, vetPaymasters, BUNDLERS, MAX_FEE_PERCENT, MAX_CALL_GAS, noteKey, executeCall, sweepThrowaway, minimumViableFee, withinCeiling, worstCaseFee, gasReference, nodeGasPrice, priceWithinBounds, limitsWithinBounds, fallbackGas,
    paymasterData, authorizationDigest, userOpDigest, directUserOp, addressOf, signRecoverable, bundlerSet, estimationUnavailable, prepareSponsored, sendSponsored, BASELINE,
    FORWARDER, splitDepositCall, forwarderOk,
    newSession, makeFlow,
    poolSize, cachedSize, timeOf, seenInfo, ageWords, exitWarning, LOW_SINCE, depositGas, intakeGas, autoSmallest, runFloor,
    metaOf, readNotes, writeNotes, noteKeyOf,
  };
})();
