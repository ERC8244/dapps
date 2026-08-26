# POIDH Universe onchain page (ERC-8244)

POIDH Universe is a self-contained visual explorer and claim interface for POIDH bounties. The application reads
the POIDH v3 contracts directly on Ethereum, Base, Arbitrum, and Degen Chain; it has no application backend,
indexer, analytics, remote JavaScript, or bounty snapshot.

| piece | path |
| --- | --- |
| canonical v0.2.2 page | `dapp/page.html` |
| immutable version | `src/UniverseVersionV2.sol` |
| version interface | `src/UniverseVersion.sol` |
| bytecode storage | `src/storage/CodeStore.sol`, `src/storage/CodeReader.sol` |
| chunk builder | `../scripts/chunk.mjs` (shared) |
| local preview | `../scripts/serve.mjs` (shared) |
| integrity tests | `test/Poidhverse8244.t.sol` |
| complete project | [AlexanderCGKarlsson/poidhverse](https://github.com/AlexanderCGKarlsson/poidhverse) |

## Architecture

`UniverseVersionV2` is the ERC-8244 endpoint: its `html()` method reconstructs the exact application document from
ordered, immutable bytecode-storage contracts. Each storage runtime begins with `STOP`, followed by up to 24,575
payload bytes. The v0.2.2 document is 296,949 bytes and therefore uses 13 chunks.

The constructor reconstructs every chunk and checks the complete Keccak-256 commitment before deployment. The
deployed version is permanent and independently retrievable. A separate stable resolver can move only between
published immutable versions, and later releases must remain staged for three days before permissionless activation.

## Build and test

From this directory:

```sh
node ../scripts/chunk.mjs poidhverse
forge test
node ../scripts/verify.mjs poidhverse
node ../scripts/serve.mjs poidhverse
```

The chunk builder refuses any page other than the canonical v0.2.2 release and proves that the generated chunks
round-trip to the source document. The Solidity test deploys those bytes locally and verifies that `html()` returns
the repository page exactly.

## Read the deployed dapp

```sh
cast call 0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4 "html()(string)" \
  --rpc-url "$ETHEREUM_RPC_URL" > poidhverse.html
```

The immutable v0.2.2 contract is directly browsable through an ERC-8244 gateway. The `poidhverse.wei` name points
to the stable resolver rather than to an individual release.

## Source provenance

The files in this directory are copied from POIDH Universe v0.2.2. The canonical application repository contains
the TypeScript sources, frontend tests, deployment scripts, release validator, onchain verification tooling, and
complete third-party attribution notices.
