# dapps

[ERC-8244](https://eip.tools/eip/8244) onchain HTML dapps: whole applications
stored as contract bytecode, served by a gateway, with no host to trust and
nothing to keep running.

| dapp | page | deployed | route |
| --- | --- | --- | --- |
| [poidh](poidh/) | 124,304 B, 6 chunks | [`0x37b9f184…3689`](https://etherscan.io/address/0x37b9f184FaC49F4c4343d60526ACDA5579Fa3689#code) | https://poidh.wei.limo/ |
| [poidhverse](poidhverse/) | 296,949 B, 13 chunks | [`0x27f3C5fe…De3a4`](https://etherscan.io/address/0x27f3C5fe79c092D663710d555Bb358cdc2dDe3a4#code) | https://poidhverse.wei.limo/ |
| [fwa](fwa/) | 214,280 B, 9 chunks | [`0xa6F1Ab97…6AF7`](https://etherscan.io/address/0xa6F1Ab97F43a3f9dE6245101619c852d1e526AF7#code) | https://fwa.wei.limo/ |
| [stamped](stamped/) | 369,688 B HTML / 111,895 B stored, 5 chunks | [`0xcBb240f5…8c310`](https://etherscan.io/address/0xcBb240f5B0fE63b7d961d50BA820d962aD88c310#code) | https://stamped.wei.limo/ |
| [tacit-pay](tacit-pay/) | 276,658 B, 12 chunks | [`0x0000005a…F919`](https://etherscan.io/address/0x0000005a9E52BD30867872DCb323bc78Eb5cF919) | https://anon.wei.limo/ |

## The shape

Every dapp is a directory with a `manifest.json`. Nothing else registers one, so
adding a dapp is adding a directory — which is also what makes a store possible
later: the manifests already are the catalogue.

```
<dapp>/
  manifest.json   identity, the page's pinned size and hash, chunking, deployment
  dapp/page.html  the full readable page — one file, no build step
  dapp/page.min.html  optional: the same page with its comments and spacing taken out, deployed in its place
  dapp/page.html.gz  optional exact compressed artifact returned by html()
  src/            the wrapper contract that serves it
  test/           the page the repo has == the page html() returns
  deploy/         what was deployed, and what was checked after
  foundry.toml
```

The page is a **single self-contained HTML file**. No dependency can be fetched
at runtime by a document that has to work forever from bytecode, so there is
nothing to bundle and nothing to pin except the file itself. When `html()`
returns compressed bytes, the exact compressed artifact is kept beside the full
HTML and is the file pinned by the manifest.

A manifest may also name a `source` beside its `page`. The page is then built
from the source by `scripts/strip.mjs`: comments go, and so does the whitespace
between tokens, which leaves every name, string and number as written. Each
script must parse to the same syntax tree as the source's before the page is
written. The built page is what the manifest pins and the chunks hold; the
source stays the file people read and edit. tacit-pay's 469 KB source is
deployed as 331 KB, 14 chunks instead of 20.

## The commands

One set, at the root, driven by the manifest — not a copy per dapp.

```sh
node scripts/strip.mjs  <dapp>          # <source> -> <page>, for a manifest that names a source
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
- `adapter` — a stable compatibility contract in front of a resolver. It may
  provide browser compatibility and crawler-visible Mini App metadata before
  opening the immutable release. The name is checked against the manifest's
  declared adapter address.
- `modified` — the gateway rewrites the document. `w3link.io` injects ~7.9 KB of
  its own script after `<body>`, so its bytes are not the page's.

## Publishing

The dapps use several publication models, and the reviewed resolver model is
the one to standardise on.

poidh names its successor in the page contract itself: immutable and elegant,
but it delivers an update only because `poidh.wei` can be repointed by hand.
The page reads its own address from the hostname, resolving a `.wei` name
through WNS when the host is one, so a reader who arrives by name is still told
when a successor exists — but the name itself remains one key's decision.

poidhverse points its name at a **resolver** holding a release root, with a
mandatory three-day delay before a published release activates. A release
propagates to everyone on the name, and the delay is a window to catch a bad
one before it reaches anybody.

Stamped uses that reviewed resolver model too, with a compatibility adapter in
front because its immutable release is deterministic gzip. The adapter serves
a tiny launcher and exposes the active gzip at `/app.gz`; it does not alter the
version contract or bypass the review delay.

For a store, the second is the only one that works: a catalogue of frozen
addresses is an archive, not a store.
