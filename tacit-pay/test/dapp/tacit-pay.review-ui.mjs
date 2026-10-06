/* Taps on a phone, in Chromium with the chains in memory: the three links of a payment held by the relay are rows that do not
   overlap (a tap lands on the link it is on, and "It is a different payment" is its own row), the small buttons above a field
   have a 44 px target, and the line under a token amount wraps instead of cutting off its last figure.

   Usage: node test/dapp/tacit-pay.review-ui.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here)
          ARTIFACTS=<dir with transact.wasm and transact_final.zkey>                                                */
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
      if (path === '/relay' && n.relayDrop) return route.abort();
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
C[8453].deposit(KEY, E); C[8453].deposit(KEY, E / 2n);
const probe = (p) => p.evaluate(() => {
  const st = document.querySelector('#status'); st.scrollIntoView({block: 'center'});
  return [...st.querySelectorAll('button.link')].map((b) => {
    const r = b.getBoundingClientRect(), name = b.textContent.trim();
    return {name, h: Math.round(r.height), misses: [0.3, 0.5, 0.8].map((f) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height * f)?.closest('button')?.textContent.trim()).filter((t) => t !== name)};
  });
});
for (const vw of [320, 360]) {
  console.log(`a payment held by the relay, at ${vw} px`);
  const p = await open(C, {viewport: {width: vw, height: 740}});
  await signIn(p);
  await p.waitForTimeout(2000);
  await p.click('#tabs [data-tab="send"]');
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.1');
  await until(p, () => /They receive/.test(document.querySelector('#f-rcpt').textContent));
  C[8453].relayDrop = true;
  await p.click('#f-go');
  await until(p, () => /may still send|did not answer/.test(document.querySelector('#status').textContent), null, 120e3);
  await until(p, () => !document.querySelector('#f-go').disabled, null, 20e3);
  await p.click('#f-go');
  ok(await until(p, () => !!document.querySelector('[data-fresh]'), null, 60e3), 'pressing Send again says a payment may still land, with the three ways on');
  const rows = await probe(p);
  ok(rows.length === 3, 'three links', rows.map((r) => r.name).join(' | '));
  for (const r of rows) ok(r.h >= 44 && r.misses.length === 0, `"${r.name}": a row of ${r.h} px, and a tap on it is its own`, r.misses.join(' | '));
  C[8453].relayDrop = false;
  await p.context().close();
}

console.log('\nthe small buttons above a field, and the line under a token amount, at 320 px');
{
  const p = await open(C, {viewport: {width: 320, height: 640}});
  await signIn(p);
  await p.waitForTimeout(1500);
  await p.click('#tabs [data-tab="send"]');
  const tall = await p.evaluate(() => { const b = document.querySelector('#f-max'), r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let lo = 1e9, hi = -1e9; for (let dy = -40; dy <= 40; dy++) { const h = document.elementFromPoint(cx, cy + dy); if (h && (h === b || b.contains(h))) { lo = Math.min(lo, dy); hi = Math.max(hi, dy); } } return hi - lo + 1; });
  ok(tall >= 44, 'Max can be tapped over a height of at least 44 px', `${tall} px`);
  const fits = await p.evaluate(() => { const e = document.createElement('p'); e.className = 'cap'; document.querySelector('#form').append(e); e.textContent = '≈ 1,234.56 USDC · at most 1,240.12 USDC'; return e.scrollWidth <= e.clientWidth; });
  ok(fits, 'the line under a token amount is not cut off');
  const foot = await p.evaluate(() => Math.min(...[...document.querySelectorAll('footer a')].map((a) => a.getBoundingClientRect().height)));
  ok(foot >= 44, 'the footer links are at least 44 px tall', `${Math.round(foot)} px`);
  await p.context().close();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
