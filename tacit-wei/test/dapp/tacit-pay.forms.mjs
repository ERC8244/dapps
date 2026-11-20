/* The forms that move money, on the deployed page with the chain kept in memory (forms-lib.mjs: Ethereum, names, a relay, the
   token list, a quoter, a wallet that can refuse or hang): "pay from my private balance instead" opens Send with the request's
   payee and amount; an amount typed in one coin or unit is not carried into another; a hold that has ended is no longer
   offered again; a withdrawal swapped to a token has a relay line that follows the relay; the wallet as the route is for the
   one payment; a token request is paid from private ETH by a swap on the way out; receipts show the amount sent; one's own
   short name is said to be one's own; an address pasted with a zero-width mark is read; a name read or a history request does
   not go to the node that reads the key's standing deposit address or carry the browser's exact last block; Rebuild reads
   without the relay's point.

   Usage: node test/dapp/tacit-pay.forms.mjs     (ARTIFACTS=<dir with transact.wasm and the zkey> for the sections that prove; PLAYWRIGHT=<path to playwright-core> if not installed here)   */
import * as H from './forms-lib.mjs';
const {mkEnv, open, signIn, until, txt, ok, info, done, KEY, PAYER_KEY, E, DEV, DEV_TACIT1, KEY_TACIT1, PAYEE, toasts} = H;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ready = (p, route = false) => until(p, (r) => /refresh/.test(document.querySelector('#bal-re')?.textContent || '') && (!r || /fee/.test(document.querySelector('#form .route')?.textContent || '')), route, 30e3);
const fund = (env) => { for (const n of Object.values(env.C)) n.balances.set(DEV.address.toLowerCase(), 10n * E); };
const listUsdc = (env) => { env.list = [{chainId: 1, addr: H.getAddress(USDC), sym: 'USDC', name: 'USD Coin', dec: 6}]; env.px[USDC] = 3000n * 10n ** 6n; };
const pickUsdc = async (p) => { await p.click('#f-tok'); await p.click(`#f-tokl [data-tk="${H.getAddress(USDC)}"]`); };
await H.boot();

console.log('"pay from my private balance instead" on a payment request');
{
  const env = mkEnv(); fund(env); env.px[USDC] = 3000n * 10n ** 6n; env.C[1].deposit(PAYER_KEY, 8n * E);
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p, PAYER_KEY); await ready(p);
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '1');
  await p.evaluate((h) => { location.hash = h; }, `pay=${KEY_TACIT1}&amount=0.05&chain=ethereum&for=rent`);
  await p.waitForSelector('#req-priv', {timeout: 15e3});
  await p.click('#req-priv'); await p.waitForTimeout(1500);
  ok(await p.inputValue('#f-to') === KEY_TACIT1, 'Send is to the request’s payee, not the one typed before', await p.inputValue('#f-to'));
  ok(await p.inputValue('#f-amt') === '0.05', 'with the amount the request has', await p.inputValue('#f-amt'));
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '5');
  await p.click('#tabs [data-tab="withdraw"]');
  await p.evaluate((h) => { location.hash = h; }, `pay=${KEY_TACIT1}&chain=ethereum`);
  await p.waitForSelector('#req-amt', {timeout: 15e3});
  await p.fill('#req-amt', '0.3'); await p.waitForTimeout(400);
  await p.click('#req-priv'); await p.waitForTimeout(1500);
  ok(await p.inputValue('#f-amt') === '0.3', 'a request with no amount: the amount typed on the card, not one left in Send', await p.inputValue('#f-amt'));
  ok(p.errors.length === 0, 'no page errors', p.errors.join(' | '));
}

console.log('an amount typed in one coin or unit is not carried into another');
{
  const env = mkEnv(); fund(env); listUsdc(env); env.C[1].deposit(KEY, 2000n * E);
  const p = await open(env);
  await p.click('#tabs [data-tab="withdraw"]'); await signIn(p); await ready(p);
  await pickUsdc(p); await p.click('#form [data-unit="tok"]');
  await p.fill('#f-wto', PAYEE); await p.fill('#f-wamt', '1000');
  await until(p, () => /At least/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 25e3);
  await p.click('#f-tok'); await p.click('#f-tokl [data-tk=""]'); await p.waitForTimeout(1500);
  ok(await p.inputValue('#f-wamt') === '' && !(await p.$('#form [data-unit]')), 'Withdraw as USDC in the units of what arrives, then as ETH: no amount of ETH from it', await p.inputValue('#f-wamt'));
  ok(p.errors.length === 0, 'no page errors', p.errors.join(' | '));
}
{
  const env = mkEnv(); listUsdc(env); const p = await open(env);
  await p.click('#tabs [data-tab="receive"]'); await signIn(p);
  await until(p, () => !!document.querySelector('#f-qr svg'), null, 40e3);
  await p.evaluate(() => { document.querySelector('#f-ropts').open = true; });
  await p.fill('#f-ramt', '0.5'); await p.waitForTimeout(500);
  await p.click('#f-tok3'); await p.click(`#f-tokl3 [data-tk="${H.getAddress(USDC)}"]`); await p.waitForTimeout(1200);
  ok(await p.inputValue('#f-ramt') === '', 'a link’s amount is not carried into the coin it asks for', await p.inputValue('#f-ramt'));
}

console.log('a hold that has ended');
{
  const env = mkEnv(); fund(env); env.C[1].deposit(KEY, E); env.C[1].deposit(KEY, E / 2n); env.drop = true;
  env.relayHook = async ({path, route}) => { if (path === '/relay' && env.drop) { await route.abort(); return true; } };
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p, true);
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.25');
  await until(p, () => /They receive/.test(document.querySelector('#f-rcpt')?.textContent || ''));
  await p.click('#f-go');
  await until(p, () => /may still/.test(document.querySelector('#status')?.textContent || ''), null, 90e3);
  ok(!!(await p.$('#status [data-retry="relay"]')), 'the relay did not answer: the payment is held and offered to try again');
  env.C[1].deposit(PAYER_KEY, E / 5n); env.C[1].tip += 12;
  await p.evaluate(() => document.querySelector('#bal-re').click());
  ok(await until(p, () => !document.querySelector('#status [data-retry]') && !/may still/.test(document.querySelector('#status')?.textContent || ''), null, 30e3), 'once the hold has ended the offer is gone', await txt(p, '#status'));
  ok(p.errors.length === 0, 'no page errors', p.errors.join(' | '));
}

console.log('the relay line of a withdrawal swapped to a token');
{
  const env = mkEnv(); fund(env); listUsdc(env); env.C[1].deposit(KEY, 2n * E);
  const p = await open(env);
  await p.click('#tabs [data-tab="withdraw"]'); await signIn(p); await pickUsdc(p);
  ok(await until(p, () => /no gas needed/.test(document.querySelector('#form .route')?.textContent || ''), null, 40e3), 'signed in on Withdraw as USDC: the line stops reading the relay’s fee once it has it', await txt(p, '#form .route'));
}
{
  const env = mkEnv(); fund(env); listUsdc(env); env.C[1].deposit(KEY, 2n * E); env.C[1].relayUp = false;
  const p = await open(env);
  await p.click('#tabs [data-tab="withdraw"]'); await signIn(p); await pickUsdc(p); await p.waitForTimeout(4000);
  await p.fill('#f-wamt', '0.5'); await p.waitForTimeout(3000);
  ok(/not answering/.test(await txt(p, '#form .route')) && !!(await p.$('#form [data-route="wallet"]')), 'the relay down: the line says so and offers the wallet', await txt(p, '#form .route'));
}

console.log('the wallet as the route, for one payment');
if (process.env.ARTIFACTS) {
  const env = mkEnv(); fund(env); env.C[1].deposit(KEY, 2n * E);
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p, true);
  await p.click('#form [data-route="wallet"]');
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.25'); await p.waitForTimeout(500);
  await p.click('#f-go');
  ok(await until(p, () => /Sent .* privately/.test(document.querySelector('#status')?.textContent || ''), null, 120e3), 'paid from the wallet', await txt(p, '#status'));
  await p.waitForTimeout(1500);
  ok(/Sent by the relay/.test(await txt(p, '#form .route')), 'the next payment is the relay’s again', await txt(p, '#form .route'));
} else info('the wallet route: ARTIFACTS not set, not run');

console.log('a token request');
{
  const env = mkEnv(); fund(env); listUsdc(env); env.C[1].deposit(KEY, E);
  const p = await open(env, {hash: `pay=${PAYEE}&token=${H.getAddress(USDC)}&chain=ethereum&amount=25`});
  await until(p, () => !/Reading/.test(document.querySelector('#req-body')?.textContent || ''), null, 20e3);
  await p.click('#req-pay'); await signIn(p); await p.waitForTimeout(3000);
  ok(!/is empty/.test(await txt(p, '#req-body')), 'with private ETH, the balance is not said to be empty', await txt(p, '#req-body'));
  await p.click('#req-pay'); await p.waitForTimeout(2500);
  ok(/ETH, private/.test(await txt(p, '#bal')) && (await p.evaluate(() => document.querySelector('#tabs [aria-selected="true"]')?.textContent)) === 'Withdraw' && /USDC/.test(await txt(p, '#f-tok')), 'Pay opens Withdraw from private ETH, swapped to USDC', await txt(p, '#bal'));
  ok(await p.inputValue('#f-wamt') === '25' && (await p.inputValue('#f-wto')).toLowerCase() === PAYEE.toLowerCase(), 'with the amount and the address of the request', `${await p.inputValue('#f-wamt')} | ${await p.inputValue('#f-wto')}`);
  ok(p.errors.length === 0, 'no page errors', p.errors.join(' | '));
}

console.log('receipts of an amount sent');
{
  const env = mkEnv(); fund(env); env.C[1].deposit(KEY, 2n * E);
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p, true);
  await p.fill('#f-to', DEV_TACIT1);
  for (const a of ['0.123456789', '0.0000001']) {
    await p.fill('#f-amt', a); await p.waitForTimeout(300);
    ok(new RegExp(`They receive ?${a.replace(/\./g, '\\.')} ETH`).test(await txt(p, '#f-rcpt')), `${a} ETH: the receipt shows the amount that is sent`, await txt(p, '#f-rcpt'));
  }
}

console.log('names and addresses');
{
  const env = mkEnv(); env.C[1].deposit(KEY, E);
  for (const nm of ['ross.wei', 'rosscampbell.wei']) env.setName(nm, {text: KEY_TACIT1, addr: PAYEE});
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p, true);
  await p.fill('#f-amt', '0.1');
  for (const nm of ['ross.wei', 'rosscampbell.wei']) {
    await p.fill('#f-to', nm); await p.waitForTimeout(2500);
    ok(/own address/.test(await txt(p, '#f-rcpt')), `${nm}, one’s own name: said to be one’s own`, await txt(p, '#f-rcpt'));
  }
  const zw = '\u200b';
  await p.fill('#f-to', DEV_TACIT1 + zw); await p.waitForTimeout(800);
  ok(/They receive/.test(await txt(p, '#f-rcpt')) && !/complete address/.test(await txt(p, '#f-rcpt')) && (await p.inputValue('#f-to')) === DEV_TACIT1, 'a tacit1 address with a zero-width space after it is read', await txt(p, '#f-rcpt'));
  await p.click('#tabs [data-tab="withdraw"]'); await p.fill('#f-wto', zw + PAYEE); await p.fill('#f-wamt', '0.1'); await p.waitForTimeout(2500);
  ok(!/Enter an 0x address|not a complete/.test(await txt(p, '#f-rcpt')) && (await p.inputValue('#f-wto')) === PAYEE, 'and an 0x address with one before it', await txt(p, '#f-rcpt'));
  ok(p.errors.length === 0, 'no page errors', p.errors.join(' | '));
}

console.log('what the nodes and the relay are asked');
{
  // The deposit deep in the confirmed history, so the history is read through the relay's index.
  const env = mkEnv(); env.C[1].deposit(KEY, E); env.C[1].tip += 2000; env.setName('friend.wei', {text: KEY_TACIT1, addr: PAYEE}); env.seen = [];
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p);
  const before = env.seen.length;
  await p.fill('#f-to', 'friend.wei'); await p.waitForTimeout(3000);
  const reads = env.seen.slice(before).filter((x) => x.data?.startsWith('0x59d1d43c'));
  const hosts = [...new Set(reads.map((x) => x.host))];
  ok(hosts.length >= 2 && !hosts.includes('ethereum-rpc.publicnode.com'), 'a name is read from nodes other than the first, which reads the standing deposit address', hosts.join(' '));
  ok(env.seen.some((x) => x.host === 'ethereum-rpc.publicnode.com' && x.to === H.MULTICALL.toLowerCase()), 'the first still reads the head');
  const ev = env.relayLog.filter((x) => x.path === '/events');
  ok(ev.length > 0 && ev.every((x) => Number(new URLSearchParams(x.search).get('from')) % 1000 === 0), 'the relay is asked for history from a round block', ev.map((x) => x.search).join(' '));
}
{
  const env = mkEnv(); fund(env);
  const P = env.C[1].eth; for (let i = 0; i < 520; i++) P.deposit(PAYER_KEY, 1n * E / 100n);
  env.C[1].deposit(KEY, E);
  const p = await open(env);
  await p.click('#tabs [data-tab="send"]'); await signIn(p); await ready(p);
  await p.evaluate(() => { document.querySelector('#rebuild-more').open = true; });
  // The reads the sign-in started are let finish first: what the relay is asked after this is Rebuild's.
  for (let n = -1, i = 0; i < 30 && n !== env.relayLog.length; i++) { n = env.relayLog.length; await p.waitForTimeout(1000); }
  env.relayLog.length = 0;
  await p.click('#rebuild'); await p.waitForTimeout(2500);
  await until(p, () => !document.querySelector('#rebuild')?.disabled, null, 60e3);
  ok(env.relayLog.length > 0 && !env.relayLog.some((x) => x.path === '/point' || x.path === '/events'), 'Rebuild asks the relay for neither its point nor its history', env.relayLog.map((x) => x.path).join(' '));
  ok(/from its own logs/.test(await txt(p, '#rebuild-more')), 'and says what it reads from', await txt(p, '#rebuild-more'));
}
await done();
