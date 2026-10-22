/* Moving from the Ethereum pool to your own private balance on Robinhood Chain, against anvil forks of Ethereum and
   Robinhood Chain: shield, then move 0.01 ETH through a relay that sends what it is given. It must land as one
   router.withdrawAndCall whose escrow opens a retryable ticket at Robinhood Chain's inbox for 0.01 ETH to a new deposit
   address of this key, refunding to the same address, with the ticket's fees on top; Activity reads "Moved to Robinhood".

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.movefork-rh.mjs     */
import {startFork, ok, finish, hexKey, mockRelay} from './fork-lib.mjs';

const {Interface, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const INBOX = '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D', T_MSG = id('InboxMessageDelivered(uint256,bytes)');
const TICKET = new Interface(['function createRetryableTicket(address to,uint256 l2CallValue,uint256 maxSubmissionCost,address excessFeeRefundAddress,address callValueRefundAddress,uint256 gasLimit,uint256 maxFeePerGas,bytes data) payable returns (uint256)']);
const relay = mockRelay();
const lab = await startFork(['ethereum', 'robinhood'], {relay});
const f = lab.fork('ethereum'), p = await lab.page();
if (process.env.TRACE) setInterval(async () => console.log('    [status]', (await p.textContent('#status').catch(() => '?')).trim().slice(0, 160), '| rcpt', (await p.textContent('#f-rcpt').catch(() => '?')).replace(/\s+/g, ' ').trim().slice(0, 160)), 20_000).unref();
await p.openKey(hexKey());

console.log('shield from the wallet');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.05');
await p.click('#f-go');
ok(/Shielded 0\.05 ETH/.test(await p.status(/Shielded|err/)), 'shielded 0.05 ETH');
await p.balance('0.05');

console.log('\nmove 0.01 ETH to Robinhood Chain through the relay');
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#form [data-mv="4663"]');
await p.fill('#f-wamt', '0.01');
await p.waitForFunction(() => /Moves to Robinhood Chain/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 180e3});
const receipt = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ');
ok(/Robinhood Chain’s bridge/.test(receipt), 'the receipt names the bridge’s fees on top', receipt.slice(0, 200));
const before = Number(BigInt(await f.rpc('eth_blockNumber')));
await p.click('#f-go');
const said = await p.status(/Moving|err/);
ok(/Moving 0\.01 ETH to your private balance on Robinhood Chain/.test(said), 'the page says it is on its way', said);
const sent = relay.calls.find((x) => x.path === '/relay' && x.body?.call);
const call = sent?.body.call.calls[0];
ok(call && call.target.toLowerCase() === INBOX.toLowerCase(), 'the relay was given a call intent into the inbox');
const t = call ? TICKET.decodeFunctionData('createRetryableTicket', call.data) : null;
ok(t && t.l2CallValue === 10n ** 16n && t.to === t.excessFeeRefundAddress && t.to === t.callValueRefundAddress, 'a ticket for 0.01 ETH, its refunds to the same address', t ? `${t.to} gas ${t.gasLimit} × ${t.maxFeePerGas}` : '');
ok(t && BigInt(call.value) === t.l2CallValue + t.maxSubmissionCost + t.gasLimit * t.maxFeePerGas && -BigInt(sent.body.tx.extAmount) === BigInt(call.value), 'the withdrawal carries the amount and the ticket’s fees exactly');
const logs = await f.rpc('eth_getLogs', [{address: INBOX, topics: [T_MSG], fromBlock: '0x' + (before + 1).toString(16), toBlock: 'latest'}]);
ok(logs.length === 1 && t && logs[0].data.toLowerCase().includes(t.to.slice(2).toLowerCase()), 'the inbox delivered one message for that address', `${logs.length} message(s)`);
ok((await f.rpc('eth_getCode', [t?.to, 'latest'])) === '0x', 'which holds no code on Ethereum, so the ticket’s refunds are not aliased');
const rows = await p.rows(2);
ok(rows.some((r) => /Moved to Robinhood/.test(r)), 'Activity reads "Moved to Robinhood"', rows.join(' | '));

console.log('\non Robinhood Chain: the ticket pays it, and it moves into the private balance');
// What the ticket's redemption does on Robinhood Chain (ArbOS runs it; anvil cannot): a call from the escrow's aliased
// address to the new deposit address with the ticket's value, within the ticket's gas.
const fr = lab.fork('robinhood'), escrow = sent.body.tx.recipient;
const alias = '0x' + ((BigInt(escrow) + 0x1111000000000000000000000000000000001111n) % (1n << 160n)).toString(16).padStart(40, '0');
await fr.rpc('anvil_impersonateAccount', [alias]);
await fr.rpc('anvil_setBalance', [alias, '0x' + (10n ** 18n).toString(16)]);
const redeem = await fr.rpc('eth_sendTransaction', [{from: alias, to: t.to, value: '0x' + t.l2CallValue.toString(16), data: '0x', gas: '0x' + t.gasLimit.toString(16)}]);
let rr = null;
for (let i = 0; i < 40 && !rr; i++) { rr = await fr.rpc('eth_getTransactionReceipt', [redeem]); if (!rr) await new Promise((r) => setTimeout(r, 500)); }
ok(rr?.status === '0x1' && BigInt(rr.gasUsed) <= t.gasLimit, 'the redemption fits the ticket’s gas and pays the new address', `gas ${rr ? BigInt(rr.gasUsed) : '?'} of ${t.gasLimit}`);
await p.chain('robinhood');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="exchange"]');
await p.waitForSelector('#f-check', {timeout: 120e3});
await p.click('#f-check');
await p.waitForSelector('[data-take]', {timeout: 180e3});
ok(/0\.01 ETH is waiting here on Robinhood Chain/.test(await p.textContent('#form')), 'the page finds it waiting at that address on Robinhood Chain');
await p.click('[data-take]');
const taken = await p.status(/Taken in|err/);
ok(/Taken in/.test(taken), 'and takes it in from the wallet', taken);
ok(await p.balance('0.01') === '0.01', 'the private balance on Robinhood Chain is 0.01');
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
