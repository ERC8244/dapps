/* The proving key and the witness program are the two large files the page does not carry. They are fetched from mirrors, or
   loaded from disk, and used only when their SHA-256 equals the pin inside the page. This runs the real dapp/page.html in
   Chromium and serves it files that are wrong in each way a mirror could get them wrong: one byte changed, one byte more,
   cut short, and a mirror the reader added that serves bad bytes ahead of the good ones. In every case no prover worker may
   start, nothing may be saved in the browser, and the card must say so; with the right bytes the prover starts.

   Usage: node test/dapp/tacit-pay.artifacts.mjs     (ARTIFACTS=<dir with transact.wasm and transact_final.zkey>,
                                                      PLAYWRIGHT=<path to playwright-core> if not installed here) */
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(process.env.PAGE || new URL('../../dapp/page.html', import.meta.url));
const DIR = process.env.ARTIFACTS || '/Users/z/tacit/dapp/evm-pool';
const real = {'transact.wasm': fs.readFileSync(DIR + '/transact.wasm'), 'transact_final.zkey': fs.readFileSync(DIR + '/transact_final.zkey')};
const PIN = {'transact.wasm': '02dd5e84970e5bc629a7a3cd4d7eae5fc9ca05579fa22c9b39b5ea70c8d8a6c1', 'transact_final.zkey': '40758061a0786fb0bdc5e5dec4c354bbf85fc106f7412716e25e781af4e79c4b'};
for (const [n, b] of Object.entries(real)) if (createHash('sha256').update(b).digest('hex') !== PIN[n]) throw new Error(`${DIR}/${n} is not the pinned file`);

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

const flip = (b, at) => { const c = Buffer.from(b); c[at] ^= 1; return c; };
const BAD = {
  'one byte changed (zkey, in the middle)': {'transact_final.zkey': flip(real['transact_final.zkey'], real['transact_final.zkey'].length >> 1)},
  'one byte changed (zkey, the last)': {'transact_final.zkey': flip(real['transact_final.zkey'], real['transact_final.zkey'].length - 1)},
  'one byte changed (witness program)': {'transact.wasm': flip(real['transact.wasm'], real['transact.wasm'].length >> 1)},
  'one byte more (zkey)': {'transact_final.zkey': Buffer.concat([real['transact_final.zkey'], Buffer.from([0])])},
  'cut short (zkey)': {'transact_final.zkey': real['transact_final.zkey'].subarray(0, real['transact_final.zkey'].length - 1)},
  'empty (witness program)': {'transact.wasm': Buffer.alloc(0)},
};

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

/* A page whose every mirror is served by `serve(host, name)` → bytes | null (null: not found). Nodes and relays are offline. */
async function open(serve, {ends} = {}) {
  const ctx = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
  const asked = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = new URL(route.request().url()), name = /\/(transact\.wasm|transact_final\.zkey)$/.exec(url.pathname)?.[1];
    const cors = {'access-control-allow-origin': '*'};
    if (name) {
      asked.push(`${url.host}/${name}`);
      const body = serve(url.host, name);
      return body ? route.fulfill({status: 200, headers: {...cors, 'content-type': 'application/octet-stream'}, body}) : route.fulfill({status: 404, headers: cors, body: ''});
    }
    return route.fulfill({status: 503, contentType: 'application/json', headers: cors, body: '{"error":"offline"}'});
  });
  await ctx.addInitScript(() => {
    window.__workers = 0;
    const W = window.Worker;
    window.Worker = function (...a) { window.__workers++; return new W(...a); };
  });
  if (ends) await ctx.addInitScript((e) => localStorage.setItem('tacit-pay-endpoints-v1', JSON.stringify(e)), ends);
  const p = await ctx.newPage();
  p.errors = [];
  p.asked = asked;
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(origin);
  await p.waitForSelector('#device-load', {state: 'attached', timeout: 30e3});
  return p;
}
const press = (p) => p.evaluate(() => document.querySelector('#device-load').click());
const outcome = (p, ms = 150e3) => p.waitForFunction(() => /ready/.test(document.querySelector('#device')?.textContent || '') || !!document.querySelector('#device .note.err'), null, {timeout: ms}).then(() => p.evaluate(() => ({ready: /Proving key\s*ready/.test(document.querySelector('#device').textContent), err: document.querySelector('#device .note.err')?.textContent || ''})));
const workers = (p) => p.evaluate(() => window.__workers);
const saved = (p) => p.evaluate(async () => { try { return (await (await caches.open('tacit-pay-artifacts-v1')).keys()).length; } catch { return -1; } });

console.log('a mirror that serves the wrong bytes');
for (const [what, bad] of Object.entries(BAD)) {
  const p = await open((host, name) => bad[name] || real[name]);
  await press(p);
  const r = await outcome(p);
  ok(!r.ready && /could not be downloaded/.test(r.err), `${what}: refused, and the card says so`, r.err.slice(0, 90));
  ok(await workers(p) === 0, `${what}: no prover worker was started`);
  ok(await saved(p) <= 1, `${what}: the bad file was not kept in the browser`, `${await saved(p)} saved (the good one may be)`);
  ok(!p.errors.length, `${what}: no page errors`, p.errors.join(' '));
  await p.context().close();
}

console.log('\na mirror the reader added, serving bad bytes ahead of the good ones');
{
  const bad = BAD['one byte changed (zkey, in the middle)'];
  const p = await open((host, name) => (host === 'evil.test' ? bad[name] || real[name] : /tacit\.finance$/.test(host) ? real[name] : null), {ends: {rpc: {}, relay: {}, mirror: 'https://evil.test/'}});
  await press(p);
  const r = await outcome(p);
  ok(r.ready, 'the bad bytes are refused and the next mirror\'s are used', r.err.slice(0, 90));
  ok(p.asked[0]?.startsWith('evil.test') && p.asked.some((a) => a.startsWith('tacit.finance')), 'the reader\'s mirror was asked first, then the default', p.asked.join(' '));
  ok(await workers(p) > 0, 'the prover started on the good bytes');
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  await p.context().close();
}

console.log('\nfiles loaded from disk');
{
  const p = await open(() => null);
  const pick = async (files) => { const fc = p.waitForEvent('filechooser'); await p.evaluate(() => document.querySelector('#device-file').click()); await (await fc).setFiles(files); };
  const toasts = () => p.$$eval('#toasts .toast', (xs) => xs.map((x) => x.textContent));
  const tmp = fs.mkdtempSync('/tmp/tacit-pay-art-');
  const put = (n, b) => { const f = `${tmp}/${n}`; fs.writeFileSync(f, b); return f; };
  await pick([put('transact.wasm', real['transact.wasm']), put('transact_final.zkey', BAD['one byte changed (zkey, in the middle)']['transact_final.zkey'])]);
  await p.waitForFunction(() => /Choose transact/.test(document.querySelector('#toasts')?.textContent || ''), null, {timeout: 60e3});
  ok(/Choose transact\.wasm and transact_final\.zkey/.test((await toasts()).join(' ')), 'a changed zkey is not taken', (await toasts()).join(' | ').slice(0, 100));
  ok(await workers(p) === 0, 'and no prover worker was started');
  ok(await saved(p) <= 0, 'and nothing was kept', `${await saved(p)} saved`);
  // the right files, named differently: taken by their bytes, not their names
  await pick([put('a.bin', real['transact_final.zkey']), put('b.bin', real['transact.wasm'])]);
  const r = await outcome(p);
  ok(r.ready && await workers(p) > 0, 'the right files are taken by what they are, and the prover starts', r.err.slice(0, 90));
  ok(!p.errors.length, 'no page errors', p.errors.join(' '));
  fs.rmSync(tmp, {recursive: true, force: true});
  await p.context().close();
}

console.log('\nthe right bytes from a mirror');
{
  const p = await open((host, name) => (/tacit\.finance$/.test(host) ? real[name] : null));
  await press(p);
  const r = await outcome(p);
  ok(r.ready && await workers(p) > 0, 'the prover starts', r.err.slice(0, 90));
  ok(await saved(p) === 2, 'and both files are kept in the browser, to be checked again at each use', `${await saved(p)} saved`);
  await p.reload();
  await p.waitForSelector('#device-load', {state: 'attached'});
  // a copy in the browser's storage is hashed again before use: swap one for a bad one and the prover refuses it
  await p.evaluate(async (n) => { const c = await caches.open('tacit-pay-artifacts-v1'); for (const k of await c.keys()) if (k.url.includes('transact_final.zkey')) await c.put(k, new Response(new Uint8Array(n))); }, 1000);
  await press(p);
  const r2 = await outcome(p);
  ok(r2.ready && p.asked.length === 3, 'a stored copy that was changed is fetched again, not used', `${p.asked.length} downloads in all`);
  await p.context().close();
}

await browser.close(); server.close();
console.log(`\n${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
