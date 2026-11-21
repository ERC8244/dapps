/* One private balance across the Tacit pool and the whole notes, on the in-memory chain: post-quantum privacy offered before
   a new balance's first action (the 24 words inline, "Not now" put off for a week, turning it on there) and as a line above
   a balance already there; Send offering to move a whole note in when the balance alone falls short; Send to an 0x address
   and Withdraw taking whole notes first, Max counting them, what is left with them counted, and notes that went in together
   named; a key opened with no wallet finding and keeping its notes; Activity listing a split shield; gas from the wallet as a
   link for the visit, and the wallet sending notes while the registry has gas from the note off; ETH at a one-time deposit
   address said to be on its way in by the relay; a payment waiting on a note moved in, kept across reloads and tabs,
   offered once the note lands, paid exactly once, refused when its name moved, and only said after a day.
   A withdrawal spread over time in parts: the first now, the others kept sealed and offered once due, each paid once.
   (ARTIFACTS=<folder with transact.wasm and transact_final.zkey> also proves and sends the finished payment.)

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
  check(/Not now \(ordinary privacy\)/.test(form) && /Enter your 24 words instead/.test(form) && /tacit\.finance PQ ID\? Its 24 words work here too/.test(form), 'with "Not now (ordinary privacy)", "I have words already" and the PQ ID line', form.slice(0, 400));
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

console.log('1b. a form with an amount in it is not taken away for the words: the press brings them');
{
  const env = mkEnv(); L.lgState(env); env.C[1].balances.set(DEV.address.toLowerCase(), 5n * E);
  const p = await L.open(env, {connected: true});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="shield"]');
  await until(p, () => /\d/.test(document.querySelector('#f-wb')?.textContent || ''), null, 15e3);
  await p.fill('#f-samt', '0.5');
  // the first read of a new balance ends while the amount is typed: the words step would turn on now
  await p.evaluate(() => { window.__pqAsk = true; });
  await p.click('#bal-re');
  await p.waitForTimeout(2000);
  check(!(await p.$('#f-pq')) && (await p.inputValue('#f-samt')) === '0.5', 'the form stays, with the amount in it', await txt(p, '#form'));
  await until(p, () => !document.querySelector('#f-go')?.disabled, null, 10e3);
  await p.click('#f-go');
  check(await until(p, () => document.querySelectorAll('#f-pq .pq-words li').length === 24, null, 5e3), 'the press brings the 24 words, before the wallet is asked', await txt(p, '#form'));
  check(env.C[1].sent.length === 0, 'and nothing is sent');
  await p.click('#pq-later');
  check(await until(p, () => document.querySelector('#f-samt')?.value === '0.5', null, 5e3), '"Not now" gives the form back with the amount still in it');
  noErrors(p, 'scenario 1b');
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
  check(await until(p, () => !!document.querySelector('#f-pq #pq-text'), null, 5e3), '"Enter your 24 words instead" asks for them');
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
  check(await p.$eval('#bal-parts', (d) => !d.open) && !(await p.isVisible('#bal-parts b')), 'the parts of the total stay behind a tap', await txt(p, '#bal'));
  await p.click('#bal-parts summary');
  check(await p.isVisible('#bal-parts b') && /0\.17 ready to pay · 1\.8 in 9 whole notes/.test(await txt(p, '#bal-parts')), 'tapped: what is ready to pay and what is in whole notes', await txt(p, '#bal-parts'));
  await p.click('#bal-pq-later');
  check(await until(p, () => !document.querySelector('#bal-pq'), null, 5e3), '"Not now" takes the line away');
  // the notes card: grouped by size
  const card = await txt(p, '#lg-notes');
  check(/8 × 0\.1 ETH/.test(card) && /(^|[^.\d])1 ETH Make ready to pay/.test(card) && !/note \d/.test(card) && !/1 × 1 ETH/.test(card) && !/Kohaku/.test(card), 'the notes card groups several notes by size (8 × 0.1) and lists a single one on its own, no "Kohaku"', card.slice(0, 300));
  check(await p.evaluate(() => !!document.querySelector('#lg-notes #lg-intake details')), 'and holds "Make whole notes from your private balance"');
  check(await p.$eval('#lg-box', (d) => !d.open) && /^Whole notes \(9\)$/.test(await txt(p, '#lg-box > summary')) && !(await p.isVisible('#lg-find')), 'the card starts shut as "Whole notes (9)", Find inside it', await txt(p, '#lg-box > summary'));
  await p.click('#lg-box > summary');
  check(await p.isVisible('#lg-find') && await p.isVisible('#lg-paste') && await p.isVisible('#lg-save'), 'opened: Find, Paste a note, Save as text');
  await p.click('#bal-re'); await ready(p); await p.waitForTimeout(800);
  check(await p.$eval('#lg-box', (d) => d.open), 'and it stays open through a redraw (for the visit)');
  await p.click('#tabs [data-tab="send"]');
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.5');
  check(await until(p, () => /few minutes/.test(document.querySelector('#f-rcpt')?.textContent || '') && /^Send privately$/.test(document.querySelector('#f-go')?.textContent.trim()) && !document.querySelector('#f-go').disabled, null, 15e3) && /Part of this comes from a whole note: it takes a few minutes, and that step shows on chain; the payment stays private\./.test(await rcpt(p)), 'paying 0.5 with 0.17 ready: the form\'s button says "Move a 1 ETH note in, then pay"', await txt(p, '#f-go'));
  check(await p.$$eval('#form button.btn', (b) => b.length) === 1, 'and it is the only button of the form', await p.$$eval('#form button.btn', (b) => b.map((x) => x.textContent).join(' | ')));
  check(/0\.17 ETH is ready to pay/.test(await rcpt(p)) && /No wallet needed/.test(await rcpt(p)) && /up to 3%/.test(await rcpt(p)) && /up to 0\.25%/.test(await rcpt(p)) && /a few minutes/.test(await rcpt(p)) && !/signs a message/.test(await rcpt(p)), 'saying what is ready, that no wallet is needed, the costs and the wait', await rcpt(p));
  await p.fill('#f-amt', '0.1'); await p.waitForTimeout(600);
  check(/Send privately/.test(await txt(p, '#f-go')) && /Left in balance ?1\.86999 ETH/.test(await rcpt(p)), 'an amount the balance covers pays from it; "Left in balance" counts the notes', await rcpt(p));
  // an 0x address: whole notes first, as Withdraw
  await p.fill('#f-to', PAYEE); await p.fill('#f-amt', '1.05');
  check(await until(p, () => /From whole notes \(1\) ?1 ETH/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3), 'Send to an 0x address takes a whole note first', await rcpt(p));
  check(/Arrives, at least ?1\.02 ETH/.test(await rcpt(p)), 'and says what arrives at least (the note less up to 3%, and the rest)', await rcpt(p));
  check(/no wallet needed/.test(await rcpt(p)) && !!(await p.$('#f-rcpt [data-lg-gas]')) && !(await p.$('#lg-gas')), 'gas from the note, no wallet needed; the wallet is a link in the receipt (no select in the notes card)', await rcpt(p));
  await p.click('#f-rcpt [data-lg-gas]');
  check(await until(p, () => /Your wallet sends each note/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 5e3) && /Arrives, at least ?1\.05 ETH/.test(await rcpt(p)) && await p.inputValue('#f-amt') === '1.05', 'the link: the wallet sends the notes, the whole note arrives, the amount kept', await rcpt(p));
  await p.click('#f-rcpt [data-lg-gas]');
  check(await until(p, () => /no wallet needed/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 5e3), 'and back', await rcpt(p));
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
  check(await until(p, () => /in Tornado Cash/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'the notes go in', await txt(p, '#status'));
  check(await until(p, () => /Into whole notes \(2\)/.test(document.querySelector('#activity')?.textContent || ''), null, 10e3), 'Activity: "Into whole notes (2)"', (await txt(p, '#activity')).slice(0, 300));
  noErrors(p, 'scenario 6');
  await L.close(p);
}

console.log('7. the registry has gas from the note off (bit 1): notes still count, the wallet sends them, said before the press');
{
  const {env, seed} = await holdings();
  env.regFlags = 2;
  const p = await L.open(env, {connected: true, seed});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="withdraw"]');
  await p.fill('#f-wto', H.PAYEE);
  await until(p, () => /fee/.test(document.querySelector('#form .route')?.textContent || ''), null, 15e3);
  await p.fill('#f-wamt', '1.05');
  check(await until(p, () => /From whole notes \(1\) ?1 ETH/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3) && /Gas from the note is off for now, so your wallet sends each note/.test(await rcpt(p)) && !(await p.$('#f-rcpt [data-lg-gas]')), 'Withdraw takes the note, saying the wallet sends it (no gas link)', await rcpt(p));
  await p.click('#tabs [data-tab="send"]');
  await p.fill('#f-to', DEV_TACIT1); await p.fill('#f-amt', '0.5');
  check(await until(p, () => /few minutes/.test(document.querySelector('#f-rcpt')?.textContent || '') && /Send privately/.test(document.querySelector('#f-go')?.textContent || ''), null, 15e3) && /your wallet sends the move and shows as the sender/.test(await rcpt(p)), 'Send still offers the move, saying the wallet sends it', await rcpt(p));
  check(env.C[1].sent.length === 0, 'nothing sent');
  noErrors(p, 'scenario 7');
  await L.close(p);
}

console.log('8. ETH at a one-time deposit address (a note moved in): the relay takes it in, the wallet is not asked for');
{
  const {env, seed} = await holdings();
  const keys = H.poolKeys(Buffer.from(KEY, 'hex')), {lib} = await import('./engine-mock.mjs');
  env.C[1].balances.set(H.receiveBoxAddress(H.ROUTER, lib.receiveKeys(keys, 1).npk).toLowerCase(), 997n * E / 10000n);
  const p = await L.open(env, {connected: true, seed});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="shield"]');
  await p.click('#f-tok'); await p.click('[data-from="exchange"]');
  await until(p, () => !!document.querySelector('#f-check'), null, 30e3);
  await p.click('#f-check');
  check(await until(p, () => !!document.querySelector('#form [data-take]'), null, 60e3), 'the address shows 0.0997 ETH waiting');
  const row = await txt(p, '#form .rows'), bal = await txt(p, '#bal-note');
  check(/The relay moves it in shortly, for up to 0\.25%\. Or take it in now from your wallet/.test(row), 'its row says the relay moves it in, the wallet only as a choice', row);
  check(/0\.0997 ETH is waiting at your deposit addresses; the relay moves it into your balance within minutes/.test(bal) && !(await p.$('#bal-note .callout')), 'the balance line says the relay moves it in (a line, not a call to act)', bal);
  check(/0\.17 ready to pay/.test(await txt(p, '#bal')) && /0\.0997 arriving/.test(await txt(p, '#bal')), 'and the total\'s own line says 0.0997 is arriving, so a dip while a note lands has its reason', await txt(p, '#bal'));
  check(env.C[1].sent.length === 0, 'nothing sent');
  noErrors(p, 'scenario 8');
  await L.close(p);
}

// What Send keeps once a note is out on its way in ("move in, then pay"): sealed in the vault under the key, as the page does.
const {lib: ENG} = await import('./engine-mock.mjs');
const KEYS = H.poolKeys(Buffer.from(KEY, 'hex'));
const later = (recs) => { const k = ENG.slotOf(KEYS.v, 'vault:later'); return {[k]: ENG.sealState(KEYS.v, JSON.stringify(recs), k)}; };
// The relay taking in `value` from one-time deposit address `i`: the note's leaf in the pool and the router's Received log.
function sweep(env, i, value) {
  const n = env.C[1], P = n.eth, npk = ENG.receiveKeys(KEYS, i).npk, box = H.receiveBoxAddress(H.ROUTER, npk), rho = ENG.receiveRho(box, 0n), first = P.size;
  const h = P.transact({nf: [0n, 0n], outs: [ENG.leafOf(H.poolAsset(1, H.POOL), value, npk, rho), null], ext: value});
  P.logs.push({address: H.ROUTER, topics: [ENG.T_RECEIVED, '0x' + box.slice(2).toLowerCase().padStart(64, '0'), H.h32(0n)], data: H.coder.encode(['uint256', 'uint256', 'uint256', 'uint256'], [first, value, rho, 0n]), blockNumber: '0x' + n.tip.toString(16), transactionHash: h, logIndex: '0x1'});
}
const relays = (env) => env.relayLog.filter((x) => x.path === '/relay').length;
const noteOf = (p) => txt(p, '#bal-note');

console.log('9. a payment waiting on a note moved in: kept across a reload, offered once the note lands, paid once across two tabs');
{
  const env = mkEnv(); L.lgState(env);
  env.C[1].deposit(KEY, 2n * E / 100n);
  const n0 = await L.noteFor(0, P01); env.tc.deposit(n0.pool, n0.c);
  const seed = {[notesKey]: JSON.stringify([L.metaOf(n0)]), ...later([{id: 'b1', a: String(5n * E / 100n), to: DEV_TACIT1, name: '', b: [1], at: Date.now()}])};
  const p = await L.open(env, {connected: true, seed});
  await signIn(p); await ready(p);
  check(await until(p, () => /0\.05 ETH to tacit1\S+ waits for your note to land/.test(document.querySelector('#bal-note')?.textContent || ''), null, 15e3) && !(await p.$('[data-pl-go]')), 'before the note lands: said, nothing to press yet', await noteOf(p));
  sweep(env, 1, 997n * E / 10000n);
  await p.reload(); await p.waitForTimeout(500);
  await signIn(p); await ready(p);
  check(await until(p, () => document.querySelectorAll('#bal-note [data-pl-go]').length === 1, null, 30e3), 'after a reload, the note landed: "Finish paying", once', await noteOf(p));
  check(/Your note landed\. Finish paying 0\.05 ETH to tacit1/.test(await noteOf(p)), 'saying what it pays and to whom', await noteOf(p));
  const p2 = await p.context().newPage(); p2.errors = []; p2.on('pageerror', (e) => p2.errors.push(String(e)));
  await p2.goto(p.url()); await p2.waitForTimeout(300); await signIn(p2); await ready(p2);
  check(await until(p2, () => !!document.querySelector('#bal-note [data-pl-go]'), null, 30e3), 'a second tab offers it too');
  if (process.env.ARTIFACTS) {
    await p.click('#bal-note [data-pl-go]');
    check(await until(p, () => /Sent 0\.05 ETH privately/.test(document.querySelector('#status')?.textContent || ''), null, 300e3), 'pressed: paid', await txt(p, '#status'));
    check(relays(env) === 1 && !(await p.$('[data-pl-go]')), 'one payment through the relay, and the offer gone', `${relays(env)} | ${await noteOf(p)}`);
    await p2.click('#bal-note [data-pl-go]');
    check(await until(p2, () => /Already paid or dropped/.test(document.querySelector('#status')?.textContent || ''), null, 15e3) && relays(env) === 1, 'the second tab\'s press pays nothing again', await txt(p2, '#status'));
    await p.reload(); await p.waitForTimeout(500); await signIn(p); await ready(p); await p.waitForTimeout(1500);
    check(!(await p.$('[data-pl-go]')) && !/0\.05 ETH to/.test(await noteOf(p)), 'and after a reload nothing is offered again', await noteOf(p));
  } else H.info('ARTIFACTS not set: the finished payment is not proved here');
  noErrors(p, 'scenario 9');
  await p2.close();
  await L.close(p);
}

console.log('10. a waiting payment whose name moved is refused and kept; one a day old is only said, and goes on Dismiss');
{
  const env = mkEnv(); L.lgState(env);
  env.C[1].deposit(KEY, 2n * E / 100n);
  env.setName('pal.wei', {text: H.KEY_TACIT1, addr: PAYEE});
  sweep(env, 3, 997n * E / 10000n);
  const recs = [{id: 'b2', a: String(E / 100n), to: DEV_TACIT1, name: '', b: [2], at: Date.now() - 25 * 3600e3}, {id: 'b3', a: String(E / 100n), to: DEV_TACIT1, name: 'pal.wei', b: [3], at: Date.now()}];
  const p = await L.open(env, {connected: true, seed: later(recs)});
  await signIn(p); await ready(p);
  check(await until(p, () => /Not paid: 0\.01 ETH to tacit1\S+\. Its note was made ready to pay over a day ago/.test(document.querySelector('#bal-note')?.textContent || ''), null, 15e3), 'a day on: "Not paid", with Dismiss', await noteOf(p));
  check(await until(p, () => !!document.querySelector('#bal-note [data-pl-go="b3"]'), null, 30e3), 'the landed one to pal.wei is offered', await noteOf(p));
  await p.click('#bal-note [data-pl-go="b3"]');
  check(await until(p, () => /pal\.wei now points somewhere else, so nothing was sent/.test(document.querySelector('#status')?.textContent || ''), null, 30e3) && relays(env) === 0, 'pal.wei points elsewhere now: refused, nothing sent', await txt(p, '#status'));
  check(await until(p, () => !!document.querySelector('#bal-note [data-pl-go="b3"]'), null, 10e3), 'and kept, to finish or drop');
  await p.click('#bal-note [data-pl-drop="b2"]');
  check(await until(p, () => !/Not paid/.test(document.querySelector('#bal-note')?.textContent || ''), null, 5e3), 'Dismiss takes the old one away');
  await p.reload(); await p.waitForTimeout(500); await signIn(p); await ready(p);
  await until(p, () => !!document.querySelector('#bal-note [data-pl-go]'), null, 30e3);
  check(!/Not paid/.test(await noteOf(p)) && !!(await p.$('[data-pl-go="b3"]')), 'after a reload: the dismissed one stays gone, the other is still offered', await noteOf(p));
  noErrors(p, 'scenario 10');
  await L.close(p);
}

console.log('11. a withdrawal in 3 parts: the first now, two kept sealed, each offered once due, paid once, Dismiss');
{
  const env = mkEnv(); L.lgState(env);
  env.C[1].deposit(KEY, 3n * E / 10n); env.C[1].deposit(KEY, 2n * E / 10n);
  const vk = ENG.slotOf(KEYS.v, 'vault:later');
  const recsOf = async (p) => { const raw = await p.evaluate((k) => localStorage.getItem(k), vk); return raw ? JSON.parse(ENG.openState(KEYS.v, raw, vk)) : []; };
  const setRecs = (p, recs) => p.evaluate(([k, v]) => localStorage.setItem(k, v), [vk, ENG.sealState(KEYS.v, JSON.stringify(recs), vk)]);
  const total = 3n * E / 10n, wei = (x) => BigInt(Math.round(Number(x) * 1e6)) * 10n ** 12n;
  const p = await L.open(env, {connected: true});
  await signIn(p); await ready(p);
  await p.click('#tabs [data-tab="withdraw"]');
  await p.fill('#f-wto', PAYEE);
  await until(p, () => /fee/.test(document.querySelector('#form .route')?.textContent || ''), null, 15e3);
  await p.fill('#f-wamt', '0.3');
  await p.selectOption('#f-parts', '3|3');
  check(await until(p, () => /Later, in 2 parts/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3) , '3 parts over 3 h: the receipt says what goes later', await rcpt(p));
  const note = await txt(p, '#form');
  check(/harder to match to your deposit than one withdrawal/.test(note) && /Open this page again as each falls due/.test(note), 'with the one honest line on what it does and what it asks');
  check(/same address, so they can still be grouped there and added up to the amount you typed/.test(note) && !/tie to each other/.test(note), 'which says the parts go to one address and can be grouped there, not that they cannot be tied to each other');
  const r = await rcpt(p), first = /Arrives ?([\d.]+) ETH/.exec(r)?.[1], later = /Later, in 2 parts ?([\d.]+) ETH/.exec(r)?.[1];
  check(!!first && !!later && /^0\.\d{1,4}$/.test(first), 'the first part is round (four significant digits)', r);
  const feeNow = /Relay fee ?([\d.]+) ETH/.exec(r)?.[1], feeLater = /Fee, each later part ?about ([\d.]+) ETH/.exec(r)?.[1];
  check(!!feeNow && feeLater === feeNow, 'the receipt says each later part pays a fee of its own: about the relay fee this one does, at today\'s price', `${feeNow} / ${feeLater} in ${r}`);
  if (process.env.ARTIFACTS) {
    await p.click('#f-go');
    check(await until(p, () => /Withdrew/.test(document.querySelector('#status')?.textContent || ''), null, 300e3) && relays(env) === 1, 'the first part goes now, once', await txt(p, '#status'));
    const recs = await recsOf(p), sum = recs.reduce((t, x) => t + BigInt(x.a), 0n);
    check(recs.length === 2 && recs.every((x) => x.k === 'w' && x.n === 3 && x.to.toLowerCase() === PAYEE.toLowerCase()) && recs.map((x) => x.i).join() === '2,3', 'two records kept for parts 2 and 3', JSON.stringify(recs));
    check(wei(first) + sum === total && recs[0].a !== recs[1].a, 'the parts add up to 0.3 ETH exactly, and differ', `${first} + ${recs.map((x) => x.a).join(' + ')}`);
    check(recs.every((x) => x.due > Date.now() && x.due < Date.now() + 3 * 3600e3) && recs[0].due < recs[1].due, 'each due later, inside the 3 h span, in order');
    const plainStore = await p.evaluate(() => Object.values(localStorage).join(' ').toLowerCase());
    check(!plainStore.includes(PAYEE.slice(2).toLowerCase()), 'sealed: the address is nowhere in plain storage');
    check(await until(p, () => /2 more parts of a withdrawal to send later, the next in \d+ (min|h)/.test(document.querySelector('#bal-note')?.textContent || ''), null, 10e3), 'the balance says two more parts wait', await noteOf(p));
    await setRecs(p, recs.map((x) => ({...x, due: Date.now() - 1000})));
    await p.reload(); await p.waitForTimeout(500); await signIn(p); await ready(p);
    check(await until(p, () => document.querySelectorAll('#bal-note [data-pl-go]').length === 2, null, 15e3) && /Part 2 of 3 is due: [\d.]+ ETH to 0x3e40…37E3/.test(await noteOf(p)), 'after a reload, each due part is offered: "Part 2 of 3 is due: … to 0x3e40…37E3"', await noteOf(p));
    const p2 = await p.context().newPage(); p2.errors = []; p2.on('pageerror', (e) => p2.errors.push(String(e)));
    await p2.goto(p.url()); await p2.waitForTimeout(300); await signIn(p2); await ready(p2);
    await until(p2, () => document.querySelectorAll('#bal-note [data-pl-go]').length === 2, null, 15e3);
    const id2 = recs.find((x) => x.i === 2).id, id3 = recs.find((x) => x.i === 3).id;
    await p.click(`#bal-note [data-pl-go="${id2}"]`);
    check(await until(p, () => /Withdrew/.test(document.querySelector('#status')?.textContent || ''), null, 300e3) && relays(env) === 2, 'Send it now: part 2 goes, once', await txt(p, '#status'));
    await p2.click(`#bal-note [data-pl-go="${id2}"]`);
    check(await until(p2, () => /Already paid or dropped/.test(document.querySelector('#status')?.textContent || ''), null, 15e3) && relays(env) === 2, 'the second tab\'s press sends nothing again', await txt(p2, '#status'));
    await p2.close();
    await until(p, (sel) => !!document.querySelector(sel), `#bal-note [data-pl-drop="${id3}"]`, 10e3);
    await p.click(`#bal-note [data-pl-drop="${id3}"]`);
    check(await until(p, () => !/Part \d of 3/.test(document.querySelector('#bal-note')?.textContent || ''), null, 5e3) && (await recsOf(p)).length === 0, 'Dismiss clears the last one');
    await p.reload(); await p.waitForTimeout(500); await signIn(p); await ready(p); await p.waitForTimeout(1500);
    check(!/Part \d of 3|more part/.test(await noteOf(p)), 'and after a reload nothing is offered', await noteOf(p));
  } else {
    H.info('ARTIFACTS not set: the parts are not proved and sent here; the offers are checked from records as the press keeps them');
    await setRecs(p, [{id: 'wa', k: 'w', a: String(E / 10n), to: PAYEE, name: '', i: 2, n: 3, at: Date.now(), due: Date.now() - 1000}, {id: 'wb', k: 'w', a: String(E / 10n), to: PAYEE, name: '', i: 3, n: 3, at: Date.now(), due: Date.now() + 3600e3}]);
    await p.reload(); await p.waitForTimeout(500); await signIn(p); await ready(p);
    check(await until(p, () => /Part 2 of 3 is due/.test(document.querySelector('#bal-note')?.textContent || ''), null, 15e3) && /1 more part of a withdrawal to send later/.test(await noteOf(p)), 'a due part offered, a later one counted', await noteOf(p));
    await p.click('#bal-note [data-pl-drop="wa"]');
    check(await until(p, () => !/Part 2 of 3/.test(document.querySelector('#bal-note')?.textContent || ''), null, 5e3) && (await recsOf(p)).length === 1, 'Dismiss clears it');
  }
  noErrors(p, 'scenario 11');
  await L.close(p);
}

console.log('12. the combine offer only when a payment could not take the balance; a note that needs a look opens the card');
{
  const few = mkEnv(); L.lgState(few);
  for (let i = 0; i < 4; i++) few.C[1].deposit(KEY, E / 100n);
  let p = await L.open(few, {connected: true});
  await signIn(p); await ready(p);
  await until(p, () => /fee/.test(document.querySelector('#form .route')?.textContent || ''), null, 15e3); await p.waitForTimeout(800);
  check(!/parts/.test(await noteOf(p)) && !(await p.$('#bal-combine')), 'four parts: a payment combines them itself, so no offer', await noteOf(p));
  await L.close(p);
  const many = mkEnv(); L.lgState(many);
  for (let i = 0; i < 12; i++) many.C[1].deposit(KEY, E / 100n);
  p = await L.open(many, {connected: true});
  await signIn(p); await ready(p);
  check(await until(p, () => /Your balance is in 12 parts, more than one payment can combine\. Combine them now: 11 steps/.test(document.querySelector('#bal-note')?.textContent || ''), null, 20e3), 'twelve parts, more than one payment combines: offered', await noteOf(p));
  await L.close(p);
  const {env, seed} = await holdings();
  const n = await L.noteFor(20, P01);
  env.tc.deposit(n.pool, n.c); env.tc.spend(n.pool, n.nh, '0x7838000000000000000000000000000000005255');
  const meta = JSON.parse(seed[notesKey]);
  p = await L.open(env, {connected: true, seed: {[notesKey]: JSON.stringify([...meta, {...L.metaOf(n), sp: 1, sv: 1, acct: '0x7838000000000000000000000000000000005255', left: 1}])}});
  await signIn(p); await ready(p);
  check(await until(p, () => !!document.querySelector('[data-lg-left]'), null, 15e3) && await p.$eval('#lg-box', (d) => d.open) && await p.isVisible('[data-lg-left]'), 'something left at a note\'s one-time address: the card opens with "Send it on" in view');
  noErrors(p, 'scenario 12');
  await L.close(p);
}

await L.shutdown();
console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s (${process.env.PAGE || 'built page'})`);
process.exit(fail ? 1 : 0);
