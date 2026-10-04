/* How the real dapp/page.html answers as it is used, with the chain unplugged: three chains kept in memory (a pool that
   takes deposits and spends, Multicall3, the router's deposit addresses), a relay that quotes and indexes, and a wallet
   in the page that can be slow or never answer. What it checks: a button that cannot be pressed says why, Enter moves
   through a form and presses its button from the last field, a new relay fee or a read that changed nothing does not
   draw a field being typed in again, the keyboard focus survives a redraw, copies are confirmed on their button, busy
   states hold while their work runs and are not shown when nothing is loading, and a wallet that never answers can be
   stopped waiting for.

   Usage: node test/dapp/tacit-pay.ux.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here)
          ARTIFACTS=<dir with transact.wasm and transact_final.zkey> … also proves a payment, and checks the balance after it */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Interface, AbiCoder, id} from 'ethers';
import {lib} from './engine-mock.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url));
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
    return n.logs.filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && (f.topics || []).every((t, i) => !t || t === l.topics[i]));
  }
  if (method === 'eth_call') {
    const to = params[0].to.toLowerCase(), data = params[0].data, sel = data.slice(0, 10);
    if (to === MULTICALL.toLowerCase()) {
      const [calls] = iface.decodeFunctionData('aggregate3', data);
      return iface.encodeFunctionResult('aggregate3', [calls.map((c) => c.target.toLowerCase() === POOL.toLowerCase() ? [true, coder.encode(['uint256'], [n.size])]
        : [true, coder.encode(['uint256'], [n.balances.get(iface.decodeFunctionData('getEthBalance', c.callData)[0].toLowerCase()) ?? 0n])])]);
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
      const cid = /-base/.test(url.host) ? 8453 : /-robinhood/.test(url.host) ? 4663 : 1, n = C[cid], path = url.pathname.replace(/^\/evm-pool\/keeper/, '');
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
for (const n of Object.values(C)) n.balances.set(DEV.address.toLowerCase(), 10n * E);
C[8453].deposit(KEY, E);
C[8453].relayDelay = 600;                                                 // a relay a little slower than the nodes
const p = await open(C);

console.log('the relay line before the relay was asked');
await p.click('#tabs [data-tab="send"]');
await signIn(p);
const lines = new Set();
for (let i = 0; i < 60 && ![...lines].some((l) => /fee 0/.test(l)); i++) { lines.add(await p.evaluate(() => document.querySelector('#form .route')?.textContent.trim() || '')); await p.waitForTimeout(50); }
ok([...lines].some((l) => /Reading the relay/.test(l)), 'says the fee is being read', [...lines].join(' | '));
ok(![...lines].some((l) => /not answering/.test(l)), 'and never that the relay is not answering before it was asked', [...lines].join(' | '));
C[8453].relayDelay = 0;

console.log('a button that cannot be pressed says why');
ok(await label(p) === 'Enter who to pay' && await p.isDisabled('#f-go'), 'Send, empty: who to pay', await label(p));
await p.fill('#f-to', DEV_TACIT1);
ok(await label(p) === 'Enter an amount', 'then the amount', await label(p));
await p.fill('#f-amt', '1.2.3');
ok(/up to 18 decimals/.test(await p.textContent('#f-rcpt')), 'an amount that cannot be read says how to write one', await p.textContent('#f-rcpt'));
await p.fill('#f-amt', '0.1');
ok(await label(p) === 'Send privately' && !(await p.isDisabled('#f-go')), 'filled in, it is the button again', await label(p));
await p.click('#tabs [data-tab="withdraw"]');
ok(await label(p) === 'Enter an address', 'Withdraw, empty: an address', await label(p));
await p.fill('#f-wto', '0x3e40');
ok(await label(p) === 'Enter an address', 'one still being typed is still missing', await label(p));
await p.fill('#f-wto', PAYEE);
ok(await label(p) === 'Enter an amount', 'then the amount', await label(p));
await p.click('#tabs [data-tab="send"]');
ok(await p.inputValue('#f-to') === DEV_TACIT1 && await p.inputValue('#f-amt') === '0.1', 'what was typed in Send is still there after another tab');

console.log('Enter, and the phone’s return key');
await p.fill('#f-amt', '');
await p.focus('#f-to');
await p.keyboard.press('Enter');
ok(await p.evaluate(() => document.activeElement.id) === 'f-amt', 'Enter in To moves on to the amount');
ok(await p.evaluate(() => [document.querySelector('#f-to').enterKeyHint, document.querySelector('#f-amt').enterKeyHint].join()) === 'next,send', 'and the return key says next, then send');
ok(await p.evaluate(() => document.querySelector('#f-to').getAttribute('autocorrect')) === 'off', 'an address field is not autocorrected');
await p.keyboard.press('Enter');
ok((await p.textContent('#status')).trim() === '', 'Enter in an empty last field presses nothing');

console.log('a new relay fee while an amount is typed');
await p.fill('#f-amt', '0.25');
await p.evaluate(() => { window.__amt = document.querySelector('#f-amt'); window.__amt.focus(); window.__amt.setSelectionRange(1, 3); });
C[8453].fee = 3n * 10n ** 13n;
await p.evaluate(() => document.querySelector('#bal-re').click());
await until(p, () => /0\.00003/.test(document.querySelector('#form .route').textContent));
const kept = await p.evaluate(() => [window.__amt === document.querySelector('#f-amt'), document.activeElement === window.__amt, window.__amt.selectionStart, window.__amt.selectionEnd].join());
ok(kept === 'true,true,1,3', 'the field is not drawn again: focus and selection stay', kept);
ok(/0\.00003/.test(await p.textContent('#f-rcpt')), 'and what it costs follows the new fee', await p.textContent('#f-rcpt'));

console.log('the keyboard focus through a redraw');
await p.focus('#tabs [data-tab="withdraw"]');
await p.keyboard.press('Enter');
ok(await p.evaluate(() => document.activeElement.dataset?.tab) === 'withdraw', 'a tab chosen with Enter keeps the focus');
await p.focus('#chains [data-chain="1"]');
await p.keyboard.press('Space');
ok(await p.evaluate(() => document.activeElement.dataset?.chain) === '1', 'so does a chain chosen with Space');
await p.focus('#chains [data-chain="8453"]');
await p.keyboard.press('Space');
C[8453].relayDelay = 700;
await p.focus('#bal-re');
await p.keyboard.press('Enter');
ok(/reading/.test(await p.textContent('#bal-re')), 'refresh says it is reading the moment it is pressed');
await until(p, () => /refresh/.test(document.querySelector('#bal-re').textContent));
ok(await p.evaluate(() => document.activeElement.id) === 'bal-re', 'and keeps the focus through the read');
C[8453].relayDelay = 0;

console.log('copies, Rebuild, deposit addresses');
await p.click('#tabs [data-tab="receive"]');
await until(p, () => document.querySelector('#f-qr svg'), null, 30e3);
await p.click('#form [data-copy^="bp1"]');
ok(await until(p, () => document.querySelector('#form [data-copy^="bp1"]').textContent === 'copied', null, 2e3), 'a copy is confirmed on its own button', await p.textContent('#form [data-copy^="bp1"]'));
ok(await p.evaluate(() => { const t = [...document.querySelectorAll('#toasts .toast')].pop(), r = t?.getBoundingClientRect(); return !!t && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== t; }), 'its toast is for screen readers only');
ok(/^bp1/.test(await p.evaluate(() => navigator.clipboard.readText())), 'and the address is on the clipboard');
await p.waitForTimeout(1800);
ok(await p.textContent('#form [data-copy^="bp1"]') === 'copy bp1…', 'the button reads as before a moment later', await p.textContent('#form [data-copy^="bp1"]'));
await p.evaluate(() => { document.querySelector('#activity details').open = true; });
C[8453].relayDelay = 800;
await p.click('#rebuild');
await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelector('#rebuild').disabled && document.querySelector('#rebuild').getAttribute('aria-busy') === 'true'), 'Rebuild stays busy while the list is drawn again');
ok(await until(p, () => !document.querySelector('#rebuild').disabled, null, 60e3), 'and comes back when done');
await p.click('#tabs [data-tab="shield"]');
await p.click('#form [data-from="exchange"]');
await until(p, () => document.querySelector('#f-check'));
await p.click('#f-check');
ok(await p.evaluate(() => !!document.querySelector('#status .spin') && document.querySelector('#f-check').disabled), 'checking for arrivals shows at once, and cannot be pressed twice');
ok(await until(p, () => /waiting at your deposit/.test(document.querySelector('#status').textContent)), 'then says what it found');
C[8453].relayDelay = 0;
const issued = () => p.$$eval('#form .rows li', (x) => x.length);
const before = await issued();
await p.fill('#f-boxlabel', 'Ana');
C[8453].relayDelay = 700;                                                 // the reads a new address sets off take a while
await p.evaluate(() => { window.__flash = []; new MutationObserver(() => { const t = document.querySelector('#bal-re')?.textContent; if (t && t !== 'refresh') window.__flash.push(t); }).observe(document.querySelector('#bal'), {subtree: true, childList: true, characterData: true}); });
await p.dblclick('#f-newbox');
ok(await issued() === before + 1, 'a double click gives one new address, not two', `${before} → ${await issued()}`);
await p.waitForTimeout(1600);
ok(!(await p.evaluate(() => window.__flash.length)), 'the reads it sets off do not flash “reading…” on the balance', String(await p.evaluate(() => window.__flash)));
C[8453].relayDelay = 0;
await p.fill('#f-boxlabel', 'Bo');
await p.press('#f-boxlabel', 'Enter');
ok(await issued() === before + 2 && /Bo/.test(await p.textContent('#form .rows')), 'Enter in its label gives one too');
await p.evaluate(() => { document.querySelector('#status').textContent = 'an earlier result'; });
await p.click('#wallet'); await p.click('#w-lock'); await p.click('#sheet-wallet [data-close]');
ok((await p.textContent('#status')).trim() === '', 'locking clears the status line of the key that was open');
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));

console.log('a payment link, paid from a wallet');
await signIn(p);
await p.click('#tabs [data-tab="receive"]');
await until(p, () => document.querySelector('#f-qr svg'), null, 30e3);
const link = (await p.textContent('#f-rlink')).split('#')[1];
await p.context().close();
const B = await open(C, {hash: link, viewport: {width: 390, height: 844}});
await B.waitForSelector('#req-pay');
await B.click('#req-pay');
await until(B, () => !/Connect/.test(document.querySelector('#req-pay').textContent));
ok(await B.textContent('#req-pay') === 'Enter an amount' && await B.isDisabled('#req-pay'), 'with any amount, the button asks for one', await B.textContent('#req-pay'));
await B.evaluate(() => window.__wallet.emit('chainChanged', '0x1237'));
ok(await until(B, () => document.querySelector('#req [data-rc="4663"]')?.getAttribute('aria-selected') === 'true', null, 3e3), 'a wallet moved to another chain the link offers moves the card with it');
await B.evaluate(() => window.__wallet.emit('chainChanged', '0xa'));
await B.waitForTimeout(200);
ok(await B.$eval('#req [data-rc="4663"]', (b) => b.getAttribute('aria-selected')) === 'true', 'one it does not offer leaves the card where it is');
await B.click('#req [data-rc="8453"]');
ok((await B.textContent('#req-status')).trim() === '', 'and the line that said the wallet was asked is clear');
await signIn(B, PAYER_KEY);
await until(B, () => !document.querySelector('#bal .sk') && /refresh/.test(document.querySelector('#bal-re')?.textContent || ''));
await B.waitForTimeout(800);
await B.evaluate(() => { document.querySelector('#req details').open = true; });
await B.click('#req-amt');
await B.keyboard.type('0.0');
await B.evaluate(() => { window.__in = document.querySelector('#req-amt'); document.querySelector('#bal-re').click(); });
await B.waitForTimeout(1200);
ok(await B.evaluate(() => window.__in === document.querySelector('#req-amt') && document.activeElement === window.__in), 'a read that changed nothing leaves the amount being typed as it is');
ok(await B.evaluate(() => document.querySelector('#req details').open), 'and an open part open');
await B.keyboard.type('1x');
ok(/up to 18 decimals/.test(await B.textContent('#req-note')), 'an amount that cannot be read says how to write one');
await B.keyboard.press('Backspace');
ok(await B.textContent('#req-pay') === 'Pay 0.01 ETH on Base', 'a good one names the payment', await B.textContent('#req-pay'));
await B.evaluate(() => { window.__modes.eth_sendTransaction = {delay: 1500}; });
await B.keyboard.press('Enter');
ok(await until(B, () => document.querySelector('#req-amt')?.disabled, null, 5e3), 'Enter pays, and the amount cannot change while it does');
ok(await until(B, () => /✓/.test(document.querySelector('#req-body').textContent), null, 30e3), 'paid');
ok(await B.evaluate(() => document.activeElement.id) === 'req-done', 'with the focus on Done');
ok(!B.errors.length, 'no page errors', B.errors.join(' | '));
await B.context().close();

console.log('a wallet that never answers');
const P = await open(C, {hash: link, modes: {wallet_switchEthereumChain: 'hang'}});
await P.waitForSelector('#req-pay');
await P.click('#req-pay');
await until(P, () => /Enter an amount/.test(document.querySelector('#req-pay').textContent));
await P.fill('#req-amt', '0.01');
await P.click('#req-pay');
ok(await until(P, () => document.querySelector('#req-status [data-unstick]'), null, 12e3), 'after a while the card offers to stop waiting', await P.textContent('#req-status'));
ok(await P.isDisabled('#chains [data-chain="1"]'), 'while the page is held');
await P.click('#req-status [data-unstick]', {timeout: 3e3}).catch(() => {});
ok(await until(P, () => !document.querySelector('#req-pay').disabled && !document.querySelector('#chains [data-chain="1"]').disabled, null, 3e3), 'stopping frees the page');
ok((await P.textContent('#req-status')).trim() === '' && !(await P.$$('#toasts .toast.bad')).length, 'without an alarm');
await P.context().close();
const S = await open(C, {modes: {personal_sign: 'hang'}});
await S.click('#wallet');
await S.click('#sheet-wallet [data-in="eth"]');
ok(await until(S, () => document.querySelector('#sheet-wallet [data-say] [data-unstick]'), null, 12e3), 'signing in offers it too');
await S.click('#sheet-wallet [data-unstick]', {timeout: 3e3}).catch(() => {});
ok(await until(S, () => !document.querySelector('#sheet-wallet [aria-busy="true"]'), null, 3e3) && !(await S.textContent('#sheet-wallet [data-say]')).trim(), 'and the button comes back, with nothing said');
ok(!S.errors.length && !P.errors.length, 'no page errors', [...S.errors, ...P.errors].join(' | '));
await S.context().close();

if (process.env.ARTIFACTS) {
  console.log('a payment proved here, and the balance after it');
  const D = chains();
  D[8453].deposit(KEY, E);
  const q = await open(D, {delay: 400});                                 // nodes slow enough that the read after the payment takes a while
  await signIn(q);
  await q.click('#tabs [data-tab="send"]');
  await until(q, () => /fee 0/.test(document.querySelector('#form .route')?.textContent || ''), null, 30e3);
  await q.fill('#f-to', DEV_TACIT1); await q.fill('#f-amt', '0.1');
  await q.click('#f-go');
  ok(await until(q, () => /Sent 0\.1 ETH/.test(document.querySelector('#status').textContent), null, 180e3), 'sent', await q.textContent('#status'));
  ok(await q.textContent('#bal .v') === '0.89999', 'the balance shows what is left the moment it is sent', await q.textContent('#bal .v'));
  ok(await q.inputValue('#f-to') === '' && await label(q) === 'Enter who to pay', 'and the form is empty again');
  ok(!q.errors.length, 'no page errors', q.errors.join(' | '));
} else console.log('(ARTIFACTS is not set: the proved payment is skipped)');

await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
