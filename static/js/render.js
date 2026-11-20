// 書き出し（F8）、描画・発表（F12）、エラー位置の表示（F17）。

import { api } from "./api.js";
import { lintGate } from "./lint.js";
import { selectObject } from "./canvas.js";
import { openPreambleDialog } from "./dialogs.js";
import { renderStepChips, selectSlide, thumbOf } from "./slides.js";
import { openPlayer } from "./slideplayer.js";
import { emit, escapeHtml, on, pagePlan, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let saveFn = null;
let pollTimer = null;
let currentJob = null;
/** 描画の最中か（窓を閉じる前の確認に使う）。 */
export const renderBusy = () => !!currentJob;

// ---------------------------------------------------------------- 下部パネル

export function showBottom(tab = "error") {
  $("bottom-panel").hidden = false;
  document.querySelectorAll(".bp-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll("[data-tab-body]").forEach((b) => { b.hidden = b.dataset.tabBody !== tab; });
  $("status-log-btn").hidden = false;
}

function setStatus(text, cls = "", ratio = null) {
  const s = $("status-render");
  s.textContent = text;
  s.className = cls;
  const bar = $("status-progress");
  bar.hidden = ratio === null;
  if (ratio !== null) bar.value = ratio;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60), r = sec % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分`;
}

/** 描画中の進み具合（ステータスバーと、下のパネル）。 */
function showProgress(job) {
  const p = job.progress;
  const elapsed = fmtTime(job.elapsed);
  if (!p) {
    setStatus(`描画の準備中…（${elapsed}）`, "running", 0);
    $("error-body").innerHTML = `<div class="progress-box"><div>Manim を読み込んで、描画の準備をしています…（経過 ${elapsed}）</div></div>`;
    return;
  }
  const pct = Math.floor(p.overall * 100);
  let eta = "";
  if (p.stage === "render" && p.overall >= 0.05 && job.elapsed >= 5) {
    eta = `・残り約 ${fmtTime(job.elapsed * (1 - p.overall) / p.overall)}`;
  }
  let detail;
  if (p.stage === "combine") {
    setStatus(`描画中 100%・動画をつなげています…（${elapsed}）`, "running", 1);
    detail = `<div>アニメーションの描画が終わりました。動画をつなげています…</div>`;
  } else if (p.stage === "slides") {
    setStatus(`描画中 100%・発表用の動画を作っています…（${elapsed}）`, "running", 1);
    detail = `<div>発表用の動画を作っています（スライドごとに、逆再生用の動画も作ります）…</div>`;
  } else {
    setStatus(`描画中 ${pct}%${eta}（${elapsed}）`, "running", p.overall);
    detail = `
      <div class="pg-row"><span class="pg-label">全体</span><progress max="1" value="${p.overall}"></progress><span class="pg-num">${pct}%</span></div>
      <div class="pg-row"><span class="pg-label">いまの動き</span><progress max="1" value="${p.animation}"></progress><span class="pg-num">${Math.floor(p.animation * 100)}%</span></div>
      <div>${escapeHtml(p.label)}（クリックの区切り ${p.segment} / ${p.segments}、これまでの動き ${p.animations} 個）</div>`;
  }
  $("error-body").innerHTML = `<div class="progress-box">${detail}<div class="hint">経過 ${elapsed}${eta}。全体の割合は、クリックの区切りの数から求めた目安です。</div></div>`;
}

// ---------------------------------------------------------------- 書き出し

async function doExport() {
  if (!(await saveFn())) return null;
  try {
    const include = renderInclude();
    const r = await api.post("/api/export", include ? { include } : {});
    toast(`書き出しました: ${r.py}`);
    return r;
  } catch (e) {
    if (e.status === 422 && e.detail?.problems) showProblems(e.detail.problems);
    else toast(e.message, "ng", 6000);
    return null;
  }
}

function showProblems(problems) {
  store.lastError = null;
  $("error-body").innerHTML = `<div class="err-title">書き出し前の検査でエラーが見つかりました</div>
    <ul class="err-list">${problems.map((p, i) => `<li>${escapeHtml(p.message)} ${p.elementId ? `<button class="link" data-prob="${i}">この要素へ移動</button>` : ""}</li>`).join("")}</ul>`;
  $("error-body").querySelectorAll("[data-prob]").forEach((b) => b.addEventListener("click", () => {
    const p = problems[Number(b.dataset.prob)];
    goToElement(p.slideIndex, p.elementId);
  }));
  showBottom("error");
}

// ---------------------------------------------------------------- 描画するスライド（今回だけ選ぶ）

let pickedIds = null; // 「選んで描画…」で選んだスライドの id（並べ替え・追加・削除のあとも、選んだスライドを指すように）

/** 今回描画するスライドの番号。印の通りなら null（サーバーが「描画しない」の印から決める）。 */
function renderInclude() {
  const mode = $("render-range").value;
  const slides = store.project?.slides ?? [];
  if (mode === "current") return [store.slideIndex];
  if (mode === "picked" && pickedIds) return slides.flatMap((sl, i) => (pickedIds.has(sl.id) ? [i] : []));
  return null;
}

function updateRangeSelect() {
  const sel = $("render-range");
  const slides = store.project?.slides ?? [];
  const nMark = slides.filter((s) => !s.skip).length;
  sel.querySelector("[value=mark]").textContent = `描画: 印の通り（${nMark} / ${slides.length} 枚）`;
  const picked = sel.querySelector("[value=picked]");
  const n = pickedIds ? slides.filter((sl) => pickedIds.has(sl.id)).length : 0;
  picked.hidden = !pickedIds;
  picked.textContent = `描画: 選んだ ${n} 枚`;
  if (!pickedIds && sel.value === "picked") sel.value = "mark";
}

function openRangeDialog() {
  const dlg = $("dlg-range");
  const slides = store.project?.slides ?? [];
  const plan0 = new Set(slides.flatMap((s, i) => (pickedIds ? pickedIds.has(s.id) : !s.skip) ? [i] : []));
  const list = $("rg-list");
  list.innerHTML = slides.map((s, i) => {
    const t = thumbOf(s.id);
    return `<li><label><input type="checkbox" data-i="${i}" ${plan0.has(i) ? "checked" : ""}>
      <span class="rg-no">${i + 1}</span><span class="rg-thumb" style="background-color:${escapeHtml(store.project.settings.background)};${t ? `background-image:url('${t}')` : ""}"></span>
      ${s.skip ? `<span class="hint">（描画しないの印）</span>` : ""}<span class="hint rg-page" data-page="${i}"></span></label></li>`;
  }).join("");
  const boxes = () => [...list.querySelectorAll("input[data-i]")];
  const refresh = () => {
    const inc = boxes().filter((b) => b.checked).map((b) => Number(b.dataset.i));
    const plan = pagePlan(store.project, inc);
    list.querySelectorAll("[data-page]").forEach((sp) => { const i = Number(sp.dataset.page); sp.textContent = inc.includes(i) ? `→ ${plan[i].number} ページ` : ""; });
    $("rg-count").textContent = `${inc.length} / ${slides.length} 枚`;
    $("rg-ok").disabled = !inc.length;
  };
  list.onchange = refresh;
  dlg.querySelector("[data-a=all]").onclick = () => { boxes().forEach((b) => { b.checked = true; }); refresh(); };
  dlg.querySelector("[data-a=none]").onclick = () => { boxes().forEach((b) => { b.checked = false; }); refresh(); };
  dlg.querySelector("[data-a=mark]").onclick = () => { boxes().forEach((b) => { b.checked = !slides[Number(b.dataset.i)].skip; }); refresh(); };
  $("rg-ok").onclick = () => {
    const inc = boxes().filter((b) => b.checked).map((b) => Number(b.dataset.i));
    pickedIds = new Set(inc.map((i) => slides[i].id));
    updateRangeSelect();
    $("render-range").value = "picked";
    dlg.close();
  };
  dlg.onclose = () => { updateRangeSelect(); if ($("render-range").value === "pick") $("render-range").value = pickedIds ? "picked" : "mark"; };
  refresh();
  dlg.showModal();
}

// ---------------------------------------------------------------- 描画・発表

/** 発表ウィンドウを開いた結果を知らせる。音声の出力先が無いときは、開けても注意を長めに出す。 */
function presentToast(r) {
  if (r.ok && r.warn) { toast(`${r.message}${r.warn}`, "warn", 12000); setStatus(r.warn, "ng"); return; }
  toast(r.message, r.ok ? "" : "ng", 6000);
}

/** 発表ウィンドウが開けなかったときのログから、考えられる原因を出す（音声の出力先が無いと、Qt の動画の再生が止まる）。 */
function presentHint(log) {
  const t = String(log ?? "");
  const audio = /pipewire|pw\.conf|pulseaudio|pulse|alsa|QAudio|qt\.multimedia|Segmentation fault|終了コード -11|code -11|0xC0000005/i.test(t);
  if (!audio) return "";
  return `<p class="hint">音声の出力先（スピーカー・イヤホン・音声のサービス）が見つからない可能性があります。発表ウィンドウは動画の再生に音声の出力先を使うので、出力先が無いと起動の途中で止まることがあります。出力デバイスを確かめてから、もう一度「発表のみ」を押してください（「環境チェック」の「音声の出力先」でも確かめられます）。</p>`;
}

async function doRender() {
  if (currentJob) return;
  if (!(await saveFn())) return;
  const quality = $("render-quality").value;
  const present = $("present-after").checked;
  if (present && !(await lintGate("render"))) return; // 発表の前の点検
  store.lastError = null;
  renderStepChips();
  emit("steps-changed");
  try {
    const include = renderInclude();
    if (include && !include.length) { toast("描画するスライドがありません。", "warn"); return; }
    const job = await api.post("/api/render", { quality, present, ...(include ? { include } : {}) });
    currentJob = job.id;
    if (job.notice) toast(job.notice, "", 12000); // 「ずっと回す」の 1 周を描く（3D は時間がかかる）
    $("render-log").textContent = "";
    $("error-body").innerHTML = `<span class="hint">描画中です…</span>`;
    setStatus("描画の準備中…", "running", 0);
    $("status-render").title = "クリックで詳しい進み具合を表示";
    updateButtons();
    poll();
  } catch (e) {
    if (e.status === 422 && e.detail?.problems) showProblems(e.detail.problems);
    else toast(e.message, "ng", 6000);
  }
}

async function poll() {
  clearTimeout(pollTimer);
  if (!currentJob) return;
  let job;
  try {
    job = await api.get(`/api/render/${currentJob}`);
  } catch (e) {
    setStatus(`描画の状態を取得できません: ${e.message}`, "ng");
    currentJob = null;
    updateButtons();
    return;
  }
  const logEl = $("render-log");
  const atBottom = logEl.parentElement.scrollTop + logEl.parentElement.clientHeight >= logEl.parentElement.scrollHeight - 20;
  logEl.textContent = job.log;
  if (atBottom) logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
  if (job.status === "running") {
    showProgress(job);
    pollTimer = setTimeout(poll, 800);
    return;
  }
  currentJob = null;
  updateButtons();
  if (job.status === "ok") {
    setStatus(`${job.kind === "slide" ? `試し描画（スライド ${job.slideIndex + 1}）` : "描画"}完了（${fmtTime(job.elapsed)}）`, "ok");
    $("error-body").innerHTML = `<span class="hint">エラーはありません。</span>`;
    if (job.kind === "slide") {
      openPlayer(job.slideIndex, doSlidePreview, { startClick: pendingStartClick });
      pendingStartClick = 0;
    } else if (job.present) {
      presentToast(job.present);
      if (!job.present.ok && job.present.log) {
        $("error-body").innerHTML = `<div class="err-title">発表ウィンドウを開けませんでした</div>${presentHint(job.present.log)}<pre>${escapeHtml(job.present.log)}</pre>`;
        showBottom("error");
      }
    } else {
      toast("描画が完了しました。");
    }
  } else if (job.status === "cancelled") {
    setStatus("描画を中止しました");
  } else {
    setStatus("描画でエラー", "ng");
    showRenderError(job.error);
  }
}

function showRenderError(err) {
  store.lastError = err;
  const loc = err?.location;
  const tex = err?.tex;
  const texList = tex?.errors?.length ? `<div><b>LaTeX のエラー:</b><ul class="err-list">${tex.errors.map((e) =>
    `<li>${escapeHtml(e.message)}${e.context ? ` <code>${escapeHtml(e.context)}</code>` : ""}</li>`).join("")}</ul></div>` : "";
  $("error-body").innerHTML = `
    <div class="err-title">描画でエラーが起きました</div>
    <div class="err-loc">${escapeHtml(err?.summary || "")} ${loc ? `<button class="link" id="err-goto">該当箇所へ移動</button>` : ""}</div>
    <div class="err-msg">${escapeHtml(err?.message || "")}</div>
    ${err?.hint ? `<div class="err-hint">対処: ${escapeHtml(err.hint)}</div>` : ""}
    ${err?.texHint ? `<div class="err-hint">対処: ${escapeHtml(err.texHint)}</div>` : ""}
    ${texList}
    <details ${loc ? "" : "open"}><summary>トレースバックの全文${err?.pyLine ? `（生成した .py の ${err.pyLine} 行目）` : ""}</summary><pre>${escapeHtml(err?.traceback || "")}</pre></details>`;
  $("err-goto")?.addEventListener("click", () => goToError());
  showBottom("error");
  renderStepChips();
  goToError();
}

function goToError() {
  const loc = store.lastError?.location;
  if (!loc) return;
  if (loc.kind === "preamble") {
    openPreambleDialog(loc.preambleLine);
    return;
  }
  if (loc.slideIndex == null) return;
  goToElement(loc.slideIndex, loc.elementId, loc.kind === "step" ? loc.stepId : null);
}

async function goToElement(slideIndex, elementId, stepId = null) {
  await selectSlide(slideIndex);
  if (!elementId) return;
  store.selectedId = elementId;
  store.focusStepId = stepId;
  selectObject(elementId);
  emit("selection", elementId);
  if (stepId) emit("focus-step", stepId);
  renderStepChips();
}

let pendingStartClick = 0; // 試し描画が終わったら、このクリック（ステップ）から見せる

/** 「このステップを試す」: スライドを試し描画して、そのステップ（k 回目のクリック）の区切りから見せる。 */
export function previewStep(k) {
  if (currentJob) { toast("描画中です。終わってから試してください。", "warn"); return; }
  pendingStartClick = k;
  doSlidePreview();
}

/** 編集中のスライドだけを低画質で描画して、小窓で確認する（Ctrl+Enter）。 */
async function doSlidePreview() {
  if (currentJob) return;
  if (!(await saveFn())) return;
  const si = store.slideIndex ?? 0;
  store.lastError = null;
  renderStepChips();
  try {
    const job = await api.post("/api/preview/slide", { slideIndex: Math.max(0, si), quality: "low" });
    currentJob = job.id;
    $("render-log").textContent = "";
    $("error-body").innerHTML = `<span class="hint">スライド ${Math.max(0, si) + 1} を試し描画しています…</span>`;
    setStatus("試し描画の準備中…", "running", 0);
    updateButtons();
    poll();
  } catch (e) {
    if (e.status === 422 && e.detail?.problems) showProblems(e.detail.problems);
    else toast(e.message, "ng", 6000);
  }
}

let presenting = false;
async function doPresent() {
  if (presenting) return; // 起動に数秒かかる間に、続けて押されても二重に開かない
  presenting = true;
  if (saveFn && !(await saveFn())) { presenting = false; return; }
  if (!(await lintGate("present"))) { presenting = false; return; } // 発表の前の点検
  updateButtons();
  setStatus("発表ウィンドウを起動しています…", "running");
  try {
    const r = await api.post("/api/present");
    setStatus(r.ok ? "" : "発表ウィンドウを開けませんでした", r.ok ? "" : "ng");
    presentToast(r);
    if (!r.ok && r.log) {
      $("error-body").innerHTML = `<div class="err-title">発表ウィンドウを開けませんでした</div>${presentHint(r.log)}<pre>${escapeHtml(r.log)}</pre>`;
      showBottom("error");
    }
  } catch (e) {
    setStatus("");
    toast(e.message, "ng");
  } finally {
    presenting = false;
    updateButtons();
  }
}

export function updateButtons() {
  const env = store.env;
  const hasProject = !!store.project;
  const rb = $("btn-render");
  const pb = $("btn-present");
  const ready = env?.renderReady;
  rb.disabled = !hasProject || !ready || !!currentJob;
  pb.disabled = !hasProject || !env?.presentReady || !!currentJob || presenting;
  pb.textContent = presenting ? "起動中…" : "発表のみ";
  rb.textContent = currentJob ? "描画中…" : "▶ 描画・発表";
  rb.title = !env ? "環境チェックの結果を待っています" : !ready ? `必須の項目が不足しています: ${env.missing.join("、")}` : "保存・書き出しをしてから、manim-slides で描画し、発表ウィンドウを開きます";
  pb.title = env && !env.presentReady ? "発表ウィンドウ（Qt）が使えません。環境チェックを確認してください" : "直前の描画結果で発表ウィンドウを開く";
  $("present-after").disabled = !env?.presentReady;
  const sp = $("btn-slide-preview");
  sp.disabled = !hasProject || !ready || !!currentJob;
  sp.title = !ready ? "必須の項目が不足しているため描画できません" : "編集中のスライドだけを低画質で描画して、小窓で確認します（Ctrl+Enter）";
  $("present-window").disabled = !env?.presentReady;
  $("present-info").disabled = !env?.presentReady;
}

export function setupRender(save) {
  saveFn = save;
  on("action:export", doExport);
  on("action:render", doRender);
  on("action:present", doPresent);
  on("action:preview-slide", doSlidePreview);
  $("render-range").addEventListener("change", (e) => { if (e.target.value === "pick") openRangeDialog(); });
  // 描画の品質は、このブラウザに覚える（ページを読み直しても戻らないように）
  const q = $("render-quality");
  try {
    const saved = localStorage.getItem("manimSlideGuiQuality");
    if (saved && [...q.options].some((o) => o.value === saved)) q.value = saved;
  } catch { /* 使えなくても続ける */ }
  q.addEventListener("change", () => { try { localStorage.setItem("manimSlideGuiQuality", q.value); } catch { /* 同上 */ } });
  // 別のプロジェクトを開いたら、前のプロジェクトの描画の表示（「描画完了（54 秒）」など）を消す
  let shownFolder = null;
  on("project-loaded", () => {
    if (store.folder === shownFolder) return;
    shownFolder = store.folder;
    if (currentJob) return;
    setStatus("");
    $("render-log").textContent = "";
    $("error-body").innerHTML = "";
  });
  on("slides-changed", updateRangeSelect);
  on("slide-skip-changed", updateRangeSelect);
  on("dirty", updateRangeSelect); // スライドを足す・消す・並べ替える（どの操作でも、変更の知らせで数え直す。軽い）
  $("render-range").addEventListener("pointerdown", updateRangeSelect); // 開く前にも数え直す
  on("project-loaded", () => { pickedIds = null; updateRangeSelect(); });
  updateRangeSelect();
  // 発表ウィンドウの開き方（ユーザー設定に保存し、次回以降も使う）
  // 発表者用の情報ウィンドウを出すかどうかも同じ
  const pw = $("present-window");
  const pi = $("present-info");
  api.get("/api/userconfig").then((cfg) => {
    if (cfg?.presentWindow) pw.value = cfg.presentWindow;
    if (cfg?.presentInfo) pi.value = cfg.presentInfo;
  }).catch(() => {});
  for (const [sel, key] of [[pw, "presentWindow"], [pi, "presentInfo"]]) {
    sel.addEventListener("change", async () => {
      try {
        await api.put("/api/userconfig", { [key]: sel.value });
        toast(`「${sel.selectedOptions[0].textContent}」にしました（次に発表ウィンドウを開くときから反映）`);
      } catch (e) { toast(e.message, "ng"); }
    });
  }
  // ステータスバーの進み具合をクリックすると、下のパネルで詳しい進み具合を見られる
  for (const id of ["status-render", "status-progress"]) {
    $(id).addEventListener("click", () => { if (currentJob) showBottom("error"); });
  }
  on("env-changed", updateButtons);
  on("project-loaded", () => { store.lastError = null; updateButtons(); });
  document.querySelectorAll(".bp-tabs .tab").forEach((t) => t.addEventListener("click", () => showBottom(t.dataset.tab)));
}
