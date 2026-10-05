/* Shielding from a token, against an anvil fork with the real pool, router, zQuoter, zRouter, Permit2 and token list: the
   wallet holds a listed token (bought through zRouter here first), picks it under Shield, and shields exactly 0.005 ETH.
   The private balance is then exactly 0.005, and the wallet spent no more of the token than the most the page showed.

   MODE (with the zap deployed on the fork at its address, through the CREATE2 proxy, as on chain):
     permit   (default) a token with an EIP-2612 permit: one signature, one transaction
     permit2  DAI (no EIP-2612 permit), already approved to Permit2: one signature, one transaction
     batch    DAI, a wallet that batches (EIP-5792): the approval and the zap in one batch
     approve  DAI, a wallet that batches nothing: an approval transaction, then the zap
     relay    the relay's way, chosen in the form: a token with an EIP-2612 permit, swapped by zRouter's own permit and
              the route in one multicall (one signature, one transaction) to a new deposit address of this key, which
              then holds exactly the amount for the relay to move in
     relaybatch  the same with DAI and a wallet that batches: the approval of zRouter and the swap in one batch
     box      no zap on the chain: the swap (permit multicall) pays a new deposit address of this key, which (the relay's
              minimum being above the amount) the wallet then takes in
     weth     WETH (no permit, unwrapped one to one), a wallet that batches nothing: an approval transaction, then the zap

   Usage: ARTIFACTS=<dir> [CHAIN=ethereum|base|robinhood] [MODE=…] node test/dapp/tacit-pay.shieldtoken.mjs     */
import fs from 'node:fs';
import {startFork, ok, finish, hexKey, mockRelay, ACCT} from './fork-lib.mjs';

const {getAddress, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const NAME = process.env.CHAIN || 'ethereum', MODE = process.env.MODE || 'permit';
// Buying DAI is a quote heavier than most nodes allow a call; Tenderly's and MEV Blocker's answer it.
const DAI = ['DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18, 'https://mainnet.gateway.tenderly.co'];
const PERMIT = ['permit', 'relay', 'box'].includes(MODE), RELAY = ['relay', 'relaybatch'].includes(MODE);
if (!PERMIT && MODE !== 'weth' && NAME !== 'ethereum') throw new Error(`MODE=${MODE} uses DAI on Ethereum`);
const CFG = MODE === 'weth'
  ? ['WETH', {ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', base: '0x4200000000000000000000000000000000000006', robinhood: '0x0bd7d308f8e1639fab988df18a8011f41eacad73'}[NAME], 18, null]
  : PERMIT
  ? {ethereum: ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'https://ethereum-rpc.publicnode.com'], base: ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'https://base-rpc.publicnode.com'], robinhood: ['USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168', 6, 'https://rpc.mainnet.chain.robinhood.com']}[NAME]
  : DAI;
const [SYM, TOKEN, DEC, REAL] = [CFG[0], getAddress(CFG[1]), CFG[2], CFG[3]];
const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const ZAP = JSON.parse(fs.readFileSync(new URL('./zap.json', import.meta.url), 'utf8'));
const relay = mockRelay({quote: {receiveMin: String(RELAY ? 10n ** 15n : 10n ** 17n)}});
const lab = await startFork([NAME], {relay, batch: MODE === 'batch' || MODE === 'relaybatch', passthrough: NAME === 'ethereum' ? [] : ['ethereum'], realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', ZQUOTER, '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork(NAME), p = await lab.page();
const W = (x) => BigInt(x).toString(16).padStart(64, '0');
const read = async (to, data) => BigInt(await f.rpc('eth_call', [{to, data}, 'latest']));
const bal = () => read(TOKEN, '0x70a08231' + W(ACCT));
const mined = async (tx) => { let rc = null; for (let i = 0; i < 40 && !rc; i++) { rc = await f.rpc('eth_getTransactionReceipt', [tx]); if (!rc) await new Promise((r) => setTimeout(r, 500)); } return rc; };

const zapCode = () => f.rpc('eth_getCode', [ZAP.address, 'latest']);
if (MODE === 'box') {
  // The chain without the zap: what the page does where it was never deployed.
  if ((await zapCode()).length > 2) await f.rpc('anvil_setCode', [ZAP.address, '0x']);
} else if ((await zapCode()).length <= 2) {
  // Deployed as on chain, through the CREATE2 proxy, where the fork's block predates it.
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZAP.proxy, data: ZAP.salt + ZAP.init.slice(2)}]);
  await mined(tx);
}
if (MODE !== 'box') ok((await zapCode()).length > 2, 'the zap is at its address');

if (MODE === 'weth') {
  console.log('the wallet wraps some ETH');
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: TOKEN, value: '0x' + (10n ** 17n).toString(16), data: '0xd0e30db0'}]);
  ok((await mined(tx))?.status === '0x1' && await bal() > 0n, 'the wallet holds WETH', String(await bal()));
} else {
  console.log(`the wallet buys some ${SYM} through zRouter`);
  const block = '0x' + BigInt(await f.rpc('eth_blockNumber')).toString(16);
  const data = '0xe7798987' + W(ACCT) + W(0) + W(0) + W(TOKEN) + W(10n ** 17n) + W(100) + W(Math.floor(Date.now() / 1000) + 900);
  let h;
  for (const u of [REAL, 'https://rpc.mevblocker.io']) if (!h) h = (await (await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: ZQUOTER, data}, block]})})).json().catch(() => ({}))).result;
  const x = h.slice(2), num = (i) => BigInt('0x' + x.slice(i * 64, i * 64 + 64)), o = Number(num(4)) * 2, n = Number(BigInt('0x' + x.slice(o, o + 64)));
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZROUTER, value: '0x' + num(6).toString(16), data: '0x' + x.slice(o + 64, o + 64 + n * 2), gas: '0x' + (1_500_000).toString(16)}]);
  ok((await mined(tx))?.status === '0x1' && await bal() > 0n, `the wallet holds ${SYM}`, String(await bal()));
}
if (MODE === 'permit2') {
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: TOKEN, data: '0x095ea7b3' + W(PERMIT2) + 'f'.repeat(64)}]);
  ok((await mined(tx))?.status === '0x1', `${SYM} is approved to Permit2, as many wallets already have it`);
}

await p.openKey(hexKey());
console.log(`\nshield exactly 0.005 ETH from ${SYM} (${MODE})`);
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-tok', {timeout: 60e3});
await p.click('#f-tok');
await p.waitForSelector(`[data-tk="${TOKEN}"]`, {timeout: 120e3});
await p.click(`[data-tk="${TOKEN}"]`);
await p.waitForFunction((s) => new RegExp(`Swap ${s} and shield`).test(document.querySelector('#f-go')?.textContent || '') || /Enter an amount/.test(document.querySelector('#f-go')?.textContent || ''), SYM, {timeout: 60e3});
ok(/Pay with/.test(await p.textContent('#form')), `the form now pays with ${SYM}`);
await p.fill('#f-samt', '0.005');
if (RELAY) {
  await p.waitForSelector('[data-via="relay"]', {timeout: 60e3});
  await p.click('[data-via="relay"]');
}
await p.waitForFunction(() => /At most/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
const r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
if (MODE === 'box') ok(/your wallet takes it in/.test(r), 'with no zap and under the relay’s minimum, the wallet will take it in', r.slice(0, 200));
else if (RELAY) ok(/the relay moves it in/.test(r) && /data-via="zap"/.test(await p.innerHTML('#f-via')), 'the relay will move it in, and the zap is offered instead', r.slice(0, 200));
else ok(/shielded in the same transaction/.test(r) && /shielded in one transaction/.test(await p.textContent('#f-snote')), 'the zap shields it in the same transaction', r.slice(0, 200));
const most = BigInt(Math.ceil(Number(new RegExp(`At most\\s*([\\d.]+)\\s*${SYM}`).exec(r)?.[1]) * 10 ** Math.min(DEC, 15))) * 10n ** BigInt(Math.max(0, DEC - 15));
const before = await bal(), seen = (await p.wallet()).length;
await p.click('#f-go');
const said = await p.status(/Shielded|Swapped|err/);
if (RELAY) ok(new RegExp(`Swapped ${SYM} for 0\\.005 ETH at a new deposit address`).test(said), 'the page swaps it to a new deposit address for the relay', said);
else ok(new RegExp(`Shielded 0\\.005 ETH from ${SYM}`).test(said), 'the page shields it', said);
const spent = before - await bal();
ok(spent > 0n && spent <= most, `the wallet spent no more ${SYM} than the most shown`, `${spent} ≤ ${most}`);
if (RELAY) {
  const rcv = relay.calls.filter((x) => x.path === '/receive').at(-1)?.body;
  const box = '0x' + (await f.rpc('eth_call', [{to: '0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5', data: id('receiveBoxOf(uint256,uint16)').slice(0, 10) + W(rcv.npk) + W(rcv.feeBps)}, 'latest'])).slice(-40);
  ok(BigInt(await f.rpc('eth_getBalance', [box, 'latest'])) === 5n * 10n ** 15n, 'the new deposit address the relay was told of holds exactly 0.005 ETH', box);
} else ok(await p.balance('0.005') === '0.005', 'the private balance is exactly 0.005 ETH');

const asked = (await p.wallet()).slice(seen).map((x) => x.split('@')[0]), sends = asked.filter((m) => m === 'eth_sendTransaction').length;
if (MODE === 'box' || RELAY) {
  const left = await read(TOKEN, '0xdd62ed3e' + W(ACCT) + W(ZROUTER));
  ok(left <= most, 'and zRouter was allowed no more than that');
  if (MODE === 'relaybatch') ok(left === 0n, 'and the batch ends with zRouter allowed nothing', String(left));
  const want = {box: [1, 2, 0], relay: [1, 1, 0], relaybatch: [0, 0, 1]}[MODE];
  const got = [asked.filter((m) => m === 'eth_signTypedData_v4').length, sends, asked.filter((m) => m === 'wallet_sendCalls').length];
  ok(got.join() === want.join(), `the wallet was asked for ${['signatures', 'transactions', 'batches'].map((k, i) => `${want[i]} ${k}`).join(', ')}`, got.join());
} else {
  ok(await read(TOKEN, '0xdd62ed3e' + W(ACCT) + W(ZAP.address)) === 0n, 'the zap is left with no allowance from the wallet');
  ok(await read(TOKEN, '0x70a08231' + W(ZAP.address)) === 0n && BigInt(await f.rpc('eth_getBalance', [ZAP.address, 'latest'])) === 0n, 'and holds nothing');
  const want = {permit: [1, 1, 0], permit2: [1, 1, 0], batch: [0, 0, 1], approve: [0, 2, 0], weth: [0, 2, 0]}[MODE];
  const got = [asked.filter((m) => m === 'eth_signTypedData_v4').length, sends, asked.filter((m) => m === 'wallet_sendCalls').length];
  ok(got.join() === want.join(), `the wallet was asked for ${['signatures', 'transactions', 'batches'].map((k, i) => `${want[i]} ${k}`).join(', ')}`, got.join());
}
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
