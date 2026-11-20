// レイヤー（重なり順）。スライドの elements の並びがそのまま重なり順（先頭が最背面、最後が最前面）。
// 一覧は上が手前。グループは1行にまとめ、その下に中の要素を字下げして並べる。
// 並べ替え・最前面/前面/背面/最背面・表示/非表示・ロック・グループ化・右クリックメニューを扱う。

import { alignSelection, distributeSelection } from "./align.js";
import { canvasObjectAt, refreshElement } from "./canvas.js";
import { copySelection, cutSelection, duplicateSelection, hasClip, pasteInternal } from "./clipboard.js";
import { putIntoBalloon, shapeLabel, wrapInBalloon } from "./shapes.js";
import {
  afterOrderChange, clearSelection, deleteSelection, groupSelection, moveSelectionLayer, select, selectAll, selectMany,
  ungroup,
} from "./selection.js";
import { currentSlide, escapeHtml, findElement, findGroup, groupMembers, isBalloon, markDirty, on, store } from "./store.js";

const $ = (id) => document.getElementById(id);
const KIND = { text: "T", math: "Σ", image: "▣", shape: "◇", media: "▶" };
const collapsed = new Set(); // 折りたたんだグループ

function label(el) {
  if (el.type === "math") return el.latex || "";
  if (el.type === "text") return (el.text || "").replace(/\n/g, " ");
  if (el.type === "image") return el.name || el.path || "";
  if (el.type === "shape") return shapeLabel(el);
  return "";
}

function buttons(hidden, locked) {
  return `<button class="ly-btn ${hidden ? "off" : ""}" data-ly="hide" title="${hidden ? "表示する" : "編集中だけ隠す（書き出しには影響しません）"}">${hidden ? "◌" : "●"}</button>
      <button class="ly-btn ${locked ? "on" : ""}" data-ly="lock" title="${locked ? "ロックを外す" : "ロックする（キャンバスで動かせなくする）"}">${locked ? "🔒" : "🔓"}</button>`;
}

export function renderLayers() {
  const ol = $("layer-list");
  const slide = currentSlide();
  if (!slide) { ol.innerHTML = ""; return; }
  if (!slide.elements.length) {
    ol.innerHTML = `<li class="empty">要素はまだありません</li>`;
    return;
  }
  const sel = new Set(store.selectedIds);
  const groupSelected = !!findGroup(store.selectedId);
  const rows = [];
  const shown = [...slide.elements].reverse();
  for (let i = 0; i < shown.length; i++) {
    const el = shown[i];
    if (el.groupId) {
      const g = findGroup(el.groupId);
      const members = shown.filter((e) => e.groupId === el.groupId);
      i += members.length - 1;
      const hidden = members.every((m) => m.hidden), locked = members.every((m) => m.locked);
      const open = !collapsed.has(g.id);
      const cls = [store.selectedId === g.id ? "sel" : "", members.some((m) => sel.has(m.id)) && store.selectedId !== g.id ? "part" : "",
        hidden ? "is-hidden" : "", store.enteredGroup === g.id ? "entered" : ""].join(" ");
      rows.push(`<li data-gid="${g.id}" draggable="true" class="ly-group ${cls}">
      <button class="ly-fold" data-ly="fold" title="${open ? "折りたたむ" : "開く"}">${open ? "▾" : "▸"}</button>
      <span class="ly-kind">▤</span>
      <span class="ly-name">${escapeHtml(g.var)}</span>
      <span class="ly-sub">グループ（${members.length}）</span>
      ${buttons(hidden, locked)}</li>`);
      if (open) {
        for (const m of members) {
          const mcls = [sel.has(m.id) ? (groupSelected ? "insel" : "sel") : "", m.hidden ? "is-hidden" : ""].join(" ");
          rows.push(`<li data-id="${m.id}" draggable="true" class="ly-member ${mcls}">
      <span class="ly-kind">${KIND[m.type] ?? "?"}</span>
      <span class="ly-name">${escapeHtml(m.var)}</span>
      <span class="ly-sub">${escapeHtml(label(m).slice(0, 20))}</span>
      ${buttons(m.hidden, m.locked)}</li>`);
        }
      }
      continue;
    }
    rows.push(`<li data-id="${el.id}" draggable="true" class="${sel.has(el.id) ? "sel" : ""} ${el.hidden ? "is-hidden" : ""}">
      <span class="ly-kind">${KIND[el.type] ?? "?"}</span>
      <span class="ly-name">${escapeHtml(el.var)}</span>
      <span class="ly-sub">${escapeHtml(label(el).slice(0, 24))}</span>
      ${buttons(el.hidden, el.locked)}</li>`);
  }
  ol.innerHTML = rows.join("");
}

/** 1 つの要素の重なり順を変える（その要素を選んでから動かす）。op: "front" | "forward" | "backward" | "back" */
export function moveLayer(id, op) {
  if (!store.selectedIds.includes(id)) select(id);
  moveSelectionLayer(op);
}

/** 要素、またはグループ（中の要素すべて）の表示・ロックを切り替える。 */
function toggleFlag(id, key) {
  const els = findGroup(id) ? groupMembers(id) : [findElement(id)].filter(Boolean);
  if (!els.length) return;
  const v = !els.every((e) => e[key]);
  for (const e of els) { e[key] = v; refreshElement(e); }
  markDirty("layer");
  renderLayers();
}
export const toggleHidden = (id) => toggleFlag(id, "hidden");
export const toggleLocked = (id) => toggleFlag(id, "locked");

/** 一覧の行の Ctrl / Shift クリック: その行の物（グループなら中の要素すべて）を選択に足す・外す。 */
function toggleInSelection(id) {
  const ids = findGroup(id) ? groupMembers(id).map((e) => e.id) : [id];
  const cur = new Set(store.selectedIds);
  const on = ids.every((x) => cur.has(x));
  for (const x of ids) on ? cur.delete(x) : cur.add(x);
  selectMany([...cur]);
}

// ---------------------------------------------------------------- 一覧のドラッグ（並べ替え・グループへの出し入れ）

function setupDrag(ol) {
  let src = null;
  const clear = () => ol.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
  const rowOf = (t) => t.closest("li[data-id], li[data-gid]");
  ol.addEventListener("dragstart", (e) => {
    const li = rowOf(e.target);
    if (!li) return;
    src = li.dataset.gid ? { gid: li.dataset.gid } : { id: li.dataset.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", src.gid ?? src.id);
  });
  ol.addEventListener("dragover", (e) => {
    const li = rowOf(e.target);
    if (!src || !li) return;
    e.preventDefault();
    clear();
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before");
  });
  ol.addEventListener("dragleave", (e) => { if (!ol.contains(e.relatedTarget)) clear(); });
  ol.addEventListener("dragend", () => { src = null; clear(); });
  ol.addEventListener("drop", (e) => {
    const li = rowOf(e.target);
    if (!src || !li) return;
    e.preventDefault();
    const below = li.classList.contains("drop-after"); // 一覧の下＝背面側
    clear();
    const s = src;
    src = null;
    dropOn(s, li.dataset.gid ? { gid: li.dataset.gid } : { id: li.dataset.id }, below);
  });
}

function dropOn(src, dst, below) {
  const slide = currentSlide();
  const els = slide.elements;
  const dstEl = dst.id ? findElement(dst.id) : null;
  const srcEl = src.id ? findElement(src.id) : null;
  // 同じグループの中での並べ替え
  if (srcEl?.groupId && dstEl?.groupId === srcEl.groupId) {
    if (srcEl === dstEl) return;
    els.splice(els.indexOf(srcEl), 1);
    const k = els.indexOf(dstEl);
    els.splice(below ? k : k + 1, 0, srcEl);
    return afterOrderChange();
  }
  // 動かす物（要素 1 つ、またはグループ全体）を取り出す
  let moving;
  if (src.gid) moving = els.filter((e) => e.groupId === src.gid);
  else {
    moving = [srcEl];
    if (srcEl.groupId) delete srcEl.groupId; // グループの外へドラッグしたら、グループから出す
  }
  // 落とした先の単位（グループの中の行に落としたら、グループ全体）
  const dgid = dst.gid ?? dstEl?.groupId ?? null;
  if (src.gid && dgid === src.gid) return;
  const rest = els.filter((e) => !moving.includes(e));
  const target = dgid ? rest.filter((e) => e.groupId === dgid) : [dstEl];
  const first = rest.indexOf(target[0]), last = rest.indexOf(target[target.length - 1]);
  const at = below ? first : last + 1;
  rest.splice(at, 0, ...moving);
  slide.elements = rest;
  afterOrderChange();
}

// ---------------------------------------------------------------- 右クリックメニュー

let menu = null;

function closeMenu() {
  menu?.remove();
  menu = null;
}

function openMenu(x, y) {
  closeMenu();
  const ids = store.selectedIds;
  if (!ids.length) {
    // 何も無い所の右クリック: 貼り付けだけ
    if (!hasClip()) return;
    menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.innerHTML = `<button data-m="paste"><span>貼り付け</span><kbd>Ctrl+V</kbd></button>`;
    document.body.appendChild(menu);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.addEventListener("click", () => { closeMenu(); pasteInternal(); });
    return;
  }
  const els = ids.map((id) => findElement(id)).filter(Boolean);
  const isGroup = !!findGroup(store.selectedId);
  const inGroup = !isGroup && ids.length === 1 && els[0]?.groupId;
  const hidden = els.every((e) => e.hidden), locked = els.every((e) => e.locked);
  const nUnits = new Set(els.map((e) => (e.groupId && e.groupId !== store.enteredGroup ? e.groupId : e.id))).size;
  menu = document.createElement("div");
  menu.className = "ctx-menu";
  const items = [
    ["copy", "コピー", "Ctrl+C"], ["cut", "切り取り", "Ctrl+X"], hasClip() ? ["paste", "貼り付け", "Ctrl+V"] : null,
    ["duplicate", "複製", "Ctrl+D"], null,
    ["front", "最前面へ移動", "Ctrl+Shift+]"], ["forward", "前面へ移動", "Ctrl+]"],
    ["backward", "背面へ移動", "Ctrl+["], ["back", "最背面へ移動", "Ctrl+Shift+["], null,
    ids.length >= 2 && !isGroup ? ["group", "グループ化", "Ctrl+G"] : null,
    isGroup || inGroup ? ["ungroup", "グループ解除", "Ctrl+Shift+G"] : null,
    isGroup ? ["enter", "グループの中の要素を選ぶ", "ダブルクリック"] : null,
    els.filter(isBalloon).length === 1 && els.length >= 2 ? ["intoBalloon", "吹き出しに入れる", ""] : null,
    !els.some(isBalloon) ? ["wrapBalloon", "吹き出しで囲む", ""] : null,
    ["hide", hidden ? "表示する" : "編集中だけ隠す", ""], ["lock", locked ? "ロックを外す" : "ロックする", ""], null,
    ["align:hcenter", nUnits >= 2 ? "左右の中央にそろえる" : "スライドの左右の中央へ", ""], ["align:vcenter", nUnits >= 2 ? "上下の中央にそろえる" : "スライドの上下の中央へ", ""],
    nUnits >= 2 ? ["align:left", "左にそろえる", ""] : null, nUnits >= 2 ? ["align:top", "上にそろえる", ""] : null,
    nUnits >= 3 ? ["align:dx", "横に等間隔", ""] : null, nUnits >= 3 ? ["align:dy", "縦に等間隔", ""] : null, null,
    ["delete", ids.length > 1 ? `削除（${ids.length} 個）` : "削除", "Delete"],
  ];
  menu.innerHTML = items.map((it, i) => it ? `<button data-m="${it[0]}"><span>${it[1]}</span><kbd>${it[2]}</kbd></button>` : (items[i - 1] ? "<hr>" : "")).join("");
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`;
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    const m = b.dataset.m;
    closeMenu();
    if (m.startsWith("align:")) {
      const a = m.slice(6);
      if (a === "dx" || a === "dy") distributeSelection(a === "dx" ? "x" : "y");
      else alignSelection(a);
    } else if (m === "copy") copySelection();
    else if (m === "cut") cutSelection();
    else if (m === "paste") pasteInternal();
    else if (m === "duplicate") duplicateSelection();
    else if (["front", "forward", "backward", "back"].includes(m)) moveSelectionLayer(m);
    else if (m === "group") groupSelection();
    else if (m === "ungroup") ungroup(isGroup ? store.selectedId : els[0].groupId);
    else if (m === "intoBalloon") putIntoBalloon();
    else if (m === "wrapBalloon") wrapInBalloon();
    else if (m === "enter") select(groupMembers(store.selectedId).at(-1).id);
    else if (m === "hide" || m === "lock") {
      const key = m === "hide" ? "hidden" : "locked";
      const v = !(m === "hide" ? hidden : locked);
      for (const e of els) { e[key] = v; refreshElement(e); }
      markDirty("layer");
      renderLayers();
    } else if (m === "delete") deleteSelection();
  });
}

// ---------------------------------------------------------------- キーボード

function onKey(e) {
  if (e.key === "Escape" && menu) { closeMenu(); return; }
  if (!store.project) return;
  // 入力欄の中の Esc: 1 回目は欄から外れる（2 回目で選択の解除）。ダイアログの中は、ダイアログが閉じる
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
    const field = e.target.closest("input, textarea, select, [contenteditable]");
    if (field && !e.target.closest("#search-panel, #lint-panel, .slide-player")) { field.blur(); e.preventDefault(); return; }
  }
  if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl && k.toLowerCase() === "a") {
    // 描画ログ・エラーの表示の中なら、その文字だけを選ぶ（要素の全選択にしない）
    const box = e.target.closest?.(".bp-body");
    if (box) {
      e.preventDefault();
      const r = document.createRange();
      r.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    e.preventDefault(); selectAll(); return;
  }
  if (k === "Escape") {
    // グループの中に入っていれば、まずグループの選択に戻る
    const el = findElement(store.selectedId);
    if (store.enteredGroup && el?.groupId === store.enteredGroup) select(store.enteredGroup);
    else clearSelection();
    return;
  }
  if (!store.selectedIds.length) return;
  if (ctrl && k.toLowerCase() === "g") {
    e.preventDefault();
    if (e.shiftKey) {
      const gid = findGroup(store.selectedId) ? store.selectedId : findElement(store.selectedId)?.groupId;
      if (gid) ungroup(gid);
    } else groupSelection();
    return;
  }
  if (!ctrl) return;
  // JIS 配列では Shift+[ / Shift+] が { / } になるので、どちらも受け付ける
  let op = null;
  if (k === "]" || k === "}") op = e.shiftKey ? "front" : "forward";
  if (k === "[" || k === "{") op = e.shiftKey ? "back" : "backward";
  if (op) { e.preventDefault(); moveSelectionLayer(op); }
}

// ---------------------------------------------------------------- 準備

export function setupLayers() {
  const ol = $("layer-list");
  ol.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id], li[data-gid]");
    if (!li) return;
    const id = li.dataset.gid ?? li.dataset.id;
    const act = e.target.closest("[data-ly]")?.dataset.ly;
    if (act === "hide") return toggleHidden(id);
    if (act === "lock") return toggleLocked(id);
    if (act === "fold") {
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      return renderLayers();
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) return toggleInSelection(id);
    select(id);
  });
  setupDrag(ol);

  // キャンバスの右クリック: 選択中の物の上なら選択をそのままに、そうでなければその物を選ぶ
  const stage = $("stage");
  stage.addEventListener("contextmenu", (e) => {
    if (!store.project) return;
    e.preventDefault();
    const id = canvasObjectAt(e);
    if (!id) {
      if (store.selectedIds.length) select(null);
      openMenu(e.clientX, e.clientY); // 貼り付けだけのメニュー
      return;
    }
    if (!store.selectedIds.includes(id)) {
      const el = findElement(id);
      select(el?.groupId && el.groupId !== store.enteredGroup ? el.groupId : id);
    }
    openMenu(e.clientX, e.clientY);
  }, true); // Fabric がキャンバス上で右クリックの伝わりを止めるため、捕捉段階で受け取る
  // 一覧の右クリック
  ol.addEventListener("contextmenu", (e) => {
    const li = e.target.closest("li[data-id], li[data-gid]");
    if (!li) return;
    e.preventDefault();
    const id = li.dataset.gid ?? li.dataset.id;
    const ids = findGroup(id) ? groupMembers(id).map((m) => m.id) : [id];
    if (!ids.every((x) => store.selectedIds.includes(x))) select(id);
    openMenu(e.clientX, e.clientY);
  });
  document.addEventListener("mousedown", (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", onKey);

  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(renderLayers, 120); };
  on("selection", renderLayers);
  on("layers-changed", renderLayers);
  on("project-loaded", renderLayers);
  on("canvas-rendered", renderLayers);
  on("dirty", later);
}

