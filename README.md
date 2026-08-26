# dapps

[ERC-8244](https://eip.tools/eip/8244) onchain HTML dapps: whole applications
stored as contract bytecode, served by a gateway, with no host to trust and
nothing to keep running.

| dapp | page | deployed | route |
| --- | --- | --- | --- |
| [poidh](poidh/) | 108,930 B, 5 chunks | [`0x0000006c…9beCa`](https://etherscan.io/address/0x0000006cf51135e7D5cB2EacF74fF7390AA9beCa#code) | https://poidh.wei.limo/ |
| [poidhverse](poidhverse/) | 296,949 B, 13 chunks | [`0x27f3C5fe…De3a4`](https://etherscan.io/address/0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4#code) | https://poidhverse.wei.limo/ |

## The shape

Every dapp is a directory with a `manifest.json`. Nothing else registers one, so
adding a dapp is adding a directory — which is also what makes a store possible
later: the manifests already are the catalogue.

```
<dapp>/
  manifest.json   identity, the page's pinned size and hash, chunking, deployment
  dapp/page.html  the page — one file, no build step, no bundler
  src/            the wrapper contract that serves it
  test/           the page the repo has == the page html() returns
  deploy/         what was deployed, and what was checked after
  foundry.toml
```

The page is a **single self-contained HTML file**. No dependency can be fetched
at runtime by a document that has to work forever from bytecode, so there is
nothing to bundle and nothing to pin except the file itself.

## The commands

One set, at the root, driven by the manifest — not a copy per dapp.

```sh
node scripts/chunk.mjs  <dapp>          # -> <dapp>/out/*.creation.txt
node scripts/serve.mjs  <dapp> [port]   # localhost, real wallet, real transactions
node scripts/verify.mjs <dapp>          # the deployment, against the chain
```

`verify` is the one that matters. It checks four things against the network
rather than against another file in the repo:

1. the page is what the manifest pins
2. every chunk rebuilt from that page is byte-identical to the runtime code at
   its deployed address
3. `html()` on the wrapper returns exactly that page
4. every published route serves exactly that page

A deployment cannot change, so it never complains when the repo drifts away from
it. This is what notices.

## The release gate

`manifest.json` pins the page's byte length and SHA-256. Editing the page
without editing the manifest fails every command, deliberately: a chunk set
built from a page nobody pinned is how a deploy stops matching its repo.
Changing the page is therefore a two-line manifest change in the same commit,
and it shows up in review as one.

## Routes

Not every gateway serves what the contract returns, and the manifest says which
do — `verify` only holds a route to the bytes if it claims them.

- `exact` — the contract's own bytes. WNS (`wei.limo`) and `w4eth.io` both are.
- `resolver` — whatever release the resolver currently points at, which may lag
  a newly published one.
- `modified` — the gateway rewrites the document. `w3link.io` injects ~7.9 KB of
  its own script after `<body>`, so its bytes are not the page's.

## Publishing

The two dapps differ here, and poidhverse's model is the one to standardise on.

poidh names its successor in the page contract itself: immutable, elegant, and
unable to actually deliver an update, because `poidh.wei` points at a frozen
address and no reader is told a newer version exists.

poidhverse points its name at a **resolver** holding a release root, with a
mandatory three-day delay before a published release activates. A release
propagates to everyone on the name, and the delay is a window to catch a bad
one before it reaches anybody.

For a store, the second is the only one that works: a catalogue of frozen
addresses is an archive, not a store.
