/* A move the relay refuses, tried again after its deadline has nearly passed, against forks of Ethereum and Base. The
   refused move holds its notes; nothing else can spend them. After 52 minutes (the move's escrow allows an hour), "Try
   it again" builds the move afresh (a new deadline, so a new escrow) from the same notes, and it lands once: one deposit
   into Base's bridge, for a deposit address of this key, and the balance down by one move and its fee.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.moveretry.mjs        */
import {startFork, ok, finish, hexKey, mockRelay} from './fork-lib.mjs';

const {id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const BRIDGE = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', T_DEPOSIT = id('ETHDepositInitiated(address,address,uint256,bytes)');
const relay = mockRelay();
const lab = await startFork(['ethereum', 'base'], {relay});
const f = lab.fork('ethereum'), p = await lab.page();
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

console.log('\na move the relay refuses');
const start = Number(BigInt(await f.rpc('eth_blockNumber')));
relay.mode = 'error';
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#form [data-mv="8453"]');
await p.fill('#f-wamt', '0.01');
await p.waitForFunction(() => /Moves to Base/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 90e3});
await p.click('#f-go');
await p.waitForSelector('#status [data-retry="relay"]', {timeout: 300e3});
ok(/did not take this payment/.test(await p.textContent('#status')), 'the page holds it, and offers to try it again', (await p.textContent('#status')).trim().slice(0, 140));
const first = relay.calls.filter((x) => x.path === '/relay' && x.body?.call).pop()?.body.call;
ok(await p.balance('0') === '0', 'its notes are held: nothing else can spend them');

console.log('\n52 minutes later, tried again');
relay.mode = 'send';
await p.clock.install();
await p.clock.fastForward('52:00');
await p.click('#status [data-retry="relay"]');
const said = await p.status(/It landed|It is settled|err/);
ok(/It landed/.test(said), 'it lands', said);
const second = relay.calls.filter((x) => x.path === '/relay' && x.body?.call).pop()?.body.call;
ok(first && second && BigInt(second.deadline) > BigInt(first.deadline) && second.nonce !== first.nonce, 'built afresh: a later deadline, so a new escrow', `${first?.deadline} → ${second?.deadline}`);
const logs = await f.rpc('eth_getLogs', [{address: BRIDGE, topics: [T_DEPOSIT], fromBlock: '0x' + (start + 1).toString(16), toBlock: 'latest'}]);
ok(logs.length === 1 && BigInt(logs[0].data.slice(0, 66)) === 10n ** 16n, 'one deposit of 0.01 ETH into Base’s bridge, not two', `${logs.length} deposit(s)`);
ok(logs[0] && first && ('0x' + logs[0].topics[2].slice(26)).toLowerCase() === new RegExp('0x[0-9a-f]{40}', 'i').exec(first.calls[0].data.slice(10).replace(/^0{24}/, '0x'))?.[0]?.toLowerCase(), 'for the same new deposit address the first one named');
ok(await p.balance('0.039995') === '0.039995', 'the balance is less one move and one relay fee');
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
