#!/usr/bin/env node
// Serves a page on localhost that deploys tacit-pay from a browser wallet: the chunks from out/, then
// TacitPay8244(steward, 0, chunks, keccak(page)) from forge's artifact. Each chunk's runtime is checked against its
// build as it lands; the wrapper's gas is estimated first, which succeeds only if the chunks reassemble to the page.
// Progress is kept in the page's localStorage and checked against the chain on every connect, so a closed tab resumes
// where it stopped. Each contract is looked for at the address its transaction creates (deployer and nonce), so a
// transaction the wallet replaced or sped up is found where it landed instead of being sent twice.
//   node ../scripts/chunk.mjs tacit-pay && forge build && node deploy/deploy-helper.mjs [port]     (from tacit-pay/)
// Never `forge build --force` or `forge clean` between chunk.mjs and this: they delete out/.
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../', import.meta.url).pathname;
const STEWARD = '0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20';
const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
const page = readFileSync(DIR + manifest.page);
if (page.length !== manifest.bytes || createHash('sha256').update(page).digest('hex') !== manifest.sha256) throw new Error('the page is not the one the manifest pins');
const files = readdirSync(DIR + 'out').filter((f) => /^TacitPay8244\.chunk\d+\.creation\.txt$/.test(f)).sort((a, b) => Number(a.match(/chunk(\d+)/)[1]) - Number(b.match(/chunk(\d+)/)[1]));
const chunks = files.map((f) => readFileSync(DIR + 'out/' + f, 'utf8').trim());
const runtimes = chunks.map((c) => '0x' + c.slice(2 + 20));   // the 10-byte stub, then the runtime
if (Buffer.concat(runtimes.map((r) => Buffer.from(r.slice(4), 'hex'))).compare(page) !== 0) throw new Error('the chunks do not reassemble to the page');
const bytecode = JSON.parse(readFileSync(DIR + 'out/TacitPay8244.sol/TacitPay8244.json', 'utf8')).bytecode.object;
const { keccak256, getCreateAddress, getAddress } = await import(new URL('../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const pageHash = keccak256(page), GAS = Math.round(page.length * 225 + 1.6e6);   // measured: 54.7M for the 243 KB page

const html = `<!doctype html><html><head><meta charset="utf-8"><title>deploy tacit-pay</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,monospace;max-width:760px;margin:40px auto;padding:0 16px}button{font:inherit;padding:8px 14px;margin:4px 0}code{overflow-wrap:anywhere}.ok{color:#0a7d3a}.err{color:#b8341d}li{margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f1e8;padding:12px}</style></head><body>
<h2>deploy tacit-pay (anon.wei)</h2>
<p>Page ${manifest.bytes.toLocaleString('en-US')} bytes, sha256 <code>${manifest.sha256}</code>, keccak <code>${pageHash}</code>. ${chunks.length} chunks, then the wrapper with steward <code>${STEWARD}</code>: ${chunks.length + 1} transactions on Ethereum mainnet. Any account can deploy and pays the gas; the steward is set by the constructor.</p>
<p><button id="connect">Connect wallet</button> <span id="who"></span></p>
<p><button id="go" disabled>Deploy what is left</button> <button id="reset">Forget progress</button></p>
<ol id="steps"></ol><pre id="out" hidden></pre>
<script>
const CHUNKS = ${JSON.stringify(chunks)}, RUNTIMES = ${JSON.stringify(runtimes)}, BYTECODE = ${JSON.stringify(bytecode)};
const STEWARD = ${JSON.stringify(STEWARD)}, PAGE_HASH = ${JSON.stringify(pageHash)}, SHA = ${JSON.stringify(manifest.sha256)}, GAS = ${GAS};
const KEY = 'tacit-pay-deploy-1-' + SHA.slice(0, 16);
let st = JSON.parse(localStorage.getItem(KEY) || '{"chunks":[]}'), eth = null, from = null;
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
const $ = (s) => document.querySelector(s), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (method, params = []) => eth.request({ method, params });
const word = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
function paint(note) {
  const items = CHUNKS.map((_, i) => '<li>chunk ' + (i + 1) + ': ' + (st.chunks[i] ? '<span class="ok">' + st.chunks[i] + '</span>' : '…') + '</li>');
  items.push('<li>wrapper: ' + (st.wrapper ? '<span class="ok">' + st.wrapper + '</span>' : '…') + '</li>');
  if (note) items.push('<li>' + note + '</li>');
  $('#steps').innerHTML = items.join('');
}
const code = async (a) => (await rpc('eth_getCode', [a, 'latest'])).toLowerCase();
async function onMainnet() {
  const id = parseInt(await rpc('eth_chainId'), 16);
  if (id !== 1) throw new Error('Your wallet is on chain ' + id + ', not Ethereum mainnet. Switch it and press the button again: nothing was sent.');
}
// Sends the creation code and waits for the contract. landed(address) says whether the intended contract is at an
// address: that is how a replaced or sped-up transaction (same nonce, so the same address) is found.
async function create(data, label, landed) {
  await onMainnet();
  const nonce = parseInt(await rpc('eth_getTransactionCount', [from, 'pending']), 16);
  const expected = await (await fetch('/addr?from=' + from + '&nonce=' + nonce)).text();
  if (await landed(expected)) return expected;
  const gas = '0x' + Math.ceil(Number(BigInt(await rpc('eth_estimateGas', [{ from, data }]))) * 1.1).toString(16);
  paint('confirm ' + label + ' in your wallet');
  const h = await rpc('eth_sendTransaction', [{ from, data, gas, nonce: '0x' + nonce.toString(16) }]);
  paint(label + ': waiting for <code>' + h + '</code>');
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    if (r) { if (r.status !== '0x1' || !r.contractAddress) throw new Error(label + ' reverted in ' + h); return r.contractAddress; }
    if (await landed(expected)) return expected;
    if (parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16) > nonce && !(await rpc('eth_getTransactionReceipt', [h])) && !(await landed(expected)))
      throw new Error('Another transaction used nonce ' + nonce + ' (see the activity in your wallet). Nothing is lost: press the button again to carry on from what is on chain.');
    await sleep(3000);
  }
}
const wrapperOk = async (a) => { try { return (await code(a)).length > 4 && (await rpc('eth_call', [{ to: a, data: '0x5b700b59' }, 'latest'])).toLowerCase() === PAGE_HASH.toLowerCase(); } catch { return false; } };
// What this wallet's chain really holds: stored addresses that are not the intended contracts are forgotten.
async function reconcile() {
  for (let i = 0; i < CHUNKS.length; i++) if (st.chunks[i] && (await code(st.chunks[i])) !== RUNTIMES[i].toLowerCase()) delete st.chunks[i];
  if (st.wrapper && !(await wrapperOk(st.wrapper))) delete st.wrapper;
  save();
}
$('#connect').onclick = async () => {
  eth = window.ethereum;
  if (!eth) return paint('<span class="err">No wallet in this browser.</span>');
  try {
    [from] = await rpc('eth_requestAccounts');
    if (parseInt(await rpc('eth_chainId'), 16) !== 1) { try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x1' }]); } catch {} }
    await onMainnet();
    await reconcile();
    const [bal, gp] = await Promise.all([rpc('eth_getBalance', [from, 'latest']), rpc('eth_gasPrice')]);
    $('#who').textContent = from + ' · ' + (Number(BigInt(bal)) / 1e18).toFixed(5) + ' ETH · gas ' + (Number(BigInt(gp)) / 1e9).toFixed(3) + ' gwei · the whole deploy ≈ ' + (Number(BigInt(gp)) * GAS / 1e18).toFixed(4) + ' ETH';
    $('#go').disabled = false;
    paint();
  } catch (e) { paint('<span class="err">' + (e.message || e) + '</span>'); }
};
$('#reset').onclick = () => { if (confirm('Forget the addresses deployed so far? (They stay on chain.)')) { st = { chunks: [] }; save(); paint(); } };
$('#go').onclick = async () => {
  $('#go').disabled = true;
  try {
    for (let i = 0; i < CHUNKS.length; i++) {
      if (st.chunks[i]) continue;
      const a = await create(CHUNKS[i], 'chunk ' + (i + 1), async (x) => (await code(x)) === RUNTIMES[i].toLowerCase());
      if ((await code(a)) !== RUNTIMES[i].toLowerCase()) throw new Error('chunk ' + (i + 1) + ' at ' + a + ' is not its build');
      st.chunks[i] = a; save(); paint();
    }
    if (!st.wrapper) {
      const n = st.chunks.length, args = word(STEWARD) + word('0') + word((32 * 4).toString(16)) + word(PAGE_HASH) + word(n.toString(16)) + st.chunks.map(word).join('');
      st.wrapper = await create(BYTECODE + args, 'the wrapper', wrapperOk); save();
    }
    const call = async (sig) => rpc('eth_call', [{ to: st.wrapper, data: sig }, 'latest']);
    const [hash, steward] = await Promise.all([call('0x5b700b59'), call('0x637eea19')]);
    paint(hash.toLowerCase() === PAGE_HASH.toLowerCase() && steward.slice(-40).toLowerCase() === STEWARD.slice(2).toLowerCase() ? '<span class="ok">Done: the wrapper commits to this page and names the steward.</span>' : '<span class="err">Deployed, but PAGE_HASH or steward does not read back as expected.</span>');
    $('#out').hidden = false;
    $('#out').textContent = 'manifest.json "deployment":\\n' + JSON.stringify({ chainId: 1, contract: st.wrapper, pageSha256: SHA, steward: STEWARD, chunkContracts: st.chunks, routes: [
      { kind: 'erc8244', url: 'https://' + st.wrapper.toLowerCase() + '.w4eth.io/', serves: 'exact' },
      { kind: 'erc4804', url: 'https://' + st.wrapper.toLowerCase() + '.1.w3link.io/', serves: 'modified', note: "w3link injects its own script, which the page's CSP refuses; the bytes it serves are not the bytes html() returns" },
      { kind: 'wns', url: 'https://anon.wei.limo/', serves: 'exact' } ] }, null, 2);
  } catch (e) { paint('<span class="err">' + (e.message || e) + '</span>'); }
  $('#go').disabled = false;
};
paint();
</script></body></html>`;
const port = Number(process.argv[2] || 8444);
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://localhost');
  if (u.pathname === '/addr') {                       // where a contract creation by `from` at `nonce` lands
    try { r.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); r.end(getCreateAddress({ from: getAddress(u.searchParams.get('from')), nonce: Number(u.searchParams.get('nonce')) })); }
    catch { r.writeHead(400); r.end(); }
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); r.end(html);
})
  .listen(port, '127.0.0.1', () => console.log(`deploy tacit-pay: http://127.0.0.1:${port}/  (${chunks.length} chunks + wrapper, steward ${STEWARD})`));
