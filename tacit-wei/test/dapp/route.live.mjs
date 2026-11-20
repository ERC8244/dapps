/* The page's private route against the live forwarders, read-only: a quote from the page's own relay and from a relay the registry lists,
   each sealed through a forwarder, and a bundler's gas price through the wallet-read gateway. Run: node test/dapp/route.live.mjs */
import { loadTC } from './tornado-lib.mjs';
const { RL, ROUTE } = loadTC();
let fail = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m} ${x}`); if (!c) fail++; };
const call = async (to, data) => (await (await fetch('https://ethereum-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json()).result;
const own = { url: 'https://tacit-evm-pool-keepers.onrender.com/1/evm-pool/keeper', relayer: '0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0' };
const relays = RL.relaysFor(own, await RL.readRegistry(call, 1));
ROUTE.listRelays(relays);
for (const r of relays) {
  const t = Date.now();
  try { const res = await ROUTE.relayFetch(`${r.url}/quote`); const q = await res.json(); ok(res.status === 200 && q.relayer?.toLowerCase() === r.relayer.toLowerCase(), `sealed quote from ${r.own ? 'the page\'s relay' : 'a listed relay'}`, `${q.fee} wei, ${Date.now() - t} ms`); } catch (e) { ok(false, `sealed quote from ${r.url}`, e.message); }
}
let refused = false;
try { await ROUTE.relayFetch('https://example.org/1/evm-pool/keeper/quote'); } catch { refused = true; }
ok(refused, 'a relay the page does not list is refused, not fetched');
const r = await ROUTE.bundlerFetch('https://public.pimlico.io/v2/1/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pimlico_getUserOperationGasPrice', params: [] }) });
const j = await r.json();
ok(!!j.result?.standard?.maxFeePerGas, 'a bundler gas price through the wallet-read gateway', JSON.stringify(j.result?.standard || j).slice(0, 120));
process.exit(fail ? 1 : 0);
