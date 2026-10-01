/* External Ethereum wallets against the real dapp/page.html, with the chain unplugged as in the page test: wallets
   that announce themselves (EIP-6963) and a bare window.ethereum, the picker and the wallet remembered from it, a
   refused or already-open request, the two signatures of a first sign-in and the one of a later visit, wallets that
   cannot hold a key, an account switch and a locked wallet, and a chain the wallet must switch to, or add, before
   anything is proved.

   Usage: node test/dapp/tacit-pay.wallets.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Signature} from 'ethers';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url));

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined && !cond ? '  ' + extra : ''));
  if (!cond) failures++;
};

// The first two development accounts, and the Tacit addresses their signatures open (as in the page test).
const ONE = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const TWO = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ONE_TACIT1 = 'tacit1qzzsx4pc3x9c8ym6q6mz53hkqa26lj4wsapknp474xxglk9r9dj0mu80q2g04y8gt2wgh3xdl6nmemkftsxeya0jcs2p8rjaed4htlfgqcmq5q5axtryqaknkkn47w5ruzd4t56hlrearwjjzhp92mpz7kfu9c2cpf3gxukgxnlm4rgewq5mmqfegdgdfxs0wurtavg8gjwlnzexpvptpkks9k72a9u74tkuns8y6x0gg490z3xd30xvpk6nvp8lpxar36qknkfaah';
const PAYEE = 'bp1q235w92ulr4p6t0jmfuqzj9l2cvr2m4qr69cw5aljvq6sgxfqq40wdx7tpeacup3lpgnegy9t4t3hfg0dzu6etxjk65qmts92d5n00c98g6cleva40sq8gz0kt500z5fjjv4tsap58ql4f4nhvhv7zmg7u4sp3v920';
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`.toLowerCase();
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const TIP = {base: 51864114, robinhood: 73991761, ethereum: 26069345};
const answer = (host, {method}) => {
  if (method === 'eth_blockNumber') return '0x' + TIP[/base/.test(host) ? 'base' : /robinhood/.test(host) ? 'robinhood' : 'ethereum'].toString(16);
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getBalance') return '0x' + (10n ** 18n).toString(16);
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_call') return '0x' + '00'.repeat(32);
  return null;
};
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

// A wallet in the page: answers like an extension, keeps a log, and can refuse, hang, sign differently or be a
// contract. `wallets` is a list of { name, rdns (announced over EIP-6963 when set), injected (window.ethereum),
// account, chain, known chains, addSwitches, code, sig, modes: { method: 'reject' | 'pending' | 'hang' } }.
const WALLET = `(() => {
  const cfg = window.__WALLETS;
  const log = window.__log = [];
  const says = window.__says = [];
  new MutationObserver(() => { for (const el of document.querySelectorAll('[data-say], #status')) { const t = el.textContent.trim(); if (t && says[says.length - 1] !== t) says.push(t); } })
    .observe(document, { subtree: true, childList: true, characterData: true });
  const err = (code, message) => Object.assign(new Error(message), { code });
  window.__wallets = cfg.map((w, i) => {
    const on = {}, st = { chain: w.chain || '0x1', known: new Set(w.known || ['0x1', '0x2105']), authorized: !!w.authorized || sessionStorage.getItem('auth' + i) === '1', signs: 0 };
    const p = {
      on(ev, f) { (on[ev] ||= []).push(f); }, removeListener(ev, f) { on[ev] = (on[ev] || []).filter((x) => x !== f); },
      emit(ev, v) { for (const f of on[ev] || []) f(v); },
      async request({ method, params = [] }) {
        log.push([i, method, params]);
        const mode = (w.modes || {})[method];
        if (mode === 'reject') throw err(4001, 'User rejected the request.');
        if (mode === 'pending') throw err(-32002, "Request of type 'wallet_requestPermissions' already pending for origin " + location.origin + '. Please wait.');
        if (mode === 'hang') return new Promise(() => {});
        if (method === 'eth_requestAccounts') { st.authorized = true; sessionStorage.setItem('auth' + i, '1'); return [w.account]; }
        if (method === 'eth_accounts') return st.authorized ? [w.account] : [];
        if (method === 'eth_chainId') return st.chain;
        if (method === 'wallet_switchEthereumChain') {
          const c = params[0].chainId;
          if (!st.known.has(c)) throw err(4902, 'Unrecognized chain ID "' + c + '". Try adding the chain using wallet_addEthereumChain first.');
          st.chain = c; p.emit('chainChanged', c); return null;
        }
        if (method === 'wallet_addEthereumChain') { st.known.add(params[0].chainId); window.__added = params[0]; if (w.addSwitches !== false) { st.chain = params[0].chainId; p.emit('chainChanged', st.chain); } return null; }
        if (method === 'eth_getCode') return w.code || '0x';
        if (method === 'personal_sign') return window.__sign(i, params[0], ++st.signs, w.sig || 'ok');
        if (method === 'eth_sendTransaction') { window.__sent = params[0]; return '0x' + 'ab'.repeat(32); }
        throw err(4200, 'not in this test: ' + method);
      },
    };
    if (w.injected) window.ethereum = p;
    if (w.rdns) {
      const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), name: w.name, icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: w.rdns }, provider: p });
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    }
    return p;
  });
})();`;

async function open(wallets) {
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST' && !/onrender\.com$/.test(url.host)) {
      const body = JSON.parse(req.postData() || '{}');
      const reply = (b) => ({jsonrpc: '2.0', id: b.id, result: answer(url.host, b)});
      return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
    }
    return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
  });
  if (!ctx.__ready) {
    ctx.__ready = true;
    await ctx.exposeFunction('__sign', async (i, hex, n, mode) => {
      const who = [ONE, TWO][i % 2], sig = Signature.from(await who.signMessage(Buffer.from(hex.slice(2), 'hex')));
      if (mode === 'smart') return '0x' + 'cd'.repeat(200);
      // The same signature's twin, (r, n - s) with the other recovery byte: valid, but not the bytes signed first.
      if (mode === 'drift' && n % 2 === 0) return sig.r + (N - BigInt(sig.s)).toString(16).padStart(64, '0') + (sig.v === 27 ? '1c' : '1b');
      if (mode === 'v01') return sig.serialized.slice(0, 130) + (sig.v - 27).toString(16).padStart(2, '0');
      return sig.serialized;
    });
    await ctx.addInitScript(`window.__WALLETS = ${JSON.stringify(wallets)};`);
    await ctx.addInitScript(WALLET);
  }
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(URL_);
  await p.waitForTimeout(300);
  return p;
}
// SHOTS=<dir> saves pictures of the screens below, at a phone's width and a laptop's.
const shot = async (p, name) => {
  if (!process.env.SHOTS) return;
  for (const [tag, w, h] of [['phone', 390, 800], ['laptop', 1100, 800]]) { await p.setViewportSize({width: w, height: h}); await p.waitForTimeout(150); await p.screenshot({path: `${process.env.SHOTS}/${name}-${tag}.png`}); }
};
const log = (p) => p.evaluate(() => window.__log.map(([i, m]) => `${i}:${m}`));
const says = (p) => p.evaluate(() => window.__says.join(' ¶ '));
const label = (p) => p.textContent('#wallet-label');
const bad = (p) => p.$$eval('#toasts .toast.bad', (x) => x.map((e) => e.textContent));
const signInFromHeader = async (p) => { await p.click('#wallet'); await p.click('#sheet-wallet [data-in="eth"]'); };
const until = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
const opened = (p) => until(p, () => /^tacit1/.test(document.querySelector('#wallet-label').textContent));
const settled = (p) => until(p, () => !document.querySelector('[data-in="eth"][aria-busy="true"]'));
const sayText = (p) => p.$eval('#sheet-wallet [data-say]', (e) => e.textContent.trim()).catch(() => '');

const ALPHA = {name: 'Alpha', rdns: 'test.alpha', account: ONE.address.toLowerCase()};
const BETA = {name: 'Beta', rdns: 'test.beta', account: TWO.address.toLowerCase()};

console.log('one wallet: a first sign-in, then a later visit');
{
  const p = await open([ALPHA]);
  ok(await label(p) === 'Open wallet', 'nothing is asked of the wallet on arrival', (await log(p)).join());
  await signInFromHeader(p);
  ok(await opened(p), 'the wallet opens the key');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 2, 'a first sign-in asks for the signature twice', (await log(p)).join());
  ok(/once more|again/i.test(await says(p)), 'and says why it asks again', await says(p));
  ok(!(await p.$('#sheet-wallet[open]')), 'the sheet closes on the open key');
  await p.click('#tabs [data-tab="receive"]');
  ok(await p.textContent('#form .addr code') === ONE_TACIT1, 'it is the key every Tacit app derives for that account');
  await p.reload(); await p.waitForTimeout(400);
  ok(await label(p) === short(ALPHA.account), 'a later visit shows the connected account without asking', `${await label(p)} ${(await log(p)).join()}`);
  ok(!(await log(p)).includes('0:eth_requestAccounts'), 'by asking what is already connected, not by requesting', (await log(p)).join());
  await p.click('#wallet');
  ok(new RegExp(`Continue with ${short(ALPHA.account).replace('…', '.')}`, 'i').test(await p.textContent('#sheet-wallet [data-in="eth"]')), 'and offers to continue with that account');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'which opens the key');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 1, 'with one signature', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('two wallets: the picker, and the wallet chosen there');
{
  const p = await open([ALPHA, BETA]);
  await signInFromHeader(p);
  ok(await until(p, () => document.querySelector('#sheet-pick')?.open), 'two wallets bring up the picker');
  await shot(p, 'picker');
  ok((await p.$$eval('#pick-body button', (b) => b.map((x) => x.textContent.trim()))).join() === 'Alpha,Beta', 'listing each by name');
  await p.keyboard.press('Escape');
  ok(await settled(p), 'closing it puts the button back');
  ok(!(await bad(p)).length, 'without an error', (await bad(p)).join());
  ok(!/no .*wallet/i.test(await sayText(p)), 'and without claiming there is no wallet', await sayText(p));
  await p.click('#sheet-wallet [data-in="eth"]');
  await until(p, () => document.querySelector('#sheet-pick')?.open);
  await p.click('#pick-body button:has-text("Beta")');
  ok(await opened(p), 'the chosen wallet opens the key');
  ok((await log(p)).every((x) => !/^0:(eth_requestAccounts|personal_sign)/.test(x)), 'the other is not asked', (await log(p)).join());
  await p.click('#wallet');
  await shot(p, 'sheet');
  ok(/Beta/.test(await p.textContent('#sheet-wallet')) && (await p.textContent('#sheet-wallet')).toLowerCase().includes(short(BETA.account)), 'the sheet names the wallet and account that pay gas', await p.textContent('#sheet-wallet'));
  await p.click('#sheet-wallet [data-close]');
  await p.reload(); await p.waitForTimeout(400);
  ok(await label(p) === short(BETA.account), 'a later visit comes back to the wallet chosen', `${await label(p)} ${(await log(p)).join()}`);
  await p.click('#wallet'); await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'and signs in with it');
  ok(!(await p.$('#sheet-pick[open]')) && (await log(p)).every((x) => !/^0:/.test(x)), 'without the picker', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('a wallet that refuses, or is busy');
for (const [modes, want, what] of [
  [{eth_requestAccounts: 'reject'}, /cancel/i, 'a refused connection'],
  [{personal_sign: 'reject'}, /cancel/i, 'a refused signature'],
  [{eth_requestAccounts: 'pending'}, /already has a request open/i, 'a request already open in the wallet'],
]) {
  const p = await open([{...ALPHA, modes}]);
  await signInFromHeader(p);
  ok(await settled(p), `${what}: the button comes back`);
  if (what === 'a request already open in the wallet') await shot(p, 'pending');
  ok(want.test(await sayText(p)), `${what}: says so where it was asked`, await sayText(p));
  ok(!(await bad(p)).length, `${what}: no alarm`, (await bad(p)).join());
  ok(await label(p) !== '' && !/^tacit1/.test(await label(p)), `${what}: nothing opened`);
  await p.context().close();
}

console.log('wallets that cannot hold a key, and one that can');
for (const [w, want, what] of [
  [{...ALPHA, code: '0x6080604052'}, /smart-contract/i, 'an account with code'],
  [{...ALPHA, sig: 'smart'}, /smart-contract/i, 'a contract signature'],
  [{...ALPHA, sig: 'drift'}, /differently/i, 'a wallet that signs differently each time'],
]) {
  const p = await open([w]);
  await signInFromHeader(p);
  ok(await settled(p), `${what}: the button comes back`);
  ok(want.test(await sayText(p)), `${what}: is refused, and told why`, await sayText(p));
  ok(!/^tacit1/.test(await label(p)), `${what}: nothing opened`);
  await p.context().close();
}
{
  const p = await open([{...ALPHA, sig: 'v01'}]);
  await signInFromHeader(p);
  ok(await opened(p), 'a hardware wallet’s 0/1 recovery byte opens the same key');
  await p.click('#tabs [data-tab="receive"]');
  ok(await p.textContent('#form .addr code') === ONE_TACIT1, 'byte for byte');
  await p.context().close();
}

console.log('a bare window.ethereum, and none at all');
{
  const p = await open([{name: 'Old', injected: true, account: ALPHA.account}]);
  await signInFromHeader(p);
  ok(await opened(p), 'a wallet that only sets window.ethereum opens the key');
  await p.context().close();
}
{
  const p = await open([]);
  await p.click('#wallet');
  await shot(p, 'nowallet');
  ok(/no ethereum wallet/i.test(await p.textContent('#sheet-wallet')), 'with no wallet, the sheet says so before anything is pressed', await p.textContent('#sheet-wallet'));
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await settled(p), 'pressing it anyway');
  ok(/wallet app|extension/i.test(await sayText(p)), 'says where a wallet can be found', await sayText(p));
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('a picker closed mid-payment');
{
  const p = await open([ALPHA, BETA]);
  await p.evaluate((a) => { location.hash = `pay=${a}&amount=0.01&chain=base`; }, PAYEE);
  await p.waitForSelector('#req:not([hidden])');
  await p.click('#req-wallet');
  ok(await until(p, () => document.querySelector('#sheet-pick')?.open), 'paying a link from a wallet asks which wallet');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok(await until(p, () => !document.querySelector('#req-wallet')?.disabled), 'closing the picker gives the button back');
  ok((await p.textContent('#status')).trim() === '' && !(await bad(p)).length, 'and says nothing', `${await p.textContent('#status')} ${(await bad(p)).join()}`);
  await p.click('#req-wallet');
  await until(p, () => document.querySelector('#sheet-pick')?.open);
  await p.click('#pick-body button:has-text("Alpha")');
  await until(p, () => /Proving|proving key/i.test(document.querySelector('#status').textContent), null, 30e3);
  ok((await log(p)).includes('0:eth_requestAccounts') && !(await log(p)).includes('1:eth_requestAccounts'), 'the wallet chosen is connected, and only it', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('the wallet changes under the page');
{
  const p = await open([ALPHA]);
  await signInFromHeader(p);
  await opened(p);
  await p.evaluate(() => window.__wallets[0].emit('accountsChanged', []));
  await p.waitForTimeout(200);
  ok(/^tacit1/.test(await label(p)), 'a locked wallet leaves the key open');
  await p.click('#wallet');
  ok(/connect a wallet/i.test(await p.textContent('#sheet-wallet')), 'and asks for a wallet to pay gas again', await p.textContent('#sheet-wallet'));
  await p.click('#sheet-wallet [data-close]');
  await p.evaluate((a) => window.__wallets[0].emit('accountsChanged', [a]), TWO.address);
  await p.waitForTimeout(200);
  ok(!/^tacit1/.test(await label(p)), 'another account locks the key the first one opened');
  ok(/switched accounts/i.test((await p.$$eval('#toasts .toast', (x) => x.map((e) => e.textContent))).join()), 'and says why');
  await p.context().close();
}

console.log('the chain, before anything is proved');
{
  // The wallet is on Ethereum and has never seen Robinhood Chain; it adds it without switching to it.
  const p = await open([{...ALPHA, known: ['0x1', '0x2105'], addSwitches: false}]);
  await p.click('#chains [data-chain="4663"]');
  await p.click('#tabs [data-tab="shield"]');
  await p.click('#f-go');
  await until(p, () => /Wallet/.test(document.querySelector('#f-max')?.textContent || ''));
  await p.fill('#f-samt', '0.01'); await p.fill('#f-sto', PAYEE);
  await p.click('#f-go');
  await until(p, () => /could not be fetched|proving key/i.test(document.querySelector('#status').textContent), null, 30e3);
  const l = await log(p), sw = l.indexOf('0:wallet_switchEthereumChain'), add = l.indexOf('0:wallet_addEthereumChain');
  ok(sw >= 0 && add > sw && l.lastIndexOf('0:wallet_switchEthereumChain') > add, 'the wallet is switched, the chain added, and switched to', l.join());
  ok(await p.evaluate(() => window.__added?.chainName === 'Robinhood Chain' && window.__added?.nativeCurrency?.symbol === 'ETH' && /^https:\/\//.test(window.__added?.rpcUrls?.[0])), 'with the chain’s name, currency and a node');
  const s = await says(p);
  ok(s.indexOf('Robinhood Chain') >= 0 && (s.search(/proving|proving key/i) < 0 || s.indexOf('Robinhood Chain') < s.search(/proving|proving key/i)), 'all before the proof is started', s);
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
