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
| deployed page | `dapp/page.min.html`: the source with its comments and spacing taken out by `../scripts/strip.mjs` (run by `deploy/repin.sh`), the file the manifest pins and the chunks hold |
| wrapper | `src/TacitPay8244.sol` |
| chunker | `../scripts/chunk.mjs` (shared) |
| tests | `test/TacitPay8244.t.sol`; in `test/dapp/`: `tacit-pay.page.mjs`, `.units.mjs`, `.sig.mjs`, `.engine.mjs`, `.unconfirmed.mjs`, `.artifacts.mjs`, `.ens.mjs`, `.wallets.mjs`, `.fork.mjs`, `.links.mjs`, `.relay.mjs`, `.index.mjs`, `.boxes.mjs`, `.keeper.mjs`, `.chains.mjs`, `.live.mjs`, `.strip.mjs`, `.scan.mjs`, `.privateswap.mjs` (below) |
| local preview | `../scripts/serve.mjs` (shared) |

## What it does

- **Shield.** ETH from any wallet into a private balance: your own, or anyone's from their `tacit1…` or `bp1…`
  address alone. The second needs no Tacit key: the page proves the deposit with a throwaway key, so a payer with only
  a wallet can pay a payment link. Or shield from an exchange: a standing deposit address, the same on every chain,
  that the relay moves into the private balance for at most 0.25%, or that you take in yourself at no fee.
  The standing deposit address is the same on every chain. For each person who will pay by plain transfer, *one-time
  addresses* give a separate deposit address that works on every chain, with nothing on chain tying two of them together.
  ETH sent to any of them waits there until it is taken in, by the relay or by the wallet at no fee. Because what waits
  is plain ETH with no event of its own, the page reads every address the key could have issued (those up to the last one
  used, and a gap past it) when a key is opened and every few minutes, and says on the balance when something waits: a
  browser that issued nothing finds it from the key alone. A key issues only as many addresses as it can find again.
- **Send** privately to a `tacit1…`, `bp1…` or name, or pay an `0x` address out of the pool.
- **Combine.** A balance held in more than two parts cannot all be spent at once (a spend takes two). The balance says so
  and one press combines them into one, through the relay or the wallet, with the steps and the fee shown first; spends
  that need a few parts combined do it by themselves.
- **Withdraw** any part to an address or to a name: a `.wei`, `.gwei` or `.eth` name is read to the Ethereum address it points
  to (its address record, not its Tacit one), shown in full beside the name, and read again just before the withdrawal, which
  is not sent if the name has moved. A withdrawal that arrives as a token takes its amount in ETH or in the token: in the
  token it is the least that arrives, and the page finds the ETH whose route pays at least that, shows it, and holds the
  swap to that minimum; what the route buys above it arrives too.
- **Receive.** The unified `tacit1…` address, and payment links that carry it or a `.wei`, `.gwei` or `.eth` name, on any chain
  (next section), with a QR code, that anyone with a wallet can pay.
- **Activity**, rebuilt from the key and the chain: what came in, what went out, with fees.

Every spend goes through a relay (no gas, and no account of yours on chain) or from your own wallet, chosen per
action; when a relay does not answer, the page offers the wallet.

## Payment links and names

A link is the page's address plus a fragment:

```
#pay=<tacit1…, bp1… or a name>&n=<deposit key>&ns=<signature>&amount=<eth>&chain=<ethereum|base|robinhood>&chains=<a,b>&for=<note>
```

`n`, `ns`, `amount`, `chain`, `chains` and `for` are optional; `#name.wei` or `#tacit1…` alone also opens a request. The
chain can be a name, `chain=base`, or a number, `chain=8453`, or the bare word, `#base`. A tab opens by its name beside the
rest, `#send&chain=base`, `#withdraw`, `#receive`, `#deposit` (the Shield tab) or `tab=send`. These are the links the main
site's pay page makes and reads, so a link from one works on the other. A gift link (`#gift=`) or a payment-proof link
(`#proof=`) belongs to the main site: the page says so and offers to open it there. Everything is in the part after `#`, which
a browser never sends to a server, so the gateway does not learn whom a payer is about to pay; the page reads no path or query.
A note is one line of at most 60 characters with control and invisible formatting characters removed. The payer sees
a request card: who is being paid (a name beside the address it resolved to), the amount and note, a chain picker
that shows what the payer's wallet holds on each chain, and one button. A payer needs only a wallet, and has two ways to pay.
When the link carries a deposit address (`n` and `ns`) the default is a plain transfer from the wallet to it: nothing
to prove or download, and the same address works on every chain. When it does not, or the payer prefers no fee, the
page proves a deposit in their browser and the wallet sends it straight into the payee's private balance. Either way
the wallet is moved to the chain chosen first (and the chain added when the wallet has never seen it). Their address and the
amount show on chain; whom they paid does not. The link stays in the address bar until it is dismissed or paid, so a
reload, or a wallet app handing the page back, keeps the request. A payer who holds a Tacit key can pay from their
private balance instead, and `chains=` offers the payer only some chains.

**A link that asks for a token** names where it arrives, the token and one chain:

```
#pay=<0x… or a name>&token=<the token's address>&amount=<in the token>&chain=<ethereum|base|robinhood>&for=<note>
```

`amount` and `for` are optional. It is paid from the payer's private balance: Withdraw opens set to the token, the
address and the amount, as the least that arrives, and the route, its minimum and the fee show before anything is sent.
Nothing on chain ties the payment to the payer; the address and the amount show on chain, as any token payment does.
The page reads the token from its own contract on that chain (its decimals, symbol and name) and from the token list;
the link gives only its address, shown in full. A token the list does not hold is paid only once the payer confirms it
is the one they were asked for (one added by address before needs no second confirmation). A name is read to the address
it points to on that chain and read again before the payment. Such a link is read whole or not at all: another field, a
field given twice, a token not given as an address, no chain, a Tacit address, or an amount the token cannot hold (past
its decimals, nothing, or in another form) refuses it with a plain sentence, so nothing in it is dropped to pay something
else. *Receive* makes one when a token is chosen under "Get paid in": it uses no deposit address.

**The deposit address in a link.** A link made by *Receive* carries a deposit address of its own, one nobody else has
been given and kept until it is paid. `n` is the key it derives from and `ns` is the payee's signature over it, made
with the key's view key. The payer's page takes the address only when the signature verifies against the key of the name
or address being paid, and when the pool's router on that chain agrees the address belongs to `n`; otherwise it ignores
the address, says so, and pays by proving. So a link cannot point a payment anywhere the payee did not sign, even when
it is edited in transit. What arrives waits at the address until the relay moves it in (up to 0.25%, and only above the
relay's minimum for that chain) or the payee takes it in at no fee. The payee's page, or any page opened with the same
key, finds it from the key alone.

**Amounts and IDs.** An amount reads a decimal comma as a point, a thousands comma as nothing, and refuses a lone comma
before three digits (`1,500`) instead of guessing, the same as tacit.finance's pay pages. Every address shows a short
ID, the same text on every page for the same address, so a payer can compare what they were given with what the payee
sees under their own address.

**Names.** A name is a payee when it has published a Tacit address as its `finance.tacit` text record (the key every
Tacit app reads, in the same format the main site's pay page and wallet read): `.wei` and `.gwei` through their registry's
`text(bytes32,string)`, `.eth` through the name's resolver in the ENS registry, or its nearest parent's resolver for a subname,
asked through its wildcard entry point; a name whose records are off-chain is refused with a reason, as is `.base.eth`. The
record is a `tacit1…` address that carries the pool lane (a record with only that lane works); a record from before pool
payments has none and is refused with a reason. What a name says decides where money goes, so the page asks every Ethereum node it knows at once and takes an answer when two agree (one,
when the reader has set a single node), shows the address it got beside the name, and reads the name again just before
anything is paid: a name that moved in between is not paid. Names are ASCII (`a–z`, `0–9`, hyphens, dots). `Send` and `Shield`
take names in their recipient fields too.

**Receiving.** *Receive* builds the link: an optional name, amount, note, and the chains offered (any, or one). The
name is checked against the open key: the link uses it only when the name's record is this key's address, and
otherwise says what is wrong. The page publishes the record itself, one transaction on Ethereum from the wallet that owns
the name (the page simulates it first): to the registry for `.wei` and `.gwei`, to the name's own resolver for `.eth`. Money paid
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
saved state is sealed under the view key, the relay's event index is checked against the pool (a root the pool never held, or a tree short of its leaf count, sends the
page to the chain's own logs, and an index that did that is not asked again that session), the unconfirmed tail counts only when
the pool has held its root at that size, the head a read goes up to is the lower of two nodes' answers, and no nullifier is ever
sent to ask whether it is spent. An index that leaves a memo out cannot hide a note from *Rebuild*, which reads the chain's logs alone. (A proof's public values do go to a node once,
in the check against the pool's verifier just before a spend the wallet sends; a relayed proof is not checked by the page.)

**Added here:** shielding from a token (swapped for an exact amount of ETH through zRouter, in one transaction through
the zap or to a deposit address the relay takes in), withdrawals that arrive as a token (an amount in ETH, or in the token
as the least that arrives), payment links that ask for a token, paid from a private balance, private swaps (a token in and
another out later, with the pool between, followed on a card), and moving a balance from Ethereum to Base or Robinhood
Chain through their own bridges.

**Left out:** passkey and Bitcoin-wallet sign-in (a passkey is bound to the origin that made it, and the Bitcoin path
needs the main app), payment links that carry the money (`#gift=`, handed to the main site), payments held until
they blend in, the privacy check, saved recipients, TAC points, payment proofs (`#proof=`, handed to the main site) and CSV export. Each has a home on tacit.finance; none is
needed to pay or be paid.

**Rebuilt so nothing is fetched to run:**

- *The prover.* tacit.finance proves with snarkjs, which is GPL-3.0 and could not be bundled into an MIT page. This
  page carries its own Groth16 prover for the pool's circuit (BN254): Pippenger multi-exponentiation for G1 and G2, an
  FFT over the circuit's domain on its odd coset, and the zkey read as it is stored. Its field arithmetic is
  WebAssembly that the page writes itself from a short generator (Montgomery multiplication over eight 32-bit limbs,
  the representation the proving key stores), so there is no binary blob in the document. The work is shared across
  up to six workers started from the document's own `<script type="text/x-prover">`. A proof takes about 7 s on a
  laptop. A proof the wallet sends is checked against the pool's verifier by `eth_call` through the wallet's node before it is sent;
  one the relay sends is checked by the relay.
- *Poseidon.* Its round constants and MDS matrices are generated in the page by the Grain LFSR, as the Poseidon
  reference does, instead of being stored (about 80 KB of tables).
- *SHA-256, HMAC, Keccak-256, secp256k1, BabyJubJub, bech32m, ABI encoding, the QR code:* written out in the page.
  SHA-256's and Keccak's constants are computed from their definitions.
- *Fonts:* system stacks in place of the hosted ones.

The circuit's proving key (28.5 MB) and witness program (4.9 MB) are the one dependency too large for any contract.
The page fetches them once, from tacit.finance or the ceremony bundle on IPFS
(`bafybeia4yvn2zoggvgpjwg5vpwpt6aivjbcm6tgzxoxsukao2nm5yyypfy`, via Filebase, ipfs.orbitor.dev or the Pinata gateway, or as a last resort its onchain copy on Base Sepolia), uses them only if
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

**Reads are batched.** A chain's head is one Multicall3 call that returns the pool's leaf count, what waits at every
deposit address being watched and the ETH the pool itself holds (shown beside the balance; with no key open there is
nothing to batch it with, so it is one `eth_getBalance`, kept for half a minute), followed by the node's own block number (a contract's `block.number` is the other
layer's on some chains, so it is not used for the tip). Nothing further is read while the chain has not moved. Reads for
the activity (receipts, block times) go out as one JSON-RPC batch per chain, and block times are kept; a node that will
not take a batch is asked one read at a time, and a node that cannot run Multicall3 gets the same reads one by one. Signing in
costs about 30 requests across the three chains, and an idle chain two per read. A tree is accepted only when the nodes
agree that the pool has held its root at that size, a chain that fails to read is asked again at a slowing pace, and the
head a read goes up to is the lower of two nodes' answers.

**What the page keeps.** Besides the wallet's sealed state, a key's last balances, the block times of its activity, the
one-time addresses it issued, the name it uses, the private swaps it started and the tokens added by address are sealed
under the same view key: storage shows ciphertext only. The chain last chosen and the wallet last connected are kept as
they are. The
page asks the Ethereum nodes to agree before it shows which contract serves it and whether a newer version exists.

| it depends on | for | when it is down |
| --- | --- | --- |
| public JSON-RPC nodes, 2 to 4 per chain (replaceable under *Endpoints*) | every read and send, and names | the next node is tried; the page remembers the one that answered |
| a wallet (EIP-1193, EIP-6963) | gas for wallet-sent spends and shielding | relayed spends and reading need none |
| the proving key and witness program, 33 MB, from tacit.finance, Filebase, ipfs.orbitor.dev or the Pinata gateway, from its onchain copy on Base Sepolia, or from disk | the first payment on a device | any mirror will do, each file is accepted only by its pinned SHA-256; or load both from disk |
| a relay (optional) | spends with no gas, deposit-address sweeps, a fast first read | the wallet route and chain logs |
| a gateway to serve the page | getting the page | any ERC-8244 gateway, or `html()` from any node |

There are no other scripts, fonts, images or stylesheets: the document pins its one module by hash. The proving key is
the one dependency that is not a chain read. Rebuilding a wallet from chain logs alone leans on nodes that serve old
logs: on Ethereum and Base, one public node each does (Tenderly's), plus Base's own with 500-block ranges (Tenderly's Base node allows 1,000), and
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
- **Swaps:** zQuoter (`0x000000bd2db80567c23e353ca95a251c573cbf9b`) finds routes and zRouter
  (`0x000000000000FB114709235f1ccBFfb925F600e4`) runs them, for shielding from a token and withdrawing as one; the zap
  (TacitEvmPoolZap, `0x0000008EbBF2323f95c4fBc18254f3D65C53998c`) shields from a token in one transaction; Permit2 takes a
  signature approval for a token that has no permit of its own; the onchain token list (`0x0000006013dF75A31678B786061C2B54bf531524`)
  names the tokens offered. Routes are asked of the page's nodes with a stand-in address in place of the reader's; the
  estimates (Max on a token, what a private swap's ETH would buy now) are asked of the reader's wallet, whose node
  already sees its payments.
- **Bridges:** Base's L1StandardBridge and Robinhood Chain's inbox, for moving a balance there from Ethereum.

The document pins its one module by hash in its Content-Security-Policy and allows connections only over HTTPS (and
to `127.0.0.1` and `localhost`, for a reader's own node). A gateway that injects script, like w3link, is refused by
that policy. The Tacit key is derived in the tab from the wallet's signature over the fixed identity message every
Tacit app asks for (the same account opens the same key everywhere), is never stored, and never leaves the tab.

**More nodes, from an onchain registry.** At load the page reads two curated lists on Ethereum, `zRpcList`
(`0x8C7348D039f58C4e9cfA936EF410eec759213b12`, `rpcs()`) and `zEndpoints` (`0x00000051F365d898132f4ebF345Cd3968e02F288`,
`listsOf` for `rpc` on Base and Robinhood Chain and `logs` on Ethereum), through its own fixed nodes with two agreeing,
keeps the https entries for six hours, and uses them only after its own nodes, and only for ordinary reads: names and the
pool's root checks go through the page's own nodes alone, so two listed nodes agreeing with each other cannot decide where
money goes. A reader who sets their own nodes under Endpoints uses those alone.

## Build

Everything below is run from this directory. `forge` comes from Foundry; the browser tests need `npm i` at the repo
root and a Chromium for playwright-core (`npx playwright-core install chromium`). The browser tests load the deployed page,
`dapp/page.min.html`; `PAGE=dapp/page.html` runs them against the source.

```
node ../scripts/chunk.mjs tacit-pay            # out/TacitPay8244.chunk1..N.creation.txt
forge test --match-path test/TacitPay8244.t.sol
node test/dapp/tacit-pay.strip.mjs             # the deployed page against its source: the same style rules, elements, text and pixels
node test/dapp/tacit-pay.page.mjs              # the page alone: vectors, sign-in, links, names, endpoints, no network
node test/dapp/tacit-pay.units.mjs             # amount parsing, an address's ID, how a failed log read is judged
node test/dapp/tacit-pay.sig.mjs               # the page's signatures against an independent implementation
node test/dapp/tacit-pay.engine.mjs            # the wallet engine on a chain in memory: merges, lagging nodes, an index that lies, batched reads
node test/dapp/tacit-pay.artifacts.mjs         # the proving key and witness program: a file that is not the pinned one is never used
node test/dapp/tacit-pay.unconfirmed.mjs       # a wallet payment the network never confirms is not sent a second time
node test/dapp/tacit-pay.scan.mjs              # a long pool history (N=600 deposits) read in workers made from the page's own code
node test/dapp/tacit-pay.ens.mjs               # a .eth name's text record, set on a fork of the real registry, read, shown and linked
node test/dapp/tacit-pay.wallets.mjs           # external wallets: picker, refusals, account and chain changes, no network
node test/dapp/tacit-pay.fork.mjs              # every flow on anvil forks of all three chains, proofs made in the page
node test/dapp/tacit-pay.links.mjs             # a real .wei name, a link, a payer paying it on every chain, recovery by key
node test/dapp/tacit-pay.relay.mjs             # a faithful relay, then relays that lie, stall, overcharge or leave events out
node test/dapp/tacit-pay.index.mjs             # an event index that says "no events" is caught against the pool
node test/dapp/tacit-pay.boxes.mjs             # one-time deposit addresses: issued, funded as by an exchange, found from the key, taken in
node test/dapp/tacit-pay.privateswap.mjs       # a private swap: USDC in, a token added by address out, through the card; what is remembered; a lost plan
node test/dapp/tacit-pay.ux.mjs                # how the page answers as it is used, chains in memory: forms, held payments, copies, Rebuild
node test/dapp/tacit-pay.shieldtoken.mjs       # shielding from a token on a fork: MODE=permit|permit2|batch|approve|relay|relaybatch|box|weth; Max
node test/dapp/tacit-pay.swapfork.mjs          # a withdrawal that arrives as a token, on a fork with the real router, zQuoter and zRouter; an amount in the token; a link that asks for one
node test/dapp/tacit-pay.routes.mjs            # every route a token withdrawal can take, on every chain, run as the escrow runs it
node test/dapp/tacit-pay.move.mjs              # a move to a rollup as the page encodes it, against the live router (one read-only call)
node test/dapp/tacit-pay.movefork.mjs          # a move to Base on forks: the bridge deposit, then the relay takes it in on Base
node test/dapp/tacit-pay.movefork-rh.mjs       # a move to Robinhood Chain on forks: the retryable ticket, then taken in there
node test/dapp/tacit-pay.moveretry.mjs         # a refused move tried again near its deadline: built afresh, lands once
KEEPER=… node test/dapp/tacit-pay.keeper.mjs   # the real relay server, from the repo's worker-relay, on a fork
node test/dapp/tacit-pay.chains.mjs            # read-only: every node and relay the page ships, asked what the page asks
node test/dapp/tacit-pay.live.mjs              # read-only against mainnet: nodes, relays, routers, the proving key
node ../scripts/serve.mjs tacit-pay            # localhost, real wallet, real chains
node ../scripts/verify.mjs tacit-pay           # once deployed: chunks, html() and every route
```

The fork test runs its proofs in the page against the deployed pool's verifier, so a passing run means the page's
prover, witness builder and transaction encoding are the ones the pool accepts.

`deploy/DEVICE-PROOFS.md` records the proofs checked two independent ways (the deployed verifier and snarkjs) for every
flow on all three chains and in WebKit, the tampered proofs refused, the proving times measured, and what was not shown.

## Deploying

From `tacit-pay/`, after any edit to `dapp/page.html`: `sh deploy/repin.sh` (pins the prover block's hash in the module and the
module's hash in the CSP, builds the deployed page `dapp/page.min.html` from the source and pins it the same way, puts its size
and hash in `manifest.json` and in the forge test, and re-chunks), then `forge build`, then
`forge test --match-path test/TacitPay8244.t.sol`.
Never run `forge build --force` or `forge clean` between `repin.sh` and the deploy: they delete `out/`, where the chunk
creation code and forge's artifact live.

1. **Check the price.** `cast base-fee latest --rpc-url <rpc>`. The deploy is one transaction per chunk plus the wrapper, about
   225 gas per page byte plus 1.6M in all (the 337,957-byte page: about 78M gas, 0.078 ETH at 1 gwei, 0.0078 ETH at 0.1 gwei).
   Any funded account can deploy; the steward is set by the constructor. Set the wallet's priority fee low.
2. **Deploy.** Build the address miner once, `cargo build --release --offline --manifest-path deploy/vanity/Cargo.toml`, then
   `node deploy/deploy-helper.mjs 8444`, open http://127.0.0.1:8444, connect a wallet on Ethereum mainnet and press
   *Deploy what is left*. The wrapper goes through CreateX's CREATE3 (`0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`) with a
   salt mined for the connected account, so its address starts with three zero bytes (about six seconds of mining on a
   laptop). The salt begins with that account's address and has `00` as its 21st byte, so CreateX lets no one else claim it
   and mixes in no chain id; the address is shown before anything is sent and CreateX itself is asked to confirm it. It confirms the page it serves is the one `manifest.json` pins, checks each chunk's runtime as it
   lands, estimates the wrapper before sending it (which succeeds only if the chunks reassemble to the page), and prints the
   `deployment` block for the manifest. A closed tab resumes: what the browser remembers is checked against the chain on every
   connect. A transaction the wallet replaces or speeds up is found where it lands, not sent twice. It stops, sending nothing
   more, if the wallet leaves mainnet. Do not use a profile that ran an earlier rehearsal without pressing *Forget progress*.
3. **Check it, from anywhere.** `node deploy/check-deployment.mjs <rpc> <wrapper> dapp/page.min.html` reads every chunk's code and
   `html()` and `PAGE_HASH()` back from the chain and compares them with the page, byte for byte. Then
   `ETH_RPC_URL=<rpc> node ../scripts/verify.mjs tacit-pay` after adding the `deployment` block to `manifest.json`.
   To read the page back by hand (`cast` prints the string JSON-quoted, so unquote it):
   `cast call <addr> "html()(string)" --rpc-url <rpc> | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")))' > tacit-pay.html`.
4. **Verify the source.** `forge verify-contract <wrapper> src/TacitPay8244.sol:TacitPay8244 --chain mainnet --compiler-version v0.8.30+commit.73712a01 --num-of-optimizations 200 --evm-version prague --constructor-args $(cast abi-encode "constructor(address,address,address[],bytes32)" <steward> 0x0000000000000000000000000000000000000000 "[<chunks>]" <keccak256(page)>) --watch`
   (add `--verifier sourcify` for Sourcify). The chunks are raw runtime bytes and cannot be verified as source; step 3 is how a
   third party checks them.
5. **Point the name.** From the key that owns `anon.wei` call WNS `0x0000000000696760e15f265e828db644a0c242eb`
   `setAddr(uint256,address)` with token id `0x496f2068cee72c1437cff59955a4fe732a44d78027e784fb39dc42aa33428b34` (the name's
   namehash) and the wrapper's address. Check `resolve(uint256)` returns the wrapper, `curl -sI https://anon.wei.limo/`, and
   that the body's sha256 equals the page's. The name runs to 2027-09-30; `renew` is 0.01 ETH a year.

Browse at `https://<addr>.w4eth.io/` (ERC-8244) or `https://<addr>.1.w3link.io/` (ERC-4804, which the page's
policy keeps from running its injected script), and at `https://anon.wei.limo/`. The wrapper answers every `request()` with
`Cache-Control: public, max-age=300`: a name can be pointed at a successor, so the page is cached for minutes, not a year.

**Releasing a new version.** Edit the page, `sh deploy/repin.sh`, `forge build`, then `node deploy/deploy-next-helper.mjs 8799`
and open http://127.0.0.1:8799 with the steward's wallet: it finds the live tip through `latest()`, deploys only the chunks
whose bytes changed (an unchanged chunk is reused at its address, checked against mainnet), and calls
`<tip>.deployNext(initcode, salt)` with the wrapper's creation code (`previous` the tip, the same steward, the new page hash)
and a gas limit of 2,000,000 (generation 2's used 1,718,451). Run step 3 against the new wrapper, then `setAddr` to it. To
verify a successor's source (step 4), its second constructor argument is the previous version's address, not zero.
To go back, `setAddr` to the old one: every version serves its own bytes forever. Only the newest version can append.

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
