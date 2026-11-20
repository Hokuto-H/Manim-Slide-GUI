// 使い方の案内（アプリ内のヘルプ）。原稿は docs/help/*.md（サーバーが HTML にして返す）。
// ツールバーの「？」・F1（今の場所に合ったページ）・パネルやダイアログの見出しの「？」から開く、右の引き出し。
// 開いているダイアログ（モーダル）があるときは、引き出しをそのダイアログの中へ移して、操作できるようにする。

import { api } from "./api.js";
import { SHAPE_PRESETS } from "./shapes.js";
import { emit, escapeHtml, findTarget, store } from "./store.js";

const $ = (id) => document.getElementById(id);
let index = null;           // [{id, title, group, summary, keywords, toc, sections}]
let cache = new Map();      // ページの id → {html, ...}
let history = [];           // 戻る用: [{page, anchor} | {view: "toc"} | {view: "search", q}]
let current = null;
const LAST_KEY = "manimSlideGuiHelpLast";

// ダイアログごとの説明のページ
const DIALOG_HELP = {
  "dlg-project": ["project", "settings"], "dlg-open": ["project", "open"], "dlg-pack": ["project", "zip"], "dlg-unpack": ["project", "zip"],
  "dlg-delproj": ["project", "open"], "dlg-backup": ["project", "backup"], "dlg-bkcmp": ["project", "backup"], "dlg-cleanup": ["project", "cleanup"],
  "dlg-slide-tpl": ["slides", "template"], "dlg-range": ["preview-render", "select"], "dlg-convert": ["export", ""],
  "dlg-lintgate": ["lint", "before"], "dlg-overview": ["present", "rehearsal"], "dlg-rehearsal": ["present", "rehearsal"],
  "dlg-record": ["present", "record"], "dlg-preamble": ["math", "preamble"], "dlg-env": ["settings", "env"],
};
// 図形メニューの分類 → ページ
const CATEGORY_HELP = { basic: "shapes", line: "shapes", data: "shapes", graph: "graphs", stat: "stats", math: "theorem", "3d": "3d" };
const SHAPE_HELP = { statchart: ["stats", ""], balloon: ["shapes", "balloon"], path: ["shapes", "path"], table: ["shapes", "table"],
  matrix: ["shapes", "table"], line: ["shapes", "lines"], axes: ["graphs", "axes"], graph: ["graphs", "plot"], part: ["shapes", "parts"] };
let shapeCat = null;

function shapePage(el) {
  if (SHAPE_HELP[el.shape]) return SHAPE_HELP[el.shape];
  if (!shapeCat) {
    shapeCat = {};
    for (const [, , spec, cat] of SHAPE_PRESETS) if (spec?.shape && !(spec.shape in shapeCat)) shapeCat[spec.shape] = cat;
  }
  const cat = shapeCat[el.shape];
  return [CATEGORY_HELP[cat] ?? "shapes", ""];
}

/** 今の場所に合ったページ（F1）。 */
export function contextHelp() {
  const dlg = [...document.querySelectorAll("dialog[open]")].pop();
  if (dlg?.id === "dlg-project") return ["project", dlg.classList.contains("mode-new") ? "new" : "settings"];
  if (dlg && DIALOG_HELP[dlg.id]) return DIALOG_HELP[dlg.id];
  if (!$("search-panel")?.hidden) return ["text", "search"];
  if (!$("lint-panel")?.hidden) return ["lint", ""];
  const act = document.activeElement;
  if (act?.closest?.("#anim-editor, #step-order, #timeline")) return ["animation", ""];
  if (!store.project) return ["start", ""];
  if (store.masterId) return ["slides", "master"];
  const t = store.selectedId ? findTarget(store.selectedId) : null;
  const el = t?.type ? t : null;
  if (store.selectedIds?.length > 1 || (t && !t.type)) return ["arrange", "group"];
  if (el) {
    if (el.type === "text") return ["text", ""];
    if (el.type === "math") return ["math", ""];
    if (el.type === "image") return ["image-media", "image"];
    if (el.type === "media") return ["image-media", "media"];
    if (el.type === "shape") return shapePage(el);
  }
  return ["slides", "settings"];
}

async function loadIndex() {
  if (!index) index = (await api.get("/api/help/index")).pages;
  return index;
}

async function loadPage(id) {
  if (!cache.has(id)) cache.set(id, await api.get(`/api/help/page/${encodeURIComponent(id)}`));
  return cache.get(id);
}

function drawer() { return $("help-drawer"); }
export const helpOpen = () => !drawer().hidden;

/** モーダルのダイアログが開いていれば、その中へ移す（後ろは操作できないため）。閉じたら戻す。 */
function placeDrawer() {
  const d = drawer();
  const dlg = [...document.querySelectorAll("dialog[open]")].filter((x) => x.matches(":modal")).pop();
  const host = dlg ?? document.body;
  if (d.parentElement !== host) host.appendChild(d);
  d.style.top = dlg ? "0px" : `${Math.round(document.querySelector(".toolbar")?.getBoundingClientRect().bottom ?? 48)}px`;
  if (dlg && !dlg.dataset.helpHooked) {
    dlg.dataset.helpHooked = "1";
    dlg.addEventListener("close", () => { if (d.parentElement === dlg) { document.body.appendChild(d); placeDrawer(); } });
    // Esc: ヘルプが開いていれば、ダイアログではなくヘルプを閉じる
    dlg.addEventListener("cancel", (e) => { if (d.parentElement === dlg && !d.hidden) { e.preventDefault(); closeHelp(); } });
  }
}

/** ヘルプを開く。page を省くと、前に見ていたページ（無ければ目次）。 */
export async function openHelp(page, anchor = "", { push = true } = {}) {
  placeDrawer();
  if (page) $("help-q").value = "";
  drawer().hidden = false;
  document.body.classList.add("help-on");
  try {
    await loadIndex();
  } catch (e) {
    $("help-body").innerHTML = `<p class="help-err">ヘルプを読み込めませんでした: ${escapeHtml(e.message)}</p>`;
    return;
  }
  if (!page) {
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch { /* 使えなくても続ける */ }
    if (last?.page && index.some((p) => p.id === last.page)) return showPage(last.page, last.anchor ?? "", push);
    return showToc(push);
  }
  return showPage(page, anchor, push);
}

export function closeHelp() {
  drawer().hidden = true;
  document.body.classList.remove("help-on");
  if (drawer().parentElement !== document.body) document.body.appendChild(drawer());
}

function pushState(s, push) {
  if (push && current) history.push(current);
  current = s;
  $("help-back").disabled = !history.length;
}

function showToc(push = true) {
  pushState({ view: "toc" }, push);
  $("help-title").textContent = "目次";
  $("help-q").value = "";
  const groups = [];
  for (const p of index) {
    let g = groups.find((x) => x.name === p.group);
    if (!g) groups.push(g = { name: p.group, pages: [] });
    g.pages.push(p);
  }
  $("help-body").innerHTML = groups.map((g) => `<h3 class="help-group">${escapeHtml(g.name || "そのほか")}</h3>
    <ul class="help-toc">${g.pages.map((p) => `<li><a href="#" class="help-link" data-page="${p.id}" data-anchor="">${escapeHtml(p.title)}</a>
      <div class="help-sum">${escapeHtml(p.summary)}</div></li>`).join("")}</ul>`).join("");
  $("help-body").scrollTop = 0;
}

async function showPage(id, anchor = "", push = true) {
  if (id === "tutorial-start") { closeHelp(); emit("action:tutorial"); return; }
  let pg;
  try {
    pg = await loadPage(id);
  } catch (e) {
    $("help-body").innerHTML = `<p class="help-err">ページを読み込めませんでした: ${escapeHtml(e.message)}</p>`;
    return;
  }
  pushState({ page: id, anchor }, push);
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ page: id, anchor })); } catch { /* 使えなくても続ける */ }
  $("help-title").textContent = pg.title;
  const toc = pg.toc.filter((t) => t.level === 2);
  const i = index.findIndex((p) => p.id === id);
  const prev = index[i - 1], next = index[i + 1];
  $("help-body").innerHTML = `<article class="help-page" data-page="${id}">
    <h1>${escapeHtml(pg.title)}</h1>
    ${toc.length > 2 ? `<nav class="help-ptoc">${toc.map((t) => `<a href="#" class="help-link" data-page="${id}" data-anchor="${t.id}">${escapeHtml(t.title)}</a>`).join("")}</nav>` : ""}
    ${pg.html}
    <nav class="help-pn">${prev ? `<a href="#" class="help-link" data-page="${prev.id}" data-anchor="">← ${escapeHtml(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a href="#" class="help-link" data-page="${next.id}" data-anchor="">${escapeHtml(next.title)} →</a>` : ""}</nav></article>`;
  scrollToAnchor(id, anchor);
}

function scrollToAnchor(id, anchor) {
  const body = $("help-body");
  const h = anchor ? body.querySelector(`[id="${CSS.escape(`${id}--${anchor}`)}"]`) : null;
  if (!h) { body.scrollTop = 0; return; }
  body.scrollTop = h.offsetTop - body.offsetTop - 8;
  h.classList.remove("help-flash");
  void h.offsetWidth;
  h.classList.add("help-flash");
}

const norm = (s) => (s || "").normalize("NFKC").toLowerCase();
// ひらがな → カタカナ（「ぐらふ」で「グラフ」も見つける）
const kata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const fold = (s) => kata(norm(s));

/** すべてのページの節から探す。言葉をすべて含む節を、題名・キーワードに当たるものを上にして並べる。 */
export function searchHelp(q) {
  const terms = fold(q).split(/[\s　]+/).filter(Boolean);
  if (!terms.length || !index) return [];
  const hits = [];
  for (const p of index) {
    const kw = fold(`${p.title} ${p.keywords} ${p.summary}`);
    for (const s of p.sections) {
      const title = fold(s.title), text = fold(s.text);
      let score = 0, ok = true;
      for (const t of terms) {
        const inT = title.includes(t), inK = kw.includes(t), inX = text.includes(t);
        if (!inT && !inK && !inX) { ok = false; break; }
        score += (inT ? 6 : 0) + (inK ? 3 : 0) + (inX ? 1 + Math.min(3, text.split(t).length - 2) * 0.3 : 0);
      }
      if (ok) hits.push({ page: p.id, pageTitle: p.title, anchor: s.anchor, title: s.title, text: s.text, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 40);
}

function snippet(text, terms) {
  const f = fold(text);
  let at = -1;
  for (const t of terms) { at = f.indexOf(t); if (at >= 0) break; }
  const start = Math.max(0, at - 30);
  let s = (start > 0 ? "…" : "") + text.slice(start, start + 110) + (start + 110 < text.length ? "…" : "");
  s = escapeHtml(s);
  // 正規化で長さが変わらない文字の範囲で印を付ける（NFKC で長さが変わる所は、印を付けないだけ）
  for (const t of terms) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return s;
}

function showSearch(q, push = true) {
  const hits = searchHelp(q);
  if (!current || current.view !== "search") pushState({ view: "search", q }, push);
  else current.q = q;
  $("help-title").textContent = "検索";
  const terms = fold(q).split(/[\s　]+/).filter(Boolean);
  $("help-body").innerHTML = hits.length
    ? `<p class="help-count">${hits.length} 件</p><ul class="help-results">${hits.map((h) => `<li><a href="#" class="help-link" data-page="${h.page}" data-anchor="${h.anchor}">
        <b>${escapeHtml(h.title)}</b>${h.title !== h.pageTitle ? `<span class="help-where">（${escapeHtml(h.pageTitle)}）</span>` : ""}</a>
        <div class="help-snip">${snippet(h.text, terms)}</div></li>`).join("")}</ul>`
    : `<p class="help-count">「${escapeHtml(q)}」は見つかりませんでした。言葉を短くするか、別の言い方で探してください。</p>`;
  $("help-body").scrollTop = 0;
}

function back() {
  const s = history.pop();
  if (!s) return;
  current = null;
  $("help-back").disabled = !history.length;
  if (s.view === "toc") showToc(false);
  else if (s.view === "search") { $("help-q").value = s.q; showSearch(s.q, false); current = s; }
  else showPage(s.page, s.anchor, false);
}

/** 見出しの横に付ける「？」のボタン。 */
export function helpButton(page, anchor = "", label = "この画面の説明") {
  return `<button type="button" class="help-q" data-help="${page}" data-help-anchor="${anchor}" title="${escapeHtml(label)}（F1）" aria-label="${escapeHtml(label)}">？</button>`;
}

function decorateDialogs() {
  for (const [id, [page, anchor]] of Object.entries(DIALOG_HELP)) {
    const h = $(id)?.querySelector("h2");
    if (h && !h.querySelector(".help-q")) h.insertAdjacentHTML("beforeend", id === "dlg-project" ? `<button type="button" class="help-q" data-help="__ctx" title="この画面の説明（F1）" aria-label="この画面の説明">？</button>` : helpButton(page, anchor));
  }
  for (const [sel, page, anchor] of [["#search-panel .sr-head", "text", "search"], ["#lint-panel .sr-head", "lint", ""]]) {
    const h = document.querySelector(sel);
    if (h && !h.querySelector(".help-q")) h.insertAdjacentHTML("beforeend", helpButton(page, anchor));
  }
}

export function setupHelp() {
  document.body.insertAdjacentHTML("beforeend", `<aside id="help-drawer" class="help-drawer" hidden aria-label="ヘルプ">
    <div class="help-head">
      <button type="button" id="help-back" title="戻る" disabled>←</button>
      <button type="button" id="help-toc" title="目次">目次</button>
      <div class="help-ttl" id="help-title">ヘルプ</div>
      <button type="button" id="help-close" title="閉じる（Esc）">×</button>
    </div>
    <div class="help-tools">
      <input type="search" id="help-q" placeholder="ヘルプを検索（例: 同時、ページ番号）" autocomplete="off">
    </div>
    <div class="help-tools help-more">
      <button type="button" id="help-tutorial" title="練習用のプロジェクトで、操作しながら一通りの流れを体験します">チュートリアルを始める</button>
      <span class="grow"></span>説明書:
      <a href="/manual/" target="_blank" rel="noopener" title="すべてのページを 1 つにまとめた説明書（ブラウザで開く）">HTML</a>
      <a href="/manual/manual.pdf" target="_blank" rel="noopener" title="印刷できる説明書（A4）">PDF</a>
    </div>
    <div class="help-body" id="help-body"></div>
  </aside>`);
  $("help-close").onclick = closeHelp;
  $("help-back").onclick = back;
  $("help-toc").onclick = () => showToc();
  $("help-tutorial").onclick = () => { closeHelp(); emit("action:tutorial"); };
  let timer = 0;
  $("help-q").addEventListener("input", (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    timer = setTimeout(() => (q ? showSearch(q) : showToc()), 160);
  });
  $("help-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const a = $("help-body").querySelector(".help-results .help-link"); a?.click(); }
  });
  drawer().addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeHelp(); }
  });
  // 本文の中のリンク・目次・検索の結果
  drawer().addEventListener("click", (e) => {
    const a = e.target.closest(".help-link");
    if (!a) return;
    e.preventDefault();
    const pg = a.dataset.page;
    if (current?.page === pg && a.dataset.anchor) { pushState({ page: pg, anchor: a.dataset.anchor }, true); scrollToAnchor(pg, a.dataset.anchor); return; }
    showPage(pg, a.dataset.anchor || "");
  });
  // 見出しの「？」（ダイアログ・パネル。後から作られる所にも効くように、文書全体で受ける）
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-help]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.help === "__ctx") { const [pg, an] = contextHelp(); openHelp(pg, an); return; }
    openHelp(b.dataset.help, b.dataset.helpAnchor || "");
  }, true);
  // F1: 今の場所に合ったページ（入力欄の中でも）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F1") return;
    e.preventDefault();
    if (helpOpen() && drawer().contains(document.activeElement)) { closeHelp(); return; }
    const [page, anchor] = contextHelp();
    openHelp(page, anchor);
  }, true);
  decorateDialogs();
}
