// スライドの複数選択と、まとめての操作（左の一覧・スライド一覧の表示で共通）。
// ・クリック: そのスライドを開いて、選択をそれだけに。Ctrl（⌘）+クリック: 選択に足す・外す。Shift+クリック: 範囲で選ぶ（開くスライドは変えない）
// ・右クリック・一覧の操作欄: 複製・削除・先頭へ・末尾へ・描画しない／する・章・付録・マスター
// ・ドラッグ: 選んだスライドをまとめて動かす
// ・スライド一覧の表示: キャンバスの所に、スライドを大きく並べる（ダブルクリックでそのスライドを開く）

import { syncTitles } from "./masters.js";
import { refreshAllThumbs, renderSlideList, selectSlide, slideThumb, cloneSlide } from "./slides.js";
import { emit, escapeHtml, findMaster, markDirty, on, pagePlan, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let anchor = null; // Shift の範囲の起点（スライドの id）
let menu = null;
let tile = 220;
try { tile = Number(localStorage.getItem("sorterTile")) || 220; } catch { /* なくてよい */ }

/** 選んでいるスライドの id（並び順）。少なくとも今のスライド。 */
export function selectedSlideIds() {
  const slides = store.project?.slides ?? [];
  const sel = store.slideSel ?? new Set();
  const ids = slides.filter((s) => sel.has(s.id)).map((s) => s.id);
  const cur = slides[store.slideIndex]?.id;
  return ids.length ? ids : cur ? [cur] : [];
}

export function isSlideSelected(id) {
  return (store.slideSel ?? new Set()).has(id) || (!(store.slideSel?.size) && store.project?.slides[store.slideIndex]?.id === id);
}

function setSel(ids) {
  const before = store.slideSel?.size ?? 0;
  store.slideSel = new Set(ids);
  paintSel();
  // 要素のパネルの「選んだスライドにもそろえる」を出す・消す
  if (store.selectedId && (before > 1 || store.slideSel.size > 1)) emit("selection", store.selectedId);
}

/** 選択の見た目だけを描き直す（一覧全体は作り直さない）。 */
export function paintSel() {
  const many = (store.slideSel?.size ?? 0) > 1;
  document.querySelectorAll("#slide-list li[data-id], #sorter .so-tile[data-id]").forEach((li) => {
    li.classList.toggle("msel", many && store.slideSel.has(li.dataset.id));
  });
  const n = selectedSlideIds().length;
  const c = $("so-count");
  if (c) c.textContent = `${store.project?.slides.length ?? 0} 枚${n > 1 ? `・選んでいるのは ${n} 枚` : ""}`;
  document.querySelectorAll("#sorter [data-op]").forEach((b) => { if (b.dataset.needMany) b.disabled = n < 2; });
}

/** 一覧のクリック。開くなら true。 */
export function clickSlide(i, e) {
  const slides = store.project.slides;
  const id = slides[i]?.id;
  if (!id) return false;
  if (!store.slideSel || !store.slideSel.size) store.slideSel = new Set([slides[store.slideIndex]?.id].filter(Boolean));
  if (e.shiftKey) {
    const a = slides.findIndex((s) => s.id === (anchor ?? slides[store.slideIndex]?.id));
    const [lo, hi] = [Math.min(a, i), Math.max(a, i)];
    setSel(slides.slice(lo, hi + 1).map((s) => s.id));
    return false;
  }
  if (e.ctrlKey || e.metaKey) {
    const s = new Set(store.slideSel);
    if (s.has(id) && s.size > 1) s.delete(id); else s.add(id);
    anchor = id;
    setSel(s);
    return false;
  }
  anchor = id;
  setSel([id]);
  return true;
}

// ---------------------------------------------------------------- 操作

function done(reason = "slide") {
  markDirty(reason);
  emit("slides-changed");
  emit("selection", store.selectedId); // 右のパネル（スライドの設定）も描き直す
  emit("page-numbers-changed");
  drawSorter();
  paintSel();
}

export function duplicateSlides(ids = selectedSlideIds()) {
  const slides = store.project.slides;
  const last = Math.max(...ids.map((id) => slides.findIndex((s) => s.id === id)));
  const copies = ids.map((id) => cloneSlide(slides.find((s) => s.id === id)));
  slides.splice(last + 1, 0, ...copies);
  setSel(copies.map((c) => c.id));
  done();
  toast(`${copies.length} 枚を複製しました（選んだスライドの最後の後ろに入れました）。`);
}

export async function deleteSlides(ids = selectedSlideIds()) {
  const slides = store.project.slides;
  if (ids.length >= slides.length) { toast("すべてのスライドは削除できません（1 枚は残します）。", "warn"); return; }
  const n = ids.reduce((a, id) => a + (slides.find((s) => s.id === id)?.elements.length ?? 0), 0);
  if (n && !confirm(`${ids.length} 枚のスライドを削除しますか？（要素 ${n} 個と、その動きも削除されます。「元に戻す」で戻せます）`)) return;
  const cur = slides[store.slideIndex];
  const firstIdx = slides.findIndex((s) => ids.includes(s.id));
  store.project.slides = slides.filter((s) => !ids.includes(s.id));
  let idx = store.project.slides.indexOf(cur);
  if (idx < 0) idx = Math.min(firstIdx, store.project.slides.length - 1);
  store.slideIndex = -1; // selectSlide で選び直す
  setSel([]);
  markDirty("slide");
  await selectSlide(idx);
  done();
}

/** 選んだスライドを、まとめて to の位置（選んだものを抜いたあとの並びでの番号）へ。 */
export function moveSlides(ids, to) {
  const slides = store.project.slides;
  const cur = slides[store.slideIndex];
  const moving = slides.filter((s) => ids.includes(s.id));
  const rest = slides.filter((s) => !ids.includes(s.id));
  to = Math.max(0, Math.min(to, rest.length));
  store.project.slides = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
  store.slideIndex = store.project.slides.indexOf(cur);
  done();
}

function setFlag(ids, key, value) {
  for (const s of store.project.slides) if (ids.includes(s.id)) { if (value) s[key] = value; else delete s[key]; }
}

export function setSkip(ids, on_) {
  if (on_ && store.project.slides.every((s) => s.skip || ids.includes(s.id))) { toast("すべてのスライドを「描画しない」にはできません。", "warn"); return; }
  for (const s of store.project.slides) if (ids.includes(s.id)) s.skip = on_;
  done();
  emit("slide-skip-changed");
}

export function setAppendix(ids, on_) {
  if (on_ && store.project.slides.every((s) => s.appendix || ids.includes(s.id))) { toast("すべてのスライドを付録にはできません。", "warn"); return; }
  for (const s of store.project.slides) if (ids.includes(s.id)) s.appendix = on_;
  done();
}

/** 選んだスライドを 1 つの章にする（先頭のスライドから章を始め、残りの章の始まりは外す）。name が null なら章の始まりを外す。 */
export function setSection(ids, name) {
  if (name == null) { setFlag(ids, "section", ""); done(); return; }
  setFlag(ids, "section", "");
  const first = store.project.slides.find((s) => ids.includes(s.id));
  if (first) first.section = name;
  done();
}

export function setMaster(ids, mid) {
  const m = findMaster(mid);
  const list = store.project.slides.filter((s) => ids.includes(s.id));
  for (const s of list) s.master = mid || "";
  if (m) syncTitles(m, list);
  done("slide-master");
  emit("refresh-thumbs");
}

// ---------------------------------------------------------------- 右クリックのメニュー

function closeMenu() { menu?.remove(); menu = null; }

export function openSlideMenu(x, y) {
  closeMenu();
  const ids = selectedSlideIds();
  const slides = store.project.slides.filter((s) => ids.includes(s.id));
  const n = ids.length;
  const allSkip = slides.every((s) => s.skip), allApx = slides.every((s) => s.appendix);
  const masters = store.project.masters ?? [];
  menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.innerHTML = `<div class="ctx-title">${n > 1 ? `${n} 枚のスライド` : "スライド"}</div>
    <button data-op="dup"><span>複製</span></button>
    <button data-op="del"><span>削除</span><kbd>${n > 1 ? `${n} 枚` : ""}</kbd></button>
    <hr><button data-op="top"><span>先頭へ移動</span></button><button data-op="end"><span>末尾へ移動</span></button>
    <hr><button data-op="skip"><span>${allSkip ? "描画する" : "描画しない"}</span></button>
    <button data-op="apx"><span>${allApx ? "付録から外す" : "付録にする"}</span></button>
    <button data-op="sec"><span>${n > 1 ? "選んだスライドを 1 つの章にする…" : "ここから新しい章…"}</span></button>
    <button data-op="nosec"><span>章の始まりを外す</span></button>
    <hr><div class="ctx-sub">マスター</div>
    <button data-op="m:"><span>マスターなし</span></button>
    ${masters.map((m) => `<button data-op="m:${escapeHtml(m.id)}"><span>${escapeHtml(m.name)}</span></button>`).join("")}
    ${n > 1 ? `<hr><button data-op="clear"><span>選択を解除</span></button>` : ""}`;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
  menu.addEventListener("click", (e) => {
    const op = e.target.closest("[data-op]")?.dataset.op;
    if (!op) return;
    closeMenu();
    runOp(op, ids);
  });
}

export function runOp(op, ids = selectedSlideIds()) {
  const slides = store.project.slides.filter((s) => ids.includes(s.id));
  if (op === "dup") duplicateSlides(ids);
  else if (op === "del") deleteSlides(ids);
  else if (op === "top") moveSlides(ids, 0);
  else if (op === "end") moveSlides(ids, store.project.slides.length);
  else if (op === "skip") setSkip(ids, !slides.every((s) => s.skip));
  else if (op === "apx") setAppendix(ids, !slides.every((s) => s.appendix));
  else if (op === "sec") {
    const name = prompt("章の名前", slides[0]?.section || "");
    if (name?.trim()) setSection(ids, name.trim());
  } else if (op === "nosec") setSection(ids, null);
  else if (op.startsWith("m:")) setMaster(ids, op.slice(2));
  else if (op === "clear") setSel([store.project.slides[store.slideIndex]?.id]);
  else if (op === "all") setSel(store.project.slides.map((s) => s.id));
}

// ---------------------------------------------------------------- スライド一覧の表示（キャンバスの所）

export const sorterOn = () => document.body.classList.contains("sorter-mode");

export function toggleSorter(on_ = !sorterOn()) {
  if (on_ && store.masterId) return;
  document.body.classList.toggle("sorter-mode", on_);
  $("sorter").hidden = !on_;
  if (on_) { drawSorter(); refreshAllThumbs(); }
  else emit("canvas-resize");
}

function drawSorter() {
  const box = $("so-grid");
  if (!box || !sorterOn() || !store.project) return;
  const plan = pagePlan();
  box.style.setProperty("--tile", `${tile}px`);
  box.innerHTML = store.project.slides.map((s, i) => `
    ${s.section ? `<div class="so-sec">■ ${escapeHtml(s.section)}</div>` : ""}
    <div class="so-tile ${i === store.slideIndex ? "active" : ""} ${s.skip ? "skip" : ""}" data-id="${s.id}" data-index="${i}" draggable="true">
      <span class="thumb" style="background-color:${escapeHtml(store.project.settings.background)};${slideThumb(s.id) ? `background-image:url('${slideThumb(s.id)}')` : ""}"></span>
      <span class="so-no">${i + 1}${plan[i]?.appendix ? `（付録 ${escapeHtml(String(plan[i].number))}）` : ""}</span>
      ${s.skip ? `<span class="sl-skip">描画しない</span>` : ""}
      ${s.master ? `<span class="so-m">${escapeHtml(findMaster(s.master)?.name ?? "")}</span>` : ""}
    </div>`).join("");
  paintSel();
}

function setupSorter() {
  const grid = $("so-grid");
  grid.addEventListener("click", (e) => {
    const t = e.target.closest(".so-tile");
    if (!t) return;
    const i = Number(t.dataset.index);
    if (clickSlide(i, e)) {
      store.slideIndex = i;
      grid.querySelectorAll(".so-tile").forEach((x) => x.classList.toggle("active", x === t));
      renderSlideList();
    }
  });
  grid.addEventListener("dblclick", async (e) => {
    const t = e.target.closest(".so-tile");
    if (!t) return;
    toggleSorter(false);
    await selectSlide(Number(t.dataset.index));
  });
  grid.addEventListener("contextmenu", (e) => {
    const t = e.target.closest(".so-tile");
    if (!t) return;
    e.preventDefault();
    if (!isSlideSelected(t.dataset.id) || (store.slideSel?.size ?? 0) < 2) clickSlide(Number(t.dataset.index), {});
    openSlideMenu(e.clientX, e.clientY);
  });
  slideDrag(grid, ".so-tile", "x");
  $("sorter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-op]");
    if (b && !b.closest(".ctx-menu")) runOp(b.dataset.op);
  });
  $("so-close").addEventListener("click", () => toggleSorter(false));
  $("so-size").addEventListener("input", (e) => {
    tile = Number(e.target.value);
    try { localStorage.setItem("sorterTile", String(tile)); } catch { /* なくてよい */ }
    grid.style.setProperty("--tile", `${tile}px`);
  });
  $("so-size").value = String(tile);
  document.addEventListener("keydown", (e) => {
    if (!sorterOn() || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); deleteSlides(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopPropagation(); runOp("all"); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); e.stopPropagation(); duplicateSlides(); }
    else if (e.key === "Enter") { e.preventDefault(); toggleSorter(false); selectSlide(store.slideIndex); }
    else if (e.key === "Escape") { e.preventDefault(); toggleSorter(false); }
  }, true);
}

/** ドラッグで並べ替え（選んでいるスライドをまとめて動かす）。 */
export function slideDrag(container, selector, axis) {
  let dragIds = null;
  const clear = () => container.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(selector);
    if (!item) return;
    const id = item.dataset.id;
    dragIds = isSlideSelected(id) ? selectedSlideIds() : [id];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragIds.join(","));
  });
  container.addEventListener("dragover", (e) => {
    const item = e.target.closest(selector);
    if (!dragIds || !item) return;
    e.preventDefault();
    clear();
    const r = item.getBoundingClientRect();
    const after = axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    item.classList.add(after ? "drop-after" : "drop-before");
  });
  container.addEventListener("dragleave", (e) => { if (!container.contains(e.relatedTarget)) clear(); });
  container.addEventListener("drop", (e) => {
    const item = e.target.closest(selector);
    if (!dragIds || !item) return;
    e.preventDefault();
    const after = item.classList.contains("drop-after");
    clear();
    const ids = dragIds;
    dragIds = null;
    if (ids.includes(item.dataset.id)) return; // 自分の上に落とした
    // 選んだものを抜いた並びで、落とした所の番号
    const rest = store.project.slides.filter((s) => !ids.includes(s.id));
    let to = rest.findIndex((s) => s.id === item.dataset.id);
    if (after) to += 1;
    moveSlides(ids, to);
  });
  container.addEventListener("dragend", () => { dragIds = null; clear(); });
}

export function setupSlideOps() {
  setupSorter();
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
  on("slides-changed", () => { drawSorter(); paintSel(); });
  // 元に戻す・やり直す（プロジェクトの中身を入れ替える）のあとも、一覧を描き直す。なくなったスライドは選択から外す
  on("project-loaded", () => {
    const ids = new Set((store.project?.slides ?? []).map((s) => s.id));
    store.slideSel = new Set([...(store.slideSel ?? [])].filter((id) => ids.has(id)));
    drawSorter();
    paintSel();
  });
  on("load-project", () => { store.slideSel = new Set(); toggleSorter(false); });
  on("master-mode", (m) => { if (m) toggleSorter(false); });
}
