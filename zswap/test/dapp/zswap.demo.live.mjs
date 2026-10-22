/* The extracted WalletConnect client pairs with the real relay.

   Serves zswap/modules/ on localhost, opens demo.html in Chromium and presses
   "Connect with WalletConnect". The demo reads the relay and project id from
   the onchain zEndpoints roster, authenticates to the relay with the module's
   own JWT, subscribes and publishes the proposal; the QR code only appears
   once all of that has succeeded. No wallet is needed for this part.

   Usage: node zswap/test/dapp/zswap.demo.live.mjs   (CHROME=/path/to/chrome to use a local build) */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../modules");
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"};

let failures = 0;
const ok = (c, msg, extra) => {
  console.log((c ? "  PASS  " : "  FAIL  ") + msg + (extra !== undefined ? "  " + extra : ""));
  if (!c) failures++;
};

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, path.normalize(new URL(req.url, "http://x").pathname).replace(/^[/\\]+/, "") || "demo.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !TYPES[path.extname(file)]) return res.writeHead(404).end();
  res.writeHead(200, {"content-type": TYPES[path.extname(file)], "cache-control": "no-store"}).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/demo.html`;

const browser = await chromium.launch(process.env.CHROME ? {executablePath: process.env.CHROME} : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.click("#wc");
  const shown = await page.waitForSelector("#qr svg path", {timeout: 45000}).then(() => true, () => false);
  const log = await page.textContent("#log");
  ok(/relay wss:\/\/\S+, project [0-9a-f]{32} \(from zEndpoints\)/.test(log), "demo configures WalletConnect from the onchain roster");
  ok(shown, "the real relay accepted the module's JWT, subscription and proposal (QR shown)");
  ok(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
