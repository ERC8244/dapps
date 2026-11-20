/* Post-quantum privacy in the page's wallet sheet, on the in-memory chain: turning it on (24 words shown, three asked back,
   a wrong word refused), the address that then names the ML-KEM key, the root kept sealed in this browser across a reload,
   the payment link that carries the key (and the line and QR code that do not), a payer's page that reads it, the words
   brought to a new device (the same address), forgetting them, and the registry's switch (bit 8).

   Usage: node test/dapp/tacit-wei.pq-ui.mjs     (PAGE=dapp/page.html runs it against the source)   */
import * as H from './forms-lib.mjs';
import * as L from './tacit-wei.lg-lib.mjs';
const {mkEnv, signIn, until, txt, ok, E} = H;
const t0 = Date.now();
let pass = 0, fail = 0;
const check = (c, m, x = '') => { ok(c, m, x) ? pass++ : fail++; return c; };
const noErrors = (p, what) => check(p.errors.length === 0, `${what}: no page errors`, p.errors.join(' | '));
const sheet = async (p) => { if (!(await p.evaluate(() => document.querySelector('#sheet-wallet')?.open))) await p.click('#wallet'); await until(p, () => !!document.querySelector('#w-pq'), null, 10e3); };
const addr = (p) => p.evaluate(() => document.querySelector('#wallet-body .addr code')?.textContent || '');
const pqText = (p) => txt(p, '#w-pq');

await L.boot();
let words = [], pqAddr = '', link = '';

console.log('1. turning it on');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env, {connected: true});
  await signIn(p); await sheet(p);
  const before = await addr(p);
  check(/Post-quantum privacy\s*off/.test(await pqText(p)), 'the wallet sheet says post-quantum privacy is off', await pqText(p));
  await p.click('#pq-new');
  words = await p.$$eval('#w-pq .pq-words li', (l) => l.map((x) => x.textContent.trim()));
  check(words.length === 24 && words.every((w) => /^[a-z]{3,8}$/.test(w)), '"Turn it on" shows 24 words', words.join(' '));
  check(await addr(p) === before && !(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tacit-wei-pq-v1:')))), 'nothing changes and nothing is kept until they are written down');
  await p.click('#pq-wrote');
  const asked = await p.$$eval('#w-pq input[id^="pq-w"]', (l) => l.map((x) => Number(x.id.slice(4))));
  check(asked.length === 3 && new Set(asked).size === 3, 'three words are asked back', asked.join());
  // a wrong word is refused
  for (const i of asked) await p.fill(`#pq-w${i}`, words[i]);
  await p.fill(`#pq-w${asked[1]}`, words[asked[1]] === 'zoo' ? 'abandon' : 'zoo');
  await p.click('#pq-check');
  check(/do not match/.test(await pqText(p)) && /check/.test(await pqText(p)), 'a wrong word is refused, and the check stays', await pqText(p));
  for (const i of asked) await p.fill(`#pq-w${i}`, ` ${words[i].toUpperCase()} `);
  await p.click('#pq-check');
  await until(p, () => /Post-quantum privacy\s*on/.test(document.querySelector('#w-pq')?.textContent || ''), null, 10e3);
  check(/Post-quantum privacy\s*on/.test(await pqText(p)), 'the right words (any case, spaces around) turn it on', await pqText(p));
  pqAddr = await addr(p);
  check(pqAddr.startsWith('tacit1') && pqAddr !== before && pqAddr.length > before.length, 'the address changes: it now names the post-quantum key', `${before.length} → ${pqAddr.length} characters`);
  check(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tacit-wei-pq-v1:')).length === 1), 'the root is kept in this browser, sealed under the key');
  const kept = await p.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('tacit-wei-pq-v1:'))));
  check(/^[0-9a-f]{96}$/.test(kept) && !words.some((w) => kept.includes(w)), 'as 48 sealed bytes, not the words');
  await p.click('#pq-show');
  const shown = await p.$$eval('#w-pq .pq-words li', (l) => l.map((x) => x.textContent.trim()));
  check(shown.join(' ') === words.join(' '), '"Show the 24 words" shows the same words');
  // after a reload and signing in again, it is on with no words asked
  await p.reload(); await p.waitForTimeout(500);
  await signIn(p); await sheet(p);
  check(/Post-quantum privacy\s*on/.test(await pqText(p)) && await addr(p) === pqAddr, 'after a reload, signing in opens it again: on, the same address');
  // the payment link carries the key; the line shown and the QR code do not
  await p.click('#sheet-wallet [data-close]');
  await p.click('#tabs [data-tab="receive"]');
  await until(p, () => !!document.querySelector('#f-link') && !document.querySelector('#f-link').disabled, null, 20e3);
  await p.evaluate(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await p.click('#f-link');
  link = await p.evaluate(() => window.__copied || '');
  const q = new URLSearchParams(link.split('#')[1] || '');
  check(q.get('pay') === pqAddr && (q.get('pq') || '').length === 1579, 'the copied link pays the new address and carries the key (1,184 bytes, base64url)', `${(q.get('pq') || '').length} characters`);
  const line = await txt(p, '#f-rlink');
  check(!/pq=[\w-]{20}/.test(line) && /post-quantum key, in the copied link/.test(line), 'the line shown leaves the key out, and says the copied link has it', line.slice(-80));
  noErrors(p, 'scenario 1');
  await L.close(p);
}

console.log('2. a payer opens the link');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env);
  await p.goto(link.replace(/^https?:\/\/[^/]+\//, (await p.evaluate(() => location.origin)) + '/'));
  await until(p, () => !!document.querySelector('#req-pq'), null, 15e3);
  check(/sealed to their key/.test(await txt(p, '#req-pq')), 'the request says what is sent is sealed to their post-quantum key', await txt(p, '#req-pq'));
  check(await p.evaluate(() => !localStorage.getItem('tacit-wei-pq-keys-v1') && !Object.values(localStorage).some((v) => v.length > 2000)), 'the key is kept in this tab only, never in plain storage (it would say whom this browser pays)');
  // the bare address, with no key: said, and paid classically
  const p2 = await L.open(env);
  await p2.goto((await p2.evaluate(() => location.origin)) + '/#pay=' + pqAddr);
  await until(p2, () => !!document.querySelector('#req-pq'), null, 15e3);
  check(await until(p2, () => /not on chain or in this link/.test(document.querySelector('#req-pq')?.textContent || ''), null, 30e3), 'the bare address, the key on chain nowhere: an ordinary memo, which still arrives', await txt(p2, '#req-pq'));
  noErrors(p, 'scenario 2'); noErrors(p2, 'scenario 2, bare address');
  await L.close(p); await L.close(p2);
}

console.log('3. the words on a new device');
{
  const env = mkEnv(); L.lgState(env);
  const p = await L.open(env, {connected: true});
  await signIn(p); await sheet(p);
  check(/Post-quantum privacy\s*off/.test(await pqText(p)), 'a new device starts with it off');
  await p.click('#pq-enter');
  await p.fill('#pq-text', words.slice(0, 23).join(' '));
  await p.click('#pq-use');
  check(/not 24 words/.test(await pqText(p)), '23 words are refused', await pqText(p));
  await p.fill('#pq-text', words.map((w, i) => (i % 5 === 0 ? w.toUpperCase() : w)).join('\n'));
  await p.click('#pq-use');
  await until(p, () => /Post-quantum privacy\s*on/.test(document.querySelector('#w-pq')?.textContent || ''), null, 10e3);
  check(await addr(p) === pqAddr, 'the words turn it on, with the same address as the first device', await addr(p));
  await p.click('#pq-off');
  check(/will not show or spend[\s\S]*written down first/.test(await pqText(p)), '"Forget them here" asks first');
  await p.click('#pq-off-yes');
  await until(p, () => /Post-quantum privacy\s*off/.test(document.querySelector('#w-pq')?.textContent || ''), null, 10e3);
  check(!(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tacit-wei-pq-v1:')))) && (await addr(p)).length < pqAddr.length, 'forgotten: nothing kept, and the address is the one without the key');
  noErrors(p, 'scenario 3');
  await L.close(p);
}

console.log('4. the registry pauses turning it on (bit 8)');
{
  const env = mkEnv(); L.lgState(env); env.regFlags = 256;
  const p = await L.open(env, {connected: true});
  await signIn(p); await sheet(p);
  await until(p, () => /paused/.test(document.querySelector('#w-pq')?.textContent || ''), null, 15e3);
  check(/paused/.test(await pqText(p)) && !(await p.$('#pq-new')) && !!(await p.$('#pq-enter')), 'with bit 8 set: no "Turn it on", but words from another device are still taken', await pqText(p));
  noErrors(p, 'scenario 4');
  await L.close(p);
}

console.log('5. a payer with only the address finds the key on chain (the ERC-5564 announcer)');
{
  const {AbiCoder} = await import('ethers'), {createHash} = await import('node:crypto');
  const q = new URLSearchParams(link.split('#')[1]), ek = Buffer.from(q.get('pq').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const h = createHash('sha256').update(Buffer.concat([Buffer.from('tacit-evm-pool-kem-v1'), ek])).digest();
  const scheme = '0x' + createHash('sha256').update('tacit-evm-pool-kem-v1').digest('hex');
  const topics = ['0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7', scheme, '0x' + '00'.repeat(12) + h.subarray(12).toString('hex')];
  const log = (key) => ({address: '0x55649E01B5Df198D18D95b5cc5051630cfD45564', topics: [...topics, '0x' + '00'.repeat(12) + '77'.repeat(20)], data: AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes'], [key, '0x']), blockNumber: '0x' + (26_450_000).toString(16), transactionHash: '0x' + 'ab'.repeat(32), logIndex: '0x0', removed: false});
  const env = mkEnv(); L.lgState(env); env.C[1].tip = 26_500_000;
  const junk = Buffer.from(ek); junk[5] ^= 1;
  env.announced = [log(junk), log(ek)];   // a made-up announcement under the same topics first: passed over
  const p = await L.open(env);
  await p.goto((await p.evaluate(() => location.origin)) + '/#pay=' + pqAddr);
  check(await until(p, () => /sealed to their key/.test(document.querySelector('#req-pq')?.textContent || ''), null, 30e3), 'the bare address: the key is found on chain (a made-up one under the same topics passed over), and what is sent is sealed to it', await txt(p, '#req-pq'));
  check(env.announceReqs?.length > 0 && env.announceReqs.every((x) => x.length <= 2), 'every read of the announcements asks for all of them: no request names the address', JSON.stringify(env.announceReqs?.map((x) => x.length)));
  const env2 = mkEnv(); L.lgState(env2); env2.C[1].tip = 26_500_000; env2.announced = [log(junk)];
  const p2 = await L.open(env2);
  await p2.goto((await p2.evaluate(() => location.origin)) + '/#pay=' + pqAddr);
  check(await until(p2, () => /not on chain or in this link/.test(document.querySelector('#req-pq')?.textContent || ''), null, 30e3), 'only a made-up announcement: not taken; an ordinary memo, which still arrives', await txt(p2, '#req-pq'));
  const env3 = mkEnv(); L.lgState(env3); env3.C[1].tip = 26_500_000; env3.announced = [log(ek)]; env3.announcedDown = true;
  const p3 = await L.open(env3);
  await p3.goto((await p3.evaluate(() => location.origin)) + '/#pay=' + pqAddr);
  check(await until(p3, () => /could not be looked up/.test(document.querySelector('#req-pq')?.textContent || ''), null, 60e3) && !/not on chain/.test(await txt(p3, '#req-pq')), 'nodes that will not read the announcements: "could not be looked up", never "not on chain"', await txt(p3, '#req-pq'));
  noErrors(p, 'scenario 5'); noErrors(p2, 'scenario 5, made-up'); noErrors(p3, 'scenario 5, unreadable');
  await L.close(p); await L.close(p2); await L.close(p3);
}

console.log('6. paying an address that names a key no one can find: an ordinary memo only on a second press');
{
  const env = mkEnv(); L.lgState(env); env.C[1].deposit(H.PAYER_KEY, E);
  const p = await L.open(env, {connected: true});
  await p.click('#tabs [data-tab="send"]');
  await signIn(p, H.PAYER_KEY);
  await until(p, () => /1(\.0+)? ETH/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3);
  await p.fill('#f-to', pqAddr); await p.fill('#f-amt', '0.1');
  await until(p, () => /asked before/.test(document.querySelector('#form')?.textContent || ''), null, 30e3);
  check(/asked before/.test(await txt(p, '#form')), 'the form says the payer is asked before an ordinary memo', await txt(p, '#form'));
  await until(p, () => !document.querySelector('#f-go')?.disabled, null, 30e3);
  env.relayLog.length = 0;
  await p.click('#f-go');
  await until(p, () => !!document.querySelector('#status [data-plain]'), null, 30e3);
  const said = await txt(p, '#status');
  check(/nothing was sent/.test(said) && /Send with an ordinary memo/.test(said), 'the first press sends nothing, and offers "Send with an ordinary memo"', said);
  check(!env.relayLog.some((x) => x.path.endsWith('/reserve') || x.path.endsWith('/relay')), 'no slot asked for, nothing given to the relay', env.relayLog.map((x) => x.path).join(' '));
  await p.click('#status [data-plain]');
  await p.waitForTimeout(3000);
  const then = await txt(p, '#status');
  // past the gate it goes on to prove (here the proving key is not served, so it stops there)
  check(!/nothing was sent/.test(then) && !(await p.$('#status [data-plain]')) && /proving key|Sent .* privately/i.test(then), 'the second press, on that button, goes ahead with the payment (on to proving it)', then);
  noErrors(p, 'scenario 6');
  await L.close(p);
}

console.log('7. a withdrawal address being typed goes to no node; it is checked at the press');
{
  const env = mkEnv(); L.lgState(env); env.C[1].deposit(H.KEY, E);
  const p = await L.open(env, {connected: true});
  await p.click('#tabs [data-tab="withdraw"]');
  await signIn(p);
  await until(p, () => /1(\.0+)? ETH/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3);
  const dest = '0x' + '5e'.repeat(20), codes = () => (env.C[1].codeReads || []).filter((a) => a === dest).length, n0 = codes();
  await p.fill('#f-wto', dest); await p.fill('#f-wamt', '0.1');
  await p.waitForTimeout(2500);
  check(codes() === n0, 'typing it asks no node for its code', `${codes() - n0} reads`);
  await until(p, () => !document.querySelector('#f-go')?.disabled, null, 20e3);
  await p.click('#f-go');
  check(await (async () => { for (let i = 0; i < 40 && codes() === n0; i++) await p.waitForTimeout(250); return codes() > n0; })(), 'the press checks it', `${codes() - n0} reads`);
  noErrors(p, 'scenario 7');
  await L.close(p);
}

console.log('8. the relays: the open RelayRegistry is read in bulk, and flag bit 3 stops it');
for (const [flags, reads] of [[0, true], [8, false]]) {
  const env = mkEnv(); L.lgState(env); env.regFlags = flags; env.C[1].deposit(H.KEY, E);
  env.relayList = [{relayer: '0x' + 'a1'.repeat(20), url: 'https://listed.example/1/evm-pool/keeper'}];
  const p = await L.open(env, {connected: true});
  await p.click('#tabs [data-tab="send"]');
  await signIn(p);
  await until(p, () => /1(\.0+)? ETH/.test(document.querySelector('#bal')?.textContent || ''), null, 30e3);
  await p.waitForTimeout(3000);
  const n = (env.relayReads || []).length;
  check(reads ? n > 0 && env.relayReads.every((s) => s === '0xd4d25113') : n === 0, reads ? 'the list is asked of the registry, only as list(chain, start, max)' : 'with bit 3 set, the registry is not read', `${n} reads`);
  noErrors(p, `scenario 8, flags ${flags}`);
  await L.close(p);
}

await L.shutdown();
console.log(`\n${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s (${process.env.PAGE || 'built page'})`);
process.exit(fail ? 1 : 0);
