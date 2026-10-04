/* Shielding from a token, against an anvil fork with the real pool, router, zQuoter, zRouter and token list: the wallet
   holds a listed token (bought through zRouter here first), picks it under Shield, and shields exactly 0.005 ETH: an
   approval, one swap paying a new deposit address of this key exactly that, and (the relay's minimum being above it)
   the wallet taking it in. The private balance is then exactly 0.005, and the wallet spent no more of the token than the
   most the page showed.

   Usage: ARTIFACTS=<dir> [CHAIN=base|robinhood] node test/dapp/tacit-pay.shieldtoken.mjs                         */
import {startFork, ok, finish, hexKey, mockRelay, ACCT} from './fork-lib.mjs';

const {getAddress} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const NAME = process.env.CHAIN || 'ethereum';
const CFG = {ethereum: ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'https://ethereum-rpc.publicnode.com'], base: ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'https://base-rpc.publicnode.com'], robinhood: ['USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168', 6, 'https://rpc.mainnet.chain.robinhood.com']}[NAME];
const [SYM, TOKEN, DEC, REAL] = [CFG[0], getAddress(CFG[1]), CFG[2], CFG[3]];
const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4';
const relay = mockRelay({quote: {receiveMin: String(10n ** 17n)}});
const lab = await startFork([NAME], {relay, passthrough: NAME === 'ethereum' ? [] : ['ethereum'], realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', ZQUOTER, '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork(NAME), p = await lab.page();
const W = (x) => BigInt(x).toString(16).padStart(64, '0');
const bal = async () => BigInt(await f.rpc('eth_call', [{to: TOKEN, data: '0x70a08231' + W(ACCT)}, 'latest']));

console.log(`the wallet buys some ${SYM} through zRouter`);
{
  const block = '0x' + BigInt(await f.rpc('eth_blockNumber')).toString(16);
  const data = '0xe7798987' + W(ACCT) + W(0) + W(0) + W(TOKEN) + W(10n ** 17n) + W(100) + W(Math.floor(Date.now() / 1000) + 900);
  const h = (await (await fetch(REAL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: ZQUOTER, data}, block]})})).json()).result;
  const x = h.slice(2), num = (i) => BigInt('0x' + x.slice(i * 64, i * 64 + 64)), o = Number(num(4)) * 2, n = Number(BigInt('0x' + x.slice(o, o + 64)));
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZROUTER, value: '0x' + num(6).toString(16), data: '0x' + x.slice(o + 64, o + 64 + n * 2), gas: '0x' + (1_500_000).toString(16)}]);
  let rc = null; for (let i = 0; i < 40 && !rc; i++) { rc = await f.rpc('eth_getTransactionReceipt', [tx]); if (!rc) await new Promise((r) => setTimeout(r, 500)); }
  ok(rc?.status === '0x1' && await bal() > 0n, `the wallet holds ${SYM}`, String(await bal()));
}

await p.openKey(hexKey());
console.log(`\nshield exactly 0.005 ETH from ${SYM}`);
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
await p.waitForFunction(() => /At most/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
const r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
ok(/your wallet takes it in/.test(r), 'under the relay’s minimum, the wallet will take it in', r.slice(0, 200));
const most = BigInt(Math.ceil(Number(new RegExp(`At most\\s*([\\d.]+)\\s*${SYM}`).exec(r)?.[1]) * 10 ** DEC));
const before = await bal();
await p.click('#f-go');
const said = await p.status(/Shielded|err/);
ok(new RegExp(`Shielded 0\\.005 ETH from ${SYM}`).test(said), 'the page shields it', said);
const spent = before - await bal();
ok(spent > 0n && spent <= most, `the wallet spent no more ${SYM} than the most shown`, `${spent} ≤ ${most}`);
ok(await p.balance('0.005') === '0.005', 'the private balance is exactly 0.005 ETH');
const allowanceLeft = BigInt(await f.rpc('eth_call', [{to: TOKEN, data: '0xdd62ed3e' + W(ACCT) + W(ZROUTER)}, 'latest']));
ok(allowanceLeft <= most, 'and zRouter was allowed no more than that', String(allowanceLeft));
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
