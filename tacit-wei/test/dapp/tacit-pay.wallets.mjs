/* External Ethereum wallets against the deployed page, with the chain unplugged as in the page test: wallets
   that announce themselves (EIP-6963) and a bare window.ethereum, the picker and the wallet remembered from it, a
   refused or already-open request, the two signatures of a first sign-in and the one of a later visit, wallets that
   cannot hold a key, an account switch and a locked wallet, and a chain the wallet must switch to, or add, before
   anything is proved.

   Usage: node test/dapp/tacit-pay.wallets.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Signature} from 'ethers';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');

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
        // dropQuick: a popup still closing drops a signature request that comes within that many ms of the last answer
        // plan: what the wallet does with each signature request in turn ('reject', 'hang', 'slow' = answered after 16 s)
        if (method === 'personal_sign' && w.plan) {
          const k = w.plan[(st.calls = (st.calls || 0) + 1) - 1];
          if (k === 'reject') throw err(4001, 'User rejected the request.');
          if (k === 'hang') return new Promise(() => {});
          if (k === 'slow') await new Promise((r) => setTimeout(r, 16_000));
        }
        if (method === 'personal_sign') { if (w.dropQuick && Date.now() - (st.answered || 0) < w.dropQuick) return new Promise(() => {}); const r = await window.__sign(i, params[0], ++st.signs, w.sig || 'ok'); st.answered = Date.now(); return r; }
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
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write'], colorScheme: process.env.DARK ? 'dark' : 'light'});
  await ctx.addInitScript(`(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = g.call(this, k); return v == null && typeof k === 'string' && k.startsWith('tacit-wei-pq-later:') && !window.__pqAsk ? String(Date.now()) : v; }; })();`);   // the post-quantum offer is put off, as after "Not now" (a test sets window.__pqAsk to see it)
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
    // WalletConnect's relay is out of reach here: a socket that cannot open.
    await ctx.addInitScript(`window.WebSocket = class { constructor() { setTimeout(() => this.onerror && this.onerror(new Event('error')), 30); } close() {} send() {} };`);
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
  ok(await label(p) === 'Sign in', 'nothing is asked of the wallet on arrival', (await log(p)).join());
  await p.click('#wallet');
  await shot(p, 'signin-one-wallet');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'the wallet opens the key');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 2, 'a first sign-in asks for the signature twice', (await log(p)).join());
  ok(/once more|again/i.test(await says(p)), 'and says why it asks again', await says(p));
  ok(!(await p.$('#sheet-wallet[open]')), 'the sheet closes on the open key');
  await p.click('#tabs [data-tab="receive"]');
  ok(await p.textContent('#form .addr code') === ONE_TACIT1, 'it is the key every Tacit app derives for that account');
  await p.reload(); await p.waitForTimeout(400);
  ok(await label(p) === `Sign in · ${short(ALPHA.account)}`, 'a later visit shows the connected account, as a way to sign in, without asking', `${await label(p)} ${(await log(p)).join()}`);
  ok(!(await log(p)).includes('0:eth_requestAccounts'), 'by asking what is already connected, not by requesting', (await log(p)).join());
  await p.click('#wallet');
  ok(new RegExp(`Continue with ${short(ALPHA.account).replace('…', '.')}`, 'i').test(await p.textContent('#sheet-wallet [data-in="eth"]')), 'and offers to continue with that account');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'which opens the key');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 1, 'with one signature', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('stay signed in for this tab: kept only when asked, taken back only for the account that opened it');
{
  const REC = 'tacit-wei-stay-key-v1';
  const rec = (p) => p.evaluate((k) => sessionStorage.getItem(k), REC);
  const put = (p, o) => p.evaluate(([k, v]) => { const r = JSON.parse(sessionStorage.getItem(k)); sessionStorage.setItem(k, JSON.stringify({...r, ...v})); }, [REC, o]);
  const stayIn = async (p) => { await p.click('#wallet'); await p.check('#sheet-wallet [data-stay]'); await p.click('#sheet-wallet [data-in="eth"]'); return opened(p); };
  const signs = async (p) => (await log(p)).filter((x) => x === '0:personal_sign').length;
  const back = async (p) => { await p.reload(); await p.waitForTimeout(500); };

  // on: the key is kept in this tab, and a reload signs in with no signature
  let p = await open([ALPHA]);
  await p.click('#wallet');
  ok(!(await p.isChecked('#sheet-wallet [data-stay]')), 'the choice is off until it is made');
  await p.click('#sheet-wallet [data-close]');
  ok(await stayIn(p), 'turned on, a first sign-in opens the key');
  const r0 = JSON.parse(await rec(p)), who = await label(p);
  ok(/^[0-9a-f]{64}$/.test(r0.k) && r0.a === ALPHA.account && r0.t > 0, 'the key is kept in this tab\'s session storage, for its account', await rec(p));
  ok(!(await p.evaluate((k) => JSON.stringify({...localStorage}).includes(k), r0.k)), 'and not in the browser\'s plain storage');
  await back(p);
  ok(await opened(p) && await label(p) === who, 'a reload signs in again, to the same key', await label(p));
  ok((await signs(p)) === 0 && !(await log(p)).includes('0:eth_requestAccounts'), 'without asking the wallet to sign or to connect', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));

  // sign out: gone at once, and a reload is signed out
  await p.click('#wallet'); await p.click('#w-lock');
  ok(await rec(p) === null, 'signing out takes the key out of the tab');
  await back(p);
  ok(/^Sign in/.test(await label(p)), 'and a reload stays signed out', await label(p));
  await p.context().close();

  // turned off in the sheet: the key is dropped at once; the choice off keeps nothing
  p = await open([ALPHA]);
  ok(await stayIn(p) && (await rec(p)) !== null, 'on again, in a fresh tab');
  await p.click('#wallet'); await p.uncheck('#sheet-wallet [data-stay]');
  ok(await rec(p) === null, 'turning it off in the sheet drops the key at once');
  await back(p);
  ok(/^Sign in/.test(await label(p)), 'a reload is signed out', await label(p));
  await p.context().close();
  p = await open([ALPHA]);
  await signInFromHeader(p);
  ok(await opened(p) && await rec(p) === null, 'with the choice off nothing is kept');
  await p.context().close();

  // a record that is not the account's, not the key this browser opened, or too old, is not used
  for (const [what, o, again, gone] of [['another account\'s', {a: '0x' + '11'.repeat(20)}, 1], ['not this browser\'s key', {k: '22'.repeat(32)}, 1], ['older than 12 hours', {t: Date.now() - 13 * 3_600_000}, 1, true]]) {
    p = await open([ALPHA]);
    await stayIn(p);
    await put(p, o);
    await back(p);
    ok(/^Sign in/.test(await label(p)), `a record that is ${what}: a reload is not signed in`, await label(p));
    if (gone) ok(await rec(p) === null, `and a record that is ${what} is taken out of the tab by the reload, not left in it`, await rec(p));
    await p.click('#wallet'); await p.click('#sheet-wallet [data-in="eth"]');
    ok(await opened(p) && (await signs(p)) === again, `and signing in asks the wallet as usual (${again} signature)`, (await log(p)).join());
    ok(JSON.parse(await rec(p)).k === r0.k, 'and the right key is kept in the record\'s place');
    await p.context().close();
  }

  // the choice turned off elsewhere: a key this tab still holds goes with it, at once from another tab and at the next load
  p = await open([ALPHA]);
  await stayIn(p);
  await p.evaluate(() => localStorage.removeItem('tacit-wei-stay-v1'));      // as another tab turning it off (no event reaches this one)
  await back(p);
  ok(await rec(p) === null && /^Sign in/.test(await label(p)), 'with the choice off, a load takes out a key left in the tab', await rec(p));
  await p.context().close();
  p = await open([ALPHA]);
  await stayIn(p);
  const p2 = await p.context().newPage();
  p2.errors = [];
  p2.on('pageerror', (e) => p2.errors.push(String(e)));
  await p2.goto(URL_); await p2.waitForTimeout(300);
  ok(await stayIn(p2) && (await rec(p2)) !== null, 'a second tab of the same browser keeps a copy of its own');
  await p.click('#wallet'); await p.uncheck('#sheet-wallet [data-stay]');
  ok(await until(p2, (k) => sessionStorage.getItem(k) === null, REC), 'turning it off in the first tab takes the key out of the second at once');
  ok(await rec(p) === null && !p.errors.length && !p2.errors.length, 'and out of the first, with no page errors', [...p.errors, ...p2.errors].join(' | '));
  await p.context().close();

  // the wallet is not connected on the reload (locked): signing in again with the same account needs no signature
  p = await open([ALPHA]);
  await stayIn(p);
  await p.evaluate(() => sessionStorage.removeItem('auth0'));
  await back(p);
  ok(await label(p) === 'Sign in', 'a wallet that is not connected: the reload is not signed in', await label(p));
  await p.click('#wallet'); await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p) && (await signs(p)) === 0 && (await log(p)).includes('0:eth_requestAccounts'), 'connecting it again signs in with no signature', (await log(p)).join());
  await p.context().close();

  // a pasted key is kept the same way, and needs no wallet at all
  p = await open([ALPHA]);
  await p.click('#wallet'); await p.check('#sheet-wallet [data-stay]'); await p.click('#sheet-wallet [data-in="paste"]');
  await p.fill('#sheet-wallet .opts input', '11'.repeat(32)); await p.click('#sheet-wallet [data-in="key"]');
  ok(await opened(p) && JSON.parse(await rec(p)).a === null, 'a pasted key is kept, for no account');
  const pasted = await label(p);
  await back(p);
  ok(await label(p) === pasted, 'a reload signs in with it', await label(p));
  ok(!(await log(p)).some((x) => /personal_sign|eth_requestAccounts/.test(x)), 'with the wallet asked for nothing', (await log(p)).join());
  await p.context().close();
}

console.log('a button that says "Sign in" starts it: one press from the form, not two');
{
  const p = await open([ALPHA]);
  await p.click('#f-go');
  ok(await until(p, () => /^Sign in · /.test(document.querySelector('#wallet-label').textContent)), 'the wallet is connected and not signed in');
  await p.fill('#f-samt', '0.5');
  ok(await until(p, () => /Sign in to shield to yourself/.test(document.querySelector('#f-go')?.textContent || '')), 'the form says "Sign in to shield to yourself"');
  await p.click('#f-go');
  ok(await opened(p), 'the one press opens the key', (await log(p)).join());
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 2 && !(await p.$('#sheet-wallet[open]')), 'with the first sign-in\'s two signatures, and the sheet closed after', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('a second press while a sign-in waits takes over its line');
{
  const p = await open([{...ALPHA, modes: {personal_sign: 'hang'}}]);
  await signInFromHeader(p);
  ok(await until(p, () => /Sign “Tacit identity”/.test(document.querySelector('#sheet-wallet [data-say]')?.textContent || '')), 'the sheet says what the wallet is asked');
  await p.click('#sheet-wallet [data-close]');
  await p.click('#tabs [data-tab="send"]');
  await p.click('#g-in [data-in="eth"]');
  ok(await until(p, () => /Sign “Tacit identity”/.test(document.querySelector('#g-in [data-say]')?.textContent || ''), null, 4000), 'the button in the form shows the same line at once');
  ok(await until(p, () => !!document.querySelector('#g-in [data-unstick]'), null, 14_000), 'and the nudge with "Stop waiting" shows there too');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 1, 'the wallet was asked once', (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('a wallet whose popup drops a request that comes as the last one closes');
for (const [ms, how] of [[500, 'the pause between the two signatures'], [1500, '"Ask again"']]) {
  const p = await open([{...ALPHA, dropQuick: ms}]);
  await p.click('#wallet');
  await p.click('#sheet-wallet [data-in="eth"]');
  if (ms > 700) {
    ok(await until(p, () => !!document.querySelector('[data-reask]'), null, 25_000), `dropped within ${ms} ms: "Ask again" is offered`, await says(p));
    await p.click('[data-reask]');
  }
  ok(await opened(p), `the first sign-in still opens the key, through ${how}`, (await log(p)).join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('two wallets: the picker, and the wallet chosen there');
{
  const p = await open([ALPHA, BETA]);
  await signInFromHeader(p);
  ok(await until(p, () => document.querySelector('#sheet-pick')?.open), 'two wallets bring up the picker');
  await shot(p, 'picker');
  ok((await p.$$eval('#pick-body button', (b) => b.map((x) => x.textContent.trim().replace(/a wallet app$/, '')))).join() === 'Alpha,Beta,WalletConnect', 'listing each by name, and WalletConnect for a wallet app');
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
  ok(await label(p) === `Sign in · ${short(BETA.account)}`, 'a later visit comes back to the wallet chosen', `${await label(p)} ${(await log(p)).join()}`);
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
  if (w.sig === 'drift') {
    const n = (await log(p)).filter((x) => x === '0:personal_sign').length;
    await p.click('#sheet-wallet [data-in="eth"]');
    ok(await settled(p), 'pressed again: the button comes back');
    ok((await log(p)).filter((x) => x === '0:personal_sign').length === n && /differently/i.test(await sayText(p)), 'and the wallet is asked nothing more, with the same reason', `${n} → ${(await log(p)).join()}`);
  }
  await p.context().close();
}

console.log('the signatures of a first sign-in, as wallets answer them');
{
  // The first request is answered late (16 s), past the offer to ask again; the request asked again is one the wallet
  // only queued, and never answers: the first answer is the one taken.
  const p = await open([{...ALPHA, plan: ['slow', 'hang']}]);
  await signInFromHeader(p);
  ok(await until(p, () => !!document.querySelector('[data-reask]'), null, 20_000), 'a slow wallet: "Ask again" is offered after 15 s');
  await p.click('[data-reask]');
  ok(await until(p, () => /^tacit1/.test(document.querySelector('#wallet-label').textContent), null, 20_000), 'the first request, answered late, still opens the key', (await log(p)).join());
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 3, 'with the check asked once', (await log(p)).join());
  await p.context().close();
}
{
  const p = await open([{...ALPHA, plan: ['ok', 'reject']}]);
  await signInFromHeader(p);
  ok(await settled(p), 'the check refused: the button comes back');
  ok(!/^tacit1/.test(await label(p)), 'and nothing is opened yet');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'pressed again, the key opens');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 3, 'asking only for the check the second time', (await log(p)).join());
  await p.context().close();
}
{
  const p = await open([{...ALPHA, plan: ['reject']}]);
  await signInFromHeader(p);
  ok(await settled(p), 'the first signature refused: the button comes back');
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await opened(p), 'pressed again, the key opens');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 3, 'with the two signatures of a first sign-in', (await log(p)).join());
  await p.context().close();
}
{
  // Pressed twice, and the account announced again while the wallet asks: one sign-in, two signatures.
  const p = await open([ALPHA]);
  await p.click('#wallet');
  await p.click('#sheet-wallet [data-in="eth"]');
  await p.evaluate(() => { window.__wallets[0].emit('accountsChanged', [window.__WALLETS[0].account]); document.querySelector('#sheet-wallet [data-in="eth"]')?.click(); document.querySelector('#form [data-in="eth"]')?.click(); });
  ok(await opened(p), 'presses and events while it signs: the key opens');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 2, 'with two signatures, no more', (await log(p)).join());
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
  ok(/no wallet in this browser/i.test(await p.textContent('#sheet-wallet')), 'with no wallet, the sheet says so before anything is pressed', await p.textContent('#sheet-wallet'));
  await p.click('#sheet-wallet [data-in="eth"]');
  ok(await until(p, () => document.querySelector('#sheet-wc')?.open) || await settled(p), 'pressing it anyway opens the WalletConnect sheet (or says why it cannot)');
  ok(await until(p, () => !document.querySelector('#sheet-wc')?.open) && await settled(p), 'which closes when the relay cannot be reached');
  ok(/WalletConnect relay could not be reached/.test(await sayText(p)), 'and says so', await sayText(p));
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('a picker closed mid-payment');
{
  const p = await open([ALPHA, BETA]);
  await p.evaluate((a) => { location.hash = `pay=${a}&amount=0.01`; }, PAYEE);
  await p.waitForSelector('#req-pay');
  ok(/Connect a wallet to pay/.test(await p.textContent('#req-pay')), 'a link with no wallet connected asks for one');
  await p.click('#req-pay');
  ok(await until(p, () => document.querySelector('#sheet-pick')?.open), 'paying a link from a wallet asks which wallet');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok((await p.textContent('#req-status')).trim() === '' && !(await bad(p)).length, 'closing the picker says nothing', `${await p.textContent('#req-status')} ${(await bad(p)).join()}`);
  await p.click('#req-pay');
  await until(p, () => document.querySelector('#sheet-pick')?.open);
  await p.click('#pick-body button:has-text("Alpha")');
  ok(await until(p, () => /Pay 0\.01 ETH on Ethereum/.test(document.querySelector('#req-pay')?.textContent || '')), 'the wallet chosen is connected, and the button now names the payment');
  ok((await log(p)).includes('0:eth_requestAccounts') && !(await log(p)).includes('1:eth_requestAccounts'), 'only the wallet chosen was asked', (await log(p)).join());
  await shot(p, 'request');
  await p.click('#req-pay');
  await until(p, () => /Proving|proving key/i.test(document.querySelector('#req-status').textContent), null, 30e3);
  ok(/Proving|proving key/i.test(await p.textContent('#req-status')), 'pressing it shows its progress in the card', (await p.textContent('#req-status')).trim().slice(0, 80));
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
  ok(await label(p) === 'Sign in', 'a locked wallet signs out the key it opened', await label(p));
  ok(/locked/i.test((await p.$$eval('#toasts .toast', (x) => x.map((e) => e.textContent))).join()), 'and says why');
  await p.evaluate((a) => window.__wallets[0].emit('accountsChanged', [a]), ALPHA.account);
  await p.waitForTimeout(200);
  ok(await label(p) === `Sign in · ${short(ALPHA.account)}`, 'unlocked again, it offers the account to sign in with', await label(p));
  await signInFromHeader(p);
  ok(await opened(p), 'which opens the key again');
  ok((await log(p)).filter((x) => x === '0:personal_sign').length === 3, 'with one more signature', (await log(p)).join());
  await p.evaluate((a) => window.__wallets[0].emit('accountsChanged', [a]), TWO.address);
  await p.waitForTimeout(200);
  ok(!/^tacit1/.test(await label(p)), 'another account locks the key the first one opened');
  ok(/switched accounts/i.test((await p.$$eval('#toasts .toast', (x) => x.map((e) => e.textContent))).join()), 'and says why');
  await p.context().close();
}

console.log('the chain, before anything is proved');
{
  // The wallet is on another chain and has never seen Ethereum; it adds it without switching to it.
  const p = await open([{...ALPHA, chain: '0x2105', known: ['0x2105'], addSwitches: false}]);
  await p.click('#tabs [data-tab="shield"]');
  await p.click('#f-go');
  await until(p, () => /Wallet|Switch wallet/.test(document.querySelector('#f-max')?.textContent || ''));
  await p.fill('#f-samt', '0.01'); await p.fill('#f-sto', PAYEE);
  await p.click('#f-go');
  await until(p, () => /could not be downloaded|proving key/i.test(document.querySelector('#status').textContent), null, 30e3);
  const l = await log(p), sw = l.indexOf('0:wallet_switchEthereumChain'), add = l.indexOf('0:wallet_addEthereumChain');
  ok(sw >= 0 && add > sw && l.lastIndexOf('0:wallet_switchEthereumChain') > add, 'the wallet is switched, the chain added, and switched to', l.join());
  ok(await p.evaluate(() => window.__added?.chainName === 'Ethereum' && window.__added?.nativeCurrency?.symbol === 'ETH' && /^https:\/\//.test(window.__added?.rpcUrls?.[0])), 'with the chain’s name, currency and a node');
  const s = await says(p);
  ok(s.indexOf('Ethereum') >= 0 && (s.search(/proving|proving key/i) < 0 || s.indexOf('Ethereum') < s.search(/proving|proving key/i)), 'all before the proof is started', s);
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

console.log('\nconnected on Shield, then Receive');
{
  const p = await open([ALPHA]);
  await p.click('#tabs [data-tab="shield"]');
  await p.click('#f-go');
  await until(p, () => !!document.querySelector('#f-max'));
  const before = (await log(p)).join();
  await p.click('#tabs [data-tab="receive"]');
  await p.waitForTimeout(500);
  ok((await log(p)).join() === before, 'opening Receive asks the wallet nothing', (await log(p)).join());
  ok(/Continue with 0xf39f…2266/.test(await p.textContent('#form [data-in="eth"]')), 'it offers to continue with the account already connected');
  await p.click('#form [data-in="eth"]');
  ok(await opened(p), 'which opens the key');
  const l = await log(p);
  ok(l.filter((x) => x === '0:eth_requestAccounts').length === 1, 'without asking the wallet to connect again', l.join());
  ok(l.filter((x) => x === '0:personal_sign').length === 2, 'only the signatures of a first sign-in', l.join());
  ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
  await p.context().close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
