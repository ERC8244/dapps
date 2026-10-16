/* Catch-up points as the page shows them, in a browser against a chain in memory with a registry. A pool holds 3,400
   deposits to other keys and two to this one (one before the registry's newest point, one after it). With a point posted
   early, the page starts from it: the note after it shows first, the older one joins when the history behind the point has
   been read, and the balance area then says the newest point is far behind and offers to post a fresh one. With a point
   posted at the end there is nothing to offer, and Activity says the newest is as recent as this device's.

   Usage: [N=3400] node test/dapp/tacit-pay.points-ui.mjs                  (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createRequire} from 'node:module';
import {mkNode, depositTo, lib} from './engine-mock.mjs';
import {config, html as HTML} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const N = Number(process.env.N || 3400), E = 10n ** 18n, KEY = '22'.repeat(32), OLD = 50, EARLY = 200;
const base = config.CHAINS.find((c) => c.chainId === 1);
const keys = lib.poolKeys(Uint8Array.from(Buffer.from(KEY, 'hex'))), other = lib.poolKeys(new Uint8Array(32).fill(5));
const node = mkNode({deployBlock: base.deployBlock}), empty = {8453: mkNode({deployBlock: config.CHAINS[1].deployBlock}), 4663: mkNode({deployBlock: config.CHAINS[2].deployBlock})};
const blockOf = (i) => base.deployBlock + 1 + Math.floor(i / 4), mine = (i) => i === OLD || i === N - 1;
const amountOf = (i) => (mine(i) ? (i === OLD ? 3n : 5n) * E / 10n : E / 100n);
let early, snapEarly, snapEnd;
for (let i = 0; i < N; i++) {
  depositTo(node, mine(i) ? keys : other, amountOf(i), blockOf(i));
  // A point is the tree at the end of a block: here the last deposit of block `blockOf(EARLY - 1)`, four to a block.
  if (i === EARLY - 1) { node.tip = blockOf(i) + 20; early = node.postPoint({block: blockOf(i)}); snapEarly = {latest: node.points.latest, at: new Map(node.points.at)}; }
}
node.tip = blockOf(N) + 40;
node.postPoint({block: node.tip - 20}); snapEnd = {latest: node.points.latest, at: new Map(node.points.at)};
for (const n of Object.values(empty)) n.tip = n.sizes[0][0] + 50;
const newer = amountOf(N - 1), both = amountOf(OLD) + amountOf(N - 1), eth = (v) => String(Number(v) / 1e18);
console.log(`a pool with ${N} deposits, a point after ${EARLY} of them (${early} leaves) and one at the end`);

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

async function open(points, slowOlder) {
  node.points = points;
  node.logDelay = slowOlder ? (from) => (from < blockOf(EARLY - 1) ? 8000 : 0) : null;
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
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(origin);
  await p.click('#chains [data-chain="1"]');
  await p.click('#tabs [data-tab="receive"]');
  await p.click('#form [data-in="paste"]');
  await p.fill('#form .opts input', KEY);
  await p.click('#form [data-in="key"]');
  return {p, ctx, errors};
}
const shown = (p) => p.evaluate(() => document.querySelector('#bal .v')?.textContent.trim());
const waitBal = (p, v, ms = 240e3) => p.waitForFunction((w) => document.querySelector('#bal .v')?.textContent.trim() === w, v, {timeout: ms}).then(() => true, () => false);

console.log('a registry whose newest point is far behind');
{
  const {p, ctx, errors} = await open(snapEarly, true);
  const first = await waitBal(p, eth(newer));
  ok(first, 'the note after the point shows first, before the older history is read', `shown ${await shown(p)}`);
  ok(!/Post a fresh one/.test(await p.textContent('#bal-note')), 'and nothing is offered while the older history is still being read');
  ok(await p.waitForFunction(() => /older history \d+%/.test(document.querySelector('#bal')?.textContent || '') || /older history/.test(document.querySelector('#activity-at')?.textContent || ''), null, {timeout: 20e3}).then(() => true, () => false), 'the older history says how far it is');
  ok(await waitBal(p, eth(both)), 'the older note joins the balance as soon as that history is in', `shown ${await shown(p)}`);
  const nudged = await p.waitForFunction(() => /Post a fresh one/.test(document.querySelector('#bal-note')?.textContent || ''), null, {timeout: 60e3}).then(() => true, () => false);
  const text = (await p.textContent('#bal-note')).replace(/\s+/g, ' ');
  ok(nudged && /transactions behind what this one has read/.test(text) && (await p.locator('#bal-point').count()) === 1, 'the balance area then says the newest point is behind and offers a fresh one', text.slice(0, 200));
  const gap = Number(/about ([\d,]+) transactions behind/.exec(text)?.[1].replace(/,/g, ''));
  ok(gap === (N * 2 - early) / 2, 'by exactly the leaves this device has read past it', `${gap} vs ${(N * 2 - early) / 2}`);
  await p.click('#activity-at, .app summary', {timeout: 1000}).catch(() => {});
  await p.evaluate(() => document.querySelector('#points-more')?.setAttribute('open', ''));
  ok(/transactions behind what this device has read/.test((await p.textContent('#points-more')).replace(/\s+/g, ' ')), 'Activity says the same, with a button to post one', (await p.textContent('#points-more')).replace(/\s+/g, ' ').slice(0, 220));
  ok(!errors.length, 'no page errors', errors.join(' | '));
  await ctx.close();
}
console.log('\na registry whose newest point is as recent as the device');
{
  const {p, ctx, errors} = await open(snapEnd, false);
  ok(await waitBal(p, eth(both)), 'a device that starts from a point at the pool’s end still ends with every note', `shown ${await shown(p)}`);
  await sleep(6000);
  ok(!/Post a fresh one/.test(await p.textContent('#bal-note')), 'and is offered nothing');
  await p.evaluate(() => document.querySelector('#points-more')?.setAttribute('open', ''));
  const line = (await p.textContent('#points-more')).replace(/\s+/g, ' ');
  ok(/as recent as this device’s/.test(line), 'Activity says the newest is as recent as this device’s', line.slice(0, 220));
  ok(await p.locator('#post-point').isDisabled(), 'and the button to post is off');
  ok(!errors.length, 'no page errors', errors.join(' | '));
  await ctx.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
