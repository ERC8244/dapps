#!/usr/bin/env node
/**
 * Write a dapp's deployed page from its readable source, as small as it can be made without changing what the page
 * does: the bytes stored on chain shrink, and every name, string and number in its code stays as it is written.
 *
 * A manifest that names a `source` beside its `page` is built this way:
 * - each JavaScript `<script>` is written again from the parser's (acorn) own reading of it: its comments and the
 *   whitespace between its tokens go, a space stays only where two tokens would otherwise run together, and a line
 *   break that ended a statement becomes the `;` it stood for. A script whose type is not JavaScript (a JSON block, say)
 *   is copied untouched, except one marked `data-strip` (a worker's code kept in the page as text).
 * - each `<style>` loses its comments and the whitespace around `{`, `}`, `;`, `,`, `>` and `!` or after a `:`, and the
 *   `;` before a `}`; strings and `url(…)` are copied as they are, and so is a value the browser keeps as written (a
 *   custom property's, or one that holds `var()`, `env()` or `attr()`).
 * - in the HTML around them, `<!-- … -->` comments go and each run of whitespace that holds a line break becomes one
 *   line break, so a space between two elements stays one; tags, `<pre>` and `<textarea>` are copied as they are.
 *
 * Each script is checked before the page is written: it parses to the same syntax tree as the source (every node, name
 * and literal, positions aside), and it holds no more `</script` or `<!--` than the source did.
 *
 * A page that pins its own scripts (a CSP hash, a hash of a worker block) is pinned again after this, by the dapp's
 * own release step, since the pinned text changes; and code that reads the page's own text (a worker made from part
 * of a script, say) finds its place by something other than the source's spacing.
 *
 * Usage: node scripts/strip.mjs <dapp>
 */
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import {load} from "./lib.mjs";

const m = load(process.argv[2]);
if (!m.source) {
  console.error(`${m.name}: the manifest names no "source" to build "${m.page}" from`);
  process.exit(1);
}
const src = fs.readFileSync(path.join(m.dir, m.source), "utf8");

const OPTS = (sourceType) => ({ecmaVersion: "latest", sourceType, allowHashBang: true});
const T = acorn.tokTypes;

/** Calls `f` on every node of an acorn tree. */
function walk(node, f) {
  f(node);
  for (const v of Object.values(node)) for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x.type === "string") walk(x, f);
}

/** Whether two acorn trees are the same program: every node, name and literal alike, positions aside. */
function same(a, b) {
  if (a === b) return true;
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a).filter((k) => k !== "start" && k !== "end"), kb = Object.keys(b).filter((k) => k !== "start" && k !== "end");
  return ka.length === kb.length && ka.every((k) => k in b && same(a[k], b[k]));
}

/** The script written again from its tokens as the parser read them. Between two tokens: a `;` where the source's line
 *  break ended a statement (automatic semicolon insertion), a space where the two would otherwise run together, and
 *  nothing else. A `;` that ends the last statement before a `}` (or the script's end) is left out, since the `}` ends
 *  it anyway. Strings, templates and regular expressions are tokens, so their text is copied as it is. */
function compact(code, sourceType) {
  const toks = [], asi = new Set(), empty = new Set();
  const ast = acorn.parse(code, {...OPTS(sourceType), onToken: toks, onInsertedSemicolon: (end) => asi.add(end)});
  walk(ast, (n) => { if (n.type === "EmptyStatement") empty.add(n.start); });
  const list = toks.filter((t) => t.type !== T.eof), word = (c) => /[\w$\\]/.test(c) || c > "\x7f";
  let out = "", prev = null;
  list.forEach((t, i) => {
    const next = list[i + 1];
    if (t.type === T.semi && !empty.has(t.start) && (!next || next.type === T.braceR)) return;
    const text = code.slice(t.start, t.end);
    if (prev) {
      const a = out[out.length - 1], b = text[0];
      if (asi.has(prev.end) && t.type !== T.braceR) out += ";";
      else if (code.slice(prev.end, t.start) && ((word(a) && word(b)) || (a === "+" && b === "+") || (a === "-" && (b === "-" || b === ">")) || (a === "/" && (b === "/" || b === "*")) || (a === "<" && b === "!") || (prev.type === T.num && b === "."))) out += " ";
    }
    out += text;
    prev = t;
  });
  return {out, ast};
}

function stripScript(code, sourceType) {
  const {out, ast} = compact(code, sourceType);
  if (!same(ast, acorn.parse(out, OPTS(sourceType)))) throw new Error("stripping a script changed its syntax tree");
  const html = (s) => (s.match(/<\/script|<!--/gi) || []).length;
  if (html(out) > html(code)) throw new Error("stripping a script left </script or <!-- in it");
  return out;
}

/** The stylesheet with its comments taken out and its whitespace cut down: none around `{`, `}`, `;`, `,`, `>` and `!`
 *  or after a `:`, a single space wherever else there was any (a space before a `:` starts a descendant's selector), and
 *  no `;` before a `}`. Strings and an unquoted `url(…)` are copied as they are, and so is a value whose text the
 *  browser keeps as written (`--x: a, b`, `padding: max(16px, env(…))`), so that its style rules read back the same. */
function stripStyle(css) {
  let out = "", code = "";
  const done = () => { out += code.replace(/\s+/g, " ").replace(/ ?([{};,>!]) ?/g, "$1").replace(/: /g, ":").replace(/;}/g, "}"); code = ""; };
  const string = (i) => {
    let j = i + 1;
    while (j < css.length && css[j] !== css[i]) j += css[j] === "\\" ? 2 : 1;
    if (j >= css.length) throw new Error("an unclosed CSS string");
    return j + 1;
  };
  const comment = (i) => {
    const e = css.indexOf("*/", i + 2);
    if (e < 0) throw new Error("an unclosed CSS comment");
    return e + 2;
  };
  for (let i = 0; i < css.length;) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const e = string(i);
      done(); out += css.slice(i, e); i = e;
    } else if (ch === "/" && css[i + 1] === "*") {
      code += " "; i = comment(i);
    } else if (/^url\(\s*[^\s"']/i.test(css.slice(i, i + 6)) && !/[\w-]/.test(css[i - 1] || "")) {
      const e = css.indexOf(")", i);
      if (e < 0) throw new Error("an unclosed url(");
      done(); out += css.slice(i, e + 1); i = e + 1;
    } else if (ch === ":" && /[{;]\s*[-\w]+\s*$/.test(code)) {
      // A property's value, unless a `{` comes first (then this is a selector's `:`). A custom property's value, or one
      // that holds var(), env() or attr(), the browser keeps as written until it substitutes: it is copied that way.
      const custom = /--[\w-]*\s*$/.test(code);
      let v = "", j = i + 1, block = false;
      for (let nest = 0; j < css.length;) {
        const c = css[j];
        if (c === '"' || c === "'") { const e = string(j); v += css.slice(j, e); j = e; continue; }
        if (c === "/" && css[j + 1] === "*") { j = comment(j); continue; }
        if (!nest && (c === ";" || c === "}")) break;
        if (!nest && c === "{" && !custom) { block = true; break; }
        if ("([{".includes(c)) nest++;
        else if (")]}".includes(c)) nest--;
        v += c; j++;
      }
      if (block || !(custom || /\b(var|env|attr)\(/i.test(v))) { code += ch; i++; continue; }
      code += ":"; done();
      out += v.trim(); i = j;
    } else { code += ch; i++; }
  }
  done();
  return out.trim();
}

/** HTML outside scripts and styles: its comments out, and each run of whitespace that holds a line break made one line
 *  break. Tags (their attributes' values), `<pre>` and `<textarea>` are copied as they are. */
function stripHtml(part) {
  let at = 0, out = "";
  for (let i = part.indexOf("<!--"); i >= 0; i = part.indexOf("<!--", at)) {
    const e = part.indexOf("-->", i + 4);
    if (e < 0) throw new Error("an unclosed HTML comment");
    out += part.slice(at, i);
    at = e + 3;
  }
  out += part.slice(at);
  return out.replace(/<pre\b[\s\S]*?<\/pre>|<textarea\b[\s\S]*?<\/textarea>|<(?:"[^"]*"|'[^']*'|[^'">])*>|([^<]+)/gi, (whole, text) => (text === undefined ? whole : text.replace(/[ \t]*[\n\r]\s*/g, "\n")));
}

const JS = /^(|module|text\/javascript|application\/javascript)$/i;
let html = "", at = 0, scripts = 0, styles = 0;
const block = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
for (let x; (x = block.exec(src));) {
  const [whole, tag, attrs, body] = x, start = x.index;
  html += stripHtml(src.slice(at, start));
  const type = (/\btype\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1] ?? "";
  let inner = body;
  if (tag.toLowerCase() === "style") { inner = stripStyle(body); styles++; }
  else if (JS.test(type) || /\bdata-strip\b/i.test(attrs)) { inner = stripScript(body, /module/i.test(type) ? "module" : "script"); scripts++; }
  html += whole.slice(0, whole.length - body.length - `</${tag}>`.length) + inner + `</${tag}>`;
  at = start + whole.length;
}
html += stripHtml(src.slice(at));

fs.writeFileSync(path.join(m.dir, m.page), html);
const a = Buffer.byteLength(src), b = Buffer.byteLength(html);
console.log(`${m.name}: ${m.source} ${a} B -> ${m.page} ${b} B (${a - b} B out, ${((1 - b / a) * 100).toFixed(1)}%; ${scripts} script(s), ${styles} style block(s))`);
