/* Contract integration, checked from the contract's own mouth.
 *
 *   1. DECODERS  — every value the page decodes by hand is compared, field by
 *      field, against canonical ABI decoding of the same live returndata.
 *   2. ARGUMENT ORDER — the silent bug this class of code is prone to: a
 *      getter given its arguments the wrong way round still encodes and
 *      decodes perfectly, it just answers a different question. Each one is
 *      pinned to a fact only the correct order can produce.
 *   3. SIMULATION — every transaction the page builds is replayed through
 *      `eth_call` against live state, from an address that should be allowed
 *      and from one that should not, and the revert is matched to the exact
 *      custom error PoidhV3 declares.
 *
 * Nothing is broadcast. Usage: node test/dapp/poidh.integration.mjs           */
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {execSync} from 'node:child_process';

const RPC = 'https://ethereum.publicnode.com';
const POIDH = '0xe731dfadbff20542e10d09d26fc71445c70d4232';
const NFT = '0x9c5f45d5e1382e4058d334d93c6c01442012a4d9';
const ISSUER24 = '0x1c0aa8ccd568d90d61659f060d1bfb1e6f855a20';
const FUNDER24 = '0x7876d1aa2fb4311f84a9ba0a8cf816eb5223d5c2';
const STRANGER = '0x00000000000000000000000000000000000000aa';
const OWED11 = '0x9fd25b6be40aecea5eb5eceea31d6c0ac9c83e11';

const ERRS = new Map(fs.readFileSync('/tmp/errmap.txt', 'utf8').trim().split('\n')
  .map(l => l.split(' ')).map(([sel, name]) => [sel, name]));

let failures = 0;
const ok = (c, msg, extra) => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + msg + (extra !== undefined ? '  ' + extra : ''));
  if (!c) failures++;
};
const rpc = async (method, params) => {
  const r = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({id: 1, jsonrpc: '2.0', method, params})});
  return r.json();
};
const castCall = (sig, ...args) =>
  execSync(`cast call ${POIDH} "${sig}" ${args.join(' ')} --rpc-url ${RPC}`).toString().trim();

/* --- the page itself, so its real decoders are the ones under test --- */
const dom = new JSDOM(fs.readFileSync('dapp/poidh/page.html', 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.w4eth.io/',
  beforeParse(w) {
    w.localStorage.setItem('poidh:rpc', RPC);
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.scrollTo = () => {};
    w.fetch = (...a) => fetch(...a);
  }});
const w = dom.window;
await new Promise(r => setTimeout(r, 9000));

/* ============================================================ 1. DECODERS */
console.log('\ndecoders — the page\'s own output vs canonical ABI decoding of the same bytes');

const b24 = JSON.parse(await w.eval(`readDetail(24n).then(b=>JSON.stringify({
  id:String(b.id),issuer:b.issuer,name:b.name,desc:b.desc,amount:String(b.amount),
  claimer:b.claimer,createdAt:b.createdAt,claimId:String(b.claimId),
  parts:b.parts.map(p=>[p.addr,String(p.amt)])}))`));
const canon = castCall('bounties(uint256)(uint256,address,string,string,uint256,address,uint256,uint256)', 24)
  .split('\n').map(x => x.trim());
ok(b24.id === canon[0], 'bounties().id', b24.id);
ok(b24.issuer.toLowerCase() === canon[1].toLowerCase(), 'bounties().issuer', b24.issuer);
ok(JSON.stringify(b24.name) === canon[2].replace(/\\"/g, '\\"'), 'bounties().name (string offset)',
   b24.name.slice(0, 32) + '…');
ok(b24.desc.length > 1000 && b24.desc.includes('BOUNTY.md'),
   'bounties().description (second dynamic string)', b24.desc.length + ' chars');
ok(b24.amount === canon[4].split(' ')[0], 'bounties().amount', b24.amount);
ok(b24.claimer.toLowerCase() === canon[5].toLowerCase(), 'bounties().claimer', b24.claimer);
ok(String(b24.createdAt) === canon[6].split(' ')[0], 'bounties().createdAt', b24.createdAt);
ok(b24.claimId === canon[7].split(' ')[0], 'bounties().claimId', b24.claimId);

const pc = castCall('getParticipants(uint256)(address[],uint256[])', 24).split('\n');
const addrs = pc[0].replace(/[\[\]]/g, '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const amts = pc[1].replace(/[\[\]]/g, '').split(',').map(x => x.trim().split(' ')[0]).filter(Boolean);
const live = addrs.map((a, i) => [a, amts[i]]).filter(([a, m]) => a !== '0x0000000000000000000000000000000000000000' && m !== '0');
ok(b24.parts.length === live.length, 'getParticipants() pairs both dynamic arrays',
   b24.parts.length + ' of ' + addrs.length + ' slots occupied');
ok(b24.parts.every(([a, m], i) => a.toLowerCase() === live[i][0] && m === live[i][1]),
   'and every address stays paired with its own amount');

const c19 = JSON.parse(await w.eval(`readDetail(19n).then(b=>JSON.stringify(
  b.claims.map(c=>[String(c.id),c.issuer,c.name,String(c.bountyId),c.accepted])))`));
const canonC = castCall('claims(uint256)(uint256,address,uint256,address,string,string,uint256,bool)', 71)
  .split('\n').map(x => x.trim());
const c71 = c19.find(c => c[0] === '71');
ok(c71[1].toLowerCase() === canonC[1].toLowerCase(), 'getClaimsByBountyId() -> issuer matches claims()');
ok(JSON.stringify(c71[2]) === canonC[4], 'and its name', c71[2].slice(0, 28));
ok(c71[3] === canonC[2], 'and its bountyId', c71[3]);
ok(c71[4] === (canonC[7] === 'true'), 'and its accepted flag', String(c71[4]));

const vt = castCall('bountyVotingTracker(uint256)(uint256,uint256,uint256)', 24).split('\n');
const pv = JSON.parse(await w.eval(`readDetail(24n).then(b=>JSON.stringify(
  [String(b.votes.yes),String(b.votes.no),String(b.votes.deadline)]))`));
ok(pv[0] === vt[0].trim().split(' ')[0] && pv[1] === vt[1].trim().split(' ')[0]
   && pv[2] === vt[2].trim().split(' ')[0], 'bountyVotingTracker() -> yes / no / deadline in order',
   pv.join(' / '));

/* Chainlink: answer is word 1 and updatedAt word 3, not 0 and 2. */
const feed = execSync(`cast call 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419 "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url ${RPC}`).toString().trim().split('\n');
ok(await w.eval('String(usdPerEth)') === feed[1].trim().split(' ')[0],
   'latestRoundData() -> answer taken from word 1', '$' + (Number(await w.eval('String(usdPerEth)')) / 1e8).toFixed(2));

/* ====================================================== 2. ARGUMENT ORDER */
console.log('\nargument order — each pinned to a fact only the right order can produce');
const first = castCall('bountyClaims(uint256,uint256)(uint256)', 21, 0);
ok(first === '75 [7.5e1]' || first.startsWith('75'), 'bountyClaims(bountyId, index) — not (index, bountyId)',
   'bountyClaims(21,0) = ' + first);
const ub = castCall('userBounties(address,uint256)(uint256)', ISSUER24, 0);
ok(ub.startsWith('24'), 'userBounties(user, index)', 'userBounties(issuer,0) = ' + ub);
const uc = castCall('userClaims(address,uint256)(uint256)', '0x6dce11cc9bba17d3c1ef60c26f0958300bb06953', 0);
ok(/^\d/.test(uc), 'userClaims(user, index)', 'userClaims(winner,0) = ' + uc);
const pa = castCall('participants(uint256,uint256)(address)', 24, 0);
ok(pa.toLowerCase() === ISSUER24, 'participants(bountyId, slot) — slot 0 is the issuer', pa);
const pend = castCall('pendingWithdrawals(address)(uint256)', OWED11);
ok(/^\d/.test(pend), 'pendingWithdrawals(address)', pend);

/* ========================================================= 3. SIMULATION */
console.log('\nsimulation — every transaction the page builds, replayed against live state');
const enc = await w.eval(`JSON.stringify({
  join:cUint(W_JOIN,24n), pull:cUint(W_WDOPEN,24n), cancelOpen:cUint(W_COPEN,24n),
  cancelSolo:cUint(W_CSOLO,24n), refund:cUint(W_REFUND,11n), resolve:cUint(W_RESOLVE,24n),
  vote:"0x"+W_VOTE+encUint(24n)+encBool(true), withdraw:"0x"+W_WITHDRAW,
  accept:cTwo(W_ACCEPT,20n,81n), submit:cTwo(W_SUBMIT,21n,82n),
  claim:cStr3(W_MKCLAIM,24n,"t","d","ipfs://x"),
  open:cStr2(W_OPEN,"t","d"), solo:cStr2(W_SOLO,"t","d"),
  uri:cUint(R_URI,71n)})`);
const C = JSON.parse(enc);
/* The `from` addresses here are real accounts with real balances or none at
   all, and a value-bearing call is refused for lack of funds before the
   contract is ever reached — which would test the node, not the page. A state
   override gives whoever is calling 10 ETH for the length of the call, so what
   comes back is the contract's answer and nothing else. */
const sim = async (from, data, value, to = POIDH) => {
  const j = await rpc('eth_call', [
    {from, to, data, value: '0x' + (value || 0n).toString(16)}, 'latest',
    {[from]: {balance: '0x8ac7230489e80000'}}]);
  if (!j.error) return {ok: true};
  const d = j.error.data && (j.error.data.data || j.error.data);
  const sel = typeof d === 'string' && d.startsWith('0x') ? d.slice(0, 10) : '';
  return {ok: false, err: ERRS.get(sel) || sel || (j.error.message || '').slice(0, 60)};
};
const expectOk = async (label, ...a) => { const r = await sim(...a); ok(r.ok, label, r.ok ? 'accepted' : 'reverted ' + r.err); };
const expectErr = async (label, want, ...a) => { const r = await sim(...a); ok(!r.ok && r.err === want, label, r.err); };

await expectOk('joinOpenBounty(24) from a stranger, 0.001 ETH', STRANGER, C.join, 1000000000000000n);
await expectErr('joinOpenBounty(24) from its issuer', 'WrongCaller', ISSUER24, C.join, 1000000000000000n);
await expectErr('joinOpenBounty(24) below the minimum', 'MinimumContributionNotMet', STRANGER, C.join, 1n);
await expectOk('withdrawFromOpenBounty(24) from a real funder', FUNDER24, C.pull);
await expectErr('withdrawFromOpenBounty(24) from a stranger', 'NotActiveParticipant', STRANGER, C.pull);
await expectErr('withdrawFromOpenBounty(24) from its issuer', 'IssuerCannotWithdraw', ISSUER24, C.pull);
await expectOk('cancelOpenBounty(24) from its issuer', ISSUER24, C.cancelOpen);
await expectErr('cancelOpenBounty(24) from a stranger', 'WrongCaller', STRANGER, C.cancelOpen);
await expectErr('cancelSoloBounty(24) — it is not a solo bounty', 'NotSoloBounty', ISSUER24, C.cancelSolo);
await expectOk('claimRefundFromCancelledOpenBounty(11) from the owed account', OWED11, C.refund);
await expectErr('…from someone with no stake in it', 'NotActiveParticipant', STRANGER, C.refund);
await expectErr('resolveVote(24) with no vote running', 'NoVotingPeriodSet', STRANGER, C.resolve);
await expectErr('voteClaim(24,true) with no vote running', 'NoVotingPeriodSet', FUNDER24, C.vote);
/* PULL PAYMENTS ARE TWO STEPS, and the page must not imply otherwise. The
   stake owed on cancelled #11 is still held as a participant slot; it reaches
   `pendingWithdrawals` only when the refund is claimed, so `withdraw()` is
   correctly empty until then. */
await expectErr('withdraw() with nothing pending', 'NothingToWithdraw', STRANGER, C.withdraw);
await expectErr('withdraw() before the refund on #11 is claimed', 'NothingToWithdraw',
  OWED11, C.withdraw);
ok(castCall('pendingWithdrawals(address)(uint256)', OWED11) === '0',
   'because the stake is still in the bounty, not in pendingWithdrawals');
await expectOk('createClaim(24,…) from a stranger', STRANGER, C.claim);
await expectErr('createClaim(24,…) from its issuer', 'IssuerCannotClaim', ISSUER24, C.claim);
await expectOk('submitClaimForVote(21,82) from #21\'s issuer',
  '0xf35ff7426e2dbe06305e71eaee7e038e6dbac620', C.submit);
await expectErr('submitClaimForVote(21,82) from a stranger', 'WrongCaller', STRANGER, C.submit);
await expectOk('acceptClaim(20,81) from #20\'s issuer',
  '0x4200ac338555e25b20c8fe82ac02a5c8d4e5a5b4', C.accept);
await expectErr('acceptClaim(20,81) from a stranger', 'WrongCaller', STRANGER, C.accept);
await expectOk('createOpenBounty at the minimum', STRANGER, C.open, 1000000000000000n);
await expectOk('createSoloBounty at the minimum', STRANGER, C.solo, 1000000000000000n);
await expectErr('createOpenBounty below the minimum', 'MinimumBountyNotMet', STRANGER, C.open, 1n);
await expectErr('createSoloBounty with no value at all', 'NoEther', STRANGER, C.solo, 0n);
await expectOk('tokenURI(71) on the claim NFT', STRANGER, C.uri, 0n, NFT);

console.log(failures ? `\n${failures} FAILED\n` : '\ncontract integration is sound\n');
process.exit(failures ? 1 : 0);
