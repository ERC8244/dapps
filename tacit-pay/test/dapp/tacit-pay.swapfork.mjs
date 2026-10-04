/* A withdrawal that arrives as a token, against an anvil fork of Ethereum with the real pool, router, zQuoter, zRouter and
   onchain token list: shield from a wallet, pick USDC from the list, and withdraw 0.01 ETH as USDC to a new address,
   through a relay (one that sends what it is given faithfully) and then from the wallet itself. Each lands as one
   router.withdrawAndCall whose escrow pays zRouter; the address ends up with at least the minimum the page showed.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.swapfork.mjs        */
import {startFork, ok, finish, hexKey, mockRelay} from './fork-lib.mjs';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4';
const relay = mockRelay();
// The token list and the quoter are read from Ethereum itself; the swap runs on the fork.
const lab = await startFork(['ethereum'], {relay, realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', '0x000000bd2db80567c23e353ca95a251c573cbf9b']});
const f = lab.fork('ethereum'), p = await lab.page();
if (process.env.TRACE) setInterval(async () => console.log('    [status]', (await p.textContent('#status').catch(() => '?')).trim().slice(0, 160), '| rcpt', (await p.textContent('#f-rcpt').catch(() => '?')).replace(/\s+/g, ' ').trim().slice(0, 160)), 20_000).unref();
const usdcOf = async (a) => BigInt(await f.rpc('eth_call', [{to: USDC, data: '0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0')}, 'latest']));
await p.openKey(hexKey());

console.log('shield from the wallet');
await p.click('#tabs [data-tab="shield"]');
await p.click('[data-from="wallet"]');
if (await p.$('#f-conn')) await p.click('#f-conn');
await p.waitForSelector('#f-max');
await p.fill('#f-samt', '0.05');
await p.click('#f-go');
const shielded = await p.status(/Shielded|err/);
ok(/Shielded 0\.05 ETH/.test(shielded), 'shielded 0.05 ETH', shielded);
await p.balance('0.05');

const swap = async (dest, via) => {
  await p.click('#tabs [data-tab="withdraw"]');
  if (!(await p.$('#f-tok') && /USDC/.test(await p.textContent('#f-tok')))) {
    await p.click('#f-tok');
    await p.waitForSelector(`[data-tk="${USDC}"]`, {timeout: 120e3});
    await p.click(`[data-tk="${USDC}"]`);
  }
  if (via === 'wallet') await p.click('[data-route="wallet"]').catch(() => {});
  await p.fill('#f-wto', dest);
  await p.fill('#f-wamt', '0.01');
  await p.waitForFunction(() => /At least/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
  const least = /At least\s*([\d.]+)\s*USDC/.exec(await p.textContent('#f-rcpt'))?.[1];
  await p.click('#f-go');
  return {said: await p.status(/Sent about|err/), least: least ? BigInt(Math.round(Number(least) * 1e6)) : null};
};

console.log('\nthe token list');
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#f-tok');
await p.waitForSelector(`[data-tk="${USDC}"]`, {timeout: 120e3});
const listed = await p.$$eval('#f-tokl [data-tk]', (b) => b.map((x) => [x.dataset.tk, !!x.querySelector('img')]));
ok(listed.length > 5 && listed[0][0] === '', 'ETH first, then the list’s tokens on Ethereum', `${listed.length} rows`);
ok(listed.filter(([, img]) => img).length >= listed.length - 2, 'with their onchain logos');
await p.fill('#f-toksq', 'usd');
ok((await p.$$eval('#f-tokl [data-tk]', (b) => b.length)) < listed.length, 'and a search narrows it');
await p.click(`[data-tk="${USDC}"]`);
ok(await p.waitForFunction(() => /USDC/.test(document.querySelector('#f-tok')?.textContent || '') && /Swap and send/.test(document.querySelector('#f-go')?.textContent || ''), null, {timeout: 10e3}).then(() => true, () => false), 'choosing USDC turns the withdrawal into a swap');

console.log('\nswap 0.01 ETH to USDC through the relay');
const D1 = '0x' + '5a'.repeat(20);
const a = await swap(D1, 'relay');
ok(/Sent about [\d.]+ USDC/.test(a.said), 'the page says it was sent', a.said);
const sent = relay.calls.find((x) => x.path === '/relay' && x.body?.call);
ok(!!sent && sent.body.call.calls.length === 1 && sent.body.call.calls[0].target.toLowerCase() === ZROUTER.toLowerCase(), 'the relay was given a call intent into zRouter');
ok(sent && sent.body.call.calls[0].data.toLowerCase().includes(D1.slice(2).toLowerCase()), 'whose route pays the address typed, written in after the quote');
const got1 = await usdcOf(D1);
ok(a.least && got1 >= a.least, 'the address holds at least the minimum shown', `${got1} ≥ ${a.least}`);

console.log('\nswap 0.01 ETH to USDC from the wallet');
const D2 = '0x' + '5b'.repeat(20);
const b = await swap(D2, 'wallet');
ok(/Sent about [\d.]+ USDC/.test(b.said), 'the page says it was sent', b.said);
const got2 = await usdcOf(D2);
ok(b.least && got2 >= b.least, 'the address holds at least the minimum shown', `${got2} ≥ ${b.least}`);

console.log('\nwhat the page shows');
const rows = await p.rows(3);
ok(rows.filter((r) => /Swapped for USDC/.test(r)).length === 2, 'Activity reads "Swapped for USDC" for both', rows.join(' | '));
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
