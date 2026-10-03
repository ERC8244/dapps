#!/usr/bin/env node
// Serves a page on localhost that deploys the NEXT generation of tacit-pay from a browser wallet: whichever chunks
// changed since the live wrapper, then deployNext(initcode, salt) on that wrapper itself. A chunk whose bytes are
// unchanged from the live deployment is reused at its existing address instead of redeployed — checked against
// mainnet at startup here, not assumed from an edit history.
//   node ../scripts/chunk.mjs tacit-pay && forge build && node deploy/deploy-next-helper.mjs [port]     (from tacit-pay/)
// Never `forge build --force` or `forge clean` between chunk.mjs and this: they delete out/.
// deployNext does a plain CREATE2 from the current wrapper's own address, and only the steward can call it: no CreateX
// hop needed, since there is no front-running risk to guard against. The address can still be mined for leading zero
// bytes with deploy/vanity/target/release/vanity2 (built alongside vanity: cargo build --release --offline --manifest-path
// deploy/vanity/Cargo.toml). Without it, the next generation lands at whatever address a zero salt gives.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../', import.meta.url).pathname;
const STEWARD = '0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20';
const OLD_WRAPPER = '0x0000001e01D6ee371b51b49dc80E9B96b238e7c5';   // the live, verified generation this one succeeds
const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
const page = readFileSync(DIR + manifest.page);
if (page.length !== manifest.bytes || createHash('sha256').update(page).digest('hex') !== manifest.sha256) throw new Error('the page is not the one the manifest pins');
const files = readdirSync(DIR + 'out').filter((f) => /^TacitPay8244\.chunk\d+\.creation\.txt$/.test(f)).sort((a, b) => Number(a.match(/chunk(\d+)/)[1]) - Number(b.match(/chunk(\d+)/)[1]));
const chunks = files.map((f) => readFileSync(DIR + 'out/' + f, 'utf8').trim());
const runtimes = chunks.map((c) => '0x' + c.slice(2 + 20));   // the 10-byte stub, then the runtime
if (Buffer.concat(runtimes.map((r) => Buffer.from(r.slice(4), 'hex'))).compare(page) !== 0) throw new Error('the chunks do not reassemble to the page');
const bytecode = JSON.parse(readFileSync(DIR + 'out/TacitPay8244.sol/TacitPay8244.json', 'utf8')).bytecode.object;
const { keccak256, getCreateAddress, getAddress, concat, AbiCoder, id, namehash } = await import(new URL('../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);

// The live generation's chunk addresses, in order. Whichever of these still carries the right bytes for the current
// chunk at the same index is reused; the rest are redeployed. Checked against mainnet below, not assumed.
const PREV_CHUNKS = [
  '0x55090Db872Cd69abC404065652FbfF00bB7C0d0c', '0x86671Ec8a873FC9277e99b4a0da244087476e7f2',
  '0xE4bF37A5ce872F27946C17ee803c0f7F827c68b3', '0xe8fb74740De2D47d71D760139B30e30B652B13f4',
  '0xc572e7526224F74911Ad4A580E0402ecD6DaE0c2', '0xC7ab1591cC002729CB63939b2cF426c8936d78Fc',
  '0x9a4EEEae095B3BC7F59fdc4e3d8ed0A5f84c4E56', '0x01f0F5152C48F9478Ca4881320b8dbc6bFBD1357',
  '0x97F63235F5a01d5409Ed1d6521b2F3C549D1a022', '0xdc7308635c813580d955118c88a682fAB974521f',
  '0x9572e4D8F0e85f073FAB9d77989A7739B8A79576', '0xe83358905B560D9a97133d008C7f276E3fa941de',
];
const RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const rpcCall = async (method, params) => {
  const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(method + ': ' + j.error.message);
  return j.result;
};
const reused = await Promise.all(PREV_CHUNKS.map(async (a, i) => {
  if (i >= runtimes.length) return null;
  const code = (await rpcCall('eth_getCode', [a, 'latest'])).toLowerCase();
  return code === runtimes[i].toLowerCase() ? a : null;
}));
const needsDeploy = reused.map((a, i) => (a ? -1 : i)).filter((i) => i !== -1);
if (!needsDeploy.length) throw new Error('every chunk already matches the live generation; there is nothing to deploy next');

const pageHash = keccak256(page);
const GAS = Math.round(needsDeploy.reduce((s, i) => s + (runtimes[i].length - 2) / 2, 0) * 225 + 1.8e6);   // rough: changed chunks + one deployNext
const MINER = DIR + 'deploy/vanity/target/release/vanity2', ZEROS = Number(process.env.ZEROS || 3), VANITY = existsSync(MINER);
const DEPLOYNEXT = id('deployNext(bytes,bytes32)').slice(0, 10);
const create2Address = (deployer, salt, initcodeHash) => getAddress('0x' + keccak256(concat(['0xff', deployer, salt, initcodeHash])).slice(26));

// The new generation's constructor args and deployNext calldata, for one final chunk list: built with ethers' own ABI
// coder rather than by hand, since getting an offset wrong in a real deployNext call is not a cheap mistake to make twice.
function buildCall(finalChunks) {
  const args = AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address[]', 'bytes32'], [STEWARD, OLD_WRAPPER, finalChunks, pageHash]);
  const initcode = bytecode + args.slice(2);
  return { initcode, initcodeHash: keccak256(initcode) };
}
const MINED = new Map();
function mineFor(finalChunks) {
  const key = finalChunks.join(',').toLowerCase();
  if (MINED.has(key)) return MINED.get(key);
  const p = (async () => {
    const { initcode, initcodeHash } = buildCall(finalChunks);
    let salt = '0x' + '00'.repeat(32);
    if (VANITY) {
      const out = await new Promise((resolve, reject) => execFile(MINER, [OLD_WRAPPER, initcodeHash, String(ZEROS)], { timeout: 900_000 }, (e, o) => (e ? reject(e) : resolve(o))));
      salt = /salt (0x[0-9a-f]{64})/.exec(out)?.[1];
      if (!salt) throw new Error('the miner did not report a salt');
    }
    const address = create2Address(OLD_WRAPPER, salt, initcodeHash);
    if (VANITY && !address.toLowerCase().startsWith('0x' + '00'.repeat(ZEROS))) throw new Error('the miner and the check disagree');
    const data = DEPLOYNEXT + AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes32'], [initcode, salt]).slice(2);
    return { salt, address, data };
  })();
  MINED.set(key, p);
  p.catch(() => MINED.delete(key));
  return p;
}
const NAME = 'anon.wei', WNS = '0x0000000000696760e15f265e828db644a0c242eb', TOKEN = namehash(NAME);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>deploy tacit-pay: next generation</title>
<style>body{font:14px/1.6 ui-monospace,Menlo,monospace;max-width:760px;margin:40px auto;padding:0 16px}button{font:inherit;padding:8px 14px;margin:4px 0}code{overflow-wrap:anywhere}.ok{color:#0a7d3a}.err{color:#b8341d}li{margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f1e8;padding:12px}
#pick{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}#pick button{display:flex;align-items:center;gap:8px}#pick img{width:20px;height:20px;border-radius:4px}</style></head><body>
<h2>deploy tacit-pay: next generation</h2>
<p>Page ${manifest.bytes.toLocaleString('en-US')} bytes, sha256 <code>${manifest.sha256}</code>, keccak <code>${pageHash}</code>. ${needsDeploy.length} of ${chunks.length} chunks changed since <code>${OLD_WRAPPER}</code>; the rest are reused at their live addresses. ${needsDeploy.length + 1} transactions on Ethereum mainnet, from the steward wallet <code>${STEWARD}</code>.</p>
<p><button id="connect">Connect wallet</button> <span id="who"></span></p>
<div id="pick" hidden></div>
<p id="where"></p>
<p><button id="go" disabled>Deploy what is left</button> <button id="reset">Forget progress</button></p>
<p><button id="name" hidden>Point ${NAME} at it</button> <span id="named"></span></p>
<ol id="steps"></ol><pre id="out" hidden></pre>
<script>
const ALL_RUNTIMES = ${JSON.stringify(runtimes)}, NEEDS = ${JSON.stringify(needsDeploy)}, NEW_CREATION = ${JSON.stringify(Object.fromEntries(needsDeploy.map((i) => [i, chunks[i]])))};
const REUSED = ${JSON.stringify(Object.fromEntries(reused.map((a, i) => [i, a]).filter(([, a]) => a)))};
const STEWARD = ${JSON.stringify(STEWARD)}, OLD_WRAPPER = ${JSON.stringify(OLD_WRAPPER)}, PAGE_HASH = ${JSON.stringify(pageHash)}, SHA = ${JSON.stringify(manifest.sha256)}, GAS = ${GAS};
const VANITY = ${VANITY}, NAME = ${JSON.stringify(NAME)}, WNS = ${JSON.stringify(WNS)}, TOKEN = ${JSON.stringify(TOKEN)};
const KEY = 'tacit-pay-deploy-next-' + OLD_WRAPPER.slice(2, 10) + '-' + SHA.slice(0, 16);
let st = JSON.parse(localStorage.getItem(KEY) || JSON.stringify({ chunks: Object.assign(new Array(ALL_RUNTIMES.length), REUSED) })), eth = null, from = null;
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
// Whether every chunk slot 0..ALL_RUNTIMES.length-1 is filled: checked by index, not by scanning st.chunks itself,
// since an array with holes answers "does any filled slot fail this test" wrong for the holes themselves.
const allChunksIn = () => Array.from({ length: ALL_RUNTIMES.length }, (_, i) => i).every((i) => st.chunks[i]);
const $ = (s) => document.querySelector(s), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A wallet's own RPC node can answer "rate limit exceeded" under a burst of reads; that is backed off and retried
// here, rather than left to abort whatever called it.
async function rpc(method, params = []) {
  for (let i = 0; ; i++) {
    try { return await eth.request({ method, params }); }
    catch (e) {
      if (i >= 5 || !/rate.?limit|too many requests|\\b429\\b/i.test(e?.message || '')) throw e;
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
  const items = ALL_RUNTIMES.map((_, i) => '<li>chunk ' + (i + 1) + ': ' + (st.chunks[i] ? '<span class="ok">' + st.chunks[i] + (REUSED[i] ? ' (reused)' : '') + '</span>' : '…') + '</li>');
  items.push('<li>next generation: ' + (st.next ? '<span class="ok">' + st.next + '</span>' : '…') + '</li>');
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
// deployNext on the live wrapper: a plain call, not a creation, so it is sent with a "to" address and checked the
// same way chunks are — by what the address holds, not by trusting that a receipt came back.
async function viaWrapper(data, expected) {
  await onMainnet();
  if (await nextOk(expected)) return expected;
  if ((await code(expected)).length > 2) throw new Error('Something else is already at ' + expected + '. Nothing was sent.');
  const gas = '0x' + Math.ceil(Number(BigInt(await rpc('eth_estimateGas', [{ from, to: OLD_WRAPPER, data }]))) * 1.1).toString(16);
  const nonce = parseInt(await rpc('eth_getTransactionCount', [from, 'pending']), 16);
  paint('confirm the next generation in your wallet');
  const h = await nudged(rpc('eth_sendTransaction', [{ from, to: OLD_WRAPPER, data, gas, nonce: '0x' + nonce.toString(16) }]), 'the next generation');
  paint('the next generation: waiting for <code>' + h + '</code>');
  for (;;) {
    const r = await rpc('eth_getTransactionReceipt', [h]);
    if (r && r.status !== '0x1') throw new Error('deployNext reverted in ' + h);
    if (await nextOk(expected)) return expected;
    if (parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16) > nonce && !(await rpc('eth_getTransactionReceipt', [h])) && !(await nextOk(expected)))
      throw new Error('Another transaction used nonce ' + nonce + ' (see the activity in your wallet). Nothing is lost: press the button again to carry on from what is on chain.');
    await sleep(3000);
  }
}
const nextOk = async (a) => { try { return (await code(a)).length > 4 && (await rpc('eth_call', [{ to: a, data: '0x5b700b59' }, 'latest'])).toLowerCase() === PAGE_HASH.toLowerCase(); } catch { return false; } };
async function reconcile() {
  for (let i = 0; i < ALL_RUNTIMES.length; i++) if (st.chunks[i] && (await code(st.chunks[i])) !== ALL_RUNTIMES[i].toLowerCase()) delete st.chunks[i];
  if (st.next && !(await nextOk(st.next))) delete st.next;
  save();
}
// Same reasoning as the first deploy's helper: a chunk's address is remembered only once its transaction is seen
// confirmed, in this browser, in this tab, so a reload a moment too early leaves nothing recorded even though it
// landed. The window looks only at the most recent nonces.
async function discover() {
  if (allChunksIn() || !st.chunks.filter(Boolean).length) return;
  let left = ALL_RUNTIMES.length - st.chunks.filter(Boolean).length;
  const sent = parseInt(await rpc('eth_getTransactionCount', [from, 'latest']), 16);
  const WINDOW = 8, from0 = Math.max(0, sent - WINDOW);
  for (let n = sent - 1; n >= from0 && left > 0; n--) {
    const a = await (await fetch('/addr?from=' + from + '&nonce=' + n)).text(), c = await code(a);
    for (const i of NEEDS) if (!st.chunks[i] && c === ALL_RUNTIMES[i].toLowerCase()) { st.chunks[i] = a; left--; break; }
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
    if (from.toLowerCase() !== STEWARD.toLowerCase()) $('#where').innerHTML = '<span class="err">This wallet is not the steward (' + STEWARD + '). deployNext will revert if sent from here.</span>';
    await reconcile();
    if (!allChunksIn()) { $('#where').textContent = 'Checking this account’s recent transactions for anything already deployed…'; await discover(); paint(); }
    const [bal, gp] = await Promise.all([rpc('eth_getBalance', [from, 'latest']), rpc('eth_gasPrice')]);
    $('#who').textContent = w.info.name + ' · ' + from + ' · ' + (Number(BigInt(bal)) / 1e18).toFixed(5) + ' ETH · gas ' + (Number(BigInt(gp)) / 1e9).toFixed(3) + ' gwei · the rest of the deploy ≈ ' + (Number(BigInt(gp)) * GAS / 1e18).toFixed(4) + ' ETH';
    $('#go').disabled = false;
    paint();
  } catch (e) { paint('<span class="err">' + (e.message || e) + '</span>'); }
};
$('#reset').onclick = () => { if (confirm('Forget the addresses deployed so far? (They stay on chain.)')) { st = { chunks: Object.assign(new Array(ALL_RUNTIMES.length), REUSED) }; save(); paint(); } };
$('#go').onclick = async () => {
  $('#go').disabled = true;
  try {
    for (const i of NEEDS) {
      if (st.chunks[i]) continue;
      const a = await create(NEW_CREATION[i], 'chunk ' + (i + 1), async (x) => (await code(x)) === ALL_RUNTIMES[i].toLowerCase());
      if ((await code(a)) !== ALL_RUNTIMES[i].toLowerCase()) throw new Error('chunk ' + (i + 1) + ' at ' + a + ' is not its build');
      st.chunks[i] = a; save(); paint();
    }
    if (!st.next) {
      $('#where').textContent = VANITY ? 'Finding an address for the next generation…' : 'Preparing the next generation…';
      const r = await fetch('/mine2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chunks: st.chunks }) });
      if (!r.ok) throw new Error('Could not prepare the next generation: ' + (await r.text()));
      const { data, address } = await r.json();
      $('#where').innerHTML = 'The next generation will be at <code>' + address + '</code>, deployed by the live contract itself.';
      st.next = await viaWrapper(data, address);
      save();
    }
    const call = async (sig, to) => rpc('eth_call', [{ to, data: sig }, 'latest']);
    const [hash, prev, steward] = await Promise.all([call('0x5b700b59', st.next), call('0x247dfaa8', st.next), call('0x637eea19', st.next)]);
    paint(hash.toLowerCase() === PAGE_HASH.toLowerCase() && prev.slice(-40).toLowerCase() === OLD_WRAPPER.slice(2).toLowerCase() && steward.slice(-40).toLowerCase() === STEWARD.slice(2).toLowerCase()
      ? '<span class="ok">Done: the next generation commits to this page, names the steward, and points back at the live one.</span>'
      : '<span class="err">Deployed, but PAGE_HASH, PREVIOUS or steward does not read back as expected.</span>');
    $('#out').hidden = false;
    $('#name').hidden = false;
    $('#out').textContent = 'manifest.json "deployment":\\n' + JSON.stringify({ chainId: 1, contract: st.next, previous: OLD_WRAPPER, pageSha256: SHA, steward: STEWARD, chunkContracts: st.chunks, routes: [
      { kind: 'erc8244', url: 'https://' + st.next.toLowerCase() + '.w4eth.io/', serves: 'exact' },
      { kind: 'erc4804', url: 'https://' + st.next.toLowerCase() + '.1.w3link.io/', serves: 'modified', note: "w3link injects its own script, which the page's CSP refuses; the bytes it serves are not the bytes html() returns" },
      { kind: 'wns', url: 'https://anon.wei.limo/', serves: 'exact' } ] }, null, 2);
  } catch (e) { paint('<span class="err">' + (e.message || e) + '</span>'); }
  $('#go').disabled = false;
};
// The name: WNS setAddr(tokenId, next) from the wallet that owns it, simulated first, then read back.
$('#name').onclick = async () => {
  const say = (t) => { $('#named').innerHTML = t; };
  $('#name').disabled = true;
  try {
    await onMainnet();
    [from] = await rpc('eth_accounts');
    if (!st.next || !(await nextOk(st.next))) throw new Error('Deploy the next generation first.');
    const data = '0xeba36dbd' + word(TOKEN) + word(st.next);
    try { await rpc('eth_call', [{ from, to: WNS, data }, 'latest']); }
    catch { throw new Error('Only the wallet that owns ' + NAME + ' can point it. Switch to that account in your wallet and press again.'); }
    say('confirm in your wallet');
    const h = await nudged(rpc('eth_sendTransaction', [{ from, to: WNS, data }]), 'pointing ' + NAME, (el) => $('#named').appendChild(el));
    say('waiting for <code>' + h + '</code>');
    let r = null;
    for (let i = 0; i < 200 && !r; i++) { r = await rpc('eth_getTransactionReceipt', [h]); if (!r) await sleep(3000); }
    if (!r || r.status !== '0x1') throw new Error('The transaction did not go through: ' + h);
    const now = '0x' + (await rpc('eth_call', [{ to: WNS, data: '0x4f896d4f' + word(TOKEN) }, 'latest'])).slice(-40);
    if (now.toLowerCase() !== st.next.toLowerCase()) throw new Error(NAME + ' resolves to ' + now + ', not the next generation.');
    say('<span class="ok">' + NAME + ' now points at ' + st.next + '.</span> Check https://' + NAME + '.limo/ in a minute.');
  } catch (e) { say('<span class="err">' + (e.message || e) + '</span>'); }
  $('#name').disabled = false;
};
paint();
</script></body></html>`;
const port = Number(process.argv[2] || 8445);
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://localhost');
  if (u.pathname === '/mine2' && q.method === 'POST') {
    let body = '';
    q.on('data', (c) => { body += c; });
    q.on('end', () => {
      Promise.resolve().then(() => {
        const { chunks: submitted } = JSON.parse(body);
        if (!Array.isArray(submitted) || submitted.length !== runtimes.length || submitted.some((a) => !a)) throw new Error('expected ' + runtimes.length + ' chunk addresses, all filled');
        return mineFor(submitted.map((a) => getAddress(a)));
      }).then((v) => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(v)); },
        (e) => { r.writeHead(500, { 'content-type': 'text/plain' }); r.end(String(e.message || e)); });
    });
    return;
  }
  if (u.pathname === '/addr') {                       // where a contract creation by `from` at `nonce` lands
    try { r.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); r.end(getCreateAddress({ from: getAddress(u.searchParams.get('from')), nonce: Number(u.searchParams.get('nonce')) })); }
    catch { r.writeHead(400); r.end(); }
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); r.end(html);
})
  .listen(port, '127.0.0.1', () => console.log(`deploy tacit-pay next generation: http://127.0.0.1:${port}/  (${needsDeploy.length} of ${chunks.length} chunks changed, steward ${STEWARD}, previous ${OLD_WRAPPER})`));
