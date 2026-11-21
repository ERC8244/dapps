/* A payment from the wallet that the network does not confirm in the three minutes the page waits, or that the payer stopped
   waiting for while the wallet still had it, is not sent a second time
   by the next press: the payer is told, shown the transaction, and the button waits until they say it was dropped.
   One whose three minutes ran out while the device slept is looked at once more, and found landed.
   No network: the nodes are scripted, the payee's page makes a signed link, and the payer's clock is moved on by hand.

   Usage: node test/dapp/tacit-pay.unconfirmed.mjs                  (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createRequire} from 'node:module';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

const KEY = '11'.repeat(32), PAYER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', SENT = '0x' + 'ab'.repeat(32), SLEPT = '0x' + 'cd'.repeat(32);
const BOX0 = '0x52fc37ee7741468a15CE879320a7a41CEBaeb232';
const state = {box: BOX0, mined: null};
const TIP = 26069345;
const answer = (host, {method, params}) => {
  if (method === 'eth_blockNumber') return '0x' + TIP.toString(16);
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getBalance') return params[0].toLowerCase() === PAYER ? '0x' + (100n * 10n ** 18n).toString(16) : '0x0';
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_getTransactionReceipt') return state.mined && params[0] === state.mined ? {status: '0x1', logs: [], transactionHash: state.mined, blockNumber: '0x' + TIP.toString(16)} : null;
  if (method === 'eth_call' && params[0].data.startsWith('0x7a4c8e5b')) return '0x' + '00'.repeat(32);
  if (method === 'eth_call' && params[0].data.startsWith('0xfc7e9c6f')) return '0x' + '00'.repeat(32);   // nextIndex(): an empty pool
  if (method === 'eth_call') return '0x' + state.box.slice(2).toLowerCase().padStart(64, '0');
  return null;
};
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const routes = async (ctx) => ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const req = route.request(), url = new URL(req.url());
  if (req.method() === 'POST' && !/onrender\.com$/.test(url.host)) {
    const body = JSON.parse(req.postData() || '{}'), reply = (b) => ({jsonrpc: '2.0', id: b.id, result: answer(url.host, b)});
    return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
  }
  return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
});

console.log('the payee makes a link');
const A = await (await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']})).newPage();
await A.addInitScript(`(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); return v == null && typeof k === 'string' && k.startsWith('tacit-wei-pq-later:') && !window.__pqAsk ? String(Date.now()) : v; }; })();`);   // the post-quantum offer is put off, as after "Not now" (a test sets window.__pqAsk to see it)
await routes(A.context());
const errors = [];
A.on('pageerror', (e) => errors.push(String(e)));
await A.goto(origin);
await A.click('#tabs [data-tab="receive"]');
await A.click('#form [data-in="paste"]');
await A.fill('#form .opts input', KEY);
await A.click('#form [data-in="key"]');
await A.waitForSelector('#f-qr svg', {timeout: 90e3});
await A.evaluate(() => { document.querySelector('#f-ropts').open = true; });
await A.fill('#f-ramt', '0.002');
await A.waitForFunction(() => /&ns=[\w-]{86}&amount=0\.002/.test(document.querySelector('#f-rlink')?.textContent || ''), null, {timeout: 30e3});
const link = await A.textContent('#f-rlink');
ok(/#pay=tacit1[a-z0-9]+&n=[\w-]{43}&ns=/.test(link), 'a signed link with a deposit address', link.slice(0, 90) + '…');

console.log('\nthe payer pays it from a wallet, and the network never confirms');
const ctx = await browser.newContext();
await ctx.addInitScript(`(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); return v == null && typeof k === 'string' && k.startsWith('tacit-wei-pq-later:') && !window.__pqAsk ? String(Date.now()) : v; }; })();`);   // the post-quantum offer is put off, as after "Not now" (a test sets window.__pqAsk to see it)
await routes(ctx);
// Reads the page sends through the wallet are answered as the wallet's own node on Ethereum would.
await ctx.exposeFunction('__read', (method, params) => answer('ethereum-rpc.publicnode.com', {method, params}));
await ctx.addInitScript(`window.__sent = 0; window.ethereum = { on() {}, removeListener() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(PAYER)}];
  if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getCode'].includes(method)) return window.__read(method, params);
  if (method === 'eth_chainId') return '0x1';
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
  if (method === 'eth_sendTransaction') { window.__sent++; return ${JSON.stringify(SENT)}; }
  throw new Error('not in this test: ' + method);
} };`);
const B = await ctx.newPage();
B.on('pageerror', (e) => errors.push(String(e)));
await B.clock.install();
await B.goto(link.replace(/^[^#]*/, origin));
await B.waitForSelector('#req-pay', {timeout: 30e3});
await B.click('#req-pay');                                           // connect
await B.waitForFunction(() => /^Pay 0\.002 ETH on/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
state.box = await B.textContent('#req .adv .addr code');
ok(/^0x[0-9a-fA-F]{40}$/.test(state.box), 'the card offers the link’s deposit address', state.box);
await B.click('#req-pay');
for (let i = 0; i < 400 && !/not confirmed/.test(await B.textContent('#req-status')); i++) { await B.clock.fastForward(2_000); await B.waitForTimeout(30); }
const status = (await B.textContent('#req-status')).trim();
ok(/has not confirmed it yet/.test(status), 'after the wait the payer is told it is not confirmed', status.slice(0, 100));
ok(await B.evaluate(() => window.__sent) === 1, 'the wallet was asked once');
ok(await B.isDisabled('#req-pay'), 'and the button waits');
ok(/not confirmed yet/.test(await B.textContent('#req-note')) && !!(await B.$('#req-note a')), 'with the transaction shown beside the reason');
await B.click('#req-pay', {force: true, timeout: 2e3}).catch(() => {});
ok(await B.evaluate(() => window.__sent) === 1, 'pressing it anyway sends nothing');
await B.click('[data-sent-again]');
ok(!(await B.isDisabled('#req-pay')), 'once the payer says it was dropped, they can pay again');

console.log('\nthe payer stops waiting for a wallet that never answers');
const ctx2 = await browser.newContext();
await ctx2.addInitScript(`(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); return v == null && typeof k === 'string' && k.startsWith('tacit-wei-pq-later:') && !window.__pqAsk ? String(Date.now()) : v; }; })();`);   // the post-quantum offer is put off, as after "Not now" (a test sets window.__pqAsk to see it)
await routes(ctx2);
await ctx2.exposeFunction('__read', (method, params) => answer('ethereum-rpc.publicnode.com', {method, params}));
await ctx2.addInitScript(`window.__sent = 0; window.ethereum = { on() {}, removeListener() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(PAYER)}];
  if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getCode'].includes(method)) return window.__read(method, params);
  if (method === 'eth_chainId') return '0x1';
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
  if (method === 'eth_sendTransaction') { window.__sent++; return new Promise(() => {}); }
  throw new Error('not in this test: ' + method);
} };`);
const C = await ctx2.newPage();
C.on('pageerror', (e) => errors.push(String(e)));
await C.clock.install();
await C.goto(link.replace(/^[^#]*/, origin));
await C.waitForSelector('#req-pay', {timeout: 30e3});
await C.click('#req-pay');                                           // connect
await C.waitForFunction(() => /^Pay 0\.002 ETH on/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
await C.click('#req-pay');
for (let i = 0; i < 60 && !(await C.$('#req-status [data-unstick]')); i++) { await C.clock.fastForward(1_000); await C.waitForTimeout(30); }
ok(!!(await C.$('#req-status [data-unstick]')) && !(await C.$('#status [data-unstick]')), 'the nudge to check the wallet is in the card’s own status line');
await C.click('#req-status [data-unstick]');
await C.waitForFunction(() => /may still send/.test(document.querySelector('#req-note')?.textContent || ''), null, {timeout: 10e3}).catch(() => {});
ok(/may still send/.test(await C.textContent('#req-note')), 'stopping the wait says the wallet may still send it', (await C.textContent('#req-note')).trim().slice(0, 100));
ok(await C.isDisabled('#req-pay'), 'and the button waits');
await C.click('#req-pay', {force: true, timeout: 2e3}).catch(() => {});
ok(await C.evaluate(() => window.__sent) === 1, 'pressing it anyway asks the wallet nothing more');
await C.reload();
await C.waitForSelector('#req-pay', {timeout: 30e3});
await C.click('#req-pay').catch(() => {});
await C.waitForFunction(() => /may still send/.test(document.querySelector('#req-note')?.textContent || ''), null, {timeout: 30e3}).catch(() => {});
ok(await C.isDisabled('#req-pay'), 'the hold outlasts a reload');
await C.click('[data-sent-again]');
ok(!(await C.isDisabled('#req-pay')), 'once the payer says it was not sent, they can pay again');
console.log('\nthe device sleeps through the wait, and the transfer landed meanwhile');
const ctx3 = await browser.newContext();
await ctx3.addInitScript(`(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); return v == null && typeof k === 'string' && k.startsWith('tacit-wei-pq-later:') && !window.__pqAsk ? String(Date.now()) : v; }; })();`);
await routes(ctx3);
await ctx3.exposeFunction('__read', (method, params) => answer('ethereum-rpc.publicnode.com', {method, params}));
await ctx3.addInitScript(`window.__sent = 0; window.ethereum = { on() {}, removeListener() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(PAYER)}];
  if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getCode', 'eth_getTransactionByHash'].includes(method)) return window.__read(method, params);
  if (method === 'eth_chainId') return '0x1';
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
  if (method === 'eth_sendTransaction') { window.__sent++; return ${JSON.stringify(SLEPT)}; }
  throw new Error('not in this test: ' + method);
} };`);
const D = await ctx3.newPage();
D.on('pageerror', (e) => errors.push(String(e)));
await D.clock.install();
await D.goto(link.replace(/^[^#]*/, origin));
await D.waitForSelector('#req-pay', {timeout: 30e3});
await D.click('#req-pay');                                           // connect
await D.waitForFunction(() => /^Pay 0\.002 ETH on/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
state.box = await D.textContent('#req .adv .addr code');
await D.click('#req-pay');
await D.waitForFunction(() => /Waiting for the block/.test(document.querySelector('#req-status')?.textContent || ''), null, {timeout: 30e3});
// Asleep: the page's timers stand still while the clock runs on past the three minutes; the transfer lands meanwhile.
await D.clock.pauseAt(await D.evaluate(() => Date.now() + 50));
state.mined = SLEPT;
await D.clock.fastForward(200_000);
await D.clock.resume();
await D.waitForSelector('#req-done', {timeout: 30e3}).catch(() => {});
const woke = (await D.textContent('#req-status')).trim();
ok(!!(await D.$('#req-done')) && !/not confirmed/.test(woke), 'on waking it looks once more, and the payment shows as landed', woke.slice(0, 100));
ok(await D.evaluate(() => window.__sent) === 1, 'the wallet was asked once');
state.mined = null;

ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
