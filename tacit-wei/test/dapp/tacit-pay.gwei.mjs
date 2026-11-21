/* A .gwei name as a payee and as a withdrawal's destination, on an anvil fork of Ethereum with the real GNS (the .gwei
   registry): the name's owner (impersonated on the fork, nothing real is touched) sets its finance.tacit text record to a
   Tacit key's address, and the page reads it from GNS, shows it on a payment request, pays through it, follows it when it
   moves, publishes to it from the owner's wallet, and, as a withdrawal's destination, reads the address the name points to.

   Usage: node test/dapp/tacit-pay.gwei.mjs                                                                         */
import {startFork, ok, finish, hexKey} from './fork-lib.mjs';

const {namehash, AbiCoder, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const NAME = 'tacit.gwei', GNS = '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6';
// A name nobody holds, so its record is empty whatever is on chain when the test runs.
const UNSET = `nr-${Date.now().toString(36)}.gwei`;
const coder = AbiCoder.defaultAbiCoder();
const word = (n) => BigInt(namehash(n));
// Who owns the name changes, so the owner is read from GNS as the test starts; the wallet on the page is that owner.
const ownerOf = async () => {
  const body = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: GNS, data: id('ownerOf(uint256)').slice(0, 10) + coder.encode(['uint256'], [word(NAME)]).slice(2)}, 'latest']});
  for (const u of ['https://mainnet.gateway.tenderly.co', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']) {
    try { const r = (await (await fetch(u, {method: 'POST', headers: {'content-type': 'application/json'}, body})).json()).result; if (/^0x[0-9a-f]{64}$/i.test(r || '')) return '0x' + r.slice(-40); } catch {}
  }
  throw new Error(`could not read who owns ${NAME}`);
};
const OWNER = await ownerOf();
const lab = await startFork(['ethereum'], {account: OWNER.toLowerCase()});
const eth = lab.fork('ethereum');
const call = (sig, types, values) => eth.rpc('eth_call', [{to: GNS, data: id(sig).slice(0, 10) + coder.encode(types, values).slice(2)}, 'latest']);
const owner = coder.decode(['address'], await call('ownerOf(uint256)', ['uint256'], [word(NAME)]))[0];
// On a real chain the owner can carry an EIP-7702 delegation; on the fork it is a plain account that sends.
const code = await eth.rpc('eth_getCode', [owner, 'latest']);
if (/^0xef0100/i.test(code)) await eth.rpc('anvil_setCode', [owner, '0x']);
const pointsTo = coder.decode(['address'], await call('resolve(uint256)', ['uint256'], [word(NAME)]))[0];
const setRecord = async (value) => {
  await eth.rpc('anvil_impersonateAccount', [owner]);
  await eth.rpc('anvil_setBalance', [owner, '0x' + (10n ** 18n).toString(16)]);
  const data = id('setText(uint256,string,string)').slice(0, 10) + coder.encode(['uint256', 'string', 'string'], [word(NAME), 'finance.tacit', value]).slice(2);
  const h = await eth.rpc('eth_sendTransaction', [{from: owner, to: GNS, data, gas: '0x7a1200'}]);
  let rc = null;
  for (let i = 0; i < 40 && !rc; i++) { rc = await eth.rpc('eth_getTransactionReceipt', [h]); if (!rc) await new Promise((r) => setTimeout(r, 500)); }
  if (rc?.status !== '0x1') throw new Error(`could not set the record on the fork: ${JSON.stringify(rc)?.slice(0, 300)}`);
};
const record = async () => coder.decode(['string'], await call('text(bytes32,string)', ['bytes32', 'string'], [namehash(NAME), 'finance.tacit']))[0];

console.log(`${NAME}: owner ${owner.slice(0, 10)}…, points to ${pointsTo.slice(0, 10)}…`);
if (await record()) await setRecord('');
ok(await record() === '', 'it has no finance.tacit record to start from');

const A = await lab.page();
const K1addr = await A.openKey(hexKey());
let B = null;
const errors = [];
const cardOf = async (hash) => {
  await B?.close();                                  // a fresh page: nothing read before is remembered
  B = await (await lab.newContext()).newPage();
  B.on('pageerror', (e) => errors.push(String(e)));
  await B.goto(lab.origin + hash);
  await B.waitForSelector('#req:not([hidden])');
  await B.waitForFunction(() => !/Reading/.test(document.querySelector('#req-body').textContent), null, {timeout: 60e3});
  return (await B.textContent('#req-body')).replace(/\s+/g, ' ');
};

console.log('\nno record');
let card = await cardOf(`#pay=${UNSET}&amount=0.001`);
ok(/has not published a Tacit address/i.test(card) && !(await B.$('#req-pay')), 'a .gwei name with no record cannot be paid, and says why', card.slice(0, 140));
card = await cardOf(`#pay=${NAME}&amount=0.001`);
ok(/has not published a Tacit address/i.test(card) && !(await B.$('#req-pay')), 'so does one that exists and has not published', card.slice(0, 140));

console.log('\nthe owner publishes a Tacit address');
await setRecord(K1addr);
ok(await record() === K1addr, 'the record is set in GNS');
card = await cardOf(`#pay=${NAME}&amount=0.001`);
ok(card.includes(NAME) && card.includes(K1addr.slice(0, 16)) && /0\.001 ETH/.test(card), 'the request shows the name beside the Tacit address it resolved to', card.slice(0, 160));
ok(await B.$('#req-pay') !== null, 'and can be paid');
card = await cardOf(`#${NAME.toUpperCase()}`);
ok(card.includes(NAME) && card.includes(K1addr.slice(0, 16)), 'a name typed in capitals reads the same', card.slice(0, 100));

console.log('\nthe record moves');
const K2 = await lab.page(); const K2addr = await K2.openKey(hexKey());
await setRecord(K2addr);
card = await cardOf(`#pay=${NAME}&amount=0.001`);
ok(card.includes(K2addr.slice(0, 16)) && !card.includes(K1addr.slice(0, 16)), 'a fresh read follows the name to the new address', card.slice(0, 160));

console.log('\nthe payee points it back from the page');
await A.click('#tabs [data-tab="receive"]');
await A.evaluate(() => { document.querySelector('#f-ropts').open = true; });
await A.fill('#f-rname', NAME);
await A.waitForFunction(() => /points to this address|different Tacit address|has no Tacit address/.test(document.querySelector('#f-rname-note')?.textContent || ''), null, {timeout: 60e3});
ok(/different Tacit address/.test(await A.textContent('#f-rname-note')), 'the page sees the name points to another key', (await A.textContent('#f-rname-note')).trim());
ok(!!(await A.$('#f-rpub')), 'and offers to point the name at this key');
await A.click('#f-rpub');
await A.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note')?.textContent || '') || document.querySelector('#status .err'), null, {timeout: 120e3});
ok(await record() === K1addr, 'one transaction from the owner’s wallet writes the record to GNS', (await A.textContent('#status').catch(() => '')).trim());
ok(/points to this address/.test(await A.textContent('#f-rname-note')), 'and the page confirms it');

console.log('\nas a withdrawal’s destination');
await A.click('#tabs [data-tab="withdraw"]');
await A.fill('#f-wto', NAME);
await A.waitForFunction(() => /tacit\.gwei · 0x/.test(document.querySelector('#f-rcpt')?.textContent || '') || /err/.test(document.querySelector('#f-rcpt')?.innerHTML || ''), null, {timeout: 60e3});
const rcpt = (await A.textContent('#f-rcpt')).replace(/\s+/g, ' ');
ok(rcpt.includes(NAME) && rcpt.toLowerCase().includes(pointsTo.toLowerCase()), 'the address record the name points to is the exit address (not its text record)', rcpt.slice(0, 160));
ok(!rcpt.includes(K1addr.slice(0, 16)), 'and the Tacit address in its text is not used as one');
ok(!errors.length && !A.errors.length, 'no page errors', [...errors, ...A.errors].join(' | '));
finish(() => lab.close());
