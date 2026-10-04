/* Runs the real dapp/page.html against anvil forks of the chains' real pools, with every proof made in the page by its
   own prover and accepted by the deployed pool, and the relays down throughout, so every spend is sent from the wallet:
   on each chain, shield from a wallet into your own balance, send privately to a tacit1 address, withdraw part, shield
   into someone else's balance, pay a payment link with no Tacit key open, take in what was sent to a deposit address,
   rebuild from the chain alone, and read each side's activity. Then a browser that has never seen the key opens it, and
   finds its balance on every chain from the key and the chains alone.

   One wallet, one page, one key throughout: the page asks the wallet to switch chains itself between the flows.

   Usage: node test/dapp/tacit-pay.fork.mjs                      (anvil on PATH; all three chains)
          CHAINS=base node test/dapp/tacit-pay.fork.mjs          (one chain, or a comma list)
          ARTIFACTS=<dir> OFFLINE=1 …                             (no mirrors: the proving key comes from disk)       */
import {startFork, ok, finish, hexKey, ACCT, CHAINS} from './fork-lib.mjs';

const names = (process.env.CHAINS || 'ethereum,base,robinhood').split(',');
const lab = await startFork(names);
const p = await lab.page();
const K0 = hexKey(), K1 = hexKey();

const K1addr = await p.openKey(K1);
await p.lockKey();
await p.openKey(K0);

if (process.env.OFFLINE) {
  console.log('no mirrors: the proving key from disk');
  await p.click('#settings-open'); await p.click('#sheet-settings [data-close]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#device-file')]);
  await chooser.setFiles([`${process.env.ARTIFACTS}/transact.wasm`, `${process.env.ARTIFACTS}/transact_final.zkey`]);
  await p.waitForFunction(() => /ready/.test(document.querySelector('#device').textContent), null, {timeout: 300e3});
  ok(true, 'loaded from disk, checked against its pinned hashes');
}

const eth = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
for (const name of names) {
  const c = CHAINS.find((x) => x.key === name), f = lab.fork(name);
  console.log(`\n${c.full}`);
  await p.chain(name);
  await p.click('#tabs [data-tab="shield"]');
  await p.click('[data-from="wallet"]');
  const wallet0 = await p.wallet();
  if (await p.$('#f-conn')) await p.click('#f-conn');
  await p.waitForSelector('#f-max');
  await p.fill('#f-samt', '0.01');
  let t0 = Date.now();
  await p.click('#f-go');
  let s = await p.status(/Shielded|err/);
  ok(/Shielded 0\.01 ETH/.test(s), `shield 0.01 from the wallet (${Math.round((Date.now() - t0) / 1000)} s)`, s);
  const wl = await p.wallet();
  const swapped = wl.filter((x) => x.startsWith('wallet_switchEthereumChain')).length;
  ok(name === names[0] || swapped > 0, 'the page switched the wallet to this chain before it proved', wl.slice(-6).join(' '));
  ok(await p.balance('0.01') === '0.01', 'private balance 0.01');

  await p.click('#tabs [data-tab="send"]');
  await p.click('[data-route="wallet"]', {timeout: 20e3}).catch(() => {});     // with the relays down the page offers the wallet; it never picks it alone
  await p.fill('#f-to', K1addr); await p.fill('#f-amt', '0.004');
  await p.waitForFunction(() => /They receive/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
  await p.click('#f-go');
  s = await p.status(/Sent|err/);
  ok(/Sent 0\.004 ETH privately/.test(s), 'send 0.004 privately to a tacit1 address', s);
  ok(await p.balance('0.006') === '0.006', 'private balance 0.006');

  const DEST = '0x' + '5e'.repeat(20), before = BigInt(await f.rpc('eth_getBalance', [DEST, 'latest']));
  await p.click('#tabs [data-tab="withdraw"]');
  await p.click('[data-route="wallet"]', {timeout: 20e3}).catch(() => {});
  await p.fill('#f-wto', DEST); await p.fill('#f-wamt', '0.002');
  await p.waitForFunction(() => /Arrives/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
  await p.click('#f-go');
  s = await p.status(/Withdrew|err/);
  ok(/Withdrew 0\.002 ETH/.test(s), 'withdraw 0.002 to an 0x address', s);
  ok(BigInt(await f.rpc('eth_getBalance', [DEST, 'latest'])) - before === eth(0.002), 'the address received exactly 0.002 ETH');
  ok(await p.balance('0.004') === '0.004', 'private balance 0.004');

  await p.click('#tabs [data-tab="shield"]');
  await p.fill('#f-samt', '0.001'); await p.fill('#f-sto', K1addr);
  await p.waitForFunction(() => /Into their private balance/.test(document.querySelector('#f-rcpt').textContent), null, {timeout: 30e3});
  await p.click('#f-go');
  s = await p.status(/Shielded|err/);
  ok(/into their private balance/.test(s), 'shield 0.001 into someone else’s balance', s);
  ok(await p.balance('0.004') === '0.004', 'one’s own balance is untouched');
  await p.lockKey();
  await p.evaluate(([a, k]) => { location.hash = `pay=${a}&amount=0.0015&chain=${k}&for=fork`; }, [K1addr, name]);
  await p.waitForSelector('#req-pay');
  await p.click('#req-pay');
  await p.waitForFunction(() => /paid to/.test(document.querySelector('#req-body').textContent) || document.querySelector('#req-status .err'), null, {timeout: 900e3});
  ok(/0\.0015 ETH\s*paid to/.test((await p.textContent('#req-body')).replace(/\s+/g, ' ')), 'a payer with no Tacit key pays a payment link from a wallet', (await p.textContent('#req-status')).trim());
  await p.click('#req-done');

  await p.openKey(K1);
  ok(await p.balance('0.0065') === '0.0065', 'the payee holds 0.004 + 0.001 + 0.0015');
  await p.click('#tabs [data-tab="shield"]');
  await p.click('[data-from="exchange"]');
  await p.waitForSelector('#form .addr code', {timeout: 60e3});
  const box = await p.textContent('#form .addr code');
  await f.rpc('eth_sendTransaction', [{from: ACCT, to: box, value: '0x' + eth(0.003).toString(16)}]);
  await p.click('#f-check');
  await p.waitForSelector('#f-sweep', {timeout: 60e3});
  await p.click('#f-sweep');
  s = await p.status(/Taken in|err/);
  ok(/Taken in/.test(s), 'takes in 0.003 sent to the deposit address', s);
  ok(await p.balance('0.0095') === '0.0095', 'which joins the private balance');
  const theirs = await p.rows(4, c.name);
  ok(theirs.some((r) => /^Received privately \+0\.004 ETH/.test(r)) && theirs.filter((r) => /^Shielded in \+0\.001(5)? ETH/.test(r)).length === 2 && theirs.some((r) => /^Came in at your deposit address \+0\.003 ETH/.test(r)), 'activity names every payment', theirs.join(' | '));
  await p.evaluate(() => { document.querySelector('#activity details').open = true; });
  await p.click('#rebuild');
  await p.waitForFunction(() => !document.querySelector('#rebuild')?.disabled, null, {timeout: 600e3});
  ok(await p.balance('0.0095') === '0.0095', 'rebuilt from the chain alone, the same balance');
  await p.lockKey();
  await p.openKey(K0);
  const mine = await p.rows(3, c.name);
  ok(mine.some((r) => /^Shielded in \+0\.01 ETH/.test(r)) && mine.some((r) => /^Sent privately −0\.004 ETH/.test(r)) && mine.some((r) => /^Withdrew to 0x5e5e…5e5e −0\.002 ETH/.test(r)), 'the payer’s activity names the shield, the send and the withdrawal', mine.join(' | '));
}
ok(!p.errors.length, 'no page errors', p.errors.join(' | '));

console.log('\na browser that has never seen the key');
const q = await lab.page();
await q.openKey(K1);
await q.waitForFunction((n) => [...document.querySelectorAll('#chains small')].filter((s) => /^0\.0095 ETH$/.test(s.textContent.trim())).length >= n, names.length, {timeout: 600e3}).catch(() => {});
const seen = await q.$$eval('#chains small', (x) => x.map((e) => e.textContent.trim()));
ok(CHAINS.filter((c) => names.includes(c.key)).every((c) => seen[CHAINS.indexOf(c)] === '0.0095 ETH'), 'finds 0.0095 ETH on each chain from the key and the chains alone, with no relay', seen.join(' · '));
ok(!q.errors.length, 'no page errors', q.errors.join(' | '));
finish(() => lab.close());
