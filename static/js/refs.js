// 定理・数式・図の番号と、ラベルへの参照（{ref:名前}・{num:名前}）。数え方は app/refs.py と同じ。
// キャンバスの仮表示では、参照を番号の文字に置き換えて見せる（押すと飛ぶ範囲は、書き出しのときに作る）。

import { pagePlan, store } from "./store.js";

export const KINDS = ["definition", "theorem", "lemma", "corollary", "proposition", "example", "remark", "proof"];
export const DEFAULT_THEOREMS = {
  definition: { label: "定義", color: "#2E8B57" },
  theorem: { label: "定理", color: "#2E6FD8" },
  lemma: { label: "補題", color: "#4F5FC4" },
  corollary: { label: "系", color: "#7A4FC4" },
  proposition: { label: "命題", color: "#1F8A9E" },
  example: { label: "例", color: "#D9822B" },
  remark: { label: "注意", color: "#7A7A7A" },
  proof: { label: "証明", color: "#555555" },
};
export const REF_RE = /\{(ref|num):([^{}\s]+)\}/g;
export const SELF_TOKEN = "{番号}";

export function theoremStyles(project = store.project) {
  const v = project?.settings?.theorems ?? {};
  return Object.fromEntries(KINDS.map((k) => {
    const x = v[k] ?? {};
    const label = String(x.label ?? "").trim() || DEFAULT_THEOREMS[k].label;
    const color = /^#[0-9A-Fa-f]{6}$/.test(x.color ?? "") ? x.color.toUpperCase() : DEFAULT_THEOREMS[k].color;
    return [k, { label, color }];
  }));
}

const isTheorem = (e) => e?.type === "shape" && e.shape === "theorem";
const numberedTheorem = (e) => isTheorem(e) && e.kind !== "proof" && e.numbered !== false;

function order(project) {
  const sl = project.slides;
  return [...sl.keys()].filter((i) => !sl[i].appendix).concat([...sl.keys()].filter((i) => sl[i].appendix));
}

function chapters(project) {
  const has = project.slides.some((s) => s.section && !s.appendix);
  const byChapter = (project.settings?.refNumbering ?? "chapter") === "chapter";
  let idx = 0;
  return project.slides.map((s) => {
    if (s.appendix) return "A";
    if (s.section) idx += 1;
    return has && idx > 0 && byChapter ? String(idx) : "";
  });
}

let memo = { key: null, plan: null };

/** {numbers: {要素の id: {num, text}}, labels: {ラベル: {num, text, slideId, elementId, slideIndex}}}。 */
export function refPlan(project = store.project) {
  if (!project) return { numbers: {}, labels: {} };
  // 同じ中身なら作り直さない（要素の位置・ラベル・番号の付け方が変わったときだけ）
  const key = JSON.stringify([project.settings?.theorems, project.settings?.refNumbering, project.settings?.pageNumbers,
    project.slides.map((s) => [s.id, s.section, s.appendix, s.skip, s.pageNumber, (s.elements ?? []).filter((e) => e.refLabel || isTheorem(e) || e.numberOf)
      .map((e) => [e.id, e.refLabel, e.kind, e.numbered, e.numberOf, e.numberKind, Math.round(e.x), Math.round(e.y), e.type])])]);
  if (memo.key === key && memo.project === project) return memo.plan;
  const styles = theoremStyles(project);
  const chap = chapters(project);
  const counters = new Map();
  const numbers = {};
  const targetNum = {};
  const nxt = (series, ch) => {
    const k = (counters.get(`${series}|${ch}`) ?? 0) + 1;
    counters.set(`${series}|${ch}`, k);
    return ch ? `${ch}.${k}` : String(k);
  };
  const pos = (e) => [Number(e.y) || 0, Number(e.x) || 0];
  for (const si of order(project)) {
    const sl = project.slides[si];
    const byId = new Map((sl.elements ?? []).map((e) => [e.id, e]));
    const items = [];
    for (const e of sl.elements ?? []) {
      if (numberedTheorem(e)) items.push([pos(e), e, "thm"]);
      else if (e.type === "text" && byId.has(e.numberOf) && ["eq", "fig"].includes(e.numberKind)) items.push([pos(byId.get(e.numberOf)), e, e.numberKind]);
    }
    items.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
    for (const [, e, series] of items) {
      const n = nxt(series, chap[si]);
      const text = series === "thm" ? `${styles[e.kind ?? "theorem"].label} ${n}` : series === "eq" ? `(${n})` : `図 ${n}`;
      numbers[e.id] = { num: n, text };
      if (series !== "thm" && !targetNum[e.numberOf]) targetNum[e.numberOf] = { num: n, text };
    }
  }
  const pp = pagePlan(project, project.slides.map((_s, i) => i));
  const labels = {};
  for (const si of order(project)) {
    const sl = project.slides[si];
    for (const e of sl.elements ?? []) {
      const lab = String(e.refLabel ?? "").trim();
      if (!lab || labels[lab]) continue;
      let got = numberedTheorem(e) ? numbers[e.id] : targetNum[e.id];
      if (!got) { const pg = String(pp[si]?.number ?? si + 1); got = { num: pg, text: `p.${pg}` }; }
      labels[lab] = { ...got, slideId: sl.id, elementId: e.id, slideIndex: si };
    }
  }
  memo = { key, plan: { numbers, labels, styles }, project };
  return memo.plan;
}

export const hasRefs = (s) => /\{(ref|num):[^{}\s]+\}/.test(s ?? "");

/** {ref:…}・{num:…} を番号の文字に（latex のときは \text{…} で囲む）。 */
export function subRefs(s, plan = refPlan(), latex = false) {
  return String(s ?? "").replace(REF_RE, (_m, k, name) => {
    const info = plan.labels[name];
    const t = !info ? "??" : k === "ref" ? info.text : info.num;
    return latex ? `\\text{${t}}` : t;
  });
}

/** 仮表示用に、参照・番号を置き換えた要素の写し（変わらなければ、そのまま el）。 */
export function resolveForPreview(el) {
  if (!store.project || !el) return el;
  const plan = refPlan();
  if (el.type === "text") {
    const self = el.numberOf ? plan.numbers[el.id]?.text : null;
    const runs = el.runs ?? [{ t: el.text ?? "" }];
    if (!self && !runs.some((r) => hasRefs(r.t))) return el;
    const nr = runs.map((r) => ({ ...r, t: subRefs(self ? String(r.t ?? "").split(SELF_TOKEN).join(self) : r.t, plan) }));
    return { ...el, runs: nr, text: nr.map((r) => r.t).join("") };
  }
  if (el.type === "math") return hasRefs(el.latex) ? { ...el, latex: subRefs(el.latex, plan, true) } : el;
  if (el.type !== "shape") return el;
  if (["tex", "title"].includes(el.shape)) return hasRefs(el.latex) ? { ...el, latex: subRefs(el.latex, plan, true) } : el;
  if (el.shape === "bullets") return (el.items ?? []).some(hasRefs) ? { ...el, items: el.items.map((x) => subRefs(x, plan, true)) } : el;
  if (isTheorem(el)) {
    const out = { ...el, title: subRefs(el.title, plan, true), body: subRefs(el.body, plan, true), _number: plan.numbers[el.id]?.num ?? null };
    if (el.kind === "proof" && el.proofOf) out._proofOf = plan.labels[el.proofOf]?.text ?? "??";
    return out;
  }
  return el;
}

/** ラベルの一覧（参照を入れる画面用）: [{label, text, slideIndex, elementId}]（スライドの順）。 */
export function labelList() {
  const plan = refPlan();
  return Object.entries(plan.labels).map(([label, v]) => ({ label, ...v })).sort((a, b) => a.slideIndex - b.slideIndex);
}

/** 点検: 見つからないラベル・同じラベルが 2 か所以上。 */
export function refProblems(project = store.project) {
  const plan = refPlan(project);
  const seen = new Map();
  const out = [];
  project.slides.forEach((sl, si) => {
    for (const e of sl.elements ?? []) {
      const lab = String(e.refLabel ?? "").trim();
      if (lab) {
        seen.set(lab, (seen.get(lab) ?? 0) + 1);
        if (seen.get(lab) === 2) out.push({ kind: "dup", label: lab, slideIndex: si, elementId: e.id });
      }
      let texts = [];
      if (e.type === "text") texts = (e.runs ?? []).map((r) => r.t);
      else if (e.type === "math" || ["tex", "title"].includes(e.shape)) texts = [e.latex];
      else if (e.shape === "bullets") texts = e.items ?? [];
      else if (isTheorem(e)) texts = [e.title, e.body, e.proofOf ? `{ref:${e.proofOf}}` : ""];
      for (const t of texts) for (const m of String(t ?? "").matchAll(REF_RE)) {
        if (!plan.labels[m[2]]) out.push({ kind: "missing", label: m[2], slideIndex: si, elementId: e.id });
      }
    }
  });
  return out;
}

/** 番号・ラベルが変わったら、今のスライドで番号を使っている要素を描き直す。 */
export function setupRefWatch(on, refresh) {
  let last = "";
  let timer = null;
  const uses = (e) => e.numberOf || isTheorem(e) || (e.type === "text" ? (e.runs ?? []).some((r) => hasRefs(r.t))
    : e.type === "math" || ["tex", "title"].includes(e.shape) ? hasRefs(e.latex) : e.shape === "bullets" ? (e.items ?? []).some(hasRefs) : false);
  const check = () => {
    if (!store.project) return;
    const p = refPlan();
    const sig = JSON.stringify([p.numbers, p.labels]);
    if (sig === last) return;
    const first = !last;
    last = sig;
    if (first) return;
    const sl = store.project.slides[store.slideIndex];
    for (const e of sl?.elements ?? []) if (uses(e)) refresh(e);
  };
  on("dirty", () => { clearTimeout(timer); timer = setTimeout(check, 400); });
  on("project-loaded", () => { last = ""; check(); });
}
