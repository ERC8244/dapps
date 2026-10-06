# anon.wei onchain page — mainnet deployment

Deployed and verified. The page is the runtime bytecode of twelve data contracts; the wrapper reassembles them in `html()`
and serves them over ERC-8244 and ERC-5219.

| | |
| --- | --- |
| **TacitPay8244** | [`0x0000005a9E52BD30867872DCb323bc78Eb5cF919`](https://etherscan.io/address/0x0000005a9E52BD30867872DCb323bc78Eb5cF919#code) |
| **Browse (ERC-8244)** | https://0x0000005a9e52bd30867872dcb323bc78eb5cf919.w4eth.io/ |
| **Browse (ERC-4804)** | https://0x0000005a9e52bd30867872dcb323bc78eb5cf919.1.w3link.io/ |
| **Name route** | https://anon.wei.limo/ (`anon.wei` resolves through WNS to the wrapper) |
| steward | `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20` |
| previous / successor | `0x0000001e01D6ee371b51b49dc80E9B96b238e7c5` / `0x0`: generation 2, the tip of its lineage |
| page | 276,658 B, sha256 `947bc1a7b9d25f449b602bd0b543726dfcf035d29654fbd59316fafc63d1313c` |
| page commitment | keccak `0xcee8bc443e5cec096c1ff16b1b40959ca3c613e01f065975fe89dc8932c41969` |
| appended | 2026-10-03 09:17:59 UTC, by `deployNext` on generation 1 |
| source | verified on Sourcify (`match`), solc 0.8.30, 200 runs, prague |

## Data chunks

| # | address | bytes |
| --- | --- | --- |
| 1 | `0xB0d9a87d555c8b597107369643F09d91F3c81058` | 24,576 |
| 2 | `0x86671Ec8a873FC9277e99b4a0da244087476e7f2` | 24,576 |
| 3 | `0xE4bF37A5ce872F27946C17ee803c0f7F827c68b3` | 24,576 |
| 4 | `0xe8fb74740De2D47d71D760139B30e30B652B13f4` | 24,576 |
| 5 | `0xc572e7526224F74911Ad4A580E0402ecD6DaE0c2` | 24,576 |
| 6 | `0xC7ab1591cC002729CB63939b2cF426c8936d78Fc` | 24,576 |
| 7 | `0x9a4EEEae095B3BC7F59fdc4e3d8ed0A5f84c4E56` | 24,576 |
| 8 | `0x01f0F5152C48F9478Ca4881320b8dbc6bFBD1357` | 24,576 |
| 9 | `0x276C7d1Eca90825A42E7B85061168F3E8Bd4710A` | 24,576 |
| 10 | `0x0c6bC4b50E2e4245042043fC16790B1f17f1F08F` | 24,576 |
| 11 | `0x9DaB8DD31f7A5f964e98014bBC58c2C74364015d` | 24,576 |
| 12 | `0x4C30b26aeBfDa219B1866908780dA3392554E0B4` | 6,334 |

Each runtime is one STOP byte followed by its slice of the page. The chunk contracts hold no source and cannot be verified as
source; `scripts/verify.mjs` and `deploy/check-deployment.mjs` check something stronger: that every chunk's runtime is the page's
slice, that `html()` returns the page byte for byte, and that `anon.wei` resolves to the wrapper.

## What a reader can check

```
git show 01b12c0:tacit-pay/dapp/page.html > gen2.html      # this version's page: 276,658 B, sha256 947bc1a7…
node tacit-pay/deploy/check-deployment.mjs <rpc> 0x0000005a9E52BD30867872DCb323bc78Eb5cF919 gen2.html
```

`tacit-pay/dapp/page.html` and `scripts/verify.mjs` follow the newest page, so this version is checked against its own bytes
as above.

The wrapper also names the two large files the page fetches (`PROVING_KEY_SHA256`, `WITNESS_PROGRAM_SHA256`); they equal the pins
inside the page, and the page uses a file only when its SHA-256 equals its pin (`node test/dapp/tacit-pay.artifacts.mjs`).
