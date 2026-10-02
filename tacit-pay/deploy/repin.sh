#!/bin/sh
# After editing dapp/page.html: pin the module's hash in its CSP, then the page in the manifest and the contract test, and rechunk.
set -e
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re, hashlib, base64
P = 'dapp/page.html'
t = open(P, encoding='utf8').read()
# The workers' code is the prover block; the module checks it against a hash kept inside the module, which the CSP pins.
prover = re.search(r'<script type="text/x-prover" id="prover">([\s\S]*?)</script>', t).group(1)
t = re.sub(r"const PROVER_SHA256 = '[0-9a-f]{64}';", "const PROVER_SHA256 = '" + hashlib.sha256(prover.encode()).hexdigest() + "';", t, count=1)
mod = re.search(r'<script type="module">([\s\S]*?)</script>', t).group(1)
h = 'sha256-' + base64.b64encode(hashlib.sha256(mod.encode()).digest()).decode()
t = re.sub(r"script-src 'sha256-[^']+'", "script-src '" + h + "'", t, count=1)
open(P, 'w', encoding='utf8').write(t)
PY
B=$(wc -c < dapp/page.html | tr -d ' '); H=$(shasum -a 256 dapp/page.html | cut -d' ' -f1)
sed -i '' -E "s/\"bytes\": [0-9]+,/\"bytes\": $B,/; s/\"sha256\": \"[0-9a-f]{64}\"/\"sha256\": \"$H\"/" manifest.json
sed -i '' -E "s/PAGE_BYTES = [0-9]+;/PAGE_BYTES = $B;/" test/TacitPay8244.t.sol
rm -f out/TacitPay8244.chunk*.creation.txt          # a page that needs fewer chunks must not leave an old one behind
node ../scripts/chunk.mjs tacit-pay | tail -2
echo "$B bytes, sha256 $H"
