/* A WalletConnect relay in memory: the part of its JSON-RPC over a WebSocket that a dapp and a wallet use. A message
   published to a topic is kept until a subscriber acknowledges it, and sent to each other socket subscribed to it, now or when
   it subscribes (a socket that dropped before acknowledging gets it again); the sender is not sent its own. `drop()` closes
   every socket, as a network does. The login (?auth=<JWT>) is checked for its shape. */
import {createRequire} from 'node:module';
const require = createRequire('/Users/z/tacit-wallet/build/package.json');
const {WebSocketServer} = require('ws');

export async function startRelay() {
  const wss = new WebSocketServer({port: 0, host: '127.0.0.1'});
  await new Promise((r) => wss.on('listening', r));
  const subs = new Map(), kept = new Map(), unacked = new Map(), seen = [], logins = [];
  let nextId = 1;
  const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch {} };
  const subscribe = (ws, mine, t) => { (subs.get(t) || subs.set(t, new Set()).get(t)).add(ws); mine.add(t); };
  // A message kept for a topic and sent to those subscribed to it, bar the sender.
  const publish = (ws, topic, message, tag) => {
    const k = {message, tag, at: Date.now(), by: ws};
    (kept.get(topic) || kept.set(topic, []).get(topic)).push(k);
    for (const s of subs.get(topic) || []) if (s !== ws) deliver(s, topic, k);
  };
  const deliver = (ws, topic, m) => {
    const id = Date.now() * 1000 + (nextId++ % 1000);
    unacked.set(id, m);
    send(ws, {id, jsonrpc: '2.0', method: 'irn_subscription', params: {id: 'sub-' + topic.slice(0, 8), data: {topic, message: m.message, publishedAt: m.at, tag: m.tag}}});
  };
  wss.on('connection', (ws, req) => {
    if (api.refuse) { ws.terminate(); return; }
    const q = new URL(req.url, 'http://x').searchParams, jwt = q.get('auth') || '';
    logins.push({ok: /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt), project: q.get('projectId'), origin: req.headers.origin || null});
    const mine = new Set();
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.method === undefined) { const k = unacked.get(m.id); if (k) { k.acked = true; unacked.delete(m.id); } return; }   // an acknowledgement of a delivery
      const p = m.params || {};
      seen.push({method: m.method, topic: p.topic, tag: p.tag});
      if (m.method === 'irn_subscribe' || m.method === 'irn_batchSubscribe') {
        const topics = p.topics || [p.topic];
        for (const t of topics) subscribe(ws, mine, t);
        send(ws, {id: m.id, jsonrpc: '2.0', result: m.method === 'irn_subscribe' ? 'sub-' + topics[0].slice(0, 8) : topics.map((t) => 'sub-' + t.slice(0, 8))});
        for (const t of topics) for (const k of kept.get(t) || []) if (k.by !== ws && !k.acked) deliver(ws, t, k);
      } else if (m.method === 'irn_publish') {
        send(ws, {id: m.id, jsonrpc: '2.0', result: true});
        publish(ws, p.topic, p.message, p.tag);
      } else if (m.method === 'wc_approveSession') {
        // The SDK's wallet approves in one call: the answer goes to the pairing topic, the wallet is put on the session's
        // topic, and the session's first message (the settlement) goes there for the dapp.
        send(ws, {id: m.id, jsonrpc: '2.0', result: true});
        publish(ws, p.pairingTopic, p.sessionProposalResponse, 1101);
        subscribe(ws, mine, p.sessionTopic);
        publish(ws, p.sessionTopic, p.sessionSettlementRequest, 1102);
      } else if (m.method === 'wc_proposeSession') {
        send(ws, {id: m.id, jsonrpc: '2.0', result: true});
        subscribe(ws, mine, p.pairingTopic);
        publish(ws, p.pairingTopic, p.sessionProposal, 1100);
      } else if (m.method === 'irn_unsubscribe' || m.method === 'irn_batchUnsubscribe') {
        for (const t of p.topics || [p.topic]) { subs.get(t)?.delete(ws); mine.delete(t); }
        send(ws, {id: m.id, jsonrpc: '2.0', result: true});
      } else send(ws, {id: m.id, jsonrpc: '2.0', result: m.method === 'irn_batchFetchMessages' ? {messages: [], hasMore: false} : true});
    });
    ws.on('close', () => { for (const t of mine) subs.get(t)?.delete(ws); });
  });
  const api = {
    url: `ws://127.0.0.1:${wss.address().port}`, seen, logins, refuse: false,
    drop: () => { for (const c of wss.clients) c.terminate(); },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }),
  };
  return api;
}
