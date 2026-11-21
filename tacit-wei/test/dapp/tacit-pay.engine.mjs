/* The page's wallet engine against a chain in memory, no browser: how a spend picks and merges notes, how the state is read
   when a node lags or a relay's index leaves events out, how deposit-address balances follow the head, how reads in
   a batch fall back, and how a relay that asks more than it quoted is paid. The engine is taken out of dapp/page.html as
   it ships.

   Usage: node test/dapp/tacit-pay.engine.mjs                                                                       */
import {mkNode, mkWallet, mkWorld, depositTo, sweepTo, fakeSweep, lib, POOL, ROUTER, asset} from './engine-mock.mjs';
import {config} from './page-config.mjs';

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
  globalThis.fetch = (u, i) => ({'https://a.test': head(100), 'https://b.test': head(5000), 'https://c.test': head(5001)})[u](u, i);
  ok(await lib.headOf(['https://a.test', 'https://b.test', 'https://c.test']) === 5000, 'a node stuck far behind does not hold the read back: a third settles it, the lower of the two that agree');
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

console.log('\nan escrow’s refund box, in a range of its own');
{
  // A refund that reached the key's refund box (from 2^20) and was moved in is found from the key alone, by the wallet
  // and by a fresh one; it moves neither the one-time addresses nor the refunds' own count past it.
  const R0 = 1 << 20, node = mkNode(), {W, keys} = mkWallet(node);
  depositTo(node, keys, E / 10n, 101); sweepTo(node, keys, R0, E / 4n, 112); sweepTo(node, keys, R0 + 3, E / 8n, 118); node.tip = 130;
  const s = await W.sync();
  const F = mkWallet(node).W, f = await F.sync();
  ok(s.balance === E / 10n + E / 4n + E / 8n && f.balance === s.balance, 'both refunds are found, by this wallet and a fresh one', `${s.balance} · ${f.balance}`);
  ok(W.nextBox() === 1 && W.nextRefundBox() === R0 + 4, 'the one-time addresses stay where they were; the next refund box is past the last used', `nextBox ${W.nextBox()} nextRefundBox ${W.nextRefundBox() - R0}`);
}

console.log('\nthe tree, with its wide levels hashed elsewhere');
{
  const {incTree, H} = lib, leaves = Array.from({length: 3007}, (_, i) => BigInt(i) * 7919n + 13n), track = [7, 300, 1024, 3006];
  const a = incTree(), b = incTree(), asked = [];
  a.append(leaves.slice(0, 7), [3]); b.append(leaves.slice(0, 7), [3]);      // an edge that starts mid-pair and mid-subtree
  for (let i = 7; i < leaves.length; i += 256) a.append(leaves.slice(i, i + 256), track.filter((x) => x >= i && x < i + 256));
  await b.appendWith(leaves.slice(7), track, async (xs) => { asked.push(xs.length); const o = []; for (let i = 0; i < xs.length; i += 2) o.push(H([xs[i], xs[i + 1]])); return o; });
  ok(a.root === b.root && a.size === b.size && JSON.stringify(a.toJSON()) === JSON.stringify(b.toJSON()), 'the same root, edge and tracked paths as appending 256 at a time', `${asked.length} levels handed out, widest ${Math.max(...asked) / 2} pairs`);
  ok([3, ...track].every((i) => a.path(i).every((x, L) => x === b.path(i)[L])), 'each tracked leaf has the same path');
}

console.log('\na relay that asks a little more than it quoted, once it sees the proof');
{
  const {node, wallet, relayed} = mkWorld();
  const QUOTE = 10n ** 13n, NEED = 13n * 10n ** 12n, real = globalThis.fetch, log = [];
  // A relay that quotes QUOTE, reserves slots, and takes a payment only at NEED or more.
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(String(url)).pathname.replace(/^.*\/keeper/, ''), body = init.body ? JSON.parse(init.body) : {};
    const res = (status, b) => ({status, ok: status === 200, headers: {get: () => null}, json: async () => b});
    log.push(p);
    if (p.startsWith('/quote')) return res(200, {chainId: 1, pool: POOL, relayer: config.RELAYERS[1], fee: String(QUOTE)});
    if (p === '/reserve') return res(200, {id: 'a'.repeat(24), root: String(node.tree.root), oldRoot: String(node.tree.root), start: node.size, pending: [], expires: Math.floor(Date.now() / 1000) + 90});
    if (p === '/cancel') return res(200, {ok: true});
    if (p === '/relay') {
      if (BigInt(body.tx.fee) < NEED) return res(400, {error: 'fee too low', needFee: String(NEED)});
      const r = relayed(body.tx);
      return r.revert ? res(400, {error: r.revert}) : res(200, {txHash: r.h});
    }
    return res(404, {});
  };
  const A = wallet(7, {keeper: 'https://relay.test/evm-pool/keeper'});
  await A.W.deposit({amount: E});
  const h = await A.W.withdraw({to: DEST, amount: 3n * E / 10n, via: null}).catch((x) => x);
  ok(typeof h === 'string', 'the payment is proved again at the fee the relay names and lands', h?.message || h);
  const s = await A.W.sync();
  ok(s.balance === E - 3n * E / 10n - NEED, 'the difference came out of the change: the amount paid is the one asked for', `balance ${s.balance}`);
  ok(log.filter((x) => x === '/cancel').length === 1 && log.filter((x) => x === '/relay').length === 2, 'the first slot was given back, and the relay was asked twice', log.join(' '));
  log.length = 0;
  const B = wallet(9, {keeper: 'https://relay.test/evm-pool/keeper'});
  await B.W.deposit({amount: E / 10n});
  const e = await B.W.withdraw({to: DEST, amount: 'max', via: null}).catch((x) => x);
  ok(/asks .* more than it quoted/.test(e?.message || '') && !e.inflight && B.W.inflight().length === 0, 'with no change to take it from, it is refused before anything was sent, and nothing is held', e?.message || e);
  globalThis.fetch = real;
}

console.log('\npost-quantum notes: the self form for one\'s own, the hybrid form to a post-quantum address, spent and read back');
{
  const {node, wallet} = mkWorld();
  const {AbiCoder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
  const coder = AbiCoder.defaultAbiCoder(), T = lib.T_TRANSACT;
  const lastMemos = () => { const l = node.logs.filter((x) => x.topics[0] === T).at(-1), d = coder.decode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], l.data); return [d[8], d[9]].map((m) => (m.length - 2) / 2); };
  const A = wallet(7), B = wallet(9), C = wallet(11), A0 = wallet(7), B0 = wallet(9);   // A0, B0: the same keys with no root
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(1)); B.keys.pq = lib.pqKeys(new Uint8Array(32).fill(2));
  await A.W.deposit({amount: E});
  ok(lastMemos().join() === '65,65', 'a deposit with a root: memos of 65 bytes, as any deposit\'s', lastMemos().join());
  let a = await A.W.sync(), a0 = await A0.W.sync();
  ok(a.balance === E && a0.balance === 0n, 'the root\'s owner reads it; the same secp keys without the root do not (the self form)', `A ${a.balance} · A without root ${a0.balance}`);
  const toB = {V: B.keys.V, A: B.keys.A, N: B.keys.N, raw: B.keys.raw, ek: B.keys.pq.ek};
  const h = await A.W.send({to: toB, amount: E / 4n, via: 'self'}).catch((x) => x);
  ok(typeof h === 'string', 'A pays B, whose address names an ML-KEM key A has', h?.message || h);
  ok(lastMemos().join() === '1153,1153', 'both outputs carry hybrid memos (the change too, to A\'s own key), so neither stands out', lastMemos().join());
  a = await A.W.sync(); const b = await B.W.sync(), b0 = await B0.W.sync();
  ok(a.balance === 3n * E / 4n && b.balance === E / 4n && b0.balance === 0n, 'B reads the payment and A its change; B\'s secp keys alone read nothing', `A ${a.balance} · B ${b.balance} · B without root ${b0.balance}`);
  const toC = {V: C.keys.V, A: C.keys.A, N: C.keys.N, raw: C.keys.raw};
  const h2 = await B.W.send({to: toC, amount: E / 8n, via: 'self'}).catch((x) => x);
  ok(typeof h2 === 'string' && lastMemos().join() === '65,65', 'B spends the hybrid note to C, who has no post-quantum key: classical lengths (B\'s change in the self form)', h2?.message || lastMemos().join());
  const b2 = await B.W.sync(), c = await C.W.sync(), b02 = await B0.W.sync();
  ok(b2.balance === E / 8n && c.balance === E / 8n && b02.balance === 0n, 'C reads it; B\'s change is B\'s, unseen without the root', `B ${b2.balance} · C ${c.balance} · B without root ${b02.balance}`);
  const A2 = wallet(7); A2.keys.pq = lib.pqKeys(new Uint8Array(32).fill(1));
  ok((await A2.W.sync()).balance === 3n * E / 4n, 'a new device with the key and the root reads everything again from the chain');
}

console.log('\npost-quantum deposit addresses: from the root, the classical ones still watched');
{
  const {node, wallet} = mkWorld();
  const A = wallet(13), A0 = wallet(13);
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(4));
  const q1 = A.W.receiveBox(1), c1 = A0.W.receiveBox(1);
  ok(q1 !== c1, 'with a root, deposit address 1 is another address than the classical one (which the Tacit key gives away)', `${q1} vs ${c1}`);
  sweepTo(node, A.keys, 1, E / 5n, 131);                       // into the root's box 1
  sweepTo(node, {...A.keys, pq: null}, 2, E / 10n, 132);      // into the classical box 2 (a link made before the root)
  node.tip = 140;
  const a = await A.W.sync(), a0 = await A0.W.sync();
  ok(a.balance === 3n * E / 10n, 'the root\'s owner reads both: the root\'s box and the classical one', `balance ${a.balance}`);
  ok(a0.balance === E / 10n, 'the Tacit key alone finds only the classical box', `balance ${a0.balance}`);
  const C = wallet(15), toC = {V: C.keys.V, A: C.keys.A, N: C.keys.N, raw: C.keys.raw};
  const e = await A.W.send({to: toC, amount: E / 4n, via: 'self'}).catch((x) => x);
  ok(e?.reseal === true, 'a payment that would need the classical box note beside the root\'s is refused, not mixed', e?.message || e);
  await A.W.reseal({via: 'self', onStep: () => {}});
  const h = await A.W.send({to: toC, amount: E / 4n, via: 'self'}).catch((x) => x);
  ok(typeof h === 'string' && (await C.W.sync()).balance === E / 4n, 'sealed first, both box notes spend', h?.message || h);
  const A2 = wallet(13); A2.keys.pq = lib.pqKeys(new Uint8Array(32).fill(4));
  ok((await A2.W.sync()).balance === (await A.W.sync()).balance, 'a new device with the key and the root reads the same balance');
}

console.log('\nthe balance from before a root, sealed under it');
{
  const {node, wallet} = mkWorld();
  const A = wallet(17), A0 = wallet(17);
  await A.W.deposit({amount: E / 2n}); await A.W.deposit({amount: E / 4n}); await A.W.deposit({amount: E / 8n});
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(6));
  await A.W.sync();
  ok(A.W.oldValue() === 7n * E / 8n, 'with the root on, the three classical notes are counted as from before', String(A.W.oldValue()));
  const steps = await A.W.reseal({via: 'self', onStep: () => {}}).catch((x) => x);
  const a = await A.W.sync(), a0 = await A0.W.sync();
  ok(steps === 2 && A.W.oldValue() === 0n && a.balance === 7n * E / 8n, 'reseal: two transfers to oneself (two notes, then the last), nothing classical left, the balance whole', `${steps?.message ?? steps} steps · old ${A.W.oldValue()} · balance ${a.balance}`);
  ok(a0.balance === 0n, 'the Tacit key alone now finds none of it', String(a0.balance));
}

// A wallet on a world's chain with a signer the test steers (`fail`: the next send is taken by the wallet and lost track of,
// so it is held), and the router's deposit-address calls answered (receiveCount, and sweepReceive applied as the router does).
const {Interface: Iface, AbiCoder: Coder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const RI = new Iface(['function sweepReceive(uint256 npk,uint16 feeBps,(uint256[2],uint256[2][2],uint256[2],uint256[11],address,int256,address,uint256,bytes,bytes) t)', 'function receiveCount(address) view returns (uint256)']);
const TI = new Iface(['function transact(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,uint256[11] publicInputs,address recipient,int256 extAmount,address relayer,uint256 fee,bytes memo0,bytes memo1)']);
const ABI = Coder.defaultAbiCoder(), w32 = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0');
function steered(world, seed, {store = null, pqWrite = undefined, root = null, keeper = null} = {}) {
  const {node, apply, prove} = world;
  const rpc = async (m, p) => {
    if (m === 'eth_call' && p[0].to.toLowerCase() === ROUTER.toLowerCase()) {
      if (p[0].data.startsWith(RI.getFunction('receiveCount').selector)) return ABI.encode(['uint256'], [0n]);
      if (p[0].data.startsWith(RI.getFunction('sweepReceive').selector)) return '0x';
    }
    return world.rpc(m, p);
  };
  rpc.batch = world.rpc.batch;
  const keys = lib.poolKeys(new Uint8Array(32).fill(seed)), s = {fail: false, sends: 0};
  s.signer = {address: '0x' + '22'.repeat(20), ready: async () => {}, send: async ({to, data, value}) => {
    s.sends++;
    if (s.fail) { s.fail = false; s.lost = {data, value}; throw Object.assign(new Error('the wallet went away'), {asked: true}); }   // `lost`: what it may still send
    if (to.toLowerCase() === ROUTER.toLowerCase()) {
      const d = RI.decodeFunctionData('sweepReceive', data), box = lib.receiveBoxAddress(ROUTER, d.npk), ext = BigInt(d.t[5]), first = node.size;
      if ((node.balances.get(box.toLowerCase()) ?? 0n) !== ext) throw new Error('reverted: not what the box holds');
      const r = apply(TI.encodeFunctionData('transact', [...d.t]), ext);
      if (r.revert) throw new Error('reverted ' + r.revert);
      node.balances.set(box.toLowerCase(), 0n);
      node.logs.push({address: ROUTER, topics: [lib.T_RECEIVED, '0x' + box.slice(2).toLowerCase().padStart(64, '0'), w32(0n)], data: ABI.encode(['uint256', 'uint256', 'uint256', 'uint256'], [first, ext, lib.receiveRho(box, 0n), 0n]), blockNumber: node.receipts.get(r.h).blockNumber, transactionHash: r.h, logIndex: '0x1'});
      return r.h;
    }
    const r = apply(data, value);
    if (r.revert) throw new Error('reverted ' + r.revert);
    s.after?.();
    return r.h;
  }};
  s.keys = keys;
  if (root) keys.pq = lib.pqKeys(root);            // as the page opens a key: its root first, then the wallet
  s.W = lib.makePoolWallet({chain: {chainId: 1, pool: POOL, router: ROUTER, rpc, deployBlock: 100, confirmations: 3, keeper, ...(pqWrite && {pqWrite})}, keys, prove, store, signer: s.signer, feed: false});
  return s;
}
const memStore = () => { const m = new Map(); return {get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), del: (k) => m.delete(k)}; };

console.log('\nanother tab without the root writes the shared state: it is read again under the root, holds kept');
{
  const world = mkWorld(), store = memStore(), root = new Uint8Array(32).fill(4);
  // T2 was open before the root was turned on in T1, and has not read anything yet
  const T1 = steered(world, 71, {store, root}), T2 = steered(world, 71, {store}), B = lib.poolKeys(new Uint8Array(32).fill(73));
  await T1.W.deposit({amount: E});                                     // notes in the self form
  await T1.W.deposit({amount: E / 2n});
  T1.fail = true;
  const e = await T1.W.send({to: {V: B.V, A: B.A, N: B.N, raw: B.raw}, amount: E / 4n, via: 'self'}).catch((x) => x);
  ok(T1.W.inflight().length === 1, 'T1 holds a payment its wallet may still send', e?.message);
  ok((await T2.W.sync()).balance === 0n, 'T2, without the root, reads none of it, and writes its state (taking in T1\'s hold)');
  T1.W.stop(); T2.W.stop();
  const R = steered(world, 71, {store, root});                         // T1 reloaded, the root kept
  const s = await R.W.sync(), held = R.W.inflight()[0]?.held;
  ok(R.W.inflight().length === 1 && held === E / 2n && s.balance === E, 'reloaded under the root, the state T2 wrote is read again: the notes are back, the hold kept', `balance ${s.balance} · held ${held}`);
}

console.log('\na deposit address from before the root, paid after it: read and taken in');
{
  const world = mkWorld(), {node} = world;
  const A = steered(world, 81), A0 = steered(world, 81);
  const c1 = A0.W.receiveBox(1);                                      // handed out before the root
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(4));
  ok(A.W.receiveBox(1, true) === c1 && A.W.receiveBox(1) !== c1, 'with a root, the classical address of index 1 is still known (classical: true)');
  node.balances.set(c1.toLowerCase(), E / 20n);                       // under the relay's minimum: no one sweeps it
  await A.W.sync();
  const h = await A.W.sweep({index: 1, classical: true}).catch((x) => x);
  ok(typeof h === 'string', 'it is taken in from the wallet, at its classical address', h?.message || h);
  ok((await A.W.sync()).balance === E / 20n && A.W.oldValue() === E / 20n, 'and shows in the balance, as a note from before the root (resealed later)', String(A.W.summary().balance));
}

console.log('\na second root in the same engine: its own deposit addresses');
{
  const {node, wallet} = mkWorld();
  const A = wallet(21);
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(1));
  await A.W.sync();
  const a0 = A.W.receiveBox(0);
  A.keys.pq = null; await A.W.sync();                                  // forgotten
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(2));                  // other words
  const b0 = lib.receiveBoxAddress(ROUTER, lib.receiveKeys(A.keys, 0).npk);
  ok(A.W.receiveBox(0) === b0 && b0 !== a0, 'deposit address 0 is the new root\'s, not the first one\'s', `${A.W.receiveBox(0)} vs ${b0}`);
  sweepTo(node, A.keys, 0, E / 5n, 140); node.tip = 150;
  ok((await A.W.sync()).balance === E / 5n, 'a payment into it is read without a reload', String(A.W.summary().balance));
}

console.log('\nregistry bit 7 (hybrid memos stopped): one\'s own outputs keep the self form, and reseal still seals');
{
  const world = mkWorld();
  let write = true;
  const A = steered(world, 41, {pqWrite: () => write}), A0 = steered(world, 41), B = steered(world, 43);
  await A.W.deposit({amount: E / 2n}); await A.W.deposit({amount: E / 4n});
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(5)); B.keys.pq = lib.pqKeys(new Uint8Array(32).fill(6));
  await A.W.sync();
  write = false; A.sends = 0;
  await A.W.deposit({amount: E / 8n});
  ok((await A.W.sync()).balance === 7n * E / 8n && (await A0.W.sync()).balance === 3n * E / 4n, 'a deposit with bit 7 set: the self form (the key alone does not read it)', `A ${A.W.summary().balance} · key alone ${A0.W.summary().balance}`);
  const steps = await A.W.reseal({via: 'self', onStep: () => {}}).catch((x) => x);
  ok(steps === 1 && A.W.oldValue() === 0n && (await A0.W.sync()).balance === 0n, 'reseal under bit 7: the classical notes in the self form, nothing classical left', `${steps?.message ?? steps} · old ${A.W.oldValue()}`);
  const h = await A.W.send({to: {V: B.keys.V, A: B.keys.A, N: B.keys.N, raw: B.keys.raw, ek: B.keys.pq.ek}, amount: E / 10n, via: 'self'}).catch((x) => x);
  const l = world.node.logs.filter((x) => x.topics[0] === lib.T_TRANSACT).at(-1), d = ABI.decode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], l.data);
  ok(typeof h === 'string' && [d[8], d[9]].map((m) => (m.length - 2) / 2).join() === '65,65' && (await B.W.sync()).balance === E / 10n, 'a payment to a post-quantum address under bit 7: no hybrid memo (65-byte memos), and it arrives', `${h?.message ?? ''} ${[d[8], d[9]].map((m) => (m.length - 2) / 2).join()}`);
}

console.log('\nwith a root, classical notes are never spent beside the root\'s');
{
  const world = mkWorld();
  const A = steered(world, 45), A0 = steered(world, 45), C = lib.poolKeys(new Uint8Array(32).fill(47)), toC = {V: C.V, A: C.A, N: C.N, raw: C.raw};
  await A.W.deposit({amount: E / 2n});                                 // from before the root
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(8));
  await A.W.deposit({amount: 3n * E / 10n}); await A.W.deposit({amount: E / 10n});
  A.sends = 0;
  const e = await A.W.send({to: toC, amount: 6n * E / 10n, via: 'self'}).catch((x) => x);
  ok(e?.reseal === true && A.sends === 0 && A.W.inflight().length === 0, 'a payment the root\'s notes cannot cover alone is refused before anything is sent, with a way to seal the rest', e?.message || e);
  const h = await A.W.send({to: toC, amount: 35n * E / 100n, via: 'self'}).catch((x) => x);
  ok(typeof h === 'string' && (await A0.W.sync()).balance === E / 2n, 'one the root\'s notes cover is paid from them alone: the classical note is untouched', `${h?.message ?? ''} key alone ${A0.W.summary().balance}`);
  await A.W.deposit({amount: E / 10n});
  const steps = await A.W.consolidate({via: 'self', onStep: () => {}}).catch((x) => x);
  ok(steps === 1 && (await A0.W.sync()).balance === E / 2n, 'combining parts leaves the classical note to reseal', `${steps?.message ?? steps} · key alone ${A0.W.summary().balance}`);
  await A.W.reseal({via: 'self', onStep: () => {}});
  const h2 = await A.W.send({to: toC, amount: 6n * E / 10n, via: 'self'}).catch((x) => x);
  ok(typeof h2 === 'string' && (await A.W.sync()).balance === E / 2n + 4n * E / 10n + E / 10n - 35n * E / 100n - 6n * E / 10n, 'sealed first, the payment goes', h2?.message || String(A.W.summary().balance));
}

console.log('\na proof made ahead under the root, the words forgotten before the press');
{
  const {mockRelay} = await import('./relay-mock.mjs');
  const proofs = [], KEEPER = 'https://relay.test/evm-pool/keeper';
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(91, {keeper: KEEPER}), A0 = wallet(91);
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(10));
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), n0 = proofs.length;
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  for (let i = 0; i < 150 && proofs.length === n0; i++) await new Promise((r) => setTimeout(r, 20));
  A.keys.pq = null;
  const h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(typeof h === 'string' && proofs.length === n0 + 2, 'pressed, it is proved again rather than sent with outputs sealed under the forgotten root', `${h?.message ?? ''} ${proofs.length - n0} proofs`);
  ok((await A0.W.sync()).balance === 3n * E / 100n - relay.quote, 'so the change is one the key alone reads', String(A0.W.summary().balance));
  relay.restore();
}

console.log('\na deposit proved while its form was still: the press sends that proof');
{
  const proofs = [], {wallet} = mkWorld({onProve: () => proofs.push(1)});
  const A = wallet(93);
  const wait = async (n) => { for (let i = 0; i < 300 && proofs.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
  A.W.proveAheadDeposit(2n * E / 100n);
  await wait(1);
  const h = await A.W.deposit({amount: 2n * E / 100n}).catch((x) => x);
  ok(typeof h === 'string' && proofs.length === 1 && A.W.summary().balance === 2n * E / 100n, 'one proof in all: made ahead, used at the press', `${h?.message ?? ''} ${proofs.length} proofs`);
  A.W.proveAheadDeposit(3n * E / 100n);
  await wait(2);
  const h2 = await A.W.deposit({amount: 4n * E / 100n}).catch((x) => x);
  ok(typeof h2 === 'string' && proofs.length === 3 && A.W.summary().balance === 6n * E / 100n, 'another amount at the press is proved again', `${h2?.message ?? ''} ${proofs.length} proofs`);
}

console.log('\na held payment to a post-quantum address, tried again: still sealed to the payee\'s key');
{
  const world = mkWorld(), {node} = world;
  const A = steered(world, 51), B = steered(world, 53);
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(7)); B.keys.pq = lib.pqKeys(new Uint8Array(32).fill(8));
  lib.pqLearn(B.keys.pq.ek);                                           // from B's payment link
  const lane = lib.parseRecipient(lib.tacitAddress(new Uint8Array(32).fill(53), B.keys, B.keys.pq.hash));
  ok(lane.ek?.length === 1184, 'B\'s address names the ML-KEM key the link brought');
  await A.W.deposit({amount: E});
  A.fail = true;
  await A.W.send({to: lane, amount: E / 4n, via: 'self'}).catch(() => {});
  const id = A.W.inflight()[0]?.id;
  const h = await A.W.retry(id, {via: 'self', onStep: () => {}}).catch((x) => x);
  const {AbiCoder} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
  const l = node.logs.filter((x) => x.topics[0] === lib.T_TRANSACT).at(-1), d = AbiCoder.defaultAbiCoder().decode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], l.data);
  ok(typeof h === 'string' && [d[8], d[9]].map((m) => (m.length - 2) / 2).join() === '1153,1153', 'the retry lands with hybrid memos', `${h?.message ?? ''} ${[d[8], d[9]].map((m) => (m.length - 2) / 2).join()}`);
  ok((await B.W.sync()).balance === E / 4n, 'and B reads it');
}

const lastLens = (node) => { const l = node.logs.filter((x) => x.topics[0] === lib.T_TRANSACT).at(-1), d = ABI.decode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], l.data); return [d[8], d[9]].map((m) => (m.length - 2) / 2).join(); };
const fast = (f) => async (...a) => { const st = globalThis.setTimeout; globalThis.setTimeout = (g, ms, ...r) => st(g, Math.min(ms, 5), ...r); try { return await f(...a); } finally { globalThis.setTimeout = st; } };

console.log('\ntwo devices pay from the same note: the one that lost is not taken for landed');
{
  const {mockRelay} = await import('./relay-mock.mjs');
  const world = mkWorld(), {node, relayed} = world, relay = mockRelay(node, relayed), KEEPER = 'https://relay.test/evm-pool/keeper';
  const D1 = steered(world, 61), D2 = world.wallet(61, {keeper: KEEPER});
  await D1.W.deposit({amount: E / 10n}); await D2.W.sync();
  relay.mode = 'drop';                                                  // D2's relay answers with a hash and never sends it
  const late = D2.W.withdraw({to: DEST, amount: E / 20n, via: null, expectFee: relay.quote}).catch((x) => x);
  await new Promise((r) => setTimeout(r, 300));
  const h1 = await D1.W.withdraw({to: '0x' + '33'.repeat(20), amount: E / 25n, via: 'self'}).catch((x) => x);
  const e = await late;
  ok(typeof h1 === 'string', 'D1\'s payment lands', h1?.message || h1);
  ok(/Another payment from these same notes landed first/.test(e?.message || '') && D2.W.landed().length === 0 && D2.W.inflight().length === 0, 'D2 says another payment from the notes landed, records nothing as landed, and holds nothing', `${e?.message ?? e} · landed ${D2.W.landed().length}`);
  relay.restore();
}

console.log('\na relay that refuses before sending (its queue moved on, 409) leaves nothing held');
{
  const {mockRelay} = await import('./relay-mock.mjs');
  const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
  const A = wallet(63, {keeper: 'https://relay.test/evm-pool/keeper'});
  await A.W.deposit({amount: E / 10n});
  relay.mode = 'stale409';
  const e = await fast(() => A.W.withdraw({to: DEST, amount: E / 20n, via: null, expectFee: relay.quote}))().catch((x) => x);
  ok(!e?.inflight && A.W.inflight().length === 0, 'refused each time: nothing is held', e?.message || e);
  relay.mode = 'send';
  const h = await A.W.withdraw({to: DEST, amount: E / 20n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(typeof h === 'string', 'pressed again, it goes, with no question about a held payment', h?.message || h);
  relay.restore();
}

console.log('\ntwo withdrawals into escrows that name no purpose (whole notes taken in): not taken for the same payment');
{
  const {mockRelay} = await import('./relay-mock.mjs');
  const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
  const A = wallet(65, {keeper: 'https://relay.test/evm-pool/keeper'});
  await A.W.deposit({amount: E}); await A.W.deposit({amount: E});
  const intent = () => ({calls: [{target: DEST, value: 0n, token: '0x' + '00'.repeat(20), amount: 0n, push: false, data: '0x'}], outTokens: [], minOuts: [], to: '0x' + '00'.repeat(20), refund: DEST, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), nonce: BigInt(Math.floor(Math.random() * 2 ** 48))});
  const a = await A.W.callOut({intent: intent(), value: E / 10n, gas: 400000, why: {notes: 1}}).catch((x) => x);
  const b = await A.W.callOut({intent: intent(), value: E / 10n, gas: 400000, why: {notes: 1}}).catch((x) => x);
  ok(typeof a === 'string' && typeof b === 'string', 'the second, into another escrow, is not refused as a duplicate', `${a?.message ?? 'ok'} · ${b?.message ?? 'ok'}`);
  relay.restore();
}

console.log('\na held payment to a post-quantum address whose key is gone from the record: asked, not sealed classically');
{
  const world = mkWorld(), {node} = world;
  const A = steered(world, 67), B = lib.poolKeys(new Uint8Array(32).fill(69));
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(11)); B.pq = lib.pqKeys(new Uint8Array(32).fill(12));
  await A.W.deposit({amount: E});
  A.fail = true;
  await A.W.send({to: {V: B.V, A: B.A, N: B.N, raw: B.raw, kemHash: B.pq.hash, ek: B.pq.ek}, amount: E / 4n, via: 'self'}).catch(() => {});
  const x = A.W.inflight()[0];
  ok(x?.pay.ek?.length === 2368, 'the hold keeps the payee\'s key itself');
  delete x.pay.ek;                                                      // a record from before, its key gone from this browser
  A.sends = 0;
  const e = await A.W.retry(x.id, {via: 'self', onStep: () => {}}).catch((y) => y);
  ok(e?.pqPlain === true && A.sends === 0, 'tried again, it asks before an ordinary memo, and sends nothing', e?.message || e);
  const h = await A.W.retry(x.id, {via: 'self', onStep: () => {}, plain: true}).catch((y) => y);
  ok(typeof h === 'string' && lastLens(node) === '65,65', 'with the person\'s say, it goes with ordinary memos', `${h?.message ?? ''} ${lastLens(node)}`);
}

console.log('\nthe words forgotten in another tab while a payment combines notes: it stops before the next step');
{
  const world = mkWorld();
  const A = steered(world, 71, {root: new Uint8Array(32).fill(13)}), C = lib.poolKeys(new Uint8Array(32).fill(73));
  for (let i = 0; i < 3; i++) await A.W.deposit({amount: 3n * E / 10n});
  A.sends = 0;
  A.after = () => { A.after = null; A.keys.pq = null; };              // the merge lands, then the root is gone
  const e = await A.W.send({to: {V: C.V, A: C.A, N: C.N, raw: C.raw}, amount: 7n * E / 10n, via: 'self'}).catch((x) => x);
  ok(/turned on or off meanwhile/.test(e?.message || '') && A.sends === 1, 'the merge went; the payment is not sealed under the other setting', `${e?.message ?? e} · ${A.sends} sent`);
}

console.log('\na held payment tried again, whose first try lands meanwhile: it landed, not "another payment"');
{
  const {mockRelay} = await import('./relay-mock.mjs');
  const world = mkWorld(), {node, relayed} = world, relay = mockRelay(node, relayed);
  const A = steered(world, 75, {keeper: 'https://relay.test/evm-pool/keeper'});
  await A.W.deposit({amount: E / 10n});
  A.fail = true;
  await A.W.withdraw({to: DEST, amount: E / 20n, via: 'self'}).catch(() => {});
  const id = A.W.inflight()[0]?.id;
  relay.mode = 'drop';                                                  // the retry's relay says it sent, and does not
  const again = A.W.retry(id, {via: null, onStep: () => {}, expectFee: String(relay.quote)}).catch((x) => x);
  await new Promise((r) => setTimeout(r, 1500));
  world.apply(A.lost.data, A.lost.value);                              // the wallet sent the first try after all
  const h = await again;
  ok(typeof h === 'string' && A.W.inflight().length === 0, 'the retry ends as landed: the first try was this payment', h?.message || h);
  relay.restore();
}

console.log('\nwith the words on, what a payment may spend (the forms plan with it)');
{
  const world = mkWorld();
  const A = steered(world, 77);
  await A.W.deposit({amount: E / 2n});
  A.keys.pq = lib.pqKeys(new Uint8Array(32).fill(14));
  await A.W.deposit({amount: E / 4n});
  ok(A.W.notes().length === 2 && A.W.spendable().map((n) => BigInt(n.v)).join() === String(E / 4n), 'spendable() leaves out the note from before the words', A.W.spendable().map((n) => n.v).join());
}

console.log('\nthe registry copy kept in this browser, checked again as it is read');
{
  const vm = await import('node:vm'), {mod} = await import('./page-config.mjs');
  const piece = (from, end) => { const a = mod.indexOf(from); return mod.slice(a, mod.indexOf(end, a) + end.length); };
  const regOf = vm.runInNewContext(`${piece('const goodUrl', ';\n')}\n${piece('function regOf(', '\n}\n')}\nregOf`);
  const r = regOf(Date.now() + 9e9, '999999999999999999999999', {rpc1: ['https://ok.example', 'javascript:alert(1)', 7], logs1: ['https://logs.example'], keepers1: ['http://plain.example'], bundlers: 'not a list', fwds: ['https://fw.example/path'], wcList: ['wss://relay.example'], copyList: [{}]});
  ok(r.at === 0 && r.flags === '0' && r.rpc[1].join() === 'https://logs.example,https://ok.example' && !r.keepers[1] && r.bundler.length === 0 && r.forwarders.length === 0 && r.wc === 'wss://relay.example' && r.logs[0] === 'https://logs.example', 'a time ahead of now, flags too long, bad URLs and wrong shapes are dropped', JSON.stringify(r));
}

// ── several relays: the listed ones are quoted, vetted against their own addresses, and one is drawn among the cheapest ──
{
  const {mockRelays} = await import('./relay-mock.mjs'), {config} = await import('./page-config.mjs');
  const SEED = config.RELAYERS[1], RA = '0x' + 'a1'.repeat(20), RB = '0x' + 'b2'.repeat(20), RC = '0x' + 'c3'.repeat(20), LIAR = '0x' + 'ee'.repeat(20);
  const U = (h) => `https://${h}/1/evm-pool/keeper`, DEST2 = '0x' + '44'.repeat(20);
  const list = (hosts) => async () => hosts.map(([h, r], i) => ({url: U(h), relayer: r, ...(i === 0 && {own: true})}));
  const setup = (specs, hosts, seed) => {
    const world = mkWorld(), relay = mockRelays(world.node, world.relayed, specs), A = world.wallet(seed, {keeper: U(hosts[0][0]), relays: list(hosts)});
    return {world, relay, A};
  };
  const pay = (A, relay) => A.W.withdraw({to: DEST2, amount: E / 50n, via: null}).catch((x) => x);

  console.log('\nthree relays: the cheapest of the near ones is used, an expensive one skipped');
  {
    const hosts = [['seed.test', SEED], ['b.test', RB], ['c.test', RC]];
    const {relay, A} = setup({'seed.test': {fee: 5n * 10n ** 13n, relayer: SEED}, 'b.test': {fee: 10n ** 13n, relayer: RB}, 'c.test': {fee: 10n ** 14n, relayer: RC}}, hosts, 81);
    await A.W.deposit({amount: E / 10n});
    const h = await pay(A, relay);
    ok(typeof h === 'string' && relay.relays['b.test'] === 1 && !relay.relays['seed.test'] && !relay.relays['c.test'], 'the payment went through the cheapest relay (b), not the seed at five times the fee nor c at ten', `${h?.message ?? ''} ${JSON.stringify(relay.relays)}`);
    ok(A.W.carried()?.url === U('b.test'), 'and the wallet says which relay carried it');
    // a deposit address is given to the page's own relay, not to the one that carried the last payment
    const r = await A.W.watch(3);
    ok(r.status === 200 && relay.log.filter((x) => x.endsWith(' /receive')).join() === 'seed.test /receive', 'a deposit address is registered with the page\'s own relay, not the one drawn for the payment', relay.log.filter((x) => /receive/.test(x)).join());
    relay.restore();
  }
  console.log('\na relay that quotes another address, or a fee over the limit: not used');
  {
    const hosts = [['seed.test', SEED], ['liar.test', RB], ['rich.test', RC]];
    const {relay, A} = setup({'seed.test': {fee: 3n * 10n ** 13n, relayer: SEED}, 'liar.test': {fee: 10n ** 12n, relayer: LIAR}, 'rich.test': {fee: 10n ** 17n, relayer: RC}}, hosts, 83);
    await A.W.deposit({amount: E / 10n});
    const h = await pay(A, relay);
    ok(typeof h === 'string' && relay.relays['seed.test'] === 1 && !relay.relays['liar.test'] && !relay.relays['rich.test'], 'the cheapest quote under another address, and one over 0.05 ETH, are passed over: the seed carries it', `${h?.message ?? ''} ${JSON.stringify(relay.relays)}`);
    relay.restore();
  }
  console.log('\na relay that refuses before sending: the next one is used, and nothing is held');
  {
    const hosts = [['seed.test', SEED], ['b.test', RB]];
    const {relay, A} = setup({'seed.test': {fee: 2n * 10n ** 13n, relayer: SEED}, 'b.test': {fee: 10n ** 13n, relayer: RB, mode: 'refuse400'}}, hosts, 85);
    await A.W.deposit({amount: E / 10n});
    const h = await A.W.withdraw({to: DEST2, amount: E / 50n, via: null, expectFee: 3n * 10n ** 13n}).catch((x) => x);
    ok(typeof h === 'string' && relay.relays['b.test'] === 1 && relay.relays['seed.test'] === 1 && A.W.inflight().length === 0, 'b refused, the seed took it, and no hold is left', `${h?.message ?? ''} ${JSON.stringify(relay.relays)}`);
    relay.restore();
  }
  console.log('\na relay that may have sent: held, and tried again through that relay only');
  {
    const hosts = [['seed.test', SEED], ['b.test', RB]];
    const {relay, A} = setup({'seed.test': {fee: 3n * 10n ** 13n, relayer: SEED}, 'b.test': {fee: 10n ** 13n, relayer: RB, mode: 'drop'}}, hosts, 87);
    await A.W.deposit({amount: E / 10n});
    const e = await fast(() => A.W.withdraw({to: DEST2, amount: E / 50n, via: null}))().catch((x) => x);
    ok(e?.inflight && !relay.relays['seed.test'] && A.W.inflight()[0]?.pay.rl?.url === U('b.test'), 'b said it sent and did not: the payment is held, with b as its relay, and the seed was not tried', `${e?.message ?? e}`);
    relay.hosts['b.test'].mode = 'send'; relay.hosts['b.test'].fee = 9n * 10n ** 13n;   // now dearer than the seed
    const h = await A.W.retry(A.W.inflight()[0].id, {via: null, onStep: () => {}, expectFee: String(9n * 10n ** 13n)}).catch((x) => x);
    ok(typeof h === 'string' && relay.relays['b.test'] === 2 && !relay.relays['seed.test'], 'tried again, it goes through b alone, though the seed is cheaper now', `${h?.message ?? ''} ${JSON.stringify(relay.relays)}`);
    relay.restore();
  }
  console.log('\na relay that sends and then says it refused: tried again only from the same notes');
  {
    // Two notes: b, the dearer of two near quotes (drawn here), is given the larger; the seed's lower fee would be covered by the
    // smaller. b keeps the transaction and answers 400, and it lands just before the seed's try.
    const hosts = [['seed.test', SEED], ['b.test', RB]], fees = {seed: 10n ** 13n, b: 12n * 10n ** 12n}, amount = E / 50n;
    const world = mkWorld(), sent = [];
    const relay = mockRelays(world.node, (t) => { const r = world.relayed(t); if (!r.revert) sent.push(t); return r; }, {'seed.test': {fee: fees.seed, relayer: SEED, stale409: true}, 'b.test': {fee: fees.b, relayer: RB, mode: 'refuse400late'}});
    const A = world.wallet(93, {keeper: U('seed.test'), relays: list(hosts)});
    await A.W.deposit({amount: amount + 11n * 10n ** 12n});            // covers the seed's fee, not b's
    await A.W.deposit({amount: amount + 15n * 10n ** 12n});
    const rnd = Math.random;
    Math.random = () => 0.999;
    const e = await A.W.withdraw({to: DEST2, amount, via: null}).catch((x) => x).finally(() => { Math.random = rnd; });
    ok(relay.relays['b.test'] === 1 && relay.relays['seed.test'] >= 1, 'b turned it away and the seed was asked next', JSON.stringify(relay.relays));
    ok(sent.length === 1 && typeof e !== 'string', 'only b\'s transaction landed: the seed\'s try spent the same note, so it could not land beside it', `${sent.length} landed · ${e?.message ?? e}`);
    await A.W.sync();
    ok(A.W.summary().balance === amount + 26n * 10n ** 12n - fees.b, 'the balance shows one payment and one fee', String(A.W.summary().balance));
    const again = await A.W.withdraw({to: DEST2, amount, via: null}).catch((x) => x);
    ok(again.duplicate === true && /may have landed/.test(again.message), 'pressed again, it is held back: a note the relay was given is spent', String(again?.message || again).slice(0, 80));
    relay.restore();
  }
  console.log('\nthe list cannot be read: the seed alone');
  {
    const world = mkWorld(), relay = mockRelays(world.node, world.relayed, {'seed.test': {fee: 2n * 10n ** 13n, relayer: SEED}});
    const A = world.wallet(89, {keeper: U('seed.test'), relays: async () => { throw new Error('registry unreachable'); }});
    await A.W.deposit({amount: E / 10n});
    const h = await pay(A, relay);
    ok(typeof h === 'string' && relay.relays['seed.test'] === 1, 'the payment goes through the page\'s own relay', h?.message || h);
    relay.restore();
  }
  console.log('\nthe seed gone: a listed relay carries it');
  {
    const hosts = [['seed.test', SEED], ['b.test', RB]];
    const {relay, A} = setup({'seed.test': {fee: 0n, relayer: SEED, mode: 'down'}, 'b.test': {fee: 10n ** 13n, relayer: RB}}, hosts, 91);
    await A.W.deposit({amount: E / 10n});
    const h = await pay(A, relay);
    ok(typeof h === 'string' && relay.relays['b.test'] === 1, 'with the page\'s own relay unreachable, the listed one takes the payment', h?.message || h);
    relay.restore();
  }
  console.log('\na relay\'s private-route key, signed by its listed address');
  {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), {createHash} = await import('node:crypto');
    const {mod} = await import('./page-config.mjs'), a = mod.indexOf('function makePoolWallet('), end = mod.indexOf('\n}\n', a) + 3, s = mod.indexOf('const ROUTE = (() => {'), e = mod.indexOf('\n})();', s) + 6;
    const body = `${mod.slice(0, end)}\n${mod.slice(mod.indexOf('const group ='), mod.indexOf('\nconst ethStr', mod.indexOf('const group =')))}\n${mod.slice(s, e)}\nexport { ROUTE };\n`;
    const file = path.join(os.tmpdir(), `tacit-route-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.mjs`);
    fs.writeFileSync(file, body);
    const {ROUTE} = await import(file);
    // a document the outside operator's relay serves (signed by 0x35cc…, its listed address)
    const doc = {relayer: '0x35cc8579fc9c0ef78574e9ca757eba2c2d10f7cc', key: '03b2ae32dbb9c044ed5f0a552d9617efdaf6ad44eb3f179b6cfbf93b966aec30eb', kid: '2c4aa8eb', sig: '18a96fe737838edc85312ba2947a02b886074582072a9456732511fec10741ee3af1193aebab644431cdccc7445c1797c46899061bd32ea507054e97ca080b2d1c'};
    const R35 = '0x35Cc8579FC9c0EF78574E9cA757EBa2C2D10f7cC';
    ok(ROUTE.verifyDoc(doc, R35) === doc.key, 'the document its own address signed is taken', String(ROUTE.verifyDoc(doc, R35)));
    ok(ROUTE.verifyDoc(doc, '0x3909A77e264c5093d1670f0AdAa098Af169e6168') === null, 'under another listed address it is not');
    ok(ROUTE.verifyDoc({...doc, key: '02' + doc.key.slice(2)}, R35) === null && ROUTE.verifyDoc({...doc, kid: '00000000'}, R35) === null && ROUTE.verifyDoc({...doc, sig: doc.sig.replace(/^../, '19')}, R35) === null, 'a changed key, kid or signature is not');
    ok(await ROUTE.relayFetch('https://other.example/1/evm-pool/keeper/quote', {}).then(() => false, () => true), 'a relay with no address to pin is not reached on the route');
  }
  console.log('\nthe relay registry\'s reply and the signed key');
  {
    const url = 'https://r.example/1/evm-pool/keeper', reply = ABI.encode(['address[]', 'uint256[]', 'string[]', 'uint256'], [[RA], [1000n], [url], 0n]);
    const page = lib.RL.decodeList(reply);
    ok(page?.entries.length === 1 && page.entries[0].relayer === RA && page.entries[0].url === url && page.next === 0, 'a reply in the contract\'s shape is read', String(page?.entries?.length));
    ok(lib.RL.decodeList('0x1234') === null && lib.RL.decodeList(reply.slice(0, -64)) === null, 'a short or broken reply is refused');
    ok(lib.RL.usable(url) && !lib.RL.usable('http://r.example/1/evm-pool/keeper') && !lib.RL.usable('https://10.0.0.1/1/evm-pool/keeper') && !lib.RL.usable('https://x.internal/1/evm-pool/keeper'), 'only a public https host that ends where the relay serves is used');
  }
}

console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
