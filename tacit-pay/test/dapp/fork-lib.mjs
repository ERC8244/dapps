/* Shared by the fork tests: the deployed page in Chromium over anvil forks of the chains' real pools, with a
   wallet that sends from a development account, and relays that are down or are a mock whose behaviour a test sets.
   Every proof is made in the page by its own prover and accepted by the deployed pool.

   The proving key (28.5 MB) and witness program (4.9 MB) are fetched by the page from its mirrors and checked against
   their hashes; ARTIFACTS=<dir holding transact.wasm and transact_final.zkey> serves them from disk instead, and
   OFFLINE=1 refuses every mirror so the key must come from disk through the page's own file picker.

   Forks come from FORK_<CHAIN>_RPC (ETHEREUM, BASE, ROBINHOOD), else a public node that serves old state.        */
import fs from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {config, html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const {Interface, id: keccakId} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const HEAD_ROOT = keccakId('root()').slice(2, 10), HEAD_NEXT = keccakId('nextIndex()').slice(2, 10);
export const {POOL, ROUTER, CHAINS, RELAYERS, MAX_RELAY_FEE} = config;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
export const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined && extra !== '' ? '  ' + extra : ''));
  if (!cond) failures++;
};
export const finish = (cleanup) => { cleanup(); console.log(failures ? `\n${failures} FAILED` : '\nall passed'); process.exit(failures ? 1 : 0); };

// Robinhood's own node answers anvil with a bot-protection page, so its second public node is the fork source.
const FORK_FROM = {ethereum: 'https://mainnet.gateway.tenderly.co', base: 'https://mainnet.base.org', robinhood: 'https://robinhood.drpc.org'};
// The first development account, as a plain account: on real chains it carries delegation code.
export const ACCT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const TRANSACT = new Interface(['function transact(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[11] publicInputs, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1)']);
const ROUTER_CALL = new Interface(['function withdrawAndCall((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[11] publicInputs, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1) t, ((address target, uint256 value, address token, uint256 amount, bool push, bytes data)[] calls, address[] outTokens, uint256[] minOuts, address to, address refund, uint64 deadline, uint256 nonce) intent)']);

export const hexKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Forks `names` (chain keys), serves the page, and returns the harness. `relay` is the mock relay's state, or null for
 *  relays that are down: { mode, fee, relayer, quote, events, calls }. */
// `realCalls`: contracts whose eth_call reads are answered by the chain itself rather than the fork (read-only contracts
// whose state a fork would fetch slot by slot, such as a token list or a quoter); everything else is the fork's.
export async function startFork(names, {relay = null, account = ACCT, endpoints = null, blockTime = 0, passthrough = [], realCalls = [], batch = false} = {}) {
  const forks = {};
  for (const name of names) {
    const c = CHAINS.find((x) => x.key === name);
    const port = 18545 + Math.floor(Math.random() * 4000), url = `http://127.0.0.1:${port}`;
    const from = process.env[`FORK_${name.toUpperCase()}_RPC`] || FORK_FROM[name];
    const anvil = spawn('anvil', ['--port', String(port), '--fork-url', from, '--chain-id', String(c.chainId), '--silent', '--no-rate-limit', ...(blockTime ? ['--block-time', String(blockTime)] : [])], {stdio: 'ignore'});
    process.on('exit', () => anvil.kill('SIGKILL'));
    // A public node behind anvil sometimes answers a burst of state requests with a challenge page; asking again works.
    const rpc = async (method, params = []) => {
      for (let i = 0; ; i++) {
        const r = await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})})).json();
        if (!r.error) return r.result;
        if (i < 6 && /HTTP error (403|429|5\d\d)|Just a moment|rate limit/i.test(r.error.message)) { await sleep(2500 * (i + 1)); continue; }
        throw new Error(`${name} ${method}: ${r.error.message.slice(0, 200)}`);
      }
    };
    forks[name] = {c, url, anvil, rpc};
  }
  for (const f of Object.values(forks)) {
    for (let i = 0; ; i++) { try { await f.rpc('eth_chainId'); break; } catch { if (i > 240) throw new Error(`anvil for ${f.c.key} did not start`); await sleep(500); } }
    f.forkBlock = Number(BigInt(await f.rpc('eth_blockNumber')));
    await f.rpc('anvil_impersonateAccount', [account]);
    await f.rpc('anvil_setCode', [account, '0x']);
    await f.rpc('anvil_setBalance', [account, '0x' + (100n * 10n ** 18n).toString(16)]);
    const rl = RELAYERS[f.c.chainId];
    await f.rpc('anvil_impersonateAccount', [rl]); await f.rpc('anvil_setCode', [rl, '0x']);
    await f.rpc('anvil_setBalance', [rl, '0x' + (10n * 10n ** 18n).toString(16)]);
  }
  const byHost = new Map();
  for (const f of Object.values(forks)) for (const u of f.c.rpc) byHost.set(new URL(u).host, f);
  const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
  const browser = await chromium.launch();
  const cors = {'access-control-allow-origin': '*'};
  const json = (route, status, body) => route.fulfill({status, contentType: 'application/json', headers: cors, body: JSON.stringify(body)}).catch(() => {});

  const passHosts = new Set(passthrough.flatMap((k) => CHAINS.find((c) => c.key === k).rpc.map((u) => new URL(u).host)));
  async function relayRoute(route) {
    const req = route.request(), u = new URL(req.url());
    const f = Object.values(forks).find((x) => x.c.relay && u.href.startsWith(x.c.relay));
    const path = u.href.slice(f ? f.c.relay.length : 0).split('?')[0];
    if (!relay || !f || relay.mode === 'down') return json(route, 503, {error: 'down'});
    const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
    relay.calls.push({chain: f.c.key, path, body});
    if (path === '/quote') {
      const q = {chainId: f.c.chainId, pool: POOL, relayer: RELAYERS[f.c.chainId], fee: String(relay.fee), ...relay.quote};
      return json(route, 200, typeof relay.quote === 'function' ? relay.quote(q, f.c) : q);
    }
    if (path === '/events') return relay.events ? json(route, 200, relay.events(f.c, u)) : json(route, 503, {error: 'no index'});
    if (path === '/reserve') return relay.reserve === 'tail' ? json(route, 403, {error: 'reservations are paused for this connection'}) : json(route, 404, {error: 'no reservations'});
    if (path === '/head') {
      const call = (d) => f.rpc('eth_call', [{to: POOL, data: d}, 'latest']);
      const [root, size] = await Promise.all([call('0x' + HEAD_ROOT), call('0x' + HEAD_NEXT)]);
      return json(route, 200, {root: String(BigInt(root)), size: String(BigInt(size)), pending: [], tail: {root: String(BigInt(root))}});
    }
    if (path === '/cancel' || path === '/receive') return json(route, 200, {});
    if (path === '/relay') {
      if (relay.mode === 'error') return json(route, 500, {error: 'relay busy'});
      if (relay.mode === 'nowhere') return json(route, 200, {txHash: '0x' + hexKey()});
      if (relay.mode === 'other') return json(route, 200, {txHash: relay.other});
      const t = body.tx, args = [t.pA, t.pB, t.pC, t.publicInputs, t.recipient, BigInt(t.extAmount), t.relayer, BigInt(t.fee), t.memo0, t.memo1];
      // A call intent goes through the router (withdrawAndCall), as the relay sends it; anything else to the pool.
      const i = body.call, data = i ? ROUTER_CALL.encodeFunctionData('withdrawAndCall', [args, [i.calls.map((c) => [c.target, BigInt(c.value), c.token, BigInt(c.amount), !!c.push, c.data]), i.outTokens, i.minOuts.map(BigInt), i.to, i.refund, BigInt(i.deadline), BigInt(i.nonce)]])
        : TRANSACT.encodeFunctionData('transact', args);
      try { return json(route, 200, {txHash: await f.rpc('eth_sendTransaction', [{from: t.relayer, to: i ? ROUTER : POOL, data, gas: '0x' + (i ? 3_000_000 : 8_000_000).toString(16)}])}); }
      catch (e) { return json(route, 400, {error: e.message}); }
    }
    return json(route, 404, {error: 'unknown'});
  }

  // Logs before the fork are the chain's own: asked of its real node, which serves long ranges and is not the bottleneck
  // a fork's upstream is; logs after it come from anvil. A range that crosses the fork is asked of both.
  const REAL = {ethereum: 'https://mainnet.gateway.tenderly.co', base: 'https://mainnet.base.org', robinhood: 'https://rpc.mainnet.chain.robinhood.com'};
  const post = async (url, req) => (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(req)})).json();
  // Base's public nodes serve short ranges (Tenderly 1,000 blocks, Base's own 500): before Base's fork the lab serves up to
  // 10,000 a request, read as 1,000-block parts from Tenderly a few at a time, and a part Tenderly refuses from Base's own
  // node in halves.
  async function baseLogs(req, q, from, to) {
    const ask = (url, a, b) => post(url, {...req, params: [{...q, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16)}]}).catch((e) => ({error: {code: -32000, message: e.message}}));
    const bad = (x) => x.error || !Array.isArray(x.result), spans = [], out = [];
    if (to - from >= 10_000) return {error: {code: -32005, message: 'the fork lab serves at most 10000 blocks a request'}};
    for (let a = from; a <= to; a += 1000) spans.push([a, Math.min(to, a + 999)]);
    for (let i = 0; i < spans.length; i += 5) {
      const got = await Promise.all(spans.slice(i, i + 5).map(async ([a, b]) => {
        const t = await ask('https://base.gateway.tenderly.co', a, b), m = Math.min(b, a + 499);
        if (!bad(t)) return t;
        const h = await Promise.all([ask(REAL.base, a, m), m < b ? ask(REAL.base, m + 1, b) : {result: []}]);
        return h.find(bad) || {result: h.flatMap((x) => x.result)};
      }));
      if (got.some(bad)) return got.find(bad);
      out.push(...got.flatMap((x) => x.result));
    }
    return {result: out};
  }
  async function logs(f, req) {
    const q = req.params[0], tip = Number(BigInt(await f.rpc('eth_blockNumber')));
    const num = (x, d) => (x == null || x === 'latest' || x === 'pending' ? d : x === 'earliest' ? 0 : Number(BigInt(x)));
    const from = num(q.fromBlock, tip), to = num(q.toBlock, tip), hex = (n) => '0x' + n.toString(16);
    const parts = [];
    if (from <= f.forkBlock) parts.push(f.c.key === 'base' ? baseLogs(req, q, from, Math.min(to, f.forkBlock)) : post(REAL[f.c.key], {...req, params: [{...q, fromBlock: hex(from), toBlock: hex(Math.min(to, f.forkBlock))}]}));
    if (to > f.forkBlock) parts.push(post(f.url, {...req, params: [{...q, fromBlock: hex(Math.max(from, f.forkBlock + 1)), toBlock: hex(to)}]}));
    const out = await Promise.all(parts), bad = out.find((x) => x.error || !Array.isArray(x.result));
    return JSON.stringify(bad ? {jsonrpc: '2.0', id: req.id, error: bad.error || {code: -32000, message: 'not a log list'}} : {jsonrpc: '2.0', id: req.id, result: out.flatMap((x) => x.result)});
  }
  const nodes = Object.fromEntries(Object.values(forks).map((f) => [f.c.chainId, f.c.rpc[0]]));
  const realSet = new Set(realCalls.map((a) => a.toLowerCase()));
  // Reads at a recent block, which a node with no archive serves; Base's own endpoint limits bursts more tightly. A quote
  // heavier than the first node allows a call (a token with many pools) is asked of the next.
  const REAL_CALLS = {ethereum: ['https://ethereum-rpc.publicnode.com', 'https://mainnet.gateway.tenderly.co'], base: ['https://base-rpc.publicnode.com', 'https://base.gateway.tenderly.co'], robinhood: [REAL.robinhood]};
  // A node that cannot be reached at all is passed over like one that answers with an error.
  const realCall = async (key, body) => {
    let t;
    for (const u of REAL_CALLS[key]) {
      t = await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body}).then((r) => r.text(), (e) => JSON.stringify({jsonrpc: '2.0', id: JSON.parse(body || '{}').id ?? 1, error: {code: -32000, message: `fork: ${e.message}`}}));
      if (!/"error"\s*:/.test(t)) break;
    }
    return t;
  };
  async function newContext() {
    const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const u = new URL(route.request().url()), f = byHost.get(u.host);
      if (f) {
        const body = route.request().postData();
        let t;
        try {
          const req = JSON.parse(body || '{}');
          const real = !Array.isArray(req) && req.method === 'eth_call' && realSet.has(String(req.params?.[0]?.to || '').toLowerCase());
          t = req.method === 'eth_getLogs' ? await logs(f, req) : real ? await realCall(f.c.key, body) : await (await fetch(f.url, {method: 'POST', headers: {'content-type': 'application/json'}, body})).text();
        }
        catch (e) { t = JSON.stringify({jsonrpc: '2.0', id: JSON.parse(body || '{}').id ?? 1, error: {code: -32000, message: `fork: ${e.message}`}}); }
        return route.fulfill({status: 200, contentType: 'application/json', headers: cors, body: t}).catch(() => {});
      }
      if (/tacit-evm-pool-keeper/.test(u.host)) return relayRoute(route);
      if (/\/(transact\.wasm|transact_final\.zkey)$/.test(u.pathname)) {
        if (process.env.OFFLINE) return route.abort();
        if (!process.env.ARTIFACTS) return route.continue();
        return route.fulfill({status: 200, contentType: 'application/octet-stream', headers: cors, body: fs.readFileSync(`${process.env.ARTIFACTS}/${u.pathname.split('/').pop()}`)});
      }
      // A chain named in `passthrough` is read for real (a name's chain, when the test forks another); any other host the page
      // may ask for (a mirror's pin, an explorer) is not part of the fork.
      if (passHosts.has(u.host)) return route.continue();
      return json(route, 503, {error: 'not in this test'});
    });
    await ctx.addInitScript(`(() => {
      const NODES = ${JSON.stringify(nodes)}, ACCT = ${JSON.stringify(account)};
      let chain = '0x' + Number(${JSON.stringify(forks[names[0]].c.chainId)}).toString(16);
      const log = window.__wallet = [];
      const call = async (method, params) => { const r = await (await fetch(NODES[Number(chain)], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.result; };
      window.ethereum = { on() {}, request: async ({ method, params }) => {
        log.push([method, chain]);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ACCT];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { if (!NODES[Number(params[0].chainId)]) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 }); chain = params[0].chainId; return null; }
        if (method === 'eth_sendTransaction') return call('eth_sendTransaction', [{ ...params[0], from: ACCT }]);
        // EIP-5792, when the test says the wallet batches: the calls are sent in order and each must land.
        if (method === 'wallet_getCapabilities') { if (!${JSON.stringify(batch)}) throw Object.assign(new Error('Method not found'), { code: -32601 }); return { [chain]: { atomic: { status: 'supported' } } }; }
        if (method === 'wallet_sendCalls') {
          if (!${JSON.stringify(batch)}) throw Object.assign(new Error('Method not found'), { code: -32601 });
          const hashes = [];
          for (const c of params[0].calls) {
            const h = await call('eth_sendTransaction', [{ from: ACCT, to: c.to, data: c.data, value: c.value || '0x0' }]);
            hashes.push(h);
            let r = null; for (let i = 0; i < 60 && !r; i++) { r = await call('eth_getTransactionReceipt', [h]); if (!r) await new Promise((ok) => setTimeout(ok, 250)); }
            if (r?.status !== '0x1') break;
          }
          const id = '0x' + hashes.at(-1).slice(2, 34);
          (window.__batches ||= {})[id] = hashes;
          return { id };
        }
        if (method === 'wallet_getCallsStatus') {
          const receipts = await Promise.all(window.__batches[params[0]].map((h) => call('eth_getTransactionReceipt', [h])));
          return { status: receipts.every((r) => r?.status === '0x1') ? 200 : 500, receipts };
        }
        return call(method, params || []);
      } };
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('tacit-pay-chain-v1', ${JSON.stringify(forks[names[0]].c.chainId)});
        ${relay || endpoints ? '' : `localStorage.setItem('tacit-pay-route-v1', JSON.stringify({ send: 'wallet', withdraw: 'wallet' }));`}
        ${endpoints ? `localStorage.setItem('tacit-pay-endpoints-v1', ${JSON.stringify(JSON.stringify(endpoints))});` : ''}
      }
    })();`);
    return ctx;
  }

  const origin = `http://127.0.0.1:${server.address().port}/`;
  async function page(ctx = null) {
    ctx ||= await newContext();
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => { p.errors.push(String(e)); console.log('        page error: ' + String(e.stack || e).split('\n').slice(0, 4).join(' | ').slice(0, 400)); });
    // Chains a test does not fork are never asked, except those it passes through; a public node that answers with a doubled
    // CORS header or none (the page rides it out by asking the next node) is not a page error.
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|multiple values '\*,\*'|not in this test|blocked by CORS policy/.test(m.text())) p.errors.push(m.text()); });
    await p.goto(origin);
    return Object.assign(p, helpers(p));
  }

  function helpers(p) {
    const h = {
      async openKey(k) {
        await p.click('#tabs [data-tab="receive"]');
        await p.click('#form [data-in="paste"]'); await p.fill('#form .opts input', k); await p.click('#form [data-in="key"]');
        await p.waitForSelector('#form .addr code');
        return p.textContent('#form .addr code');
      },
      async lockKey() { await p.click('#wallet'); await p.click('#w-lock'); await p.click('#sheet-wallet [data-close]'); },
      async status(re, ms = 900e3) {
        try { await p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status').textContent) || document.querySelector('#status .err'), re.source, {timeout: ms}); }
        catch (e) { throw new Error(`${e.message} waiting for ${re}; the status line says: ${(await p.textContent('#status').catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300)}`); }
        return (await p.textContent('#status')).trim();
      },
      async balance(want, ms = 180e3) {
        await p.waitForFunction((w) => document.querySelector('#bal .v')?.textContent.trim() === w, want, {timeout: ms}).catch(() => {});
        return (await p.textContent('#bal .v')).trim();
      },
      // The activity rows, of one chain when it is named (the list mixes every chain the key has used).
      async rows(n, chainName = '') {
        await p.waitForFunction(([k, c]) => [...document.querySelectorAll('#activity .rows li')].filter((e) => e.innerText.includes(c)).length >= k, [n, chainName ? ` ${chainName} · ` : ''], {timeout: 180e3}).catch(() => {});
        return p.$$eval('#activity .rows li', (x, c) => x.map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t.includes(c)), chainName ? ` ${chainName} · ` : '');
      },
      async chain(key) { await p.click(`#chains [data-chain="${CHAINS.find((c) => c.key === key).chainId}"]`); },
      wallet: () => p.evaluate(() => window.__wallet.map(([m, c]) => `${m}@${c}`)),
    };
    return h;
  }

  const close = () => { try { browser.close(); server.close(); } catch {} for (const f of Object.values(forks)) f.anvil.kill('SIGKILL'); };
  return {forks, fork: (name) => forks[name], page, newContext, relay, close, origin};
}

/** A relay whose behaviour a test sets: mode 'send' (a faithful relayer: the pool's transact, sent from the relayer's
 *  own account), 'down', 'error' (HTTP 500), 'nowhere' (a hash that never lands), 'other' (a real hash of some other
 *  transaction, set as `other`), 'tail' as `reserve` (reservations refused with 403 and the queue's head served, as when a
 *  relay has paused them for a connection). `quote` may override fields of the quote, or be a function that returns it. */
export const mockRelay = (over = {}) => ({mode: 'send', fee: 5n * 10n ** 12n, quote: {}, events: null, other: null, calls: [], ...over});
