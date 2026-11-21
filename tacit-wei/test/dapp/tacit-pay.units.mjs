/* The page's small pure functions, taken out of dapp/page.html and run on their own: the amount parser (the same rules as
   tacit.finance's pay pages), the short ID of an address (the same text on every page), how a failed log read is judged,
   and how stored state is sealed (and read back as earlier pages sealed it).

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

console.log('\namounts in a token');
const parseUnits = vm.runInNewContext(`${cut('function parseEth(', '\nfor (const ev of')}\n${cut('function parseUnits(', '\n// Arrow keys')}\nparseUnits`, {BigInt, String});
for (const [t, d, want] of [
  ['1.5', 6, 1500000n], ['0.000001', 6, 1n], ['1,234.5', 6, 1234500000n], ['0', 6, 0n], ['3', 0, 3n], ['3.0', 0, 3n], ['0.1', 18, 10n ** 17n], ['1', 24, 10n ** 24n],
  ['0.0000001', 6, null], ['3.5', 0, null], ['1e3', 6, null], ['-1', 6, null], ['', 6, null], ['1', 37, null],
  ['0.0000000000000000000001', 24, 100n], ['1.000000', 2, 100n], ['0.0000000000000000000000001', 24, null],
]) ok(parseUnits(t, d) === want, `${JSON.stringify(t)} with ${d} decimals → ${want == null ? 'not an amount' : want}`, String(parseUnits(t, d)));

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

console.log('\nshortening an address');
const short = vm.runInNewContext(`${cut('const short =', '\n')}\nshort`, {RegExp});
const T = 'tacit1qzzsxne4t0wt0nq27u5w70xwh9s4myrgfw6m9jjlskdtpu9hqsr4sud2qtvmuq4q9swlf55uxmmrlfw9ezfjdzattp93p8hmlg9re4lgr994yq4rgu24e782r5kl9kncq9yt74scx4h2q85tsafmlycp4qsvjqp27u6dukrnm3crr7z38jsg2h2hrwjs769e4jkd9d4gpkhq25mfx7ls2w343ljem2lqqwsylvhg779gn9ye2hp6rgwpl2nt8weweu9k3aetkuyv7k';
ok(short(T, 6) === T.slice(0, 16) + '…' + T.slice(-6) && short(T, 6).startsWith('tacit1qzzsxne4t0'), 'a tacit1… address keeps its first ten characters, which are the same for everyone, and then six more, as tacit.finance does', short(T, 6));
ok(short(T, 8) === T.slice(0, 18) + '…' + T.slice(-8), 'and eight more where there is room');
const X = '0xf39Fd6e51aad88F6F4ce6AB8827279cffFb92266';
ok(short(X, 6) === '0xf39Fd6…b92266' && short(X) === '0xf39F…2266', 'any other address keeps 0x and n characters');
ok(short('tacit1qq') === 'tacit1qq' && short('') === '' && short(null) === '', 'a short one is left whole');

console.log('\nnames and notes');
const nm = vm.runInNewContext(`${cut('const nameOk =', '\n')}\n${cut('const looksName =', '\n')}\n${cut('const nameHint =', '\n')}\n${cut('const noteOf =', '\n')}\n({ nameOk, looksName, nameHint, noteOf })`, {String, RegExp});
for (const n of ['alice.wei', 'a-b.gwei', 'alice.eth', 'pay.alice.eth', 'a.b.c.wei', '0.wei', 'x'.repeat(63) + '.wei']) ok(nm.nameOk(n), `${n.length > 40 ? 'a 63-letter label' : n} is a name`);
for (const n of ['alice', 'alice.com', '.wei', 'alice..wei', 'alice.wei.', 'Alice.wei', 'al ice.wei', 'münchen.eth', 'x'.repeat(64) + '.wei', 'pay.base.eth', 'base.eth', 'alice.weiX']) ok(!nm.nameOk(n), `${n.length > 40 ? 'a 64-letter label' : JSON.stringify(n)} is not one`);
ok(nm.looksName('alice.com') && !nm.looksName('tacit1qq') && !nm.looksName('a b.wei'), 'anything with a dot and no spaces is read as a name, so its refusal can say why');
ok(/\.base\.eth are not supported/.test(nm.nameHint('x.base.eth')) && /ends in \.wei, \.gwei or \.eth/.test(nm.nameHint('x.com')), 'and the refusal names the .base.eth case apart');
ok(nm.noteOf('a\u202Eb\nc\td') === 'ab c d' && nm.noteOf('\u200Bx\u200F') === 'x' && nm.noteOf('  rent  ') === 'rent' && nm.noteOf('y'.repeat(80)).length === 60 && nm.noteOf(null) === '', 'a note loses control and invisible formatting characters, collapses spaces, and keeps 60 characters');

ok(nm.noteOf('a' + '\u0301'.repeat(40) + 'b') === 'a\u0301\u0301b' && nm.noteOf('caf\u00e9 e\u0301') === 'caf\u00e9 e\u0301', 'marks stacked past two on one letter go, and ordinary accents stay');

console.log('\nfigures that say what something holds');
{
  const fmt = vm.runInNewContext(`${cut('function fmt(', '\nconst ethStr')}\n${cut('const group =', '\n')}\nfmt`, {BigInt, String});
  ok(fmt(999_999_500_000_000_000n) === '1' && fmt(999_999_500_000_000_000n, 6, true) === '0.999999', 'a holding is cut, not rounded up to read as enough');
  ok(fmt(12_345_500_000_000_000n, 6, true) === '0.012345' && fmt(12_345_500_000_000_000n) === '0.012346', 'and the most a spend takes is never shown above what it is');
}

console.log('\ncombining a balance held in parts');
const combinePlan = vm.runInNewContext(`${cut('function combinePlan(', '\nfunction maxSpend(')}\ncombinePlan`, {BigInt, Number});
const W = 10n ** 15n;
ok(combinePlan(5n * 10n ** 12n, [W, 2n * W]) === null && combinePlan(5n * 10n ** 12n, [W]) === null && combinePlan(0n, []) === null, 'a balance in one or two parts needs nothing');
const cp = combinePlan(5n * 10n ** 12n, [4n * W, W, W, W, W]);
ok(cp.parts === 5 && cp.steps === 4 && cp.cost === 20n * 10n ** 12n && cp.after === 8n * W - 20n * 10n ** 12n, 'five parts take four steps, each paying the fee once', JSON.stringify({...cp, cost: String(cp.cost), after: String(cp.after)}));
ok(combinePlan(null, [W, W, W]).cost === 0n && combinePlan(0n, [W, W, W]).steps === 2, 'with no fee known yet, or none (the wallet pays the gas), the steps still count');
ok(combinePlan(2n * W, [W, W, W]) === null && combinePlan(W / 2n, [W, W, W]).after === 2n * W, 'and it is not offered when the fees would eat the balance');
ok(combinePlan(W, [W, W, W]) === null && combinePlan(W, [2n * W, 2n * W, 2n * W, W]).parts === 3, 'a part worth no more than one step\'s fee is left out: combining it would cost what it holds');

console.log('\nwhy an amount cannot be spent');
{
  const w = vm.runInNewContext(`${cut('function plan(', '\nfunction maxSpend(')}\nwhyNot`, {BigInt, Number});
  const parts = (n) => Array(n).fill(W);
  ok(w(W, 0n, 2n * W, parts(2)) === null, 'two parts, one of them enough: it can be spent');
  ok(w(9n * W, 0n, 12n * W, parts(12)) === null, 'twelve parts for nine: the combining a payment does by itself covers it');
  ok(w(10n * W, 0n, 12n * W, parts(12)) === 'parts', 'twelve parts for ten: the balance covers it, but only after combining first');
  ok(w(20n * W, 0n, 12n * W, parts(12)) === 'short', 'and twenty from twelve is short, not fragmented');
}

console.log('\nthe onchain registry of public nodes');
{
  const {AbiCoder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href), coder = AbiCoder.defaultAbiCoder();
  const unhex = (h) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) || [], (x) => parseInt(x, 16)), big = (b) => b.reduce((x, y) => (x << 8n) | BigInt(y), 0n);
  const reg = vm.runInNewContext(`${cut('const abiStrings =', '\nasync function readRegistry')}\n({ abiStrings, abiStringLists, goodUrl })`, {Number, TextDecoder, Error, big, unhex, Set, RegExp});
  const topOf = (h) => { const b = unhex(h); return [b, Number(big(b.subarray(0, 32)))]; };   // a reply's bytes and where its first list starts
  const list = ['https://a.example', 'https://b.example/path', ''], lists = [['https://x.example'], [], ['https://y.example', 'https://z.example']];
  ok(JSON.stringify(reg.abiStrings(...topOf(coder.encode(['string[]'], [list])))) === JSON.stringify(list), 'a string[] reply decodes as the encoder wrote it');
  ok(JSON.stringify(reg.abiStringLists(...topOf(coder.encode(['string[][]'], [lists])))) === JSON.stringify(lists), 'and a string[][] reply, empty lists included');
  let threw = false; try { reg.abiStrings(...topOf('0x' + '00'.repeat(31) + '20' + '00'.repeat(31) + '05')); } catch { threw = true; }
  ok(threw, 'a reply that claims more than it holds is refused, not read past its end');
  ok(reg.goodUrl('https://node.example/v1') && !reg.goodUrl('http://node.example') && !reg.goodUrl('https://a b') && !reg.goodUrl('javascript:alert(1)') && !reg.goodUrl(''), 'only https URLs without spaces are taken');
}

console.log('\na log read that failed');
const logFailure = vm.runInNewContext(`${cut('function logFailure(', '\nasync function getLogs(')}\nlogFailure`, {JSON, Math, Number, String});
const err = (...msgs) => Object.assign(new Error(msgs[0]), {all: msgs.map((m) => Object.assign(new Error(m), {rpc: {data: ''}}))});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(logFailure(err('eth_getLogs is limited to a 2000 block range'), 50000), {step: 2000, named: true}), 'a node that names its range limit sets the window to it');
ok(same(logFailure(err('query exceeds max block range'), 50000), {step: 12500}), 'one that only says the range is too large narrows by a quarter');
ok(same(logFailure(err('exceeded maximum block range: 10,000 blocks', 'rate limited'), 50000), {step: 10000, named: true}), 'the limit one node names wins over another node’s rate limit');
ok(same(logFailure(err('429 Too Many Requests'), 50000), {busy: true}), 'a rate limit is waited out, not narrowed');
ok(same(logFailure(err('rate limit exceeded: try a smaller range'), 50000), {busy: true}), 'a rate limit is waited out even when it mentions ranges, unless a limit is named');
ok(same(logFailure(err('response size exceeded'), 8), {step: 2}), 'a size complaint narrows by a quarter');
ok(logFailure(err('response size exceeded'), 1) === null, 'at one block there is nothing narrower to try');
ok(logFailure(err('execution reverted'), 50000) === null, 'an unrelated error is passed on');
ok(same(logFailure(new Error('too many results, limit 10000'), 4000), {step: 1000}), 'a single error, not a list of them, is read the same way');
ok(same(logFailure(err('eth_getLogs is limited to a 1,000 range', 'request limit reached', '429 Too Many Requests'), 50000, 50000), {busy: true}), 'a step a node served before, failing with one busy, is waited out: the node that names a small cap is not taken as the cap');
ok(same(logFailure(err('eth_getLogs is limited to a 1,000 range', 'request limit reached'), 50000, 10000), {step: 1000, named: true}), 'a step wider than any served still takes the named cap');
ok(same(logFailure(err('ranges over 10000 blocks are not supported on free plan'), 50000), {step: 12500}), 'a free plan’s number is not taken as a cap (its node refuses far less): the range narrows instead');

console.log('\nstored state, sealed');
{
  const seal = vm.runInNewContext(`${cut('// ── bytes ──', '\n// The shared secrets of memo keys')}\n({ sealState, openState, stateKeys, keccak, cat, utf8, toB64 })`, {crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob});
  const v = 0x1234567890abcdefn, text = JSON.stringify({notes: [1, 2, 3], pad: 'x'.repeat(5000)}), name = 'tacit-pay-s1:00ff';
  const s3 = seal.sealState(v, text, name);
  ok(s3.startsWith('enc3:') && seal.openState(v, s3, name) === text, 'a state is written as enc3 and opens again');
  ok(seal.openState(v, s3, name + 'x') === null && seal.openState(v + 1n, s3, name) === null, 'it does not open under another name or another key');
  // As earlier pages wrote it: the same keys and tag, a keccak(key ‖ be32(i)) stream for each 32 bytes.
  const old = (two) => {
    const nonce = new Uint8Array(16).fill(7), pt = seal.utf8(text), [enc, mac] = seal.stateKeys(v, nonce), m = seal.cat(enc, [0, 0, 0, 0]), ks = new Uint8Array(Math.ceil(pt.length / 32) * 32);
    for (let i = 0; i * 32 < pt.length; i++) { m[32] = i >>> 24; m[33] = i >>> 16; m[34] = i >>> 8; m[35] = i; ks.set(seal.keccak(m), 32 * i); }
    const ct = pt.map((b, i) => b ^ ks[i]), tag = seal.keccak(two ? seal.cat(mac, seal.keccak(seal.utf8(name)), ct) : seal.cat(mac, ct)).subarray(0, 16), b = seal.cat(nonce, ct, tag);
    return two ? 'enc2:' + seal.toB64(b) : 'enc1:' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  ok(seal.openState(v, old(true), name) === text, 'a state an earlier page wrote as enc2 still opens');
  ok(seal.openState(v, old(false)) === text, 'and one written as enc1 under the oldest names');
}

console.log('stay signed in: the kept key is removed when its time is up, not only refused');
{
  // the page's own functions, with a fake clock, a fake tab storage, and timers that are only recorded
  let now = 1_700_000_000_000;
  const tab = new Map(), plain = new Map(), timers = [], cleared = [];
  const SN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const ctx = vm.createContext({
    Date: {now: () => now}, JSON, RegExp, Number, String, Object, BigInt, Uint8Array, Buffer, Math, SN,
    sessionStorage: {getItem: (k) => tab.get(k) ?? null, setItem: (k, v) => tab.set(k, String(v)), removeItem: (k) => tab.delete(k)},
    store: {get: (k) => plain.get(k) ?? null, set: (k, v) => plain.set(k, v), del: (k) => plain.delete(k)},
    setTimeout: (f, ms) => { timers.push({f, ms}); return timers.length; }, clearTimeout: (id) => cleared.push(id),
    hex: (b) => Buffer.from(b).toString('hex'), unhex: (h) => Uint8Array.from(Buffer.from(h, 'hex')),
    big: (b) => BigInt('0x' + Buffer.from(b).toString('hex')), lc: (s) => String(s).toLowerCase(),
    anchorOf: (a) => 'anchor:' + a, sealOf: (k) => 'seal:' + Buffer.from(k).toString('hex').slice(0, 8),
  });
  vm.runInContext(`${cut("const STAY = 'tacit-wei-stay-v1'", 'function stayRestore()')}\nglobalThis.stay = { stayOn, stayDrop, stayRec, stayKeep, stayGet, STAY, STAY_KEY, STAY_MS };`, ctx);
  const S = ctx.stay, HOUR = 3_600_000, key = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex')), acct = '0xAbCd000000000000000000000000000000000001';
  plain.set(S.STAY, '1'); plain.set('anchor:' + acct.toLowerCase(), 'seal:11111111');

  S.stayKeep(key, acct);
  ok(!!S.stayGet(acct) && tab.has(S.STAY_KEY), 'a key kept now is read back for its account');
  ok(timers.length === 1 && timers[0].ms === 12 * HOUR + 1000, 'and a timer is set for the end of its twelve hours', String(timers[0]?.ms));
  now += 5 * HOUR; S.stayKeep(key, acct);
  ok(JSON.parse(tab.get(S.STAY_KEY)).t === 1_700_000_000_000 && timers.at(-1).ms === 7 * HOUR + 1000, 'kept again (a reload), it keeps its first time: the twelve hours are not extended', String(timers.at(-1)?.ms));
  now = 1_700_000_000_000 + 12 * HOUR + 1000; timers.at(-1).f();
  ok(!tab.has(S.STAY_KEY), 'when the timer ends the record is removed with nobody reading it');

  now = 1_700_000_000_000; S.stayKeep(key, acct); now += 13 * HOUR;
  ok(S.stayGet(acct) === null && !tab.has(S.STAY_KEY), 'a record read after its time is refused and removed, not left in storage');
  tab.set(S.STAY_KEY, 'not json'); ok(S.stayRec() === null && !tab.has(S.STAY_KEY), 'a record that is not one is removed');
  tab.set(S.STAY_KEY, JSON.stringify({k: 'zz', a: null, t: now})); ok(S.stayRec() === null && !tab.has(S.STAY_KEY), 'and one whose key is not 32 bytes of hex');
  S.stayKeep(key, acct); const before = cleared.length; S.stayDrop();
  ok(!tab.has(S.STAY_KEY) && cleared.length === before + 1, 'dropping a key also stops its timer');
}

console.log('a withdrawal in parts: sizes and times drawn from the cryptographic generator, within their bounds');
{
  const {webcrypto} = await import('node:crypto');
  const src = `${cut('const rand01 =', '\n')}\n${cut('const partDue =', '\n')}\n${cut('function lgParts(', '\n// A part that fell due')}\nglobalThis.api = { rand01, partDue, lgParts };`;
  ok(!/Math\.random/.test(src), 'the code that draws them does not mention Math.random');
  // Math without random: a call to it would throw. `bytes` is what the generator hands out, so the draws can be set.
  const M = Object.create(Math); M.random = () => { throw new Error('Math.random was used'); };
  let fill = null;
  const make = () => {
    const ctx = vm.createContext({BigInt, Math: M, randomBytes: (n) => (fill == null ? webcrypto.getRandomValues(new Uint8Array(n)) : new Uint8Array(n).fill(fill))});
    vm.runInContext(src, ctx);
    return ctx.api;
  };
  const P = make(), A = 15n * 10n ** 17n, sig4 = (v) => { let u = 1n; while (v / u >= 10_000n) u *= 10n; return v % u === 0n; };
  // 85%..115% of an even share a/n; cutting to four digits takes off at most a thousandth of the part
  const inShare = (v, a, n) => v * BigInt(n) * 1000n * 1000n >= a * 850n * 999n && v * BigInt(n) * 1000n <= a * 1150n;
  let bad = '';
  for (let i = 0; i < 1500 && !bad; i++) for (const n of [2, 3, 4]) {
    const ps = P.lgParts(A, n), sum = ps.reduce((t, v) => t + v, 0n);
    if (ps.length !== n || sum !== A) bad = `${n} parts summing to ${sum}`;
    else if (ps.some((v) => v <= 0n)) bad = 'a part that is not above zero';
    else if (!ps.slice(0, -1).every((v) => sig4(v) && inShare(v, A, n))) bad = `a part outside four digits or 85%..115%: ${ps}`;
  }
  ok(!bad, 'the parts of a withdrawal always add up to the amount, each above zero, all but the last at four digits and near an even share', bad);
  ok(new Set(Array.from({length: 40}, () => P.lgParts(A, 3).join())).size > 30, 'and they differ from one withdrawal to the next');
  fill = 0; const low = make().lgParts(10n ** 18n, 3); fill = 255; const high = make().lgParts(10n ** 18n, 3); fill = null;
  ok(low[0] === 283_300_000_000_000_000n && high[0] === 383_000_000_000_000_000n, 'the lowest draw gives 85% of an even share and the highest just under 115%', `${low[0]} ${high[0]}`);
  const at = 1_700_000_000_000, span = 12 * 3_600_000;
  let off = '';
  for (let i = 0; i < 1500 && !off; i++) { const d = [0, 1, 2].map((k) => P.partDue(at, span, k, 4)); d.forEach((x, k) => { if (x < at + span * (k + 1) / 4 - 1 || x >= at + span * (k + 2) / 4) off = `part ${k + 2} due at ${(x - at) / 3_600_000} h`; }); if (!(d[0] < d[1] && d[1] < d[2])) off ||= 'slices out of order'; }
  ok(!off, 'each later part falls due inside its own slice of the span, in order', off);
  fill = 0; const first = make().partDue(at, span, 0, 3); fill = 255; const last = make().partDue(at, span, 1, 3); fill = null;
  ok(first === at + span / 3 && last < at + span && last > at + span * 0.99, 'at the lowest and highest draws, the start of the slice and just before its end', `${(first - at) / 3_600_000} h, ${(last - at) / 3_600_000} h`);
}

console.log('a withdrawal in parts: the receipt says what each later part pays');
{
  // the page's own row, with its helpers as plain text
  const row = vm.runInNewContext(`${cut('const laterFeeRow =', '\n// An amount out that is exactly one')}\nlaterFeeRow`, {
    kvRow: (label, value) => `${label}: ${value}`, ethStr: (v) => `${Number(v) / 1e18}`, TC: {MAX_FEE_PERCENT: 3},
  });
  const E18 = 10n ** 18n, notesOnly = {rest: 0n, notes: [1]}, mixed = {rest: E18 / 10n, notes: [1]};
  ok(row(null, null) === '', 'while the relay\'s fee is still being read, nothing is said of it');
  ok(row(0n, null) === 'Fee, each later part: none · your wallet pays the gas', 'a wallet that pays the gas pays it for each part', row(0n, null));
  ok(row(E18 / 1000n, null) === 'Fee, each later part: about 0.001 ETH', 'a part from the balance: each later part pays about the relay fee this one does', row(E18 / 1000n, null));
  ok(row(E18 / 1000n, mixed) === 'Fee, each later part: about 0.001 ETH and the notes’ gas', 'a part of notes and balance: that, and the notes\' gas', row(E18 / 1000n, mixed));
  ok(row(E18 / 1000n, notesOnly) === 'Fee, each later part: from its note, as this one’s (at most 3%)' && row(null, notesOnly) === row(0n, notesOnly), 'a part wholly from notes: each pays from its own note, whatever the relay asks', row(null, notesOnly));
}

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
