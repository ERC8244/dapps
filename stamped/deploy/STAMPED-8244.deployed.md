# Stamped onchain application — mainnet deployment

Release `0.1.0` is deployed and active. Five STOP-prefixed data contracts hold
the deterministic gzip page; `StampedVersion.html()` reassembles those exact
bytes. The stable resolver currently serves this release, and `stamped.wei`
resolves to the gzip-compatible gateway adapter.

| | |
| --- | --- |
| **StampedVersion 0.1.0** | [`0xcBb240f5B0fE63b7d961d50BA820d962aD88c310`](https://etherscan.io/address/0xcBb240f5B0fE63b7d961d50BA820d962aD88c310#code) |
| **StampedRoot** | [`0xa80978E5Cf461C8E26E16B084F55D0c5cB2C8b9b`](https://etherscan.io/address/0xa80978E5Cf461C8E26E16B084F55D0c5cB2C8b9b#code) |
| **StampedResolver** | [`0xe5fc60819694e46633c97D97be01bc00E3b47789`](https://etherscan.io/address/0xe5fc60819694e46633c97D97be01bc00E3b47789#code) |
| **Gateway adapter** | [`0x2d07854640cc1E0080dEA77c22296CEB17856C21`](https://etherscan.io/address/0x2d07854640cc1E0080dEA77c22296CEB17856C21#code) |
| **WNS route** | https://stamped.wei.limo/ |
| **Exact active gzip** | https://stamped.wei.limo/app.gz |
| compressed page | 111,895 B, SHA-256 `4554b4ec22915cb4e39a47665aed7c5a0e2097fee436f05d108a4f11afda5ea9` |
| uncompressed page | 369,688 B, SHA-256 `0a4c13751669542e7e8e55351f489f48c54d7457aaf25ef6deb77d36f98727df` |
| onchain commitment | Keccak-256 `0xfbef74bcc67300692d2fe40c0e6a49d52c029a26632f695f57758dc83f85a039` |
| active generation | 1 |

## HTML chunks

Each runtime begins with one `STOP` byte followed by its slice of the gzip
payload. The prefix makes accidental calls harmless and is skipped during
reassembly.

| # | address | runtime bytes |
| --- | --- | --- |
| 1 | `0x07bA4a74C207c556EDd02E365F1ED3188517bD2F` | 24,576 |
| 2 | `0x92c4FD699A9267784BE1040088d7D19663DC4c9a` | 24,576 |
| 3 | `0x4Bcb7E7DaF731F7EA33cefd85eC1d4521fD2f1ec` | 24,576 |
| 4 | `0xf4aaC3eC46E5Bf0caf006Af20D10b289dBcD2C16` | 24,576 |
| 5 | `0xBaBB12788004F5D77F86c0Be7A8141B96e87F162` | 13,596 |

## What the repository verifies

- the committed full HTML matches its pinned byte length and SHA-256
- the committed gzip artifact decodes byte-for-byte to that full HTML
- the five rebuilt chunk runtimes match the deployed runtime code byte-for-byte
- `StampedVersion.html()` returns the committed gzip bytes exactly
- `StampedResolver.current()` is the documented immutable version
- `stamped.wei` resolves to the documented gateway adapter
- `/app.gz` follows the resolver's reviewed active release

The top-level route intentionally serves the adapter's 2,872-byte launcher,
not the compressed page directly. This preserves browser compatibility without
changing the immutable release bytes. The same initial response contains the
Farcaster Mini App and Open Graph metadata that social crawlers need, while the
adapter's `/.well-known/farcaster.json` route serves the Mini App domain
manifest.
