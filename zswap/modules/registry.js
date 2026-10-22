// Hand-written, not generated: read the onchain rosters zSwap configures
// itself from, with one eth_call each and no dependencies.
//
//   const [relay] = await endpoints(rpcUrl, "wc");      // WalletConnect relay
//   const [projectId] = await endpoints(rpcUrl, "wcpid"); // WalletConnect project id
//   const nodes = await rpcs(rpcUrl);                     // Ethereum read nodes
//
// Both contracts are on Ethereum mainnet. zSwap reads them through two of its
// own built-in nodes and only uses an answer the two agree on; do the same if
// a single node is not trustworthy for you.

export const ZENDPOINTS = "0x00000051F365d898132f4ebF345Cd3968e02F288";
export const ZRPCLIST = "0x8C7348D039f58C4e9cfA936EF410eec759213b12";

const LIST_OF = "0xe8edb32f"; // listOf(bytes32 service, uint256 chainId) returns (string[])
const RPCS = "0xd77e4c79"; // rpcs() returns (string[])

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const bytes32 = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0");

/** ABI-decode a single `string[]` return value. */
export function decodeStrings(hex) {
  const b = Uint8Array.from((hex.startsWith("0x") ? hex.slice(2) : hex).match(/../g) || [], (h) => parseInt(h, 16));
  const at = (o) => Number(BigInt("0x" + Array.from(b.subarray(o, o + 32), (x) => x.toString(16).padStart(2, "0")).join("")));
  const base = at(0), n = at(base), out = [];
  for (let i = 0; i < n; i++) {
    const p = base + 32 + at(base + 32 + i * 32), len = at(p);
    out.push(new TextDecoder().decode(b.subarray(p + 32, p + 32 + len)));
  }
  return out;
}

async function call(rpcUrl, to, data) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_call", params: [{to, data}, "latest"]}),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** zEndpoints: the URLs listed for `service` on `chainId` (0 = any chain). */
export const endpoints = async (rpcUrl, service, chainId = 0) =>
  decodeStrings(await call(rpcUrl, ZENDPOINTS, LIST_OF + bytes32(service) + word(chainId)));

/** zRpcList: the curated Ethereum read nodes. */
export const rpcs = async (rpcUrl) => decodeStrings(await call(rpcUrl, ZRPCLIST, RPCS));
