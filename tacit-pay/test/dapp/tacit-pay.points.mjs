/* Catch-up points: the pool's tree edge at a count, posted on chain and kept only when the pool held its root. A wallet
   with nothing read yet starts from the newest point at once (its new notes spendable, with paths the pool's root
   checks), and reads the history behind it in the background, kept under its own name so another visit goes on from
   where it stopped; a point whose block is wrong, or an edge a lying node serves, is passed over for the chain itself.

   Usage: node test/dapp/tacit-pay.points.mjs                                                                       */
import {mkNode, mkWallet, depositTo, lib} from './engine-mock.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n, DEST = '0x' + '11'.repeat(20), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = lib.poolKeys(new Uint8Array(32).fill(5));
const mkStore = () => { const m = new Map(); return {m, get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); return true; }, del: (k) => m.delete(k)}; };
const settled = async (W, ms = 20_000) => { for (const t0 = Date.now(); W.older() !== null;) { if (Date.now() - t0 > ms) return false; await sleep(25); } return true; };
// A pool with 100 deposits to others and one to this key (0.3 ETH, block 201) before the point, posted at block 210,
// then ten more to others and one to this key (0.5 ETH, block 250) after it; the head at 300.
function world({pointBlock = 210, lie = false, point = true} = {}) {
  const node = mkNode(), keys = lib.poolKeys(new Uint8Array(32).fill(7));
  for (let i = 0; i < 100; i++) depositTo(node, other, E / 100n, 101 + i);
  depositTo(node, keys, 3n * E / 10n, 201);
  node.tip = 210;
  const size = point ? node.postPoint({block: pointBlock, lie}) : null;
  for (let i = 0; i < 10; i++) depositTo(node, other, E / 100n, 220 + i);
  depositTo(node, keys, 5n * E / 10n, 250);
  node.tip = 300;
  return {node, keys, size};
}

console.log('a wallet with nothing read starts at the point');
{
  const {node, size} = world(), store = mkStore();
  node.logDelay = (from) => (from < 211 ? 300 : 0);   // the older history takes its time, as on a real chain
  let witness = null;
  const {W} = mkWallet(node, {points: true, store, prove: async (input) => { witness = input; throw new Error('PROVE-CALLED'); }});
  const t0 = Date.now(), s = await W.sync();
  const firstRead = node.logReads[0];
  ok(s.balance === 5n * E / 10n && s.notes === 1, 'the first read shows the note after the point, and only that', `${s.balance} in ${Date.now() - t0} ms`);
  ok(firstRead === 211, 'and read the chain from the block after the point, not the first block', `first log read from ${firstRead}`);
  ok(W.older() !== null && W.older() < 1, 'the older history is still to be read', `older ${W.older()}`);
  ok(W.progress() === null || W.progress() >= 0, 'progress is from the point');
  const e = await W.withdraw({to: DEST, amount: 4n * E / 10n, via: 'self'}).catch((x) => x);
  ok(/PROVE-CALLED/.test(e.message) && BigInt(witness.root) === node.tree.root, 'the new note is spendable at once: its path checks against the pool’s root', `${e.message} root ok ${witness && BigInt(witness.root) === node.tree.root}`);
  const e2 = await W.withdraw({to: DEST, amount: 7n * E / 10n, via: 'self'}).catch((x) => x);
  ok(/does not cover/.test(e2.message), 'what is behind the point is not spendable yet', e2.message);
  ok(await settled(W), 'the older history is read in the background', `older ${W.older()}`);
  const s2 = W.summary();
  ok(s2.balance === 8n * E / 10n && s2.notes === 2, 'then the note from before the point shows', `${s2.balance}`);
  ok(Math.min(...node.logReads) === 100, 'read from the pool’s first block', `${Math.min(...node.logReads)}`);
  const e3 = await W.withdraw({to: DEST, amount: 7n * E / 10n, via: 'self'}).catch((x) => x);
  ok(/PROVE-CALLED/.test(e3.message) && BigInt(witness.root) === node.tree.root, 'and both notes prove against the pool’s root', e3.message);
  const slots = [...store.m.keys()];
  ok(slots.length === 1, 'the second state is gone from storage once joined', `${slots.length} slot(s)`);
  const again = mkWallet(node, {points: true, store}).W, s3 = await again.sync();
  ok(s3.balance === 8n * E / 10n && again.older() === null, 'a wallet opened from the stored state has everything, nothing left to read', `${s3.balance}`);
}

console.log('\nthe older history goes on from where a visit stopped');
{
  const node = mkNode({deployBlock: 100}), keys = lib.poolKeys(new Uint8Array(32).fill(7)), store = mkStore();
  depositTo(node, keys, E / 10n, 150);
  for (let i = 0; i < 20; i++) depositTo(node, other, E / 100n, 120_000 + i);
  depositTo(node, keys, E / 10n, 250_000);
  node.tip = 350_000;
  node.postPoint({block: 350_000});
  depositTo(node, keys, E / 10n, 350_010);
  node.tip = 350_100;
  // The chain stops answering log reads past block 250,000 for this visit.
  const rpc0 = node.rpc, gate = {cut: 250_000};
  const rpc1 = async (m, p) => { if (m === 'eth_getLogs' && parseInt(p[0].toBlock, 16) > gate.cut && parseInt(p[0].fromBlock, 16) < 340_000) throw new Error('node down'); return rpc0(m, p); };
  rpc1.batch = rpc0.batch;
  node.rpc = rpc1;
  const W1 = mkWallet(node, {points: true, store}).W, s1 = await W1.sync();
  ok(s1.balance === E / 10n, 'the visit sees the note after the point', `${s1.balance}`);
  for (const t0 = Date.now(); W1.older() === 0 && Date.now() - t0 < 5000;) await sleep(20);
  await sleep(200);
  const got = W1.older();
  ok(got > 0 && got < 1, 'the older history was read partway and kept', `older ${got}`);
  const reads1 = node.logReads.length;
  gate.cut = Infinity;
  const W2 = mkWallet(node, {points: true, store}).W, s2 = await W2.sync();
  ok(s2.balance === E / 10n && W2.older() > 0, 'the next visit opens with the point’s state and the partial older read', `older ${W2.older()}`);
  ok(await settled(W2), 'and finishes the older history');
  const later = node.logReads.slice(reads1).filter((b) => b < 340_000);
  ok(Math.min(...later) >= 200_000, 'from where the last visit stopped, not from the first block', `reads from ${Math.min(...later)}`);
  ok(W2.summary().balance === 3n * E / 10n && W2.summary().notes === 3, 'every note shows', `${W2.summary().balance}`);
}

console.log('\na point whose block is wrong, and one a lying node serves');
{
  // Too late: the point is the tree at block 210, but says 260; the events read after it do not start where it ends.
  const {node} = world({pointBlock: 260});
  const {W} = mkWallet(node, {points: true});
  const t0 = Date.now(), s = await W.sync();
  ok(s.balance === 8n * E / 10n && W.older() === null, 'the point is passed over and the chain read from its first block', `${s.balance} older ${W.older()} in ${Date.now() - t0} ms`);
}
{
  // Too early: a point that says a block before the tree reached its count only costs reading events already in the edge.
  const {node} = world({pointBlock: 120});
  const {W} = mkWallet(node, {points: true});
  const s = await W.sync();
  ok(s.balance === 5n * E / 10n && W.older() !== null, 'an early block is harmless: the point is used', `${s.balance}`);
  ok(await settled(W) && W.summary().balance === 8n * E / 10n, 'and the older history completes the balance', `${W.summary().balance}`);
}
{
  const {node} = world({lie: true});
  const {W} = mkWallet(node, {points: true});
  const s = await W.sync();
  ok(s.balance === 8n * E / 10n && W.older() === null, 'an edge the pool never held is refused before anything is read from it', `${s.balance}`);
}
{
  const {node} = world({point: false});
  const {W} = mkWallet(node, {points: true});
  const s = await W.sync();
  ok(s.balance === 8n * E / 10n && W.older() === null && Math.min(...node.logReads) === 100, 'with no point posted yet, the chain is read from its first block', `${s.balance}`);
}

console.log('\nrebuilding from the chain');
{
  const {node} = world(), store = mkStore();
  const {W} = mkWallet(node, {points: true, store});
  await W.sync(); await settled(W);
  node.logReads.length = 0;
  node.logDelay = (from) => (from < 211 ? 200 : 0);
  const s = await W.rescan();
  ok(s.balance === 5n * E / 10n && W.older() !== null && node.logReads[0] === 211, 'a rebuild starts from the point again', `${s.balance} first read ${node.logReads[0]}`);
  ok(await settled(W) && W.summary().balance === 8n * E / 10n, 'and reads the older history again behind it', `${W.summary().balance}`);
}

console.log('\nposting a point');
{
  const {node} = world({point: false});
  const {W} = mkWallet(node, {points: true});
  await W.sync();
  const e = await W.postPoint().catch((x) => x);
  ok(/Connect a wallet/.test(e.message), 'a post goes from the wallet, so it needs one', e.message);
  ok((await W.latestPoint()) === null, 'no point yet');
  node.postPoint({block: 300});
  const p = await W.latestPoint();
  ok(p && p.size === node.size && p.block === 300, 'the latest point is read back', JSON.stringify(p));
}

console.log('\nthe root of a tree from its edge');
{
  const tree = lib.incTree(), leaves = Array.from({length: 777}, (_, i) => BigInt(i + 1) * 7919n);
  tree.append(leaves);
  const e = tree.edge();
  ok(lib.edgeRoot(e.size, e.filled) === tree.root, 'folds to the tree’s root');
  const t2 = lib.treeFromEdge(e.size, e.filled);
  tree.append([5n, 6n], [777]); t2.append([5n, 6n], [777]);
  ok(t2.root === tree.root && lib.rootFromPath(5n, 777, t2.path(777)) === t2.root, 'and the tree goes on from the edge with the same roots and paths');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
