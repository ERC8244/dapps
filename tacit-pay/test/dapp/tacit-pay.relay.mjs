/* The page against relays, on an anvil fork of a real pool with real proofs: a faithful relayer (the transaction is sent
   from the relayer's own account, the payer's wallet is not asked and does not appear on chain), and relays that are
   not: a quote from another relayer, chain or pool or above the page's fee ceiling is refused before anything is
   proved; a fee that moved between the form and the spend is shown before it is paid; a relay that names some other
   transaction, or one that never sends, is not taken for a payment; a relay that errors hands the spend to the wallet;
   an event index that leaves events out is caught against the pool and the state is read from the chain instead.

   Usage: node test/dapp/tacit-pay.relay.mjs                     (anvil on PATH; CHAIN=base|ethereum|robinhood)
          FAST=1 …                                                (skips the three-minute wait on a relay that never sends) */
import {startFork, mockRelay, ok, finish, hexKey, ACCT, POOL, RELAYERS, CHAINS} from './fork-lib.mjs';

const name = process.env.CHAIN || 'base', c = CHAINS.find((x) => x.key === name), RELAYER = RELAYERS[c.chainId].toLowerCase();
const relay = mockRelay();
const lab = await startFork([name], {relay, passthrough: ['ethereum']});   // names are read from Ethereum itself
const f = lab.fork(name);
const p = await lab.page();
const K0 = hexKey(), K1 = hexKey();
const E12 = 10n ** 12n;
const eth = (wei) => { const w = BigInt(wei), f6 = ((w % 10n ** 18n).toString().padStart(18, '0')).slice(0, 6).replace(/0+$/, ''); return `${w / 10n ** 18n}${f6 ? '.' + f6 : ''}`; };
const txOf = async () => /\/tx\/(0x[0-9a-f]{64})/.exec(await p.$eval('#status a', (a) => a.href))?.[1];
const route = async (re) => { await p.waitForFunction((s) => new RegExp(s, 'i').test(document.querySelector('#form .route')?.textContent || ''), re.source, {timeout: 60e3}).catch(() => {}); return (await p.textContent('#form .route').catch(() => '')).trim(); };
const refresh = async () => { await p.click('#bal-re'); await p.waitForFunction(() => document.querySelector('#bal-re')?.textContent === 'refresh', null, {timeout: 60e3}).catch(() => {}); };
const fillSend = async (to, amt) => {
  await p.click('#tabs [data-tab="send"]');
  await p.fill('#f-to', to); await p.fill('#f-amt', amt);
};
const calls = (path) => relay.calls.filter((x) => x.path === path).length;

const K1addr = await p.openKey(K1);
await p.lockKey();
await p.openKey(K0);
await p.chain(name);

console.log(`${c.full}: a balance to spend, shielded from the wallet`);
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.02');
await p.click('#f-go');
let s = await p.status(/Shielded|err/);
ok(/Shielded 0\.02 ETH/.test(s), 'shield 0.02', s);
let bal = 20000n * E12;       // 0.02 ETH
ok(await p.balance('0.02') === '0.02', 'private balance 0.02');

console.log('\na quote the page does not accept');
for (const [quote, why, re] of [
  [{relayer: '0x' + '11'.repeat(20)}, 'from another relayer address', /address this page does not expect/],
  [{fee: String(10n ** 18n)}, 'above the fee ceiling', /fee above this page/],
  [{chainId: 1 + c.chainId}, 'for another chain', /another chain or pool/],
  [{pool: '0x' + '22'.repeat(20)}, 'for another pool', /another chain or pool/],
  [{fee: 'not a number'}, 'with a fee that is not a number', /fee above this page/],
]) {
  relay.quote = quote;
  await fillSend(K1addr, '0.001');
  await refresh();
  const r = await route(re);
  ok(/nothing was signed/.test(r) && re.test(r), `a quote ${why} is refused`, r.slice(0, 120));
  ok(await p.isDisabled('#f-go'), 'and nothing can be sent through that relay');
}
ok(calls('/relay') === 0, 'no proof was sent to any of them');
relay.quote = {};

console.log('\na faithful relay');
await refresh();
await fillSend(K1addr, '0.004');
let r = await route(/Sent by the relay/);
ok(/Sent by the relay, no gas needed · fee 0\.000005 ETH/.test(r), 'the form shows the relay and its fee', r);
const walletSends = async () => (await p.wallet()).filter((x) => x.startsWith('eth_sendTransaction')).length;
const sends0 = await walletSends();
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 0\.004 ETH privately/.test(s), 'send 0.004 privately through the relay', s);
bal -= 4n * 10n ** 15n + 5n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `the balance falls by the amount and the fee: ${eth(bal)}`);
let tx = await f.rpc('eth_getTransactionByHash', [await txOf()]);
ok(tx.from.toLowerCase() === RELAYER && tx.to.toLowerCase() === POOL.toLowerCase(), 'the pool transaction was sent from the relayer’s account, not the payer’s wallet', `${tx.from}`);
ok(await walletSends() === sends0, 'the wallet was not asked to send anything');
const DEST = '0x' + '5e'.repeat(20), d0 = BigInt(await f.rpc('eth_getBalance', [DEST, 'latest']));
await p.click('#tabs [data-tab="withdraw"]');
await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '0.002');
await route(/Sent by the relay/);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/Withdrew|err/);
ok(/Withdrew 0\.002 ETH/.test(s), 'withdraw 0.002 through the relay', s);
ok(BigInt(await f.rpc('eth_getBalance', [DEST, 'latest'])) - d0 === 2n * 10n ** 15n, 'the address received exactly 0.002 ETH');
bal -= 2n * 10n ** 15n + 5n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);
const goodHash = await txOf();

console.log('\na withdrawal to a name');
const NAMED = '0xC1D6F3AC3dFd66bb264f732CB5581DE3E232CC21', n0 = BigInt(await f.rpc('eth_getBalance', [NAMED, 'latest']));   // alakazam.wei points here
await p.fill('#f-wto', 'alakazam.wei'); await p.fill('#f-wamt', '0.001');
await p.waitForFunction(() => /Address/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go')?.disabled, null, {timeout: 90e3});
ok((await p.textContent('#f-rcpt')).toLowerCase().includes(NAMED.toLowerCase()), 'the name is read on Ethereum and the address it points to is shown in full');
await p.click('#f-go');
s = await p.status(/Withdrew|err/);
ok(/Withdrew 0\.001 ETH to alakazam\.wei/.test(s), 'withdraw 0.001 to alakazam.wei through the relay', s);
ok(BigInt(await f.rpc('eth_getBalance', [NAMED, 'latest'])) - n0 === 10n ** 15n, 'the address the name points to received exactly 0.001 ETH');
bal -= 1n * 10n ** 15n + 5n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);

console.log('\na fee that moves between the form and the spend');
await fillSend(K1addr, '0.001');
await route(/fee 0\.000005 ETH/);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
relay.fee = 100n * E12;                                   // 0.0001 ETH: twenty times what the form showed, under the ceiling
await p.click('#f-go');
s = await p.status(/fee moved|Sent|err/);
ok(/fee moved to 0\.0001 ETH/.test(s), 'the new fee is shown before anything is proved', s);
ok(calls('/relay') === 3, 'and nothing was sent');
r = await route(/fee 0\.0001 ETH/);
ok(/fee 0\.0001 ETH/.test(r), 'the form now shows the new fee', r);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 0\.001 ETH privately/.test(s), 'pressed again, it goes ahead at the new fee', s);
bal -= 1n * 10n ** 15n + 100n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);
relay.fee = 5n * E12;

console.log('\na relay that names some other transaction');
relay.mode = 'other'; relay.other = goodHash;
await refresh();
await fillSend(K1addr, '0.001');
await route(/Sent by the relay/);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/not this payment|Sent|err/);
ok(/not this payment, so nothing was sent/.test(s), 'is not taken for the payment', s);
ok(await p.balance(eth(bal)) === eth(bal), 'the balance is unchanged and the notes can be spent again');
relay.mode = 'send';
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 0\.001 ETH privately/.test(s), 'and a faithful relay then sends it', s);
bal -= 1n * 10n ** 15n + 5n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);

if (!process.env.FAST) {
  console.log('\na relay that takes the proof and never sends it');
  relay.mode = 'nowhere';
  await fillSend(K1addr, '0.001');
  await route(/Sent by the relay/);
  await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
  await p.click('#f-go');
  s = await p.status(/not confirmed it yet|Sent|err/, 400e3);
  ok(/has not confirmed it yet/.test(s) && !/Sent 0/.test(s), 'is not reported as a payment', s);
  ok(await p.$('#status a') !== null, 'and its hash is shown');
  ok(await p.balance(eth(bal)) === eth(bal), 'the balance is unchanged and shown in full');
  relay.mode = 'send';
}

console.log('\na relay that has paused reservations for this connection');
relay.reserve = 'tail';
await fillSend(K1addr, '0.001');
await route(/Sent by the relay/);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
const heads0 = calls('/head'), reserves0 = calls('/reserve');
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 0\.001 ETH privately/.test(s), 'the spend is proved against the queue’s head and sent without a slot', s);
ok(calls('/reserve') > reserves0 && calls('/head') > heads0, 'after the reservation was refused, the head was asked for');
bal -= 1n * 10n ** 15n + 5n * E12;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);
relay.reserve = null;

console.log('\na relay that errors');
relay.mode = 'error';
await fillSend(K1addr, '0.001');
await route(/Sent by the relay/);
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await p.click('#f-go');
s = await p.status(/relay busy|Sent|err/);
ok(/The relay could not do that just now/.test(s) && !/relay busy/.test(s), 'it is told in the page’s words, not the relay’s', s);
ok(await p.$('#use-wallet') !== null, 'with the wallet offered');
await p.click('#use-wallet');
await p.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
const sends1 = await walletSends();
await p.click('#f-go');
s = await p.status(/Sent|err/);
ok(/Sent 0\.001 ETH privately/.test(s), 'the wallet sends it', s);
tx = await f.rpc('eth_getTransactionByHash', [await txOf()]);
ok(tx.from.toLowerCase() === ACCT && await walletSends() === sends1 + 1, 'from the payer’s own account, no fee to the relay');
bal -= 1n * 10n ** 15n;
ok(await p.balance(eth(bal)) === eth(bal), `balance ${eth(bal)}`);
relay.mode = 'send';

console.log('\nan event index that leaves events out');
const tip = Number(BigInt(await f.rpc('eth_blockNumber')));
relay.events = () => ({chainId: c.chainId, pool: POOL, through: tip + 1000, events: []});
const q = await lab.page();
await q.openKey(K1);
await q.chain(name);
const got = await q.balance('0.008', 240e3);
ok(got === '0.008', 'a wallet opened on it still finds what it was paid, read from the chain instead', `${got} (4 + 1 + 1 + 1 + 1 of the sends above)`);
ok(calls('/events') > 0, 'the index was asked first');

console.log('\none press combines a balance held in parts');
relay.events = null;
await q.waitForFunction(() => /in 5 parts/.test(document.querySelector('#bal-note')?.textContent || ''), null, {timeout: 60e3}).catch(() => {});
ok(/Your balance here is in 5 parts, and one payment can use two\. Combine them into one: 4 steps, fee 0\.00002 ETH in all\./.test((await q.textContent('#bal-note')).replace(/\s+/g, ' ')), 'the balance says it is in five parts, and what combining them costs', (await q.textContent('#bal-note')).replace(/\s+/g, ' ').slice(0, 160));
await q.click('#bal-combine');
s = await q.status(/Combined|err/, 900e3);
ok(/Combined 5 parts into one/.test(s), 'four relayed steps later, it is one part', s);
ok(await q.balance('0.00798', 120e3) === '0.00798', 'the balance is the sum less four fees: 0.00798');
await q.waitForFunction(() => !/parts/.test(document.querySelector('#bal-note')?.textContent || ''), null, {timeout: 60e3}).catch(() => {});
ok(!/parts/.test(await q.textContent('#bal-note')), 'and the offer is gone');
ok(!q.errors.length && !p.errors.length, 'no page errors', [...p.errors, ...q.errors].join(' | '));
finish(() => lab.close());
