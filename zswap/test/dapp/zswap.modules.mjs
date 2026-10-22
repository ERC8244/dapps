/* The modules cut out of the page work on their own.

   1. Every generated module still matches the page (build.mjs --check).
   2. WalletConnect crypto agrees with Node's own implementations: ChaCha20-
      Poly1305, X25519 + HKDF-SHA256, SHA-256 topics, did:key, the relay JWT.
   3. The QR encoder draws a well-formed symbol.
   4. The relay client pairs, settles, signs and disconnects against a fake
      relay and a fake wallet that does its own crypto.
   5. provider.js routes EIP-1193 calls the way the page does.
   6. wallets.js lists EIP-6963 wallets under jsdom.

   Usage: node zswap/test/dapp/zswap.modules.mjs                              */
import {spawnSync} from "node:child_process";
import nodeCrypto from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {JSDOM} from "jsdom";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.resolve(HERE, "../../modules");
const {WCU, QR8, createClient} = await import(path.join(MODULES, "walletconnect.js"));
const {toProvider, accountsOn} = await import(path.join(MODULES, "provider.js"));

let failures = 0;
const ok = (c, msg, extra) => {
  console.log((c ? "  PASS  " : "  FAIL  ") + msg + (extra !== undefined ? "  " + extra : ""));
  if (!c) failures++;
};
const hex = (b) => Buffer.from(b).toString("hex");
const eq = (a, b) => hex(a) === hex(b);

// 1. drift
const drift = spawnSync(process.execPath, [path.join(MODULES, "build.mjs"), "--check"], {encoding: "utf8"});
ok(drift.status === 0, "generated modules match the page", drift.status ? drift.stderr.trim() : "");

// 2a. ChaCha20-Poly1305 against Node, no AAD (WalletConnect uses none)
for (const n of [0, 1, 63, 64, 65, 1000]) {
  const key = nodeCrypto.randomBytes(32), iv = nodeCrypto.randomBytes(12), pt = nodeCrypto.randomBytes(n);
  const c = nodeCrypto.createCipheriv("chacha20-poly1305", key, iv, {authTagLength: 16});
  const ref = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  const box = WCU.seal(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(pt));
  ok(eq(box, ref), `seal == Node chacha20-poly1305 (${n} B)`);
  ok(eq(WCU.open(new Uint8Array(key), new Uint8Array(iv), box), pt), `open(seal(x)) == x (${n} B)`);
}
{
  const key = new Uint8Array(32).fill(7), iv = new Uint8Array(12).fill(9);
  const box = WCU.seal(key, iv, new TextEncoder().encode("zSwap"));
  box[0] ^= 1;
  ok(WCU.open(key, iv, box) === null, "open refuses a tampered box");
}

// 2b. X25519 + HKDF-SHA256 (empty salt and info) against Node
{
  const a = await WCU.kex(), b = nodeCrypto.generateKeyPairSync("x25519");
  const bPub = b.publicKey.export({format: "der", type: "spki"}).subarray(-32);
  const mine = await WCU.sessionKey(a.priv, hex(bPub));
  const aPub = nodeCrypto.createPublicKey({key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(a.pub)]), format: "der", type: "spki"});
  const shared = nodeCrypto.diffieHellman({privateKey: b.privateKey, publicKey: aPub});
  const theirs = Buffer.from(nodeCrypto.hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.alloc(0), 32));
  ok(eq(mine, theirs), "sessionKey == Node X25519 + HKDF-SHA256");
}

// 2c. topic = sha256(symKey) in hex
{
  const k = nodeCrypto.randomBytes(32);
  ok(await WCU.topicOf(new Uint8Array(k)) === nodeCrypto.createHash("sha256").update(k).digest("hex"), "topicOf == sha256 hex");
}

// 2d. did:key, against the did:key specification's Ed25519 example
{
  const pub = Buffer.from("Lm_M42cB3HkUiODQsXRcweM6TByfzEHGO9ND274JcOY", "base64url");
  ok(WCU.didKey(new Uint8Array(pub)) === "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "didKey matches the did:key spec example");
}

// 2e. relay JWT: EdDSA, signed by the key its iss names, a day long
{
  const jwt = await WCU.relayJwt("wss://relay.example");
  const [h, p, s] = jwt.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url")), body = JSON.parse(Buffer.from(p, "base64url"));
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of body.iss.slice("did:key:z".length)) n = n * 58n + BigInt(B58.indexOf(ch));
  const raw = Buffer.from(n.toString(16).padStart(68, "0"), "hex");
  const key = nodeCrypto.createPublicKey({key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw.subarray(2)]), format: "der", type: "spki"});
  ok(head.alg === "EdDSA" && body.aud === "wss://relay.example" && body.exp - body.iat === 86400, "relay JWT claims");
  ok(raw[0] === 0xed && raw[1] === 0x01 && nodeCrypto.verify(null, Buffer.from(h + "." + p), key, Buffer.from(s, "base64url")), "relay JWT signature verifies against iss");
}

// 2f. a type-0 envelope built with Node decodes, and one WCU builds opens in Node
{
  const key = nodeCrypto.randomBytes(32), iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv("chacha20-poly1305", key, iv, {authTagLength: 16});
  const sealed = Buffer.concat([c.update(JSON.stringify({id: 1, ok: true})), c.final(), c.getAuthTag()]);
  const msg = Buffer.concat([Buffer.from([0]), iv, sealed]).toString("base64");
  ok(JSON.stringify(WCU.decode(new Uint8Array(key), msg)) === '{"id":1,"ok":true}', "decode reads a Node-built envelope");
  const env = Buffer.from(WCU.encode(new Uint8Array(key), {hello: "zSwap"}), "base64");
  const d = nodeCrypto.createDecipheriv("chacha20-poly1305", key, env.subarray(1, 13), {authTagLength: 16});
  d.setAuthTag(env.subarray(env.length - 16));
  ok(env[0] === 0 && Buffer.concat([d.update(env.subarray(13, env.length - 16)), d.final()]).toString() === '{"hello":"zSwap"}', "Node opens an envelope encode built");
}

// 3. QR: square, version-sized, with the three finder patterns
{
  const uri = "wc:" + "a".repeat(64) + "@2?relay-protocol=irn&symKey=" + "b".repeat(64);
  const q = QR8.build(uri);
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6, core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (!!q.modules[r0 + r][c0 + c] !== (ring || core)) return false;
    }
    return true;
  };
  ok((q.size - 17) % 4 === 0 && q.modules.length === q.size && q.modules.every((row) => row.length === q.size), "QR symbol is a valid size", `${q.size}x${q.size}`);
  ok(finder(0, 0) && finder(0, q.size - 7) && finder(q.size - 7, 0), "QR has its three finder patterns");
}

// 4. pairing against a fake relay and a fake wallet
const WALLET = "0x00000000000000000000000000000000000000aa";
const relayUrls = [], relays = [];
const wallet = {kp: null, symKey: null, pTopic: null, sKey: null, sTopic: null, requests: []};
class FakeRelay {
  constructor(url) {
    relayUrls.push(url);
    relays.push(this);
    this.held = [];
    this.closed = false;
    setTimeout(() => this.onopen && this.onopen(), 0);
  }
  close() { this.closed = true; }
  deliver(topic, message) {
    setTimeout(() => this.onmessage({data: JSON.stringify({id: Date.now(), jsonrpc: "2.0", method: "irn_subscription", params: {id: "x", data: {topic, message}}})}), 0);
  }
  async send(raw) {
    const m = JSON.parse(raw);
    if (!m.method) return;
    setTimeout(() => this.onmessage({data: JSON.stringify({id: m.id, jsonrpc: "2.0", result: true})}), 0);
    if (m.method === "irn_subscribe" && m.params.topic === wallet.sTopic) {
      const settle = {id: 7, jsonrpc: "2.0", method: "wc_sessionSettle", params: {
        relay: {protocol: "irn"}, expiry: Math.floor(Date.now() / 1000) + 604800,
        namespaces: {eip155: {accounts: ["eip155:1:" + WALLET, "eip155:8453:" + WALLET], methods: ["personal_sign", "eth_sendTransaction"], events: ["chainChanged"]}}}};
      this.deliver(wallet.sTopic, WCU.encode(wallet.sKey, settle));
    }
    if (m.method !== "irn_publish") return;
    if (!wallet.pTopic) return void this.held.push(m.params);
    await this.route(m.params);
  }
  async route({topic, message}) {
    if (topic === wallet.pTopic) {
      const p = WCU.decode(wallet.symKey, message);
      if (p?.method !== "wc_sessionPropose") return;
      wallet.proposal = p;
      wallet.kp = await WCU.kex();
      wallet.sKey = await WCU.sessionKey(wallet.kp.priv, p.params.proposer.publicKey);
      wallet.sTopic = await WCU.topicOf(wallet.sKey);
      this.deliver(wallet.pTopic, WCU.encode(wallet.symKey, {id: p.id, jsonrpc: "2.0", result: {relay: {protocol: "irn"}, responderPublicKey: WCU.hex(wallet.kp.pub)}}));
    } else if (topic === wallet.sTopic) {
      const r = WCU.decode(wallet.sKey, message);
      if (r?.method === "wc_sessionRequest") {
        wallet.requests.push(r);
        this.deliver(wallet.sTopic, WCU.encode(wallet.sKey, {id: r.id, jsonrpc: "2.0", result: "0x5167"}));
      }
      if (r?.method === "wc_sessionDelete") wallet.deleted = true;
    }
  }
}

const client = createClient({chains: [1, 8453], relay: "wss://relay.example", WebSocket: FakeRelay});
const {uri, done} = await client.pair("project-id", {name: "test", description: "", url: "https://example", icons: []});
const u = new URL(uri.replace("wc:", "wc://"));
wallet.pTopic = u.username;
wallet.symKey = WCU.unhex(u.searchParams.get("symKey"));
for (const r of relays) for (const m of r.held.splice(0)) await r.route(m);
ok(/^wc:[0-9a-f]{64}@2\?relay-protocol=irn&symKey=[0-9a-f]{64}$/.test(uri), "pairing URI has the v2 shape");
ok(relayUrls[0].startsWith("wss://relay.example/?auth=") && relayUrls[0].includes("projectId=project-id"), "relay URL carries the JWT and project id");
const session = await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error("no settle")), 5000))]);
ok(JSON.stringify(wallet.proposal.params.optionalNamespaces.eip155.chains) === '["eip155:1","eip155:8453"]', "proposal offers the configured chains");
ok(session.topic === wallet.sTopic && eq(session.key, wallet.sKey), "both sides derive the same session key and topic");
ok(session.accounts.length === 2 && session.methods.includes("personal_sign"), "session carries the settled accounts and methods");
const sig = await client.request({...session, chain: 1}, "personal_sign", ["0x68656c6c6f", WALLET]);
ok(sig === "0x5167" && wallet.requests[0].params.request.method === "personal_sign" && wallet.requests[0].params.chainId === "eip155:1", "a signing request reaches the wallet and its answer comes back");

// 5. provider.js over that session
{
  const reads = [];
  const prov = toProvider(client, session, {chainId: 8453, read: async (m, p) => (reads.push(m), "0x1")});
  ok(JSON.stringify(await prov.request({method: "eth_accounts"})) === JSON.stringify([WALLET]), "eth_accounts lists the settled account");
  ok(await prov.request({method: "eth_chainId"}) === "0x2105", "eth_chainId is the session's chain");
  ok(await prov.request({method: "eth_blockNumber"}) === "0x1" && reads[0] === "eth_blockNumber", "reads go to the read function");
  ok(await prov.request({method: "personal_sign", params: ["0x00", WALLET]}) === "0x5167" && wallet.requests[1].params.chainId === "eip155:8453", "signing goes to the wallet on the provider's chain");
  await prov.request({method: "wallet_switchEthereumChain", params: [{chainId: "0x1"}]});
  ok(await prov.request({method: "eth_chainId"}) === "0x1", "switching stays inside the session's chains");
  ok(JSON.stringify(accountsOn(session, 8453)) === JSON.stringify([WALLET]), "accountsOn reads one chain's accounts");
}
await client.end(session);
ok(wallet.deleted === true, "end() tells the wallet the session is over");

// 6. wallets.js under jsdom
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const g = globalThis;
  const saved = {addEventListener: g.addEventListener, dispatchEvent: g.dispatchEvent, Event: g.Event};
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
  g.Event = dom.window.Event;
  let asked = 0;
  dom.window.addEventListener("eip6963:requestProvider", () => {
    asked++;
    const detail = {info: {uuid: "u-1", name: "Test Wallet", icon: "data:,", rdns: "xyz.test"}, provider: {request: async () => []}};
    dom.window.dispatchEvent(new dom.window.CustomEvent("eip6963:announceProvider", {detail}));
  });
  const {wallets, rescan} = await import(path.join(MODULES, "wallets.js"));
  ok(asked === 1 && wallets().length === 1 && wallets()[0].info.rdns === "xyz.test", "importing asks wallets to announce and lists the answer");
  rescan();
  ok(asked === 2 && wallets().length === 1, "a rescan does not list the same wallet twice");
  Object.assign(g, saved);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
