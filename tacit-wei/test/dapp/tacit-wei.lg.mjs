/* The large pools (Tornado Cash) in the page, on the in-memory chain (forms-lib.mjs, with the fixed pools, the split
   forwarder and a wallet that signs typed data from tacit-wei.lg-lib.mjs): the split card under a Shield amount (none under
   the smallest note, whole notes and the rest, the smallest-note select, the registry's switch), a deposit of whole notes in
   one forwarder transaction whose commitments are the ones the page's own TC derives from the wallet's signatures, the notes
   card (listed from this browser, a spent one folded away, saved as text), the notes part of Withdraw, and Find.

   Usage: node test/dapp/tacit-wei.lg.mjs     (PAGE=dapp/page.html runs it against the source)   */
import * as H from './forms-lib.mjs';
import * as L from './tacit-wei.lg-lib.mjs';
const {mkEnv, signIn, until, txt, ok, info, KEY, E, DEV} = H;
const {TC, FORWARDER, fwdIface, b32} = L;
const t0 = Date.now();
const P01 = TC.POOLS[0].address, P1 = TC.POOLS[1].address;
const notesKey = 'tacit-wei-fixed-notes:' + DEV.address.toLowerCase();
const fund = (env) => env.C[1].balances.set(DEV.address.toLowerCase(), 10n * E);
const ready = (p) => until(p, () => /refresh/.test(document.querySelector('#bal-re')?.textContent || ''), null, 30e3);
const rcpt = (p) => txt(p, '#f-rcpt');
const split = (p) => txt(p, '#f-split');
let pass = 0, fail = 0;
const check = (c, m, x = '') => { ok(c, m, x) ? pass++ : fail++; return c; };
const noErrors = (p, what) => check(p.errors.length === 0, `${what}: no page errors`, p.errors.join(' | '));
// Signed in with the key, the wallet connected, on Shield.
async function shieldPage(env, opts = {}) {
  const p = await L.open(env, opts);
  await p.click('#tabs [data-tab="shield"]');
  await signIn(p); await ready(p);
  if (/Connect a wallet/.test(await txt(p, '#f-go'))) await p.click('#f-go');
  await until(p, () => !/Connect a wallet/.test(document.querySelector('#f-go')?.textContent || ''), null, 15e3);
  await until(p, () => /\d/.test(document.querySelector('#f-wb')?.textContent || ''), null, 15e3);
  return p;
}
const amount = async (p, v) => { await p.fill('#f-samt', v); await p.waitForTimeout(400); };

await L.boot();
let kept = null;          // scenario 2's page and chain, carried into scenario 5

console.log('1. under the smallest note: no split');
{
  const env = mkEnv(); fund(env); L.lgState(env);
  const p = await shieldPage(env);
  await amount(p, '0.05');
  await until(p, () => /Into/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 10e3);
  check((await p.$eval('#f-split', (e) => e.innerHTML.trim())) === '', '0.05 ETH: the split card is empty', await split(p));
  check(/Into your private balance ?0\.05 ETH/.test(await rcpt(p)) && !/whole notes/.test(await rcpt(p)), 'the receipt says "Into your private balance 0.05 ETH"', await rcpt(p));
  noErrors(p, 'scenario 1');
  await L.close(p);
}

console.log('2. 0.2 ETH with the smallest note 0.1: two whole notes in one forwarder transaction');
{
  const env = mkEnv(); fund(env); L.lgState(env);
  const p = await shieldPage(env, {seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  await amount(p, '0.2');
  await until(p, () => /2 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3);
  check(/2 × 0\.1 ETH/.test(await split(p)) && /whole notes/.test(await split(p)), 'the split card shows "2 × 0.1 ETH" whole notes', await split(p));
  check(!/your private balance/.test(await split(p)), 'and no remainder row', await split(p));
  check((await p.inputValue('#lg-min')) === String(10n ** 17n), 'the select says 0.1 ETH (from the stored choice)');
  check(/Into whole notes ?0\.2 ETH/.test(await rcpt(p)) && !/Into your private balance/.test(await rcpt(p)), 'the receipt says "Into whole notes 0.2 ETH" and nothing into the balance', await rcpt(p));
  await p.click('#f-go');
  const landed = await until(p, () => /large pools/.test(document.querySelector('#status')?.textContent || ''), null, 60e3);
  check(landed, 'the status says the notes are in the large pools', await txt(p, '#status'));
  // what the wallet was asked to sign
  check(env.typed.length === 0, 'signed in, the notes come from the Tacit key: the wallet is asked for no signature', JSON.stringify(env.typed.map((t) => t.message?.nonce)));
  // the one transaction
  const sent = env.C[1].sent;
  check(sent.length === 1 && sent[0].to.toLowerCase() === FORWARDER.toLowerCase(), 'exactly one eth_sendTransaction, to the split forwarder', JSON.stringify(sent.map((s) => s.to)));
  check(sent[0] && BigInt(sent[0].value) === 2n * 10n ** 17n, 'with value 0.2 ETH', sent[0]?.value);
  const n0 = await L.noteFor(0, P01), n1 = await L.noteFor(1, P01);
  let d = null; try { d = fwdIface.decodeFunctionData('splitDeposit', sent[0].data); } catch (e) { info('decode failed', e.message); }
  check(d && d.pools.length === 2 && d.pools.every((a) => a.toLowerCase() === P01.toLowerCase()), 'its calldata is splitDeposit([0.1 pool, 0.1 pool], …)', d ? d.pools.join() : '');
  check(d && d.commitments[0].toLowerCase() === n0.c && d.commitments[1].toLowerCase() === n1.c, 'whose commitments are the notes of numbers 0 and 1 from the sign-in\'s seed', d ? d.commitments.join() : '');
  const t = d?.t;
  check(t && t.slice(0, 4).flat(3).every((x) => x === 0n) && t[4] === '0x0000000000000000000000000000000000000000' && t[5] === 0n && t[6] === '0x0000000000000000000000000000000000000000' && t[7] === 0n && t[8] === '0x' && t[9] === '0x', 'and a zero Tacit part', t ? String(t) : '');
  check(await until(p, () => !document.querySelector('#lg-notes')?.hidden && document.querySelectorAll('#lg-notes [data-lg-out]').length === 2, null, 10e3), '#lg-notes is visible with 2 notes');
  const card = await txt(p, '#lg-notes');
  check(/0\.1 ETH · note 0/.test(card) && /0\.1 ETH · note 1/.test(card), 'listed as "0.1 ETH · note 0" and "0.1 ETH · note 1"', card.slice(0, 200));
  check(await until(p, () => /0\.2 ?in 2 whole notes/.test(document.querySelector('#bal')?.textContent || ''), null, 10e3), 'the balance counts them: "0.2 in 2 whole notes"', await txt(p, '#bal'));
  // signed in, the records that link deposits to withdrawals are sealed under the key: none in plain storage
  const plain = await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tacit-wei-fixed-(notes|log|pending|next):/.test(k)));
  check(plain.length === 0, 'no note record, log, pending list or next number is in plain localStorage', JSON.stringify(plain));
  noErrors(p, 'scenario 2');
  kept = {env, p, n0, n1};
}

console.log('3. 2.37 ETH with the smallest note 0.1: notes and the rest; the select');
{
  const env = mkEnv(); L.lgState(env); env.C[1].balances.set(DEV.address.toLowerCase(), 50n * E);
  const p = await shieldPage(env, {seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  await amount(p, '2.37');
  await until(p, () => /2 × 1 ETH \+ 3 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3);
  check(/2 × 1 ETH \+ 3 × 0\.1 ETH/.test(await split(p)), 'the card shows "2 × 1 ETH + 3 × 0.1 ETH"', await split(p));
  check(/0\.07 ETH ?your private balance/.test(await split(p)), 'and "0.07 ETH your private balance"', await split(p));
  check(await until(p, () => /Network fee about [\d.]+ ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3), 'with a network-fee line once the gas price is read', await split(p));
  // depositGas(5, rest) = 5 × 0.8M + 0.48M at 1 gwei
  check(/Network fee about 0\.00448 ETH/.test(await split(p)), 'the fee is 4.48M gas at 1 gwei (0.00448 ETH)', /Network fee[^.]*\.[^.]*\./.exec(await split(p))?.[0]);
  check(/Into whole notes ?2\.3 ETH/.test(await rcpt(p)) && /Into your private balance ?0\.07 ETH/.test(await rcpt(p)), 'the receipt: 2.3 ETH into whole notes, 0.07 ETH into the balance', await rcpt(p));
  await p.selectOption('#lg-min', String(E)); await p.waitForTimeout(500);
  check(/2 × 1 ETH/.test(await split(p)) && !/0\.1 ETH ?whole/.test(await split(p)) && !/3 ×/.test(await split(p)) && /0\.37 ETH ?your private balance/.test(await split(p)), 'smallest 1 ETH: "2 × 1 ETH" and 0.37 ETH to the balance', await split(p));
  check((await p.evaluate(() => localStorage.getItem('tacit-wei-fixed-min'))) === String(E), 'the choice is kept');
  // a choice that leaves no whole note: the card goes (formShield's onChange resets splitKey to '', the key of no card)
  await p.selectOption('#lg-min', String(10n * E)); await p.waitForTimeout(500);
  check((await p.$eval('#f-split', (e) => e.innerHTML.trim())) === '' && /Into your private balance ?2\.37 ETH/.test(await rcpt(p)), 'smallest 10 ETH for 2.37: the card goes, all into the balance', `${await split(p)} | ${await rcpt(p)}`);
  await amount(p, '12');
  check(await until(p, () => /1 × 10 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3) && /2 ETH ?your private balance/.test(await split(p)), '12 ETH with smallest 10: "1 × 10 ETH" and 2 ETH to the balance', await split(p));
  await p.selectOption('#lg-min', '0'); await p.waitForTimeout(500);
  check(!/whole notes ·|× /.test(await split(p)) && /Split into whole notes: off/.test(await split(p)) && !!(await p.$('#f-split #lg-min')) && /Into your private balance ?12 ETH/.test(await rcpt(p)), 'Off: the parts are hidden, one line says the split is off (with the select to turn it on), all 12 ETH into the balance', `${await split(p)} | ${await rcpt(p)}`);
  await p.selectOption('#lg-min', '100000000000000000'); await p.waitForTimeout(500);
  check(/120 × 0\.1 ETH|1 × 10 ETH|× 10 ETH|× 1 ETH/.test(await split(p)) || /× 0\.1 ETH/.test(await split(p)), 'and choosing a size from that line turns the split back on', await split(p));
  await p.selectOption('#lg-min', '0'); await p.waitForTimeout(500);
  check((await p.evaluate(() => localStorage.getItem('tacit-wei-fixed-min'))) === '0', 'Off is kept');
  info(`with Off kept, a smallest-note select is ${(await p.$('#lg-min')) ? 'still' : 'no longer'} on the page (the only way back on)`);
  check(env.C[1].sent.length === 0 && env.typed.length === 0, 'nothing signed or sent');
  noErrors(p, 'scenario 3');
  await L.close(p);
}

console.log('4. the registry switches the split off (flag bit 0)');
{
  const env = mkEnv(); fund(env); L.lgState(env);
  const reg = JSON.stringify({at: Date.now(), flags: '1', rpc: {1: []}});
  const p = await shieldPage(env, {seed: {'tacit-wei-registry-v1': reg, 'tacit-wei-fixed-min': String(10n ** 17n)}});
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('tacit-wei-registry-v1')).flags) === '1', 'the registry entry is still the seeded one (fresh, not read again)');
  await amount(p, '2.37');
  await until(p, () => /Into/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 10e3);
  check((await p.$eval('#f-split', (e) => e.innerHTML.trim())) === '' && /Into your private balance ?2\.37 ETH/.test(await rcpt(p)), 'flag bit 0: no split card for 2.37, all into the balance', `${await split(p)} | ${await rcpt(p)}`);
  noErrors(p, 'scenario 4');
  await L.close(p);
}

console.log('5. the notes card: listed from this browser, saved as text, a spent one folded');
if (kept) {
  const {env, p, n0, n1} = kept;
  await p.reload(); await p.waitForTimeout(500);
  check(await until(p, () => /^Sign in · 0x/.test(document.querySelector('#wallet-label')?.textContent || ''), null, 15e3), 'after a reload the wallet is connected again (the key is not open)', await txt(p, '#wallet-label'));
  // bind() → refresh() draws the wallet and the form, not the notes card: lgRender() runs only from render()
  // notes made from the sign-in are sealed under the key: before sign-in nothing of them shows
  check(await until(p, () => document.querySelector('#lg-notes')?.hidden && document.querySelectorAll('#lg-notes [data-lg-out]').length === 0, null, 8e3) && (await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tacit-wei-fixed-(notes|log|pending|next):/.test(k)))).length === 0, 'with the wallet connected on load and no sign-in, the notes stay sealed: none listed, none in plain storage', `hidden=${await p.$eval('#lg-notes', (e) => e.hidden)}`);
  await signIn(p);
  check(await until(p, () => !document.querySelector('#lg-notes')?.hidden && document.querySelectorAll('#lg-notes [data-lg-out]').length === 2, null, 15e3), 'signed in again: #lg-notes lists the 2 notes', await txt(p, '#lg-notes'));
  const before = env.typed.length;
  const [dl] = await Promise.all([p.waitForEvent('download', {timeout: 30e3}).catch(() => null), p.click('#lg-save')]);
  check(!!dl, '"Save as text" downloads a file', dl?.suggestedFilename());
  if (dl) {
    const body = await new Promise((res) => dl.createReadStream().then((s) => { let b = ''; s.on('data', (x) => (b += x)); s.on('end', () => res(b)); }, () => res('')));
    const lines = body.split('\n').filter((l) => l && !l.startsWith('#'));
    check(lines.length === 2 && lines[0] === n0.text && lines[1] === n1.text, 'its lines are TC.noteString of the two notes', JSON.stringify(lines).slice(0, 300));
    check(lines.every((l) => /^tornado-eth-0\.1-1-0x[0-9a-f]{124}$/.test(l)), 'each "tornado-eth-0.1-1-0x<124 hex>"');
    check(/^notes-\d{4}-\d\d-\d\d\.txt$/.test(dl.suggestedFilename()), 'named notes-<date>.txt', dl.suggestedFilename());
  }
  info(`save asked for ${env.typed.length - before} signatures after the reload`, JSON.stringify(env.typed.slice(before).map((t) => t.message.nonce)));
  check(/2 notes saved/.test(await txt(p, '#status')), 'the status says 2 notes saved', await txt(p, '#status'));
  env.tc.spend(P01, n1.nh);
  await p.reload(); await p.waitForTimeout(500);
  await until(p, () => /^Sign in · 0x/.test(document.querySelector('#wallet-label')?.textContent || ''), null, 15e3);
  await signIn(p);
  check(await until(p, () => /1 spent/.test(document.querySelector('#lg-notes')?.textContent || '') && document.querySelectorAll('#lg-notes [data-lg-out]').length === 1, null, 15e3), 'note 1 spent on chain: after a reload it folds into "1 spent", one note left to use', await txt(p, '#lg-notes'));
  check(/0\.1 ETH · note 0/.test(await p.$eval('#lg-notes', (e) => [...e.querySelectorAll('.kv')].filter((k) => !k.closest('.lg-spent')).map((k) => k.textContent).join(' '))), 'the one left is note 0');
  check(await until(p, () => /0\.1 ?in a whole note/.test(document.querySelector('#bal')?.textContent || ''), null, 10e3), 'the balance line now says 0.1 in a whole note', await txt(p, '#bal'));
  noErrors(p, 'scenario 5');
  await L.close(p);
} else check(false, 'scenario 5 needs scenario 2');

console.log('6. Withdraw: whole notes first, the rest from the balance');
{
  const env = mkEnv(); fund(env); L.lgState(env); env.C[1].deposit(KEY, 2n * E);
  const N = 7, note = await L.noteFor(N, P1);
  env.tc.deposit(P1, note.c);
  const p = await L.open(env, {connected: true, seed: {[notesKey]: JSON.stringify([L.metaOf(note)])}});
  await p.click('#tabs [data-tab="withdraw"]');
  await signIn(p); await ready(p);
  check(await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 1, null, 15e3), 'the stored 1 ETH note is listed', await txt(p, '#lg-notes'));
  const fresh = '0x' + '5a'.repeat(20).replace(/^5a/, '7b');
  await p.fill('#f-wto', H.getAddress(fresh)); await p.fill('#f-wamt', '1.5');
  await until(p, () => /From whole notes/.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3);
  await until(p, () => /fee/i.test(document.querySelector('#f-rcpt')?.textContent || ''), null, 15e3);
  const r = await rcpt(p);
  check(/From whole notes \(1\) ?1 ETH/.test(r), 'amount 1.5: "From whole notes (1) 1 ETH"', r);
  check(/From your private balance ?0\.5 ETH/.test(r) || /Reading the relay/.test(r), 'and "From your private balance 0.5 ETH"', r);
  await p.fill('#f-wamt', '0.5'); await p.waitForTimeout(800);
  const r2 = await rcpt(p);
  check(!/whole notes/.test(r2) && /Arrives ?0\.5 ETH/.test(r2), 'amount 0.5: no notes rows, it arrives from the balance', r2);
  check(env.C[1].sent.length === 0, 'nothing sent');
  check(!(await p.$eval('#form .route', (e) => e.hidden)), 'a part from the balance: the relay line shows');
  await p.fill('#f-wamt', '1'); await p.waitForTimeout(800);
  check(await p.$eval('#form .route', (e) => e.hidden), 'the whole amount from a note: no relay line (the note pays its own gas)');
  noErrors(p, 'scenario 6');
  await L.close(p);
}

console.log('7. Find brings the notes back from the sign-in, asking nothing; notes made with wallet signatures on request');
{
  // signed notes are looked for in each pool's whole history, whose leaf numbers must run from 0 to the pool's count
  const env = mkEnv(); fund(env); L.lgState(env, {base: 0});
  const a = await L.noteFor(0, P01), b = await L.noteFor(1, P01), c = await L.noteFor(2, P1);
  for (const n of [a, b, c]) env.tc.deposit(n.pool, n.c);
  const p = await L.open(env, {connected: true});
  await signIn(p); await ready(p);
  // With no notes kept in this browser the large pools stay out of the way; Withdraw offers to find notes made elsewhere.
  check(await p.$eval('#lg-notes', (e) => e.hidden), 'a wallet connected, no notes kept in this browser: the notes card stays out of the way');
  await p.click('#tabs [data-tab="withdraw"]');
  await until(p, () => !!document.querySelector('#lg-open'), null, 15e3);
  await p.click('#lg-open');
  await until(p, () => !document.querySelector('#lg-notes').hidden && !!document.querySelector('#lg-find')?.offsetParent, null, 10e3);
  const shown = await p.evaluate(() => !document.querySelector('#lg-notes').hidden && !!document.querySelector('#lg-find')?.offsetParent);
  check(shown, 'Withdraw\'s "Find them" opens the notes card with Find (a new device)', `#lg-notes hidden=${await p.$eval('#lg-notes', (e) => e.hidden)}`);
  if (!shown) await p.evaluate(() => { document.querySelector('#lg-notes').hidden = false; });   // to go on with Find itself
  await p.click('#lg-find');
  check(await until(p, () => /3 found/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'the status says 3 found', await txt(p, '#status'));
  check(env.typed.length === 0, 'with no signature asked for', JSON.stringify(env.typed.map((t) => t.message?.nonce)));
  check(await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 3, null, 10e3), '#lg-notes lists 3 notes', await txt(p, '#lg-notes'));
  const card = await txt(p, '#lg-notes');
  check(/0\.1 ETH · note 0/.test(card) && /0\.1 ETH · note 1/.test(card) && /1 ETH · note 2/.test(card), 'note 0 and note 1 of 0.1 ETH, note 2 of 1 ETH', card.slice(0, 200));
  check((await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tacit-wei-fixed-(notes|log|pending|next):/.test(k)))).length === 0, 'and keeps them sealed, not in plain storage');
  check(await until(p, () => /1\.2 ?in 3 whole notes/.test(document.querySelector('#bal')?.textContent || ''), null, 10e3), 'the balance says "1.2 in 3 whole notes"', await txt(p, '#bal'));
  check(env.C[1].sent.length === 0, 'nothing sent');
  // a note this wallet signed for (another app, or this page before): found on request, one signature per number
  const w = await L.noteFor(0, P1, {signed: true});
  env.tc.deposit(w.pool, w.c);
  check(await until(p, () => !!document.querySelector('#lg-findw'), null, 5e3), 'the status offers to look for notes made with wallet signatures', await txt(p, '#status'));
  await p.click('#lg-findw');
  check(await until(p, () => /1 found/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), '"Look for those" finds the signed note', await txt(p, '#status'));
  const nonces = env.typed.map((t) => Number(t.message.nonce));
  check(JSON.stringify(nonces) === '[0,0,1,2]', 'the wallet signs nonces 0 (twice, the check), 1 and 2: up to the last found (0) plus two', JSON.stringify(nonces));
  const want = (await import('ethers')).id('tornado');
  check(env.typed.every((t) => t.domain.name === 'TornadoCash Keychain' && t.domain.version === '1' && Number(t.domain.chainId) === 1 && t.domain.salt.toLowerCase() === want && t.primaryType === 'TornadoCashNote' && t.account.toLowerCase() === DEV.address.toLowerCase()), 'each is the TornadoCashNote typed data: TornadoCash Keychain, version 1, chain 1, salt keccak("tornado")', JSON.stringify(env.typed[0]?.domain));
  check(await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 4, null, 10e3), 'the card lists 4 notes: both schemes share number 0 in different pools', await txt(p, '#lg-notes'));
  const rows = await p.$$eval('#lg-notes [data-lg-out]', (l) => l.map((b) => b.closest('.kv').textContent));
  check(rows.filter((t) => /wallet-signed/.test(t)).length === 1 && rows.length === 4, 'kept with their schemes: one says wallet-signed, the sign-in\'s three do not', JSON.stringify(rows));
  noErrors(p, 'scenario 7');
  await L.close(p);
}

console.log('8. with post-quantum privacy on, whole notes come from the 24 words; Find brings them back on a new device');
{
  const env = mkEnv(); fund(env); L.lgState(env);
  const p = await shieldPage(env, {seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  // turn it on in the wallet sheet
  await p.click('#wallet'); await until(p, () => !!document.querySelector('#pq-new'), null, 10e3);
  await p.click('#pq-new');
  const words = await p.$$eval('#w-pq .pq-words li', (l) => l.map((x) => x.textContent.trim()));
  await p.click('#pq-wrote');
  for (const i of await p.$$eval('#w-pq input[id^="pq-w"]', (l) => l.map((x) => Number(x.id.slice(4))))) await p.fill(`#pq-w${i}`, words[i]);
  await p.click('#pq-check');
  await until(p, () => /Post-quantum privacy\s*on/.test(document.querySelector('#w-pq')?.textContent || ''), null, 10e3);
  await p.click('#sheet-wallet [data-close]');
  await amount(p, '0.2');
  await until(p, () => /2 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 15e3);
  check(/come from your post-quantum words, so there is nothing extra to sign/.test(await split(p)), 'the split card: nothing extra to sign', await split(p));
  await p.click('#f-go');
  check(await until(p, () => /large pools/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'the notes go in', await txt(p, '#status'));
  check(env.typed.length === 0, 'with no signature asked for');
  // the notes are those of the root's seed: HMAC(root, "tacit-wei-tornado-v1")
  const root = L.vmEval('PQ.rootOf(' + JSON.stringify(words.join(' ')) + ')');
  const {createHmac} = await import('node:crypto');
  const seed = new Uint8Array(createHmac('sha256', Buffer.from(root)).update('tacit-wei-tornado-v1').digest());
  const want = [0, 1].map((n) => b32(TC.secretsOf(TC.seedRS(seed, n), P01).commitment));
  const d = fwdIface.decodeFunctionData('splitDeposit', env.C[1].sent.at(-1).data);
  check(d.commitments.map((x) => x.toLowerCase()).join() === want.join(), 'their commitments are notes 0 and 1 from the root\'s seed', d.commitments.join());
  check(await until(p, () => [...document.querySelectorAll('#lg-notes [data-lg-out]')].filter((b) => /from your words/.test(b.closest('.kv').textContent)).length === 2, null, 10e3), 'kept as made from the words (scheme "q")', await txt(p, '#lg-notes'));
  noErrors(p, 'scenario 8');
  await L.close(p);
  // a new device: signed in, the words entered, Find brings them back asking nothing
  const q = await L.open(env, {connected: true});
  await signIn(q); await ready(q);
  await q.click('#wallet'); await until(q, () => !!document.querySelector('#pq-enter'), null, 10e3);
  await q.click('#pq-enter'); await q.fill('#pq-text', words.join(' ')); await q.click('#pq-use');
  await until(q, () => /Post-quantum privacy\s*on/.test(document.querySelector('#w-pq')?.textContent || ''), null, 10e3);
  await q.click('#sheet-wallet [data-close]');
  await q.click('#tabs [data-tab="withdraw"]');
  await until(q, () => !!document.querySelector('#lg-open'), null, 15e3);
  await q.click('#lg-open');
  await until(q, () => !!document.querySelector('#lg-find')?.offsetParent, null, 10e3);
  const typed = env.typed.length;
  await q.click('#lg-find');
  check(await until(q, () => /2 found/.test(document.querySelector('#status')?.textContent || ''), null, 60e3), 'Find on the new device: 2 found', await txt(q, '#status'));
  check(env.typed.length === typed, 'asking nothing');
  noErrors(q, 'scenario 8, new device');
  await L.close(q);
}

console.log('9. a split deposit: its notes are kept aside before the wallet is asked, and recorded once they land, across a reload');
{
  const env = mkEnv(); fund(env); L.lgState(env);
  const p = await shieldPage(env, {seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  await p.evaluate(() => { window.__modes = { eth_sendTransaction: 'hang' }; });
  await amount(p, '0.2');
  await until(p, () => /2 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3);
  await p.click('#f-go');
  check(await until(p, () => /wallet/.test(document.querySelector('#status')?.textContent || ''), null, 30e3) && (await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tacit-wei-fixed-(notes|log|pending|next):/.test(k)))).length === 0, 'the wallet is asked; what is kept aside is sealed, not in plain storage', await txt(p, '#status'));
  const kept = [await L.noteFor(0, P01), await L.noteFor(1, P01)];
  // the tab goes away; the transaction lands anyway
  for (const n of kept) env.tc.deposit(n.pool, n.c);
  await p.reload(); await p.waitForTimeout(500);
  await until(p, () => /^Sign in · 0x/.test(document.querySelector('#wallet-label')?.textContent || ''), null, 15e3);
  await signIn(p);
  check(await until(p, () => document.querySelectorAll('#lg-notes [data-lg-out]').length === 2, null, 30e3), 'after the reload the landed notes are recorded and listed', await txt(p, '#lg-notes'));
  noErrors(p, 'scenario 9');
  await L.close(p);
}

console.log('10. a split deposit mined whose notes do not show in their pools: said, the amount cleared, no second deposit');
{
  const env = mkEnv(); fund(env); L.lgState(env); env.noLand = true;
  const p = await shieldPage(env, {seed: {'tacit-wei-fixed-min': String(10n ** 17n)}});
  await amount(p, '0.2');
  await until(p, () => /2 × 0\.1 ETH/.test(document.querySelector('#f-split')?.textContent || ''), null, 10e3);
  await p.click('#f-go');
  check(await until(p, () => /The deposit was mined/.test(document.querySelector('#status')?.textContent || ''), null, 90e3), 'the status says the deposit was mined and its notes show once their pools do', await txt(p, '#status'));
  check((await p.inputValue('#f-samt')) === '', 'the amount is cleared', await p.inputValue('#f-samt'));
  const sent = env.C[1].sent.length;
  await p.click('#f-go').catch(() => {}); await p.waitForTimeout(1500);
  check(env.C[1].sent.length === sent, 'pressing again sends nothing', String(env.C[1].sent.length));
  noErrors(p, 'scenario 10');
  await L.close(p);
}

await L.shutdown();
console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s (${process.env.PAGE || 'built page'})`);
process.exit(fail ? 1 : 0);
