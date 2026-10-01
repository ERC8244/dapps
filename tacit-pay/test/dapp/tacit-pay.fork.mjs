/* Runs the real dapp/page.html against an anvil fork of Base, with every proof made in the page by its own prover and
   accepted by the deployed pool: shield from a wallet into your own balance, send privately to a tacit1 address,
   withdraw part, shield into someone else's balance, pay a payment link with no Tacit key open, take in what was
   sent to a deposit address, rebuild from the chain alone, and read each side's activity. The relays are down
   throughout, so every spend is sent from the wallet.

   The proving key (28.5 MB) and witness program (4.9 MB) are fetched by the page from its mirrors and checked against
   their hashes; ARTIFACTS=<dir holding transact.wasm and transact_final.zkey> serves them from disk instead.

   Usage: node test/dapp/tacit-pay.fork.mjs     (anvil on PATH; BASE_RPC to fork from another node)        */
import fs from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

const PORT = 18545 + Math.floor(Math.random() * 1000), ANVIL = `http://127.0.0.1:${PORT}`;
const anvil = spawn('anvil', ['--port', String(PORT), '--fork-url', process.env.BASE_RPC || 'https://mainnet.base.org', '--chain-id', '8453', '--silent', '--no-rate-limit'], {stdio: 'ignore'});
process.on('exit', () => anvil.kill('SIGKILL'));
const rpc = async (method, params = []) => {
  const r = await (await fetch(ANVIL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})})).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
};
for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch { if (i > 120) throw new Error('anvil did not start'); await sleep(500); } }
// The first development account, as a plain account: on real chains it carries delegation code.
const ACCT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
await rpc('anvil_setCode', [ACCT, '0x']);
await rpc('anvil_setBalance', [ACCT, '0x' + (10n ** 18n).toString(16)]);

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route(/mainnet\.base\.org|base-rpc\.publicnode\.com|base\.drpc\.org/, async (route) => {
  const body = route.request().postData();
  let text;
  try { text = await (await fetch(ANVIL, {method: 'POST', headers: {'content-type': 'application/json'}, body})).text(); }
  catch (e) { text = JSON.stringify({jsonrpc: '2.0', id: JSON.parse(body || '{}').id ?? 1, error: {code: -32000, message: `fork: ${e.message}`}}); }
  await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: text}).catch(() => {});
});
await ctx.route(/tacit-evm-pool-keeper/, (route) => route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"down"}'}));
if (process.env.ARTIFACTS) {
  await ctx.route(/\/(transact\.wasm|transact_final\.zkey)$/, (route) => route.fulfill({status: 200, contentType: 'application/octet-stream', headers: {'access-control-allow-origin': '*'},
    body: fs.readFileSync(`${process.env.ARTIFACTS}/${route.request().url().split('/').pop()}`)}));
}
await ctx.addInitScript(`(() => {
  const NODE = 'https://mainnet.base.org', ACCT = ${JSON.stringify(ACCT)};
  let chain = '0x2105';
  const call = async (method, params) => { const r = await (await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; };
  window.ethereum = { on() {}, request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ACCT];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; return null; }
    if (method === 'eth_sendTransaction') return call('eth_sendTransaction', [{ ...params[0], from: ACCT }]);
    return call(method, params || []);
  } };
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tacit-pay-chain-v1', '8453');
    localStorage.setItem('tacit-pay-route-v1', JSON.stringify({ send: 'wallet', withdraw: 'wallet' }));
  }
})();`);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
// Chains the flows do not use are read from public nodes; one of them (Robinhood's) now and then answers with a doubled
// CORS header, which the page rides out on its second node.
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|multiple values '\*,\*'/.test(m.text())) errors.push(m.text()); });
await p.goto(`http://127.0.0.1:${server.address().port}/`);

const hexKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const openKey = async (k) => {
  await p.click('#tabs [data-tab="receive"]');
  await p.click('#form [data-in="paste"]'); await p.fill('#form .opts input', k); await p.click('#form [data-in="key"]');
  await p.waitForSelector('#form .addr code');
};
const lockKey = async () => { await p.click('#wallet'); await p.click('#w-lock'); await p.click('#sheet-wallet [data-close]'); };
const status = async (re, ms = 900e3) => {
  await p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status').textContent) || document.querySelector('#status .err'), re.source, {timeout: ms});
  return (await p.textContent('#status')).trim();
};
const balance = async (want) => {
  await p.waitForFunction((w) => document.querySelector('#bal .v')?.textContent.trim() === w, want, {timeout: 180e3}).catch(() => {});
  return (await p.textContent('#bal .v')).trim();
};
const rows = async (n) => {
  await p.waitForFunction((k) => document.querySelectorAll('#activity .rows li').length >= k, n, {timeout: 180e3}).catch(() => {});
  return p.$$eval('#activity .rows li', (x) => x.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
};

const K0 = hexKey(), K1 = hexKey();
await openKey(K1);
const K1addr = await p.textContent('#form .addr code');
await lockKey();
await openKey(K0);

console.log('shield, send, withdraw');
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.01');
let t0 = Date.now();
await p.click('#f-go');
let s = await status(/Shielded|err/);
ok(/Shielded 0\.01 ETH/.test(s), `shield 0.01 from the wallet, proved here (${Math.round((Date.now() - t0) / 1000)} s with the key)`, s);
ok(await balance('0.01') === '0.01', 'private balance 0.01');
console.log(`        one proof: ${await p.evaluate(() => document.querySelector('#device').textContent.match(/([\d.]+) s/)?.[1])} s`);

await p.click('#tabs [data-tab="send"]');
await p.fill('#f-to', K1addr); await p.fill('#f-amt', '0.004');
await p.waitForFunction(() => /They receive/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
await p.click('#f-go');
s = await status(/Sent|err/);
ok(/Sent 0\.004 ETH privately/.test(s), 'send 0.004 privately to a tacit1 address', s);
ok(await balance('0.006') === '0.006', 'private balance 0.006');

const DEST = '0x' + '5e'.repeat(20), before = BigInt(await rpc('eth_getBalance', [DEST, 'latest']));
await p.click('#tabs [data-tab="withdraw"]');
await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '0.002');
await p.waitForFunction(() => /Arrives/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
await p.click('#f-go');
s = await status(/Withdrew|err/);
ok(/Withdrew 0\.002 ETH/.test(s), 'withdraw 0.002 to an 0x address', s);
ok(BigInt(await rpc('eth_getBalance', [DEST, 'latest'])) - before === 2n * 10n ** 15n, 'the address received exactly 0.002 ETH');
ok(await balance('0.004') === '0.004', 'private balance 0.004');

console.log('paying someone else');
await p.click('#tabs [data-tab="shield"]');
await p.fill('#f-samt', '0.001'); await p.fill('#f-sto', K1addr);
await p.waitForFunction(() => /Into their private balance/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
await p.click('#f-go');
s = await status(/Shielded|err/);
ok(/into their private balance/.test(s), 'shield 0.001 into someone else’s balance', s);
ok(await balance('0.004') === '0.004', 'one’s own balance is untouched');
await lockKey();
await p.evaluate((a) => { location.hash = `pay=${a}&amount=0.0015&chain=base&for=fork`; }, K1addr);
await p.waitForSelector('#req-wallet');
await p.click('#req-wallet');
await p.waitForFunction(() => /Paid 0\.0015 ETH/.test(document.querySelector('#req').textContent) || document.querySelector('#status .err'), null, {timeout: 900e3});
ok(/Paid 0\.0015 ETH/.test(await p.textContent('#req')), 'a payer with no Tacit key pays a payment link from a wallet', (await p.textContent('#status')).trim());
await p.click('#req-x');

console.log('the payee');
await openKey(K1);
ok(await balance('0.0065') === '0.0065', 'holds 0.004 + 0.001 + 0.0015');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="exchange"]');
await p.waitForSelector('#form .addr code', {timeout: 60e3});
const box = await p.textContent('#form .addr code');
await rpc('eth_sendTransaction', [{from: ACCT, to: box, value: '0x' + (3n * 10n ** 15n).toString(16)}]);
await p.click('#f-check');
await p.waitForSelector('#f-sweep', {timeout: 60e3});
await p.click('#f-sweep');
s = await status(/Taken in|err/);
ok(/Taken in/.test(s), 'takes in 0.003 sent to the deposit address', s);
ok(await balance('0.0095') === '0.0095', 'which joins the private balance');
const theirs = await rows(4);
console.log('        ' + theirs.join('\n        '));
ok(theirs.some((r) => /^Received privately \+0\.004 ETH/.test(r)) && theirs.filter((r) => /^Shielded in \+0\.001(5)? ETH/.test(r)).length === 2 && theirs.some((r) => /^Came in at your deposit address \+0\.003 ETH/.test(r)), 'activity names every payment');
await p.evaluate(() => { document.querySelector('#activity details').open = true; });
await p.click('#rebuild');
await p.waitForFunction(() => !document.querySelector('#rebuild')?.disabled, null, {timeout: 600e3});
ok(await balance('0.0095') === '0.0095', 'rebuilt from the chain alone, the same balance');

console.log('the payer');
await lockKey();
await openKey(K0);
const mine = await rows(3);
console.log('        ' + mine.join('\n        '));
ok(mine.some((r) => /^Shielded in \+0\.01 ETH/.test(r)) && mine.some((r) => /^Sent privately −0\.004 ETH/.test(r)) && mine.some((r) => /^Withdrew to 0x5e5e…5e5e −0\.002 ETH/.test(r)), 'activity names the shield, the send and the withdrawal');

ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close(); anvil.kill('SIGKILL');
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
