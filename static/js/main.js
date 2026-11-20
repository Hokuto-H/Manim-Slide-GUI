// 起動処理と、ボタン・キー操作の割り当て。

import { api } from "./api.js";
import { applySelection, fit, initCanvas, refreshElement, scenePointOf, selectObject, setBackground, showSlide } from "./canvas.js";
import { setupClipboard } from "./clipboard.js";
import { setupCam3d } from "./cam3d.js";
import { setupPathTools } from "./pathtools.js";
import { setupShapeMenu } from "./shapes.js";
import { noteUpdated, setupPartMenu } from "./parts.js";
import { addImageFiles, pickImageFiles, setupImages } from "./images.js";
import { addMediaFiles, pickMediaFiles } from "./media.js";
import {
  openEnvDialog, openOpenDialog, openPreambleDialog, refreshOpenRecent, openProjectAt, openProjectDialog, runEnvCheck, setupDialogs,
} from "./dialogs.js";
import { mathReady, setMacros } from "./mathjax.js";
import { renderProps, setupProps } from "./props.js";
import { setupAnimPane } from "./animpane.js";
import { setupNumberSteps } from "./numstep.js";
import { openSlideTemplates, setupSlideTemplates } from "./slidetpl.js";
import { convertBusy, openConvert, setupConvert } from "./convert.js";
import { openRecord, setupRecord } from "./record.js";
import { openBackup, setupBackup } from "./backup.js";
import { openSearch, setupSearch } from "./search.js";
import { openCleanup, setupCleanup } from "./cleanup.js";
import { openRehearsal, setupRehearsal } from "./rehearsal.js";
import { openLint, setupLint } from "./lint.js";
import { closeHelp, helpOpen, openHelp, setupHelp } from "./help.js";
import { setupTutorial } from "./tutorial.js";
import { openPack, openUnpack, setupPortable } from "./portable.js";
import { setupProjectFonts } from "./projfonts.js";
import { setupRefWatch } from "./refs.js";
import { clearTextPreviewCache } from "./textpreview.js";
import { clearShapePreviewCache } from "./shapepreview.js";
import { setupPresets } from "./presets.js";
import { setupTimeline } from "./timeline.js";
import { setupTexPalette } from "./texpalette.js";
import { setupSlideOps, toggleSorter } from "./slideops.js";
import { openOverview, setupOverview } from "./overview.js";
import { setupCompare } from "./bkcompare.js";
import { backgroundOf, openMasters, setupMasters } from "./masters.js";
import { bindRecentActions, recentRow, setupProjectDelete } from "./projdelete.js";
import { canRedo, canUndo, redo, setupHistory, undo } from "./history.js";
import { drawingMode, editingPathId } from "./pathtools.js";
import { deleteSelection, nudgeSelection } from "./selection.js";
import { renderBusy, setupRender, showBottom, updateButtons } from "./render.js";
import { addSlide, refreshAllThumbs, renderSlideList, renderStepChips, selectSlide, setupSlides } from "./slides.js";
import { setupLayers } from "./layers.js";
import { currentSlide, emit, escapeHtml, makeElement, markDirty, on, selectionTarget, store, toast, uid, uniqueVar } from "./store.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- 保存

let saving = null;
let lastSaved = null; // { at: Date, auto: bool }
async function save(auto = false) {
  if (!store.project) return false;
  if (lockedOut) { if (!auto) showLockBanner(lockedOut); return false; } // 別のタブで別のプロジェクトを開いたあとは保存しない
  if (saving) {
    // 自動保存の途中に手動で保存したときは、終わってから、まだ変更があればもう一度保存する
    const ok = await saving;
    return ok && store.dirty && !auto ? save(false) : ok;
  }
  const project = store.project;
  const rev = store.rev ?? 0;
  saving = (async () => {
    try {
      const r = await api.put("/api/project", project);
      if (store.project !== project) return true; // 保存の途中で、別のプロジェクトを開いた
      // 保存の途中に変更が無ければ、サーバー側で補われた項目を反映して「保存済み」にする（選択中の状態は保つ）
      if ((store.rev ?? 0) === rev) {
        store.project.settings = r.project.settings;
        store.dirty = false;
      }
      lastSaved = { at: new Date(), auto };
      emit("dirty", "saved");
      return true;
    } catch (e) {
      toast(`${auto ? "自動保存" : "保存"}できませんでした: ${e.message}`, "ng", 6000);
      return false;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

// ---------------------------------------------------------------- 自動保存
// 変更が止まって delay 秒たったら保存する（変え続けていても、最初の変更から 30 秒たったら保存する）。

let autoCfg = { autosave: true, delay: 3 };
let autoTimer = null;
let firstDirtyAt = 0;
function setAutosave(cfg) {
  autoCfg = { ...autoCfg, ...cfg };
  scheduleAutosave();
  emit("dirty", "autosave-config");
}
function scheduleAutosave() {
  clearTimeout(autoTimer);
  if (!autoCfg.autosave || !store.project || !store.dirty || lockedOut) { firstDirtyAt = 0; return; }
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  const wait = Math.max(200, Math.min(autoCfg.delay * 1000, firstDirtyAt + 30000 - now));
  autoTimer = setTimeout(async () => {
    if (!store.dirty || !autoCfg.autosave) return;
    // マウスのボタンを押している（ドラッグ中）間は待つ
    if (pointerDown) { scheduleAutosave(); return; }
    firstDirtyAt = 0;
    await save(true);
    if (store.dirty) scheduleAutosave();
  }, wait);
}
let pointerDown = false;
window.addEventListener("pointerdown", () => { pointerDown = true; }, true);
window.addEventListener("pointerup", () => { pointerDown = false; if (store.dirty) scheduleAutosave(); }, true);
window.addEventListener("pointercancel", () => { pointerDown = false; }, true);

// ---------------------------------------------------------------- プロジェクトの読み込み

// ---------------------------------------------------------------- 別のタブで別のプロジェクトを開いたとき（B1）
// サーバーが開くプロジェクトは 1 つなので、このタブの保存などを止める。サーバーでも照らし合わせて断る（app/main.py）。
const TAB_ID = Math.random().toString(36).slice(2);
let lockedOut = null;
const tabs = "BroadcastChannel" in window ? new BroadcastChannel("manim-slide-gui-tabs") : null;
tabs?.addEventListener("message", (ev) => {
  const m = ev.data || {};
  if (m.type === "opened" && m.tab !== TAB_ID && store.project && m.folder !== store.folder) {
    lockOut(`別のタブ（またはウィンドウ）で、別のプロジェクト「${m.name || m.folder}」を開きました。このタブの「${store.project.settings?.name || ""}」を上書きから守るため、このタブでの保存などを止めました。`);
  }
});
window.addEventListener("project-mismatch", (ev) => lockOut(ev.detail));

function lockOut(message) {
  lockedOut = message;
  clearTimeout(autoTimer);
  showLockBanner(message);
}

function showLockBanner(message) {
  let b = document.getElementById("lock-banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "lock-banner";
    b.className = "lock-banner";
    document.body.appendChild(b);
  }
  b.innerHTML = `<div><b>このタブでは保存できません</b><br>${escapeHtml(message)}${store.dirty ? "<br><b>このタブには、まだ保存していない変更があります。</b>" : ""}</div>
    <div class="row"><button type="button" class="primary" data-a="reclaim" title="このタブのプロジェクトを開き直し、このタブの内容で保存します（別のタブの方は保存できなくなります）">このタブで作業を続ける</button>
    <button type="button" data-a="close" title="このタブを閉じて、別のタブで作業します">このタブを閉じる</button></div>`;
  b.hidden = false;
  b.onclick = async (ev) => {
    const a = ev.target.closest("button")?.dataset.a;
    if (a === "close") { lockedOut = null; store.dirty = false; window.close(); toast("ブラウザがこのタブを閉じさせなかったので、手で閉じてください。", "", 6000); }
    if (a === "reclaim") await reclaimProject();
  };
}

/** このタブのプロジェクトを、サーバーで開き直し、このタブの内容で保存する。 */
async function reclaimProject() {
  const project = store.project, dirty = store.dirty;
  try {
    await api.post("/api/project/open", { folder: store.folder });
    lockedOut = null;
    document.getElementById("lock-banner")?.remove();
    tabs?.postMessage({ type: "opened", tab: TAB_ID, folder: store.folder, name: project.settings?.name });
    store.project = project; // 開き直しで読んだ内容ではなく、このタブの内容を保つ
    store.dirty = true;
    await save(false);
    if (!dirty) store.dirty = false;
    toast("このタブで作業を続けます。このタブの内容で保存しました。");
  } catch (e) {
    toast(`開き直せませんでした: ${e.message}`, "ng", 8000);
  }
}

async function loadProject(payload) {
  window.PROJECT_FOLDER = payload.folder;
  lockedOut = null;
  document.getElementById("lock-banner")?.remove();
  tabs?.postMessage({ type: "opened", tab: TAB_ID, folder: payload.folder, name: payload.project?.settings?.name });
  store.folder = payload.folder;
  store.project = payload.project;
  store.preamble = payload.preamble;
  store.macros = payload.macros;
  store.slideIndex = 0;
  store.selectedId = null;
  store.selectedIds = [];
  store.enteredGroup = null;
  store.focusStepId = null;
  store.lastError = null;
  store.dirty = false;
  $("welcome").hidden = true;
  $("bottom-panel").hidden = true;
  updateProjectUi();
  emit("dirty", "loaded");
  store.macrosApplied = applyMacros(false);
  await store.macrosApplied;
  renderSlideList();
  await selectSlide(0);
  emit("project-loaded");
  refreshAllThumbs();
  document.title = `${store.project.settings.name} — Manim Slide GUI`;
}

/** 元に戻す・やり直す: 履歴の写しを、いまのプロジェクトにして画面を作り直す。 */
async function restoreProject(project, view, reason = "undo") {
  store.project = project;
  store.slideIndex = Math.max(0, Math.min(view.slideIndex ?? 0, project.slides.length - 1));
  const slide = project.slides[store.slideIndex];
  const has = (id) => slide.elements.some((e) => e.id === id) || (slide.groups ?? []).some((g) => g.id === id);
  store.selectedIds = (view.selectedIds ?? []).filter(has);
  store.selectedId = selectionTarget(store.selectedIds);
  store.enteredGroup = null;
  store.focusStepId = slide.steps.some((s) => s.id === view.focusStepId) ? view.focusStepId : null;
  markDirty(reason);
  renderSlideList();
  await showSlide();
  applySelection(store.selectedIds);
  emit("project-loaded");
  emit("selection", store.selectedId);
  renderStepChips();
  refreshAllThumbs();
}

async function applyMacros(rerender = true) {
  try {
    store.mathWarnings = await setMacros(store.macros);
  } catch (e) {
    console.warn(e);
    store.mathWarnings = [];
  }
  if (store.mathWarnings.length || store.macros?.unsupported?.length) {
    const n = store.mathWarnings.length + (store.macros.unsupported?.length ?? 0);
    toast(`共通プリアンブルに、仮表示では展開できない定義が ${n} 個あります（描画には反映されます）。`, "warn", 5000);
  }
  if (rerender && store.project) {
    await showSlide();
    refreshAllThumbs();
  }
}

function updateProjectUi() {
  const has = !!store.project;
  document.querySelectorAll("[data-needs-project]").forEach((b) => {
    if (!["btn-render", "btn-present", "btn-slide-preview"].includes(b.id)) b.disabled = !has;
  });
  $("status-project").textContent = has ? `${store.project.settings.name}  —  ${store.folder}` : "プロジェクト未選択";
  updateButtons();
}

// ---------------------------------------------------------------- 要素の追加

async function addElement(type) {
  const slide = currentSlide();
  if (!slide) return;
  const s = store.project.settings;
  const { w, h } = store.meta.canvas;
  const offset = (slide.elements.length % 6) * 40;
  const el = makeElement(type, w / 2 + offset, h / 2 + offset);
  slide.elements.push(el);
  store.selectedId = el.id;
  store.focusStepId = null;
  markDirty("add");
  await refreshElement(el);
  selectObject(el.id);
  emit("selection", el.id);
  // 内容の入力欄にすぐ入力できるようにする
  if (type === "math") {
    const input = document.querySelector("#props textarea.latex");
    input?.focus();
    input?.select();
  } else {
    const area = document.querySelector("#props .rt-area");
    if (area) {
      area.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(area);
    }
  }
}

// ---------------------------------------------------------------- 操作の割り当て

const actions = {
  new: () => openProjectDialog("new"),
  open: () => openOpenDialog(),
  save: async () => { if (await save()) toast("保存しました。"); },
  settings: () => openProjectDialog("settings"),
  preamble: () => openPreambleDialog(),
  env: () => { openEnvDialog(); if (!store.env) runEnvCheck(false); },
  export: () => emit("action:export"),
  render: () => emit("action:render"),
  present: () => emit("action:present"),
  "preview-slide": () => emit("action:preview-slide"),
  "add-slide": () => addSlide(),
  "add-text": () => addElement("text"),
  "add-math": () => addElement("math"),
  "add-image": async () => { const files = await pickImageFiles(); if (files.length) addImageFiles(files); },
  "add-media": async () => { const files = await pickMediaFiles(); if (files.length) addMediaFiles(files); },
  undo: () => undo(),
  "slide-templates": () => openSlideTemplates(),
  convert: () => openConvert(),
  record: () => openRecord(),
  backup: () => openBackup(),
  search: () => openSearch(),
  cleanup: () => openCleanup(),
  masters: () => openMasters(),
  overview: () => openOverview(),
  sorter: () => toggleSorter(),
  pack: () => openPack(),
  unpack: () => openUnpack(),
  rehearsal: () => openRehearsal(),
  lint: () => openLint(),
  help: () => (helpOpen() ? closeHelp() : openHelp()),
  tutorial: () => emit("action:tutorial"),
  redo: () => redo(),
  "close-bottom": () => { $("bottom-panel").hidden = true; requestAnimationFrame(fit); },
  "show-bottom": () => { showBottom("log"); requestAnimationFrame(fit); },
};

function setupActions() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (fn) { e.preventDefault(); fn(); }
  });
  document.addEventListener("keydown", (e) => {
    const inField = e.target.closest("input, textarea, select, [contenteditable]");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (store.project) actions.save();
      return;
    }
    // Ctrl+Enter: このスライドを試す（F11 は Windows のブラウザが全画面に使うので使わない）。入力欄の中でも、欄の変更を決めてから試す
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.shiftKey && !e.altKey && store.project && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      if (inField) inField.blur();
      setTimeout(() => emit("action:preview-slide"), 50);
      return;
    }
    if (inField || document.querySelector("dialog[open]")) return;
    // 元に戻す・やり直す（入力欄の中では、その欄の元に戻すを使う。線を描いている途中は、描いた線を 1 本ずつ戻す）
    if ((e.ctrlKey || e.metaKey) && !e.altKey && store.project && !drawingMode() && !editingPathId()) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }
    if ((e.key === "Delete" || e.key === "Backspace") && store.selectedIds.length) {
      e.preventDefault();
      deleteSelection();
    }
    // 矢印キーで選択中の物を動かす（Shift で 10px ずつ）
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (arrow && store.selectedIds.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudgeSelection(arrow[0] * d, arrow[1] * d);
    }
  });
  window.addEventListener("beforeunload", (e) => {
    // 未保存の変更・描画や出力の最中は、閉じる前に確かめる（アプリの窓を閉じるとアプリも終わるため）
    if (store.dirty || renderBusy() || convertBusy()) { e.preventDefault(); e.returnValue = ""; }
  });
  // アプリの窓が開いている間、サーバーとつないでおく（窓をすべて閉じると、起動用のプログラムがアプリを終える）
  try { new EventSource(`/alive?t=${encodeURIComponent(window.APP_TOKEN)}`); } catch { /* 無くても編集はできる */ }
  new MutationObserver(() => requestAnimationFrame(fit)).observe($("bottom-panel"), { attributes: true, attributeFilter: ["hidden"] });
}

async function showRecent() {
  const cfg = await api.get("/api/userconfig").catch(() => null);
  const list = cfg?.recentProjects ?? [];
  $("recent-list").innerHTML = list.length
    ? `<li class="hint">最近のプロジェクト</li>` + list.map((p) => recentRow(p, "data-recent")).join("")
    : "";
  $("recent-list").querySelectorAll("[data-recent]").forEach((b) => b.addEventListener("click", async () => {
    try { await openProjectAt(b.dataset.recent); } catch (e) { toast(e.message, "ng", 6000); }
  }));
}

// ---------------------------------------------------------------- 起動

async function boot() {
  store.meta = await api.get("/api/meta");
  initCanvas($("slide-canvas"), $("stage"));
  setupCam3d(); // 3D のカメラをマウスで動かす（中ボタン・Shift＋中ボタン・Ctrl＋ホイール）
  setupDialogs();
  setupSlides();
  setupLayers();
  setupClipboard();
  setupShapeMenu($("btn-add-shape"));
  setupPartMenu($("btn-add-part"));
  setupPathTools();
  setupImages({ stage: $("stage"), toScene: scenePointOf });
  setupProps();
  setupAnimPane();
  setupNumberSteps();
  setupHistory(restoreProject);
  setupSlideTemplates();
  on("history-changed", () => { $("btn-undo").disabled = !canUndo(); $("btn-redo").disabled = !canRedo(); });
  setupRender(save);
  store.saveNow = save; // 点検など、保存した project.json を調べる処理の前に、未保存の変更を保存する
  setupConvert(save);
  setupRecord(save);
  setupBackup({ save, loadProject, setAutosave });
  setupSearch(restoreProject);
  setupCleanup(save);
  setupProjectDelete();
  setupPresets();
  setupTimeline();
  setupTexPalette();
  setupSlideOps();
  setupOverview();
  setupCompare();
  setupMasters();
  on("refresh-thumbs", () => refreshAllThumbs());
  bindRecentActions($("recent-list"));
  on("recent-changed", () => { showRecent(); refreshOpenRecent(); });
  setupProjectFonts();
  setupRefWatch(on, (e) => refreshElement(e));
  on("fonts-changed", () => {
    if (!store.project) return;
    clearTextPreviewCache();
    clearShapePreviewCache();
    renderProps();
    showSlide().then(() => applySelection(store.selectedIds));
    emit("refresh-thumbs");
  });
  setupPortable(save, (p) => emit("load-project", p), () => { openEnvDialog(); runEnvCheck(false); });
  document.getElementById("op-unpack").addEventListener("click", () => { document.getElementById("dlg-open").close(); openUnpack(); });
  setupRehearsal(save);
  setupLint();
  setupHelp();
  setupTutorial();
  setupActions();
  updateProjectUi();
  renderProps();

  on("load-project", (p) => loadProject(p).then(() => noteUpdated(p.partsUpdated)).catch((e) => toast(e.message, "ng")));
  on("dirty", (reason) => {
    const d = $("status-dirty");
    if (reason === "loaded") lastSaved = null;
    const hm = (t) => `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    d.textContent = store.dirty ? (autoCfg.autosave ? "● 未保存の変更（自動で保存します）" : "● 未保存の変更があります")
      : !store.project ? "" : lastSaved ? `${lastSaved.auto ? "自動保存しました" : "保存しました"}（${hm(lastSaved.at)}）` : "保存済み";
    d.title = autoCfg.autosave ? `自動保存: オン（変更が止まって ${autoCfg.delay} 秒後）。「バックアップ」で変えられます。` : "自動保存: オフ。「バックアップ」で変えられます。";
    d.className = store.dirty ? "dirty" : "";
    if (store.dirty) scheduleAutosave();
  });
  on("settings-changed", async ({ background, use3d, texFont }) => {
    if (texFont) {
      // LaTeX の書体が変わった: プレビューはサーバーが保存した設定から書体を決めるので、先に保存してから描き直す
      try { await save(true); } catch { /* 保存できなくても描き直しは試す */ }
      await showSlide();
      refreshAllThumbs();
    }
    if (use3d) {
      // 3D の切り替え: スライドのカメラの欄・オレンジの枠・3D の要素の表示が変わる
      await showSlide();
      renderProps();
    }
    // 定理の種類の名前・色が変わったかもしれない: 今のスライドの定理を描き直す
    for (const e of currentSlide()?.elements ?? []) if (e.type === "shape" && e.shape === "theorem") refreshElement(e);
    if (background) {
      setBackground(backgroundOf(currentSlide()));
      renderSlideList();
      refreshAllThumbs();
    }
    await save();
    toast("プロジェクト設定を変更しました。");
  });
  on("preamble-changed", () => { store.macrosApplied = applyMacros(true); });

  // ライブラリの読み込みを待つ
  try { await mathReady(); } catch (e) { toast(e.message, "ng", 8000); }
  if (!window.fabric) toast("Fabric.js を読み込めませんでした。static/vendor を確認してください。", "ng", 8000);

  // フォントの導入状況（F15）
  api.get("/api/fonts").then((f) => { store.fonts = f; if (store.project) renderProps(); }).catch(() => {});

  if (store.meta.project) await loadProject(store.meta.project);
  else showRecent();

  // 起動時の環境チェック（F16）。必須項目が欠けていれば、一覧を開いて知らせる
  const env = await runEnvCheck(false);
  if (env && !env.renderReady) openEnvDialog();
}

boot().catch((e) => {
  console.error(e);
  toast(`起動に失敗しました: ${e.message}`, "ng", 10000);
});
