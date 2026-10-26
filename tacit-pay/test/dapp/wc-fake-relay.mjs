// An in-process WalletConnect relay and a wallet that answers as the official SDK does, for driving the page's own
// wcClient/wcProvider (tacit-pay.wcrelay.mjs). `inject` sends every page socket a frame of the relay's own making, `hooks` see
// every frame the page sends, `kept` and `subs` say what the relay was given.
import crypto from 'node:crypto';

export class FakeSocket {
  constructor(relay, url) {
    this.relay = relay; this.url = url; this.readyState = 0; this.onopen = this.onclose = this.onerror = this.onmessage = null;
    setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; relay.sockets.add(this); this.onopen?.({}); } }, 1);
  }
  send(str) { this.relay.fromPage(this, JSON.parse(str)); }
  close() { if (this.readyState >= 2) return; this.readyState = 3; this.relay.sockets.delete(this); for (const s of this.relay.subs.values()) s.delete(this); setTimeout(() => this.onclose?.({ code: 1000 }), 0); }
  deliver(obj) { setTimeout(() => this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }), 0); }
}

export function makeRelay() {
  const relay = {
    sockets: new Set(), subs: new Map(), waiting: new Map(), walletSubs: new Map(), kept: new Map(), hooks: [], nextId: 1,
    factory: (url) => new FakeSocket(relay, url),
    fromPage(sock, m) {
      for (const h of relay.hooks) h(m, sock);
      if (m.method === undefined) return;               // the page's acknowledgement of a delivery
      if (m.method === 'irn_subscribe') {
        (relay.subs.get(m.params.topic) || relay.subs.set(m.params.topic, new Set()).get(m.params.topic)).add(sock);
        sock.deliver({ id: m.id, jsonrpc: '2.0', result: 'sub-' + m.params.topic.slice(0, 8) });
        for (const f of relay.waiting.get(m.params.topic) || []) sock.deliver(f);
        relay.waiting.delete(m.params.topic);
        return;
      }
      if (m.method === 'irn_publish') {
        sock.deliver({ id: m.id, jsonrpc: '2.0', result: true });
        (relay.kept.get(m.params.topic) || relay.kept.set(m.params.topic, []).get(m.params.topic)).push({ message: m.params.message, tag: m.params.tag });
        for (const cb of relay.walletSubs.get(m.params.topic) || []) setTimeout(() => cb(m.params.message, m.params.tag), 0);
        return;
      }
      sock.deliver({ id: m.id, jsonrpc: '2.0', result: true });
    },
    // A message for the page on a topic it subscribed to (what the wallet sends).
    toPage(topic, message, tag = 1109) {
      const frame = () => ({ id: Date.now() * 1000 + (relay.nextId++ % 1000), jsonrpc: '2.0', method: 'irn_subscription', params: { id: 'sub', data: { topic, message, publishedAt: Date.now(), tag } } });
      const subs = relay.subs.get(topic);
      if (!subs?.size) { (relay.waiting.get(topic) || relay.waiting.set(topic, []).get(topic)).push(frame()); return; }
      for (const s of subs) s.deliver(frame());
    },
    walletSubscribe(topic, cb) { (relay.walletSubs.get(topic) || relay.walletSubs.set(topic, []).get(topic)).push(cb); for (const k of relay.kept.get(topic) || []) setTimeout(() => cb(k.message, k.tag), 0); },
    inject(obj) { for (const s of relay.sockets) s.deliver(obj); },
  };
  return relay;
}

const b64 = (b) => Buffer.from(b).toString('base64');
export const seal = (key, obj) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('chacha20-poly1305', key, iv, { authTagLength: 16 }); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return b64(Buffer.concat([Buffer.from([0]), iv, ct, c.getAuthTag()])); };
export const open = (key, msg) => { const b = Buffer.from(msg, 'base64'), head = b[0] === 1 ? 33 : 1, iv = b.subarray(head, head + 12), ct = b.subarray(head + 12, b.length - 16), tag = b.subarray(b.length - 16); const d = crypto.createDecipheriv('chacha20-poly1305', key, iv, { authTagLength: 16 }); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString()); };
export const topicOf = (key) => crypto.createHash('sha256').update(key).digest('hex');

// What a wallet does on its side of a pairing: answers the proposal with its public key, settles the session, answers requests.
export function honestWallet(relay, { accounts = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'], chains = [1, 8453], methods = ['personal_sign', 'eth_sendTransaction', 'eth_signTypedData_v4'], onRequest = null } = {}) {
  const w = { requests: [], session: null };
  w.pair = (uri) => {
    const u = new URL(uri.replace(/^wc:/, 'wc://')), pairTopic = u.username, symKey = Buffer.from(u.searchParams.get('symKey'), 'hex');
    relay.walletSubscribe(pairTopic, (message) => {
      const prop = open(symKey, message);
      if (prop.method !== 'wc_sessionPropose') return;
      const kp = crypto.generateKeyPairSync('x25519'), pubRaw = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      const theirs = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(prop.params.proposer.publicKey, 'hex')]), format: 'der', type: 'spki' });
      const shared = crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: theirs });
      const sessionKey = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.alloc(0), 32)), sessionTopic = topicOf(sessionKey);
      w.session = { topic: sessionTopic, key: sessionKey, pairTopic, symKey, proposal: prop };
      relay.walletSubscribe(sessionTopic, (m2) => {
        const r = open(sessionKey, m2);
        if (r.method === 'wc_sessionRequest') {
          w.requests.push(r);
          const respond = (resp) => relay.toPage(sessionTopic, seal(sessionKey, { id: r.id, jsonrpc: '2.0', ...resp }), 1109);
          if (onRequest) onRequest(r, respond, w); else respond({ result: '0x' + 'ab'.repeat(32) });
        }
      });
      relay.toPage(pairTopic, seal(symKey, { id: prop.id, jsonrpc: '2.0', result: { relay: { protocol: 'irn' }, responderPublicKey: Buffer.from(pubRaw).toString('hex') } }), 1101);
      setTimeout(() => relay.toPage(sessionTopic, seal(sessionKey, { id: Date.now() * 1000 + 1, jsonrpc: '2.0', method: 'wc_sessionSettle', params: { relay: { protocol: 'irn' }, namespaces: { eip155: { chains: chains.map((c) => `eip155:${c}`), methods, events: ['accountsChanged', 'chainChanged'], accounts: chains.flatMap((c) => accounts.map((a) => `eip155:${c}:${a}`)) } }, expiry: Math.floor(Date.now() / 1000) + 604800, controller: { publicKey: Buffer.from(pubRaw).toString('hex'), metadata: { name: 'Test Wallet', url: 'https://wallet.test', icons: [] } } } }), 1102), 20);
    });
  };
  return w;
}
