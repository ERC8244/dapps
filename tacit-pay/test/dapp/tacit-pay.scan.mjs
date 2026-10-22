/* Reading a pool's history with many transactions in it: every output is tried against the view key, and the page shares
   that work out over workers made from its own code. A chain in memory holds N deposits to other keys and three to this
   one; the page, with no relay index, reads the logs and must find exactly this key's three, using its scan workers.

   Usage: [N=600] node test/dapp/tacit-pay.scan.mjs                 (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createRequire} from 'node:module';
import {mkNode, depositTo, lib} from './engine-mock.mjs';
import {config, html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

const N = Number(process.env.N || 600), E = 10n ** 18n, KEY = '22'.repeat(32);
// Ethereum: the engine test's deposits are sealed to its pool asset.
const base = config.CHAINS.find((c) => c.chainId === 1);
const keys = lib.poolKeys(Uint8Array.from(Buffer.from(KEY, 'hex'))), other = lib.poolKeys(new Uint8Array(32).fill(5));
const node = mkNode({deployBlock: base.deployBlock}), empty = {8453: mkNode({deployBlock: config.CHAINS[1].deployBlock}), 4663: mkNode({deployBlock: config.CHAINS[2].deployBlock})};
console.log(`a pool with ${N} other deposits and three of this key's`);
let t = performance.now();
for (let i = 0; i < N; i++) depositTo(node, i === 100 || i === 300 || i === N - 1 ? keys : other, (BigInt(i % 7) + 1n) * E / 1000n * BigInt(i === 100 || i === 300 || i === N - 1 ? 10 : 1), base.deployBlock + 1 + Math.floor(i / 4));
node.tip = base.deployBlock + 1 + Math.ceil(N / 4) + 40;
for (const n of Object.values(empty)) n.tip = n.sizes[0][0] + 50;
const want = [100, 300, N - 1].reduce((s, i) => s + (BigInt(i % 7) + 1n) * E / 1000n * 10n, 0n);
console.log(`        built in ${((performance.now() - t) / 1000).toFixed(1)} s; this key's deposits add up to ${Number(want) / 1e18} ETH`);

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const nodeOf = (host) => (base.rpc.some((u) => new URL(u).host === host) ? node : config.CHAINS[1].rpc.some((u) => new URL(u).host === host) ? empty[8453] : config.CHAINS[2].rpc.some((u) => new URL(u).host === host) ? empty[4663] : null);
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
  const req = route.request(), url = new URL(req.url()), n = req.method() === 'POST' ? nodeOf(url.host) : null;
  if (!n) return route.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{"error":"offline"}'});
  const body = JSON.parse(req.postData() || '{}');
  const one = async (b) => { try { return {jsonrpc: '2.0', id: b.id, result: await n.rpc(b.method, b.params || [])}; } catch (e) { return {jsonrpc: '2.0', id: b.id, error: {code: -32000, message: String(e.message || e)}}; } };
  const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
  return route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify(out)});
});
// Count the workers the page makes: with no proof asked for, any is a scan worker.
await ctx.addInitScript(() => { const W = window.Worker; window.__workers = 0; window.Worker = function (...a) { window.__workers++; return new W(...a); }; });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(origin);
await p.click('#chains [data-chain="1"]');
await p.click('#tabs [data-tab="receive"]');
await p.click('#form [data-in="paste"]');
await p.fill('#form .opts input', KEY);
t = performance.now();
await p.click('#form [data-in="key"]');
const shown = Number(want) / 1e18;
const got = await p.waitForFunction((w) => document.querySelector('#bal .v')?.textContent.trim() === w, String(shown), {timeout: 300e3}).then(() => true, () => false);
const secs = (performance.now() - t) / 1000;
ok(got, `the page finds this key's three deposits among ${N + 3}: ${shown} ETH`, `${secs.toFixed(1)} s, shown ${(await p.textContent('#bal .v')).trim()}`);
ok(await p.evaluate(() => window.__workers) > 0, 'and the outputs were tried in workers made from its own code', `${await p.evaluate(() => window.__workers)} workers`);
ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
