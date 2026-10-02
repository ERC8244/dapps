# What the page's prover has been shown to do

Every spend from this page is a Groth16 proof (BN254, the pool's `transact` circuit, the ceremony's proving key pinned
by SHA-256) made in the reader's browser by the page's own prover: WebAssembly field arithmetic the page writes itself,
and multi-exponentiations split across Web Workers. Before anything is sent, the page asks the pool's own verifier
contract whether the proof checks out, and sends nothing if it does not. This file records what was run to show the prover is
right, how fast it is, and what was not shown.

## Proofs verified two independent ways

Each flow below was run in the real page against anvil forks of the real pools, with the page's own prover. The proof
and public inputs were taken from the transaction the page sent and checked twice: by the deployed verifier
(`0x000000b1c0e84CEc8AdF8278B90c4d6400DfB153`, by `eth_call`) and by an independent implementation, snarkjs 0.7.6,
against the ceremony's verifying key. Every one was valid both ways and the transaction was mined.

| flow | Base | Ethereum | Robinhood Chain | WebKit, on Ethereum |
|---|---|---|---|---|
| shield from the wallet into one's own balance | ✔ | ✔ | ✔ | ✔ |
| private send | ✔ | ✔ | ✔ | ✔ |
| withdraw to an address | ✔ | ✔ | ✔ | ✔ |
| shield into someone else's balance | ✔ | ✔ | ✔ | ✔ |
| pay a link with no Tacit key (a throwaway key proves the deposit) | ✔ | ✔ | ✔ | ✔ |
| take in the standing deposit address (`sweepReceive`) | ✔ | ✔ | ✔ | ✔ |
| take in a one-time deposit address | ✔ | ✔ | ✔ | ✔ |
| merge two notes, then send | ✔ | | | |
| relayed send and withdraw (a relay's fee in the proof) | | ✔ | | |

Those runs were made on the audited build of the page. All 32 proofs recorded in the four column runs were checked a second
time, separately, with snarkjs and the ceremony's verifying key: all valid, and each failed with one public input changed by one.

**Negative controls.** For one proof of each kind: every public input +1, a public input out of the field, pA and pC
moved on and off the curve, negated, pB changed and pB with its halves swapped. 72 of 72 tampered proofs per run were
refused by both verifiers. A proof or public input corrupted between the worker and the page (an intercepted worker
message) is refused by the page with "The proof did not check out against the pool's verifier, so nothing was sent":
no wallet request, no relay call, no nonce used, no block. The same page then sent a good proof without a reload.

**Engines.** Chromium (V8) and WebKit (the Safari 26.6 engine, run through Playwright) both produced valid proofs for every
flow. The prover's core, unmodified, also ran single-threaded in the macOS JavaScriptCore shell; its proof of a real
send verified with snarkjs and with the deployed verifier on all three chains, and the page's own hashes, Poseidon and
key derivation gave identical results in JavaScriptCore and V8.

**After the prover was tuned for this release** (a smaller multi-exponentiation window, and each worker's share sized
by its measured speed), every flow in the repository's fork tests was proved again and accepted by the deployed
verifier: shield, send, withdraw, merges, take-ins, links on all three chains, the real relay server, and a relay
that misbehaves (`test/dapp/tacit-pay.fork.mjs`, `.links.mjs`, `.boxes.mjs`, `.relay.mjs`, `.keeper.mjs`).

The release build (`dapp/page.html`, sha256 `1b3495233c3380ee…`; its prover block is byte for byte the one captured here, pinned by the page as `a68b9f8d…`) was captured again on Base: shield into one's own balance, private
send, withdraw, shield into someone else's balance, a link paid with no key, and both kinds of take-in. All seven proofs were
valid by the deployed verifier and by snarkjs (checked twice, separately) and every transaction was mined; 72 of 72 tampered
variants were refused by both verifiers.

## Speed

Proof time is from the witness to the finished proof, measured in the page on an M2 MacBook Air (4 performance and 4
efficiency cores, 8 GB) that was shared with other work, so absolute numbers are noisy.

| profile | workers | audited build | this release |
|---|---|---|---|
| this machine, every core offered | 6 | 4.6 s (4.4–5.8), quiet | 4.3 s (3.2–4.4), under load |
| 4 cores offered | 3 | 5.7 s | 5.7 s (5.0–6.3) |
| 1 or 2 cores offered | 1 | 12–13 s | 11.2 s (11.1–11.3) |
| two of six workers made 4× slower | 6 | 15.0 s | about 6.3 s, measured on the same change |
| efficiency cores only, 4 offered | 3 | 17.7 s | 14.4 s, measured on the same change |
| WebKit, every core offered | 6 | 12.7 s (10.7–14.7) | not measured again |

The audited build's times and the last two rows of this release come from a separate review run; this release's first
three rows were measured afterwards on the same machine while other work was running, so they lean slow.

What a reader should expect: a laptop or desktop proves in a few seconds. On a phone, the slowest core used to set the
pace, because every worker got an equal share; this release times each worker before splitting the key and gives
faster ones more, which brought a run with two of six workers four times slower from 15 s to about 6 s. Phone figures
are a model, not a measurement (see below). The first proof also downloads the 33 MB proving key once; it is kept in the
browser after that.

Memory: about 245 MB with the key loaded and 260 to 320 MB at the peak of a proof, flat over repeated proofs (no growth
across seven proofs). The page stays responsive while proving: the work runs in workers.

## What the page does when proving goes wrong

- A worker that stops without an error (a browser can do that when memory runs short) can no longer leave the page
  waiting: past a deadline well beyond the device's last proof, the workers are replaced and the button works again.
- While the key downloads, the busy line says so, with its progress, instead of counting it as proving time.
- A browser with no Web Workers or WebAssembly is told so before anything is downloaded.
- A worker that runs out of memory is reported in plain words, and the next press starts fresh workers.
- A mirror that serves a wrong or corrupt file is refused by its SHA-256 and the next mirror is used; one that creeps
  along at under 10 KB/s for half a minute is left for the next (never the last); with every mirror down, the error
  offers to load the two files from disk, which works on the same page.

## What was not shown

- No real phone was used, and no real iOS Safari or Chrome on Android. Emulated phone profiles slow only the main
  thread, not Web Workers, so they say nothing about proving speed; the phone figures above come from efficiency-core
  runs, slowed workers and a model. A phone's memory ceiling, thermal throttling and iOS background suspension were not
  tested.
- A proof running in a background tab was not shown to finish on every browser.
- Mirrors other than tacit.finance and Filebase (which served the exact pinned files) were simulated; real slow
  mobile networks were not used.
- The page was not yet served from its onchain contract when these runs were made.

## Reproducing

The repository's fork tests make real proofs in the page and send them to the real pools on anvil forks, so a passing
run means the deployed verifier accepted every proof:

```
ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.fork.mjs
node test/dapp/tacit-pay.links.mjs
node test/dapp/tacit-pay.boxes.mjs
FAST=1 node test/dapp/tacit-pay.relay.mjs
```

The second, independent check with snarkjs was run outside this repository (snarkjs is GPL-3.0, and nothing here ships
or depends on it): take `pA, pB, pC, publicInputs` from a page-sent `transact` call, swap the halves of each pB pair back,
and run `snarkjs.groth16.verify` with the ceremony's `transact_vk.json`.
