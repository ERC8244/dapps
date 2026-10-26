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
 * A manifest with `"minify": true` has its scripts minified instead (terser, at the version package.json pins): names
 * are shortened and the code is compressed, so the page is smaller still, but its names are no longer the source's.
 * Each script is taken to be the only code that names its top-level bindings, so those are shortened too, except where
 * a line `//:part` cuts a script into parts. Each part before the last keeps its top-level names as written, and the
 * parts after it never reuse them: a worker can run the first part's text on its own and find what it defines. Each
 * minified script must parse, keep every name its earlier parts define, and hold no more `</script` or `<!--` than the
 * source did.
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

/** The names a script declares at its top level: its variables, functions, classes and imports. */
function topNames(code, sourceType) {
  const names = [];
  const bind = (p) => {
    if (!p) return;
    if (p.type === "Identifier") names.push(p.name);
    else if (p.type === "ObjectPattern") p.properties.forEach((x) => bind(x.type === "RestElement" ? x.argument : x.value));
    else if (p.type === "ArrayPattern") p.elements.forEach(bind);
    else if (p.type === "AssignmentPattern") bind(p.left);
    else if (p.type === "RestElement") bind(p.argument);
  };
  for (const n of acorn.parse(code, OPTS(sourceType)).body) {
    if (n.type === "VariableDeclaration") n.declarations.forEach((d) => bind(d.id));
    else if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) names.push(n.id.name);
    else if (n.type === "ImportDeclaration") n.specifiers.forEach((s) => names.push(s.local.name));
  }
  return names;
}

/** The names a script reads that nothing in it declares: the globals it uses. A minified script may read no other. */
function freeNames(code, sourceType) {
  const ast = acorn.parse(code, OPTS(sourceType)), scopes = new Map(), free = new Set();
  const bind = (set, p) => {
    if (!p) return;
    if (p.type === "Identifier") set.add(p.name);
    else if (p.type === "ObjectPattern") p.properties.forEach((x) => bind(set, x.type === "RestElement" ? x.argument : x.value));
    else if (p.type === "ArrayPattern") p.elements.forEach((x) => bind(set, x));
    else if (p.type === "AssignmentPattern") bind(set, p.left);
    else if (p.type === "RestElement") bind(set, p.argument);
  };
  const kids = (n) => Object.entries(n).filter(([k]) => k !== "type" && k !== "start" && k !== "end");
  const BLOCK = /^(BlockStatement|For(In|Of)?Statement|SwitchStatement|CatchClause|StaticBlock)$/;
  // Declarations: `var` to the function, a function's name to the block around it, the rest to the block they are in.
  const declare = (n, fn, block) => {
    let f = fn, b = block;
    if (n.type === "Program" || /Function/.test(n.type)) {
      f = b = new Set(); scopes.set(n, f);
      n.params?.forEach((p) => bind(f, p));
      if (n.type === "FunctionExpression" && n.id) f.add(n.id.name);
    } else if (BLOCK.test(n.type)) { b = new Set(); scopes.set(n, b); if (n.type === "CatchClause") bind(b, n.param); }
    if (n.type === "VariableDeclaration") n.declarations.forEach((d) => bind(n.kind === "var" ? f : b, d.id));
    if (n.type === "FunctionDeclaration" && n.id) block.add(n.id.name);
    if ((n.type === "ClassDeclaration" || n.type === "ClassExpression") && n.id) b.add(n.id.name);
    if (/^Import(Default|Namespace)?Specifier$/.test(n.type)) b.add(n.local.name);
    for (const [, v] of kids(n)) for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x.type === "string") declare(x, f, b);
  };
  declare(ast, null, null);
  // References: an identifier that no enclosing scope declares, and that is not a property, a key or a label.
  const read = (n, chain, parent, key) => {
    const own = scopes.get(n), here = own ? [own, ...chain] : chain;
    if (n.type === "Identifier") {
      const property = parent?.type === "MemberExpression" && key === "property" && !parent.computed;
      const named = /^(Property|MethodDefinition|PropertyDefinition)$/.test(parent?.type) && key === "key" && !parent.computed && !parent.shorthand;
      const label = /^(Labeled|Break|Continue)Statement$/.test(parent?.type) || /^(ExportSpecifier|MetaProperty)$/.test(parent?.type);
      if (!property && !named && !label && !here.some((s) => s.has(n.name))) free.add(n.name);
      return;
    }
    for (const [k, v] of kids(n)) for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x.type === "string") read(x, here, n, k);
  };
  read(ast, [], null, null);
  return free;
}

/** The names a part reads (not as a property) that a later part declares at its top level: those keep their names, and
 *  their declarations stay, so the part still finds them once the whole script runs. Read from the tokens, so a name that
 *  is only a local's or an object key's is kept as well, which costs a few bytes and nothing else. */
function namesFrom(part, later) {
  const found = new Set();
  let prev = null;
  for (const t of acorn.tokenizer(part, OPTS("script"))) {
    if (t.type === T.name && prev !== T.dot && prev !== T.questionDot && later.has(t.value)) found.add(t.value);
    prev = t.type;
  }
  return [...found];
}

/** The script minified part by part (see above). A part before the last is minified as a classic script with its
 *  top-level names kept, since a worker may run it as one; the last as the script itself, its top-level names
 *  shortened apart from those the earlier parts define or read from it. Property reads are kept even where nothing uses
 *  their value (`void el.offsetWidth` lays the page out), and so is each `typeof x` test. */
async function minifyScript(code, sourceType) {
  const {minify} = await import("terser");
  const parts = code.split(/^[ \t]*\/\/:part\b.*$/m), kept = [], held = [];
  const tops = parts.map((x, i) => topNames(x, i === parts.length - 1 ? sourceType : "script"));
  let out = "";
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    if (!last) held.push(...namesFrom(part, new Set(tops.slice(i + 1).flat())));
    const r = await minify(part, {
      ecma: 2020, module: last && sourceType === "module", toplevel: last,
      compress: {passes: 2, pure_getters: false, typeofs: false, top_retain: last ? [...held] : null}, mangle: {reserved: [...kept, ...held]}, format: {comments: false},
    });
    const lost = held.filter((x) => tops[i].includes(x) && !topNames(r.code, last ? sourceType : "script").includes(x));
    if (lost.length) throw new Error(`minifying part ${i + 1} of a script lost ${lost.join(", ")}, which an earlier part reads`);
    if (!last) {
      const names = topNames(part, "script"), have = new Set(topNames(r.code, "script")), lost = names.filter((x) => !have.has(x));
      if (lost.length) throw new Error(`minifying part ${i + 1} of a script lost its top-level ${lost.join(", ")}`);
      kept.push(...names);
    }
    out += last || r.code.endsWith(";") ? r.code : r.code + ";";
  }
  const was = freeNames(code, sourceType), extra = [...freeNames(out, sourceType)].filter((x) => !was.has(x));
  if (extra.length) throw new Error(`minifying a script left it reading ${extra.join(", ")}, which nothing declares`);
  const html = (s) => (s.match(/<\/script|<!--/gi) || []).length;
  if (html(out) > html(code)) throw new Error("minifying a script left </script or <!-- in it");
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
  else if (JS.test(type) || /\bdata-strip\b/i.test(attrs)) {
    const sourceType = /module/i.test(type) ? "module" : "script";
    inner = m.minify ? await minifyScript(body, sourceType) : stripScript(body, sourceType);
    scripts++;
  }
  html += whole.slice(0, whole.length - body.length - `</${tag}>`.length) + inner + `</${tag}>`;
  at = start + whole.length;
}
html += stripHtml(src.slice(at));

fs.writeFileSync(path.join(m.dir, m.page), html);
const a = Buffer.byteLength(src), b = Buffer.byteLength(html);
console.log(`${m.name}: ${m.source} ${a} B -> ${m.page} ${b} B (${a - b} B out, ${((1 - b / a) * 100).toFixed(1)}%; ${scripts} script(s)${m.minify ? " minified" : ""}, ${styles} style block(s))`);
