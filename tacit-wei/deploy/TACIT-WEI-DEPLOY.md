# tacit.wei: deploying the page

The page is generation 1 of its own lineage (`previous = 0`) at `0x000000000009dde9bb333bbad42ad74bbacc2bd6`. Every
control over it sits with the ops multisig; anon.wei and its lineage are separate and not touched by these tools.

| | |
| --- | --- |
| ops multisig | `0x006CD14F36F65eCbB29b2519cCBe63A0DC8549F2`: 2 of 5 owners, a one-hour delay between queueing and release |
| page contract steward | the ops multisig (`steward()`), the only account that can call `deployNext` |
| name | `tacit.wei` in WNS `0x0000000000696760e15f265e828db644a0c242eb`, owned by the ops multisig; `resolve` gives the page contract |
| TacitPayRegistry | `0x0000000000029534a955A164223417fc5f4fA405`, owned by the ops multisig |
| cost | each 24 KB chunk is about 5.4M gas (under the 16.7M per-transaction cap); a whole page about 115M gas |

The multisig's calls: `execute(address,uint256,bytes,bytes)` queues a call once two owners have signed its op id
(`getTransactionHash(address,uint256,bytes,uint32)` at the multisig's `nonce()`); after the delay, anyone releases it with
`executeQueued(address,uint256,bytes,uint32)`; `queued(bytes32)` gives the release time, and zero once released. The
multisig answers a selector it does not know with success and no effect, so every step below is checked by reading its
effect on chain, never by a transaction's status.

## The next version

Each version serves its own bytes forever. `deployNext(initcode, salt)` on the live version creates its successor by
CREATE2 (so the successor's `PREVIOUS` is unforgeable) from creation code built from `src/TacitPay8244.sol`; then
`tacit.wei` is pointed at it. The page shows a "newer version" link only when a version's `latest()` is what
`tacit.wei` resolves to. The page's code is minified as a whole, so a new build usually changes every chunk: plan on all
21 (about 114M gas) plus about 2.45M for `deployNext`.

1. **Build.** After `npm ci` at the repo root: `bash deploy/repin.sh` writes `dapp/page.min.html`, the manifest's size and
   hash, and the chunks in `out/`, and checks that they reassemble and carry their pins. Then `forge build` (never
   `--force` or `forge clean` after repin: they delete `out/`). Run the page suites against the new
   `dapp/page.min.html`, and the fork suites with `FORK_ETHEREUM_RPC`, `FORK_ETHEREUM_LOGS` and `ARTIFACTS` set (see
   `test/dapp/fork-lib.mjs`).
2. **Simulate.** `node deploy/deploy-next-helper.mjs --sim` estimates `deployNext` from the multisig against mainnet, with
   the chunks that are not yet on chain put in place by a state override, and `setAddr` from the multisig. It prints the
   successor's address and the op id at the multisig's next nonce. A call from any other account reverts `NotSteward`.
3. **Chunks.** `node deploy/deploy-next-helper.mjs` serves a page; from any funded wallet it sends each new chunk through
   CreateX at an address fixed by its code (two per transaction from a wallet that batches calls). Chunks whose bytes
   the lineage already holds are reused. The page reads each address back.
4. **deployNext.** Once every chunk is on chain with its exact bytes, `--plan` (or the served page) gives the call
   (to the live version, value 0, data), its op id, and the `execute` call. Two owners sign the op id;
   `node deploy/deploy-next-helper.mjs --execute deployNext 0x<signatures>` prints the `execute` calldata to send to the
   multisig. After the delay, `--plan` prints the `executeQueued` call (gas limit 3.5M), which any account may send.
   Before signing, each owner rebuilds the page and the contract (steps 1 and 2) and checks that the successor address
   and the call's target and data are the ones printed here, and that the op id their own multisig tool shows for that
   call and nonce equals the printed one: the helper takes the op id from one RPC.
5. **setAddr.** Offered only once the live version's `successor()` is the predicted address and the successor reads back
   with this page's `PAGE_HASH`, the multisig as steward and the live version as `PREVIOUS`. Queue and release it the
   same way (`--execute setAddr 0x<signatures>`, then `executeQueued`).
6. **setGwei.** `tacit.gwei` (GNS `0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6`, served at `https://tacit.gwei.limo/`) is
   pointed the same way: `setAddr(namehash("tacit.gwei"), successor)` on GNS. While the name's owner is an account rather
   than the multisig, that account sends this one transaction (the helper prints it, about 41k gas); once the multisig
   owns the name, it is queued like setAddr. The page names `tacit.gwei.limo` among the hosts to sign in on, so the name
   belongs with the multisig before this version is deployed (until it does, one account can repoint it). Until the
   record is set, tacit.gwei.limo keeps serving the earlier version, whose page does not show a "newer version" link on
   that host.
7. **Read back.** `--plan` reports `done` once `tacit.wei` and `tacit.gwei` resolve to the successor and
   `https://tacit.wei.limo/` and `https://tacit.gwei.limo/` serve bytes with the manifest's SHA-256, and prints the `deployment` record for `manifest.json`. Then
   `node deploy/check-deployment.mjs https://ethereum-rpc.publicnode.com <successor> dapp/page.min.html`, verify the
   successor on Sourcify and Etherscan (solc 0.8.30, 200 runs, prague), and check the "newer version" link on
   `https://0x000000000009dde9bb333bbad42ad74bbacc2bd6.w4eth.io/`.
7. **Record it** in `TACIT-WEI.deployed.md`: the successor, its chunks, the page's sha256 and keccak, and the multisig's
   op ids and transactions.

Rehearse steps 4 and 5 on an anvil fork first (two owners impersonated: `execute`, the delay passed with
`evm_increaseTime`, then `executeQueued`), and confirm `successor()`, `resolve` and `html()` there.

To go back, the multisig points `tacit.wei` at an earlier version: every version still serves its own page. Renouncing
the steward freezes the lineage.

## A new lineage

`deploy/deploy-helper.mjs` deploys a first version from a browser wallet: each chunk, then
`TacitPay8244(steward, 0, chunks, keccak(page))`, whose gas estimate only succeeds if the chunks reassemble to the page.
Its steward is the ops multisig unless `STEWARD` names another account.

## Rehearsal (Sepolia, 2026-11-20)

21 chunks and the wrapper at `0xC15eA27339137fEAE3d40A886ee9Ad357A05B216`. `html()` came back byte for byte, `request()`
answered 200 with the page, `check-deployment.mjs` passed all 24 checks, and serving the page cost about 2.2M gas per
`eth_call`. (Sepolia charges about 38M gas per chunk on its newer fork; mainnet charges about 5.4M.)
