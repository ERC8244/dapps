# POIDH onchain page, second build — mainnet deployment

Deployed and verified. The page is the runtime bytecode of six data contracts;
the wrapper reassembles them in `html()` and serves them over ERC-8244 and
ERC-5219.

This build is **not** in the first build's lineage. `deployNext` creates a
successor itself, by CREATE2 from the predecessor, so a contract deployed any
other way can never become one — see "Lineage" below.

| | |
| --- | --- |
| **Poidh8244** | [`0x37b9f184FaC49F4c4343d60526ACDA5579Fa3689`](https://etherscan.io/address/0x37b9f184FaC49F4c4343d60526ACDA5579Fa3689#code) |
| **Browse (ERC-8244)** | https://0x37b9f184fac49f4c4343d60526acda5579fa3689.w4eth.io/ |
| **Browse (ERC-4804)** | https://0x37b9f184fac49f4c4343d60526acda5579fa3689.1.w3link.io/ |
| steward | `0x7C7F6cb2dab9De9b242eEec29d2F61bD7d9750E0` |
| previous / successor | `0x0` / `0x0` — its own lineage, generation 1 |
| page | 124,304 B, sha256 `e2eacdc8a1f4cb6c1f3483d1039e8214ae358bda0f2adf7fc6c7362f9c3f0075` |
| compiler | solc `v0.8.36+commit.8a079791`, optimizer on, 200 runs, no metadata hash |

## Data chunks

Deployed by plain `CREATE` from `0x68575B073DE49a94e3E3ACf6F3A0d6E3b66267C7`,
nonces 763–768. That deployer's key was shared in the clear and must be treated
as public; it holds no role here, since the chunks are data and the steward is
set by constructor argument.

| # | address | bytes |
| --- | --- | --- |
| 1 | `0x2f9601B413a9BbF620c52c620Bf354Be33e7b907` | 20,718 |
| 2 | `0x3522C50FD4a00E54aBeF4eF043b169a304a7A968` | 20,718 |
| 3 | `0x600526395b5db1129c67236003639942b9989EcC` | 20,718 |
| 4 | `0xcC7200Fe1500245e534158d53f0f12c571704441` | 20,718 |
| 5 | `0xdad6FF01E411b3348a02F627585420A905A45120` | 20,718 |
| 6 | `0xB9Acd1E89FaEAD820ba721044be45a03f4026979` | 20,714 |

Wrapper: [`0x39b204e7…`](https://etherscan.io/tx/0x39b204e7c23c5c3f14fff9ba947cf66151630a773e2e085b709ddf361a72c7ff),
1,301,728 gas. Whole deployment cost about **0.0013 ETH** at ~0.05 gwei.

## What was checked

- every chunk's initcode was simulated with `eth_call` and the six simulated
  runtimes concatenated to the pinned sha256 **before anything was broadcast**
- after the chunks landed, their deployed runtime was concatenated and checked
  against the manifest again — the wrapper would not have been deployed if it
  had not matched
- `html()` returns 124,304 bytes identical to `dapp/page.html`
- `generation()` is 1, `latest()` is itself, `resolveMode()` is `"5219"`
- the w4eth.io gateway serves the identical document
- Etherscan source verification passes, after reproducing the deployed runtime
  locally with immutables masked

## Sixteen slots

The constructor takes `address[16]`, filled from the front; the first zero ends
the list and everything after it must be zero, so a hole cannot silently drop a
chunk out of the middle of the page. Six are used here, so the page may grow to
393,216 B before the count — and therefore the address — has to change.

## Lineage

`previous` is `0x0`, so this contract is the head of its own chain and the first
build's `latest()` does not walk to it. Two separate things follow:

- **Readers on `poidh.wei`** move as soon as the name is repointed at this
  address. That is the owner's transaction and needs no steward.
- **Readers on the first build's frozen address** are told nothing. Only
  `deployNext`, called by the steward `0x7C7F6cb2…9750E0` on
  `0x0000006cf51135e7D5cB2EacF74fF7390AA9beCa`, appends a successor to that
  chain — and it deploys that successor itself, so it would be a second
  wrapper over these same six chunks, at a CREATE2 address derived from the
  first build and a salt.
