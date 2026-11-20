// タイムライン: 下の動きの欄の「一覧／タイムライン」の切り替え。クリック（ステップ）ごとに、動き・待つ行を時間の帯で並べる。
// ・時刻の計算は app/animgen.py の block_times・row_duration と同じ（自由なコード・すぐ行う動きで区切られた並びごと）
// ・帯をドラッグ: 始まり（前と同時・前の後・前の始まりから○秒後）。右端をドラッグ: 長さ（run_time）。Alt で吸い付かない
// ・帯を押す（動かさない）と、一覧に切り替えて、その行の編集へ

import { animSpec, loadCatalog } from "./animpane.js";
import { currentSlide, emit, escapeHtml, findElement, findGroup, markDirty, on, store } from "./store.js";

const $ = (id) => document.getElementById(id);
const SNAP = 0.05; // 秒の刻み
const ZOOMS = [30, 60, 100, 160, 260];
let view = "list";
let pxs = 100; // 1 秒の幅（px）
try { view = localStorage.getItem("stepView") === "timeline" ? "timeline" : "list"; pxs = Number(localStorage.getItem("tlZoom")) || 100; } catch { /* なくてよい */ }

const varOf = (id) => (id === "camera" ? "カメラ" : String(id ?? "").startsWith("v:") ? id.slice(2) : findElement(id)?.var ?? findGroup(id)?.var ?? "?");

/** 速さの変化で、長さが何倍になるか（animgen.speed_factor と同じ）。 */
function speedFactor(speed) {
  if (!speed?.length) return 1;
  const pts = speed.map(([p, s]) => [p, s]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts.at(-1)[0] < 1) pts.push([1, pts.at(-1)[1]]);
  let t = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] > pts[i - 1][0]) t += 2 * (pts[i][0] - pts[i - 1][0]) / (pts[i - 1][1] + pts[i][1]);
  return t || 1;
}

export function rowDuration(r) {
  if (r.kind === "wait") return Number(r.runTime) || 0;
  const spec = animSpec(r.anim);
  return Number(r.runTime ?? spec?.rt ?? 1) * speedFactor(r.speed);
}

const isBreak = (r) => r.kind === "code" || (r.kind === "anim" && animSpec(r.anim)?.stmt);

/** 1 つの並びの、各行の {row, s（始まり）, d（長さ）, ps（前の行の始まり）, pe（前までの終わり）}。 */
function blockTimes(block) {
  const out = [];
  let ps = 0, pe = 0;
  block.forEach((r, k) => {
    const d = rowDuration(r);
    const st = r.start ?? "after";
    const s = k === 0 ? (st === "lag" ? Number(r.lag) || 0 : 0) : st === "with" ? ps : st === "lag" ? ps + (Number(r.lag) || 0) : pe;
    out.push({ row: r, s, d, ps, pe, first: k === 0 });
    pe = st === "with" ? Math.max(pe, s + d) : s + d;
    ps = s;
  });
  return out;
}

/** ステップの帯: [{row, s, d, …}]（ステップの初めからの秒）。区切り（コード・すぐ行う動き）は d = 0 で、次の並びはその後から。 */
export function stepTimes(st) {
  if (st.mode !== "gui") return { items: [], total: null };
  const items = [];
  let base = 0, block = [];
  const flush = () => {
    const ts = blockTimes(block);
    for (const t of ts) items.push({ ...t, s: base + t.s, base });
    base += Math.max(0, ...ts.map((t) => t.s + t.d));
    block = [];
  };
  for (const r of st.rows ?? []) {
    if (isBreak(r)) { flush(); items.push({ row: r, s: base, d: 0, brk: true }); }
    else block.push(r);
  }
  flush();
  const hasCode = (st.rows ?? []).some((r) => r.kind === "code");
  return { items, total: base, hasCode };
}

// ---------------------------------------------------------------- 描く

function label(r) {
  if (r.kind === "wait") return "待つ";
  if (r.kind === "code") return "自由なコード";
  return `${animSpec(r.anim)?.label ?? r.anim}`;
}

function draw() {
  const box = $("timeline");
  if (!box || view !== "timeline") return;
  const slide = currentSlide();
  if (!slide || store.masterId) { box.innerHTML = ""; return; }
  const steps = slide.steps ?? [];
  if (!steps.length) { box.innerHTML = `<p class="hint">ステップはありません。</p>`; return; }
  const all = steps.map((st) => stepTimes(st));
  const maxT = Math.max(2, ...all.map((a) => a.total ?? 0)) + 1;
  const width = Math.ceil(maxT * pxs);
  const ticks = [];
  const every = pxs >= 100 ? 0.5 : pxs >= 60 ? 1 : 2;
  for (let t = 0; t <= maxT + 1e-9; t += every) ticks.push(`<i style="left:${t * pxs}px" class="${Math.abs(t - Math.round(t)) < 1e-9 ? "maj" : ""}">${Math.abs(t - Math.round(t)) < 1e-9 ? `${Math.round(t)}s` : ""}</i>`);
  box.innerHTML = `
    <div class="tl-tools"><span class="hint">帯をドラッグで始まり、右端で長さを変えます（${SNAP} 秒刻み・前と同時／前の後に吸い付く。Alt で吸い付かない）。帯を押すと、その行の編集へ。</span>
      <span class="grow"></span><label class="unit">拡大 <select data-k="zoom">${ZOOMS.map((z) => `<option value="${z}" ${z === pxs ? "selected" : ""}>${z} px/秒</option>`).join("")}</select></label></div>
    <div class="tl-scroll"><div class="tl-inner" style="width:${width + 200}px">
      <div class="tl-ruler"><span class="tl-label"></span><div class="tl-track" style="width:${width}px">${ticks.join("")}</div></div>
      ${steps.map((st, k) => {
        const a = all[k];
        const head = `<div class="tl-head ${st.id === store.focusStepId ? "on" : ""}" data-step="${st.id}"><b>クリック ${k + 1}</b>
          ${st.mode === "gui" ? `<span>${a.total.toFixed(2)} 秒${a.hasCode ? "＋コード" : ""}</span>` : `<span class="hint">コードのステップ（長さは描画するまで分かりません）</span>`}
          ${st.autoNext ? `<span class="tl-tag">自動で次へ</span>` : ""}${st.loop ? `<span class="tl-tag">くり返す</span>` : ""}</div>`;
        if (st.mode !== "gui") return head + `<div class="tl-lane"><span class="tl-label">コード</span><div class="tl-track" style="width:${width}px"><div class="tl-bar g-code fixed" style="left:0;width:${Math.max(40, pxs)}px">コード</div></div></div>`;
        const lanes = a.items.map((it) => {
          const r = it.row;
          const g = r.kind === "anim" ? animSpec(r.anim)?.group ?? "" : r.kind;
          const tgt = r.kind === "anim" ? `<span class="tl-tgt">${escapeHtml(varOf(r.target))}</span>` : "";
          if (it.brk) {
            return `<div class="tl-lane"><span class="tl-label">${escapeHtml(label(r))}</span><div class="tl-track" style="width:${width}px">
              <div class="tl-mark" style="left:${it.s * pxs}px" data-row="${r.id}" data-step="${st.id}" title="${r.kind === "code" ? "自由なコード（ここで区切り、次の動きはこの後から）" : "すぐ行う動き（区切り）"}"></div></div></div>`;
          }
          const w = Math.max(4, it.d * pxs);
          const startTxt = it.first ? (r.start === "lag" ? `${Number(r.lag).toFixed(2)} 秒後` : "初め") : { with: "前と同時", after: "前の後", lag: `前の始まりから ${Number(r.lag).toFixed(2)} 秒` }[r.start ?? "after"];
          return `<div class="tl-lane"><span class="tl-label" title="${escapeHtml(label(r))}">${escapeHtml(label(r))} ${tgt}</span><div class="tl-track" style="width:${width}px">
            <div class="tl-bar g-${g}" data-row="${r.id}" data-step="${st.id}" style="left:${it.s * pxs}px;width:${w}px" title="${escapeHtml(label(r))}: ${it.s.toFixed(2)}〜${(it.s + it.d).toFixed(2)} 秒（${startTxt}）">
              <span class="tl-txt">${it.d.toFixed(2)}s</span><span class="tl-h" title="長さを変える"></span></div></div></div>`;
        }).join("");
        return head + (lanes || `<div class="tl-lane"><span class="tl-label hint">動きなし</span></div>`);
      }).join("")}
    </div></div>`;
}

// ---------------------------------------------------------------- ドラッグ

function findRow(stepId, rowId) {
  const st = currentSlide()?.steps.find((s) => s.id === stepId);
  return st ? { st, row: st.rows.find((r) => r.id === rowId) } : {};
}

const snapT = (t) => Math.round(t / SNAP) * SNAP;

function startDrag(e, bar, resize) {
  const { st, row } = findRow(bar.dataset.step, bar.dataset.row);
  if (!st || !row) return;
  e.preventDefault();
  const it = stepTimes(st).items.find((x) => x.row === row);
  const x0 = e.clientX;
  const orig = { start: row.start, lag: row.lag, runTime: row.runTime };
  let moved = false;
  const tip = document.createElement("div");
  tip.className = "tl-tip";
  document.body.appendChild(tip);
  const move = (ev) => {
    const dx = (ev.clientX - x0) / pxs;
    if (!moved && Math.abs(ev.clientX - x0) < 3) return;
    moved = true;
    if (resize) {
      const sf = row.kind === "wait" ? 1 : speedFactor(row.speed);
      const d = Math.max(SNAP, ev.altKey ? it.d + dx : snapT(it.d + dx));
      row.runTime = Math.round((d / sf) * 1000) / 1000;
      tip.textContent = `長さ ${d.toFixed(2)} 秒`;
    } else {
      // 始まりの秒（並びの初めから）→ 前と同時・前の後・前の始まりから○秒後
      let s = Math.max(0, it.s - it.base + dx);
      const th = 8 / pxs;
      if (it.first) {
        s = ev.altKey ? s : snapT(s);
        if (s < th && !ev.altKey) { row.start = "after"; row.lag = 0.5; s = 0; }
        else { row.start = "lag"; row.lag = Math.round(s * 1000) / 1000; }
      } else if (!ev.altKey && Math.abs(s - it.ps) < th) { row.start = "with"; s = it.ps; }
      else if (!ev.altKey && Math.abs(s - it.pe) < th) { row.start = "after"; s = it.pe; }
      else {
        s = Math.max(it.ps, ev.altKey ? s : snapT(s));
        row.start = s - it.ps < 1e-6 ? "with" : "lag";
        row.lag = Math.round((s - it.ps) * 1000) / 1000;
      }
      tip.textContent = row.start === "with" ? "前と同時" : row.start === "after" ? "前の後" : it.first ? `${row.lag.toFixed(2)} 秒後` : `前の始まりから ${row.lag.toFixed(2)} 秒`;
    }
    Object.assign(tip.style, { left: `${ev.clientX + 12}px`, top: `${ev.clientY + 12}px` });
    draw();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    tip.remove();
    if (!moved) { openRow(st, row); return; }
    if (orig.start !== row.start || orig.lag !== row.lag || orig.runTime !== row.runTime) {
      markDirty("timeline");
      emit("steps-rows-changed");
    }
    draw();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** 一覧に切り替えて、その行の編集を開く。 */
function openRow(st, row) {
  store.focusStepId = st.id;
  setView("list");
  emit("focus-step", st.id);
  emit("step-chips");
  setTimeout(() => {
    const li = document.querySelector(`#anim-editor .arow[data-row="${row.id}"]`);
    if (li) { li.scrollIntoView({ block: "nearest" }); li.classList.add("flash"); setTimeout(() => li.classList.remove("flash"), 1200); }
  }, 120);
}

// ---------------------------------------------------------------- 切り替え

function setView(v) {
  view = v;
  try { localStorage.setItem("stepView", v); } catch { /* なくてよい */ }
  const tl = view === "timeline";
  $("timeline").hidden = !tl;
  $("step-chips").hidden = tl;
  $("anim-editor").hidden = tl;
  document.querySelectorAll("#step-view [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  if (tl) loadCatalog().then(draw);
}

/** 自動テスト用。 */
export const timelineView = () => view;
export { setView as setTimelineView };

export function setupTimeline() {
  const box = $("timeline");
  document.querySelectorAll("#step-view [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  box.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const h = e.target.closest(".tl-h");
    const bar = e.target.closest(".tl-bar:not(.fixed)");
    if (bar) { startDrag(e, bar, !!h); return; }
    const mk = e.target.closest(".tl-mark");
    if (mk) { const { st, row } = findRow(mk.dataset.step, mk.dataset.row); if (st && row) openRow(st, row); return; }
    const head = e.target.closest(".tl-head");
    if (head) { store.focusStepId = head.dataset.step; emit("focus-step", head.dataset.step); emit("step-chips"); draw(); }
  });
  box.addEventListener("change", (e) => {
    if (e.target.dataset.k === "zoom") { pxs = Number(e.target.value); try { localStorage.setItem("tlZoom", String(pxs)); } catch { /* なくてよい */ } draw(); }
  });
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(draw, 80); };
  for (const ev of ["steps-changed", "steps-rows-changed", "slide-selected", "canvas-rendered", "focus-step", "load-project", "master-mode"]) on(ev, later);
  setView(view);
}
