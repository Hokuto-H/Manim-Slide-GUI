// 数式の一部に色を付ける（app/texcolor.py と同じ動き。仮表示の MathJax に、書き出しと同じ書き換えをする）。
// el.colorMap = [{ tex, color }] の tex を LaTeX から探し、見つかった所をすべて {\color[HTML]{RRGGBB} …} で囲む。

const SKIP_ARGS = {
  begin: 1, end: 1, color: 1, textcolor: 1, colorbox: 1, fcolorbox: 2, pagecolor: 1, definecolor: 3,
  hspace: 1, vspace: 1, label: 1, ref: 1, eqref: 1, rule: 2, raisebox: 1, includegraphics: 1,
  setlength: 2, kern: 0, hskip: 0, vskip: 0, mkern: 0, mskip: 0, enclose: 1, cssId: 1, class: 1,
  style: 1, href: 1, url: 1, phantom: 0, operatorname: 0,
};
const DELIM_CMDS = new Set(["left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr",
  "Biggl", "Biggr", "bigm", "Bigm", "biggm", "Biggm"]);
const ARRAY_ENVS = new Set(["array", "tabular", "alignat", "alignat*", "subarray", "alignedat"]);
const TOKEN = /\\[A-Za-z]+\*?|\\[\s\S]|%[^\n]*|\s+|[\s\S]/gu;

export const tokenize = (s) => String(s ?? "").match(TOKEN) ?? [];
const isSpace = (t) => /^\s+$/.test(t);

function groupEnd(toks, i) {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j] === "{") depth++;
    else if (toks[j] === "}") { depth--; if (depth === 0) return j; }
  }
  return toks.length - 1;
}

function locked(toks) {
  const n = toks.length, lock = new Array(n).fill(false);
  const skipSpace = (j) => { while (j < n && isSpace(toks[j])) j++; return j; };
  const lockOpt = (j) => { let k = j; while (k < n && toks[k] !== "]") k++; for (let m = j; m <= Math.min(k, n - 1); m++) lock[m] = true; return k; };
  toks.forEach((t, i) => {
    if (t.startsWith("%")) { lock[i] = true; return; }
    if (t === "\\\\") { const j = skipSpace(i + 1); if (j < n && toks[j] === "[") lockOpt(j); return; }
    if (!t.startsWith("\\") || t.length < 2) return;
    const name = t.slice(1);
    if (DELIM_CMDS.has(name)) {
      const j = skipSpace(i + 1);
      if (j < n) { lock[j] = true; if (toks[j] === "\\" && j + 1 < n) lock[j + 1] = true; }
      return;
    }
    if (!(name in SKIP_ARGS)) return;
    const nargs = SKIP_ARGS[name];
    let j = skipSpace(i + 1);
    if (j < n && toks[j] === "[") j = skipSpace(lockOpt(j) + 1);
    if (nargs === 0) {
      if (j < n && toks[j] === "{") { const e = groupEnd(toks, j); for (let m = j; m <= e; m++) lock[m] = true; }
      else { let k = j; while (k < n && !isSpace(toks[k]) && !toks[k].startsWith("\\") && !"{}^_&".includes(toks[k])) { lock[k] = true; k++; } }
      return;
    }
    let env = null;
    for (let a = 0; a < nargs; a++) {
      j = skipSpace(j);
      if (j >= n) break;
      if (toks[j] === "{") {
        const e = groupEnd(toks, j);
        if (name === "begin" && a === 0) env = toks.slice(j + 1, e).join("").trim();
        for (let m = j; m <= e; m++) lock[m] = true;
        j = e + 1;
      } else { lock[j] = true; j++; }
    }
    if (name === "begin" && ARRAY_ENVS.has(env)) {
      j = skipSpace(j);
      if (j < n && toks[j] === "{") { const e = groupEnd(toks, j); for (let m = j; m <= e; m++) lock[m] = true; }
    }
  });
  return lock;
}

/** 探す文字列を比べる単位に分ける。使えない文字列は null。 */
export function ruleTokens(tex) {
  const toks = tokenize(tex).filter((t) => !isSpace(t));
  if (!toks.length) return null;
  let depth = 0;
  for (const t of toks) {
    if (t === "&" || t === "\\\\" || t === "#" || t.startsWith("%")) return null;
    if (t === "{") depth++;
    else if (t === "}") { depth--; if (depth < 0) return null; }
  }
  const last = toks.at(-1);
  if (depth !== 0 || ["^", "_"].includes(toks[0]) || ["^", "_"].includes(last) || (last.startsWith("\\") && DELIM_CMDS.has(last.slice(1)))) return null;
  return toks;
}

const hex = (c) => { const m = /^#?([0-9A-Fa-f]{6})$/.exec(String(c ?? "").trim()); return m ? m[1].toUpperCase() : null; };

/** { latex: 色を付けた LaTeX, counts: 規則ごとの、色を付けた数 } */
export function colorize(latex, rules) {
  rules = rules ?? [];
  const counts = rules.map(() => 0);
  if (!rules.length || !latex) return { latex, counts };
  const toks = tokenize(latex), lock = locked(toks);
  const idx = []; toks.forEach((t, i) => { if (!isSpace(t)) idx.push(i); });
  const vals = idx.map((i) => toks[i]);
  const order = [];
  rules.forEach((r, k) => { const rt = ruleTokens(r.tex ?? ""), col = hex(r.color); if (rt && col) order.push([k, rt, col]); });
  order.sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const taken = new Array(toks.length).fill(false);
  const starts = new Map();
  for (const [k, rt, col] of order) {
    const m = rt.length;
    let p = 0;
    while (p + m <= vals.length) {
      let eq = true;
      for (let q = 0; q < m; q++) if (vals[p + q] !== rt[q]) { eq = false; break; }
      if (!eq) { p++; continue; }
      const s = idx[p], e = idx[p + m - 1];
      let ok = true;
      for (let q = s; q <= e; q++) if (lock[q] || taken[q]) { ok = false; break; }
      if (ok && m > 1 && p > 0) {
        const prev = vals[p - 1];
        const whole = rt[0] === "{" && groupEnd(toks, s) === e;
        if (!whole && (prev === "^" || prev === "_" || (prev.startsWith("\\") && /^[A-Za-z]+$/.test(prev.slice(1)) && idx[p - 1] === s - 1))) ok = false;
      }
      if (ok) {
        for (let q = s; q <= e; q++) taken[q] = true;
        starts.set(s, [e, col]);
        counts[k]++;
        p += m;
      } else p++;
    }
  }
  if (!starts.size) return { latex, counts };
  const out = [];
  for (let i = 0; i < toks.length;) {
    if (starts.has(i)) {
      const [e, col] = starts.get(i);
      out.push(`{\\color[HTML]{${col}}${toks.slice(i, e + 1).join("")}}`);
      i = e + 1;
    } else out.push(toks[i++]);
  }
  return { latex: out.join(""), counts };
}
