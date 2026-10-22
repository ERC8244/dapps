# zSwap v0.3 — deployed

Ethereum mainnet. Page `dapp/page.html`: 666,463 B, sha256
`b2a2bc648ec0237e3f8da7af86492c757be28da42ddeacecaf68df5f8f25f478`
(zFi commit `c89da66`).

## Release contract

| | |
| --- | --- |
| zSwap v0.3 | [`0x0a0Be4271Ca53f0002800a323Dee65A6B31CD507`](https://etherscan.io/address/0x0a0Be4271Ca53f0002800a323Dee65A6B31CD507#code) |
| transaction | [`0x67e08f58…19ed`](https://etherscan.io/tx/0x67e08f586dccba8de7cdc3854d733fce53aebf02fd5e6a140763cfcf829719ed), block 26112066, 2,378,994 gas, 2026-10-03 |
| constructor | `dao` = zFi DAO `0x5E58BA0e06ED0F5558f83bE732a4b899a674053E`, `previous` = `0x0` (a standalone root), 28 chunk addresses below |
| compiler | solc 0.8.36, via-IR, 9,999,999 runs, Prague. Etherscan-verified. |
| source | `src/zSwap.sol`. Compiled here with `foundry.toml`, its creation code is byte-identical to the deployment's except the 32-byte metadata hash at the end (source paths differ between repositories). |

All 29 transactions together used 148,020,908 gas (0.010369 ETH).

## Chunks

Each chunk's runtime code is one 1/28 slice of the page, with no prefix
(`chunks.count = 28` in the manifest). `scripts/verify.mjs zswap` rebuilds them
from the page and compares each against the chain.

| # | address | transaction | block |
| --- | --- | --- | --- |
| 1 | [`0xA31cc12D1061b9e7eA0354Bd83c912cE6517aa9C`](https://etherscan.io/address/0xA31cc12D1061b9e7eA0354Bd83c912cE6517aa9C) | [`0x2bf7dd345e…`](https://etherscan.io/tx/0x2bf7dd345eb827241426917f49309e6802b5906d3638ae9c76787353b9bebb23) | 26111972 |
| 2 | [`0xd9dc621bC7a5FFFfbaE5ae318b0d02e5cC6dF246`](https://etherscan.io/address/0xd9dc621bC7a5FFFfbaE5ae318b0d02e5cC6dF246) | [`0x46a4b35d91…`](https://etherscan.io/tx/0x46a4b35d91149e85c03a9cee2090040ffa1549b0484d56f45a5ea74ceacd5021) | 26111976 |
| 3 | [`0x8495e5FbFABFDE1D601E253f75436D5AB1459b5E`](https://etherscan.io/address/0x8495e5FbFABFDE1D601E253f75436D5AB1459b5E) | [`0xc77a625626…`](https://etherscan.io/tx/0xc77a6256266e9dbf61193b4df911dea01ef5b32d4669d38c5b3f098c1a896039) | 26111980 |
| 4 | [`0xefc3eAC71cF71aD216049E8c62cf2D16dbcc69bc`](https://etherscan.io/address/0xefc3eAC71cF71aD216049E8c62cf2D16dbcc69bc) | [`0x181d98e3e4…`](https://etherscan.io/tx/0x181d98e3e40ab968404101ed4574f51bf77fa852582cc4972a0298ab0736b91c) | 26111985 |
| 5 | [`0x4EF02899181746BdF46Ee15826Da59EF04E97050`](https://etherscan.io/address/0x4EF02899181746BdF46Ee15826Da59EF04E97050) | [`0x1d8ab8d1c7…`](https://etherscan.io/tx/0x1d8ab8d1c7c68d4b479e5730d0b84bdd7de37d44d465310cd488b89a286fae47) | 26111992 |
| 6 | [`0x649bB3e04717F4B9b47F2ceB05827E4f27a03f6F`](https://etherscan.io/address/0x649bB3e04717F4B9b47F2ceB05827E4f27a03f6F) | [`0xc0ba88abfb…`](https://etherscan.io/tx/0xc0ba88abfbbc847268a3510f6524a0ac38557d073c5c44954c3d8b65a2a17a57) | 26111996 |
| 7 | [`0xc21EDe19A8bFaAA6CBA1b5a07e54Fcb4041D4291`](https://etherscan.io/address/0xc21EDe19A8bFaAA6CBA1b5a07e54Fcb4041D4291) | [`0x1d55f85fc0…`](https://etherscan.io/tx/0x1d55f85fc04ec9d9fd5a600b234e2cc4efc4d4f3b15260ce99d98ce0a27572dd) | 26112002 |
| 8 | [`0x8DD29A08289F47806C42a50bFFDb99ecCc3af0f1`](https://etherscan.io/address/0x8DD29A08289F47806C42a50bFFDb99ecCc3af0f1) | [`0x21ccc11852…`](https://etherscan.io/tx/0x21ccc118523b1cab3617cd8547d55fb9c484c0f99c3c361425a441af0b7bc36c) | 26112004 |
| 9 | [`0x4d6aaf190CE25418f3CBeB4154C64cA57e047E50`](https://etherscan.io/address/0x4d6aaf190CE25418f3CBeB4154C64cA57e047E50) | [`0xff9b3e27d3…`](https://etherscan.io/tx/0xff9b3e27d3e969ceddcbd4bf9368463cc6380a27e028c178b431bcb6f26d2dd6) | 26112006 |
| 10 | [`0x276f22d54e898503754cc5EcE9e60458892B3B2D`](https://etherscan.io/address/0x276f22d54e898503754cc5EcE9e60458892B3B2D) | [`0xb099d712c1…`](https://etherscan.io/tx/0xb099d712c15366e951729eccfe2dd1e953f076047f23eee446abf48d95dce4d1) | 26112007 |
| 11 | [`0x20d8B819b0aCe6A279FD94007125FA98DFb76335`](https://etherscan.io/address/0x20d8B819b0aCe6A279FD94007125FA98DFb76335) | [`0xc0ce821f10…`](https://etherscan.io/tx/0xc0ce821f105f1e439f1e397779e0b62cfca26d1f84a29559bf389e99c137da48) | 26112009 |
| 12 | [`0x71C6B699B6bc6ff5D3AB4BAC2d624F26d258ECAE`](https://etherscan.io/address/0x71C6B699B6bc6ff5D3AB4BAC2d624F26d258ECAE) | [`0x2647190054…`](https://etherscan.io/tx/0x2647190054b0764b8c55f41209b17f21d4a2b0df548d4ff03753958192976e1a) | 26112011 |
| 13 | [`0xf51C9D22a4DF008fD409747E4fD5fAC58ff5d8E6`](https://etherscan.io/address/0xf51C9D22a4DF008fD409747E4fD5fAC58ff5d8E6) | [`0xdaa929ccab…`](https://etherscan.io/tx/0xdaa929ccabf3cbbb68f0ca6ffd0a61ce91c282d6c943ed0f386894025410fe34) | 26112015 |
| 14 | [`0x662fA39bD8db1cc38b2DDB55FE3e9c091C610614`](https://etherscan.io/address/0x662fA39bD8db1cc38b2DDB55FE3e9c091C610614) | [`0xc2d36c7f54…`](https://etherscan.io/tx/0xc2d36c7f542100758fa1b35dc5f0e512bd4a0b69b23794858a4d78884af6c141) | 26112034 |
| 15 | [`0xd411d8E20316e075A54422f3647a2082A8B093f5`](https://etherscan.io/address/0xd411d8E20316e075A54422f3647a2082A8B093f5) | [`0x0b8b557203…`](https://etherscan.io/tx/0x0b8b5572037160786b20cb0100afa56c67e5f1936aa46f529f304631d1efa58e) | 26112035 |
| 16 | [`0xa61793d87f6C4CE4A45B82dD8E0383Ce00a618b9`](https://etherscan.io/address/0xa61793d87f6C4CE4A45B82dD8E0383Ce00a618b9) | [`0xff5b2e096a…`](https://etherscan.io/tx/0xff5b2e096ae660113914c70f0627ebcab0b3dad89db8aaf434195b76aa6d162a) | 26112037 |
| 17 | [`0x0F1e813516A80cFBA3E86E6c32b384Fda77b54C7`](https://etherscan.io/address/0x0F1e813516A80cFBA3E86E6c32b384Fda77b54C7) | [`0x00516540d0…`](https://etherscan.io/tx/0x00516540d0236ef6b52a8ab922df5b0f93359cdb5603c22cbccde4700270a438) | 26112039 |
| 18 | [`0x93a12a1C6c2c2a27e5D58cFA1A995C6Cb0ebCB38`](https://etherscan.io/address/0x93a12a1C6c2c2a27e5D58cFA1A995C6Cb0ebCB38) | [`0x0c965609c6…`](https://etherscan.io/tx/0x0c965609c68f71bdeb2c256786494a7c7b9c19346a1f3880e67620b4118b4305) | 26112041 |
| 19 | [`0x8e11aA7345192A1522FF8B6898e510b70093790E`](https://etherscan.io/address/0x8e11aA7345192A1522FF8B6898e510b70093790E) | [`0x0793657edf…`](https://etherscan.io/tx/0x0793657edfbaa22917874c474fc0efb61708fef26fee15562f946c6f76ec30fc) | 26112042 |
| 20 | [`0x8Ec6D2b571a7D69Ff682b1cc5C36d66202CeFea6`](https://etherscan.io/address/0x8Ec6D2b571a7D69Ff682b1cc5C36d66202CeFea6) | [`0xce0a238c53…`](https://etherscan.io/tx/0xce0a238c53bda2e6d7d7581e88b0311d233d121ec823e1d5355ebf778e252ff1) | 26112044 |
| 21 | [`0xb37522048cA942F681eEB6E36Da2A2bf058F3288`](https://etherscan.io/address/0xb37522048cA942F681eEB6E36Da2A2bf058F3288) | [`0xfea721c3e1…`](https://etherscan.io/tx/0xfea721c3e191d9f779caaaa9b68b406cdc0b257bae19353390293261dea8e481) | 26112047 |
| 22 | [`0x6999FCddf55bf3793aE13fD568f202aDDe4F08cB`](https://etherscan.io/address/0x6999FCddf55bf3793aE13fD568f202aDDe4F08cB) | [`0x6704f3e734…`](https://etherscan.io/tx/0x6704f3e734f02c036d82406c7294f1c4961264bbaf931b5ddda532d290e68b03) | 26112048 |
| 23 | [`0x80578583280336BE8725bcd77dB38dDAd19D4eA7`](https://etherscan.io/address/0x80578583280336BE8725bcd77dB38dDAd19D4eA7) | [`0xf8439c5eba…`](https://etherscan.io/tx/0xf8439c5eba5360937a3d2a621f7ef28e20098e9ef83587f1d94ff9bd0eb1788c) | 26112052 |
| 24 | [`0x2D2dA6d1cDAB7a73844b0B0B8cB1Da4e06D3bf55`](https://etherscan.io/address/0x2D2dA6d1cDAB7a73844b0B0B8cB1Da4e06D3bf55) | [`0x249e94dd2f…`](https://etherscan.io/tx/0x249e94dd2f492c25caf57676b0d89114531c951daea7b88a7299c858bb7d2f83) | 26112057 |
| 25 | [`0xBb04c25C629cEaaf7eaF1A1132F218452b9924E3`](https://etherscan.io/address/0xBb04c25C629cEaaf7eaF1A1132F218452b9924E3) | [`0x2310c8c96e…`](https://etherscan.io/tx/0x2310c8c96e124538004fbbe61d3426756f8655d3237c52eb1144c2aceb5a8232) | 26112059 |
| 26 | [`0xfd7255Aeab05687B61335F73A00F7B6C9E1374D4`](https://etherscan.io/address/0xfd7255Aeab05687B61335F73A00F7B6C9E1374D4) | [`0xa78bdd50a9…`](https://etherscan.io/tx/0xa78bdd50a905bcc9e80e3f4770c94309ef1f1cb5008cbc988e7ecfcd6f89be24) | 26112061 |
| 27 | [`0x21d663b62Bb20a2B3c222C7b2a17B11d1158A73c`](https://etherscan.io/address/0x21d663b62Bb20a2B3c222C7b2a17B11d1158A73c) | [`0xe5048bdc1b…`](https://etherscan.io/tx/0xe5048bdc1be4cd8c8b856c2ec2722fb0fc519bb2fc13159bec83f34bd63e6e3c) | 26112063 |
| 28 | [`0xC2c3B453d9b43Bd37721C1a5e676Ad849B8d6fBB`](https://etherscan.io/address/0xC2c3B453d9b43Bd37721C1a5e676Ad849B8d6fBB) | [`0xa708f793a8…`](https://etherscan.io/tx/0xa708f793a808602d2d37ed5aa855cbd064edb4f2fa40b911b1b534d9fdba71af) | 26112064 |

## Lineage

zSwap versions are linked: each records `PREVIOUS()`, and the zFi DAO can set
one `successor()` per version through `deployNext`. `latest()` walks forward.

| version | address | |
| --- | --- | --- |
| v0.1 | [`0x00000095643CFfA7D9fae407a84dfCB6406456c6`](https://etherscan.io/address/0x00000095643CFfA7D9fae407a84dfCB6406456c6) | root |
| v0.2 | [`0xe686952842627A2cf81DF42CCaD54ef98046DB8D`](https://etherscan.io/address/0xe686952842627A2cf81DF42CCaD54ef98046DB8D) | |
| successor of v0.2 | [`0x000000791BE31E1F70f2FFA9d32eE3C7bb6E8ba9`](https://etherscan.io/address/0x000000791BE31E1F70f2FFA9d32eE3C7bb6E8ba9) | a zSwapLink: relays `html()`/`request()` to v0.3 above |

The link was created by a zFi DAO proposal executing v0.2's `deployNext`
(proposal `0x9bd73d2e…14e6`). `src/zSwapLink.sol`, compiled at 200 runs, gives
the deployed creation code except the metadata hash. Its `html()` returns this
page byte for byte, and the manifest holds its w4eth route to that.

## Names and the resolver

`zswap.wei` resolves (WNS) directly to the v0.3 contract, set by its owner.

`zSwapResolver` [`0x000000E7DAD6128683D1fb415e80B30c23dAb7AC`](https://etherscan.io/address/0x000000E7DAD6128683D1fb415e80B30c23dAb7AC#code)
walks the lineage from v0.1 and serves the newest version that has stood for
three days. The link became v0.2's successor at 2026-10-17 11:05 UTC and
matured at 2026-10-20 11:05 UTC; since then `current()` is the link,
`versions()` is v0.1, v0.2, link, and `html()` returns this page. Its w4eth
route is in the manifest as a `resolver` route: `verify` reports what it
serves rather than failing when a later release becomes current.

## Checked after deploy

`node scripts/verify.mjs zswap` (2026-10-22): page matches the manifest, all 28
chunk runtimes match, `html()` returns the page, `zswap.wei` resolves to this
release, and zswap.wei.limo, w4eth.io (release, link and resolver) and w3link.io
serve the exact bytes.
