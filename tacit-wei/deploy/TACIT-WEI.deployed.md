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


## Version 2 (2026-11-22)

The next version of the page, deployed as the successor of the version above: `deployNext` on `0x000000000009dde9bb333bbad42ad74bbacc2bd6`, a CREATE2 from that contract. The version above still serves its own page, and its `latest()` now walks to this one.

| | |
| --- | --- |
| contract | `0x0000000066cAa35D1719e251D36B550508B51427` (a CREATE2 salt mined for four leading zero bytes) |
| previous | `0x000000000009DdE9bb333bBaD42aD74bBACc2bD6` |
| steward | the ops multisig `0x006CD14F36F65eCbB29b2519cCBe63A0DC8549F2` |
| names | `tacit.wei` (WNS) and `tacit.gwei` (GNS) both resolve to it; `https://tacit.wei.limo/` and `https://tacit.gwei.limo/` serve the page bytes |
| page | 538,182 B, sha256 `2f42e7e467a0bce4966e143d7a7bbd5ca4063160f3e0b3f87bbfeb8dfd505097`, keccak256 `0xa4e626f179d49c66b3284a0ac8cb36231c2d5e4f6725af8525137770cf331289` |
| salt | `0x18ea73d089ea4ef00000000000000000000000000000000040000000936d1bc3` (init code hash `0xd8308941373cf85432cc7cfa5bf7a77fa318908976bf20270250370a4134b7ea`) |
| chunks | 22, through CreateX `deployCreate2` with open salts, from `0xc2531dF297CCc41d39004dEd1E9cB9F8f985374f`; 117.9M gas in all |
| checks | `deploy/check-deployment.mjs` passed on the live contract: all 22 chunk code hashes, the chunks hold 538,182 B, `html()` equal to the page byte for byte, `PAGE_HASH`; `deploy/rehearse-next.mjs` passed 17 of 17 on a fork before the release; verified on Sourcify (full match, creation and runtime) and on Etherscan (solc 0.8.30, 200 runs, prague, the constructor arguments as deployed) on 2026-11-23 |

| step | transaction | when (UTC) |
| --- | --- | --- |
| deployNext, queued (ops nonce 87) | `0xed1d8529c1acd7841892fb6127c5e88c525a5eec89a5b7f45738ebfd6d809c22` | 2026-11-22 20:38 |
| deployNext, released | `0xd45c2b51bb9d863bd873ed5d81f91c2c299830c3b36b94d0fe0e6473600e2165` | 2026-11-22 21:41 |
| setAddr tacit.wei, queued (ops nonce 89) | `0x3f827cff0ee93799e53213a2d442c2a9646c1fe94832bc9f8aa675afc92ffcd3` | 2026-11-22 21:51 |
| setAddr tacit.wei, released | `0x6ffdf0732327955b9022f9378bb48ae3a36599913cc43ca59be8fe33937146ce` | 2026-11-23 02:32 |
| setAddr tacit.gwei, from the owner | `0x0283f40ca5c15711b26c8d14b950e9b55a9341cb8dc62b78292d1a2a748cbef3` | 2026-11-23 02:43 |

### Chunks of version 2

| # | address | transaction |
| --- | --- | --- |
| 1 | `0x488b5d2EA374C9644B326749e1Bc13824459e392` | `0x59b6ac3ce368452dc336cd20fc9ab6bfdc9103dadaa9b934699d701b9af5f1f6` |
| 2 | `0xB7Db80Bef782EfE082491AA8Ac6ce2534f0fa6a4` | `0xcf7e373dfb90de90e3a7046378433e580027713a6b52cda015d03c93fc8c510a` |
| 3 | `0x20EB3fd26e3341539d975Fb0526c92BC8c727Ea2` | `0x76d51e8ae59ec58697b16105224965e0958d9ebbdd5ff4db5b540f3d8caa76d8` |
| 4 | `0x9C92BBa6f5140f0150ee8bc70EfB19D1AF48e678` | `0x6b7652063a995b4cc39bc77b40f6bb2dfa266021e9a2b310c224218ad45d513c` |
| 5 | `0xeeCaD2FA2990C50fe577bde0d89d69c456E6b586` | `0xeb2d34e798a4a3ef456f3d31525e1c3c985673ff9d3b42547a06289e32c93536` |
| 6 | `0x3158aF26Ea0CC5fa32a170B8796F6DcB273e4c86` | `0xb87e42782408768c39edcead6ff8fb2eb4a2a5d5fd357c953b1906e8c2d2b121` |
| 7 | `0xCb0e6a3421c8E548Ec62a1a9e8b440A2f92D0428` | `0x47e49971c2e24e9a84d04f61a1d5e31d6545e19b5cbc566e5c4978a10621a4f6` |
| 8 | `0x6dd50b6d4885efC9f305bd45403C4b5beA944Edb` | `0xb10d4d070c6fa80e7ba7c4a9ed0d96c66035e03f3c9c8b297d93e6ab0754b8b3` |
| 9 | `0x2beAc44B60930cbB644c5b9f566657bc416d17a2` | `0xcc46f3739024f5c4b726d3435f004588046cbf7ea54d1da10c91307a8a1ef2a8` |
| 10 | `0x81a23c0f350f7696B3E2Cd6286e2a31fB20AfB70` | `0x0391f4d1ae05cf387b1454aca3251331b09b8da9ffa490f48c459ad8562ab535` |
| 11 | `0x7e7254167c2dBF2445D385012Db4411d57Fb4d5f` | `0xeb24fc56a0925f1e8f20b49b09e04e8692eba5df6f02584ae5d52d97787a45ad` |
| 12 | `0x6ebb2d85648638777Bd2Bd3d60CF11b0DAB42F1F` | `0x39cf6a90b4b31a2719b835c11e9cb38dd43d9fef54955f8e697db4fa3acffa2d` |
| 13 | `0x33134fFa6DE7b2bCA86f730a6E820085095935F1` | `0x10d0513540b842b5341e86f770ed7b365e8702b642fb5abcfb7f7f19cbca9ee9` |
| 14 | `0x41c985863E35358d87Bb38eAfF386244dB12F3D2` | `0x3cec5e6ba1ea720afc9eb05a3440d5cbdfed755202089f35fb3c99eb4d6a81b9` |
| 15 | `0x6604750751f8768eF9f902B67f767AC8073181cF` | `0xa107e9bb0c72c51cd3f3fe1c2ec77f5d8305ce001196bc07d737706e7acd798d` |
| 16 | `0x31820b5F73A1B76cB084ad881C393EEbD36F18DA` | `0x58b4dcfea5fdb07acb0941f438c9ff22b24f87a29667b470ca60e554b5cc7e38` |
| 17 | `0x7939a5F7c3aB379A2F66BE87a52FAC6f48505312` | `0xbf964487940b0d2e6bf16df640afa36d736f74567a1d77aa90420912d36a6e90` |
| 18 | `0xa85fc360E98cA9b8e5b88370408E26c9BCf433c3` | `0x83b401fdc5ec6da923aed601254ea3c41d6f49ec26bd0d223776427d9d17e30c` |
| 19 | `0x6BFb03E74d35A4F152059ee1FCFB6568c2596FD8` | `0xbfe1eaa73401f4c83e4ae773ba35a05ec50fdb214ae417f6d9d461118b438200` |
| 20 | `0xb82BD4cb71CC992570F9ce0d55E78b17502A0a7c` | `0x51fbb5d018c6846246956b45e49614477ea90802cd447410038ca0ad0665e495` |
| 21 | `0x8aC6C79333076af5e40e9FAfc6e9C384b18f06Af` | `0xfcd64f16ae4366fe7bdab46bf727bc3a8e16d65ed0b9d2ac0f48e5a6b7fe5d08` |
| 22 | `0x0F597C1FD6646249E4DaCA7Fa35Cd75702c5268A` | `0xc2749a734c2119c6af5235cba20365edfb74a813c52bef1530b331b5e5851dfe` |
