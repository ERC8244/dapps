#!/usr/bin/env node

import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "dapp", "page.html");
const OUTPUT = path.join(ROOT, "out");
const MAX_PAYLOAD = 24_575;
const EXPECTED_BYTES = 296_949;
const EXPECTED_SHA256 = "1e051d5152594af2b542114874789127b11f8bb9ed8a728f818c950a99dcb819";

const html = fs.readFileSync(SOURCE);
const sha256 = createHash("sha256").update(html).digest("hex");

if (html.length !== EXPECTED_BYTES || sha256 !== EXPECTED_SHA256) {
  console.error(
    `release mismatch: expected ${EXPECTED_BYTES} bytes / ${EXPECTED_SHA256}, got ${html.length} / ${sha256}`,
  );
  process.exit(1);
}

const initcodeStub = (runtimeSize) =>
  Buffer.from(`61${runtimeSize.toString(16).padStart(4, "0")}80600a5f395ff3`, "hex");

fs.mkdirSync(OUTPUT, {recursive: true});

const rebuilt = [];
const chunks = Math.ceil(html.length / MAX_PAYLOAD);
for (let index = 0; index < chunks; index += 1) {
  const payload = html.subarray(index * MAX_PAYLOAD, (index + 1) * MAX_PAYLOAD);
  const runtime = Buffer.concat([Buffer.from([0]), payload]);
  const initcode = Buffer.concat([initcodeStub(runtime.length), runtime]);
  const output = path.join(OUTPUT, `Poidhverse8244.chunk${index + 1}.creation.txt`);

  fs.writeFileSync(output, `0x${initcode.toString("hex")}`);
  rebuilt.push(payload);
  console.log(`chunk ${index + 1}: ${payload.length} payload bytes -> ${path.relative(ROOT, output)}`);
}

if (!Buffer.concat(rebuilt).equals(html)) {
  console.error("chunk round trip did not reproduce dapp/page.html");
  process.exit(1);
}

console.log(`${html.length} bytes -> ${chunks} chunks; SHA-256 ${sha256}; round trip verified`);
