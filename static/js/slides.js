// 左: スライド一覧（F7）と、中央下: スライド内のステップ順（F6）。

import { renderThumbnail, selectObject, showSlide } from "./canvas.js";
import { stepSummary, syncAnimEditor } from "./animpane.js";
import { clickSlide, isSlideSelected, openSlideMenu, paintSel, slideDrag } from "./slideops.js";
import { allVars, currentSlide, emit, escapeHtml, findTarget, markDirty, on, pagePlan, store, toast, uid } from "./store.js";

const thumbs = new Map(); // slide.id → data URL
const thumbKeys = new Map(); // slide.id → そのサムネイルを描いたときの内容（変わっていなければ描き直さない。スライドが多いときの速さ）
function thumbKey(s, plan) {
  const i = store.project.slides.indexOf(s);
  const m = (store.project.masters ?? []).find((x) => x.id === s.master);
  return `${JSON.stringify(s)}|${JSON.stringify(store.project.settings)}|${JSON.stringify(plan?.[i] ?? null)}|${JSON.stringify(store.macros ?? null)}|${m ? JSON.stringify(m) : ""}`;
}
export const thumbOf = (id) => thumbs.get(id);
let thumbTimer = null;

// ---------------------------------------------------------------- サムネイル

export function scheduleThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const s = currentSlide();
    if (!s || store.masterId) return; // マスターの編集中は、左の一覧（masters.js）が描く
    // 編集中のキャンバスの選択状態に触れないよう、画面外のキャンバスで描く
    try {
      const key = thumbKey(s, pagePlan(store.project));
      thumbs.set(s.id, await renderThumbnail(s));
      thumbKeys.set(s.id, key);
      paintThumb(s.id);
    } catch (e) { console.warn(e); }
  }, 300);
}

function paintThumb(id) {
  for (const li of document.querySelectorAll(`#slide-list li[data-id="${id}"] .thumb, #sorter .so-tile[data-id="${id}"] .thumb`)) {
    li.style.backgroundImage = thumbs.has(id) ? `url("${thumbs.get(id)}")` : "";
  }
}

export async function refreshAllThumbs() {
  const plan = store.project ? pagePlan(store.project) : [];
  for (const s of store.project?.slides ?? []) {
    if (s === currentSlide() && !store.masterId) continue;
    try {
      const key = thumbKey(s, plan);
      if (thumbs.has(s.id) && thumbKeys.get(s.id) === key) { paintThumb(s.id); continue; } // 変わっていない
      thumbs.set(s.id, await renderThumbnail(s));
      thumbKeys.set(s.id, key);
      paintThumb(s.id);
    } catch (e) { console.warn(e); }
  }
  scheduleThumb();
}

// ---------------------------------------------------------------- 一覧

const TRANS_LABEL = { fade: "フェード", wipe: "ワイプ", zoom: "ズーム" };

/** スライドの一覧の小さな印（切り替え効果・初めから自動・ノート）。 */
function slideBadges(s, i) {
  const b = [];
  const k = s.transition?.kind;
  if (i > 0 && k && k !== "none") b.push(`<span title="切り替え効果: ${TRANS_LABEL[k]}">⇄</span>`);
  if (s.autoStart) b.push(`<span title="初めから自動でステップ 1 へ">⏭</span>`);
  if ((s.notes || "").trim() || (s.steps ?? []).some((t) => (t.notes || "").trim())) b.push(`<span title="発表者ノートあり">✎</span>`);
  return b.length ? `<span class="sl-badges">${b.join("")}</span>` : "";
}

export function renderSlideList() {
  const ol = document.getElementById("slide-list");
  const slides = store.project?.slides ?? [];
  const plan = slides.length ? pagePlan(store.project) : [];
  ol.innerHTML = slides.map((s, i) => `
    <li data-id="${s.id}" data-index="${i}" draggable="true" class="${i === store.slideIndex ? "active" : ""} ${s.skip ? "skip" : ""} ${s.appendix ? "appendix" : ""} ${s.section ? "sec-start" : ""}">
      ${s.section ? `<span class="sl-sec" title="ここから新しい章（スライドのパネルの「章・付録・時間」で変えます）">■ ${escapeHtml(s.section)}</span>` : ""}
      <span class="thumb" style="background-color:${escapeHtml(store.project.settings.background)}"></span>
      ${s.appendix ? `<span class="sl-apx" title="付録のスライド（本編の後ろにまとめて描画し、ふだんの「次へ」では入らない）">付録 ${escapeHtml(String(plan[i]?.number ?? ""))}</span>` : ""}
      ${s.skip ? `<span class="sl-skip" title="描画しないスライド（描画・発表・ファイルへの出力に入りません。試し描画はできます）">描画しない</span>` : ""}
      ${slideBadges(s, i)}
      <span class="sl-actions">
        <button data-sl="skip" title="${s.skip ? "描画するスライドに戻す" : "このスライドを描画しない（描画・発表・ファイルへの出力に入れない）"}">${s.skip ? "描画する" : "描画しない"}</button>
        <button data-sl="dup" title="複製">複製</button>
        <button data-sl="del" title="削除">削除</button>
      </span>
    </li>`).join("");
  for (const s of slides) paintThumb(s.id);
  paintSel();
  emit("page-numbers-changed"); // スライドの数・順番が変わると、ページ番号も変わる
}

export async function selectSlide(i) {
  if (!store.project) return;
  if (store.masterId) { // マスターの編集中にスライドを選んだら、編集を終える
    store.masterId = null;
    document.body.classList.remove("master-mode");
    emit("master-mode", false);
    emit("refresh-thumbs");
    store.selectedId = null;
    store.selectedIds = [];
    renderSlideList();
  }
  i = Math.max(0, Math.min(i, store.project.slides.length - 1));
  const sid = store.project.slides[i].id;
  if (!store.slideSel?.has(sid)) store.slideSel = new Set([sid]); // 選んでいない所へ移ったら、選択はそれだけに
  if (i !== store.slideIndex) {
    store.slideIndex = i;
    store.selectedId = null;
    store.selectedIds = [];
    store.enteredGroup = null;
    store.focusStepId = null;
  }
  renderSlideList();
  renderStepChips();
  emit("selection", store.selectedId);
  await showSlide();
  scheduleThumb();
}

export async function addSlide() {
  const slides = store.project.slides;
  const slide = { id: uid("s"), elements: [], steps: [], values: [], camera: null, master: store.project.settings.defaultMaster || "" };
  // マスターに題名の型があれば、題名を置いておく（書くまでは薄く表示し、描画しない: placeholder）
  if (store.project.settings.autoTitle !== false) {
    const { titleTemplate } = await import("./masters.js");
    const { masterOf } = await import("./store.js");
    const tpl = titleTemplate(masterOf(slide));
    if (tpl) {
      const { newShape } = await import("./shapes.js");
      const el = newShape("title", { shape: "title" }, store.meta.canvas.w / 2, 80);
      Object.assign(el, { latex: "題名", fontSize: 48, color: store.project.settings.defaultColor, underline: true, matchWidth: false }, structuredClone(tpl), { placeholder: true });
      slide.elements.push(el);
    }
  }
  slides.splice(store.slideIndex + 1, 0, slide);
  markDirty("slide");
  selectSlide(store.slideIndex + 1);
}

/** 「描画しない」の印を付ける・外す。 */
export function toggleSkip(i, on = null) {
  const sl = store.project.slides[i];
  if (!sl) return;
  const v = on ?? !sl.skip;
  if (v && store.project.slides.every((x, k) => k === i || x.skip)) {
    toast("すべてのスライドを「描画しない」にはできません（描画するスライドが無くなります）。", "warn");
    return;
  }
  sl.skip = v;
  markDirty("slide");
  emit("slides-changed");
  emit("slide-skip-changed");
}

function duplicateSlide(i) {
  const copy = cloneSlide(store.project.slides[i]);
  store.project.slides.splice(i + 1, 0, copy);
  markDirty("slide");
  selectSlide(i + 1);
}

/** スライドの写しを、新しい id・変数名で作る（ほかの要素への参照・コードの中の変数名も付け替える）。複製とスライドの型で使う。 */
export function cloneSlide(src) {
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid("s");
  const idMap = new Map();
  const used = allVars();
  for (const el of copy.elements) {
    const nid = uid("e");
    idMap.set(el.id, nid);
    el.id = nid;
    const base = el.var.replace(/\d+$/, "") || (el.type === "math" ? "eq" : "text");
    let i = 1;
    while (used.has(`${base}${i}`)) i++;
    el.var = `${base}${i}`;
    used.add(el.var);
  }
  const renames = new Map(src.elements.map((e, k) => [e.var, copy.elements[k].var]));
  // グループも新しい id・変数名にする
  const gidMap = new Map();
  for (const g of copy.groups ?? []) {
    const nid = uid("g");
    gidMap.set(g.id, nid);
    idMap.set(g.id, nid);
    const old = g.var;
    const base = old.replace(/\d+$/, "") || "group";
    let k = 1;
    while (used.has(`${base}${k}`)) k++;
    g.var = `${base}${k}`;
    used.add(g.var);
    renames.set(old, g.var);
    g.id = nid;
  }
  for (const el of copy.elements) if (el.groupId) el.groupId = gidMap.get(el.groupId);
  for (const el of copy.elements) if (Array.isArray(el.contentIds)) el.contentIds = el.contentIds.map((id) => idMap.get(id)).filter(Boolean);
  // ほかの要素への参照（座標軸・グラフ・線・元の図形・セルの要素など）も、複製した要素に付け替える
  for (const el of copy.elements) for (const k of ["axesId", "targetId", "graphId", "graph2Id", "line1Id", "line2Id"]) if (el[k]) el[k] = idMap.get(el[k]) ?? el[k];
  for (const el of copy.elements) if (el.onCircle?.id) el.onCircle = { ...el.onCircle, id: idMap.get(el.onCircle.id) ?? el.onCircle.id };
  for (const el of copy.elements) for (const k of ["operandIds", "followIds"]) if (Array.isArray(el[k])) el[k] = el[k].map((id) => idMap.get(id) ?? id);
  for (const el of copy.elements) if (["table", "matrix"].includes(el.shape) && Array.isArray(el.items)) el.items = el.items.map((r) => r.map((id) => (id ? idMap.get(id) ?? null : null)));
  // 変数名を置き換えたので、コード欄の中の旧変数名も置き換える
  const re = renames.size ? new RegExp(`(?<![A-Za-z0-9_.])(${[...renames.keys()].join("|")})(?![A-Za-z0-9_])`, "g") : null;
  for (const st of copy.steps) {
    st.id = uid("t");
    st.elementId = idMap.get(st.elementId) ?? gidMap.get(st.elementId) ?? st.elementId;
    if (re) st.code = (st.code || "").replace(re, (m) => renames.get(m) ?? m);
    for (const r of st.rows ?? []) {
      r.id = uid("r");
      if (r.target) r.target = idMap.get(r.target) ?? gidMap.get(r.target) ?? r.target;
      for (const k of ["to", "path", "elem"]) if (r.params?.[k]) r.params[k] = idMap.get(r.params[k]) ?? r.params[k]; // 引数の要素も複製した要素に
      if (re && r.kind === "code") r.code = (r.code || "").replace(re, (m) => renames.get(m) ?? m);
    }
  }
  return copy;
}

/** スライドのサムネイル（data URL。まだ無ければ ""）。 */
export const slideThumb = (id) => thumbs.get(id) ?? "";

/** スライドの型の中身を、今のスライドのあとに足す。 */
export function insertSlideCopy(src) {
  const copy = cloneSlide({ elements: [], steps: [], groups: [], values: [], camera: null, ...src });
  const i = store.slideIndex;
  store.project.slides.splice(i + 1, 0, copy);
  markDirty("template");
  selectSlide(i + 1);
  return copy;
}

function deleteSlide(i) {
  const slides = store.project.slides;
  const s = slides[i];
  if (s.elements.length && !confirm(`スライド${i + 1}を削除しますか？（要素 ${s.elements.length} 個とステップ ${s.steps.length} 個も削除されます）`)) return;
  slides.splice(i, 1);
  thumbs.delete(s.id);
  if (!slides.length) slides.push({ id: uid("s"), elements: [], steps: [], values: [], camera: null });
  markDirty("slide");
  store.slideIndex = Math.min(store.slideIndex, slides.length - 1);
  store.selectedId = null;
  selectSlide(store.slideIndex);
}

function setupSlideList() {
  const ol = document.getElementById("slide-list");
  ol.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const i = Number(li.dataset.index);
    const act = e.target.closest("[data-sl]")?.dataset.sl;
    if (act === "del") return deleteSlide(i);
    if (act === "dup") return duplicateSlide(i);
    if (act === "skip") return toggleSkip(i);
    if (clickSlide(i, e)) selectSlide(i);
  });
  ol.addEventListener("contextmenu", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    e.preventDefault();
    if (!isSlideSelected(li.dataset.id)) { if (clickSlide(Number(li.dataset.index), {})) selectSlide(Number(li.dataset.index)); }
    openSlideMenu(e.clientX, e.clientY);
  });
  slideDrag(ol, "li", "y"); // 選んでいるスライドは、まとめて動かす
}

// ---------------------------------------------------------------- ステップの順序

export function renderStepChips() {
  const ol = document.getElementById("step-chips");
  const slide = currentSlide();
  syncAnimEditor();
  if (!slide) { ol.innerHTML = ""; return; }
  if (!slide.steps.length) {
    ol.innerHTML = `<li class="empty">ステップはありません。「＋ステップ」か、要素のパネルの「＋出す」「＋消す」「＋強調」で足します。</li>`;
    return;
  }
  const count = {};
  const errStep = store.lastError?.location?.kind === "step" ? store.lastError.location.stepId : null;
  // 発表の仕方の印（くり返す・自動で次へ・ノート）
  const marks = (st) => `${st.loop ? `<span class="pmark" title="次のクリックまでくり返す">⟳</span>` : ""}${st.autoNext ? `<span class="pmark" title="終わったら自動で次へ">⏭</span>` : ""}${(st.notes || "").trim() ? `<span class="pmark" title="発表者ノート: ${escapeHtml(st.notes.trim().slice(0, 80))}">✎</span>` : ""}`;
  ol.innerHTML = slide.steps.map((st, k) => {
    const cls = [st.id === store.focusStepId ? "sel" : "", st.id === errStep ? "err" : "", st.mode === "gui" ? "gui" : "code"].join(" ");
    const sum = stepSummary(st);
    if (sum != null) {
      return `<li draggable="true" data-index="${k}" data-step="${st.id}" class="${cls}" title="クリックでこのステップの動きを開く">
        <span class="n">${k + 1}</span><span>${escapeHtml(sum)}</span>${marks(st)}</li>`;
    }
    const el = findTarget(st.elementId, slide);
    count[st.elementId] = (count[st.elementId] || 0) + 1;
    return `<li draggable="true" data-index="${k}" data-step="${st.id}" class="${cls}" title="クリックでこのステップのコードを開く">
      <span class="n">${k + 1}</span><span class="ctag">コード</span><span>${escapeHtml(el?.var ?? "?")}</span><span class="hint">#${count[st.elementId]}</span>${marks(st)}</li>`;
  }).join("");
}

function setupStepChips() {
  const ol = document.getElementById("step-chips");
  ol.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-step]");
    if (!li) return;
    const st = currentSlide().steps.find((s) => s.id === li.dataset.step);
    if (!st) return;
    store.focusStepId = st.id;
    if (findTarget(st.elementId)) {
      store.selectedId = st.elementId;
      selectObject(st.elementId);
      emit("selection", st.elementId);
    }
    emit("focus-step", st.id);
    renderStepChips();
  });
  dragReorder(ol, "li[data-step]", (from, to) => {
    const steps = currentSlide().steps;
    const [m] = steps.splice(from, 1);
    steps.splice(to, 0, m);
    markDirty("steps");
    renderStepChips();
    emit("steps-changed");
  }, "x");
}

// ---------------------------------------------------------------- 並べ替え（HTML のドラッグ＆ドロップ）

export function dragReorder(container, selector, onMove, axis) {
  let from = null;
  const clear = () => container.querySelectorAll(".drop-before,.drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(selector);
    if (!item) return;
    from = Number(item.dataset.index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(from));
  });
  container.addEventListener("dragover", (e) => {
    const item = e.target.closest(selector);
    if (from === null || !item) return;
    e.preventDefault();
    clear();
    const r = item.getBoundingClientRect();
    const after = axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    item.classList.add(after ? "drop-after" : "drop-before");
  });
  container.addEventListener("dragleave", (e) => { if (!container.contains(e.relatedTarget)) clear(); });
  container.addEventListener("drop", (e) => {
    const item = e.target.closest(selector);
    if (from === null || !item) return;
    e.preventDefault();
    let to = Number(item.dataset.index);
    if (item.classList.contains("drop-after")) to += 1;
    if (to > from) to -= 1;
    clear();
    const f = from;
    from = null;
    if (to !== f) onMove(f, to);
  });
  container.addEventListener("dragend", () => { from = null; clear(); });
}

export function setupSlides() {
  setupSlideList();
  setupStepChips();
  on("canvas-rendered", scheduleThumb);
  on("element-rendered", scheduleThumb);
  on("slide-changed", scheduleThumb);
  on("steps-changed", renderStepChips);
  on("step-chips", renderStepChips);
  on("steps-rows-changed", renderStepChips);
  on("slides-changed", renderSlideList);
  on("selection", () => {
    // 選択された要素のステップを強調する
    renderStepChips();
  });
}
