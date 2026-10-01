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
const body = `${mod.slice(0, end)}\nexport { jsonRpc, aggregate, makePoolWallet, poolKeys, sealNote, poolAsset, incTree, hex, unhex, T_TRANSACT, T_RECEIVED, leafOf, receiveRho, receiveKeys, receiveBoxAddress };\n`;
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
  const node = {tip: deployBlock + 10, logs: [], size: 0, tree: incTree(), roots: new Map(), balances: new Map(), calls: [], multicall, lag: 0, rootLagCalls: 0, txn: 0, receipts: new Map()};
  node.roots.set(String(node.tree.root), 0);
  node.addTransact = ({block, nf, outs, ext = 0n, memos = ['0x', '0x']}) => {
    const first = node.size, leaves = outs.map((o) => o ?? 0n);
    node.tree.append(leaves, []); node.size += 2; node.roots.set(String(node.tree.root), node.size);
    const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(leaves[0]), h32(leaves[1]), first, h32(node.tree.root), '0x' + '00'.repeat(20), ext, '0x' + '00'.repeat(20), 0n, memos[0], memos[1]]);
    const txh = '0x' + (++node.txn).toString(16).padStart(64, '0');
    const log = {address: POOL, topics: [T_TRANSACT, h32(nf[0]), h32(nf[1])], data, blockNumber: '0x' + block.toString(16), transactionHash: txh, logIndex: '0x0'};
    node.logs.push(log);
    node.receipts.set(txh, {status: '0x1', logs: [log], blockNumber: '0x' + block.toString(16)});
    return txh;
  };
  const rpc = async (method, params = []) => {
    node.calls.push(method);
    if (method === 'eth_blockNumber') return '0x' + (node.tip - node.lag).toString(16);
    if (method === 'eth_getBalance') return '0x' + (node.balances.get(params[0].toLowerCase()) ?? 0n).toString(16);
    if (method === 'eth_getTransactionReceipt') return node.receipts.get(params[0]) ?? null;
    if (method === 'eth_getLogs') {
      const f = params[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      return node.logs.filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && (!f.topics || f.topics.every((t, i) => !t || (Array.isArray(t) ? t.includes(l.topics[i]) : t === l.topics[i]))));
    }
    if (method === 'eth_call') {
      const {to, data} = params[0], sel = data.slice(0, 10);
      if (to.toLowerCase() === MULTICALL.toLowerCase()) {
        if (!node.multicall) return '0x';
        const [calls] = iface.decodeFunctionData('aggregate3', data);
        const res = calls.map((c) => {
          if (c.target.toLowerCase() === POOL.toLowerCase()) return [true, coder.encode(['uint256'], [node.size])];
          if (c.target.toLowerCase() === MULTICALL.toLowerCase()) { const [x] = iface.decodeFunctionData('getEthBalance', c.callData); return [true, coder.encode(['uint256'], [node.balances.get(x.toLowerCase()) ?? 0n])]; }
          return [false, '0x'];
        });
        return iface.encodeFunctionResult('aggregate3', [res]);
      }
      if (to.toLowerCase() === POOL.toLowerCase()) {
        if (sel === id('nextIndex()').slice(0, 10)) return coder.encode(['uint256'], [node.size]);
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

export function mkWallet(node, {keeper = null, confirmations = 3, deployBlock = 100, vote, key = new Uint8Array(32).fill(7), prove = null} = {}) {
  const keys = poolKeys(key);
  const chain = {chainId: 1, pool: POOL, router: ROUTER, rpc: node.rpc, deployBlock, confirmations, keeper, vote};
  const W = makePoolWallet({chain, keys, prove, store: null, signer: null, feed: !!keeper});
  return {W, keys, chain};
}
export const asset = poolAsset(1, POOL);
/** A deposit note of `value` for `keys` at `block`. */
export function depositTo(node, keys, value, block) {
  const s = sealNote({to: keys, value, asset});
  return node.addTransact({block, nf: [rnd(), rnd()], outs: [s.leaf, null], ext: value, memos: ['0x' + hex(s.memo), '0x']});
}
