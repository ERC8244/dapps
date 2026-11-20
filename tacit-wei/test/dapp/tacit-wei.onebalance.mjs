/* One private balance across the Tacit pool and the whole notes, on the in-memory chain: post-quantum privacy offered before
   a new balance's first action (the 24 words inline, "Not now" put off for a week, turning it on there) and as a line above
   a balance already there; Send offering to move a whole note in when the balance alone falls short; Send to an 0x address
   and Withdraw taking whole notes first, Max counting them, what is left with them counted, and notes that went in together
   named; a key opened with no wallet finding and keeping its notes; Activity listing a split shield.

   Usage: node test/dapp/tacit-wei.onebalance.mjs     (PAGE=dapp/page.html runs it against the source)   */
import * as H from './forms-lib.mjs';
import * as L from './tacit-wei.lg-lib.mjs';
const {mkEnv, signIn, until, txt, ok, KEY, E, DEV, DEV_TACIT1, PAYEE} = H;
const {TC} = L;
const t0 = Date.now();
const P01 = TC.POOLS[0].address, P1 = TC.POOLS[1].address;
const notesKey = 'tacit-wei-fixed-notes:' + DEV.address.toLowerCase();
const ready = (p) => until(p, () => /refresh/.test(document.querySelector('#bal-re')?.textContent || ''), null, 30e3);
const rcpt = (p) => txt(p, '#f-rcpt');
let pass = 0, fail = 0;
const check = (c, m, x = '') => { ok(c, m, x) ? pass++ : fail++; return c; };
const noErrors = (p, what) => check(p.errors.length === 0, `${what}: no page errors`, p.errors.join(' | '));
// 0.17 ETH in the balance (two parts) and 1.8 ETH in nine whole notes: 3 × 0.1 that went in together (one block), 1 ETH and
// 5 × 0.1, as shielding 0.37 and then 1.6 ETH leaves them.
async function holdings({together = true} = {}) {
  const env = mkEnv(); env.C[1].balances.set(DEV.address.toLowerCase(), 5n * E); L.lgState(env);
  env.C[1].deposit(KEY, 7n * E / 100n); env.C[1].deposit(KEY, E / 10n);
  const pools = [P01, P01, P01, P1, P01, P01, P01, P01, P01], meta = [];
  for (let i = 0; i < pools.length; i++) {
    const n = await L.noteFor(i, pools[i]);
    env.tc.deposit(n.pool, n.c);
    meta.push({...L.metaOf(n), ...(together && i < 3 ? {b: 26272500, i: 100 + i} : {})});
  }
  return {env, seed: {[notesKey]: JSON.stringify(meta)}};
}

await L.boot();

console.log('1. a new balance: post-quantum privacy first, inline; "Not now" puts it off');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env, {connected: true, pqAsk: true});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="shield"]');
  check(await until(p, () => document.querySelectorAll('#f-pq .pq-words li').length === 24, null, 10e3), 'Shield shows the 24 words inline, before the form', await txt(p, '#form'));
  const form = await txt(p, '#form');
  check(/Not now \(ordinary privacy\)/.test(form) && /I have words already/.test(form) && /tacit\.finance PQ ID\? Its 24 words work here too/.test(form), 'with "Not now (ordinary privacy)", "I have words already" and the PQ ID line', form.slice(0, 400));
  check(/show only on tacit\.wei \(and apps that add post-quantum support\)/.test(form), 'and that notes sealed under the words show only on tacit.wei and apps that support it');
  check(!(await p.$('#f-samt')), 'the amount field waits');
  await p.click('#tabs [data-tab="send"]');
  check(await until(p, () => !!document.querySelector('#f-pq'), null, 5e3), 'Send waits for it too');
  await p.click('#pq-later');
  check(await until(p, () => !!document.querySelector('#f-amt') && !document.querySelector('#f-pq'), null, 5e3), '"Not now" opens the form');
  const later = await p.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('tacit-wei-pq-later:')));
  check(!!later && Date.now() - Number(await p.evaluate((k) => localStorage.getItem(k), later)) < 60_000, 'and is kept for this key', later);
  await p.click('#tabs [data-tab="receive"]');
  check(await until(p, () => !document.querySelector('#f-pq') && !!document.querySelector('#f-rlink'), null, 20e3), 'Receive is not asked again', await txt(p, '#form'));
  noErrors(p, 'scenario 1');
  await L.close(p);
}

console.log('2. turning it on inline');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env, {connected: true, pqAsk: true});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="shield"]');
  await until(p, () => document.querySelectorAll('#f-pq .pq-words li').length === 24, null, 10e3);
  const words = await p.$$eval('#f-pq .pq-words li', (l) => l.map((x) => x.textContent.trim()));
  const shownNow = () => p.$$eval('#f-pq .pq-words li', (l) => l.map((x) => x.textContent.trim()).join(' '));
  await p.click('#f-pq #pq-enter');
  check(await until(p, () => !!document.querySelector('#f-pq #pq-text'), null, 5e3), '"I have words already" asks for them');
  await p.click('#f-pq #pq-back');
  await until(p, () => document.querySelectorAll('#f-pq .pq-words li').length === 24, null, 5e3);
  check(await shownNow() === words.join(' '), 'Cancel comes back to the same words');
  await p.click('#wallet'); await until(p, () => !!document.querySelector('#w-pq'), null, 5e3);
  await p.click('#sheet-wallet [data-close]'); await p.waitForTimeout(300);
  check(await shownNow() === words.join(' '), 'opening the wallet sheet keeps them too');
  await p.click('#f-pq #pq-wrote');
  const asked = await p.$$eval('#f-pq input[id^="pq-w"]', (l) => l.map((x) => Number(x.id.slice(4))));
  check(asked.length === 3, 'three words are asked back', asked.join());
  for (const i of asked) await p.fill(`#f-pq #pq-w${i}`, words[i]);
  await p.click('#f-pq #pq-check');
  check(await until(p, () => !document.querySelector('#f-pq') && !!document.querySelector('#f-samt'), null, 10e3), 'the form follows once the words check out', await txt(p, '#form'));
  check(await until(p, () => /Your address now carries your post-quantum key/.test(document.body.textContent), null, 5e3), 'the toast says the address now carries the key and the old one still works');
  await p.click('#wallet'); await until(p, () => !!document.querySelector('#w-pq'), null, 5e3);
  check(/Post-quantum privacy\s*on/.test(await txt(p, '#w-pq')), 'the wallet sheet says it is on', await txt(p, '#w-pq'));
  noErrors(p, 'scenario 2');
  await L.close(p);
}

console.log('3. a balance already there: a line above it instead, and Send moves a note in when the balance falls short');
{
  const {env, seed} = await holdings();
  const p = await L.open(env, {connected: true, pqAsk: true, seed});
  await signIn(p); await ready(p);
  check(await until(p, () => !!document.querySelector('#bal-pq') && !document.querySelector('#f-pq'), null, 15e3), 'no inline step; the balance offers "Turn it on"', await txt(p, '#bal-note'));
  check(await until(p, () => /1\.97/.test(document.querySelector('#bal')?.textContent || '') && /0\.17 ready to pay/.test(document.querySelector('#bal')?.textContent || ''), null, 15e3), 'the headline is all of it, 1.97 ETH, with 0.17 ready to pay', await txt(p, '#bal'));
  await p.click('#bal-pq-later');
  check(await until(p, () => !document.querySelector('#bal-pq'), null, 5e3), '"Not now" takes the line away');
  // the notes card: grouped by size
  const card = await txt(p, '#lg-notes');
  check(/8 × 0\.1 ETH/.test(card) && /1 ETH · note/.test(card) && !/1 × 1 ETH/.test(card) && !/Kohaku/.test(card), 'the notes card groups several notes by size (8 × 0.1) and lists a single one on its own, no "Kohaku"', card.slice(0, 300));
  check(await p.evaluate(() => !!document.querySelector('#lg-notes #lg-intake details')), 'and holds "Make whole notes from your private balance"');
  await p.click('#tabs [data-tab="send"]');
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.5');
  check(await until(p, () => /Move a 1 ETH note in, then pay/.test(document.querySelector('#f-move')?.textContent || ''), null, 15e3), 'paying 0.5 with 0.17 ready: "Move a 1 ETH note in, then pay"', await rcpt(p));
  check(/0\.17 ETH is ready to pay/.test(await rcpt(p)) && /up to 3%/.test(await rcpt(p)) && /up to 0\.25%/.test(await rcpt(p)) && /a few minutes/.test(await rcpt(p)), 'saying what is ready, the costs and the wait', await rcpt(p));
  await p.fill('#f-amt', '0.1'); await p.waitForTimeout(600);
  check(!(await p.$('#f-move')) && /Left in balance ?1\.86999 ETH/.test(await rcpt(p)), 'an amount the balance covers pays from it; "Left in balance" counts the notes', await rcpt(p));
  // an 0x address: whole notes first, as Withdraw
  await p.fill('#f-to', PAYEE); await p.fill('#f-amt', '1.05');
  check(await until(p, () => /From whole notes \(1\) ?1 ETH/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3), 'Send to an 0x address takes a whole note first', await rcpt(p));
  check(/Arrives, at least ?1\.02 ETH/.test(await rcpt(p)), 'and says what arrives at least (the note less up to 3%, and the rest)', await rcpt(p));
  check(env.C[1].sent.length === 0, 'nothing sent');
  noErrors(p, 'scenario 3');
  await L.close(p);
}

console.log('4. Withdraw: Max counts the notes; notes that went in together are named');
{
  const {env, seed} = await holdings();
  const p = await L.open(env, {connected: true, seed});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="withdraw"]');
  await p.fill('#f-wto', PAYEE);
  await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 9, null, 15e3);
  await until(p, () => /fee/.test(document.querySelector('#form .route')?.textContent || ''), null, 15e3);
  await p.click('#f-max'); await p.waitForTimeout(600);
  check(await p.inputValue('#f-wamt') === '1.9', 'Max: 1.9 ETH (1.8 in notes and the balance, rounded down)', await p.inputValue('#f-wamt'));
  check(/From whole notes \(9\) ?1\.8 ETH/.test(await rcpt(p)) && /Left in balance/.test(await rcpt(p)), 'all nine notes and the rest from the balance', await rcpt(p));
  await p.fill('#f-wamt', '0.3'); await p.waitForTimeout(800);
  const r = await rcpt(p);
  check(/3 of these notes went in together/.test(r) && !!(await p.$('#lg-one')), 'three notes that went in together: named, with "Take one now"', r);
  await p.click('#lg-one'); await p.waitForTimeout(600);
  check(await p.inputValue('#f-wamt') === '0.1' && !/went in together/.test(await rcpt(p)), '"Take one now" sets one note', `${await p.inputValue('#f-wamt')} | ${await rcpt(p)}`);
  await p.fill('#f-wamt', '0.05'); await p.waitForTimeout(600);
  check(/Arrives ?0\.05 ETH/.test(await rcpt(p)), 'under the smallest note it comes from the balance', await rcpt(p));
  await p.fill('#f-wamt', '1.99'); await p.waitForTimeout(600);
  check(/1\.8 ETH of this comes from whole notes, and the other 0\.19 ETH from your balance/.test(await rcpt(p)) && !/Max fills it in/.test(await rcpt(p)), 'a shortfall names the notes part (and no Max hint that would drop them)', await rcpt(p));
  check(env.C[1].sent.length === 0, 'nothing sent');
  noErrors(p, 'scenario 4');
  await L.close(p);
}

console.log('5. a key opened with no wallet finds its notes and keeps them');
{
  const env = mkEnv(); L.lgState(env);
  for (const [i, pool] of [[0, P01], [1, P1]]) { const n = await L.noteFor(i, pool); env.tc.deposit(n.pool, n.c); }
  const p = await L.open(env);
  await signIn(p); await ready(p);
  check(await p.evaluate(() => /^tacit1/.test(document.querySelector('#wallet-label')?.textContent || '')), 'signed in with the key alone');
  await p.click('#tabs [data-tab="withdraw"]');
  await until(p, () => !!document.querySelector('#lg-open'), null, 10e3);
  await p.click('#lg-open');
  await until(p, () => /Find/.test(document.querySelector('#lg-find')?.textContent || ''), null, 10e3);
  await p.click('#lg-find');
  check(await until(p, () => /2 found/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'Find: 2 found, no wallet needed', await txt(p, '#status'));
  check(await until(p, () => /1\.1/.test(document.querySelector('#bal')?.textContent || ''), null, 10e3), 'the headline counts them', await txt(p, '#bal'));
  await p.reload(); await p.waitForTimeout(500);
  await signIn(p); await ready(p);
  check(await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 2, null, 15e3), 'after a reload, signed in with the key again: both notes listed from this browser', await txt(p, '#lg-notes'));
  noErrors(p, 'scenario 5');
  await L.close(p);
}

console.log('6. Activity lists a split shield');
{
  const env = mkEnv(); env.C[1].balances.set(DEV.address.toLowerCase(), 10n * E); L.lgState(env);
  const p = await L.open(env, {connected: true, seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  await p.click('#tabs [data-tab="shield"]');
  await signIn(p); await ready(p);
  if (/Connect a wallet/.test(await txt(p, '#f-go'))) await p.click('#f-go');
  await until(p, () => /\d/.test(document.querySelector('#f-wb')?.textContent || ''), null, 15e3);
  await p.fill('#f-samt', '0.2');
  await until(p, () => /2 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3);
  await p.click('#f-go');
  check(await until(p, () => /large pools/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'the notes go in', await txt(p, '#status'));
  check(await until(p, () => /Into whole notes \(2\)/.test(document.querySelector('#activity')?.textContent || ''), null, 10e3), 'Activity: "Into whole notes (2)"', (await txt(p, '#activity')).slice(0, 300));
  noErrors(p, 'scenario 6');
  await L.close(p);
}

await L.shutdown();
console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s (${process.env.PAGE || 'built page'})`);
process.exit(fail ? 1 : 0);
