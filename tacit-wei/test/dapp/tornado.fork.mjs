/* The page's fixed-pool flows (TC, dapp/parts/tornado.js) end to end on an anvil fork of Ethereum mainnet: the split into
   notes in one transaction through the deployed TacitSplitDeposit forwarder, a plain deposit, a wallet-paid withdrawal,
   and gasless withdrawals through the Kohaku TornadoPaymaster on EntryPoint v0.8 (an EIP-7702 throwaway sender) sent by
   an in-process bundler that submits handleOps to the fork as a type-4 transaction. Every proof comes from the page's own
   worker source (TC.WORKER) running the pinned wasm, and is accepted by the real pool's verifier on the fork. The pool's
   history is read the page's way (the published chunk cache, then the tail from the fork's node).

   node test/dapp/tornado.fork.mjs     (FORK=<upstream rpc>; PAGE_SRC=<page with the primitives>; TACIT=<z0r0z/tacit checkout
   holding dapp/vendor/fixed-pool-prover_bg.wasm>; ONLY_SWAP=1 runs only 6-8; needs anvil; a few minutes)                                          */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadTC } from './tornado-lib.mjs';
import { startAnvil, makeWallet, threadProver, mockBundler, EP_ABI, ethers as E, hx } from './tornado-fork-lib.mjs';

const PAGE = process.env.PAGE_SRC || '/Users/z/dapps-tacitwei/tacit-pay/dapp/page.html';
const TACIT = process.env.TACIT || '/Users/z/tacit-wt-tacitwei';
const TACIT_POOL = '0x000000c2A20657CE25f2Ba99737933D031AFBEE9';
const ETHER = 10n ** 18n, TENTH = ETHER / 10n;
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`); if (cond) pass++; else fail++; return cond; };
const eth = (w) => E.formatEther(BigInt(w));
const step = (label) => (s) => { if (['read', 'tree', 'prove', 'estimate', 'quote', 'wait', 'send', 'reprice', 'price'].includes(s.step) && !s.done) console.log(`    [${secs()}] ${label}: ${s.step}${s.fee != null ? ' fee ' + eth(s.fee) : ''}${s.count != null ? ' ' + s.count : ''}${s.note ? ' ' + s.note : ''}`); };
async function scenario(name, fn) {
  console.log(`\n${name}  [${secs()}]`);
  if (process.env.ONLY_SWAP && /^[1-5]/.test(name)) { console.log('  (skipped: ONLY_SWAP)'); return; }
  try { await fn(); } catch (e) { ok(false, `${name} threw: ${String(e?.stack || e?.message || e).split('\n').slice(0, 4).join(' | ')}`); }
}
async function rejects(p, re, what) {
  try { await p; ok(false, `${what}: expected a refusal`); return null; } catch (e) { ok(re.test(String(e?.message)), what, `(${String(e?.message).slice(0, 110)})`); return e; }
}

const { TC } = loadTC({ page: PAGE });
const wasmBytes = fs.readFileSync(`${TACIT}/dapp/vendor/fixed-pool-prover_bg.wasm`);
if (createHash('sha256').update(wasmBytes).digest('hex') !== TC.WASM.sha256) throw new Error('the wasm is not the one the page pins');

const fork = await startAnvil();
const prover = threadProver({ source: TC.WORKER, wasmBytes });
const watchdog = setTimeout(async () => { console.log('  FAIL  the whole run took over 40 minutes'); prover.close(); await fork.stop(); process.exit(2); }, 40 * 60_000);
console.log(`forked mainnet at block ${fork.forkBlock} from ${fork.upstream} (anvil pid ${fork.pid}, ${PAGE.replace(/.*dapps-tacitwei\//, '')})`);

try {
  const read = (method, params) => fork.rpc(method, params);
  const bal = async (a) => BigInt(await read('eth_getBalance', [a, 'latest']));
  const nonceOf = async (a) => Number(BigInt(await read('eth_getTransactionCount', [a, 'latest'])));
  const word = async (to, sig, args = '0x') => BigInt(await read('eth_call', [{ to, data: E.id(sig).slice(0, 10) + String(args).slice(2) }, 'latest']));
  const newStore = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), m }; };

  const userKey = E.Wallet.createRandom().privateKey;
  const sent = [];
  const W = makeWallet({ key: userKey, rpc: read, onSend: (s) => sent.push(s) });
  const account = W.address;
  await read('anvil_setBalance', [account, hx(10n * ETHER)]);
  const store = newStore();
  const flowOf = (opts = {}) => TC.makeFlow({ read, wallet: W.wallet, account, session: TC.newSession(), store, poll: 500, timeout: 180_000, ...opts });
  const flow = flowOf();
  const [P01, P1] = [TC.POOLS[0], TC.POOLS[1]];
  const cache = { pools: new Map(), loaded: null };
  let leafReads = 0;
  const leaves = (args) => { leafReads++; return TC.poolLeaves({ ...args, onProgress: (p) => { if (p.note) console.log(`    (${p.note})`); } }); };
  {
    // the published cache's real file names (stream and block range, with '[', ',' and ')') are read as they are
    const files = [];
    const r = await TC.readChunkCache({ base: TC.CACHES[0], pool: TC.POOLS[0], fetchImpl: (u, i) => { files.push(decodeURIComponent(new URL(u).pathname)); return fetch(u, i); }, onProgress: () => {} }).catch((e) => ({ error: e.message }));
    ok(!r.error && r.deposits.length > 70_000 && files.some((f) => /\[0x[0-9a-f]+,0x[0-9a-f]+\)/.test(f)), 'the page reads the published cache under its real file names', r.error ? `(${r.error})` : `(${files.length - 1} files, ${r.deposits.length} deposits up to block ${r.upTo})`);
  }
  const gasOf = async (h) => BigInt((await read('eth_getTransactionReceipt', [h])).gasUsed);
  const report = {};

  // ---- 1. the split into notes, one transaction ----
  let splitNotes = [];
  await scenario('1. split into notes in one transaction (TacitSplitDeposit)', async () => {
    const p25 = TC.planSplit(25n * ETHER / 100n, { min: TENTH });
    ok(p25.notes.length === 1 && p25.notes[0].denomination === TENTH && p25.notes[0].count === 2 && p25.remainder === 5n * ETHER / 100n && p25.noteCount === 2, 'plan of 0.25 ETH at min 0.1: two 0.1 notes and 0.05 for Tacit');
    ok(await TC.forwarderOk(read, TACIT_POOL, TC.POOLS), 'forwarderOk: the deployed forwarder is on the fork, wired to the Tacit pool and every fixed pool');
    ok(!(await TC.forwarderOk(read, '0x' + '11'.repeat(20), TC.POOLS)), 'forwarderOk refuses a forwarder wired to another Tacit pool');
    const plan = TC.planSplit(2n * TENTH, { min: TENTH });
    const before = { pool: await bal(P01.address), idx: await word(P01.address, 'nextIndex()'), fwd: await bal(TC.FORWARDER), nonce: await nonceOf(account), user: await bal(account) };
    const n0 = sent.length;
    const res = await flow.depositWith(plan, async (notes) => (await flow.sendOne(TC.splitDepositCall(null, notes))).hash, { onStep: step('split') });
    splitNotes = res.notes;
    ok(res.notes.length === 2 && res.notes[0].nonce === 0 && res.notes[1].nonce === 1, 'two notes made, numbers 0 and 1');
    ok(sent.length - n0 === 1 && (await nonceOf(account)) === before.nonce + 1, 'the wallet sent exactly one transaction');
    const tx = await read('eth_getTransactionByHash', [res.hash]);
    ok(tx.to.toLowerCase() === TC.FORWARDER.toLowerCase() && BigInt(tx.value) === 2n * TENTH, 'it went to the forwarder carrying exactly 0.2 ETH');
    report.splitGas = await gasOf(res.hash);
    const after = { pool: await bal(P01.address), idx: await word(P01.address, 'nextIndex()'), fwd: await bal(TC.FORWARDER) };
    ok(after.pool - before.pool === 2n * TENTH && after.idx === before.idx + 2n, `the 0.1 pool took both: +0.2 ETH, +2 deposits (index ${before.idx} -> ${after.idx})`);
    ok(after.fwd === before.fwd, 'the forwarder kept nothing');
    for (const n of res.notes) ok((await word(P01.address, 'commitments(bytes32)', TC.b32(n.secrets.commitment))) === 1n, `commitments(note ${n.nonce}) is true in the pool`);
    ok(store.get(`tacit-wei-fixed-next:${account.toLowerCase()}`) === '2', 'the next-number hint moved to 2');
    const fresh = flowOf({ store: newStore() });
    const sc = await fresh.scan();
    ok(sc.found.length === 2 && sc.found.map((f) => f.nonce).join() === '0,1' && sc.found.every((f) => f.pool.address === P01.address && f.spent === false) && sc.next === 2, 'a fresh session (no hint, no signatures kept) finds both notes, numbers 0 and 1, unspent', `(${report.splitGas} gas)`);
  });

  // ---- 2. a plain deposit ----
  await scenario('2. plain deposit of a 1 ETH note', async () => {
    const plan = TC.planSplit(ETHER, { min: ETHER });
    const before = { pool: await bal(P1.address), nonce: await nonceOf(account) };
    const res = await flow.deposit(plan, { onStep: step('deposit') });
    ok(res.notes.length === 1 && res.notes[0].nonce === 2 && res.notes[0].pool.address === P1.address, 'one 1 ETH note, number 2 (after the split\'s 0 and 1)');
    ok((await nonceOf(account)) === before.nonce + 1 && (await bal(P1.address)) - before.pool === ETHER, 'one transaction from the wallet, the 1 ETH pool +1 ETH');
    report.depositGas = await gasOf(sent.at(-1).hash);
    const sc = await flowOf({ store: newStore() }).scan();
    ok(sc.found.map((f) => `${f.nonce}:${TC.ethWords(f.pool.denomination)}`).join() === '0:0.1,1:0.1,2:1' && sc.found.every((f) => !f.spent), 'a fresh scan finds 0 and 1 (0.1) and 2 (1 ETH), all unspent', `(${report.depositGas} gas)`);
  });

  const noteA = await flow.noteText({ nonce: 0, pool: P01.address });
  const noteB = await flow.noteText({ nonce: 1, pool: P01.address });
  const noteC = await flow.noteText({ nonce: 2, pool: P1.address });
  const nh = (t) => TC.parseNote(t).nullifierHash;

  // ---- 3. wallet-paid withdrawal ----
  await scenario('3. wallet-paid withdrawal of a 0.1 note', async () => {
    const recipient = E.Wallet.createRandom().address;
    const before = { nonce: await nonceOf(account), user: await bal(account), r: await bal(recipient) };
    const asked = [];
    const res = await flow.withdraw({ noteText: noteA, recipient, prover, leaves, cache, confirm: async (q) => { asked.push(q); return true; }, onStep: step('withdraw') });
    const got = (await bal(recipient)) - before.r;
    report.withdrawGas = await gasOf(res.hash);
    ok(got === TENTH, `the recipient got exactly ${eth(got)} ETH`);
    ok(res.spent === true && (await flow.spent(P01, nh(noteA))), 'the note shows spent');
    ok(asked.length === 1 && asked[0].fee === 0n && asked[0].receive === TENTH, 'confirm was asked once: no fee, the whole note');
    ok((await nonceOf(account)) === before.nonce + 1, 'the wallet sent the one withdrawal transaction', `(${report.withdrawGas} gas, the tree of ${(await word(P01.address, 'nextIndex()'))} leaves built in ${prover.stats.treeMs.at(-1)} ms, proof ${prover.stats.proveMs.at(-1)} ms)`);
    const root = cache.pools.get(P01.address)?.root;
    ok(!!root && (await flow.knownRoot(P01, root)), 'the tree from the chunk cache and the fork\'s tail landed on a root the pool knows', `(${root})`);
  });

  // ---- the bundler ----
  const mainnetPrice = async () => {
    // what a public bundler quotes: twice the network's base fee plus a small tip (the live chain's, read-only; else the fork's)
    let base;
    try { const b = await (await fetch(fork.upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }), signal: AbortSignal.timeout(10_000) })).json(); base = BigInt(b.result.baseFeePerGas); } catch { base = BigInt((await read('eth_getBlockByNumber', ['latest', false])).baseFeePerGas); }
    const tip = 10n ** 8n;
    return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
  };
  const bundlerKey = E.Wallet.createRandom().privateKey;
  const blog = [];
  const B = mockBundler({ rpc: read, key: bundlerKey, entryPoint: TC.ENTRY_POINT, price: mainnetPrice, log: blog });
  await read('anvil_setBalance', [B.address, hx(5n * ETHER)]);
  const BUNDLER_URL = 'https://bundler.invalid/rpc';
  const epDeposit = () => word(TC.ENTRY_POINT, 'balanceOf(address)', '0x' + TC.PAYMASTER.slice(2).padStart(64, '0'));
  report.paymasterDeposit = await epDeposit();

  // ---- 5c (first, while the 1 ETH note is unspent): confirm says no ----
  await scenario('5c. confirm returning false sends nothing', async () => {
    const recipient = E.Wallet.createRandom().address;
    const before = { nonce: await nonceOf(account), sends: B.state.sends };
    const e1 = await rejects(flow.withdraw({ noteText: noteC, recipient, prover, leaves, cache, confirm: async () => false, onStep: step('withdraw-no') }), /Cancelled/, 'wallet-paid: confirm false is a cancel');
    ok(e1?.cancelled === true && (await nonceOf(account)) === before.nonce, 'nothing sent from the wallet');
    B.mode.estimate = 'aa33';
    const e2 = await rejects(flow.withdrawSponsored({ noteText: noteC, recipient, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl, confirm: async () => false, onStep: step('sponsored-no') }), /Cancelled/, 'gasless: confirm false is a cancel');
    ok(e2?.cancelled === true && B.state.sends === before.sends && !blog.some((l) => l.method === 'eth_sendUserOperation'), 'no operation reached the bundler');
    ok(!(await flow.spent(P1, nh(noteC))) && (await bal(recipient)) === 0n && (await nonceOf(account)) === before.nonce, 'the note stays unspent, the recipient got nothing, the wallet sent nothing');
  });

  // ---- 4. gasless withdrawals ----
  const gasless = async (label, noteText, pool, estimateMode) => {
    B.mode.estimate = estimateMode;
    const recipient = E.Wallet.createRandom().address;
    const before = { nonce: await nonceOf(account), user: await bal(account), r: await bal(recipient), pm: await bal(TC.PAYMASTER), dep: await epDeposit(), sends: B.state.sends, est: B.state.estimates.length, proves: prover.stats.proves };
    const asked = [], steps = [];
    const res = await flow.withdrawSponsored({ noteText, recipient, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl, confirm: async (q) => { asked.push(q); return true; }, onStep: (s) => { steps.push(s); step(label)(s); } });
    const sentOp = B.state.handleOps.at(-1), rc = await read('eth_getTransactionReceipt', [sentOp.txHash]);
    const evTopic = EP_ABI.getEvent('UserOperationEvent').topicHash, evLog = rc.logs.find((l) => l.address.toLowerCase() === TC.ENTRY_POINT.toLowerCase() && l.topics[0] === evTopic);
    const ev = evLog ? EP_ABI.parseLog(evLog) : null;
    const got = (await bal(recipient)) - before.r, fee = res.fee, den = pool.denomination, refund = got - (den - fee);
    const waitHash = steps.find((s) => s.step === 'wait')?.hash;
    ok(B.state.sends === before.sends + 1 && sentOp.type === 4, 'one operation sent, as a type-4 transaction carrying the throwaway sender\'s 7702 authorization');
    ok(rc.status === '0x1' && ev?.args.success === true, 'handleOps mined and the operation succeeded (UserOperationEvent success)');
    ok(String(waitHash).toLowerCase() === String(sentOp.hash).toLowerCase(), 'the page\'s operation hash is the EntryPoint\'s getUserOpHash');
    const code = await read('eth_getCode', [ev.args.sender, 'latest']);
    ok(code.toLowerCase() === '0xef0100' + TC.SIMPLE_7702.slice(2).toLowerCase(), 'the sender is now delegated to Simple7702Account, and holds nothing', `(${ev.args.sender}, ${eth(await bal(ev.args.sender))} ETH)`);
    ok(asked.length === 1 && asked[0].fee === fee && asked[0].receive === den - fee, `confirm asked once with the fee the proof names: ${eth(fee)} ETH`);
    ok(fee * 100n <= den * 3n, `the confirmed fee is within 3% of the note (${(Number(fee * 10000n / den) / 100).toFixed(2)}%)`);
    ok(got >= den - fee && got <= den, `the recipient got ${eth(got)} ETH = ${eth(den)} - fee ${eth(fee)} + postOp refund ${eth(refund)}`);
    ok(res.spent === true && (await flow.spent(pool, nh(noteText))), 'the note shows spent');
    ok((await nonceOf(account)) === before.nonce && (await bal(account)) === before.user, 'the user\'s wallet sent nothing and paid nothing (nonce and balance unchanged)');
    const pmGain = (await bal(TC.PAYMASTER)) - before.pm, depDrop = before.dep - (await epDeposit());
    ok(pmGain + refund === fee && depDrop === ev.args.actualGasCost, 'the paymaster kept fee - refund in ETH, and its EntryPoint deposit paid the actual gas cost', `(kept ${eth(pmGain)}, deposit -${eth(depDrop)})`);
    return { fee, got, refund, gasUsed: BigInt(rc.gasUsed), actualGasCost: ev.args.actualGasCost, actualGasUsed: ev.args.actualGasUsed, proofs: prover.stats.proves - before.proves, estimates: B.state.estimates.slice(before.est), steps: steps.map((s) => s.step) };
  };
  await scenario('4a. gasless withdrawal of the 0.1 note, the bundler estimating for real', async () => {
    report.g1 = await gasless('gasless-0.1', noteB, P01, 'real');
    const est = report.g1.estimates;
    ok(est.length >= 1 && est.every((e) => e.mode === 'real') && report.g1.steps.filter((s) => s === 'estimate').length === est.length, `the page took the bundler's estimates (${est.length} round${est.length > 1 ? 's' : ''}, ${report.g1.proofs} proofs)`, `(pmVGL ${est.at(-1)?.paymasterVerificationGasLimit}, VGL ${est.at(-1)?.verificationGasLimit}, postOp ${est.at(-1)?.paymasterPostOpGasLimit}, PVG ${est.at(-1)?.preVerificationGas})`);
  });
  await scenario('4b. gasless withdrawal of the 1 ETH note, the estimate refused (AA33 CallGasLimitNonZero) so the fallback limits are used', async () => {
    report.g2 = await gasless('gasless-1', noteC, P1, 'aa33');
    ok(report.g2.estimates.length === 1 && report.g2.estimates[0].mode === 'aa33' && report.g2.proofs === 2, 'one estimate refused, then the keychain\'s fallback limits with a second proof');
  });

  // ---- 5. refusals ----
  await scenario('5a/5b. refusals before any proof', async () => {
    const before = { proves: prover.stats.proves, reads: leafReads, blog: blog.length, nonce: await nonceOf(account) };
    const e = await rejects(flow.withdraw({ noteText: noteA, recipient: E.Wallet.createRandom().address, prover, leaves, cache }), /already spent/, 'a spent note is refused (wallet-paid)');
    ok(e?.spent === true, 'the refusal says spent');
    await rejects(flow.withdrawSponsored({ noteText: noteB, recipient: E.Wallet.createRandom().address, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl }), /already spent/, 'a spent note is refused (gasless)');
    const other = noteA.replace(/-1-0x/, '-5-0x');
    await rejects(flow.withdraw({ noteText: other, recipient: E.Wallet.createRandom().address, prover, leaves, cache }), /chain 5/, 'a note for another chain is refused (wallet-paid)');
    await rejects(flow.withdrawSponsored({ noteText: other, recipient: E.Wallet.createRandom().address, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl }), /chain 5/, 'a note for another chain is refused (gasless)');
    ok(prover.stats.proves === before.proves && leafReads === before.reads && blog.length === before.blog && (await nonceOf(account)) === before.nonce, 'no proof made, no history read, no bundler asked, nothing sent');
  });

  // ---- 8. unit: the swap-out account's key and its call ----
  await scenario('8. noteKey and executeCall', async () => {
    const pa = TC.parseNote(noteA).preimage, pb = TC.parseNote(noteB).preimage;
    // (TC's bytes come from the VM's realm, which ethers' instanceof check does not take: copied into this one)
    const u8 = (b) => Uint8Array.from(b), ka = u8(TC.noteKey(pa)), kb = u8(TC.noteKey(pb));
    ok(E.hexlify(ka) === E.hexlify(u8(TC.noteKey(TC.parseNote(noteA).preimage))) && E.hexlify(ka) !== E.hexlify(kb), 'noteKey is the same for the same note and differs between notes');
    ok(ka.length === 32 && new E.Wallet(E.hexlify(ka)).address.toLowerCase() === TC.addressOf(ka).toLowerCase(), 'addressOf(noteKey) is the key\'s address as ethers derives it');
    const I = new E.Interface(['function execute(address target, uint256 value, bytes data)']);
    let same = true;
    for (const [t, v, d] of [[TC.POOLS[0].address, 0n, '0x'], ['0x000000000000FB114709235f1ccBFfb925F600e4', 99n * 10n ** 15n, '0x21c0dad2' + 'ab'.repeat(288)], [E.Wallet.createRandom().address, 2n ** 255n, '0x01']]) same &&= TC.executeCall(t, v, d).toLowerCase() === I.encodeFunctionData('execute', [t, v, d]).toLowerCase();
    ok(same, 'executeCall matches ethers\' encoding of Simple7702Account.execute(address,uint256,bytes)');
  });

  // ---- 6/7. swap-outs: the note to USDC through zRouter, from the note's one-time account ----
  const ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4', ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', USDC = '0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48';
  const usdc = (a) => word(USDC, 'balanceOf(address)', '0x' + a.slice(2).toLowerCase().padStart(64, '0'));
  const qU = (n) => BigInt(n).toString(16).padStart(64, '0'), qA = (a) => a.slice(2).toLowerCase().padStart(64, '0');
  // zQuoter's single best exact-in route (selector 0xe7798987), read as the page's routeOf reads it (u 0, v 4, mv 6)
  function routeOf(h, slip, u, v, S, mv) {
    const x = h.replace(/^0x/, ''), num = (i) => BigInt('0x' + (x.slice(i * 64, (i + 1) * 64) || '0'));
    if (x.length < Math.max(v + 2, (mv || v + 1) + 1) * 64) return null;
    const o = Number(num(v)) * 2;
    if (o + 64 > x.length) return null;
    const n = Number(BigInt('0x' + x.slice(o, o + 64)));
    if (!n || o + 64 + n * 2 > x.length) return null;
    const g = num(u + 3), B = 10000n, out = S ? num(3) + g : g > 0n ? g : num(3);
    if (!out) return null;
    return { out, inp: S || num(2), limit: S ? num(3) * (B - slip) / B + g * (B - slip) / B : out * (B - slip) / B, value: num(mv || v + 1), data: '0x' + x.slice(o + 64, o + 64 + n * 2), minWord: x.slice(5 * 64, 6 * 64) };
  }
  const SLIP = 50n;
  // The quoter reads every venue it knows: thousands of cold slots a fork fetches one by one from its free upstream node
  // (it did not answer in 25 s, and the fetches it went on with got the upstream to answer with a challenge page). So
  // it is asked of public nodes at the fork's block, where the pools are the fork's own until a swap here moves one (the
  // route's minimum covers that, and the fork is what runs it). QUOTE_ON_FORK=1 asks the fork first.
  let quoteFrom = null;
  const QUOTE_NODES = [...new Set(['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', fork.upstream])];
  const rawCall = async (url, data, tag, ms) => { const t = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ZQUOTER, data }, tag] }), signal: AbortSignal.timeout(ms) })).text(); let j; try { j = JSON.parse(t); } catch { throw new Error(`not JSON: ${t.slice(0, 40)}`); } if (j.error || !j.result) throw new Error(j.error?.message || 'no result'); return j.result; };
  const quoterCall = async (data) => {
    if (process.env.QUOTE_ON_FORK && quoteFrom !== 'nodes') { try { const h = await rawCall(fork.url, data, 'latest', 25_000); quoteFrom = 'fork'; return h; } catch (e) { console.log(`    (the fork could not quote in time: ${String(e.message).slice(0, 60)})`); } }
    for (const u of QUOTE_NODES) { try { const h = await rawCall(u, data, hx(fork.forkBlock), 30_000); quoteFrom = 'nodes'; return h; } catch (e) { console.log(`    (quote from ${u} failed: ${String(e.message).slice(0, 60)})`); } }
    throw new Error('no node could quote');
  };
  const quote = async (amountIn, to) => {
    const now = BigInt((await read('eth_getBlockByNumber', ['latest', false])).timestamp);
    const data = '0xe7798987' + qA(to) + qU(0) + qA('0x' + '00'.repeat(20)) + qA(USDC) + qU(amountIn) + qU(SLIP) + qU(now + 1200n);
    const r = routeOf(await quoterCall(data), SLIP, 0, 4, 0, 6);
    if (!r || r.value !== amountIn || !r.data.toLowerCase().includes(to.slice(2).toLowerCase())) throw new Error('no usable route');
    return r;
  };
  const routes = [];
  const swapFor = (to, { impossible = false } = {}) => ({
    router: ZROUTER,
    async route(amountIn) {
      const r = await quote(amountIn, to);
      let data = r.data;
      if (impossible) { const i = data.toLowerCase().indexOf(r.minWord.toLowerCase()); if (i < 0 || (i - 10) % 64) throw new Error('the minimum is not where expected in the route'); data = data.slice(0, i) + qU(BigInt('0x' + r.minWord) * 1000n) + data.slice(i + 64); }
      const out = { to: ZROUTER, value: amountIn, data, out: r.out, limit: impossible ? BigInt('0x' + r.minWord) * 1000n : r.limit };
      routes.push(out);
      return out;
    },
  });
  // what the route's call takes, from any funded address (the page's own estimate is from the address holding the ETH)
  const callGasOf = async (to) => { const r = await quote(TENTH * 99n / 100n, to); return BigInt(await read('eth_estimateGas', [{ from: B.address, to: ZROUTER, value: hx(r.value), data: r.data }])); };
  // three more 0.1 notes for these (nonces 3, 4, 5), through the forwarder in one transaction
  let swapNotes = [];
  await scenario('6. setup: three more 0.1 notes', async () => {
    const res = await flow.depositWith(TC.planSplit(3n * TENTH, { min: TENTH }), async (notes) => (await flow.sendOne(TC.splitDepositCall(null, notes))).hash, { onStep: step('split3') });
    swapNotes = await Promise.all(res.notes.map((n) => flow.noteText({ nonce: n.nonce, pool: P01.address })));
    ok(res.notes.length === 3 && res.notes.map((n) => n.nonce).join() === (process.env.ONLY_SWAP ? '0,1,2' : '3,4,5'), `notes ${res.notes.map((n) => n.nonce).join(', ')} are in the 0.1 pool`);
  });
  const sweepRaw = [];
  const readCapture = async (method, params) => { if (method === 'eth_sendRawTransaction') sweepRaw.push(params[0]); return read(method, params); };
  const swapOut = async (label, noteText, estimateMode) => {
    B.mode.estimate = estimateMode;
    const recipient = E.Wallet.createRandom().address, key = TC.noteKey(TC.parseNote(noteText).preimage), acct = TC.addressOf(key);
    const swap = { ...swapFor(recipient), gas: await callGasOf(recipient) };
    const before = { nonce: await nonceOf(account), user: await bal(account), u: await usdc(recipient), sends: B.state.sends, est: B.state.estimates.length, proves: prover.stats.proves, acct: await bal(acct) };
    const asked = [], steps = [];
    const res = await flow.withdrawSponsored({ noteText, recipient, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl, swap, confirm: async (q) => { asked.push(q); return true; }, onStep: (s) => { steps.push(s); step(label)(s); } });
    const sentOp = B.state.handleOps.at(-1), rc = await read('eth_getTransactionReceipt', [sentOp.txHash]);
    const evLog = rc.logs.find((l) => l.topics[0] === EP_ABI.getEvent('UserOperationEvent').topicHash), ev = EP_ABI.parseLog(evLog);
    const gotU = (await usdc(recipient)) - before.u, fee = res.fee, den = P01.denomination, held = await bal(acct);
    ok(before.acct === 0n && res.account?.toLowerCase() === acct.toLowerCase() && ev.args.sender.toLowerCase() === acct.toLowerCase(), 'the operation\'s sender is the note\'s one-time account, TC.addressOf(TC.noteKey(preimage))', `(${acct})`);
    ok(rc.status === '0x1' && ev.args.success === true && sentOp.type === 4, 'one type-4 handleOps, the operation succeeded');
    ok(gotU >= res.route.limit && res.route.limit > 0n, `the recipient's USDC rose by ${E.formatUnits(gotU, 6)}, at least the route's minimum ${E.formatUnits(res.route.limit, 6)} (quoted ${E.formatUnits(res.route.out, 6)})`);
    ok(res.route.value === den - fee && asked.length === 1 && asked[0].fee === fee && asked[0].route?.limit === res.route.limit, 'the route swaps exactly the note less the fee, and confirm saw that fee and that minimum');
    ok(fee * 100n <= den * 3n, `the confirmed fee is within 3% of the note: ${eth(fee)} ETH (${(Number(fee * 10000n / den) / 100).toFixed(2)}%)`);
    ok(res.spent === true && (await flow.spent(P01, nh(noteText))), 'the note shows spent');
    const code = await read('eth_getCode', [acct, 'latest']);
    ok(code.toLowerCase() === '0xef0100' + TC.SIMPLE_7702.slice(2).toLowerCase() && held > 0n && held < fee, `the account is delegated and holds only the postOp refund: ${eth(held)} ETH`);
    ok((await usdc(acct)) === 0n, 'the account holds no USDC');
    ok((await nonceOf(account)) === before.nonce && (await bal(account)) === before.user, 'the user\'s wallet sent nothing and paid nothing');
    const est = B.state.estimates.slice(before.est);
    return { recipient, key, acct, fee, gotU, limit: res.route.limit, out: res.route.out, refund: held, swapGas: swap.gas, callGasLimit: BigInt(B.ops.get(sentOp.hash).op.callGasLimit), gasUsed: BigInt(rc.gasUsed), actualGasUsed: ev.args.actualGasUsed, proofs: prover.stats.proves - before.proves, est };
  };
  const sweep = async (label, key, acct) => {
    const to = E.Wallet.createRandom().address, balBefore = await bal(acct);
    const n0 = sweepRaw.length;
    const r = await TC.sweepThrowaway({ read: readCapture, key, to });
    const raw = sweepRaw[n0], tx = E.Transaction.from(raw), rc = await read('eth_getTransactionReceipt', [r.hash]);
    ok(sweepRaw.length === n0 + 1 && tx.from.toLowerCase() === acct.toLowerCase() && tx.to.toLowerCase() === to.toLowerCase() && tx.value === r.value && tx.chainId === 1n && tx.type === 2, `${label}: the raw transaction decodes (ethers Transaction.from) as a type-2 from the account to the address`);
    const got = await bal(to), cost = BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice);
    ok(rc.status === '0x1' && got === r.value && (await bal(acct)) === balBefore - r.value - cost, `${label}: ${eth(got)} ETH arrived (the account's ${eth(balBefore)} less ${eth(balBefore - got)} kept back for gas; ${BigInt(rc.gasUsed)} gas, cost ${eth(cost)})`);
    return { got, gas: BigInt(rc.gasUsed), cost, left: await bal(acct) };
  };
  await scenario('6a. swap-out of a 0.1 note to USDC, the bundler estimating for real', async () => {
    report.s1 = await swapOut('swap-real', swapNotes[0], 'real');
    ok(report.s1.est.length >= 1 && report.s1.est.every((e) => e.mode === 'real') && report.s1.est.at(-1).callGasLimit > 0n, `the page took the bundler's estimates, the call's included (${report.s1.est.length} rounds, ${report.s1.proofs} proofs; call estimate ${report.s1.est.at(-1).callGasLimit}, swap.gas ${report.s1.swapGas}, callGasLimit sent ${report.s1.callGasLimit})`);
    try { report.sw1 = await sweep('sweep of the refund', report.s1.key, report.s1.acct); } catch (e) { ok(/would not cover the gas/.test(e.message), 'the refund is too small to sweep, and is refused as such', `(${e.message})`); }
  });
  await scenario('6b. swap-out of a 0.1 note to USDC, the estimate failing opaquely so the fallback limits are used', async () => {
    report.s2 = await swapOut('swap-fallback', swapNotes[1], 'opaque');
    ok(report.s2.est.length === 1 && report.s2.est[0].mode === 'opaque' && report.s2.callGasLimit === report.s2.swapGas * 3n / 2n, `fallback: callGasLimit is half again the call's own estimate (${report.s2.callGasLimit})`);
  });
  await scenario('7. a swap-out whose call fails on chain leaves the note\'s ETH at its account, and the account sends it on', async () => {
    const noteText = swapNotes[2], key = TC.noteKey(TC.parseNote(noteText).preimage), acct = TC.addressOf(key), recipient = E.Wallet.createRandom().address, den = P01.denomination;
    const swap = { ...swapFor(recipient, { impossible: true }), gas: await callGasOf(recipient) };
    // (the account's balance is not read first: that read would name the note's withdrawal to the node, and what an
    // account already holds stays there for the sweep)
    const s0 = B.state.sends;
    // a bundler that simulates the call refuses the route: nothing is sent
    B.mode.estimate = 'real';
    const e1 = await rejects(flow.withdrawSponsored({ noteText, recipient, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl, swap, confirm: async () => true }), /would not take the withdrawal/, 'with real estimates the failing route is refused at estimation');
    ok(B.state.sends === s0 && !(await flow.spent(P01, nh(noteText))) && (await bal(acct)) === 0n, 'nothing sent, the note unspent');
    // a bundler that cannot estimate: the operation lands, its call fails
    B.mode.estimate = 'opaque';
    const asked = [];
    const e = await rejects(flow.withdrawSponsored({ noteText, recipient, prover, leaves, cache, bundlers: [BUNDLER_URL], fetchImpl: B.fetchImpl, swap, confirm: async (q) => { asked.push(q); return true; }, onStep: step('swap-fails') }), /swap did not go through/, 'withdrawSponsored throws the stranded error');
    const sentOp = B.state.handleOps.at(-1), rc = await read('eth_getTransactionReceipt', [sentOp.txHash]);
    const ev = EP_ABI.parseLog(rc.logs.find((l) => l.topics[0] === EP_ABI.getEvent('UserOperationEvent').topicHash));
    const fee = asked.at(-1)?.fee, held = await bal(acct);
    ok(e?.stranded === true && e?.sender?.toLowerCase() === acct.toLowerCase() && B.state.sends === s0 + 1 && rc.status === '0x1' && ev.args.success === false, 'the operation landed with success=false; the error says stranded, with sender = the account');
    ok(await flow.spent(P01, nh(noteText)), 'the note is spent');
    ok(fee != null && held >= den - fee && held <= den && (await usdc(recipient)) === 0n, `the account holds the note less the fee plus the refund: ${eth(held)} ETH (fee ${eth(fee)}, refund ${eth(held - (den - fee))}); the recipient got no USDC`);
    report.s3 = { fee, held, refund: held - (den - fee), actualGasUsed: ev.args.actualGasUsed };
    report.sw3 = await sweep('sweep of the stranded note', key, acct);
  });

  console.log('\nnumbers');
  console.log(`  fork block ${fork.forkBlock} (${fork.upstream}); paymaster EntryPoint deposit at fork ${eth(report.paymasterDeposit)} ETH`);
  console.log(`  gas: split deposit (2 notes via forwarder) ${report.splitGas}, plain 1 ETH deposit ${report.depositGas}, wallet-paid withdrawal ${report.withdrawGas}`);
  for (const [k, g] of [['gasless 0.1 (real estimate)', report.g1], ['gasless 1 (fallback limits)', report.g2]]) if (g) console.log(`  ${k}: fee ${eth(g.fee)}, recipient ${eth(g.got)}, refund ${eth(g.refund)}, handleOps tx gas ${g.gasUsed}, op actualGasUsed ${g.actualGasUsed}, actualGasCost ${eth(g.actualGasCost)}, proofs ${g.proofs}`);
  for (const [k, g] of [['swap-out 0.1 (real estimate)', report.s1], ['swap-out 0.1 (fallback limits)', report.s2]]) if (g) console.log(`  ${k}: USDC out ${E.formatUnits(g.gotU, 6)} vs minimum ${E.formatUnits(g.limit, 6)} (quoted ${E.formatUnits(g.out, 6)}), fee ${eth(g.fee)}, swap.gas ${g.swapGas}, callGasLimit ${g.callGasLimit}, handleOps tx gas ${g.gasUsed}, op actualGasUsed ${g.actualGasUsed}, refund at the account ${eth(g.refund)}, proofs ${g.proofs}`);
  console.log(`  quotes from: ${quoteFrom === 'nodes' ? `public nodes at block ${fork.forkBlock}` : quoteFrom}`);
  if (report.sw1) console.log(`  sweep of the 6a refund: ${eth(report.sw1.got)} arrived, ${report.sw1.gas} gas (${eth(report.sw1.cost)}), ${eth(report.sw1.left)} left at the account`);
  if (report.s3) console.log(`  stranded swap-out: fee ${eth(report.s3.fee)}, account held ${eth(report.s3.held)} (refund ${eth(report.s3.refund)}), op actualGasUsed ${report.s3.actualGasUsed}; sweep ${eth(report.sw3?.got ?? 0n)} arrived, ${report.sw3?.gas} gas, ${eth(report.sw3?.left ?? 0n)} left`);
  console.log(`  prover: ${prover.stats.proves} proofs (${prover.stats.proveMs.join(', ')} ms), ${prover.stats.loads} tree loads (${prover.stats.treeMs.join(', ')} ms)`);
} finally {
  clearTimeout(watchdog);
  prover.close();
  await fork.stop();
}
console.log(`\n${pass} passed, ${fail} failed  (${secs()})`);
process.exit(fail ? 1 : 0);
