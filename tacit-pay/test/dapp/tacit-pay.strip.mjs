/* The deployed page is dapp/page.html with its comments and spacing taken out (scripts/strip.mjs, run by
   deploy/repin.sh). This checks in Chromium that what the browser builds from the two is the same: with scripts off,
   the same style rules as the browser reads them, the same elements with the same computed styles and boxes, the same
   text and the same pixels, in light and dark, at a phone's width and a desktop's. The scripts are checked as the page
   is written (each parses to the same syntax tree as the source), and the other browser tests run the deployed page.

   Usage: node test/dapp/tacit-pay.strip.mjs        (PLAYWRIGHT=<path to playwright-core> if not installed here) */
import http from 'node:http';
import {createRequire} from 'node:module';
import {text, html} from './page-config.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT || 'playwright-core');

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

const pages = {'/source': Buffer.from(text), '/deployed': html};
const server = http.createServer((q, r) => { r.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); r.end(pages[q.url] ?? ''); }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

const read = async (name, {width, height, colorScheme}) => {
  const ctx = await browser.newContext({javaScriptEnabled: false, viewport: {width, height}, colorScheme, deviceScaleFactor: 1});
  const p = await ctx.newPage();
  await p.goto(base + name);
  const seen = await p.evaluate(() => ({
    rules: [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)),
    els: [...document.querySelectorAll('*')].map((e) => {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      return [e.tagName, ...Array.from(cs, (k) => `${k}:${cs.getPropertyValue(k)}`), r.x, r.y, r.width, r.height].join('|');
    }),
    text: document.body.innerText,
  }));
  seen.shot = await p.screenshot({fullPage: true});
  await ctx.close();
  return seen;
};

console.log(`dapp/page.html ${pages['/source'].length} B, the deployed page ${html.length} B`);
for (const view of [{width: 1280, height: 900, colorScheme: 'light'}, {width: 1280, height: 900, colorScheme: 'dark'}, {width: 375, height: 812, colorScheme: 'light'}, {width: 375, height: 812, colorScheme: 'dark'}]) {
  const a = await read('/source', view), b = await read('/deployed', view), at = `${view.width}px ${view.colorScheme}`;
  const rule = a.rules.findIndex((r, i) => r !== b.rules[i]), el = a.els.findIndex((e, i) => e !== b.els[i]);
  ok(a.rules.length > 50 && a.rules.length === b.rules.length && rule < 0, `${at}: the same ${a.rules.length} style rules`, rule < 0 ? undefined : `\n    ${a.rules[rule]}\n    ${b.rules[rule]}`);
  ok(a.els.length === b.els.length && el < 0, `${at}: the same ${a.els.length} elements, computed styles and boxes`, el < 0 ? undefined : `${a.els[el]?.slice(0, 80)} …`);
  ok(a.text === b.text, `${at}: the same text`);
  ok(a.shot.equals(b.shot), `${at}: the same pixels`, a.shot.equals(b.shot) ? undefined : `${a.shot.length} B vs ${b.shot.length} B`);
}

await browser.close();
server.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
