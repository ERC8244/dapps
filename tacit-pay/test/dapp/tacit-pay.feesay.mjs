/* A withdrawal the private balance cannot cover because of the relay's fee, against an anvil fork of Ethereum: the card says
   what the payment takes (the amount and the relay's fee on top) against the balance, and the most it can take; Max fills in
   an amount that goes through; and an amount smaller than the relay's fee is said to be.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.feesay.mjs               */
import {startFork, ok, finish, hexKey, mockRelay} from './fork-lib.mjs';

const relay = mockRelay({fee: 2n * 10n ** 15n});
const lab = await startFork(['ethereum'], {relay});
const p = await lab.page();
const text = async (sel) => (await p.textContent(sel).catch(() => '')).replace(/\s+/g, ' ').trim();
await p.openKey(hexKey());

console.log('shield from the wallet');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.003');
await p.click('#f-go');
ok(/Shielded 0\.003 ETH/.test(await p.status(/Shielded|err/)), 'shielded 0.003 ETH');
await p.balance('0.003');

console.log('\na withdrawal the fee makes too large');
await p.click('#tabs [data-tab="withdraw"]');
await p.fill('#f-wto', '0x' + '6a'.repeat(20));
await p.fill('#f-wamt', '0.002');
await p.waitForFunction(() => /This takes/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 60e3});
const said = await text('#f-rcpt');
ok(/This takes 0\.004 ETH: 0\.002 for what you asked and 0\.002 for the relay\./.test(said), 'it says what the payment takes, and the relay\'s part', said);
ok(/Your private balance is 0\.003 ETH\./.test(said), 'against the private balance', said);
ok(/The most it can take now is 0\.000599 ETH: Max fills it in\./.test(said), 'and the most it can take', said);
ok(await p.$eval('#f-go', (b) => b.disabled), 'and the button waits');

console.log('\nMax');
await p.click('#f-max');
await p.waitForFunction(() => /Arrives/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 60e3});
const filled = await p.inputValue('#f-wamt');
ok(Number(filled) > 0 && Number(filled) <= 0.000599, 'Max fills in an amount the balance covers', filled);
ok(/more than the amount/.test(await text('#f-rcpt')), 'and the fee being more than the amount is said', await text('#f-rcpt'));
ok(!/This takes/.test(await text('#f-rcpt')), 'with no shortfall left');

console.log('\nan amount under the fee');
await p.fill('#f-wamt', '0.0005');
await p.waitForFunction(() => /Arrives/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 60e3});
ok(/The relay’s fee, 0\.002 ETH, is more than the amount, 0\.0005 ETH\. Sending from your wallet instead pays no relay fee, only its gas\./.test(await text('#f-rcpt')), 'an amount under the relay\'s fee says so, and the way round it', await text('#f-rcpt'));
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
