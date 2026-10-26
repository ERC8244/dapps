/* The small things a person meets on a phone or with a keyboard, on the deployed page with the chain unplugged: a toast raised
   while the Account sheet is open is carried to the page when it closes (the warning that this browser will not save is
   one), a sheet stops the page behind it from scrolling, a toast takes no taps, the keyboard focus lands somewhere when the
   control it was on is gone, a key being pasted is not wiped by a redraw, the Endpoints inputs look alike, a token with no
   logo is a ring with its letter in it, the asset picker can be hit just outside its text, a very large balance stays inside
   the card at 320 px, forced colours draw a focus outline, and each field's name contains the label shown beside it; a chain that
   cannot be read is named where the link's address waits for it, "Check for arrivals" says which chain it read, connecting a
   wallet from the Account sheet says what it waits for, Endpoints' Save shows it is working, and a key pasted with a space in it
   is read.

   Usage: node test/dapp/tacit-pay.polish.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here)         */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Interface, AbiCoder, id} from 'ethers';
import {lib} from './engine-mock.mjs';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const {poolKeys, sealNote, poolAsset, incTree, hex, T_TRANSACT, receiveBoxAddress} = lib;

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== '' && !c ? '  ' + x : '')); if (!c) failures++; };

const POOL = '0x000000c2A20657CE25f2Ba99737933D031AFBEE9', ROUTER = '0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5', MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const RELAYERS = {1: '0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0', 8453: '0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec', 4663: '0xc1F8DAc6BC910A5A794b4795b5F9997e0E8A5Fad'};
const DEPLOY = {1: 26069245, 8453: 51864014, 4663: 73991661};
const E = 10n ** 18n, KEY = '11'.repeat(32), PAYER_KEY = '05'.repeat(32);
const DEV = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const DEV_TACIT1 = 'tacit1qzzsx4pc3x9c8ym6q6mz53hkqa26lj4wsapknp474xxglk9r9dj0mu80q2g04y8gt2wgh3xdl6nmemkftsxeya0jcs2p8rjaed4htlfgqcmq5q5axtryqaknkkn47w5ruzd4t56hlrearwjjzhp92mpz7kfu9c2cpf3gxukgxnlm4rgewq5mmqfegdgdfxs0wurtavg8gjwlnzexpvptpkks9k72a9u74tkuns8y6x0gg490z3xd30xvpk6nvp8lpxar36qknkfaah';
const PAYEE = '0x3e407f4158440F1e5a9E6BA98b0198AEA6d837E3';
const coder = AbiCoder.defaultAbiCoder(), h32 = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0'), rnd = () => BigInt(Math.floor(Math.random() * 2 ** 50)) + 1n;
const iface = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)', 'function getEthBalance(address) view returns (uint256)',
  'function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[11] pub, address recipient, int256 ext, address relayer, uint256 fee, bytes memo0, bytes memo1)', 'function receiveBoxOf(uint256 npk, uint16 bps) view returns (address)']);

// Each chain: the pool's Transact logs and tree, balances, receipts, and what its relay quotes.
function chains() {
  const C = {};
  for (const cid of [1, 8453, 4663]) {
    const n = C[cid] = {cid, tip: DEPLOY[cid] + 100, logs: [], size: 0, tree: incTree(), roots: new Map(), balances: new Map(), receipts: new Map(), txn: 0, fee: 10n ** 13n, relayUp: true, relayDelay: 0};
    n.roots.set(String(n.tree.root), 0);
    const hash = () => '0x' + (BigInt(cid) * 10n ** 9n + BigInt(++n.txn)).toString(16).padStart(64, '0');
    n.transact = ({nf, outs, ext = 0n, memos = ['0x', '0x'], recipient = '0x' + '00'.repeat(20), fee = 0n, relayer = '0x' + '00'.repeat(20)}) => {
      const block = ++n.tip, first = n.size, leaves = outs.map((o) => BigInt(o ?? 0n));
      n.tree.append(leaves, []); n.size += 2; n.roots.set(String(n.tree.root), n.size);
      const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(leaves[0]), h32(leaves[1]), first, h32(n.tree.root), recipient, ext, relayer, fee, memos[0], memos[1]]);
      const tx = hash(), log = {address: POOL, topics: [T_TRANSACT, h32(nf[0]), h32(nf[1])], data, blockNumber: '0x' + block.toString(16), transactionHash: tx, logIndex: '0x0'};
      n.logs.push(log); n.receipts.set(tx, {status: '0x1', logs: [log], blockNumber: log.blockNumber});
      return tx;
    };
    n.deposit = (key, value) => { const s = sealNote({to: poolKeys(Buffer.from(key, 'hex')), value, asset: poolAsset(cid, POOL)}); return n.transact({nf: [rnd(), rnd()], outs: [s.leaf, null], ext: value, memos: ['0x' + hex(s.memo), '0x']}); };
    n.apply = (t) => n.transact({nf: [t.pub[7], t.pub[8]], outs: [t.pub[9], t.pub[10]], ext: BigInt(t.ext), memos: [t.memo0, t.memo1], recipient: t.recipient, fee: BigInt(t.fee), relayer: t.relayer});
    n.transfer = (to, value) => { const tx = hash(); ++n.tip; n.balances.set(to.toLowerCase(), (n.balances.get(to.toLowerCase()) ?? 0n) + BigInt(value)); n.receipts.set(tx, {status: '0x1', logs: [], blockNumber: '0x' + n.tip.toString(16)}); return tx; };
  }
  return C;
}
const chainOf = (host) => (/base/.test(host) ? 8453 : /robinhood/.test(host) ? 4663 : 1);
function answer(n, {method, params = []}) {
  if (method === 'eth_blockNumber') return '0x' + n.tip.toString(16);
  if (method === 'eth_getBalance') return '0x' + (n.balances.get(params[0].toLowerCase()) ?? 0n).toString(16);
  if (method === 'eth_getCode') return '0x6080';
  if (method === 'eth_getTransactionReceipt') return n.receipts.get(params[0]) ?? null;
  if (method === 'eth_getBlockByNumber') return {number: params[0], timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16)};
  if (method === 'eth_getLogs') {
    const f = params[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
    return n.logs.filter((l) => [].concat(f.address).some((x) => x.toLowerCase() === l.address.toLowerCase()) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && (f.topics || []).every((t, i) => !t || (Array.isArray(t) ? t.includes(l.topics[i]) : t === l.topics[i])));
  }
  if (method === 'eth_call') {
    const to = params[0].to.toLowerCase(), data = params[0].data, sel = data.slice(0, 10);
    if (to === MULTICALL.toLowerCase()) {
      const [calls] = iface.decodeFunctionData('aggregate3', data);
      return iface.encodeFunctionResult('aggregate3', [calls.map((c) => c.target.toLowerCase() === POOL.toLowerCase() ? [true, coder.encode(['uint256'], [n.size])]
        : c.callData.startsWith(iface.getFunction('getEthBalance').selector) ? [true, coder.encode(['uint256'], [n.balances.get(iface.decodeFunctionData('getEthBalance', c.callData)[0].toLowerCase()) ?? 0n])]
        : (() => { try { return [true, answer(n, {method: 'eth_call', params: [{to: c.target, data: c.callData}]})]; } catch { return [false, '0x']; } })())]);
    }
    if (to === POOL.toLowerCase() && sel === id('nextIndex()').slice(0, 10)) return coder.encode(['uint256'], [n.size]);
    if (to === POOL.toLowerCase() && sel === id('rootSize(bytes32)').slice(0, 10)) return coder.encode(['uint256'], [n.roots.get(String(BigInt('0x' + data.slice(10)))) ?? 0n]);
    if (to === ROUTER.toLowerCase() && sel === iface.getFunction('receiveBoxOf').selector) return coder.encode(['address'], [receiveBoxAddress(ROUTER, BigInt(iface.decodeFunctionData('receiveBoxOf', data)[0]))]);
    if (to === POOL.toLowerCase() || to === ROUTER.toLowerCase()) return '0x';
    return '0x' + '00'.repeat(31) + '01';                                 // the verifier, and anything else asked
  }
  return null;
}

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const ORIGIN = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

// A wallet in the page (EIP-6963): `modes` makes a method hang, or answer after `delay` ms.
const WALLET = `(() => {
  const w = window.__W, on = {}, st = { chain: '0x1', authorized: false };
  const p = window.__wallet = {
    on(ev, f) { (on[ev] ||= []).push(f); }, removeListener() {}, emit(ev, v) { for (const f of on[ev] || []) f(v); },
    async request({ method, params = [] }) {
      const mode = (window.__modes || {})[method];
      if (mode === 'hang') return new Promise(() => {});
      if (mode?.delay) await new Promise((r) => setTimeout(r, mode.delay));
      if (method === 'eth_requestAccounts') { st.authorized = true; return [w.account]; }
      if (method === 'eth_accounts') return st.authorized ? [w.account] : [];
      if (method === 'eth_chainId') return st.chain;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { st.chain = params[0].chainId; p.emit('chainChanged', st.chain); return null; }
      if (method === 'eth_getCode') return '0x';
      // Reads the page sends through the wallet are answered by the chain the wallet is on, as a wallet's node would.
      if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber'].includes(method)) return window.__read(parseInt(st.chain, 16), method, params);
      if (method === 'personal_sign') return window.__sign(params[0]);
      if (method === 'eth_sendTransaction') return window.__send(parseInt(st.chain, 16), params[0]);
      throw Object.assign(new Error('not in this test: ' + method), { code: 4200 });
    },
  };
  const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), name: 'Alpha', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.alpha' }, provider: p });
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })));
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
})();`;

async function open(C, {hash = '', modes = null, viewport = {width: 1100, height: 900}, delay = 0} = {}) {
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write'], viewport});
  const cors = {'access-control-allow-origin': '*'};
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (process.env.ARTIFACTS && /\/(transact\.wasm|transact_final\.zkey)$/.test(url.pathname)) return route.fulfill({status: 200, headers: cors, body: fs.readFileSync(`${process.env.ARTIFACTS}/${url.pathname.split('/').pop()}`)});
    if (/onrender\.com$/.test(url.host)) {
      const cid = Number(/^\/(\d+)\/evm-pool\/keeper/.exec(url.pathname)?.[1] || 1), n = C[cid], path = url.pathname.replace(/^\/\d+\/evm-pool\/keeper/, '');
      const json = (status, body) => route.fulfill({status, contentType: 'application/json', headers: cors, body: JSON.stringify(body)});
      if (n.relayDelay) await new Promise((r) => setTimeout(r, n.relayDelay));
      if (!n.relayUp) return json(503, {error: 'offline'});
      if (path === '/quote') return json(200, {chainId: cid, pool: POOL, relayer: RELAYERS[cid], fee: String(n.fee), gas: '400000', receiveMin: '400000000000000'});
      if (path === '/events') return json(200, {chainId: cid, pool: POOL, through: n.tip - 3, events: []});
      if (path === '/receive') return json(200, {ok: true});
      if (path === '/relay') { const {tx} = JSON.parse(req.postData()); return json(200, {txHash: n.apply({...tx, pub: tx.publicInputs, ext: tx.extAmount})}); }
      return json(404, {error: 'no'});
    }
    if (req.method() === 'POST') {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (C[chainOf(url.host)].down) return route.fulfill({status: 503, headers: cors, body: '{}'});
      const body = JSON.parse(req.postData() || '{}'), n = C[chainOf(url.host)], reply = (b) => ({jsonrpc: '2.0', id: b.id, result: answer(n, b)});
      return route.fulfill({status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
    }
    return route.fulfill({status: 503, headers: cors, body: '{}'});
  });
  await ctx.exposeFunction('__sign', (h) => DEV.signMessage(Buffer.from(h.slice(2), 'hex')));
  await ctx.exposeFunction('__read', (cid, method, params) => (C[cid] ? answer(C[cid], {method, params}) : null));
  await ctx.exposeFunction('__send', (cid, tx) => {
    if (tx.to.toLowerCase() !== POOL.toLowerCase()) return C[cid].transfer(tx.to, BigInt(tx.value || 0));
    const d = iface.decodeFunctionData('transact', tx.data);
    return C[cid].apply({pub: d.pub.map(String), recipient: d.recipient, ext: d.ext, relayer: d.relayer, fee: d.fee, memo0: d.memo0, memo1: d.memo1});
  });
  await ctx.addInitScript(`window.__W = ${JSON.stringify({account: DEV.address.toLowerCase()})}; window.__modes = ${JSON.stringify(modes || {})};`);
  await ctx.addInitScript(WALLET);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(ORIGIN + (hash ? '#' + hash : ''));
  await p.waitForTimeout(300);
  return p;
}
const signIn = async (p, key = KEY) => {
  await p.click('#wallet'); await p.click('#sheet-wallet [data-in="paste"]');
  await p.fill('#sheet-wallet .opts input', key); await p.click('#sheet-wallet [data-in="key"]');
  await p.waitForFunction(() => /^tacit1/.test(document.querySelector('#wallet-label').textContent));
};
const until = (p, fn, arg, ms = 15e3) => p.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
const label = (p) => p.textContent('#f-go');

const C = chains();
C[8453].deposit(KEY, E);
for (const n of Object.values(C)) n.balances.set(DEV.address.toLowerCase(), 10n * E);
const p = await open(C, {viewport: {width: 390, height: 844}});
await signIn(p);
await until(p, () => !document.querySelector('#bal .sk'), null, 30e3);
const css = (sel, prop) => p.evaluate(([s, k]) => getComputedStyle(document.querySelector(s))[k], [sel, prop]);

console.log('a sheet and its toasts');
await p.click('#wallet');
await p.click('#w-copy');
ok(await until(p, () => !!document.querySelector('#sheet-wallet .toast'), null, 3e3), 'a toast raised while the sheet is open is drawn in it');
ok(await p.evaluate(() => getComputedStyle(document.documentElement).overflow) === 'hidden', 'the page behind an open sheet does not scroll');
ok(await css('#sheet-wallet .toast', 'pointerEvents') === 'none', 'a toast takes no taps');
await p.click('#sheet-wallet [data-close]');
ok(await until(p, () => /Address copied/.test(document.querySelector('#toasts')?.textContent || '') && !document.querySelector('#sheet-wallet .toast'), null, 3e3), 'it is carried to the page when the sheet closes');
ok(await p.evaluate(() => getComputedStyle(document.documentElement).overflow) !== 'hidden', 'and the page scrolls again');

console.log('\nthe keyboard focus');
await p.click('#wallet');
await p.focus('#w-lock'); await p.keyboard.press('Enter');
ok(await until(p, () => document.activeElement?.id === 'wallet-h', null, 3e3), 'Sign out leaves the focus on the sheet’s heading', await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
await p.click('#sheet-wallet [data-close]');
await signIn(p);
await until(p, () => !document.querySelector('#bal .sk'), null, 30e3);

console.log('\nthe Endpoints sheet and the marks');
await p.click('#settings-open');
const ends = await p.evaluate(() => { const w = (s) => document.querySelector(s).getBoundingClientRect().width; return { pts: w('#e-points'), wc: w('#e-wc'), ta: w('#e-relay-1'), min: getComputedStyle(document.querySelector('#e-relay-1')).minHeight }; });
ok(ends.pts > 0.9 * ends.ta && ends.wc > 0.9 * ends.ta, 'the registry and project-id inputs are as wide as the boxes beside them', JSON.stringify(ends));
ok(ends.min === '78px', 'and the relay boxes show their whole placeholder', ends.min);
await p.click('#sheet-settings [data-close]');
ok(await p.evaluate(() => { const s = document.createElement('span'); s.className = 'tk sm tl'; s.dataset.l = 'T'; document.body.append(s); const d = getComputedStyle(s).display; s.remove(); return d; }) === 'inline-grid', 'a token with no logo draws its letter inside its ring');
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
ok(await p.evaluate(() => { const e = document.querySelector('#asset-pick'); if (!e) return false; const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left - 6, r.top - 8) === e; }), 'the asset picker can be hit just outside its text');

console.log('\nforced colours and names');
await p.emulateMedia({forcedColors: 'active'});
await p.click('#tabs [data-tab="send"]');
await p.focus('#f-amt');
const fo = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('#f-amt').closest('.amt')); return [s.outlineStyle, s.outlineWidth].join(); });
ok(/^solid,([2-9]|\d\d)px$/.test(fo), 'the focused amount field has an outline in forced colours', fo);
await p.emulateMedia({forcedColors: 'none'});
ok(await p.$eval('#f-to', (e) => e.getAttribute('aria-label')) === 'For', 'a field’s name contains the label shown beside it (Send)');
await p.click('#tabs [data-tab="receive"]');
await until(p, () => document.querySelector('#f-qr svg'), null, 30e3);
ok((await p.textContent('#f-link')).trim() === 'Copy link', 'the link button fits its half of the row');
await p.evaluate(() => { document.querySelector('#f-ropts').open = true; });
ok(await p.$eval('#f-rfor', (e) => e.getAttribute('aria-label')) === 'What it’s for (optional)', 'and so does the note’s (Receive)');
const link = (await p.textContent('#f-rlink')).split('#')[1];
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
await p.context().close();

console.log('\na payment link and a key being pasted');
const B = await open(C, {hash: link, viewport: {width: 390, height: 844}});
await B.waitForSelector('#req-x');
await B.focus('#req-x'); await B.keyboard.press('Enter');
ok(await until(B, () => document.activeElement?.getAttribute('aria-selected') === 'true' && !!document.activeElement.closest('#chains'), null, 3e3), 'dismissing a request card puts the focus on the chain tab', await B.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
await B.click('#wallet'); await B.click('#sheet-wallet [data-in="paste"]');
await B.fill('#sheet-wallet .opts input', '1111111111');
await B.evaluate(() => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: crypto.randomUUID(), name: 'Beta', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.beta' }, provider: window.__wallet }) })));
await B.waitForTimeout(400);
ok(await B.evaluate(() => document.querySelector('#sheet-wallet .opts input')?.value === '1111111111' && document.activeElement?.type === 'password'), 'a wallet announcing itself does not wipe a key being pasted');
ok(!B.errors.length, 'no page errors', B.errors.join(' | '));
await B.context().close();

console.log('\nreading, connecting and saving');
{
  const C3 = chains(); C3[8453].deposit(KEY, E); C3[4663].down = true;
  const R = await open(C3, {viewport: {width: 390, height: 844}});
  await signIn(R, KEY.slice(0, 10) + ' ' + KEY.slice(10));
  ok(/^tacit1/.test(await R.textContent('#wallet-label')), 'a key pasted with a space in it is read');
  await R.click('#tabs [data-tab="receive"]');
  ok(await until(R, () => /Could not read Robinhood Chain/.test(document.querySelector('#f-qr')?.textContent || ''), null, 90e3), 'a link waiting on a chain that cannot be read names it', (await R.textContent('#f-qr').catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
  await R.click('#tabs [data-tab="shield"]');
  await R.click('#f-tok'); await R.click('#form [data-from="exchange"]');
  await until(R, () => document.querySelector('#f-check'));
  await R.click('#f-check');
  ok(await until(R, () => /Nothing is waiting on Base\./.test(document.querySelector('#status')?.textContent || ''), null, 60e3), '“Check for arrivals” says which chain it read', (await R.textContent('#status')).replace(/\s+/g, ' ').slice(0, 120));
  await R.context().close();
}
{
  const H = await open(C, {modes: {eth_requestAccounts: 'hang'}, viewport: {width: 390, height: 844}});
  await signIn(H);
  await H.click('#wallet'); await H.click('#w-conn');
  ok(await until(H, () => /Approve the connection in your wallet/.test(document.querySelector('#w-say')?.textContent || ''), null, 5e3), 'connecting from the Account sheet says what it waits for', await H.textContent('#w-say').catch(() => 'n/a'));
  ok(await H.evaluate(() => getComputedStyle(document.querySelector('#w-say')).display !== 'none'), 'and the line is shown');
  await H.context().close();
}
{
  const E2 = await open(C, {delay: 1500, viewport: {width: 390, height: 844}});
  await E2.click('#settings-open');
  await E2.fill('#e-rpc-8453', 'https://base.example.org');
  await E2.click('#e-save');
  ok(await until(E2, () => document.querySelector('#e-save')?.getAttribute('aria-busy') === 'true', null, 3e3), 'Save shows it is working while it asks the node');
  ok(await until(E2, () => document.querySelector('#e-save')?.getAttribute('aria-busy') !== 'true', null, 30e3), 'and stops when it has an answer');
  await E2.context().close();
}

console.log('\na very large balance on a narrow phone');
const C2 = chains();
C2[8453].deposit(KEY, 12345678912n * 10n ** 12n);
const N = await open(C2, {viewport: {width: 320, height: 700}});
await signIn(N);
await until(N, () => !document.querySelector('#bal .sk') && /12,345/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3);
const fit = await N.evaluate(() => { const b = document.querySelector('#bal'), r = b.getBoundingClientRect(); return { page: document.documentElement.scrollWidth, out: [...b.querySelectorAll('*')].filter((e) => !e.closest('svg') && e.getBoundingClientRect().right > r.right + 0.5).map((e) => e.id || String(e.className)).slice(0, 4) }; });
ok(fit.page <= 320 && !fit.out.length, 'the balance stays inside the card at 320 px', JSON.stringify(fit));
const tabs = (await N.textContent('#chains')).replace(/\s+/g, ' ');
ok(/12,34[56] ETH/.test(tabs) && !/678912/.test(tabs), 'and a chain tab shows a large figure to the unit', tabs.slice(0, 100));
await N.context().close();
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
