# dapps

[ERC-8244](https://eip.tools/eip/8244) onchain HTML dapps: whole applications
stored as contract bytecode, served by a gateway, with no host to trust and
nothing to keep running.

| dapp | page | deployed | route |
| --- | --- | --- | --- |
| [poidh](poidh/) | 124,304 B, 6 chunks | [`0x37b9f184…3689`](https://etherscan.io/address/0x37b9f184FaC49F4c4343d60526ACDA5579Fa3689#code) | https://poidh.wei.limo/ |
| [poidhverse](poidhverse/) | 296,949 B, 13 chunks | [`0x27f3C5fe…De3a4`](https://etherscan.io/address/0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4#code) | https://poidhverse.wei.limo/ |
| [fwa](fwa/) | 214,280 B, 9 chunks | [`0xa6F1Ab97…6AF7`](https://etherscan.io/address/0xa6F1Ab97F43a3f9dE6245101619c852d1e526AF7#code) | https://fwa.wei.limo/ |

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

poidh names its successor in the page contract itself: immutable and elegant,
but it delivers an update only because `poidh.wei` can be repointed by hand.
The page reads its own address from the hostname, resolving a `.wei` name
through WNS when the host is one, so a reader who arrives by name is still told
when a successor exists — but the name itself remains one key's decision.

poidhverse points its name at a **resolver** holding a release root, with a
mandatory three-day delay before a published release activates. A release
propagates to everyone on the name, and the delay is a window to catch a bad
one before it reaches anybody.

For a store, the second is the only one that works: a catalogue of frozen
addresses is an archive, not a store.
