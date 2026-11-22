/* The page's fixed-pool part (TC) against the Tacit app's own modules, which have been through mainnet canaries:
   the same inputs must give the same outputs. Also: the keychain's own vectors, and the page's wasm glue in a stand-in
   worker, whose proof the pool's live verifier is asked to accept (one eth_call to a public node; set OFFLINE=1 to skip).

   TACIT=<a checkout of z0r0z/tacit> (default /Users/z/tacit-wt-tacitwei). Run: node test/dapp/tornado.part.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import { register } from 'node:module';
import { webcrypto } from 'node:crypto';
import { loadTC } from './tornado-lib.mjs';
import { Wallet, Transaction } from 'ethers';

const TACIT = process.env.TACIT || '/Users/z/tacit-wt-tacitwei';
register('data:text/javascript,' + encodeURIComponent(`const D = ${JSON.stringify('file://' + TACIT + '/dapp')};
export async function resolve(spec, ctx, next) { if (spec.startsWith('/') && !spec.startsWith('//')) return next(D + spec.split('?')[0], ctx); return next(spec, ctx); }`));
const N = await import(`file://${TACIT}/dapp/fixed-pool-notes.js`);
const P = await import(`file://${TACIT}/dapp/fixed-pool-paymaster.js`);
const F = await import(`file://${TACIT}/dapp/fixed-pool-flow.js`);
const PAY = await import(`file://${TACIT}/dapp/fixed-pool-pay.js`);
const Wm = await import(`file://${TACIT}/dapp/evm-pool-wallet.js`);
const D = await import(`file://${TACIT}/dapp/vendor/tacit-deps.min.js`);
const G = await import(`file://${TACIT}/dapp/vendor/fixed-pool-prover.js`);

const { TC, ROUTE, ctx } = loadTC();
let pass = 0, fail = 0;
const test = async (label, fn) => { try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}: ${e.stack || e.message}`); fail++; } };
const eq = (a, b, what = '') => { if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`); };
const rnd = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const hex = (b) => Buffer.from(b).toString('hex');
const E = 10n ** 18n;

console.log('hashes');
await test('BLAKE-256 matches the app over every length 0..300', () => { for (let n = 0; n <= 300; n++) { const m = rnd(n); eq(hex(TC.blake256(m)), hex(N.blake256(m)), `len ${n}`); } });
await test('the Pedersen point matches the app over lengths 1..100 (x and y)', () => { for (let n = 1; n <= 100; n++) { const m = rnd(n), a = TC.pedersenPoint(m), b = N.pedersenPoint(m); eq(a[0], b[0], `x ${n}`); eq(a[1], b[1], `y ${n}`); } });

console.log('notes');
const VECTORS = [
  { nonce: 0, pool: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936', signature: '0xff77f2f406c836e7ee02cc09f19e6f2ce516f56a7d032e48b07a0e440b9aec4321b29d04f2764724b5939222b736e5067a6a485b669487e6c7e5d045177e10b01b', commitment: '12835225892590859773925035759362146102382624861804570551273234300053110344907', nullifierHash: '4421162913551255187565258613137729303119586078752544998892470642633069808385' },
  { nonce: 123456, pool: '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291', signature: '0x33cf08f921aa4c79bd9c7a266ba4b2b648f0af74f05a7539362cd2b975b00f4322d53e780c4a20493385207e60ba6698ecfeb7fa7df1e9113a594117df3c61f21b', commitment: '9512028510634418257330769837777432835737419748964676667993766714717209481305', nullifierHash: '1205311484172536424487280165489558024604071434976111203753024818251419276559' },
];
await test('the keychain\'s vectors: commitment and nullifier hash', () => { for (const v of VECTORS) { const s = TC.deriveSecrets(v.signature, v.pool); eq(s.commitment, BigInt(v.commitment), 'commitment'); eq(s.nullifierHash, BigInt(v.nullifierHash), 'nullifierHash'); } });
await test('random signatures and pools: secrets, commitment, note text, parse and the deposit call match the app', () => {
  for (let i = 0; i < 60; i++) {
    const sig = '0x' + hex(rnd(64)) + (i % 2 ? '1b' : '1c'), pool = TC.POOLS[i % 4];
    const a = TC.deriveSecrets(sig, pool.address), b = N.deriveSecrets({ signature: sig, pool: pool.address });
    eq(hex(a.preimage), hex(b.preimage), 'preimage'); eq(a.commitment, b.commitment, 'commitment'); eq(a.nullifierHash, b.nullifierHash, 'nh');
    const text = TC.noteString(pool.denomination, a.preimage);
    eq(text, N.noteString({ denomination: pool.denomination, chainId: 1, preimage: b.preimage }), 'note text');
    const pa = TC.parseNote(text), pb = N.parseNoteString(text);
    eq(pa.commitment, pb.commitment, 'parsed commitment'); eq(pa.nullifierHash, pb.nullifierHash, 'parsed nh'); eq(pa.amount, pb.amount, 'amount');
    const ca = TC.depositCall(pool, a.commitment), cb = N.depositCall(pool, b.commitment);
    eq(ca.to, cb.to); eq(ca.value, cb.value); eq(ca.data, cb.data, 'deposit data');
  }
});
await test('a high-s signature gives the same note as its low-s twin', () => {
  const SN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n, v = VECTORS[0], s = BigInt('0x' + v.signature.slice(66, 130));
  const flip = v.signature.slice(0, 66) + (SN - s).toString(16).padStart(64, '0') + '1c';
  eq(TC.deriveSecrets(flip, v.pool).commitment, TC.deriveSecrets(v.signature, v.pool).commitment);
});
await test('the typed data is the app\'s, byte for byte', () => { for (const n of [0, 1, 99, 123456]) eq(JSON.stringify(TC.noteTypedData(n)), JSON.stringify(N.noteTypedData(n, 1))); });
console.log('a listed relay\'s private-route key');
// The forwarders' answers are stubbed, and so are the timers, so the ten-minute wait can be seen without waiting.
const keyRun = async (relayer, mode) => {
  const realFetch = ctx.fetch, realTimeout = ctx.setTimeout, keyAsks = [], timers = [];
  ctx.fetch = async (u) => {
    if (!/\/key$/.test(String(u))) throw new Error('unexpected request ' + u);
    keyAsks.push(u);
    if (mode === 'unreachable') throw new Error('network down');
    // a proxy's own page in front of a forwarder (no JSON): the route is in trouble, not the relay
    if (mode === 'proxy-502') return { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    // the forwarder's own 502 for a relay it has no key for
    if (mode === 'no-key-502') return { ok: false, status: 502, json: async () => ({ error: 'the relay has no gateway key to show' }) };
    return { ok: true, json: async () => ({ docs: [] }) };       // reachable, and it has no key for this relay
  };
  ctx.setTimeout = (f, ms) => { timers.push(ms); return 0; };
  try {
    const url = 'https://r.example/1/evm-pool/keeper/quote';
    const one = await ROUTE.relayFetch(url, {}, relayer).then(() => 'reached', (e) => e);
    const asksAfterOne = keyAsks.length;
    const two = await ROUTE.relayFetch(url, {}, relayer).then(() => 'reached', (e) => e);
    return { one, two, asksAfterOne, asksAfterTwo: keyAsks.length, timers };
  } finally { ctx.fetch = realFetch; ctx.setTimeout = realTimeout; }
};
await test('when no forwarder could be reached, the next quote asks for the relay\'s key again', async () => {
  const r = await keyRun('0x' + '35'.repeat(20), 'unreachable');
  eq(/could not be shown and checked/.test(r.one?.message), true, 'the first is refused: ' + r.one);
  eq(r.asksAfterOne > 0 && r.asksAfterTwo > r.asksAfterOne, true, `asked again: ${r.asksAfterOne} then ${r.asksAfterTwo} key requests`);
  eq(r.timers.includes(600_000), false, 'and no ten-minute wait was set');
});
await test('when a forwarder answered that it has no key for the relay, the relay is passed over for an hour (kept as a time, not a timer)', async () => {
  const r = await keyRun('0x' + '36'.repeat(20), 'no-key');
  eq(/could not be shown and checked/.test(r.one?.message), true, 'the first is refused: ' + r.one);
  eq(r.asksAfterOne > 0 && r.asksAfterTwo === r.asksAfterOne, true, `not asked again: ${r.asksAfterOne} then ${r.asksAfterTwo} key requests`);
  eq(r.timers.includes(600_000), false, 'and no ten-minute timer is what holds it');
});
await test('a forwarder\'s own 502 for a relay with no key counts as an answer: the relay is passed over, not asked again at every quote', async () => {
  const r = await keyRun('0x' + '37'.repeat(20), 'no-key-502');
  eq(/could not be shown and checked/.test(r.one?.message), true, 'the first is refused: ' + r.one);
  eq(r.asksAfterOne > 0 && r.asksAfterTwo === r.asksAfterOne, true, `not asked again: ${r.asksAfterOne} then ${r.asksAfterTwo} key requests`);
});
await test('a proxy\'s 502 with no forwarder words in it is the route in trouble: the next quote asks again', async () => {
  const r = await keyRun('0x' + '38'.repeat(20), 'proxy-502');
  eq(r.asksAfterOne > 0 && r.asksAfterTwo > r.asksAfterOne, true, `asked again: ${r.asksAfterOne} then ${r.asksAfterTwo} key requests`);
});

// a wallet that answers eth_signTypedData_v4 with `key`'s signature, whatever account it is asked for
const typedWallet = (key) => { const w = new Wallet(key); return async (method, params) => { const td = JSON.parse(params[1]), types = { ...td.types }; delete types.EIP712Domain; return w.signTypedData(td.domain, types, td.message); }; };
await test('a typed-data signature is taken only when it is the connected account\'s', async () => {
  const mine = new Wallet('0x' + '11'.repeat(32)), other = '0x' + '22'.repeat(32), noRead = () => { throw new Error('no read'); };
  const good = TC.makeFlow({ read: noRead, wallet: typedWallet(mine.privateKey), account: mine.address });
  eq(typeof (await good.signNonce(0)), 'string', 'the account\'s own signature');
  const bad = TC.makeFlow({ read: noRead, wallet: typedWallet(other), account: mine.address });
  let said = '';
  try { await bad.signNonce(0); } catch (e) { said = e.message; }
  eq(/another account/.test(said), true, 'another key\'s signature refused: ' + said);
});
await test('a sweep signs a tip no higher than the cap, whatever one node says of the fees', async () => {
  const sent = [], read = async (method, params) => {
    if (method === 'eth_getBalance') return '0x' + E.toString(16);
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_feeHistory') return { baseFeePerGas: Array(11).fill('0x3b9aca00'), reward: Array(10).fill(['0x' + (10n ** 15n).toString(16)]) };   // a tip of a million gwei
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_sendRawTransaction') { sent.push(params[0]); return '0x' + '11'.repeat(32); }
    throw new Error('unexpected ' + method);
  };
  await TC.sweepThrowaway({ read, key: rnd(32), to: '0x' + 'ab'.repeat(20) });
  const tx = Transaction.from(sent[0]);
  eq(tx.maxPriorityFeePerGas <= 20_000_000_000n, true, 'tip ' + tx.maxPriorityFeePerGas);
  eq(tx.value + tx.gasLimit * tx.maxFeePerGas <= E, true, 'it never sends more than the account holds');
});
await test('a note that is not one, or of another shape, is refused', () => {
  for (const bad of ['', 'tornado-eth-1-1-0x00', 'tornado-eth-1-1-0x' + 'g'.repeat(124), 'tornado-eth-1-1-0x' + 'a'.repeat(126)]) { let threw = false; try { TC.parseNote(bad); } catch { threw = true; } eq(threw, true, bad.slice(0, 20)); }
});

console.log('notes from a seed (no signatures)');
{
  const { createHmac } = await import('node:crypto');
  const seed = rnd(32);
  await test('seedRS is HMAC-SHA256(seed, "tacit-wei-note-v1" || nonce as 32 bytes)', () => {
    for (const nonce of [0, 1, 7, 123456, 2 ** 40]) {
      const msg = Buffer.concat([Buffer.from('tacit-wei-note-v1'), Buffer.from(nonce.toString(16).padStart(64, '0'), 'hex')]);
      eq(hex(TC.seedRS(seed, nonce)), createHmac('sha256', Buffer.from(seed)).update(msg).digest('hex'), `nonce ${nonce}`);
    }
  });
  await test('secretsOf(rs) is what deriveSecrets gives for the signature with that r || s', () => {
    const v = VECTORS[0], rs = TC.canonicalRS(v.signature);
    eq(TC.secretsOf(rs, v.pool).commitment, TC.deriveSecrets(v.signature, v.pool).commitment);
  });
  // a node that knows a few commitments; the wallet must never be asked for anything
  const pools = TC.ALL_POOLS, made = [[0, 1], [1, 0], [2, 3], [4, 1]];
  const known = new Set(made.map(([n, k]) => TC.b32(TC.secretsOf(TC.seedRS(seed, n), pools[k].address).commitment).slice(2)));
  const read = async (m, p) => {
    if (m === 'eth_call') { const d = p[0].data; if (d.startsWith('0x839df945')) return known.has(d.slice(10)) ? '0x' + '0'.repeat(63) + '1' : '0x' + '0'.repeat(64); return '0x' + '0'.repeat(64); }
    throw new Error('unexpected ' + m);
  };
  const store = new Map(), st = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const wallet = () => { throw new Error('the wallet was asked'); };
  const flow = TC.makeFlow({ read, wallet, account: '0x' + '11'.repeat(20), seed, store: st });
  await test('a seeded flow finds its notes past a gap of 1, asking the wallet nothing', async () => {
    const asked = [];
    const { found, next } = await flow.scan({ onProbe: (n, signs) => asked.push(signs) });
    eq(found.length, 4, 'found'); eq(next, 5, 'next'); eq(asked.every((x) => x === false), true, 'no signature');
    eq(found.every((f) => f.s === 'k'), true, 'scheme');
    const metas = found.map(TC.metaOf);
    eq(metas.every((m) => m.s === 'k'), true, 'meta scheme');
  });
  await test('a seeded note text opens to its commitment, and refuses under another seed or scheme', async () => {
    const f = (await flow.scan()).found[0], m = TC.metaOf(f);
    eq(TC.parseNote(await flow.noteText(m)).commitment, f.secrets.commitment, 'commitment');
    const other = TC.makeFlow({ read, wallet, account: '0x' + '11'.repeat(20), seed: rnd(32), store: st });
    let msg = '';
    try { await other.noteText(m); } catch (e) { msg = e.message; }
    eq(/another Tacit key/.test(msg), true, 'other seed: ' + msg);
    msg = '';
    try { await flow.noteText({ ...m, s: undefined }); } catch (e) { msg = e.message; }
    eq(/wallet signatures/.test(msg), true, 'scheme: ' + msg);
  });
  await test('the next-number hint is kept per seed, apart from the wallet\'s', () => {
    flow.remember(9);
    eq(flow.hint(), 9, 'seeded');
    eq(TC.makeFlow({ read, wallet, account: '0x' + '11'.repeat(20), store: st }).hint(), 0, 'wallet');
  });
  await test('two schemes may share a number in one pool: both are kept, each once', () => {
    const s2 = new Map(), st2 = { get: (k) => s2.get(k), set: (k, v) => s2.set(k, v) };
    const a = { nonce: 3, pool: pools[1].address, c: '0x' + 'aa'.repeat(32), nh: '0x01' }, b = { ...a, c: '0x' + 'bb'.repeat(32), s: 'k' };
    eq(TC.writeNotes(st2, '0x' + '11'.repeat(20), [a, b, a, { ...b, acct: '0x' + '22'.repeat(20) }]).length, 2, 'kept');
    eq(TC.readNotes(st2, '0x' + '11'.repeat(20)).find((x) => x.s === 'k').acct, '0x' + '22'.repeat(20), 'acct merged');
  });
  await test('the notes of one deposit share a mark, kept with them and merged into a record without it; another deposit has its own', async () => {
    const DEN = '0x' + hex(D.keccak_256(new TextEncoder().encode('denomination()')).slice(0, 4));
    const r2 = async (m, p) => (m === 'eth_getCode' ? '0x6080' : m === 'eth_call' && p[0].data === DEN ? '0x' + TC.poolOf(p[0].to).denomination.toString(16).padStart(64, '0') : read(m, p));
    const f2 = TC.makeFlow({ read: r2, wallet, account: '0x' + '11'.repeat(20), seed, store: { get: () => null, set() {} } });
    const plan = TC.planSplit(3n * E + E / 10n, { min: E / 10n });
    const a = await f2.prepareNotes(plan), b = await f2.prepareNotes(plan);
    eq(a.length, 4, 'notes'); eq(new Set(a.map((n) => n.g)).size === 1 && /^[0-9a-f]{8}$/.test(a[0].g), true, 'one mark: ' + a.map((n) => n.g));
    eq(a[0].g !== b[0].g, true, 'another deposit, another mark');
    const m = TC.metaOf(a[1]);
    eq(m.g, a[0].g, 'kept in the record');
    const s3 = new Map(), st3 = { get: (k) => s3.get(k), set: (k, v) => s3.set(k, v) }, { g, ...bare } = m;
    eq(TC.writeNotes(st3, '0x' + '11'.repeat(20), [bare, m, { ...bare, g: 'ffffffff' }])[0].g, g, 'merged, and the first mark stays');
  });
}

console.log('plans');
await test('notes that went in together: one mark, or deposits within 50 blocks of one another', () => {
  eq(TC.together([]), 0, 'none');
  eq(TC.together([{ g: 'a' }, { g: 'a' }, { g: 'b' }]), 2, 'one mark, no blocks known yet');
  eq(TC.together([{ b: 100 }, { b: 140 }, { b: 189 }, { b: 300 }]), 3, 'a run of deposits minutes apart');
  eq(TC.together([{ b: 100 }, { b: 151 }, { b: 300 }]), 1, 'further apart');
  eq(TC.together([{ g: 'a', b: 100 }, { g: 'a', b: 100 }, { b: 5000 }]), 2, 'one block');
  eq(TC.together([{ g: 'x' }, { g: 'y' }, { b: 10 }, { b: 20 }, { b: 30 }]), 3, 'the larger set');
});
await test('what the pools hold: the large pools summed apart from Tacit, and each pool\'s whole notes', () => {
  const h = TC.held([147n * E / 10n, 657n * E + E / 20n, 4288n * E, 23750n * E, 281100n * E]);
  eq(h.tacit, 147n * E / 10n, 'tacit'); eq(h.tornado, 309795n * E + E / 20n, 'tornado');
  eq(h.notes.join(), '6570,4288,2375,2811', 'notes');
});
await test('split plans match the app for random amounts and every smallest note', () => {
  for (let i = 0; i < 2000; i++) {
    const wei = BigInt('0x' + hex(rnd(9))) % (400n * E), min = [10n ** 17n, E, 10n * E, 100n * E][i % 4];
    const a = TC.planSplit(wei, { min }), b = N.planSplit(wei, 1, { minDenominationWei: min, maxNotes: 6 });
    eq(JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? String(v) : v)), JSON.stringify(b, (k, v) => (typeof v === 'bigint' ? String(v) : v)), `plan ${wei}`);
    const total = a.notes.reduce((t, n) => t + n.denomination * BigInt(n.count), 0n);
    eq(total + a.remainder, wei, 'nothing lost');
  }
});
await test('under the smallest note there is nothing to split (the large pools stay out of sight)', () => { eq(TC.planSplit(E / 10n - 1n, { min: E / 10n }).noteCount, 0); eq(TC.planSplit(99n * E / 100n, { min: E }).noteCount, 0); });
await test('exit plans match the app', () => {
  for (let i = 0; i < 500; i++) {
    const dens = Array.from({ length: i % 7 }, (_, k) => TC.POOLS[(i + k) % 4].denomination), amt = BigInt('0x' + hex(rnd(9))) % (250n * E);
    eq(JSON.stringify(TC.planExit(amt, dens), (k, v) => (typeof v === 'bigint' ? String(v) : v)), JSON.stringify(PAY.planExit(amt, dens), (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  }
});
await test('the smallest note follows the gas price as the app\'s does', () => {
  for (const g of [1n, 10n ** 8n, 10n ** 9n, 2n * 10n ** 9n, 3n * 10n ** 9n, 2n * 10n ** 10n, 3n * 10n ** 10n, 10n ** 12n]) {
    const want = [10n ** 17n, 10n ** 18n, 10n ** 19n].find((d) => 1_000_000n * g * 50n <= d) ?? 10n ** 19n;
    eq(TC.autoSmallest(g), want, String(g));
  }
});

console.log('deposit history');
await test('a cache in the published shape is read: bracketed file names, digests, order, and a tail from the node', async () => {
  const { gzipSync } = await import('node:zlib');
  const pool = TC.POOLS[0], topic = '0x' + hex(D.keccak_256(new TextEncoder().encode('Deposit(bytes32,uint32,uint256)')));
  const ev = (i, block) => ({ address: pool.address, topics: [topic, '0x' + (1000n + BigInt(i)).toString(16).padStart(64, '0')], data: '0x' + BigInt(i).toString(16).padStart(64, '0') + '0'.repeat(64), blockNumber: '0x' + block.toString(16), logIndex: '0x0' });
  const files = { 'tornado-cash-1-eth-0.1-[0x10,0x20).jsonl.gz': [ev(0, 0x11), ev(1, 0x12)], 'tornado-cash-1-eth-0.1-[0x20,0x30).hot.jsonl.gz': [ev(2, 0x25)] };
  const raw = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v.map((x) => JSON.stringify(x)).join('\n') + '\n')]));
  const part = (k, a, b) => ({ file: k, fromBlock: a, toBlock: b, digest: { data: '0x' + hex(D.sha256(raw[k])) } });
  const keys = Object.keys(files);
  const index = { availableProtocols: { 'tornado-cash-1-eth-0.1': { trackedAddresses: [pool.address.toLowerCase()], chunks: [part(keys[0], '0x10', '0x20')], hotHead: part(keys[1], '0x20', '0x30') } } };
  const asked = [];
  const fetchImpl = async (u) => { asked.push(u); const name = decodeURIComponent(u.slice('https://c.example/'.length)); if (name === 'index.json') return new Response(JSON.stringify(index)); return raw[name] ? new Response(gzipSync(raw[name])) : new Response('no', { status: 404 }); };
  const tails = [], other = { ...ev(9, 0x32), address: TC.POOLS[1].address };
  const getLogs = async (f) => { tails.push(f); return BigInt(f.fromBlock) <= 0x31n ? [ev(3, 0x31), other] : []; };
  const r = await TC.poolLeaves({ pool, caches: ['https://c.example'], getLogs, blockNumber: async () => 0x40, fetchImpl });
  eq(r.count, 4, 'leaves (another pool\'s deposit in the tail is not one)');
  eq(tails.every((f) => f.address.length === TC.ALL_POOLS.length), true, 'the tail after the cache names every pool');
  eq(hex(r.bytes.subarray(96, 128)), (1003n).toString(16).padStart(64, '0'), 'the tail leaf');
  eq(asked.some((u) => u.includes('%5B0x10%2C0x20)')), true, 'names are sent encoded');
  raw[keys[0]] = Buffer.from(raw[keys[0]].toString().replace('0x11', '0x13'));   // changed after its digest was taken
  let note = null;
  await TC.poolLeaves({ pool, caches: ['https://c.example'], getLogs: async () => [ev(0, 0x11), ev(1, 0x12), ev(2, 0x25), ev(3, 0x31)], blockNumber: async () => 0x40, fetchImpl, onProgress: (p) => { if (p.note) note = p.note; } });
  eq(/digest/.test(note || ''), true, 'a file that does not match its digest sends the read to the node');
});
await test('a gzip that opens to more than its cap is refused', async () => {
  const { gzipSync } = await import('node:zlib'), z = gzipSync(Buffer.alloc(5000));
  eq((await TC.gunzip(z, 5000)).length, 5000, 'at the cap');
  let e = null;
  try { await TC.gunzip(z, 4999); } catch (x) { e = x; }
  eq(/larger than any should be/.test(e?.message || ''), true, e?.message);
});

console.log('the paymaster path');
const randAddr = () => '0x' + hex(rnd(20));
await test('paymaster data, the 7702 authorization digest and the operation digest match the app', () => {
  for (let i = 0; i < 40; i++) {
    const f = { instance: TC.POOLS[i % 4].address, proof: '0x' + hex(rnd(256)), root: '0x' + hex(rnd(32)), nullifierHash: '0x' + hex(rnd(32)), recipient: randAddr(), fee: BigInt('0x' + hex(rnd(8))) };
    eq(TC.paymasterData(f), P.encodePaymasterData(f), 'paymasterData');
    const nonce = i % 3, a = TC.authorizationDigest(1, TC.SIMPLE_7702, nonce), b = P.authorizationDigest(1, P.SIMPLE_7702, nonce);
    eq(hex(a), hex(b), 'authorization');
    const op = { sender: randAddr(), nonce: '0x0', callData: '0x', callGasLimit: '0x0', verificationGasLimit: '0x' + (50000 + i).toString(16), preVerificationGas: '0x186a0', maxFeePerGas: '0x' + (1e9 + i).toString(16), maxPriorityFeePerGas: '0x3b9aca00', paymaster: TC.PAYMASTER, paymasterVerificationGasLimit: '0x6ddd0', paymasterPostOpGasLimit: '0xc350', paymasterData: TC.paymasterData(f) };
    eq(hex(TC.userOpDigest(op)), hex(P.userOpDigest(op, 1)), 'userOp digest');
  }
});
await test('a signed operation: the sender is the key\'s address, both signatures recover to it, and the fields are the app\'s', async () => {
  for (let i = 0; i < 6; i++) {
    const key = rnd(32), gas = { ...TC.BASELINE, verificationGasLimit: 60_000n + BigInt(i) }, pd = '0x' + hex(rnd(64));
    const a = TC.directUserOp({ key, paymasterData: pd, gas, maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 6n });
    const b = await P.buildDirectUserOp({ key, chainId: 1, paymaster: P.PAYMASTERS[1].paymaster, paymasterData: pd, gas, maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 6n });
    for (const k of Object.keys(b)) if (k !== 'signature' && k !== 'eip7702Auth') eq(JSON.stringify(a[k]), JSON.stringify(b[k]), k);
    eq(a.sender, P.addressOf(key), 'sender');
    const sig = D.hexToBytes(a.signature.slice(2));
    const rec = D.secp.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(sig[64] - 27).recoverPublicKey(TC.userOpDigest(a));
    eq('0x' + hex(D.keccak_256(rec.toRawBytes(false).slice(1)).slice(12)), a.sender, 'op signer');
    const au = a.eip7702Auth, asig = D.secp.Signature.fromCompact(D.hexToBytes(au.r.slice(2) + au.s.slice(2))).addRecoveryBit(Number(au.yParity));
    eq('0x' + hex(D.keccak_256(asig.recoverPublicKey(TC.authorizationDigest(1, TC.SIMPLE_7702, 0)).toRawBytes(false).slice(1)).slice(12)), a.sender, 'authorization signer');
    eq(au.address, b.eip7702Auth.address); eq(au.chainId, b.eip7702Auth.chainId); eq(au.nonce, b.eip7702Auth.nonce);
  }
});
await test('fees, ceilings, bounds and fallback limits match the app', () => {
  for (let i = 0; i < 200; i++) {
    const p = BigInt('0x' + hex(rnd(5))), g = { ...TC.BASELINE, preVerificationGas: 100_000n + BigInt(i) * 1000n };
    eq(TC.minimumViableFee(g, p), P.minimumViableFee(g, p)); eq(TC.worstCaseFee(p), P.worstCaseFee(p));
    eq(TC.withinCeiling(p, E / 10n), P.withinCeiling(p, E / 10n));
    const op = { callData: '0x', paymasterData: '0x' + '00'.repeat(i * 3) };
    eq(JSON.stringify(TC.fallbackGas(g, op), (k, v) => String(v)), JSON.stringify(P.fallbackGas(g, op), (k, v) => String(v)));
    const ref = { baseFeePerGas: BigInt(i) * 10n ** 7n, maxPriorityFeePerGas: BigInt(i % 9) * 10n ** 8n }, price = { maxFeePerGas: p, maxPriorityFeePerGas: p / 3n };
    let a = null, b = null;
    try { TC.priceWithinBounds(price, ref); } catch (e) { a = e.message; }
    try { P.assertGasPriceWithinBounds(price, ref); } catch (e) { b = e.message.replace('wallet\'s node', 'page’s node').replace('bundler\'s', 'bundler’s'); }
    eq(a, b, 'price bounds');
  }
});
await test('estimate failures are read as the app reads them', () => {
  const op = { callData: '0x', callGasLimit: '0x0' };
  const cases = [{ kind: 'network' }, { kind: 'http', status: 429 }, { kind: 'http', status: 400 }, { kind: 'rpc', code: -32500, details: 'AA33 reverted 0x54107e37' + '0'.repeat(56) + '01312d00' }, { kind: 'rpc', code: -32603, details: 'Unknown error, could not parse simulate validation result.' }, { kind: 'rpc', code: -32500, details: 'AA23 reverted' }, { kind: 'incomplete-estimate' }];
  for (const c of cases) eq(TC.estimationUnavailable(c, op), P.estimationUnavailableReason(c, op), JSON.stringify(c));
});
await test('the bundler set behaves as the app\'s on the same scripted answers', async () => {
  const script = (answers) => { const log = []; const f = async (url, init) => { const { method } = JSON.parse(init.body); log.push(`${url.includes('pimlico') ? 'P' : 'C'}:${method}`); const a = answers[url.includes('pimlico') ? 'P' : 'C'](method); if (a instanceof Error) throw a; return { ok: a.status ? a.status < 400 : true, status: a.status || 200, json: async () => a.body }; }; return { f, log }; };
  const scenarios = [
    { P: () => ({ body: { result: { standard: { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' } } } }), C: () => ({ body: { error: { code: -32601, message: 'method not found' } } }), m: 'pimlico_getUserOperationGasPrice' },
    { P: () => new Error('down'), C: () => ({ body: { result: { callGasLimit: '0x0', verificationGasLimit: '0x1', preVerificationGas: '0x1', paymasterVerificationGasLimit: '0x1', paymasterPostOpGasLimit: '0x1' } } }), m: 'eth_estimateUserOperationGas' },
    { P: () => ({ body: { result: { callGasLimit: '0x0', verificationGasLimit: '0x1', preVerificationGas: '0x1' } } }), C: () => ({ body: { result: { callGasLimit: '0x0', verificationGasLimit: '0x1', preVerificationGas: '0x1', paymasterVerificationGasLimit: '0x2', paymasterPostOpGasLimit: '0x2' } } }), m: 'eth_estimateUserOperationGas' },
    { P: () => ({ body: { error: { code: -32500, message: 'AA23 reverted' } } }), C: () => ({ body: { result: '0x1' } }), m: 'eth_sendUserOperation' },
    { P: () => ({ status: 503, body: null }), C: () => ({ body: { result: '0xabc' } }), m: 'eth_sendUserOperation' },
    { P: () => ({ body: { result: null } }), C: () => ({ body: { result: { success: true } } }), m: 'eth_getUserOperationReceipt' },
  ];
  for (const s of scenarios) {
    const params = [{ paymaster: TC.PAYMASTER, callData: '0x', callGasLimit: '0x0' }];
    const a = script(s), b = script(s);
    const ra = await TC.bundlerSet(TC.BUNDLERS, a.f).request(s.m, params).then((r) => JSON.stringify(r), (e) => 'ERR ' + e.message);
    const rb = await P.bundlerSet(P.PAYMASTERS[1].bundlers, b.f).request(s.m, params).then((r) => JSON.stringify(r), (e) => 'ERR ' + e.message);
    eq(ra, rb, s.m); eq(a.log.join(','), b.log.join(','), s.m + ' order');
  }
});

console.log('bundlers that are shut, and a run of swapped notes');
{
  // Pimlico (first) answers `status` (with `body`, or no JSON); Candide works but has no price call
  const PIM = 'https://pimlico.example', CAN = 'https://candide.example';
  const setOf = (status, body = null, send = null) => TC.bundlerSet([PIM, CAN], async (url, init) => {
    const { method, id } = JSON.parse(init.body);
    if (url === PIM) return body ? new Response(JSON.stringify({ jsonrpc: '2.0', id, ...body }), { status, headers: { 'content-type': 'application/json' } }) : new Response('nope', { status });
    if (method === 'pimlico_getUserOperationGasPrice') return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    if (method === 'eth_estimateUserOperationGas') return Response.json({ jsonrpc: '2.0', id, result: { callGasLimit: '0x0', verificationGasLimit: '0x10000', preVerificationGas: '0x10000', paymasterVerificationGasLimit: '0x60000', paymasterPostOpGasLimit: '0x8000' } });
    if (method === 'eth_sendUserOperation' && send) return Response.json({ jsonrpc: '2.0', id, ...send });
    return Response.json({ jsonrpc: '2.0', id, result: null });
  });
  const prep = (bundler) => TC.prepareSponsored({
    pool: TC.POOLS[1], recipient: randAddr(), bundler, reference: { baseFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 8n },
    nodePrice: async () => ({ maxFeePerGas: 2n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 8n }),
    prove: async () => ({ proof: '0x' + '00'.repeat(256), root: '0x' + '22'.repeat(32), nullifierHash: '0x' + '33'.repeat(32) }), wait: async () => {},
  });
  for (const [status, body] of [[429], [401], [403], [404], [500], [503], [429, { error: { code: -32005, message: 'rate limit exceeded' } }], [403, { error: { code: -32000, message: 'no key' } }]]) {
    await test(`a first bundler answering ${status}${body ? ' with a JSON-RPC error' : ''} is passed over: the node's price, the next bundler's estimate`, async () => {
      const out = await prep(setOf(status, body));
      eq(out.gasEstimation.status, 'estimated', 'estimated'); eq(out.price.maxFeePerGas, 2n * 10n ** 9n, 'the node\'s price');
    });
  }
  await test('a refusal of the operation by the second bundler, after the first was shut, is what the send reports', async () => {
    const op = { sender: randAddr(), nonce: '0x0', callData: '0x', callGasLimit: '0x0', verificationGasLimit: '0x1', preVerificationGas: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', paymaster: TC.PAYMASTER, paymasterVerificationGasLimit: '0x1', paymasterPostOpGasLimit: '0x1', paymasterData: '0x', signature: '0x' };
    let e = null;
    try { await TC.sendSponsored({ op, bundler: setOf(429, null, { error: { code: -32602, message: 'maxFeePerGas must be at least 5' } }), wait: async () => {} }); } catch (x) { e = x; }
    eq(!!e && !e.unsure, true, 'not "could not tell": ' + e?.message); eq(/did not take/.test(e.message) && e.priceMoved === true, true, e?.message);
  });
  await test('an estimate refused by the first bundler is still final (it says something about the operation)', async () => {
    let e = null;
    try { await prep(setOf(200, { error: { code: -32500, message: 'AA23 reverted' } })); } catch (x) { e = x; }
    eq(/would not take the withdrawal\. Nothing was sent/.test(e?.message || ''), true, e?.message);
  });
  // a constant-product pool, no trade in between the notes: the later notes get a worse rate than the run's quote
  const outOf = (X, Y, dx) => Y * dx * 997n / (X * 1000n + dx * 997n), B = 10000n, slip = 50n;
  const runOf = (X, Y, notes, bad = null) => {
    const total = notes.reduce((a, b) => a + b, 0n), amountIn = total * 97n / 100n, floor = outOf(X, Y, amountIn) * (B - slip) / B * (B - slip) / B, minRate = floor * E / amountIn;
    const run = TC.runFloor(minRate), said = [];
    let x = X, y = Y;
    for (const [k, d] of notes.entries()) {
      const value = d - d / 200n, out = outOf(x, y, value), limit = (k === bad ? out * 9n / 10n : out) * (B - slip) / B;
      said.push(run.ok(limit, value));
      if (said.at(-1)) run.add(limit, value);
      x += value; y -= out;
    }
    return said;
  };
  await test('the run\'s floor: two 10 ETH notes into a pool 2000 ETH deep both go (one by one, the second would be refused)', () => {
    eq(runOf(2000n * E, 6_000_000n * 10n ** 6n, [10n * E, 10n * E]).join(), 'true,true');
    eq(runOf(500n * E, 1_000_000n * E, [10n * E, E, E]).join(), 'true,true,true', '10 + 1 + 1 into 500 ETH, 18 decimals');
  });
  await test('the run\'s floor still refuses a note that swaps well under it, and a route paying nothing', () => {
    eq(runOf(2000n * E, 6_000_000n * 10n ** 6n, [10n * E, 10n * E], 1).join(), 'true,false');
    eq(TC.runFloor(10n).ok(0n, E), false, 'nothing'); eq(TC.runFloor(null).ok(1n, E), true, 'no floor');
  });
}

console.log('the pools read without naming a note');
{
  const { gzipSync } = await import('node:zlib');
  const seed = rnd(32), dTopic = '0x' + hex(D.keccak_256(new TextEncoder().encode('Deposit(bytes32,uint32,uint256)')));
  eq(TC.WITHDRAWAL_TOPIC, '0x' + hex(D.keccak_256(new TextEncoder().encode('Withdrawal(address,bytes32,address,uint256)'))), 'withdrawal topic');
  const P01 = TC.POOLS[0], P1 = TC.POOLS[1], F = TC.NOTES_FROM;
  const noteAt = (n, pool) => TC.secretsOf(TC.seedRS(seed, n), pool.address);
  const w32 = (x) => BigInt(x).toString(16).padStart(64, '0');
  const dep = (pool, c, i, block) => ({ address: pool.address, topics: [dTopic, '0x' + w32(c)], data: '0x' + w32(i) + w32(0), blockNumber: '0x' + block.toString(16), logIndex: '0x0' });
  const wd = (pool, nh, to, block) => ({ address: pool.address, topics: [TC.WITHDRAWAL_TOPIC, '0x' + w32(0)], data: '0x' + w32(BigInt(to)) + w32(nh) + w32(0), blockNumber: '0x' + block.toString(16), logIndex: '0x0' });
  // the 0.1 pool's cache: an old file (before the seeds) and a hot head; note 0 in the head, note 1 in the node's tail,
  // note 2 in the 1 ETH pool (no cache stream: the node from NOTES_FROM); note 1 spent to its own swap-out account
  const n0 = noteAt(0, P01), n1 = noteAt(1, P01), n2 = noteAt(2, P1), acct1 = TC.addressOf(TC.noteKey(n1.preimage));
  const files = { 'tornado-cash-1-eth-0.1-[a).jsonl.gz': [dep(P01, 5n, 0, P01.deployBlock + 1)], 'tornado-cash-1-eth-0.1-[b).hot.jsonl.gz': [dep(P01, 6n, 1, F + 10), dep(P01, n0.commitment, 2, F + 20)] };
  const raw = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v.map((x) => JSON.stringify(x)).join('\n') + '\n')]));
  const part = (k, a, b) => ({ file: k, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16), digest: { data: '0x' + hex(D.sha256(raw[k])) } });
  const [ka, kb] = Object.keys(files), HEAD = F + 1000;
  const index = { availableProtocols: { 'tornado-cash-1-eth-0.1': { trackedAddresses: [P01.address.toLowerCase()], chunks: [part(ka, P01.deployBlock, F - 5)], hotHead: part(kb, F - 5, F + 100) } } };
  const fetched = [];
  const fetchImpl = async (u) => { const name = decodeURIComponent(u.slice('https://c.example/'.length)); fetched.push(name); if (name === 'index.json') return new Response(JSON.stringify(index)); return raw[name] ? new Response(gzipSync(raw[name])) : new Response('no', { status: 404 }); };
  const logs = [dep(P01, n1.commitment, 3, F + 200), dep(P1, n2.commitment, 0, F + 300), wd(P01, n1.nullifierHash, acct1, F + 400)];
  const filters = [];
  const getLogs = async (f) => { filters.push(f); const addrs = [].concat(f.address).map((a) => a.toLowerCase()), lo = Number(BigInt(f.fromBlock)), hi = Number(BigInt(f.toBlock)); return logs.filter((l) => addrs.includes(l.address.toLowerCase()) && l.topics[0] === f.topics[0] && Number(BigInt(l.blockNumber)) >= lo && Number(BigInt(l.blockNumber)) <= hi); };
  // each pool's deposit count at a block (nextIndex, which names no note); any other call is one that would
  const named = [], blocksOf = { [P01.address]: [P01.deployBlock + 1, F + 10, F + 20, F + 200], [P1.address]: [F + 300] };
  const countAt = (to, b) => (blocksOf[to] ?? []).filter((x) => x <= b).length;
  const read = async (m, p) => { if (m === 'eth_call') { if (p[0].data === '0xfc7e9c6f') return '0x' + w32(countAt(p[0].to, Number(BigInt(p[1])))); named.push(p[0].data.slice(0, 10)); return '0x' + '0'.repeat(64); } throw new Error('unexpected ' + m); };
  // other single nodes, for confirming a withdrawal: each serves `ls` filtered as asked
  const nodeOf = (ls, asked = []) => async (f) => { asked.push(f); return getLogsOf(ls)(f); };
  const getLogsOf = (ls) => async (f) => { const addrs = [].concat(f.address).map((a) => a.toLowerCase()), lo = Number(BigInt(f.fromBlock)), hi = Number(BigInt(f.toBlock)); return ls.filter((l) => addrs.includes(l.address.toLowerCase()) && l.topics[0] === f.topics[0] && Number(BigInt(l.blockNumber)) >= lo && Number(BigInt(l.blockNumber)) <= hi); };
  const confirms = [];
  const book = TC.poolBook({ getLogs, blockNumber: async () => HEAD, read, others: () => [nodeOf(logs, confirms), nodeOf(logs, confirms)], caches: ['https://c.example'], fetchImpl });
  const flow = TC.makeFlow({ read, account: randAddr(), seed, book, store: { get: () => null, set: () => {} } });
  let found = null;
  await test('Find with a book finds the notes in the cache, the tail and a pool with no cache, asking no node about a note', async () => {
    ({ found } = await flow.scan());
    eq(found.length, 3, 'found'); eq(named.length, 0, 'eth_calls naming a note: ' + named.join());
    eq(found.map((f) => `${f.nonce}:${f.block}:${f.index}`).join(), `0:${F + 20}:2,1:${F + 200}:3,2:${F + 300}:0`, 'blocks and leaves');
    eq(fetched.includes(ka), false, 'the file from before the seeds is not fetched');
    // every request the same for every reader: all nine pools, from NOTES_FROM, by event only (no note's block or pool)
    eq(filters.every((f) => f.address.length === TC.ALL_POOLS.length && [F, HEAD + 1 - 64].includes(Number(BigInt(f.fromBlock))) && !f.topics.slice(1).some(Boolean)), true, 'requests: ' + JSON.stringify(filters.map((f) => [f.address.length, Number(BigInt(f.fromBlock)) - F])));
  });
  await test('a read from further back fetches only the files before what was read, and keeps what was', async () => {
    const before = fetched.length;
    await book.deposits(TC.ALL_POOLS, 0);
    eq(fetched.slice(before).includes(ka), true, 'the older file fetched');
    eq(!!book.deposit(P01, 5n) && !!book.deposit(P01, n0.commitment) && !!book.deposit(P01, n1.commitment), true, 'the old leaf and the ones read before');
  });
  await test('spent from the withdrawals read in bulk; a swap-out to its own account is marked as such', () => {
    eq(found.map((f) => String(f.spent)).join(), 'false,true,false', 'spent');
    eq(confirms.length === 2 && confirms.every((f) => f.address.length === TC.ALL_POOLS.length && Number(BigInt(f.toBlock)) - Number(BigInt(f.fromBlock)) <= 99), true, 'confirmed by two other nodes, asked for every pool\'s withdrawals over the 100-block run around it: ' + JSON.stringify(confirms[0]));
    const m = found.map(TC.metaOf);
    eq(m[1].sp === 1 && m[1].left === 1 && m[1].b === F + 200, true, JSON.stringify(m[1]));
    eq(m[0].w === HEAD + 1 && !m[0].sp, true, 'checked up to the head: ' + JSON.stringify(m[0]));
  });
  await test('a later read goes on from where the last stopped; a note too old for the span is not called spent or unspent', async () => {
    const before = filters.length;
    await book.withdrawals([P01], F + 20);
    const more = filters.slice(before);
    eq(more.length <= 1 && more.every((f) => Number(BigInt(f.fromBlock)) >= HEAD + 1 - 64 && f.address.length === TC.ALL_POOLS.length), true, 'only the last 64 blocks again: ' + JSON.stringify(more));
    eq(await flow.spent(P01, n0.nullifierHash, HEAD - TC.SPENT_SPAN - 1), null, 'too old: unknown');
  });
  await test('records keep what any copy knows: spent stays spent, the deposit block, the furthest check, the latest leftover word', () => {
    const s = new Map(), st = { get: (k) => s.get(k), set: (k, v) => s.set(k, v) }, a = randAddr();
    const r = { nonce: 1, pool: P01.address, c: '0x' + 'cc'.repeat(32), nh: '0x01', s: 'k' };
    const out = TC.writeNotes(st, a, [{ ...r, w: 5 }, { ...r, sp: 1, b: 7, i: 2 }, { ...r, w: 9, left: 1 }, { ...r, left: 0 }]);
    eq(out.length, 1); eq(JSON.stringify([out[0].sp, out[0].b, out[0].i, out[0].w, out[0].left]), '[1,7,2,9,0]');
  });
  // the same chain, with a cache that leaves out note 0's deposit (leaf 2), and a node that may too
  const holed = { ...raw, [kb]: Buffer.from([dep(P01, 6n, 1, F + 10)].map((x) => JSON.stringify(x)).join('\n') + '\n') };
  const index2 = JSON.parse(JSON.stringify(index));
  index2.availableProtocols['tornado-cash-1-eth-0.1'].hotHead.digest.data = '0x' + hex(D.sha256(holed[kb]));
  const fetch2 = async (u) => { const name = decodeURIComponent(u.slice('https://c.example/'.length)); if (name === 'index.json') return new Response(JSON.stringify(index2)); return holed[name] ? new Response(gzipSync(holed[name])) : new Response('no', { status: 404 }); };
  const all = [dep(P01, 6n, 1, F + 10), dep(P01, n0.commitment, 2, F + 20), ...logs];
  const bookOf = (nodeLogs, others = () => []) => TC.poolBook({ getLogs: getLogsOf(nodeLogs), blockNumber: async () => HEAD, read, others, caches: ['https://c.example'], fetchImpl: fetch2 });
  await test('a cache that leaves out a deposit leaves a gap up to the pool\'s count: the pool is read again from the node, and it says so', async () => {
    // the node serves leaf 2 only when asked again (the read from the node alone after a gap)
    let n = 0;
    const notes = [], b = TC.poolBook({ getLogs: async (f) => getLogsOf(n++ ? all : logs)(f), blockNumber: async () => HEAD, read, caches: ['https://c.example'], fetchImpl: fetch2 });
    await b.deposits([P01], F, (p) => { if (p.note) notes.push(p.note); });
    eq(!!b.deposit(P01, n0.commitment), true, 'note 0\'s deposit read');
    eq(notes.some((x) => /0\.1 ETH pool’s deposits read did not add up/.test(x)), true, notes.join(' | '));
    const r = await TC.makeFlow({ read, account: randAddr(), seed, book: bookOf(all), store: { get: () => null, set: () => {} } }).scan();
    eq(r.found.map((f) => f.nonce).join(), '0,1,2', 'Find finds note 0');
  });
  await test('a cache that leaves out the first deposits after its start is caught by the count at the block before, and read again from the node', async () => {
    // every pool has a stream to the same block, so the node is asked only after it; the 0.1 pool's leaves out leaf 1
    const cut = { ...raw, [kb]: Buffer.from([dep(P01, n0.commitment, 2, F + 20)].map((x) => JSON.stringify(x)).join('\n') + '\n'), 'empty.gz': Buffer.alloc(0) };
    const ix = JSON.parse(JSON.stringify(index));
    ix.availableProtocols['tornado-cash-1-eth-0.1'].hotHead.digest.data = '0x' + hex(D.sha256(cut[kb]));
    const none = { file: 'empty.gz', fromBlock: '0x' + (F - 5).toString(16), toBlock: '0x' + (F + 100).toString(16), digest: { data: '0x' + hex(D.sha256(new Uint8Array(0))) } };
    for (const q of TC.ALL_POOLS.slice(1)) ix.availableProtocols[`tornado-cash-1-eth-${TC.ethWords(q.denomination)}`] = { trackedAddresses: [q.address.toLowerCase()], chunks: [], hotHead: none };
    const fc = async (u) => { const name = decodeURIComponent(u.slice('https://c.example/'.length)); return name === 'index.json' ? new Response(JSON.stringify(ix)) : cut[name] ? new Response(gzipSync(cut[name])) : new Response('no', { status: 404 }); };
    for (const old of [true, false]) {
      // `old`: a node that keeps old state; without one, the cache's deposits are read again from the node all the same
      const r = old ? read : async (m, p) => (Number(BigInt(p[1])) < HEAD - 128 ? Promise.reject(new Error('missing trie node')) : read(m, p));
      const notes = [], b = TC.poolBook({ getLogs: getLogsOf(all), blockNumber: async () => HEAD, read: r, caches: ['https://c.example'], fetchImpl: fc });
      await b.deposits([P01], F, (p) => { if (p.note) notes.push(p.note); });
      eq(!!b.deposit(P01, 6n), true, `the left-out leaf is read (${old})`);
      eq(notes.some((x) => /0\.1 ETH pool’s deposits read did not add up/.test(x)), true, notes.join(' | '));
    }
  });
  await test('a cache file that begins before the read holds earlier deposits: they are left out, and the read adds up', async () => {
    // the hot head starts at F - 5 and holds a deposit at F - 3 (leaf 1); the read from F begins at the count at F - 1
    const early = { ...raw, [kb]: Buffer.from([dep(P01, 7n, 1, F - 3), dep(P01, 6n, 2, F + 10), dep(P01, n0.commitment, 3, F + 20)].map((x) => JSON.stringify(x)).join('\n') + '\n') };
    const ix = JSON.parse(JSON.stringify(index));
    ix.availableProtocols['tornado-cash-1-eth-0.1'].hotHead.digest.data = '0x' + hex(D.sha256(early[kb]));
    const fe = async (u) => { const name = decodeURIComponent(u.slice('https://c.example/'.length)); return name === 'index.json' ? new Response(JSON.stringify(ix)) : early[name] ? new Response(gzipSync(early[name])) : new Response('no', { status: 404 }); };
    const counts = { [P01.address]: [P01.deployBlock + 1, F - 3, F + 10, F + 20, F + 200], [P1.address]: [F + 300] };
    const r = async (m, p) => { if (m === 'eth_call' && p[0].data === '0xfc7e9c6f') return '0x' + w32((counts[p[0].to] ?? []).filter((x) => x <= Number(BigInt(p[1]))).length); return '0x' + '0'.repeat(64); };
    const nodeLogs = [dep(P01, n1.commitment, 4, F + 200), dep(P1, n2.commitment, 0, F + 300)], notes = [];
    const b = TC.poolBook({ getLogs: getLogsOf(nodeLogs), blockNumber: async () => HEAD, read: r, caches: ['https://c.example'], fetchImpl: fe });
    await b.deposits(TC.ALL_POOLS, F, (p) => { if (p.note) notes.push(p.note); });
    eq(notes.filter((x) => /did not add up/.test(x)).length, 0, notes.join(' | '));
    eq(!!b.deposit(P01, n0.commitment) && !!b.deposit(P01, n1.commitment) && !b.deposit(P01, 7n), true, 'the deposits from F on, not the earlier one');
  });
  await test('two reads at once fetch each file once', async () => {
    const seen = [], b = TC.poolBook({ getLogs, blockNumber: async () => HEAD, read, caches: ['https://c.example'], fetchImpl: async (u) => { seen.push(u); return fetchImpl(u); } });
    await Promise.all([b.deposits(TC.ALL_POOLS, F), b.deposits(TC.ALL_POOLS, F)]);
    eq(seen.filter((u) => u.includes(encodeURIComponent(kb))).length, 1, seen.join(' '));
  });
  await test('a node that refuses 5,000 blocks confirms over the 100-block run around the withdrawal (all pools)', async () => {
    const asked = [], small = (ls) => async (f) => { asked.push(f); if (BigInt(f.toBlock) - BigInt(f.fromBlock) > 99n) throw new Error('range'); return getLogsOf(ls)(f); };
    const b = TC.poolBook({ getLogs, blockNumber: async () => HEAD, read, others: () => [small(logs), small(logs)], caches: ['https://c.example'], fetchImpl });
    await b.withdrawals([P01], F);
    eq(await b.confirmed(P01, n1.nullifierHash), true, 'confirmed');
    const last = asked.at(-1);
    eq(Number(BigInt(last.fromBlock)) % 100 === 0 && Number(BigInt(last.toBlock)) - Number(BigInt(last.fromBlock)) === 99 && last.address.length === TC.ALL_POOLS.length, true, JSON.stringify(last));
  });
  await test('spent as the chain confirmed it (sv) is undone only by the reader\'s own node (so), which also clears "may be spent"', () => {
    const s = new Map(), st = { get: (k) => s.get(k), set: (k, v) => s.set(k, v) }, a = randAddr(), r = { nonce: 1, pool: P01.address, c: '0x' + 'dd'.repeat(32), nh: '0x02', s: 'k' };
    eq(TC.writeNotes(st, a, [{ ...r, sp: 1, sv: 1 }, { ...r, sp: 0, ms: 0 }])[0].sp, 1, 'a Find from the logs node does not undo it');
    const o = TC.writeNotes(st, a, [{ ...r, sp: 1, sv: 1, ms: 1 }, { ...r, sp: 0, ms: 0, so: 1 }])[0];
    eq(JSON.stringify([o.sp, o.sv, o.ms]), '[0,0,0]', 'the own node\'s word does');
    eq(TC.writeNotes(st, a, [{ ...r, sp: 1 }, { ...r, sp: 0 }])[0].sp, 0, 'one from before sv: any check');
    eq(TC.metaOf({ ...found[1], spent: false, own: true }).so, 1, 'a scan from the own node says so');
  });
  await test('a node that leaves it out too: Find stops and says the deposits do not add up (no note is missed quietly)', async () => {
    let e = null;
    try { await TC.makeFlow({ read, account: randAddr(), seed, book: bookOf(logs), store: { get: () => null, set: () => {} } }).scan(); } catch (x) { e = x; }
    eq(/do not add up/.test(e?.message || ''), true, e?.message);
  });
  await test('a withdrawal only the first node serves is "may be spent": not spent, not unspent, and not kept as spent', async () => {
    for (const others of [() => [nodeOf(all), nodeOf([])], () => []]) {
      const f3 = TC.makeFlow({ read, account: randAddr(), seed, book: bookOf(all, others), store: { get: () => null, set: () => {} } });
      const r = await f3.scan(), one = r.found.find((f) => f.nonce === 1);
      eq(one.spent === null && one.maybe === true && !TC.metaOf(one).sp && !TC.metaOf(one).w, true, JSON.stringify({ spent: one.spent, maybe: one.maybe }));
    }
  });
}

console.log('a note out: spent only as the chain shows it, paid to this operation\'s recipient');
{
  const pool = TC.POOLS[1], seed = rnd(32), sec = TC.secretsOf(TC.seedRS(seed, 0), pool.address), noteText = TC.noteString(pool.denomination, sec.preimage);
  const w32 = (x) => BigInt(x).toString(16).padStart(64, '0'), word = (x) => '0x' + w32(x), ROOT = '0x' + '12'.repeat(32), TX = '0x' + 'ab'.repeat(32);
  const selOf = (s) => '0x' + hex(D.keccak_256(new TextEncoder().encode(s)).slice(0, 4)), DEN = selOf('denomination()'), WD = selOf('withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)');
  const noCode = new Set(), unreadable = new Set(), lc = (s) => String(s).toLowerCase(), used = [], LAST = selOf('getLastRoot()'), calls = [], last = { root: ROOT };
  const read = async (m, p) => {
    calls.push([m, p[0]?.to ?? p[0], p[0]?.data?.slice(0, 10)]);
    if (m === 'eth_getCode') { if (noCode.has(lc(p[0]))) return '0x'; if (m === 'eth_getCode' && unreadable.has(lc(p[0]))) throw new Error('down'); return '0x6080'; }
    if (m === 'eth_call') return p[0].data === DEN ? word(pool.denomination) : p[0].data === LAST ? (lc(p[0].to) === lc(pool.address) ? last.root : word(7)) : word(1);
    if (m === 'eth_feeHistory') return { reward: [['0x5f5e100']], baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'] };
    throw new Error('unexpected ' + m);
  };
  const prover = { load: async () => ({ root: ROOT }), prove: async ({ recipient, relayer, fee }) => {
    const proof = '00'.repeat(256), body = [224, ROOT, sec.nullifierHash, recipient, relayer, fee, 0, 256].map(w32).join('') + proof;
    return { target: pool.address, input: WD + body, proof: '0x' + proof, root: ROOT, nullifierHash: TC.b32(sec.nullifierHash) };
  } };
  const leaves = async () => ({ bytes: D.hexToBytes(w32(sec.commitment)), count: 1, blocks: Uint32Array.of(50) });
  // the book sees the withdrawal named `after` (to, tx) once the bundler has said the operation was mined
  const run = async (after, success = true, o = {}) => {
    const w = { v: null }, recipient = randAddr();
    const book = { tip: async () => 100, again() {}, deposits: async () => {}, withdrawals: async () => {}, deposit: () => null, withdrawal: () => w.v, confirmed: async () => !!w.v };
    const fetchImpl = async (url, init) => {
      const { method, id } = JSON.parse(init.body), res = (result) => Response.json({ jsonrpc: '2.0', id, result });
      if (method === 'pimlico_getUserOperationGasPrice') return res({ standard: { maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x5f5e100' } });
      if (method === 'eth_estimateUserOperationGas') { used.push(lc(JSON.parse(init.body).params[0].paymaster)); if (o.bad?.includes(lc(JSON.parse(init.body).params[0].paymaster))) return Response.json({ jsonrpc: '2.0', id, error: { code: -32500, message: 'AA33 reverted' } }); }
      if (method === 'eth_estimateUserOperationGas') return res({ callGasLimit: '0x0', verificationGasLimit: '0x10000', preVerificationGas: '0x10000', paymasterVerificationGasLimit: '0x60000', paymasterPostOpGasLimit: '0x8000' });
      if (method === 'eth_getUserOperationReceipt') { w.v = after && { to: after.to === 'me' ? recipient.toLowerCase() : after.to, tx: after.tx }; return res({ success, receipt: { transactionHash: TX } }); }
      return res(null);
    };
    const flow = TC.makeFlow({ read, book, poll: 1 });
    return flow.withdrawSponsored({ noteText, recipient, prover, leaves, caches: [], bundlers: ['https://b.example'], fetchImpl, confirm: async () => true, ...(o.paymasters ? { paymasters: o.paymasters } : {}) });
  };
  await test('a bundler\'s receipt alone is not spent: the withdrawal the chain shows must pay this recipient, in this transaction', async () => {
    eq((await run(null)).spent, false, 'no withdrawal seen');
    eq((await run({ to: randAddr().toLowerCase(), tx: TX })).spent, false, 'the note paid someone else');
    eq((await run({ to: 'me', tx: '0x' + 'cd'.repeat(32) })).spent, false, 'in another transaction');
    const out = await run({ to: 'me', tx: TX });
    eq(out.spent, true, 'this one');
    eq(out.at, 100, 'and says the head block it was sent at (kept with a note sent but not seen)');
  });
  await test('the root is held to every pool\'s last root in one go; the pool is asked by name only when that differs, and its code and size are not read', async () => {
    calls.length = 0;
    await run({ to: 'me', tx: TX });
    const KNOWN = selOf('isKnownRoot(bytes32)');
    eq(calls.filter((c) => c[2] === LAST).length, TC.ALL_POOLS.length, 'every pool\'s last root');
    eq(calls.some((c) => c[2] === KNOWN || c[2] === DEN || (c[0] === 'eth_getCode' && lc(c[1]) === lc(pool.address))), false, JSON.stringify(calls));
    last.root = word(9); calls.length = 0;
    await run({ to: 'me', tx: TX });
    eq(calls.some((c) => c[2] === KNOWN && lc(c[1]) === lc(pool.address)), true, 'a moved last root: the pool is asked whether it knows the root');
    last.root = ROOT;
  });
  await test('a tree built ahead (warm) is the one the press uses: one read of the leaves and one build in all', async () => {
    let loads = 0, reads = 0;
    const counting = { ...prover, load: async (b) => { loads++; return prover.load(b); } }, cache = { pools: new Map(), loaded: null };
    const book = { tip: async () => 100, again() {}, deposits: async () => {}, withdrawals: async () => {}, deposit: () => null, withdrawal: () => null, confirmed: async () => false };
    const flow = TC.makeFlow({ read, book, poll: 1 }), counted = async (...a) => { reads++; return leaves(...a); };
    eq(await flow.warm({ noteText, prover: counting, leaves: counted, caches: [], cache }), true, 'warmed');
    const fetchImpl = async (url, init) => { const { method, id } = JSON.parse(init.body), res = (result) => Response.json({ jsonrpc: '2.0', id, result });
      if (method === 'pimlico_getUserOperationGasPrice') return res({ standard: { maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x5f5e100' } });
      if (method === 'eth_estimateUserOperationGas') return res({ callGasLimit: '0x0', verificationGasLimit: '0x10000', preVerificationGas: '0x10000', paymasterVerificationGasLimit: '0x60000', paymasterPostOpGasLimit: '0x10000' });
      if (method === 'eth_sendUserOperation') return res('0x' + 'ee'.repeat(32));
      return res(null); };
    await flow.withdrawSponsored({ noteText, recipient: randAddr(), prover: counting, leaves: counted, caches: [], cache, bundlers: ['https://b.example'], fetchImpl, confirm: async () => false }).catch(() => null);
    eq(`${reads} read(s), ${loads} build(s)`, '1 read(s), 1 build(s)', 'the press built nothing again');
  });
  await test('an operation mined with success=false counts as paid only if the note paid this recipient', async () => {
    let e = null;
    try { await run({ to: randAddr().toLowerCase(), tx: TX }, false); } catch (x) { e = x; }
    eq(/failed on chain/.test(e?.message || ''), true, e?.message);
    eq((await run({ to: 'me', tx: TX }, false)).spent, true, 'paid in validation');
  });
  await test('Find\'s word that a note is unspent clears a stale "spent", and "sent, not seen" takes the latest word', () => {
    const s = new Map(), st = { get: (k) => s.get(k), set: (k, v) => s.set(k, v) }, r = { nonce: 0, pool: pool.address, c: TC.b32(sec.commitment), nh: TC.b32(sec.nullifierHash), s: 'k' };
    eq(TC.metaOf({ nonce: 0, pool, secrets: sec, s: 'k', spent: false }).sp, 0, 'checked unspent');
    eq(TC.metaOf({ nonce: 0, pool, secrets: sec, s: 'k', spent: null }).sp, undefined, 'not known');
    const out = TC.writeNotes(st, randAddr(), [{ ...r, sp: 1, o: 5 }, { ...r, sp: 0 }, { ...r, o: 0 }]);
    eq(JSON.stringify([out[0].sp, out[0].o]), '[0,0]');
  });
  const A1 = TC.PAYMASTER, A2 = '0x' + '22'.repeat(20), A3 = '0x' + '33'.repeat(20);
  await test('registry paymasters: the seed first, shape and interface checked, unknown tags and repeats ignored, unreadable lists leave the seed', () => {
    eq(TC.parsePaymasters().map((p) => p.address).join(), A1, 'no registry: the seed only');
    eq(TC.parsePaymasters(undefined).length, 1, 'unreadable');
    const got = TC.parsePaymasters([`${A2} kohaku-v1`, `${A3} future-v9`, `${A1.toLowerCase()} kohaku-v1`, 'junk', `${A2} kohaku-v1`, 7]);
    eq(got.map((p) => p.address).join(), `${A1},${A2}`, 'unknown tag and repeats dropped');
  });
  await test('a listed paymaster with no code is skipped, and one whose code cannot be read is passed over', async () => {
    noCode.add(A2); unreadable.add(A3);
    const v = await TC.vetPaymasters([...TC.PAYMASTERS, { address: A2, iface: 'kohaku-v1' }, { address: A3, iface: 'kohaku-v1' }], read);
    noCode.clear(); unreadable.clear();
    eq(v.map((p) => p.address).join(), A1);
  });
  await test('a first paymaster whose bundler refuses before sending is followed by the next: the proof is made for its address, and the receipt names it', async () => {
    used.length = 0;
    const out = await run({ to: 'me', tx: TX }, true, { bad: [lc(A1)], paymasters: [...TC.PAYMASTERS, { address: A2, iface: 'kohaku-v1' }] });
    eq(out.paymaster, A2, 'carried by the second'); eq(out.spent, true);
    eq(used.includes(lc(A1)) && used.includes(lc(A2)), true, 'both asked: ' + used.join());
  });
  await test('every paymaster refusing: the last refusal is the error, nothing sent; none with code: said', async () => {
    let e = null;
    try { await run({ to: 'me', tx: TX }, true, { bad: [lc(A1), lc(A2)], paymasters: [...TC.PAYMASTERS, { address: A2, iface: 'kohaku-v1' }] }); } catch (x) { e = x; }
    eq(/would not take the withdrawal/.test(e?.message || ''), true, e?.message);
    noCode.add(lc(A1)); e = null;
    try { await run({ to: 'me', tx: TX }); } catch (x) { e = x; }
    noCode.clear();
    eq(/Gas from the note is not available right now/.test(e?.message || ''), true, e?.message);
  });
  await test('the fee cap holds for a listed paymaster: a fee over 3% of the note is not proved or sent', async () => {
    let e = null;
    try { await TC.prepareSponsored({ paymaster: A2, pool: TC.POOLS[0], recipient: randAddr(), bundler: TC.bundlerSet(['https://b.example'], async (u, i) => { const { method, id } = JSON.parse(i.body); return Response.json({ jsonrpc: '2.0', id, result: method === 'pimlico_getUserOperationGasPrice' ? { standard: { maxFeePerGas: '0x174876e800', maxPriorityFeePerGas: '0x77359400' } } : null }); }), reference: { baseFeePerGas: 90n * 10n ** 9n, maxPriorityFeePerGas: 2n * 10n ** 9n }, prove: async () => { throw new Error('proved'); }, priceTries: 0, wait: async () => {} }); } catch (x) { e = x; }
    eq(/over 3% of the note/.test(e?.message || ''), true, e?.message);
  });
  await test('a deposit count that cannot be read is not a pass: the read stops and says to try again', async () => {
    const b = TC.poolBook({ getLogs: async () => [], blockNumber: async () => TC.NOTES_FROM + 10, read: async () => { throw new Error('down'); }, caches: [] });
    let e = null;
    try { await b.deposits([pool]); } catch (x) { e = x; }
    eq(/Could not read the pool’s deposit count/.test(e?.message || ''), true, e?.message);
  });
}

console.log('withdrawals from the cache\'s files');
{
  const { gzipSync } = await import('node:zlib');
  const seed = rnd(32), P01 = TC.POOLS[0], F = TC.NOTES_FROM, HEAD = F + 1000;
  const w32 = (x) => BigInt(x).toString(16).padStart(64, '0');
  const dTopic = '0x' + hex(D.keccak_256(new TextEncoder().encode('Deposit(bytes32,uint32,uint256)')));
  const n0 = TC.secretsOf(TC.seedRS(seed, 0), P01.address), n1 = TC.secretsOf(TC.seedRS(seed, 1), P01.address), acct0 = TC.addressOf(TC.noteKey(n0.preimage));
  // lines as the published files have them: contractAddress, no transaction hash
  const dep = (c, i, block, ix) => ({ contractAddress: P01.address.toLowerCase(), eventTopic: dTopic, topics: [dTopic, '0x' + w32(c)], data: '0x' + w32(i) + w32(0), blockNumber: '0x' + block.toString(16), logIndex: '0x' + ix.toString(16) });
  const wd = (nh, to, block, ix) => ({ contractAddress: P01.address.toLowerCase(), eventTopic: TC.WITHDRAWAL_TOPIC, topics: [TC.WITHDRAWAL_TOPIC, '0x' + w32(7)], data: '0x' + w32(BigInt(to)) + w32(nh) + w32(5), blockNumber: '0x' + block.toString(16), logIndex: '0x' + ix.toString(16) });
  const lines = [dep(n0.commitment, 0, F + 10, 0), dep(n1.commitment, 1, F + 20, 0), wd(n0.nullifierHash, acct0, F + 50, 1)];
  const raw = Buffer.from(lines.map((x) => JSON.stringify(x)).join('\n') + '\n'), file = 'tornado-cash-1-eth-0.1-[a).hot.jsonl.gz';
  // every pool has a stream (the same file: only the lines of its own pool are taken from it)
  const mk = (topics) => ({ availableProtocols: Object.fromEntries(TC.ALL_POOLS.map((p) => [`tornado-cash-1-eth-${TC.ethWords(p.denomination)}`, { trackedAddresses: [p.address.toLowerCase()], ...(topics ? { trackedEventTopics: [dTopic, TC.WITHDRAWAL_TOPIC] } : {}), chunks: [], hotHead: { file, fromBlock: '0x' + (F - 5).toString(16), toBlock: '0x' + (F + 100).toString(16), digest: { data: '0x' + hex(D.sha256(raw)) } } }])) });
  const bookOf = (topics, logs = [], head = HEAD) => {
    const calls = [], index = mk(topics);
    const fetchImpl = async (u) => { const n = decodeURIComponent(u.slice('https://c.example/'.length)); return n === 'index.json' ? new Response(JSON.stringify(index)) : n === file ? new Response(gzipSync(raw)) : new Response('no', { status: 404 }); };
    const getLogs = async (f) => { calls.push(f); const lo = Number(BigInt(f.fromBlock)), hi = Number(BigInt(f.toBlock)); return logs.filter((l) => l.topics[0] === f.topics[0] && Number(BigInt(l.blockNumber)) >= lo && Number(BigInt(l.blockNumber)) <= hi); };
    return { calls, book: TC.poolBook({ getLogs, blockNumber: async () => head, caches: ['https://c.example'], fetchImpl }) };
  };
  await test('a cache that tracks withdrawals gives them over the blocks it covers: no node read there, only the tail', async () => {
    const { book, calls } = bookOf(true);
    await book.deposits(TC.ALL_POOLS, F);
    const before = calls.length;
    await book.withdrawals(TC.ALL_POOLS, F);
    const w = book.withdrawal(P01, n0.nullifierHash);
    eq(!!w && w.block === F + 50 && w.to === acct0.toLowerCase() && !w.tx, true, JSON.stringify(w));
    eq(book.withdrawal(P01, n1.nullifierHash), null, 'the other note is unspent');
    const asked = calls.slice(before);
    eq(asked.length > 0 && asked.every((f) => Number(BigInt(f.fromBlock)) >= F + 100 - 64 && f.address.length === TC.ALL_POOLS.length && f.topics[0] === TC.WITHDRAWAL_TOPIC), true, 'only the tail, all pools: ' + JSON.stringify(asked));
  });
  await test('a tail withdrawal the node gives is added to the cache\'s', async () => {
    const tail = { address: P01.address, topics: [TC.WITHDRAWAL_TOPIC, '0x' + w32(7)], data: '0x' + w32(1) + w32(n1.nullifierHash) + w32(5), blockNumber: '0x' + (F + 500).toString(16), transactionHash: '0x' + 'ee'.repeat(32), logIndex: '0x0' };
    const { book } = bookOf(true, [tail]);
    await book.deposits(TC.ALL_POOLS, F); await book.withdrawals(TC.ALL_POOLS, F);
    eq(book.withdrawal(P01, n1.nullifierHash)?.block, F + 500); eq(!!book.withdrawal(P01, n0.nullifierHash), true);
  });
  await test('a far-back read fetches the cache for itself, and asks the node nothing before the cache ends', async () => {
    const { book, calls } = bookOf(true, [], F + 60_000);
    await book.withdrawals(TC.ALL_POOLS, F);
    eq(!!book.withdrawal(P01, n0.nullifierHash), true, 'spent from the cache');
    eq(calls.filter((f) => f.topics[0] === TC.WITHDRAWAL_TOPIC).every((f) => Number(BigInt(f.fromBlock)) >= F + 100 - 64), true, 'node reads start at the cache\'s end');
  });
  await test('a cache that does not track withdrawals falls back to the node for the whole range', async () => {
    const wl = { address: P01.address, topics: [TC.WITHDRAWAL_TOPIC, '0x' + w32(7)], data: '0x' + w32(BigInt(acct0)) + w32(n0.nullifierHash) + w32(5), blockNumber: '0x' + (F + 50).toString(16), transactionHash: '0x' + 'ee'.repeat(32), logIndex: '0x1' };
    const { book, calls } = bookOf(false, [wl]);
    await book.deposits(TC.ALL_POOLS, F); await book.withdrawals(TC.ALL_POOLS, F);
    eq(book.withdrawal(P01, n0.nullifierHash)?.tx, '0x' + 'ee'.repeat(32), 'from the node');
    eq(calls.some((f) => f.topics[0] === TC.WITHDRAWAL_TOPIC && Number(BigInt(f.fromBlock)) === F), true, 'read from the start');
  });
  await test('confirmation asks the 100-block run around the exact block, once for notes in it, across all pools', async () => {
    const { book } = bookOf(true), asked = [], logs = lines.filter((l) => l.topics[0] === TC.WITHDRAWAL_TOPIC).map((l) => ({ ...l, address: l.contractAddress }));
    const node = async (f) => { asked.push(f); return logs; };
    const b = TC.poolBook({ getLogs: async () => [], blockNumber: async () => HEAD, others: () => [node, node], caches: ['https://c.example'], fetchImpl: async (u) => { const n = decodeURIComponent(u.slice('https://c.example/'.length)); return n === 'index.json' ? new Response(JSON.stringify(mk(true))) : new Response(gzipSync(raw)); } });
    await b.deposits(TC.ALL_POOLS, F); await b.withdrawals(TC.ALL_POOLS, F);
    eq(await b.confirmed(P01, n0.nullifierHash), true, 'confirmed');
    eq(asked.length, 2, 'one run per node'); eq(Number(BigInt(asked[0].toBlock)) - Number(BigInt(asked[0].fromBlock)) <= 99 && asked[0].address.length === TC.ALL_POOLS.length, true, JSON.stringify(asked[0]));
    await b.confirmed(P01, n0.nullifierHash); eq(asked.length, 2, 'not asked again');
  });
}

console.log('the split forwarder');
await test('the one-transaction call is the app\'s, with and without a Tacit part', () => {
  const tx = { pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], publicInputs: Array.from({ length: 11 }, (_, i) => BigInt(i) * 99n), recipient: randAddr(), extAmount: 123456789n, relayer: '0x' + '00'.repeat(20), fee: 0n, memo0: '0x' + hex(rnd(70)), memo1: '0x' + hex(rnd(3)) };
  for (const withTx of [tx, null]) {
    const notes = [0, 1, 1].map((k) => { const pool = TC.POOLS[k], secrets = TC.deriveSecrets('0x' + hex(rnd(64)) + '1b', pool.address); return { pool, secrets }; });
    const a = TC.splitDepositCall(withTx, notes), b = Wm.splitDepositCall(TC.FORWARDER, withTx, { pools: notes.map((n) => n.pool), commitments: notes.map((n) => n.secrets.commitment) });
    eq(a.to, b.to); eq(a.value, b.value, 'value'); eq(a.data, b.data, 'data');
  }
});

console.log('the prover');
const wasm = fs.readFileSync(`${TACIT}/dapp/vendor/fixed-pool-prover_bg.wasm`);
await test('the wasm is the one the page pins', () => { eq(D.bytesToHex(D.sha256(wasm)), TC.WASM.sha256); eq(wasm.length, TC.WASM.bytes); });
G.initSync({ module: wasm });
// The page's worker, run in this thread: its `self` posts back to us.
const worker = (() => {
  const src = TC.WORKER;
  const replies = new Map();
  const self = { postMessage: (m) => { replies.get(m.id)?.(m); replies.delete(m.id); } };
  const sandbox = vm.createContext({ self, WebAssembly, TextEncoder, TextDecoder, crypto: webcrypto, Error, Uint8Array, DataView, Array, String, Number, Object, JSON, Promise });
  vm.runInContext(src, sandbox);
  let id = 0;
  return (msg) => new Promise((r) => { const i = ++id; replies.set(i, r); self.onmessage = sandbox.self.onmessage; sandbox.self.onmessage({ data: { id: i, ...msg } }); });
})();
const leavesOf = (cs) => { const b = new Uint8Array(cs.length * 32); cs.forEach((c, i) => b.set(D.hexToBytes(c.toString(16).padStart(64, '0')), i * 32)); return b; };
const mine = TC.deriveSecrets(VECTORS[0].signature, TC.POOLS[1].address);
const others = Array.from({ length: 37 }, () => TC.deriveSecrets('0x' + hex(rnd(64)) + '1b', TC.POOLS[1].address).commitment);
const cs = [...others.slice(0, 20), mine.commitment, ...others.slice(20)];
let proved = null;
await test('the glue loads the wasm and builds the same tree as the app\'s glue', async () => {
  eq((await worker({ type: 'init', wasm: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length) })).ok, true, 'init');
  const r = await worker({ type: 'tree', leaves: leavesOf(cs) });
  const t = new G.Tree(leavesOf(cs));
  eq(r.ok, true, r.error); eq(r.root, t.root(), 'root'); eq(r.leaves, t.leaves(), 'leaves');
  t.free();
});
await test('a direct and a relayed proof come back in the app\'s call shape and pass the page\'s check', async () => {
  const pool = TC.POOLS[1], recipient = randAddr(), t = new G.Tree(leavesOf(cs)), root = t.root();
  const a = await worker({ type: 'prove', chainId: 1, pool: pool.address, preimageHex: hex(mine.preimage), recipient });
  eq(a.ok, true, a.error);
  const out = JSON.parse(a.result);
  TC.checkWithdrawCall(out, { pool, recipient, root, nullifierHash: mine.nullifierHash });
  const b = await worker({ type: 'prove', chainId: 1, pool: pool.address, preimageHex: hex(mine.preimage), recipient, relayer: TC.PAYMASTER, fee: '12345' });
  const outB = JSON.parse(b.result);
  TC.checkWithdrawCall(outB, { pool, recipient, root, nullifierHash: mine.nullifierHash, relayer: TC.PAYMASTER, fee: 12345n });
  const ref = JSON.parse(t.prove(1, pool.address, hex(mine.preimage), recipient));
  eq(out.input.slice(0, 10 + 8 * 64), ref.input.slice(0, 10 + 8 * 64), 'everything but the proof bytes');
  let refused = false;
  try { TC.checkWithdrawCall(outB, { pool, recipient, root, nullifierHash: mine.nullifierHash, relayer: TC.PAYMASTER, fee: 12346n }); } catch { refused = true; }
  eq(refused, true, 'a fee other than the one proved is refused');
  proved = { out, root, recipient };
  t.free();
});
await test('an error inside the wasm comes back as an error, and the worker keeps working', async () => {
  const bad = await worker({ type: 'prove', chainId: 1, pool: TC.POOLS[1].address, preimageHex: 'zz', recipient: randAddr() });
  eq(bad.ok, false, 'bad preimage refused');
  const good = await worker({ type: 'tree', leaves: leavesOf(cs.slice(0, 5)) });
  eq(good.ok, true, 'still answers');
});
if (!process.env.OFFLINE) await test('the pool\'s live verifier accepts the proof (eth_call on mainnet)', async () => {
  const node = 'https://ethereum-rpc.publicnode.com', rpc = async (method, params) => (await (await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
  const v = '0x' + (await rpc('eth_call', [{ to: TC.POOLS[1].address, data: '0x' + hex(D.keccak_256(new TextEncoder().encode('verifier()')).slice(0, 4)) }, 'latest'])).slice(-40);   // verifier()
  const body = proved.out.input.slice(10), w = (i) => body.slice(i * 64, i * 64 + 64);
  // verifyProof(bytes proof, uint256[6] inputs): root, nullifierHash, recipient, relayer, fee, refund, as the pool passes them
  const data = '0x' + hex(D.keccak_256(new TextEncoder().encode('verifyProof(bytes,uint256[6])')).slice(0, 4)) + (7n * 32n).toString(16).padStart(64, '0') + [1, 2, 3, 4, 5, 6].map(w).join('') + (256).toString(16).padStart(64, '0') + body.slice(8 * 64);
  const ok = await rpc('eth_call', [{ to: v, data }, 'latest']);
  eq(BigInt(ok), 1n, 'verifier answer');
  const tampered = data.slice(0, -2) + (data.endsWith('00') ? '01' : '00');
  const no = await rpc('eth_call', [{ to: v, data: tampered }, 'latest']);
  eq(no == null || BigInt(no) === 0n, true, 'a changed proof is refused');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
