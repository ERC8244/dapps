# POIDH onchain page (ERC-8244 / ERC-5219 / ERC-4804)

An onchain HTML front end for the POIDH bounty market
`0xE731dFadBFf20542E10D09D26Fc71445C70d4232` (mainnet), and its claim NFT
`0x9c5F45D5e1382e4058D334d93C6c01442012a4D9`.

| piece | path |
| --- | --- |
| page source | `dapp/poidh/page.html` |
| wrapper | `src/Poidh8244.sol` |
| chunker | `script/build-poidh-chunks.mjs` |
| tests | `test/Poidh8244.t.sol`, `test/dapp/poidh.smoke.mjs`, `test/dapp/poidh.abi.mjs`, `test/dapp/poidh.buttons.mjs`, `test/dapp/poidh.integration.mjs` |
| local preview | `script/serve-poidh.mjs` |

## How the page finds bounties

There is no indexer and no scan-and-push, because `bounties` is a plain
append-only array: `bountyCounter() == getBountiesLength()`, ids run `0..n-1`
with no gaps, and nothing is ever deleted. Enumeration is therefore arithmetic,
and a bounty's status is the `claimer` field of the struct already being read
(`0` active, `issuer` cancelled, anything else paid).

The one thing the protocol has no index for is **funder -> bounties**: there is
`userBounties` and `userClaims`, but no `userContributions`. The page answers it
by reading `getParticipants` for every bounty in one `aggregate3` - 10 KB and
~110 ms for the contract's whole history - which beats the log route, since only
one public node in four will serve `eth_getLogs` over that range at all.

The reader's "water level" (`poidh:seen:v1`) is one number, held in their own
browser: how many bounties existed last time they looked. It marks what is new
and lets the cached immutable half paint before any request returns. It is not
on chain because the reading is per-person, it would cost gas, and a shared
counter could be advanced past somebody by anyone else.

## Build

```
node script/build-poidh-chunks.mjs   # out/Poidh8244.chunk1..5.creation.txt
forge test --match-path test/Poidh8244.t.sol
node test/dapp/poidh.smoke.mjs       # the real page against mainnet in jsdom
node test/dapp/poidh.abi.mjs         # every hard-coded selector vs the verified ABI
node test/dapp/poidh.buttons.mjs     # presses every control, decodes what it would send
node test/dapp/poidh.integration.mjs # decoders vs canonical ABI; every tx simulated by eth_call
node script/serve-poidh.mjs          # localhost, real wallet, real transactions
```

`testServesTheRepoPage` deploys the five chunks and asserts `html()` is
`dapp/poidh/page.html` byte for byte, so a stale chunk set fails the suite
rather than reaching a deploy.

## Deploy order

1. Deploy each of the five chunk initcodes. Each returns its slice of the page
   as runtime bytecode; nothing else is in them.
2. Deploy `Poidh8244(steward, address(0), [A,B,C,D,E])` — constructor args
   appended to the creation code. `previous` is zero for the first version.
3. Read it back: `cast call <addr> "html()(string)" > poidh.html`.

Browse at `https://<addr>.w4eth.io/` (ERC-8244) or
`https://<addr>.1.w3link.io/` (ERC-4804, through the ERC-5219 `request()`).

## Stewardship

Unlike zSwap and Firstfruits8244, the steward is **not** immutable here: keys
rotate and signer sets migrate, and freezing the role into the bytecode meant
any such change ended the lineage. `transferStewardship` / `acceptStewardship`
move it in two steps; `renounceStewardship` freezes it deliberately and clears
any standing offer.

What is *not* relaxed: `PREVIOUS` and `successor` are still write-once and
still checked before they are set, so the chain a reader walks cannot be
restated by a steward, new or old.

## Growing the page

## Read budget

Everything on the read path is an `eth_call`, and `aggregate3` carries as many
of them per request as you like — so only a genuine DEPENDENCY may cost a
second round trip. Measured against a public node, and asserted in the smoke
test so it cannot regress:

| | requests |
| --- | --- |
| cold load, no wallet | 2 (+1 unbatched lineage read) |
| refresh with an account | 3 |
| open a bounty, up to 10 claims | 1 |
| open the one bounty past 10 | 3 |

`MIN_BOUNTY_AMOUNT` and `MIN_CONTRIBUTION` are `immutable` and `votingPeriod`
is assigned once at its declaration with no setter, so all three are read once
ever and cached. Claim lists come from `getClaimsByBountyId`, which returns ten
complete structs in one subcall; the 24-slot `bountyClaims` probe it replaced
cost 17 KB of calldata and a second wave. A claim's `tokenURI` is read only
when a reader asks for that picture.

## Growing the page

Five chunks hold 122,880 bytes; the page is ~105 KB, so there is only ~17 KB of room — see the note below.
Past that the count — and therefore the address — has to change, which means a
new wrapper deployed as a successor, not an edit.
