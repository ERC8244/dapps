#!/usr/bin/env node
/**
 * Serve a dapp's page on localhost, so it can be driven with a real wallet
 * against mainnet before it is ever deployed. The same file the chunker splits
 * and the tests read — nothing is rewritten on the way out.
 *
 * `no-store`, unlike the deployed contract's permanent cache hint: on chain the
 * bytes cannot change, here they change every time you save.
 *
 * Usage: node scripts/serve.mjs <dapp> [port]
 */
import http from "node:http";
import {load, page} from "./lib.mjs";

const m = load(process.argv[2]);
const {bytes, sha256} = page(m);
const host = "127.0.0.1";
const port = Number(process.argv[3] || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("usage: node scripts/serve.mjs <dapp> [port]");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {Allow: "GET, HEAD"});
    response.end();
    return;
  }
  // Every path answers with the page: these are single-page apps that read
  // their route from the URL fragment, exactly as request() does on chain.
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": bytes.length,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
});

server.listen(port, host, () => {
  console.log(`${m.name}: ${bytes.length} B, sha256 ${sha256}`);
  console.log(`serving at http://${host}:${port}`);
});
