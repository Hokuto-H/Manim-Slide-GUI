// LaTeX（XeLaTeX ＋ zxjatype・IPAex）で組む欄で、表示されずに消えてしまう文字を見つけ、数式の形に直す。
// 題名・LaTeX の文章・箇条書き・定理のブロックは文章（Tex。数式は $…$）、数式の要素は数式（MathTex）として組まれる。
// これらの欄では、Unicode の添字（e₁）・上付き（x⁴）・ギリシャ文字・数学の記号（∠ △ ≦ など）は、
// フォント（Latin Modern）に無いため、何の知らせもなく消える（xelatex の「Missing character」）。
// ふつうのテキスト要素（Pango）では正しく出るので、ここでは調べない。

const SUB = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ";
const SUB_TO = "0123456789+-=()aeoxhklmnpst";
// ¹²³ は Latin-1 にあり表示されるが、ほかの上付きとそろえて直す
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
const SUP_TO = "0123456789+-=()ni";
const SUP_MISSING = new Set([..."⁰⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"]);

// 記号 → 数式のコマンド（文章の中では $…$ で囲む）
const SYM = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", ι: "\\iota", κ: "\\kappa",
  λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau", υ: "\\upsilon", φ: "\\varphi", χ: "\\chi",
  ψ: "\\psi", ω: "\\omega", Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "∠": "\\angle", "△": "\\triangle", "≦": "\\leqq", "≧": "\\geqq", "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≒": "\\fallingdotseq", "≈": "\\approx",
  "≡": "\\equiv", "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow", "⟹": "\\Longrightarrow", "∈": "\\in", "∋": "\\ni", "∉": "\\notin", "⊂": "\\subset", "⊃": "\\supset",
  "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "∫": "\\int", "∑": "\\sum",
  "∏": "\\prod", "∂": "\\partial", "∇": "\\nabla", "⊥": "\\perp", "∥": "\\parallel", "∴": "\\therefore", "∵": "\\because", "′": "'", "″": "''",
  "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "⌒": "\\frown", "∓": "\\mp", "∘": "\\circ",
  "√": "\\surd", "⊕": "\\oplus", "⊗": "\\otimes", "↦": "\\mapsto", "⟨": "\\langle", "⟩": "\\rangle", "∧": "\\land", "∨": "\\lor", "¬": "\\lnot",
};
// 直し方の無い（数式にしても出ない・意味が決まらない）消える文字
const OTHER_MISSING = new Set([..."①②③④⑤⑥⑦⑧⑨⑩ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ"]);
// 後ろの英字を数式に取り込む記号（∠APB → $\angle APB$）
const TAKES_LETTERS = new Set(["∠", "△", "⌒"]);

const isMissing = (c) => SUB.includes(c) || SUP_MISSING.has(c) || c in SYM || OTHER_MISSING.has(c);

/** 文字列の中の、消える文字（重ならない一覧）。 */
export function missingChars(s) {
  return [...new Set([...(s ?? "")].filter(isMissing))];
}

/** 直せない文字（数式にしても出ない）だけ。 */
export function unfixableChars(s) {
  return [...new Set([...(s ?? "")].filter((c) => OTHER_MISSING.has(c)))];
}

/**
 * 消える文字を数式の形に直した文字列。mode: "text"（$…$ の外は文章）・"math"（全体が数式）。
 * 文章: e₁ → $e_{1}$、x⁴ → $x^{4}$、∠APB → $\angle APB$、α → $\alpha$。$…$ の中: e₁ → e_{1}、α → \alpha。
 */
export function fixTexChars(s, mode = "text") {
  const cs = [...(s ?? "")];
  let out = "", inMath = mode === "math", i = 0;
  const cmd = (c, next) => { const t = SYM[c]; return /^\\[A-Za-z]+$/.test(t) && next && /[A-Za-z]/.test(next) ? `${t} ` : t; };
  while (i < cs.length) {
    const c = cs[i];
    if (c === "\\" && i + 1 < cs.length) { out += c + cs[i + 1]; i += 2; continue; }
    if (c === "$" && mode === "text") { inMath = !inMath; out += c; i++; continue; }
    const isSub = SUB.includes(c), isSup = SUP.includes(c);
    if (isSub || isSup) {
      // 続いている添字（上付き）をまとめる
      const kind = isSub ? SUB : SUP, to = isSub ? SUB_TO : SUP_TO;
      let j = i, body = "";
      while (j < cs.length && kind.includes(cs[j])) { body += to[kind.indexOf(cs[j])]; j++; }
      const op = `${isSub ? "_" : "^"}{${body}}`;
      if (inMath) { out += op; i = j; continue; }
      // 文章の中: 前の英数字（ひと続き）を土台にして、まとめて $…$ にする
      const m = /[A-Za-z0-9]+$/.exec(out);
      const base = m ? m[0] : "";
      out = out.slice(0, out.length - base.length) + `$${base}${op}$`;
      i = j;
      continue;
    }
    if (c in SYM) {
      if (inMath) { out += cmd(c, cs[i + 1]); i++; continue; }
      let j = i + 1, tail = "";
      if (TAKES_LETTERS.has(c)) while (j < cs.length && /[A-Za-z]/.test(cs[j])) tail += cs[j++];
      out += `$${tail ? `${SYM[c]} ${tail}` : SYM[c]}$`;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 要素の、LaTeX で組まれる欄の一覧: { label, mode, get(), set(v) }。 */
export function texFieldsOf(el) {
  const out = [];
  if (el.type === "math") out.push({ label: "数式", mode: "math", get: () => el.latex, set: (v) => { el.latex = v; } });
  if (el.type !== "shape") return out;
  if (el.shape === "tex" || el.shape === "title") out.push({ label: el.shape === "title" ? "題名" : "文章", mode: "text", get: () => el.latex, set: (v) => { el.latex = v; } });
  if (el.shape === "bullets") (el.items ?? []).forEach((_, k) => out.push({ label: `項目 ${k + 1}`, mode: "text", get: () => el.items[k], set: (v) => { el.items[k] = v; } }));
  if (el.shape === "theorem") {
    out.push({ label: "本文", mode: "text", get: () => el.body, set: (v) => { el.body = v; } });
    out.push({ label: "名前", mode: "text", get: () => el.title, set: (v) => { el.title = v; } });
  }
  if (el.shape === "angle") out.push({ label: "ラベル", mode: "math", get: () => el.label, set: (v) => { el.label = v; } });
  if (el.shape === "dot") {
    out.push({ label: "ラベル", mode: "math", get: () => el.label, set: (v) => { el.label = v; } });
    out.push({ label: "名前", mode: "math", get: () => el.pname, set: (v) => { el.pname = v; } });
  }
  return out.filter((f) => typeof f.get() === "string");
}

// LaTeX の特別な文字。文章（$…$ の外）では # % & _ ^ が、数式では # % が、そのままだと誤り・消える原因になる
// （# と _ ^ & は描画のときの LaTeX のエラー、% はその後ろが行の終わりまで消える）。直すときは \# のように \ を付ける。
const SPECIAL_TEXT = new Set([..."#%&_^"]);
const SPECIAL_MATH = new Set([..."#%"]);

/** cs[i] から始まる {ref:…}・{num:…}（マスターの {章} などは特別な文字を含まない）の長さ。無ければ 0。 */
function refAt(cs, i) {
  if (cs[i] !== "{") return 0;
  const m = cs.slice(i, i + 200).join("").match(/^\{(?:ref|num):[^{}\s]+\}/);
  return m ? [...m[0]].length : 0;
}

/** 文字列の中の、\ の付いていない特別な文字（重ならない一覧）。mode: "text"・"math"。 */
export function texSpecials(s, mode = "text") {
  const cs = [...(s ?? "")];
  const found = new Set();
  let inMath = mode === "math";
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const ref = refAt(cs, i);
    if (ref) { i += ref - 1; continue; } // {ref:ラベル}・{num:ラベル} の中は、番号に置き換わる
    if (c === "\\") { i++; continue; } // \# などは、そのままでよい
    if (c === "$" && mode === "text") { inMath = !inMath; continue; }
    if ((inMath ? SPECIAL_MATH : SPECIAL_TEXT).has(c)) found.add(c);
  }
  return [...found];
}

/** 特別な文字に \ を付けた文字列（文章の _ ^ は \_ ・ \^{} にする）。 */
export function escapeTexSpecials(s, mode = "text") {
  const cs = [...(s ?? "")];
  let out = "", inMath = mode === "math";
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const ref = refAt(cs, i);
    if (ref) { out += cs.slice(i, i + ref).join(""); i += ref - 1; continue; }
    if (c === "\\") { out += c + (cs[i + 1] ?? ""); i++; continue; }
    if (c === "$" && mode === "text") { inMath = !inMath; out += c; continue; }
    if ((inMath ? SPECIAL_MATH : SPECIAL_TEXT).has(c)) out += c === "^" ? "\\^{}" : `\\${c}`;
    else out += c;
  }
  return out;
}
