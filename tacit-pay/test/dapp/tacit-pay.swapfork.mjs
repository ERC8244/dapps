/* A withdrawal that arrives as a token, against an anvil fork of Ethereum with the real pool, router, zQuoter, zRouter and
   onchain token list: shield from a wallet, pick USDC from the list, and withdraw 0.01 ETH as USDC to a new address,
   through a relay (one that sends what it is given faithfully) and then from the wallet itself. Each lands as one
   router.withdrawAndCall whose escrow pays zRouter; the address ends up with at least the minimum the page showed.

   Usage: ARTIFACTS=<dir with transact.wasm and transact_final.zkey> node test/dapp/tacit-pay.swapfork.mjs        */
import {startFork, ok, finish, hexKey, mockRelay} from './fork-lib.mjs';

const {getAddress, parseEther} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
// CHAIN=base or robinhood swaps on that chain instead; the token list is read from Ethereum either way.
const NAME = process.env.CHAIN || 'ethereum';
const [SYM, TOKEN] = {ethereum: ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'], base: ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'], robinhood: ['USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168']}[NAME];
const USDC = getAddress(TOKEN), ZROUTER = '0x000000000000FB114709235f1ccBFfb925F600e4', SYMRX = new RegExp(SYM);
const relay = mockRelay();
// The token list and the quoter are read from Ethereum itself; the swap runs on the fork.
const lab = await startFork([NAME], {relay, passthrough: NAME === 'ethereum' ? [] : ['ethereum'], realCalls: ['0x0000006013dF75A31678B786061C2B54bf531524', '0x000000bd2db80567c23e353ca95a251c573cbf9b', '0x000000f584434f81fc115b1a59243a4287db08be']});
const f = lab.fork(NAME), p = await lab.page();
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
  if (!(await p.$('#f-tok') && SYMRX.test(await p.textContent('#f-tok')))) {
    await p.click('#f-tok');
    await p.waitForSelector(`[data-tk="${USDC}"]`, {timeout: 120e3});
    await p.click(`[data-tk="${USDC}"]`);
  }
  if (via === 'wallet') await p.click('[data-route="wallet"]').catch(() => {});
  await p.fill('#f-wto', dest);
  await p.fill('#f-wamt', '0.01');
  await p.waitForFunction(() => /At least/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
  const least = new RegExp(`At least\\s*([\\d.]+)\\s*${SYM}`).exec(await p.textContent('#f-rcpt'))?.[1];
  await p.click('#f-go');
  return {said: await p.status(/Sent about|err/), least: least ? BigInt(Math.round(Number(least) * 1e6)) : null};
};

console.log('\nthe token list');
await p.click('#tabs [data-tab="withdraw"]');
await p.click('#f-tok');
await p.waitForSelector(`[data-tk="${USDC}"]`, {timeout: 120e3});
const listed = await p.$$eval('#f-tokl [data-tk]', (b) => b.map((x) => [x.dataset.tk, !!x.querySelector('img')]));
ok(listed.length > 1 && listed[0][0] === '', `ETH first, then the list’s tokens on ${NAME}`, `${listed.length} rows`);
ok(listed.filter(([, img]) => img).length >= listed.length - 2, 'with their onchain logos');
await p.fill('#f-toksq', SYM.toLowerCase());
ok((await p.$$eval('#f-tokl [data-tk]', (b) => b.length)) < listed.length || listed.length <= 2, 'and a search narrows it');
await p.click(`[data-tk="${USDC}"]`);
ok(await p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#f-tok')?.textContent || '') && /zRouter swaps it/.test(document.querySelector('#form')?.textContent || ''), SYM, {timeout: 30e3}).then(() => true, () => false), `choosing ${SYM} turns the withdrawal into a swap`);

console.log(`\nswap 0.01 ETH to ${SYM} through the relay`);
const D1 = '0x' + '5a'.repeat(20);
const a = await swap(D1, 'relay');
ok(new RegExp(`Sent about [\\d.]+ ${SYM}`).test(a.said), 'the page says it was sent', a.said);
const sent = relay.calls.find((x) => x.path === '/relay' && x.body?.call);
ok(!!sent && sent.body.call.calls.length === 1 && sent.body.call.calls[0].target.toLowerCase() === ZROUTER.toLowerCase(), 'the relay was given a call intent into zRouter');
ok(sent && sent.body.call.calls[0].data.toLowerCase().includes(D1.slice(2).toLowerCase()), 'whose route pays the address typed, written in after the quote');
const got1 = await usdcOf(D1);
ok(a.least && got1 >= a.least, 'the address holds at least the minimum shown', `${got1} ≥ ${a.least}`);

console.log(`\nswap 0.01 ETH to ${SYM} from the wallet`);
const D2 = '0x' + '5b'.repeat(20);
const b = await swap(D2, 'wallet');
ok(new RegExp(`Sent about [\\d.]+ ${SYM}`).test(b.said), 'the page says it was sent', b.said);
const got2 = await usdcOf(D2);
ok(b.least && got2 >= b.least, 'the address holds at least the minimum shown', `${got2} ≥ ${b.least}`);

console.log('\nwhat the page shows');
const rows = await p.rows(3);
ok(rows.filter((r) => r.includes(`Swapped for ${SYM}`)).length === 2, `Activity reads "Swapped for ${SYM}" for both`, rows.join(' | '));
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));

const DEC = Number(BigInt(await f.rpc('eth_call', [{to: USDC, data: '0x313ce567'}, 'latest']))), U = (s) => BigInt(Math.round(Number(s) * 1e6)) * 10n ** BigInt(DEC) / 1000000n;
console.log(`\nan amount in ${SYM}: at least 10 arrive`);
const D3 = '0x' + '5c'.repeat(20);
await p.click('#tabs [data-tab="withdraw"]');
if (await p.$('[data-route="relay"]')) await p.click('[data-route="relay"]');
await p.click('#form [data-unit="tok"]');
await p.fill('#f-wto', D3);
await p.fill('#f-wamt', '10');
await p.waitForFunction(() => /You pay/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
const r3 = (await p.textContent('#f-rcpt')).replace(/\s+/g, ' '), swaps = /Swaps\s*([\d.]+)\s*ETH/.exec(r3)?.[1], least3 = new RegExp(`At least\\s*([\\d.,]+)\\s*${SYM}`).exec(r3)?.[1];
ok(!!swaps && new RegExp(`Swaps ${swaps.replace('.', '\\.')} ETH`).test(await p.textContent('#f-cap')), 'the ETH it takes is found, and shown under the amount and in the receipt', r3.slice(0, 220));
ok(!!least3 && U(least3.replace(/,/g, '')) >= U('10'), `with at least the 10 ${SYM} asked as its minimum`, least3);
ok(/You pay\s*[\d.]+\s*ETH/.test(r3), 'and what the private balance pays in all, the fee included');
await p.click('#f-go');
const s3 = await p.status(/Sent about|err/);
ok(new RegExp(`Sent about [\\d.]+ ${SYM}`).test(s3), 'the page says it was sent', s3);
const sent3 = relay.calls.filter((x) => x.path === '/relay' && x.body?.call).pop();
ok(!!sent3 && BigInt(sent3.body.call.calls[0].value) === parseEther(swaps), 'the relay was given a swap of exactly the ETH shown', sent3 && String(sent3.body.call.calls[0].value));
const got3 = await usdcOf(D3);
ok(got3 >= U('10'), `the address holds at least 10 ${SYM}`, `${got3}`);

console.log(`\na payment link that asks for 7.5 ${SYM}`);
const D4 = getAddress('0x' + '5d'.repeat(20));
await p.evaluate((h) => { location.hash = h; }, `pay=${D4}&token=${USDC}&amount=7.5&chain=${NAME}&for=fork`);
await p.waitForFunction(() => !!document.querySelector('#req-pay') && !/Reading/.test(document.querySelector('#req-body')?.textContent || ''), null, {timeout: 120e3});
const card4 = (await p.textContent('#req-body')).replace(/\s+/g, ' ');
ok(new RegExp(`7\\.5 ${SYM}`).test(card4) && card4.includes(D4) && card4.includes(USDC) && !/not on the token list/.test(card4), `the request shows the amount in ${SYM}, the address in full and the listed token by its address`, card4.slice(0, 220));
await p.click('#req-pay');
await p.waitForFunction(() => /You pay/.test(document.querySelector('#f-rcpt')?.textContent || '') && !document.querySelector('#f-go').disabled, null, {timeout: 300e3});
ok((await p.inputValue('#f-wto')) === D4 && (await p.inputValue('#f-wamt')) === '7.5', 'paying it opens the swap out for that address and amount');
await p.click('#f-go');
const s4 = await p.status(/Sent about|err/);
const got4 = await usdcOf(D4);
ok(got4 >= U('7.5'), `paid from the private balance, the address holds at least 7.5 ${SYM}`, `${got4} · ${s4}`);

console.log('\nasking for a token by link');
await p.click('#req-x').catch(() => {});
await p.click('#tabs [data-tab="receive"]');
await p.evaluate(() => { const d = document.querySelector('#f-ropts'); if (d) d.open = true; });
await p.click('#f-tok3');
await p.waitForSelector(`#f-tokl3 [data-tk="${USDC}"]`, {timeout: 120e3});
await p.click(`#f-tokl3 [data-tk="${USDC}"]`);
await p.fill('#f-rto', D4); await p.fill('#f-ramt', '7.5');
await p.waitForFunction(() => /token=/.test(document.querySelector('#f-rlink')?.textContent || ''), null, {timeout: 30e3}).catch(() => {});
ok(new RegExp(`#pay=${D4}&token=${USDC}&amount=7\\.5&chain=${NAME}$`).test(await p.textContent('#f-rlink')), `the payee picks ${SYM} from the list, and the link asks for it`, await p.textContent('#f-rlink'));
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));
finish(lab.close);
