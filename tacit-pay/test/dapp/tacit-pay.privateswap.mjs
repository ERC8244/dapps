/* A private swap, token to token through the pool, against an anvil fork of Ethereum with the real pool, router, zap,
   zQuoter, zRouter and token list. The wallet holds USDC; under Shield it pays with USDC and picks, under "You get", a
   token that is not on the list, added by pasting its address. Starting the swap shields exactly 0.005 ETH and leaves a
   plan, shown as a card with the time and the pool's transactions since (the form estimates what the ETH would buy of
   the token at today's price); the card takes it out as that token, to the
   address given, through Withdraw. Also: the line shown when the address is the wallet paying in, what the browser
   remembers on the next visit, a plan taken out as ETH instead from its card, and that a plan lost with the browser's
   storage leaves the ETH in the private balance.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.privateswap.mjs      */
import fs from 'node:fs';
import {startFork, ok, finish, hexKey, mockRelay, ACCT} from './fork-lib.mjs';

const {getAddress} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'), PEPE = getAddress('0x6982508145454Ce325dDbE47a25d4ec3d2311933');
const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4';
const ZAP = JSON.parse(fs.readFileSync(new URL('./zap.json', import.meta.url), 'utf8'));
const relay = mockRelay({quote: {receiveMin: String(10n ** 17n)}});
const lab = await startFork(['ethereum'], {relay, realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', ZQUOTER, '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork('ethereum'), p = await lab.page();
const W = (x) => BigInt(x).toString(16).padStart(64, '0');
const balOf = async (t, a) => BigInt(await f.rpc('eth_call', [{to: t, data: '0x70a08231' + W(a)}, 'latest']));
const mined = async (tx) => { let rc = null; for (let i = 0; i < 40 && !rc; i++) { rc = await f.rpc('eth_getTransactionReceipt', [tx]); if (!rc) await new Promise((r) => setTimeout(r, 500)); } return rc; };
const text = async (sel) => (await p.textContent(sel).catch(() => '')).replace(/\s+/g, ' ').trim();
const K = hexKey(), D = '0x' + '6a'.repeat(20), D2 = '0x' + '6b'.repeat(20);

if ((await f.rpc('eth_getCode', [ZAP.address, 'latest'])).length <= 2) await mined(await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZAP.proxy, data: ZAP.salt + ZAP.init.slice(2)}]));
console.log('the wallet buys some USDC through zRouter');
{
  const block = '0x' + BigInt(await f.rpc('eth_blockNumber')).toString(16);
  const data = '0xe7798987' + W(ACCT) + W(0) + W(0) + W(USDC) + W(10n ** 17n) + W(100) + W(Math.floor(Date.now() / 1000) + 900);
  let h;
  for (const u of ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io']) if (!h) h = (await (await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: ZQUOTER, data}, block]})})).json().catch(() => ({}))).result;
  const x = h.slice(2), num = (i) => BigInt('0x' + x.slice(i * 64, i * 64 + 64)), o = Number(num(4)) * 2, n = Number(BigInt('0x' + x.slice(o, o + 64)));
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZROUTER, value: '0x' + num(6).toString(16), data: '0x' + x.slice(o + 64, o + 64 + n * 2), gas: '0x' + (1_500_000).toString(16)}]);
  ok((await mined(tx))?.status === '0x1' && await balOf(USDC, ACCT) > 0n, 'the wallet holds USDC');
}

await p.openKey(K);
console.log('\nShield: pay with USDC, get a token added by its address');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-tok', {timeout: 60e3});
await p.click('#f-tok');
await p.waitForSelector(`[data-tk="${USDC}"]`, {timeout: 120e3});
await p.click(`[data-tk="${USDC}"]`);
await p.waitForSelector('#f-tok2', {timeout: 60e3});
ok(/You get/.test(await text('#form')) && /Private ETH/.test(await text('#f-tok2')), 'the form offers "You get", private ETH unless another is picked');
await p.click('#f-tok2');
await p.waitForSelector('#f-toksq2', {timeout: 120e3});
await p.fill('#f-toksq2', 'pepe');
ok(!(await p.$(`#f-tokl2 [data-tk="${PEPE}"]`)), 'PEPE is not on the list');
await p.fill('#f-toksq2', PEPE.toLowerCase());
await p.waitForSelector(`#f-tokl2 [data-tk="${PEPE}"]`, {timeout: 60e3});
ok(/PEPE/.test(await text(`#f-tokl2 [data-tk="${PEPE}"]`)) && /not on the list/.test(await text('#f-tokl2')), 'pasting its address reads it from the chain and offers it', await text(`#f-tokl2 [data-tk="${PEPE}"]`));
await p.click(`#f-tokl2 [data-tk="${PEPE}"]`);
await p.waitForSelector('#f-pto', {timeout: 30e3});
ok(/PEPE/.test(await text('#f-tok2')) && /Start the private swap|Enter/.test(await text('#f-go')), 'picked, the form asks where it goes and offers to start a private swap', await text('#f-go'));

await p.fill('#f-samt', '0.005');
await p.fill('#f-pto', ACCT);
await p.waitForFunction(() => /At most/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 300e3});
ok(/This is the wallet paying in/.test(await text('#f-rcpt')), 'one plain line when the address is the wallet paying in', (await text('#f-rcpt')).slice(-120));
await p.fill('#f-pto', D);
await p.waitForFunction((d) => new RegExp(`out as PEPE to ${d.slice(0, 6)}`, 'i').test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, D, {timeout: 300e3});
ok(!/This is the wallet paying in/.test(await text('#f-rcpt')), 'and none for another address', (await text('#f-rcpt')).slice(0, 220));
await p.waitForFunction(() => /PEPE, estimated/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 120e3}).catch(() => {});
ok(/At today’s price\s*about [\d,.]+ PEPE, estimated/.test(await text('#f-rcpt')), 'it estimates the PEPE the ETH would buy now', (await text('#f-rcpt')).slice(-160));
await p.click('#f-go');
const said = await p.status(/Shielded|err/);
ok(/Shielded 0\.005 ETH from USDC\. Swap it out as PEPE/.test(said), 'the first step shields exactly 0.005 ETH from USDC', said);
ok(await p.balance('0.005') === '0.005', 'the private balance is 0.005 ETH');
await p.waitForSelector('#bal-note .callout.plan', {timeout: 60e3});
const card = await text('#bal-note .callout.plan');
ok(/Private swap: 0\.005 ETH from [\d.]+ USDC, to go out as PEPE \(0x[0-9a-f]+…[0-9a-f]+\) to 0x6a6a/i.test(card) && /Started (just now|\d+ min ago)/.test(card) && /\d+ pool transactions? since/.test(card), 'a card shows the plan, the time and the pool’s transactions since', card);

console.log('\nthe next visit');
await p.reload();
await p.openKey(K);
await p.click('#tabs [data-tab="shield"]');
await p.waitForSelector('#bal-note .callout.plan', {timeout: 120e3});
ok(true, 'the plan is still there, kept under the key');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-tok2', {timeout: 60e3});
ok(/ETH/.test(await text('#f-tok')) && /Private ETH/.test(await text('#f-tok2')), 'the visit starts on the simple path: ETH in, private ETH', `${await text('#f-tok')} | ${await text('#f-tok2')}`);
await p.click('#f-tok2');
await p.waitForSelector(`#f-tokl2 [data-tk="${PEPE}"]`, {timeout: 120e3});
const first = await p.$$eval('#f-tokl2 [data-tk]', (b) => b.map((x) => x.dataset.tk));
ok(first[1] === PEPE && /added by you/.test(await text('#f-tokl2')) && !!(await p.$(`#f-tokl2 [data-forget="${PEPE}"]`)), 'the added token is remembered: first in the picker, marked as added, with a way to forget it', first.slice(0, 3).join(' '));
await p.click('#f-tok2');

console.log('\nswap it out');
await p.click('#bal-note [data-plan]');
await p.waitForSelector('#f-wto', {timeout: 30e3});
ok((await p.inputValue('#f-wto')).toLowerCase() === D && /PEPE/.test(await text('#f-tok')) && /^0\.00[45]/.test(await p.inputValue('#f-wamt')), 'the card opens Withdraw with the plan’s token, address and ETH', `${await p.inputValue('#f-wamt')} ETH as ${await text('#f-tok')}`);
await p.waitForFunction(() => /At least/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
const least = /At least\s*([\d.]+)\s*PEPE/.exec(await text('#f-rcpt'))?.[1];
await p.click('#f-go');
const out = await p.status(/Sent about|err/);
ok(/Sent about [\d.]+ PEPE to 0x6a6a/.test(out), 'the page sends it', out);
const got = await balOf(PEPE, D);
ok(least && got >= BigInt(Math.floor(Number(least))) * 10n ** 18n, 'the address holds at least the minimum shown', `${got} wei`);
await p.waitForFunction(() => !document.querySelector('#bal-note .callout.plan'), null, {timeout: 60e3}).catch(() => {});
ok(!(await p.$('#bal-note .callout.plan')), 'and the card is gone');

console.log('\ntaken out as ETH instead');
const D3 = '0x' + '6c'.repeat(20), ethAt = async (a) => BigInt(await f.rpc('eth_getBalance', [a, 'latest']));
const wei = (s) => { const [i, d = ''] = String(s).split('.'); return BigInt(i + (d + '0'.repeat(18)).slice(0, 18)); };
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
await p.waitForSelector('#f-tok', {timeout: 60e3});
await p.click('#f-tok');
await p.waitForSelector('#f-tokl [data-tk=""]', {timeout: 120e3});
await p.click('#f-tokl [data-tk=""]');
await p.waitForSelector('#f-tok2', {timeout: 60e3});
await p.click('#f-tok2');
await p.waitForSelector(`#f-tokl2 [data-tk="${PEPE}"]`, {timeout: 120e3});
await p.click(`#f-tokl2 [data-tk="${PEPE}"]`);
await p.waitForSelector('#f-pto', {timeout: 30e3});
await p.fill('#f-samt', '0.003');
await p.fill('#f-pto', D3);
await p.waitForFunction(() => /Later/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
await p.click('#f-go');
ok(/Shielded 0\.003 ETH/.test(await p.status(/Shielded|err/)), 'a plan for 0.003 ETH');
await p.waitForSelector('#bal-note [data-plan-eth]', {timeout: 60e3});
ok(/Take out as ETH/.test(await text('#bal-note .callout.plan')), 'its card offers to take it out as ETH', await text('#bal-note .callout.plan'));
await p.click('#bal-note [data-plan-eth]');
await p.waitForSelector('#f-wto', {timeout: 30e3});
const amt3 = await p.inputValue('#f-wamt');
ok((await p.inputValue('#f-wto')).toLowerCase() === D3 && /^0\.00\d+$/.test(amt3) && /ETH/.test(await text('#f-tok')) && !/PEPE/.test(await text('#f-tok')) && !(await p.$('#bal-note .callout.plan')), 'Withdraw opens on ETH with the plan’s address and amount, and the card is gone', `${amt3} ETH as ${await text('#f-tok')}`);
await p.waitForFunction(() => !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
const before3 = await ethAt(D3);
await p.click('#f-go');
const out3 = await p.status(/Withdrew|err/);
ok(/Withdrew/.test(out3) && await ethAt(D3) - before3 === wei(amt3), `the address receives exactly ${amt3} ETH`, out3);

console.log('\na plan lost with the browser’s storage');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
await p.waitForSelector('#f-tok', {timeout: 60e3});
await p.click('#f-tok');
await p.waitForSelector('#f-tokl [data-tk=""]', {timeout: 120e3});
await p.click('#f-tokl [data-tk=""]');
await p.waitForSelector('#f-tok2', {timeout: 60e3});
await p.click('#f-tok2');
await p.waitForSelector(`#f-tokl2 [data-tk="${PEPE}"]`, {timeout: 120e3});
await p.click(`#f-tokl2 [data-tk="${PEPE}"]`);
await p.waitForSelector('#f-pto', {timeout: 30e3});
await p.fill('#f-samt', '0.002');
await p.fill('#f-pto', D2);
await p.waitForFunction(() => /Later/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
await p.waitForFunction(() => /PEPE, estimated/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 120e3}).catch(() => {});
ok(/about [\d,.]+ PEPE, estimated/.test(await text('#f-rcpt')), 'paid with ETH, the plan is estimated too');
const pre = await text('#bal .v');
await p.click('#f-go');
const said2 = await p.status(/Shielded|err/);
ok(/Shielded 0\.002 ETH\. Swap it out as PEPE/.test(said2), 'a second plan, paid with ETH', said2);
await p.waitForSelector('#bal-note .callout.plan', {timeout: 60e3});
const bal = String(Number((Number(pre) + 0.002).toFixed(6)));
ok(await p.balance(bal, 180e3) === bal, `the private balance is ${bal}`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.openKey(K);
await p.chain('ethereum');   // the chain last chosen went with the storage
const after = await p.balance(bal, 240e3);
ok(after === bal, 'with the browser’s storage cleared, the key finds the same private balance', `${after} (want ${bal})`);
ok(!(await p.$('#bal-note .callout.plan')), 'the plan is gone with the storage; the ETH is not');
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
