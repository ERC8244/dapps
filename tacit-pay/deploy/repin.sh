#!/bin/sh
# After editing dapp/page.html (the readable source): pin its prover block and module in it, build the deployed page
# (dapp/page.min.html: the same code minified, by scripts/strip.mjs) and pin that the same way, then put the deployed
# page's size and hash in the manifest and the contract test, and rechunk it.
set -e
cd "$(dirname "$0")/.."
pin() { python3 - "$1" "${2:-$1}" <<'PY'
import re, sys, hashlib, base64
P, SRC = sys.argv[1], sys.argv[2]
t = open(P, encoding='utf8').read()
# Each pin is found by its value in the source (`SRC`, the page itself unless named): minified, its name is not kept.
def put(name, digest):
    global t
    old = re.search(r"const " + name + r" ?= ?'([0-9a-f]{64})'", open(SRC, encoding='utf8').read())
    assert old and t.count(old.group(1)) == 1, 'no single ' + name + ' in ' + P
    t = t.replace(old.group(1), digest)
# The workers' code is the prover block; the module checks it against a hash kept inside the module, which the CSP pins.
prover = re.search(r'<script type="text/x-prover" id="prover"[^>]*>([\s\S]*?)</script>', t).group(1)
put('PROVER_SHA256', hashlib.sha256(prover.encode()).hexdigest())
mod = re.search(r'<script type="module">([\s\S]*?)</script>', t).group(1)
# The scan workers run the module's first part (through H's definition) as read back from the document: pinned by its hash.
end = re.search(r'\bH ?= ?\(?(\w+)\)? ?=> ?poseidon\(\1\);?', mod)
assert end, 'no scan part in ' + P
put('SCAN_SHA256', hashlib.sha256(mod[:end.end()].encode()).hexdigest())
mod = re.search(r'<script type="module">([\s\S]*?)</script>', t).group(1)
h = 'sha256-' + base64.b64encode(hashlib.sha256(mod.encode()).digest()).decode()
t, n = re.subn(r"script-src 'sha256-[^']+'", "script-src '" + h + "'", t, count=1)
assert n == 1, 'no script-src hash in ' + P
open(P, 'w', encoding='utf8').write(t)
PY
}
pin dapp/page.html
node ../scripts/strip.mjs tacit-pay
pin dapp/page.min.html dapp/page.html
B=$(wc -c < dapp/page.min.html | tr -d ' '); H=$(shasum -a 256 dapp/page.min.html | cut -d' ' -f1)
sed -i '' -E "s/\"bytes\": [0-9]+,/\"bytes\": $B,/; s/\"sha256\": \"[0-9a-f]{64}\"/\"sha256\": \"$H\"/" manifest.json
sed -i '' -E "s/PAGE_BYTES = [0-9]+;/PAGE_BYTES = $B;/" test/TacitPay8244.t.sol
grep -q "\"bytes\": $B," manifest.json && grep -q "\"sha256\": \"$H\"" manifest.json && grep -q "PAGE_BYTES = $B;" test/TacitPay8244.t.sol || { echo 'manifest.json or the contract test did not take the new size and hash' >&2; exit 1; }
rm -f out/TacitPay8244.chunk*.creation.txt          # a page that needs fewer chunks must not leave an old one behind
out=$(node ../scripts/chunk.mjs tacit-pay) || { echo "$out"; exit 1; }
echo "$out" | tail -2
echo "$B bytes, sha256 $H"
# The built page carries its own CSP hash and the two pins: a hand edit, or a build without the pin step above, is caught here.
node -e 'const fs=require("fs"),c=require("crypto"),h=fs.readFileSync("dapp/page.min.html","utf8"),s=x=>c.createHash("sha256").update(x).digest("hex"),
m=/<script type="module">([\s\S]*?)<\/script>/.exec(h)[1],p=/<script type="text\/x-prover" id="prover"[^>]*>([\s\S]*?)<\/script>/.exec(h)[1],
e=/\bH ?= ?\(?(\w+)\)? ?=> ?poseidon\(\1\);?/.exec(m);
if(!h.includes("script-src \x27sha256-"+c.createHash("sha256").update(m).digest("base64")+"\x27")||!m.includes(s(p))||!m.includes(s(m.slice(0,e.index+e[0].length))))process.exit(1)' || { echo 'the built page does not match its CSP hash or its pins' >&2; exit 1; }
