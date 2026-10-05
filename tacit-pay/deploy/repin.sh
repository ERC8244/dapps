#!/bin/sh
# After editing dapp/page.html (the readable source): pin its prover block and module in it, build the deployed page
# (dapp/page.min.html: the same code with its comments and spacing taken out, by scripts/strip.mjs) and pin that the same
# way, then put the deployed page's size and hash in the manifest and the contract test, and rechunk it.
set -e
cd "$(dirname "$0")/.."
pin() { python3 - "$1" <<'PY'
import re, sys, hashlib, base64
P = sys.argv[1]
t = open(P, encoding='utf8').read()
# The workers' code is the prover block; the module checks it against a hash kept inside the module, which the CSP pins.
prover = re.search(r'<script type="text/x-prover" id="prover"[^>]*>([\s\S]*?)</script>', t).group(1)
t, n = re.subn(r"(const PROVER_SHA256 ?= ?')[0-9a-f]{64}'", lambda m: m.group(1) + hashlib.sha256(prover.encode()).hexdigest() + "'", t, count=1)
assert n == 1, 'no PROVER_SHA256 in ' + P
mod = re.search(r'<script type="module">([\s\S]*?)</script>', t).group(1)
h = 'sha256-' + base64.b64encode(hashlib.sha256(mod.encode()).digest()).decode()
t, n = re.subn(r"script-src 'sha256-[^']+'", "script-src '" + h + "'", t, count=1)
assert n == 1, 'no script-src hash in ' + P
open(P, 'w', encoding='utf8').write(t)
PY
}
pin dapp/page.html
node ../scripts/strip.mjs tacit-pay
pin dapp/page.min.html
B=$(wc -c < dapp/page.min.html | tr -d ' '); H=$(shasum -a 256 dapp/page.min.html | cut -d' ' -f1)
sed -i '' -E "s/\"bytes\": [0-9]+,/\"bytes\": $B,/; s/\"sha256\": \"[0-9a-f]{64}\"/\"sha256\": \"$H\"/" manifest.json
sed -i '' -E "s/PAGE_BYTES = [0-9]+;/PAGE_BYTES = $B;/" test/TacitPay8244.t.sol
rm -f out/TacitPay8244.chunk*.creation.txt          # a page that needs fewer chunks must not leave an old one behind
node ../scripts/chunk.mjs tacit-pay | tail -2
echo "$B bytes, sha256 $H"
