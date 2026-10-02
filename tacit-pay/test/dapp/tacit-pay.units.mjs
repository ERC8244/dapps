/* The page's small pure functions, taken out of dapp/page.html and run on their own: the amount parser (the same rules as
   tacit.finance's pay pages), the short ID of an address (the same text on every page), and how a failed log read is judged.

   Usage: node test/dapp/tacit-pay.units.mjs                                                                         */
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {cut} from './page-config.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

console.log('amounts');
const parseEth = vm.runInNewContext(`${cut('function parseEth(', '\nfor (const ev of')}\nparseEth`, {BigInt, String});
const E = 10n ** 10n;   // the shared cases are written for 8 decimals; the page reads 18
for (const [t, want] of [
  ['0.001', 100000n], ['.5', 50000000n], ['1.', 100000000n], ['1', 100000000n],
  ['0,001', 100000n], ['0,5', 50000000n], ['1,5', 150000000n], ['12,5', 1250000000n], ['10,50', 1050000000n],
  ['1,234.5', 123450000000n], ['1,000,000', 100000000000000n], ['1,000.', 100000000000n],
  ['1,500', null], ['1,2,3', null], ['1,23,456', null], ['', null], ['.', null], ['abc', null], ['-1', null], ['1e3', null], ['0x10', null],
]) ok(parseEth(t) === (want == null ? null : want * E), `${JSON.stringify(t)} → ${want == null ? 'not an amount' : want * E}`, String(parseEth(t)));
ok(parseEth('0.123456789012345678') === 123456789012345678n, 'eighteen decimals are kept');
ok(parseEth('0.1234567890123456789') === null, 'a nineteenth is refused, not rounded');
ok(parseEth(' 0.5 ') === 5n * 10n ** 17n && parseEth(undefined) === null && parseEth(null) === null, 'spaces are trimmed; nothing is not an amount');

console.log('\nthe ID of an address');
const sha256 = (u) => new Uint8Array(createHash('sha256').update(u).digest());
const utf8 = (s) => new TextEncoder().encode(s), cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const addressId = vm.runInNewContext(`${cut('const addressId =', '\n')}\naddressId`, {sha256, utf8, cat, hex, String});
// tacit.finance's dapp/address-id.js: sha256("tacit-address-id-v1\0" ‖ lowercased address without spaces), first 8 bytes, four groups
const ref = (a) => { const x = hex(sha256(cat(utf8('tacit-address-id-v1\0'), utf8(String(a).toLowerCase().replace(/\s/g, '')))).subarray(0, 8)); return `${x.slice(0, 4)}·${x.slice(4, 8)}·${x.slice(8, 12)}·${x.slice(12)}`; };
const A = 'tacit1qzzsx4pc3x9c8h7x2dpfkvu5r6jwa7qrqzly4sxkq6hqj2p6r5nuep3gf7dv8w9';
ok(addressId(A) === ref(A) && /^[0-9a-f]{4}(·[0-9a-f]{4}){3}$/.test(addressId(A)), 'matches the reference construction', addressId(A));
ok(addressId(A.toUpperCase()) === addressId(A) && addressId(` ${A.slice(0, 20)} ${A.slice(20)} `) === addressId(A), 'case and spaces do not change it');
ok(addressId(A) !== addressId(A.slice(0, -1) + 'x'), 'one character does');

console.log('\nnames and notes');
const nm = vm.runInNewContext(`${cut('const nameOk =', '\n')}\n${cut('const looksName =', '\n')}\n${cut('const nameHint =', '\n')}\n${cut('const noteOf =', '\n')}\n({ nameOk, looksName, nameHint, noteOf })`, {String, RegExp});
for (const n of ['alice.wei', 'a-b.gwei', 'alice.eth', 'pay.alice.eth', 'a.b.c.wei', '0.wei', 'x'.repeat(63) + '.wei']) ok(nm.nameOk(n), `${n.length > 40 ? 'a 63-letter label' : n} is a name`);
for (const n of ['alice', 'alice.com', '.wei', 'alice..wei', 'alice.wei.', 'Alice.wei', 'al ice.wei', 'münchen.eth', 'x'.repeat(64) + '.wei', 'pay.base.eth', 'base.eth', 'alice.weiX']) ok(!nm.nameOk(n), `${n.length > 40 ? 'a 64-letter label' : JSON.stringify(n)} is not one`);
ok(nm.looksName('alice.com') && !nm.looksName('tacit1qq') && !nm.looksName('a b.wei'), 'anything with a dot and no spaces is read as a name, so its refusal can say why');
ok(/\.base\.eth are not supported/.test(nm.nameHint('x.base.eth')) && /ends in \.wei, \.gwei or \.eth/.test(nm.nameHint('x.com')), 'and the refusal names the .base.eth case apart');
ok(nm.noteOf('a\u202Eb\nc\td') === 'ab c d' && nm.noteOf('\u200Bx\u200F') === 'x' && nm.noteOf('  rent  ') === 'rent' && nm.noteOf('y'.repeat(80)).length === 60 && nm.noteOf(null) === '', 'a note loses control and invisible formatting characters, collapses spaces, and keeps 60 characters');

console.log('\na log read that failed');
const logFailure = vm.runInNewContext(`${cut('function logFailure(', '\nasync function getLogs(')}\nlogFailure`, {JSON, Math, Number, String});
const err = (...msgs) => Object.assign(new Error(msgs[0]), {all: msgs.map((m) => Object.assign(new Error(m), {rpc: {data: ''}}))});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(logFailure(err('eth_getLogs is limited to a 2000 block range'), 50000), {step: 2000}), 'a node that names its range limit sets the window to it');
ok(same(logFailure(err('query exceeds max block range'), 50000), {step: 12500}), 'one that only says the range is too large narrows by a quarter');
ok(same(logFailure(err('exceeded maximum block range: 10,000 blocks', 'rate limited'), 50000), {step: 10000}), 'the limit one node names wins over another node’s rate limit');
ok(same(logFailure(err('429 Too Many Requests'), 50000), {busy: true}), 'a rate limit is waited out, not narrowed');
ok(same(logFailure(err('rate limit exceeded: try a smaller range'), 50000), {busy: true}), 'a rate limit is waited out even when it mentions ranges, unless a limit is named');
ok(same(logFailure(err('response size exceeded'), 8), {step: 2}), 'a size complaint narrows by a quarter');
ok(logFailure(err('response size exceeded'), 1) === null, 'at one block there is nothing narrower to try');
ok(logFailure(err('execution reverted'), 50000) === null, 'an unrelated error is passed on');
ok(same(logFailure(new Error('too many results, limit 10000'), 4000), {step: 1000}), 'a single error, not a list of them, is read the same way');

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
