/* Payment links across chains, on anvil forks of Ethereum, Base and Robinhood Chain with real proofs. The Ethereum fork
   carries mainnet's real name registry, so a real .wei name is used: its owner is the wallet here (impersonated on the
   fork, nothing real is touched).

   The payee opens a Tacit key and points z0r0z.wei at it from the page, in one transaction. The link built from it
   carries the name. A payer with no Tacit key and only a wallet opens that link, sees the name beside the address it
   resolved to, and pays it on each chain in turn, the page moving the wallet to each chain itself. The payee, with
   the page open, is told when money arrives; a browser that has never seen the key then finds it all on every chain from
   the key and the chains alone. A name that moves between the card and the payment is not paid.

   Usage: node test/dapp/tacit-pay.links.mjs                              (anvil on PATH)
          CHAINS=base,ethereum …                                          (a subset)                                    */
import {startFork, ok, finish, hexKey, CHAINS} from './fork-lib.mjs';

const OWNER = '0x1c0aa8ccd568d90d61659f060d1bfb1e6f855a20', NAME = 'z0r0z.wei';
const names = (process.env.CHAINS || 'ethereum,base,robinhood').split(',');
const WNS = '0x0000000000696760e15f265e828db644a0c242eb';
const lab = await startFork(names, {account: OWNER});
const eth = lab.fork('ethereum') || null;
if (!eth) throw new Error('the name lives on Ethereum: fork it');
const K1 = hexKey(), K2 = hexKey();
const E = 10n ** 15n;

// What the name's finance.tacit record says, read straight from the fork.
const { namehash, AbiCoder, id } = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const record = async (n = NAME) => {
  const r = await eth.rpc('eth_call', [{to: WNS, data: id('text(bytes32,string)').slice(0, 10) + AbiCoder.defaultAbiCoder().encode(['bytes32', 'string'], [namehash(n), 'finance.tacit']).slice(2)}, 'latest']);
  return AbiCoder.defaultAbiCoder().decode(['string'], r)[0];
};
const publishAs = async (tacit1) => eth.rpc('eth_sendTransaction', [{from: OWNER, to: WNS, data: id('setText(uint256,string,string)').slice(0, 10) + AbiCoder.defaultAbiCoder().encode(['uint256', 'string', 'string'], [BigInt(namehash(NAME)), 'finance.tacit', tacit1]).slice(2), gas: '0x7a1200'}]);

console.log('the payee points a real name at their key');
const real = await record();
ok(/^tacit1/.test(real), `${NAME} publishes someone’s address on mainnet already`, real.slice(0, 20) + '…');
const A = await lab.page();
const K1addr = await A.openKey(K1);
ok(real !== K1addr, 'which is not this key’s');
await A.fill('#f-rname', NAME);
await A.waitForFunction(() => /different Tacit address/.test(document.querySelector('#f-rname-note').textContent), null, {timeout: 60e3});
ok(true, 'the page reads it from Ethereum and says the link cannot use it yet');
await A.click('#f-rpub');
await A.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note')?.textContent || '') || document.querySelector('#status .err'), null, {timeout: 120e3});
ok(await record() === K1addr, 'one transaction from the wallet that owns it points the name at this key', (await A.textContent('#status').catch(() => '')).trim());
ok(/points to this address/.test(await A.textContent('#f-rname-note')), 'and the page confirms it');
await A.fill('#f-ramt', '0.002'); await A.fill('#f-rfor', 'fork test');
const link = await A.textContent('#f-rlink');
ok(link.includes(`pay=${NAME}`) && link.includes('amount=0.002') && !link.includes('chain='), 'the link carries the name, the amount and no chain', link);
if (names.includes('base')) await A.chain('base');

console.log('\na payer with only a wallet pays it on every chain');
const B = await (await lab.newContext()).newPage();
B.errors = [];
B.on('pageerror', (e) => B.errors.push(String(e)));
await B.goto(link);
await B.waitForSelector('#req:not([hidden])');
await B.waitForFunction(() => !/Reading/.test(document.querySelector('#req-body').textContent), null, {timeout: 60e3});
const card = (await B.textContent('#req-body')).replace(/\s+/g, ' ');
ok(card.includes(NAME) && card.includes(K1addr.slice(0, 10)) && /0\.002 ETH/.test(card) && /fork test/.test(card), 'the card shows the name, the address it resolved to, the amount and the note', card.slice(0, 160));
ok(await B.$$eval('#req [data-rc]', (b) => b.length) === 3, 'with every chain offered');
await B.click('#req-pay');
await B.waitForFunction(() => /Pay 0\.002 ETH on/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
await B.waitForFunction(() => [...document.querySelectorAll('#req [data-rc]')].every((b) => / ETH/.test(b.textContent)), null, {timeout: 30e3}).catch(() => {});
const chips = await B.$$eval('#req [data-rc]', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
ok(chips.every((t) => /(99\.\d+|100) ETH/.test(t)), 'once its wallet is connected, each chain shows what the wallet holds there', chips.join(' · '));
await B.reload();
await B.waitForSelector('#req-body .req-to');
ok((await B.textContent('#req-body')).includes(NAME), 'a reload keeps the request');
for (const name of ['base', 'robinhood', 'ethereum'].filter((n) => names.includes(n))) {
  const c = CHAINS.find((x) => x.key === name);
  await B.click(`#req [data-rc="${c.chainId}"]`);
  if (/Connect a wallet/.test(await B.textContent('#req-pay'))) { await B.click('#req-pay'); await B.waitForFunction(() => /Pay 0\.002/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3}); }
  const t0 = Date.now();
  await B.click('#req-pay');
  await B.waitForFunction(() => /paid to/.test(document.querySelector('#req-body').textContent) || document.querySelector('#req-status .err'), null, {timeout: 900e3});
  const got = (await B.textContent('#req-body')).replace(/\s+/g, ' ');
  ok(/0\.002 ETH paid to z0r0z\.wei on/.test(got) && got.includes(c.full), `${c.full}: paid 0.002 ETH to the name (${Math.round((Date.now() - t0) / 1000)} s)`, (await B.textContent('#req-status')).trim() || got.slice(0, 100));
  const sent = await B.evaluate(() => window.__wallet.map(([m, ch]) => `${m}@${ch}`).filter((x) => x.startsWith('eth_sendTransaction')));
  ok(sent[sent.length - 1].endsWith('@0x' + c.chainId.toString(16)), `${c.full}: sent from the wallet on that chain, which the page switched to`, sent.join(' '));
  if (name === 'base') {
    // The payee's page is open on Base: it says so within its next read.
    await A.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some((t) => /arrived on Base/.test(t.textContent)), null, {timeout: 120e3}).catch(() => {});
  }
  await B.click('#req-again');
}
if (names.includes('base')) ok(await A.balance('0.002', 90e3) === '0.002', 'the payee’s open page shows the Base payment without being asked');

console.log('\nthe payee, on a browser that has never seen the key');
const C = await lab.page();
await C.openKey(K1);
await C.waitForFunction((n) => [...document.querySelectorAll('#chains small')].filter((s) => /^0\.002 ETH$/.test(s.textContent.trim())).length >= n, names.length, {timeout: 600e3}).catch(() => {});
const seen = await C.$$eval('#chains small', (x) => x.map((e) => e.textContent.trim()));
ok(CHAINS.filter((c) => names.includes(c.key)).every((c) => seen[CHAINS.indexOf(c)] === '0.002 ETH'), 'finds 0.002 ETH on each chain from the key and the chains alone, with no relay', seen.join(' · '));

console.log('\na name that moves between the card and the payment');
await B.click('#req-done').catch(() => {});
await B.goto(link);
await B.waitForSelector('#req-pay');
const before = await B.evaluate(() => window.__wallet.filter(([m]) => m === 'eth_sendTransaction').length);
await B.waitForFunction(() => /Pay 0\.002/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3}).catch(async () => { await B.click('#req-pay'); });
await B.waitForFunction(() => /Pay 0\.002/.test(document.querySelector('#req-pay')?.textContent || ''), null, {timeout: 30e3});
const K2addr = await (await lab.page()).openKey(K2);
await publishAs(K2addr);
ok(await record() === K2addr, 'the owner points the name somewhere else');
await B.click('#req-pay');
await B.waitForFunction(() => /now points somewhere else/.test(document.querySelector('#req-status').textContent) || /paid to/.test(document.querySelector('#req-body').textContent), null, {timeout: 120e3});
ok(/now points somewhere else, so nothing was sent/.test(await B.textContent('#req-status')), 'it is not paid', (await B.textContent('#req-status')).trim());
ok(await B.evaluate(() => window.__wallet.filter(([m]) => m === 'eth_sendTransaction').length) === before, 'and the wallet was never asked to send');
ok(!B.errors.length, 'no page errors', B.errors.join(' | '));
ok(!A.errors.length, 'no page errors on the payee’s page', A.errors.join(' | '));
finish(() => lab.close());
