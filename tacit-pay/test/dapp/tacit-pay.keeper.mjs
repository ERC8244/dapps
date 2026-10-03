/* The page against the real relay: the keeper server as committed in src-company/tacit (worker-relay), run on this
   machine against an anvil fork of Ethereum's real pool, and set as the relay under the page's Endpoints, which also
   lifts the default relay's address check but keeps the fee ceiling. Real proofs, real quotes, the real reservation
   queue and the real event index.

   A payer's relayed send and withdrawal go through and are sent from the keeper's own account; two payers press Send
   together and both land, the keeper queueing their leaves; a browser that has never seen the key reads its history
   from the keeper's index, and agrees with a browser that read the chain alone.

   Needs the keeper's source exported from origin/main: KEEPER=<dir with worker-relay/ and dapp/>, and node_modules
   for it (see the header of this file's runner in the repo's CI notes); skipped when KEEPER is not set.

   Usage: KEEPER=… ARTIFACTS=<dir with transact.wasm, transact_final.zkey, transact_vk.json> node test/dapp/tacit-pay.keeper.mjs */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startFork, ok, finish, hexKey, sleep, POOL, ROUTER, CHAINS} from './fork-lib.mjs';

if (!process.env.KEEPER || !process.env.ARTIFACTS) { console.log('KEEPER and ARTIFACTS are not set: nothing to run'); process.exit(0); }
const {Wallet} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const c = CHAINS[0], PORT = 23000 + Math.floor(Math.random() * 2000), URL_ = `http://127.0.0.1:${PORT}/evm-pool/keeper`;
// Blocks come on a clock, as on a chain: the keeper waits for confirmations after a transaction.
const lab = await startFork(['ethereum'], {endpoints: {relay: {1: URL_}}, blockTime: 1});
const f = lab.fork('ethereum');

const keeperKey = Wallet.createRandom().privateKey, keeper = new Wallet(keeperKey).address.toLowerCase();
await f.rpc('anvil_setBalance', [keeper, '0x' + (50n * 10n ** 18n).toString(16)]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-'));
// The keeper sends through private endpoints by default when it is told it is on chain 1, so it is not told: it
// reads the chain id from the RPC and sends to that RPC alone, which here is the fork.
const env = {...process.env};
delete env.EVM_POOL_CHAIN_ID; delete env.EVM_POOL_KEEPER_SEND_RPC_URLS;
const proc = spawn('node', ['src/evm-pool-keeper.js'], {
  cwd: path.join(process.env.KEEPER, 'worker-relay'),
  env: {
    ...env, PORT: String(PORT), EVM_POOL_ADDR: POOL, EVM_POOL_ROUTER_ADDR: ROUTER, EVM_POOL_RPC_URL: f.url,
    EVM_POOL_KEEPER_PRIV: keeperKey, EVM_POOL_KEEPER_DB: path.join(tmp, 'keeper.db'), EVM_POOL_ARTIFACT_DIR: path.join(tmp, 'artifacts'),
    EVM_POOL_START_BLOCK: String(c.deployBlock), EVM_POOL_CONFIRMATIONS: '1', EVM_POOL_LOG_CHUNK: '50000',
    EVM_POOL_WASM: `${process.env.ARTIFACTS}/transact.wasm`, EVM_POOL_ZKEY: `${process.env.ARTIFACTS}/transact_final.zkey`, EVM_POOL_VK: `${process.env.ARTIFACTS}/transact_vk.json`,
    EVM_POOL_KEEPER_POLL_SECS: '2', EVM_POOL_KEEPER_HISTORY_SECS: '5', EVM_POOL_KEEPER_RATE_PER_MIN: '600',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
let klog = '';
proc.stdout.on('data', (d) => { klog += d; }); proc.stderr.on('data', (d) => { klog += d; });
process.on('exit', () => proc.kill('SIGKILL'));
process.on('uncaughtException', (e) => { console.log('\nkeeper log tail:\n' + klog.split('\n').slice(-40).join('\n')); throw e; });
let quote = null;
for (let i = 0; i < 240 && !quote; i++) {
  await sleep(1000);
  if (proc.exitCode != null) break;
  quote = await fetch(`${URL_}/quote`).then((r) => r.ok ? r.json() : null, () => null);
}
if (!quote) { console.log(klog.slice(-1500)); throw new Error('the keeper did not come up'); }
ok(quote.relayer.toLowerCase() === keeper && Number(quote.chainId) === 1, 'the real keeper is up and quotes from its own account', `fee ${Number(BigInt(quote.fee)) / 1e18} ETH`);
const info = await fetch(`${URL_}/events?from=${c.deployBlock}`).then((r) => r.json());
ok(Number(info.chainId) === 1 && info.pool.toLowerCase() === POOL.toLowerCase(), 'and serves its event index for this pool', `${info.events.length} events through ${info.through}`);

const fund = async (page, key, amount) => {
  const addr = await page.openKey(key);
  await page.click('#tabs [data-tab="shield"]');
  if (await page.$('#f-conn')) await page.click('#f-conn');
  await page.waitForSelector('#f-max');
  await page.fill('#f-samt', amount);
  await page.click('#f-go');
  const s = await page.status(/Shielded|err/);
  ok(new RegExp(`Shielded ${amount} ETH`).test(s), `shield ${amount} ETH from the wallet`, s);
  return addr;
};
const K0 = hexKey(), K1 = hexKey(), K2 = hexKey();
const A = await lab.page();
const K1addr = await (async () => { const a = await A.openKey(K1); await A.lockKey(); return a; })();
await fund(A, K0, '0.02');
ok(await A.balance('0.02') === '0.02', 'balance 0.02');

console.log('\na relayed send and withdrawal');
await A.click('#tabs [data-tab="send"]');
await A.fill('#f-to', K1addr); await A.fill('#f-amt', '0.004');
await A.waitForFunction(() => /Sent by the relay, no gas needed · fee/.test(document.querySelector('#form .route')?.textContent || ''), null, {timeout: 60e3});
const feeShown = (await A.textContent('#form .route')).match(/fee ([\d.]+) ETH/)[1];
await A.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 30e3});
await A.click('#f-go');
let s = await A.status(/Sent|err/, 150e3).catch(async (e) => { console.log('page status: ' + (await A.textContent('#status')).trim() + ' | balance: ' + (await A.textContent('#bal')).replace(/\s+/g, ' ').trim() + ' | wallet: ' + (await A.wallet()).slice(-4).join(' ')); const h = /relayed \w+ (0x[0-9a-f]{64})/.exec(klog)?.[1]; if (h) { const r = await f.rpc('eth_getTransactionReceipt', [h]); console.log('receipt of ' + h.slice(0, 12) + ': ' + (r ? `status ${r.status}, block ${parseInt(r.blockNumber, 16)}, logs ${r.logs.length}, topics ${r.logs.map((l) => l.topics.length).join(',')}` : 'none') + ' | tip ' + parseInt(await f.rpc('eth_blockNumber'), 16)); } throw e; });
ok(/Sent 0\.004 ETH privately/.test(s), 'send 0.004 privately through the keeper', s);
const hash = /\/tx\/(0x[0-9a-f]{64})/.exec(await A.$eval('#status a', (a) => a.href))[1];
const tx = await f.rpc('eth_getTransactionByHash', [hash]);
ok(tx.from.toLowerCase() === keeper && tx.to.toLowerCase() === POOL.toLowerCase(), 'sent from the keeper’s account, to the pool', tx.from);
const sent = await A.evaluate(() => window.__wallet.filter(([m]) => m === 'eth_sendTransaction').length);
ok(sent === 1, 'the payer’s wallet sent only the shield', String(sent));
await A.waitForFunction(() => Number(document.querySelector('#bal .v').textContent) < 0.0161, null, {timeout: 60e3}).catch(() => {});
const bal1 = (await A.textContent('#bal .v')).trim();
ok(Math.abs(Number(bal1) - (0.02 - 0.004 - Number(feeShown))) < 2e-6, 'the balance fell by the amount and the fee the form showed', `${bal1} = 0.02 - 0.004 - ${feeShown}`);
const DEST = '0x' + '5e'.repeat(20), d0 = BigInt(await f.rpc('eth_getBalance', [DEST, 'latest']));
await A.click('#tabs [data-tab="withdraw"]');
await A.fill('#f-wto', DEST); await A.fill('#f-wamt', '0.002');
await A.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 60e3});
await A.click('#f-go');
s = await A.status(/Withdrew|err/);
ok(/Withdrew 0\.002 ETH/.test(s), 'withdraw 0.002 through the keeper', s);
ok(BigInt(await f.rpc('eth_getBalance', [DEST, 'latest'])) - d0 === 2n * 10n ** 15n, 'the address received exactly 0.002 ETH');

console.log('\ntwo payers at once');
const B = await lab.page();
await fund(B, K2, '0.01');
await A.click('#tabs [data-tab="send"]');
await B.click('#tabs [data-tab="send"]');
for (const [pg, amt] of [[A, '0.001'], [B, '0.002']]) { await pg.fill('#f-to', K1addr); await pg.fill('#f-amt', amt); }
for (const pg of [A, B]) await pg.waitForFunction(() => !document.querySelector('#f-go')?.disabled, null, {timeout: 60e3});
await Promise.all([A.click('#f-go'), B.click('#f-go')]);
const [sa, sb] = await Promise.all([A.status(/Sent|err/), B.status(/Sent|err/)]);
ok(/Sent 0\.001 ETH/.test(sa) && /Sent 0\.002 ETH/.test(sb), 'both sends land through the keeper’s queue', `${sa} | ${sb}`);
const calls = klog.split('\n').filter((l) => /reserve|relay/i.test(l)).length;
console.log(`        keeper log lines about reserve/relay: ${calls}`);

console.log('\nreading the history');
const C = await lab.page();
const t0 = Date.now();
await C.openKey(K1);
const got = await C.balance('0.007', 240e3);
ok(got === '0.007', 'a browser that has never seen the key finds 0.004 + 0.001 + 0.002 through the keeper’s index', `${got} after ${Math.round((Date.now() - t0) / 1000)} s`);
ok(!A.errors.length && !B.errors.length && !C.errors.length, 'no page errors', [...A.errors, ...B.errors, ...C.errors].join(' | '));
if (process.env.KEEPER_LOG) console.log(klog.slice(-3000));
finish(() => { proc.kill('SIGKILL'); lab.close(); });
