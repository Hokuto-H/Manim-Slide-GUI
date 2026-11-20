// 数式の入力補助: LaTeX の入力欄（数式・LaTeX の文章・箇条書き・題名）に、分数・積分・行列・ギリシャ文字などをボタンで入れる。
// ・入力欄を選ぶと、その右上に「Σ 記号」が出る。押すと、欄の下に表が開く（もう一度押すか Esc で閉じる）
// ・入れる所は文字カーソルの位置。文字を選んでいれば、その文字を最初の空欄（▮）に入れる。入れたあとは、次に書く空欄へカーソルを置く
// ・LaTeX の文章の欄では、$…$ の外なら $ で囲んで入れる
// ・最近使ったものを、いちばん上に出す（このブラウザに覚える）

import { labelList } from "./refs.js";
import { renderMath } from "./mathjax.js";

const SLOT = "▮"; // 空欄（入れたあと、最初の ▮ にカーソルを置き、▮ は消す）

const GROUPS = [
  ["構造", [
    ["\\frac{▮}{▮}", "\\frac{a}{b}", "分数"], ["\\sqrt{▮}", "\\sqrt{x}", "根号"], ["\\sqrt[▮]{▮}", "\\sqrt[n]{x}", "n 乗根"],
    ["^{▮}", "x^{n}", "上付き"], ["_{▮}", "x_{i}", "下付き"], ["▮^{▮}_{▮}", "x^{a}_{b}", "上下付き"],
    ["\\int_{▮}^{▮} ▮ \\, dx", "\\int_a^b f\\,dx", "積分"], ["\\iint_{▮} ▮ \\, dS", "\\iint_D f\\,dS", "2 重積分"], ["\\oint_{▮} ▮", "\\oint_C", "周回積分"],
    ["\\sum_{▮}^{▮} ▮", "\\sum_{k=1}^{n}", "総和"], ["\\prod_{▮}^{▮} ▮", "\\prod_{k=1}^{n}", "総乗"], ["\\lim_{▮ \\to ▮} ▮", "\\lim_{x\\to a}", "極限"],
    ["\\frac{d ▮}{d ▮}", "\\frac{dy}{dx}", "微分"], ["\\frac{\\partial ▮}{\\partial ▮}", "\\frac{\\partial f}{\\partial x}", "偏微分"],
    ["\\left( ▮ \\right)", "\\left(\\,\\right)", "丸かっこ（大きさ自動）"], ["\\left[ ▮ \\right]", "\\left[\\,\\right]", "角かっこ"], ["\\left\\{ ▮ \\right\\}", "\\left\\{\\,\\right\\}", "波かっこ"],
    ["\\left| ▮ \\right|", "\\left|x\\right|", "絶対値"], ["\\left\\| ▮ \\right\\|", "\\|\\vec v\\|", "ノルム"],
    ["\\begin{pmatrix} ▮ & ▮ \\\\ ▮ & ▮ \\end{pmatrix}", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "行列（2×2）"],
    ["\\begin{pmatrix} ▮ & ▮ & ▮ \\\\ ▮ & ▮ & ▮ \\\\ ▮ & ▮ & ▮ \\end{pmatrix}", "\\begin{pmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{pmatrix}", "行列（3×3）"],
    ["\\begin{vmatrix} ▮ & ▮ \\\\ ▮ & ▮ \\end{vmatrix}", "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}", "行列式"],
    ["\\begin{pmatrix} ▮ \\\\ ▮ \\end{pmatrix}", "\\begin{pmatrix}x\\\\y\\end{pmatrix}", "縦ベクトル"],
    ["\\begin{cases} ▮ & (▮) \\\\ ▮ & (▮) \\end{cases}", "\\begin{cases}a&(x\\ge0)\\\\b&(x<0)\\end{cases}", "場合分け"],
    ["\\binom{▮}{▮}", "\\binom{n}{k}", "二項係数"], ["{}_{▮}\\mathrm{C}_{▮}", "{}_n\\mathrm{C}_k", "組合せ（ₙCₖ）"], ["{}_{▮}\\mathrm{P}_{▮}", "{}_n\\mathrm{P}_k", "順列（ₙPₖ）"],
    ["\\overset{▮}{▮}", "\\overset{!}{=}", "上に文字"], ["\\underbrace{▮}_{▮}", "\\underbrace{a+b}_{c}", "下に中かっこ"], ["\\overbrace{▮}^{▮}", "\\overbrace{a+b}^{c}", "上に中かっこ"],
    ["\\vec{▮}", "\\vec{a}", "ベクトル（矢印）"], ["\\boldsymbol{▮}", "\\boldsymbol{a}", "太字"], ["\\overrightarrow{▮}", "\\overrightarrow{AB}", "有向線分"],
    ["\\hat{▮}", "\\hat{x}", "ハット"], ["\\bar{▮}", "\\bar{x}", "バー"], ["\\overline{▮}", "\\overline{AB}", "上線"], ["\\dot{▮}", "\\dot{x}", "ドット"], ["\\ddot{▮}", "\\ddot{x}", "2 ドット"],
    ["\\text{▮}", "\\text{文字}", "文字（日本語）"], ["\\mathrm{▮}", "\\mathrm{d}", "立体"], ["\\displaystyle ", "\\displaystyle\\sum", "大きく出す"],
  ]],
  ["ギリシャ文字", [..."alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega".split(" ").map((g) => [`\\${g}`, `\\${g}`, g])]],
  ["演算・関係", [
    ["\\pm", "\\pm"], ["\\mp", "\\mp"], ["\\times", "\\times"], ["\\div", "\\div"], ["\\cdot", "\\cdot"], ["\\cdots", "\\cdots"], ["\\ldots", "\\ldots"], ["\\vdots", "\\vdots"], ["\\ddots", "\\ddots"],
    ["\\neq", "\\neq"], ["\\leq", "\\leq"], ["\\geq", "\\geq"], ["\\leqq", "\\leqq"], ["\\geqq", "\\geqq"], ["\\ll", "\\ll"], ["\\gg", "\\gg"],
    ["\\approx", "\\approx"], ["\\simeq", "\\simeq"], ["\\sim", "\\sim"], ["\\equiv", "\\equiv"], ["\\cong", "\\cong"], ["\\propto", "\\propto"],
    ["\\infty", "\\infty"], ["\\partial", "\\partial"], ["\\nabla", "\\nabla"], ["^{\\circ}", "30^{\\circ}", "度"], ["\\prime", "f^{\\prime}"], ["\\perp", "\\perp"], ["\\parallel", "\\parallel"],
    ["\\angle", "\\angle"], ["\\triangle", "\\triangle"], ["\\therefore", "\\therefore"], ["\\because", "\\because"], ["\\circ", "f\\circ g"], ["\\otimes", "\\otimes"], ["\\oplus", "\\oplus"],
  ]],
  ["矢印", [
    ["\\to", "\\to"], ["\\leftarrow", "\\leftarrow"], ["\\leftrightarrow", "\\leftrightarrow"], ["\\Rightarrow", "\\Rightarrow"], ["\\Leftarrow", "\\Leftarrow"], ["\\Leftrightarrow", "\\Leftrightarrow"],
    ["\\mapsto", "\\mapsto"], ["\\uparrow", "\\uparrow"], ["\\downarrow", "\\downarrow"], ["\\nearrow", "\\nearrow"], ["\\searrow", "\\searrow"],
    ["\\xrightarrow{▮}", "\\xrightarrow{f}", "上に文字の矢印"], ["\\longrightarrow", "\\longrightarrow"], ["\\Longleftrightarrow", "\\Longleftrightarrow"],
  ]],
  ["集合・論理", [
    ["\\in", "\\in"], ["\\notin", "\\notin"], ["\\ni", "\\ni"], ["\\subset", "\\subset"], ["\\subseteq", "\\subseteq"], ["\\supset", "\\supset"], ["\\supseteq", "\\supseteq"],
    ["\\cup", "\\cup"], ["\\cap", "\\cap"], ["\\bigcup_{▮}", "\\bigcup_i", "和集合（大）"], ["\\bigcap_{▮}", "\\bigcap_i", "共通部分（大）"], ["\\setminus", "\\setminus"], ["\\emptyset", "\\emptyset"],
    ["\\forall", "\\forall"], ["\\exists", "\\exists"], ["\\neg", "\\neg"], ["\\land", "\\land"], ["\\lor", "\\lor"],
    ["\\mathbb{N}", "\\mathbb{N}"], ["\\mathbb{Z}", "\\mathbb{Z}"], ["\\mathbb{Q}", "\\mathbb{Q}"], ["\\mathbb{R}", "\\mathbb{R}"], ["\\mathbb{C}", "\\mathbb{C}"],
    ["\\{ ▮ \\mid ▮ \\}", "\\{x\\mid P\\}", "条件で書く集合"], ["\\overline{▮}", "\\overline{A}", "補集合"],
  ]],
  ["関数", [..."sin cos tan log ln exp max min sup inf det gcd arcsin arccos arctan sinh cosh".split(" ").map((f) => [`\\${f}`, `\\${f}`, f]),
    ["\\log_{▮}", "\\log_2", "底つきの log"], ["\\sin^{2}", "\\sin^2"], ["f(x)", "f(x)"], ["f^{-1}", "f^{-1}"], ["\\operatorname{▮}", "\\operatorname{rank}", "名前の関数"]]],
];

let field = null; // 今の入力欄
let btn = null, panel = null;
let tab = 0;
const RECENT_KEY = "texRecent";

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function pushRecent(item) {
  try {
    const r = recent().filter((x) => x[0] !== item[0]);
    r.unshift(item);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 14)));
  } catch { /* 覚えられなくてもよい */ }
}

const isLatexField = (el) => el instanceof HTMLTextAreaElement && (el.classList.contains("latex") || el.classList.contains("latex-text"));
const isTextField = (el) => el.classList.contains("latex-text"); // LaTeX の文章（数式は $ で囲む）

/** カーソルの位置が $…$ の中か（LaTeX の文章の欄で）。 */
function inMath(s, pos) {
  let n = 0;
  for (let i = 0; i < pos; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === "$") n++;
  }
  return n % 2 === 1;
}

/** 入れる。 */
function insert(item) {
  if (!field) return;
  const ta = field;
  const s = ta.value, a = ta.selectionStart ?? s.length, b = ta.selectionEnd ?? a;
  const sel = s.slice(a, b);
  let ins = item[0];
  // 選んでいた文字は、最初の空欄に入れる
  if (sel && ins.includes(SLOT)) ins = ins.replace(SLOT, sel);
  else if (sel && !ins.includes(SLOT)) ins = ins + sel;
  if (isTextField(ta) && !inMath(s, a) && item[3] !== "ref") ins = `$${ins}$`; // 参照は $ の外でも中でも、そのまま
  // \命令 のすぐ後ろに英字が続くと、つながって別の命令になるので空白を入れる
  if (/^\\[A-Za-z]+$/.test(ins) && /^[A-Za-z]/.test(s.slice(b))) ins += " ";
  const out = s.slice(0, a) + ins + s.slice(b);
  const first = out.indexOf(SLOT, a);
  const cleaned = out.replace(new RegExp(SLOT, "g"), "");
  ta.value = cleaned;
  const caret = first >= 0 && first < a + ins.length ? first : a + ins.replace(new RegExp(SLOT, "g"), "").length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.dispatchEvent(new Event("change", { bubbles: true })); // 欄から外れたときに反映する欄（LaTeX の文章）にも
  if (item[3] !== "ref") pushRecent(item);
  if (tab === -1) draw();
}

// ---------------------------------------------------------------- 表示

const icons = new Map();
async function icon(tex) {
  if (icons.has(tex)) return icons.get(tex);
  const p = renderMath(tex, 18, "#1f2430").then((r) => (r?.url && !r.error ? r.url : null)).catch(() => null);
  icons.set(tex, p);
  return p;
}

function draw() {
  if (!panel) return;
  const rec = recent();
  const tabs = [...(rec.length ? [["最近", -1]] : []), ...GROUPS.map((g, i) => [g[0], i]), ["参照", -2]];
  if (tab === -1 && !rec.length) tab = 0;
  if (tab === -2) { drawRefs(tabs); return; }
  const items = tab === -1 ? rec : GROUPS[tab][1];
  panel.innerHTML = `<div class="tp-tabs">${tabs.map(([t, i]) => `<button type="button" class="small ${i === tab ? "on" : ""}" data-tab="${i}">${t}</button>`).join("")}
      <span class="grow"></span><button type="button" class="icon small" data-close title="閉じる（Esc）">×</button></div>
    <div class="tp-grid">${items.map((it, k) => `<button type="button" class="tp-item" data-k="${k}" title="${(it[2] ? `${it[2]}: ` : "") + it[0].replace(/"/g, "&quot;").replace(new RegExp(SLOT, "g"), "□")}"><span class="tp-ph">${it[2] ?? it[0].replace(/\\/g, "")}</span></button>`).join("")}</div>
    <div class="tp-note">${isTextField(field) ? "LaTeX の文章の欄では、$…$ の外なら $ で囲んで入れます。" : ""}文字を選んでから押すと、その文字を最初の空欄に入れます。</div>`;
  panel.querySelectorAll(".tp-item").forEach(async (b) => {
    const it = items[Number(b.dataset.k)];
    const url = await icon(it[1] ?? it[0]);
    if (url && b.isConnected) b.innerHTML = `<img src="${url}" alt="">`;
  });
  panel._items = items;
}

/** 「参照」のタブ: ラベルを付けた定理・式・図の一覧。押すと {ref:ラベル} を入れる。 */
function drawRefs(tabs) {
  const labs = labelList();
  const items = labs.map((x) => [`{ref:${x.label}}`, null, x.label, "ref"]);
  panel.innerHTML = `<div class="tp-tabs">${tabs.map(([t, i]) => `<button type="button" class="small ${i === tab ? "on" : ""}" data-tab="${i}">${t}</button>`).join("")}
      <span class="grow"></span><button type="button" class="icon small" data-close title="閉じる（Esc）">×</button></div>
    ${labs.length ? `<div class="tp-refs">${labs.map((x, k) => `<button type="button" class="tp-item tp-ref" data-k="${k}" title="{ref:${escapeAttr(x.label)}} を入れる"><b>${escapeAttr(x.text)}</b><span>${escapeAttr(x.label)}</span><span class="muted">${x.slideIndex + 1} 枚目</span></button>`).join("")}</div>`
      : `<div class="tp-note">ラベルを付けた要素がありません。定理・数式・画像などを選び、右の欄の「番号・ラベル」でラベルを付けると、ここに出ます。</div>`}
    <div class="tp-note">押すと <code>{ref:ラベル}</code> を入れます。描画では「定理 3.1」「(3.1)」「図 3.1」のような番号になり、発表・HTML・PDF で押すと、そのスライドへ飛びます。<code>{num:ラベル}</code> と書くと番号（3.1）だけになります。</div>`;
  panel._items = items;
}

const escapeAttr = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function place() {
  if (!field || !btn) return;
  const r = field.getBoundingClientRect();
  if (!r.width) { hide(); return; }
  Object.assign(btn.style, { left: `${r.right - 54}px`, top: `${r.top - 20}px` });
  if (panel && !panel.hidden) {
    const w = Math.min(460, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 4, h = panel.offsetHeight || 320;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 24) : below;
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });
  }
}

function hide() {
  if (btn) btn.hidden = true;
  if (panel) panel.hidden = true;
}

function show(ta) {
  field = ta;
  btn.hidden = false;
  place();
}

export function setupTexPalette() {
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tp-btn small";
  btn.textContent = "Σ 記号";
  btn.title = "分数・積分・行列・ギリシャ文字などを入れる";
  btn.hidden = true;
  panel = document.createElement("div");
  panel.className = "tp-panel";
  panel.hidden = true;
  document.body.append(btn, panel);
  // ボタン・表を押しても、入力欄から外れたことにしない
  for (const el of [btn, panel]) el.addEventListener("mousedown", (e) => { if (!e.target.closest("input, select")) e.preventDefault(); });
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { draw(); place(); }
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { panel.hidden = true; return; }
    const t = e.target.closest("[data-tab]");
    if (t) { tab = Number(t.dataset.tab); draw(); place(); return; }
    const b = e.target.closest(".tp-item");
    if (b) insert(panel._items[Number(b.dataset.k)]);
  });
  document.addEventListener("focusin", (e) => {
    if (isLatexField(e.target)) show(e.target);
    else if (!btn.contains(e.target) && !panel.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; e.stopPropagation(); } }, true);
  window.addEventListener("resize", place);
  document.addEventListener("scroll", place, true);
  // 入力欄が画面から消えたら（パネルを描き直したなど）、ボタンも隠す
  setInterval(() => { if (field && !btn.hidden && !field.isConnected) hide(); }, 500);
}

/** 自動テスト用。 */
export const texPaletteGroups = () => GROUPS;
