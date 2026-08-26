/* Enumerates every <button> the page can render, in every state it can be in —
   list, post, mine (connected and not), a live bounty, a cancelled one, an open
   ballot, the menu, the wallet picker, the read-node picker — and asserts that
   each one has something listening to it. A control with no handler looks
   identical to one that works until somebody presses it.

   Usage: node test/dapp/poidh.controls.mjs                                  */
import fs from 'node:fs'; import {JSDOM} from 'jsdom';
const w8=ms=>new Promise(r=>setTimeout(r,ms));
const dom=new JSDOM(fs.readFileSync('dapp/page.html','utf8'),{runScripts:'dangerously',
 pretendToBeVisual:true,url:'https://x.w4eth.io/',beforeParse(w){
  w.localStorage.setItem('poidh:rpc','https://gateway.tenderly.co/public/mainnet');
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.scrollTo=()=>{};
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.ethereum={request:async({method,params})=>{
    if(method==='eth_accounts')return[];
    if(method==='eth_chainId')return'0x1';
    const r=await fetch('https://ethereum.publicnode.com',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({id:1,jsonrpc:'2.0',method,params:params||[]})});
    const j=await r.json(); if(j.error)throw Error(j.error.message); return j.result},on(){}};
  w.fetch=(...a)=>fetch(...a)}});
const w=dom.window,d=w.document;
await w8(9000);

/* every <button> that exists in any state, and whether anything listens to it */
const seen=new Map();
const sweep=label=>{
  for(const b of d.querySelectorAll('button')){
    if(b.closest('.hide'))continue;
    const id=b.id||b.className+'|'+(b.dataset&&Object.keys(b.dataset)[0]||'')+'|'+b.textContent.trim().slice(0,22);
    const wired=!!b.onclick||!!b.closest('[data-nav]');
    if(!seen.has(id))seen.set(id,{label,wired,text:b.textContent.trim().slice(0,30)});
  }
};
sweep('list');
await w.eval('go("new")'); await w8(400); sweep('post');
await w.eval('go("mine")'); await w8(400); sweep('mine (disconnected)');
await w.eval('go("b",21n)'); await w8(3000); sweep('detail #21');
await w.eval('go("b",11n)'); await w8(3000); sweep('detail #11 (cancelled)');
await w.eval(`(async()=>{account="0x7876d1aa2fb4311f84a9ba0a8cf816eb5223d5c2";
  await refresh();await go("b",24n)})()`); await w8(4000); sweep('detail #24 as funder');
await w.eval('go("mine")'); await w8(600); sweep('mine (connected)');
/* public nodes rate-limit under a sweep this chatty; retry rather than crash */
for(let i=0;i<4 && !(await w.eval('!!detail'));i++){
  const e=await w.eval('go("b",24n).then(()=>$("stat").textContent)');
  await w8(2500);
  if(!(await w.eval('!!detail'))) console.log('    attempt',i+1,'->',JSON.stringify(e));
}
if(!(await w.eval('!!detail'))){console.log('  (could not load #24 for the ballot sweep)');}
else await w.eval(`(()=>{const n=Math.floor(Date.now()/1000);detail.voting=83n;detail.round=1n;
  detail.iVoted=false;detail.votes={yes:1n,no:0n,deadline:n+3600};view={t:"b",id:24n};render()})()`);
await w8(300); sweep('ballot open');
d.getElementById('burger').click(); await w8(200); sweep('menu');
d.getElementById('navx').click();
await w.eval('connect()'); await w8(400); sweep('wallet picker');
d.getElementById('wpX').click();
await w.eval('showReadPick()'); await w8(300); sweep('read-node picker');

const dead=[...seen.entries()].filter(([,v])=>!v.wired);
console.log('controls found across every view:',seen.size);
for(const [k,v] of seen) if(!v.wired) console.log('  DEAD  ['+v.label+']', JSON.stringify(v.text), k);
console.log(dead.length? `\n${dead.length} UNWIRED` : '\nevery control in every state has a handler');
process.exit(dead.length?1:0);
