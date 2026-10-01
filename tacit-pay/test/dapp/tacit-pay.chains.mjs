/* The three chains and their relays as the page ships them, read-only, no browser: every node and relay is taken from
   dapp/page.html itself and asked what the page will ask it. Per chain: each node answers for the right chain, serves
   a browser (one CORS origin header, a preflight that allows a JSON POST), reads logs in the ranges the page asks for
   and from the pool's first block; the pool, router and verifier have code; the relay answers its quote, index and
   head, and its quote passes the page's own checks; the relay's address holds gas. Where a node or relay is down the
   page still works, so those are warnings, not failures, as long as one node per chain serves logs.

   Usage: node test/dapp/tacit-pay.chains.mjs                                                                   */
import vm from 'node:vm';
import { cut, config } from './page-config.mjs';

const { keccak256, toUtf8Bytes } = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const { POOL, ROUTER, VERIFIER, CHAINS, RELAYERS, MAX_RELAY_FEE } = config;

// The page's own log reader and its error text, so what is timed here is what a wallet rebuilt from its key does.
const reader = vm.runInNewContext(`${cut('const errorText =', '\n')}\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n${cut('async function getLogs(', '\nconst T_TRANSACT')}\ngetLogs`, { setTimeout, Array });
const T_TRANSACT = keccak256(toUtf8Bytes('Transact(bytes32,bytes32,bytes32,bytes32,uint256,bytes32,address,int256,address,uint256,bytes,bytes)'));
const ORIGIN = 'https://anon.wei.limo';

let failures = 0, warnings = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const warn = (m, x = '') => { console.log('  warn  ' + m + (x ? '  ' + x : '')); warnings++; };
const info = (m) => console.log('        ' + m);
const hex = (n) => '0x' + n.toString(16);
const call = async (url, method, params = [], ms = 20000) => {
  const t = performance.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(ms) });
  const j = await r.json();
  return { ms: Math.round(performance.now() - t), headers: r.headers, error: j.error, result: j.result };
};
const get = async (url, ms = 30000) => {
  const t = performance.now();
  const r = await fetch(url, { headers: { origin: ORIGIN }, signal: AbortSignal.timeout(ms) });
  const body = await r.json().catch(() => null);
  return { status: r.status, ms: Math.round(performance.now() - t), body, headers: r.headers };
};

const codeHashes = {};
for (const c of CHAINS) {
  console.log(`\n${c.full} (${c.chainId})`);
  const good = [];
  let tip = 0;
  for (const url of c.rpc) {
    const host = new URL(url).host;
    try {
      const id = await call(url, 'eth_chainId');
      if (id.error || Number(id.result) !== c.chainId) { warn(`${host}: not answering for chain ${c.chainId}`, JSON.stringify(id.error || id.result)); continue; }
      const origin = id.headers.get('access-control-allow-origin');
      const single = origin === '*' || origin === ORIGIN;
      const pre = await fetch(url, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
      const preOk = !!pre && pre.status < 300 && /content-type|\*/i.test(pre.headers.get('access-control-allow-headers') || '');
      const t = await call(url, 'eth_blockNumber');
      tip = Math.max(tip, Number(t.result));
      // Logs in the ranges the page asks for: it starts at 50,000 blocks and shrinks to what the node names.
      info(`${host}: ${id.ms} ms, cors ${origin ?? 'none'}${preOk ? '' : ' (no preflight)'}`);
      if (!single) { warn(`${host}: a browser would refuse it`, `access-control-allow-origin: ${origin}`); continue; }
      // The page's reader, from the pool's first block to the tip, over this node alone.
      let calls = 0, lastErr = '';
      const rpc = async (m, ps) => { calls++; const r = await call(url, m, ps, 30000); if (r.error || !Array.isArray(r.result)) { r.error ||= { message: 'not a log list: ' + JSON.stringify(r.result).slice(0, 60) }; lastErr = r.error.message; throw Object.assign(new Error(r.error.message), { rpc: r.error }); } return r.result; };
      const t0 = performance.now();
      const got = await Promise.race([reader(rpc, POOL, [T_TRANSACT], c.deployBlock, Number(t.result)).then((x) => x.length, (e) => e), new Promise((r) => setTimeout(() => r(new Error('over 3 minutes')), 180000))]);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const logs = typeof got === 'number';
      info(`  rebuild from the pool's first block: ${logs ? `${got} pool events in ${calls} requests, ${secs} s` : `fails after ${calls} requests (${secs} s): ${String(got.message || got).slice(0, 80)}`}`);
      good.push({ url, logs });
    } catch (e) { warn(`${host}: unreachable`, String(e.message).slice(0, 80)); }
  }
  ok(good.length >= 2, `at least two nodes a browser can use`, `${good.length} of ${c.rpc.length}`);
  ok(good.some((g) => g.logs), 'at least one serves the page’s log reader from the pool’s first block, which a wallet rebuilt from its key needs');
  if (good.filter((g) => g.logs).length >= 2) ok(true, 'and a second one does, so one node going down does not stop a rebuild');
  else warn('only one public node serves a full rebuild here; the relay’s index covers the first read, and a reader can add an archive node of their own under Endpoints');
  if (good.length) {
    const node = good.find((g) => g.logs)?.url || good[0].url;
    for (const [name, addr] of [['pool', POOL], ['router', ROUTER], ['verifier', VERIFIER]]) {
      const code = (await call(node, 'eth_getCode', [addr, 'latest'])).result;
      ok(/^0x[0-9a-f]{100,}$/i.test(code), `${name} has code at ${addr.slice(0, 8)}…`);
      (codeHashes[name] ||= {})[c.chainId] = keccak256(code).slice(0, 12);
    }
    const here = await call(node, 'eth_getCode', [POOL, hex(c.deployBlock)]).catch(() => null), before = await call(node, 'eth_getCode', [POOL, hex(c.deployBlock - 1)]).catch(() => null);
    if (here?.result && before?.result !== undefined && !here.error && !before.error) ok(here.result.length > 4 && before.result === '0x', 'deployBlock is the pool’s first block', `${c.deployBlock}`);
    else warn('deployBlock not checked: the node keeps no old state');
  }
  // The relay: optional for the page, so unreachable is a warning; reachable, it must be sound.
  const rel = c.relay;
  const q = await get(`${rel}/quote`).catch((e) => ({ error: e }));
  if (q.error || q.status !== 200) warn(`relay quote: ${q.error ? String(q.error.message).slice(0, 60) : 'HTTP ' + q.status}`, rel);
  else {
    const b = q.body;
    info(`relay quote in ${q.ms} ms: fee ${Number(BigInt(b.fee)) / 1e18} ETH, relayer ${b.relayer}`);
    ok(Number(b.chainId) === c.chainId && b.pool.toLowerCase() === POOL.toLowerCase(), 'the relay quotes this chain and pool');
    ok(b.relayer.toLowerCase() === RELAYERS[c.chainId].toLowerCase(), 'from the relayer address the page expects');
    ok(BigInt(b.fee) <= MAX_RELAY_FEE[c.chainId], 'under the page’s fee ceiling', `${Number(BigInt(b.fee)) / 1e18} of ${Number(MAX_RELAY_FEE[c.chainId]) / 1e18} ETH`);
    if (good.length) {
      const bal = BigInt((await call(good[0].url, 'eth_getBalance', [b.relayer, 'latest'])).result);
      ok(bal > 0n, 'the relayer address holds gas', `${(Number(bal) / 1e18).toFixed(5)} ETH`);
    }
  }
  const ev = await get(`${rel}/events?from=${c.deployBlock}`).catch((e) => ({ error: e }));
  if (ev.error || ev.status !== 200) warn(`relay index: ${ev.error ? String(ev.error.message).slice(0, 60) : 'HTTP ' + ev.status}`);
  else {
    ok(Number(ev.body.chainId) === c.chainId && ev.body.pool.toLowerCase() === POOL.toLowerCase(), 'the relay’s index is for this chain and pool', `${ev.body.events?.length} events through ${ev.body.through} in ${ev.ms} ms`);
  }
  const ex = await fetch(`${c.explorer}/address/${POOL}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!ex || ex.status >= 400) warn(`explorer ${new URL(c.explorer).host} did not answer`, ex ? 'HTTP ' + ex.status : '');
}

console.log('\nthe same contracts on every chain');
for (const [name, byChain] of Object.entries(codeHashes)) {
  const set = new Set(Object.values(byChain));
  if (set.size === 1) ok(true, `${name}: one bytecode on every chain`, [...set][0]);
  else info(`${name}: code hash by chain ${JSON.stringify(byChain)} (the pool and router carry per-chain constants)`);
}
console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}${warnings ? `, ${warnings} warning(s)` : ''}`);
process.exit(failures ? 1 : 0);
