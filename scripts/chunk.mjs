#!/usr/bin/env node
/**
 * Split a dapp's page into data-contract chunks and write deployable initcode.
 *
 * The page is stored as the runtime bytecode of data contracts, so one contract
 * would cap a dapp at EIP-170's 24,576 bytes. Chunking moves the ceiling; the
 * limit applies per chunk, not to the page. The wrapper takes the chunk
 * addresses and reassembles them in html(), so its own creation code stays
 * small.
 *
 * Usage: node scripts/chunk.mjs <dapp>
 */
import fs from "node:fs";
import path from "node:path";
import {EIP170, load, page, split} from "./lib.mjs";

const m = load(process.argv[2]);
const {bytes, sha256} = page(m);
const parts = split(m, bytes);

const out = path.join(m.dir, "out");
fs.mkdirSync(out, {recursive: true});

console.log(`${m.name}/${m.page}: ${bytes.length} B, sha256 ${sha256} -> ${parts.length} chunk(s)`);
for (const p of parts) {
  const file = path.join(out, `${m.chunks.artifact}.chunk${p.n}.creation.txt`);
  fs.writeFileSync(file, `0x${p.initcode.toString("hex")}`);
  console.log(
    `  chunk${p.n}: ${p.runtime.length} B runtime` +
      ` (${EIP170 - p.runtime.length} B under EIP-170)` +
      ` -> ${path.relative(m.dir, file)}`
  );
}
console.log(`reassembly verified; headroom at this chunk count: ${EIP170 * parts.length - bytes.length} B`);
