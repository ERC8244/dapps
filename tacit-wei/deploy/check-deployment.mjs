// Anyone can run this: node third-party-check.mjs <rpcUrl> <wrapperAddress> <path/to/page.html>
// needs only ethers (keccak). Checks the page is exactly what the contract commits to and serves, chunk by chunk.
import { readFileSync } from 'node:fs'; import { keccak256, getAddress } from 'ethers';
const [rpcUrl, wrapper, pagePath] = process.argv.slice(2); const page = readFileSync(pagePath);
const rpc = async (method, params) => { const j = await (await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
const call = (data) => rpc('eth_call', [{ to: wrapper, data }, 'latest']);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const n = Number(BigInt(await call('0xf91f0937')));
// How the page is cut is the deployer's choice (equal parts, or parts of a fixed size): the chain says where each chunk ends. What must hold
// is that each chunk is STOP || the next slice of the page, under EIP-170, and that together the chunks are exactly the page.
ok(n > 0, `chunkCount ${n}`);
let at = 0;
for (let i = 0; i < n; i++) {
  const a = getAddress('0x' + (await call('0x1bbb6678' + i.toString(16).padStart(64, '0'))).slice(-40));
  const code = Buffer.from((await rpc('eth_getCode', [a, 'latest'])).slice(2), 'hex'), len = code.length - 1;
  ok(code[0] === 0 && len > 0 && code.length <= 24576 && code.subarray(1).equals(page.subarray(at, at + len)), `chunk ${i + 1} ${a} codehash ${keccak256(code).slice(0, 14)}… = STOP || page[${at}..${at + len})`);
  at += Math.max(len, 0);
}
ok(at === page.length, `the ${n} chunks hold ${at} bytes == the page's ${page.length}`);
const r = await call('0x33c34ac3'); const off = Number(BigInt('0x' + r.slice(2, 66))), len = Number(BigInt('0x' + r.slice(2 + off * 2, 66 + off * 2)));
ok(Buffer.from(r.slice(66 + off * 2, 66 + off * 2 + len * 2), 'hex').equals(page), 'html() == page byte for byte');
ok((await call('0x5b700b59')) === keccak256(page), 'PAGE_HASH == keccak256(page)');
console.log('steward', '0x' + (await call('0x637eea19')).slice(-40), '| successor', '0x' + (await call('0x6ff968c3')).slice(-40), '| latest', '0x' + (await call('0x52bfe789')).slice(-40));
console.log('wrapper runtime codehash', keccak256(await rpc('eth_getCode', [wrapper, 'latest'])));
process.exit(bad ? 1 : 0);
