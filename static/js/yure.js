// 表記ゆれ: プロジェクトの文字の中で、同じものの書き方が混ざっている所を探し、「こちらにそろえる」で一度にそろえる。
// ・全角と半角（英数字・かっこ・記号）・句読点（、。と，．）・同じ語の書き方（カタカナの伸ばし棒・送り仮名・漢字とかな）
// ・見るのは文字の部分だけ: テキスト・LaTeX の文章（$…$ の数式は見ない）・箇条書き・表やラベルの文字・発表者ノート。数式の要素・コードは見ない
// ・そろえるのは 1 回の「元に戻す」で戻せる。「無視する」はプロジェクトに覚える（点検の無視と同じ）

import { searchFields } from "./search.js";
import { store } from "./store.js";

// 同じ語の書き方（よくある組）
const WORDS = [
  ["行う", "行なう"], ["行います", "行ないます"], ["行った", "行なった"], ["出来る", "できる"], ["出来ます", "できます"], ["出来ない", "できない"],
  ["下さい", "ください"], ["予め", "あらかじめ"], ["及び", "および"], ["又は", "または"], ["並びに", "ならびに"], ["全て", "すべて"],
  ["既に", "すでに"], ["殆ど", "ほとんど"], ["様々", "さまざま"], ["色々", "いろいろ"], ["分かる", "わかる"], ["分かります", "わかります"],
  ["例えば", "たとえば"], ["更に", "さらに"], ["但し", "ただし"], ["一旦", "いったん"], ["沢山", "たくさん"], ["丁度", "ちょうど"],
  ["お勧め", "おすすめ", "お薦め"], ["取り扱い", "取扱い"], ["申し込み", "申込み"], ["問い合わせ", "問合せ"], ["受け付け", "受付け"],
  ["読み込み", "読込み"], ["書き込み", "書込み"], ["組み合わせ", "組合せ", "組み合せ"], ["話し合い", "話合い"], ["引き数", "引数"],
  ["見つける", "見付ける"], ["付ける", "つける"], ["共に", "ともに"], ["我々", "われわれ"], ["何故", "なぜ"], ["是非", "ぜひ"],
];
// 全角・半角の記号の組（[全角, 半角, 名前]）。LaTeX の文章では % ~ & などは特別な意味があるので扱わない
const SYMBOLS = [["（", "(", "かっこ"], ["）", ")", "かっこ"], ["：", ":", "コロン"], ["！", "!", "感嘆符"], ["？", "?", "疑問符"], ["％", "%", "パーセント"], ["／", "/", "スラッシュ"]];
const LATEX_UNSAFE = new Set(["%"]);

const z2h = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const h2z = (s) => s.replace(/[0-9A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

/** 文字の欄: {text, latex, get, set, where, slideIndex}。マスターの文字も含める。 */
function textFields() {
  const out = [];
  for (const f of searchFields({ text: true, math: true, notes: true, code: false }, null)) {
    const el = f.elementId ? store.project.slides[f.slideIndex]?.elements.find((e) => e.id === f.elementId) : null;
    if (f.kind === "math" && el?.type === "math") continue; // 数式の要素は見ない
    if (f.rich && el) {
      for (const r of el.runs) out.push({ latex: false, slideIndex: f.slideIndex, elementId: el.id, get: () => r.t ?? "", set: (v) => { r.t = v; el.text = el.runs.map((x) => x.t).join(""); } });
      continue;
    }
    out.push({ latex: f.kind === "math", slideIndex: f.slideIndex, elementId: f.elementId, get: f.get, set: f.set });
  }
  for (const m of store.project.masters ?? []) {
    for (const el of m.elements) {
      if (el.type === "text") for (const r of el.runs ?? []) out.push({ latex: false, master: m.id, get: () => r.t ?? "", set: (v) => { r.t = v; el.text = el.runs.map((x) => x.t).join(""); } });
      else if (el.type === "shape" && ["tex", "title"].includes(el.shape)) out.push({ latex: true, master: m.id, get: () => el.latex ?? "", set: (v) => { el.latex = v; } });
    }
  }
  return out;
}

/** LaTeX の文章では、$…$・\( \)・\[ \] の数式と、\命令 の名前を変えない。fn は変えてよい部分の文字を変える。 */
function mapText(s, latex, fn) {
  if (!latex) return fn(s);
  return s.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\[A-Za-z]+)/).map((p, i) => (i % 2 ? p : fn(p))).join("");
}
function eachText(s, latex, fn) { mapText(s, latex, (p) => { fn(p); return p; }); }

const KATA = /[ァ-ヶー]{2,}/g;

/** ゆれの一覧: [{key, label, forms: [{label, count}], to: (form 番号) => (文字, latex) => 変えた文字}] */
export function findYure() {
  const fields = textFields();
  const groups = [];
  const count = (re, latexOk = true) => { let n = 0; for (const f of fields) if (latexOk || !f.latex) eachText(f.get(), f.latex, (p) => { n += (p.match(re) ?? []).length; }); return n; };
  // 英数字
  const zen = count(/[０-９Ａ-Ｚａ-ｚ]/g), han = count(/[0-9A-Za-z]/g);
  if (zen && han) groups.push({ key: "yure:alnum", label: "英数字の全角・半角", forms: [{ label: "全角（ＡＢＣ１２３）", count: zen }, { label: "半角（ABC123）", count: han }],
    to: (k) => (s, latex) => mapText(s, latex, k === 0 ? h2z : z2h), note: "半角の数字・英字が多いときは、半角にそろえるのがふつうです。" });
  // 記号
  const symNames = [...new Set(SYMBOLS.map((x) => x[2]))];
  for (const nm of symNames) {
    const pairs = SYMBOLS.filter((x) => x[2] === nm);
    const unsafe = pairs.some(([, h]) => LATEX_UNSAFE.has(h));
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const z = count(new RegExp(pairs.map(([a]) => esc(a)).join("|"), "g"), !unsafe), h = count(new RegExp(pairs.map(([, b]) => esc(b)).join("|"), "g"), !unsafe);
    if (z && h) groups.push({ key: `yure:sym:${nm}`, label: `${nm}の全角・半角`, forms: [{ label: `全角（${pairs.map((p) => p[0]).join("")}）`, count: z }, { label: `半角（${pairs.map((p) => p[1]).join("")}）`, count: h }],
      to: (k) => (s, latex) => ((latex && unsafe) ? s : mapText(s, latex, (p) => pairs.reduce((acc, [a, b]) => acc.split(k === 0 ? b : a).join(k === 0 ? a : b), p))) });
  }
  // 句読点
  const ten = count(/[、。]/g), comma = count(/[，．]/g);
  if (ten && comma) groups.push({ key: "yure:punct", label: "句読点", forms: [{ label: "、。", count: ten }, { label: "，．", count: comma }],
    to: (k) => (s, latex) => mapText(s, latex, (p) => (k === 0 ? p.replace(/，/g, "、").replace(/．/g, "。") : p.replace(/、/g, "，").replace(/。/g, "．"))) });
  // カタカナの伸ばし棒（「サーバー」と「サーバ」）
  const kata = new Map();
  for (const f of fields) eachText(f.get(), f.latex, (p) => { for (const w of p.match(KATA) ?? []) kata.set(w, (kata.get(w) ?? 0) + 1); });
  for (const [w, n] of kata) {
    if (!w.endsWith("ー") || w.length < 4) continue;
    const short = w.slice(0, -1);
    if (!kata.has(short)) continue;
    const exact = (target) => (s, latex) => mapText(s, latex, (p) => p.replace(KATA, (x) => (x === w || x === short ? target : x)));
    groups.push({ key: `yure:kata:${short}`, label: `「${w}」と「${short}」`, forms: [{ label: w, count: n }, { label: short, count: kata.get(short) }], to: (k) => exact(k === 0 ? w : short) });
  }
  // 同じ語の書き方
  for (const forms of WORDS) {
    const counts = forms.map((w) => { let c = 0; for (const f of fields) eachText(f.get(), f.latex, (p) => { c += p.split(w).length - 1; }); return c; });
    if (counts.filter((c) => c > 0).length < 2) continue;
    groups.push({ key: `yure:word:${forms[0]}`, label: `「${forms.join("」「")}」`, forms: forms.map((w, i) => ({ label: w, count: counts[i] })).filter((f) => f.count),
      to: (k, fs) => (s, latex) => mapText(s, latex, (p) => fs.reduce((acc, f, i) => (i === k ? acc : acc.split(f.label).join(fs[k].label)), p)) });
  }
  return groups;
}

/** ゆれ g を、form 番号 k の書き方にそろえる。変えた欄の数を返す。 */
export function unify(g, k) {
  const fn = g.to(k, g.forms);
  let n = 0;
  const slides = new Set();
  for (const f of textFields()) {
    const s = f.get();
    const t = fn(s, f.latex);
    if (t !== s) { f.set(t); n += 1; if (f.slideIndex != null) slides.add(f.slideIndex); }
  }
  return n;
}
