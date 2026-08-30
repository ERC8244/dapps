/* Runs the real dapp/page.html in jsdom with the chain unplugged.
   Four documents became four fragment routes and one control was added to the
   page that was not in any of them, so this checks the parts of the page that
   are ours: every route resolves and paints, every page's own script starts
   only when its route is first shown, and the endpoint panel opens, validates,
   and closes three different ways.

   Nothing here touches the network - a page that only works with a healthy
   node is not what this asserts.

   Usage: node test/dapp/fwa.routes.mjs                                      */
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const HTML = fs.readFileSync('dapp/page.html', 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

const errors = [];
const console_ = new VirtualConsole();
console_.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  url: 'https://0x1111111111111111111111111111111111111111.w4eth.io/',
  virtualConsole: console_,
  beforeParse(w) {
    // The chain is refused, not absent: this is the state a reader is in when
    // every endpoint is down, and the page still has to be a page.
    w.fetch = async () => { throw new Error('offline'); };
  },
});
const {window} = dom;
const d = window.document;
const $ = id => d.getElementById(id);
const shown = () => [...d.querySelectorAll('.route')].filter(r => r.classList.contains('is-active')).map(r => r.id).join(',');
const go = async hash => {
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await wait(60);
};

await wait(250);

console.log('routes');
ok(shown() === 'route-home', 'no fragment lands on the hub', shown());
ok(d.title === 'fwa.wei — Community Hub', 'the hub sets its own title', d.title);
ok(d.body.className === '', 'the hub carries no body class');
for (const [hash, route, title, body] of [
  ['#/impact', 'route-impact', 'FWA Mainchain Impact — fwa.wei', 'impact-page'],
  ['#/buybacks', 'route-buybacks', 'FWA Buyback Tracker — fwa.wei', 'buyback-page'],
  ['#/fwair', 'route-fwair', 'FWAIR — fwa.wei', 'impact-page'],
  ['#/home', 'route-home', 'fwa.wei — Community Hub', ''],
]) {
  await go(hash);
  ok(shown() === route && d.title === title && d.body.className === body,
    `${hash} shows one route, its title and its body class`, `${shown()} / ${d.title}`);
}
await go('#/nonsense');
ok(shown() === 'route-home', 'an unknown route falls back to the hub rather than a blank page');
await go('#/home/collections');
ok(shown() === 'route-home' && !!$('collections'), 'a route-scoped anchor keeps its route');

console.log('the page itself');
await go('#/home');
ok(d.querySelectorAll('#collectionList .collection-item').length === 12,
  'the directory paints its first twelve without a chain', d.querySelectorAll('#collectionList .collection-item').length);
ok($('collectionCount').textContent === '62', 'the collection count is the launch configuration', $('collectionCount').textContent);
const search = $('collectionSearch');
search.value = 'milady';
search.dispatchEvent(new window.Event('input'));
ok(d.querySelectorAll('#collectionList .collection-item').length === 1
  && d.querySelector('#collectionList b').textContent === 'Miladys', 'the directory filters');
search.value = '';
search.dispatchEvent(new window.Event('input'));

ok(!/fwa\.eth/.test(HTML), 'no fwa.eth survives anywhere in the page');
ok(!/Resolved through ENS|Published on IPFS/.test(HTML), 'the provenance line names Ethereum and WNS');
ok(d.querySelectorAll('a[href="https://eip.tools/eip/8244"]').length >= 4,
  'every route links ERC-8244', d.querySelectorAll('a[href="https://eip.tools/eip/8244"]').length);
ok(d.querySelectorAll('[data-page-origin]').length === 4, 'every route has a line for the contract that served it');
ok([...d.querySelectorAll('[data-page-newer]')].every(el => el.hidden),
  'the newer-version link stays hidden until a successor says otherwise');
ok(/\.route\{display:none\}/.test(HTML) && /\[hidden\]\{display:none!important\}/.test(HTML),
  'hidden beats every class rule in the document');

console.log('the reader’s endpoints');
const list = window.__FWA_RPC_ENDPOINTS;
ok(Array.isArray(list) && list.length === 7, 'the public list is seeded before any page script runs', list?.length);
ok(list.every(e => /^https:\/\//.test(e.url)), 'every default is https');
ok($('rpcModal').hidden, 'the panel starts closed');
$('rpcOpen').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
await wait(60);
ok(!$('rpcModal').hidden, 'the button opens it');
ok(d.querySelectorAll('.nodes-row').length === 7, 'one row per endpoint', d.querySelectorAll('.nodes-row').length);
ok(d.querySelectorAll('.nodes-row input:checked').length === 7, 'all of them start selected');

const field = $('rpcNew');
field.value = 'not a url';
$('rpcAdd').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
await wait(40);
ok(/not an http/i.test($('rpcNote').textContent) && d.querySelectorAll('.nodes-row').length === 7,
  'a bad endpoint is refused and says why', $('rpcNote').textContent);
field.value = 'https://my-node.example/rpc';
$('rpcAdd').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
await wait(60);
ok(d.querySelectorAll('.nodes-row').length === 8
  && d.querySelector('.nodes-row').classList.contains('is-custom'), 'their own endpoint goes to the top');
d.querySelector('.nodes-drop').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
await wait(40);
ok(d.querySelectorAll('.nodes-row').length === 7, 'and can be taken back out');
ok(d.querySelectorAll('.nodes-row.is-custom .nodes-drop').length === 0
  || [...d.querySelectorAll('.nodes-row:not(.is-custom)')].length === 7, 'a default cannot be dropped, only unticked');

$('rpcClose').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
ok($('rpcModal').hidden, 'the close button closes it');
$('rpcOpen').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
ok($('rpcModal').hidden, 'Escape closes it');
$('rpcOpen').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
$('rpcModal').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
ok($('rpcModal').hidden, 'clicking the backdrop closes it');

ok(errors.length === 0, 'the page throws nothing with every endpoint refused', errors[0] || '');

console.log(failures ? `\n${failures} FAILED` : '\nfwa.routes: all passed');
process.exit(failures ? 1 : 0);
