/* A payment proved while its form is filled in (the engine's proveAhead): pressed while the relay's queue is as it was, it
   is sent with that proof and not proved again; pressed after another transaction landed, or for a payment the form no
   longer shows, it is proved again, and the proof made ahead is stopped. Nothing is reserved or sent for a proof made
   ahead, and the one-time key its outputs were sealed under is taken only by the press that sends it.

   Usage: node test/dapp/tacit-pay.ahead.mjs                                                                          */
import {mkWorld, lib} from './engine-mock.mjs';
import {mockRelay} from './relay-mock.mjs';

let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };
const E = 10n ** 18n, DEST = '0x' + '11'.repeat(20), KEEPER = 'https://relay.test/evm-pool/keeper';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !f(); i++) await sleep(20); return f(); };
const {secp, paymentKey, hex} = lib;
// Whether a memo was sealed under the one-time key of `attempt` for note `nf`: its first 33 bytes are e·G.
const sealedUnder = (memo, keys, nf, attempt) => memo.slice(2, 68) === hex(secp.compress(secp.mulG(paymentKey(keys, 1, nf, 0, attempt))));
const sent = (relay) => relay.log.filter((p) => p === '/reserve' || p === '/relay').length;

console.log('a withdrawal proved ahead, pressed with the queue as it was');
{
  const proofs = [];
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), nf = A.W.notes()[0].nf, n0 = proofs.length, s0 = sent(relay);
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  ok(await until(() => proofs.length === n0 + 1), 'a withdrawal whose form is filled in is proved ahead');
  ok(sent(relay) === s0, 'and nothing is reserved or sent for it', relay.log.slice(-4).join(' '));
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  await sleep(100);
  ok(proofs.length === n0 + 1, 'the same form again proves nothing more');
  const h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  ok(typeof h === 'string' && proofs.length === n0 + 1 && relay.relays === 1, 'pressed, it is sent with the proof made ahead, not proved again', `${proofs.length - n0} proofs`);
  ok(sealedUnder(relay.last.tx.memo0, A.keys, nf, 0), 'its change sealed under the note’s first one-time key');
  await A.W.sync();
  ok(A.W.summary().balance === 3n * E / 100n - relay.quote, 'and the balance is what is left', String(A.W.summary().balance));
  relay.restore();
}

console.log('\nanother transaction lands between the proof made ahead and the press');
{
  const proofs = [];
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER}), B = wallet(9, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), n0 = proofs.length;
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  await until(() => proofs.length === n0 + 1);
  await B.W.deposit({amount: E / 100n});
  const n1 = proofs.length;
  const h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  ok(typeof h === 'string' && proofs.length === n1 + 1, 'the pool moved on, so it is proved again at the press, and sent', `${proofs.length - n1} proofs at the press`);
  ok(proofs[n0]() === false, 'and the proof made ahead is told to stop');
  relay.restore();
}

console.log('\na form that changed');
{
  const proofs = [];
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), nf = A.W.notes()[0].nf, n0 = proofs.length;
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  await until(() => proofs.length === n0 + 1);
  A.W.proveAhead({to: DEST, amount: 3n * E / 100n, out: true, q});
  await until(() => proofs.length === n0 + 2);
  ok(proofs[n0]() === false && proofs[n0 + 1]() === true, 'a new amount proves again and stops the proof for the old one');
  const h = await A.W.withdraw({to: DEST, amount: E / 100n, via: null, expectFee: relay.quote});
  ok(typeof h === 'string' && proofs.length === n0 + 3 && proofs[n0 + 1]() === false, 'pressed for an amount neither was made for, it is proved at the press, and the one made ahead stops', `${proofs.length - n0} proofs`);
  ok(sealedUnder(relay.last.tx.memo0, A.keys, nf, 0), 'its change sealed under the note’s first one-time key: the proofs made ahead took none');
  relay.restore();
}

console.log('\na relay that asks more than the quote the proof was made at');
{
  const proofs = [];
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), n0 = proofs.length;
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  await until(() => proofs.length === n0 + 1);
  relay.need = relay.quote * 11n / 10n;
  const h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  ok(typeof h === 'string' && proofs.length === n0 + 2 && BigInt(relay.last.tx.fee) === relay.need, 'the proof made ahead is refused for its fee, and the payment is proved again at the fee asked', `${proofs.length - n0} proofs, fee ${relay.last.tx.fee}`);
  relay.restore();
}

console.log('\na private send proved ahead');
{
  const proofs = [];
  const {node, wallet, relayed} = mkWorld({onProve: (input, still) => proofs.push(still)}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER}), B = wallet(8, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), nf = A.W.notes()[0].nf, n0 = proofs.length;
  A.W.proveAhead({to: B.keys, amount: 2n * E / 100n, out: false, q});
  await until(() => proofs.length === n0 + 1);
  const h = await A.W.send({to: B.keys, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  await B.W.sync();
  ok(typeof h === 'string' && proofs.length === n0 + 1 && B.W.summary().balance === 2n * E / 100n, 'it is sent at the press with the proof made ahead, and arrives', `${proofs.length - n0} proofs, B holds ${B.W.summary().balance}`);
  ok(sealedUnder(relay.last.tx.memo0, A.keys, nf, 0), 'sealed under the note’s first one-time key');
  relay.restore();
}

console.log('\na proof made ahead still looking for its tree (the relay’s head is ahead of this device)');
{
  const {node, wallet, relayed} = mkWorld({onProve: () => {}}), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER});
  await A.W.deposit({amount: 5n * E / 100n});
  const q = await A.W.quote(), real = globalThis.fetch;
  let heads = 0;
  globalThis.fetch = async (url, init) => { if (String(url).endsWith('/head')) { heads++; return {status: 200, ok: true, headers: {get: () => null}, json: async () => ({root: '12345', size: node.size + 2, pending: [], tail: {root: '12345'}})}; } return real(url, init); };
  A.W.proveAhead({to: DEST, amount: 2n * E / 100n, out: true, q});
  await sleep(200);
  const t0 = Date.now(), h = await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((e) => e), took = Date.now() - t0, seen = heads;
  await sleep(2000);
  globalThis.fetch = real;
  ok(typeof h === 'string' && took < 10_000, 'the press is not held up by it: it proves for itself and sends', `${took} ms`);
  ok(heads - seen <= 1, 'and the proof made ahead stops looking once the press has gone', `${heads - seen} more /head reads`);
  relay.restore();
}

console.log('\nthe browser out of room while a one-time key is taken, then room again');
{
  const m = new Map(), store = {full: false, get: (k) => m.get(k) ?? null, set: (k, v) => { if (store.full) return false; m.set(k, v); return true; }, del: (k) => m.delete(k)};
  const {node, wallet, relayed} = mkWorld(), relay = mockRelay(node, relayed);
  const A = wallet(7, {keeper: KEEPER, store}), B = wallet(9, {});
  await A.W.deposit({amount: 5n * E / 100n});
  await A.W.sync();
  const nf = A.W.notes()[0].nf;
  store.full = true; relay.mode = 'refuse400';
  await A.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote}).catch((x) => x);
  ok(A.W.storageFull(), 'the write that took the key does not fit');
  store.full = false;
  for (let i = 0; i < 2; i++) { await B.W.deposit({amount: E / 100n}); await A.W.sync(); }
  relay.mode = 'send';
  const A2 = wallet(7, {keeper: KEEPER, store});
  await A2.W.withdraw({to: DEST, amount: 2n * E / 100n, via: null, expectFee: relay.quote});
  ok(!A.W.storageFull() && sealedUnder(relay.last.tx.memo0, A2.keys, nf, 1), 'the next read writes it once there is room, so a reload takes the next key, not the same one again', `full ${A.W.storageFull()}`);
  relay.restore();
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
