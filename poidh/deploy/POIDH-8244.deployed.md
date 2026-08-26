# POIDH onchain page — mainnet deployment

Deployed and verified. The page is the runtime bytecode of five data contracts;
the wrapper reassembles them in `html()` and serves them over ERC-8244 and
ERC-5219.

| | |
| --- | --- |
| **Poidh8244** | [`0x0000006cf51135e7D5cB2EacF74fF7390AA9beCa`](https://etherscan.io/address/0x0000006cf51135e7D5cB2EacF74fF7390AA9beCa#code) |
| **Browse (ERC-8244)** | https://0x0000006cf51135e7d5cb2eacf74ff7390aa9beca.w4eth.io/ |
| **Browse (ERC-4804)** | https://0x0000006cf51135e7d5cb2eacf74ff7390aa9beca.1.w3link.io/ |
| **WNS route** | https://poidh.wei.limo/ |
| steward | `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20` (ross.wei) |
| previous / successor | `0x0` / `0x0` — generation 1, tip of its own lineage |
| page | 108,930 B, sha256 `63faa25ab253313f5ccc94e05fed3a5989647723e3a56ebdef580e33c6e75a0e` |

## Data chunks

| # | address | bytes |
| --- | --- | --- |
| 1 | `0x9022d2375aa7c878d8486DD5649a86bF653b4741` | 21,786 |
| 2 | `0x5129ddB7009ABAd18229bb0BbffE92CA17C5b84f` | 21,786 |
| 3 | `0x76E11ebeAfD4daBfB3B0f4CFD3EE169cc3aE95D8` | 21,786 |
| 4 | `0xF116eE52d95D66A72e2525c3A004458CfFb11d03` | 21,786 |
| 5 | `0xa2F53f63aB6409f6737f999E1Fad5367922B1873` | 21,786 |

Deployed by plain `CREATE` from `0xAcFBA7Ce872C6eAD99d535586f84b0D68ADE4082`;
the wrapper by `create2Deploy` through the repo factory
`0x00000000004473e1f31C8266612e7FD5504e6f2a` with salt
`0x8e3a0345212cd56387c625e5e5db3974a0224639ba9e584674dcf9d777315774`.
The salt was mined against that factory and the resulting address was
**simulated before broadcast** to prove the factory is deployer-independent.

## What was checked after deploy

- every chunk's runtime code is byte-identical to its build artifact
- the five concatenated reassemble to `dapp/page.html` exactly
- `html()` returns 108,930 bytes identical to the repo page
- `request()` answers `200` with the page and `text/html`
- `resolveMode()` is `"5219"`; `generation()` is 1; `latest()` is itself
- `DATA1..5` point at the five chunks above
- the w4eth.io gateway serves the identical document
- `https://poidh.wei.limo/` serves the identical document, and answers with
  `x-wns-contract: 0x0000006cf51135e7d5cb2eacf74ff7390aa9beca` — the `poidh.wei`
  name points at this version contract directly, not at a resolver, so a
  successor deployed through `deployNext` does not move the name with it

## Growing it

Five chunks hold 122,880 B and the page is 108,930 B, so there are **13,950 B**
of headroom. Past that the count — and therefore the address — has to change,
which means a successor deployed through `deployNext`, not an edit.
