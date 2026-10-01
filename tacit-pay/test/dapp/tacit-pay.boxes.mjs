/* One-time deposit addresses, on an anvil fork of a real pool: a payee issues an address for each of two people, plain
   ETH is sent to them from a wallet that has never heard of the page (as an exchange would), the page shows it waiting
   (also on a browser that did not issue the addresses: they are found again from the key), takes each in with a real
   proof, and a browser that has never seen the key finds the balance. A key can issue only as many addresses as it can
   find again from the key alone.

   Usage: node test/dapp/tacit-pay.boxes.mjs                       (anvil on PATH; CHAIN=ethereum|base|robinhood)      */
import {startFork, ok, finish, hexKey, ACCT} from './fork-lib.mjs';

const name = process.env.CHAIN || 'ethereum';
const lab = await startFork([name]);
const f = lab.fork(name);
const K1 = hexKey(), K2 = hexKey();
const eth = (n) => '0x' + (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(16);
const rowsOf = (p) => p.$$eval('#form .rows li', (lis) => lis.map((li) => ({label: li.querySelector('b').textContent.trim(), addr: li.querySelector('code').textContent.trim(), take: !!li.querySelector('[data-take]')})));
const exchange = async (p) => { await p.click('#tabs [data-tab="shield"]'); await p.click('[data-from="exchange"]'); await p.waitForSelector('#f-newbox', {timeout: 120e3}); };

const A = await lab.page();
await A.openKey(K1);
await exchange(A);
const standing = await A.textContent('#form .addr code');
for (const label of ['Ann', 'Bob']) { await A.fill('#f-boxlabel', label); await A.click('#f-newbox'); await A.waitForSelector(`#form .rows li:has-text("${label}")`); }
let rows = await rowsOf(A);
ok(rows.length === 2 && rows[0].label === 'Bob' && rows[1].label === 'Ann', 'two one-time addresses are issued, newest first', rows.map((r) => r.label).join());
ok(new Set([standing, ...rows.map((r) => r.addr)]).size === 3 && rows.every((r) => /^0x[0-9a-fA-F]{40}$/.test(r.addr)), 'each distinct from the standing address and from the other');
const ann = rows[1].addr, bob = rows[0].addr;

console.log('\nplain ETH arrives, as from an exchange');
await f.rpc('eth_sendTransaction', [{from: ACCT, to: ann, value: eth(0.002)}]);
await f.rpc('eth_sendTransaction', [{from: ACCT, to: bob, value: eth(0.001)}]);
await A.click('#f-check');
await A.waitForFunction(() => document.querySelectorAll('#form [data-take]').length === 2, null, {timeout: 60e3});
ok(true, 'both show as waiting, each with its own Take it in');
ok(/0\.003 ETH is waiting at your deposit addresses/.test(await A.textContent('#bal-note')), 'and the balance says so on any tab', (await A.textContent('#bal-note')).trim());

const B = await lab.page();
await B.openKey(K1);
await B.waitForFunction(() => /0\.003 ETH is waiting/.test(document.querySelector('#bal-note')?.textContent || ''), null, {timeout: 120e3}).catch(() => {});
ok(/0\.003 ETH is waiting/.test(await B.textContent('#bal-note')), 'a browser that issued nothing finds it too, from the key alone', (await B.textContent('#bal-note')).trim());
await exchange(B);
rows = await rowsOf(B);
ok(rows.length === 2 && rows.every((r) => r.take) && rows.map((r) => r.addr).sort().join() === [ann, bob].sort().join(), 'and lists both addresses, each ready to be taken in', rows.map((r) => r.label).join());

console.log('\ntaking them in');
await A.click(`#form li:has-text("Ann") [data-take]`);
let s = await A.status(/Taken in|err/);
ok(/Taken in/.test(s), 'Ann’s address is taken in with a proof', s);
ok(await A.balance('0.002') === '0.002', 'private balance 0.002');
await A.click(`#form li:has-text("Bob") [data-take]`);
s = await A.status(/Taken in|err/);
ok(/Taken in/.test(s), 'Bob’s too', s);
ok(await A.balance('0.003') === '0.003', 'private balance 0.003');
ok(await A.$('#bal-note .callout') === null, 'and nothing is waiting any more');
const acts = await A.rows(2, 'Ethereum');
ok(acts.filter((r) => /^Came in at a one-time address/.test(r)).length === 2, 'the activity names them one-time addresses', acts.join(' | ').slice(0, 200));

const C = await lab.page();
await C.openKey(K1);
ok(await C.balance('0.003', 240e3) === '0.003', 'a browser that has never seen the key finds 0.003 ETH from the key and the chain alone');

console.log('\nhow many a key can issue');
const D = await lab.page();
await D.openKey(K2);
await exchange(D);
for (let i = 1; i <= 20; i++) { await D.click('#f-newbox'); await D.waitForFunction((n) => document.querySelectorAll('#form .rows li').length === n, i, {timeout: 20e3}); }
await D.click('#f-newbox');
await D.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /addresses are out and unused/.test(t.textContent)), null, {timeout: 10e3}).catch(() => {});
ok((await rowsOf(D)).length === 20 && (await D.$$eval('#toasts .toast', (t) => t.some((x) => /addresses are out and unused/.test(x.textContent)))), 'twenty are issued, then it says why there are no more until one is used');
ok(![A, B, C, D].some((p) => p.errors.length), 'no page errors', [A, B, C, D].flatMap((p) => p.errors).join(' | '));
finish(() => lab.close());
