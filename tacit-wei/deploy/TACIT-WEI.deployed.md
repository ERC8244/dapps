# tacit.wei: deployment record

| | |
| --- | --- |
| wrapper | `0x000000000009dde9bb333bbad42ad74bbacc2bd6` (CreateX CREATE3, banked deployer salt) |
| steward | the ops multisig `0x006CD14F36F65eCbB29b2519cCBe63A0DC8549F2` (2 of 5 owners, one-hour delay), since 2026-11-21: ops nonce 84, `acceptStewardship` |
| name | `tacit.wei`, owned by the ops multisig since 2026-11-21; WNS `setAddr` to the wrapper (2026-11-20); `https://tacit.wei.limo/` serves the page bytes |
| registry | TacitPayRegistry `0x0000000000029534a955A164223417fc5f4fA405`, owned by the ops multisig since 2026-11-21: ops nonce 83, `acceptOwnership` |
| page | 503,436 B, sha256 `c58a4815f9a328856026eaa6b33c61fba16b220c525c6341dc344458d288057b`, keccak256 `0xcc3ebcd1896fda9d4171f01a72b83edba3fc74dd6f9e214c4b691853c662671a` |
| wrapper transaction | `0xda2f9aea6fac3474927cd243e12693fde1699d01c0fe4e56fa150cf74e171728` |
| deployer | `0x68575B073DE49a94e3E3ACf6F3A0d6E3b66267C7` (chunks by CREATE, wrapper through CreateX `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`) |
| salt | `0x68575b073de49a94e3e3acf6f3a0d6e3b66267c700511f70a266f5d788362d3b` |
| checks | `deploy/check-deployment.mjs`: every chunk's code hash, `html()` equal to the page byte for byte, `PAGE_HASH`; wrapper verified on Etherscan and Sourcify (solc 0.8.30, 200 runs, prague) |

## Chunks

| # | address |
| --- | --- |
| 1 | `0xa288a2d0B7Cb579D41d24A0E434fd7F3ba79c00a` |
| 2 | `0x6E15480C4d6206481224351A553F5e12d7377cb2` |
| 3 | `0x6F4b14eb4B57c603bE93c5Fcb9b7333F07ce6955` |
| 4 | `0xd5c642E4B416501D57ada9255e1e2a26c1200B81` |
| 5 | `0xC90175611ef030865b18667886d39492A9d2C01E` |
| 6 | `0x780f4668c086adFe16D233E5960c8C7AB37b80E2` |
| 7 | `0xF1620eD90B6eAe7506fe32d6422476caA0C01f6c` |
| 8 | `0x41A4544301E83C5db4285b89f77566D1d6949d1a` |
| 9 | `0x47Dc3c50306E3cEE33B66d409E753c0E80c97d61` |
| 10 | `0x2C4Bb4D8580361244247d86f24Af51d424AAd484` |
| 11 | `0x9f7fAbb65A72769cbb4447eaD890AC9B42Ec2BCB` |
| 12 | `0x0F218872DCe5B6697eb0762734C28CC3746C142C` |
| 13 | `0xD86E203977E8BA395f93a6e820373bb7B2756b96` |
| 14 | `0xB2Bb549a69dc9AE1D6882Ab055029931522D90db` |
| 15 | `0xe9b5190cB344be77d52F666923C9e88CE774e41E` |
| 16 | `0x02100eb4C25ec10fFd30aBdd73a5481C9c93BAb3` |
| 17 | `0x5d403B1a24465BFeF6625BCd7642c4667d4B2c73` |
| 18 | `0xCbE015C906901E65401eE4b112bF4c20BaA38a32` |
| 19 | `0x9401cB1daB3Bd095cB749e6753Df17790AC76e5F` |
| 20 | `0x1EaC1c7B19bD46F8d0e5889418EB75cE81dc76FC` |
| 21 | `0x620b99153C83a777a06c1F1Fd05075961C9a3b10` |
