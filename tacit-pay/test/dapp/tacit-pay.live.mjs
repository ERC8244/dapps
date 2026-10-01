/* Runs the real dapp/page.html in Chromium against mainnet, read-only: no transaction is sent. Over the public nodes
   and relays the page ships with, it opens the specification's vector key and checks what only the live chains
   can answer: each chain's pool is read from its first block, each relay's quote passes the page's checks (chain,
   pool, relay address, fee ceiling), each chain's router confirms the deposit address the page computes, and the
   ceremony's proving key is fetched from a mirror, matches its pinned hash and loads into the page's prover.

   Usage: node test/dapp/tacit-pay.live.mjs                                                                     */
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');
const HTML = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url));
let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};
const KEY = '11'.repeat(32), BOX0 = '0x52fc37ee7741468a15CE879320a7a41CEBaeb232';

const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(HTML); }).listen(0);
const browser = await chromium.launch();
const p = await (await browser.newContext()).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.click('#tabs [data-tab="receive"]');
await p.click('#form [data-in="paste"]'); await p.fill('#form .opts input', KEY); await p.click('#form [data-in="key"]');
await p.waitForSelector('#form .addr code');
await p.waitForFunction(() => [...document.querySelectorAll('#chains small')].every((s) => /ETH/.test(s.textContent) && !s.querySelector('.sk, .stale')), null, {timeout: 300e3}).catch(() => {});
ok((await p.$$eval('#chains small', (x) => x.map((e) => e.textContent))).join() === '0 ETH,0 ETH,0 ETH', 'each chain’s pool reads, and the vector key holds nothing', (await p.$$eval('#chains button', (x) => x.map((e) => e.textContent))).join(' | '));
for (const [id, name] of [[1, 'Ethereum'], [8453, 'Base'], [4663, 'Robinhood']]) {
  await p.click(`#chains [data-chain="${id}"]`);
  await p.click('#tabs [data-tab="send"]');
  await p.waitForFunction(() => /Sent by the relay, no gas needed · fee/.test(document.querySelector('#form .route')?.textContent || ''), null, {timeout: 120e3}).catch(() => {});
  ok(/fee [\d.]+ ETH/.test(await p.textContent('#form .route')), `${name}: the relay’s quote passes the page’s checks`, (await p.textContent('#form .route')).trim().slice(0, 60));
  await p.click('#tabs [data-tab="shield"]');
  await p.click('[data-from="exchange"]');
  await p.waitForSelector('#form .addr code', {timeout: 120e3}).catch(() => {});
  ok((await p.textContent('#form .addr code').catch(() => '')) === BOX0, `${name}: the router confirms the deposit address`);
  await p.click('[data-from="wallet"]');
}
await p.click('#device-load');
await p.waitForFunction(() => /ready/.test(document.querySelector('#device').textContent) || document.querySelector('#device .err'), null, {timeout: 600e3});
ok(/ready/.test(await p.textContent('#device')), 'the proving key comes from a mirror, matches its hash and loads into the prover', (await p.textContent('#device .err').catch(() => '')) || '');
ok(!errors.length, 'no page errors', errors.join(' | '));
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
