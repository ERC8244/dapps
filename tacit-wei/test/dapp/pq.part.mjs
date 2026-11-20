/* The page's post-quantum part (PQ, dapp/parts/pq.js): the SHA-3 sponges against NIST's examples and node's OpenSSL,
   ML-KEM-768 against NIST's ACVP vectors (every ML-KEM-768 case of keyGen and encapDecap, key checks included) and,
   byte for byte, against the noble library the Tacit app ships, and the backup phrase against the Tacit app's own phrase
   module. Also: the KEM in a context with no globals and in a worker made from the part's text, timings, minified size.

   ACVP files are read from PQ_VECTORS (default: the scratchpad dir below) and fetched from github once if missing;
   OFFLINE=1 skips them when they are not there. TACIT=<a checkout of tacit.finance's app> (default /Users/z/tacit-neutral).
   N=<differential rounds> (default 2000). Run: node test/dapp/pq.part.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const TACIT = process.env.TACIT || '/Users/z/tacit-neutral';
const VECTORS = process.env.PQ_VECTORS || '/private/tmp/claude-501/-Users-z-tacit/683d0b7a-80a2-451a-8f5e-9178129f5caf/scratchpad/pq-vectors';
const ROUNDS = Number(process.env.N || 2000);
const SRC = fs.readFileSync(new URL('../../dapp/parts/pq.js', import.meta.url), 'utf8');
const { ml_kem768: NOBLE } = await import(`file://${TACIT}/dapp/vendor/tacit-pq.min.js`);
const PHRASE = await import(`file://${TACIT}/dapp/tacit-chain-phrase.js`);
const { WORDS } = await import(`file://${TACIT}/dapp/vendor/bip39-english.js`);

// The phrase uses the page's SHA-256: taken from the page when its section is found, else node's.
const nodeSha = (b) => new Uint8Array(crypto.createHash('sha256').update(b).digest());
let sha256 = nodeSha, shaFrom = 'node';
try {
  const page = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url), 'utf8'), a = page.indexOf('// ── SHA-256 and HMAC ──'), b = page.indexOf('function hmac(', a);
  if (a > 0 && b > a) { const c = vm.createContext({}); vm.runInContext(page.slice(a, b) + '\nglobalThis.sha256 = sha256;', c); sha256 = c.sha256; shaFrom = 'page'; }
} catch {}
const ctx = vm.createContext({ sha256 });
vm.runInContext(SRC + '\nglobalThis.PQ = PQ;', ctx, { filename: 'pq.js' });
const PQ = ctx.PQ;

let pass = 0, fail = 0;
const test = async (label, fn) => { try { const note = await fn(); console.log(`  PASS  ${label}${note ? ` (${note})` : ''}`); pass++; } catch (e) { console.log(`  FAIL  ${label}: ${e.stack || e.message}`); fail++; } };
const eq = (a, b, what = '') => { if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`); };
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const rnd = (n) => new Uint8Array(crypto.randomBytes(n));
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const utf8 = (s) => new TextEncoder().encode(s);

console.log('sponges');
const A3 = new Uint8Array(200).fill(0xa3);
const KAT = [
  ['sha3_256', '', 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'],
  ['sha3_256', 'abc', '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'],
  ['sha3_256', A3, '79f38adec5c20307a98ef76e8324afbfd46cfd81b22e3973c65fa1bd9de31787'],
  ['sha3_512', '', 'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26'],
  ['sha3_512', 'abc', 'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0'],
  ['sha3_512', A3, 'e76dfad22084a8b1467fcf2ffa58361bec7628edf5f3fdc0e4805dc48caeeca81b7c13c30adf52a3659584739a2df46be589c51ca1a4a8416df6545a1ce8ba00'],
  ['shake128', '', '7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26'],
  ['shake128', 'abc', '5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8'],
  ['shake128', A3, '131ab8d2b594946b9c81333f9bb6e0ce75c3b93104fa3469d3917457385da037'],
  ['shake256', '', '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be'],
  ['shake256', 'abc', '483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739d5a15bef186a5386c75744c0527e1faa9f8726e462a12a4feb06bd8801e751e4'],
  ['shake256', A3, 'cd8a920ed141aa0407a22d59288652e9d9f1a7ee0c1e7c1ca699424da84a904d2d700caae7396ece96604440577da4f3aa22aeb8857f961c4cd8e06f0ae6610b'],
];
await test(`NIST examples: SHA3-256/512 and SHAKE128/256 of '', 'abc' and 200 × 0xa3 (${KAT.length})`, () => {
  for (const [f, m, want] of KAT) { const b = typeof m == 'string' ? utf8(m) : m; eq(hex(f.startsWith('shake') ? PQ[f](b, want.length / 2) : PQ[f](b)), want, `${f}(${typeof m == 'string' ? `'${m}'` : '200×a3'})`); }
});
await test('every length 0..700 (across each rate) against node\'s OpenSSL, all four functions', () => {
  for (let n = 0; n <= 700; n++) {
    const m = rnd(n);
    eq(hex(PQ.sha3_256(m)), crypto.createHash('sha3-256').update(m).digest('hex'), `sha3-256 len ${n}`);
    eq(hex(PQ.sha3_512(m)), crypto.createHash('sha3-512').update(m).digest('hex'), `sha3-512 len ${n}`);
    eq(hex(PQ.shake128(m, 200)), crypto.createHash('shake128', { outputLength: 200 }).update(m).digest('hex'), `shake128 len ${n}`);
    eq(hex(PQ.shake256(m, 300)), crypto.createHash('shake256', { outputLength: 300 }).update(m).digest('hex'), `shake256 len ${n}`);
  }
  return '2,804 hashes';
});
await test('long SHAKE output and the incremental squeeze (uneven chunks) equal the one-shot output', () => {
  for (let t = 0; t < 50; t++) {
    const m = rnd(t * 13), n = 1 + (t * 397) % 2000, whole = PQ.shake128(m, n);
    eq(hex(whole), crypto.createHash('shake128', { outputLength: n }).update(m).digest('hex'), `shake128 ${n} B`);
    const sq = PQ.shake128x(m), parts = [];
    for (let got = 0; got < n;) { const k = Math.min(n - got, 1 + ((got * 7 + t) % 211)); parts.push(...sq(k)); got += k; }
    eq(hex(parts), hex(whole), 'chunked');
    const s2 = PQ.shake256x(m), p2 = [...s2(5), ...s2(300), ...s2(1)];
    eq(hex(p2), hex(PQ.shake256(m, 306)), 'shake256 chunked');
  }
});

console.log('ML-KEM-768: NIST ACVP vectors');
const acvp = async (dir) => {
  const file = `${VECTORS}/${dir}.json`;
  if (!fs.existsSync(file)) {
    if (process.env.OFFLINE) return null;
    const url = `https://raw.githubusercontent.com/usnistgov/ACVP-Server/master/gen-val/json-files/${dir}/internalProjection.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.mkdirSync(VECTORS, { recursive: true });
    fs.writeFileSync(file, await r.text());
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const KG = await acvp('ML-KEM-keyGen-FIPS203'), ED = await acvp('ML-KEM-encapDecap-FIPS203');
if (!KG || !ED) console.log('  SKIP  ACVP files not cached and OFFLINE is set');
else {
  const groups = (j, fn) => j.testGroups.filter((g) => g.parameterSet == 'ML-KEM-768' && (fn == null || g.function == fn));
  const L = (h) => h.toLowerCase();
  await test('keyGen: (d, z) → ek, dk, every ML-KEM-768 case', () => {
    let n = 0;
    for (const g of groups(KG)) for (const t of g.tests) { const k = PQ.keygen(unhex(t.d), unhex(t.z)); eq(hex(k.ek), L(t.ek), `tc ${t.tcId} ek`); eq(hex(k.dk), L(t.dk), `tc ${t.tcId} dk`); n++; }
    if (n < 25) throw new Error(`only ${n} cases`);
    return `${n} cases`;
  });
  await test('encapsulation: (ek, m) → c, k, and decaps(dk, c) = k', () => {
    let n = 0;
    for (const g of groups(ED, 'encapsulation')) for (const t of g.tests) {
      const e = PQ.encaps(unhex(t.ek), unhex(t.m));
      eq(hex(e.ct), L(t.c), `tc ${t.tcId} c`); eq(hex(e.ss), L(t.k), `tc ${t.tcId} k`); eq(hex(PQ.decaps(unhex(t.dk), e.ct)), L(t.k), `tc ${t.tcId} decaps`); n++;
    }
    if (n < 25) throw new Error(`only ${n} cases`);
    return `${n} cases`;
  });
  await test('decapsulation: (dk, c) → k, valid and modified ciphertexts (implicit rejection)', () => {
    let n = 0, modified = 0;
    for (const g of groups(ED, 'decapsulation')) for (const t of g.tests) { eq(hex(PQ.decaps(unhex(t.dk), unhex(t.c))), L(t.k), `tc ${t.tcId} (${t.reason})`); n++; if (/modified/.test(t.reason)) modified++; }
    if (n < 10 || !modified) throw new Error(`only ${n} cases, ${modified} modified`);
    return `${n} cases, ${modified} modified`;
  });
  await test('decapsulation key check (H(ek) in dk)', () => {
    let n = 0, bad = 0;
    for (const g of groups(ED, 'decapsulationKeyCheck')) for (const t of g.tests) {
      const dk = unhex(t.dk);
      eq(!throws(() => PQ.expand(dk)), t.testPassed, `tc ${t.tcId} (${t.reason}) expand`);
      eq(!throws(() => PQ.decaps(dk, new Uint8Array(1088))), t.testPassed, `tc ${t.tcId} (${t.reason}) decaps`);
      n++; if (!t.testPassed) bad++;
    }
    if (n < 10 || !bad) throw new Error(`only ${n} cases, ${bad} refused`);
    return `${n} cases, ${bad} refused`;
  });
  await test('encapsulation key check (coefficients below q)', () => {
    let n = 0, bad = 0;
    for (const g of groups(ED, 'encapsulationKeyCheck')) for (const t of g.tests) {
      const ek = unhex(t.ek);
      eq(!throws(() => PQ.expand(ek)), t.testPassed, `tc ${t.tcId} (${t.reason}) expand`);
      eq(!throws(() => PQ.encaps(ek, new Uint8Array(32))), t.testPassed, `tc ${t.tcId} (${t.reason}) encaps`);
      n++; if (!t.testPassed) bad++;
    }
    if (n < 10 || !bad) throw new Error(`only ${n} cases, ${bad} refused`);
    return `${n} cases, ${bad} refused`;
  });
}

console.log('ML-KEM-768: the Tacit app\'s library (noble), byte for byte');
await test(`${ROUNDS} random (d, z, m): ek, dk, ct, ss equal; decaps of the ciphertext and of a tampered one equal`, () => {
  let rejected = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const seed = rnd(64), m = rnd(32), a = PQ.keygenFromSeed(seed), b = NOBLE.keygen(seed.slice());
    eq(hex(a.ek), hex(b.publicKey), `round ${i} ek`); eq(hex(a.dk), hex(b.secretKey), `round ${i} dk`);
    const e = PQ.encaps(a.ek, m), f = NOBLE.encapsulate(b.publicKey, m.slice());
    eq(hex(e.ct), hex(f.cipherText), `round ${i} ct`); eq(hex(e.ss), hex(f.sharedSecret), `round ${i} ss`);
    eq(hex(PQ.decaps(a.dk, e.ct)), hex(e.ss), `round ${i} decaps`);
    const bad = e.ct.slice(), at = i % 3 ? crypto.randomInt(1088) : 1087 - (i % 128);
    bad[at] ^= 1 << (i % 8);
    const k1 = PQ.decaps(a.dk, bad), k2 = NOBLE.decapsulate(bad, b.secretKey);
    eq(hex(k1), hex(k2), `round ${i} tampered`);
    if (hex(k1) !== hex(e.ss)) rejected++;
  }
  eq(rejected, ROUNDS, 'every tampered ciphertext rejected');
  return `${ROUNDS} keys, ${ROUNDS} encapsulations, ${2 * ROUNDS} decapsulations`;
});
await test('random ciphertexts (not made by encaps) decapsulate as noble does', () => {
  const k = PQ.keygen(rnd(32), rnd(32));
  for (let i = 0; i < 200; i++) { const c = rnd(1088); eq(hex(PQ.decaps(k.dk, c)), hex(NOBLE.decapsulate(c, k.dk)), `ct ${i}`); }
});
await test('an expanded key gives the same answers (ek handle for encaps, dk handle for both)', () => {
  for (let i = 0; i < 100; i++) {
    const k = PQ.keygen(rnd(32), rnd(32)), xe = PQ.expand(k.ek), xd = PQ.expand(k.dk), m = rnd(32), e = PQ.encaps(k.ek, m);
    eq(PQ.expand(xe), xe, 'expand is idempotent');
    for (const x of [xe, xd]) { const e2 = PQ.encaps(x, m); eq(hex(e2.ct), hex(e.ct), 'ct'); eq(hex(e2.ss), hex(e.ss), 'ss'); }
    eq(hex(PQ.decaps(xd, e.ct)), hex(e.ss), 'decaps');
    const bad = e.ct.slice(); bad[i * 7 % 1088] ^= 0x80;
    eq(hex(PQ.decaps(xd, bad)), hex(PQ.decaps(k.dk, bad)), 'tampered');
  }
});
await test('refusals: an ek with a coefficient ≥ q (noble refuses it too), a dk with a changed hash, wrong lengths, decaps with an ek', () => {
  const k = PQ.keygen(rnd(32), rnd(32));
  for (let c = 0; c < 768; c += 17) {
    const ek = k.ek.slice(), byte = (c >> 1) * 3;      // coefficient c of the 12-bit fields
    if (c & 1) { ek[byte + 1] |= 0xf0; ek[byte + 2] = 0xff; } else { ek[byte] = 0xff; ek[byte + 1] |= 0x0f; }
    eq(throws(() => PQ.encaps(ek, rnd(32))), true, `coefficient ${c}`);
    eq(throws(() => NOBLE.encapsulate(ek, rnd(32))), true, `noble, coefficient ${c}`);
  }
  for (const at of [1152, 2000, 2336, 2367]) { const dk = k.dk.slice(); dk[at] ^= 4; eq(throws(() => PQ.decaps(dk, new Uint8Array(1088))), true, `dk byte ${at}`); }
  eq(throws(() => PQ.encaps(k.ek.subarray(1), rnd(32))), true, 'short ek');
  eq(throws(() => PQ.encaps(k.ek, rnd(31))), true, 'short m');
  eq(throws(() => PQ.decaps(k.dk, rnd(1087))), true, 'short ct');
  eq(throws(() => PQ.decaps(k.dk.subarray(0, 2399), rnd(1088))), true, 'short dk');
  eq(throws(() => PQ.decaps(k.ek, rnd(1088))), true, 'decaps with an ek');
  eq(throws(() => PQ.keygen(rnd(31), rnd(32))), true, 'short d');
  eq(throws(() => PQ.keygenFromSeed(rnd(63))), true, 'short seed');
});
await test('the KEM runs with no globals at all (no sha256, no crypto, no DOM)', () => {
  const bare = vm.createContext(Object.create(null));
  vm.runInContext(SRC + '\nglobalThis.PQ = PQ;', bare);
  const P2 = bare.PQ, seed = rnd(64), m = rnd(32), a = P2.keygenFromSeed(seed), e = P2.encaps(a.ek, m);
  eq(hex(a.dk), hex(PQ.keygenFromSeed(seed).dk), 'dk'); eq(hex(P2.decaps(a.dk, e.ct)), hex(PQ.encaps(a.ek, m).ss), 'ss');
});
await test('the KEM runs in a worker made from the part\'s text', async () => {
  const seed = rnd(64), m = rnd(32);
  const w = new Worker(`${SRC}\nconst { parentPort, workerData: { seed, m } } = require('node:worker_threads');
const k = PQ.keygenFromSeed(seed), e = PQ.encaps(k.ek, m); parentPort.postMessage({ dk: k.dk, ss: PQ.decaps(PQ.expand(k.dk), e.ct) });`, { eval: true, workerData: { seed, m } });
  const got = await new Promise((res, rej) => { w.once('message', res); w.once('error', rej); });
  await w.terminate();
  const k = PQ.keygenFromSeed(seed);
  eq(hex(got.dk), hex(k.dk), 'dk'); eq(hex(got.ss), hex(PQ.encaps(k.ek, m).ss), 'ss');
});

console.log('backup phrase');
await test(`the page's SHA-256 (from ${shaFrom}) is SHA-256`, () => { for (let n = 0; n < 200; n++) { const m = rnd(n); eq(hex(sha256(m)), hex(nodeSha(m)), `len ${n}`); } });
await test('the packed list is the BIP39 English list, word for word (and its published SHA-256)', () => {
  const w = [...PQ.words()];
  eq(w.length, 2048, 'count'); eq(w.join(' '), WORDS.join(' '), 'list');
  eq(crypto.createHash('sha256').update(w.join('\n') + '\n').digest('hex'), '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda', 'english.txt');
});
const TREZOR = [
  ['00', 'abandon '.repeat(23) + 'art'],
  ['7f', 'legal winner thank year wave sausage worth useful '.repeat(2) + 'legal winner thank year wave sausage worth title'],
  ['80', 'letter advice cage absurd amount doctor acoustic avoid '.repeat(2) + 'letter advice cage absurd amount doctor acoustic bless'],
  ['ff', 'zoo '.repeat(23) + 'vote'],
];
await test('BIP39 vectors (Trezor\'s 256-bit entropy cases): ours and the app\'s', () => {
  for (const [b, words] of TREZOR) {
    const root = new Uint8Array(32).fill(parseInt(b, 16));
    eq(PQ.phraseOf(root), words, `0x${b}…`); eq(PHRASE.rootToPhrase(root), words, `app 0x${b}…`); eq(hex(PQ.rootOf(words)), hex(root), `back 0x${b}…`);
  }
  const root = unhex('f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f'), words = 'void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold';
  eq(PQ.phraseOf(root), words, 'f585…'); eq(PHRASE.rootToPhrase(root), words, 'app f585…'); eq(hex(PQ.rootOf(words)), hex(root), 'back f585…');
});
await test('500 random roots: the same phrase as the app, and both read it back to the root', () => {
  for (let i = 0; i < 500; i++) {
    const root = rnd(32), p = PQ.phraseOf(root);
    eq(p, PHRASE.rootToPhrase(root), `root ${hex(root)}`);
    eq(hex(PQ.rootOf(p)), hex(root), 'rootOf'); eq(hex(PHRASE.phraseToRoot(p)), hex(root), 'app phraseToRoot');
  }
});
await test('read the way the app reads: case, spacing, punctuation, four-letter prefixes', () => {
  for (let i = 0; i < 300; i++) {
    const root = rnd(32), w = PQ.phraseOf(root).split(' ');
    const messy = w.map((x, k) => (k % 3 == 0 ? x.toUpperCase() : k % 3 == 1 && x.length > 4 ? x.slice(0, 4 + (k % 2)) : x)).join(i % 2 ? ' \n ' : ', ');
    eq(hex(PQ.rootOf(messy)), hex(root), `messy ${i}`); eq(hex(PHRASE.phraseToRoot(messy)), hex(root), 'app agrees');
  }
});
await test('refusals: a wrong checksum, a word not on the list, 23 or 25 words, three-letter stubs, nothing', () => {
  const root = rnd(32), w = PQ.phraseOf(root).split(' ');
  const app = (t) => { try { return hex(PHRASE.phraseToRoot(t)); } catch { return null; } };
  const ours = (t) => { const r = PQ.rootOf(t); return r && hex(r); };
  const L = PQ.words(), idx = L.indexOf(w[23]);
  const wrongSum = [...w.slice(0, 23), L[(idx & ~0xff) | ((idx + 1) & 0xff)]].join(' ');     // same 3 entropy bits, another check byte
  const cases = [wrongSum, [...w.slice(0, 5), 'xyzzy', ...w.slice(6)].join(' '), w.slice(0, 23).join(' '), [...w, w[0]].join(' '),
    [...w.slice(0, 23), w[23].slice(0, 3)].join(' '), '', null, undefined, 'abandon '.repeat(24)];
  for (const t of cases) { eq(ours(t), null, JSON.stringify(t)?.slice(0, 50)); eq(app(t), null, `app ${JSON.stringify(t)?.slice(0, 50)}`); }
  const digits = [...w.slice(0, 10), '42', ...w.slice(10)].join(' ');      // the app reads letters only: a number between words is skipped
  eq(ours(digits), hex(root), 'digits skipped'); eq(app(digits), hex(root), 'app skips digits');
  eq(throws(() => PQ.phraseOf(rnd(31))), true, 'a 31-byte root'); eq(throws(() => PQ.phraseOf('00'.repeat(32))), true, 'a hex string');
});
await test('fuzz: 3,000 mutated phrases, ours and the app\'s agree on refusing and on the root', () => {
  const app = (t) => { try { return hex(PHRASE.phraseToRoot(t)); } catch { return null; } };
  const L = PQ.words();
  let refused = 0;
  for (let i = 0; i < 3000; i++) {
    const w = PQ.phraseOf(rnd(32)).split(' '), k = crypto.randomInt(24), r = i % 6;
    if (r == 0) w[k] = L[crypto.randomInt(2048)];
    else if (r == 1) w[k] = w[k].slice(0, 1 + crypto.randomInt(w[k].length));
    else if (r == 2) w[k] = w[k] + 'xq'.slice(0, 1 + (i & 1));
    else if (r == 3) w.splice(k, 1);
    else if (r == 4) w[k] = w[k].replace(/[aeiou]/, 'é');
    else [w[k], w[(k + 1) % 24]] = [w[(k + 1) % 24], w[k]];
    const t = w.join(' '), a = PQ.rootOf(t);
    eq(a && hex(a), app(t), JSON.stringify(t));
    if (!a) refused++;
  }
  return `${refused} refused`;
});

console.log('timing and size');
await test('timings in node', () => {
  const time = (n, fn) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); return ((performance.now() - t) / n).toFixed(2); };
  const k = PQ.keygen(rnd(32), rnd(32)), e = PQ.encaps(k.ek, rnd(32)), xe = PQ.expand(k.ek), xd = PQ.expand(k.dk), m = rnd(32), d = rnd(32);
  const seed = rnd(64);
  return `keygen ${time(100, () => PQ.keygen(d, d))} ms, encaps ${time(100, () => PQ.encaps(k.ek, m))} ms, decaps ${time(100, () => PQ.decaps(k.dk, e.ct))} ms; ` +
    `expand(dk) ${time(100, () => PQ.expand(k.dk))} ms, then encaps ${time(100, () => PQ.encaps(xe, m))} ms, decaps ${time(100, () => PQ.decaps(xd, e.ct))} ms; ` +
    `noble keygen ${time(100, () => NOBLE.keygen(seed))} ms, encaps ${time(100, () => NOBLE.encapsulate(k.ek, m))} ms, decaps ${time(100, () => NOBLE.decapsulate(e.ct, k.dk))} ms`;
});
await test('minified size (terser): KEM + sponges ≤ 8 KB', async () => {
  const require = createRequire(import.meta.url);
  let terser;
  try { terser = require('terser'); } catch { terser = require('/Users/z/dapps-tacitwei/node_modules/terser'); }
  const min = async (s) => (await terser.minify(s + '\nexport { PQ };', { module: true, compress: { passes: 2 }, mangle: true })).code.replace(/export\{\w+( as PQ)?\};?$/, '');
  const a = SRC.indexOf('  // ---- the backup phrase ----'), b = SRC.indexOf('  return {', a);
  const kemOnly = SRC.slice(0, a) + SRC.slice(b).replace(', phraseOf, rootOf, words', '');
  const noList = SRC.replace(/const LIST = [\s\S]*?';\n/, "const LIST = '';\n");
  const [all, kem, nl] = await Promise.all([min(SRC), min(kemOnly), min(noList)]);
  const gz = (s) => zlib.gzipSync(s, { level: 9 }).length;
  if (kem.length > 8192) throw new Error(`KEM + sponges is ${kem.length} B`);
  return `KEM + sponges ${kem.length} B (gzip ${gz(kem)}); phrase code ${nl.length - kem.length} B; packed wordlist ${all.length - nl.length} B; whole part ${all.length} B (gzip ${gz(all)})`;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
