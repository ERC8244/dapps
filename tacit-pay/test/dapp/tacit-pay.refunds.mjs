/* Where an escrow's unused part comes back: the refund boxes (from 2^20), no browser. The engine finds a refund only within
   the gap past the last refund box its history used, so the page must hand them out within it; and a refund below the
   relay's minimum is never moved in by the relay, so the page must read what waits at them, as it reads the one-time
   addresses, and offer to take it in. A send into someone's pool in another coin pays its leftovers to such a box, which
   passes on only its own pool's coin: it takes the single best route only, never one that sweeps a middle token there.
   The engine and the page's own functions are taken out of dapp/page.html as it ships.

   Usage: node test/dapp/tacit-pay.refunds.mjs                                                                       */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkNode, mkWallet, sweepTo, depositTo} from './engine-mock.mjs';
import {mod} from './page-config.mjs';

const {AbiCoder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n, R0 = 1 << 20;

// A top-level declaration of the page's module by name: a function to its closing brace, a const to the end of its statement.
const piece = (name) => {
  const fn = new RegExp(`^(async )?function ${name}\\(`, 'm').exec(mod), cn = new RegExp(`^const ${name} = `, 'm').exec(mod);
  const m = fn || cn;
  if (!m) return null;
  const a = m.index;
  if (fn) return mod.slice(a, mod.indexOf('\n}\n', a) + 2);
  for (let i = a, depth = 0; i < mod.length; i++) {
    const ch = mod[i];
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) return mod.slice(a, i + 1);
  }
  throw new Error('page layout changed: ' + name);
};
// The engine part (as engine-mock takes it) and the page's functions named, in a module of their own over stubs the test sets.
const engineEnd = mod.indexOf('\n}\n', mod.indexOf('function makePoolWallet(')) + 3;
const names = ['boxes', 'boxIndexes', 'paidBox', 'boxList', 'checkBoxes', 'refundsAt', 'refundBox', 'refundIdx', 'withDest', 'routeOf', 'qA', 'qU', 'shieldRoute'];
const parts = names.map((n) => [n, piece(n)]).filter(([, s]) => s);
const body = `${mod.slice(0, engineEnd)}
const REFUND_GAP_PAGE = 20, BOX_DAY = 86_400_000, ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', BOXQ = {};
export const T = { vault: new Map(), reads: [], bal: {}, asked: [], quorum: null, S: { key: { pool: {} } }, CH: {}, W: null, PW: null };
const S = T.S, CH = T.CH, CHAINS = [{ chainId: 1, full: 'Ethereum' }];
const vget = (n) => (T.vault.has(n) ? JSON.parse(T.vault.get(n)) : null), vset = (n, v) => { T.vault.set(n, JSON.stringify(v)); };
const walletOn = () => T.W, poolWallet = () => T.PW, watchBox = () => Promise.resolve(true), paint = () => {};
const oneNode = async (c, method, params) => { const a = method === 'eth_getBalance' ? params[0] : params[0].to; T.reads.push(a); return '0x' + (T.bal[a] ?? 0n).toString(16); };
const chainNow = async () => 1_900_000_000, headAt = async () => 100, headNodes = () => [], vetted = () => () => true, ownNodes = () => ['a', 'b'];
const nap = () => Promise.resolve();
const quorum = (to, data, ...rest) => { T.asked.push(data.slice(2, 10)); return T.quorum(to, data, ...rest); };
${parts.map(([, s]) => s.replace(/\bawait sleep\(/g, 'await nap(').replace(/\bheadOf\(/g, 'headAt(')).join('\n')}
export { ${parts.map(([n]) => n).join(', ')} };
`;
const file = path.join(os.tmpdir(), `tacit-pay-refunds-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.mjs`);
fs.writeFileSync(file, body);
const P = await import(file), {T} = P;

console.log('a token pool reads refunds in a range of its own');
{
  const RB = R0 + 3733 * 65536, node = mkNode(), {W, keys} = mkWallet(node, {refundBase: RB});
  depositTo(node, keys, E / 10n, 101); sweepTo(node, keys, RB + 5, E / 4n, 110); node.tip = 130;
  const a = await W.sync();
  ok(a.balance === E / 10n + E / 4n && W.nextRefundBox() === RB + 6 && W.refundBase === RB, 'its refund is found, and its next refund box follows it in its own range', `${a.balance} · next ${W.nextRefundBox() - RB}`);
  const node2 = mkNode(), w2 = mkWallet(node2, {refundBase: RB});
  depositTo(node2, w2.keys, E / 10n, 101); sweepTo(node2, w2.keys, R0 + 5, E / 4n, 110); node2.tip = 130;
  const b = await w2.W.sync();
  ok(b.balance === E / 10n && w2.W.nextRefundBox() === RB, 'and a refund at the ETH pool’s range is not one of its own', `${b.balance}`);
}

console.log('the engine reads refund boxes only within the gap past the last one used');
{
  const node = mkNode(), {W, keys} = mkWallet(node);
  depositTo(node, keys, E / 10n, 101); sweepTo(node, keys, R0 + 19, E / 4n, 110); node.tip = 130;
  const a = await W.sync();
  ok(a.balance === E / 10n + E / 4n && W.nextRefundBox() === R0 + 20, 'a refund at the 20th refund box is found', `${a.balance} · next ${W.nextRefundBox() - R0}`);
  const node2 = mkNode(), w2 = mkWallet(node2);
  depositTo(node2, w2.keys, E / 10n, 101); sweepTo(node2, w2.keys, R0 + 20, E / 4n, 110); node2.tip = 130;
  const b = await w2.W.sync();
  ok(b.balance === E / 10n, 'one at the 21st, with none used before it, is not: so none may be handed out past the gap', `${b.balance}`);
}

console.log('\nthe page hands out refund boxes within that gap');
{
  T.vault.clear();
  let used = 0;
  T.W = { nextRefundBox: () => R0 + used, receiveBox: (i) => `0x${i.toString(16).padStart(40, '0')}`, boxSpan: () => 21, nextBox: () => 1, watch: async () => ({status: 200}) };
  T.PW = T.W;
  const got = Array.from({length: 45}, () => Number(BigInt(P.refundBox({chainId: 1}))));
  ok(got.slice(0, 20).every((x, j) => x === R0 + j), 'the first twenty are fresh, one after another', got.slice(0, 3).map((x) => x - R0).join() + '…');
  ok(got.every((x) => x >= R0 + used && x < R0 + used + 20), 'none of 45 lies past the gap the key reads again', `highest ${Math.max(...got) - R0}`);
  used = 7;
  const next = Number(BigInt(P.refundBox({chainId: 1})));
  ok(next >= R0 + 7 && next < R0 + 27, 'once the history has used seven, the next is within the gap past them', `${next - R0}`);
}

console.log('\nwhat waits at a refund box is read, shown and not taken for a one-time address');
{
  T.vault.clear(); T.reads.length = 0;
  for (const k of Object.keys(T.bal)) delete T.bal[k];
  T.S.key = {pool: {}};
  const W = {nextRefundBox: () => R0, receiveBox: (i) => `0x${i.toString(16).padStart(40, '0')}`, boxSpan: () => 21, nextBox: () => 1, watch: async () => ({status: 200})};
  T.W = T.PW = W; T.CH[1] = {W};
  const c = {chainId: 1};
  P.refundBox(c); P.refundBox(c);   // two escrows' refunds handed out here
  const box = W.receiveBox(R0 + 1);
  T.bal[box] = 3n * 10n ** 14n;      // 0.0003 ETH came back, under the relay's minimum, so the relay leaves it there
  await P.checkBoxes(c, true);
  ok(T.reads.includes(box), 'a full read ("Check for arrivals", and once a day) reads the refund boxes too', `${T.reads.length} addresses read`);
  ok((T.CH[1].boxW?.[R0 + 1] ?? 0n) === 3n * 10n ** 14n, 'and keeps what waits there, which the balance and Shield’s list then show');
  const rows = P.boxList(T.CH[1]);
  ok(rows.some((r) => r.i === R0 + 1 && r.label), 'it is listed with a name of its own, to be taken in', JSON.stringify(rows.map((r) => [r.i - R0, r.label])));
  ok(P.paidBox() === 0, 'and does not count as a one-time address paid (which would hold back every new one)', `${P.paidBox()}`);
  T.reads.length = 0; delete T.CH[1].boxW; delete T.bal[box];
  const vault = JSON.parse(T.vault.get('boxday') || '{}');
  T.vault.set('boxday', JSON.stringify({...vault, 1: Date.now()}));
  for (let i = 0; i < 4; i++) await P.checkBoxes(c);
  ok(T.reads.includes(box) && T.reads.includes(W.receiveBox(R0)), 'between full reads, the ones handed out here are read in turn with the one-time addresses', `${T.reads.length} reads`);
}

console.log('\na send into a pool in another coin takes the single best route only');
{
  // zQuoter as it answers for a pair with no pool of its own (USDT into wstETH on Ethereum, 2026-10-26): no single route,
  // and a route through WETH that sweeps the WETH it does not use to the refund address it is given.
  const Q = '(uint8,uint256,uint256,uint256)', coder = AbiCoder.defaultAbiCoder();
  T.asked.length = 0;
  T.quorum = async (to, data) => {
    const sel = data.slice(2, 10);
    if (sel === 'e7798987') throw Object.assign(new Error('Could not confirm that just now.'), {seen: ['0x']});
    const me = data.slice(10 + 24, 10 + 64), you = data.slice(74 + 24, 74 + 64);
    const sweep = (tok, to) => '0xcb019b84' + tok.padStart(64, '0') + '0'.repeat(64) + '0'.repeat(64) + to.padStart(64, '0');
    const mc = '0xac9650d8' + coder.encode(['bytes[]'], [[sweep('7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', me), sweep('c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', you)]]).slice(2);
    return coder.encode([Q, Q, 'bytes[]', 'bytes', 'uint256'], [[3, 1, 290651283n, 125026775350825661n], [3, 1, 124714987881122853n, 10n ** 17n], [], mc, 0n]);
  };
  const USDT = {addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', sym: 'USDT', dec: 6}, WST = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
  const box = '0x' + 'd0'.repeat(20), back = '0x' + 'b0'.repeat(20);
  const open = await P.shieldRoute({chainId: 1}, USDT, 10n ** 17n, 50n, box, back, WST);
  ok(open && open.data.includes('b0'.repeat(20)), 'asked for any route, the one through WETH sweeps its leftover WETH to the refund address', open ? 'a route' : 'none');
  T.asked.length = 0;
  const one = await P.shieldRoute({chainId: 1}, USDT, 10n ** 17n, 50n, box, back, WST, true);
  ok(one === null && T.asked.every((s) => s === 'e7798987'), 'asked for the single best route only, there is none: nothing is sent', `asked ${T.asked.join()}`);
  const send = /function formSendX[\s\S]*?\n}\n/.exec(mod)?.[0] || '';
  const calls = [...send.matchAll(/shieldRoute\(([^)]*)\)/g)].map((m) => m[1]);
  ok(calls.length === 2 && calls.every((a) => /, true$/.test(a.trim())), 'Send into a pool in another coin asks for it both when it quotes and when it sends', calls.join(' | '));
}

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
