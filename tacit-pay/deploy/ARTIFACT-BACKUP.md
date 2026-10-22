# Onchain copy of the files wallets check by hash

The files a Tacit wallet fetches from tacit.finance or IPFS and checks against a pinned SHA-256 are also stored as
contract code on Base Sepolia (chain 84532), written on 2026-10-04 by `deploy/artifact-backup.mjs`. Each file is cut
into 24,575-byte pieces, each the code of a data contract behind a STOP byte, deployed through the deterministic CREATE2
proxy (`0x4e59b44847b379578588920ca78fbf26c0b4956c`, salt 0), so every address follows from the bytes alone and the same
files deployed on any other chain land at the same addresses. A manifest per file lists its SHA-256, size and pieces.

| File | Bytes | Pieces | SHA-256 | Manifest |
|---|---|---|---|---|
| `transact_final.zkey` (proving key) | 28,558,285 | 1,163 | `40758061…79c4b` | `0xF7679584f6dc84495374dA5B5350C2E7828ad620` |
| `transact.wasm` (witness program) | 4,916,992 | 201 | `02dd5e84…8a6c1` | `0xc63e43d159429583A9fb3fF0b5053e4D12415F55` |
| `transact_vk.json` (verifying key) | 4,761 | 1 | `f3e36ac0…626b3` | `0x8649Dd8ec5b0DE7de9F6934A13188E2b868B975B` |
| `pin.json` | 1,501 | 1 | `79ddf12a…6f8f9` | `0x75578ab320147Af1f8d39e7e3643621Bc57e5bE9` |
| `tacit-evm-pool-wallet.js` (standalone wallet, as served) | 705,182 | 29 | `cdc59dd5…c15c0` | `0x202fF20B540794CD6f8F54cF80A0Af6170BEaDB4` |

**Index:** `TacitArtifacts` at `0x250FCb513A809727b9b538A313895Eec5A36674C` (source `src/TacitArtifacts.sol`, verified on
Sourcify and on sepolia.basescan.org) names the five files and reads them from an explorer: `files()`, `manifest(m)` (the
SHA-256, size and piece addresses), `piece(m, i)` (one piece's bytes) and `check(m)` (reassembles a small file and
compares its SHA-256 onchain; true for the verifying key and the pin record).

Read one back, checked: `RPC=https://base-sepolia-rpc.publicnode.com node deploy/artifact-read.mjs <manifest> [out]`.
All five were read back and matched on 2026-10-04. A testnet is not permanent; this is one copy among several.

The anon.wei page (from its next version) reads the proving key and witness program from here when every mirror fails,
through public Base Sepolia nodes, and keeps them only if they match the SHA-256 it pins.
