#!/usr/bin/env node
/**
 * Check that a deployed dapp is the repo, all the way down.
 *
 * Four claims, each checked against the chain or the network rather than
 * against another file in the repo:
 *
 *   1. the page is what the manifest pins
 *   2. each chunk rebuilt from that page is byte-identical to the runtime code
 *      at its deployed address
 *   3. html() on the wrapper returns exactly the page
 *   4. every published route serves exactly the page
 *
 * This is the check that catches a repo drifting away from what is deployed —
 * which is invisible otherwise, because the deployment cannot change and so
 * never complains.
 *
 * Usage: node scripts/verify.mjs <dapp>          (ETH_RPC_URL to pick a node)
 */
import {createHash} from "node:crypto";
import {HTML_SELECTOR, RPC, decodeString, load, page, rpc, split} from "./lib.mjs";

const m = load(process.argv[2]);
const d = m.deployment;
let failed = 0;

const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};

console.log(`${m.name} against ${RPC}`);

// 1. the page is what the manifest pins — page() exits if not
const {bytes, sha256} = page(m);
check(true, "page matches manifest", `${bytes.length} B, sha256 ${sha256.slice(0, 16)}…`);

// A release is written before it is deployed, so the repo is briefly AHEAD of
// the chain. `deployment.pageSha256` records what is actually live; while it
// differs from the page, this is a prepared release and everything below is
// checked against the deployment's own page rather than against the new one.
const live = d.pageSha256 && d.pageSha256 !== sha256;
if (live) {
  console.log(
    `  --   repo is AHEAD of the deployment: this page is not deployed\n` +
      `       deployed sha256 ${d.pageSha256.slice(0, 16)}…, repo ${sha256.slice(0, 16)}…\n` +
      `       deploy it with deployNext, then set deployment.pageSha256 to the repo hash`
  );
}

// What the deployment is expected to serve: the page, unless the repo has
// moved ahead of it, in which case the hash the deployment was pinned at.
const expect = live ? d.pageSha256 : sha256;

// 2. rebuilt chunks vs deployed runtime code. Only meaningful when the repo
//    page IS the deployed one — a pending release rebuilds to different chunks
//    by definition, and the deployed page's bytes are no longer in the repo.
const parts = split(m, bytes);
if (live) {
  console.log(`  --   chunk runtimes not checked (repo page is not the deployed one)`);
} else if (d.chunkContracts?.length) {
  if (d.chunkContracts.length !== parts.length) {
    check(false, "chunk count", `manifest lists ${d.chunkContracts.length}, page needs ${parts.length}`);
  } else {
    for (const [i, address] of d.chunkContracts.entries()) {
      const code = Buffer.from((await rpc("eth_getCode", [address, "latest"])).slice(2), "hex");
      check(code.equals(parts[i].runtime), `chunk ${i + 1} runtime`, address);
    }
  }
} else {
  console.log(`  --   chunk runtimes not checked (no chunkContracts in manifest)`);
}

// 3. html() on the wrapper
const served = decodeString(await rpc("eth_call", [{to: d.contract, data: HTML_SELECTOR}, "latest"]));
check(
  createHash("sha256").update(served).digest("hex") === expect,
  live ? "html() returns the deployed page" : "html() returns the page",
  d.contract
);

// 4. every published route.
//
// Only a route that promises the contract's own bytes is held to them. A
// resolver route serves whatever release is currently active, and a gateway
// that rewrites the document cannot match by construction — both are reported
// rather than failed, because neither is the repo drifting.
for (const route of d.routes ?? []) {
  const exact = route.serves === "exact";
  try {
    const response = await fetch(route.url);
    const body = Buffer.from(await response.arrayBuffer());
    const hash = createHash("sha256").update(body).digest("hex");
    const same = hash === expect;
    if (exact) {
      check(same, `${route.kind} serves the page`, `${route.url} (${body.length} B)`);
    } else {
      console.log(
        `  --   ${route.kind} ${same ? "serves the page" : `serves ${body.length} B, not this release`}` +
          `  ${route.url}\n       ${route.serves}: ${route.note ?? ""}`
      );
    }
  } catch (e) {
    check(!exact, `${route.kind} reachable`, `${route.url} — ${e.message}`);
  }
}

console.log(failed ? `\n${m.name}: ${failed} FAILED` : `\n${m.name}: verified`);
process.exit(failed ? 1 : 0);
