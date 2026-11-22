// A dress rehearsal of the next version on a fork of Ethereum: the 22 chunks through CreateX, deployNext from the ops
// multisig, setAddr on WNS and GNS, then the successor read back and its html() compared byte for byte with the build.
// Nothing here touches mainnet: anvil forks it locally, and the multisig and the name owner are impersonated.
//
// The fork test the deploy guide asks for before a release: run it on the build in hand, after repin.sh and forge build.
//
//   node deploy/rehearse-next.mjs [--keep]   (anvil on PATH; FORK_RPC to fork from another node; PORT, DIR to override)
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { AbiCoder, keccak256, concat, getAddress, namehash, toUtf8Bytes, Interface } = require('ethers');

const DIR = (process.env.DIR || new URL('..', import.meta.url).pathname).replace(/\/?$/, '/');
const OUT = DIR + 'out/';
const FORK = process.env.FORK_RPC || 'https://ethereum-rpc.publicnode.com';
const PORT = Number(process.env.PORT || 8656), NODE = `http://127.0.0.1:${PORT}`;
const CREATEX = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed';
const OPS = '0x006CD14F36F65eCbB29b2519cCBe63A0DC8549F2';
const BASE = '0x000000000009DdE9bb333bBaD42aD74bBACc2bD6';
const WNS = '0x0000000000696760e15f265e828db644a0c242eb', GNS = '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6';
const GWEI_OWNER = '0x1C0Aa8cCD568d90d61659F060D1bFb1e6f855A20';
const abi = AbiCoder.defaultAbiCoder();
const lc = (x) => String(x).toLowerCase();

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { console.log(`${c ? '  PASS ' : '  FAIL '} ${m}${x ? '  · ' + x : ''}`); c ? pass++ : fail++; };
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ── the build, read exactly as the helper reads it ──
const files = readdirSync(OUT).filter((f) => /^TacitPay8244\.chunk\d+\.creation\.txt$/.test(f))
  .sort((a, b) => Number(a.match(/chunk(\d+)/)[1]) - Number(b.match(/chunk(\d+)/)[1]));
const chunkInit = files.map((f) => readFileSync(OUT + f, 'utf8').trim());
const runtimes = chunkInit.map((c) => '0x' + c.slice(2 + 20));
const bytecode = JSON.parse(readFileSync(OUT + 'TacitPay8244.sol/TacitPay8244.json', 'utf8')).bytecode.object;
const page = readFileSync(DIR + 'dapp/page.min.html');
const pageHash = keccak256(page);
const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
const create2 = (deployer, salt, initHash) => getAddress('0x' + keccak256(concat(['0xff', deployer, salt, initHash])).slice(26));
const PLAN = chunkInit.map((init, i) => {
  const salt = '0x' + Buffer.concat([Buffer.alloc(20), Buffer.from([1]), Buffer.from(`tacitwei${String(i + 1).padStart(2, '0')}`), Buffer.alloc(1)]).toString('hex');
  const guarded = keccak256(abi.encode(['uint256', 'bytes32'], [1, salt]));
  return { address: create2(CREATEX, guarded, keccak256(init)), data: new Interface(['function deployCreate2(bytes32,bytes)']).encodeFunctionData('deployCreate2', [salt, init]) };
});
let salt = '0x' + '00'.repeat(32);
try { salt = JSON.parse(readFileSync(OUT + 'next-salt.json', 'utf8'))[`${lc(BASE)}:${keccak256(concat([bytecode, abi.encode(['address', 'address', 'address[]', 'bytes32'], [OPS, BASE, PLAN.map((p) => p.address), pageHash])]))}`] ?? salt; } catch {}
const initcode = concat([bytecode, abi.encode(['address', 'address', 'address[]', 'bytes32'], [OPS, BASE, PLAN.map((p) => p.address), pageHash])]);
const predicted = create2(BASE, salt, keccak256(initcode));
say(`build ${page.length} B, sha256 ${manifest.sha256.slice(0, 16)}…, ${PLAN.length} chunks`);
say(`salt ${salt === '0x' + '00'.repeat(32) ? '(zero: none mined)' : salt}`);
say(`successor expected at ${predicted}`);

// ── the fork ──
const anvil = spawn('anvil', ['--port', String(PORT), '--fork-url', FORK, '--silent', '--gas-limit', '60000000'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGKILL'); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
const rpc = async (method, params = []) => {
  const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch { if (i > 240) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 500)); } }
say(`fork of ${FORK} at block ${Number(await rpc('eth_blockNumber'))}`);
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const send = async (from, to, data, gas = '0x2faf080') => {
  let h;
  try { h = await rpc('eth_sendTransaction', [{ from, to, data, gas }]); }
  catch (e) { if (process.env.DEBUG) say('   send error:', String(e.message).slice(0, 180)); return { ok: false, gas: 0, err: e.message }; }
  let rc = null;
  for (let i = 0; i < 60 && !rc; i++) { rc = await rpc('eth_getTransactionReceipt', [h]); if (!rc) await new Promise((r) => setTimeout(r, 250)); }
  if (process.env.DEBUG && (!rc || rc.status !== '0x1')) say('   tx status', rc && rc.status, 'gasUsed', rc && Number(BigInt(rc.gasUsed)));
  return { hash: h, ok: rc && rc.status === '0x1', gas: rc ? Number(BigInt(rc.gasUsed)) : 0 };
};
const fund = async (a) => { await rpc('anvil_setBalance', [a, '0x' + (10n ** 21n).toString(16)]); };
const sel = (sig) => keccak256(toUtf8Bytes(sig)).slice(0, 10);
const addrOf = (w) => getAddress('0x' + String(w).slice(-40));

// ── 1. the chunks, from an ordinary funded wallet ──
const [deployer] = await rpc('eth_accounts');
await fund(deployer);
let gasAll = 0, bad = 0;
for (let i = 0; i < PLAN.length; i++) {
  const r = await send(deployer, CREATEX, PLAN[i].data, '0x7a1200');
  const code = await rpc('eth_getCode', [PLAN[i].address, 'latest']);
  if (!r.ok || code.length <= 2) { bad++; say(`  chunk ${i + 1} FAILED`); }
  gasAll += r.gas;
  if ((i + 1) % 6 === 0 || i === PLAN.length - 1) say(`  chunks ${i + 1}/${PLAN.length} deployed`);
}
ok(bad === 0, `all ${PLAN.length} chunks deploy through CreateX at the addresses the build predicts`, `${(gasAll / 1e6).toFixed(1)}M gas total`);

// ── 2. deployNext, from the multisig (impersonated; the queue itself is exercised in production) ──
await rpc('anvil_impersonateAccount', [OPS]);
await fund(OPS);
const deployNextData = new Interface(['function deployNext(bytes,bytes32)']).encodeFunctionData('deployNext', [initcode, salt]);
const notSteward = await send(deployer, BASE, deployNextData, '0x5b8d80').catch(() => ({ ok: false }));
ok(!notSteward.ok, 'deployNext from an account that is not the steward does not go through');
const dn = await send(OPS, BASE, deployNextData, '0x5b8d80');
ok(dn.ok, 'deployNext from the ops multisig lands', `${(dn.gas / 1e6).toFixed(2)}M gas`);

// ── 3. the successor, read back ──
const successor = addrOf(await call(BASE, sel('successor()')));
ok(lc(successor) === lc(predicted), 'the successor is at the address the helper predicted', successor);
const zeros = (lc(successor).slice(2).match(/^(00)*/)[0].length) / 2;
ok(true, `its address has ${zeros} leading zero byte(s)`, successor);
ok(lc(await call(successor, sel('PAGE_HASH()'))) === lc(pageHash), 'the successor commits to this build’s page hash');
ok(lc(addrOf(await call(successor, sel('steward()')))) === lc(OPS), 'its steward is the ops multisig');
ok(lc(addrOf(await call(successor, sel('PREVIOUS()')))) === lc(BASE), 'its PREVIOUS is the live version');
ok(lc(addrOf(await call(BASE, sel('latest()')))) === lc(successor), 'latest() on the live version walks to it');

// ── 4. html(), byte for byte ──
const raw = await call(successor, sel('html()'));
const dec = abi.decode(['string'], raw)[0];
const got = Buffer.from(dec, 'utf8');
ok(got.length === page.length && got.equals(page), 'html() returns the built page byte for byte', `${got.length} B`);
ok(keccak256(got) === pageHash, 'and its keccak matches PAGE_HASH');

// ── 5. the names ──
const setAddr = (name, to) => new Interface(['function setAddr(uint256,address)']).encodeFunctionData('setAddr', [BigInt(namehash(name)), to]);
const wns = await send(OPS, WNS, setAddr('tacit.wei', successor), '0x30d40');
ok(wns.ok, 'setAddr for tacit.wei from the multisig lands', `${wns.gas} gas`);
const resolved = addrOf(await call(WNS, '0x4f896d4f' + BigInt(namehash('tacit.wei')).toString(16).padStart(64, '0')));
ok(lc(resolved) === lc(successor), 'tacit.wei resolves to the successor');
await rpc('anvil_impersonateAccount', [GWEI_OWNER]);
await fund(GWEI_OWNER);
const gns = await send(GWEI_OWNER, GNS, setAddr('tacit.gwei', successor), '0x30d40');
ok(gns.ok, 'setAddr for tacit.gwei from its owner lands', `${gns.gas} gas`);
const gresolved = addrOf(await call(GNS, '0x4f896d4f' + BigInt(namehash('tacit.gwei')).toString(16).padStart(64, '0')));
ok(lc(gresolved) === lc(successor), 'tacit.gwei resolves to the successor');

// ── 6. going back, and the lineage ──
const back = await send(OPS, WNS, setAddr('tacit.wei', BASE), '0x30d40');
const backTo = addrOf(await call(WNS, '0x4f896d4f' + BigInt(namehash('tacit.wei')).toString(16).padStart(64, '0')));
ok(back.ok && lc(backTo) === lc(BASE), 'the multisig can point the name back at the live version');
const stillServes = abi.decode(['string'], await call(BASE, sel('html()')))[0].length > 0;
ok(stillServes, 'and the live version still serves its own page after the successor exists');

console.log(`\n${pass} passed${fail ? `, ${fail} failed` : ''}`);
if (!process.argv.includes('--keep')) stop();
process.exit(fail ? 1 : 0);
