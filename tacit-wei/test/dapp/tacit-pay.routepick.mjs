/* The route the page takes for a swap (swapRoute: ETH into a token, for a withdrawal that arrives as one) and for a shield
   from a token (shieldRoute: exactly an amount of ETH, bought with the token), no network: the nodes are stand-ins that all
   give the same zQuoter reply. Replies zQuoter gave for listed tokens (vectors/zquoter-routes.json) are taken, with the
   recipient written in. A reply that two nodes agree on is still read leg by leg: one whose legs pay another address, or
   whose minimums come to less than the floor shown, is not taken.
   The page's own functions are taken out of dapp/page.html as it ships.

   Usage: node test/dapp/tacit-pay.routepick.mjs                                                                    */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mod} from './page-config.mjs';

const {AbiCoder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

// A top-level declaration of the page's module by name: a function to its closing brace, a const to the end of its statement.
const piece = (name) => {
  const fn = new RegExp(`^(async )?function ${name}\\(`, 'm').exec(mod), cn = new RegExp(`^const ${name} = `, 'm').exec(mod);
  const m = fn || cn;
  if (!m) throw new Error('page layout changed: ' + name);
  const a = m.index;
  if (fn) return mod.slice(a, mod.indexOf('\n}\n', a) + 2);
  for (let i = a, depth = 0, q = null; i < mod.length; i++) {
    const ch = mod[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) return mod.slice(a, i + 1);
  }
  throw new Error('page layout changed: ' + name);
};
const engineEnd = mod.indexOf('\n}\n', mod.indexOf('function makePoolWallet(')) + 3;
const names = ['qA', 'routeOf', 'swapRoute', 'routePays', 'HUBS', 'LEGS', 'routeLegsOk', 'shieldLegsOk', 'withDest', 'shieldRoute'];
const body = `${mod.slice(0, engineEnd)}
const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4', HEAVY = {}, T_TRANSFER = '0x';
export const T = { reply: null, asked: [] };
const chainNow = async () => 1_900_000_000, headAt = async () => 100, headNodes = () => [], vetted = () => () => true, ownNodes = () => ['a', 'b', 'c'];
const gasPriceOf = async () => null, routeGas = async (c, r) => ({ ...r, gas: 600_000 });
const anyNode = async () => { throw new Error('no node answered'); };
const quorum = async (to, data) => { T.asked.push(data.slice(2, 10)); const r = T.reply(data.slice(2)); if (!r) throw Object.assign(new Error('no answer'), { seen: ['0x'] }); return r; };
${names.map((n) => piece(n).replace(/\bheadOf\(/g, 'headAt(')).join('\n')}
export { ${names.filter((n) => n !== 'qA').join(', ')}, qA, qU };
`;
const file = path.join(os.tmpdir(), `tacit-pay-routepick-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.mjs`);
fs.writeFileSync(file, body);
const P = await import(file), {T} = P;
const V = JSON.parse(fs.readFileSync(new URL('./vectors/zquoter-routes.json', import.meta.url), 'utf8'));

const coder = AbiCoder.defaultAbiCoder(), Q = '(uint8,uint256,uint256,uint256)';
const W = (x) => BigInt(x).toString(16).padStart(64, '0'), A = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const multicall = (calls) => '0xac9650d8' + coder.encode(['bytes[]'], [calls.map((x) => '0x' + x)]).slice(2);
// The request's own random addresses: `stand` (the recipient), and `back` (where leftovers go) for the request that names two.
const standOf = (d) => d.slice(8 + 24, 8 + 64), backOf = (d) => d.slice(8 + 64 + 24, 8 + 128);
// A reply as zQuoter shapes it: (quote: source, fee, amount in, amount out), the router call, its limit, the ETH it takes.
const reply = (q, data, limit, value) => coder.encode([Q, 'bytes', 'uint256', 'uint256'], [q, data, limit, value]);
const DEST = '0x' + '5e'.repeat(20), OTHER = 'ab'.repeat(20), REFUND = '0x' + 'b0'.repeat(20), WETH = 'c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

console.log('ETH into a token: replies zQuoter gave, the same from every node');
for (const v of V.swap) {
  T.reply = (d) => (d.startsWith(v.sel) ? v.reply.split(v.stand).join(standOf(d)) : null);
  const r = await P.swapRoute({chainId: 1}, {addr: v.addr, sym: v.sym, dec: v.dec}, BigInt(v.amount), 50n, DEST);
  ok(r && r.data.includes(DEST.slice(2)) && r.stand === null && r.limit > 0n && r.value === BigInt(v.amount), `${v.sym}: the route is taken, paying the address given`, r ? `at least ${r.limit}` : 'none');
}

console.log('\nETH into a token: a reply every node agrees on, read leg by leg');
{
  const v = V.swap[0], t = {addr: v.addr, sym: v.sym, dec: v.dec}, amount = BigInt(v.amount), out = 16_638_753n;
  // A swap leg (V2: to, exact-out, in, out, amount, least out, deadline) paying another address, then an empty sweep of WETH to
  // the recipient, so the recipient is in the call.
  const away = (d) => reply([4, 5, amount, out], multicall(['6e0a4f98' + A(OTHER) + W(0) + A('0x0') + A(v.addr) + W(amount) + W(out) + W(2n ** 40n), 'cb019b84' + A(WETH) + W(0) + W(0) + A(standOf(d))]), out, amount);
  T.reply = (d) => (d.startsWith('e7798987') ? away(d) : null);
  const r1 = await P.swapRoute({chainId: 1}, t, amount, 50n, DEST);
  ok(r1 === null, 'a route whose swap pays another address is not taken', r1 ? 'taken' : 'none');
  // The leg pays the recipient, but holds the swap to far less than the floor the reply states.
  const low = (d) => reply([4, 5, amount, out], '0x6e0a4f98' + A(standOf(d)) + W(0) + A('0x0') + A(v.addr) + W(amount) + W(1) + W(2n ** 40n), out, amount);
  T.reply = (d) => (d.startsWith('e7798987') ? low(d) : null);
  const r2 = await P.swapRoute({chainId: 1}, t, amount, 50n, DEST);
  ok(r2 === null, 'a route whose least out comes to less than the floor shown is not taken', r2 ? `taken, at least ${r2.limit}` : 'none');
  // The same leg with its least out at the floor is taken.
  const fair = (d) => reply([4, 5, amount, out], '0x6e0a4f98' + A(standOf(d)) + W(0) + A('0x0') + A(v.addr) + W(amount) + W(out * 9950n / 10000n) + W(2n ** 40n), out, amount);
  T.reply = (d) => (d.startsWith('e7798987') ? fair(d) : null);
  const r3 = await P.swapRoute({chainId: 1}, t, amount, 50n, DEST);
  ok(r3 && r3.data.includes(DEST.slice(2)), 'the same leg, held to the floor and paying the recipient, is taken', r3 ? `at least ${r3.limit}` : 'none');
}

console.log('\na token into exactly an amount of ETH: replies zQuoter gave, the same from every node');
for (const v of V.shield) {
  T.reply = (d) => (d.startsWith(v.sel) ? v.reply.split(v.stand).join(standOf(d)).split(v.back).join(backOf(d)) : null);
  const box = '0x' + 'd0'.repeat(20);
  const r = await P.shieldRoute({chainId: 1}, {addr: v.addr, sym: v.sym, dec: v.dec}, BigInt(v.amount), 50n, box, REFUND);
  ok(r && r.data.includes(box.slice(2)) && r.limit >= r.inp && r.value === 0n, `${v.sym}: the route is taken, paying the address given`, r ? `at most ${r.limit}` : 'none');
}

console.log('\na token into exactly an amount of ETH: a reply every node agrees on, read leg by leg');
{
  const v = V.shield[0], t = {addr: v.addr, sym: v.sym, dec: v.dec}, amount = BigInt(v.amount), inp = 16_638_553n, limit = inp * 10050n / 10000n;
  // V3 (to, exact-out, fee, in, out, amount, most in, deadline)
  const v3 = (to, amt) => 'afeae12b' + A(to) + W(1) + W(500) + A(v.addr) + A('0x0') + W(amt) + W(limit) + W(2n ** 40n);
  const sweepEth = (to) => 'cb019b84' + A('0x0') + W(0) + W(0) + A(to);
  const cases = [
    ['a route whose swap pays the ETH to another address', (d) => multicall([v3(OTHER, amount), sweepEth(standOf(d))])],
    ['a route that buys less ETH than asked', (d) => '0x' + v3(standOf(d), amount / 2n)],
    ['a route that sweeps what is left to another address', (d) => multicall([v3(standOf(d), amount), 'cb019b84' + A(v.addr) + W(0) + W(0) + A(OTHER)])],
  ];
  for (const [what, data] of cases) {
    T.reply = (d) => (d.startsWith('e7798987') ? reply([3, 1, inp, amount], data(d), limit, 0n) : null);
    const r = await P.shieldRoute({chainId: 1}, t, amount, 50n, '0x' + 'd0'.repeat(20), REFUND);
    ok(r === null, `${what} is not taken`, r ? 'taken' : 'none');
  }
  T.reply = (d) => (d.startsWith('e7798987') ? reply([3, 1, inp, amount], '0x' + v3(standOf(d), amount), limit, 0n) : null);
  const r = await P.shieldRoute({chainId: 1}, t, amount, 50n, '0x' + 'd0'.repeat(20), REFUND);
  ok(r && r.data.includes('d0'.repeat(20)), 'the same swap paying the recipient exactly the amount is taken', r ? 'taken' : 'none');
}

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
