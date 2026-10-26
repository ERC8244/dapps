/* What the page takes from a node, a link or a token's own contract, each taken out of dapp/page.html as it ships and run with
   concrete values, no browser and no network: the chain's clock is one node's word, and it moves a deadline by five minutes at
   most; Max on an amount that shows on chain is rounded in a token pool too (the amount would otherwise be the deposit less
   the relay's fee, to the last unit); a name in a link has a few labels (each one is asked of the registry); a token no list vouches for does not take the
   mark, or the dollar route, of a listed token from the symbol its own contract reports.

   Usage: node test/dapp/tacit-pay.untrusted.mjs                                                                        */
import vm from 'node:vm';
import { mod } from './page-config.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== '' && !c ? '  ' + x : '')); if (!c) failures++; };

const L = mod.split('\n');
const at = (re, from = 0) => { const i = L.findIndex((l, k) => k >= from && re.test(l)); if (i < 0) throw new Error('page layout changed: ' + re); return i; };
const block = (re, end) => { const a = at(re), b = at(end, a + 1); return L.slice(a, b + 1).join('\n'); };
const code = [
  `const lc = (s) => String(s).toLowerCase(), ZERO_ADDRESS = '0x' + '0'.repeat(40);`,
  `let POOLS = []; const poolsOf = () => POOLS, tst = () => ({ bal: 1n }), CH = { 1: { bal: 1n } };`,
  `const html = (s, ...v) => s.reduce((a, x, i) => a + x + (v[i] ?? ''), '');`,
  `const pethIcon = 'PETH', ethIcon = 'ETH', POOL_ICONS = { USDC: 1, USDT: 1, TAC: 1 }, poolIcon = (t) => 'POOL:' + t.sym;`,
  `let NODE_TS = null; const ownOn = () => async () => (NODE_TS == null ? null : { timestamp: '0x' + NODE_TS.toString(16) });`,
  L[at(/^const nameOk = /)],
  `const plain = (v) => 'P' + v, toasts = []; const toast = (m) => toasts.push(m); class Event { constructor(n) { this.type = n; } }`,
  block(/^function coarse\(/, /^\}/), block(/^function maxPublic\(/, /^\}/), L[at(/^const unitsAll = /)],
  block(/^const CLOCK = \{\};/, /^\}/),
  L[at(/^const tokIcon = /)],
  L[at(/^const STABLE = /)], L[at(/^const DOLLARS = /)], L[at(/^const hubInto = /)], block(/^const hubFrom = /, /^\};/),
  `globalThis.__t = { toasts, coarse, maxPublic, unitsAll, nameOk, chainNow, tokIcon, hubInto, hubFrom, setPools: (p) => { POOLS = p; }, setTs: (t) => { NODE_TS = t; } };`,
].join('\n');
const ctx = vm.createContext({ Date, Math, Number, BigInt, Array, Object, Set, Promise, String, RegExp });
vm.runInContext(code, ctx);
const T = ctx.__t;

console.log('the chain’s clock');
{
  const now = () => Math.floor(Date.now() / 1000);
  let chain = 100;
  const at = async (ts) => { T.setTs(ts); return (await T.chainNow({ chainId: ++chain })) - now(); };
  const near = (d, want) => Math.abs(d - want) <= 3;
  ok(near(await at(now()), 0), 'a node that agrees with the device changes nothing');
  ok(near(await at(now() + 120), 120), 'a clock two minutes slow is corrected');
  ok(near(await at(now() - 120), -120), 'a clock two minutes fast is corrected');
  ok(near(await at(now() + 100 * 365 * 86400), 300), 'a node a hundred years ahead moves a deadline by five minutes at most', String(await at(now() + 100 * 365 * 86400)));
  ok(near(await at(now() - 86400), -300), 'and a node a day behind by five minutes at most');
  ok(near(await at(null), 0), 'a node that does not answer leaves the device’s clock');
}

console.log('\na name in a link');
{
  const many = Array(301).fill('a').join('.') + '.eth';
  ok(T.nameOk('z.eth') && T.nameOk('alice.wei') && T.nameOk('x.gwei') && T.nameOk('a.b.c.d.e.f.g.eth'), 'ordinary names, and up to eight labels, are read');
  ok(!T.nameOk('a.b.c.d.e.f.g.h.eth') && !T.nameOk(many), 'nine labels, or three hundred, are not');
  ok(!T.nameOk('name.base.eth') && !T.nameOk('Alice.eth') && !T.nameOk('a b.eth'), 'and the other refusals are as they were');
}

console.log('\na token its own contract names');
{
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', FAKE = '0x' + '77'.repeat(20);
  const listed = { chainId: 1, addr: USDC, sym: 'USDC', name: 'USD Coin', dec: 6, logo: '' }, fake = { chainId: 1, addr: FAKE, sym: 'USDC', name: 'USD Coin', dec: 6, logo: '', added: true };
  ok(T.tokIcon(listed) === 'POOL:USDC', 'a listed token gets its own mark');
  ok(T.tokIcon(fake) !== 'POOL:USDC' && /data-l="U"/.test(T.tokIcon(fake)), 'one only added by its address does not: it gets the plain lettered mark', T.tokIcon(fake).slice(0, 60));
  ok(T.tokIcon({ into: 'eth' }) === 'PETH' && T.tokIcon({ addr: '0x' + '0'.repeat(40), sym: 'ETH' }) === 'ETH', 'ETH and the private balances are as they were');
  const pool = { sym: 'USDC', token: USDC.toLowerCase() };
  T.setPools([pool]);
  const c = { chainId: 1 };
  ok(T.hubInto(c, { addr: '0x' + '55'.repeat(20), sym: 'DAI' }) === pool, 'a listed dollar goes into the dollar pool');
  ok(T.hubInto(c, fake) === null, 'one added by its address goes into ETH, whatever symbol it reports');
  ok(T.hubFrom(c, { addr: '0x' + '55'.repeat(20), sym: 'DAI' }) === pool, 'a listed dollar is taken out of the dollar pool');
  ok(T.hubFrom(c, fake) === null, 'one added by its address is taken out of the ETH balance');
}

console.log('\nMax on an amount that shows on chain');
{
  const fill = (v, ...rest) => { const amt = { value: 'x', dispatchEvent() {} }; T.toasts.length = 0; T.maxPublic(amt, v, 'private', ...rest); return { value: amt.value, toast: T.toasts[0] || '' }; };
  const usdc = (x) => T.unitsAll(x, 6);
  let r = fill(1234419743n, usdc, 'USDC');
  ok(r.value === '1200' && r.toast === 'Max rounds down to 1200 USDC. The rest stays private.', 'a token pool\u2019s Max is cut to two significant digits, and says so', `${r.value} | ${r.toast}`);
  r = fill(1234500000000000000n);
  ok(r.value === 'P1200000000000000000' && /^Max rounds down to P1200000000000000000 ETH/.test(r.toast), 'ETH is as it was', `${r.value} | ${r.toast}`);
  r = fill(42n, usdc, 'USDC');
  ok(r.value === '0.000042' && r.toast === '', 'an amount already short is left whole, with nothing said', `${r.value} | ${r.toast}`);
  r = fill(0n, usdc, 'USDC');
  ok(r.value === '' && r.toast === '', 'and nothing to take leaves the field empty', `${r.value} | ${r.toast}`);
  ok(T.coarse(1234419743n) === 1200000000n && T.coarse(999n) === 990n && T.coarse(100n) === 100n, 'rounded down, never up', `${T.coarse(1234419743n)} ${T.coarse(999n)} ${T.coarse(100n)}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
