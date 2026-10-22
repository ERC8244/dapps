/* Against Ethereum mainnet: the onchain rosters registry.js reads answer, and
   the WalletConnect relay and project id they list are the page's built-in
   defaults (a difference is reported, not failed: the roster may move on).

   Usage: node zswap/test/dapp/zswap.live.mjs     (ETH_RPC_URL to pick a node) */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {endpoints, rpcs} = await import(path.resolve(HERE, "../../modules/registry.js"));
const RPC = process.env.ETH_RPC_URL || "https://ethereum-rpc.publicnode.com";
const page = fs.readFileSync(path.resolve(HERE, "../../dapp/page.html"), "utf8");

let failures = 0;
const ok = (c, msg, extra) => {
  console.log((c ? "  PASS  " : "  FAIL  ") + msg + (extra !== undefined ? "  " + extra : ""));
  if (!c) failures++;
};
const note = (msg) => console.log("  --    " + msg);

const builtInPid = /let WC_PID="([0-9a-f]{32})"/.exec(page)?.[1];
const builtInRelay = /const WC_RELAY=\["(wss:\/\/[^"]+)"\]/.exec(page)?.[1];
ok(!!builtInPid && !!builtInRelay, "page declares a built-in relay and project id", `${builtInRelay} ${builtInPid}`);

const relay = await endpoints(RPC, "wc");
const pid = await endpoints(RPC, "wcpid");
ok(relay.length > 0 && relay.every((u) => u.startsWith("wss://")), "zEndpoints lists a WalletConnect relay", relay.join(", "));
ok(pid.length > 0 && pid.every((p) => /^[0-9a-f]{32}$/.test(p)), "zEndpoints lists a WalletConnect project id", pid.join(", "));
(relay[0] === builtInRelay ? ok : (c, m) => note(m))(true, `roster relay ${relay[0] === builtInRelay ? "is" : "differs from"} the page default`);
(pid[0] === builtInPid ? ok : (c, m) => note(m))(true, `roster project id ${pid[0] === builtInPid ? "is" : "differs from"} the page default`);

const nodes = await rpcs(RPC);
ok(nodes.length > 0 && nodes.every((u) => u.startsWith("https://")), "zRpcList lists https read nodes", `${nodes.length} nodes`);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
