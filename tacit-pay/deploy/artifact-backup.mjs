#!/usr/bin/env node
/* A copy of the pool's proving key and witness program in contract code, as a backup the page's SHA-256 pins can check.

   Each file is cut into 24,575-byte pieces, each stored as the runtime code of a data contract behind a STOP byte (the
   format of the page's own chunks). Every piece is deployed through the deterministic CREATE2 proxy with salt 0, so its
   address follows from its bytes alone: anyone holding the file can work out where each piece lives, on any chain.
   A manifest per file follows the pieces, also content-addressed:
     0x00 ‖ "tacit-artifact-v1" ‖ sha256(file) 32 ‖ bytes u64 ‖ pieces u16 ‖ piece addresses 20 × pieces
   Reading one back: eth_getCode of the manifest, then of each piece in order, drop each leading 0x00, join, and check
   the SHA-256 against the one the page pins.

   Usage: RPC=<url> KEY_FILE=<file with a 0x private key> node deploy/artifact-backup.mjs [send]
   Without `send` it only plans: piece and manifest addresses, what is already deployed, gas, and cost at the node's
   price. With it, it deploys what is missing, oldest first, a few transactions per block, and can be run again to
   resume. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const {JsonRpcProvider, Wallet, keccak256, getCreate2Address, concat, toBeHex, zeroPadValue, formatEther} = await import(new URL('../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);

const SRC = '/Users/z/tacit/dapp/evm-pool';
const FILES = [
  {name: 'transact_final.zkey', sha256: '40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b'},
  {name: 'transact.wasm', sha256: '02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1'},
];
const PROXY = '0x4e59b44847b379578588920ca78fbf26c0b4956c', SALT = '0x' + '00'.repeat(32), PIECE = 24_575, TAG = Buffer.from('tacit-artifact-v1');
const IN_FLIGHT = Number(process.env.IN_FLIGHT || 4);

// PUSH2 len DUP1 PUSH1 0x0a PUSH0 CODECOPY PUSH0 RETURN ‖ runtime: returns the payload as the contract's code.
const initcode = (runtime) => Buffer.concat([Buffer.from([0x61, runtime.length >> 8, runtime.length & 255, 0x80, 0x60, 0x0a, 0x5f, 0x39, 0x5f, 0xf3]), runtime]);
const addressOf = (init) => getCreate2Address(PROXY, SALT, keccak256(init));

const plan = [];
for (const f of FILES) {
  const b = fs.readFileSync(`${SRC}/${f.name}`), sha = createHash('sha256').update(b).digest('hex');
  if (sha !== f.sha256) throw new Error(`${f.name}: sha256 ${sha} is not the pinned ${f.sha256}`);
  const pieces = [];
  for (let at = 0; at < b.length; at += PIECE) { const init = initcode(Buffer.concat([Buffer.from([0]), b.subarray(at, at + PIECE)])); pieces.push({init, addr: addressOf(init)}); }
  const head = Buffer.alloc(8 + 2); head.writeBigUInt64BE(BigInt(b.length)); head.writeUInt16BE(pieces.length, 8);
  const man = initcode(Buffer.concat([Buffer.from([0]), TAG, Buffer.from(sha, 'hex'), head, ...pieces.map((p) => Buffer.from(p.addr.slice(2), 'hex'))]));
  if (man.length - 10 > 24_576) throw new Error(`${f.name}: the manifest is over EIP-170`);
  plan.push({...f, bytes: b.length, pieces, manifest: {init: man, addr: addressOf(man)}});
}
const all = plan.flatMap((f) => [...f.pieces.map((p, i) => ({...p, what: `${f.name} piece ${i + 1}/${f.pieces.length}`})), {...f.manifest, what: `${f.name} manifest`}]);

const rpc = new JsonRpcProvider(process.env.RPC || 'https://ethereum-sepolia-rpc.publicnode.com', undefined, {staticNetwork: true, batchMaxCount: 20});
const net = await rpc.getNetwork();
const have = [];
for (let i = 0; i < all.length; i += 20) have.push(...await Promise.all(all.slice(i, i + 20).map((x) => rpc.getCode(x.addr).then((c) => c.length > 2))));
const todo = all.filter((_, i) => !have[i]);
const gasOf = (init) => 32_000n + 21_000n + 200n * BigInt(init.length - 10) + 16n * BigInt(init.length + 32) + 2n * BigInt(Math.ceil(init.length / 32)) + 30_000n;
const estimate = todo.length ? await rpc.estimateGas({to: PROXY, data: concat([SALT, todo[0].init])}).catch(() => null) : null;
const fee = await rpc.getFeeData(), price = fee.maxFeePerGas ? (await rpc.getBlock('latest')).baseFeePerGas + (fee.maxPriorityFeePerGas ?? 0n) : fee.gasPrice;
const gas = todo.reduce((n, x) => n + gasOf(x.init), 0n);

console.log(`chain ${net.chainId}: ${all.length} contracts (${plan.map((f) => `${f.name} ${f.bytes} B in ${f.pieces.length}`).join(', ')}), ${all.length - todo.length} already there`);
for (const f of plan) console.log(`  ${f.name} manifest ${f.manifest.addr}`);
console.log(`  to deploy: ${todo.length}, about ${(Number(gas) / 1e9).toFixed(2)}B gas${estimate ? ` (node's estimate for the first: ${estimate}, ours ${gasOf(todo[0].init)})` : ''}, ${formatEther(gas * price)} ETH at ${Number(price) / 1e9} gwei`);
if (process.argv[2] !== 'send' || !todo.length) process.exit(0);

const key = fs.readFileSync(process.env.KEY_FILE, 'utf8').trim();
const w = new Wallet(key.startsWith('0x') ? key : '0x' + key, rpc);
let nonce = await rpc.getTransactionCount(w.address, 'pending');
if (nonce !== await rpc.getTransactionCount(w.address, 'latest')) throw new Error(`${w.address} has transactions pending on this chain: wait for them first`);
console.log(`from ${w.address}, nonce ${nonce}, balance ${formatEther(await rpc.getBalance(w.address))} ETH`);

const flying = [];
let done = 0;
const settle = async (x) => {
  for (const t0 = Date.now(); ;) {
    const r = await rpc.getTransactionReceipt(x.hash).catch(() => null);
    if (r) { if (r.status !== 1 || (await rpc.getCode(x.addr)).length <= 2) throw new Error(`${x.what} did not deploy (${x.hash})`); done++; return; }
    if (Date.now() - t0 > 600_000) throw new Error(`${x.what} not mined after 10 min (${x.hash}); run again once it lands or drops`);
    await new Promise((r) => setTimeout(r, 4000));
  }
};
for (const x of todo) {
  while (flying.length >= IN_FLIGHT) await settle(flying.shift());
  // The node's estimate, with room: the proxy keeps 1/64 of what it forwards to the CREATE2, which a sum of costs misses.
  const g = (await rpc.estimateGas({from: w.address, to: PROXY, data: concat([SALT, x.init])}).catch(() => gasOf(x.init) + 100_000n)) * 11n / 10n;
  const base = (await rpc.getBlock('latest')).baseFeePerGas, tip = (await rpc.getFeeData()).maxPriorityFeePerGas ?? 10n ** 9n;
  const bal = await rpc.getBalance(w.address, 'pending');
  if (bal < g * (base * 2n + tip)) { console.log(`stopping: ${formatEther(bal)} ETH left is short of the next piece; ${todo.length - done - flying.length} not sent. Run again after topping up.`); break; }
  const tx = await w.sendTransaction({to: PROXY, data: concat([SALT, x.init]), gasLimit: g, maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip, nonce: nonce++, chainId: net.chainId});
  flying.push({...x, hash: tx.hash});
  if ((done + flying.length) % 25 === 0 || x.what.includes('manifest')) console.log(`  ${new Date().toISOString().slice(11, 19)} sent ${x.what} ${x.addr} ${tx.hash}`);
}
while (flying.length) await settle(flying.shift());
console.log(`done: ${done} deployed this run; balance ${formatEther(await rpc.getBalance(w.address))} ETH`);
for (const f of plan) console.log(`  ${f.name}: manifest ${f.manifest.addr}, sha256 ${f.sha256}, ${f.bytes} B, ${f.pieces.length} pieces`);
