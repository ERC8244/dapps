// ── large pools in the page ──
// The Tornado Cash pools as part of one private balance. Shield: an amount of a whole note or more is split, whole notes
// into the large pools and the rest into Tacit, in one transaction (the split forwarder), from ETH or from a token (the
// split zap). Under the smallest note none of this shows. Withdraw: notes go first, each with its gas paid from the note
// (or by the wallet), the rest comes from the Tacit balance; as ETH, or as a token (the note's own account swaps). The
// notes card lists what the wallet holds there, finds it again from the wallet's signatures, takes in a pasted note, and
// moves a note into the Tacit balance. Notes are never stored: only where each is (number, pool) and its public names.
const LG = { smallest: null, chosen: false, gas: 'note', open: false, howOpen: false, notes: [], spent: new Map(), seen: new Map(), sessions: new Map(), gasPrice: null, gasAt: 0, ask: null, busy: false };
const LG_STORE = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
const lgChain = () => CHAINS[0];
const lgRead = (method, params = []) => rpcOn(lgChain())(method, params);
const lgOff = (bit) => ((REG.flags ?? 0n) >> BigInt(bit)) & 1n;
// What the large pools are and who reads the notes, in two marks drawn inline, each beside its name.
const LG_MARK = (box, body) => html`<svg width="14" height="14" viewBox="0 0 ${box} ${box}" aria-hidden="true" focusable="false" style="vertical-align:-2px;margin-right:4px">${new Raw(body)}</svg>`;
const LG_TORNADO = html`<span class="nw">${LG_MARK(39.9, '<path d="M40,19.4A17.3,17.3,0,0,0,22.8,2.8,17.1,17.1,0,0,0,8.6,10.4,11.3,11.3,0,0,1,19.3,0,17.1,17.1,0,0,0,2.8,17.1a16.8,16.8,0,0,0,7.7,14.2A11.3,11.3,0,0,1,0,20.6a17.1,17.1,0,0,0,31.3,9A11.4,11.4,0,0,1,20.6,39.9,17.1,17.1,0,0,0,37.1,22.8,17.3,17.3,0,0,0,29.5,8.6,11.8,11.8,0,0,1,40,19.4ZM20,27.2a7.4,7.4,0,0,1-5.2-2.1,7.1,7.1,0,0,1-2-5.1A7.2,7.2,0,1,1,20,27.2Z" fill="currentColor"/>')}Tornado Cash</span>`;
LG.gas = store.get('tacit-wei-fixed-gas') === 'wallet' ? 'wallet' : 'note';
{ const v = store.get('tacit-wei-fixed-min'); if (v === '0' || TC.SMALLEST.some((d) => String(d) === v)) { LG.smallest = BigInt(v); LG.chosen = true; } }

// ── the wallet's flows ──
// One session per account for as long as the page is open: a note number is signed for once.
function lgFlow() {
  const account = S.account;
  if (!LG.sessions.has(lc(account))) LG.sessions.set(lc(account), TC.newSession());
  return TC.makeFlow({
    read: lgRead, wallet: (method, params) => ask(S.provider, method, params), account, session: LG.sessions.get(lc(account)), store: LG_STORE,
    sendTx: (tx) => ask(S.provider, 'eth_sendTransaction', [{ ...tx, chainId: '0x1' }]),
  });
}
const lgReader = () => TC.makeFlow({ read: lgRead });

// ── the smallest note: 0.1 ETH, raised while a note's deposit gas is over 2% of it, unless chosen ──
async function lgGasPrice() {
  if (Date.now() - LG.gasAt < 60_000 && LG.gasPrice != null) return LG.gasPrice;
  try { LG.gasPrice = BigInt(await lgRead('eth_gasPrice', [])); LG.gasAt = Date.now(); } catch { LG.gasAt = Date.now() - 50_000; }
  return LG.gasPrice;
}
const lgSmallest = () => (LG.smallest != null ? LG.smallest : LG.gasPrice != null ? TC.autoSmallest(LG.gasPrice) : 10n ** 17n);
// The split of `wei` for a deposit into the wallet's own balance, or null when there is none to show.
function lgPlan(wei) {
  if (!wei || lgOff(0) || lgSmallest() === 0n) return null;
  const p = TC.planSplit(wei, { min: lgSmallest() });
  return p.noteCount ? { ...p, wei, noteTotal: p.notes.reduce((t, n) => t + n.denomination * BigInt(n.count), 0n) } : null;
}
const lgSmallestSelect = () => html`<label class="nw">Smallest note <select id="lg-min" aria-label="Smallest note">${[...TC.SMALLEST.map((d) => [d, `${TC.ethWords(d)} ETH`]), [0n, 'Off']].map(([d, l]) => html`<option value="${d}" ${d === lgSmallest() ? 'selected' : ''}>${l}</option>`)}</select></label>`;
// The split card, under the amount: the parts, the crowd each pool holds, the network fee, and what the wallet will ask.
function lgSplitCard(p, { swapped = false } = {}) {
  if (!p) return '';
  const sizes = p.notes.map((n) => { const s = TC.cachedSize(TC.poolOf(n.address)); return s ? html`<p class="note mute" data-lg-size="${n.address}">${TC.ethWords(n.denomination)} ETH pool: ${s.deposits.toLocaleString('en-US')} deposits, ${s.held.toLocaleString('en-US')} notes in it now.</p>` : html`<p class="note mute" data-lg-size="${n.address}" hidden></p>`; });
  const fee = LG.gasPrice != null ? TC.depositGas(p.noteCount, p.remainder > 0n) * LG.gasPrice : null;
  const dust = p.remainder > 0n && LG.gasPrice != null && 380_000n * LG.gasPrice * 10n > p.remainder;
  return html`<div class="lg-split"><div class="lbl"><span>Split</span><span>${lgSmallestSelect()}</span></div>
    <div class="lg-parts" role="group" aria-label="How the deposit is split">
      <div class="lg-part"><b class="num">${p.notes.map((n) => `${n.count} × ${TC.ethWords(n.denomination)} ETH`).join(' + ')}</b><span>whole ${p.noteCount === 1 ? 'note' : 'notes'} · ${LG_TORNADO}</span></div>
      ${p.remainder > 0n ? html`<div class="lg-part"><b class="num">${fmt(p.remainder, 18)} ETH</b><span>your private balance</span></div>` : ''}
    </div>${sizes}
    ${fee != null ? html`<p class="note mute">Network fee about ${ethStr(fee)} ETH${swapped ? ' plus the swap' : ''}, paid by your wallet. One transaction.</p>` : ''}
    ${dust ? html`<p class="note warn">The ${fmt(p.remainder, 18)} ETH left over costs about as much gas to deposit as it is worth. <button class="link" type="button" id="lg-drop">Leave it in my wallet</button></p>` : ''}
    <p class="note">Your wallet signs ${p.noteCount + (lgSessionChecked() ? 0 : 1)} short messages first (nothing is sent; they make the notes, so only your wallet can find them again), then confirms once.</p></div>`;
}
const lgSessionChecked = () => !!LG.sessions.get(lc(S.account))?.checked;
// The card's live bits: the select, the pool sizes as they come in, the leftover choice. `onChange()` redraws the form.
function lgWireSplit(f, p, onChange, { setAmount } = {}) {
  const sel = $('#lg-min', f);
  if (sel) sel.onchange = () => { LG.smallest = BigInt(sel.value); LG.chosen = true; store.set('tacit-wei-fixed-min', sel.value); onChange(); };
  $('#lg-drop', f)?.addEventListener('click', () => setAmount?.(p.noteTotal));
  if (!p) return;
  for (const n of p.notes) {
    const pool = TC.poolOf(n.address);
    if (TC.cachedSize(pool)) continue;
    TC.poolSize(lgRead, pool).then((s) => { const el = $(`[data-lg-size="${n.address}"]`, f); if (el) { el.textContent = `${TC.ethWords(pool.denomination)} ETH pool: ${s.deposits.toLocaleString('en-US')} deposits, ${s.held.toLocaleString('en-US')} notes in it now.`; el.hidden = false; } }, () => {});
  }
  if (LG.gasPrice == null || Date.now() - LG.gasAt > 60_000) lgGasPrice().then(() => { if (!S.busy) onChange(); });
}
const lgSaid = (s) => (s.step === 'find' ? 'checking which note numbers are free'
  : s.step === 'probe' ? (s.signs ? 'sign in your wallet to find your next note number' : 'checking which note numbers are free')
  : s.step === 'sign' ? (s.signs ? `sign in your wallet for note ${s.i + 1} of ${s.of}` : `preparing note ${s.i + 1} of ${s.of}`)
  : s.step === 'send' ? 'confirm the deposit in your wallet' : `deposit ${s.i} of ${s.of} confirmed`);
const lgKeep = (notes) => { if (!notes?.length) return; TC.writeNotes(LG_STORE, S.account, [...TC.readNotes(LG_STORE, S.account), ...notes.map(TC.metaOf)]); lgLoad(); };
const LG_FORWARDER_OK = { v: null, at: 0 };
async function lgForwarder(p) {
  if (lgOff(6)) return false;
  if (Date.now() - LG_FORWARDER_OK.at < 600_000 && LG_FORWARDER_OK.v != null) return LG_FORWARDER_OK.v;
  const ok = await TC.forwarderOk(lgRead, POOL, TC.POOLS).catch(() => false);
  Object.assign(LG_FORWARDER_OK, { v: ok, at: Date.now() });
  return ok && !!p;
}
// The deposit of plan `p` from ETH, inside act(): notes and the rest in one transaction through the forwarder (the Tacit
// part proved here, as any deposit), or, with no forwarder, the notes one by one and then the rest. → { h, text }
async function lgDeposit(c, p, step) {
  await walletReady(c, step);
  await walletCovers(c, p.wei);
  const flow = lgFlow(), one = (p.remainder > 0n || p.noteCount > 1) && (await lgForwarder(p));
  const placed = (notes) => `${notes.length === 1 ? 'The note is' : `The ${notes.length} notes are`} in the large ${notes.length === 1 ? 'pool' : 'pools'} (${fmt(p.noteTotal, 18)} ETH)`;
  if (one) {
    let out;
    try {
      out = await flow.depositWith(p, async (notes) => {
        if (p.remainder > 0n) {
          // the Tacit part is proved by the deposit as any is, and sent inside the forwarder's call with the notes
          return walletOn(c).deposit({ amount: p.remainder, onStep: step, through: { to: TC.FORWARDER, value: notes.reduce((t, n) => t + n.pool.denomination, 0n) + p.remainder, data: (tv) => calldata(`splitDeposit(address[],bytes32[],${TX_SIG})`, [{ array: 'address' }, { array: 'bytes32' }, { tuple: TX_TYPES }], [notes.map((n) => n.pool.address), notes.map((n) => TC.b32(n.secrets.commitment)), tv]), before: [] } });
        }
        step('confirm the deposit in your wallet');
        return (await flow.sendOne(TC.splitDepositCall(null, notes))).hash;
      }, { onStep: (s) => step(lgSaid(s)) });
    } catch (e) {
      if (e?.done?.length) lgKeep(e.done);
      throw e?.done?.length ? e : new Error(`None of it was deposited. ${errText(e)}`);
    }
    lgKeep(out.notes);
    return { h: out.hash, text: p.remainder > 0n ? `${placed(out.notes)}, and ${fmt(p.remainder, 18)} ETH went into your private balance, in one transaction.` : `${placed(out.notes)}, in one transaction.` };
  }
  let out;
  try { out = await flow.deposit(p, { onStep: (s) => step(lgSaid(s)) }); } catch (e) {
    if (e?.done?.length) { lgKeep(e.done); throw new Error(`${e.done.length} of ${p.noteCount} notes went in and are kept. ${errText(e)}`); }
    throw e;
  }
  lgKeep(out.notes);
  if (p.remainder === 0n) return { h: null, text: `${placed(out.notes)}.` };
  try { return { h: await walletOn(c).deposit({ amount: p.remainder, onStep: step }), text: `${placed(out.notes)}, and ${fmt(p.remainder, 18)} ETH went into your private balance.` }; } catch (e) {
    throw new Error(`${placed(out.notes)}. The other ${fmt(p.remainder, 18)} ETH did not go in: ${errText(e)} Shield it again on its own.`);
  }
}

// ── the notes the wallet holds ──
function lgLoad() {
  LG.notes = S.account ? TC.readNotes(LG_STORE, S.account) : [];
  const r = lgReader();
  for (const n of LG.notes) {
    if (LG.spent.has(n.nh)) continue;
    r.spent(TC.poolOf(n.pool), BigInt(n.nh)).then((v) => { LG.spent.set(n.nh, v); lgPaint(); }, () => {});
  }
  lgSeen();
  lgPaint();
}
let lgSeenBusy = false;
async function lgSeen() {
  if (lgSeenBusy) return;
  lgSeenBusy = true;
  try {
    for (const n of [...LG.notes]) {
      if (LG.spent.get(n.nh) || !n.c) continue;
      const pool = TC.poolOf(n.pool);
      try { const info = TC.seenInfo(await TC.noteSeen({ read: lgRead, store: LG_STORE, pool, commitment: n.c }), await TC.poolSize(lgRead, pool).catch(() => null)); if (info) { LG.seen.set(n.c, info); lgPaint(); } } catch { /* no line for it */ }
    }
  } finally { lgSeenBusy = false; }
}
const lgLive = () => LG.notes.filter((n) => LG.spent.get(n.nh) !== true).sort((a, b) => a.nonce - b.nonce);
const lgHeld = () => lgLive().reduce((t, n) => t + (TC.poolOf(n.pool)?.denomination ?? 0n), 0n);
// Under the balance: what is in whole notes, as part of one total.
const lgBalLine = () => { const h = lgHeld(); return h > 0n ? html`<p class="note mute">Also in whole notes: <b class="num">${fmt(h)} ETH</b> (${lgLive().length}) · ${LG_TORNADO}</p>` : ''; };

// ── the notes card ──
function lgPaint() {
  const host = $('#lg-notes');
  if (!host || LG.busy) return;
  if (LG.ask && !LG.ask.hidden) { LG.dirty = true; return; }
  const live = lgLive(), done = LG.notes.filter((n) => LG.spent.get(n.nh) === true);
  if (!S.account && !live.length) { mount(host, ''); host.hidden = true; return; }
  host.hidden = !live.length && !LG.open;
  const rows = live.map((n) => { const s = LG.seen.get(n.c); return html`<div class="kv"><span>${TC.ethWords(TC.poolOf(n.pool).denomination)} ETH <span class="mute">· note ${n.nonce}</span></span><b><button class="link" type="button" data-lg-move="${n.pool}:${n.nonce}">Move into balance</button> <button class="link" type="button" data-lg-out="${n.pool}:${n.nonce}">Withdraw</button></b></div>${s ? html`<p class="note mute">${s.text}</p>` : ''}`; });
  const early = live.map((n) => LG.seen.get(n.c)).filter((s) => s?.low);
  mount(host, html`<div class="card-h"><h2>Whole notes</h2><span><button class="link" type="button" id="lg-find">${S.account ? 'Find' : 'Connect wallet'}</button> · <button class="link" type="button" id="lg-paste">Paste a note</button></span></div>
    <p class="note mute">${LG_TORNADO} notes, made from your wallet's signatures: Find brings them back on any device. Other wallets that read this scheme (Kohaku) open them too.</p>
    ${rows.length ? rows : html`<p class="note">None found in this browser. Find looks for notes made with this wallet.</p>`}
    ${early.length ? html`<p class="note warn">${early.length === 1 ? early[0].nudge : 'Few deposits have come after some of these. The more do, the better they blend in.'}</p>` : ''}
    ${done.length ? html`<details class="lg-spent"><summary class="note mute">${done.length} spent</summary>${done.map((n) => html`<div class="kv"><span>${TC.ethWords(TC.poolOf(n.pool).denomination)} ETH <span class="mute">· note ${n.nonce}</span></span><b class="mute">spent</b></div>`)}</details>` : ''}
    <div id="lg-ask" hidden></div>
    ${live.length ? html`<div class="lbl"><span>Gas</span><span><label>Paid from <select id="lg-gas" aria-label="Where a note's gas is paid from"><option value="note" ${LG.gas === 'note' ? 'selected' : ''}>the note</option><option value="wallet" ${LG.gas === 'wallet' ? 'selected' : ''}>my wallet</option></select></label></span></div>
      <p class="note">${LG.gas === 'wallet' ? 'Your wallet sends each withdrawal and pays its gas, so it shows as the sender.' : `Gas comes out of the note (at most ${TC.MAX_FEE_PERCENT}%), so no wallet shows: a public bundler sends it.`}</p>` : ''}
    <details class="lg-how"><summary class="note">How it works</summary>
      <p class="note">A deposit of a whole note or more puts whole notes (0.1, 1, 10 or 100 ETH) into ${LG_TORNADO}'s pools, where every deposit is the same size and the crowd is large, and the rest into your Tacit balance, which takes any amount and pays inside itself.</p>
      <p class="note">Take a note out to any address, as ETH or a token, or move it into your balance to pay from there. Waiting first helps: the more deposits after yours, the better it blends in.</p></details>`);
  LG.ask = $('#lg-ask', host);
  $('#lg-find', host).onclick = (e) => (S.account ? lgFind(e.currentTarget) : connect().then(lgLoad, warn));
  $('#lg-paste', host).onclick = () => lgAskPaste();
  const g = $('#lg-gas', host);
  if (g) g.onchange = () => { LG.gas = g.value === 'wallet' ? 'wallet' : 'note'; store.set('tacit-wei-fixed-gas', LG.gas); lgPaint(); if (S.tab === 'withdraw') renderForm(); };
  const pick = (v) => LG.notes.find((n) => `${n.pool}:${n.nonce}` === v);
  $$('[data-lg-move]', host).forEach((b) => b.onclick = () => lgMove(b, pick(b.dataset.lgMove)));
  $$('[data-lg-out]', host).forEach((b) => b.onclick = () => lgAskOut(pick(b.dataset.lgOut)));
}
function lgCloseAsk() { if (!LG.ask) return; LG.ask.hidden = true; mount(LG.ask, ''); if (LG.dirty) { LG.dirty = false; lgPaint(); } }
function lgFind(btn) {
  return act(btn, async (step, c) => {
    await walletReady(c, step);
    const { found } = await lgFlow().scan({ from: 0, onProbe: (n, signs) => step(signs ? `sign in your wallet to look for note number ${n}` : 'looking for your notes') });
    for (const f of found) LG.spent.set(TC.b32(f.secrets.nullifierHash), !!f.spent);
    lgKeep(found);
    LG.open = true;
    mount($('#status'), found.length ? `${found.length} found, ${found.filter((f) => !f.spent).length} unspent.` : 'No notes found for this wallet.');
  });
}

// ── the prover: fetched once, checked by its SHA-256, kept in this browser ──
const LG_PROVER = { bytes: null, busy: null };
function lgWasm(onBytes = () => {}) {
  if (LG_PROVER.bytes) return Promise.resolve(LG_PROVER.bytes);
  return (LG_PROVER.busy ||= (async () => {
    const a = { name: TC.WASM.name, sha256: TC.WASM.sha256, bytes: TC.WASM.bytes }, key = `${location.origin}/${a.name}?sha256=${a.sha256}`;
    let cache = null;
    try { cache = await caches.open(ARTIFACTS); } catch {}
    const hit = await cache?.match(key).catch(() => null);
    if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); if (b.length === a.bytes && await sha256hex(b) === a.sha256) return (LG_PROVER.bytes = b); await cache.delete(key).catch(() => {}); }
    const urls = [...new Set([...TC.WASM_MIRRORS, ...(REG.tmirrors || [])])];
    for (const u of urls) {
      let got = 0;
      const ac = new AbortController();
      let stall = wakeful(MIRROR_STALL_MS, () => ac.abort());
      try {
        const r = await fetch(u, { signal: ac.signal });
        if (!r.ok) continue;
        const reader = r.body.getReader(), b = new Uint8Array(a.bytes);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stall.stop(); stall = wakeful(MIRROR_STALL_MS, () => ac.abort());
          if (got + value.length > a.bytes) throw new Error('longer than the pinned file');
          b.set(value, got); got += value.length; onBytes(value.length);
        }
        if (got === a.bytes && await sha256hex(b) === a.sha256) { await cache?.put(key, new Response(b)).catch(() => {}); return (LG_PROVER.bytes = b); }
        onBytes(-got);
      } catch { onBytes(-got); } finally { stall.stop(); }
    }
    const b = await fromChain(a, onBytes);
    if (b) { await cache?.put(key, new Response(b)).catch(() => {}); return (LG_PROVER.bytes = b); }
    throw new Error('The withdrawal prover could not be downloaded. Try again in a minute, or add a mirror under Endpoints.');
  })().finally(() => { LG_PROVER.busy = null; }));
}
// Fetched ahead, quietly, once a wallet with notes opens Withdraw: the first withdrawal then waits for no download.
const lgWarm = () => { if (lgLive().length && !LG_PROVER.bytes && !LG_PROVER.busy && !navigator.connection?.saveData) lgWasm().catch(() => {}); };
const lgProver = () => TC.workerProver(() => lgWasm().then((b) => b.slice().buffer));
// The deposit histories read in this visit, by pool: a second withdrawal from a pool reads and builds nothing again.
const LG_TREES = { pools: new Map(), loaded: null };
const lgExitSaid = (s) => (s.step === 'read' ? (s.note ? 'the deposit history cache did not answer, so the pool is read from the chain (this can take minutes)' : s.of ? `reading the pool's deposits (${s.done} of ${s.of})` : 'reading the pool\'s deposits')
  : s.step === 'tree' ? `building the pool's tree from ${s.count.toLocaleString('en-US')} deposits` : s.step === 'prove' ? 'proving' : s.step === 'estimate' ? 'asking the bundler about the gas'
  : s.step === 'price' ? 'gas is high right now, waiting for a calmer price' : s.step === 'quote' ? 'check the fee, then press Send' : s.step === 'reprice' ? 'the gas price moved, making it again'
  : s.step === 'wait' ? 'waiting for the withdrawal to be mined' : s.step === 'send' ? 'confirm in your wallet' : 'working');

// One note out, inside act(). `n`: a stored note or { text }; `to`: an address; `swap`: { t (token), slip } for a token.
// `confirm(info)` → bool is asked once the fee is fixed. → { receive, route, hash, spent, account }
async function lgExitOne(c, step, n, to, { confirm, swap = null, prover = null } = {}) {
  const fromWallet = LG.gas === 'wallet' && !swap, flow = lgFlow(), own = prover || lgProver();
  try {
    const text = n.text || (await walletReady(c, step), await flow.noteText(n));
    if (fromWallet) { await walletReady(c, step); return await flow.withdraw({ noteText: text, recipient: to, prover: own, confirm, cache: LG_TREES, onStep: (s) => step(lgExitSaid(s)) }); }
    if (lgOff(1)) throw new Error('Gas from the note is switched off for now. Choose your wallet for the gas.');
    let route = null;
    if (swap) {
      // the call's gas from a first route for about what the note leaves: swapRoute counts the relay's withdrawal (520k) in its
      // figure, which a note's own account does not make, so that part comes off
      const denom = TC.poolOf(n.pool ?? '')?.denomination ?? (n.text ? TC.POOLS.find((q) => TC.ethWords(q.denomination) === TC.parseNote(n.text).amount)?.denomination : null);
      const first = denom ? await swapRoute(c, swap.t, denom * 97n / 100n, swap.slip, to).catch(() => null) : null;
      if (!first) throw new Error(`No route to ${swap.t.sym} right now. Nothing was sent.`);
      const gas = BigInt(first.gas) > 620_000n ? BigInt(first.gas) - 520_000n : 100_000n;
      route = { router: ZROUTER, gas: gas + 60_000n, route: async (amountIn) => swapRoute(c, swap.t, amountIn, swap.slip, to).then((r) => (r ? { to: ZROUTER, value: r.value, data: r.data, out: r.out, limit: r.limit } : null)) };
    }
    return await flow.withdrawSponsored({ noteText: text, recipient: to, prover: own, confirm, cache: LG_TREES, bundlers: [...new Set([...(REG.bundler || []), ...TC.BUNDLERS])], fetchImpl: ROUTE.bundlerFetch, swap: route, onStep: (s) => step(lgExitSaid(s)) });
  } finally { if (!prover) own.close(); }
}
// The fee panel under the notes: what goes where, the fee and its share, a token's floor. → Promise<bool>
function lgConfirm({ fee, receive, denomination, route }, { what, to, swap } = {}) {
  return new Promise((resolve) => {
    const ask = LG.ask || $('#status');
    const up = (BigInt(fee) * 10000n + denomination - 1n) / denomination;
    ask.hidden = false;
    mount(ask, html`<div class="callout lg-fee"><div>
      <p class="note"><b>${what || 'This note'}</b> · ${TC.ethWords(denomination)} ETH${to ? html` → <code>${short(to, 6)}</code>` : ''}</p>
      ${fee === 0n ? html`<p class="note">Your wallet sends this and pays its gas, so it shows as the sender. The address gets the whole ${TC.ethWords(denomination)} ETH.</p>`
        : html`<p class="note">Gas from the note: up to ${ethStr(fee)} ETH (${(Number(up) / 100).toFixed(2)}%); what is not used comes back${swap ? ' to the note\'s one-time address, which you can send on later' : ' to the address'}.</p>`}
      ${route ? html`<p class="note">Arrives as at least <b class="num">${units(route.limit, swap.t.dec)} ${swap.t.sym}</b> (quoted ${units(route.out, swap.t.dec)}).</p>` : fee ? html`<p class="note">The address gets at least <b class="num">${fmt(receive, 6, true)} ETH</b>.</p>` : ''}
      <div class="row"><button class="btn sm" type="button" id="lg-yes">Send</button><button class="btn ghost sm" type="button" id="lg-no">Cancel</button></div></div></div>`);
    const fin = (ok) => { clearTimeout(t); ask.hidden = true; mount(ask, ''); resolve(ok); if (LG.dirty) { LG.dirty = false; lgPaint(); } };
    const t = setTimeout(() => fin(false), 180_000);
    $('#lg-yes', ask).onclick = () => fin(true);
    $('#lg-no', ask).onclick = () => fin(false);
    $('#lg-yes', ask).focus();
  });
}
// A swap-out whose call failed, or a refund waiting at a note's one-time address: send it on from there.
async function lgSweep(c, step, n, to) {
  const flow = lgFlow(), text = n.text || (await walletReady(c, step), await flow.noteText(n));
  step('sending it on from the note\'s one-time address');
  const r = await TC.sweepThrowaway({ read: lgRead, key: TC.noteKey(TC.parseNote(text).preimage), to });
  done(c, r.hash, `${fmt(r.value)} ETH is on its way to ${short(to, 6)}.`);
}
async function lgOutcome(c, n, out, words) {
  if (n.nh) LG.spent.set(n.nh, !!out.spent);
  lgLoad();
  if (out.hash) done(c, out.hash, words); else mount($('#status'), 'Sent; the pool has not shown it yet.');
}
function lgMove(btn, n) {
  return act(btn, async (step, c) => {
    if (!S.key) throw new Error('Sign in first: the note goes to your deposit address, which your key makes.');
    const to = walletOn(c).receiveBox(0);
    const out = await lgExitOne(c, step, n, to, { confirm: (i) => lgConfirm(i, { what: `Note ${n.nonce}`, to }) });
    await lgOutcome(c, n, out, `${fmt(out.receive, 6, true)} ETH is on its way to your deposit address; the relay moves it into your balance within minutes.`);
  });
}
function lgAskOut(n) { lgAskForm(n, null); }
function lgAskPaste() { lgAskForm(null, ''); }
// The small form under the notes: an address (or name) and, for a pasted note, the note.
function lgAskForm(n, pasted) {
  const ask = LG.ask;
  if (!ask) return;
  ask.hidden = false;
  mount(ask, html`${pasted != null ? html`<div class="lbl"><span>Note</span></div><div class="amt text"><textarea id="lg-note" rows="3" placeholder="tornado-eth-…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Note" style="width:100%;font:inherit;resize:vertical;border:0;background:none;padding:12px 14px"></textarea></div>` : ''}
    <div class="lbl"><span>To</span><span>${pasted != null ? 'empty: your deposit address' : ''}</span></div>
    <div class="amt text"><input id="lg-to" placeholder="0x… or name.wei" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="To" data-1p-ignore data-lpignore="true"></div>
    <p class="note">${pasted != null ? 'The note stays in this page; nothing is signed by your wallet.' : 'As ETH. To take it as a token, use Withdraw.'}</p>
    <div class="row"><button class="btn sm" type="button" id="lg-go">Withdraw</button><button class="btn ghost sm" type="button" id="lg-cancel">Cancel</button></div>`);
  $('#lg-cancel', ask).onclick = lgCloseAsk;
  const go = $('#lg-go', ask);
  go.onclick = () => {
    const raw = $('#lg-to', ask).value.trim(), text = pasted != null ? $('#lg-note', ask).value.trim() : null;
    if (text != null) { try { const p = TC.parseNote(text); if (p.chainId !== 1) throw 0; } catch { return toast('That is not a note for Ethereum.', true); } }
    lgCloseAsk();
    act(go, async (step, c) => {
      const to = raw ? (isAddr(raw) ? (addrOk(raw) ? raw : null) : (await addressOfName(raw.toLowerCase(), c)).addr) : S.key ? walletOn(c).receiveBox(0) : null;
      if (!to) throw new Error('Enter where it goes.');
      const note = n || { text };
      const out = await lgExitOne(c, step, note, to, { confirm: (i) => lgConfirm(i, { what: n ? `Note ${n.nonce}` : 'The pasted note', to }) });
      await lgOutcome(c, note, out, `${fmt(out.receive, 6, true)} ETH is on its way to ${short(to, 6)}.`);
    });
  };
}

// ── the Withdraw form's notes part ──
// For an amount of a whole note or more, whole notes go first (the largest that fit), the rest from the Tacit balance.
function lgExitPlan(amount) {
  const live = lgLive();
  if (!live.length || !amount) return null;
  const dens = live.map((n) => TC.poolOf(n.pool).denomination), { picks, total } = TC.planExit(amount, dens);
  return picks.length ? { notes: picks.map((i) => live[i]), total, rest: amount - total } : null;
}
function lgExitRows(x, { swap = null } = {}) {
  if (!x) return '';
  const seens = x.notes.map((n) => LG.seen.get(n.c)), warnText = TC.exitWarning(seens);
  return html`${kvRow(`From whole notes (${x.notes.length})`, `${fmt(x.total)} ETH`)}${x.rest > 0n ? kvRow('From your private balance', `${fmt(x.rest, 18)} ETH`) : ''}
    <p class="note mute">${swap ? `Each note swaps to ${swap.t.sym} on its way out, gas from the note (at most ${TC.MAX_FEE_PERCENT}% each).` : LG.gas === 'wallet' ? 'Your wallet sends each note and pays its gas, so it shows as the sender.' : `Gas comes out of each note, at most ${TC.MAX_FEE_PERCENT}%.`}${x.notes.length > 1 ? ' Notes paid to one address one after another can be linked; spreading them out over time hides them better.' : ''}</p>
    ${warnText ? html`<p class="note warn">${warnText}</p>` : ''}`;
}
// Inside act(): the notes of `x` to `to` (as `swap`'s token when given), one prover and one tree per pool for the run.
// Each note is sent only if its fee is within the ceiling; the caller then sends `x.rest` from the Tacit balance.
async function lgExitNotes(c, step, x, to, { swap = null } = {}) {
  const prover = lgProver(), outs = [];
  try {
    for (let k = 0; k < x.notes.length; k++) {
      const n = x.notes[k], tag = (m) => step(x.notes.length > 1 ? `note ${k + 1} of ${x.notes.length}: ${m}` : m);
      try {
        const out = await lgExitOne(c, tag, n, to, { prover, swap, confirm: ({ fee, denomination, route }) => TC.withinCeiling(fee, denomination) && (!route || route.limit > 0n) });
        outs.push(out);
        if (n.nh) LG.spent.set(n.nh, !!out.spent);
      } catch (e) {
        const sent = outs.reduce((t, o) => t + o.receive, 0n);
        throw Object.assign(new Error(outs.length ? `${outs.length} of ${x.notes.length} notes went out (${fmt(sent, 6, true)} ETH). Note ${n.nonce} did not: ${errText(e)}` : errText(e)), { stranded: e?.stranded, note: n });
      }
    }
  } finally { prover.close(); lgLoad(); }
  return outs;
}

// ── making whole notes from the private balance ──
// One private spend into the router's call escrow, whose calls are the pools' deposits, so no wallet's ETH passes: the
// relay sends it (one note a transaction, under its gas cap) or the wallet does (all in one). Notes come from the wallet's
// signatures, so Find brings them back. If a call fails the transaction reverts and nothing is spent.
function lgIntakeCard(f) {
  if (lgOff(2) || !S.key) return;
  const host = $('#lg-intake', f);
  if (!host) return;
  const st = (LG.intake ||= { amount: '', open: false, via: 'relay' });
  const draw = () => {
    const live = $('details', host);
    if (live) st.open = live.open;
    const wei = parseEth(st.amount), p = wei ? TC.planSplit(wei, { min: lgSmallest() || 10n ** 17n }) : null, total = p ? p.notes.reduce((t, n) => t + n.denomination * BigInt(n.count), 0n) : 0n;
    const have = CH[lgChain().chainId].bal;
    mount(host, html`<details ${st.open ? 'open' : ''}><summary class="note">Make whole notes from your private balance</summary>
      <div class="amt text"><input id="lg-iamt" inputmode="decimal" placeholder="ETH to move into notes" autocomplete="off" aria-label="ETH to move into notes" value="${st.amount}"></div>
      ${p?.noteCount ? html`${p.notes.map((n) => kvRow(`${n.count} × ${TC.ethWords(n.denomination)} ETH`, 'whole notes'))}${p.remainder ? kvRow(`${fmt(p.remainder, 18)} ETH`, 'stays in your balance') : ''}
        ${have != null && have < total ? html`<p class="note err">Your private balance holds ${fmt(have, 6, true)} ETH, less than ${fmt(total)} ETH.</p>` : ''}
        <div class="lbl"><span>Sent by</span><span><select id="lg-ivia" aria-label="Who sends it"><option value="relay" ${st.via === 'relay' ? 'selected' : ''}>the relay (a fee for each note)</option><option value="wallet" ${st.via === 'wallet' ? 'selected' : ''}>my wallet (it shows as the sender)</option></select></span></div>
        <button class="btn ghost" type="button" id="lg-igo" ${have != null && have < total ? 'disabled' : ''}>Move ${fmt(total)} ETH into ${p.noteCount} ${p.noteCount === 1 ? 'note' : 'notes'}</button>` : html`<p class="note">${wei ? `Less than the smallest note, ${TC.ethWords(lgSmallest() || 10n ** 17n)} ETH.` : 'For a large amount kept in deep pools, with no wallet in between.'}</p>`}
    </details>`);
    const i = $('#lg-iamt', host);
    i.oninput = () => { st.amount = i.value; const pos = i.selectionStart; draw(); const j = $('#lg-iamt', host); j.focus(); j.setSelectionRange(pos, pos); };
    const v = $('#lg-ivia', host);
    if (v) v.onchange = () => { st.via = v.value === 'wallet' ? 'wallet' : 'relay'; };
    const go = $('#lg-igo', host);
    if (go) go.onclick = () => act(go, (step, c) => lgIntake(c, step, p, st.via));
  };
  draw();
}
async function lgIntake(c, step, p, via) {
  await walletReady(c, step);
  const flow = lgFlow(), W = walletOn(c);
  const notes = await flow.prepareNotes(p, { onStep: (s) => step(lgSaid(s)) });
  const groups = via === 'wallet' ? [notes] : notes.map((n) => [n]), placed = [];
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k], tag = (m) => step(groups.length > 1 ? `note ${k + 1} of ${groups.length}: ${m}` : m);
    const intent = { calls: g.map((n) => ({ target: n.pool.address, value: n.pool.denomination, token: ZERO_ADDRESS, amount: 0n, push: false, data: n.call.data })), outputs: [], to: ZERO_ADDRESS, refund: W.receiveBox(0), deadline: BigInt((await chainNow(c)) + 3600), nonce: big(randomBytes(16)) };
    const value = g.reduce((t, n) => t + n.pool.denomination, 0n), gas = TC.intakeGas(g.length);
    try {
      await W.callOut({ intent, value, gas, via: via === 'wallet' ? 'self' : null, onStep: tag, why: 'notes' });
    } catch (e) {
      const landed = await flow.landedNotes(g, { wait: false });
      if (landed.length !== g.length) { lgKeep(placed); throw new Error(placed.length ? `${placed.length} of ${notes.length} notes were made. The next did not go: ${errText(e)}` : errText(e)); }
    }
    const landed = await flow.landedNotes(g);
    placed.push(...landed);
    if (landed.length !== g.length) { lgKeep(placed); throw new Error('The spend went through but a note is not in its pool yet. Find shows it in a minute.'); }
  }
  lgKeep(placed);
  LG.intake.amount = '';
  mount($('#status'), html`<span class="ok">${placed.length === 1 ? 'The note is' : `The ${placed.length} notes are`} in the large pools, made from your private balance.</span>`);
}
