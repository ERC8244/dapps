/* A relay's event index is a speed-up the page checks against the pool, never a source it trusts. On an anvil fork of a
   real pool, a key is paid once, then opened in a browser whose relay serves an index that says "no events, current
   through the tip": the page must see that the tree it builds is short of the pool's leaf count and read the chain
   instead, and still find the payment. Another browser, whose index is honest about nothing (it is down), does too.

   Usage: node test/dapp/tacit-pay.index.mjs                      (anvil on PATH; CHAIN=ethereum|base|robinhood)      */
import {startFork, mockRelay, ok, finish, hexKey, POOL, CHAINS} from './fork-lib.mjs';

const name = process.env.CHAIN || 'ethereum', c = CHAINS.find((x) => x.key === name);
const relay = mockRelay({mode: 'down'});
const lab = await startFork([name], {relay});
const f = lab.fork(name);
const K0 = hexKey(), K1 = hexKey();

const A = await lab.page();
const K1addr = await (async () => { const a = await A.openKey(K1); await A.lockKey(); return a; })();
await A.openKey(K0);
await A.click('#tabs [data-tab="shield"]');
await A.click('#f-conn');
await A.waitForSelector('#f-max');
await A.fill('#f-samt', '0.003'); await A.fill('#f-sto', K1addr);
await A.waitForFunction(() => /Into their private balance/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
await A.click('#f-go');
const s = await A.status(/Shielded|err/);
ok(/into their private balance/.test(s), 'a key is paid 0.003 ETH', s);

const tip = Number(BigInt(await f.rpc('eth_blockNumber')));
relay.mode = 'send';
relay.events = () => ({chainId: c.chainId, pool: POOL, through: tip + 1000, events: []});
const B = await lab.page();
await B.openKey(K1);
await B.chain(name);
const got = await B.balance('0.003', 240e3);
ok(got === '0.003', 'a browser opened on an index that says "no events" still finds it, read from the chain', `${got} · ${(await B.textContent('#bal')).replace(/\s+/g, ' ').trim()}`);
ok(relay.calls.some((x) => x.path === '/events'), 'the index was asked first');
ok(!A.errors.length && !B.errors.length, 'no page errors', [...A.errors, ...B.errors].join(' | '));
finish(() => lab.close());
