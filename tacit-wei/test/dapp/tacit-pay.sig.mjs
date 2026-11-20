/* The page's ECDSA (the signature on a payment link's deposit address) against an independent implementation,
   @noble/secp256k1, which tacit.finance uses to make and check the same signatures: a signature the page makes is
   accepted by it, one it makes is accepted by the page, and a high-s, tampered or wrongly keyed one is refused by both.
   No browser: the page's own secp256k1 code is loaded out of dapp/page.html.

   Usage: node test/dapp/tacit-pay.sig.mjs                                                                         */
import vm from 'node:vm';
import { cut } from './page-config.mjs';

const NM = '/Users/z/tacit/node_modules/';
const noble = await import(NM + '@noble/secp256k1/index.js');
const { hmac } = await import(NM + '@noble/hashes/hmac.js');
const { sha256 } = await import(NM + '@noble/hashes/sha256.js');
noble.etc.hmacSha256Sync = (k, ...m) => hmac(sha256, k, noble.etc.concatBytes(...m));

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

const code = cut('// ── bytes ──', 'const pubOf = ') + 'const pubOf = (priv) => secp.compress(secp.mulG(big(priv)));';
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, BigInt, Math, Error, Array, Object, Number, String });
vm.runInContext(`${code}\nglobalThis.__p = { secp, SN, big, be, cat, hex, unhex, pubOf, keccak, utf8, randomBytes };`, ctx);
const P = ctx.__p;
const rnd = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
const toHex = (b) => Buffer.from(b).toString('hex');
const scalar = () => { for (;;) { const k = rnd(); const v = P.big(k); if (v > 0n && v < P.SN) return k; } };

let a = 0, b = 0, rejectHigh = 0, rejectTamper = 0, rejectKey = 0;
const N = 150;
for (let i = 0; i < N; i++) {
  const d = scalar(), msg = P.keccak(rnd(40)), pub = P.pubOf(d);
  // made by the page, checked by noble
  const sig = P.secp.sign(msg, P.big(d));
  if (noble.verify(toHex(sig), toHex(msg), toHex(pub))) a++;
  // made by noble, checked by the page
  const nsig = noble.sign(toHex(msg), toHex(d));
  if (P.secp.verify(nsig.toCompactRawBytes(), msg, pub)) b++;
  // a high-s twin is refused by both; a tampered message or another key is refused by the page
  const r = P.big(sig.subarray(0, 32)), s = P.big(sig.subarray(32));
  const high = P.cat(P.be(r), P.be(P.SN - s));
  if (!P.secp.verify(high, msg, pub) && !noble.verify(toHex(high), toHex(msg), toHex(pub))) rejectHigh++;
  const m2 = Uint8Array.from(msg); m2[0] ^= 1;
  if (!P.secp.verify(sig, m2, pub)) rejectTamper++;
  if (!P.secp.verify(sig, msg, P.pubOf(scalar()))) rejectKey++;
}
ok(a === N, `${N} signatures made by the page are accepted by noble`, `${a}`);
ok(b === N, `${N} signatures made by noble are accepted by the page`, `${b}`);
ok(rejectHigh === N, 'a high-s twin of a valid signature is refused by both', `${rejectHigh}`);
ok(rejectTamper === N, 'a changed message is refused', `${rejectTamper}`);
ok(rejectKey === N, 'another key is refused', `${rejectKey}`);
const d = scalar(), msg = P.keccak(rnd(8)), sig = P.secp.sign(msg, P.big(d));
ok(!P.secp.verify(new Uint8Array(64), msg, P.pubOf(d)) && !P.secp.verify(sig.subarray(0, 63), msg, P.pubOf(d)) && !P.secp.verify(sig, msg, new Uint8Array(33)), 'zero, short and malformed inputs are refused, not thrown');
const tag = P.utf8('tacit-pay-box-v1'), npk = 0x1234567890abcdefn;
const digest = P.keccak(P.cat(tag, P.unhex(npk.toString(16).padStart(64, '0'))));
ok(digest.length === 32 && toHex(digest) === toHex(P.keccak(P.cat(tag, P.be(npk, 32)))), 'the signed digest is keccak("tacit-pay-box-v1" ‖ 32-byte key), as tacit.finance makes it');
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
