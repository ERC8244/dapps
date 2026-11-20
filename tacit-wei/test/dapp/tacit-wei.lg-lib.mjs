/* The large pools (Tornado Cash) on the in-memory chain of forms-lib.mjs: the nine fixed pools (code, denomination(),
   commitments(), isSpent(), nextIndex(), isKnownRoot(), balances, Deposit and Withdrawal logs), the split forwarder and the split zap, and
   a wallet that also signs EIP-712 typed data (deterministically, with the harness's key) and keeps its connection across a
   reload. A splitDeposit sent to the forwarder puts its commitments into their pools, as the chain would. */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {Interface, id, getAddress} from 'ethers';
import * as H from './forms-lib.mjs';
import {html as HTML} from './page-config.mjs';
import {loadTC} from './tornado-lib.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const {coder, DEV, POOL, RELAYERS, E} = H;

// The page's own TC (from the readable source), to compute in Node what the page should compute in the browser.
const LOADED = loadTC({page: new URL('../../dapp/page.html', import.meta.url)});
export const {TC} = LOADED;
// An expression in the same context (the page's primitives and parts: PQ among them).
const {default: vmMod} = await import('node:vm');
export const vmEval = (code) => vmMod.runInContext(code, LOADED.ctx);
export const FORWARDER = '0x0000000000049541f6582aB13C0b3a8dC35165Ae', SPLITZAP = '0x000000000003f50439AA073fE48bb8E20313354f';
export const TPR = '0x0000000000029534a955A164223417fc5f4fA405';
export const TX_SIG = '(uint256[2],uint256[2][2],uint256[2],uint256[11],address,int256,address,uint256,bytes,bytes)';
export const fwdIface = new Interface([`function splitDeposit(address[] pools, bytes32[] commitments, ${TX_SIG} t) payable`]);
export const DEPOSIT_TOPIC = id('Deposit(bytes32,uint32,uint256)'), WITHDRAWAL_TOPIC = id('Withdrawal(address,bytes32,address,uint256)');
const S = (sig) => id(sig).slice(0, 10);
const SEL = {denomination: S('denomination()'), commitments: S('commitments(bytes32)'), isSpent: S('isSpent(bytes32)'), nextIndex: '0xfc7e9c6f', isKnownRoot: S('isKnownRoot(bytes32)'), tacitPool: S('TACIT_POOL()'), denominationOf: S('denominationOf(address)')};
const word = (x) => coder.encode(['uint256'], [BigInt(x)]);
const lc = (a) => String(a).toLowerCase();
export const b32 = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0');

// The fixed pools' state, kept on env.tc: commitments (with their Deposit logs) and spent nullifier hashes per pool.
export function lgState(env, {base = 100_000} = {}) {
  const pools = new Map();
  // the newer pools are read from their deployment, so their leaf numbers start at 0
  for (const p of [...TC.POOLS, ...TC.MORE_POOLS]) pools.set(lc(p.address), {address: p.address, den: BigInt(p.denomination), commits: new Set(), spent: new Set(), logs: [], wlogs: [], base: TC.MORE_POOLS.includes(p) ? 0 : base});
  const tc = env.tc = {pools, calls: [], deposited: []};
  tc.deposit = (pool, commitment) => {
    const P = pools.get(lc(pool)), c = lc(b32(commitment)), n = env.C[1];
    if (P.commits.has(c)) return;
    P.commits.add(c);
    const block = ++n.tip, i = P.base + P.logs.length;
    P.logs.push({address: P.address, topics: [DEPOSIT_TOPIC, c], data: coder.encode(['uint32', 'uint256'], [i, Math.floor(Date.now() / 1000)]), blockNumber: '0x' + block.toString(16), transactionHash: b32(BigInt(block) * 7n), logIndex: '0x0', removed: false});
    tc.deposited.push({pool: P.address, c});
  };
  // a withdrawal: the nullifier hash spent, and its Withdrawal log (to, nullifier hash, fee; the relayer as a topic)
  tc.spend = (pool, nh, to = '0x' + '00'.repeat(20)) => {
    const P = pools.get(lc(pool)), block = ++env.C[1].tip;
    P.spent.add(lc(b32(nh)));
    P.wlogs.push({address: P.address, topics: [WITHDRAWAL_TOPIC, b32(0)], data: coder.encode(['address', 'bytes32', 'uint256'], [to, b32(nh), 0]), blockNumber: '0x' + block.toString(16), transactionHash: b32(BigInt(block) * 11n), logIndex: '0x0', removed: false});
  };
  return tc;
}

// The fixed pools' answers, or undefined for a call that is not theirs.
export function lgAnswer(env, n, {method, params = []}) {
  const tc = env.tc;
  if (!tc) return undefined;
  if (method === 'eth_getCode') { const a = lc(params[0]); if (tc.pools.has(a) || a === lc(FORWARDER) || a === lc(SPLITZAP)) return '0x6080604052'; return undefined; }
  if (method === 'eth_getBalance') { const P = tc.pools.get(lc(params[0])); if (P) return '0x' + (P.den * BigInt(P.base + P.logs.length) / 3n).toString(16); return undefined; }
  if (method === 'eth_feeHistory') return {oldestBlock: '0x' + (n.tip - 4).toString(16), baseFeePerGas: Array(6).fill('0x' + (2_000_000_000n).toString(16)), gasUsedRatio: Array(5).fill(0.5), reward: Array(5).fill(['0x' + (100_000_000n).toString(16)])};
  if (method === 'eth_getLogs') {
    const f = params[0], addrs = [].concat(f.address || []).map(lc);
    // the ERC-5564 announcer: env.announced, filtered by topics
    // (env.announceReqs: the topics each read asked for; env.announcedDown: every read refused, as a node without the range would)
    if (addrs.includes('0x55649e01b5df198d18d95b5cc5051630cfd45564')) (env.announceReqs ||= []).push(f.topics || []);
    if (addrs.includes('0x55649e01b5df198d18d95b5cc5051630cfd45564') && env.announcedDown) throw new Error('internal error');
    if (addrs.includes('0x55649e01b5df198d18d95b5cc5051630cfd45564')) return (env.announced || []).filter((l) => (f.topics || []).every((t, i) => !t || [].concat(t).map(lc).includes(lc(l.topics[i]))));
    if (!addrs.some((a) => tc.pools.has(a))) return undefined;
    const from = parseInt(f.fromBlock, 16), to = f.toBlock === 'latest' || !f.toBlock ? Infinity : parseInt(f.toBlock, 16), out = [];
    for (const a of addrs) for (const l of [...(tc.pools.get(a)?.logs || []), ...(tc.pools.get(a)?.wlogs || [])]) {
      const b = parseInt(l.blockNumber, 16);
      if (b >= from && b <= to && (f.topics || []).every((t, i) => !t || [].concat(t).map(lc).includes(lc(l.topics[i])))) out.push(l);
    }
    return out;
  }
  if (method === 'eth_call') {
    const to = lc(params[0].to), data = lc(params[0].data || '0x'), sel = data.slice(0, 10), arg = '0x' + data.slice(10, 74);
    const P = tc.pools.get(to);
    if (P) {
      tc.calls.push({to, sel, arg});
      if (sel === SEL.denomination) return word(P.den);
      if (sel === SEL.commitments) return word(P.commits.has(arg) ? 1 : 0);
      if (sel === SEL.isSpent) return word(P.spent.has(arg) ? 1 : 0);
      if (sel === SEL.nextIndex) return word(P.base + P.logs.length);
      if (sel === SEL.isKnownRoot) return word(1);
      return '0x';
    }
    // The page's registry (TacitPayRegistry): no flags and empty lists unless env.regFlags says otherwise. forms-lib's
    // catch-all answers it with the word 1, which the page reads as flags = 1 (the split switched off).
    if (to === lc(TPR)) return coder.encode(['uint256', 'string[][]'], [BigInt(env.regFlags ?? 0), Array.from({length: 11}, () => [])]);
    if (to === lc(FORWARDER)) {
      if (sel === SEL.tacitPool) return coder.encode(['address'], [POOL]);
      if (sel === SEL.denominationOf) { const p = TC.POOLS.find((x) => lc(x.address) === '0x' + arg.slice(26)); return word(p ? p.denomination : 0n); }
      return '0x';
    }
  }
  return undefined;
}
export const answer = (env, n, req, host) => { const r = lgAnswer(env, n, req); return r !== undefined ? r : H.answer(env, n, req, host); };

// The wallet: forms-lib's, plus eth_signTypedData_v4 (window.__signTyped), and a connection kept for the tab's session.
const WALLET = `(() => {
  const w = window.__W, on = {}, st = { chain: '0x1', authorized: sessionStorage.getItem('__authorized') === '1' };
  window.__log = [];
  const p = window.__wallet = {
    on(ev, f) { (on[ev] ||= []).push(f); }, removeListener() {}, emit(ev, v) { for (const f of on[ev] || []) f(v); },
    async request({ method, params = [] }) {
      window.__log.push(method);
      const mode = (window.__modes || {})[method];
      if (mode === 'reject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (mode === 'hang') return new Promise(() => {});   // the wallet asked, never answering (the tab closes meanwhile)
      if (method === 'eth_requestAccounts') { st.authorized = true; sessionStorage.setItem('__authorized', '1'); return [w.account]; }
      if (method === 'eth_accounts') return st.authorized ? [w.account] : [];
      if (method === 'eth_chainId') return st.chain;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { st.chain = params[0].chainId; p.emit('chainChanged', st.chain); return null; }
      if (method === 'eth_getCode') return '0x';
      if (['eth_call', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_getBlockByNumber'].includes(method)) return window.__read(parseInt(st.chain, 16), method, params);
      if (method === 'personal_sign') return window.__sign(params[0]);
      if (method === 'eth_signTypedData_v4') return window.__signTyped(params[0], params[1]);
      if (method === 'eth_sendTransaction') return window.__send(parseInt(st.chain, 16), params[0]);
      throw Object.assign(new Error('not in this test: ' + method), { code: 4200 });
    },
  };
  const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), name: 'Alpha', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'test.alpha' }, provider: p });
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })));
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
})();`;

// What the wallet signs for a note number: the keychain's typed data, signed by the harness's key (RFC 6979, so the same each time).
export async function signNote(nonce) {
  const t = TC.noteTypedData(nonce), types = {...t.types};
  delete types.EIP712Domain;
  return DEV.signTypedData(t.domain, types, t.message);
}
// The note the page should make for number `nonce` in `pool`: signed in with the harness's Tacit key (H.KEY), from the seed
// HMAC-SHA256(key, "tacit-wei-tornado-v1") with no signature (scheme 'k'); with `signed`, from the wallet's signature ('w').
const {createHmac} = await import('node:crypto');
export const NOTES_SEED = new Uint8Array(createHmac('sha256', Buffer.from(H.KEY, 'hex')).update('tacit-wei-tornado-v1').digest());
export async function noteFor(nonce, pool, {signed = false} = {}) {
  const s = signed ? TC.deriveSecrets(await signNote(nonce), pool) : TC.secretsOf(TC.seedRS(NOTES_SEED, nonce), pool);
  return {nonce, pool: getAddress(pool), secrets: s, s: signed ? 'w' : 'k', c: b32(s.commitment), nh: b32(s.nullifierHash), text: TC.noteString(TC.poolOf(pool).denomination, s.preimage)};
}
export const metaOf = (n) => ({nonce: n.nonce, pool: n.pool, c: n.c, nh: n.nh, ...(n.s === 'k' ? {s: 'k'} : {})});

let server = null, browser = null, ORIGIN = '';
export async function boot() {
  server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
  ORIGIN = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
}
export async function shutdown() { try { await browser?.close(); } catch {} try { server?.close(); } catch {} }

// A page on env's chain. `seed`: localStorage entries set once, before the first load; `connected`: the wallet starts connected.
export async function open(env, {seed = {}, connected = false, viewport = {width: 390, height: 844}, pqAsk = false} = {}) {
  const C = env.C, n = C[1];
  env.signs = env.signs || []; env.typed = env.typed || [];
  const ctx = await browser.newContext({viewport, acceptDownloads: true});
  await ctx.addInitScript(pqAsk ? 'window.__pqAsk = true;' + H.PQ_LATER : H.PQ_LATER);
  const cors = {'access-control-allow-origin': '*'};
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (/onrender\.com$/.test(url.host)) {
      const m = /^\/([^/]+)\/evm-pool\/keeper(.*)$/.exec(url.pathname) || [], path = m[2] || '', P = n.eth;
      const json = (status, body) => route.fulfill({status, contentType: 'application/json', headers: cors, body: JSON.stringify(body)});
      env.relayLog.push({path, method: req.method()});
      if (!n.relayUp) return json(503, {error: 'offline'});
      if (path.startsWith('/quote')) return json(200, {chainId: 1, pool: P.pool, relayer: RELAYERS[1], fee: String(n.fee), gas: '400000', receiveMin: '400000000000000'});
      if (path === '/receive' || path === '/cancel' || path === '/deposit') return json(200, {ok: true});
      return json(404, {error: 'no'});
    }
    if (req.method() === 'POST') {
      let body;
      try { body = JSON.parse(req.postData() || '{}'); } catch { return route.fulfill({status: 400, headers: cors, body: '{}'}); }
      const reply = (b) => { try { return {jsonrpc: '2.0', id: b.id, result: answer(env, n, b, url.host)}; } catch (e) { return {jsonrpc: '2.0', id: b.id, error: {code: -32000, message: String(e.message || e)}}; } };
      return route.fulfill({status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))});
    }
    return route.fulfill({status: 503, headers: cors, body: '{}'});
  });
  await ctx.exposeFunction('__sign', (h) => DEV.signMessage(Buffer.from(h.slice(2), 'hex')));
  await ctx.exposeFunction('__signTyped', async (account, json) => {
    const t = JSON.parse(json), types = {...t.types};
    env.typed.push({account, ...t});
    delete types.EIP712Domain;
    return DEV.signTypedData(t.domain, types, t.message);
  });
  await ctx.exposeFunction('__read', (cid, method, params) => answer(env, C[cid] || n, {method, params}));
  await ctx.exposeFunction('__send', async (cid, tx) => {
    n.sent.push(tx);
    const hash = b32(BigInt(cid) * 10n ** 12n + BigInt(++n.txn)), block = ++n.tip;
    if (lc(tx.to) === lc(FORWARDER) && !env.noLand) {   // env.noLand: mined, its notes not (yet) in their pools
      const d = fwdIface.decodeFunctionData('splitDeposit', tx.data);
      d.pools.forEach((p, i) => env.tc.deposit(p, d.commitments[i]));
    } else if (env.tc?.pools.has(lc(tx.to)) && lc(tx.data).startsWith('0xb214faa5')) env.tc.deposit(tx.to, '0x' + tx.data.slice(10, 74));
    n.receipts.set(hash, {status: '0x1', logs: [], blockNumber: '0x' + block.toString(16), transactionHash: hash});
    return hash;
  });
  await ctx.addInitScript(`window.__W = ${JSON.stringify({account: DEV.address.toLowerCase()})};`);
  await ctx.addInitScript(`try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, s[k]); ${connected ? `localStorage.setItem('tacit-pay-wallet-v1', 'test.alpha'); sessionStorage.setItem('__authorized', '1');` : ''} } } catch {}`);
  await ctx.addInitScript(WALLET);
  // The relay here is a stand-in at the relay's own address, so the page reaches it directly (Endpoints' choice).
  await ctx.addInitScript(`try { const k = 'tacit-pay-endpoints-v1', e = JSON.parse(localStorage.getItem(k) || '{}'); if (!('direct' in e)) { e.direct = true; localStorage.setItem(k, JSON.stringify(e)); } } catch {}`);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(ORIGIN);
  await p.waitForTimeout(300);
  return p;
}
export const close = (p) => p.context().close().catch(() => {});
export {E};
