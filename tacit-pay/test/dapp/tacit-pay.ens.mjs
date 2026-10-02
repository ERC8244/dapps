/* A .eth name as a payee, on an anvil fork of Ethereum with the real name registry: the name's owner (impersonated on the
   fork, nothing real is touched) sets its finance.tacit text record to a Tacit key's address, and the page resolves it
   through the registry and the name's resolver, shows it on a payment request, and puts it in a payment link.

   Usage: node test/dapp/tacit-pay.ens.mjs                                                                          */
import {startFork, ok, finish, hexKey} from './fork-lib.mjs';

const {namehash, AbiCoder, id} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
const NAME = 'ens.eth', REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
// The wallet on the page is the name's owner (impersonated on the fork), so the page can publish to it.
const OWNER = '0xb6E040C9ECAaE172a89bD561c5F73e1C48d28cd9';
const lab = await startFork(['ethereum'], {account: OWNER.toLowerCase()});
const eth = lab.fork('ethereum');
const coder = AbiCoder.defaultAbiCoder();
const node = namehash(NAME);
const call = (to, sig, types, values) => eth.rpc('eth_call', [{to, data: id(sig).slice(0, 10) + coder.encode(types, values).slice(2)}, 'latest']);
const owner = coder.decode(['address'], await call(REGISTRY, 'owner(bytes32)', ['bytes32'], [node]))[0];
const resolver = coder.decode(['address'], await call(REGISTRY, 'resolver(bytes32)', ['bytes32'], [node]))[0];
const setRecord = async (value) => {
  await eth.rpc('anvil_impersonateAccount', [owner]);
  await eth.rpc('anvil_setBalance', [owner, '0x' + (10n ** 18n).toString(16)]);
  const data = id('setText(bytes32,string,string)').slice(0, 10) + coder.encode(['bytes32', 'string', 'string'], [node, 'finance.tacit', value]).slice(2);
  const h = await eth.rpc('eth_sendTransaction', [{from: owner, to: resolver, data, gas: '0x7a1200'}]);
  let rc = null;
  for (let i = 0; i < 40 && !rc; i++) { rc = await eth.rpc('eth_getTransactionReceipt', [h]); if (!rc) await new Promise((r) => setTimeout(r, 500)); }
  if (rc?.status !== '0x1') throw new Error(`could not set the record on the fork: ${JSON.stringify(rc)?.slice(0, 300)}`);
};
const record = async () => coder.decode(['string'], await call(resolver, 'text(bytes32,string)', ['bytes32', 'string'], [node, 'finance.tacit']))[0];

console.log(`${NAME}: owner ${owner.slice(0, 10)}…, resolver ${resolver.slice(0, 10)}…`);
ok(await record() === '', 'it has no finance.tacit record yet');

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
let card = await cardOf(`#pay=${NAME}&amount=0.001`);
ok(/has not published a Tacit address/i.test(card) && !(await B.$('#req-pay')), 'a name with no record cannot be paid, and says why', card.slice(0, 140));

console.log('\nthe owner publishes a Tacit address');
await setRecord(K1addr);
ok(await record() === K1addr, 'the record is set on the name’s own resolver');
card = await cardOf(`#pay=${NAME}&amount=0.001`);
ok(card.includes(NAME) && card.includes(K1addr.slice(0, 10)) && /0\.001 ETH/.test(card), 'the request shows the name beside the address it resolved to', card.slice(0, 160));
ok(await B.$('#req-pay') !== null, 'and can be paid');
card = await cardOf(`#${NAME.toUpperCase()}`);
ok(card.includes(NAME), 'a name typed in capitals reads the same', card.slice(0, 100));

console.log('\nthe payee builds a link with it');
await A.click('#tabs [data-tab="receive"]');
await A.fill('#f-rname', NAME);
await A.waitForFunction(() => /points to this address|different Tacit address|has not published/.test(document.querySelector('#f-rname-note')?.textContent || ''), null, {timeout: 60e3});
ok(/points to this address/.test(await A.textContent('#f-rname-note')), 'the page checks it against the open key', (await A.textContent('#f-rname-note')).trim());
await A.waitForFunction((n) => new RegExp(`#pay=${n.replace('.', '\\.')}&n=`).test(document.querySelector('#f-rlink')?.textContent || ''), NAME, {timeout: 600e3});
ok(true, 'and the link carries the name');

console.log('\nthe record moves');
const K2 = await lab.page(); const K2addr = await K2.openKey(hexKey());
await setRecord(K2addr);
await A.fill('#f-rname', ''); await A.fill('#f-rname', NAME);
await A.waitForFunction(() => /different Tacit address/.test(document.querySelector('#f-rname-note')?.textContent || ''), null, {timeout: 60e3});
ok(!/#pay=ens\.eth/.test(await A.textContent('#f-rlink')), 'a name that now points to another key is not used in the link');

console.log('\nthe payee points it back from the page');
ok(!!(await A.$('#f-rpub')), 'the page offers to point the name at this key');
await A.click('#f-rpub');
await A.waitForFunction(() => /points to this address/.test(document.querySelector('#f-rname-note')?.textContent || '') || document.querySelector('#status .err'), null, {timeout: 120e3});
ok(await record() === K1addr, 'one transaction from the owner’s wallet writes the record to the name’s own resolver', (await A.textContent('#status').catch(() => '')).trim());
ok(/points to this address/.test(await A.textContent('#f-rname-note')), 'and the page confirms it');
ok(!errors.length && !A.errors.length, 'no page errors', [...errors, ...A.errors].join(' | '));
finish(() => lab.close());
