/* The token pools on Ethereum, against an anvil fork with the real USDC and USDT pools and routers, proofs made in the page:
   the wallet buys USDC and USDT through zRouter, picks USDC under the chain, shields 5 USDC by an EIP-2612 permit (one
   signature, one transaction, no approval), sends 2 USDC privately to another key and withdraws 1 USDC to an address, each
   through the relay with its fee in USDC; then shields USDT, which has no permit, through an approval first, and USDC paid
   with ETH, swapped and shielded in one transaction. The other key finds the 2 USDC from the key and the chain alone, and
   Activity names every payment in its token. Its request for 1.5 USDC is paid once from a private balance through the
   relay and once from a wallet with no key, each straight into its private USDC. USDT through Permit2, and USDC swapped in
   from USDT. Then hops between private balances: private ETH into private USDC, and private USDC into private USDT, each
   a withdrawal whose escrow swaps into a new deposit address of the key on the other pool, taken in from there.

   Usage: ARTIFACTS=<dir> node test/dapp/tacit-pay.tokenpools.mjs                                                    */
import {startFork, ok, finish, hexKey, mockRelay, ACCT} from './fork-lib.mjs';

const {getAddress} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), USDT = getAddress('0xdac17f958d2ee523a2206206994597c13d831ec7');
const POOLS = {usdc: '0x6C0be904750Fe1b50cd7207cc94731642d99e908', usdt: '0x73872ceEaADd2C603BD057073D403f08DCB31EB9'};
const ROUTERS = {usdc: '0xe77D82b9A7B686ADc5F31F4cb83286981AC55FE4', usdt: '0x5650c850872bc89FC6E22CBB7a51b0e0DAC97198'};
const ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4', DEST = '0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e', FEE = 20_000n;   // 0.02 USDC
const relay = mockRelay({pools: {'1-xa0b86991c6': {pool: POOLS.usdc, router: ROUTERS.usdc, fee: FEE}, '1-xdac17f958d': {pool: POOLS.usdt, router: ROUTERS.usdt, fee: FEE}}});
const lab = await startFork(['ethereum'], {relay, realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', '0x000000bd2db80567c23e353ca95a251c573cbf9b', '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork('ethereum'), p = await lab.page();
const W = (x) => BigInt(x).toString(16).padStart(64, '0');
const read = async (to, data) => BigInt(await f.rpc('eth_call', [{to, data}, 'latest']));
const balOf = (token, who) => read(token, '0x70a08231' + W(who));
const mined = async (tx) => { let rc = null; for (let i = 0; i < 40 && !rc; i++) { rc = await f.rpc('eth_getTransactionReceipt', [tx]); if (!rc) await new Promise((r) => setTimeout(r, 500)); } return rc; };
// The asset picker on the balance opens the chain's assets; picking one closes them.
const pickIn = async (x, token) => { if (await x.isHidden('#assets')) await x.click('#asset-pick'); await x.click(`#assets [data-asset="${token.toLowerCase()}"]`); };
const pick = (token) => pickIn(p, token);

console.log('the wallet buys USDC and USDT through zRouter');
for (const token of [USDC, USDT]) {
  const block = '0x' + BigInt(await f.rpc('eth_blockNumber')).toString(16);
  const data = '0xe7798987' + W(ACCT) + W(0) + W(0) + W(token) + W(2n * 10n ** 16n) + W(100) + W(Math.floor(Date.now() / 1000) + 900);
  let h;
  for (const u of ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io']) if (!h) h = (await (await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: '0x000000bd2db80567c23e353ca95a251c573cbf9b', data}, block]})})).json().catch(() => ({}))).result;
  const x = h.slice(2), num = (i) => BigInt('0x' + x.slice(i * 64, i * 64 + 64)), o = Number(num(4)) * 2, n = Number(BigInt('0x' + x.slice(o, o + 64)));
  const tx = await f.rpc('eth_sendTransaction', [{from: ACCT, to: ZROUTER, value: '0x' + num(6).toString(16), data: '0x' + x.slice(o + 64, o + 64 + n * 2), gas: '0x' + (1_500_000).toString(16)}]);
  ok((await mined(tx))?.status === '0x1' && await balOf(token, ACCT) >= 10n * 10n ** 6n, `the wallet holds ${token === USDC ? 'USDC' : 'USDT'}`, String(await balOf(token, ACCT)));
}

const K1 = hexKey(), K1addr = await (async () => { const q = await lab.page(); const a = await q.openKey(K1); await q.close(); return a; })();
await p.openKey(hexKey());
console.log('\nthe USDC pool, picked under Ethereum');
await p.waitForSelector('#asset-pick', {timeout: 60e3});
await p.click('#asset-pick');
ok(await p.$$eval('#assets [data-asset]', (b) => b.map((x) => x.textContent.replace(/[\d.,—]/g, '').trim())).then((t) => t.join(' ').includes('USDC') && t.join(' ').includes('USDT') && t.join(' ').includes('TAC')), 'the assets row offers ETH, TAC, USDC and USDT');
await pick(USDC);
ok(/USDC, private on Ethereum/.test(await p.textContent('#bal')), 'the balance is the private USDC one', (await p.textContent('#bal')).replace(/\s+/g, ' '));

console.log('\nshield 5 USDC by a permit');
await p.click('#tabs [data-tab="shield"]');
if (/^Connect a wallet$/.test((await p.textContent('#f-go')).trim())) await p.click('#f-go');
await p.waitForFunction(() => /\d/.test(document.querySelector('#f-wb')?.textContent || ''), null, {timeout: 60e3});
ok(/USDC/.test(await p.textContent('#f-max')), 'the wallet’s USDC shows beside the amount', await p.textContent('#f-max'));
const sent0 = (await p.wallet()).length, held0 = await balOf(USDC, ACCT);
await p.fill('#f-samt', '5');
await p.click('#f-go');
let s = await p.status(/Shielded|err/);
const asked = (await p.wallet()).slice(sent0);
ok(/Shielded 5 USDC/.test(s), 'shields 5 USDC', s);
ok(asked.filter((x) => /^eth_signTypedData_v4/.test(x)).length === 1 && asked.filter((x) => /^eth_sendTransaction|^wallet_sendCalls/.test(x)).length === 1, 'with one signature and one transaction, no approval', asked.join(' '));
ok(held0 - await balOf(USDC, ACCT) === 5n * 10n ** 6n, 'and the wallet paid exactly 5 USDC');
ok(await p.balance('5') === '5', 'the private USDC balance is 5');

console.log('\nsend 2 USDC privately through the relay');
await p.click('#tabs [data-tab="send"]');
await p.fill('#f-to', K1addr); await p.fill('#f-amt', '2');
await p.waitForFunction(() => /Relay fee/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
ok(/0\.02 USDC/.test(await p.textContent('#f-rcpt')), 'the receipt names the relay fee in USDC', (await p.textContent('#f-rcpt')).replace(/\s+/g, ' '));
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 2 USDC privately/.test(s), 'sends 2 USDC', s);
ok(await p.balance('2.98') === '2.98', 'what is left is 5 − 2 − the 0.02 fee');

console.log('\nwithdraw 1 USDC to an address through the relay');
await p.click('#tabs [data-tab="withdraw"]');
await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '1');
await p.waitForFunction(() => /Relay fee/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
await p.click('#f-go');
s = await p.status(/Withdrew|err/);
ok(/Withdrew 1 USDC/.test(s) && await balOf(USDC, DEST) === 10n ** 6n, 'the address receives exactly 1 USDC', s);
ok(await p.balance('1.96') === '1.96', 'and what is left is 2.98 − 1 − the fee');

console.log('\nshield 3 USDT, which has no permit: an approval first');
await pick(USDT);
await p.click('#tabs [data-tab="shield"]');
const sent1 = (await p.wallet()).length;
await p.fill('#f-samt', '3');
await p.click('#f-go');
s = await p.status(/Shielded|err/);
const asked1 = (await p.wallet()).slice(sent1);
ok(/Shielded 3 USDT/.test(s) && asked1.filter((x) => /^eth_sendTransaction/.test(x)).length === 2, 'shields 3 USDT, after an approval transaction', `${s} · ${asked1.join(' ')}`);
ok(await p.balance('3') === '3', 'the private USDT balance is 3');

console.log('\nshield 2 USDC paid with ETH: swapped and shielded in one transaction');
await pick(USDC);
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok'); await p.click('#f-tokl [data-tk=""]');
const usdc0 = await balOf(USDC, ACCT), sent2 = (await p.wallet()).length;
await p.fill('#f-samt', '2');
await p.waitForFunction(() => /Costs/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3});
await p.click('#f-go');
s = await p.status(/Shielded|err/);
const asked2 = (await p.wallet()).slice(sent2);
const usdc1 = await balOf(USDC, ACCT);
ok(/Shielded 2 USDC/.test(s) && asked2.filter((x) => /^eth_sendTransaction/.test(x)).length === 1 && usdc1 >= usdc0 && usdc1 - usdc0 < 2n * 10n ** 4n, 'shields 2 USDC paid with ETH in one transaction, the wallet’s USDC unspent (the swap’s surplus comes back)', `${s} · +${usdc1 - usdc0} · ${asked2.join(' ')}`);
ok(await p.balance('3.96') === '3.96', 'the private USDC balance is 1.96 + 2');

console.log('\nthe activity');
const rows = await p.rows(4);
ok(rows.some((r) => /^Shielded in \+5 USDC/.test(r)) && rows.some((r) => /^Shielded in \+2 USDC/.test(r)) && rows.some((r) => /^Sent privately −2 USDC/.test(r)) && rows.some((r) => /^Withdrew to 0x5e5e…5e5e −1 USDC/.test(r)) && rows.some((r) => /^Shielded in \+3 USDT/.test(r)), 'Activity names each payment in its token', rows.join(' | '));

console.log('\nthe other key, on a fresh page');
const q = await lab.page();
await q.openKey(K1);
await q.waitForSelector('#asset-pick', {timeout: 60e3});
await pickIn(q, USDC);
ok(await q.balance('2') === '2', 'finds the 2 USDC from the key and the chain alone');
const theirs = await q.rows(1);
ok(theirs.some((r) => /^Received privately \+2 USDC/.test(r)), 'and its activity names it in USDC', theirs.join(' | '));

console.log('\na request for 1.5 USDC from the other key, paid from a private balance and from a wallet');
await q.click('#tabs [data-tab="receive"]');
await q.evaluate(() => { document.querySelector('#f-ropts').open = true; });
await q.fill('#f-ramt', '1.5'); await q.fill('#f-rfor', 'rent');
await q.waitForFunction(() => /asset=usdc/i.test(document.querySelector('#f-rlink')?.textContent || '') && /amount=1\.5/.test(document.querySelector('#f-rlink').textContent), null, {timeout: 60e3});
const link = (await q.textContent('#f-rlink')).trim();
ok(link.includes(`pay=${K1addr}`) && /&for=rent/.test(link) && !/[&#]chains?=/.test(link), 'its link names the address, the token, the amount and the note, and no chain (the pool is on Ethereum)', link);
const paid = async (x) => { await x.waitForFunction(() => /paid to/.test(document.querySelector('#req-body').textContent) || document.querySelector('#req-status .err'), null, {timeout: 900e3}); return (await x.textContent('#req-body')).replace(/\s+/g, ' ').trim(); };
const offCard = (x) => x.$eval('#assets', (e) => e.hidden || getComputedStyle(e).display === 'none');
await p.goto(link);
await p.waitForSelector('#req:not([hidden])');
await p.waitForFunction(() => /Pay from my private balance/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 120e3}).catch(() => {});
const card = (await p.textContent('#req-body')).replace(/\s+/g, ' ');
ok(/1\.5 USDC/.test(card) && /rent/.test(card) && /Pay from my private balance/.test(card) && /relay fee 0\.02 USDC/.test(card), 'a payer with private USDC is asked 1.5 USDC for rent, from that balance, the relay fee named', card);
ok(await offCard(p), 'the asset row stays out of the request card');
await p.click('#req-pay');
let got = await paid(p);
ok(/1\.5 USDC paid to/.test(got), 'paid from the private balance', got + ' ' + (await p.textContent('#req-status')).trim());
ok(await p.balance('2.44') === '2.44', 'which is 3.96 − 1.5 − the fee');
const B = await lab.page();
await B.goto(link);
await B.waitForSelector('#req:not([hidden])');
ok(await offCard(B), 'a payer with no key sees the card alone too');
if (/Connect a wallet/.test(await B.textContent('#req-pay'))) await B.click('#req-pay');
await B.waitForFunction(() => /Pay from my wallet/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
const usdcB = await balOf(USDC, ACCT);
await B.click('#req-pay');
got = await paid(B);
ok(/1\.5 USDC paid to/.test(got) && usdcB - await balOf(USDC, ACCT) === 1_500_000n, 'and from a wallet, straight into their private USDC: exactly 1.5 USDC out of the wallet', got + ' ' + (await B.textContent('#req-status')).trim());
await q.click('#bal-re').catch(() => {});
ok(await q.balance('5') === '5', 'the payee’s open page shows 2 + 1.5 + 1.5 USDC');

console.log('\nPermit2, once the wallet has approved it (as a wallet that has used Uniswap has)');
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
ok((await mined(await f.rpc('eth_sendTransaction', [{from: ACCT, to: USDT, data: '0x095ea7b3' + W(PERMIT2) + 'f'.repeat(64)}])))?.status === '0x1', 'the wallet approves Permit2 for its USDT');
// The request card the payer paid from is closed first: the asset row stays out of it.
if (await p.$('#req-x')) { await p.click('#req-x'); await p.waitForSelector('#req', {state: 'hidden', timeout: 10e3}).catch(() => {}); }
await pick(USDT);
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok'); await p.click(`#f-tokl [data-tk="${USDT}"]`);
await p.fill('#f-samt', '1');
await p.waitForFunction(() => /Your wallet/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 60e3}).catch(() => {});
let r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
ok(/Your wallet ?a signature, then one transaction/.test(r), 'the receipt says the wallet signs, then sends one transaction', r);
const sent3 = (await p.wallet()).length, usdt0 = await balOf(USDT, ACCT);
await p.click('#f-go');
s = await p.status(/Shielded|err/);
const asked3 = (await p.wallet()).slice(sent3);
ok(/Shielded 1 USDT/.test(s) && asked3.filter((x) => /^eth_signTypedData_v4/.test(x)).length === 1 && asked3.filter((x) => /^eth_sendTransaction/.test(x)).length === 1, 'shields 1 USDT by a Permit2 signature and one transaction, no approval', `${s} · ${asked3.join(' ')}`);
ok(usdt0 - await balOf(USDT, ACCT) === 10n ** 6n && await p.balance('4') === '4', 'the wallet paid exactly 1 USDT, and the private USDT is 3 + 1');

console.log('\nshield 1 USDC swapped in from USDT, through Permit2');
await pick(USDC);
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok');
await p.waitForSelector(`#f-tokl [data-tk="${USDT}"]`, {timeout: 60e3});
await p.click(`#f-tokl [data-tk="${USDT}"]`);
ok(/From\s*USDT/.test(await p.textContent('#f-flow')) && /To\s*Private USDC/.test(await p.textContent('#f-flow')), 'From USDT in the wallet, To private USDC: the form says both', (await p.textContent('#f-flow')).replace(/\s+/g, ' '));
await p.fill('#f-samt', '1');
await p.waitForFunction(() => /Costs about/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3}).catch(() => {});
r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
ok(/Costs about ?[\d.]+ USDT/.test(r) && /At most ?[\d.]+ USDT/.test(r) && /Your wallet ?a signature, then one transaction/.test(r), 'the receipt gives the USDT it costs, the most it may take, and how the wallet is asked', r);
const sent4 = (await p.wallet()).length, usdt1 = await balOf(USDT, ACCT), usdc2 = await balOf(USDC, ACCT), most = BigInt(Math.round(Number(r.match(/At most ?([\d.]+) USDT/)[1]) * 1e6));
await p.click('#f-go');
s = await p.status(/Shielded|err/);
const asked4 = (await p.wallet()).slice(sent4), spent = usdt1 - await balOf(USDT, ACCT);
ok(/Shielded 1 USDC from USDT/.test(s) && asked4.filter((x) => /^eth_signTypedData_v4/.test(x)).length === 1 && asked4.filter((x) => /^eth_sendTransaction/.test(x)).length === 1, 'swaps USDT for exactly 1 USDC and shields it: one signature, one transaction', `${s} · ${asked4.join(' ')}`);
ok(spent > 0n && spent <= most && await balOf(USDC, ACCT) >= usdc2, 'the wallet paid no more USDT than the receipt said, and its own USDC was not touched', `spent ${spent}, at most ${most}`);
ok(await p.balance('3.44') === '3.44', 'the private USDC balance is 2.44 + 1');

console.log('\nhops between private balances');
// The deposit address a hop paid, from its transaction: the last address the token went to.
const hopBox = async (token) => {
  const b = await f.rpc('eth_getBlockByNumber', ['latest', true]), tx = b.transactions.find((x) => x.from.toLowerCase() === '0x7c9f8ae4e48cbb2727f95b6477a1cf92bcfc43d0');
  if (!tx) return {rc: {}, box: null};
  const rc = await f.rpc('eth_getTransactionReceipt', [tx.hash]), T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const last = rc.logs.filter((l) => !token || l.address.toLowerCase() === token.toLowerCase()).filter((l) => l.topics[0] === T).pop();
  return {rc, box: last && '0x' + last.topics[2].slice(26)};
};
const hop = async (from, into, amount, re) => {
  await pickIn(p, from);
  await p.click('#tabs [data-tab="swap"]');
  await p.click('#f-pv2'); await p.click(`#f-pv2-l [data-pv="${into}"]`);
  await p.fill('#f-wamt', amount);
  await p.waitForFunction((x) => new RegExp(x).test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, re, {timeout: 120e3}).catch(() => {});
  const r = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
  await p.click('#f-go');
  return {r, s: await p.status(/Moving|err/)};
};
// The relay here moves nothing in: after ten minutes the page offers to take it in from the wallet.
const later = () => p.evaluate(() => { const d = Date.now; Date.now = () => d() + 11 * 60_000; });
const nowBal = async () => (await p.textContent('#bal .v')).trim(), micro = (t) => BigInt(Math.round(Number(String(t).replace(/,/g, '')) * 1e6));

// Private ETH, shielded first, into private USDC.
await pickIn(p, '');
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok'); await p.click('#f-tokl [data-tk=""]');
await p.fill('#f-samt', '0.02');
await p.click('#f-go');
s = await p.status(/Shielded|err/);
ok(/Shielded 0\.02 ETH/.test(s), 'shields 0.02 ETH to hop from', s);
let hp = await hop('', '1-xa0b86991c6', '0.01', 'Into your private USDC');
ok(/Into your private USDC ?about [\d.]+ USDC/.test(hp.r) && /At least ?[\d.]+ USDC, less up to 0\.25%/.test(hp.r) && /Relay fee/.test(hp.r), 'Swap, from private ETH to private USDC: the receipt says about what arrives, the least, and the fee', hp.r);
got = await hopBox(USDC);
const usdcAt = got.box ? await balOf(USDC, got.box) : 0n;
ok(/Moving about [\d.]+ USDC into your private balance/.test(hp.s) && got.rc.status === '0x1' && usdcAt > 0n, 'private ETH is swapped into USDC at a new deposit address of the key on the USDC pool, in one transaction', `${hp.s} · ${usdcAt} at ${got.box}`);
await later();
await pick(USDC);
await p.click('#bal-re');
await p.waitForSelector('#bal-take', {timeout: 60e3});
ok(/on its way into your private balance/.test(await p.textContent('#bal-note')), 'the USDC pool says it is on its way in');
const usdcBefore = await nowBal();
await p.click('#bal-take');
s = await p.status(/Took|err/);
await p.click('#bal-re');
const usdcAfter = await p.waitForFunction((b) => { const t = document.querySelector('#bal .v')?.textContent.trim(); return t && t !== b && t; }, usdcBefore, {timeout: 60e3}).then((x) => x.jsonValue(), () => '');
ok(/Took/.test(s) && micro(usdcAfter) - micro(usdcBefore) === usdcAt, 'taken in from the wallet, the private USDC grows by exactly what arrived', `${s} · ${usdcBefore} → ${usdcAfter}`);

// Private USDC into private USDT: a hop out of a token pool.
hp = await hop(USDC, '1-xdac17f958d', '1', 'Into your private USDT');
got = await hopBox(USDT);
const usdtAt = got.box ? await balOf(USDT, got.box) : 0n;
ok(/Into your private USDT ?about [\d.]+ USDT/.test(hp.r) && /0\.02 USDC/.test(hp.r) && /Moving about [\d.]+ USDT/.test(hp.s) && usdtAt > 900_000n, 'private USDC is swapped into USDT at a new deposit address on the USDT pool, the relay fee in USDC', `${hp.r} · ${hp.s} · ${usdtAt}`);
await p.waitForFunction((b) => document.querySelector('#bal .v')?.textContent.trim() !== b, usdcAfter, {timeout: 60e3}).catch(() => {});
ok(micro(usdcAfter) - micro(await nowBal()) === 1_020_000n, 'the private USDC is down by the 1 USDC and the fee', await nowBal());

// Out of a token pool to an address as another coin: Withdraw, To ETH.
await pickIn(p, USDC);
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#f-tok'); await p.click('#f-tokl [data-tk="0x0000000000000000000000000000000000000000"]');
await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '1');
await p.waitForFunction(() => /Arrives/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 120e3}).catch(() => {});
const eth0 = BigInt(await f.rpc('eth_getBalance', [DEST, 'latest']));
await p.click('#f-go');
s = await p.status(/Sent about|err/);
ok(/Sent about [\d.]+ ETH to/.test(s) && BigInt(await f.rpc('eth_getBalance', [DEST, 'latest'])) > eth0, 'private USDC withdrawn to an address as ETH, swapped on the way', s);

ok(!p.errors.length && !q.errors.length && !B.errors.length, 'no page errors', [...p.errors, ...q.errors, ...B.errors].join(' | '));
finish(() => lab.close());
