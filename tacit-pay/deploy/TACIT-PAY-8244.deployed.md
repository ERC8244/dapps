# anon.wei onchain page: mainnet deployment

Deployed and verified. The page is the runtime bytecode of sixteen data contracts; the wrapper reassembles them in `html()`
and serves them over ERC-8244 and ERC-5219.

| | |
| --- | --- |
| **TacitPay8244** | [`0x937BFF44d6EeeF798AbB0088b6441843eA276DFF`](https://etherscan.io/address/0x937BFF44d6EeeF798AbB0088b6441843eA276DFF#code) |
| **Browse (ERC-8244)** | https://0x937bff44d6eeef798abb0088b6441843ea276dff.w4eth.io/ |
| **Browse (ERC-4804)** | https://0x937bff44d6eeef798abb0088b6441843ea276dff.1.w3link.io/ |
| **Name route** | https://anon.wei.limo/ (`anon.wei` resolves through WNS to the wrapper) |
| steward | `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20` |
| previous / successor | `0x0000002145004Fd9637c0FA5AED0A9Ea05E89A9D` / `0x0`: generation 3, the tip of its lineage |
| page | 382,215 B, sha256 `ceeaad92839b970556d371373519e4f62a89fded79222f3c8ef9880bcde3c7d4` |
| page commitment | keccak `0x5f980792929c7fe1c12fbcd1c2d89430c4ab06193a94b73ab58f6ff318684b29` |
| appended | 2026-10-17, by `deployNext` on generation 3 |
| source | verified on Sourcify (`match`) and Etherscan, solc 0.8.30, 200 runs, prague |

## Data chunks

Each chunk is a CreateX CREATE2 deployment under a chain-bound salt anyone may use, so its address is fixed by its code (the
`anon-wei-4` job on tacit.finance/tasks paid for them).

| # | address | bytes |
| --- | --- | --- |
| 1 | `0xfe72Bfe4eF3E41C86D075Aa1A8707c2422384D6a` | 24,576 |
| 2 | `0x8788ec1062445eb98Edea61DfA8d0B8F5bfB6Da3` | 24,576 |
| 3 | `0xA67f59f4B3177422Ae054B255e5ccaC98477515E` | 24,576 |
| 4 | `0xDfAc1698E5912372dA487De765BB737fEf19331F` | 24,576 |
| 5 | `0xEB644A43662Dacc110E1EBD5415BEA68B6399829` | 24,576 |
| 6 | `0x9c8802Ae436E98242881Ac9e15B398fF5F4b517A` | 24,576 |
| 7 | `0x56ea184D2599235544f6a169D48BB2E94949a08F` | 24,576 |
| 8 | `0xcc3B31C61BAcaA18422bB16Fb10033E4e85C42cd` | 24,576 |
| 9 | `0xD03F73c44B84482298fd6911fBC7913135a40CD6` | 24,576 |
| 10 | `0xFD5dF6F4875551706115f18E0B2cF963DBFC6c2F` | 24,576 |
| 11 | `0x06a8b5D22f5D3830D676Cc12B330d6A40C0ebedf` | 24,576 |
| 12 | `0x4E760f0Fb66B1DB6391Cd5ec2Bcde16FCB25b41d` | 24,576 |
| 13 | `0x3572808339C93E77f871B87b720b90b802D03524` | 24,576 |
| 14 | `0x284d855b659253f61Cf1425f22830Ad9fD62b554` | 24,576 |
| 15 | `0xE5C8D5bd9C914D83639976A0D6ccb96d7442a599` | 24,576 |
| 16 | `0x182EB4a67b24542504CaBb7AC34243B8598213Dd` | 13,591 |

## Check it

`node deploy/check-deployment.mjs <rpc url> 0x937BFF44d6EeeF798AbB0088b6441843eA276DFF dapp/page.min.html` checks each chunk's bytes, that `html()` returns the page
byte for byte, and that `PAGE_HASH` is its keccak.

## The catch-up registry

`TacitEvmPoolCheckpoints` is at `0x00000000C3267616ED5E0DAA6F6490D109d6844D` on Ethereum, Base, Robinhood Chain and MegaETH (CreateX
CREATE2 under an open salt, so the address is fixed by the registry's code). This page starts a new device from its newest point.
