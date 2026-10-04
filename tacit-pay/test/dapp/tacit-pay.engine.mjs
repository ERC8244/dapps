/* The page's wallet engine against a chain in memory, no browser: how a spend picks and merges notes, how the state is read
   when a node lags or a relay's index leaves events out, how deposit-address balances follow the head, and how reads in
   a batch fall back. The engine is taken out of dapp/page.html as it ships.

   Usage: node test/dapp/tacit-pay.engine.mjs                                                                       */
import {mkNode, mkWallet, mkWorld, depositTo, sweepTo, fakeSweep, lib, POOL, asset} from './engine-mock.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n, DEST = '0x' + '11'.repeat(20);

console.log('a spend that needs notes merged first');
{
  const node = mkNode();
  let proves = 0;
  const {W, keys} = mkWallet(node, {prove: async () => { proves++; throw new Error('PROVE-CALLED'); }});
  for (let i = 0; i < 10; i++) depositTo(node, keys, 5n * E / 100n, 101 + i);   // ten notes of 0.05
  node.tip = 130;
  await W.sync();
  const e = await W.withdraw({to: DEST, amount: 4n * E / 10n, via: 'self'}).catch((x) => x);
  ok(/PROVE-CALLED/.test(e.message) && proves === 1, '0.4 ETH from ten notes of 0.05 goes ahead: the first merge is proved', `${e.message} · ${proves} proof(s)`);
}
{
  const node = mkNode();
  let proves = 0;
  const {W, keys} = mkWallet(node, {prove: async () => { proves++; throw new Error('PROVE-CALLED'); }});
  depositTo(node, keys, E, 101); node.tip = 130;
  await W.sync();
  const e = await W.withdraw({to: DEST, amount: 3n * E, via: 'self'}).catch((x) => x);
  ok(/does not cover/.test(e.message) && proves === 0, 'an amount no merging can reach is refused before anything is proved or paid', `${e.message} · ${proves} proof(s)`);
}

console.log('\ncombining every part into one');
{
  const node = mkNode();
  let proves = 0, steps = [];
  const {W, keys} = mkWallet(node, {prove: async () => { proves++; throw new Error('PROVE-CALLED'); }});
  for (const v of [4n, 1n, 1n, 1n, 1n]) depositTo(node, keys, v * E / 1000n, 101);
  node.tip = 130; await W.sync();
  const e = await W.consolidate({via: 'self', onStep: (m) => steps.push(m)}).catch((x) => x);
  ok(/PROVE-CALLED/.test(e.message) && proves === 1 && steps[0] === 'Combining 1 of 4', 'five parts: the first of four steps is proved, and the step is said', `${e.message} · ${steps[0]}`);
  const one = mkNode(), w1 = mkWallet(one, {prove: async () => { throw new Error('PROVE-CALLED'); }});
  depositTo(one, w1.keys, E, 101); one.tip = 130; await w1.W.sync();
  ok(await w1.W.consolidate({via: 'self', onStep: () => {}}) === 0, 'one part: nothing is proved and nothing is paid');
}

console.log('\na node that lags the pool by a block or two');
{
  const node = mkNode();
  const {W, keys} = mkWallet(node);
  depositTo(node, keys, E / 10n, 105); node.tip = 130;
  await W.sync();
  depositTo(node, keys, E / 10n, 135); node.tip = 150;
  node.rootLagCalls = 2;               // two answers that do not know the new root yet
  const t0 = Date.now(), s = await W.sync().catch((x) => x);
  ok(s.balance === 2n * E / 10n, 'the nodes are asked again, and the read lands on the right balance', `${s.balance ?? s.message} after ${Date.now() - t0} ms`);
  ok(W.summary().balance === 2n * E / 10n, 'and what was already known is never blanked meanwhile');
}

console.log('\na relay whose index leaves events out');
{
  const node = mkNode();
  const asked = {events: 0};
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/events')) { asked.events++; return {status: 200, ok: true, headers: new Headers(), json: async () => ({chainId: 1, pool: POOL, through: node.tip - 3, events: []})}; }
    return {status: 404, ok: false, headers: new Headers(), json: async () => ({})};
  };
  const {W, keys} = mkWallet(node, {keeper: 'http://relay.test/keeper'});
  depositTo(node, keys, E / 10n, 105); node.tip = 130;
  const r1 = await W.sync().catch((x) => x);
  depositTo(node, keys, E / 10n, 140); node.tip = 150;
  const r2 = await W.sync().catch((x) => x);
  const r3 = await W.sync().catch((x) => x);
  ok(r1.balance === E / 10n && r2.balance === 2n * E / 10n && r3.balance === 2n * E / 10n, 'every read shows what the chain holds, the second time as well as the first', [r1, r2, r3].map((r) => r.balance ?? r.message).join(' · '));
  const before = asked.events;
  depositTo(node, keys, E / 10n, 160); node.tip = 170;
  const r4 = await W.sync().catch((x) => x);
  ok(r4.balance === 3n * E / 10n && asked.events === before, 'an index that has left events out is not asked again this session', `${r4.balance ?? r4.message} · index asked ${asked.events - before} more time(s)`);
  delete globalThis.fetch;
}

console.log('\ndeposit addresses follow the head');
{
  const node = mkNode();
  const {W, keys} = mkWallet(node);
  for (let i = 0; i < 3; i++) depositTo(node, keys, E / 20n, 101 + i);
  node.tip = 130;
  await W.sync([0, 1, 2]);
  node.balances.set(W.receiveBox(1).toLowerCase(), E / 10n);
  await W.sync([0, 1, 2]);
  ok(W.boxBalances()[1] === E / 10n, 'ETH that arrives at a deposit address at the same head is seen on the next read', String(W.boxBalances()[1]));
  node.multicall = false;
  node.balances.set(W.receiveBox(2).toLowerCase(), E / 5n);
  node.tip = 131;
  await W.sync([0, 1, 2]);
  ok(W.boxBalances()[1] === E / 10n && W.boxBalances()[2] === E / 5n, 'and a node with no Multicall3 is read address by address', JSON.stringify(Object.fromEntries(Object.entries(W.boxBalances()).map(([k, v]) => [k, String(v)]))));
}

console.log('\nthe ETH the pool holds');
{
  const node = mkNode();
  const {W, keys} = mkWallet(node);
  depositTo(node, keys, E / 10n, 101); node.tip = 130;
  node.balances.set(POOL.toLowerCase(), 1234n * E);
  await W.sync([0, 1]);
  ok(W.poolBalance() === 1234n * E, 'comes back with the head read', String(W.poolBalance()));
  ok(node.calls.filter((m) => m === 'eth_getBalance').length === 0 && node.calls.filter((m) => m === 'eth_call').length >= 1, 'in the same Multicall3 call as the leaf count and the deposit addresses: no read of its own');
  node.balances.set(POOL.toLowerCase(), 1235n * E); node.tip = 131;
  await W.sync([0, 1]);
  ok(W.poolBalance() === 1235n * E, 'and follows the pool from one read to the next');
  node.multicall = false; node.balances.set(POOL.toLowerCase(), 1236n * E); node.tip = 132;
  await W.sync([0, 1]);
  ok(W.poolBalance() === 1236n * E, 'and a node with no Multicall3 gives it in the one batch of balance reads');
}

console.log('\na payment that was never made');
{
  const node = mkNode();
  const {W, keys} = mkWallet(node);
  node.tip = 130;
  node.addPhantom({block: 129, keys, value: 100n * E});     // inside the unconfirmed tail, which the pool has no root for
  const s = await W.sync().catch((x) => x);
  ok(s.balance === 0n, 'a node that serves a deposit the pool never saw does not make a balance appear', String(s.balance ?? s.message));
  const real = mkNode(), w2 = mkWallet(real);
  depositTo(real, w2.keys, E, 129); real.tip = 130;
  ok((await w2.W.sync()).balance === E, 'while a real one in the same unconfirmed tail is shown at once');
}

console.log('\nthe head a read goes up to');
{
  const real = globalThis.fetch;
  const head = (n) => async () => ({json: async () => ({jsonrpc: '2.0', id: 1, result: '0x' + n.toString(16)})});
  globalThis.fetch = (u, i) => ({'https://a.test': head(2 ** 40), 'https://b.test': head(130), 'https://c.test': head(131)})[u](u, i);
  ok(await lib.headOf(['https://a.test', 'https://b.test', 'https://c.test']) === 130, 'is the lower of two nodes’ answers, so one node cannot send a read through blocks that do not exist');
  ok(await lib.headOf(['https://b.test']) === 130, 'and one node is enough when it is the only one');
  globalThis.fetch = real;
}

console.log('\nreads sent in one batch');
{
  const hits = {};
  const node = (name, mode) => async (url, init) => {
    hits[name] = (hits[name] || 0) + 1;
    const body = JSON.parse(init.body), one = (x) => mode === 'busy' ? {jsonrpc: '2.0', id: x.id, error: {code: 429, message: 'rate limited'}} : {jsonrpc: '2.0', id: x.id, result: `${name}:${x.method}`};
    const out = Array.isArray(body) ? (mode === 'nobatch' ? {jsonrpc: '2.0', id: 1, error: {code: -32600, message: 'batch not supported'}} : body.map(one)) : one(body);
    return {json: async () => out};
  };
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => ({'https://a.test': node('a', 'busy'), 'https://b.test': node('b', 'ok')})[url](url, init);
  let rpc = lib.jsonRpc(['https://a.test', 'https://b.test']);
  let out = await rpc.batch([['eth_blockNumber', []], ['eth_chainId', []]]);
  ok(out.every((x) => !x.error) && out[0].result === 'b:eth_blockNumber', 'a read a node answers with an error is asked of the next node', JSON.stringify(out.map((x) => x.result || x.error?.message)));
  globalThis.fetch = (url, init) => ({'https://a.test': node('a', 'nobatch'), 'https://b.test': node('b', 'ok')})[url](url, init);
  for (const k in hits) delete hits[k];
  rpc = lib.jsonRpc(['https://a.test', 'https://b.test']);
  await rpc.batch([['eth_blockNumber', []], ['eth_chainId', []]]);
  const first = hits.a;
  await rpc.batch([['eth_blockNumber', []], ['eth_chainId', []]]);
  ok(out.every((x) => !x.error) && hits.a === first, 'a node that will not take a batch is not asked for one again', `asked ${hits.a} time(s) in all`);
  globalThis.fetch = real;
}

console.log('\na transaction the wallet replaced lands under another hash');
{
  const {node, wallet} = mkWorld();
  const FAKE = '0x' + 'ee'.repeat(32);
  let fake = false;
  const A = wallet(7, {send: (h) => (fake ? (fake = false, FAKE) : h)}), B = wallet(9);
  await A.W.deposit({amount: E}); await A.W.deposit({amount: E});
  // the hash the wallet hands back never lands; the replacement does. The clock moves 20 s at each look for it.
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  const get = node.receipts.get.bind(node.receipts);
  node.receipts.get = (h) => { if (h === FAKE) { skew += 20_000; return undefined; } return get(h); };
  fake = true;
  const r = await A.W.send({to: B.keys, amount: E / 2n, via: 'self'}).catch((x) => x);
  Date.now = realNow;
  ok(typeof r === 'string', 'the send is reported as landed, not as unconfirmed', r?.message || r);
  const a = await A.W.sync(), b = await B.W.sync();
  ok(a.balance === 3n * E / 2n && b.balance === E / 2n, 'and the balances show the one payment', `A ${a.balance} B ${b.balance}`);
}

console.log('\na head a few blocks behind the leaf count');
{
  const node = mkNode();
  let lag = 0;
  const {W, keys} = mkWallet(node, {head: async () => node.tip - lag});
  depositTo(node, keys, E / 10n, 105); node.tip = 130;
  await W.sync();
  depositTo(node, keys, E / 10n, 133); node.tip = 135; lag = 4;      // the head two nodes agree on is before the new deposit
  node.logReads.length = 0;
  const s = await W.sync().catch((e) => e);
  ok(!(s instanceof Error) && s.balance === E / 10n, 'the leaf count is read at that head, so nothing is inconsistent', s?.message || `balance ${s.balance}`);
  ok(node.logReads.every((b) => b > 120), 'and nothing is rebuilt from the first block (a head with no new leaf reads no logs at all)', `logs read from ${node.logReads.join(', ') || 'nowhere'}`);
  lag = 0; node.tip = 140;
  const s2 = await W.sync();
  ok(s2.balance === E / 5n, 'the deposit shows once the head reaches it', `balance ${s2.balance}`);
}

console.log('\na made-up sweep into a deposit address, from a lying node');
{
  const node = mkNode();
  const {W, keys} = mkWallet(node);
  depositTo(node, keys, E / 10n, 101); node.tip = 130;
  fakeSweep(node, keys, 20, E, 110);
  await W.sync().catch(() => {});
  ok(W.nextBox() === 1 && W.boxSpan() === 21, 'does not move the deposit addresses forward', `nextBox ${W.nextBox()} span ${W.boxSpan()}`);
  const honest = mkNode();
  const {W: H, keys: hk} = mkWallet(honest);
  depositTo(honest, hk, E / 10n, 101); sweepTo(honest, hk, 5, E, 115); honest.tip = 130;
  const s = await H.sync();
  ok(s.balance === E + E / 10n && H.nextBox() === 6 && H.boxSpan() === 26, 'while a real one does', `balance ${s.balance} nextBox ${H.nextBox()} span ${H.boxSpan()}`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
