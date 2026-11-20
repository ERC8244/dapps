# tacit.wei: deploying the page

The page is generation 1 of its own lineage (`previous = 0`), with ross.wei as steward. anon.wei and its lineage are
not touched: the helpers name `tacit.wei` only.

| | |
| --- | --- |
| steward and name owner | `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20` (ross.wei; owns `tacit.wei` in WNS) |
| WNS | `0x0000000000696760e15f265e828db644a0c242eb`, `setAddr(namehash("tacit.wei"), wrapper)` |
| cost | each 24 KB chunk is about 5.4M gas (under the 16.7M per-transaction cap); the whole page about 115M gas |

## Steps

1. **Build the final bytes.** `bash deploy/repin.sh` writes `dapp/page.min.html`, `manifest.json` and the chunks in
   `out/`, and checks that they reassemble. Note the sha256 it prints. Then `forge build` (never `--force` or
   `forge clean` after repin: they delete `out/`).
2. **Deploy.** `node deploy/deploy-helper.mjs` and open the page it serves in a browser with the steward's wallet. It
   deploys each chunk (checked against its build as it lands), then `TacitPay8244(steward, 0, chunks, keccak(page))`,
   whose gas estimate only succeeds if the chunks reassemble to the page. A closed tab resumes where it stopped.
3. **Check it.** `node deploy/check-deployment.mjs https://ethereum-rpc.publicnode.com <wrapper> dapp/page.min.html`:
   every chunk's code hash, `html()` equal to the page byte for byte, and `PAGE_HASH`. Then verify the wrapper on Sourcify
   and Etherscan.
4. **Open it** at `https://<wrapper>.w4eth.io/`: no page errors, sign in, the balance reads.
5. **Point the name.** The helper's last step sends WNS `setAddr` from the name's owner (simulated first, then read
   back). Check `https://tacit.wei.limo/` serves the same bytes.
6. **Smoke test on the live URL**, with small amounts: a shield, a private send, a withdrawal.
7. **Record it** in a `TACIT-WEI.deployed.md` (wrapper, chunks, page sha256, keccak, transactions), as the anon.wei
   deployment record does.

## Later versions

`deploy/deploy-next-helper.mjs` appends a successor from the steward through `deployNext` (a CREATE2 contract that
records this one as `PREVIOUS`), then points `tacit.wei` at it. Each version serves its own bytes forever; the page shows a
"newer version" link only when the version's `latest()` is what `tacit.wei` resolves to. Renouncing the steward freezes
the lineage.

## Rehearsal (Sepolia, 2026-11-20)

21 chunks and the wrapper at `0xC15eA27339137fEAE3d40A886ee9Ad357A05B216`. `html()` came back byte for byte, `request()`
answered 200 with the page, `check-deployment.mjs` passed all 24 checks, and serving the page cost about 2.2M gas per
`eth_call`. (Sepolia charges about 38M gas per chunk on its newer fork; mainnet charges about 5.4M.)
