// 配置の補助: スマートガイド（ほかの要素・スライドの端と中央に吸い付く）、グリッド（表示と吸着）、自分で引くガイド線。
// どれも編集の画面だけのもので、描画・書き出しには出ない。
// ・表示の設定（スマートガイド・グリッド・ガイド線を見せるか）は、このブラウザに覚える
// ・ガイド線は、プロジェクトの settings.guides = {x: [Manim の x …], y: [Manim の y …]} に保存する

import { markDirty, on, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
const VIEW_KEY = "guideView";
const DEFAULT_VIEW = { smart: true, grid: false, gridSnap: false, gridSize: 0.5, guides: true, pointSnap: true };
const SIZES = [0.25, 0.5, 1];
const SNAP_PX = 7; // 画面の上で、これだけ近づいたら吸い付く
let view = loadView();
let canvas = null;
let lines = []; // 今出しているスマートガイドの線 [{x1,y1,x2,y2}]（スライドの座標）
let overlay = null;
let rulerX = null, rulerY = null;

function loadView() {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") }; } catch { return { ...DEFAULT_VIEW }; }
}
function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* 覚えられなくてもよい */ }
}

const W = () => store.meta.canvas.w;
const H = () => store.meta.canvas.h;
const P = () => H() / 8; // Manim の 1 単位のピクセル数
const toPxX = (x) => W() / 2 + x * P();
const toPxY = (y) => H() / 2 - y * P();
const toMX = (px) => (px - W() / 2) / P();
const toMY = (px) => (H() / 2 - px) / P();
const zoom = () => canvas?.viewportTransform?.[0] || 1;

export function guideLines() {
  const g = store.project?.settings?.guides;
  return { x: Array.isArray(g?.x) ? g.x : [], y: Array.isArray(g?.y) ? g.y : [] };
}

function setGuides(g, reason = "guides") {
  if (!store.project) return;
  const r = (v) => Math.round(v * 1000) / 1000;
  store.project.settings.guides = { x: [...new Set(g.x.map(r))].sort((a, b) => a - b), y: [...new Set(g.y.map(r))].sort((a, b) => a - b) };
  markDirty(reason);
  drawGuides();
  canvas?.requestRenderAll();
}

// ---------------------------------------------------------------- 吸い付く先

function boxOf(o) {
  const r = o.getBoundingRect();
  return { l: r.left, t: r.top, r: r.left + r.width, b: r.top + r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

/** 吸い付く先: [値, 線を引く範囲の箱（null は全体）, 種類] */
function candidates(target) {
  const xs = [], ys = [];
  const mine = new Set(canvas.getActiveObjects()); // 複数選んで動かしているときは、その中の物どうしには吸い付かない
  mine.add(target);
  if (view.smart) {
    xs.push([0, null, "slide"], [W() / 2, null, "slide"], [W(), null, "slide"]);
    ys.push([0, null, "slide"], [H() / 2, null, "slide"], [H(), null, "slide"]);
    for (const o of canvas.getObjects()) {
      if ((!o.elId && !o._guiMaster) || !o.visible || mine.has(o) || o.excludeFromExport) continue;
      const b = boxOf(o);
      for (const v of [b.l, b.cx, b.r]) xs.push([v, b, "obj"]);
      for (const v of [b.t, b.cy, b.b]) ys.push([v, b, "obj"]);
    }
  }
  if (view.guides) {
    const g = guideLines();
    for (const v of g.x) xs.push([toPxX(v), null, "guide"]);
    for (const v of g.y) ys.push([toPxY(v), null, "guide"]);
  }
  return { xs, ys };
}

function gridNear(v, axis) {
  const step = view.gridSize * P();
  const c = axis === "x" ? W() / 2 : H() / 2;
  return c + Math.round((v - c) / step) * step;
}

/** 動かす値 vals（左・中・右など）を、いちばん近い吸い付く先に合わせるずれ。 */
function bestShift(vals, cands, axis) {
  const th = SNAP_PX / zoom();
  let best = null;
  for (const v of vals) {
    for (const c of cands) {
      const d = c[0] - v;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d) - 1e-6)) best = { d, at: c[0], box: c[1] };
    }
    if (view.gridSnap) {
      const g = gridNear(v, axis);
      const d = g - v;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d) - 1e-6)) best = { d, at: g, box: null, grid: true };
    }
  }
  return best;
}

function lineFor(axis, hit, me) {
  if (hit.grid) return null;
  if (axis === "x") {
    const t = hit.box ? Math.min(hit.box.t, me.t) : 0, b = hit.box ? Math.max(hit.box.b, me.b) : H();
    return { x1: hit.at, y1: t, x2: hit.at, y2: b };
  }
  const l = hit.box ? Math.min(hit.box.l, me.l) : 0, r = hit.box ? Math.max(hit.box.r, me.r) : W();
  return { x1: l, y1: hit.at, x2: r, y2: hit.at };
}

const active = () => view.smart || view.gridSnap || (view.guides && (guideLines().x.length || guideLines().y.length));

/** 動かしている最中（canvas.js の object:moving から、位置を知らせる前に呼ぶ）。 */
export function snapMove(e) {
  lines = [];
  const t = e.target;
  if (!t || !canvas || e.e?.altKey || !active()) return;
  const { xs, ys } = candidates(t);
  let me = boxOf(t);
  const hx = bestShift([me.l, me.cx, me.r], xs, "x");
  const hy = bestShift([me.t, me.cy, me.b], ys, "y");
  if (hx) t.left += hx.d;
  if (hy) t.top += hy.d;
  if (hx || hy) { t.setCoords(); me = boxOf(t); }
  if (hx) { const L = lineFor("x", hx, me); if (L) lines.push(L); }
  if (hy) { const L = lineFor("y", hy, me); if (L) lines.push(L); }
}

/** 大きさを変えている最中（object:scaling）。回していない 1 つの物だけ、動かしている辺を吸い付かせる。 */
export function snapScale(e) {
  lines = [];
  const t = e.target;
  const corner = e.transform?.corner || "";
  if (!t || !canvas || e.e?.altKey || !active() || !corner || Math.abs(t.angle % 360) > 0.01 || canvas.getActiveObjects().length > 1) return;
  const me = boxOf(t);
  const ex = corner.includes("l") ? "l" : corner.includes("r") ? "r" : null;
  const ey = corner.includes("t") ? "t" : corner.includes("b") ? "b" : null;
  const { xs, ys } = candidates(t);
  const hx = ex ? bestShift([me[ex]], xs, "x") : null;
  const hy = ey ? bestShift([me[ey]], ys, "y") : null;
  if (!hx && !hy) return;
  const w = me.r - me.l, h = me.b - me.t;
  let fx = hx ? (w + (ex === "r" ? hx.d : -hx.d)) / w : 1;
  let fy = hy ? (h + (ey === "b" ? hy.d : -hy.d)) / h : 1;
  const o = e.transform?.original;
  const uniform = ex && ey && o && Math.abs(t.scaleX / t.scaleY - o.scaleX / o.scaleY) < 1e-3; // 縦横比を保って変えている
  if (uniform) {
    // 縦横比を保つ: 近い方の吸い付きだけを使う
    const useX = hx && (!hy || Math.abs(hx.d) <= Math.abs(hy.d));
    const f = useX ? fx : fy;
    fx = f; fy = f;
  }
  if (!(fx > 0.01 && fy > 0.01)) return;
  const fixX = ex === "r" ? me.l : me.r, fixY = ey === "b" ? me.t : me.b;
  t.set({ scaleX: t.scaleX * fx, scaleY: t.scaleY * fy });
  t.setCoords();
  const n = boxOf(t);
  if (ex) t.left += fixX - (ex === "r" ? n.l : n.r);
  else t.left += me.cx - n.cx;
  if (ey) t.top += fixY - (ey === "b" ? n.t : n.b);
  else t.top += me.cy - n.cy;
  t.setCoords();
  const m2 = boxOf(t);
  if (hx && (!uniform || Math.abs(m2[ex] - hx.at) < 0.5)) { const L = lineFor("x", hx, m2); if (L) lines.push(L); }
  if (hy && (!uniform || Math.abs(m2[ey] - hy.at) < 0.5)) { const L = lineFor("y", hy, m2); if (L) lines.push(L); }
}

/** 線の端・曲線の点などの 1 点を、グリッド（吸い付くとき）とガイド線に吸い付かせる（縦・横それぞれ）。
 * 吸い付いたら {x, y}、どちらにも吸い付かなければ null。 */
export function snapPoint(x, y, altKey = false) {
  if (altKey || !canvas || !view.pointSnap || !store.project) return null;
  const th = SNAP_PX / zoom();
  const g = guideLines();
  const near = (v, axis) => {
    let best = null;
    const cand = view.guides ? (axis === "x" ? g.x.map(toPxX) : g.y.map(toPxY)) : [];
    if (view.gridSnap) cand.push(gridNear(v, axis));
    for (const c of cand) if (Math.abs(c - v) <= th && (best == null || Math.abs(c - v) < Math.abs(best - v))) best = c;
    return best;
  };
  const nx = near(x, "x"), ny = near(y, "y");
  if (nx == null && ny == null) return null;
  return { x: nx ?? x, y: ny ?? y };
}

export function clearSnapLines() {
  if (lines.length) { lines = []; canvas?.requestRenderAll(); }
}

// ---------------------------------------------------------------- 描く

function drawCanvas(ctx) {
  if (!store.project) return;
  const vt = canvas.viewportTransform, z = vt[0];
  ctx.save();
  ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
  if (view.grid) {
    const step = view.gridSize * P();
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = "rgba(53,84,209,0.16)";
    ctx.beginPath();
    for (let x = W() / 2 % step; x <= W() + 0.1; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H()); }
    for (let y = H() / 2 % step; y <= H() + 0.1; y += step) { ctx.moveTo(0, y); ctx.lineTo(W(), y); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(53,84,209,0.32)"; // 原点を通る線（Manim の x = 0・y = 0）
    ctx.beginPath(); ctx.moveTo(W() / 2, 0); ctx.lineTo(W() / 2, H()); ctx.moveTo(0, H() / 2); ctx.lineTo(W(), H() / 2); ctx.stroke();
  }
  if (lines.length) {
    ctx.strokeStyle = "#e5398a";
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.beginPath();
    for (const L of lines) { ctx.moveTo(L.x1, L.y1); ctx.lineTo(L.x2, L.y2); }
    ctx.stroke();
  }
  ctx.restore();
}

/** ガイド線（HTML の線。つかんで動かし、スライドの外へ出すと消える）と、上・左の帯（ここからドラッグで新しい線）。 */
function drawGuides() {
  if (!overlay || !canvas) return;
  const vt = canvas.viewportTransform, z = vt[0], ox = vt[4], oy = vt[5];
  const show = !!store.project && view.guides;
  const g = guideLines();
  rulerX.hidden = rulerY.hidden = !store.project;
  if (store.project) {
    Object.assign(rulerX.style, { left: `${ox}px`, top: `${oy - 14}px`, width: `${W() * z}px` });
    Object.assign(rulerY.style, { left: `${ox - 14}px`, top: `${oy}px`, height: `${H() * z}px` });
  }
  // 線の要素は作り直さずに使い回す（ダブルクリックの途中で消えないように）
  const want = show ? [...g.x.map((v, k) => ["x", v, k]), ...g.y.map((v, k) => ["y", v, k])] : [];
  const have = [...overlay.querySelectorAll(".gd-line:not(.gd-drag)")];
  while (have.length > want.length) have.pop().remove();
  want.forEach(([axis, v, k], i) => {
    let d = have[i];
    if (!d) { d = document.createElement("div"); overlay.appendChild(d); }
    d.className = `gd-line gd-${axis}`;
    d.dataset.axis = axis;
    d.dataset.k = String(k);
    d.title = `ガイド線 ${axis} = ${fmt(v)}（ドラッグで動かす・ダブルクリックで数値・スライドの外へ出すと消える）`;
    d.style.cssText = axis === "x"
      ? `left:${ox + toPxX(v) * z}px;top:${oy}px;height:${H() * z}px`
      : `top:${oy + toPxY(v) * z}px;left:${ox}px;width:${W() * z}px`;
  });
}

const fmt = (v) => String(Math.round(v * 1000) / 1000);

// ---------------------------------------------------------------- ガイド線の操作

function scenePt(ev) {
  const r = canvas.upperCanvasEl.getBoundingClientRect();
  const vt = canvas.viewportTransform;
  return { x: (ev.clientX - r.left - vt[4]) / vt[0], y: (ev.clientY - r.top - vt[5]) / vt[3] };
}

/** ドラッグ中の線。axis: "x"（縦の線）か "y"（横の線）。k: 動かす線の番号（新しい線は -1）。 */
function dragGuide(ev, axis, k) {
  ev.preventDefault();
  ev.stopPropagation();
  if (!view.guides) { view.guides = true; saveView(); drawMenu(); }
  const tmp = document.createElement("div");
  tmp.className = `gd-line gd-${axis} gd-drag`;
  overlay.appendChild(tmp);
  const tip = document.createElement("div");
  tip.className = "gd-tip";
  overlay.appendChild(tip);
  const src = k >= 0 ? overlay.querySelector(`.gd-line[data-axis="${axis}"][data-k="${k}"]`) : null;

  let val = null;
  let moved = k < 0;
  const x0 = ev.clientX, y0 = ev.clientY;
  const move = (e) => {
    if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 3) return;
    moved = true;
    if (src) src.style.visibility = "hidden";
    const p = scenePt(e);
    const vt = canvas.viewportTransform, z = vt[0];
    let px = axis === "x" ? p.x : p.y;
    if (view.gridSnap && !e.altKey) { const gp = gridNear(px, axis); if (Math.abs(gp - px) <= SNAP_PX / z) px = gp; }
    const inside = axis === "x" ? p.x >= 0 && p.x <= W() && p.y >= -20 / z && p.y <= H() : p.y >= 0 && p.y <= H() && p.x >= -20 / z && p.x <= W();
    val = inside ? (axis === "x" ? toMX(px) : toMY(px)) : null;
    tmp.classList.toggle("gd-out", val == null);
    if (axis === "x") Object.assign(tmp.style, { left: `${vt[4] + px * z}px`, top: `${vt[5]}px`, height: `${H() * z}px` });
    else Object.assign(tmp.style, { top: `${vt[5] + px * z}px`, left: `${vt[4]}px`, width: `${W() * z}px` });
    tip.textContent = val == null ? "離すと消えます" : `${axis} = ${fmt(val)}`;
    Object.assign(tip.style, { left: `${e.clientX - overlay.getBoundingClientRect().left + 12}px`, top: `${e.clientY - overlay.getBoundingClientRect().top + 12}px` });
  };
  const up = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    tmp.remove();
    tip.remove();
    if (src) src.style.visibility = "";
    if (!moved) return; // 押しただけ（ダブルクリックなど）は、動かさない
    const g = guideLines();
    const list = [...g[axis]];
    if (k >= 0) list.splice(k, 1);
    if (val != null) list.push(val);
    if (k >= 0 || val != null) setGuides({ ...g, [axis]: list });
    else drawGuides();
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  move(ev);
}

function editGuideValue(axis, k) {
  const g = guideLines();
  const box = $("gd-edit");
  box.hidden = false;
  box.dataset.axis = axis;
  box.dataset.k = String(k);
  $("gd-edit-axis").value = axis;
  $("gd-edit-val").value = k >= 0 ? fmt(g[axis][k]) : "0";
  $("gd-edit-del").hidden = k < 0;
  $("gd-edit-title").textContent = k >= 0 ? "ガイド線の位置" : "ガイド線を足す";
  $("gd-edit-val").focus();
  $("gd-edit-val").select();
}

function commitEdit(del = false) {
  const box = $("gd-edit");
  const k = Number(box.dataset.k);
  const oldAxis = box.dataset.axis;
  const axis = $("gd-edit-axis").value;
  const v = Number($("gd-edit-val").value);
  const lim = axis === "x" ? W() / 2 / P() : 4;
  if (!del && (!Number.isFinite(v) || Math.abs(v) > lim + 1e-9)) { toast(`位置は ${-fmt(lim)}〜${fmt(lim)} で入れてください（Manim の座標。中央が 0）。`, "warn"); return; }
  const g = guideLines();
  const nx = { x: [...g.x], y: [...g.y] };
  if (k >= 0) nx[oldAxis].splice(k, 1);
  if (!del) nx[axis].push(v);
  box.hidden = true;
  setGuides(nx);
}

// ---------------------------------------------------------------- 「表示 ▾」

function drawMenu() {
  const m = $("guide-menu");
  if (!m) return;
  const g = guideLines();
  m.innerHTML = `
    <label><input type="checkbox" data-v="smart" ${view.smart ? "checked" : ""}> スマートガイド（ほかの要素・スライドの端と中央に吸い付く）</label>
    <label><input type="checkbox" data-v="grid" ${view.grid ? "checked" : ""}> グリッドを表示</label>
    <label><input type="checkbox" data-v="gridSnap" ${view.gridSnap ? "checked" : ""}> グリッドに吸い付く</label>
    <label><input type="checkbox" data-v="pointSnap" ${view.pointSnap ? "checked" : ""}> 線の端・曲線の点も、グリッド・ガイド線に吸い付く</label>
    <label class="gm-row">グリッドの間隔 <select data-v="gridSize">${SIZES.map((s) => `<option value="${s}" ${s === view.gridSize ? "selected" : ""}>${s}（Manim の単位）</option>`).join("")}</select></label>
    <hr>
    <label><input type="checkbox" data-v="guides" ${view.guides ? "checked" : ""}> ガイド線を表示（${g.x.length + g.y.length} 本）</label>
    <div class="gm-row"><button type="button" class="small" data-a="add">数値で足す…</button>
      <button type="button" class="small" data-a="center">中央に十字</button>
      <button type="button" class="small danger" data-a="clear" ${g.x.length + g.y.length ? "" : "disabled"}>すべて消す</button></div>
    <p class="hint">ガイド線は、スライドの上・左の帯からドラッグして引きます。Alt を押しながら動かすと、吸い付きません。どれも描画には出ません。</p>`;
}

function setupMenu() {
  const btn = $("btn-guides");
  const m = $("guide-menu");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!m.hidden) { m.hidden = true; return; }
    drawMenu();
    const r = btn.getBoundingClientRect();
    Object.assign(m.style, { left: `${Math.min(r.left, window.innerWidth - 380)}px`, top: `${r.bottom + 4}px` });
    m.hidden = false;
  });
  document.addEventListener("pointerdown", (e) => { if (!m.hidden && !m.contains(e.target) && e.target !== btn) m.hidden = true; });
  m.addEventListener("change", (e) => {
    const k = e.target.dataset.v;
    if (!k) return;
    view[k] = k === "gridSize" ? Number(e.target.value) : e.target.checked;
    saveView();
    drawGuides();
    canvas?.requestRenderAll();
    if (k === "guides") drawMenu();
  });
  m.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "add") { m.hidden = true; editGuideValue("x", -1); }
    else if (a === "center") { const g = guideLines(); setGuides({ x: [...g.x, 0], y: [...g.y, 0] }); view.guides = true; saveView(); drawMenu(); }
    else if (a === "clear") { setGuides({ x: [], y: [] }); drawMenu(); }
  });
}

/** 自動テスト用。 */
export function guideView() { return { ...view }; }
export function setGuideView(v) { view = { ...view, ...v }; saveView(); drawGuides(); canvas?.requestRenderAll(); }

export function setupGuides(fabricCanvas) {
  canvas = fabricCanvas;
  const wrap = canvas.wrapperEl;
  overlay = document.createElement("div");
  overlay.className = "gd-overlay";
  wrap.appendChild(overlay);
  rulerX = document.createElement("div");
  rulerX.className = "gd-ruler gd-ruler-x";
  rulerX.title = "下へドラッグして、横のガイド線を引く";
  rulerY = document.createElement("div");
  rulerY.className = "gd-ruler gd-ruler-y";
  rulerY.title = "右へドラッグして、縦のガイド線を引く";
  overlay.append(rulerX, rulerY);
  rulerX.addEventListener("pointerdown", (e) => dragGuide(e, "y", -1));
  rulerY.addEventListener("pointerdown", (e) => dragGuide(e, "x", -1));
  overlay.addEventListener("pointerdown", (e) => {
    const d = e.target.closest(".gd-line:not(.gd-drag)");
    if (d && e.button === 0) dragGuide(e, d.dataset.axis, Number(d.dataset.k));
  });
  overlay.addEventListener("dblclick", (e) => {
    const d = e.target.closest(".gd-line");
    if (d) editGuideValue(d.dataset.axis, Number(d.dataset.k));
  });
  canvas.on("after:render", ({ ctx }) => {
    if (!ctx || ctx === canvas.contextTop) return;
    drawCanvas(ctx);
    drawGuides();
  });
  canvas.on("mouse:up", clearSnapLines);
  setupMenu();
  $("gd-edit-ok").addEventListener("click", () => commitEdit(false));
  $("gd-edit-del").addEventListener("click", () => commitEdit(true));
  $("gd-edit-cancel").addEventListener("click", () => { $("gd-edit").hidden = true; });
  $("gd-edit-val").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(false); }
    else if (e.key === "Escape") { e.preventDefault(); $("gd-edit").hidden = true; }
    e.stopPropagation();
  });
  on("load-project", () => setTimeout(drawGuides, 0));
  on("project-loaded", () => { drawGuides(); drawMenu(); });
}

/** 自動テスト用: 編集のキャンバス。 */
export function guideCanvas() { return canvas; }
