/* The page's post-quantum memo forms, taken out of dapp/page.html and run on their own: the self form (65 bytes) and the
   hybrid form (1,153 bytes) open for their owner and for no one else, a classical memo still opens as before, and each form
   is what the comment in the page says it is (its s worked out here from the spec with node's own SHA-256 and HMAC, the
   ML-KEM shared secret from the noble library tacit.finance ships). Fixed vectors pin the bytes for any other reader.

   TACIT=<a checkout with dapp/vendor/tacit-pq.min.js> (default /Users/z/tacit-neutral). Run: node test/dapp/pq-memo.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash, createHmac, webcrypto} from 'node:crypto';

const TACIT = process.env.TACIT || '/Users/z/tacit-neutral';
const {ml_kem768} = await import(`file://${TACIT}/dapp/vendor/tacit-pq.min.js`);
const page = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url), 'utf8');
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1];
const cut = (a, b) => { const i = mod.indexOf(a), j = mod.indexOf(b, i); if (i < 0 || j < 0) throw new Error('page layout changed: ' + a); return mod.slice(i, j); };
const mem = new Map(), store = {get: (k) => mem.get(k) ?? null, set: (k, v) => (mem.set(k, v), true), del: (k) => mem.delete(k)};
const ctx = vm.createContext({crypto: webcrypto, TextEncoder, TextDecoder, store, console});
vm.runInContext(`${cut('// ── bytes ──', '// ── receive boxes ──')}
globalThis.P = { PQ, poolKeys, pqKeys, sealNote, sealSelf, sealHybrid, openNote, outputKeys, openValue, leafOf, kemHash, memoKey, pqSeen, pqLearn, parseRecipient, tacitAddress, hex, unhex, secp, be, big, FR, SN, PQ_MEMO, paymentKey };`, ctx, {filename: 'page-pq.js'});
const {P} = ctx;

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); c ? pass++ : fail++; };
const sha = (...b) => new Uint8Array(createHash('sha256').update(Buffer.concat(b.map((x) => Buffer.from(x)))).digest());
const hm = (k, ...b) => new Uint8Array(createHmac('sha256', Buffer.from(k)).update(Buffer.concat(b.map((x) => Buffer.from(x)))).digest());
const u8 = (s) => new TextEncoder().encode(s), hex = (b) => Buffer.from(b).toString('hex');
const rnd = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const seeded = (tag) => sha(u8('pq-memo test ' + tag));
const asset = 12345678901234567890n;

// two people: Alice with a root, Bob with a root, Carol without
const keyA = seeded('alice key'), keyB = seeded('bob key'), keyC = seeded('carol key');
const A = P.poolKeys(keyA), B = P.poolKeys(keyB), C = P.poolKeys(keyC);
const rootA = seeded('alice root'), rootB = seeded('bob root');
A.pq = P.pqKeys(rootA); B.pq = P.pqKeys(rootB);
const leafOk = (o, n) => !!o && o.v === n.v;

console.log('keys from the root');
{
  const k = A.pq, d = hm(rootA, u8('tacit-evm-pool-kem-v1'), [0]), z = hm(rootA, u8('tacit-evm-pool-kem-v1'), [1]), n = ml_kem768.keygen(new Uint8Array([...d, ...z]));
  ok(hex(k.ek) === hex(n.publicKey), 'the ML-KEM key is noble keygen(HMAC(root, "tacit-evm-pool-kem-v1" ‖ 0) ‖ HMAC(…‖ 1))');
  ok(hex(k.self) === hex(hm(rootA, u8('tacit-evm-pool-self-v1'))) && hex(k.ent) === hex(hm(rootA, u8('tacit-evm-pool-kem-rand-v1'))) && hex(k.tornado) === hex(hm(rootA, u8('tacit-wei-tornado-v1'))), 'self, ent and the whole notes\' seed are HMACs of the root under their tags');
  ok(hex(k.hash) === hex(sha(u8('tacit-evm-pool-kem-v1'), k.ek)), 'the address names the key by SHA-256("tacit-evm-pool-kem-v1" ‖ ek)');
}

console.log('classical memos, as before');
{
  const n = P.sealNote({to: B, value: 7n, asset});
  ok(n.memo.length === 65 && leafOk(P.openNote(B, {memo: n.memo, leaf: n.leaf, asset}), n), 'a classical memo to Bob opens for Bob (who has a root)');
  ok(leafOk(P.openNote({...B, pq: null}, {memo: n.memo, leaf: n.leaf, asset}), n), 'and for Bob without his root');
  ok(P.openNote(A, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not for Alice');
}

console.log('the self form (65 bytes)');
{
  const e = 0x77777777777n;
  const n = P.sealSelf({keys: A, value: 10n ** 17n, asset, e});
  ok(n.memo.length === 65, 'it is 65 bytes, as a classical memo is');
  const o = P.openNote(A, {memo: n.memo, leaf: n.leaf, asset});
  ok(leafOk(o, n), 'Alice opens it with her root');
  ok(P.openNote({...A, pq: null}, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not without it (her secp keys alone, which a quantum computer could have)');
  ok(P.openNote({...A, pq: B.pq}, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not with another root');
  ok(P.openNote(B, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not for Bob');
  // the spec: s = 0x04 ‖ HMAC(self, "tacit-evm-pool-s-self-v1" ‖ pk_eph)
  const pk = n.memo.subarray(0, 33), s = new Uint8Array([4, ...hm(A.pq.self, u8('tacit-evm-pool-s-self-v1'), pk)]);
  ok(hex(o.s) === hex(s) && P.openValue(s, n.memo.subarray(33)) === n.v, 'its s is 0x04 ‖ HMAC(self, "tacit-evm-pool-s-self-v1" ‖ pk_eph), worked out here');
  ok(hex(pk) === hex(P.secp.compress(P.secp.mulG(e))), 'its pk_eph is e·G, a real point (no different from a classical memo\'s)');
}

console.log('the hybrid form (1,153 bytes)');
{
  const e = 0x1234567n, rB = P.parseRecipient(P.tacitAddress(keyB, B, B.pq.hash));
  ok(hex(rB.kemHash) === hex(B.pq.hash) && !rB.ek, 'Bob\'s address names his key by its hash; this browser does not have the key yet');
  P.pqLearn(B.pq.ek);
  const rB2 = P.parseRecipient(P.tacitAddress(keyB, B, B.pq.hash));
  ok(rB2.ek && hex(rB2.ek) === hex(B.pq.ek), 'once a link brought it, the address is read with the key');
  const n = P.sealHybrid({to: rB2, ek: rB2.ek, value: 5n * 10n ** 16n, asset, e, ent: A.pq.ent});
  ok(n.memo.length === P.PQ_MEMO, 'it is 1,153 bytes');
  const o = P.openNote(B, {memo: n.memo, leaf: n.leaf, asset});
  ok(leafOk(o, n), 'Bob opens it');
  ok(P.openNote({...B, pq: null}, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not without his root');
  ok(P.openNote(A, {memo: n.memo, leaf: n.leaf, asset}) === null, 'not Alice, who sent it');
  // the spec: s = 0x01 ‖ SHA-256("tacit-evm-pool-s-v2" ‖ compress(e·V) ‖ ss ‖ kem_ct ‖ pk_eph); m = HMAC(ent, "tacit-evm-pool-kem-m-v1" ‖ pk_eph)
  const ct = n.memo.subarray(0, 1088), pk = n.memo.subarray(1088, 1121), dh = P.secp.compress(P.secp.mul(B.V, e));
  const m = hm(A.pq.ent, u8('tacit-evm-pool-kem-m-v1'), pk), enc = ml_kem768.encapsulate(B.pq.ek, m);
  ok(hex(enc.cipherText) === hex(ct), 'kem_ct is noble encapsulate(ek, HMAC(ent, "tacit-evm-pool-kem-m-v1" ‖ pk_eph))');
  const ss = ml_kem768.decapsulate(ct, ml_kem768.keygen(new Uint8Array([...hm(rootB, u8('tacit-evm-pool-kem-v1'), [0]), ...hm(rootB, u8('tacit-evm-pool-kem-v1'), [1])])).secretKey);
  const s = new Uint8Array([1, ...sha(u8('tacit-evm-pool-s-v2'), dh, ss, ct, pk)]);
  ok(hex(o.s) === hex(s) && P.openValue(s, n.memo.subarray(1121)) === n.v, 'its s is 0x01 ‖ SHA-256("tacit-evm-pool-s-v2" ‖ e·V ‖ ss ‖ kem_ct ‖ pk_eph), worked out here');
  // changed anywhere, it opens for no one
  let refused = 0;
  for (const at of [0, 500, 1087, 1088, 1100, 1120, 1121, 1140, 1152]) { const t = n.memo.slice(); t[at] ^= 1; if (P.openNote(B, {memo: t, leaf: n.leaf, asset}) === null) refused++; }
  ok(refused === 9, 'a memo changed in any part (the ML-KEM ciphertext, pk_eph, ct, tag) opens for no one', `${refused}/9`);
  // a sender with no root: random encapsulation randomness, still opened
  const n2 = P.sealHybrid({to: rB2, ek: rB2.ek, value: 3n, asset});
  ok(leafOk(P.openNote(B, {memo: n2.memo, leaf: n2.leaf, asset}), n2), 'from a sender with no root (random encapsulation), Bob opens it');
  // a hybrid memo to a recipient whose ML-KEM key is not theirs (a pad output sealed to Bob's key with other view keys)
  const pad = P.sealHybrid({to: P.poolKeys(rnd(32)), ek: B.pq.ek, value: 0n, asset});
  ok(P.openNote(B, {memo: pad.memo, leaf: pad.leaf, asset}) === null, 'a pad output sealed to Bob\'s ML-KEM key under other view keys does not open for him');
  ok(P.openNote(C, {memo: n.memo, leaf: n.leaf, asset}) === null && P.memoKey(n.memo, null) === null, 'a reader with no root does not read hybrid memos at all');
}

console.log('a spend\'s one-time keys');
{
  const nf = 987654321n, plain = {...A, pq: null};
  const e0 = P.paymentKey(plain, 1, nf, 0), e1 = P.paymentKey(A, 1, nf, 0);
  const want0 = P.big(hm(sha(u8('tacit-evm-pool-eph-v1'), P.be(A.v)), P.be(1n), P.be(nf), [0])) % P.SN, want1 = P.big(hm(hm(rootA, u8('tacit-evm-pool-eph-pq-v1')), P.be(1n), P.be(nf), [0])) % P.SN;
  ok(e0 === want0, 'without a root, from the view key (as every Tacit app makes them)');
  ok(e1 === want1 && e1 !== e0, 'with a root, from HMAC(root, "tacit-evm-pool-eph-pq-v1"): the view key (which the Tacit key gives away) does not find the spend');
}

console.log('the address\'s 0x10 lane');
{
  const a = P.tacitAddress(keyA, A, A.pq.hash), plain = P.tacitAddress(keyA, A);
  ok(a !== plain && a.startsWith('tacit1') && a.length > plain.length, 'with a root the address is longer and different');
  const r = P.parseRecipient(a), r0 = P.parseRecipient(plain);
  ok(hex(r.raw) === hex(r0.raw), 'both carry the same pool keys (the old address still pays the same person, classically)');
  // tacit.finance's reader takes the address (an unknown lane after the known ones)
  const {makeTacitAddress} = await import(`file://${TACIT}/dapp/tacit-address.js`);
  const {secp} = await import(`file://${TACIT}/dapp/vendor/tacit-deps.min.js`);
  {
    const d = makeTacitAddress({secp}).decodeTacitAddress(a);
    ok(hex(d.lanes.pool.keys) === hex(A.raw), 'tacit.finance\'s address reader reads it, with the same pool keys (it pays it classically)');
  }
}

console.log('fixed vectors');
{
  const e = 0xabcdefn, keys = P.poolKeys(seeded('vector key')), root = seeded('vector root');
  keys.pq = P.pqKeys(root);
  const self = P.sealSelf({keys, value: 123456789n, asset, e});
  const hy = P.sealHybrid({to: keys, ek: keys.pq.ek, value: 987654321n, asset, e: e + 1n, ent: keys.pq.ent});
  const v = {self: hex(sha(self.memo)), selfLeaf: String(self.leaf), hybrid: hex(sha(hy.memo)), hybridLeaf: String(hy.leaf), ek: hex(sha(keys.pq.ek))};
  const file = new URL('./vectors/pq-memo.json', import.meta.url);
  if (!fs.existsSync(file) || process.env.WRITE_VECTORS) { fs.mkdirSync(new URL('./vectors/', import.meta.url), {recursive: true}); fs.writeFileSync(file, JSON.stringify({about: 'sha256(memo) and the leaf for fixed inputs: key = sha256("pq-memo test vector key"), root = sha256("pq-memo test vector root"), asset 12345678901234567890; self: e 0xabcdef, value 123456789; hybrid to oneself: e 0xabcdf0, value 987654321, m from ent', ...v}, null, 2) + '\n'); ok(true, 'vectors written', file.pathname); }
  else { const w = JSON.parse(fs.readFileSync(file, 'utf8')); ok(['self', 'selfLeaf', 'hybrid', 'hybridLeaf', 'ek'].every((k) => w[k] === v[k]), 'the memos and leaves match the vectors on file'); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
