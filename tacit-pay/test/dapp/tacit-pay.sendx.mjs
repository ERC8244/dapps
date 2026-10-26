/* Sends into someone else's private balance in another coin or on a rollup, and a withdrawal bridged to an address on
   Base, against anvil forks of Ethereum and Base with the real pools, routers, zRouter routes and Base bridge, proofs made
   in the page. Each send tells the relay of the pool it goes into a deposit intent for the recipient's note (the relay
   answers with the box the router computes for it), then pays that box exactly, in one withdrawal from the sender's
   private ETH: by an exact swap into USDC, or through Base's bridge. Nothing here completes the deposits (a keeper
   would): what is checked is that the box holds exactly what the intent asks, and the bridge was paid for it.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.sendx.mjs              */
import {startFork, ok, finish, hexKey, mockRelay, ROUTER} from './fork-lib.mjs';

const {getAddress, Interface, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), BRIDGE = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', T_DEPOSIT = id('ETHDepositInitiated(address,address,uint256,bytes)');
const USDC_POOL = '0x6C0be904750Fe1b50cd7207cc94731642d99e908', USDC_ROUTER = '0xe77D82b9A7B686ADc5F31F4cb83286981AC55FE4', DEST = '0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e';
const relay = mockRelay({pools: {'1-xa0b86991c6': {pool: USDC_POOL, router: USDC_ROUTER, fee: 20_000n}}});
const lab = await startFork(['ethereum', 'base'], {relay, realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', '0x000000bd2db80567c23e353ca95a251c573cbf9b', '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork('ethereum'), fb = lab.fork('base'), p = await lab.page();
const W = (x) => BigInt(x).toString(16).padStart(64, '0');
const balOf = async (token, who) => BigInt(await f.rpc('eth_call', [{to: token, data: '0x70a08231' + W(who)}, 'latest']));
const BOX = new Interface(['function depositBoxOf((uint256 amount,uint256 outLeaf0,uint256 outLeaf1,bytes32 memo0Hash,bytes32 memo1Hash,address refund,uint64 deadline,uint256 nonce)) view returns (address)']);
const boxOf = async (fork, router, i) => '0x' + (await fork.rpc('eth_call', [{to: router, data: BOX.encodeFunctionData('depositBoxOf', [[BigInt(i.amount), BigInt(i.outLeaf0), BigInt(i.outLeaf1), i.memo0Hash, i.memo1Hash, i.refund, BigInt(i.deadline), BigInt(i.nonce)]])}, 'latest'])).slice(26);
const bridged = async (from) => f.rpc('eth_getLogs', [{address: BRIDGE, topics: [T_DEPOSIT], fromBlock: '0x' + (from + 1).toString(16), toBlock: 'latest'}]);
const rcpt = async (re) => { await p.waitForFunction((x) => new RegExp(x).test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, re, {timeout: 180e3}).catch(() => {}); return (await p.textContent('#f-rcpt')).replace(/\s+/g, ' '); };

const K2addr = await (async () => { const q = await lab.page(); const a = await q.openKey(hexKey()); await q.close(); return a; })();
await p.openKey(hexKey());
console.log('shield 0.05 ETH from the wallet');
await p.click('#tabs [data-tab="shield"]');
if (/^Connect a wallet$/.test((await p.textContent('#f-go')).trim())) await p.click('#f-go');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.05');
await p.click('#f-go');
let s = await p.status(/Shielded|err/);
ok(/Shielded 0\.05 ETH/.test(s), 'shielded 0.05 ETH', s);
await p.balance('0.05');

console.log('\nsend 10 USDC into their private USDC, from private ETH');
await p.click('#tabs [data-tab="send"]');
await p.click('#f-pv3'); await p.click('#f-pv3-l [data-pv="1-xa0b86991c6"]');
await p.fill('#f-to', K2addr); await p.fill('#f-amt', '10');
let r = await rcpt('They receive');
ok(/They receive ?10 USDC/.test(r) && /Costs about ?[\d.]+ ETH/.test(r) && /Their relay ?0\.024 USDC/.test(r), 'the receipt: what they receive, what it costs in ETH, and their relay’s fee', r);
await p.click('#f-go');
s = await p.status(/Sending [\d.]+ |err/);
const d1 = relay.calls.filter((x) => x.path === '/deposit').pop()?.body;
const box1 = d1 && await boxOf(f, USDC_ROUTER, d1.intent);
ok(/Sending 10 USDC privately/.test(s) && d1 && BigInt(d1.hint.outputs[0].v) === 10_000_000n && BigInt(d1.intent.amount) === 10_024_000n, 'their relay was told an intent for 10 USDC plus its fee', `${s} · ${d1?.intent?.amount}`);
ok(box1 && await balOf(USDC, box1) === 10_024_000n, 'and its box holds exactly that, paid by the swap in one withdrawal', `${box1} holds ${box1 && await balOf(USDC, box1)}`);

console.log('\nsend 0.005 ETH into their private ETH on Base');
const b2 = Number(BigInt(await f.rpc('eth_blockNumber')));
await p.click('#f-pv3'); await p.click('#f-pv3-l [data-pv="chain:8453"]');
await p.fill('#f-to', K2addr); await p.fill('#f-amt', '0.005');
r = await rcpt('They receive');
ok(/They receive ?0\.005 ETH, on Base/.test(r), 'the receipt names Base', r);
await p.click('#f-go');
s = await p.status(/Sending [\d.]+ |err/);
const d2 = relay.calls.filter((x) => x.path === '/deposit' && x.chain === 'base').pop()?.body, logs2 = await bridged(b2);
const box2 = d2 && await boxOf(fb, ROUTER, d2.intent);
ok(/Sending 0\.005 ETH privately on Base/.test(s) && !!d2, 'Base’s relay was told the intent', s);
ok(logs2.length === 1 && box2 && ('0x' + logs2[0].topics[2].slice(26)).toLowerCase() === box2.toLowerCase() && BigInt(logs2[0].data.slice(0, 66)) === BigInt(d2.intent.amount), 'the bridge was paid exactly the intent’s amount for its box on Base', `${logs2.length} deposit(s) to ${logs2[0] && '0x' + logs2[0].topics[2].slice(26)}, box ${box2}`);

console.log('\nwithdraw 0.004 ETH to an address on Base');
const b3 = Number(BigInt(await f.rpc('eth_blockNumber')));
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#f-tok'); await p.click('#f-tokl [data-tk="chain:8453"]');
await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '0.004');
r = await rcpt('Arrives on Base');
await p.click('#f-go');
s = await p.status(/Bridging|err/);
const logs3 = await bridged(b3);
ok(/Bridging 0\.004 ETH to 0x5e5e…5e5e on Base/.test(s) && logs3.length === 1 && ('0x' + logs3[0].topics[2].slice(26)).toLowerCase() === DEST && BigInt(logs3[0].data.slice(0, 66)) === 4n * 10n ** 15n, 'bridged exactly 0.004 ETH to that address on Base', `${s} · ${r}`);

ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(() => lab.close());
