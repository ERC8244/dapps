/* Moving to a rollup, as the page encodes it: the call intent's escrow address against the live router's own
   callEscrowOf (one read-only call on Ethereum), the router.withdrawAndCall calldata against an ABI encoder, and the
   bridge calls against their published signatures. No key and nothing sent.

   Usage: node test/dapp/tacit-pay.move.mjs              (RPC=<Ethereum JSON-RPC> to use another node) */
import vm from 'node:vm';
import {cut, config} from './page-config.mjs';

const {Interface, keccak256, getBytes} = await import(new URL('../../../node_modules/ethers/lib.esm/index.js', import.meta.url).href);
let failures = 0;
const ok = (c, m, x = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x ? '  ' + x : '')); if (!c) failures++; };

// The page's own byte helpers and ABI encoder, with ethers' keccak in place of the page's (the same function).
const keccak = (b) => getBytes(keccak256(b));
const src = [
  cut('const te =', '\nconst unhex'), cut('const unhex =', '\nconst cat'), cut('const cat =', '\nconst big'), cut('const big =', '\nconst be'), cut('const be =', '\n'),
  cut('const mod =', '\n'), cut('const selector =', '\n'), cut('const word =', '\n'), cut('function abi(', '\nconst PAIR'), cut('const PAIR =', '\n\n'),
  cut('const addrWord =', '\n'), cut('function checksum(', '\n}') + '\n}', cut('const RECEIVE_FEE_BPS =', '\n'), cut('const RECEIVE_TAG =', '\n'),
  cut('function boxAt(', '\nconst receiveRho'), cut('const ZERO_ADDRESS =', '\n'),
].join('\n');
const P = vm.runInNewContext(`${src}\n({ abi, calldata, boxAt, receiveBoxAddress, escrowOf, intentValues, intentJson, INTENT_SIG, TX_SIG, TX_TYPES, INTENT_T, txValues, utf8, hex, big })`, {keccak, TextEncoder, BigInt, Uint8Array, Number, String, Array, Object, Error, Math});

const ROUTER = config.ROUTER;
const box = P.receiveBoxAddress(ROUTER, 12345n);
const intent = {
  calls: [{target: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', value: 10n ** 16n, token: '0x0000000000000000000000000000000000000000', amount: 0n, push: false,
    data: P.calldata('depositETHTo(address,uint32,bytes)', ['address', 'uint32', 'bytes'], [box, 200_000n, '0x'])}],
  outTokens: [], minOuts: [], to: '0x0000000000000000000000000000000000000000', refund: box, deadline: 1_900_000_000n, nonce: 0xdeadbeefn,
};

console.log('the escrow a move pays into');
const local = P.escrowOf(ROUTER, intent);
const router = new Interface(['function callEscrowOf(((address target,uint256 value,address token,uint256 amount,bool push,bytes data)[] calls,address[] outTokens,uint256[] minOuts,address to,address refund,uint64 deadline,uint256 nonce) intent) view returns (address)',
  `function withdrawAndCall((uint256[2] pA,uint256[2][2] pB,uint256[2] pC,uint256[11] publicInputs,address recipient,int256 extAmount,address relayer,uint256 fee,bytes memo0,bytes memo1) t,${'(' + '(address target,uint256 value,address token,uint256 amount,bool push,bytes data)[] calls,address[] outTokens,uint256[] minOuts,address to,address refund,uint64 deadline,uint256 nonce)'} intent)`]);
const asTuple = (i) => [i.calls.map((c) => [c.target, c.value, c.token, c.amount, c.push, c.data]), i.outTokens, i.minOuts, i.to, i.refund, i.deadline, i.nonce];
const rpc = process.env.RPC || 'https://ethereum-rpc.publicnode.com';
const live = await fetch(rpc, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to: ROUTER, data: router.encodeFunctionData('callEscrowOf', [asTuple(intent)])}, 'latest']})}).then((r) => r.json());
const onchain = live.result ? '0x' + live.result.slice(-40) : null;
ok(onchain && onchain.toLowerCase() === local.toLowerCase(), 'the page computes the escrow the router does', `${local} vs ${onchain ?? JSON.stringify(live.error)}`);
const back = P.intentJson(intent);
ok(JSON.stringify(back) === JSON.stringify(JSON.parse(JSON.stringify(back))) && P.escrowOf(ROUTER, back).toLowerCase() === local.toLowerCase(), 'and the same from the intent as kept in storage (decimal strings)');
const other = {...intent, nonce: intent.nonce + 1n};
ok(P.escrowOf(ROUTER, other).toLowerCase() !== local.toLowerCase(), 'a different nonce is a different escrow');

console.log('\nwithdrawAndCall, as the wallet sends it');
const tx = {pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], publicInputs: Array.from({length: 11}, (_, i) => BigInt(i + 9)), recipient: local, extAmount: '-10000000000000000', relayer: '0x0000000000000000000000000000000000000000', fee: '0', memo0: '0x' + 'ab'.repeat(97), memo1: '0x' + 'cd'.repeat(97)};
const data = P.calldata(`withdrawAndCall(${P.TX_SIG},${P.INTENT_SIG})`, [{tuple: P.TX_TYPES}, P.INTENT_T], [P.txValues(tx), P.intentValues(intent)]);
const want = router.encodeFunctionData('withdrawAndCall', [[tx.pA, tx.pB, tx.pC, tx.publicInputs, tx.recipient, BigInt(tx.extAmount), tx.relayer, 0n, tx.memo0, tx.memo1], asTuple(intent)]);
ok(data === want, 'the calldata equals the ABI encoding of router.withdrawAndCall', `${data.length} vs ${want.length} chars`);

console.log('\nthe bridge calls');
const sel = (sig) => keccak256(new TextEncoder().encode(sig)).slice(0, 10);
const op = P.calldata('depositETHTo(address,uint32,bytes)', ['address', 'uint32', 'bytes'], [box, 200_000n, '0x']);
ok(op === new Interface(['function depositETHTo(address _to,uint32 _minGasLimit,bytes _extraData) payable']).encodeFunctionData('depositETHTo', [box, 200000, '0x']), 'Base: L1StandardBridge.depositETHTo(box, 200000, 0x)', sel('depositETHTo(address,uint32,bytes)'));
const arb = P.calldata('createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)', ['address', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bytes'], [box, 10n ** 16n, 123n, box, box, 300000n, 10n ** 8n, '0x']);
ok(arb === new Interface(['function createRetryableTicket(address to,uint256 l2CallValue,uint256 maxSubmissionCost,address excessFeeRefundAddress,address callValueRefundAddress,uint256 gasLimit,uint256 maxFeePerGas,bytes data) payable returns (uint256)']).encodeFunctionData('createRetryableTicket', [box, 10n ** 16n, 123n, box, box, 300000n, 10n ** 8n, '0x']), 'Robinhood Chain: Inbox.createRetryableTicket, refunds to the same address');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
