// A local preview of the tacit.wei page as it heads for its next version: the built page (dapp/page.min.html) as last
// pushed, read from the remote branch every two minutes, and the one in this checkout.
//
//   node deploy/preview.mjs [port]          (default 8480; REF=origin/main, EVERY=120 seconds, NOFETCH=1 to stay offline)
//
//   http://127.0.0.1:<port>/          the page at REF, fetched again on its own (the working tree is not touched)
//   http://127.0.0.1:<port>/local     the page in this checkout, as built by deploy/repin.sh
//   http://127.0.0.1:<port>/version   which commit, size and SHA-256 each serves
//
// The page counts 127.0.0.1 as one of its own hosts, so signing in works as on tacit.wei.limo, against Ethereum mainnet: real
// funds. Keep one port: what the page keeps in the browser (the key's sealed state, the 24 words' root) is kept per origin.
// The page runs in no frame and its script is pinned by its CSP, so nothing is added to it: reload the tab for a new build.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../../', import.meta.url).pathname, PORT = Number(process.argv[2] || 8480);
const REF = process.env.REF || 'origin/main', EVERY = Number(process.env.EVERY || 120) * 1000, FILE = 'tacit-wei/dapp/page.min.html';
const git = (...a) => execFileSync('git', a, { cwd: DIR, maxBuffer: 64 << 20 });
const sha = (b) => createHash('sha256').update(b).digest('hex');
let remote = null;

function load() {
  try {
    if (!process.env.NOFETCH) git('fetch', '-q', REF.split('/')[0]);
    const commit = git('rev-parse', '--short', REF).toString().trim();
    if (remote?.commit === commit) return;
    const body = git('show', `${REF}:${FILE}`), subject = git('log', '-1', '--format=%s', REF).toString().trim();
    remote = { commit, subject, body, bytes: body.length, sha256: sha(body), at: new Date().toISOString() };
    console.log(`${remote.at.slice(11, 19)}  / now serves ${REF} ${commit} (${subject}), ${remote.bytes} B, sha256 ${remote.sha256.slice(0, 16)}…`);
  } catch (e) { console.log(`could not read ${REF}: ${String(e.message || e).split('\n')[0]}`); }
}
const local = () => { const body = readFileSync(DIR + FILE); return { body, bytes: body.length, sha256: sha(body) }; };

load();
setInterval(load, EVERY).unref?.();
http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  try {
    if (path === '/' && remote) return send(200, 'text/html; charset=utf-8', remote.body);
    if (path === '/local') return send(200, 'text/html; charset=utf-8', local().body);
    if (path === '/version') {
      const l = local();
      return send(200, 'application/json', JSON.stringify({ '/': remote && { ref: REF, commit: remote.commit, subject: remote.subject, bytes: remote.bytes, sha256: remote.sha256, fetched: remote.at }, '/local': { bytes: l.bytes, sha256: l.sha256 } }, null, 2));
    }
    send(404, 'text/plain', 'not here: / (pushed), /local (this checkout), /version');
  } catch (e) { send(500, 'text/plain', String(e.message || e)); }
}).listen(PORT, '127.0.0.1', () => console.log(`tacit.wei preview on http://127.0.0.1:${PORT}/ (${REF}), /local, /version`));
