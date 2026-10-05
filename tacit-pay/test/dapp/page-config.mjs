// The chains, contracts and relay limits exactly as dapp/page.html ships them, read out of the page itself so a test
// checks what is deployed rather than a copy of it. The browser tests load `html`: the deployed page (the manifest's
// `page`, built from dapp/page.html by deploy/repin.sh with the same code and its comments and spacing taken out), or
// the file PAGE names (PAGE=dapp/page.html runs them against the source).
import fs from 'node:fs';
import vm from 'node:vm';

export const text = fs.readFileSync(new URL('../../dapp/page.html', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
export const html = fs.readFileSync(process.env.PAGE || new URL(`../../${manifest.page}`, import.meta.url));
export const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(text)[1];
export const cut = (from, to) => {
  const a = mod.indexOf(from), b = mod.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('page layout changed: ' + from);
  return mod.slice(a, b);
};
export const config = vm.runInNewContext(`${cut('const POOL =', '\nconst CEREMONY')}\n${cut('const RELAYERS =', '\nconst MAX_RELAY_FEE')}\n${cut('const MAX_RELAY_FEE =', '\n')}\n({ POOL, ROUTER, VERIFIER, CHAINS, RELAYERS, MAX_RELAY_FEE })`);
