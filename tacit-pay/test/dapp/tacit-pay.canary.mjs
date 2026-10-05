/* A live canary on Ethereum mainnet, with real money: the page (served here) against the real pool, router, zRouter, the
   onchain token list and the live relays. A funded wallet shields twice, then the page withdraws as USDC and as DAI
   through the relay, and moves part to Base, where the live Base relay moves it into the private balance.

   Keys: CANARY=<json with funder, destUSDC, destDAI (address, key) and tacitKey>. Everything stays recoverable from it.
   Usage: CANARY=… ARTIFACTS=<dir> [SHIELD=0.0028] [SWAP=0.001] node test/dapp/tacit-pay.canary.mjs [shield] [usdc] [dai] [base]  */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const {JsonRpcProvider, Wallet, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const K = JSON.parse(fs.readFileSync(process.env.CANARY, 'utf8'));
const steps = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['shield', 'swap1', 'swap2']);
// CHAIN: which pool; SHIELD and SWAP in ETH. Two tokens per chain from the onchain list: [symbol, address, decimals].
const CHAIN = process.env.CHAIN || 'ethereum';
const CFG = {
  ethereum: {id: 1, rpc: 'https://ethereum-rpc.publicnode.com', tokens: [['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6], ['DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18]]},
  base: {id: 8453, rpc: 'https://base-rpc.publicnode.com', tokens: [['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6], ['DAI', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18]]},
  robinhood: {id: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com', tokens: [['USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168', 6], ['NVDA', '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 18]]},
}[CHAIN];
const SHIELD = (process.env.SHIELD || '0.0028').split(','), SWAP = process.env.SWAP || '0.001';
const RPC = {1: 'https://ethereum-rpc.publicnode.com', 8453: 'https://mainnet.base.org', 4663: 'https://rpc.mainnet.chain.robinhood.com'};
const PROV = Object.fromEntries(Object.entries(RPC).map(([k, u]) => [k, new JsonRpcProvider(u, Number(k), {staticNetwork: true})]));
const eth = PROV[CFG.id], base = PROV[8453];
const READS = {8453: new JsonRpcProvider('https://base-rpc.publicnode.com', 8453, {staticNetwork: true})};
// WALLET: which of the canary's wallets signs (funder by default; destUSDC holds the swapped USDC).
const funder = new Wallet(K[process.env.WALLET || 'funder'].key, eth);
const {getAddress} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const TOKENS = CFG.tokens.map(([sym, a, d]) => [sym, getAddress(a), d]);
// Token balances through the chain's publicnode endpoint (Base's own endpoint rate-limits bursts).
const reads = new JsonRpcProvider(CFG.rpc, CFG.id, {staticNetwork: true});
const bal = async (t, a) => BigInt(await reads.call({to: t, data: '0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0')}));
const units = (v, d) => { const s = v.toString().padStart(d + 1, '0'); return `${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`.replace(/\.?0+$/, ''); };
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const log = (m) => console.log(`  ${new Date().toISOString().slice(11, 19)} ${m}`);

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const browser = await chromium.launch();
const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
// The proving files from disk (the same bytes the page pins); everything else is the real network.
await ctx.route(/\/(transact\.wasm|transact_final\.zkey)$/, (route) => route.fulfill({status: 200, contentType: 'application/octet-stream', headers: {'access-control-allow-origin': '*'}, body: fs.readFileSync(`${process.env.ARTIFACTS}/${new URL(route.request().url()).pathname.split('/').pop()}`)}));
// The wallet: the funder's key, signing here; reads go to the chain the wallet is on.
let chain = CFG.id;
await ctx.exposeFunction('__rpc', async (method, params) => {
  const p = PROV[chain];
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [funder.address];
  if (method === 'eth_chainId') return '0x' + chain.toString(16);
  if (method === 'wallet_switchEthereumChain') { chain = Number(params[0].chainId); return null; }
  if (method === 'eth_sendTransaction') {
    const t = params[0], w = funder.connect(p);
    // A small tip and a fee cap of 1.5× the base fee, so a small balance is not held back for gas it will never pay.
    const baseFee = (await p.getBlock('latest')).baseFeePerGas, tip = chain === 1 ? 50_000_000n : 1_000_000n;
    const req = {to: t.to, data: t.data || '0x', value: BigInt(t.value || 0), maxPriorityFeePerGas: tip, maxFeePerGas: baseFee * 3n / 2n + tip};
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({to: t.to, data: t.data, value: String(t.value || 0), chain}));
    req.gasLimit = t.gas ? BigInt(t.gas) : (await p.estimateGas({...req, from: funder.address})) * 6n / 5n;
    const tx = await w.sendTransaction(req);
    log(`wallet sent ${tx.hash} on ${chain}`);
    return tx.hash;
  }
  if (method === 'personal_sign') throw Object.assign(new Error('not in this canary'), {code: 4200});
  // Approvals by signature (EIP-2612, Permit2); this wallet sends no batches.
  if (method === 'eth_signTypedData_v4') { const td = JSON.parse(params[1]), {EIP712Domain, ...types} = td.types; return funder.signTypedData(td.domain, types, td.message); }
  if (method === 'wallet_getCapabilities' || method === 'wallet_sendCalls') throw Object.assign(new Error('not in this canary'), {code: 4200});
  // Reads go to the chain's publicnode endpoint first: Base's own endpoint rate-limits bursts.
  return (READS[chain] || p).send(method, params || []).catch(() => p.send(method, params || []));
});
await ctx.addInitScript(`window.ethereum = { on() {}, removeListener() {}, request: ({ method, params }) => window.__rpc(method, params) };`);
const p = await ctx.newPage();
p.errors = [];
p.on('pageerror', (e) => p.errors.push(String(e)));
await p.goto(`http://127.0.0.1:${server.address().port}/`);
const status = async (re, ms = 900e3) => { await p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status').textContent) || document.querySelector('#status .err') || /not confirmed/.test(document.querySelector('#status').textContent), re.source, {timeout: ms}); return (await p.textContent('#status')).trim(); };
await p.click('#tabs [data-tab="receive"]');
await p.click('#form [data-in="paste"]'); await p.fill('#form .opts input', K.tacitKey); await p.click('#form [data-in="key"]');
await p.waitForSelector('#form .addr code');
await p.click(`#chains [data-chain="${CFG.id}"]`);
log(`signed in, on ${CHAIN}; funder holds ${Number(await eth.getBalance(funder.address)) / 1e18} ETH there`);

if (steps.has('shield')) {
  console.log(`\nshield ${SHIELD.join(' + ')} from the wallet`);
  for (const amt of SHIELD) {
    await p.click('#tabs [data-tab="shield"]');
    await p.click('[data-from="wallet"]');
    if (await p.$('#f-conn')) await p.click('#f-conn');
    await p.waitForSelector('#f-max');
    await p.fill('#f-samt', amt);
    await p.waitForFunction(() => !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
    await p.click('#f-go');
    const s = await status(/Shielded|err/);
    ok(/Shielded/.test(s), `shield ${amt}`, s);
  }
}

const swap = async (sym, token, dest) => {
  console.log(`\nwithdraw ${SWAP} ETH as ${sym} through the relay`);
  await p.click('#tabs [data-tab="withdraw"]');
  if (!new RegExp(sym).test(await p.textContent('#f-tok'))) {
    await p.click('#f-tok');
    await p.waitForSelector(`[data-tk="${token}"]`, {timeout: 120e3});
    await p.click(`[data-tk="${token}"]`);
    // On a rollup the token's decimals are read before it is taken: wait for the form to name it.
    await p.waitForFunction((x) => new RegExp(x).test(document.querySelector('#f-tok')?.textContent || ''), sym, {timeout: 60e3});
  }
  await p.fill('#f-wto', dest);
  await p.fill('#f-wamt', SWAP);
  const ready = await p.waitForFunction(() => /At least/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3}).then(() => true, () => false);
  const r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
  if (!ready) { ok(false, `the form was ready to send`, `receipt: ${r.slice(0, 240)} | button: ${await p.textContent('#f-go')} | route line: ${(await p.textContent('#form .route').catch(() => '')).slice(0, 120)}`); return; }
  log(r.slice(0, 220));
  const least = new RegExp(`At least\\s*([\\d.]+)\\s*${sym}`).exec(r)?.[1], before = await bal(token, dest);
  await p.click('#f-go');
  const s = await status(/Sent about|err/);
  ok(/Sent about/.test(s), `the page sent it`, s);
  const dec = TOKENS.find((x) => x[0] === sym)[2], got = (await bal(token, dest)) - before;
  ok(least && got >= BigInt(Math.floor(Number(least) * 10 ** Math.min(dec, 9))) * 10n ** BigInt(dec - Math.min(dec, 9)), `${dest.slice(0, 10)}… received at least the minimum shown`, `${got} (${least} ${sym} minimum)`);
};
if (steps.has('swap1')) await swap(TOKENS[0][0], TOKENS[0][1], K.destUSDC.address);
if (steps.has('swap2')) await swap(TOKENS[1][0], TOKENS[1][1], K.destDAI.address);

if (steps.has('base')) {
  console.log('\nmove 0.003 ETH to Base through the relay');
  await p.click('#tabs [data-tab="withdraw"]');
  await p.click('#form [data-mv="8453"]');
  await p.fill('#f-wamt', '0.003');
  await p.waitForFunction(() => /Moves to Base/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
  log((await p.textContent('#f-rcpt')).replace(/\s+/g, ' ').slice(0, 220));
  await p.click('#f-go');
  const s = await status(/Moving|err/);
  ok(/Moving 0\.003 ETH/.test(s), 'the page sent the move', s);
  const hash = /0x[0-9a-f]{6}…[0-9a-f]{6}/.exec(s)?.[0];
  log(`move ${hash}; waiting for Base's bridge and Base's relay (up to 20 min)`);
  // The deposit address on Base: the one the bridge's event names in the move's transaction.
  const T = id('ETHDepositInitiated(address,address,uint256,bytes)'), tip = await eth.getBlockNumber();
  const ev = (await eth.getLogs({address: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', topics: [T], fromBlock: tip - 20, toBlock: tip})).pop();
  const box = ev ? '0x' + ev.topics[2].slice(26) : null;
  ok(!!box, 'Base’s bridge took it for a deposit address', box || '');
  let swept = false;
  for (let i = 0; i < 80 && box && !swept; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const j = await (await fetch(`https://tacit-evm-pool-keeper-base.onrender.com/evm-pool/keeper/events?from=${(await base.getBlockNumber()) - 3000}`)).json().catch(() => ({}));
    const hit = (j.events || []).find((e) => e.kind === 'received' && String(e.box).toLowerCase() === box.toLowerCase());
    if (hit) { swept = true; log(`swept on Base in ${hit.tx}: ${hit.value} wei into a note, fee ${hit.fee}`); }
    else if (i % 8 === 0) log(`at the box on Base: ${await base.getBalance(box)} wei`);
  }
  ok(swept, 'Base’s live relay moved it into the private balance on Base');
}
if (steps.has('tokenshield')) {
  const [sym, token, dec] = TOKENS[0], amt = process.env.TOKEN_SHIELD || '0.0002';
  console.log(`\nshield exactly ${amt} ETH from ${sym}`);
  await p.click('#tabs [data-tab="shield"]');
  await p.click('[data-from="wallet"]');
  if (await p.$('#f-conn')) await p.click('#f-conn');
  await p.waitForSelector('#f-tok', {timeout: 60e3});
  if (!new RegExp(sym).test(await p.textContent('#f-tok'))) {
    await p.click('#f-tok');
    await p.waitForSelector(`[data-tk="${token}"]`, {timeout: 120e3});
    await p.click(`[data-tk="${token}"]`);
    await p.waitForFunction((x) => new RegExp(x).test(document.querySelector('#f-tok')?.textContent || ''), sym, {timeout: 60e3});
  }
  const before = await bal(token, funder.address);
  await p.fill('#f-samt', amt);
  const ready = await p.waitForFunction(() => /At most/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3}).then(() => true, () => false);
  const r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
  log(r.slice(0, 240));
  if (ready) {
    await p.click('#f-go');
    const s = await status(/Shielded|Swapped|err/);
    ok(/Shielded|Swapped/.test(s), 'the page shielded it', s);
    log(`${sym} spent: ${units(before - await bal(token, funder.address), dec)}; private balance on ${CHAIN}: ${(await p.textContent('#bal .v').catch(() => '?')).trim()} ETH`);
  } else ok(false, 'the form was ready', r.slice(0, 200));
}
if (steps.has('takein')) {
  console.log('\ntake in what waits at the deposit addresses');
  await p.click('#tabs [data-tab="shield"]');
  await p.click('[data-from="exchange"]');
  await p.waitForSelector('#f-check', {timeout: 120e3});
  await p.click('#f-check');
  const found = await p.waitForSelector('[data-take]', {timeout: 240e3}).then(() => true, () => false);
  log((await p.textContent('#form .rows').catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
  if (found) {
    await p.click('[data-take]');
    const s = await status(/Taken in|err/);
    ok(/Taken in/.test(s), 'taken in', s.slice(0, 400));
  } else ok(false, 'something waits at a deposit address');
}
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
log(`funder holds ${Number(await eth.getBalance(funder.address)) / 1e18} ETH; private balance on Ethereum: ${(await p.textContent('#bal .v').catch(() => '?')).trim()} ETH`);
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
