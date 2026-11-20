// 3D のカメラをマウスで動かす（3D を使うプロジェクト）。
// - 中ボタン（ホイール）を押したままドラッグ: 回す（θ・φ）
// - Shift＋中ボタンのドラッグ: 中心を動かす
// - Ctrl＋ホイール: 寄る・引く（拡大率）
// 動かしている間は、軸と 3D の物の外形（枠の線）だけを画面で計算して描き（Manim の絵は薄くする）、
// 離したときに 3D の物の絵を Manim で描き直す。ふだんはスライドの初めのカメラ（slide.camera3d）を変える。
// ステップの「カメラの向きを変える」の「キャンバスで決める」では、そのステップの向きを決める（スライドの初めのカメラは変えない）。

import { fabricCanvas, showSlide, stageElement } from "./canvas.js";
import { currentSlide, emit, markDirty, store, toast } from "./store.js";

const D = Math.PI / 180;
const PX = 135; // 1 単位 = 135px（キャンバスの論理座標）
const DEFAULT = { phi: 0, theta: -90, zoom: 1, x: 0, y: 0 };
let drag = null;      // { x0, y0, cam0, mode: "orbit" | "pan" }
let live = false;     // 外形を描いている間
let wheelTimer = null;
let pick = null;      // { row, saved, onDone }（ステップの向きを決めている間）

const cam = () => (currentSlide().camera3d ??= { ...DEFAULT });

// ---------------------------------------------------------------- 写し方（Manim の ThreeDCamera と同じ）

function rot(c) {
  const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, _v, k) => s + r[k] * B[k][j], 0)));
  return mul(Rx(-c.phi * D), Rz((-c.theta - 90) * D)); // Rz(γ=0)·Rx(−φ)·Rz(−θ−90°)
}

function projector(c) {
  const R = rot(c), f = 20; // 焦点距離（Manim の既定）
  return (p) => {
    const q = [p[0] - (c.x || 0), p[1] - (c.y || 0), p[2]];
    const v = R.map((r) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]);
    const k = (f - v[2]) > 0 ? f / (f - v[2]) : 1e3;
    const { w, h } = store.meta.canvas;
    return [w / 2 + v[0] * k * c.zoom * PX, h / 2 - v[1] * k * c.zoom * PX, v[2]];
  };
}

// ---------------------------------------------------------------- 3D の物の外形（だいたいの大きさの箱）

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec = (v) => (Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(Number(x))) ? v.map(Number) : null);

function rotate3(p, r) { // x 軸・y 軸・z 軸のまわりに、この順で回す（gui_solid と同じ）
  let [x, y, z] = p;
  const [ax, ay, az] = (r || [0, 0, 0]).map((a) => num(a) * D);
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}

function halfSize(e) {
  const r = num(e.radius, 1), h = num(e.height, 2);
  switch (e.solidKind) {
    case "sphere": return [r, r, r];
    case "cube": { const s = num(e.side, 2) / 2; return [s, s, s]; }
    case "prism": { const d = vec(e.dims) || [2, 1, 1]; return d.map((x) => x / 2); }
    case "cone": case "cylinder": return [r, r, h / 2];
    case "torus": { const m = num(e.minorRadius, 0.3); return [r + m, r + m, m]; }
    default: { const s = num(e.side, 2) * 0.8; return [s, s, s]; } // 多面体など
  }
}

/** 外形の線分（空間の点の組）と、名前を書く位置。 */
function outlines() {
  const out = [];
  for (const e of currentSlide()?.elements ?? []) {
    if (e.type !== "shape") continue;
    const pos = vec(e.pos3) || [0, 0, 0];
    if (e.shape === "solid" || e.shape === "axes3d") {
      const hs = e.shape === "axes3d" ? [num(e.xLen, 8) / 2, num(e.yLen, 8) / 2, num(e.zLen, 6) / 2] : halfSize(e).map((v) => v * num(e.scale, 1));
      const c = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = rotate3([sx * hs[0], sy * hs[1], sz * hs[2]], e.shape === "solid" ? e.rot3 : null);
        c.push([p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]]);
      }
      const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      out.push({ lines: edges.map(([a, b]) => [c[a], c[b]]), label: e.name || e.var, at: pos, color: e.shape === "axes3d" ? "#888" : (e.color || "#3554d1") });
    } else if (e.shape === "point3d" && !e.axesId) {
      const a = vec(e.p1), b = vec(e.p2);
      if (a && b && e.pointKind !== "dot") out.push({ lines: [[a, b]], label: e.var, at: a, color: e.color || "#3554d1" });
      else if (a) out.push({ lines: [], dot: a, label: e.var, at: a, color: e.color || "#3554d1" });
    }
  }
  return out;
}

/** キャンバスの after:render から呼ぶ: 動かしている間の、軸と外形。 */
export function drawCam3dOverlay(ctx) {
  if (!live || !store.project?.settings?.use3d) return;
  const c = cam(), P = projector(c);
  ctx.save();
  ctx.lineWidth = 2;
  // 軸（原点から 3 単位）
  for (const [v, col, name] of [[[3, 0, 0], "#d33", "x"], [[0, 3, 0], "#2a2", "y"], [[0, 0, 3], "#36c", "z"]]) {
    const a = P([0, 0, 0]), b = P(v);
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.fillStyle = col; ctx.font = "bold 28px sans-serif"; ctx.fillText(name, b[0] + 6, b[1] - 6);
  }
  for (const o of outlines()) {
    ctx.strokeStyle = o.color; ctx.globalAlpha = 0.85; ctx.setLineDash(o.color === "#888" ? [10, 8] : []);
    for (const [a, b] of o.lines) { const p = P(a), q = P(b); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
    if (o.dot) { const p = P(o.dot); ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, 2 * Math.PI); ctx.fill(); }
    const t = P(o.at); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = "#222"; ctx.font = "24px sans-serif"; ctx.fillText(o.label || "", t[0] + 8, t[1] + 26);
  }
  // 今の値
  const { w } = store.meta.canvas;
  const msg = `${pick ? "ステップの向き　" : ""}φ ${Math.round(c.phi)}°　θ ${Math.round(c.theta)}°　拡大率 ${c.zoom.toFixed(2)}`;
  ctx.font = "bold 30px sans-serif"; const tw = ctx.measureText(msg).width;
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(w - tw - 40, 16, tw + 24, 46);
  ctx.fillStyle = "#3554d1"; ctx.fillText(msg, w - tw - 28, 50);
  ctx.restore();
}

// ---------------------------------------------------------------- 操作

function setLive(on) {
  live = on;
  const cv = fabricCanvas();
  if (!cv) return;
  for (const o of cv.getObjects()) {
    if (o.depth3 === undefined && !o.anchor3 && !o.comp3d) continue; // 3D の物の絵と、まとめた絵
    if (on && o._camOp === undefined) { o._camOp = o.opacity ?? 1; o.set("opacity", 0.15 * o._camOp); }
    if (!on && o._camOp !== undefined) { o.set("opacity", o._camOp); delete o._camOp; }
  }
  cv.requestRenderAll();
}

function syncPanel() { // スライドのパネルのカメラの欄（開いていれば）の数を、今の値に
  const c = cam();
  for (const k of ["phi", "theta", "zoom", "x", "y"]) {
    const inp = document.querySelector(`#props [data-k=camera] [data-k=${k}]`);
    if (inp) inp.value = k === "zoom" ? Math.round(c[k] * 100) / 100 : Math.round(c[k] * 10) / 10;
  }
}

async function finish() {
  setLive(false);
  const c = cam();
  c.phi = Math.round(c.phi); c.theta = Math.round(c.theta); c.zoom = Math.round(c.zoom * 100) / 100;
  c.x = Math.round(c.x * 100) / 100; c.y = Math.round(c.y * 100) / 100;
  if (!pick) markDirty("camera");
  syncPanel();
  await showSlide(); // 3D の物の絵を、この向きで描き直す
  emit("camera3d-changed");
}

function inStage(e) {
  const st = stageElement();
  return st && st.contains(e.target) && store.project?.settings?.use3d && currentSlide();
}

export function setupCam3d() {
  const st = stageElement();
  if (!st) return;
  // 中ボタンは、ブラウザの自動スクロールと、キャンバスの選択に渡さない
  st.addEventListener("mousedown", (e) => { if (e.button === 1 && inStage(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  st.addEventListener("auxclick", (e) => { if (e.button === 1 && inStage(e)) e.preventDefault(); }, true);
  st.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 || !inStage(e)) return;
    e.preventDefault(); e.stopPropagation();
    drag = { x0: e.clientX, y0: e.clientY, cam0: { ...DEFAULT, ...cam() }, mode: e.shiftKey ? "pan" : "orbit", moved: false };
    st.setPointerCapture?.(e.pointerId);
    setLive(true);
  }, true);
  st.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, c = cam(), c0 = drag.cam0;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.mode === "orbit") {
      c.theta = c0.theta - dx * 0.4;
      c.phi = Math.min(180, Math.max(0, c0.phi - dy * 0.4));
    } else {
      // 画面の右・上の向き（空間）に沿って、中心を逆に動かす（掴んで引っ張る感じ）。中心は xy 平面の上だけ
      const R = rot(c0), s = 1 / (PX * c0.zoom * (fabricCanvas()?.getZoom?.() || 1));
      c.x = c0.x - (dx * R[0][0] - dy * R[1][0]) * s;
      c.y = c0.y - (dx * R[0][1] - dy * R[1][1]) * s;
    }
    fabricCanvas()?.requestRenderAll();
    syncPanel();
  }, true);
  const up = (e) => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    const moved = drag.moved;
    drag = null;
    if (moved) finish(); else setLive(false);
  };
  st.addEventListener("pointerup", up, true);
  st.addEventListener("pointercancel", up, true);
  st.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !inStage(e)) return;
    e.preventDefault(); // ブラウザのページの拡大にしない
    const c = cam();
    c.zoom = Math.min(20, Math.max(0.05, c.zoom * Math.exp(-e.deltaY * 0.0015)));
    if (!live) setLive(true);
    fabricCanvas()?.requestRenderAll();
    syncPanel();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(finish, 450);
  }, { passive: false, capture: true });
}

// ---------------------------------------------------------------- ステップの向きを、キャンバスで決める

/** ステップの「カメラの向きを変える」の行の向きを、キャンバスで決める。決定で row.params に入れる。 */
export async function pickStepCamera(row, onDone) {
  if (pick) endPick(false);
  const c = cam();
  const saved = { ...c };
  const v = (k, d) => (Number.isFinite(Number(row.params?.[k])) && String(row.params?.[k] ?? "").trim() !== "" ? Number(row.params[k]) : d);
  Object.assign(c, { phi: v("phi", c.phi), theta: v("theta", c.theta), zoom: v("zoom", c.zoom), x: v("cx", c.x), y: v("cy", c.y) });
  pick = { row, saved, onDone };
  const st = stageElement();
  let bar = document.getElementById("cam-pick-bar");
  if (!bar) { bar = document.createElement("div"); bar.id = "cam-pick-bar"; bar.className = "cam-pick-bar"; st.appendChild(bar); }
  bar.innerHTML = `<span>ステップのカメラの向きを決めています。中ボタンのドラッグで回す・Shift＋中ボタンで中心を動かす・Ctrl＋ホイールで寄り・引き。</span>
    <button type="button" class="small primary" data-a="ok">決定</button><button type="button" class="small" data-a="cancel">やめる</button>`;
  bar.onclick = (e) => { const a = e.target.closest("button")?.dataset.a; if (a) endPick(a === "ok"); };
  await showSlide();
  setLive(true);
  toast("ステップの向きを決めます。スライドの初めのカメラは変わりません。", "", 5000);
}

async function endPick(ok) {
  if (!pick) return;
  const { row, saved, onDone } = pick;
  const c = cam();
  if (ok) {
    const r2 = (v) => String(Math.round(v * 100) / 100);
    row.params = { ...(row.params || {}), phi: String(Math.round(c.phi)), theta: String(Math.round(c.theta)), zoom: r2(c.zoom), cx: r2(c.x), cy: r2(c.y) };
  }
  Object.assign(c, saved); // スライドの初めのカメラは元に戻す
  pick = null;
  document.getElementById("cam-pick-bar")?.remove();
  setLive(false);
  if (ok) markDirty("step");
  await showSlide();
  onDone?.(ok);
}

export function cam3dPicking() { return !!pick; }
