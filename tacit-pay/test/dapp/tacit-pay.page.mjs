/* Runs the deployed page in Chromium with the chain unplugged: every JSON-RPC call is answered here by a chain
   with nothing in its pool, and every relay is down. What it checks is what the page computes and shows on its own:
   the document is self-contained and pins its one module, a Tacit key opens to the addresses the specification's
   vectors give, an Ethereum wallet's signature opens the key every Tacit app derives from it, the deposit address
   is shown only once the router agrees with it, and payment links round-trip.

   Usage: node test/dapp/tacit-pay.page.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Wallet, AbiCoder, namehash, id, getAddress} from 'ethers';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
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
// bech32m, to build addresses the vectors do not include.
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const polymod = (v) => { let c = 1; for (const x of v) { const b = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >>> i) & 1) c ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i]; } return c >>> 0; };
const hrpX = (h) => [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
const bits = (data, from, to, pad) => { let acc = 0, n = 0; const out = []; for (const v of data) { acc = (acc << from) | v; n += from; while (n >= to) { n -= to; out.push((acc >> n) & ((1 << to) - 1)); } acc &= (1 << n) - 1; } if (pad && n) out.push((acc << (to - n)) & ((1 << to) - 1)); return out; };
const b32m = (hrp, bytes) => { const d = bits(bytes, 8, 5, true), m = polymod([...hrpX(hrp), ...d, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3; return hrp + '1' + [...d, ...[0, 1, 2, 3, 4, 5].map((i) => (m >>> (5 * (5 - i))) & 31)].map((x) => B32[x]).join(''); };
const unb32 = (s) => bits([...s.slice(s.lastIndexOf('1') + 1, -6)].map((c) => B32.indexOf(c)), 5, 8, false);
// The well-known first development account; its signature over the Tacit identity message opens this address.
const DEV = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const DEV_TACIT1 = 'tacit1qzzsx4pc3x9c8ym6q6mz53hkqa26lj4wsapknp474xxglk9r9dj0mu80q2g04y8gt2wgh3xdl6nmemkftsxeya0jcs2p8rjaed4htlfgqcmq5q5axtryqaknkkn47w5ruzd4t56hlrearwjjzhp92mpz7kfu9c2cpf3gxukgxnlm4rgewq5mmqfegdgdfxs0wurtavg8gjwlnzexpvptpkks9k72a9u74tkuns8y6x0gg490z3xd30xvpk6nvp8lpxar36qknkfaah';

console.log('the document');
const module = /<script type="module">([\s\S]*?)<\/script>/.exec(text)?.[1] ?? '';
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(text)?.[1] ?? '';
ok(csp.includes(`'sha256-${createHash('sha256').update(module).digest('base64')}'`), 'the CSP pins the one module by its hash');
const style = /<style>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '', tags = text.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
ok(!/<script[^>]+src=|<link[^>]+href="(?!data:)|<img[^>]+src="(?!data:)/i.test(tags) && !/@import|url\((?!["']?data:)/i.test(style), 'nothing is loaded by URL: no script src, no stylesheet, no remote image or url()');
ok(/<script type="text\/x-prover" id="prover"[^>]*>/.test(text) && /function makeProver/.test(text), 'the prover is in the document, for its workers');
ok(text.includes('40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b') && text.includes('02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1'), 'it pins the ceremony’s proving key and witness program by SHA-256');

// Each chain a hundred blocks past the pool's deployment with nothing in the pool: enough for the page to read, and
// a router that names BOX0 as the deposit address.
const seen = new Set(), DOWN = new Set(), CALLS = [], NOLOGS = new Set();
const TIP = {base: 51864114, robinhood: 73991761, ethereum: 26069345};
// A tacit1 record with the Bitcoin and pool lanes and no Ethereum-side key (flags 0x05), as a name may publish.
const POOLONLY = b32m('tacit', [0, 0x05, ...unb32(DEV_TACIT1).slice(2)]);
const WNS = '0x0000000000696760e15f265e828db644a0c242eb', GNS = '0x9d51d507bc7264d4fe8ad1cf7fe191933a0a81d6', ENSREG = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
const R_DIRECT = '0x' + '11'.repeat(20), R_WILD = '0x' + '22'.repeat(20), R_OFF = '0x' + '33'.repeat(20);
// ENS: the resolver set on a name's own node, a parent's resolver that answers for its subnames, and one that answers off-chain.
const RESOLVERS = {[namehash('direct.eth')]: R_DIRECT, [namehash('parent.eth')]: R_WILD, [namehash('off.eth')]: R_OFF};
const RECORDS = {
  [namehash('bob.gwei')]: () => DEV_TACIT1,
  [namehash('direct.eth')]: () => DEV_TACIT1,
  [namehash('sub.parent.eth')]: () => DEV_TACIT1,
  [namehash('pooly.wei')]: () => POOLONLY,
  [namehash('ross.wei')]: () => TACIT1,                 // the vector key's own name
  [namehash('friend.wei')]: () => DEV_TACIT1,           // someone else's
  [namehash('blank.wei')]: () => '',                    // registered, nothing published
  [namehash('old.wei')]: () => 'tacit1qqpsxr8grjvk4asyvl',
  [namehash('mine.wei')]: () => DEV_TACIT1,             // read only after the reader sets their own node
  [namehash('later.wei')]: () => DEV_TACIT1,
  [namehash('split.wei')]: (host) => ({'ethereum-rpc.publicnode.com': TACIT1, 'mainnet.gateway.tenderly.co': DEV_TACIT1, 'eth.drpc.org': BP1}[host] ?? 'tacit1qq'),
};
const coder = AbiCoder.defaultAbiCoder();
const PAYEE = '0xC1D6F3AC3dFd66bb264f732CB5581DE3E232CC21', PAYEE2 = '0x3e407f4158440F1e5a9E6BA98b0198AEA6d837E3';
// A token the token list does not hold, with six decimals, as its own contract reports them.
const TOKEN = '0x' + '7a'.repeat(20);
const POINTS = {[namehash('bob.wei')]: PAYEE, [namehash('bob.gwei')]: PAYEE2, [namehash('direct.eth')]: PAYEE, [namehash('sub.parent.eth')]: PAYEE2, [namehash('zero.wei')]: '0x' + '00'.repeat(20), [namehash('pool.wei')]: '0x000000c2A20657CE25f2Ba99737933D031AFBEE9'};
const ZRPC = '0x8c7348d039f58c4e9cfa936ef410eec759213b12', ZEND = '0x00000051f365d898132f4ebf345cd3968e02f288';
const answer = (host, {method, params}) => {
  const to = method === 'eth_call' ? params[0].to.toLowerCase() : '', data = method === 'eth_call' ? params[0].data : '';
  if (to === ZRPC && data === '0xd77e4c79') return coder.encode(['string[]'], [['https://registry-eth.example', 'http://insecure.example', 'https://ethereum-rpc.publicnode.com']]);
  if (to === ZEND && data.startsWith('0xc03c2d74')) return coder.encode(['string[][]'], [[['https://registry-base.example'], ['https://registry-rh.example'], ['https://registry-logs.example']]]);
  if ([WNS, GNS, R_DIRECT].includes(to) && data.startsWith('0x59d1d43c')) {
    const rec = RECORDS['0x' + data.slice(10, 74)];
    return coder.encode(['string'], [rec ? rec(host) : '']);
  }
  // The address a name points to: WNS and GNS by resolve(uint256), a .eth name's resolver by addr(bytes32), a parent's through resolve(bytes,bytes).
  if ([WNS, GNS].includes(to) && data.startsWith('0x4f896d4f')) return coder.encode(['address'], [POINTS['0x' + data.slice(10, 74)] || '0x' + '00'.repeat(20)]);
  if (to === R_DIRECT && data.startsWith('0x3b3b57de')) return coder.encode(['address'], [POINTS['0x' + data.slice(10, 74)] || '0x' + '00'.repeat(20)]);
  if (to === ENSREG && data.startsWith('0x0178b8bf')) return coder.encode(['address'], [RESOLVERS['0x' + data.slice(10, 74)] || '0x' + '00'.repeat(20)]);
  if (to === R_WILD && data.startsWith('0x9061b923')) {                   // resolve(bytes name, bytes data): the text request is inside
    const [, inner] = coder.decode(['bytes', 'bytes'], '0x' + data.slice(10)), node = '0x' + inner.slice(10, 74);
    if (inner.startsWith('0x3b3b57de')) return coder.encode(['bytes'], [coder.encode(['address'], [POINTS[node] || '0x' + '00'.repeat(20)])]);
    const rec = RECORDS[node];
    return coder.encode(['bytes'], [coder.encode(['string'], [rec ? rec(host) : ''])]);
  }
  if (to === R_OFF) throw {rpcError: {code: 3, message: 'execution reverted', data: '0x556f1830' + '00'.repeat(32)}};
  if (method === 'eth_blockNumber') return '0x' + TIP[/base/.test(host) ? 'base' : /robinhood/.test(host) ? 'robinhood' : 'ethereum'].toString(16);
  if (method === 'eth_getLogs') { if (NOLOGS.has(host)) throw {rpcError: {code: -32005, message: 'logs are not served on this plan'}}; return []; }
  if (to === TOKEN && data === '0x313ce567') return coder.encode(['uint8'], [6]);
  if (to === TOKEN && data === '0x95d89b41') return coder.encode(['string'], ['TUSD']);
  if (to === TOKEN && data === '0x06fdde03') return coder.encode(['string'], ['Test USD']);
  if (method === 'eth_call' && params[0].data.startsWith(id('nextIndex()').slice(0, 10))) return '0x' + '00'.repeat(32);
  if (method === 'eth_getBalance') return params[0].toLowerCase() === '0x000000c2a20657ce25f2ba99737933d031afbee9' ? '0x' + (1234n * 10n ** 18n).toString(16) : '0x0';
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
  if (req.method() === 'POST') try { for (const x of [].concat(JSON.parse(req.postData() || '{}'))) CALLS.push([url.host, x.method, x.params?.[0]?.data || '']); } catch {}
  if (DOWN.has(url.host)) return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"down"}'});
  if (req.method() === 'POST' && !/onrender\.com$/.test(url.host)) {
    const body = JSON.parse(req.postData() || '{}');
    const reply = (b) => { try { return {jsonrpc: '2.0', id: b.id, result: answer(url.host, b)}; } catch (e) { if (e.rpcError) return {jsonrpc: '2.0', id: b.id, error: e.rpcError}; throw e; } };
    return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
  }
  return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
});
await ctx.exposeFunction('__sign', (hex) => DEV.signMessage(Buffer.from(hex.slice(2), 'hex')));
await ctx.addInitScript(`let chain = '0x1'; window.ethereum = { on() {}, request: async ({ method, params }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [${JSON.stringify(DEV.address.toLowerCase())}];
  if (method === 'eth_chainId') return chain;
  if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; return null; }
  if (method === 'eth_getBalance') return '0x' + (123n * 10n ** 15n).toString(16);
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
ok((await p.textContent('#wallet-label')) === 'Sign in', 'nothing is open on arrival');
ok(await p.isVisible('#f-samt') && await p.isVisible('#f-sto'), 'Shield works with no key open: paying someone needs only their address');
await p.click('#tabs [data-tab="receive"]');
await p.click('#form [data-in="paste"]');
await p.fill('#form .opts input', KEY);
await p.click('#form [data-in="key"]');
await p.waitForSelector('#form .addr code');
ok((await p.textContent('#form .addr code')) === TACIT1, 'Receive shows the unified tacit1 address');
ok((await p.getAttribute('#form [data-copy^="bp1"]', 'data-copy')) === BP1, 'and the bp1 pool address');
await p.waitForSelector('#f-qr svg', {timeout: 30e3}).catch(() => {});
ok(await p.isVisible('#f-qr svg'), 'and a QR code of the payment link, once the chains’ history is read');
await p.waitForFunction(() => [...document.querySelectorAll('#chains small')].every((s) => /0 ETH/.test(s.textContent)), null, {timeout: 30e3}).catch(() => {});
ok((await p.$$eval('#chains small', (x) => x.map((e) => e.textContent))).join() === '0 ETH,0 ETH,0 ETH', 'an empty pool reads as 0 on each chain');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="exchange"]');
await p.waitForSelector('#form .addr code', {timeout: 30e3});
ok((await p.textContent('#form .addr code')) === BOX0, 'the deposit address is the vector, shown once the router agrees');

console.log('payment links');
await p.evaluate(() => { const d = document.querySelector('#f-ropts'); if (d) d.open = true; });
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
ok(/not a complete address/.test(await p.textContent('#f-rcpt')), 'a one-character change to an address is refused, in plain words');
await p.fill('#f-to', TACIT1);
await p.waitForTimeout(200);
ok(/your own address/.test(await p.textContent('#f-rcpt')), 'and so is paying yourself');

console.log('names in links');
// (the sections below read names and links of every kind this page takes)
const shot = async (name) => {
  if (!process.env.SHOTS) return;
  for (const [tag, w, h] of [['phone', 390, 900], ['laptop', 1100, 900]]) { await p.setViewportSize({width: w, height: h}); await p.waitForTimeout(150); await p.screenshot({path: `${process.env.SHOTS}/${name}-${tag}.png`}); }
};
const open = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector('#req:not([hidden])'); await p.waitForFunction(() => !/Reading/.test(document.querySelector('#req-body').textContent), null, {timeout: 20e3}); };
await open('pay=friend.wei&amount=0.05&chain=base&for=lunch');
await shot('namerequest');
let req = (await p.textContent('#req-body')).replace(/\s+/g, ' ');
ok(/friend\.wei/.test(req) && /0\.05 ETH/.test(req) && /“lunch”/.test(req), 'a name in a link is read from Ethereum and shown with the amount and note');
ok(req.includes(DEV_TACIT1.slice(0, 18) + '…' + DEV_TACIT1.slice(-8)), 'beside the address it gave, so it can be checked');
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
ok(/Could not confirm that just now/.test(await p.textContent('#req-body')) && !!(await p.$('#req-retry')), 'a name the Ethereum nodes disagree on is not paid, and can be read again');
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

console.log('the ETH the pool holds, and a withdrawal to a name');
await p.waitForFunction(() => /pool holds/.test(document.querySelector('#bal')?.textContent || ''), null, {timeout: 20e3}).catch(() => {});
ok(/The pool holds 1,234 ETH/.test(await p.textContent('#bal')), 'the pool’s ETH on the chain is shown beside the balance', (await p.textContent('#bal')).replace(/\s+/g, ' ').slice(0, 120));
await p.click('#tabs [data-tab="withdraw"]');
const dest = async (v, amt = '') => { await p.fill('#f-wto', v); await p.fill('#f-wamt', amt); await p.waitForFunction(() => !/Reading/.test(document.querySelector('#f-rcpt')?.textContent || 'x'), null, {timeout: 10e3}).catch(() => {}); await p.waitForTimeout(150); return (await p.textContent('#f-rcpt')).replace(/\s+/g, ' '); };
let w = await dest('bob.wei');
ok(w.includes('bob.wei') && w.includes(PAYEE) && w.includes(PAYEE.slice(0, 8)), 'a .wei name is read to the address it points to, which is shown in full beside the name', w.slice(0, 140));
w = await dest('bob.gwei');
ok(w.includes(PAYEE2), 'a .gwei name too');
w = await dest('direct.eth');
ok(w.includes(PAYEE), 'a .eth name through its resolver');
w = await dest('sub.parent.eth');
ok(w.includes(PAYEE2), 'and a .eth subname through its parent’s wildcard resolver');
w = await dest('zero.wei');
ok(/does not point to an address yet/.test(w), 'a name that points nowhere says so');
w = await dest('pool.wei');
ok(/cannot receive a withdrawal/.test(w), 'and one that points at the pool itself is refused');
w = await dest('foo.com');
ok(/ends in \.wei, \.gwei or \.eth/.test(w), 'a name of another kind says which names work');
w = await dest('pay.base.eth');
ok(/\.base\.eth are not supported/.test(w), 'and .base.eth says so');
await dest(PAYEE.toLowerCase());
ok(await p.isHidden('#f-rcpt'), 'a plain address still works as before: nothing to read, nothing to refuse');
await p.fill('#f-wto', ''); await p.fill('#f-wamt', '');
await p.click('#tabs [data-tab="shield"]');

console.log('name services, and the forms a link can take');
const card = async (hash) => { await open(hash); return (await p.textContent('#req-body')).replace(/\s+/g, ' '); };
const SHORT = DEV_TACIT1.slice(0, 18) + '…' + DEV_TACIT1.slice(-8);
let t = await card('pay=bob.gwei&amount=0.01');
ok(t.includes('bob.gwei') && t.includes(SHORT) && !!(await p.$('#req-pay')), 'a .gwei name is read from its own registry');
t = await card('pay=direct.eth&amount=0.01');
ok(t.includes('direct.eth') && t.includes(SHORT) && !!(await p.$('#req-pay')), 'a .eth name is read through its own resolver');
t = await card('pay=sub.parent.eth&amount=0.01');
ok(t.includes('sub.parent.eth') && t.includes(SHORT) && !!(await p.$('#req-pay')), 'a .eth subname is read through its parent’s wildcard resolver');
t = await card('pay=off.eth');
ok(/keeps its records off chain/.test(t) && !(await p.$('#req-pay')), 'a name whose records are off chain says so and cannot be paid');
t = await card('pay=nobody.eth');
ok(/has no resolver set/.test(t) && !(await p.$('#req-pay')), 'a .eth name with no resolver says so');
t = await card('pay=pay.base.eth');
ok(/\.base\.eth are not supported/.test(t) && !(await p.$('#req-pay')), 'a .base.eth name is refused, and the refusal says what to do');
t = await card('pay=alice.com');
ok(/ends in \.wei, \.gwei or \.eth/.test(t) && !(await p.$('#req-pay')), 'a name of another kind says which names work');
t = await card('pay=pooly.wei&amount=0.01');
ok(t.includes('pooly.wei') && !!(await p.$('#req-pay')), 'a record that carries only the pool lane (no Bitcoin lane) can be paid');
await p.click('#req-x');
await p.click('#tabs [data-tab="send"]');
await p.fill('#f-to', 'pay.base.eth'); await p.fill('#f-amt', '0.1');
await p.waitForFunction(() => /not supported/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 10e3}).catch(() => {});
ok(/\.base\.eth are not supported/.test(await p.textContent('#f-rcpt')), 'and the Send form says the same');
await p.fill('#f-to', 'bob.gwei');
await p.waitForFunction((x) => (document.querySelector('#f-rcpt')?.textContent || '').includes(x), SHORT.slice(0, 10), {timeout: 10e3}).catch(() => {});
ok(/bob\.gwei/.test(await p.textContent('#f-rcpt')), 'Send takes a .gwei name');
await p.click('#tabs [data-tab="shield"]');
t = await card('pay=friend.wei&for=' + encodeURIComponent('a\u202Eb\nc'));
ok(/“ab c”/.test(t), 'a note loses control and invisible formatting characters and keeps to one line');
await p.click('#req-x');
const where = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(150); return [await p.$eval('#tabs [aria-selected="true"]', (b) => b.textContent), await p.$eval('#chains [aria-selected="true"]', (b) => b.textContent.replace(/[\d.,]+ ETH|—/g, '').trim())].join(' · '); };
ok(await where('send&chain=base') === 'Send · Base', 'a tab and a chain can sit together: #send&chain=base');
ok(await where('deposit&chain=1') === 'Shield · Ethereum', '#deposit is the Shield tab, and a chain can be its number');
ok(await where('withdraw') === 'Withdraw · Ethereum', 'a tab alone: #withdraw');
ok(await where('robinhood') === 'Withdraw · Robinhood', 'a chain alone: #robinhood');
ok(await where('tab=send&chain=8453') === 'Send · Base', 'tab= and a chain number');
const gift = '0x'.length && 'ab'.repeat(32);
await p.evaluate((h) => { location.hash = h; }, `gift=${gift}&chain=base`);
await p.waitForSelector('#req:not([hidden])');
ok(/gift link made on tacit\.finance/.test(await p.textContent('#req-body')) && (await p.getAttribute('#req-body a.btn', 'href')) === `https://tacit.finance/pay/eth/#gift=${gift}&chain=base`, 'a gift link is handed to the site that made it, not guessed at');
ok(!(await p.$('#req-pay')), 'and nothing here can pay or claim it');
await p.click('#req-x');
await p.evaluate(() => { location.hash = 'proof=base:0x' + 'cd'.repeat(32) + ':0:ab'; });
await p.waitForSelector('#req:not([hidden])');
ok(/payment proof made on tacit\.finance/.test(await p.textContent('#req-body')), 'so is a payment-proof link');
await p.click('#req-x');
await p.click('#tabs [data-tab="send"]');
await p.click('[data-route="wallet"]');
await p.fill('#f-to', 'friend.wei'); await p.fill('#f-amt', '0.1');
await p.waitForFunction(() => /friend\.wei · tacit1/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 20e3});
ok(true, 'Send takes a name too, and shows who it resolved to');
await p.fill('#f-to', 'blank.wei'); await p.fill('#f-amt', '0.1');
await p.waitForFunction(() => /has not published/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 20e3});
ok(true, 'a short name that cannot be paid says why, instead of leaving the button dead');
await p.click('#tabs [data-tab="withdraw"]');
await p.fill('#f-wamt', '0.1');
await p.fill('#f-wto', '0x52fc37ee7741468a15ce879320a7a41CEBaeb232');
await p.waitForFunction(() => /typo/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 10e3}).catch(() => {});
ok(/typo/.test(await p.textContent('#f-rcpt')), 'a mixed-case address whose capitals do not match its checksum is refused');
await p.fill('#f-wto', '0x52fc37ee7741468a15CE879320a7a41CEBaeb232');
await p.waitForTimeout(200);
ok(!/typo/.test(await p.textContent('#f-rcpt')), 'the same address with its right checksum is not');
await p.fill('#f-wto', '0x52fc37ee7741468a15ce879320a7a41cebaeb232');
await p.waitForTimeout(200);
ok(!/typo/.test(await p.textContent('#f-rcpt')), 'and one typed in a single case, as wallets often give it, is taken as typed');
const store = await p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /^tacit-pay-/.test(k))));
const plain = Object.keys(store).filter((k) => /seen|times|boxes|name-v1|last-v1/.test(k) && !/vault/.test(k));
ok(!plain.length && Object.entries(store).filter(([k]) => /vault/.test(k)).every(([, v]) => v.startsWith('enc1:')), 'what the page remembers about the key is stored as ciphertext only', plain.join());
await p.click('#tabs [data-tab="receive"]');
await p.evaluate(() => { const d = document.querySelector('#f-ropts'); if (d) d.open = true; });
await p.fill('#f-rname', 'ross.wei');
await p.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 20e3});
ok(/#pay=ross\.wei/.test(await p.textContent('#f-rlink')), 'a name that points at this key goes into the payment link');
await p.click('#tabs [data-tab="send"]'); await p.click('#tabs [data-tab="receive"]');
ok(/points to this address/.test(await p.textContent('#f-rname-note')) && /#pay=ross\.wei/.test(await p.textContent('#f-rlink')), 'and drawing the form again keeps the name in the link, with no second reading');
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
ok(/#pay=ross\.wei&n=[0-9a-f]{64}&ns=[0-9a-f]{128}&amount=0\.5&chain=base&for=rent$/.test(link), 'the link carries the name, a signed deposit address, amount, chain and note', link);
await p.click('#f-rchains [data-rs="any"]');
ok(!/chain=/.test(await p.textContent('#f-rlink')), 'and offers every chain unless one is picked');
ok(await p.isVisible('#f-qr svg'), 'with a QR code of it');
await shot('receive');

console.log('links that ask for a token');
const TOKC = getAddress(TOKEN), BADSUM = PAYEE.replace('C1D6', 'c1D6');
const closeReq = async () => { if (await p.$('#req-x')) await p.click('#req-x'); await p.waitForSelector('#req', {state: 'hidden', timeout: 10e3}).catch(() => {}); };
for (const [hash, why, says] of [
  [`pay=${PAYEE}&token=usdc&chain=base`, /names its token in a way this page does not read/, 'a token named any way but by its address'],
  [`pay=${PAYEE}&token=${'0x' + '00'.repeat(20)}&chain=base`, /names its token/, 'the zero address as its token'],
  [`pay=${PAYEE}&token=${TOKEN}&chain=base&n=12`, /has parts this page does not read/, 'a field a token link does not have'],
  [`pay=${PAYEE}&token=${TOKEN}&token=${TOKEN}&chain=base`, /has parts this page does not read/, 'a field given twice'],
  [`pay=${PAYEE}&token=${TOKEN}&amount=5`, /does not say which chain/, 'no chain'],
  [`pay=${TACIT1}&token=${TOKEN}&chain=base`, /Tacit address, which takes only private ETH/, 'a Tacit address as where it arrives'],
  [`pay=${BADSUM}&token=${TOKEN}&chain=base`, /does not name an address this page reads/, 'an address whose capitals do not match its checksum'],
  [`pay=${PAYEE}&token=${TOKEN}&chain=base&amount=1e3`, /amount is not one this page reads/, 'an amount with an exponent'],
  [`pay=${PAYEE}&token=${TOKEN}&chain=base&amount=-1`, /amount is not one this page reads/, 'a negative amount'],
  [`pay=${PAYEE}&token=${TOKEN}&chain=base&amount=1.1234567`, /not one TUSD can be paid in/, 'more decimals than the token has'],
  [`pay=${PAYEE}&token=${TOKEN}&chain=base&amount=0`, /not one TUSD can be paid in/, 'an amount of nothing'],
  [`pay=${PAYEE}&token=${'0x' + '7b'.repeat(20)}&chain=base`, /is not a token on Base/, 'an address that is not a token there'],
]) { const t = await card(hash); ok(why.test(t) && !(await p.$('#req-pay')), `refused with a plain sentence: ${says}`, t.slice(0, 140)); }
let tk = await card(`pay=bob.wei&token=${TOKEN}&amount=12.5&chain=base&for=invoice`);
ok(/bob\.wei/.test(tk) && tk.includes(PAYEE) && /12\.5 TUSD/.test(tk) && /on Base/.test(tk) && /“invoice”/.test(tk), 'a token link shows whom it pays, in full, the amount in the token, the chain and the note', tk.slice(0, 160));
ok(tk.includes(TOKC) && /TUSD · Test USD/.test(tk), 'and the token by its full address, with the symbol and name its contract reports');
ok(/not on the token list/.test(tk) && await p.$eval('#req-pay', (b) => b.disabled), 'a token the list does not hold is confirmed before it can be paid');
await p.click('#req-tokok');
ok(await p.$eval('#req-pay', (b) => !b.disabled && /Pay from my private balance/.test(b.textContent)), 'then it is paid from the private balance');
await p.click('#req-pay');
await p.waitForSelector('#f-wamt');
ok((await p.inputValue('#f-wto')) === 'bob.wei' && (await p.inputValue('#f-wamt')) === '12.5' && /TUSD/.test(await p.textContent('#f-tok')) && await p.$eval('#form [data-unit="tok"]', (b) => b.getAttribute('aria-selected') === 'true'), 'which opens Withdraw as a swap into the token, to the name, for the amount, in the token');
ok(/Amount to arrive, at least/.test(await p.textContent('#form')), 'the amount reading as the least that arrives');
await p.fill('#f-wamt', '1.1234567');
ok(await p.waitForFunction(() => /TUSD has 6 decimals/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, {timeout: 10e3}).then(() => true, () => false), 'an amount past the token’s decimals is refused there too, not rounded');
await p.click('#form [data-unit="eth"]');
ok(/Amount of ETH to swap/.test(await p.textContent('#form')) && !(await p.inputValue('#f-wamt')), 'and the ETH unit takes back an amount in ETH');
await closeReq();
await p.click('#tabs [data-tab="receive"]');
await p.evaluate(() => { const d = document.querySelector('#f-ropts'); if (d) d.open = true; });
await p.click('#f-tok3');
await p.fill('#f-toksq3', TOKEN);
await p.waitForSelector(`#f-tokl3 [data-tk="${TOKC}"]`, {timeout: 20e3});
await p.click(`#f-tokl3 [data-tk="${TOKC}"]`);
await p.waitForSelector('#f-rto');
ok(!(await p.$('#f-rname')) && !(await p.$('#f-rchains')) && /names one chain/.test(await p.textContent('#form')), 'asking for a token, the link names where it arrives, on the chain chosen at the top');
await p.fill('#f-rto', TACIT1);
ok(/Tacit address/.test(await p.textContent('#f-rto-note')) && !(await p.textContent('#f-rlink')), 'a Tacit address is not where a token arrives');
await p.fill('#f-rto', PAYEE); await p.fill('#f-ramt', '1.1234567');
ok(!(await p.isHidden('#f-rerr')) && /up to 6 decimals/.test(await p.textContent('#f-rerr')) && !(await p.textContent('#f-rlink')), 'nor is an amount past the token’s decimals');
await p.fill('#f-ramt', '12.5'); await p.fill('#f-rfor', 'invoice');
await p.waitForFunction(() => /token=/.test(document.querySelector('#f-rlink')?.textContent || ''), null, {timeout: 10e3}).catch(() => {});
const tlink = await p.textContent('#f-rlink');
ok(new RegExp(`#pay=${PAYEE}&token=${TOKC}&amount=12\\.5&chain=[a-z]+&for=invoice$`).test(tlink), 'the link carries the address, the token, the amount in the token, one chain and the note', tlink);
await p.fill('#f-rto', 'bob.wei');
ok(await p.waitForFunction((a) => document.querySelector('#f-rto-note')?.textContent.includes(a) && /#pay=bob\.wei&token=/.test(document.querySelector('#f-rlink')?.textContent || ''), PAYEE, {timeout: 20e3}).then(() => true, () => false), 'a name is shown with the address it points to, and goes into the link as the name');
tk = await card((await p.textContent('#f-rlink')).split('#')[1]);
ok(/bob\.wei/.test(tk) && /12\.5 TUSD/.test(tk) && !/not on the token list/.test(tk) && await p.$eval('#req-pay', (b) => !b.disabled), 'the link opens as the request it was made for; a token added before is not asked about again', tk.slice(0, 160));
await closeReq();
await p.click('#f-tok3');
await p.click('#f-tokl3 [data-tk=""]');
ok(!!(await p.$('#f-rname')) && /#pay=ross\.wei/.test(await p.textContent('#f-rlink')), 'and Private ETH puts the link back as it was');

console.log('an Ethereum wallet');
await p.click('#wallet'); await p.click('#w-lock'); await p.click('#sheet-wallet [data-close]');
await p.click('#form [data-in="eth"]');
await p.waitForFunction(() => /^tacit1/.test(document.querySelector('#wallet-label').textContent), null, {timeout: 30e3});
await p.click('#tabs [data-tab="receive"]');
ok((await p.textContent('#form .addr code')) === DEV_TACIT1, 'a wallet’s signature over the identity message opens the key every Tacit app derives');

console.log('the onchain registry of public nodes');
await p.waitForFunction(() => !!localStorage.getItem('tacit-pay-registry-v1'), null, {timeout: 20e3}).catch(() => {});
const reg = JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-registry-v1') || 'null'));
ok(!!reg && reg.rpc[1].includes('https://registry-eth.example') && reg.rpc[1].includes('https://registry-logs.example') && reg.rpc[8453][0] === 'https://registry-base.example' && reg.rpc[4663][0] === 'https://registry-rh.example', 'the registry’s lists are read at load, through the page’s own nodes, and kept', JSON.stringify(reg?.rpc));
ok(!reg.rpc[1].includes('http://insecure.example') && reg.rpc[1].filter((u) => u === 'https://ethereum-rpc.publicnode.com').length === 1, 'an http entry is dropped');
ok(!seen.has('registry-base.example'), 'while the page’s own nodes answer, the registry’s are not asked');
for (const h of ['mainnet.base.org', 'base.gateway.tenderly.co', 'base-rpc.publicnode.com', 'base.drpc.org']) DOWN.add(h);
await p.click('#chains [data-chain="8453"]');
await p.click('#bal-re');
await p.waitForFunction(() => /0 ETH|^0$/.test(document.querySelector('#bal .v')?.textContent || '') && !document.querySelector('#bal .err'), null, {timeout: 30e3}).catch(() => {});
ok(seen.has('registry-base.example') && !(await p.$('#bal .err')), 'with every one of the page’s Base nodes down, the balance is read through a node the registry listed', (await p.textContent('#bal')).replace(/\s+/g, ' ').slice(0, 100));
DOWN.clear();

console.log('endpoints');
await p.click('#settings-open');
await p.fill('#e-rpc-8453', 'https://example.org/rpc');
await p.fill('#e-rpc-1', 'https://own-eth.example/rpc');
await p.click('#e-save');
const saved = JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-endpoints-v1')));
ok(saved.rpc[8453][0] === 'https://example.org/rpc' && saved.rpc[1][0] === 'https://own-eth.example/rpc', 'a reader’s own node is saved, one field per chain');
const isName = ([, m, d]) => m === 'eth_call' && d.startsWith('0x59d1d43c');
let mark = CALLS.length;
t = await card('pay=mine.wei&amount=0.01');
let asked = CALLS.slice(mark).filter(isName).map(([h]) => h);
ok(t.includes('mine.wei') && t.includes(SHORT) && asked.length && asked.every((h) => h === 'own-eth.example'), 'with your own Ethereum node set, a name is read only through it', [...new Set(asked)].join(' '));
const closeCard = async () => { if (await p.$('#req-x')) await p.click('#req-x'); await p.waitForSelector('#req', {state: 'hidden', timeout: 10e3}).catch(() => {}); };
await closeCard();
NOLOGS.add('own-eth.example');
mark = CALLS.length;
await p.evaluate(() => document.querySelector('#rebuild')?.closest('details')?.setAttribute('open', ''));
await p.click('#rebuild');
await p.waitForFunction(() => !/Rebuilding|Reading/.test(document.querySelector('#activity')?.textContent || ''), null, {timeout: 60e3}).catch(() => {});
await p.waitForTimeout(1500);
const ETH_PUBLIC = /^(ethereum-rpc\.publicnode\.com|mainnet\.gateway\.tenderly\.co|eth\.drpc\.org|1rpc\.io|registry-eth\.example|registry-logs\.example)$/;
const later = CALLS.slice(mark), pub = later.filter(([h]) => ETH_PUBLIC.test(h));
ok(pub.length && pub.every(([, m]) => m === 'eth_getLogs') && later.some(([h, m]) => h === 'own-eth.example' && m === 'eth_call'), 'when your node does not serve the pool’s logs, only those are read through Ethereum’s public nodes; your deposit addresses and the rest stay with your node', [...new Set(pub.map(([h, m]) => `${h}:${m}`))].join(' '));
NOLOGS.clear();
DOWN.add('own-eth.example');
mark = CALLS.length;
t = await card('pay=later.wei&amount=0.01');
asked = CALLS.slice(mark).filter(isName).map(([h]) => h);
ok(!t.includes(SHORT) && /Your own node did not answer/.test(t) && asked.every((h) => h === 'own-eth.example'), 'but a name is never read through them: the page says your node did not answer', [...new Set(asked)].join(' ') + ' | ' + t.slice(0, 120));
DOWN.clear();
await closeCard();
await p.click('#settings-open');
await p.click('#e-reset');
ok(JSON.stringify(JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-endpoints-v1')))) === '{}', 'and the defaults come back');

console.log('a wallet that is connected but has not signed in');
{
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errors.push(String(e)));
  await q.goto(`http://127.0.0.1:${server.address().port}/`);
  await q.waitForFunction(() => /^Sign in · 0x/.test(document.querySelector('#wallet-label')?.textContent || ''), null, {timeout: 20e3}).then(() => ok(true, 'the header reads as an action with the wallet’s address: Sign in · 0x…'), () => ok(false, 'the header reads as an action with the wallet’s address', document.querySelector ? '' : ''));
  await q.click('#chains [data-chain="8453"]');
  await q.waitForFunction(() => /Switch wallet to Base/.test(document.querySelector('#f-max')?.textContent || ''), null, {timeout: 20e3}).then(() => ok(true, 'with the wallet on another chain, its balance is a button that says to switch'), () => ok(false, 'with the wallet on another chain, its balance is a button that says to switch'));
  await q.click('#f-max');
  await q.waitForFunction(() => /Wallet\s+0\.123\s+ETH/.test(document.querySelector('#f-max')?.textContent || ''), null, {timeout: 20e3}).then(() => ok(true, 'pressing it moves the wallet to Base and the balance shows'), () => ok(false, 'pressing it moves the wallet to Base and the balance shows'));
  await q.close();
}

const hosts = [...seen].filter((h) => !/^(ethereum-rpc\.publicnode\.com|(base|mainnet)\.gateway\.tenderly\.co|eth\.drpc\.org|1rpc\.io|mainnet\.base\.org|base-rpc\.publicnode\.com|base\.drpc\.org|rpc\.mainnet\.chain\.robinhood\.com|robinhood\.drpc\.org|tacit-evm-pool-keeper(-base|-robinhood)?\.onrender\.com|example\.org|own-eth\.example|registry-[a-z]+\.example|tacit\.finance|ipfs\.filebase\.io|ipfs\.orbitor\.dev|gateway\.pinata\.cloud|base-sepolia-rpc\.publicnode\.com|sepolia\.base\.org)$/.test(h));
ok(!hosts.length, 'it talks only to its listed nodes, relays, proving-key mirrors and the nodes of the key’s onchain copy', hosts.join(' '));
ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
