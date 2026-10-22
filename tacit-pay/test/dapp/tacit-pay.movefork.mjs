/* Moving from the Ethereum pool to your own private balance on Base, against an anvil fork of Ethereum with the real
   pool, router and Base bridge: shield from a wallet, then move part of it through a relay (one that sends what it is
   given faithfully) and then from the wallet itself. Each move must land as one router.withdrawAndCall whose escrow pays
   the Base bridge for a deposit address of this key, issued for it and never shown before; the balance goes down by the
   amount and the fee, and Activity reads "Moved to Base".

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.movefork.mjs        */
import {startFork, ok, finish, hexKey, mockRelay, ROUTER} from './fork-lib.mjs';

const {Interface, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const BRIDGE = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35';
const T_DEPOSIT = id('ETHDepositInitiated(address,address,uint256,bytes)');
const relay = mockRelay();
const lab = await startFork(['ethereum', 'base'], {relay});
const f = lab.fork('ethereum'), p = await lab.page();
if (process.env.TRACE) setInterval(async () => console.log('    [status]', (await p.textContent('#status').catch(() => '?')).trim().slice(0, 160), '| bal', (await p.textContent('#bal').catch(() => '?')).replace(/\s+/g, ' ').trim().slice(0, 100)), 20_000).unref();
await p.openKey(hexKey());

console.log('shield from the wallet');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.05');
await p.click('#f-go');
const shielded = await p.status(/Shielded|err/);
ok(/Shielded 0\.05 ETH/.test(shielded), 'shielded 0.05 ETH', shielded);
await p.balance('0.05');

const move = async (amount, via) => {
  await p.click('#tabs [data-tab="withdraw"]');
  await p.click('#form [data-mv="8453"]');
  if (via === 'wallet') await p.click('[data-route="wallet"]').catch(() => {});
  await p.fill('#f-wamt', amount);
  await p.waitForFunction(() => /Moves to Base/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 90e3});
  const before = Number(BigInt(await f.rpc('eth_blockNumber')));
  await p.click('#f-go');
  const said = await p.status(/Moving|err/);
  const logs = await f.rpc('eth_getLogs', [{address: BRIDGE, topics: [T_DEPOSIT], fromBlock: '0x' + (before + 1).toString(16), toBlock: 'latest'}]);
  return {said, logs, hash: logs[0]?.transactionHash};
};

console.log('\nmove 0.01 ETH to Base through the relay');
const a = await move('0.01', 'relay');
ok(/Moving 0\.01 ETH to your private balance on Base/.test(a.said), 'the page says it is on its way', a.said);
const sent = relay.calls.find((x) => x.path === '/relay');
ok(!!sent?.body?.call && sent.body.call.calls.length === 1 && sent.body.call.calls[0].target.toLowerCase() === BRIDGE.toLowerCase(), 'the relay was given a call intent into the Base bridge');
ok(a.logs.length === 1 && BigInt(a.logs[0].data.slice(0, 66)) === 10n ** 16n, 'the bridge took 0.01 ETH for Base in that transaction', `${a.logs.length} deposit(s)`);
const to1 = a.logs[0] ? '0x' + a.logs[0].topics[2].slice(26) : null, from1 = a.logs[0] ? '0x' + a.logs[0].topics[1].slice(26) : null;
ok(from1 && from1.toLowerCase() === String(sent?.body?.tx?.recipient).toLowerCase(), 'sent by the intent’s escrow, the proof’s recipient');
ok(relay.calls.some((x) => x.path === '/receive'), 'the deposit address was registered for watching before the move');

console.log('\nmove 0.01 ETH again, from the wallet');
const b = await move('0.01', 'wallet');
ok(/Moving 0\.01 ETH/.test(b.said), 'the page says it is on its way', b.said);
const to2 = b.logs[0] ? '0x' + b.logs[0].topics[2].slice(26) : null;
ok(b.logs.length === 1 && BigInt(b.logs[0].data.slice(0, 66)) === 10n ** 16n, 'the bridge took 0.01 ETH, sent through the router from the wallet');
ok(to1 && to2 && to1.toLowerCase() !== to2.toLowerCase(), 'each move lands at its own new deposit address', `${to1} · ${to2}`);
const code = await f.rpc('eth_getCode', [to2, 'latest']);
ok(code === '0x', 'which holds no code: nobody else knows its key');

console.log('\nwhat the page shows');
const fee = 5n * 10n ** 12n;
const left = 5n * 10n ** 16n - 2n * 10n ** 16n - fee;
const shown = await p.balance((Number(left) / 1e18).toString());
ok(shown === (Number(left) / 1e18).toString(), 'the balance is less the two moves and one relay fee', shown);
const rows = await p.rows(3);
ok(rows.filter((r) => /Moved to Base/.test(r)).length === 2, 'Activity reads "Moved to Base" for both', rows.join(' | '));

console.log('\non Base: the bridge delivers it, and it moves into the private balance');
// The deposit as Base executes it: the L1 messenger's message, relayed by its aliased address to the L2 messenger.
const L1M = '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', L2M = '0x4200000000000000000000000000000000000007';
const alias = '0x' + ((BigInt(L1M) + 0x1111000000000000000000000000000000001111n) % (1n << 160n)).toString(16).padStart(40, '0');
const MSG = new Interface(['event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)', 'event SentMessageExtension1(address indexed sender, uint256 value)', 'function relayMessage(uint256 _nonce, address _sender, address _target, uint256 _value, uint256 _minGasLimit, bytes _message) payable']);
const rc1 = await f.rpc('eth_getTransactionReceipt', [a.hash]);
const sentLog = rc1.logs.find((l) => l.address.toLowerCase() === L1M.toLowerCase() && l.topics[0] === MSG.getEvent('SentMessage').topicHash);
const extLog = rc1.logs.find((l) => l.address.toLowerCase() === L1M.toLowerCase() && l.topics[0] === MSG.getEvent('SentMessageExtension1').topicHash);
ok(!!sentLog && !!extLog, 'the Ethereum transaction sent one message through Base’s messenger');
const m = MSG.parseLog(sentLog).args, v = MSG.parseLog(extLog).args.value;
const fb = lab.fork('base');
await fb.rpc('anvil_impersonateAccount', [alias]);
await fb.rpc('anvil_setBalance', [alias, '0x' + (10n ** 18n).toString(16)]);
const relayHash = await fb.rpc('eth_sendTransaction', [{from: alias, to: L2M, value: '0x' + v.toString(16), data: MSG.encodeFunctionData('relayMessage', [m.messageNonce, m.sender, m.target, v, m.gasLimit, m.message]), gas: '0x' + (2_000_000).toString(16)}]);
let rr = null;
for (let i = 0; i < 40 && !rr; i++) { rr = await fb.rpc('eth_getTransactionReceipt', [relayHash]); if (!rr) await new Promise((r) => setTimeout(r, 500)); }
const onBase = BigInt(await fb.rpc('eth_getBalance', [to1, 'latest']));
ok(rr?.status === '0x1' && onBase === 10n ** 16n, 'Base’s bridge pays the new deposit address 0.01 ETH', `${onBase} wei at ${to1}`);
await p.chain('base');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="exchange"]');
await p.waitForSelector('#f-check', {timeout: 120e3});
await p.click('#f-check');
await p.waitForSelector('[data-take]', {timeout: 180e3});
ok(/0\.01 ETH is waiting here on Base/.test(await p.textContent('#form')), 'the page finds it waiting at that address on Base');
await p.click('[data-take]');
const taken = await p.status(/Taken in|err/);
ok(/Taken in/.test(taken), 'and takes it in from the wallet', taken);
ok(await p.balance('0.01') === '0.01', 'the private balance on Base is 0.01');
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
