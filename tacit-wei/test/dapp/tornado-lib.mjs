// The page's fixed-pool part (TC) with the page's own primitives under it, in a VM context: the bytes, hashes, curves
// and ABI sections of the page's module, then TC from the page (a page without it is an error: the page is canonical).
// PAGE_SRC names another page source to take the primitives from.
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export function loadTC({ page = process.env.PAGE_SRC || new URL('../../dapp/page.html', import.meta.url) } = {}) {
  const text = fs.readFileSync(page, 'utf8');
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(text)[1];
  const cut = (from, to) => { const a = mod.indexOf(from), b = mod.indexOf(to, a); if (a < 0 || b < 0) throw new Error('page layout changed: ' + from); return mod.slice(a, b); };
  let prims = cut('// ── bytes ──', '// ── receive boxes ──');
  // TC needs BabyJubJub's general multiply and square root, which the page's curve object keeps inside until it carries TC
  if (!/\bmul: mulPoint\b/.test(prims)) prims = prims.replace('return { mulB8, add, pack, unpack };', 'return { mulB8, add, pack, unpack, mul: mulPoint, sqrt };');
  const checksum = cut('function checksum(', '\n}\n') + '\n}\n';
  const START = '// ── fixed-denomination pools (Tornado Cash) ──';
  if (!mod.includes(START)) throw new Error(`${page} has no fixed-pool section (${START}): TC is read from the page only`);
  const partOf = (start, file) => (mod.includes(start) ? cut(start, '\n})();\n') + '\n})();\n' : fs.readFileSync(new URL(`../../dapp/parts/${file}`, import.meta.url), 'utf8'));
  const part = [partOf(START, 'tornado.js'), partOf('// ── relays: the page', 'relays.js'), partOf('// ── the private route ──', 'route.js')].join('\n');
  const extraFns = mod.includes('const timeoutSignal') ? '' : 'const timeoutSignal = (ms) => AbortSignal.timeout(ms);';
  const ctx = vm.createContext({ AbortSignal, crypto: webcrypto, TextEncoder, TextDecoder, URL, Blob, Response, DecompressionStream, fetch, setTimeout, clearTimeout, console });
  vm.runInContext(`${prims}\n${checksum}\n${extraFns}\n${part}\nglobalThis.TC = TC; globalThis.RL = RL; globalThis.ROUTE = ROUTE; globalThis.prim = { keccak, sha256, secp, bj, hex, unhex, cat, utf8, big, be, abi, calldata, FR, SN };`, ctx, { filename: 'page-part.js' });
  return { TC: ctx.TC, RL: ctx.RL, ROUTE: ctx.ROUTE, prim: ctx.prim, ctx };
}
