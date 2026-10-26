/* What the page says about what shows on chain, on the screens where a choice changes it: taking a deposit in from the
   wallet shows the wallet beside the address (said where it is offered, and the one-time addresses' note says the relay is
   what keeps them apart), a destination that is the connected wallet says what paying it ties, and the pool's size line says
   when no one else is in the pool; and what the device keeps and the Receive screen offers: a name cleared from the Receive field is
   gone at the next visit, what is typed as a payer's name or a note is not spell-checked, and the plain link and the standing
   address say what they show. The chain is unplugged: three chains in memory, a relay that quotes, a mock wallet.

   Usage: node test/dapp/tacit-pay.privacy.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here)         */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Interface, AbiCoder, id, namehash} from 'ethers';
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
    if (to === '0x0000000000696760e15f265e828db644a0c242eb' && sel === '0x59d1d43c') return coder.encode(['string'], [globalThis.NAMES?.['0x' + data.slice(10, 74)] || '']);
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
const POOL_L = POOL.toLowerCase();
C[8453].deposit(KEY, E);                                                  // one deposit: the pool's two leaves are this key's
C[8453].balances.set(POOL_L, E);
for (const n of Object.values(C)) n.balances.set(DEV.address.toLowerCase(), 10n * E);
const p = await open(C);
await signIn(p);
const bal = () => p.evaluate(() => document.querySelector('#bal')?.textContent.replace(/\s+/g, ' ').trim() || '');

console.log('the pool’s size line');
ok(await until(p, () => /No one else is in this pool yet/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3), 'a key that is alone in its pool is told so', await bal());
C[8453].deposit('22'.repeat(32), E); C[8453].balances.set(POOL_L, 2n * E);
await p.click('#bal-re');
ok(await until(p, () => /The pool holds 2 ETH/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3), 'and what the pool holds once another key is in it', await bal());
C[8453].balances.set(POOL_L, 3n * E);
await p.click('#bal-re');
ok(await until(p, () => /The pool holds 3 ETH/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3), 'what it holds follows the pool', await bal());

console.log('\ntaking a deposit in from the wallet');
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok'); await p.click('#form [data-from="exchange"]');
await until(p, () => document.querySelector('#f-check'));
const addr0 = await p.evaluate(() => document.querySelector('#form .addr code')?.textContent.trim());
C[8453].balances.set(addr0.toLowerCase(), 3n * 10n ** 14n);               // under the relay's minimum (0.0004 ETH): the wallet is the way
await p.click('#f-check');
ok(await until(p, () => /waiting at your deposit address/.test(document.querySelector('#form .callout')?.textContent || ''), null, 30e3), 'a deposit under the relay’s minimum is shown as waiting');
const call = await p.textContent('#form .callout');
ok(/Take it in from your wallet: no fee, just gas\. Your wallet then shows beside this address on chain\./.test(call.replace(/\s+/g, ' ')), 'and says the wallet then shows beside the address', call.replace(/\s+/g, ' ').slice(0, 200));
const note = await p.evaluate(() => [...document.querySelectorAll('#form .note')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
ok(/Taken in by the relay, nothing on chain ties them together\./.test(note) && !/Each works on every chain, and nothing on chain ties/.test(note), 'one-time addresses: it is the relay that keeps them apart', note.slice(0, 260));
C[8453].balances.set(addr0.toLowerCase(), 5n * 10n ** 14n);               // over it: the relay takes it, the wallet is still offered
await p.click('#f-check');
ok(await until(p, () => /The relay moves it in shortly, or take it in now from your wallet: no fee, just gas\. Your wallet then shows beside this address on chain\./.test((document.querySelector('#form .callout')?.textContent || '').replace(/\s+/g, ' ')), null, 30e3), 'over the minimum, the same line follows the relay’s');

console.log('\nthe wallet route');
await p.click('#wallet'); await p.click('#w-conn');
ok(await until(p, () => /Alpha/.test(document.querySelector('#wallet-body')?.textContent || ''), null, 15e3), 'the wallet is connected', (await p.textContent('#wallet-body')).replace(/\s+/g, ' ').slice(0, 160));
await p.click('#sheet-wallet [data-close]');
await p.click('#tabs [data-tab="withdraw"]');
ok(await until(p, () => document.querySelector('#f-me'), null, 10e3), 'Withdraw offers “My wallet”');
await p.click('#f-me');
const mine = await p.inputValue('#f-wto');
await p.fill('#f-wamt', '0.5');
ok(await until(p, (m) => document.querySelector('#f-rcpt')?.textContent.includes('ties the two together') && m, mine, 15e3), 'a destination that is the connected wallet says what paying it ties', (await p.textContent('#f-rcpt')).replace(/\s+/g, ' ').slice(0, 200));
await p.fill('#f-wto', PAYEE);
ok(await until(p, () => !/ties the two together/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3), 'and any other address does not');

console.log('\nwhat is typed, and what the device keeps');
await p.click('#tabs [data-tab="shield"]');
await p.click('#f-tok'); await p.click('#form [data-from="exchange"]');
await until(p, () => document.querySelector('#f-boxlabel'));
ok(await p.$eval('#f-boxlabel', (e) => [e.getAttribute('spellcheck'), e.getAttribute('autocorrect')].join()) === 'false,off', 'a payer’s name is not either');
const lbls = await p.$$eval('#form .lbl', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
ok(/Your deposit address\s*reusing it links your deposits/.test(lbls) && !/the same on every chain/.test(lbls), 'the standing address says what reusing it does', lbls);
await p.click('#tabs [data-tab="receive"]');
await until(p, () => document.querySelector('#f-qr svg'), null, 30e3);
ok(/or you take it in from your wallet at no fee, which then shows on chain/.test((await p.textContent('#form')).replace(/\s+/g, ' ')), 'a plain link says that taking it in from the wallet shows on chain');
const TACIT1 = poolKeys(Buffer.from(KEY, 'hex')).address;
globalThis.NAMES = {[namehash('ross.wei')]: TACIT1};
await p.evaluate(() => { document.querySelector('#f-ropts').open = true; });
ok(await p.$eval('#f-rfor', (e) => [e.getAttribute('spellcheck'), e.getAttribute('autocorrect')].join()) === 'false,off' && await p.$eval('#f-rname', (e) => [e.getAttribute('spellcheck'), e.getAttribute('autocorrect')].join()) === 'false,off', 'a note and an own name are not spell-checked or auto-corrected', '');
const link = async (q) => (await q.textContent('#f-rlink')).trim().replace(/^http:\/\/127.0.0.1:\d+\/#/, '');
await p.fill('#f-rname', 'ross.wei');
ok(await until(p, () => /pay=ross\.wei/.test(document.querySelector('#f-rlink')?.textContent || ''), null, 20e3), 'an own name that points here goes into the link', (await link(p)).slice(0, 60));
await p.fill('#f-rname', '');
ok(await until(p, () => /pay=tacit1/.test(document.querySelector('#f-rlink')?.textContent || ''), null, 20e3), 'cleared, the link is by address again', (await link(p)).slice(0, 60));
const ctx = p.context();                                                  // the same browser profile, a new visit
const errs0 = p.errors.slice();
await p.close();
const q = await ctx.newPage();
q.errors = []; q.on('pageerror', (e) => q.errors.push(String(e)));
await q.goto(ORIGIN); await q.waitForTimeout(300);
await signIn(q);
await q.click('#tabs [data-tab="receive"]');
await until(q, () => document.querySelector('#f-qr svg'), null, 30e3);
await q.waitForTimeout(1500);
ok(/pay=tacit1/.test(await link(q)) && await q.inputValue('#f-rname').catch(() => '') === '', 'and at the next visit it is still cleared', `${(await link(q)).slice(0, 40)} | ${await q.inputValue('#f-rname').catch(() => 'n/a')}`);
const lk = (await link(q));
await ctx.close();
const B = await open(C, {hash: lk, viewport: {width: 390, height: 844}});
await B.waitForSelector('#req-pay');
ok(await until(B, () => /Prove it here instead \(33 MB, once\): no relay fee, and nothing on chain shows who you paid/.test(document.querySelector('#req-prove')?.textContent || ''), null, 15e3), 'the payer is told what proving here changes', await B.textContent('#req-prove').catch(() => 'n/a'));
await B.context().close();
const errs = [...errs0, ...q.errors];
ok(!errs.length, 'no page errors', errs.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
