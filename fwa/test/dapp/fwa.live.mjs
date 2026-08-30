/* Runs the real dapp/page.html in jsdom against mainnet.
   No stubs on the read path: every number below came off the chain through the
   page's own decoders, over the same public endpoints the page ships with.

   It checks the three readings that are worth a round trip - the current king,
   the mainchain impact page, and the buyback tracker - because each is a
   different shape of read (contract state, a 24-hour log scan, an indexed
   history) and each has failed in a different way.

   Slow on purpose: the impact page walks a day of logs and an hour of receipts,
   which takes a couple of minutes on public nodes.

   Usage: node test/dapp/fwa.live.mjs                                        */
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const HTML = fs.readFileSync('dapp/page.html', 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

const quiet = new VirtualConsole();
const open = () => {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://fwa.wei.limo/',
    virtualConsole: quiet,
    beforeParse(w) {
      // Node's fetch, and Node's AbortController with it: the page aborts its
      // own requests on a timeout, and node rejects a signal it did not make.
      w.fetch = (u, o) => fetch(u, o);
      w.AbortController = AbortController;
      w.TextDecoder = TextDecoder;
      w.TextEncoder = TextEncoder;
      // A reader arriving fresh, with nothing remembered from a previous visit.
      w.localStorage.clear();
    },
  });
  return dom.window;
};

/* The page paints as soon as each section resolves, so the test waits for the
   text to stop saying "—" rather than for a fixed number of seconds. */
const settle = async (window, id, seconds, done = t => t && t !== '—') => {
  for (let i = 0; i < seconds * 2; i++) {
    const el = window.document.getElementById(id);
    if (el && done(el.textContent.trim())) return el.textContent.trim();
    await wait(500);
  }
  return window.document.getElementById(id)?.textContent.trim() ?? '';
};

const route = async (window, hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await wait(100);
};

const ETH = /^[\d,]+(\.\d+)?\s*Ξ$/;

console.log('the current king  (contract state, then one tokenURI)');
{
  const window = open();
  const asset = await settle(window, 'kingAsset', 60, t => t && !/^Loading/.test(t));
  const backing = await settle(window, 'kingBacking', 30);
  const odds = await settle(window, 'kingOdds', 10);
  const meta = window.document.getElementById('kingMeta').textContent.trim();
  ok(!/unavailable/i.test(asset), 'the top listing reads from the chain', asset);
  ok(ETH.test(backing), 'its backing decodes as ether', backing);
  ok(/%$/.test(odds), 'its odds decode as a share of total weight', odds);
  ok(/LISTING #\d+/.test(meta), 'it names the listing it read', meta);
  window.close();
}

console.log('mainchain impact  (protocol state, a day of logs, an hour of receipts)');
{
  const window = open();
  await route(window, '#/impact');
  const created = await settle(window, 'metricPositionsCreated', 90);
  const active = await settle(window, 'metricActivePositions', 30);
  const price = await settle(window, 'metricPullPrice', 30);
  ok(/^[\d,]+$/.test(created), 'positions created is a number from contract storage', created);
  ok(/^[\d,]+$/.test(active), 'active positions is a number from contract storage', active);
  ok(ETH.test(price), 'the acquisition price quotes in ether', price);

  const pulls = await settle(window, 'metricPulls24', 180);
  const flow = await settle(window, 'metricEthFlow24', 30);
  ok(/^[\d,]+$/.test(pulls), 'the 24-hour log scan completed', pulls);
  ok(ETH.test(flow), 'and its ether flow decoded', flow);

  const tx = await settle(window, 'metricTx1h', 180);
  const burn = await settle(window, 'metricBurn1h', 30);
  ok(/^[\d,]+$/.test(tx), 'the one-hour footprint completed', tx);
  ok(ETH.test(burn), 'and its burn decoded from real base fees', burn);
  window.close();
}

console.log('buyback tracker  (indexed history, both programs)');
{
  const window = open();
  await route(window, '#/buybacks');
  const executions = await settle(window, 'protocolExecutions', 120);
  const spent = await settle(window, 'protocolEthSpent', 30);
  const bought = await settle(window, 'protocolFwaBought', 30);
  ok(/^[\d,]+$/.test(executions) && Number(executions.replace(/,/g, '')) > 0,
    'the protocol pipeline has executions', executions);
  ok(ETH.test(spent), 'its ether spent decoded', spent);
  ok(/FWA$/.test(bought), 'its FWA bought decoded', bought);

  // The figure the hosted site leaves blank on every load.
  const retro = await settle(window, 'retroFwaBought', 120);
  const slices = await settle(window, 'retroExecutions', 30);
  ok(/FWA$/.test(retro), 'the retroactive program reports what it bought', retro);
  ok(/^[\d,]+$/.test(slices), 'and how many slices it executed', slices);

  const rows = window.document.querySelectorAll('#buybackFeed .buyback-feed-row').length;
  ok(rows > 0, 'the execution feed has rows', rows);
  window.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nfwa.live: all passed');
process.exit(failures ? 1 : 0);
