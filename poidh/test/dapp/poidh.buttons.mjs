/* Presses every control in dapp/poidh/page.html against a MOCK wallet and
   decodes the transaction each one would have broadcast. Reads are real
   (mainnet, through a public node); only the signing end is faked, so the
   button -> calldata path is exercised exactly as a user would exercise it,
   without spending anything.

   Usage: node test/dapp/poidh.buttons.mjs                                   */
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {execSync} from 'node:child_process';

const HTML = fs.readFileSync('dapp/poidh/page.html', 'utf8');
const RPC = 'https://ethereum.publicnode.com';
const POIDH = '0xe731dfadbff20542e10d09d26fc71445c70d4232';
const ISSUER = '0x1c0aa8ccd568d90d61659f060d1bfb1e6f855a20';  // posted #24
const FUNDER = '0x7876d1aa2fb4311f84a9ba0a8cf816eb5223d5c2';  // funded #24 with 0.125
const STRANGER = '0x00000000000000000000000000000000000000aa';
const OWED = '0x9fd25b6be40aecea5eb5eceea31d6c0ac9c83e11';   // never claimed its refund from #11
const wait = ms => new Promise(r => setTimeout(r, ms));

let failures = 0, sent = null;
const ok = (c, msg, extra) => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!c) failures++;
};
/* `cast calldata-decode` decodes from byte 4 and never looks at the selector,
   so it will happily read createSoloBounty's calldata against createOpenBounty's
   signature. The selector is therefore checked here, separately, against keccak
   of the signature being claimed - otherwise "it decoded" proves only that the
   arguments were the right shape, not that the right function was called. */
const selOf = sig => execSync(`cast sig "${sig}"`).toString().trim();
const dec = (sig, data) => {
  if (!data) return 'NOTHING SENT';
  const want = selOf(sig);
  if (data.slice(0, 10).toLowerCase() !== want.toLowerCase())
    return `WRONG SELECTOR ${data.slice(0, 10)} (expected ${want} for ${sig})`;
  try { return execSync(`cast calldata-decode "${sig}" ${data}`).toString().trim().replace(/\n+/g, ' | '); }
  catch { return 'DECODE FAILED'; }
};

let persona = ISSUER;
const dom = new JSDOM(HTML, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.w4eth.io/',
  beforeParse(w) {
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    w.scrollTo = () => {}; w.confirm = () => true;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const rpc = async (method, params) => {
      const r = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({id: 1, jsonrpc: '2.0', method, params: params || []})});
      const j = await r.json();
      if (j.error) throw Error(j.error.message);
      return j.result;
    };
    /* A wallet that approves everything and remembers what it was handed. */
    w.ethereum = {
      request: async ({method, params}) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [persona];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'eth_sendTransaction') { sent = params[0]; return '0x' + 'ab'.repeat(32); }
        if (method === 'eth_getTransactionReceipt') return {status: '0x1'};
        return rpc(method, params);
      },
      on: () => {},
    };
    w.fetch = (...a) => fetch(...a);
  }
});
const w = dom.window, d = w.document;
const $ = s => d.querySelector(s);
/* Presses a control and returns the transaction it produced, or null. */
const press = async sel => {
  sent = null;
  const el = $(sel);
  if (!el) return {missing: true};
  if (el.hasAttribute('disabled')) return {disabled: true};
  el.click();
  await wait(1200);
  return sent ? {to: sent.to, data: sent.data, value: BigInt(sent.value || '0x0')} : {none: true};
};
const asPersona = async (who, fn) => { persona = who; await w.eval(`(async()=>{account=${JSON.stringify(who)};await refresh()})()`); return fn(); };

await wait(9000);
console.log('connected as the issuer of #24:', await w.eval('account'));

/* ------------------------------------------------------------- navigation */
console.log('\nnavigation — no transaction, just state');
$('#burger').click();
ok(!$('#navov').classList.contains('hide'), 'burger opens the full-screen menu');
$('#navx').click();
ok($('#navov').classList.contains('hide'), 'the X closes it');
$('#tNew').click(); await wait(200);
ok(!$('#pNew').classList.contains('hide'), 'POST tab shows the form');
$('#tMine').click(); await wait(200);
ok(!$('#pMine').classList.contains('hide'), 'MINE tab shows the account view');
$('#tList').click(); await wait(300);
ok(!$('#pList').classList.contains('hide') && !$('#hero').classList.contains('hide'),
   'BOUNTIES tab returns to the list and its hero');
const kind = d.querySelectorAll('#kind button');
kind[1].click();
ok(await w.eval('newKind') === 'solo', 'Kind: Solo selects');
kind[0].click();
ok(await w.eval('newKind') === 'open', 'Kind: Open selects back');
$('#list .b').click(); await wait(2500);
ok(!$('#pB').classList.contains('hide'), 'a list row opens that bounty');
$('#back').click(); await wait(400);
ok(!$('#pList').classList.contains('hide'), 'back returns to the list');
const more = await w.eval('(()=>{const n=LIST.length;$("more").click();return n})()');
await wait(2500);
ok(await w.eval('LIST.length') > more, 'Load older pages further back',
   more + ' -> ' + (await w.eval('LIST.length')));

/* --------------------------------------------------------- writes: issuer */
console.log('\nas the ISSUER of #24 — every button decoded from what it sent');
await w.eval('go("b",24n)'); await wait(2500);
let tx = await press('#doCancel');
ok(tx.to === POIDH && dec('cancelOpenBounty(uint256)', tx.data) === '24',
   'Cancel the bounty -> cancelOpenBounty(24)', tx.data ? tx.data.slice(0, 10) : JSON.stringify(tx));
ok(tx.value === 0n, 'and sends no value', String(tx.value));
ok(await press('#doJoin').then(r => r.missing), 'the issuer is not offered Fund it (WrongCaller)');
ok(await press('#doPull').then(r => r.missing), 'nor Take back (IssuerCannotWithdraw)');
ok(await press('#doClaim').then(r => r.missing), 'nor Claim it (IssuerCannotClaim)');

/* --------------------------------------------------------- writes: funder */
console.log('\nas a FUNDER of #24');
await asPersona(FUNDER, async () => { await w.eval('go("b",24n)'); return wait(2500); });
await w.eval('$("joinAmt").value="0.05"');
tx = await press('#doJoin');
ok(dec('joinOpenBounty(uint256)', tx.data) === '24', 'Fund it -> joinOpenBounty(24)');
ok(tx.value === 50000000000000000n, 'carrying the ETH typed into the field', tx.value + ' wei');
tx = await press('#doPull');
ok(dec('withdrawFromOpenBounty(uint256)', tx.data) === '24',
   'Take back your stake -> withdrawFromOpenBounty(24)');
ok(await press('#doCancel').then(r => r.missing), 'a funder is not offered Cancel (WrongCaller)');
await w.eval('$("cTitle").value="I built it";$("cDesc").value="proof";$("cUri").value="ipfs://QmProof"');
tx = await press('#doClaim');
ok(dec('createClaim(uint256,string,string,string)', tx.data)
   === '24 | "I built it" | "proof" | "ipfs://QmProof"', 'Submit the claim -> createClaim(...)');
ok(tx.value === 0n, 'and sends no value with it', String(tx.value));

/* ------------------------------------------------------------ the ballot */
console.log('\nthe ballot — no live vote on chain, so one is staged in the page');
/* A send that succeeds calls refresh(), which re-reads the bounty from chain
   and drops anything staged here — so the ballot is re-staged before each
   press rather than assumed to survive the last one. */
const stageVote = (over = '') => w.eval(`(()=>{const now=Math.floor(Date.now()/1000);
 detail.voting=83n;detail.round=1n;detail.iVoted=false;
 detail.votes={yes:100000000000000000n,no:0n,deadline:now+3600};${over}render()})()`);
await stageVote();
tx = await press('[data-vote="1"]');
ok(dec('voteClaim(uint256,bool)', tx.data) === '24 | true', 'Vote for -> voteClaim(24, true)');
await stageVote();
tx = await press('[data-vote="0"]');
ok(dec('voteClaim(uint256,bool)', tx.data) === '24 | false', 'Vote against -> voteClaim(24, false)');
await stageVote();
ok(await press('#doResolve').then(r => r.missing), 'Resolve is hidden while the deadline stands');
await stageVote('detail.votes.deadline=now-1;');
tx = await press('#doResolve');
ok(dec('resolveVote(uint256)', tx.data) === '24', 'once it has passed, Resolve -> resolveVote(24)');
await stageVote('detail.iVoted=true;');
ok(!$('[data-vote="1"]'), 'and someone who already voted is offered no ballot at all');
await stageVote('detail.myWeight=0n;');
ok(!$('[data-vote="1"]'), 'nor does someone who held no stake when it opened');

/* ------------------------------------------- accept / put-to-vote on claims */
/* Two live bounties sit on opposite sides of the rule that decides this, so
   neither case has to be invented: #21 has taken outside funding and must go
   to a vote; #20 has not, so its issuer may still accept a claim alone. */
console.log('\nclaim controls — the everHadExternalContributor rule, on real bounties');
await asPersona(STRANGER, async () => { await w.eval('go("b",21n)'); return wait(2500); });
ok(!$('[data-accept]') && !$('[data-submit]'), 'a stranger gets neither Accept nor Put to a vote');

/* The issuer is read from the bounty on screen, and the claim id from the
   button itself, so this keeps testing the right thing as claims are added. */
const issuerOf = async id => {
  await asPersona(STRANGER, async () => { await w.eval(`go("b",${id}n)`); return wait(2500); });
  return w.eval('detail.issuer');
};

await asPersona(await issuerOf(21), async () => { await w.eval('go("b",21n)'); return wait(2500); });
ok(await w.eval('detail.everExternal') === true, '#21 has taken outside funding');
let cid = $('[data-submit]') && $('[data-submit]').dataset.submit;
tx = await press('[data-submit]');
ok(dec('submitClaimForVote(uint256,uint256)', tx.data) === `21 | ${cid}`,
   `so its issuer gets Put to a vote -> submitClaimForVote(21, ${cid})`,
   tx.data ? tx.data.slice(0, 10) : JSON.stringify(tx));
ok(!$('[data-accept]'), 'and NOT Accept — the contract would revert NotSoloBounty');

await asPersona(await issuerOf(20), async () => { await w.eval('go("b",20n)'); return wait(2500); });
ok(await w.eval('detail.everExternal') === false, '#20 has not');
cid = $('[data-accept]') && $('[data-accept]').dataset.accept;
tx = await press('[data-accept]');
ok(dec('acceptClaim(uint256,uint256)', tx.data) === `20 | ${cid}`,
   `so its issuer gets Accept & pay -> acceptClaim(20, ${cid})`,
   tx.data ? tx.data.slice(0, 10) : JSON.stringify(tx));
ok(!$('[data-submit]'), 'and no ballot, because none is needed');
ok(cid === $('.claim [data-accept]').dataset.accept,
   'and the button carries the claim it sits on', 'claim #' + cid);

/* --------------------------------------------------- withdraw + post + pic */
/* Bounty #11 was cancelled with one funder's stake still in it — a real
   unclaimed refund, so this path needs nothing staged. */
console.log('\nrefund from a cancelled bounty (#11, a real unclaimed stake)');
await asPersona(OWED, async () => { await w.eval('go("b",11n)'); return wait(2500); });
ok(await w.eval('statusOf(detail)') === 'cancelled', '#11 is cancelled');
ok(await w.eval('detail.mine?String(detail.mine.amt):"0"') === '400000000000000',
   'and this account still has a stake in it', '0.0004 ETH');
tx = await press('#doRefund');
ok(dec('claimRefundFromCancelledOpenBounty(uint256)', tx.data) === '11',
   'Claim your refund -> claimRefundFromCancelledOpenBounty(11)',
   tx.data ? tx.data.slice(0, 10) : JSON.stringify(tx));
ok(!$('#doJoin') && !$('#doClaim'),
   'and a cancelled bounty offers no funding or claiming at all');
await asPersona(STRANGER, async () => { await w.eval('go("b",11n)'); return wait(2500); });
ok(!$('#doRefund'), 'someone with no stake in it is offered no refund');

console.log('\nthe rest');
await asPersona(ISSUER, async () => { await w.eval('go("mine")'); return wait(600); });
const owed = await w.eval('String(pending)');
ok(owed === '0' ? !$('#doWd') : true, 'Withdraw is absent when nothing is owed', owed + ' wei owed');
await w.eval(`(()=>{pending=1234n;render()})()`);
tx = await press('#doWd');
ok(tx.data === '0x3ccfd60b', 'and when something is, Withdraw -> withdraw()', tx.data);
await w.eval('go("new")'); await wait(300);
await w.eval('$("nTitle").value="Ship it";$("nDesc").value="with a picture";$("nAmt").value="0.01"');
tx = await press('#doNew');
ok(dec('createOpenBounty(string,string)', tx.data) === '"Ship it" | "with a picture"',
   'Post bounty (Open) -> createOpenBounty(...)');
ok(tx.value === 10000000000000000n, 'with the amount as value', tx.value + ' wei');
/* Posting clears the form and jumps to the new bounty, so the solo case is
   set up again from scratch rather than pressed on the leftovers. */
await w.eval('go("new")'); await wait(300);
d.querySelectorAll('#kind button')[1].click();
await w.eval('$("nTitle").value="Ship it";$("nDesc").value="with a picture";$("nAmt").value="0.01"');
tx = await press('#doNew');
ok(dec('createSoloBounty(string,string)', tx.data) === '"Ship it" | "with a picture"',
   'Post bounty (Solo) -> createSoloBounty(...)');
/* By this point the harness has made a lot of requests; a public node can
   start refusing. Retry rather than crash, so a rate limit cannot look like a
   broken control. */
for (let i = 0; i < 4 && !$('[data-pic]'); i++) {
  await w.eval('go("b",6n)'); await wait(2500);
}
ok(!!$('[data-pic]'), 'a claim with a picture offers the control');
$('[data-pic]').click(); await wait(4000);
const shot = $('.claim .shot');
ok(/img|Could not|No picture|not one this page/.test(shot.innerHTML),
   'Show the picture resolves to an image or an honest failure',
   (shot.querySelector('img') ? 'rendered an <img>' : shot.textContent.trim().slice(0, 40)));

/* ------------------------------------------------------- connect + status */
console.log('\nconnecting, and what the page says about it');

/* A wallet that announces itself AFTER load — the case that made connecting
   feel like it only worked the second time. */
await w.eval(`(()=>{account=null;PROV=null;render();
 dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{
   info:{uuid:"late-1",name:"Late Wallet"},provider:window.ethereum}}))})()`);
const p1 = w.eval('connect()');
await wait(400);
const names = [...d.querySelectorAll('#wpList [data-w]')].map(x => x.textContent.trim());
ok(names.includes('Late Wallet'), 'a wallet that announced after load is in the picker',
   names.join(', '));
$('#wpX').click();
await p1;
ok(true, 'and dismissing the picker settles rather than hanging');

/* Press an action while disconnected: it must WAIT for the wallet and then do
   the thing, not throw the action away. */
await w.eval('go("new")'); await wait(300);
d.querySelectorAll('#kind button')[0].click();   // back to Open for this one
await w.eval('$("nTitle").value="Two goes";$("nDesc").value="no more";$("nAmt").value="0.002"');
sent = null;
const posting = w.eval('postBounty()');
await wait(400);
ok(!$('#wpick').classList.contains('hide'), 'pressing Post bounty while disconnected opens the picker');
d.querySelector('#wpList [data-w]').click();
await posting; await wait(1500);
ok(sent && dec('createOpenBounty(string,string)', sent.data) === '"Two goes" | "no more"',
   'and once connected the post goes through WITHOUT pressing again',
   sent ? sent.data.slice(0, 10) : 'nothing sent');

/* A finished message should not outlive the moment it describes. */
await w.eval('setStat("Cancelled.","err")');
ok($('#stat').textContent === 'Cancelled.', 'a rejected prompt says so');
await w.eval('go("list")'); await wait(600);
ok($('#stat').textContent === '', 'and moving to another view clears it');
await w.eval('setStat("Cancelled.","err")');
const cleared = await w.eval(`new Promise(r=>{const t=Date.now();
  const i=setInterval(()=>{if(!$("stat").textContent){clearInterval(i);r(Date.now()-t)}
    else if(Date.now()-t>12000){clearInterval(i);r(-1)}},200)})`);
ok(cleared > 0 && cleared < 12000, 'and it clears itself if you just leave it',
   Math.round(cleared / 1000) + 's');

/* The theme control moved into the bar. */
const before = await w.eval('document.documentElement.classList.contains("d")');
$('#theme').click(); await wait(150);
const after = await w.eval('document.documentElement.classList.contains("d")');
ok(before !== after, 'the light/dark button in the bar switches the theme',
   (before ? 'dark' : 'light') + ' -> ' + (after ? 'dark' : 'light'));
$('#theme').click(); await wait(150);
ok(await w.eval('document.documentElement.classList.contains("d")') === before,
   'and switches back');

console.log(failures ? `\n${failures} FAILED\n` : `\nevery control does what it says\n`);
process.exit(failures ? 1 : 0);
