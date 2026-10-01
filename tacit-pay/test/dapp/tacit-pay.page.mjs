/* Runs the real dapp/page.html in Chromium with the chain unplugged: every JSON-RPC call is answered here by a chain
   with nothing in its pool, and every relay is down. What it checks is what the page computes and shows on its own:
   the document is self-contained and pins its one module, a Tacit key opens to the addresses the specification's
   vectors give, an Ethereum wallet's signature opens the key every Tacit app derives from it, the deposit address
   is shown only once the router agrees with it, and payment links round-trip.

   Usage: node test/dapp/tacit-pay.page.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Wallet, AbiCoder, namehash, id} from 'ethers';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url));
const text = HTML.toString('utf8');

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

// Vectors from docs/EVM-POOL.md and the reference implementation in src-company/tacit (dapp/tacit-unified.js).
const KEY = '11'.repeat(32);
const BP1 = 'bp1q235w92ulr4p6t0jmfuqzj9l2cvr2m4qr69cw5aljvq6sgxfqq40wdx7tpeacup3lpgnegy9t4t3hfg0dzu6etxjk65qmts92d5n00c98g6cleva40sq8gz0kt500z5fjjv4tsap58ql4f4nhvhv7zmg7u4sp3v920';
const TACIT1 = 'tacit1qzzsxne4t0wt0nq27u5w70xwh9s4myrgfw6m9jjlskdtpu9hqsr4sud2qtvmuq4q9swlf55uxmmrlfw9ezfjdzattp93p8hmlg9re4lgr994yq4rgu24e782r5kl9kncq9yt74scx4h2q85tsafmlycp4qsvjqp27u6dukrnm3crr7z38jsg2h2hrwjs769e4jkd9d4gpkhq25mfx7ls2w343ljem2lqqwsylvhg779gn9ye2hp6rgwpl2nt8weweu9k3aetkuyv7k';
const BOX0 = '0x52fc37ee7741468a15CE879320a7a41CEBaeb232';
// The well-known first development account; its signature over the Tacit identity message opens this address.
const DEV = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const DEV_TACIT1 = 'tacit1qzzsx4pc3x9c8ym6q6mz53hkqa26lj4wsapknp474xxglk9r9dj0mu80q2g04y8gt2wgh3xdl6nmemkftsxeya0jcs2p8rjaed4htlfgqcmq5q5axtryqaknkkn47w5ruzd4t56hlrearwjjzhp92mpz7kfu9c2cpf3gxukgxnlm4rgewq5mmqfegdgdfxs0wurtavg8gjwlnzexpvptpkks9k72a9u74tkuns8y6x0gg490z3xd30xvpk6nvp8lpxar36qknkfaah';

console.log('the document');
const module = /<script type="module">([\s\S]*?)<\/script>/.exec(text)?.[1] ?? '';
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(text)?.[1] ?? '';
ok(csp.includes(`'sha256-${createHash('sha256').update(module).digest('base64')}'`), 'the CSP pins the one module by its hash');
const style = /<style>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '', tags = text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
ok(!/<script[^>]+src=|<link[^>]+href="(?!data:)|<img[^>]+src="(?!data:)/i.test(tags) && !/@import|url\((?!["']?data:)/i.test(style), 'nothing is loaded by URL: no script src, no stylesheet, no remote image or url()');
ok(/<script type="text\/x-prover" id="prover">/.test(text) && /function makeProver/.test(text), 'the prover is in the document, for its workers');
ok(text.includes('40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b') && text.includes('02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1'), 'it pins the ceremony’s proving key and witness program by SHA-256');

// Each chain a hundred blocks past the pool's deployment with nothing in the pool: enough for the page to read, and
// a router that names BOX0 as the deposit address.
const seen = new Set();
const TIP = {base: 51864114, robinhood: 73991761, ethereum: 26069345};
const WNS = '0x0000000000696760e15f265e828db644a0c242eb', RECORDS = {
  [namehash('ross.wei')]: () => TACIT1,                 // the vector key's own name
  [namehash('friend.wei')]: () => DEV_TACIT1,           // someone else's
  [namehash('blank.wei')]: () => '',                    // registered, nothing published
  [namehash('old.wei')]: () => 'tacit1qqpsxr8grjvk4asyvl',
  [namehash('split.wei')]: (host) => ({'ethereum-rpc.publicnode.com': TACIT1, 'mainnet.gateway.tenderly.co': DEV_TACIT1, 'eth.drpc.org': BP1}[host] ?? 'tacit1qq'),
};
const answer = (host, {method, params}) => {
  if (method === 'eth_call' && params[0].to.toLowerCase() === WNS && params[0].data.startsWith('0x59d1d43c')) {
    const rec = RECORDS['0x' + params[0].data.slice(10, 74)];
    return rec ? AbiCoder.defaultAbiCoder().encode(['string'], [rec(host)]) : AbiCoder.defaultAbiCoder().encode(['string'], ['']);
  }
  if (method === 'eth_blockNumber') return '0x' + TIP[/base/.test(host) ? 'base' : /robinhood/.test(host) ? 'robinhood' : 'ethereum'].toString(16);
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_call' && params[0].data.startsWith(id('nextIndex()').slice(0, 10))) return '0x' + '00'.repeat(32);
  if (method === 'eth_getBalance') return '0x0';
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_call') return '0x' + BOX0.slice(2).toLowerCase().padStart(64, '0');
  return null;
};
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const browser = await chromium.launch();
const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const req = route.request(), url = new URL(req.url());
  seen.add(url.host);
  if (req.method() === 'POST' && !/onrender\.com$/.test(url.host)) {
    const body = JSON.parse(req.postData() || '{}');
    const reply = (b) => ({jsonrpc: '2.0', id: b.id, result: answer(url.host, b)});
    return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
  }
  return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
});
await ctx.exposeFunction('__sign', (hex) => DEV.signMessage(Buffer.from(hex.slice(2), 'hex')));
await ctx.addInitScript(`window.ethereum = { on() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(DEV.address.toLowerCase())}];
  if (method === 'eth_chainId') return '0x1';
  if (method === 'eth_getCode') return '0x';
  if (method === 'personal_sign') return window.__sign(params[0]);
  throw new Error('not in this test: ' + method);
} };`);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.waitForTimeout(400);

console.log('a key opens to the vectors');
ok((await p.textContent('#wallet-label')) === 'Open wallet', 'nothing is open on arrival');
ok(await p.isVisible('#f-samt') && await p.isVisible('#f-sto'), 'Shield works with no key open: paying someone needs only their address');
await p.click('#tabs [data-tab="receive"]');
await p.click('#form [data-in="paste"]');
await p.fill('#form .opts input', KEY);
await p.click('#form [data-in="key"]');
await p.waitForSelector('#form .addr code');
ok((await p.textContent('#form .addr code')) === TACIT1, 'Receive shows the unified tacit1 address');
ok((await p.getAttribute('#form [data-copy^="bp1"]', 'data-copy')) === BP1, 'and the bp1 pool address');
ok(await p.isVisible('#f-qr svg'), 'and a QR code of the payment link');
await p.waitForFunction(() => [...document.querySelectorAll('#chains small')].every((s) => /0 ETH/.test(s.textContent)), null, {timeout: 30e3}).catch(() => {});
ok((await p.$$eval('#chains small', (x) => x.map((e) => e.textContent))).join() === '0 ETH,0 ETH,0 ETH', 'an empty pool reads as 0 on each chain');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="exchange"]');
await p.waitForSelector('#form .addr code', {timeout: 30e3});
ok((await p.textContent('#form .addr code')) === BOX0, 'the deposit address is the vector, shown once the router agrees');

console.log('payment links');
await p.fill('#f-ramt', '').catch(() => {});
await p.evaluate((a) => { location.hash = `pay=${a}&amount=0.25&chain=robinhood&for=rent`; }, TACIT1);
await p.waitForSelector('#req:not([hidden])');
ok(/0\.25/.test(await p.textContent('#req .req-a')) && /“rent”/.test(await p.textContent('#req .req-m')), 'a link opens a request with its amount and note');
ok(/This is your own request/.test(await p.textContent('#req')), 'the payee’s own request says so');
await p.click('#req-x');
ok(!(await p.evaluate(() => location.hash)), 'dismissing it clears the link from the address bar');
await p.click('#tabs [data-tab="send"]');
const mutated = TACIT1.slice(0, 40) + (TACIT1[40] === 'q' ? 'p' : 'q') + TACIT1.slice(41);
await p.fill('#f-to', mutated); await p.fill('#f-amt', '0.1');
await p.waitForFunction(() => document.querySelector('#f-rcpt .err'), null, {timeout: 10e3}).catch(() => {});
ok(/checksum/.test(await p.textContent('#f-rcpt')), 'a one-character change to an address is refused');
await p.fill('#f-to', TACIT1);
await p.waitForTimeout(200);
ok(/your own address/.test(await p.textContent('#f-rcpt')), 'and so is paying yourself');

console.log('names in links');
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  for (const [tag, w, h] of [['phone', 390, 900], ['laptop', 1100, 900]]) { await p.setViewportSize({width: w, height: h}); await p.waitForTimeout(150); await p.screenshot({path: `${process.env.SHOTS}/${name}-${tag}.png`}); }
};
const open = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector('#req:not([hidden])'); await p.waitForFunction(() => !/Reading/.test(document.querySelector('#req-body').textContent), null, {timeout: 20e3}); };
await open('pay=friend.wei&amount=0.05&chain=base&for=lunch');
await shot('namerequest');
let req = (await p.textContent('#req-body')).replace(/\s+/g, ' ');
ok(/friend\.wei/.test(req) && /0\.05 ETH/.test(req) && /“lunch”/.test(req), 'a name in a link is read from Ethereum and shown with the amount and note');
ok(req.includes(DEV_TACIT1.slice(0, 10) + '…' + DEV_TACIT1.slice(-8)), 'beside the address it gave, so it can be checked');
ok(await p.$eval('#req [data-rc][aria-selected="true"]', (b) => b.textContent.startsWith('Base')), 'on the chain the link names');
ok((await p.$$eval('#req [data-rc]', (b) => b.map((x) => x.textContent.replace(/[\d.]+ ETH/, '').trim()))).join() === 'Ethereum,Base,Robinhood', 'with the other chains one click away');
ok(/Connect a wallet to pay/.test(await p.textContent('#req-pay')), 'a payer with no wallet connected is asked for one first');
ok((await p.evaluate(() => location.hash)).includes('friend.wei'), 'and the link stays in the address bar, so a reload keeps the request');
await p.click('#req [data-rc="8453"]');
await p.click('#req [data-rc="1"]');
ok(await p.$eval('#req [data-rc="1"]', (b) => b.getAttribute('aria-selected') === 'true') && (await p.$eval('#chains [aria-selected="true"]', (b) => b.textContent.startsWith('Ethereum'))), 'picking a chain moves the whole page to it');
await open('pay=ross.wei&amount=0.25');
ok(/This is your own request/.test(await p.textContent('#req')), 'a name that points at the open key is its own request');
await open('pay=blank.wei');
ok(/has not published a Tacit address/.test(await p.textContent('#req-body')) && !(await p.$('#req-pay')), 'a name with no record cannot be paid, and says why');
await open('pay=old.wei');
ok(/publishes an address this page cannot pay/.test(await p.textContent('#req-body')), 'nor can one with a record that is not a usable address');
await open('pay=split.wei');
ok(/did not agree/.test(await p.textContent('#req-body')) && !!(await p.$('#req-retry')), 'a name the Ethereum nodes disagree on is not paid, and can be read again');
await open('pay=friend.wei&chains=base,robinhood&amount=0.1');
ok((await p.$$eval('#req [data-rc]', (b) => b.map((x) => x.textContent.replace(/[\d.]+ ETH/, '').trim()))).join() === 'Base,Robinhood', 'a link can offer only some chains');
ok(await p.$eval('#req [data-rc][aria-selected="true"]', (b) => !b.textContent.startsWith('Ethereum')), 'and the page moves onto one of them');
await open('friend.wei');
ok(/Any amount/.test(await p.textContent('#req')) && !!(await p.$('#req-amt')), 'a bare #name.wei asks for an amount');
await open(TACIT1);
ok(/This is your own request/.test(await p.textContent('#req')), 'and so does a bare tacit1… address');
await p.click('#req-x');
await open('pay=not-an-address');
ok(/not valid/.test(await p.textContent('#req-body')), 'a link that is not an address or a name says so');
await p.click('#req-x');
await p.click('#tabs [data-tab="send"]');
await p.click('[data-route="wallet"]');
await p.fill('#f-to', 'friend.wei'); await p.fill('#f-amt', '0.1');
await p.waitForFunction(() => /friend\.wei · tacit1/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 20e3});
ok(true, 'Send takes a name too, and shows who it resolved to');
await p.click('#tabs [data-tab="receive"]');
await p.fill('#f-rname', 'ross.wei');
await p.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 20e3});
ok(/#pay=ross\.wei/.test(await p.textContent('#f-rlink')), 'a name that points at this key goes into the payment link');
await p.fill('#f-rname', 'friend.wei');
await p.waitForFunction(() => /different Tacit address/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 20e3});
ok(/#pay=tacit1/.test(await p.textContent('#f-rlink')) && !!(await p.$('#f-rpub')), 'one that points elsewhere is not used, and can be pointed here');
await p.fill('#f-rname', 'blank.wei');
await p.waitForFunction(() => /has not published/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 20e3});
ok(!!(await p.$('#f-rpub')), 'one with no record can have the address published to it');
await p.fill('#f-rname', 'ross.wei');
await p.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 20e3});
await p.fill('#f-ramt', '0.5'); await p.fill('#f-rfor', 'rent');
await p.click('#f-rchains [data-rs="base"]');
const link = await p.textContent('#f-rlink');
ok(/#pay=ross\.wei&amount=0\.5&chain=base&for=rent$/.test(link), 'the link carries the name, amount, chain and note', link);
await p.click('#f-rchains [data-rs="any"]');
ok(!/chain=/.test(await p.textContent('#f-rlink')), 'and offers every chain unless one is picked');
ok(await p.isVisible('#f-qr svg'), 'with a QR code of it');
await shot('receive');

console.log('an Ethereum wallet');
await p.click('#wallet'); await p.click('#w-lock'); await p.click('#sheet-wallet [data-close]');
await p.click('#form [data-in="eth"]');
await p.waitForFunction(() => /^tacit1/.test(document.querySelector('#wallet-label').textContent), null, {timeout: 30e3});
await p.click('#tabs [data-tab="receive"]');
ok((await p.textContent('#form .addr code')) === DEV_TACIT1, 'a wallet’s signature over the identity message opens the key every Tacit app derives');

console.log('endpoints');
await p.click('#settings-open');
await p.fill('#e-rpc-8453', 'https://example.org/rpc');
await p.click('#e-save');
ok(JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-endpoints-v1'))).rpc[8453][0] === 'https://example.org/rpc', 'a reader’s own node is saved');
await p.click('#settings-open');
await p.click('#e-reset');
ok(JSON.stringify(JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-endpoints-v1')))) === '{}', 'and the defaults come back');

const hosts = [...seen].filter((h) => !/^(ethereum-rpc\.publicnode\.com|(base|mainnet)\.gateway\.tenderly\.co|eth\.drpc\.org|1rpc\.io|mainnet\.base\.org|base-rpc\.publicnode\.com|base\.drpc\.org|rpc\.mainnet\.chain\.robinhood\.com|robinhood\.drpc\.org|tacit-evm-pool-keeper(-base|-robinhood)?\.onrender\.com|example\.org|tacit\.finance|ipfs\.filebase\.io|ipfs\.io|[a-z0-9]+\.ipfs\.dweb\.link)$/.test(h));
ok(!hosts.length, 'it talks only to its listed nodes, relays and proving-key mirrors', hosts.join(' '));
ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
