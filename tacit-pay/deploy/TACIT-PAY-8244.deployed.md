# anon.wei onchain page: mainnet deployment

Deployed and verified. The page is the runtime bytecode of seventeen data contracts; the wrapper reassembles them in `html()`
and serves them over ERC-8244 and ERC-5219.

| | |
| --- | --- |
| **TacitPay8244** | [`0x0000000d42137547140b0812E1178F025e08bc49`](https://etherscan.io/address/0x0000000d42137547140b0812E1178F025e08bc49#code) |
| **Browse (ERC-8244)** | https://0x0000000d42137547140b0812e1178f025e08bc49.w4eth.io/ |
| **Browse (ERC-4804)** | https://0x0000000d42137547140b0812e1178f025e08bc49.1.w3link.io/ |
| **Name route** | https://anon.wei.limo/ (`anon.wei` resolves through WNS to the wrapper) |
| steward | `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20` |
| previous / successor | `0x000000BC9db0D5091853bFBf6D062C1410Bc3745` / `0x0`: generation 6, the tip of its lineage |
| page | 415,902 B, sha256 `3b94ab980316470756345dd754cd212dde57067e0ef95dce1531fcaecfde9c08` |
| page commitment | keccak `0xc38edd73acfcad5a4d5049669f6d7853c32b4687904d6b3d56ce9ccac0feea12` |
| appended | 2026-10-27, by `deployNext` on generation 5, in one transaction with the new chunk and the name pointed (tx `0x12a96138e057c571386d9340996900124ec8b4886a78d85dcd8b0ad5653cef7c`), at a CREATE2 salt mined for three leading zero bytes |
| source | verified on Sourcify (`match`, creation and runtime) and Etherscan, solc 0.8.30, 200 runs, prague |

## Data chunks

Chunk 2 was sent in the release (the repaired USDG mark and the Base and Robinhood network marks); the other sixteen are generation 5's, reused at their live addresses. Each is a CreateX CREATE2 deployment under a chain-bound salt anyone may use, so its address is fixed by its code.

| # | address | bytes |
| --- | --- | --- |
| 1 | `0xF80d79CA8586b2181d59FECd8D62f79f9990c68f` | 24,576 |
| 2 | `0x526BA833CbF55dcf063dc6A4cb6493F425904A95` | 24,576 |
| 3 | `0x77cA6552C1b3aD4F55f11F9eEA8F0f6E7c0C6820` | 24,576 |
| 4 | `0xe071cd1C1a9d047b171A0a8503B2BeE155DEeF51` | 24,576 |
| 5 | `0xC147958E8F6Bf651450fc0Dcf726FCBa9eFaC949` | 24,576 |
| 6 | `0xC9A059D757142C813B519F180bB67A0a44eE23Fb` | 24,576 |
| 7 | `0x83744c2C272Da97F35462872C8928C9f5dEa80a3` | 24,576 |
| 8 | `0xfA1A4f5a7D19E8D323f3256De8d388f876ee523d` | 24,576 |
| 9 | `0xaEe334bB16a59A3552C2CC30237BF67dade9E870` | 24,576 |
| 10 | `0x038565EEb5a828Db434344521220F388f531F2C9` | 24,576 |
| 11 | `0x6d4403b41299cde6B96930935F59Dc6933ac6550` | 24,576 |
| 12 | `0xF9C0BD7B9D05AeBF67501B2d451BFe506bef8CE5` | 24,576 |
| 13 | `0x289120d364f1030221305A6f2e2Da36d3acE4Ebd` | 24,576 |
| 14 | `0x57E919DaA7cDA16f617045bb4FAA584B9c2a4AFe` | 24,576 |
| 15 | `0x9F8e961f0CBBbDeE4734dBcfFD0242e7a38E04EB` | 24,576 |
| 16 | `0x4366ACBe083C2fA7a7FD5e04ECedd629a952b5C2` | 24,576 |
| 17 | `0x4b153Ce96dBcECa62123bdD8A196a71E4fB16cac` | 22,703 |

## Check it

`node deploy/check-deployment.mjs <rpc url> 0x0000000d42137547140b0812E1178F025e08bc49 dapp/page.min.html` checks each chunk's bytes, that `html()` returns the page
byte for byte, and that `PAGE_HASH` is its keccak.

## The catch-up registry

`TacitEvmPoolCheckpoints` is at `0x00000000C3267616ED5E0DAA6F6490D109d6844D` on Ethereum, Base and Robinhood Chain (CreateX
CREATE2 under an open salt, so the address is fixed by the registry's code). This page starts a new device from its newest point.
