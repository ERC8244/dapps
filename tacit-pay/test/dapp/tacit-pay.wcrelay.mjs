/* The page's WalletConnect client settles a pairing, and a request to the wallet, only from what the wallet sends encrypted
   under the session's key: a frame the relay makes up, a message of the page's own sent back to it, and a second answer to
   the proposal do not. A receipt that one node reports as failed is taken as failed when a second node reports it too. A
   wallet that pairs and answers is unaffected. An in-process relay and local nodes, no browser, no network: the code is
   read out of dapp/page.html.

   Usage: node test/dapp/tacit-pay.wcrelay.mjs                                                                              */
import http from 'node:http';
import crypto from 'node:crypto';
import { mod } from './page-config.mjs';
import { makeRelay, honestWallet, seal, topicOf } from './wc-fake-relay.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// What a promise does within `ms`: { v } resolved, { e } rejected, null still waiting.
const within = (p, ms = 700) => Promise.race([p.then((v) => ({ v }), (e) => ({ e })), sleep(ms).then(() => null)]);

const L = mod.split('\n');
const line = (re, from = 0) => { const i = L.findIndex((l, k) => k >= from && re.test(l)); if (i < 0) throw new Error('page layout changed: ' + re); return i; };
const lines = (a, b) => L.slice(a, b + 1).join('\n');

// The WalletConnect section with the helpers it uses.
const b0 = line(/^const te = new TextEncoder\(\);/), b1 = line(/^const isAddr = /);
const s0 = line(/^const sha256 = \(\(\) => \{/), s1 = line(/^\}\)\(\);/, s0);
const w0 = line(/^\/\/ ── WalletConnect, lean ──/), w1 = line(/^\/\/ ── end of WalletConnect ──/);
const wcCode = [
  'const document = { addEventListener() {}, hidden: false };',
  'const store = new Map(); globalThis.sessionStorage ??= { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };',
  lines(b0, b1), lines(s0, s1), L[line(/^const sleep = /)], L[line(/^const noteOf = /)],
  "const CHAINS = [{ chainId: 1, full: 'Ethereum', key: 'ethereum' }, { chainId: 8453, full: 'Base', key: 'base' }, { chainId: 4663, full: 'Robinhood Chain', key: 'robinhood' }];",
  'const chainOf = (x) => CHAINS.find((c) => c.chainId === Number(x) || c.key === lc(x)); const S = { chain: CHAINS[1] }; const REG = {}; const SENT_KEY = "tacit-pay-sent-v1"; const setSent = () => {};',
  lines(w0, w1),
  'export { wcClient, wcProvider, appLink };',
].join('\n');
const { wcClient, wcProvider, appLink } = await import('data:text/javascript;base64,' + Buffer.from(wcCode).toString('base64'));

const META = { name: 'anon.wei', description: 'Private ETH payments', url: 'https://anon.wei.limo', icons: [] };
const TX = { from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', to: '0x' + '22'.repeat(20), value: '0x1', chainId: '0x1' };
const pair = async (relay, wallet) => { const client = wcClient(relay.factory), { uri, done } = await client.pair([1, 8453, 4663], META); wallet?.pair(uri); return { client, done }; };

console.log('a wallet');
{
  const relay = makeRelay(), wallet = honestWallet(relay), { client, done } = await pair(relay, wallet);
  const s = await within(done, 8000);
  ok(!!s?.v && /^eip155:1:0xf39f/i.test(s.v.accounts[0]), 'pairs', s?.v?.accounts[0]);
  const h = s?.v && await within(wcProvider(client, s.v, async () => '0x').request({ method: 'eth_sendTransaction', params: [TX] }), 8000);
  ok(h?.v === '0x' + 'ab'.repeat(32), 'its answer to a request is the answer the page gets', h?.v);
  client.close();
}

console.log('frames the relay makes up');
{
  const relay = makeRelay(), key = crypto.randomBytes(32);
  // The proposal's id is drawn just before the subscribe call's own.
  relay.hooks.push((m) => {
    if (m.method !== 'irn_subscribe' || relay.sent) return;
    relay.sent = true;
    for (const g of [m.id - 1, m.id - 1001, m.id + 999]) setTimeout(() => relay.inject({ id: 'p' + g, jsonrpc: '2.0', result: { topic: topicOf(key), key: [...key], accounts: ['eip155:1:0x70997970C51812dc3A010C7d01b50e0d17dc79C8'], methods: ['personal_sign', 'eth_sendTransaction'], expiry: Math.floor(Date.now() / 1000) + 604800, peerName: 'MetaMask', native: null } }), 30);
  });
  const { client, done } = await pair(relay, null);
  const s = await within(done);
  ok(s === null, 'a pairing is not completed by one', s?.v?.accounts[0]);
  client.close();
}
{
  const relay = makeRelay(), wallet = honestWallet(relay, { onRequest: () => {} }), { client, done } = await pair(relay, wallet);   // the wallet has the prompt open
  const session = (await within(done, 8000))?.v, provider = wcProvider(client, session, async () => '0x');
  let rid = null;
  relay.hooks.push((m) => { if (m.method === 'irn_publish' && m.params.tag === 1108 && rid === null) rid = m.id; });
  const asked = provider.request({ method: 'eth_sendTransaction', params: [TX] });
  await sleep(200);
  // A request's own id is drawn just before the publish call's.
  for (const g of [rid - 1, rid - 1001, rid + 999, rid - 2, rid - 1002]) relay.inject({ id: 's' + g, jsonrpc: '2.0', result: '0x' + 'cd'.repeat(32) });
  const r = await within(asked);
  ok(rid !== null && wallet.requests.length === 1 && r === null, 'a request the wallet has not answered is not answered by one', r?.v);
  // The page's own request, sent back as it was published.
  const own = relay.kept.get(session.topic).filter((k) => k.tag === 1108).pop();
  relay.toPage(session.topic, own.message, 1108);
  const r2 = await within(asked);
  ok(r2 === null, 'nor by the page\u2019s own request sent back to it', r2 && String(r2.v));
  client.close();
}

console.log('a second answer to the proposal');
{
  const relay = makeRelay(), wallet = honestWallet(relay), { client, done } = await pair(relay, wallet);
  await within(done, 8000);
  const { symKey, pairTopic, proposal } = wallet.session;
  const kp = crypto.generateKeyPairSync('x25519'), pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const theirs = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(proposal.params.proposer.publicKey, 'hex')]), format: 'der', type: 'spki' });
  const topic2 = topicOf(Buffer.from(crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: theirs }), Buffer.alloc(0), Buffer.alloc(0), 32)));
  relay.toPage(pairTopic, seal(symKey, { id: proposal.id, jsonrpc: '2.0', result: { relay: { protocol: 'irn' }, responderPublicKey: Buffer.from(pub).toString('hex') } }), 1101);
  await sleep(500);
  ok(!relay.subs.has(topic2), 'opens no second session');
  client.close();
}

console.log('a wallet app link');
{
  ok(appLink('metamask://') === 'metamask://' && appLink('rainbow://') === 'rainbow://', 'the app’s own scheme is kept');
  const bad = ['itms-services://?action=download-manifest&url=https%3A%2F%2Fx.test%2Fm.plist', 'market://details?id=x.y', 'tg://resolve?domain=x', 'https://x.test/', 'javascript:alert(1)', 'data://x', ''];
  ok(bad.every((u) => appLink(u) === null), 'a link with a path or a query, or a web or script one, is dropped');
}

console.log('a receipt reported as failed');
{
  // The page's own jsonRpc, rpcAt and WalletConnect reader, with nodes of this test: the first asked is `nodes[0]`.
  const t0 = line(/^function timeoutSignal\(/), t1 = line(/^\}/, t0), j0 = line(/^function jsonRpc\(/), j1 = line(/^const sleep = /, j0) - 1, r0 = line(/^const WCO = \{\}/), r1 = line(/^async function connectWc/) - 1;
  const code = [lines(t0, t1), L[line(/^const rpcPost = /)], lines(j0, j1), L[line(/^const RPCAT = /)], 'const mineOf = () => [], c0 = { chainId: 1, rpc: [...urls].reverse() }, chainOf = () => c0;', lines(r0, r1), 'return wcRead;'].join('\n');
  const serve = (receipt) => new Promise((res) => { const s = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { const j = JSON.parse(b); r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: j.method === 'eth_getTransactionReceipt' ? receipt : '0x1' })); }); }).listen(0, '127.0.0.1', () => res(s)); });
  const failed = { status: '0x0', logs: [] }, landed = { status: '0x1', logs: [] };
  const read = async (answers) => {
    const servers = await Promise.all(answers.map(serve)), urls = servers.map((s) => `http://127.0.0.1:${s.address().port}`);
    try { return await new Function('urls', code)(urls)(1, 'eth_getTransactionReceipt', ['0x' + 'ab'.repeat(32)]); } finally { servers.forEach((s) => s.close()); }
  };
  const status = (r) => (r === null ? 'not seen' : r.status);
  let r = await read([failed, null]);
  ok(r === null, 'one node reporting it failed, the next not having it, reads as not seen yet', status(r));
  r = await read([failed, landed]);
  ok(r === null, 'one node reporting it failed, the next that it landed, reads as not seen yet', status(r));
  r = await read([failed, failed]);
  ok(r?.status === '0x0', 'two nodes reporting it failed is failed', status(r));
  r = await read([landed, null]);
  ok(r?.status === '0x1', 'a receipt that landed is taken from the first node', status(r));
  r = await read([null, null]);
  ok(r === null, 'no receipt yet is no receipt', status(r));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
