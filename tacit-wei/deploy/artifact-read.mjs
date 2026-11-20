#!/usr/bin/env node
/* Reads a file back from its onchain backup (deploy/artifact-backup.mjs): the manifest's code names the file's SHA-256,
   size and pieces; each piece's code, less its leading STOP byte, is the next part of the file. The SHA-256 is checked.

   Usage: [RPC=<url>[,<url>…]] node deploy/artifact-read.mjs <manifest address> [out file]                                    */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const [manifest, out] = process.argv.slice(2);
// Free public nodes limit reads in different ways: some count every item of a batch against a per-second budget, some
// cap a batch at a few items, some answer a burst with a rate-limit error. So nodes are tried in turn, each at its own pace:
// a batch of 16 at most, no more than about 20 items a second, a smaller batch where a node names its cap, and a pause and
// retry where it says to slow down. Use your own node (RPC=<url>) to read at full speed.
const NODES = (process.env.RPC || 'https://base-sepolia-rpc.publicnode.com,https://sepolia.base.org,https://base-sepolia.drpc.org').split(',').map((u) => u.trim()).filter(Boolean);
const state = NODES.map((url) => ({ url, batch: 16, perSec: process.env.RPC ? 1000 : 20, last: 0, bad: 0 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slow = /rate|limit|too many|capacity|429|-32005|-32007|-32029/i;
async function codeFrom(n, addrs) {
  const wait = n.last + (addrs.length / n.perSec) * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  n.last = Date.now();
  const res = await fetch(n.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(addrs.map((a, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getCode', params: [a, 'latest'] }))) });
  const r = await res.json();
  const items = Array.isArray(r) ? r : [r];
  const err = items.find((x) => x.error);
  if (err) throw Object.assign(new Error(err.error.message || JSON.stringify(err.error)), { code: err.error.code, status: res.status });
  if (!Array.isArray(r) || r.length !== addrs.length) throw new Error('short batch');
  return r.sort((a, b) => a.id - b.id).map((x) => Buffer.from(x.result.slice(2), 'hex'));
}
// The code of each address, in order.
async function code(addrs) {
  const out = [];
  for (let i = 0; i < addrs.length;) {
    let done = false;
    for (const n of state) {
      if (n.bad >= 6) continue;
      const take = addrs.slice(i, i + n.batch);
      try { out.push(...await codeFrom(n, take)); i += take.length; n.bad = 0; done = true; break; }
      catch (e) {
        const cap = /more than (\d+)/i.exec(e.message || '');
        if (cap && Number(cap[1]) > 0 && Number(cap[1]) < n.batch) { n.batch = Number(cap[1]); break; }   // retry this node with its own batch size
        if (slow.test(`${e.message} ${e.code} ${e.status}`)) { n.perSec = Math.max(2, n.perSec / 2); n.bad++; await sleep(1500); break; }
        n.bad++;
      }
    }
    if (!done && state.every((n) => n.bad >= 6)) throw new Error('no node would serve the reads: set RPC=<your own Base Sepolia node>');
  }
  return out;
}
const [m] = await code([manifest]), TAG = Buffer.from('tacit-artifact-v1');
if (m[0] !== 0 || !m.subarray(1, 1 + TAG.length).equals(TAG)) throw new Error('not a tacit-artifact-v1 manifest');
let at = 1 + TAG.length;
const sha = m.subarray(at, at + 32).toString('hex'); at += 32;
const bytes = Number(m.readBigUInt64BE(at)); at += 8;
const n = m.readUInt16BE(at); at += 2;
const pieces = Array.from({length: n}, (_, i) => '0x' + m.subarray(at + 20 * i, at + 20 * i + 20).toString('hex'));
const parts = [];
parts.push(...await code(pieces));
if (parts.some((p) => p[0] !== 0)) throw new Error('a piece is missing or not a data contract');
const file = Buffer.concat(parts.map((p) => p.subarray(1)));
const got = createHash('sha256').update(file).digest('hex');
console.log(`${manifest}: ${n} pieces, ${file.length} of ${bytes} B, sha256 ${got} ${got === sha && file.length === bytes ? 'matches' : 'DOES NOT MATCH ' + sha}`);
if (out && got === sha) fs.writeFileSync(out, file);
process.exit(got === sha && file.length === bytes ? 0 : 1);
