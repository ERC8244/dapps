#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "dapp", "page.html");
const host = "127.0.0.1";
const port = Number(process.argv[2] || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("usage: node scripts/serve-poidhverse.mjs [port]");
  process.exit(1);
}

const html = fs.readFileSync(PAGE);
const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {Allow: "GET, HEAD"});
    response.end();
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": html.length,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(request.method === "HEAD" ? undefined : html);
});

server.listen(port, host, () => {
  console.log(`serving the canonical POIDH Universe release at http://${host}:${port}`);
});
