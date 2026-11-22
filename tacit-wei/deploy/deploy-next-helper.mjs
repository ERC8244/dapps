#!/usr/bin/env node
// The next version of the tacit.wei page, appended to the live one through deployNext, with the ops multisig as steward.
//
// What it does, in order, and what each step waits for:
//   1. Chunks. Every chunk the lineage does not already hold is deployed through CreateX's CREATE2 from any funded wallet
//      (this page, in a browser), under a salt anyone may use (20 zero bytes, 0x01, 'tacitwei' and the chunk's number),
//      so each lands at an address fixed by its code. A chunk whose bytes are already on chain anywhere in the lineage is
//      reused at that address. Someone else sending a chunk first only saves the gas.
//   2. deployNext. Offered only once every chunk is on chain with exactly its bytes. It is a call from the multisig to
//      the live version: deployNext(initcode, salt), a CREATE2 from that contract, whose address is printed beforehand.
//      The successor's steward is the multisig.
//   3. setAddr. Offered only once the live version's successor() is that address and the successor commits to this page.
//      It is a call from the multisig to WNS: setAddr(namehash("tacit.wei"), successor).
//   4. setGwei. Then tacit.gwei (GNS) is pointed the same way: setAddr(namehash("tacit.gwei"), successor) on GNS, a multisig
//      op when the multisig owns the name, else one transaction from the account that owns it.
//   5. Read-back: the successor's PAGE_HASH, steward and PREVIOUS, what tacit.wei resolves to, and the SHA-256 of what
//      https://tacit.wei.limo/ serves.
// Steps 2 and 3 are never sent from here. For each, the helper prints the call (target, value, data), the multisig's op
// id for it (getTransactionHash, asked of the multisig itself), the execute(...) call that queues it once two owners
// have signed the op id, and, once it is queued, the executeQueued(...) call that anyone may send after the delay. Every
// step is decided by reading the chain, never by a transaction's status: the multisig answers a selector it does not
// know with success and no effect.
//
// Usage (from tacit-wei/, after deploy/repin.sh and forge build; never `forge build --force` or `forge clean` between
// them, since they delete out/):
//   node deploy/deploy-next-helper.mjs [port]           serve the page: chunks from a browser wallet, and the steps above
//   node deploy/deploy-next-helper.mjs --plan           print the current step as JSON
//   node deploy/deploy-next-helper.mjs --sim            estimate deployNext and setAddr from the multisig; chunks that are
//                                                       not yet on chain are put in place by a state override
//   node deploy/deploy-next-helper.mjs --execute <deployNext|setAddr> 0x<signatures>
//                                                       print the execute(...) calldata for that step with the owners'
//                                                       signatures over its op id (65 bytes each, as the ops tool joins them)
// Environment: ETH_RPC_URL (default publicnode), LINEAGE (any version of the lineage; default the first), OUT (the forge
// output directory; default ./out), MAX_GWEI (the chunk sender's gas ceiling; default 1), ZEROS (leading zero bytes the
// successor's address is mined for, by the served page, when deploy/vanity/target/release/vanity2 is built:
//   cargo build --release --offline --manifest-path deploy/vanity/Cargo.toml). A mined salt is kept in OUT/next-salt.json;
// without the miner the salt is zero.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../', import.meta.url).pathname;
const OUT = (process.env.OUT || DIR + 'out').replace(/\/?$/, '/');
// The ops multisig (2 of 5 owners, a one-hour delay): steward of the page contract, owner of tacit.wei and of
// TacitPayRegistry. The successor names it as steward too.
const OPS = '0x006CD14F36F65eCbB29b2519cCBe63A0DC8549F2';
const LINEAGE = process.env.LINEAGE || '0x000000000009dde9bb333bbad42ad74bbacc2bd6';
const NAME = 'tacit.wei', WNS = '0x0000000000696760e15f265e828db644a0c242eb', LIMO = 'https://tacit.wei.limo/';
// tacit.gwei (GNS) serves the same page; its record follows tacit.wei's, sent by whoever owns the name.
const GNAME = 'tacit.gwei', GNS = '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6', GLIMO = 'https://tacit.gwei.limo/';
const CREATEX = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
// Gas limits for the release transactions: deployNext estimates near 2.45M from the multisig.
const RELEASE_GAS = { deployNext: 3_500_000, setAddr: 200_000, setGwei: 200_000 };

const argv = process.argv.slice(2);
const MODE = argv.includes('--sim') ? 'sim' : argv.includes('--plan') ? 'plan' : argv.includes('--execute') ? 'execute' : 'serve';

const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
const page = readFileSync(DIR + manifest.page);
if (page.length !== manifest.bytes || createHash('sha256').update(page).digest('hex') !== manifest.sha256) throw new Error('the page is not the one the manifest pins');
const files = readdirSync(OUT).filter((f) => /^TacitPay8244\.chunk\d+\.creation\.txt$/.test(f)).sort((a, b) => Number(a.match(/chunk(\d+)/)[1]) - Number(b.match(/chunk(\d+)/)[1]));
const chunks = files.map((f) => readFileSync(OUT + f, 'utf8').trim());
const runtimes = chunks.map((c) => '0x' + c.slice(2 + 20));   // the 10-byte stub, then the runtime
if (Buffer.concat(runtimes.map((r) => Buffer.from(r.slice(4), 'hex'))).compare(page) !== 0) throw new Error('the chunks in ' + OUT + ' do not reassemble to the page');
const bytecode = JSON.parse(readFileSync(OUT + 'TacitPay8244.sol/TacitPay8244.json', 'utf8')).bytecode.object;
const { keccak256, getAddress, concat, AbiCoder, id, namehash } = await import(new URL('../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const abi = AbiCoder.defaultAbiCoder();
const sel = (sig) => id(sig).slice(0, 10);
const enc = (sig, types, args) => sel(sig) + abi.encode(types, args).slice(2);
const lc = (a) => String(a).toLowerCase();

const RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const SIM_RPCS = ['https://eth.drpc.org', 'https://rpc.mevblocker.io'];
async function rpcCall(method, params, url = RPC_URL) {
  const j = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw Object.assign(new Error(method + ': ' + (j.error.message ?? JSON.stringify(j.error))), { data: j.error.data });
  return j.result;
}
// Several reads in one request, answered in order; a read that fails is null. A node that does not answer a batch in
// full is asked one read at a time.
async function rpcBatch(calls) {
  if (!calls.length) return [];
  let j = null;
  try { j = await (await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map(([method, params], i) => ({ jsonrpc: '2.0', id: i, method, params }))) })).json(); } catch {}
  if (!Array.isArray(j) || j.length !== calls.length) return Promise.all(calls.map(([method, params]) => rpcCall(method, params).catch(() => null)));
  const out = new Array(calls.length).fill(null);
  for (const r of j) if (!r.error) out[r.id] = r.result;
  return out;
}
const callAt = (to, data) => rpcCall('eth_call', [{ to, data }, 'latest']);
// A read that must return exactly one word: anything else (the multisig's empty answer to an unknown selector) throws.
async function word(to, data) {
  const r = await callAt(to, data);
  if (typeof r !== 'string' || r.length !== 66) throw new Error(`${to} gave ${r} for ${data.slice(0, 10)}, not one word`);
  return r;
}
const addrOf = (w) => getAddress('0x' + String(w).slice(-40));
const view = (to, sig, types = [], args = []) => word(to, enc(sig, types, args));
const nameOf = async (a) => { try { return abi.decode(['string'], await callAt(a, sel('NAME()')))[0]; } catch { return null; } };

// ── the lineage, read from mainnet ──
const pageHash = keccak256(page);
const TOKEN = namehash(NAME), GTOKEN = namehash(GNAME);
const tip = addrOf(await view(LINEAGE, 'latest()'));
if ((await nameOf(tip)) !== NAME) throw new Error(`${tip} (the tip of ${LINEAGE}) is not a ${NAME} page contract`);
// The tip already holding this page means deployNext has run: the version before it is the one being extended. In --sim
// the live tip is always the base, so the current build can be simulated as its own successor.
let base = tip, landed = null;
if (MODE !== 'sim' && lc(await view(tip, 'PAGE_HASH()')) === lc(pageHash)) {
  const prev = addrOf(await view(tip, 'PREVIOUS()'));
  if (!BigInt(prev)) { console.log(`${tip} is the first version and already serves this page (sha256 ${manifest.sha256}): there is no next version to release.`); process.exit(0); }
  base = prev; landed = tip;
}
const steward = addrOf(await view(base, 'steward()'));
if (steward !== getAddress(OPS)) throw new Error(`${base} is stewarded by ${steward}, not the ops multisig ${OPS}`);

// Every chunk the lineage already holds, by its exact bytes, newest generation first.
const onchain = new Map();
for (let g = base; BigInt(g); g = addrOf(await view(g, 'PREVIOUS()'))) {
  const n = Number(BigInt(await view(g, 'chunkCount()')));
  const addrs = (await rpcBatch(Array.from({ length: n }, (_, i) => ['eth_call', [{ to: g, data: enc('chunkAt(uint256)', ['uint256'], [i]) }, 'latest']]))).map(addrOf);
  const codes = await rpcBatch(addrs.map((a) => ['eth_getCode', [a, 'latest']]));
  addrs.forEach((a, i) => { const c = lc(codes[i] || ''); if (c.length > 2 && !onchain.has(c)) onchain.set(c, a); });
}
const reused = runtimes.map((r) => onchain.get(lc(r)) ?? null);
const needsDeploy = reused.map((a, i) => (a ? -1 : i)).filter((i) => i !== -1);

const create2Address = (deployer, salt, initcodeHash) => getAddress('0x' + keccak256(concat(['0xff', deployer, salt, initcodeHash])).slice(26));
// Where each chunk lands through CreateX (deployCreate2(bytes32,bytes)): its salt is chain-bound, open to any sender.
const PLAN = chunks.map((init, i) => {
  const salt = '0x' + Buffer.concat([Buffer.alloc(20), Buffer.from([1]), Buffer.from(`tacitwei${String(i + 1).padStart(2, '0')}`), Buffer.alloc(1)]).toString('hex');
  const guarded = keccak256(abi.encode(['uint256', 'bytes32'], [1, salt]));
  return { salt, address: create2Address(CREATEX, guarded, keccak256(init)), data: enc('deployCreate2(bytes32,bytes)', ['bytes32', 'bytes'], [salt, init]), bytes: (init.length - 2) / 2 };
});
// The successor's chunk list is fixed by the build: a reused address, else the chunk's CreateX address.
const finalChunks = runtimes.map((_, i) => reused[i] ?? PLAN[i].address);
const initcode = bytecode + abi.encode(['address', 'address', 'address[]', 'bytes32'], [OPS, base, finalChunks, pageHash]).slice(2);
const initcodeHash = keccak256(initcode);

// The salt: one mined by the served page and kept in OUT, else zero.
const MINER = DIR + 'deploy/vanity/target/release/vanity2', ZEROS = Number(process.env.ZEROS || 3), SALTS = OUT + 'next-salt.json';
async function saltFor() {
  let kept = {};
  try { kept = JSON.parse(readFileSync(SALTS, 'utf8')); } catch {}
  const key = `${lc(base)}:${initcodeHash}`;
  if (kept[key]) return kept[key];
  if (MODE !== 'serve' || !existsSync(MINER)) return '0x' + '00'.repeat(32);
  const out = await new Promise((resolve, reject) => execFile(MINER, [base, initcodeHash, String(ZEROS)], { timeout: 900_000 }, (e, o) => (e ? reject(e) : resolve(o))));
  const salt = /salt (0x[0-9a-f]{64})/.exec(out)?.[1];
  if (!salt) throw new Error('the miner did not report a salt');
  if (!lc(create2Address(base, salt, initcodeHash)).startsWith('0x' + '00'.repeat(ZEROS))) throw new Error('the miner and the check disagree');
  kept[key] = salt;
  writeFileSync(SALTS, JSON.stringify(kept, null, 2));
  return salt;
}
const salt = landed ? null : await saltFor();
const predicted = landed ?? create2Address(base, salt, initcodeHash);
const deployNextData = landed ? null : enc('deployNext(bytes,bytes32)', ['bytes', 'bytes32'], [initcode, salt]);
const setAddrData = '0xeba36dbd' + TOKEN.slice(2) + predicted.slice(2).toLowerCase().padStart(64, '0');
const setGweiData = '0xeba36dbd' + GTOKEN.slice(2) + predicted.slice(2).toLowerCase().padStart(64, '0');

// ── the multisig's queue ──
// The op id for (target, value 0, data) at a nonce, asked of the multisig; an op already queued is found by its queued()
// eta at one of the recent nonces. queued() reads zero again once an op has been released.
const QUEUE_SCAN = 64;
const hashCall = (target, data, n) => enc('getTransactionHash(address,uint256,bytes,uint32)', ['address', 'uint256', 'bytes', 'uint32'], [target, 0, data, n]);
async function opFor(target, data) {
  const nonce = Number(BigInt(await view(OPS, 'nonce()')));
  const ns = []; for (let n = nonce - 1; n >= Math.max(0, nonce - QUEUE_SCAN); n--) ns.push(n);
  const ids = await rpcBatch(ns.map((n) => ['eth_call', [{ to: OPS, data: hashCall(target, data, n) }, 'latest']]));
  const etas = await rpcBatch(ids.map((h) => ['eth_call', [{ to: OPS, data: '0x228250c9' + String(h || '0x').slice(2).padStart(64, '0') }, 'latest']]));
  const now = Number(BigInt((await rpcCall('eth_getBlockByNumber', ['latest', false])).timestamp));
  for (let k = 0; k < ns.length; k++) {
    if (!ids[k] || ids[k].length !== 66 || !etas[k] || etas[k].length !== 66 || !BigInt(etas[k])) continue;
    const eta = Number(BigInt(etas[k]));
    return { queued: true, nonce: ns[k], id: ids[k], eta, etaUtc: new Date(eta * 1000).toISOString(), ready: now >= eta,
      release: { to: OPS, value: '0', data: enc('executeQueued(address,uint256,bytes,uint32)', ['address', 'uint256', 'bytes', 'uint32'], [target, 0, data, ns[k]]) } };
  }
  return { queued: false, nonce, id: await word(OPS, hashCall(target, data, nonce)), note: `the op id if it is queued at nonce ${nonce}, the multisig's next; an op queued before it moves it to the next nonce` };
}
const executeData = (target, data, sigs) => enc('execute(address,uint256,bytes,bytes)', ['address', 'uint256', 'bytes', 'bytes'], [target, 0, data, sigs]);
async function stepCall(step, target, data) {
  const op = await opFor(target, data);
  const out = { step, call: { from: OPS, to: target, value: '0', data }, op };
  if (!op.queued) out.queue = { to: OPS, value: '0', function: 'execute(address,uint256,bytes,bytes)', args: [target, '0', '<data above>', `<two owners' signatures over ${op.id}, 65 bytes each>`], encode: `node deploy/deploy-next-helper.mjs --execute ${step} 0x<signatures>` };
  else if (op.ready) {
    let gas;
    try { gas = Number(BigInt(await rpcCall('eth_estimateGas', [{ to: OPS, data: op.release.data }]))); } catch (e) { gas = 'estimate failed: ' + e.message; }
    out.release = { ...op.release, gasEstimate: gas, gasLimit: RELEASE_GAS[step], note: 'any account may send it; the next step is then read from the chain' };
  } else out.release = { ...op.release, gasLimit: RELEASE_GAS[step], note: `queued; it can be released from ${op.etaUtc}` };
  return out;
}

// ── where the release stands, read from the chain ──
async function status() {
  const codes = await rpcBatch(finalChunks.map((a) => ['eth_getCode', [a, 'latest']]));
  const missing = finalChunks.map((a, i) => (lc(codes[i] || '') === lc(runtimes[i]) ? -1 : i)).filter((i) => i !== -1);
  const wrong = missing.filter((i) => (codes[i] || '0x').length > 2);
  const head = { base, steward: OPS, page: { bytes: manifest.bytes, sha256: manifest.sha256, keccak256: pageHash }, predicted, salt, initcodeHash, chunks: finalChunks.map((a, i) => ({ n: i + 1, address: a, reused: !!reused[i], onchain: !missing.includes(i) })) };
  if (wrong.length) return { ...head, step: 'stop', error: `something other than its chunk is at ${wrong.map((i) => finalChunks[i]).join(', ')}` };
  if (missing.length) return { ...head, step: 'chunks', todo: missing.map((i) => i + 1), note: 'deploy these from any funded wallet (the served page); deployNext is offered once all are on chain' };
  const succ = addrOf(await view(base, 'successor()'));
  if (!BigInt(succ)) {
    try { await rpcCall('eth_call', [{ from: OPS, to: base, data: deployNextData }, 'latest']); }
    catch (e) { return { ...head, step: 'stop', error: 'deployNext would revert from the multisig: ' + e.message + (e.data ? ' ' + e.data : '') }; }
    return { ...head, ...(await stepCall('deployNext', base, deployNextData)) };
  }
  if (succ !== predicted) return { ...head, step: 'stop', error: `${base} already has the successor ${succ}, not ${predicted}` };
  const [ph, st, prev] = await Promise.all([view(succ, 'PAGE_HASH()'), view(succ, 'steward()'), view(succ, 'PREVIOUS()')]);
  const next = { address: succ, pageHash: lc(ph) === lc(pageHash), steward: addrOf(st) === getAddress(OPS), previous: addrOf(prev) === getAddress(base) };
  if (!next.pageHash || !next.steward || !next.previous) return { ...head, step: 'stop', next, error: 'the successor does not read back as built' };
  const resolved = addrOf(await callAt(WNS, '0x4f896d4f' + TOKEN.slice(2)));
  if (resolved !== succ) return { ...head, next, resolved, ...(await stepCall('setAddr', WNS, setAddrData)) };
  // tacit.gwei next: a multisig op when the multisig owns it, else one transaction from the name's owner.
  const gResolved = addrOf(await callAt(GNS, '0x4f896d4f' + GTOKEN.slice(2)));
  if (gResolved !== succ) {
    const gOwner = addrOf(await callAt(GNS, '0x6352211e' + GTOKEN.slice(2)));
    if (gOwner === getAddress(OPS)) return { ...head, next, resolved, gResolved, ...(await stepCall('setGwei', GNS, setGweiData)) };
    return { ...head, next, resolved, gResolved, step: 'setGwei', call: { from: gOwner, to: GNS, value: '0', data: setGweiData }, note: `${GNAME} is owned by ${gOwner}, not the multisig: that account sends this one transaction (or moves the name to the multisig first)` };
  }
  // What each host serves, by the SHA-256 of its bytes.
  const served = async (url) => { try { const b = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer()); const r = { bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }; r.same = r.sha256 === manifest.sha256; return r; } catch (e) { return { error: String(e.message || e) }; } };
  const [limo, glimo] = await Promise.all([served(LIMO), served(GLIMO)]);
  return { ...head, step: limo.same && glimo.same ? 'done' : 'serving', next, resolved, limo, glimo,
    note: limo.same && glimo.same ? `${NAME} and ${GNAME} serve this page from ${succ}` : `${NAME} and ${GNAME} resolve to ${succ}; ${limo.same ? '' : LIMO + ' '}${glimo.same ? '' : GLIMO + ' '}does not serve this page yet (a host may hold a page for a few minutes)`,
    deployment: { chainId: 1, contract: succ, previous: base, steward: OPS, pageSha256: manifest.sha256, chunkContracts: finalChunks, routes: [
      { kind: 'erc8244', url: 'https://' + lc(succ) + '.w4eth.io/', serves: 'exact' }, { kind: 'wns', url: LIMO, serves: 'exact' }, { kind: 'gns', url: GLIMO, serves: 'exact' }] } };
}

if (MODE === 'plan') { console.log(JSON.stringify(await status(), null, 2)); process.exit(0); }

if (MODE === 'execute') {
  const [, step, sigs] = argv.slice(argv.indexOf('--execute'));
  if (!/^0x([0-9a-f]{130})+$/i.test(sigs || '')) throw new Error('signatures: 0x and 65 bytes per owner');
  const s = await status();
  if (s.step !== step) throw new Error(`the release is at "${s.step}", not "${step}"${s.error ? ': ' + s.error : ''}`);
  if (s.op.queued) throw new Error(`already queued at nonce ${s.op.nonce}; --plan prints its executeQueued call`);
  console.log(JSON.stringify({ step, opId: s.op.id, nonce: s.op.nonce, to: OPS, value: '0', data: executeData(s.call.to, s.call.data, sigs) }, null, 2));
  process.exit(0);
}

if (MODE === 'sim') {
  // Chunks not yet on chain get their runtime from a state override, so the estimate is of this build's release.
  const codes = await rpcBatch(finalChunks.map((a) => ['eth_getCode', [a, 'latest']]));
  const override = {};
  finalChunks.forEach((a, i) => { if (lc(codes[i] || '') !== lc(runtimes[i])) override[a] = { code: runtimes[i] }; });
  const tx = { from: OPS, to: base, data: deployNextData };
  // A state override of new chunks is about 1 MB of JSON, more than some nodes take: those after ETH_RPC_URL are tried.
  const est = async (t, o) => {
    let last;
    for (const url of Object.keys(o).length ? [RPC_URL, ...SIM_RPCS] : [RPC_URL]) {
      try { return Number(BigInt(await rpcCall('eth_estimateGas', Object.keys(o).length ? [t, 'latest', o] : [t], url))); }
      catch (e) { last = e; if (e.data) break; }
    }
    return 'reverts: ' + last.message + (last.data ? ' ' + last.data : '');
  };
  const nonce = Number(BigInt(await view(OPS, 'nonce()')));
  console.log(JSON.stringify({
    base, steward, successorSteward: OPS, predicted, salt, initcodeHash, page: { bytes: manifest.bytes, keccak256: pageHash },
    chunks: { total: finalChunks.length, reused: reused.filter(Boolean).length, toDeploy: needsDeploy.length, overridden: Object.keys(override).length },
    deployNext: { to: base, calldataBytes: (deployNextData.length - 2) / 2, gasFromMultisig: await est(tx, override), gasFromAnotherAccount: await est({ ...tx, from: CREATEX }, override),
      opIdAtNextNonce: await word(OPS, hashCall(base, deployNextData, nonce)), nonce },
    setAddr: { to: WNS, data: setAddrData, gasFromMultisig: await est({ from: OPS, to: WNS, data: setAddrData }, {}) },
    setGwei: await (async () => { const owner = addrOf(await callAt(GNS, '0x6352211e' + GTOKEN.slice(2))); return { to: GNS, data: setGweiData, owner, ownerIsMultisig: owner === getAddress(OPS), gasFromOwner: await est({ from: owner, to: GNS, data: setGweiData }, {}) }; })(),
  }, null, 2));
  process.exit(0);
}

// ── the page: chunks from a browser wallet, then the multisig's steps ──
const GAS = Math.round(needsDeploy.reduce((s, i) => s + PLAN[i].bytes * 225 + 150_000, 0));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>tacit.wei: next version</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,monospace;max-width:820px;margin:40px auto;padding:0 16px}button{font:inherit;padding:8px 14px;margin:4px 0}code{overflow-wrap:anywhere}.ok{color:#0a7d3a}.err{color:#b8341d}li{margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f1e8;padding:12px}
#pick{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}#pick button{display:flex;align-items:center;gap:8px}#pick img{width:20px;height:20px;border-radius:4px}</style></head><body>
<h2>tacit.wei: next version</h2>
<p>Page ${manifest.bytes.toLocaleString('en-US')} bytes, sha256 <code>${manifest.sha256}</code>, keccak <code>${pageHash}</code>. It follows <code>${base}</code>, stewarded by the ops multisig <code>${OPS}</code>; the next version will be at <code>${predicted}</code>.</p>
<h3>1. Chunks, from any wallet</h3>
<p>${needsDeploy.length} of ${chunks.length} chunks are new; the rest are reused at their live addresses. Any funded account can send them: each lands at an address fixed by its code.</p>
<p><button id="connect">Connect wallet</button> <span id="who"></span></p>
<div id="pick" hidden></div>
<p><button id="go" disabled>Deploy the chunks still missing</button> <span id="onesay"></span></p>
<ol id="steps"></ol>
<h3>2–4. The multisig's steps</h3>
<p>deployNext is offered once every chunk is on chain, setAddr once the successor is in place; each is queued by two owners and released after the delay. Nothing here sends them.</p>
<p><button id="check">Read the chain again</button></p>
<pre id="plan">reading…</pre>
<script>
const ALL_RUNTIMES = ${JSON.stringify(runtimes)}, NEEDS = ${JSON.stringify(needsDeploy)}, PLAN = ${JSON.stringify(PLAN.map(({ address, data, bytes }) => ({ address, data, bytes })))}, CREATEX = ${JSON.stringify(CREATEX)};
const FINAL = ${JSON.stringify(finalChunks)}, GAS = ${GAS}, MAXGWEI = ${Number(process.env.MAX_GWEI ?? 1)};
let eth = null, from = null;
const $ = (s) => document.querySelector(s), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
async function rpc(method, params = []) {
  for (let i = 0; ; i++) {
    try { return await eth.request({ method, params }); }
    catch (e) { if (i >= 5 || !/rate.?limit|too many requests|\\b429\\b/i.test(e?.message || '')) throw e; await sleep(500 * 2 ** i); }
  }
}
function nudged(p, label) {
  const t = setTimeout(() => { const el = document.createElement('li'); el.innerHTML = '<span class="err">Still waiting on your wallet for ' + esc(label) + '. Check its popup; if nothing is pending there, reload and press again: what is on chain is read first.</span>'; $('#steps').appendChild(el); }, 8000);
  return Promise.resolve(p).finally(() => clearTimeout(t));
}
const WALLETS = [];
window.addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; if (!d?.info || !d.provider?.request || WALLETS.some((w) => w.info.uuid === d.info.uuid)) return; WALLETS.push(d); });
const askWallets = () => window.dispatchEvent(new Event('eip6963:requestProvider'));
askWallets();
const installed = () => (WALLETS.length ? WALLETS : window.ethereum?.request ? [{ info: { name: 'Browser wallet' }, provider: window.ethereum }] : []);
function pickWallet(list) {
  return new Promise((resolve) => {
    $('#pick').innerHTML = list.map((w, i) => '<button type="button" data-i="' + i + '">' + ((w.info.icon || '').indexOf('data:image') === 0 ? '<img src="' + esc(w.info.icon) + '" alt="">' : '') + '<span>' + esc(w.info.name) + '</span></button>').join('');
    $('#pick').hidden = false;
    document.querySelectorAll('#pick [data-i]').forEach((b) => b.onclick = () => { $('#pick').hidden = true; $('#pick').innerHTML = ''; resolve(list[b.dataset.i]); });
  });
}
const code = async (a) => (await rpc('eth_getCode', [a, 'latest'])).toLowerCase();
const publicCode = async (a) => (await (await fetch('/code?a=' + a, { signal: AbortSignal.timeout(20000) })).text()).toLowerCase();
const onchain = async (i, read = code) => (await read(FINAL[i])) === ALL_RUNTIMES[i].toLowerCase();
async function paint(note, read = publicCode) {
  const have = await Promise.all(ALL_RUNTIMES.map((_, i) => onchain(i, read).catch(() => false)));
  $('#steps').innerHTML = ALL_RUNTIMES.map((_, i) => '<li>chunk ' + (i + 1) + ': <code>' + FINAL[i] + '</code> ' + (have[i] ? '<span class="ok">on chain' + (NEEDS.includes(i) ? '' : ' (reused)') + '</span>' : '…') + '</li>').join('') + (note ? '<li>' + note + '</li>' : '');
  return have;
}
async function onMainnet() { const id = parseInt(await rpc('eth_chainId'), 16); if (id !== 1) throw new Error('Your wallet is on chain ' + id + ', not Ethereum mainnet. Switch it and press again: nothing was sent.'); }
// Gas above the ceiling (MAX_GWEI on the server, default 1; ?maxgwei=N here, 0 turns it off) waits for it to fall.
async function preflight(label, gas) {
  const q = new URLSearchParams(location.search).get('maxgwei'), ceiling = q === null || q === '' ? MAXGWEI : Number(q);
  for (;;) {
    const [bal, gp] = await Promise.all([rpc('eth_getBalance', [from, 'latest']), rpc('eth_gasPrice')]);
    const gwei = Number(BigInt(gp)) / 1e9, cost = Number(BigInt(gas) * BigInt(gp)) / 1e18, have = Number(BigInt(bal)) / 1e18;
    if (have < cost * 1.3) throw new Error('Nothing was sent: ' + label + ' needs about ' + cost.toFixed(4) + ' ETH at ' + gwei.toFixed(3) + ' gwei, and ' + from + ' holds ' + have.toFixed(4) + ' ETH.');
    if (ceiling > 0 && gwei > ceiling) { $('#onesay').textContent = 'Gas is ' + gwei.toFixed(3) + ' gwei, above the ' + ceiling + ' gwei ceiling: waiting (checked every 15 s).'; await sleep(15000); continue; }
    return;
  }
}
const NONCE = { floor: 0 };
const nextNonce = async () => Math.max(parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16), NONCE.floor);
// One chunk through CreateX at its planned address, found afterwards by what the address holds.
async function viaCreateX(i) {
  await onMainnet();
  const plan = PLAN[i], label = 'chunk ' + (i + 1);
  if (await onchain(i)) return;
  if ((await code(plan.address)).length > 2) throw new Error('Something else is already at ' + plan.address + '. Nothing was sent.');
  const gas = '0x' + Math.ceil(Number(BigInt(await rpc('eth_estimateGas', [{ from, to: CREATEX, data: plan.data }]))) * 1.1).toString(16);
  await preflight(label, gas);
  const nonce = await nextNonce();
  $('#onesay').textContent = 'confirm ' + label + ' in your wallet';
  const h = await nudged(rpc('eth_sendTransaction', [{ from, to: CREATEX, data: plan.data, gas, nonce: '0x' + nonce.toString(16) }]), label);
  $('#onesay').innerHTML = label + ': waiting for <code>' + esc(h) + '</code>';
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    if (r && r.status !== '0x1') throw new Error(label + ' reverted in ' + h);
    if (await onchain(i)) { NONCE.floor = nonce + 1; return; }
    if (parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16) > nonce && !(await rpc('eth_getTransactionReceipt', [h])) && !(await onchain(i)))
      throw new Error('Another transaction used nonce ' + nonce + '. Nothing is lost: press again to carry on from what is on chain.');
    await sleep(3000);
  }
}
// A wallet that batches calls (EIP-5792) sends several chunks per transaction, under the 16,777,216 gas one may use.
const TX_GAS = 15000000;
async function atomicOk() {
  try { const c = await rpc('wallet_getCapabilities', [from, ['0x1']]), m = (c && (c['0x1'] || c['1'])) || {}; return ['supported', 'ready'].includes(m.atomic?.status) || m.atomicBatch?.supported === true; } catch { return false; }
}
async function sendBatch(idx) {
  await onMainnet();
  const label = 'chunks ' + idx.map((i) => i + 1).join(', ');
  $('#onesay').textContent = 'confirm ' + label + ' in your wallet';
  const res = await nudged(rpc('wallet_sendCalls', [{ version: '2.0.0', chainId: '0x1', from, atomicRequired: true, calls: idx.map((i) => ({ to: CREATEX, data: PLAN[i].data, value: '0x0' })) }]), label);
  const bid = typeof res === 'string' ? res : res?.id;
  if (!bid) throw new Error('The wallet returned no id for ' + label + '. Check its activity, then press again.');
  $('#onesay').textContent = label + ': waiting for the block';
  for (;;) {
    if ((await Promise.all(idx.map((i) => onchain(i)))).every(Boolean)) return;
    let s = null; try { s = await rpc('wallet_getCallsStatus', [bid]); } catch {}
    const n = typeof s?.status === 'number' ? s.status : { CONFIRMED: 200, PENDING: 100 }[s?.status] ?? 0, r = s?.receipts?.[0];
    if (n >= 400 || (r && r.status !== '0x1' && r.status !== 1 && r.status !== 'success')) throw new Error(label + ' did not go through. Press again.');
    await sleep(3000);
  }
}
$('#connect').onclick = async () => {
  askWallets(); await sleep(150);
  const list = installed();
  if (!list.length) return paint('<span class="err">No wallet found in this browser.</span>');
  const w = list.length > 1 ? await pickWallet(list) : list[0];
  if (!w) return;
  eth = w.provider;
  try {
    [from] = await nudged(rpc('eth_requestAccounts'), 'connecting ' + w.info.name);
    if (parseInt(await rpc('eth_chainId'), 16) !== 1) { try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x1' }]); } catch {} }
    await onMainnet();
    const [bal, gp] = await Promise.all([rpc('eth_getBalance', [from, 'latest']), rpc('eth_gasPrice')]);
    $('#who').textContent = w.info.name + ' · ' + from + ' · ' + (Number(BigInt(bal)) / 1e18).toFixed(5) + ' ETH · gas ' + (Number(BigInt(gp)) / 1e9).toFixed(3) + ' gwei · all new chunks ≈ ' + (Number(BigInt(gp)) * GAS / 1e18).toFixed(4) + ' ETH';
    $('#go').disabled = false;
    await paint(null, code);
  } catch (e) { paint('<span class="err">' + esc(e.message || e) + '</span>'); }
};
$('#go').onclick = async () => {
  $('#go').disabled = true;
  try {
    const have = await paint(null, code), todo = NEEDS.filter((i) => !have[i]);
    for (const i of todo) if ((await code(PLAN[i].address)).length > 2) throw new Error('Something else is already at ' + PLAN[i].address + '. Nothing was sent.');
    if (todo.length && (await atomicOk())) {
      const per = Math.max(1, Math.floor(TX_GAS / Math.max(...todo.map((i) => PLAN[i].bytes * 225 + 150000))));
      for (let k = 0; k < todo.length; k += per) { const b = todo.slice(k, k + per); await preflight('chunks', b.reduce((s, i) => s + PLAN[i].bytes * 225 + 150000, 0)); await sendBatch(b); await paint(null, code); }
    } else for (const i of todo) { await viaCreateX(i); await paint(null, code); }
    $('#onesay').innerHTML = '<span class="ok">Every chunk is on chain.</span>';
    await plan();
  } catch (e) { $('#onesay').innerHTML = '<span class="err">' + esc(e.message || e) + '</span>'; }
  $('#go').disabled = false;
};
async function plan() {
  $('#plan').textContent = 'reading…';
  try { const r = await fetch('/plan', { signal: AbortSignal.timeout(120000) }); $('#plan').textContent = await r.text(); } catch (e) { $('#plan').textContent = 'Could not read: ' + (e.message || e); }
}
$('#check').onclick = plan;
paint(); plan();
</script></body></html>`;
const port = Number(argv.find((a) => /^\d+$/.test(a)) || 8445);
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://localhost');
  if (u.pathname === '/plan') {
    status().then((v) => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(v, null, 2)); },
      (e) => { r.writeHead(500, { 'content-type': 'text/plain' }); r.end(String(e.message || e)); });
    return;
  }
  if (u.pathname === '/code') {                        // the code at an address, through the server's own node
    const a = u.searchParams.get('a') || '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { r.writeHead(400); return r.end('an address'); }
    rpcCall('eth_getCode', [a, 'latest']).then((c) => { r.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); r.end(c); }, (e) => { r.writeHead(502); r.end(String(e.message)); });
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); r.end(html);
})
  .listen(port, '127.0.0.1', () => console.log(`tacit.wei next version: http://127.0.0.1:${port}/  (${needsDeploy.length} of ${chunks.length} chunks new; follows ${base}; successor ${predicted}; steward ${OPS})`));
