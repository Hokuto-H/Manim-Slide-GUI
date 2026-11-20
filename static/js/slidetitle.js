// スライドの題名を、一覧（リンクの飛ぶ先・見通しなど）に出す文字にする。app/codegen.py の plain_title と同じ考え方。
// 題名の図形があればその文字（$…$ の中の簡単な記号は文字に、ほかの命令・かっこは外す）、無ければ最初のテキスト
// （式・図の番号のテキスト「{番号}」は除く）。参照（{ref:…}）は番号の文字にする。

import { subRefs } from "./refs.js";

const CMDS = { angle: "∠", triangle: "△", alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", pi: "π", lambda: "λ", mu: "μ",
  sigma: "σ", omega: "ω", Delta: "Δ", Omega: "Ω", leq: "≤", geq: "≥", leqq: "≦", geqq: "≧", neq: "≠", times: "×", cdot: "·", pm: "±",
  infty: "∞", in: "∈", to: "→", Rightarrow: "⇒", perp: "⊥", parallel: "∥", circ: "°", det: "det", sin: "sin", cos: "cos", tan: "tan",
  log: "log", lim: "lim" };

export function plainLatex(s) {
  const math = (_m, t) => {
    t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2").replace(/\\mathbb\{([RNZQC])\}/g, (_k, c) => "ℝℕℤℚℂ"["RNZQC".indexOf(c)]);
    t = t.replace(/\\,|\\ /g, " ").replace(/\\([A-Za-z]+) ?/g, (_k, c) => { const v = CMDS[c] ?? ""; return /^[A-Za-z]+$/.test(v) ? `${v} ` : v; });
    return t.replace(/\^°/g, "°").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  };
  return String(s ?? "").replace(/\$([^$]*)\$/g, math).replace(/\\[A-Za-z]+\*?/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** スライドの題名（無ければ ""）。 */
export function slideTitleText(s) {
  const t = (s.elements ?? []).find((e) => e.type === "shape" && e.shape === "title" && !e.placeholder);
  if (t?.latex) return plainLatex(subRefs(t.latex));
  const x = (s.elements ?? []).find((e) => e.type === "text" && !e.numberOf && (e.text ?? (e.runs ?? []).map((r) => r.t).join("")).trim());
  if (x) return subRefs((x.text ?? (x.runs ?? []).map((r) => r.t).join("")).split("\n")[0]).trim();
  return "";
}
