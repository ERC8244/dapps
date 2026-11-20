/* The receive code and what links say when they cannot be used, on the in-memory chain: the code for a phone camera (the
   link) and for a wallet app (an EIP-681 transfer of the amount to the link's one-time deposit address, the same address the
   link carries), the choice kept; and a link with an amount that is not ETH, or one asking for a private token, said plainly.

   Usage: node test/dapp/tacit-wei.qr.mjs     (PAGE=dapp/page.html runs it against the source)   */
import * as H from './forms-lib.mjs';
import * as L from './tacit-wei.lg-lib.mjs';
const {mkEnv, signIn, until, txt, ok} = H;
const t0 = Date.now();
let pass = 0, fail = 0;
const check = (c, m, x = '') => { ok(c, m, x) ? pass++ : fail++; return c; };
const noErrors = (p, what) => check(p.errors.length === 0, `${what}: no page errors`, p.errors.join(' | '));

await L.boot();

console.log('1. the receive code: a phone camera, or a wallet app');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env, {connected: true});
  await signIn(p);
  await p.click('#tabs [data-tab="receive"]');
  await until(p, () => !!document.querySelector('#f-qr svg') && !!document.querySelector('#f-qrfor'), null, 40e3);
  check(/#pay=tacit1/.test(await txt(p, '#f-rlink')), 'by default the code is the link (a phone camera opens this page)', (await txt(p, '#f-rlink')).slice(0, 60));
  await p.evaluate(() => { document.querySelector('#f-ropts').open = true; });
  await p.fill('#f-ramt', '0.25'); await p.waitForTimeout(400);
  await p.click('#f-qrfor [data-qf="wallet"]');
  await until(p, () => /^ethereum:/.test(document.querySelector('#f-rlink')?.textContent || ''), null, 10e3);
  const uri = await txt(p, '#f-rlink');
  check(/^ethereum:0x[0-9a-fA-F]{40}@1\?value=250000000000000000$/.test(uri), '"A wallet app": an EIP-681 transfer of 0.25 ETH on chain 1', uri);
  await p.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await p.click('#f-link');
  const link = await p.evaluate(() => window.__copied || '');
  check(/#pay=tacit1.*&n=/.test(link), 'the copied link is still the link, with its deposit address', link.slice(0, 80));
  check(/plain transfer to your one-time deposit address/.test(await txt(p, '#f-qrnote')), 'and the code says what a wallet app does with it', await txt(p, '#f-qrnote'));
  check(await p.evaluate(() => localStorage.getItem('tacit-wei-qr-for')) === 'wallet', 'the choice is kept');
  noErrors(p, 'scenario 1');
  await L.close(p);
}

console.log('2. links that cannot be used say why');
{
  const env = mkEnv(); L.lgState(env);
  const addr = H.KEY_TACIT1;
  const p = await L.open(env);
  const origin = await p.evaluate(() => location.origin);
  await p.goto(`${origin}/#pay=${addr}&asset=usdc&amount=1000usdc`);
  await until(p, () => /private USDC/.test(document.querySelector('#req')?.textContent || ''), null, 15e3);
  check(/asks for private USDC, and this page pays only private ETH/.test(await txt(p, '#req')), 'a private-token request (anon.wei or tacit.finance) names the token and says where to open it', await txt(p, '#req'));
  const q = await L.open(env);
  await q.goto(`${origin}/#pay=${addr}&amount=1,5,0`);
  await until(q, () => /not an amount of ETH/.test(document.querySelector('#req')?.textContent || ''), null, 15e3);
  check(/asks for “1,5,0”, which is not an amount of ETH/.test(await txt(q, '#req')), 'an amount that is not ETH is shown as written, and why it is refused', await txt(q, '#req'));
  noErrors(p, 'scenario 2'); noErrors(q, 'scenario 2, amount');
  await L.close(p); await L.close(q);
}

await L.shutdown();
console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s (${process.env.PAGE || 'built page'})`);
process.exit(fail ? 1 : 0);
