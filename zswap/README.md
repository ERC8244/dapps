# zswap

zSwap is a DEX for Ethereum, Base and Robinhood Chain whose whole interface is
one hand-written HTML file stored on Ethereum. There is no framework, bundler or
backend: `dapp/page.html` is the source, and it is byte-identical to what the
contract's `html()` returns.

| | |
| --- | --- |
| page | 666,463 B, 28 data contracts |
| contract | [`0x0a0Be427…D507`](https://etherscan.io/address/0x0a0Be4271Ca53f0002800a323Dee65A6B31CD507#code) (zSwap v0.3) |
| routes | https://zswap.wei.limo/ · [w4eth.io](https://0x0a0be4271ca53f0002800a323dee65a6b31cd507.w4eth.io/) · [w3link.io](https://0x0a0be4271ca53f0002800a323dee65a6b31cd507.1.w3link.io/) |
| resolver | [`0x000000E7…B7AC`](https://etherscan.io/address/0x000000E7DAD6128683D1fb415e80B30c23dAb7AC#code) · [w4eth.io](https://0x000000e7dad6128683d1fb415e80b30c23dab7ac.w4eth.io/): always the latest lineage release |
| docs | https://docs.zswap.wei.limo/ |
| upstream | [github.com/z-fi/zFi](https://github.com/z-fi/zFi) (`zSwap.html`, `src/zSwap.sol`) |

```sh
node scripts/chunk.mjs  zswap        # 28 chunks, 21,665 B of headroom
node scripts/verify.mjs zswap        # chunks, html() and routes against mainnet
node scripts/serve.mjs  zswap        # http://127.0.0.1:3000 with a real wallet
cd zswap && forge test               # the contract serves this page, and its lineage rules
node zswap/test/dapp/zswap.modules.mjs     # the extracted modules (offline)
node zswap/test/dapp/zswap.live.mjs        # the onchain rosters (mainnet)
node zswap/test/dapp/zswap.demo.live.mjs   # the WalletConnect module against the real relay
```

## Reading the page

Comments and indentation are stripped to save bytes, but nothing is minified or
renamed, so the file reads top to bottom. Line numbers are for this release.

| lines | what |
| --- | --- |
| 10–366 | CSS |
| 367 | theme bootstrap |
| 368–554 | markup |
| 555 | one-line helpers (`U8`, `Er`, `Js`, `Pa`, …) used everywhere below |
| 583–620 | contract addresses, `CHAINS` (per-chain venues, nodes, explorers) |
| 1240–1470 | the read path: built-in nodes, the onchain node list, two-node agreement, `rpc()` |
| 2391–2397 | EIP-6963 wallet discovery |
| 2400–2779 | WalletConnect v2: crypto (`WCU`), relay client (`WCCLI`), QR encoder (`QR8`) |
| 2835–2885 | `wcConnect`, `wcResume`, `wcProv` (a WalletConnect session as an EIP-1193 provider) |
| 2886 | `wkChoices`: the wallet picker |
| 2950–3000 | `wkResolve`, `connect()` |

### Replacing the wallet button

Every wallet the page can use is one entry in `wkChoices` (line 2886):

```js
{name, icon | svg, rdns, get}   // get() returns an EIP-1193 provider, or a promise of one
```

The rest of the page only calls `PROV.request(...)`, so a new connector is one
more entry. The built-in WalletConnect entry (`get: wcConnect`, with `wcProv`
adapting the session) is a complete example of a wallet that is not injected.
A wallet that announces itself over EIP-6963 needs no change at all.

## modules/

zSwap's wallet code, cut out of the page so it can be used elsewhere.

| file | what | source |
| --- | --- | --- |
| `walletconnect.js` | WalletConnect v2: `WCU` (ChaCha20-Poly1305, X25519/HKDF and Ed25519 via WebCrypto, envelopes, relay JWT), `createClient()` (pair, resume, request, end), `QR8` | page lines 2400–2779, verbatim |
| `wallets.js` | EIP-6963 discovery: `wallets()`, `rescan()` | page lines 2394–2397, verbatim |
| `provider.js` | a WalletConnect session as an EIP-1193 provider | hand-written, after `wcProv` |
| `registry.js` | read zEndpoints (`wc` relay, `wcpid` project id, …) and zRpcList | hand-written |
| `demo.html` | connect, show the QR, sign a message, configured from the chain | hand-written |

`build.mjs` writes the two generated files from `dapp/page.html`. It cuts each
block at exact text anchors and refuses to run if the page is not the one the
manifest pins, or if a helper it re-declares is not declared the same way in
the page. `node zswap/modules/build.mjs --check` fails when a committed module
no longer matches the page.

```js
import {createClient, QR8} from "./walletconnect.js";
import {toProvider} from "./provider.js";
import {endpoints} from "./registry.js";

const [relay] = await endpoints(RPC, "wc");          // from the chain
const [projectId] = await endpoints(RPC, "wcpid");
const client = createClient({relay, chains: [1, 8453]});
const {uri, done} = await client.pair(projectId, {name: "my app", description: "", url: location.origin, icons: []});
// draw QR8.build(uri), then:
const provider = toProvider(client, await done, {read: myRpc});
```

The modules need WebCrypto's X25519 and Ed25519, so a recent browser (or Node
20+). Serve them over http(s); browsers do not load ES modules from `file://`.

## Publishing

zSwap versions form a lineage. Each names its predecessor (`PREVIOUS`) and, once,
a successor that only the zFi DAO can create through `deployNext`; `latest()`
walks to the newest. A version's bytes never change, so an upgrade is a new
address, never an edit.

```
v0.1 0x00000095…56c6 → v0.2 0xe6869528…DB8D → zSwapLink 0x00000079…8ba9 ⇢ serves v0.3 0x0a0Be427…D507
```

v0.3 was deployed as a standalone root, then adopted into the lineage by a DAO
vote: v0.2's `deployNext` created a **zSwapLink** (`src/zSwapLink.sol`), a small
successor that keeps the lineage rules and relays `html()` and `request()` to
the v0.3 contract. Adopting a page this way costs one 2 KB proposal instead of
re-sending 28 chunk addresses.

**zSwapResolver** follows the lineage by itself. It walks `successor()` from
v0.1 and serves the newest version that has existed for at least three days, so
a release reaches it without anyone repointing anything, and a hijacked vote
cannot move its readers in one transaction. Since 2026-10-20 its `current()` is
the zSwapLink, and its `html()` is this page. `zswap.wei` points at the resolver
(since 2026-10-23), so the name follows each DAO release on that delay. Every
version also stays reachable at its own address.

See [deploy/ZSWAP-8244.deployed.md](deploy/ZSWAP-8244.deployed.md).
