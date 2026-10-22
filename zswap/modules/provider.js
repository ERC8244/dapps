// Hand-written, not generated: a small EIP-1193 provider over a WalletConnect
// session, modelled on wcProv() in zswap/dapp/page.html without the page's
// storage, reload and read-pool wiring.
//
//   const provider = toProvider(client, session, {read: (method, params) => myRpc(method, params)});
//   await provider.request({method: "eth_accounts"});
//
// Signing and wallet_* methods go to the wallet over the relay. Everything else
// goes to `read` (your own node), falling back to the wallet when the session
// allows that method and no `read` is given.

const SIGN = ["eth_sendTransaction", "eth_signTransaction", "personal_sign", "eth_sign",
  "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4"];
const toWallet = (m) => m.startsWith("wallet_") || SIGN.includes(m);

/** Accounts the session settled on one chain, as plain addresses. */
export const accountsOn = (session, chainId) =>
  session.accounts
    .filter((a) => a.startsWith("eip155:") && a.split(":")[1] === String(chainId))
    .map((a) => a.split(":").pop());

export function toProvider(client, session, {chainId, read} = {}) {
  const ids = [...new Set(session.accounts.filter((a) => a.startsWith("eip155:")).map((a) => +a.split(":")[1]))];
  let chain = chainId && ids.includes(chainId) ? chainId : session.chain && ids.includes(session.chain) ? session.chain : ids[0];
  if (!chain) throw new Error("The wallet settled no EVM account.");
  session.chain = chain;
  const listeners = {chainChanged: [], accountsChanged: []};
  const emit = (name, data) => listeners[name].forEach((f) => { try { f(data); } catch {} });

  client.on((ev) => {
    if (!ev || ev.t !== "session" || !ev.m) return;
    const s = ev.m;
    if (s.method === "wc_sessionUpdate") {
      session.accounts = Object.values(s.params?.namespaces || {}).flatMap((n) => n.accounts || []);
      return emit("accountsChanged", accountsOn(session, chain));
    }
    if (s.method !== "wc_sessionEvent") return;
    const e = s.params?.event || {};
    let d = e.data;
    if (e.name === "chainChanged") {
      d = typeof d === "string" && d.includes(":") ? +d.split(":").pop() : +d;
      if (ids.includes(d)) { chain = session.chain = d; emit("chainChanged", "0x" + d.toString(16)); }
    }
    if (e.name === "accountsChanged" && Array.isArray(d)) emit("accountsChanged", d.map((a) => String(a).split(":").pop()));
  });

  return {
    request({method, params = []}) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return Promise.resolve(accountsOn(session, chain));
      if (method === "eth_chainId") return Promise.resolve("0x" + chain.toString(16));
      if (method === "wallet_switchEthereumChain") {
        const want = Number(params[0]?.chainId);
        if (!ids.includes(want)) return Promise.reject(Object.assign(new Error("Chain not in this session."), {code: 4902}));
        chain = session.chain = want;
        emit("chainChanged", "0x" + want.toString(16));
        return Promise.resolve(null);
      }
      if (toWallet(method)) return client.request(session, method, params);
      if (read) return read(method, params);
      if (session.methods.includes(method)) return client.request(session, method, params);
      return Promise.reject(Object.assign(new Error(`${method} needs a read node`), {code: 4200}));
    },
    on(name, f) { if (listeners[name]) listeners[name].push(f); },
    disconnect: () => client.end(session),
  };
}
