/* A payment from the wallet that the network does not confirm in the three minutes the page waits is not sent a second time
   by the next press: the payer is told, shown the transaction, and the button waits until they say it was dropped.
   No network: the nodes are scripted, the payee's page makes a signed link, and the payer's clock is moved on by hand.

   Usage: node test/dapp/tacit-pay.unconfirmed.mjs                  (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(process.env.PAGE || new URL('../../dapp/page.html', import.meta.url));
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

const KEY = '11'.repeat(32), PAYER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', SENT = '0x' + 'ab'.repeat(32);
const BOX0 = '0x52fc37ee7741468a15CE879320a7a41CEBaeb232';
const state = {box: BOX0};
const TIP = {base: 51864114, robinhood: 73991761, ethereum: 26069345};
const answer = (host, {method, params}) => {
  if (method === 'eth_blockNumber') return '0x' + TIP[/base/.test(host) ? 'base' : /robinhood/.test(host) ? 'robinhood' : 'ethereum'].toString(16);
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getBalance') return params[0].toLowerCase() === PAYER ? '0x' + (100n * 10n ** 18n).toString(16) : '0x0';
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_getTransactionReceipt') return null;
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
await A.waitForFunction(() => /&ns=[0-9a-f]{128}&amount=0\.002/.test(document.querySelector('#f-rlink')?.textContent || ''), null, {timeout: 30e3});
const link = await A.textContent('#f-rlink');
ok(/#pay=tacit1[a-z0-9]+&n=[0-9a-f]{64}&ns=/.test(link), 'a signed link with a deposit address', link.slice(0, 90) + '…');

console.log('\nthe payer pays it from a wallet, and the network never confirms');
const ctx = await browser.newContext();
await routes(ctx);
await ctx.addInitScript(`window.__sent = 0; window.ethereum = { on() {}, removeListener() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(PAYER)}];
  if (method === 'eth_chainId') return '0x2105';
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
await B.click('#sent-again');
ok(!(await B.isDisabled('#req-pay')), 'once the payer says it was dropped, they can pay again');
ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
