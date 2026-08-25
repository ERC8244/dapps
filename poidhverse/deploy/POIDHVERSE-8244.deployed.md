# POIDH Universe onchain page — Ethereum deployment

POIDH Universe v0.2.2 is deployed as an immutable 13-chunk ERC-8244 application version. It is published as
generation 4 through the existing root and is staged behind the resolver's mandatory three-day review delay.

| | |
| --- | --- |
| **Immutable v0.2.2** | [`0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4`](https://etherscan.io/address/0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4#code) |
| **Browse immutable v0.2.2 (ERC-8244)** | https://0x27f3c5fe79c092d663710d555bb358cdc2dde3a4.w4eth.io/ |
| **Stable resolver** | [`0x4f6bdaaC679961aA0C8C6503CF204EA9F9A7A0aC`](https://etherscan.io/address/0x4f6bdaaC679961aA0C8C6503CF204EA9F9A7A0aC#code) |
| **Release root** | [`0x5DCbD2FCE275A49D233a46A8c337429b48B5A965`](https://etherscan.io/address/0x5DCbD2FCE275A49D233a46A8c337429b48B5A965#code) |
| **WNS route** | https://poidhverse.wei.limo/ |
| publisher | `0xE423b19262EA8FBC68aB9509f90080aB6aA1930B` (acgk.eth) |
| release / generation | `0.2.2` / `4` |
| activation eligibility | 2026-08-27 06:59:23 UTC |
| page | 296,949 bytes |
| Keccak-256 | `0x9c9ac545ee71c01d9de3c0c822097856dfd915e48b9ed4f55b79dd69fa539235` |
| SHA-256 | `1e051d5152594af2b542114874789127b11f8bb9ed8a728f818c950a99dcb819` |

## Deployment state

At publication, the resolver continued serving immutable v0.1.0 while generation 4 completed its review delay.
Activation is permissionless after the eligibility timestamp. The immutable v0.2.2 address above already serves
the final bytes directly and is unaffected by resolver activation.

## What was verified

- all 13 data contracts reconstruct the canonical `dapp/page.html` byte for byte
- the reconstructed document matches both committed hashes above
- `UniverseVersionV2.html()` returns the exact 296,949-byte release
- `snapshot()` is empty because v0.2 reads POIDH contracts directly at runtime
- the release was published as generation 4 and staged through the three-day resolver delay
- the application reads Ethereum, Base, Arbitrum, and Degen Chain without a POIDH API or indexer

The full reproducible deployment and onchain verification record is in
[AlexanderCGKarlsson/poidhverse](https://github.com/AlexanderCGKarlsson/poidhverse).
