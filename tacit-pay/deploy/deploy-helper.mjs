#!/usr/bin/env node
// Serves a page on localhost that deploys tacit-pay from a browser wallet: the chunks from out/, then
// TacitPay8244(steward, 0, chunks, keccak(page)) from forge's artifact. Each chunk's runtime is checked against its
// build as it lands; the wrapper's gas is estimated first, which succeeds only if the chunks reassemble to the page.
// Progress is kept in the page's localStorage and checked against the chain on every connect, so a closed tab resumes
// where it stopped. Each contract is looked for at the address its transaction creates (deployer and nonce), so a
// transaction the wallet replaced or sped up is found where it landed instead of being sent twice.
//   node ../scripts/chunk.mjs tacit-pay && forge build && node deploy/deploy-helper.mjs [port]     (from tacit-pay/)
// Never `forge build --force` or `forge clean` between chunk.mjs and this: they delete out/.
// The wrapper goes through CreateX's CREATE3 with a salt mined for the connected account, so its address starts with zero
// bytes, is known before anything is sent, and only that account can claim it. Needs the miner built once:
//   cargo build --release --offline --manifest-path deploy/vanity/Cargo.toml     (without it, the wrapper is a plain creation)
import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const { keccak256, getCreateAddress, getAddress, namehash, concat, zeroPadValue, AbiCoder, id } = await import(new URL('../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const CREATEX = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed', ZEROS = Number(process.env.ZEROS || 3), MINER = DIR + 'deploy/vanity/target/release/vanity';
const DEPLOY3 = id('deployCreate3(bytes32,bytes)').slice(0, 10), COMPUTE3 = id('computeCreate3Address(bytes32)').slice(0, 10);
// What CreateX does with a salt that starts with the sender and has 0x00 as its 21st byte, and where CREATE3 lands it.
const create3 = (from, salt) => {
  if (getAddress(salt.slice(0, 42)) !== getAddress(from) || salt.slice(42, 44) !== '00') throw new Error('not a salt for this account');
  const guarded = keccak256(concat([zeroPadValue(from, 32), salt]));
  const proxy = '0x' + keccak256(concat(['0xff', CREATEX, guarded, keccak256('0x67363d3d37363d34f03d5260086018f3')])).slice(26);
  return { guarded, address: getAddress('0x' + keccak256(concat(['0xd694', proxy, '0x01'])).slice(26)) };
};
const MINED = new Map();
const mine = (from) => MINED.get(from) || MINED.set(from, new Promise((resolve, reject) => execFile(MINER, [from, CREATEX, String(ZEROS)], { timeout: 900_000 }, (e, out) => {
  if (e) { MINED.delete(from); return reject(e); }
  const salt = /salt (0x[0-9a-f]{64})/.exec(out)?.[1], { guarded, address } = create3(from, salt);
  if (!address.toLowerCase().startsWith('0x' + '00'.repeat(ZEROS)) || /address (0x[0-9a-f]{40})/.exec(out)?.[1] !== address.toLowerCase()) { MINED.delete(from); return reject(new Error('the miner and the check disagree')); }
  resolve({ salt, guarded, address });
}))).get(from);
const NAME = 'anon.wei', WNS = '0x0000000000696760e15f265e828db644a0c242eb', TOKEN = namehash(NAME);
const pageHash = keccak256(page), GAS = Math.round(page.length * 225 + 1.6e6);   // measured: 54.7M for the 243 KB page

const html = `<!doctype html><html><head><meta charset="utf-8"><title>deploy tacit-pay</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,monospace;max-width:760px;margin:40px auto;padding:0 16px}button{font:inherit;padding:8px 14px;margin:4px 0}code{overflow-wrap:anywhere}.ok{color:#0a7d3a}.err{color:#b8341d}li{margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f1e8;padding:12px}
#pick{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}#pick button{display:flex;align-items:center;gap:8px}#pick img{width:20px;height:20px;border-radius:4px}</style></head><body>
<h2>deploy tacit-pay (anon.wei)</h2>
<p>Page ${manifest.bytes.toLocaleString('en-US')} bytes, sha256 <code>${manifest.sha256}</code>, keccak <code>${pageHash}</code>. ${chunks.length} chunks, then the wrapper with steward <code>${STEWARD}</code>: ${chunks.length + 1} transactions on Ethereum mainnet. Any account can deploy and pays the gas; the steward is set by the constructor.</p>
<p><button id="connect">Connect wallet</button> <span id="who"></span></p>
<div id="pick" hidden></div>
<p id="where"></p>
<p><button id="go" disabled>Deploy what is left</button> <button id="reset">Forget progress</button></p>
<p><button id="name" hidden>Point ${NAME} at it</button> <span id="named"></span></p>
<ol id="steps"></ol><pre id="out" hidden></pre>
<script>
const CHUNKS = ${JSON.stringify(chunks)}, RUNTIMES = ${JSON.stringify(runtimes)}, BYTECODE = ${JSON.stringify(bytecode)};
const STEWARD = ${JSON.stringify(STEWARD)}, PAGE_HASH = ${JSON.stringify(pageHash)}, SHA = ${JSON.stringify(manifest.sha256)}, GAS = ${GAS}, CREATEX = ${JSON.stringify(CREATEX)}, DEPLOY3 = ${JSON.stringify(DEPLOY3)}, COMPUTE3 = ${JSON.stringify(COMPUTE3)}, VANITY = ${existsSync(MINER)}, NAME = ${JSON.stringify(NAME)}, WNS = ${JSON.stringify(WNS)}, TOKEN = ${JSON.stringify(TOKEN)};
const KEY = 'tacit-pay-deploy-1-' + SHA.slice(0, 16);
let st = JSON.parse(localStorage.getItem(KEY) || '{"chunks":[]}'), eth = null, from = null;
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
// Whether every chunk slot 0..CHUNKS.length-1 is filled: checked by index, not by scanning st.chunks itself, since
// that array starts empty (st.chunks.some(...) on [] is always false, which would say "nothing left to do" when
// really nothing has even been attempted yet).
const allChunksIn = () => Array.from({ length: CHUNKS.length }, (_, i) => i).every((i) => st.chunks[i]);
const $ = (s) => document.querySelector(s), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A wallet's own RPC node can answer "rate limit exceeded" under a burst of reads (discover() below can send several
// dozen in a row); that is backed off and retried here, rather than left to abort whatever called it.
async function rpc(method, params = []) {
  for (let i = 0; ; i++) {
    try { return await eth.request({ method, params }); }
    catch (e) {
      if (i >= 5 || !/rate.?limit|too many requests|\b429\b/i.test(e?.message || '')) throw e;
      await sleep(500 * 2 ** i);
    }
  }
}
// A wallet that never answers (its popup dismissed, backgrounded, or dropped) would otherwise hang this await with no
// sign of it: after 8 s a note appears saying so. There is no way to cancel a pending wallet request, so the only way
// out is to find and answer it in the wallet, or reload: reconcile() re-checks every address against the chain before
// anything more is sent, so a reload never sends what is already on it twice.
function nudged(p, label, append = (el) => $('#steps').appendChild(el)) {
  const t = setTimeout(() => {
    const el = document.createElement('div');
    el.innerHTML = '<span class="err">Still waiting on your wallet for ' + label + '. Check its popup or toolbar icon (it can open behind this window). If there is truly nothing pending there, reload this page and press the button again: nothing already sent is ever sent twice.</span>';
    append(el);
  }, 8000);
  return Promise.resolve(p).finally(() => clearTimeout(t));
}
// Every extension that announces itself (EIP-6963: MetaMask, Rainbow, Coinbase Wallet, Rabby, …) is offered by name, not
// just whichever one happened to grab window.ethereum first; a wallet that only sets window.ethereum is used when none
// announces.
const WALLETS = [];
window.addEventListener('eip6963:announceProvider', (e) => {
  const d = e.detail;
  if (!d?.info || !d.provider?.request || WALLETS.some((w) => w.info.uuid === d.info.uuid)) return;
  WALLETS.push(d);
});
const askWallets = () => window.dispatchEvent(new Event('eip6963:requestProvider'));
askWallets();
const installed = () => (WALLETS.length ? WALLETS : window.ethereum?.request ? [{ info: { name: 'Browser wallet', rdns: 'window.ethereum' }, provider: window.ethereum }] : []);
function pickWallet(list) {
  return new Promise((resolve) => {
    $('#pick').innerHTML = list.map((w, i) => '<button type="button" data-i="' + i + '">' + ((w.info.icon || '').indexOf('data:image') === 0 ? '<img src="' + w.info.icon + '" alt="">' : '') + '<span>' + w.info.name + '</span></button>').join('');
    $('#pick').hidden = false;
    document.querySelectorAll('#pick [data-i]').forEach((b) => b.onclick = () => { $('#pick').hidden = true; $('#pick').innerHTML = ''; resolve(list[b.dataset.i]); });
  });
}
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
  const h = await nudged(rpc('eth_sendTransaction', [{ from, data, gas, nonce: '0x' + nonce.toString(16) }]), label);
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
async function viaCreateX(data, expected, landed) {
  await onMainnet();
  if (await landed(expected)) return expected;
  if ((await code(expected)).length > 2) throw new Error('Something else is already at ' + expected + '. Nothing was sent.');
  const gas = '0x' + Math.ceil(Number(BigInt(await rpc('eth_estimateGas', [{ from, to: CREATEX, data }]))) * 1.1).toString(16);
  const nonce = parseInt(await rpc('eth_getTransactionCount', [from, 'pending']), 16);
  paint('confirm the wrapper in your wallet (through CreateX)');
  const h = await nudged(rpc('eth_sendTransaction', [{ from, to: CREATEX, data, gas, nonce: '0x' + nonce.toString(16) }]), 'the wrapper');
  paint('the wrapper: waiting for <code>' + h + '</code>');
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    if (r && r.status !== '0x1') throw new Error('The wrapper reverted in ' + h);
    if (await landed(expected)) return expected;
    if (parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16) > nonce && !(await rpc('eth_getTransactionReceipt', [h])) && !(await landed(expected)))
      throw new Error('Another transaction used nonce ' + nonce + ' (see the activity in your wallet). Nothing is lost: press the button again to carry on from what is on chain.');
    await sleep(3000);
  }
}
const wrapperOk = async (a) => { try { return (await code(a)).length > 4 && (await rpc('eth_call', [{ to: a, data: '0x5b700b59' }, 'latest'])).toLowerCase() === PAGE_HASH.toLowerCase(); } catch { return false; } };
// What this wallet's chain really holds: stored addresses that are not the intended contracts are forgotten.
// The wrapper's address, mined for this account: { salt, guarded, address }, checked against CreateX itself.
async function vanity() {
  if (!VANITY) return null;
  if (st.vanity?.from === from) return st.vanity;
  $('#where').textContent = 'Finding an address for this account…';
  const r = await fetch('/mine?from=' + from);
  if (!r.ok) throw new Error('The address could not be mined: ' + (await r.text()));
  const v = { from, ...(await r.json()) };
  const said = '0x' + (await rpc('eth_call', [{ to: CREATEX, data: COMPUTE3 + v.guarded.slice(2) }, 'latest'])).slice(-40);
  if (said.toLowerCase() !== v.address.toLowerCase()) throw new Error('CreateX puts that salt at ' + said + ', not ' + v.address + '. Nothing was sent.');
  st.vanity = v; save();
  return v;
}
async function reconcile() {
  for (let i = 0; i < CHUNKS.length; i++) if (st.chunks[i] && (await code(st.chunks[i])) !== RUNTIMES[i].toLowerCase()) delete st.chunks[i];
  if (st.wrapper && !(await wrapperOk(st.wrapper))) delete st.wrapper;
  save();
}
// A chunk's own address is remembered only once its transaction is seen confirmed, in this browser, in this tab: closing
// or reloading the page a moment too early, before that happens, leaves nothing recorded even though the chunk really
// did land. So before trusting what is remembered, this account's most recent nonces are checked directly against the
// chain: a plain creation's address is the same function of (account, nonce) whether or not anything was saved, and a
// chunk's bytes, once deployed, are exactly its build, nothing else ever matches. The window looks only at the most
// recent nonces, not every one back to zero, so it costs the same whether this account is brand new or has a long
// history of its own unrelated activity. (The wrapper does not need this: its address comes from a mined CreateX salt,
// not a nonce, so it is already found this way regardless of what is saved.)
async function discover() {
  if (allChunksIn() || !st.chunks.length) return;   // nothing missing, or nothing ever attempted: nothing to find
  let left = CHUNKS.length - st.chunks.filter(Boolean).length;
  const sent = parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16);
  const WINDOW = 8, from0 = Math.max(0, sent - WINDOW);   // the gap is always just the last send or two, never more
  for (let n = sent - 1; n >= from0 && left > 0; n--) {
    const a = await (await fetch('/addr?from=' + from + '&nonce=' + n)).text(), c = await code(a);
    for (let i = 0; i < CHUNKS.length; i++) if (!st.chunks[i] && c === RUNTIMES[i].toLowerCase()) { st.chunks[i] = a; left--; break; }
  }
  save();
}
$('#connect').onclick = async () => {
  askWallets(); await sleep(150);
  const list = installed();
  if (!list.length) return paint('<span class="err">No wallet found in this browser. Install one (MetaMask, Rainbow, Coinbase Wallet, …) and reload.</span>');
  const w = list.length > 1 ? await pickWallet(list) : list[0];
  if (!w) return;
  eth = w.provider;
  $('#who').textContent = 'connecting to ' + w.info.name + '…';
  const whereNudge = (el) => $('#where').appendChild(el);
  try {
    [from] = await nudged(rpc('eth_requestAccounts'), 'connecting ' + w.info.name, whereNudge);
    if (parseInt(await rpc('eth_chainId'), 16) !== 1) { try { await nudged(rpc('wallet_switchEthereumChain', [{ chainId: '0x1' }]), 'switching to Ethereum mainnet', whereNudge); } catch {} }
    await onMainnet();
    await reconcile();
    if (!allChunksIn()) { $('#where').textContent = 'Checking this account’s recent transactions for anything already deployed…'; await discover(); paint(); }
    const v = await vanity();
    $('#where').innerHTML = v ? 'The page’s contract will be at <code>' + v.address + '</code>, deployed through CreateX: only ' + from + ' can claim it.' : 'The wrapper will be a plain creation (the address miner is not built).';
    const [bal, gp] = await Promise.all([rpc('eth_getBalance', [from, 'latest']), rpc('eth_gasPrice')]);
    $('#who').textContent = w.info.name + ' · ' + from + ' · ' + (Number(BigInt(bal)) / 1e18).toFixed(5) + ' ETH · gas ' + (Number(BigInt(gp)) / 1e9).toFixed(3) + ' gwei · the whole deploy ≈ ' + (Number(BigInt(gp)) * GAS / 1e18).toFixed(4) + ' ETH';
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
      const v = await vanity();
      if (v) {
        // CreateX's deployCreate3(salt, initCode): the address is the mined one whatever the nonce, so a replaced
        // transaction is found there too.
        const initCode = BYTECODE + args, len = (initCode.length - 2) / 2;
        const data = DEPLOY3 + word(v.salt) + word((64).toString(16)) + word(len.toString(16)) + initCode.slice(2).padEnd(Math.ceil(len / 32) * 64, '0');
        st.wrapper = await viaCreateX(data, v.address, wrapperOk);
      } else st.wrapper = await create(BYTECODE + args, 'the wrapper', wrapperOk);
      save();
    }
    const call = async (sig) => rpc('eth_call', [{ to: st.wrapper, data: sig }, 'latest']);
    const [hash, steward] = await Promise.all([call('0x5b700b59'), call('0x637eea19')]);
    paint(hash.toLowerCase() === PAGE_HASH.toLowerCase() && steward.slice(-40).toLowerCase() === STEWARD.slice(2).toLowerCase() ? '<span class="ok">Done: the wrapper commits to this page and names the steward.</span>' : '<span class="err">Deployed, but PAGE_HASH or steward does not read back as expected.</span>');
    $('#out').hidden = false;
    $('#name').hidden = false;
    $('#out').textContent = 'manifest.json "deployment":\\n' + JSON.stringify({ chainId: 1, contract: st.wrapper, pageSha256: SHA, steward: STEWARD, chunkContracts: st.chunks, routes: [
      { kind: 'erc8244', url: 'https://' + st.wrapper.toLowerCase() + '.w4eth.io/', serves: 'exact' },
      { kind: 'erc4804', url: 'https://' + st.wrapper.toLowerCase() + '.1.w3link.io/', serves: 'modified', note: "w3link injects its own script, which the page's CSP refuses; the bytes it serves are not the bytes html() returns" },
      { kind: 'wns', url: 'https://anon.wei.limo/', serves: 'exact' } ] }, null, 2);
  } catch (e) { paint('<span class="err">' + (e.message || e) + '</span>'); }
  $('#go').disabled = false;
};
// The name: WNS setAddr(tokenId, wrapper) from the wallet that owns it, simulated first, then read back.
$('#name').onclick = async () => {
  const say = (t) => { $('#named').innerHTML = t; };
  $('#name').disabled = true;
  try {
    await onMainnet();
    [from] = await rpc('eth_accounts');
    if (!st.wrapper || !(await wrapperOk(st.wrapper))) throw new Error('Deploy the page first.');
    const data = '0xeba36dbd' + word(TOKEN) + word(st.wrapper);
    try { await rpc('eth_call', [{ from, to: WNS, data }, 'latest']); }
    catch { throw new Error('Only the wallet that owns ' + NAME + ' can point it. Switch to that account in your wallet and press again.'); }
    say('confirm in your wallet');
    const h = await nudged(rpc('eth_sendTransaction', [{ from, to: WNS, data }]), 'pointing ' + NAME, (el) => $('#named').appendChild(el));
    say('waiting for <code>' + h + '</code>');
    let r = null;
    for (let i = 0; i < 200 && !r; i++) { r = await rpc('eth_getTransactionReceipt', [h]); if (!r) await sleep(3000); }
    if (!r || r.status !== '0x1') throw new Error('The transaction did not go through: ' + h);
    const now = '0x' + (await rpc('eth_call', [{ to: WNS, data: '0x4f896d4f' + word(TOKEN) }, 'latest'])).slice(-40);
    if (now.toLowerCase() !== st.wrapper.toLowerCase()) throw new Error(NAME + ' resolves to ' + now + ', not the wrapper.');
    say('<span class="ok">' + NAME + ' now points at ' + st.wrapper + '.</span> Check https://' + NAME + '.limo/ in a minute.');
  } catch (e) { say('<span class="err">' + (e.message || e) + '</span>'); }
  $('#name').disabled = false;
};
paint();
</script></body></html>`;
const port = Number(process.argv[2] || 8444);
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://localhost');
  if (u.pathname === '/mine') {
    Promise.resolve().then(() => mine(getAddress(u.searchParams.get('from')))).then((v) => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(v)); },
      (e) => { r.writeHead(500, { 'content-type': 'text/plain' }); r.end(String(e.message || e)); });
    return;
  }
  if (u.pathname === '/addr') {                       // where a contract creation by `from` at `nonce` lands
    try { r.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); r.end(getCreateAddress({ from: getAddress(u.searchParams.get('from')), nonce: Number(u.searchParams.get('nonce')) })); }
    catch { r.writeHead(400); r.end(); }
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); r.end(html);
})
  .listen(port, '127.0.0.1', () => console.log(`deploy tacit-pay: http://127.0.0.1:${port}/  (${chunks.length} chunks + wrapper, steward ${STEWARD})`));
