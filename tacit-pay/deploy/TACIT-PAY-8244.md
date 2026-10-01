# tacit pay onchain page (ERC-8244 / ERC-5219 / ERC-4804)

Private ETH payments on Ethereum, Base and Robinhood Chain, as one document served by a contract. It drives the Tacit
shielded ETH pool, which is deployed at the same addresses on all three chains:

| contract | address |
| --- | --- |
| pool (`TacitEvmPool`, native ETH) | `0x000000c2A20657CE25f2Ba99737933D031AFBEE9` |
| router (`TacitEvmPoolRouter`) | `0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5` |
| Groth16 verifier | `0x000000b1c0e84CEc8AdF8278B90c4d6400DfB153` |

| piece | path |
| --- | --- |
| page source | `dapp/page.html` |
| wrapper | `src/TacitPay8244.sol` |
| chunker | `../scripts/chunk.mjs` (shared) |
| tests | `test/TacitPay8244.t.sol`; in `test/dapp/`: `tacit-pay.page.mjs`, `.wallets.mjs`, `.fork.mjs`, `.links.mjs`, `.relay.mjs`, `.index.mjs`, `.keeper.mjs`, `.chains.mjs`, `.live.mjs` (below) |
| local preview | `../scripts/serve.mjs` (shared) |

## What it does

- **Shield.** ETH from any wallet into a private balance: your own, or anyone's from their `tacit1…` or `bp1…`
  address alone. The second needs no Tacit key: the page proves the deposit with a throwaway key, so a payer with only
  a wallet can pay a payment link. Or shield from an exchange: a standing deposit address, the same on every chain,
  that the relay moves into the private balance for at most 0.25%, or that you take in yourself at no fee.
- **Send** privately to a `tacit1…` or `bp1…` address, or pay an `0x` address out of the pool.
- **Withdraw** any part to any address.
- **Receive.** The unified `tacit1…` address, and payment links that carry it or a `.wei`/`.eth` name, on any chain
  (next section), with a QR code, that anyone with a wallet can pay.
- **Activity**, rebuilt from the key and the chain: what came in, what went out, with fees.

Every spend goes through a relay (no gas, and no account of yours on chain) or from your own wallet, chosen per
action; when a relay does not answer, the page offers the wallet.

## Payment links and names

A link is the page's address plus a fragment:

```
#pay=<tacit1…, bp1… or name.wei>&amount=<eth>&chain=<ethereum|base|robinhood>&chains=<a,b>&for=<note>
```

`amount`, `chain`, `chains` and `for` are optional; `#name.wei` or `#tacit1…` alone also opens a request. The payer sees
a request card: who is being paid (a name beside the address it resolved to), the amount and note, a chain picker
that shows what the payer's wallet holds on each chain, and one button. A payer needs only a wallet: the page
proves a deposit in their browser and the wallet sends it straight into the payee's private balance on the chain
chosen, moving the wallet to that chain first (adding it when the wallet has never seen it). Their address and the
amount show on chain; whom they paid does not. The link stays in the address bar until it is dismissed or paid, so a
reload, or a wallet app handing the page back, keeps the request. A payer who holds a Tacit key can pay from their
private balance instead, and `chains=` offers the payer only some chains.

**Names.** A name is a payee when it has published a Tacit address as its `finance.tacit` text record (the key every
Tacit app reads): `.wei` through the name service's `text(bytes32,string)`, `.eth` through the owner's resolver. What
a name says decides where money goes, so the page asks every Ethereum node it knows at once and takes an answer when two agree (one,
when the reader has set a single node), shows the address it got beside the name, and reads the name again just before
anything is paid: a name that moved in between is not paid. Names are ASCII (`a–z`, `0–9`, hyphens). `Send` and `Shield`
take names in their recipient fields too.

**Receiving.** *Receive* builds the link: an optional name, amount, note, and the chains offered (any, or one). The
name is checked against the open key: the link uses it only when the name's record is this key's address, and
otherwise says what is wrong. For a `.wei` name the page publishes the record itself, one transaction on Ethereum from
the wallet that owns the name (the page simulates it first); for `.eth` it says which record to set. Money paid
through the link waits in the payee's private balance on that chain. It is found by opening the page with the Tacit
key, or the Ethereum wallet it was derived from, on any device: balances are rebuilt from the key and the chains,
without the relay's index, and a page that is open says when something arrives.

## Where the page came from

It is the private-ETH page of `tacit.finance/pay` (`dapp/pay/eth/index.html` in src-company/tacit, at `76ffebb3`),
reduced to the payments themselves and rebuilt to stand alone.

**Kept:** shield (to yourself or anyone), the deposit address and taking it in, send, withdraw, receive and payment
links, paying a link from a wallet with no Tacit key, the relay-or-wallet choice for every spend, activity from the
key alone, and the wallet hardening the source carries: the relay's quote is checked (chain, pool, relay address and
a per-chain fee ceiling) before anything is signed, a spend rebuilt from the same note takes a fresh one-time key,
saved state is sealed under the view key, the relay's event index is checked against the pool and replaced by a
chain-log rebuild weekly, and no nullifier is ever sent to a node.

**Left out:** passkey and Bitcoin-wallet sign-in (a passkey is bound to the origin that made it, and the Bitcoin path
needs the main app), `.wei` and `.eth` names, payment links that carry the money (`#gift=`), one-time deposit
addresses per link, payments held until they blend in, the privacy check, saved recipients, moving Ethereum balances
to an L2 through its bridge, TAC points, payment proofs and CSV export. Each has a home on tacit.finance; none is
needed to pay or be paid.

**Rebuilt so nothing is fetched to run:**

- *The prover.* tacit.finance proves with snarkjs, which is GPL-3.0 and could not be bundled into an MIT page. This
  page carries its own Groth16 prover for the pool's circuit (BN254): Pippenger multi-exponentiation for G1 and G2, an
  FFT over the circuit's domain on its odd coset, and the zkey read as it is stored. Its field arithmetic is
  WebAssembly that the page writes itself from a short generator (Montgomery multiplication over eight 32-bit limbs,
  the representation the proving key stores), so there is no binary blob in the document. The work is shared across
  up to six workers started from the document's own `<script type="text/x-prover">`. A proof takes about 7 s on a
  laptop, and every proof is checked against the pool's verifier by `eth_call` before it is sent.
- *Poseidon.* Its round constants and MDS matrices are generated in the page by the Grain LFSR, as the Poseidon
  reference does, instead of being stored (about 80 KB of tables).
- *SHA-256, HMAC, Keccak-256, secp256k1, BabyJubJub, bech32m, ABI encoding, the QR code:* written out in the page.
  SHA-256's and Keccak's constants are computed from their definitions.
- *Fonts:* system stacks in place of the hosted ones.

The circuit's proving key (28.5 MB) and witness program (4.9 MB) are the one dependency too large for any contract.
The page fetches them once, from tacit.finance or the ceremony bundle on IPFS
(`bafybeia4yvn2zoggvgpjwg5vpwpt6aivjbcm6tgzxoxsukao2nm5yyypfy`, via Filebase, dweb.link or ipfs.io), uses them only if
their SHA-256 equals the pins the page carries (also readable from the contract as `PROVING_KEY_SHA256` and
`WITNESS_PROGRAM_SHA256`), and keeps them in the browser. A reader can add a mirror, or load the two files from disk.

## Relay or wallet, and what the page depends on

Every spend has two routes, and the page shows which is in use:

- **The relay** sends it: no gas needed, and the payer's account is not on chain. The relay quotes a fee, which is
  signed into the proof together with the relayer's address, the recipient and the memos, so a relay can deliver a
  spend but cannot change it. Before anything is proved the quote is checked (this chain, this pool, the relayer
  address the page expects, and a per-chain fee ceiling); a fee that moved up between the form and the spend is shown
  before it is paid; and a transaction the relay names counts only when it is in a block and spent these notes, so a
  relay that names some other transaction, or sends nothing, is not taken for a payment. When a relay errors or does
  not answer, the page offers the wallet.
- **The wallet** sends it: no fee, the wallet pays gas, and its address shows as the sender. Nothing else is needed.

Reading is the same: the relay's event index is a speed-up the page checks against the pool (the tree it builds must
be a root the pool has held, and must reach the pool's own leaf count, or the page reads the chain instead), and a
full read of the logs runs behind the first paint. With no relay, every balance is rebuilt from chain logs alone.

| it depends on | for | when it is down |
| --- | --- | --- |
| public JSON-RPC nodes, 2 to 4 per chain (replaceable under *Endpoints*) | every read and send, and names | the next node is tried; the page remembers the one that answered |
| a wallet (EIP-1193, EIP-6963) | gas for wallet-sent spends and shielding | relayed spends and reading need none |
| the proving key and witness program, 33 MB, from tacit.finance, Filebase, dweb.link or ipfs.io, or from disk | the first payment on a device | any mirror will do, each file is accepted only by its pinned SHA-256; or load both from disk |
| a relay (optional) | spends with no gas, deposit-address sweeps, a fast first read | the wallet route and chain logs |
| a gateway to serve the page | getting the page | any ERC-8244 gateway, or `html()` from any node |

There are no other scripts, fonts, images or stylesheets: the document pins its one module by hash. The proving key is
the one dependency that is not a chain read. Rebuilding a wallet from chain logs alone leans on nodes that serve old
logs: on Ethereum and Base, one public node each does (Tenderly's), plus Base's own with 2,000-block ranges, and
Robinhood Chain's own node. `test/dapp/tacit-pay.chains.mjs` measures this against the live nodes. A reader with an
archive node of their own can set it under *Endpoints*.

## What it talks to

- **Chain state:** public nodes per chain, which the reader can replace under *Endpoints*; transactions through the
  reader's wallet (EIP-1193, discovered with EIP-6963; a wallet that only sets `window.ethereum` works too). A wallet
  still connected to the page is picked up on a later visit without a prompt, and is put on the chain (switched, or
  added first) before a proof is started, not after it.
- **Relays:** one per chain, for relayed spends, fee quotes, an index of pool events and watching deposit addresses.
  The reader can point a chain at another relay or none. A relay the reader sets is held to the fee ceiling but not
  to the default relay's address.
- **Mirrors** for the proving key, as above.

The document pins its one module by hash in its Content-Security-Policy and allows connections only over HTTPS (and
to `127.0.0.1` and `localhost`, for a reader's own node). A gateway that injects script, like w3link, is refused by
that policy. The Tacit key is derived in the tab from the wallet's signature over the fixed identity message every
Tacit app asks for (the same account opens the same key everywhere), is never stored, and never leaves the tab.

## Build

Everything below is run from this directory. `forge` comes from Foundry; the browser tests need `npm i` at the repo
root and a Chromium for playwright-core (`npx playwright-core install chromium`).

```
node ../scripts/chunk.mjs tacit-pay            # out/TacitPay8244.chunk1..N.creation.txt
forge test --match-path test/TacitPay8244.t.sol
node test/dapp/tacit-pay.page.mjs              # the page alone: vectors, sign-in, links, names, endpoints, no network
node test/dapp/tacit-pay.wallets.mjs           # external wallets: picker, refusals, account and chain changes, no network
node test/dapp/tacit-pay.fork.mjs              # every flow on anvil forks of all three chains, proofs made in the page
node test/dapp/tacit-pay.links.mjs             # a real .wei name, a link, a payer paying it on every chain, recovery by key
node test/dapp/tacit-pay.relay.mjs             # a faithful relay, then relays that lie, stall, overcharge or leave events out
node test/dapp/tacit-pay.index.mjs             # an event index that says "no events" is caught against the pool
KEEPER=… node test/dapp/tacit-pay.keeper.mjs   # the real relay server, from the repo's worker-relay, on a fork
node test/dapp/tacit-pay.chains.mjs            # read-only: every node and relay the page ships, asked what the page asks
node test/dapp/tacit-pay.live.mjs              # read-only against mainnet: nodes, relays, routers, the proving key
node ../scripts/serve.mjs tacit-pay            # localhost, real wallet, real chains
node ../scripts/verify.mjs tacit-pay           # once deployed: chunks, html() and every route
```

The fork test runs its proofs in the page against the deployed pool's verifier, so a passing run means the page's
prover, witness builder and transaction encoding are the ones the pool accepts.

## Deploy order

1. Deploy each chunk initcode from `out/`. Each returns `STOP || slice` as runtime bytecode; nothing else is in them.
2. Deploy `TacitPay8244(steward, address(0), chunks, keccak256(page))`, constructor args appended to the creation
   code. The constructor reassembles the page from the chunks and reverts unless it hashes to the commitment.
3. Read it back: `cast call <addr> "html()(string)" > tacit-pay.html`, and compare with `dapp/page.html`.
4. Add `deployment` to `manifest.json` (contract, chunk addresses, `pageSha256`, routes), then run `verify.mjs`.

Browse at `https://<addr>.w4eth.io/` (ERC-8244) or `https://<addr>.1.w3link.io/` (ERC-4804, which the page's
policy keeps from running its injected script), then point a `.wei` name at the contract.

**Cost**, measured by deploying the chunks and the wrapper on a local anvil (Prague rules): a full chunk is 5,368,866
gas and the last 3,040,808, so nine chunks are 45,991,736 gas, and the wrapper 1,504,819: 47,496,555 gas in all,
about 0.047 ETH at 1 gwei. The wrapper deployed there served `dapp/page.html` byte for byte from `html()`.

## Stewardship and the name

The steward is `0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20`. Releases follow the lineage model poidh and fwa use, with
no delay: the steward deploys each new version through `deployNext` (CREATE2 from this contract, so the successor's
`PREVIOUS` is unforgeable) and points `anon.wei` at it. The role moves in two steps (`transferStewardship`, then
`acceptStewardship` from the new steward), so once the page settles it can be handed to a lock, a multisig or a
timelock, or renounced to freeze the lineage.

`html()` never forwards: every version serves its own bytes forever. The page reads its own address from the
gateway's hostname (an `<address>.` host, or a `.wei.limo` name resolved through WNS) and, when `latest()` names a
newer version, says so in its footer; it redirects nothing.

`anon.wei` points at the version contract directly, as `fwa.wei` and `poidh.wei` do, so a successor reaches the name
when the steward repoints it.
