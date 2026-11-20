// 全スライドからの検索・置換。文字（テキスト・表・グラフや図形のラベル）・数式（LaTeX）・発表者ノート・コードを探す。
// 要素の名前（変数名）・ファイルのパス・色などの設定は探さない。置換は「元に戻す」で 1 回で戻せる。

import { select } from "./selection.js";
import { renderStepChips, selectSlide } from "./slides.js";
import { emit, escapeHtml, store, toast } from "./store.js";
import { keepHistory } from "./history.js";

const $ = (id) => document.getElementById(id);
let refresh = null; // 画面をすべて描き直す（main.js の restoreProject）
let results = [];
let timer = null;

// 要素の中で「文字」として探す項目の名前（どの深さでも）。runs（書式付きの文字）は別に扱う
const TEXT_KEYS = new Set(["text", "title", "xLabel", "yLabel", "zLabel", "nameLabel", "label", "labels", "cells", "headers", "rows",
  "caption", "legendTitle", "unit", "prefix", "suffix"]);
const MATH_KEYS = new Set(["latex", "pname"]);
const CODE_SHAPE = "code"; // 図形「コード」の中身は文字として探す
// 文字の欄の名前（結果に出す）
const FIELD_LABEL = { headers: "表の見出し", rows: "表", cells: "表", title: "題名", xLabel: "横軸のラベル", yLabel: "縦軸のラベル",
  zLabel: "z 軸のラベル", nameLabel: "名前のラベル", label: "ラベル", labels: "ラベル", caption: "説明", code: "コード", bars: "棒の名前",
  latex: "LaTeX", pname: "点の名前", text: "文字", unit: "単位", prefix: "前に付ける文字", suffix: "後に付ける文字", legendTitle: "凡例の題名" };
const fieldLabel = (key, path) => {
  for (const k of [...path].reverse()) if (FIELD_LABEL[k]) return FIELD_LABEL[k];
  return FIELD_LABEL[key] ?? "";
};
const KIND_LABEL = { text: "文字", math: "数式", notes: "ノート", code: "コード" };

/** 探す欄の一覧: { slideIndex, kind, where, elementId?, stepId?, get(), set(v) } */
function fields(cats, onlySlide) {
  const out = [];
  store.project.slides.forEach((slide, si) => {
    if (onlySlide != null && si !== onlySlide) return;
    for (const el of slide.elements) {
      const name = el.var || el.id;
      if (cats.text && el.type === "text" && Array.isArray(el.runs)) {
        out.push({ slideIndex: si, kind: "text", where: name, rich: true, elementId: el.id,
          get: () => el.runs.map((r) => r.t ?? "").join(""), set: (v, edits) => applyRuns(el, edits, v) });
      }
      walk(el, [], (obj, key, path) => {
        if (el.type === "text" && path.length === 0 && key === "text") return; // 書式付きの文字は runs で
        const isMath = MATH_KEYS.has(key);
        const isText = !isMath && (TEXT_KEYS.has(key) || path.some((p) => TEXT_KEYS.has(p)) || (key === "code" && el.shape === CODE_SHAPE)
          || (key === "name" && path.includes("bars")));
        if (isMath ? !cats.math : !(isText && cats.text)) return;
        const fl = fieldLabel(key, path);
        out.push({ slideIndex: si, kind: isMath ? "math" : "text", where: fl && el.type !== "math" ? `${name} の${fl}` : name, elementId: el.id,
          get: () => obj[key], set: (v) => { obj[key] = v; } });
      });
    }
    if (cats.notes) {
      out.push({ slideIndex: si, kind: "notes", where: "スライドのノート", get: () => slide.notes ?? "", set: (v) => { slide.notes = v; } });
    }
    slide.steps.forEach((st, k) => {
      if (cats.notes) out.push({ slideIndex: si, kind: "notes", where: `ステップ ${k + 1} のノート`, stepId: st.id, get: () => st.notes ?? "", set: (v) => { st.notes = v; } });
      if (!cats.code) return;
      if (st.mode !== "gui") out.push({ slideIndex: si, kind: "code", where: `ステップ ${k + 1} のコード`, stepId: st.id, elementId: st.elementId, get: () => st.code ?? "", set: (v) => { st.code = v; } });
      (st.rows ?? []).forEach((r, n) => {
        if (r.kind === "code") out.push({ slideIndex: si, kind: "code", where: `ステップ ${k + 1} のコードの行 ${n + 1}`, stepId: st.id, get: () => r.code ?? "", set: (v) => { r.code = v; } });
      });
    });
  });
  return out.filter((f) => typeof f.get() === "string");
}

/** 要素の中の文字列を、たどる。fn(入れ物, 項目の名前（配列なら番号）, 上の項目の名前の並び)。 */
const SKIP = new Set(["id", "var", "path", "type", "shape", "kind", "font", "color", "fill", "stroke", "groupId", "targetId", "axesId",
  "items", "mode", "runs", "colorMap", "values", "mask", "name"]);
function walk(obj, path, fn) {
  const arr = Array.isArray(obj);
  for (const [k, v] of arr ? obj.map((x, i) => [i, x]) : Object.entries(obj)) {
    if (!arr && SKIP.has(k) && !(k === "name" && path.includes("bars"))) continue;
    if (typeof v === "string") fn(obj, k, path);
    else if (v && typeof v === "object") walk(v, arr ? path : [...path, k], fn);
  }
}

/** 書式付きの文字（runs）の置換: つないだ文字の位置で置き換え、書式は置き換えの始まりの所のものにする。 */
function applyRuns(el, edits) {
  // edits: [{start, end, text}]（後ろから順に）
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    let pos = 0, inserted = false;
    for (const r of el.runs) {
      const t = r.t ?? "";
      const a = pos, b = pos + t.length;
      const lo = Math.max(a, e.start), hi = Math.min(b, e.end);
      let nt = t;
      if (!inserted && e.start >= a && (e.start < b || (e.start === b && e.end === e.start))) {
        nt = t.slice(0, e.start - a) + e.text + t.slice(Math.min(t.length, e.end - a));
        inserted = true;
      } else if (hi > lo) {
        nt = t.slice(0, lo - a) + t.slice(hi - a);
      }
      r.t = nt;
      pos = b;
    }
    if (!inserted && el.runs.length) el.runs[el.runs.length - 1].t += e.text;
  }
  el.runs = el.runs.filter((r, i) => (r.t ?? "") !== "" || el.runs.length === 1 || i === 0);
  el.text = el.runs.map((r) => r.t ?? "").join("");
}

function matcher() {
  const q = $("sr-find").value;
  if (!q) return null;
  const flags = $("sr-case").checked ? "g" : "gi";
  try {
    return new RegExp($("sr-regex").checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags + "u");
  } catch (e) {
    return { error: e.message };
  }
}

function cats() {
  return { text: $("sr-c-text").checked, math: $("sr-c-math").checked, notes: $("sr-c-notes").checked, code: $("sr-c-code").checked };
}

function search() {
  results = [];
  const re = matcher();
  const list = $("sr-list");
  if (!store.project || !re) { list.innerHTML = ""; $("sr-count").textContent = ""; return; }
  if (re.error) { list.innerHTML = ""; $("sr-count").textContent = `正規表現が正しくありません: ${re.error}`; return; }
  const only = $("sr-scope").value === "slide" ? store.slideIndex : null;
  for (const f of fields(cats(), only)) {
    const text = f.get();
    const hits = [];
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m[0] === "") continue;
      hits.push({ start: m.index, end: m.index + m[0].length, m });
      if (hits.length > 500) break;
    }
    if (hits.length) results.push({ ...f, text, hits });
  }
  const n = results.reduce((a, r) => a + r.hits.length, 0);
  $("sr-count").textContent = n ? `${n} か所（${results.length} 個の欄・${new Set(results.map((r) => r.slideIndex)).size} 枚のスライド）` : "見つかりません。";
  $("sr-all").disabled = !n;
  list.innerHTML = results.slice(0, 300).map((r, i) => {
    const h = r.hits[0];
    const a = Math.max(0, h.start - 20), b = Math.min(r.text.length, h.end + 30);
    const snip = `${a > 0 ? "…" : ""}${escapeHtml(r.text.slice(a, h.start))}<mark>${escapeHtml(r.text.slice(h.start, h.end))}</mark>${escapeHtml(r.text.slice(h.end, b))}${b < r.text.length ? "…" : ""}`;
    return `<li data-i="${i}"><div class="sr-where"><b>スライド ${r.slideIndex + 1}</b> <span class="sr-kind k-${r.kind}">${KIND_LABEL[r.kind]}</span> ${escapeHtml(r.where)}${r.hits.length > 1 ? `（${r.hits.length} か所）` : ""}</div>
      <div class="sr-snip">${snip.replace(/\n/g, "↵")}</div>
      <button type="button" class="small" data-a="one">この欄を置換</button></li>`;
  }).join("") + (results.length > 300 ? `<li class="sr-more">ほかに ${results.length - 300} 個の欄があります（すべて置換には入ります）。</li>` : "");
}

function replacement(m) {
  const rep = $("sr-replace").value;
  if (!$("sr-regex").checked) return rep;
  // 正規表現: $1・$<name>・$& を使える
  return rep.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (_s, g) => {
    if (g === "$") return "$";
    if (g === "&") return m[0];
    if (g.startsWith("<")) return m.groups?.[g.slice(1, -1)] ?? "";
    return m[Number(g)] ?? "";
  });
}

function applyTo(r) {
  const edits = r.hits.map((h) => ({ start: h.start, end: h.end, text: replacement(h.m) }));
  if (r.rich) {
    r.set(null, edits);
  } else {
    let s = r.text;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
    r.set(s);
  }
  return edits.length;
}

async function replaceIn(list) {
  if (!list.length) return;
  let n = 0;
  for (const r of list) n += applyTo(r);
  await keepHistory(() => refresh(store.project, { slideIndex: store.slideIndex, selectedIds: store.selectedIds, focusStepId: store.focusStepId }, "replace"));
  toast(`${n} か所を置換しました（「元に戻す」で戻せます）。`);
  search();
}

async function goTo(r) {
  await selectSlide(r.slideIndex);
  if (r.elementId) select(r.elementId, { stepId: r.stepId ?? null });
  if (r.stepId) {
    store.focusStepId = r.stepId;
    emit("focus-step", r.stepId);
    renderStepChips();
    document.getElementById("anim-editor")?.scrollIntoView({ block: "nearest" });
  }
}

export function openSearch(replace = false) {
  if (!store.project) return;
  const p = $("search-panel");
  p.hidden = false;
  document.getElementById("lint-panel").hidden = true; // 同じ場所に出すので、点検の欄は閉じる
  $("sr-replace-row").hidden = false;
  const sel = window.getSelection?.().toString();
  if (sel && sel.length < 100 && !sel.includes("\n")) $("sr-find").value = sel;
  (replace && $("sr-find").value ? $("sr-replace") : $("sr-find")).focus();
  $("sr-find").select();
  search();
}

export function setupSearch(restore) {
  refresh = restore;
  const again = () => { clearTimeout(timer); timer = setTimeout(search, 200); };
  for (const id of ["sr-find", "sr-replace"]) $(id).addEventListener("input", again);
  for (const id of ["sr-case", "sr-regex", "sr-c-text", "sr-c-math", "sr-c-notes", "sr-c-code", "sr-scope"]) $(id).addEventListener("change", search);
  $("sr-close").addEventListener("click", () => { $("search-panel").hidden = true; });
  $("sr-find").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (results[0]) goTo(results[0]); }
    if (e.key === "Escape") $("search-panel").hidden = true;
  });
  $("sr-replace").addEventListener("keydown", (e) => { if (e.key === "Escape") $("search-panel").hidden = true; });
  $("sr-all").addEventListener("click", () => {
    const n = results.reduce((a, r) => a + r.hits.length, 0);
    if (n > 20 && !confirm(`${n} か所を置換します。よろしいですか？（「元に戻す」で 1 回で戻せます）`)) return;
    replaceIn(results);
  });
  $("sr-list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    const r = results[Number(li.dataset.i)];
    if (e.target.closest("[data-a=one]")) replaceIn([r]);
    else goTo(r);
  });
  // 内容が変わったら（開いている間だけ）探し直す
  const relook = (reason) => { if (!$("search-panel").hidden && reason !== "saved" && reason !== "replace") again(); };
  import("./store.js").then(({ on }) => { on("dirty", relook); on("project-loaded", () => { if (!$("search-panel").hidden) again(); }); });
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !store.project) return;
    const k = e.key.toLowerCase();
    if ((k === "f" && e.shiftKey) || k === "h") { e.preventDefault(); openSearch(k === "h"); }
  });
}
export { fields as searchFields };

/** 文字をまとめて変えたあと、画面をすべて描き直す（1 回の「元に戻す」で戻せる）。表記ゆれで使う。 */
export async function redrawAfterBulkEdit() {
  await keepHistory(() => refresh(store.project, { slideIndex: store.slideIndex, selectedIds: store.selectedIds, focusStepId: store.focusStepId }, "replace"));
}
