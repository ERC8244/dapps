/* Every route the page can take for a withdrawal that arrives as a token, on every chain, run as the escrow runs it.
   For each chain and a few listed tokens, each of zQuoter's builders is asked for a route exactly as the page asks
   (a random stand-in for the recipient, the page's own decoder), at the block an anvil fork starts from. Each route
   the page would accept is then sent on the fork from a contract (code that accepts ETH, as the escrow does) with the
   ETH it asks for and the real recipient written in. It must land, pay the recipient at least the minimum the page
   computes, and leave nothing of the token with the sender.

   Usage: node test/dapp/tacit-pay.routes.mjs                     (anvil on PATH; CHAINS=base,robinhood to pick)   */
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import {cut} from './page-config.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const routeOf = vm.runInNewContext(`${cut('function routeOf(', '\n// The best route')}\nrouteOf`, {BigInt, Number, Math});

const ZQUOTER = '0x000000bd2db80567c23e353ca95a251c573cbf9b', Z3H = '0x000000f584434f81fc115b1a59243a4287db08be', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4';
const CH = {
  ethereum: {id: 1, real: 'https://mainnet.gateway.tenderly.co', tokens: {USDC: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6], WBTC: ['0x2260FAC5E5542a773Aa44fBCfEDf7C193bc2C599', 8], WETH: ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18]}},
  base: {id: 8453, real: 'https://mainnet.base.org', tokens: {USDC: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6], cbBTC: ['0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8], AERO: ['0x940181a94A35A4569E4529A3CDfB74e38FD98631', 18]}},
  robinhood: {id: 4663, real: 'https://rpc.mainnet.chain.robinhood.com', tokens: {USDG: ['0x5fc5360d0400a0fd4f2af552add042d716f1d168', 6], NVDA: ['0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 18]}},
};
const post = async (url, method, params) => {
  for (let i = 0; ; i++) {
    const r = await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})})).json().catch((e) => ({error: {message: String(e)}}));
    if (!r.error) return r.result;
    if (i < 4 && /429|rate|Too Many|timeout/i.test(r.error.message)) { await sleep(1500 * (i + 1)); continue; }
    throw Object.assign(new Error(r.error.message), {data: r.error.data});
  }
};
const W = (x) => BigInt(x).toString(16).padStart(64, '0'), A = (a) => W(a);
const balOf = (url, t, a) => post(url, 'eth_call', [{to: t, data: '0x70a08231' + A(a)}, 'latest']).then(BigInt);

for (const name of (process.env.CHAINS || 'ethereum,base,robinhood').split(',')) {
  const c = CH[name], port = 19545 + Math.floor(Math.random() * 3000), url = `http://127.0.0.1:${port}`;
  console.log(`\n${name}`);
  const anvil = spawn('anvil', ['--port', String(port), '--fork-url', c.real, '--chain-id', String(c.id), '--silent', '--no-rate-limit'], {stdio: 'ignore'});
  process.on('exit', () => anvil.kill('SIGKILL'));
  for (let i = 0; ; i++) { try { await post(url, 'eth_chainId', []); break; } catch { if (i > 240) throw new Error('anvil did not start'); await sleep(500); } }
  const block = '0x' + BigInt(await post(url, 'eth_blockNumber', [])).toString(16);
  for (const [sym, [token, dec]] of Object.entries(c.tokens)) {
    const amount = 10n ** 16n, slip = 50n, deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const stand = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join(''), me = '0'.repeat(24) + stand;
    const tk = (sl) => W(0) + A(0) + A(token) + W(amount) + W(sl) + W(deadline);
    const s2 = slip / 2n || 1n, s3 = slip / 3n || 1n, w = slip * 3n, ss = w < 150n ? 150n : w > 500n ? 500n : w;
    const split = (sel, sl) => [sel, ZQUOTER, sel + me + A(0) + A(token) + W(amount) + W(sl) + W(deadline), sl, 4, 8, amount];
    const jobs = [['best', ZQUOTER, 'e7798987' + me + tk(slip), slip, 0, 4, 0, 6], ['via ETH', ZQUOTER, 'e453166e' + me + me + tk(s2), s2, 4, 9, 0],
      ...(c.id === 1 ? [] : [['3 hops', Z3H, '4c464f59' + me + tk(s3), s3, 8, 13, 0]]), ['split', ...split('892af013', slip).slice(1)], ['hybrid', ...split('85f86a90', ss).slice(1)]];
    for (const [label, q, data, sl, ...r] of jobs) {
      let h;
      try { h = await post(c.real, 'eth_call', [{to: q, data: '0x' + data}, block]); }
      catch (e) { console.log(`  ----  ${sym} ${label}: no answer (${String(e.message).slice(0, 60)})`); continue; }
      let route = null;
      try { route = routeOf(h, sl, ...r); } catch {}
      if (!route || route.value !== amount || !route.data.includes(stand)) { console.log(`  ----  ${sym} ${label}: no route the page would take`); continue; }
      // The escrow: a contract that takes ETH back, sending the route with the recipient written in.
      const sender = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join(''), dest = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
      await post(url, 'anvil_setCode', [sender, '0x00']);
      await post(url, 'anvil_setBalance', [sender, '0x' + (10n ** 18n).toString(16)]);
      await post(url, 'anvil_impersonateAccount', [sender]);
      const tx = route.data.split(stand).join(dest.slice(2));
      let rc = null, err = '';
      try {
        const hash = await post(url, 'eth_sendTransaction', [{from: sender, to: ZROUTER, value: '0x' + route.value.toString(16), data: tx, gas: '0x' + (3_000_000).toString(16)}]);
        for (let i = 0; i < 60 && !rc; i++) { rc = await post(url, 'eth_getTransactionReceipt', [hash]); if (!rc) await sleep(500); }
      } catch (e) { err = String(e.message).slice(0, 120); }
      const got = await balOf(url, token, dest), left = await balOf(url, token, sender);
      const src = route.data.startsWith('0xac9650d8') ? 'multicall' : route.data.slice(0, 10);
      ok(rc?.status === '0x1' && got >= route.limit && left === 0n, `${sym} ${label} (${src}, source ${route.source}): lands, pays ≥ the minimum, strands nothing`,
        rc ? `got ${got} ≥ ${route.limit} (quoted ${route.out}), sender keeps ${left}, gas ${BigInt(rc.gasUsed)}` : err);
    }
  }
  anvil.kill('SIGKILL');
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
