/* The page's log reader against nodes that refuse in the ways public ones do: a range limit they name or do not, a rate
   limit, an outage, a hard error, and a very large answer. Each is a node in memory with a fixed rule; the reader's timers
   are shortened so the waits a real one makes take milliseconds.

   Usage: node test/dapp/tacit-pay.getlogs.mjs                                                                      */
import {lib} from './engine-mock.mjs';

const {getLogs} = lib;
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realTimeout(f, Math.min(ms, 3), ...a);
const tick = () => new Promise((r) => realTimeout(r, Math.floor(Math.random() * 3)));
const logsIn = (a, b, every = 7) => { const o = []; for (let x = Math.ceil(a / every) * every; x <= b; x += every) o.push({blockNumber: '0x' + x.toString(16)}); return o; };
const span = ([{fromBlock, toBlock}]) => [parseInt(fromBlock, 16), parseInt(toBlock, 16)];
const FROM = 1_000_000, TO = 1_099_999, WANT = logsIn(FROM, TO).length;
const err = (m, rpc = {}) => Object.assign(new Error(m), {rpc});

// A node that takes at most `cap` blocks and says how it refuses.
const capped = (cap, say, stats) => async (m, p) => { stats.calls++; await tick(); const [a, b] = span(p); if (b - a + 1 > cap) throw err(say(cap)); return logsIn(a, b); };
const named = (c) => `eth_getLogs is limited to a ${c.toLocaleString('en-US')} range`;
const unnamed = () => 'query returned more than 10000 results. Try with this block range';

console.log('a node that names its range limit');
{
  const stats = {calls: 0}, size = {step: 50_000}, rpc = capped(10_000, named, stats);
  // The pool's logs and the router's, read at once, as a sync does.
  const [a, b] = await Promise.all([getLogs(rpc, 'p', [], FROM, TO, size), getLogs(rpc, 'r', [], FROM, TO, size)]);
  ok(a.length === WANT && b.length === WANT, 'every log comes back, once, in order', `${a.length}/${b.length} of ${WANT}`);
  ok(a.every((l, i) => !i || parseInt(a[i - 1].blockNumber, 16) < parseInt(l.blockNumber, 16)), 'in block order');
  ok(stats.calls <= 60 && size.step === 10_000, 'in a few requests, at the step the node named (not narrowed again by each lane)', `${stats.calls} requests, step ${size.step}`);
}
console.log('\na node that refuses without a number');
{
  const stats = {calls: 0}, size = {step: 50_000}, rpc = capped(2000, unnamed, stats);
  const [a, b] = await Promise.all([getLogs(rpc, 'p', [], FROM, TO, size), getLogs(rpc, 'r', [], FROM, TO, size)]);
  ok(a.length === WANT && b.length === WANT, 'every log comes back');
  ok(stats.calls <= 700, 'and the range settles under the limit without failing its way down again and again', `${stats.calls} requests, step ${size.step}`);
  const before = stats.calls;
  await getLogs(rpc, 'p', [], FROM, TO, size);
  const second = stats.calls - before, ideal = Math.ceil(100_000 / 2000);
  ok(second <= ideal * 1.5, 'a second read goes in about the ideal number of requests, with no more probes above the limit', `${second} requests for ${ideal}`);
}
console.log('\nan outage that is over');
{
  const stats = {calls: 0, down: 4}, size = {step: 50_000};
  const rpc = async (m, p) => { stats.calls++; await tick(); if (stats.down-- > 0) throw new Error('The operation was aborted: signal timed out'); const [a, b] = span(p); return logsIn(a, b); };
  const a = await getLogs(rpc, 'p', [], FROM, TO, size);
  ok(a.length === WANT, 'a read through four timeouts still returns every log');
  const calls0 = stats.calls;
  for (let i = 0; i < 6; i++) await getLogs(rpc, 'p', [], FROM, TO, size);
  ok(size.step >= 50_000 && (stats.calls - calls0) <= 6 * 12, 'and the range is back to what it began with, not left narrow for good', `step ${size.step}, ${stats.calls - calls0} requests for six windows`);
}
console.log('\na failure on one range');
{
  const stats = {calls: 0}, size = {step: 10_000}, t0 = Date.now();
  let first = true;
  const rpc = async (m, p) => {
    stats.calls++;
    const [a] = span(p);
    if (first && a === FROM) { first = false; throw err('execution reverted: nope'); }
    if (a > FROM) throw err('rate limit exceeded');     // the other ranges are rate limited
    return logsIn(...span(p));
  };
  const e = await getLogs(rpc, 'p', [], FROM, TO, size).catch((x) => x);
  ok(/reverted/.test(e.message) && Date.now() - t0 < 1000 && stats.calls < 40, 'the error comes at once, and the other ranges are not kept retrying behind it', `${e.message} · ${stats.calls} requests · ${Date.now() - t0} ms`);
}
console.log('\na node with a rate limit');
{
  // At most 6 requests in any 12 ms window of real time, with the waits shortened to 3 ms.
  const mk = () => { const seen = [], s = {calls: 0, busy: 0}; return {s, rpc: async (m, p) => { s.calls++; const now = Date.now(); while (seen.length && now - seen[0] > 12) seen.shift(); await tick(); if (seen.length >= 6) { s.busy++; throw err('rate limit exceeded: request limit reached'); } seen.push(now); const [a, b] = span(p); if (b - a + 1 > 5000) throw err(named(5000)); return logsIn(a, b); }}; };
  const one = mk(), three = mk();
  await getLogs(one.rpc, 'p', [], FROM, FROM + 199_999, {step: 5000}, 1);
  const size = {step: 5000};
  await getLogs(three.rpc, 'p', [], FROM, FROM + 199_999, size, 3);
  ok(three.s.busy <= one.s.busy * 1.5 + 6, 'three lanes do not draw many more refusals than one: the first "busy" brings them down to one', `one lane ${one.s.busy}, three lanes ${three.s.busy}`);
  ok(size.soloUntil > Date.now(), 'and later reads start with one lane for a while');
}
console.log('\na very large answer');
{
  const rpc = async (m, p) => { const [a, b] = span(p); return Array.from({length: 200_000}, (_, i) => ({blockNumber: '0x' + (a + (i % (b - a + 1))).toString(16)})); };
  const size = {step: 50_000};
  const a = await getLogs(rpc, 'p', [], 1, 50_000, size).catch((x) => x);
  ok(Array.isArray(a) && a.length === 200_000 && size.step === 50_000, '200,000 logs in one answer are taken whole', Array.isArray(a) ? `${a.length}, step ${size.step}` : String(a.message));
}
console.log('\nedges');
{
  const stats = {calls: 0}, rpc = capped(1e9, named, stats);
  ok((await getLogs(rpc, 'p', [], 10, 9)).length === 0 && stats.calls === 0, 'an empty range asks nothing');
  ok((await getLogs(rpc, 'p', [], 14, 14)).length === 1 && stats.calls === 1, 'one block is one request');
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
