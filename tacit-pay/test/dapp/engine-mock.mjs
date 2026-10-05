/* A chain in memory for the page's wallet engine: a pool's Transact and Received logs, a tree that follows them, Multicall3,
   deposit-address balances, and the knobs a test turns (a lagging node, a node with no Multicall3). The engine is the part
   of dapp/page.html up to the end of makePoolWallet, taken out of the page as it ships. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mod} from './page-config.mjs';

const {Interface, AbiCoder, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);

const a = mod.indexOf('function makePoolWallet('), end = mod.indexOf('\n}\n', a) + 3;
if (a < 0 || end < 3) throw new Error('page layout changed: makePoolWallet');
// The engine's messages write amounts with the page's own formatting, which the page defines further down.
const f0 = mod.indexOf('const group ='), f1 = mod.indexOf('\nconst ethStr', f0);
if (f0 < 0 || f1 < 0) throw new Error('page layout changed: fmt');
const body = `${mod.slice(0, end)}\n${mod.slice(f0, f1)}\nexport { headOf, jsonRpc, aggregate, makePoolWallet, poolKeys, sealNote, poolAsset, incTree, H, hex, unhex, T_TRANSACT, T_RECEIVED, leafOf, receiveRho, receiveKeys, receiveBoxAddress };\n`;
const file = path.join(os.tmpdir(), `tacit-pay-engine-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.mjs`);
fs.writeFileSync(file, body);
export const lib = await import(file);
const {makePoolWallet, poolKeys, sealNote, poolAsset, incTree, hex, T_TRANSACT, T_RECEIVED, leafOf, receiveRho, receiveKeys, receiveBoxAddress} = lib;

export const POOL = '0x000000c2A20657CE25f2Ba99737933D031AFBEE9', ROUTER = '0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5', MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const iface = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)', 'function getEthBalance(address) view returns (uint256)']);
const coder = AbiCoder.defaultAbiCoder();
const h32 = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0');
const rnd = () => BigInt(Math.floor(Math.random() * 2 ** 50)) + 1n;

export function mkNode({deployBlock = 100, multicall = true} = {}) {
  const node = {tip: deployBlock + 10, logs: [], size: 0, tree: incTree(), roots: new Map(), balances: new Map(), calls: [], multicall, lag: 0, rootLagCalls: 0, txn: 0, receipts: new Map(), spent: new Set(), sizes: [[deployBlock, 0]], logReads: []};
  node.roots.set(String(node.tree.root), 0);
  // The leaf count as of a block, for a read at a block tag.
  node.sizeAt = (tag) => { if (typeof tag !== 'string' || !/^0x[0-9a-f]+$/i.test(tag)) return node.size; const b = parseInt(tag, 16); let s = 0; for (const [at, n] of node.sizes) if (at <= b) s = n; return s; };
  node.addTransact = ({block, nf, outs, ext = 0n, memos = ['0x', '0x']}) => {
    const first = node.size, leaves = outs.map((o) => o ?? 0n);
    node.tree.append(leaves, []); node.size += 2; node.roots.set(String(node.tree.root), node.size); node.sizes.push([block, node.size]);
    for (const x of nf) if (BigInt(x)) node.spent.add(BigInt(x));
    const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(leaves[0]), h32(leaves[1]), first, h32(node.tree.root), '0x' + '00'.repeat(20), ext, '0x' + '00'.repeat(20), 0n, memos[0], memos[1]]);
    const txh = '0x' + (++node.txn).toString(16).padStart(64, '0');
    const log = {address: POOL, topics: [T_TRANSACT, h32(nf[0]), h32(nf[1])], data, blockNumber: '0x' + block.toString(16), transactionHash: txh, logIndex: '0x0'};
    node.logs.push(log);
    node.receipts.set(txh, {status: '0x1', logs: [log], blockNumber: '0x' + block.toString(16)});
    return txh;
  };
  // A deposit the pool never saw, as a node that makes one up would serve it: a log, but no root and no leaf in the pool.
  node.addPhantom = ({block, keys, value}) => {
    const sealed = sealNote({to: keys, value, asset: poolAsset(1, POOL)}), t = node.tree.clone();
    t.append([sealed.leaf, 0n]);
    const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(sealed.leaf), h32(0n), node.size, h32(t.root), '0x' + '00'.repeat(20), value, '0x' + '00'.repeat(20), 0n, '0x' + hex(sealed.memo), '0x']);
    node.logs.push({address: POOL, topics: [T_TRANSACT, h32(rnd()), h32(rnd())], data, blockNumber: '0x' + block.toString(16), transactionHash: '0x' + (++node.txn).toString(16).padStart(64, '0'), logIndex: '0x0'});
  };
  const rpc = async (method, params = []) => {
    node.calls.push(method);
    if (method === 'eth_blockNumber') return '0x' + (node.tip - node.lag).toString(16);
    if (method === 'eth_getBalance') return '0x' + (node.balances.get(params[0].toLowerCase()) ?? 0n).toString(16);
    if (method === 'eth_getTransactionReceipt') return node.receipts.get(params[0]) ?? null;
    if (method === 'eth_getLogs') {
      const f = params[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      node.logReads.push(from);
      return node.logs.filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && (!f.topics || f.topics.every((t, i) => !t || (Array.isArray(t) ? t.includes(l.topics[i]) : t === l.topics[i]))));
    }
    if (method === 'eth_call') {
      const {to, data} = params[0], sel = data.slice(0, 10), size = node.sizeAt(params[1]);
      if (to.toLowerCase() === MULTICALL.toLowerCase()) {
        if (!node.multicall) return '0x';
        const [calls] = iface.decodeFunctionData('aggregate3', data);
        const res = calls.map((c) => {
          if (c.target.toLowerCase() === POOL.toLowerCase()) return [true, coder.encode(['uint256'], [size])];
          if (c.target.toLowerCase() === MULTICALL.toLowerCase()) { const [x] = iface.decodeFunctionData('getEthBalance', c.callData); return [true, coder.encode(['uint256'], [node.balances.get(x.toLowerCase()) ?? 0n])]; }
          return [false, '0x'];
        });
        return iface.encodeFunctionResult('aggregate3', [res]);
      }
      if (to.toLowerCase() === POOL.toLowerCase()) {
        if (sel === id('nextIndex()').slice(0, 10)) return coder.encode(['uint256'], [size]);
        if (sel === id('nullified(bytes32)').slice(0, 10)) return coder.encode(['bool'], [node.spent.has(BigInt('0x' + data.slice(10)))]);
        if (sel === id('rootSize(bytes32)').slice(0, 10)) {
          const r = BigInt('0x' + data.slice(10));
          if (node.rootLagCalls > 0) { node.rootLagCalls--; return coder.encode(['uint256'], [0n]); }
          return coder.encode(['uint256'], [node.roots.get(String(r)) ?? 0n]);
        }
      }
      throw new Error('mock eth_call ' + to + ' ' + sel);
    }
    throw new Error('mock ' + method);
  };
  rpc.batch = async (calls) => Promise.all(calls.map(([m, p]) => rpc(m, p).then((result) => ({result}), (error) => ({error}))));
  node.rpc = rpc;
  return node;
}

export function mkWallet(node, {keeper = null, confirmations = 3, deployBlock = 100, vote, head, key = new Uint8Array(32).fill(7), prove = null} = {}) {
  const keys = poolKeys(key);
  const chain = {chainId: 1, pool: POOL, router: ROUTER, rpc: node.rpc, deployBlock, confirmations, keeper, vote, head};
  const W = makePoolWallet({chain, keys, prove, store: null, signer: null, feed: !!keeper});
  return {W, keys, chain};
}
export const asset = poolAsset(1, POOL);
/** A deposit note of `value` for `keys` at `block`. */
export function depositTo(node, keys, value, block) {
  const s = sealNote({to: keys, value, asset});
  return node.addTransact({block, nf: [rnd(), rnd()], outs: [s.leaf, null], ext: value, memos: ['0x' + hex(s.memo), '0x']});
}

/** A sweep of `value` into deposit address `i` of `keys` at `block`, as the router does it: the note's leaf, and a Received log. */
export function sweepTo(node, keys, i, value, block) {
  const npk = receiveKeys(keys, i).npk, box = receiveBoxAddress(ROUTER, npk), rho = receiveRho(box, 0n), first = node.size;
  const h = node.addTransact({block, nf: [0n, 0n], outs: [leafOf(asset, value, npk, rho), null], ext: value});
  node.logs.push({address: ROUTER, topics: [T_RECEIVED, '0x' + box.slice(2).toLowerCase().padStart(64, '0'), h32(0n)], data: coder.encode(['uint256', 'uint256', 'uint256', 'uint256'], [first, value, rho, 0n]), blockNumber: '0x' + block.toString(16), transactionHash: h, logIndex: '0x1'});
  return h;
}
/** A sweep the pool never saw, as a lying node or index would serve it: the two logs, but no root and no leaf in the pool. */
export function fakeSweep(node, keys, i, value, block) {
  const npk = receiveKeys(keys, i).npk, box = receiveBoxAddress(ROUTER, npk), rho = 12345n, leaf = leafOf(asset, value, npk, rho);
  const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(leaf), h32(0n), node.size, h32(999n), '0x' + '00'.repeat(20), value, '0x' + '00'.repeat(20), 0n, '0x', '0x']);
  const txh = '0x' + (++node.txn).toString(16).padStart(64, '0');
  node.logs.push({address: POOL, topics: [T_TRANSACT, h32(rnd()), h32(0n)], data, blockNumber: '0x' + block.toString(16), transactionHash: txh, logIndex: '0x0'});
  node.logs.push({address: ROUTER, topics: [T_RECEIVED, '0x' + box.slice(2).toLowerCase().padStart(64, '0'), h32(0n)], data: coder.encode(['uint256', 'uint256', 'uint256', 'uint256'], [node.size, value, rho, 0n]), blockNumber: '0x' + block.toString(16), transactionHash: txh, logIndex: '0x1'});
}

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TXI = new Interface(['function transact(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,uint256[11] publicInputs,address recipient,int256 extAmount,address relayer,uint256 fee,bytes memo0,bytes memo1)']);
/** Wallets that spend for real on the chain in memory: a prover that returns the witness's public signals, and a signer that
 *  applies transact() the way the pool does (root, insertion index, nullifiers, the public amount). */
export function mkWorld() {
  const node = mkNode();
  node.tip = 130;
  const apply = (data, value = 0n) => {
    const d = TXI.decodeFunctionData('transact', data), pi = d.publicInputs.map(BigInt), inserts = pi[9] !== 0n || pi[10] !== 0n;
    if (inserts && (pi[1] !== node.tree.root || Number(pi[3]) !== node.size)) return {revert: 'StaleRoot'};
    if (!node.roots.has(String(pi[0]))) return {revert: 'UnknownMembershipRoot'};
    for (const nf of [pi[7], pi[8]]) if (nf && node.spent.has(nf)) return {revert: 'AlreadyNullified'};
    const ext = BigInt(d.extAmount);
    if (pi[4] !== ((ext - BigInt(d.fee)) % FR + FR) % FR) return {revert: 'BadProof'};
    if (ext > 0n && BigInt(value) !== ext) return {revert: 'EthValueMismatch'};
    node.tip++;
    let h;
    if (inserts) h = node.addTransact({block: node.tip, nf: [pi[7], pi[8]], outs: [pi[9], pi[10]], ext, memos: [d.memo0, d.memo1]});
    else {
      for (const nf of [pi[7], pi[8]]) if (nf) node.spent.add(nf);
      const data2 = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(0n), h32(0n), node.size, h32(node.tree.root), d.recipient, ext, d.relayer, BigInt(d.fee), d.memo0, d.memo1]);
      h = '0x' + (++node.txn).toString(16).padStart(64, '0');
      const log = {address: POOL, topics: [T_TRANSACT, h32(pi[7]), h32(pi[8])], data: data2, blockNumber: '0x' + node.tip.toString(16), transactionHash: h, logIndex: '0x0'};
      node.logs.push(log); node.receipts.set(h, {status: '0x1', logs: [log], blockNumber: log.blockNumber});
    }
    node.tip += 4;
    return {h};
  };
  const base = node.rpc;
  const rpc = async (m, p) => (m === 'eth_call' && p[0].to.toLowerCase() === POOL.toLowerCase() && p[0].data.startsWith(TXI.getFunction('transact').selector)) ? '0x' : base(m, p);
  rpc.batch = base.batch;
  const prove = async (input) => ({proof: {pi_a: ['1', '2'], pi_b: [['1', '2'], ['3', '4']], pi_c: ['5', '6']}, publicSignals: [input.root, input.oldRoot, input.newRoot, input.startIndex, input.publicAmount, input.extDataHash, input.asset, input.nf[0], input.nf[1], input.outLeaf[0], input.outLeaf[1]].map(String)});
  // `keeper`: a relay's base URL, answered by whatever the test puts in globalThis.fetch (`relayed` applies what it sends).
  const wallet = (seed, {send = null, keeper = null} = {}) => {
    const keys = poolKeys(new Uint8Array(32).fill(seed));
    const signer = {address: '0x' + '22'.repeat(20), ready: async () => {}, send: async ({data, value}) => { const r = apply(data, value); if (r.revert) throw new Error('reverted ' + r.revert); return send ? send(r.h) : r.h; }};
    const W = makePoolWallet({chain: {chainId: 1, pool: POOL, router: ROUTER, rpc, deployBlock: 100, confirmations: 3, keeper}, keys, prove, store: null, signer, feed: false});
    return {W, keys};
  };
  const relayed = (t) => apply(TXI.encodeFunctionData('transact', [t.pA, t.pB, t.pC, t.publicInputs, t.recipient, t.extAmount, t.relayer, t.fee, t.memo0, t.memo1]));
  return {node, wallet, apply, relayed};
}
