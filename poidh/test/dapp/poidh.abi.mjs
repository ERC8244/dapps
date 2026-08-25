import fs from 'node:fs';
import {execSync} from 'node:child_process';
/* Checks every selector the page hard-codes against the deployed, verified
   ABI. The page cannot compute keccak for its own selectors cheaply, so they
   are written out as constants — and a constant nobody checks is a bug that
   only shows up as a failed transaction.
   Usage: node test/dapp/poidh.abi.mjs                                      */
const page = fs.readFileSync('dapp/poidh/page.html','utf8');

/* every selector constant the page declares, paired with the signature it claims */
const SIGS = {
 R_COUNT:'bountyCounter()', R_BOUNTY:'bounties(uint256)', R_CLAIM:'claims(uint256)',
 R_BCLAIMS:'bountyClaims(uint256,uint256)', R_PARTS:'getParticipants(uint256)',
 R_PART:'participants(uint256,uint256)', R_PEND:'pendingWithdrawals(address)',
 R_TRACK:'bountyVotingTracker(uint256)', R_CURVOTE:'bountyCurrentVotingClaim(uint256)',
 R_EXT:'everHadExternalContributor(uint256)', R_ROUND:'voteRound(uint256)',
 R_PERIOD:'votingPeriod()', R_MINB:'MIN_BOUNTY_AMOUNT()', R_MINC:'MIN_CONTRIBUTION()',
 R_URI:'tokenURI(uint256)', R_UB:'userBounties(address,uint256)', R_UC:'userClaims(address,uint256)',
 W_SOLO:'createSoloBounty(string,string)', W_OPEN:'createOpenBounty(string,string)',
 W_JOIN:'joinOpenBounty(uint256)', W_WDOPEN:'withdrawFromOpenBounty(uint256)',
 W_CSOLO:'cancelSoloBounty(uint256)', W_COPEN:'cancelOpenBounty(uint256)',
 W_REFUND:'claimRefundFromCancelledOpenBounty(uint256)',
 W_MKCLAIM:'createClaim(uint256,string,string,string)', W_ACCEPT:'acceptClaim(uint256,uint256)',
 W_SUBMIT:'submitClaimForVote(uint256,uint256)', W_VOTE:'voteClaim(uint256,bool)',
 W_RESOLVE:'resolveVote(uint256)', W_WITHDRAW:'withdraw()'};

/* The ABI is fetched from the verified source on Etherscan rather than kept as
   a copy here: a pinned copy can drift from the contract the page actually
   calls, which is the exact failure this test exists to catch. */
const KEY = process.env.ETHERSCAN_API_KEY || 'K3GX89YJAGF55CTNS353136VSN7TVITCDF';
const POIDH = '0xE731dFadBFf20542E10D09D26Fc71445C70d4232';
const res = await (await fetch(`https://api.etherscan.io/v2/api?chainid=1&module=contract`
  + `&action=getabi&address=${POIDH}&apikey=${KEY}`)).json();
if (res.status !== '1') { console.error('could not fetch the verified ABI:', res.result); process.exit(1); }
const abi = JSON.parse(res.result);
const onPoidh = new Set(abi.filter(e=>e.type==='function')
  .map(e=>`${e.name}(${e.inputs.map(i=>i.type).join(',')})`));

let bad = 0;
console.log('SELECTOR                                  in page     keccak    abi?');
for (const [name, sig] of Object.entries(SIGS)) {
  const m = new RegExp(`${name}="([0-9a-f]{8})"`).exec(page);
  if (!m) { console.log(`${name.padEnd(12)} ${sig.padEnd(46)} NOT DECLARED`); bad++; continue; }
  const real = execSync(`cast sig "${sig}"`).toString().trim().slice(2);
  const known = sig === 'tokenURI(uint256)' ? 'nft' : (onPoidh.has(sig) ? 'yes' : 'MISSING');
  const okSel = m[1] === real;
  if (!okSel || known === 'MISSING') bad++;
  console.log(`${sig.padEnd(42)}${m[1]}  ${okSel?'==':'!='}  ${real}  ${known}`);
}
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nall selectors match the verified ABI');

process.exit(bad ? 1 : 0);
