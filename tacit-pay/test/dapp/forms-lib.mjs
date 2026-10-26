/* The in-memory world of tacit-pay.forms.mjs: the deployed page in headless Chromium with three chains (the ETH pool and the token
   pools of Ethereum and Base), names (WNS records), a relay, the token list and a quoter, and a wallet that can answer slowly,
   hang or refuse. A test sets what it needs on `env` and on `env.C[chainId]`, then `open(env)`s a page. */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Wallet, Interface, AbiCoder, id, namehash, getAddress} from 'ethers';
import {lib} from './engine-mock.mjs';
import {html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
export const {poolKeys, sealNote, poolAsset, incTree, hex, T_TRANSACT, receiveBoxAddress} = lib;
export {getAddress, namehash, id};

export const POOL = '0x000000c2A20657CE25f2Ba99737933D031AFBEE9', ROUTER = '0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5', MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const RELAYERS = {1: '0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0', 8453: '0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec', 4663: '0xc1F8DAc6BC910A5A794b4795b5F9997e0E8A5Fad'};
export const DEPLOY = {1: 26069245, 8453: 51864014, 4663: 73991661};
export const E = 10n ** 18n, KEY = '11'.repeat(32), PAYER_KEY = '05'.repeat(32);
export const DEV = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
export const DEV_TACIT1 = 'tacit1qzzsx4pc3x9c8ym6q6mz53hkqa26lj4wsapknp474xxglk9r9dj0mu80q2g04y8gt2wgh3xdl6nmemkftsxeya0jcs2p8rjaed4htlfgqcmq5q5axtryqaknkkn47w5ruzd4t56hlrearwjjzhp92mpz7kfu9c2cpf3gxukgxnlm4rgewq5mmqfegdgdfxs0wurtavg8gjwlnzexpvptpkks9k72a9u74tkuns8y6x0gg490z3xd30xvpk6nvp8lpxar36qknkfaah';
export const KEY_TACIT1 = 'tacit1qzzsxne4t0wt0nq27u5w70xwh9s4myrgfw6m9jjlskdtpu9hqsr4sud2qtvmuq4q9swlf55uxmmrlfw9ezfjdzattp93p8hmlg9re4lgr994yq4rgu24e782r5kl9kncq9yt74scx4h2q85tsafmlycp4qsvjqp27u6dukrnm3crr7z38jsg2h2hrwjs769e4jkd9d4gpkhq25mfx7ls2w343ljem2lqqwsylvhg779gn9ye2hp6rgwpl2nt8weweu9k3aetkuyv7k';
export const PAYEE = '0x3e407f4158440F1e5a9E6BA98b0198AEA6d837E3', PAYEE2 = '0xC1D6F3AC3dFd66bb264f732CB5581DE3E232CC21';
export const WNS = '0x0000000000696760e15f265e828db644a0c242eb', GNS = '0x9d51d507bc7264d4fe8ad1cf7fe191933a0a81d6';
export const coder = AbiCoder.defaultAbiCoder();
export const h32 = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0'), rnd = () => BigInt(Math.floor(Math.random() * 2 ** 50)) + 1n;
export const iface = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)', 'function getEthBalance(address) view returns (uint256)',
  'function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[11] pub, address recipient, int256 ext, address relayer, uint256 fee, bytes memo0, bytes memo1)', 'function receiveBoxOf(uint256 npk, uint16 bps) view returns (address)']);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The token pools as the page ships them (chain -> pools), for the in-memory chains.
export const TP = {
  1: [['TAC', 18, '0xa1313eb9f3a445606d9583bcac3ebeb56a858279', '0x0000007F401114398b8fa67b4Bf1e1CFEcd28ffe', '0x000000fA029Eaf69840C1490Bf9AA6C094794D5a', '1-tac'],
    ['USDC', 6, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0x6C0be904750Fe1b50cd7207cc94731642d99e908', '0xe77D82b9A7B686ADc5F31F4cb83286981AC55FE4', '1-xa0b86991c6'],
    ['USDT', 6, '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x73872ceEaADd2C603BD057073D403f08DCB31EB9', '0x5650c850872bc89FC6E22CBB7a51b0e0DAC97198', '1-xdac17f958d']],
  8453: [['USDC', 6, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0xCAf6BE2e337AEcAB4a4eA183452f78800fD1616D', '0x7401aFD518eED7f4656DA367d2Fdd0E527cd7838', '8453-x833589fcd6']],
  4663: [],
};

// Each chain: the ETH pool's Transact logs and tree, token pools beside it, balances, receipts, and what its relay quotes.
export function chains() {
  const C = {};
  for (const cid of [1, 8453, 4663]) {
    const n = C[cid] = {cid, tip: ({1: 26272540, 8453: 53088441, 4663: 97923247}[cid]) + 100, balances: new Map(), receipts: new Map(), txn: 0, fee: 10n ** 13n, relayUp: true, relayDelay: 0, pools: {}, tokBal: new Map(), tokens: new Map(), codes: new Set(), calls: [], sent: [], allowance: new Map(), nonces: new Map()};
    const mk = (pool, token) => {
      const P = {pool, token, logs: [], size: 0, tree: incTree(), roots: new Map(), fee: token ? 20000n : null};
      P.roots.set(String(P.tree.root), 0);
      const hash = () => '0x' + (BigInt(cid) * 10n ** 9n + BigInt(++n.txn)).toString(16).padStart(64, '0');
      P.transact = ({nf, outs, ext = 0n, memos = ['0x', '0x'], recipient = '0x' + '00'.repeat(20), fee = 0n, relayer = '0x' + '00'.repeat(20)}) => {
        const block = ++n.tip, first = P.size, leaves = outs.map((o) => BigInt(o ?? 0n));
        P.tree.append(leaves, []); P.size += 2; P.roots.set(String(P.tree.root), P.size);
        const data = coder.encode(['bytes32', 'bytes32', 'uint256', 'bytes32', 'address', 'int256', 'address', 'uint256', 'bytes', 'bytes'], [h32(leaves[0]), h32(leaves[1]), first, h32(P.tree.root), recipient, ext, relayer, fee, memos[0], memos[1]]);
        const tx = hash(), log = {address: pool, topics: [T_TRANSACT, h32(nf[0]), h32(nf[1])], data, blockNumber: '0x' + block.toString(16), transactionHash: tx, logIndex: '0x0'};
        P.logs.push(log); n.receipts.set(tx, {status: '0x1', logs: [log], blockNumber: log.blockNumber});
        return tx;
      };
      P.deposit = (key, value) => { const s = sealNote({to: poolKeys(Buffer.from(key, 'hex')), value, asset: poolAsset(cid, pool, token || undefined)}); return P.transact({nf: [rnd(), rnd()], outs: [s.leaf, null], ext: value, memos: ['0x' + hex(s.memo), '0x']}); };
      P.sizeAt = (tag) => { if (typeof tag !== 'string' || !/^0x[0-9a-f]+$/i.test(tag)) return P.size; const b = parseInt(tag, 16); return 2 * P.logs.filter((l) => parseInt(l.blockNumber, 16) <= b).length; };
      P.apply = (t) => P.transact({nf: [t.pub[7], t.pub[8]], outs: [t.pub[9], t.pub[10]], ext: BigInt(t.ext), memos: [t.memo0, t.memo1], recipient: t.recipient, fee: BigInt(t.fee), relayer: t.relayer});
      n.pools[pool.toLowerCase()] = P;
      return P;
    };
    n.eth = mk(POOL, null);
    for (const [sym, dec, token, pool, router, pid] of TP[cid]) { const P = mk(pool, token); P.sym = sym; P.dec = dec; P.pid = pid; P.router = router; n.tokens.set(token.toLowerCase(), {sym, dec, name: sym + ' coin'}); }
    n.deposit = (key, value) => n.eth.deposit(key, value);
    n.transfer = (to, value) => { const tx = '0x' + (BigInt(cid) * 10n ** 9n + BigInt(++n.txn)).toString(16).padStart(64, '0'); ++n.tip; n.balances.set(to.toLowerCase(), (n.balances.get(to.toLowerCase()) ?? 0n) + BigInt(value)); n.receipts.set(tx, {status: '0x1', logs: [], blockNumber: '0x' + n.tip.toString(16)}); return tx; };
    n.poolByRelay = (pid) => Object.values(n.pools).find((P) => P.pid === pid) || n.eth;
  }
  return C;
}
export const chainOf = (host) => (/base/.test(host) ? 8453 : /robinhood/.test(host) ? 4663 : 1);

// Names: WNS records by namehash. `env.names[name] = {text, addr}`.
export function answer(env, n, {method, params = []}, host = '') {
  n.calls.push(method);
  if (method === 'eth_chainId') return '0x' + n.cid.toString(16);
  if (method === 'eth_gasPrice') return '0x' + (1_000_000_000n).toString(16);
  if (method === 'eth_blockNumber') return '0x' + n.tip.toString(16);
  if (method === 'eth_getBalance') return '0x' + (n.balances.get(params[0].toLowerCase()) ?? 0n).toString(16);
  if (method === 'eth_getCode') { const a = params[0].toLowerCase(); return (a === POOL.toLowerCase() || a === ROUTER.toLowerCase() || Object.keys(n.pools).includes(a) || n.codes.has(a) || Object.values(n.pools).some((P) => P.router && P.router.toLowerCase() === a)) ? '0x6080' : '0x'; }
  if (method === 'eth_getTransactionReceipt') return n.receipts.get(params[0]) ?? null;
  if (method === 'eth_getTransactionByHash') return n.receipts.has(params[0]) ? {hash: params[0], blockNumber: '0x1', nonce: '0x0', from: DEV.address.toLowerCase()} : null;
  if (method === 'eth_getTransactionCount') return '0x0';
  if (method === 'eth_getBlockByNumber') return {number: params[0], timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), baseFeePerGas: '0x' + (2_000_000_000n).toString(16)};
  if (method === 'eth_estimateGas') return '0x7a120';
  if (method === 'eth_getLogs') {
    const f = params[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
    const out = [];
    for (const P of Object.values(n.pools)) for (const l of P.logs) if ([].concat(f.address).some((x) => x.toLowerCase() === l.address.toLowerCase()) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && (f.topics || []).every((t, i) => !t || (Array.isArray(t) ? t.includes(l.topics[i]) : t === l.topics[i]))) out.push(l);
    return out;
  }
  if (method === 'eth_call') {
    const to = params[0].to.toLowerCase(), data = params[0].data, sel = data.slice(0, 10);
    if (to === MULTICALL.toLowerCase()) {
      const [calls] = iface.decodeFunctionData('aggregate3', data);
      return iface.encodeFunctionResult('aggregate3', [calls.map((c) => {
        const t = c.target.toLowerCase(), P = n.pools[t];
        if (P) return [true, coder.encode(['uint256'], [P.sizeAt(params[1])])];
        if (c.callData.startsWith(iface.getFunction('getEthBalance').selector)) return [true, coder.encode(['uint256'], [n.balances.get(iface.decodeFunctionData('getEthBalance', c.callData)[0].toLowerCase()) ?? 0n])];
        const rg = registryCall(t, c.callData);
        if (rg != null) return [true, rg];
        const r = tokenCall(env, n, t, c.callData);
        return r == null ? [false, '0x'] : [true, r];
      })]);
    }
    for (const [a, P] of Object.entries(n.pools)) {
      if (to === a && sel === id('nextIndex()').slice(0, 10)) return coder.encode(['uint256'], [P.sizeAt(params[1])]);
      if (to === a && sel === id('rootSize(bytes32)').slice(0, 10)) return coder.encode(['uint256'], [P.roots.get(String(BigInt('0x' + data.slice(10)))) ?? 0n]);
    }
    if (to === ROUTER.toLowerCase() && sel === iface.getFunction('receiveBoxOf').selector) return coder.encode(['address'], [receiveBoxAddress(ROUTER, BigInt(iface.decodeFunctionData('receiveBoxOf', data)[0]))]);
    if (to === WNS.toLowerCase() || to === GNS.toLowerCase()) {
      if (data.startsWith('0x59d1d43c')) { const nm = env.byNode['0x' + data.slice(10, 74)]; return coder.encode(['string'], [nm?.text ?? '']); }
      if (data.startsWith('0x4f896d4f')) { const nm = env.byNode['0x' + data.slice(10, 74)]; return coder.encode(['address'], [nm?.addr ?? '0x' + '00'.repeat(20)]); }
    }
    const rg = registryCall(to, data);
    if (rg != null) return rg;
    const tr = tokenCall(env, n, to, data);
    if (tr != null) return tr;
    if (to === TLIST.toLowerCase()) {
      if (env.listFail) throw new Error('list node down');
      if (data.startsWith('0xdf7ca268')) return coder.encode(['bytes32[]'], [env.list.map((_, i) => h32(BigInt(i + 1)))]);
      if (data.startsWith('0xac9650d8')) return coder.encode(['bytes[]'], [env.list.map((t) => coder.encode(['bytes'], ['0x' + Buffer.from(JSON.stringify({k: 'eip155', p: 'ERC-20', a: t.addr, c: t.chainId, s: t.sym, n: t.name, d: t.dec})).toString('hex')]))]);
    }
    if (to === '0x1a07cc4bd17e0118bdb54d70990d2158abad7a2d' && sel === id('calculateRetryableSubmissionFee(uint256,uint256)').slice(0, 10)) return coder.encode(['uint256'], [3n * 10n ** 13n]);
    if (to === ZQUOTER) { const r = quoterAnswer(env, n, data); if (r != null) return r; return '0x'; }
    if (to === POOL.toLowerCase() || to === ROUTER.toLowerCase()) return '0x';
    return '0x' + '00'.repeat(31) + '01';                                 // the verifier, and anything else asked
  }
  return null;
}
const CHECKPOINTS = '0x00000000C3267616ED5E0DAA6F6490D109d6844D'.toLowerCase(), HUB = '0x00000000C824B4F120C03f4Bdd4Bf4656232E835'.toLowerCase();
function registryCall(to, data) {
  if (to !== CHECKPOINTS && to !== HUB) return null;
  return coder.encode(['uint256'], [0n]);          // a registry with no point yet
}
export const TLIST = '0x0000006013dF75A31678B786061C2B54bf531524';
export const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b';
// zQuoter's single best route (e7798987): [source, 0, amountIn, amountOut, offset, 0, value, len, data]; exact-out when the flag word is 1.
function quoterAnswer(env, n, data) {
  if (!data.startsWith('0xe7798987')) return null;
  const w = (i) => BigInt('0x' + data.slice(10 + 64 * i, 74 + 64 * i));
  const stand = data.slice(10 + 24, 10 + 64), flag = w(1), tin = ('0x' + data.slice(10 + 64 * 2 + 24, 10 + 64 * 3)).toLowerCase(), tout = ('0x' + data.slice(10 + 64 * 3 + 24, 10 + 64 * 4)).toLowerCase(), amount = w(4);
  const ZERO = '0x' + '00'.repeat(20);
  const usd = { [ZERO]: [3000n, 18], ...(env.usd || {}) };
  if (!usd[tin] && env.px?.[tout] == null) return null;
  // legacy: env.px[token] = token units per 1 ETH (ETH in, token out)
  if (!env.usd && env.px?.[tout] != null && tin === ZERO) { const px = env.px[tout]; const inp = flag === 1n ? amount * 10n ** 18n / px : amount, out = flag === 1n ? amount : amount * px / 10n ** 18n; return build(inp, out); }
  if (!usd[tin] || !usd[tout]) return null;
  const [ui, di] = usd[tin], [uo, doo] = usd[tout];
  // value in USD micro-units: amount * usd / 10^dec
  const conv = (amt, from, to) => amt * from[0] * 10n ** BigInt(to[1]) / (to[0] * 10n ** BigInt(from[1]));
  const inp = flag === 1n ? conv(amount, usd[tout], usd[tin]) : amount, out = flag === 1n ? amount : conv(amount, usd[tin], usd[tout]);
  return build(inp, out);
  function build(inp, out) {
    const calldata = '12345678' + '00'.repeat(12) + stand + '00'.repeat(32);
    const val = tin === ZERO ? inp : 0n;
    const body = [3n, 0n, inp, out, 7n * 32n, 0n, val, BigInt(calldata.length / 2)].map((x) => x.toString(16).padStart(64, '0')).join('') + calldata.padEnd(Math.ceil(calldata.length / 64) * 64, '0');
    env.quotes = (env.quotes || 0) + 1;
    return '0x' + body;
  }
}
function tokenCall(env, n, to, data) {
  const t = n.tokens.get(to);
  if (!t) return null;
  const sel = data.slice(0, 10);
  if (sel === '0x313ce567') return coder.encode(['uint8'], [t.dec]);
  if (sel === '0x95d89b41') return coder.encode(['string'], [t.sym]);
  if (sel === '0x06fdde03') return coder.encode(['string'], [t.name]);
  if (sel === '0x18160ddd') return coder.encode(['uint256'], [10n ** 12n]);
  if (sel === '0x70a08231') return coder.encode(['uint256'], [n.tokBal.get(to + ':' + ('0x' + data.slice(34, 74)).toLowerCase()) ?? 0n]);
  if (sel === '0xdd62ed3e') return coder.encode(['uint256'], [n.allowance.get(to + ':' + ('0x' + data.slice(34, 74)).toLowerCase() + ':' + ('0x' + data.slice(98, 138)).toLowerCase()) ?? 0n]);
  return null;
}

export function mkEnv() {
  const env = {C: chains(), list: [], px: {}, names: {}, byNode: {}, calls: [], relayLog: [], relayMode: {}, quoter: null, relayHook: null};
  env.setName = (name, rec) => { env.names[name] = rec; env.byNode[h32(BigInt(namehash(name)))] = rec; };
  return env;
}

// A wallet in the page (EIP-6963): `modes` makes a method hang, refuse (code 4001), or answer after `delay` ms.
const WALLET = `(() => {
  const w = window.__W, on = {}, st = { chain: '0x1', authorized: false };
  window.__log = [];
  const p = window.__wallet = {
    on(ev, f) { (on[ev] ||= []).push(f); }, removeListener() {}, emit(ev, v) { for (const f of on[ev] || []) f(v); },
    async request({ method, params = [] }) {
      window.__log.push(method);
      const mode = (window.__modes || {})[method];
      if (mode === 'hang') return new Promise(() => {});
      if (mode === 'reject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (mode?.delay) await new Promise((r) => setTimeout(r, mode.delay));
      if (mode?.reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (method === 'eth_requestAccounts') { st.authorized = true; return [w.account]; }
      if (method === 'eth_accounts') return st.authorized ? [w.account] : [];
      if (method === 'eth_chainId') return st.chain;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { st.chain = params[0].chainId; p.emit('chainChanged', st.chain); return null; }
      if (method === 'eth_getCode') return '0x';
      if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice'].includes(method)) return window.__read(parseInt(st.chain, 16), method, params);
      if (method === 'personal_sign') return window.__sign(params[0]);
      if (method === 'eth_sendTransaction') return window.__send(parseInt(st.chain, 16), params[0]);
      throw Object.assign(new Error('not in this test: ' + method), { code: 4200 });
    },
  };
  const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), name: 'Alpha', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.alpha' }, provider: p });
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })));
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
})();`;

let server = null, browser = null, ORIGIN = '';
export async function boot() {
  server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
  ORIGIN = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
}
export async function shutdown() { try { await browser?.close(); } catch {} try { server?.close(); } catch {} }

export async function open(env, {hash = '', modes = null, viewport = {width: 390, height: 844}, delay = 0, artifacts = !!process.env.ARTIFACTS} = {}) {
  const C = env.C;
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write'], viewport});
  const cors = {'access-control-allow-origin': '*'};
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (process.env.ARTIFACTS && /\/(transact\.wasm|transact_final\.zkey)$/.test(url.pathname)) return route.fulfill({status: 200, headers: cors, body: fs.readFileSync(`${process.env.ARTIFACTS}/${url.pathname.split('/').pop()}`)});
    if (/onrender\.com$/.test(url.host)) {
      const m = /^\/([^/]+)\/evm-pool\/keeper(.*)$/.exec(url.pathname) || [];
      const pid = m[1] || '1', path = m[2] || '', cid = /^\d+$/.test(pid) ? Number(pid) : Number(pid.split('-')[0]), n = C[cid];
      const P = /^\d+$/.test(pid) ? n.eth : n.poolByRelay(pid);
      const json = (status, body) => route.fulfill({status, contentType: 'application/json', headers: cors, body: JSON.stringify(body)});
      env.relayLog.push({path, search: url.search, pid, method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null});
      if (env.relayHook) { const r = await env.relayHook({path, pid, cid, n, P, req, json, route}); if (r !== undefined) return r; }
      if (n.relayDelay) await new Promise((r) => setTimeout(r, n.relayDelay));
      if (!n.relayUp) return json(503, {error: 'offline'});
      if (path.startsWith('/quote')) return json(200, {chainId: cid, pool: P.pool, relayer: RELAYERS[cid], fee: String(P.token ? P.fee : n.fee), gas: '400000', receiveMin: P.token ? '1000000' : '400000000000000'});
      if (path.startsWith('/events')) return json(404, {error: 'no index'});
      if (path === '/receive') return json(200, {ok: true});
      if (path === '/head') return json(404, {});
      if (path === '/reserve') return json(404, {});
      if (path === '/cancel') return json(200, {ok: true});
      if (path === '/deposit') return json(200, {ok: true});
      if (path === '/relay' && n.relayDrop) return route.abort();
      if (path === '/relay') { const {tx} = JSON.parse(req.postData()); return json(200, {txHash: P.apply({...tx, pub: tx.publicInputs, ext: tx.extAmount})}); }
      return json(404, {error: 'no'});
    }
    if (req.method() === 'POST') {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (env.flaky && Math.random() < env.flaky) return route.fulfill({status: 503, contentType: 'application/json', headers: cors, body: '{"error":"busy"}'});
      const body = JSON.parse(req.postData() || '{}'), n = C[chainOf(url.host)];
      const reply = (b) => { env.seen?.push({host: url.host, method: b.method, to: b.params?.[0]?.to?.toLowerCase(), data: b.params?.[0]?.data}); try { return {jsonrpc: '2.0', id: b.id, result: answer(env, n, b, url.host)}; } catch (e) { return {jsonrpc: '2.0', id: b.id, error: {code: -32000, message: String(e.message || e)}}; } };
      return route.fulfill({status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
    }
    return route.fulfill({status: 503, headers: cors, body: '{}'});
  });
  await ctx.exposeFunction('__sign', (h) => DEV.signMessage(Buffer.from(h.slice(2), 'hex')));
  await ctx.exposeFunction('__read', (cid, method, params) => (C[cid] ? answer(env, C[cid], {method, params}) : null));
  await ctx.exposeFunction('__send', async (cid, tx) => {
    const n = C[cid];
    n.sent.push(tx);
    if (env.sendHook) { const r = await env.sendHook(cid, tx); if (r !== undefined) return r; }
    if (tx.to.toLowerCase() !== POOL.toLowerCase()) return n.transfer(tx.to, BigInt(tx.value || 0));
    const d = iface.decodeFunctionData('transact', tx.data);
    return n.eth.apply({pub: d.pub.map(String), recipient: d.recipient, ext: d.ext, relayer: d.relayer, fee: d.fee, memo0: d.memo0, memo1: d.memo1});
  });
  await ctx.addInitScript(`window.__W = ${JSON.stringify({account: DEV.address.toLowerCase()})}; window.__modes = ${JSON.stringify(modes || {})};`);
  await ctx.addInitScript(WALLET);
  await ctx.addInitScript(`window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true });`);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(ORIGIN + (hash ? '#' + hash : ''));
  await p.waitForTimeout(300);
  return p;
}
export const signIn = async (p, key = KEY) => {
  if (!(await p.evaluate(() => document.querySelector('#sheet-wallet')?.open))) await p.click('#wallet');
  await p.click('#sheet-wallet [data-in="paste"]');
  await p.fill('#sheet-wallet .opts input', key); await p.click('#sheet-wallet [data-in="key"]');
  await p.waitForFunction(() => /^tacit1/.test(document.querySelector('#wallet-label').textContent));
  await p.evaluate(() => { const d = document.querySelector('#sheet-wallet'); if (d?.open) d.close(); });
};
export const until = (p, fn, arg, ms = 15e3) => p.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
export const label = (p) => p.textContent('#f-go');
export const txt = async (p, sel) => ((await p.textContent(sel).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
export const toasts = (p) => p.evaluate(() => window.__toasts.splice(0));
let failures = 0;
export const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== '' && !c ? '  ' + x : '')); if (!c) failures++; return c; };
export const info = (m, x = '') => console.log('  INFO  ' + m + (x !== '' ? '  ' + x : ''));
export const done = async () => { await shutdown(); console.log(failures ? `\n${failures} FAILED` : '\ndone'); process.exit(0); };
