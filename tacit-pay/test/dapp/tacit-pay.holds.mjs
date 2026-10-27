/* What holds a payment's notes, in the engine: a spend that left this device keeps its notes held until the chain closes it.
   Here: a hold on a note from before a catch-up point survives a rebuild from the point (the note is not read yet, so the
   spend cannot be called landed); a step that combines notes is held and listed like any payment and retries into one
   note; a combine from the wallet is not remembered as a payment; a transaction that mined and reverted frees its notes.

   Usage: node test/dapp/tacit-pay.holds.mjs                                                                         */
import {mkWorld, POOL, ROUTER, lib} from './engine-mock.mjs';
import {mockRelay} from './relay-mock.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n, DEST = '0x' + '11'.repeat(20), KEEPER = 'https://relay.test/evm-pool/keeper';
const mkStore = () => { const m = new Map(); return {m, get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, del: (k) => m.delete(k)}; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('a hold on a note from before a catch-up point');
{
  const {node, wallet, relayed} = mkWorld(), store = mkStore(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER, points: true, store});
  for (let i = 0; i < 3; i++) await A.W.deposit({amount: 5n * E / 100n});
  node.postPoint({block: node.tip}); node.tip += 10;
  relay.mode = 'refuse';
  const e = await A.W.withdraw({to: DEST, amount: 4n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(e.inflight && A.W.inflight().length === 1, 'a payment the relay would not take is held', e.message.slice(0, 60));
  await A.W.rescan();
  ok(A.W.older() != null && A.W.inflight().length === 1 && A.W.landed().length === 0, 'a rebuild from the point keeps the hold, and does not record the payment as landed', `holds ${A.W.inflight().length}, landed ${A.W.landed().length}`);
  for (let i = 0; i < 60 && A.W.older() != null; i++) { await sleep(50); await A.W.sync().catch(() => {}); }
  ok(A.W.older() === null && A.W.inflight().length === 1 && A.W.summary().balance === 10n * E / 100n, 'and when the older history is in, the held notes are still held', `balance ${A.W.summary().balance}`);
  relay.mode = 'send';
  const again = await A.W.withdraw({to: DEST, amount: 4n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(again.hold === true && !again.duplicate, 'so a new payment waits for the user to say it is a different one', again.message.slice(0, 70));
  relay.restore();
}
console.log('\na relay that refuses before it sends');
for (const [mode, held, label] of [['refuse503', false, 'the relay’s own 503 (no gas to front it)'], ['refuse400', false, 'its trial run reverting (400)'], ['proxy502', true, 'a proxy’s 502, which may come after a send'], ['refuse', true, 'a 500']]) {
  const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  relay.mode = mode;
  const e = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  if (held) ok(e.inflight && A.W.inflight().length === 1, `${label}: the notes stay held`, e.message.slice(0, 60));
  else {
    ok(!e.inflight && e.relay && A.W.inflight().length === 0, `${label}: nothing was sent, so nothing is held`, e.message.slice(0, 70));
    relay.mode = 'send';
    const h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
    ok(typeof h === 'string' && !h.hold, 'and the payment goes through when pressed again, with no question about a held one', String(h?.message || h).slice(0, 60));
  }
  relay.restore();
}
console.log('\na relay that says it sent nothing after it sent');
{
  const {node, wallet, relayed} = mkWorld(), store = mkStore(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER, store});
  for (let i = 0; i < 3; i++) await A.W.deposit({amount: 5n * E / 100n});
  relay.mode = 'refuse400sent';
  const e = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(!e.inflight && e.relay && A.W.inflight().length === 0, 'it is taken at its word: nothing is held', e.message.slice(0, 70));
  relay.mode = 'send';
  const other = await A.W.withdraw({to: '0x' + '22'.repeat(20), amount: E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(typeof other === 'string', 'a different payment is not held back', String(other?.message || other).slice(0, 60));
  const again = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(again.duplicate === true && /may have landed/.test(again.message), 'the same payment pressed again is held back: a note the relay was given is spent', String(again?.message || again).slice(0, 80));
  const B = wallet(7, {keeper: KEEPER, store});
  const reloaded = await B.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(reloaded.duplicate === true, 'and is still held back after the page is opened again', String(reloaded?.message || reloaded).slice(0, 60));
  const second = await B.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote, fresh: true}).catch((x) => x);
  ok(typeof second === 'string', 'and goes out when the user says it is a second payment', String(second?.message || second).slice(0, 60));
  relay.restore();
}
console.log('\nwhat a payment leaves for the duplicate check');
{
  const {node, wallet, relayed} = mkWorld(), store = mkStore(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER, store});
  for (let i = 0; i < 2; i++) await A.W.deposit({amount: 5n * E / 100n});
  await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  ok(A.W.landed().length === 1 && A.W.landed()[0].pay.to.toLowerCase() === DEST, 'a payment that landed is remembered with its payee', JSON.stringify(A.W.landed().map((y) => y.pay.to)));
  const real = Date.now; Date.now = () => real() + 2 * 86_400_000;
  await A.W.deposit({amount: E / 100n});
  ok(A.W.landed().length === 0, 'and is gone at the next write after its day', JSON.stringify(A.W.landed().map((y) => y.pay.to)));
  const B = wallet(7, {keeper: KEEPER, store});
  ok(B.W.landed().length === 0, 'and from what is stored', String(B.W.landed().length));
  Date.now = real;
  relay.restore();
}
console.log('\na step that combines notes');
{
  const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  for (let i = 0; i < 3; i++) await A.W.deposit({amount: 5n * E / 100n});
  relay.mode = 'refuse';
  const e = await A.W.consolidate({via: null, onStep: () => {}, expectFee: relay.quote}).catch((x) => x);
  ok(e.inflight && A.W.inflight().length === 1 && A.W.inflight()[0].pay.merge, 'a combine the relay would not take is held and listed, as a combine', `${A.W.inflight().length} listed`);
  relay.mode = 'send';
  const h = await A.W.retry(e.inflight, {via: null});
  await A.W.sync();
  ok(h && A.W.inflight().length === 0 && A.W.notes().length === 2 && A.W.summary().balance === 15n * E / 100n - 10n ** 13n, 'tried again, it lands into one note, with nothing held and nothing left over', `${A.W.notes().length} notes, ${A.W.summary().balance}`);
  relay.restore();
}
{
  // A combine that was held, tried again at another fee, makes one note of what the notes hold less that fee.
  for (const [label, quote] of [['higher', 15n * 10n ** 12n], ['lower', 5n * 10n ** 12n]]) {
    const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
    const A = wallet(7, {keeper: KEEPER});
    for (let i = 0; i < 3; i++) await A.W.deposit({amount: 5n * E / 100n});
    relay.mode = 'refuse';
    await A.W.withdraw({to: DEST, amount: 10n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
    relay.mode = 'send'; relay.quote = quote;
    let r = await A.W.retry(A.W.inflight()[0].id).catch((x) => x);
    // A fee above what the user was shown is said first, and then taken: the retry is the user's answer.
    if (r?.feeMoved) r = await A.W.retry(A.W.inflight()[0].id).catch((x) => x);
    await A.W.sync();
    const notes = A.W.notes().map((n) => BigInt(n.v)).sort((a, b) => (a < b ? -1 : 1));
    ok(typeof r === 'string' && A.W.inflight().length === 0 && notes.length === 2 && notes[1] === 10n * E / 100n - quote, `a combine tried again at a ${label} fee lands as one note, no dust`, `${notes.map(String).join(' ')}`);
    relay.restore();
  }
}
console.log('\na combine from the wallet');
{
  const {node, wallet} = mkWorld();
  let shallow = false, A;
  const w = wallet(7, {send: (h) => { if (shallow) node.tip -= 4; return h; }});
  A = w;
  for (let i = 0; i < 3; i++) await A.W.deposit({amount: 5n * E / 100n});
  shallow = true;
  const h = await A.W.withdraw({to: DEST, amount: 14n * E / 100n, via: 'self'}).catch((x) => x);
  ok(typeof h === 'string', 'a payment that needed a combine first is sent');
  ok(JSON.stringify(A.W.landed().map((y) => y.pay.kind)) === '["withdraw"]', 'and only the payment is remembered as landed, not the combine', JSON.stringify(A.W.landed().map((y) => y.pay.kind + (y.pay.merge ? ':merge' : ''))));
}
console.log('\na transaction that mined and reverted');
{
  const {node, rpc, prove, wallet} = mkWorld();
  const S = wallet(7);
  await S.W.deposit({amount: E / 10n}); await S.W.deposit({amount: E / 10n});
  let n = 0;
  const keys = lib.poolKeys(new Uint8Array(32).fill(7));
  const signer = {address: '0x' + '22'.repeat(20), ready: async () => {}, send: async () => {
    const h = '0x' + (0xabc00 + ++n).toString(16).padStart(64, '0');
    node.receipts.set(h, {status: '0x0', logs: [], blockNumber: '0x' + node.tip.toString(16)});
    return h;
  }};
  const W = lib.makePoolWallet({chain: {chainId: 1, pool: POOL, router: ROUTER, rpc, deployBlock: 100, confirmations: 3, keeper: null}, keys, prove, store: null, signer, feed: false});
  await W.sync();
  const r = await W.withdraw({to: DEST, amount: E / 20n, via: 'self'}).catch((x) => x);
  ok(/failed on the network, so no ETH moved/.test(r.message), 'the user is told it failed and nothing moved', r.message.slice(0, 80));
  ok(W.inflight().length === 0 && W.summary().balance === E / 5n && W.notes().length === 2, 'and its notes are free: nothing is held', `${W.inflight().length} held, ${W.summary().balance}`);
  const r2 = await W.withdraw({to: DEST, amount: E / 20n, via: 'self'}).catch((x) => x);
  ok(!r2.hold, 'so pressing it again is not refused as a payment that may still land');
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
