#!/usr/bin/env node
/**
 * Serve dapp/page.html on localhost, so the page can be driven with a real
 * wallet against mainnet before it is ever deployed. The same file the chunker
 * splits and the tests read — nothing is rewritten on the way out.
 *
 * `no-store`, unlike the deployed contract's permanent cache hint: on chain the
 * bytes cannot change, here they change every time you save.
 *
 * Usage: node scripts/serve-poidh.mjs [port]
 */
import {createHash} from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "dapp", "page.html");
const host = "127.0.0.1";
const port = Number(process.argv[2] || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("usage: node scripts/serve-poidh.mjs [port]");
  process.exit(1);
}

const html = fs.readFileSync(PAGE);
const sha256 = createHash("sha256").update(html).digest("hex");

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {Allow: "GET, HEAD"});
    response.end();
    return;
  }

  // Every path answers with the page: the dapp is a single-page app that reads
  // which bounty to show from the URL fragment, exactly as request() does on
  // chain.
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": html.length,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(request.method === "HEAD" ? undefined : html);
});

server.listen(port, host, () => {
  console.log(`serving dapp/page.html (${html.length} B, sha256 ${sha256}) at http://${host}:${port}`);
});
