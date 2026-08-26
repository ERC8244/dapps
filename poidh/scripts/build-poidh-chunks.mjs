#!/usr/bin/env node
/**
 * Split dapp/page.html into data-contract chunks and emit deployable initcode,
 * the same way scripts/build-poidhverse-chunks.mjs does for POIDH Universe.
 *
 * WHY CHUNKS
 * The page is stored as the runtime bytecode of data contracts, so a single
 * contract would cap the dapp at EIP-170's 24,576 bytes. Five contracts move
 * the ceiling to 122,880 — the limit applies per chunk, not to the page.
 * Poidh8244 takes the five addresses as constructor args and reassembles them
 * in html(), so its own creation bytecode stays small.
 *
 * DEPLOY ORDER
 *   1. deploy chunk 1..5                       -> addresses A..E
 *   2. deploy Poidh8244(steward, 0, [A..E])    (args appended to creation code)
 *
 * Each chunk's initcode is the classic data-contract stub:
 *   PUSH2 <len> DUP1 PUSH1 0x0a PUSH0 CODECOPY PUSH0 RETURN | <payload>
 * which returns the payload as the contract's runtime bytecode.
 *
 * Usage: node scripts/build-poidh-chunks.mjs
 */
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EIP170 = 24576;
const n = 5;
if (process.argv[2] && process.argv[2] !== String(n)) {
  console.error(`Poidh8244 takes exactly ${n} data chunks; update the wrapper before changing this.`);
  process.exit(1);
}

const SRC = path.join(ROOT, "dapp", "page.html");
const html = fs.readFileSync(SRC);
const sha256 = createHash("sha256").update(html).digest("hex");
const per = Math.ceil(html.length / n);
if (per > EIP170) {
  console.error(`chunk size ${per} exceeds EIP-170 (${EIP170}); use more chunks`);
  process.exit(1);
}

const stub = (len) => "61" + len.toString(16).padStart(4, "0") + "80600a5f395ff3";

fs.mkdirSync(path.join(ROOT, "out"), {recursive: true});

const parts = [];
for (let i = 0; i < n; i++) {
  const slice = html.subarray(i * per, Math.min((i + 1) * per, html.length));
  if (!slice.length) continue;
  const initcode = "0x" + stub(slice.length) + slice.toString("hex");
  const file = path.join(ROOT, "out", `Poidh8244.chunk${i + 1}.creation.txt`);
  fs.writeFileSync(file, initcode);
  parts.push({i: i + 1, bytes: slice.length, file, initcode});
}

// Every chunk must be non-empty and distinct, or the constructor reverts.
if (parts.length !== n) {
  console.error(`FATAL: page produced ${parts.length} non-empty chunks, not ${n}`);
  process.exit(1);
}
if (new Set(parts.map((p) => p.initcode)).size !== n) {
  console.error("FATAL: two chunks are byte-identical; the constructor rejects duplicates");
  process.exit(1);
}

// Round-trip guard: the concatenated chunks must reproduce the page exactly.
const rebuilt = Buffer.concat(
  parts.map((p) => Buffer.from(p.initcode.slice(2 + stub(p.bytes).length), "hex"))
);
if (!rebuilt.equals(html)) {
  console.error("FATAL: chunks do not reassemble to page.html");
  process.exit(1);
}

console.log(`dapp/page.html: ${html.length} B, sha256 ${sha256} -> ${parts.length} chunk(s)`);
for (const p of parts) {
  console.log(
    `  chunk${p.i}: ${p.bytes} B runtime (${EIP170 - p.bytes} B under EIP-170)  -> ${path.relative(ROOT, p.file)}`
  );
}
console.log(`reassembly verified: ${rebuilt.length} B == page.html`);
console.log(`\nheadroom at this chunk count: ${EIP170 * parts.length - html.length} B`);
