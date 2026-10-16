/* A wallet app joined by WalletConnect, against the deployed page, with the official SDK as the wallet and a relay in memory
   (wc-relay-mock.mjs): the pairing sheet and the code it shows, the wallet's approval, a first sign-in (two signatures) and a
   later one (one), reads answered by the page's own nodes and not by the wallet, a payment and a chain switch reaching the
   wallet on the right chain, a chain the wallet did not approve, the wallet's events, a wallet that refuses or ends the
   connection, a page that ends it, a relay that drops while the wallet is deciding, and a reload that picks the session up.
   LIVE=1 runs the first of these against WalletConnect's own relay with the page as deployed.

   Usage: node test/dapp/tacit-pay.walletconnect.mjs   (PAGE=<built page>, PLAYWRIGHT=<path to playwright-core>,
                                                         WC_SDK=<package.json of a folder with @walletconnect/sign-client and ws>) */
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Wallet} from 'ethers';
import {html as HTML} from './page-config.mjs';
import {startRelay} from './wc-relay-mock.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const SC = createRequire(process.env.WC_SDK || '/Users/z/tacit-wallet/build/package.json')('@walletconnect/sign-client');
const SignClient = SC.default?.init ? SC.default : SC.SignClient || SC;
const LIVE = !!process.env.LIVE;
process.chdir(fs.mkdtempSync('/tmp/tacit-pay-wc-'));       // the SDK keeps its state in the working folder

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined && !cond ? '  ' + extra : ''));
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONE = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const TWO = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ONE_TACIT1 = /ONE_TACIT1 = '(tacit1[^']+)'/.exec(fs.readFileSync(new URL('./tacit-pay.wallets.mjs', import.meta.url), 'utf8'))[1];
const OFFICIAL = 'wss://relay.walletconnect.org';
const PROJECT = /WC_PROJECT\s*=\s*'([0-9a-f]{32})'/.exec(String(HTML))[1];

// The page as served: its relay is the in-memory one, its module hash in the content policy follows, and the wallet it
// binds is kept where the test can reach it.
function served(relayUrl) {
  let page = String(HTML);
  if (LIVE) return page;
  const m = /<script type="module">([\s\S]*?)<\/script>/.exec(page);
  const mod = m[1].replaceAll(OFFICIAL, relayUrl).replace(/function bind\(w,\s*a\)\s*\{/, (head) => head + 'window.__bound=w;');
  if (mod === m[1]) throw new Error('the page does not carry the relay or the bind function');
  const hash = crypto.createHash('sha256').update(mod).digest('base64');
  return page.replace(m[1], () => mod).replace(/script-src 'sha256-[^']+'/, `script-src 'sha256-${hash}'`).replaceAll(OFFICIAL, relayUrl);
}

const TIP = {base: 51864114, robinhood: 73991761, ethereum: 26069345};
const answer = (host, {method}) => {
  if (method === 'eth_blockNumber') return '0x' + TIP[/base/.test(host) ? 'base' : /robinhood/.test(host) ? 'robinhood' : 'ethereum'].toString(16);
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getBalance') return '0x' + (10n ** 18n).toString(16);
  if (method === 'eth_getCode') return '0x';
  if (method === 'eth_call') return '0x' + '00'.repeat(32);
  return null;
};
const browser = await chromium.launch();
const relay = LIVE ? null : await startRelay();

// SHOTS=<dir> saves pictures of the sheets below, at a phone's width and a laptop's.
const shot = async (p, name) => {
  if (!process.env.SHOTS) return;
  for (const [tag, w, h] of [['phone', 390, 800], ['laptop', 1100, 800]]) { await p.setViewportSize({width: w, height: h}); await p.waitForTimeout(150); await p.screenshot({path: `${process.env.SHOTS}/${name}-${tag}.png`}); }
};
async function openPage({touch = false} = {}) {
  const html = served(relay?.url);
  const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(html); }).listen(0);
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write'], ...(touch ? {hasTouch: true, isMobile: true, viewport: {width: 390, height: 800}} : {})});
  const nodes = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST' && !/onrender\.com$/.test(url.host)) {
      const body = JSON.parse(req.postData() || '{}'), reply = (b) => { nodes.push(`${url.host} ${b.method}`); return {jsonrpc: '2.0', id: b.id, result: answer(url.host, b)}; };
      return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
    }
    return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
  });
  const p = await ctx.newPage();
  p.errors = []; p.nodes = nodes; p.origin = `http://127.0.0.1:${server.address().port}`;
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  p.shut = async () => { await ctx.close(); server.close(); };
  await p.goto(p.origin + '/');
  await p.waitForTimeout(300);
  return p;
}

// The wallet: the SDK's own client (one for the whole run, as its core is one per process), approving what it is told to and
// answering what it is asked, with a log of both. `makeWallet` sets what the next pairing and requests are met with.
let sdk = null, now = null;
const SIGNS = ['personal_sign', 'eth_sendTransaction', 'eth_signTypedData_v4'];
async function makeWallet({account = ONE, chains = [1, 8453], methods = SIGNS, refuse = {}, delay = 0} = {}) {
  if (!sdk) {
    sdk = await SignClient.init({projectId: PROJECT, logger: process.env.DEBUG === '2' ? 'debug' : 'silent', ...(relay ? {relayUrl: relay.url} : {}), metadata: {name: 'Test Wallet', description: 'a wallet for the test', url: 'https://wallet.test', icons: [], redirect: {native: 'testwallet://'}}});
    sdk.on('session_proposal', async ({id, params}) => {
      const st = now, opt = params.optionalNamespaces?.eip155 || {methods: [], events: []};
      st.proposals.push(params);
      await sdk.approve({id, namespaces: {eip155: {chains: st.chains.map((c) => `eip155:${c}`), accounts: st.chains.map((c) => `eip155:${c}:${st.account.address}`), methods: opt.methods.filter((x) => st.methods.includes(x)), events: opt.events}}})
        .then((sess) => { st.session = sess; }, (e) => { st.approveError = String(e); });
    });
    sdk.on('session_request', async ({id, topic, params}) => {
      const st = now, {method, params: args} = params.request;
      st.requests.push({method, args, chainId: params.chainId});
      if (st.delay) await sleep(st.delay);
      const respond = (response) => sdk.respond({topic, response: {id, jsonrpc: '2.0', ...response}}).catch((e) => { if (process.env.DEBUG) console.log('respond failed', id, String(e)); });
      if (st.refuse[method]) return respond({error: {code: st.refuse[method], message: 'User rejected the request.'}});
      if (method === 'personal_sign') return respond({result: await st.account.signMessage(Buffer.from(args[0].slice(2), 'hex'))});
      if (method === 'eth_sendTransaction') return respond({result: '0x' + 'ab'.repeat(32)});
      return respond({error: {code: 5101, message: 'Unsupported method: ' + method}});
    });
    sdk.on('session_delete', () => { now.deleted++; });
    await sleep(1500);   // the SDK rebuilds its request queue a second after it starts, which would put back a request answered by then
  }
  return (now = {wallet: sdk, account, chains, methods, refuse, delay, proposals: [], requests: [], session: null, deleted: 0});
}

const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
const label = (p) => p.textContent('#wallet-label');
const opened = (p) => until(p, () => /^tacit1/.test(document.querySelector('#wallet-label').textContent));
const startSignIn = async (p) => { await p.click('#wallet'); await p.click('#sheet-wallet [data-in="eth"]'); };
const pairingUri = async (p) => {
  await p.waitForSelector('#sheet-wc[open] [data-wc-copy]', {timeout: 20000});
  await p.click('#sheet-wc [data-wc-copy]');
  return p.evaluate(() => navigator.clipboard.readText());
};
// → { p, w } with the page signed in (or only connected, with `key: false`) through a wallet that has paired
async function joined(opts = {}, {key = true} = {}) {
  const p = await openPage(), w = await makeWallet(opts);
  await startSignIn(p);
  await w.wallet.pair({uri: await pairingUri(p)});
  if (key) await opened(p); else await until(p, () => !document.querySelector('#sheet-wc[open]'));
  return {p, w};
}
const bound = (p, method, params = []) => p.evaluate(([m, a]) => window.__bound.provider.request({method: m, params: a}).then((r) => ({r}), (e) => ({code: e.code, message: e.message, wc: !!e.wc})), [method, params]);
const done = async ({p}) => { await p.shut(); };

console.log('pairing, and a first sign-in');
{
  const {p, w} = await joined();
  const prop = w.proposals[0];
  ok(prop?.proposer.metadata.name === 'anon.wei' && prop.proposer.metadata.url === p.origin, 'the proposal names this page and its origin', JSON.stringify(prop?.proposer.metadata));
  ok(JSON.stringify(prop.optionalNamespaces.eip155.chains) === '["eip155:1","eip155:8453","eip155:4663"]' && !Object.keys(prop.requiredNamespaces).length, 'it asks for Ethereum, Base and Robinhood Chain as optional, and requires nothing', JSON.stringify(prop.optionalNamespaces));
  ok(['personal_sign', 'eth_sendTransaction', 'eth_signTypedData_v4', 'wallet_sendCalls'].every((m) => prop.optionalNamespaces.eip155.methods.includes(m)), 'and for the methods the page uses');
  const sign = await opened(p);
  if (process.env.DEBUG && !sign) console.log('DEBUG', w.approveError, relay?.seen.map((x) => `${x.method}:${x.tag ?? ''}`).join(' '), '|', await p.evaluate(() => document.querySelector('#sheet-wallet [data-say]')?.textContent + ' / ' + document.querySelector('#toasts')?.textContent), p.errors);
  ok(sign, 'the wallet approves and the key opens');
  ok(w.requests.filter((r) => r.method === 'personal_sign').length === 2 && w.requests.every((r) => r.method === 'personal_sign'), 'a first sign-in asks the wallet for the signature twice, and for nothing else', w.requests.map((r) => r.method).join());
  ok(w.requests[0].chainId === 'eip155:8453' && w.requests[0].args[1].toLowerCase() === ONE.address.toLowerCase(), 'on the chain in view (Base), for the connected account', JSON.stringify([w.requests[0].chainId, w.requests[0].args[1]]));
  await p.click('#tabs [data-tab="receive"]');
  ok(await p.textContent('#form .addr code') === ONE_TACIT1, 'it is the key every Tacit app derives for that account');
  ok(p.nodes.some((n) => /eth_getCode/.test(n)), 'the account was checked for contract code by the page\'s own node');
  ok(!(await p.$('#sheet-wc[open]')), 'the pairing sheet is closed');
  ok(!LIVE ? relay.logins.length >= 2 && relay.logins.every((l) => l.ok && l.project === PROJECT) : true, 'the relay login is a token with a project id', JSON.stringify(relay?.logins));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  if (LIVE) { await done({p, w}); await browser.close(); console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`); process.exit(failures ? 1 : 0); }

  console.log('\na reload: the session is picked up, and a later sign-in asks once');
  const before = w.requests.length;
  await p.reload();
  await p.click('#wallet');
  ok(await until(p, () => /Continue with 0xf39f/i.test(document.querySelector('#sheet-wallet')?.textContent || '')), 'the wallet is connected again with no prompt', await p.textContent('#sheet-wallet').catch(() => ''));
  ok(!(await p.$('#sheet-wc[open]')) && w.proposals.length === 1, 'and no new pairing was made');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'it signs in');
  ok(w.requests.length - before === 1, 'with one signature', String(w.requests.length - before));

  console.log('\nreads, a payment and the chain');
  const asked = w.requests.length, seen = p.nodes.length;
  ok((await bound(p, 'eth_chainId')).r === '0x2105' && (await bound(p, 'eth_accounts')).r[0].toLowerCase() === ONE.address.toLowerCase(), 'the connection starts on the chain in view (Base), with the account');
  const bal = await bound(p, 'eth_getBalance', [ONE.address, 'latest']);
  ok(bal.r === '0x' + (10n ** 18n).toString(16) && p.nodes.length > seen && w.requests.length === asked, 'a balance is read from the page\'s own node, not asked of the wallet');
  await p.evaluate(() => { window.__changes = []; window.__bound.provider.on('chainChanged', (c) => window.__changes.push(c)); });
  ok((await bound(p, 'wallet_switchEthereumChain', [{chainId: '0x1'}])).r === null && (await bound(p, 'eth_chainId')).r === '0x1' && w.requests.length === asked, 'switching to Ethereum is answered by the page, with no request to the wallet');
  const hash = await bound(p, 'eth_sendTransaction', [{from: ONE.address, to: TWO.address, value: '0x10', chainId: '0x1'}]);
  const sent = w.requests.at(-1);
  ok(hash.r === '0x' + 'ab'.repeat(32) && sent.method === 'eth_sendTransaction' && sent.chainId === 'eip155:1' && sent.args[0].to === TWO.address && sent.args[0].value === '0x10', 'a payment reaches the wallet on Ethereum, with its fields', JSON.stringify(sent));
  const rh = await bound(p, 'wallet_switchEthereumChain', [{chainId: '0x1237'}]);
  ok(rh.code === 4902 && rh.wc && /Robinhood Chain/.test(rh.message) && /allow it/.test(rh.message), 'a chain the wallet did not approve is refused, saying what to do', JSON.stringify(rh));
  const add = await bound(p, 'wallet_addEthereumChain', [{chainId: '0x1237'}]);
  ok(add.code === 4200 && add.wc, 'a wallet cannot be asked to add a chain');
  const caps = await bound(p, 'wallet_getCapabilities', [ONE.address]);
  ok(caps.code === 4200 || caps.r === undefined, 'a method the wallet did not approve is not sent to it', JSON.stringify(caps));
  await w.wallet.emit({topic: w.session.topic, event: {name: 'chainChanged', data: 8453}, chainId: 'eip155:1'});
  ok(await until(p, () => window.__changes.includes('0x2105')) && (await bound(p, 'eth_chainId')).r === '0x2105', 'the wallet moving to Base is followed', JSON.stringify(await p.evaluate(() => window.__changes)));
  await w.wallet.emit({topic: w.session.topic, event: {name: 'chainChanged', data: 10}, chainId: 'eip155:1'});
  await sleep(500);
  ok((await bound(p, 'eth_chainId')).r === '0x2105', 'and moving to a chain the page does not use is not');
  await w.wallet.emit({topic: w.session.topic, event: {name: 'accountsChanged', data: [TWO.address]}, chainId: 'eip155:1'});
  ok(await until(p, () => /^Sign in/.test(document.querySelector('#wallet-label').textContent)) && /signed out/.test(await p.textContent('#toasts')), 'the wallet switching accounts signs the page out', await label(p));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));

  console.log('\nthe page ends the connection');
  await p.click('#wallet');
  await p.click('#sheet-wallet [data-in="switch"]');
  for (let i = 0; i < 40 && !w.deleted; i++) await sleep(250);
  ok(w.deleted === 1, 'the wallet is told the session is over');
  ok(await p.evaluate(() => sessionStorage.getItem('tacit-pay-wc-v1')) === null, 'and the page keeps nothing of it');
  await done({p, w});
}

console.log('\nthe wallet ends the connection');
{
  const {p, w} = await joined();
  await w.wallet.disconnect({topic: w.session.topic, reason: {code: 6000, message: 'User disconnected.'}});
  ok(await until(p, () => /ended the connection/.test(document.querySelector('#toasts')?.textContent || '')), 'the page says so');
  ok(await p.evaluate(() => sessionStorage.getItem('tacit-pay-wc-v1')) === null, 'and forgets the session');
  await p.click('#wallet');
  ok(!(await p.textContent('#sheet-wallet')).includes('Continue with'), 'the sign-in no longer names the account', (await p.textContent('#sheet-wallet')).slice(0, 80));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  await done({p, w});
}

console.log('\na wallet that refuses to sign');
{
  const {p, w} = await joined({refuse: {personal_sign: 5000}}, {key: false});
  ok(await until(p, () => /Cancelled in your wallet/.test(document.querySelector('#sheet-wallet [data-say]')?.textContent || '')), 'the wallet\'s refusal is shown where the page asked, as a cancel');
  ok(/^Sign in/.test(await label(p)) && !(await p.$('#sheet-wallet [data-say].err')), 'no key opens, and a refusal is not drawn as a fault', await p.evaluate(() => document.querySelector('#sheet-wallet [data-say]')?.className));
  w.refuse = {};
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'asking again, and approving, opens the key');
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  await done({p, w});
}

console.log('\na wallet that approves only Ethereum, while the page shows Base');
{
  const {p, w} = await joined({chains: [1]});
  ok(w.requests[0]?.chainId === 'eip155:1', 'the signatures are asked on Ethereum', w.requests[0]?.chainId);
  ok((await bound(p, 'eth_chainId')).r === '0x1', 'the connection is on Ethereum');
  const base = await bound(p, 'wallet_switchEthereumChain', [{chainId: '0x2105'}]);
  ok(base.code === 4902 && /Base/.test(base.message), 'and Base is refused by name', JSON.stringify(base));
  await done({p, w});
}

console.log('\na wallet that approves none of the three chains');
{
  const p = await openPage(), w = await makeWallet({chains: [10]});
  await startSignIn(p);
  await w.wallet.pair({uri: await pairingUri(p)});
  ok(await until(p, () => /approved none of Ethereum, Base or Robinhood Chain/.test(document.querySelector('#sheet-wallet [data-say]')?.textContent || '')), 'the page says what to allow');
  let ended = false;
  for (let i = 0; i < 40 && !(ended = w.deleted > 0); i++) await sleep(250);
  ok(ended, 'and ends the session at the wallet');
  ok(await p.evaluate(() => sessionStorage.getItem('tacit-pay-wc-v1')) === null, 'keeping nothing');
  await done({p, w});
}

console.log('\nthe sheet closed before a wallet pairs');
{
  const p = await openPage();
  await startSignIn(p);
  await p.waitForSelector('#sheet-wc[open] [data-wc-copy]', {timeout: 20000});
  ok(await p.$('#sheet-wc svg.qr') !== null, 'the sheet shows a QR code');
  await shot(p, 'pairing');
  await p.click('#sheet-wc [data-close]');
  await p.waitForTimeout(500);
  ok(!(await p.$('#sheet-wc[open]')) && !(await p.$('#sheet-wallet [data-say].err')) && /^Sign in/.test(await label(p)), 'closing it is a cancel, not an error', await p.evaluate(() => document.querySelector('#sheet-wallet [data-say]')?.textContent));
  const w = await makeWallet();
  await p.click('#sheet-wallet [data-in="eth"]');
  await w.wallet.pair({uri: await pairingUri(p)});
  ok(await opened(p), 'and pairing again, with a new code, works');
  await done({p, w});
}

console.log('\nthe pairing sheet on a phone');
{
  const p = await openPage({touch: true});
  await startSignIn(p);
  await p.waitForSelector('#sheet-wc[open] [data-wc-copy]', {timeout: 20000});
  ok(await p.$('#sheet-wc svg.qr') === null && (await p.$$('#sheet-wc .picker a')).length === 5, 'a phone is offered its wallet apps and the plain link, not a QR code to scan with itself', String((await p.$$('#sheet-wc .picker a')).length));
  ok((await p.$$eval('#sheet-wc .picker a', (as) => as.map((a) => a.getAttribute('href').split(':')[0]))).join() === 'metamask,trust,rainbow,cbwallet,wc', 'each is a link in its own scheme');
  await shot(p, 'pairing-touch');
  await p.shut();
}

console.log('\nthe relay drops while the wallet is deciding');
{
  const {p, w} = await joined();
  w.delay = 3500;
  await p.evaluate(() => { window.__tx = window.__bound.provider.request({method: 'eth_sendTransaction', params: [{from: window.__bound.provider.session.accounts[0].split(':')[2], to: '0x' + '22'.repeat(20), value: '0x1'}]}).then((r) => ({r}), (e) => ({e: e.message})); });
  await sleep(800);
  relay.drop();
  const r = await p.evaluate(() => Promise.race([window.__tx, new Promise((res) => setTimeout(() => res({e: 'no answer in 40 s'}), 40000))]));
  ok(r.r === '0x' + 'ab'.repeat(32), 'the page connects again and receives the answer the wallet sent meanwhile', JSON.stringify(r));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  await done({p, w});
}

console.log('\nthe connection is lost for good while the wallet is deciding');
{
  const {p, w} = await joined();
  const pay = (to, v) => p.evaluate(([t, x]) => window.__bound.provider.request({method: 'eth_sendTransaction', params: [{from: window.__bound.provider.session.accounts[0].split(':')[2], to: t, value: x}]}).then((r) => ({r}), (e) => ({code: e.code, asked: !!e.asked, message: e.message})), [to, v]);
  w.delay = 120000;
  await p.evaluate(() => { window.__lost = null; });
  const lost = p.evaluate(() => (window.__lost = window.__bound.provider.request({method: 'eth_sendTransaction', params: [{from: window.__bound.provider.session.accounts[0].split(':')[2], to: '0x' + '33'.repeat(20), value: '0x1'}]}).then((r) => ({r}), (e) => ({code: e.code, asked: !!e.asked, message: e.message}))));
  await sleep(800);
  relay.refuse = true; relay.drop();
  const r = await lost;
  ok(r.asked === true && r.code === undefined && /dropped/.test(r.message), 'the request fails as one the wallet may still act on, so the page holds its forms', JSON.stringify(r));
  relay.refuse = false;
  const next = await p.evaluate(() => window.__bound.provider.request({method: 'eth_chainId'}));
  ok(next === '0x2105', 'and asking the connection something local still answers', next);
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  w.delay = 0;
  await done({p, w});
}

console.log('\na reload while the wallet is deciding holds the forms');
{
  const {p, w} = await joined();
  w.delay = 4000;
  await p.evaluate(() => { window.__tx = window.__bound.provider.request({method: 'eth_sendTransaction', params: [{from: window.__bound.provider.session.accounts[0].split(':')[2], to: '0x' + '44'.repeat(20), value: '0x1', chainId: '0x2105'}]}).catch(() => {}); });
  await until(p, () => !!sessionStorage.getItem('tacit-pay-wc-pending-v1'), null, 5000);
  ok(await p.evaluate(() => JSON.parse(sessionStorage.getItem('tacit-pay-wc-pending-v1')).c) === 8453, 'a send is marked, with its chain, before it goes to the wallet');
  await p.reload();
  ok(await until(p, () => !!JSON.parse(sessionStorage.getItem('tacit-pay-sent-v1') || 'null')?.asked, null, 8000), 'a reload turns the mark into the held payment the page already knows');
  ok(await p.evaluate(() => sessionStorage.getItem('tacit-pay-wc-pending-v1')) === null && await p.evaluate(() => JSON.parse(sessionStorage.getItem('tacit-pay-sent-v1')).c) === 8453, 'once, on its chain');
  w.delay = 0;
  await sleep(5500);   // the wallet's one request is answered before the next scenario
  await done({p, w});
}

console.log('\na second request while the connection comes back');
{
  const {p, w} = await joined();
  w.delay = 3000;
  const pay = (to) => p.evaluate((t) => window.__bound.provider.request({method: 'eth_sendTransaction', params: [{from: window.__bound.provider.session.accounts[0].split(':')[2], to: t, value: '0x1', chainId: '0x2105'}]}).then((r) => ({r}), (e) => ({e: e.message, asked: !!e.asked})), to);
  const first = pay('0x' + '55'.repeat(20));
  await sleep(600);
  relay.drop();
  await sleep(300);
  const second = pay('0x' + '66'.repeat(20));
  const settle = (x) => Promise.race([x, sleep(45000).then(() => ({e: 'no answer'}))]);
  const [a, b] = await Promise.all([settle(first), settle(second)]);
  if (process.env.DEBUG) console.log('wallet saw', JSON.stringify(w.requests.slice(-3).map((r) => [r.method, r.chainId, r.args[0]?.to])), 'relay', relay.seen.slice(-14).map((x) => x.method + ':' + (x.tag ?? '')).join(' '));
  ok(a.r === '0x' + 'ab'.repeat(32) && b.r === '0x' + 'ab'.repeat(32), 'both are answered: the second does not take the first one\'s place', JSON.stringify([a, b]));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  w.delay = 0;
  await done({p, w});
}

console.log('\na payment is signed on the chain its body names');
{
  const {p, w} = await joined();
  const send = (chainId) => bound(p, 'eth_sendTransaction', [{from: ONE.address, to: TWO.address, value: '0x1', chainId}]);
  await bound(p, 'wallet_switchEthereumChain', [{chainId: '0x2105'}]);
  const r = await send('0x1');
  ok(r.r && w.requests.at(-1).chainId === 'eip155:1', 'a body for Ethereum goes out on Ethereum while the connection shows Base', w.requests.at(-1).chainId);
  const rh = await send('0x1237');
  ok(rh.code === 4902 && rh.wc, 'a chain the wallet did not approve is refused before anything is sent', JSON.stringify(rh));
  await done({p, w});
}

console.log('\na wallet that ended the session while the page was away');
{
  const {p, w} = await joined({}, {key: false});
  const origin = p.origin;
  await p.goto('about:blank');
  await w.wallet.disconnect({topic: w.session.topic, reason: {code: 6000, message: 'User disconnected.'}});
  await sleep(1200);
  await p.goto(origin + '/');
  await p.click('#wallet');
  ok(await until(p, () => !!document.querySelector('#sheet-wallet [data-in="eth"]')), 'the sheet is back');
  await sleep(1500);
  ok(!(await p.textContent('#sheet-wallet')).includes('Continue with'), 'it does not offer the account of a session that is over', (await p.textContent('#sheet-wallet')).slice(0, 90));
  ok(await p.evaluate(() => sessionStorage.getItem('tacit-pay-wc-v1')) === null, 'and keeps nothing of it');
  await done({p, w});
}

console.log('\nthe project ID can be set under Endpoints');
{
  const p = await openPage();
  await p.click('#settings-open');
  await p.fill('#e-wc', '0123456789abcdef0123456789abcdef');
  await p.click('#e-save');
  await p.waitForTimeout(300);
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('tacit-pay-endpoints-v1'))).wc === '0123456789abcdef0123456789abcdef', 'a 32-character ID is kept');
  await startSignIn(p);
  await p.waitForSelector('#sheet-wc[open] [data-wc-copy]', {timeout: 20000});
  ok(!relay || relay.logins.at(-1).project === '0123456789abcdef0123456789abcdef', 'and is what the relay is logged in with', relay?.logins.at(-1)?.project);
  await p.shut();
}

await browser.close(); await relay?.close();
console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
