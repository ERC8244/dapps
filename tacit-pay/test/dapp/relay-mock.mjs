// A relay in memory for the page's wallet engine: quotes, reservations, a head, and a /relay that sends, refuses, or says it
// sent what it did not. Replaces fetch; call .restore() to put it back.
import {POOL} from './engine-mock.mjs';
import {config} from './page-config.mjs';
export function mockRelay(node, relayed, o = {}) {
  const st = {quote: 10n ** 13n, mode: 'send', log: [], need: null, reserve: 'ok', ...o};
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(String(url)).pathname.replace(/^.*\/keeper/, ''), body = init.body ? JSON.parse(init.body) : {};
    const res = (status, b) => ({status, ok: status === 200, headers: {get: () => null}, json: async () => b});
    st.log.push(p);
    if (p.startsWith('/quote')) return res(200, {chainId: 1, pool: POOL, relayer: config.RELAYERS[1], fee: String(st.quote), gas: 300000});
    if (p === '/reserve') {
      if (st.reserve === 'stale') return res(409, {error: 'queued'});
      return res(200, {id: 'a'.repeat(24), root: String(node.tree.root), oldRoot: String(node.tree.root), start: node.size, pending: [], expires: Math.floor(Date.now() / 1000) + 90});
    }
    if (p === '/cancel') return res(200, {ok: true});
    if (p === '/head') return res(200, {root: String(node.tree.root), size: node.size, pending: [], tail: {root: String(node.tree.root)}});
    if (p === '/relay') {
      st.relays = (st.relays || 0) + 1; st.last = body;
      if (st.mode === 'refuse') return res(500, {error: 'busy'});
      if (st.mode === 'drop') return res(200, {txHash: '0x' + 'cd'.repeat(32)});
      if (st.need && BigInt(body.tx.fee) < st.need) return res(400, {error: 'fee too low', needFee: String(st.need)});
      const r = relayed(body.tx);
      return r.revert ? res(400, {error: r.revert}) : res(200, {txHash: r.h});
    }
    if (p.startsWith('/events')) return res(404, {});
    return res(404, {});
  };
  st.restore = () => { globalThis.fetch = real; };
  return st;
}
