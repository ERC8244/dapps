#!/usr/bin/env node
/* Reads a file back from its onchain backup (deploy/artifact-backup.mjs): the manifest's code names the file's SHA-256,
   size and pieces; each piece's code, less its leading STOP byte, is the next part of the file. The SHA-256 is checked.

   Usage: RPC=<url> node deploy/artifact-read.mjs <manifest address> [out file]                                    */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const [manifest, out] = process.argv.slice(2), RPC = process.env.RPC || 'https://base-sepolia-rpc.publicnode.com';
const code = async (addrs) => {
  const r = await (await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(addrs.map((a, i) => ({jsonrpc: '2.0', id: i, method: 'eth_getCode', params: [a, 'latest']})))})).json();
  return r.sort((a, b) => a.id - b.id).map((x) => Buffer.from(String(x.result).slice(2), 'hex'));
};
const [m] = await code([manifest]), TAG = Buffer.from('tacit-artifact-v1');
if (m[0] !== 0 || !m.subarray(1, 1 + TAG.length).equals(TAG)) throw new Error('not a tacit-artifact-v1 manifest');
let at = 1 + TAG.length;
const sha = m.subarray(at, at + 32).toString('hex'); at += 32;
const bytes = Number(m.readBigUInt64BE(at)); at += 8;
const n = m.readUInt16BE(at); at += 2;
const pieces = Array.from({length: n}, (_, i) => '0x' + m.subarray(at + 20 * i, at + 20 * i + 20).toString('hex'));
const parts = [];
for (let i = 0; i < n; i += 20) parts.push(...await code(pieces.slice(i, i + 20)));
if (parts.some((p) => p[0] !== 0)) throw new Error('a piece is missing or not a data contract');
const file = Buffer.concat(parts.map((p) => p.subarray(1)));
const got = createHash('sha256').update(file).digest('hex');
console.log(`${manifest}: ${n} pieces, ${file.length} of ${bytes} B, sha256 ${got} ${got === sha && file.length === bytes ? 'matches' : 'DOES NOT MATCH ' + sha}`);
if (out && got === sha) fs.writeFileSync(out, file);
process.exit(got === sha && file.length === bytes ? 0 : 1);
