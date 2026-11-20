/* Helpers for tornado.fork.mjs: an anvil fork of Ethereum mainnet, a node `read`, a wallet that signs with an ethers key,
   the page's own prover source (TC.WORKER) in a node worker thread, and an in-process ERC-4337 bundler that submits
   EntryPoint v0.8 handleOps to the fork as a type-4 transaction carrying the operation's EIP-7702 authorization.      */
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';

const E = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
export const ethers = E;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hx = (v) => '0x' + BigInt(v).toString(16);
const ANVIL = process.env.ANVIL || '/Users/z/.foundry/bin/anvil';

async function post(url, method, params = [], { timeoutMs = 180_000 } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message}`), { rpc: j.error, data: j.error.data });
  return j.result;
}
// The fork's upstream node fails now and then (5xx, timeouts, throttling): asked again when the error is the node's.
const upstreamFault = (e) => /failed to get|HTTP error|error sending request|timed out|timeout|429|50[234]|rate limit|temporarily|connection|ECONNRESET|fetch failed|-32603/i.test(String(e?.message));
export async function retrying(fn, { tries = 6, label = 'a call', delay = 3000 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (!upstreamFault(e) || i >= tries) throw e;
      console.log(`    (${label}: upstream fault, attempt ${i}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 100)})`);
      await sleep(delay * i);
    }
  }
}
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** Forks mainnet at a recent block. Returns { url, rpc, forkBlock, upstream, stop }. */
export async function startAnvil({ upstreams = (process.env.FORK ? [process.env.FORK] : ['https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']), hardfork = process.env.HARDFORK || 'prague' } = {}) {
  let upstream = null, head = null;
  for (const u of upstreams) {
    try { head = Number(BigInt(await post(u, 'eth_blockNumber', [], { timeoutMs: 15_000 }))); upstream = u; break; } catch (e) { console.log(`    (upstream ${u} did not answer: ${e.message.slice(0, 80)})`); }
  }
  if (!upstream) throw new Error('no upstream node answered');
  const forkBlock = head - 2, port = await freePort(), url = `http://127.0.0.1:${port}`;
  const args = ['--port', String(port), '--fork-url', upstream, '--fork-block-number', String(forkBlock), '--chain-id', '1', '--hardfork', hardfork, '--silent',
    '--compute-units-per-second', '100', '--retries', '15', '--timeout', '120000', '--fork-retry-backoff', '2000'];
  const child = spawn(ANVIL, args, { stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const kill = () => { if (!exited) { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
  process.on('exit', kill);
  const rpc = (method, params = []) => retrying(() => post(url, method, params), { label: method });
  for (let i = 0; ; i++) {
    if (exited) throw new Error('anvil exited at start');
    try { await post(url, 'eth_chainId', [], { timeoutMs: 2000 }); break; } catch { if (i > 300) { kill(); throw new Error('anvil did not start'); } await sleep(200); }
  }
  const stop = async () => { kill(); for (let i = 0; i < 50 && !exited; i++) await sleep(100); };
  return { url, rpc, forkBlock, upstream, pid: child.pid, stop };
}

/** The page's `wallet(method, params)` for an ethers key: typed-data signatures, and transactions it signs and sends. */
export function makeWallet({ key, rpc, onSend = () => {} }) {
  const w = new E.Wallet(key);
  const wallet = async (method, params) => {
    if (method === 'eth_signTypedData_v4') {
      if (String(params[0]).toLowerCase() !== w.address.toLowerCase()) throw new Error('wrong account');
      const td = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      const types = { ...td.types };
      delete types.EIP712Domain;
      return w.signTypedData(td.domain, types, td.message);
    }
    if (method === 'eth_sendTransaction') {
      const t = params[0];
      if (String(t.from).toLowerCase() !== w.address.toLowerCase()) throw new Error('wrong account');
      if (t.chainId != null && BigInt(t.chainId) !== 1n) throw new Error('wrong chain');
      const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [w.address, 'pending'])));
      const est = BigInt(await rpc('eth_estimateGas', [{ from: w.address, to: t.to, value: t.value || '0x0', data: t.data || '0x' }]));
      const block = await rpc('eth_getBlockByNumber', ['latest', false]);
      const tip = 10n ** 8n, maxFee = BigInt(block.baseFeePerGas) * 2n + tip;
      const raw = await w.signTransaction({ type: 2, chainId: 1, nonce, to: t.to, value: BigInt(t.value || 0), data: t.data || '0x', gasLimit: est * 13n / 10n + 20_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
      const hash = await rpc('eth_sendRawTransaction', [raw]);
      onSend({ hash, to: t.to, value: BigInt(t.value || 0) });
      return hash;
    }
    throw new Error(`wallet: ${method} not supported`);
  };
  return { address: w.address, wallet, signer: w };
}

/** A prover with the page's interface, running the page's own worker source in a node worker thread. */
export function threadProver({ source, wasmBytes }) {
  const boot = `const { parentPort, workerData } = require('node:worker_threads');
globalThis.self = { postMessage: (m) => parentPort.postMessage(m) };
require('node:vm').runInThisContext(workerData.source, { filename: 'tc-worker.js' });
parentPort.on('message', (data) => self.onmessage({ data }));`;
  const w = new Worker(boot, { eval: true, workerData: { source } });
  const waiting = new Map();
  let n = 1, ready = null;
  const stats = { loads: 0, proves: 0, proveMs: [], treeMs: [] };
  w.on('message', (data) => { const p = waiting.get(data.id); if (!p) return; waiting.delete(data.id); if (data.ok) p.resolve(data); else p.reject(new Error(data.error)); });
  w.on('error', (e) => { for (const p of waiting.values()) p.reject(e); waiting.clear(); });
  const ask = (msg) => new Promise((resolve, reject) => { const id = n++; waiting.set(id, { resolve, reject }); w.postMessage({ id, ...msg }); });
  const loaded = () => (ready ||= ask({ type: 'init', wasm: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.length) }));
  return {
    stats,
    async load(bytes) { await loaded(); stats.loads++; const t = Date.now(); const r = await ask({ type: 'tree', leaves: Uint8Array.from(bytes) }); stats.treeMs.push(Date.now() - t); return { root: r.root, leaves: r.leaves }; },
    async prove(args) { await loaded(); stats.proves++; const t = Date.now(); const r = await ask({ type: 'prove', chainId: 1, ...args }); stats.proveMs.push(Date.now() - t); return JSON.parse(r.result); },
    close() { w.terminate(); },
  };
}

// ---- the mock bundler ----
const EP_ABI = new E.Interface([
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) op) view returns (bytes32)',
  'function balanceOf(address) view returns (uint256)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)',
  'event PostOpRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)',
  'error FailedOp(uint256 opIndex, string reason)',
  'error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)',
]);
const PM_ABI = new E.Interface([
  'function validatePaymasterUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) op, bytes32 userOpHash, uint256 maxCost) returns (bytes context, uint256 validationData)',
  'function postOp(uint8 mode, bytes context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)',
]);
const ACCT_ABI = new E.Interface(['function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) op, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256)']);
export { EP_ABI };
const u128 = (v) => E.toBeHex(BigInt(v), 16);
const pack2 = (hi, lo) => E.concat([u128(hi), u128(lo)]);
/** The v0.8 PackedUserOperation of a bundler-RPC operation. */
export function packOp(op) {
  const pmd = op.paymaster ? E.concat([op.paymaster, u128(op.paymasterVerificationGasLimit), u128(op.paymasterPostOpGasLimit), op.paymasterData || '0x']) : '0x';
  if (op.factory) throw new Error('mock bundler: no factories');
  return {
    sender: op.sender, nonce: BigInt(op.nonce), initCode: '0x', callData: op.callData,
    accountGasLimits: pack2(op.verificationGasLimit, op.callGasLimit), preVerificationGas: BigInt(op.preVerificationGas),
    gasFees: pack2(op.maxPriorityFeePerGas, op.maxFeePerGas), paymasterAndData: pmd, signature: op.signature,
  };
}
const calldataGas = (data) => { let g = 0n; for (const b of E.getBytes(data)) g += b ? 16n : 4n; return g; };
const errText = (e) => { const d = e?.data ?? e?.rpc?.data; if (typeof d === 'string' && d.length >= 10) { try { const p = EP_ABI.parseError(d); if (p) return `${p.args.reason}${p.args.inner ? ' ' + p.args.inner : ''}`; } catch { /* raw */ } return d; } return String(e?.message || e); };

/**
 * An in-process bundler as a `fetchImpl`. `mode.estimate`: 'real' (measures the paymaster's and the account's validation,
 * the account's call and the postOp on the fork), 'opaque' (the estimator failure the page treats as the bundler's own) or 'aa33' (answers as Pimlico does when its estimator puts a nonzero callGasLimit in a
 * no-call operation: the paymaster's CallGasLimitNonZero(uint256) revert). `price()` gives { maxFeePerGas, maxPriorityFeePerGas }.
 */
export function mockBundler({ rpc, key, entryPoint, price, log = [] }) {
  const bundler = new E.Wallet(key);
  const ops = new Map();   // hash -> { op, txHash }
  const mode = { estimate: 'real' };
  const state = { sends: 0, estimates: [], handleOps: [] };
  const methods = {
    async pimlico_getUserOperationGasPrice() { const p = await price(); const o = { maxFeePerGas: hx(p.maxFeePerGas), maxPriorityFeePerGas: hx(p.maxPriorityFeePerGas) }; return { slow: o, standard: o, fast: o }; },
    async eth_supportedEntryPoints() { return [entryPoint]; },
    async eth_estimateUserOperationGas([op, ep]) {
      if (String(ep).toLowerCase() !== entryPoint.toLowerCase()) throw { code: -32602, message: 'unsupported entry point' };
      if (mode.estimate === 'opaque') { state.estimates.push({ mode: 'opaque' }); throw { code: -32603, message: 'Unknown error, could not parse simulate validation result.' }; }
      if (mode.estimate === 'aa33') { state.estimates.push({ mode: 'aa33' }); throw { code: -32500, message: 'UserOperation reverted during simulation with reason: AA33 reverted 0x54107e37' + (10_000_000n).toString(16).padStart(64, '0') }; }
      const packed = packOp(op), hash = await rpc('eth_call', [{ to: entryPoint, data: EP_ABI.encodeFunctionData('getUserOpHash', [packed]) }, 'latest']);
      const maxCost = (BigInt(op.verificationGasLimit) + BigInt(op.callGasLimit) + BigInt(op.paymasterVerificationGasLimit) + BigInt(op.paymasterPostOpGasLimit) + BigInt(op.preVerificationGas)) * BigInt(op.maxFeePerGas);
      const intrinsic = (data) => 21_000n + calldataGas(data);
      const sim = async (to, data, override) => {
        try { return BigInt(await rpc('eth_estimateGas', [{ from: entryPoint, to, data, gas: hx(5_000_000) }, 'latest', ...(override ? [override] : [])])) - intrinsic(data); } catch (e) { throw { code: -32500, message: `simulation of ${to} reverted: ${errText(e)}` }; }
      };
      // the account: its validation with the delegation in place (the 7702 code is only there once the authorization lands)
      const delegated = { [op.sender]: { code: '0xef0100' + op.eip7702Auth.address.slice(2).toLowerCase() } };
      const vgl = await sim(op.sender, ACCT_ABI.encodeFunctionData('validateUserOp', [packed, hash, 0n]), delegated);
      // the paymaster's validation: the whole withdrawal with its proof, from the EntryPoint
      const pmData = PM_ABI.encodeFunctionData('validatePaymasterUserOp', [packed, hash, maxCost]);
      const pvgl = await sim(op.paymaster, pmData);
      const [context] = PM_ABI.decodeFunctionResult('validatePaymasterUserOp', await rpc('eth_call', [{ from: entryPoint, to: op.paymaster, data: pmData, gas: hx(5_000_000) }, 'latest']));
      // postOp after that validation: the refund to the recipient (state the validation left is not kept, so the
      // paymaster's balance for the refund is given to it here)
      let post = 0n;
      if (context !== '0x') post = await sim(op.paymaster, PM_ABI.encodeFunctionData('postOp', [0, context, maxCost / 3n, BigInt(op.maxFeePerGas)]), { [op.paymaster]: { balance: hx(10n ** 18n) } });
      // the account's call (a swap-out's execute), run as the EntryPoint runs it once the note has paid the account
      let cgl = 0n;
      if (op.callData && op.callData !== '0x') cgl = await sim(op.sender, op.callData, { [op.sender]: { code: '0xef0100' + op.eip7702Auth.address.slice(2).toLowerCase(), balance: hx(100n * 10n ** 18n) } });
      const handle = EP_ABI.encodeFunctionData('handleOps', [[packed], bundler.address]);
      const pvg = 21_000n + calldataGas(handle) + 25_000n + 15_000n;   // the transaction, its data, the authorization, overhead
      const r = { preVerificationGas: hx(pvg), verificationGasLimit: hx(vgl + 10_000n), callGasLimit: hx(cgl > 0n ? cgl + 10_000n : 0n), paymasterVerificationGasLimit: hx(pvgl + 10_000n), paymasterPostOpGasLimit: hx(post + 5_000n) };
      state.estimates.push({ mode: 'real', ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, BigInt(v)])) });
      return r;
    },
    async eth_sendUserOperation([op, ep]) {
      if (String(ep).toLowerCase() !== entryPoint.toLowerCase()) throw { code: -32602, message: 'unsupported entry point' };
      const packed = packOp(op), hash = await rpc('eth_call', [{ to: entryPoint, data: EP_ABI.encodeFunctionData('getUserOpHash', [packed]) }, 'latest']);
      if (ops.has(hash)) throw { code: -32602, message: 'AA25 already known' };
      const a = op.eip7702Auth;
      const authorizationList = a ? [{ address: a.address, chainId: BigInt(a.chainId), nonce: BigInt(a.nonce), signature: { r: a.r, s: a.s, yParity: Number(BigInt(a.yParity)) } }] : null;
      const data = EP_ABI.encodeFunctionData('handleOps', [[packed], bundler.address]);
      const gasLimit = BigInt(op.verificationGasLimit) + BigInt(op.callGasLimit) + BigInt(op.paymasterVerificationGasLimit) + BigInt(op.paymasterPostOpGasLimit) + BigInt(op.preVerificationGas) + 200_000n;
      const block = await rpc('eth_getBlockByNumber', ['latest', false]), base = BigInt(block.baseFeePerGas);
      const tip = BigInt(op.maxPriorityFeePerGas), maxFee = BigInt(op.maxFeePerGas) > base * 2n + tip ? BigInt(op.maxFeePerGas) : base * 2n + tip;
      const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [bundler.address, 'pending'])));
      const tx = { type: a ? 4 : 2, chainId: 1, nonce, to: entryPoint, data, value: 0n, gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip, ...(authorizationList ? { authorizationList } : {}) };
      // simulated first, as a bundler does: an operation the EntryPoint refuses is answered with its reason and not sent
      // (the delegation the authorization makes is put in place for the simulation as a state override)
      try { await rpc('eth_call', [{ from: bundler.address, to: entryPoint, data, gas: hx(gasLimit) }, 'latest', a ? { [op.sender]: { code: '0xef0100' + a.address.slice(2).toLowerCase() } } : {}]); } catch (e) { throw { code: -32500, message: errText(e) }; }
      const raw = await bundler.signTransaction(tx);
      const txHash = await rpc('eth_sendRawTransaction', [raw]);
      state.sends++;
      ops.set(hash, { op, txHash });
      state.handleOps.push({ hash, txHash, type: tx.type, gasLimit });
      return hash;
    },
    async eth_getUserOperationReceipt([hash]) {
      const rec = ops.get(hash);
      if (!rec) return null;
      const r = await rpc('eth_getTransactionReceipt', [rec.txHash]);
      if (!r) return null;
      const topic = EP_ABI.getEvent('UserOperationEvent').topicHash;
      const log = r.logs.find((l) => l.address.toLowerCase() === entryPoint.toLowerCase() && l.topics[0] === topic && l.topics[1] === hash);
      if (!log) return null;
      const ev = EP_ABI.parseLog(log);
      const revert = r.logs.find((l) => l.topics[0] === EP_ABI.getEvent('UserOperationRevertReason').topicHash && l.topics[1] === hash);
      return { userOpHash: hash, entryPoint, sender: ev.args.sender, paymaster: ev.args.paymaster, nonce: hx(ev.args.nonce), success: ev.args.success, actualGasCost: hx(ev.args.actualGasCost), actualGasUsed: hx(ev.args.actualGasUsed), reason: revert ? EP_ABI.parseLog(revert).args.revertReason : undefined, logs: r.logs, receipt: r };
    },
    async eth_getUserOperationByHash([hash]) {
      const rec = ops.get(hash);
      if (!rec) return null;
      const r = await rpc('eth_getTransactionReceipt', [rec.txHash]);
      return { userOperation: rec.op, entryPoint, transactionHash: rec.txHash, blockHash: r?.blockHash ?? null, blockNumber: r?.blockNumber ?? null };
    },
  };
  const fetchImpl = async (url, init) => {
    const req = JSON.parse(init.body);
    log.push({ url, method: req.method });
    let body;
    try {
      const f = methods[req.method];
      if (!f) throw { code: -32601, message: `Method not found: ${req.method}` };
      body = { jsonrpc: '2.0', id: req.id, result: await f(req.params || []) };
    } catch (e) {
      body = { jsonrpc: '2.0', id: req.id, error: e && typeof e.code === 'number' ? e : { code: -32603, message: String(e?.message || e) } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, mode, state, ops, address: bundler.address };
}

