/* Runs the real dapp/page.html in jsdom against mainnet.
   No stubs on the read path: every number below came off the chain through the
   page's own decoders. Checks the three things that are easy to break and
   impossible to notice - the list, the funder scan, and the cached first paint.

   Usage: node test/dapp/poidh.smoke.mjs                                     */
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const HTML = fs.readFileSync('dapp/page.html', 'utf8');
const RPC = 'https://ethereum.publicnode.com';   // deliberately a "state only" node
const FUNDER = '0x7876d1aa2fb4311f84a9ba0a8cf816eb5223d5c2'; // funded #24 with 0.125
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!cond) failures++;
};

function open(seed = {}) {
  const errs = [], calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://0x000000db0f2627bce21b594ea67b8f685812ba1d.w4eth.io/',
    beforeParse(w) {
      w.localStorage.setItem('poidh:rpc', RPC);
      for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      w.fetch = async (u, o) => {            // counted, so batching can be asserted
        const t = Date.now();
        const r = await fetch(u, o);
        try { const b = JSON.parse(o.body);
          calls.push({m: b.method, ms: Date.now() - t,
            to: (b.params?.[0]?.to || '').slice(0, 10),
            sel: (b.params?.[0]?.data || '').slice(0, 10)}); } catch {}
        return r;
      };
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.scrollTo = () => {};
      w.addEventListener('error', e => errs.push('error: ' + e.message));
      w.addEventListener('unhandledrejection', e =>
        errs.push('reject: ' + (e.reason && e.reason.message || e.reason)));
    }
  });
  return {w: dom.window, d: dom.window.document, errs, calls};
}

/* ---------------------------------------------------------- 1. cold visit */
console.log('\ncold visit, no cache, on a node that refuses eth_getLogs');
const a = open();
await wait(9000);
const rows = a.d.querySelectorAll('#list .b').length;
ok(rows >= 9, 'list renders from state alone', rows + ' rows');
/* Nothing is pinned any more, so the assertion is the rule the page follows
   rather than the bounty it happens to pick today. */
const feat = JSON.parse(await a.w.eval(`(()=>{const b=featuredOf();
  return JSON.stringify(b ? {id: Number(b.id), amt: String(b.amount)} : null)})()`));
const deepest = JSON.parse(await a.w.eval(`JSON.stringify(LIST
  .filter(b => !b.prov && statusOf(b) === "open")
  .map(b => ({id: Number(b.id), amt: String(b.amount)}))
  .sort((x, y) => Number(BigInt(y.amt) - BigInt(x.amt)))[0] || null)`));
ok(feat && deepest && feat.id === deepest.id, 'the deepest open pot is featured',
   feat ? '#' + feat.id + ', ' + feat.amt + ' wei' : 'nothing featured');
ok(a.d.getElementById('feature').textContent.includes('Biggest pot'),
   'and labelled as a pot, not as a pin');
ok(!a.d.querySelector('.pill.new'), 'nothing marked new on a first-ever visit');
ok(a.errs.length === 0, 'no script errors', a.errs.join('; '));

/* the funder scan, on the real account, through the page's own code */
const backing = await a.w.eval(`(async()=>{
  account=${JSON.stringify(FUNDER)};
  await refresh();
  return JSON.stringify({n:mine.backing.length,scanned:mine.scanned,total:mine.total,
    ids:mine.backing.map(x=>Number(x.b.id)),amts:mine.backing.map(x=>String(x.amt))});
})()`);
const b = JSON.parse(backing);
ok(b.scanned === b.total, 'funder scan covered every bounty', b.scanned + '/' + b.total);
ok(b.ids.includes(24), 'found the funded bounty #24', 'ids ' + JSON.stringify(b.ids));
ok(b.amts[0] === '125000000000000000', 'with the right stake', b.amts[0] + ' wei');

/* ---------------------------------------------------- the vote path (#24) */
console.log('\nvote path — bounty #24 must use it (open, has outside funders)');
const vote = JSON.parse(await a.w.eval(`(async()=>{
  account=${JSON.stringify(FUNDER)};
  const b=await readDetail(24n);
  return JSON.stringify({weight:String(b.myWeight),mineAmt:b.mine?String(b.mine.amt):null,
    ext:b.everExternal,open:b.open,voting:String(b.voting),iVoted:b.iVoted});
})()`));
ok(vote.ext === true && vote.open === true, 'acceptClaim is blocked, so a claim must go to a vote');
ok(vote.weight === '125000000000000000', 'voting weight read from the live participant list',
   vote.weight + ' wei');
ok(vote.weight === vote.mineAmt, 'weight equals the stake, not a stale snapshot');

/* The topics are built by the page's own encoders, against a real past vote:
   bounty #14, claim #42, voter 0x4200ac33…, which the chain says cast 0.015 yes. */
const topics = JSON.parse(await a.w.eval(`JSON.stringify([T_VOTECAST,
  "0x"+encAddr("0x4200ac338555e25b20c8fe82ac02a5c8d4e5a5b4"),
  "0x"+encUint(14),"0x"+encUint(42)])`));
const hits = await (await fetch('https://gateway.tenderly.co/public/mainnet', {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({id: 1, jsonrpc: '2.0', method: 'eth_getLogs', params: [{
    address: '0xe731dfadbff20542e10d09d26fc71445c70d4232',
    fromBlock: '0x17ee65d', toBlock: '0x18a207a', topics}]})})).json();
ok(hits.result && hits.result.length === 1, 'page-built VoteCast filter finds a real past vote',
   (hits.result || []).length + ' match');

/* On a node that refuses logs the check must go quiet, not throw or lie. */
const degraded = await a.w.eval(`(async()=>{
  const r=await votedThisRound({id:14n,voting:42n,round:1n,
    votes:{yes:0n,no:0n,deadline:Math.floor(Date.now()/1000)+3600}});
  return JSON.stringify(r);
})()`);
ok(degraded === 'null', 'degrades to "unknown" where logs are refused', degraded);

const cache = a.w.localStorage.getItem('poidh:bounties:v1');
const seen = a.w.localStorage.getItem('poidh:seen:v1');
/* Read from the chain, not written in here: bounty 26 was posted and a pinned
   25 failed a page that was right. */
const COUNT = Number(await a.w.eval('CFG.count'));
ok(COUNT > 0, 'bounty counter read from the chain', COUNT + ' bounties');
ok(JSON.parse(seen).count === COUNT, 'water level recorded', seen);
ok(Object.keys(JSON.parse(cache)).length >= 10, 'immutable half cached',
   Object.keys(JSON.parse(cache)).length + ' bounties');

/* --------------------------------------- 2. return visit, one bounty behind */
const NEWEST = COUNT - 1;                      /* ids are 0-based */
console.log(`\nreturn visit, cache warm, last seen ${NEWEST} of ${COUNT}`);
const c = open({'poidh:bounties:v1': cache,
                'poidh:seen:v1': JSON.stringify({count: NEWEST, at: 0})});
await wait(250);
const early = c.d.querySelectorAll('#list .b').length;
ok(early >= 9, 'list painted from cache before any read returned', early + ' rows in 250ms');

/* The provisional state is asserted on the FUNCTIONS rather than by racing the
   network: on a fast node the live read can land inside 250ms and legitimately
   replace those rows, which made a timing check fail for the page being quick. */
const cachedShape = JSON.parse(await c.w.eval(`(()=>{
  const r=cachedRow(23); if(!r) return null;
  return JSON.stringify({prov:r.prov,amount:String(r.amount),name:r.name,issuer:r.issuer})})()`));
ok(cachedShape && cachedShape.prov === true, 'a cached row is marked provisional');
ok(cachedShape.amount === '0' && cachedShape.name.length > 0,
   'carrying only what cannot change — never a remembered pot', JSON.stringify(cachedShape.name));
const provHtml = await c.w.eval('rowOf(cachedRow(23))');
ok(/b-amt num prov/.test(provHtml) && /···/.test(provHtml) && !/ETH/.test(provHtml),
   'and renders the pot as unknown, never as a stale number',
   (provHtml.match(/b-amt[^>]*>[^<]*/) || [''])[0].slice(0, 34));
await wait(9000);
ok(c.d.querySelectorAll('#list .b-amt.prov').length === 0, 'live read replaced them');
ok(!!c.d.querySelector('#feature .pill.new, #list .pill.new'),
   'bounty #' + NEWEST + ' marked new');
ok(c.d.querySelectorAll('.pill.new').length === 1, 'and only the unseen one',
   c.d.querySelectorAll('.pill.new').length + ' marked');
ok(c.errs.length === 0, 'no script errors', c.errs.join('; '));

/* ------------------------------------------------- 3. batching + decoding */
console.log('\nround-trip budgets — every read is an eth_call, so only a real');
console.log('dependency may cost a second request');
const rt = async fn => { a.calls.length = 0; const v = await fn(); return {n: a.calls.length, v}; };

const MC3 = '0xca11bde0', AGG3 = '0x82ad56cb', LATEST = '0x52bfe789';
const data = c.calls.filter(x => x.to === MC3 && x.sel === AGG3).length;
const lineage = c.calls.filter(x => x.sel === LATEST).length;
ok(data === 2, 'cold load is 2 waves: the counter, then everything it decides', data + ' aggregate3');
ok(lineage === 1, 'plus one lineage read, deliberately not batched with the page data', lineage);
ok(c.calls.length === 3, 'and nothing else is requested at all', c.calls.length + ' requests total');

const ref = await rt(() => a.w.eval(`(async()=>{account=${JSON.stringify(FUNDER)};await refresh()})()`));
ok(ref.n === 3, 'connected refresh in 3 waves — list, own arrays, funder scan all ride together',
   ref.n + ' requests');

const d24 = await rt(() => a.w.eval('readDetail(24n)'));
ok(d24.n === 1, 'a bounty with no claims is one request', d24.n);
const d19 = await rt(() => a.w.eval(`readDetail(19n).then(b=>JSON.stringify(
  {n:b.claims.length,more:b.more,ids:b.claims.map(x=>Number(x.id)),
   acc:b.claims.filter(x=>x.accepted).map(x=>Number(x.id))}))`));
const j19 = JSON.parse(d19.v);
ok(d19.n === 1, 'ten claims still one request (getClaimsByBountyId, not 24 probes)', d19.n);
ok(j19.n === 10, 'all ten decoded from the packed Claim[]', j19.n);
ok(String(j19.ids) === String([...j19.ids].sort((x, y) => y - x)), 'newest first', j19.ids.join(' '));
ok(String(j19.acc) === '71', 'the accepted one is flagged', 'claim #' + j19.acc);

/* Bounty #3 is the only one past ten, so it is the only exercise of the
   fallback the getter forces — its offset cannot reach older claims. */
const d3 = await rt(() => a.w.eval(`readDetail(3n).then(b=>JSON.stringify(
  {n:b.claims.length,ids:b.claims.map(x=>Number(x.id))}))`));
const j3 = JSON.parse(d3.v);
ok(j3.n === 14, 'the 14-claim bounty returns all fourteen', j3.n);
ok(j3.ids.join(' ') === '28 26 25 24 23 22 21 20 19 18 17 16 15 14',
   'in the order the chain holds them, newest first', j3.ids.join(' '));
ok(d3.n <= 3, 'and the overflow costs 3 waves, not one per slot', d3.n + ' requests');

/* --------------------------------------------- 4. the busy guard must lift */
console.log('\nbusy guard — a cancelled transaction must not brick the page');
await a.w.eval('go("new")');
const before = await a.w.eval('$("doNew").hasAttribute("disabled")');
ok(before === false, 'Post bounty is live to begin with', String(before));
/* Exactly what a rejected wallet prompt does: busy on, repaint, busy off,
   repaint. Before the fix the second repaint left every control disabled. */
const after = await a.w.eval('(()=>{busy=true;render();busy=false;render();'
  + 'return $("doNew").hasAttribute("disabled")})()');
ok(after === false, 'and still live after a send that went nowhere', String(after));
const anyStuck = await a.w.eval('document.querySelectorAll(".btn[disabled]").length');
ok(anyStuck === 0, 'no control anywhere is left latched', anyStuck + ' disabled');

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
