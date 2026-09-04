# Stamped onchain application

Stamped is a permanent event-stamp protocol with a public web and Farcaster
Mini App frontend. The application has no server, database, indexer, custody or
mock calls: the browser reads the supported chains directly and the production
release is stored in Ethereum bytecode.

Unlike the other pages in this repository, the canonical ERC-8244 payload is
deterministic gzip rather than plain HTML. `StampedVersion.html()` returns those
gzip bytes exactly. `StampedResolver` serves the active reviewed version with a
`Content-Encoding: gzip` header, while `StampedGatewayAdapter` provides a small
plain-HTML launcher for gateways that strip that header. The launcher downloads
`/app.gz`, decompresses it in the browser, and opens the application. It also
puts the Farcaster Mini App and Open Graph metadata in the initial HTML so
crawlers can discover Stamped before any JavaScript runs, and serves the
Farcaster domain manifest at `/.well-known/farcaster.json`.

## Release model

- `StampedVersion` is one immutable release and validates all ordered bytecode
  chunks against publisher-supplied Keccak-256 commitments in its constructor.
- `StampedRoot` is the append-only release registry and canonical version
  factory.
- `StampedResolver` exposes the active release through a stable ERC-5219 route.
  Release one activates immediately; later releases have a mandatory three-day
  public review period.
- `StampedGatewayAdapter` keeps `stamped.wei` usable through gateways that do
  not preserve gzip response headers, exposes crawler-visible Farcaster and
  social metadata, and forwards the manifest, images, and other resources from
  the reviewed resolver.

## Reproduce the page artifacts

From the repository root:

```sh
node scripts/chunk.mjs stamped
node scripts/serve.mjs stamped 3000
node scripts/verify.mjs stamped
```

The committed `dapp/page.html` is the full readable 369,688-byte application.
`dapp/page.html.gz` is the exact immutable payload returned by release `0.1.0`.
The shared tools verify that the compressed artifact decodes byte-for-byte to
the full HTML before reproducing its deployed chunks.

## Protocol deployments used by the application

| chain | contract |
| --- | --- |
| Ethereum | `0xdFF56b8403dfF5a03A1E99850598F9DCB96c09E6` |
| Base | `0xf342cCfeeeC000727D02F069d14a94E812dCE0a3` |
| Arbitrum | `0xb6830b896f50f916c0f85e55f4c01e45bf1b554f` |
| Sepolia | `0xcf013B90fcd56cB31581FA0067Feab2C98C512a5` |
| Base Sepolia | `0xC3249356a483fbe17d5355D39105D2eA666d9de6` |
