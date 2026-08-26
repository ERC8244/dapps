import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EIP170 = 24576;

/** Every dapp in the repo is a directory with a manifest.json. Nothing else
 *  registers one, so adding a dapp is adding a directory. */
export const list = () =>
  fs
    .readdirSync(ROOT, {withFileTypes: true})
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, e.name, "manifest.json")))
    .map((e) => e.name)
    .sort();

export const load = (name) => {
  if (!name) {
    console.error(`usage: node scripts/<command>.mjs <dapp>\n  dapps: ${list().join(", ")}`);
    process.exit(1);
  }
  const dir = path.join(ROOT, name);
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) {
    console.error(`no manifest for "${name}"; dapps: ${list().join(", ")}`);
    process.exit(1);
  }
  return {...JSON.parse(fs.readFileSync(file, "utf8")), dir};
};

/** The page, checked against what the manifest says it is. The size and hash
 *  are the release gate: editing the page without editing the manifest is the
 *  mistake this catches, because a chunk set built from a page nobody pinned is
 *  how a deploy stops matching its repo. */
export const page = (m) => {
  const bytes = fs.readFileSync(path.join(m.dir, m.page));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== m.bytes || sha256 !== m.sha256) {
    console.error(
      `${m.name}: page is ${bytes.length} B / ${sha256}\n` +
        `           manifest pins ${m.bytes} B / ${m.sha256}\n` +
        `           update manifest.json deliberately if this is the new release`
    );
    process.exit(1);
  }
  return {bytes, sha256};
};

/** PUSH2 <len> DUP1 PUSH1 0x0a PUSH0 CODECOPY PUSH0 RETURN | <runtime>
 *  — the classic data-contract stub: it returns the payload as runtime code. */
const stub = (len) => Buffer.from(`61${len.toString(16).padStart(4, "0")}80600a5f395ff3`, "hex");

/** Split a page into chunk runtimes and their initcode.
 *
 *  Two shapes, because the wrappers differ: a fixed `count` when the
 *  constructor's arity fixes it (the page is spread evenly), or `maxPayload`
 *  when the count follows the size. `prefix` is a byte prepended to each
 *  runtime — "00" is STOP, so the chunk can never be mistaken for a callable
 *  contract; it is not part of the page and is skipped on reassembly.
 */
export const split = (m, bytes) => {
  const prefix = Buffer.from(m.chunks.prefix || "", "hex");
  const per = m.chunks.count
    ? Math.ceil(bytes.length / m.chunks.count)
    : m.chunks.maxPayload;
  const count = m.chunks.count ?? Math.ceil(bytes.length / per);

  const parts = [];
  for (let i = 0; i < count; i++) {
    const payload = bytes.subarray(i * per, Math.min((i + 1) * per, bytes.length));
    if (!payload.length) continue;
    const runtime = Buffer.concat([prefix, payload]);
    if (runtime.length > EIP170) {
      console.error(`${m.name}: chunk ${i + 1} is ${runtime.length} B, over EIP-170 (${EIP170})`);
      process.exit(1);
    }
    parts.push({n: i + 1, payload, runtime, initcode: Buffer.concat([stub(runtime.length), runtime])});
  }

  // A missing or duplicated chunk serves broken HTML forever, and some wrappers
  // reject both in the constructor. Catch it here rather than at a deploy.
  if (parts.length !== count) {
    console.error(`${m.name}: produced ${parts.length} non-empty chunks, not ${count}`);
    process.exit(1);
  }
  if (new Set(parts.map((p) => p.runtime.toString("hex"))).size !== count) {
    console.error(`${m.name}: two chunks are byte-identical`);
    process.exit(1);
  }
  if (!Buffer.concat(parts.map((p) => p.payload)).equals(bytes)) {
    console.error(`${m.name}: chunks do not reassemble to ${m.page}`);
    process.exit(1);
  }
  return parts;
};

export const RPC = process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";

export const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

/** keccak256("html()")[0:4] — the ERC-8244 entry point, and the only thing a
 *  gateway needs from any of these contracts. */
export const HTML_SELECTOR = "0x33c34ac3";

/** Decode an `abi.encode(string)` return into bytes. */
export const decodeString = (hex) => {
  const data = Buffer.from(hex.slice(2), "hex");
  const offset = Number(BigInt("0x" + data.subarray(0, 32).toString("hex")));
  const length = Number(BigInt("0x" + data.subarray(offset, offset + 32).toString("hex")));
  return data.subarray(offset + 32, offset + 32 + length);
};
