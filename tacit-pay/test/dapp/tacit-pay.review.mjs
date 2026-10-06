/* Cases from the release review of the page, each taken out of dapp/page.html as it ships and run with concrete values, no
   browser and no network: two tabs of one browser and the hold on a payment, a destination that could not be read, an
   escrow the pool paid whose row has no recipient yet, a payment held while the wallet cannot be asked, and what a message
   says. The browser cases are in tacit-pay.review-ui.mjs.

   Usage: node test/dapp/tacit-pay.review.mjs                                                                         */
import vm from 'node:vm';
import {mkWorld, depositTo, lib} from './engine-mock.mjs';
import {cut, config} from './page-config.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== '' && !c ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n;

// A clock that moves by the length of every sleep, so the five-minute write interval passes at once.
const realNow = Date.now.bind(Date), realSet = globalThis.setTimeout;
let skew = 0;
Date.now = () => realNow() + skew;
globalThis.setTimeout = (f, ms, ...a) => { skew += Number(ms) || 0; return realSet(f, 0, ...a); };
const skewBy = (ms) => { skew += ms; };

const {makePoolWallet, poolKeys} = lib, {RELAYERS} = config;
const POOL = '0x000000c2A20657CE25f2Ba99737933D031AFBEE9', ROUTER = '0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5', KEEPER = 'http://relay.test/evm-pool/keeper';
const mkStore = () => { const m = new Map(); return {get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); return true; }, del: (k) => { m.delete(k); }}; };
const prove = async (input) => ({proof: {pi_a: ['1', '2'], pi_b: [['1', '2'], ['3', '4']], pi_c: ['5', '6']}, publicSignals: [input.root, input.oldRoot, input.newRoot, input.startIndex, input.publicAmount, input.extDataHash, input.asset, input.nf[0], input.nf[1], input.outLeaf[0], input.outLeaf[1]].map(String)});
const tab = (node, key, store, signer = null) => {
  const keys = poolKeys(key), base = node.rpc;
  const rpc = async (m, p) => (m === 'eth_call' && p[0].to.toLowerCase() === POOL.toLowerCase() && p[0].data.length > 1000 ? '0x' : base(m, p));
  rpc.batch = base.batch;
  return {keys, W: makePoolWallet({chain: {chainId: 1, pool: POOL, router: ROUTER, rpc, deployBlock: 100, confirmations: 3, keeper: KEEPER}, keys, prove, store, signer, feed: false, proofMs: () => 0})};
};
// A relay that lands a proof at once ('apply'), or answers with a hash and never sends it ('hold').
const relayUp = (apply) => {
  const relay = {mode: 'apply', held: []};
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^.*\/keeper/, ''), body = init.body ? JSON.parse(init.body) : null;
    const rsp = (status, j) => ({status, ok: status < 300, headers: new Headers(), json: async () => j});
    if (path === '/quote') return rsp(200, {chainId: 1, pool: POOL, relayer: RELAYERS[1], fee: '1000000000000', gas: '450000'});
    if (path === '/relay') {
      if (relay.mode === 'hold') { relay.held.push(body.tx); return rsp(200, {txHash: '0x' + 'cd'.repeat(32)}); }
      const r = apply(body.tx);
      return r.revert ? rsp(409, {error: r.revert, stale: true}) : rsp(200, {txHash: r.h});
    }
    return rsp(path === '/cancel' ? 200 : 404, {});
  };
  return relay;
};
const PAYEE = (() => { const R = poolKeys(new Uint8Array(32).fill(5)); return {V: R.V, A: R.A, N: R.N, raw: R.raw}; })();
const KEY = new Uint8Array(32).fill(9), FEE = 1_000_000_000_000n;
const opened = (node, store) => tab(node, KEY, store);

console.log('two tabs of one browser share one slot of storage');
{
  const {node, relayed} = mkWorld(), store = mkStore(), relay = relayUp(relayed);
  const A = tab(node, KEY, store);
  depositTo(node, A.keys, E, 105); depositTo(node, A.keys, 3n * E / 10n, 106); node.tip = 130;
  await A.W.sync();
  const B = tab(node, KEY, store);                       // open since before the payment, and idle
  await B.W.sync();
  relay.mode = 'hold';
  await A.W.send({to: PAYEE, amount: E / 10n, via: null, expectFee: FEE}).catch(() => {});
  ok(A.W.inflight().length === 1 && opened(node, store).W.inflight().length === 1, 'a payment the relay holds is a hold in a tab opened after it');
  skewBy(301_000); node.tip += 30;
  await B.W.sync();                                       // the idle tab reads a new block and writes its state five minutes on
  ok(opened(node, store).W.inflight().length === 1, 'the idle tab\'s write does not drop it', `${opened(node, store).W.inflight().length} hold(s)`);
  const held = opened(node, store).W.notes().length;
  ok(held === 1, 'and the notes it holds are not spendable there', `${held} spendable note(s)`);
}
{
  const {node, relayed} = mkWorld(), store = mkStore(), relay = relayUp(relayed);
  const A = tab(node, KEY, store);
  depositTo(node, A.keys, E, 105); depositTo(node, A.keys, 3n * E / 10n, 106); depositTo(node, A.keys, 2n * E / 10n, 107); node.tip = 130;
  await A.W.sync();
  const B = tab(node, KEY, store);
  await B.W.sync();
  await A.W.send({to: PAYEE, amount: 25n * E / 100n, via: null, expectFee: FEE});   // lands at once: remembered for an hour
  skewBy(301_000); node.tip += 30;
  await B.W.sync();
  const C = opened(node, store);
  await C.W.sync();
  const e = await C.W.send({to: PAYEE, amount: 25n * E / 100n, via: null, expectFee: FEE}).catch((x) => x);
  ok(e?.duplicate === true, 'the same payment pressed again in another tab is asked about first', e?.message || 'it was paid again');
}

console.log('\nholds made again on the same notes, and holds taken back');
{
  const sleep = (ms) => new Promise((r) => realSet(r, ms)), DEST = '0x' + '77'.repeat(20);
  const landedOf = (node, a) => node.logs.filter((l) => l.address.toLowerCase() === POOL.toLowerCase() && BigInt.asIntN(256, BigInt('0x' + l.data.slice(2 + 64 * 5, 2 + 64 * 6))) === -a).length;
  {
    const {node, relayed} = mkWorld(), store = mkStore(), relay = relayUp(relayed);
    const T1 = tab(node, KEY, store);
    depositTo(node, T1.keys, 3n * E / 10n, 105); node.tip = 130;
    await T1.W.sync();
    const T2 = tab(node, KEY, store); await T2.W.sync();
    relay.mode = 'hold';
    await T1.W.withdraw({to: DEST, amount: E / 10n, via: null, expectFee: FEE}).catch(() => {});
    depositTo(node, poolKeys(new Uint8Array(32).fill(3)), E / 100n, 131); node.tip = 140;     // another payment lands: the held proof's slot is gone
    await T1.W.sync(); await T2.W.sync();
    ok(T1.W.inflight().length === 0 && T2.W.inflight().length === 0, 'a dead hold ends in both tabs');
    relay.held.length = 0;
    await T2.W.withdraw({to: DEST, amount: E / 10n, via: null, expectFee: FEE}).catch(() => {});   // the same payment again: a new hold, the same notes
    const e = await T1.W.withdraw({to: DEST, amount: E / 10n, via: null, expectFee: FEE}).then(() => null, (x) => x);
    ok(e?.hold === true, 'the other tab sees the new hold on the same notes and does not pay it again', e ? e.message.slice(0, 70) : 'it was paid a second time');
    for (const tx of relay.held.splice(0)) relayed(tx);
    node.tip += 10;
    ok(landedOf(node, E / 10n) <= 1, 'and the amount lands at most once', `${landedOf(node, E / 10n)} time(s)`);
  }
  {
    const {node} = mkWorld(), store = mkStore();
    let reject;
    const gate = new Promise((_, rej) => { reject = rej; });
    const T2 = tab(node, KEY, store, {address: '0x' + '22'.repeat(20), ready: async () => {}, send: () => gate});
    depositTo(node, T2.keys, 3n * E / 10n, 105); node.tip = 130;
    await T2.W.sync();
    const T1 = tab(node, KEY, store); await T1.W.sync();
    relayUp(() => ({revert: 'x'}));
    const pay = T2.W.withdraw({to: DEST, amount: E / 10n, via: 'self', expectFee: null}).catch((x) => x);
    await sleep(300);
    const e1 = await T1.W.withdraw({to: DEST, amount: E / 10n, via: null, expectFee: FEE}).then(() => null, (x) => x);
    ok(e1?.hold === true, 'a hold handed to the wallet in one tab is joined by the other');
    skewBy(301_000); node.tip += 6;
    reject(Object.assign(new Error('User rejected'), {code: 4001}));
    await pay; await sleep(50);
    await T1.W.sync(); skewBy(301_000); node.tip += 6; await T1.W.sync();
    const T3 = tab(node, KEY, store); await T3.W.sync();
    ok(T2.W.inflight().length === 0 && T1.W.inflight().length === 0 && T3.W.inflight().length === 0, 'when the wallet refuses, no tab keeps or writes back the hold', `T1 ${T1.W.inflight().length} T2 ${T2.W.inflight().length} T3 ${T3.W.inflight().length}`);
  }
}

console.log('\na destination whose code could not be read');
{
  const code = cut('const CODES = new Map()', '// The receipt');
  const mk = (reads) => new Function('ownNodes', 'rpcAt', 'S', 'walletRead', 'lc', 'REQ', 'FORM', 'CHAINS', `${code}\nreturn { destGate, destNote };`)(
    () => ['n1', 'n2'], () => async (m, p) => reads(p[0]), {account: null, key: null}, async () => { throw new Error('no wallet'); }, (x) => String(x).toLowerCase(), {v: null}, {}, [{chainId: 1}, {chainId: 8453}]);
  const BASE = {chainId: 8453, full: 'Base'}, SAFE = '0x' + '5a'.repeat(20);
  const down = mk(async () => { throw new Error('rate limited'); });
  const e1 = await down.destGate(BASE, SAFE).then(() => null, (e) => e);
  ok(/Could not check that address on Base/.test(e1?.message || ''), 'with every node failing, the withdrawal is not sent unchecked', e1?.message || 'it went ahead');
  const live = mk(async (a) => (a === SAFE ? '0x6080' : '0x'));
  const e2 = await live.destGate(BASE, SAFE).then(() => null, (e) => e);
  ok(/contract on Base/.test(e2?.message || ''), 'with the code read, a contract still asks "It takes ETH"', e2?.message || 'it went ahead');
  const e3 = await live.destGate(BASE, '0x' + '11'.repeat(20)).then(() => null, (e) => e);
  ok(e3 === null, 'and an account goes ahead');
  // Ethereum cannot be read, the rollup can (the lab forks one chain only): an account on the rollup goes ahead, a contract there still asks.
  const split = (reads) => new Function('ownNodes', 'rpcAt', 'S', 'walletRead', 'lc', 'REQ', 'FORM', 'CHAINS', `${code}\nreturn { destGate };`)(
    (c) => [c.chainId === 1 ? 'eth' : 'l2'], (u) => async (m, p) => reads(u, p[0]), {account: null, key: null}, async () => { throw new Error('no wallet'); }, (x) => String(x).toLowerCase(), {v: null}, {}, [{chainId: 1}, {chainId: 8453}]);
  const l2only = split(async (u, a) => { if (u === 'eth') throw new Error('ethereum down'); return a === SAFE ? '0x6080' : '0x'; });
  const e4 = await l2only.destGate(BASE, '0x' + '11'.repeat(20)).then(() => null, (e) => e);
  ok(e4 === null, 'with only Ethereum unreadable, an account on the rollup goes ahead', e4?.message || '');
  const e5 = await l2only.destGate(BASE, SAFE).then(() => null, (e) => e);
  ok(/contract on Base/.test(e5?.message || ''), 'and a contract on the rollup still asks', e5?.message || 'it went ahead');
  const l1safe = split(async (u, a) => (u === 'eth' && a === SAFE ? '0x6080' : '0x'));
  const e6 = await l1safe.destGate(BASE, SAFE).then(() => null, (e) => e);
  ok(/contract on Ethereum with nothing on Base/.test(e6?.message || ''), 'with Ethereum readable, a contract there and nothing here still asks', e6?.message || 'it went ahead');
}

console.log('\nan escrow the pool paid without running its calls');
{
  const code = cut('function escrowsLeft(c) {', '// Runs an escrow\'s calls from the wallet');
  const vault = {};
  const intent = (deadline) => ({deadline: String(deadline), refund: '0x' + '22'.repeat(20)});
  const mk = (rows, landed, balance) => {
    const saved = {escrows: {['0x' + 'ee'.repeat(20)]: {c: 1, intent: intent(Math.floor(Date.now() / 1000) - 3 * 86400), label: 'Swap for USDC'}}};
    const S = {key: true, busy: false}, CH = {1: {W: {history: () => rows, inflight: () => [], landed: () => landed}}}, ESCQ = {};
    const f = new Function('S', 'CH', 'ESCQ', 'vget', 'vset', 'lc', 'oneNode', 'paintBal', `${code}\nreturn escrowsLeft;`)(
      S, CH, ESCQ, (n) => saved[n], (n, v) => { saved[n] = v; }, (x) => String(x).toLowerCase(), async () => balance, () => {});
    return {f, saved, ESCQ};
  };
  const c = {chainId: 1};
  // The row the relay's index gave has no recipient yet: the escrow is not in `paid`, three days past its deadline.
  const a = mk([{tx: '0xaa', block: 5, used: '1', kept: '0'}], [], 10n ** 18n);
  a.f(c); await new Promise((r) => realSet(r, 20)); const out = a.f(c);
  ok(Object.keys(a.saved.escrows).length === 1, 'its record is kept while the escrow holds ETH', `${Object.keys(a.saved.escrows).length} record(s)`);
  ok(out.length === 1 && out[0].v === 10n ** 18n, 'and it is offered to be finished or sent on', JSON.stringify(out.map((x) => String(x.v))));
  // One that is empty is forgotten, after two reads of nothing.
  const b = mk([], [], 0n);
  b.f(c); await new Promise((r) => realSet(r, 20));
  ok(Object.keys(b.saved.escrows).length === 1, 'a first read of nothing does not drop a record');
  skewBy(61_000); b.f(c); await new Promise((r) => realSet(r, 20));
  ok(Object.keys(b.saved.escrows).length === 0, 'a second read of nothing does');
}

console.log('\n"It was dropped: pay again" with a wallet that cannot be asked');
{
  const code = cut('async function sentState(', '// Another action that went through says nothing of a held payment');
  const wire = cut('const sentWire = (again) =>', 'const RMIN = {}');
  const mk = (provider) => {
    const log = {toasts: [], cleared: 0, again: 0, ready: 0};
    const S = {sent: {h: '0x' + 'ab'.repeat(32), c: {chainId: 1, full: 'Ethereum'}, nonce: 4, from: '0xf'}, provider};
    const btn = {hasAttribute: () => false, addEventListener: null};
    let click = null;
    const $ = () => ({addEventListener: (ev, f) => { click = f; }});
    const busy = async (b, fn) => fn();
    const f = new Function('S', 'walletRead', 'toast', 'setSent', 'heldPlans', 'paintBal', '$', 'busy', 'again', 'walletReady', 'warn', `${code}\n${wire}\nsentWire(again);\nreturn sentState;`)(
      S, async () => { throw new Error('no wallet'); }, (m) => log.toasts.push(m), () => { log.cleared++; S.sent = null; }, () => {}, () => {}, $, busy, () => { log.again++; }, async () => { log.ready++; }, () => {});
    return {S, log, press: () => click({currentTarget: btn})};
  };
  const t = mk(null);
  await t.press();
  ok(t.log.cleared === 0 && t.S.sent && /Connect your wallet on Ethereum/.test(t.log.toasts[0] || ''), 'with no wallet connected the hold stays and the page says why', t.log.toasts[0] || 'it was cleared');
  ok(t.log.ready === 1, 'and asks the wallet to connect on that chain');
}

console.log('\nwhat a failed check says');
{
  const {id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
  const errText = new Function('hex', 'selector', `${cut('const REVERTS =', 'const relayTrouble')}\nreturn errText;`)(lib.hex, (sig) => Buffer.from(id(sig).slice(2, 10), 'hex'));
  const wouldFail = Object.assign(new Error('This would fail on chain (execution reverted), so nothing was sent.'), {rpc: {data: '0x'}});
  ok(/so nothing was sent/.test(errText(wouldFail)) && !/A node answered/.test(errText(wouldFail)), 'a precheck that would fail says so, not "A node answered with an error"', errText(wouldFail));
  const slip = Object.assign(new Error('execution reverted'), {rpc: {data: '0x7dd37f70'}});
  ok(/price moved past your slippage/.test(errText(slip)), 'a zRouter slippage revert is said in the page\'s words', errText(slip));
  const plain = Object.assign(new Error('boom'), {rpc: {data: '0x'}});
  ok(/A node answered with an error/.test(errText(plain)), 'any other node error keeps the usual sentence', errText(plain));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
