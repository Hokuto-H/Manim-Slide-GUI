// 手書き・ベジェ曲線（ペン）・点の編集。図形の要素（shape: "path"）を作り、編集する。
// 点は [x, y, 入る取っ手 dx, dy, 出る取っ手 dx, dy]（キャンバスの px、要素の位置からの相対、回す前の向き）。

import { snapPoint } from "./guides.js";
import { fabricCanvas, refreshElement, showSlide } from "./canvas.js";
import { select } from "./selection.js";
import { currentSlide, emit, findElement, markDirty, on, store, toast, uid, uniqueVar } from "./store.js";

const fab = () => window.fabric;
const cv = () => fabricCanvas();
const zoom = () => cv().viewportTransform[0];
const r1 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- 曲線の当てはめ（Schneider の方法）

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const vmul = (a, k) => [a[0] * k, a[1] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1];
const vlen = (a) => Math.hypot(a[0], a[1]);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l]; };

function bez(b, t) {
  const mt = 1 - t;
  return [0, 1].map((i) => mt * mt * mt * b[0][i] + 3 * mt * mt * t * b[1][i] + 3 * mt * t * t * b[2][i] + t * t * t * b[3][i]);
}
function bezD1(b, t) {
  const mt = 1 - t;
  return [0, 1].map((i) => 3 * mt * mt * (b[1][i] - b[0][i]) + 6 * mt * t * (b[2][i] - b[1][i]) + 3 * t * t * (b[3][i] - b[2][i]));
}
function bezD2(b, t) {
  return [0, 1].map((i) => 6 * (1 - t) * (b[2][i] - 2 * b[1][i] + b[0][i]) + 6 * t * (b[3][i] - 2 * b[2][i] + b[1][i]));
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map((x) => x / L);
}

function generateBezier(pts, u, t1, t2) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  const C = [[0, 0], [0, 0]], X = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], mt = 1 - t;
    const a1 = vmul(t1, 3 * mt * mt * t), a2 = vmul(t2, 3 * mt * t * t);
    C[0][0] += vdot(a1, a1); C[0][1] += vdot(a1, a2); C[1][0] += vdot(a1, a2); C[1][1] += vdot(a2, a2);
    const tmp = vsub(pts[i], bez([p0, p0, p3, p3], t));
    X[0] += vdot(a1, tmp); X[1] += vdot(a2, tmp);
  }
  const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  let al = det ? (X[0] * C[1][1] - X[1] * C[0][1]) / det : 0;
  let ar = det ? (C[0][0] * X[1] - C[1][0] * X[0]) / det : 0;
  const seg = vlen(vsub(p3, p0)), eps = 1e-6 * seg;
  if (al < eps || ar < eps) { al = seg / 3; ar = seg / 3; }
  return [p0, vadd(p0, vmul(t1, al)), vadd(p3, vmul(t2, ar)), p3];
}

function maxError(pts, b, u) {
  let max = 0, split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = vsub(bez(b, u[i]), pts[i]), e = vdot(d, d);
    if (e > max) { max = e; split = i; }
  }
  return [max, split];
}

function reparam(b, pts, u) {
  return u.map((t, i) => {
    const d = vsub(bez(b, t), pts[i]), d1 = bezD1(b, t), d2 = bezD2(b, t);
    const den = vdot(d1, d1) + vdot(d, d2);
    return den ? Math.min(1, Math.max(0, t - vdot(d, d1) / den)) : t;
  });
}

function fitCubic(pts, t1, t2, err) {
  if (pts.length === 2) {
    const d = vlen(vsub(pts[1], pts[0])) / 3;
    return [[pts[0], vadd(pts[0], vmul(t1, d)), vadd(pts[1], vmul(t2, d)), pts[1]]];
  }
  let u = chordParams(pts);
  let b = generateBezier(pts, u, t1, t2);
  let [e, split] = maxError(pts, b, u);
  if (e < err) return [b];
  if (e < err * 4) {
    for (let k = 0; k < 20; k++) {
      u = reparam(b, pts, u);
      b = generateBezier(pts, u, t1, t2);
      [e, split] = maxError(pts, b, u);
      if (e < err) return [b];
    }
  }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const tc = vnorm(vsub(pts[split - 1], pts[split + 1]));
  return [...fitCubic(pts.slice(0, split + 1), t1, tc, err), ...fitCubic(pts.slice(split), vmul(tc, -1), t2, err)];
}

/** 点の列を、なめらかな 3 次ベジェ曲線の点（[x, y, 入る dx, dy, 出る dx, dy]）にする。tol は許す誤差（px）。 */
export function fitPoints(points, tol = 4) {
  const pts = [];
  for (const p of points) if (!pts.length || vlen(vsub(p, pts[pts.length - 1])) > 0.75) pts.push(p);
  if (pts.length < 2) return pts.length ? [[pts[0][0], pts[0][1], 0, 0, 0, 0], [pts[0][0] + 0.5, pts[0][1], 0, 0, 0, 0]] : [];
  const segs = fitCubic(pts, vnorm(vsub(pts[1], pts[0])), vnorm(vsub(pts[pts.length - 2], pts[pts.length - 1])), tol * tol);
  const nodes = [[segs[0][0][0], segs[0][0][1], 0, 0, segs[0][1][0] - segs[0][0][0], segs[0][1][1] - segs[0][0][1]]];
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    nodes.push([s[3][0], s[3][1], s[2][0] - s[3][0], s[2][1] - s[3][1], next ? next[1][0] - s[3][0] : 0, next ? next[1][1] - s[3][1] : 0]);
  });
  return nodes.map((n) => n.map(r1));
}

// ---------------------------------------------------------------- 描くときの表示（ガイド）

function pathString(subpaths, closed = false) {
  // subpaths: キャンバスの絶対座標の点
  let d = "";
  for (const sp of subpaths) {
    if (!sp.length) continue;
    d += `M ${sp[0][0]} ${sp[0][1]} `;
    const segs = sp.slice(1).map((n, i) => [sp[i], n]);
    if (closed && sp.length > 2) segs.push([sp[sp.length - 1], sp[0]]);
    for (const [a, b] of segs) d += `C ${a[0] + a[4]} ${a[1] + a[5]} ${b[0] + b[2]} ${b[1] + b[3]} ${b[0]} ${b[1]} `;
    if (closed && sp.length > 2) d += "Z ";
  }
  return d || "M 0 0";
}

let guides = [];
function clearGuides() { for (const g of guides) cv().remove(g); guides = []; }
function addGuide(obj) { obj.set({ selectable: false, evented: false, excludeFromExport: true, objectCaching: false }); cv().add(obj); guides.push(obj); return obj; }
function guidePath(subpaths, closed = false, color = "#3554d1", width = 2) {
  return addGuide(new (fab().Path)(pathString(subpaths, closed), { fill: "", stroke: color, strokeWidth: width / zoom(), strokeLineCap: "round", strokeLineJoin: "round" }));
}
function guideDot(p, r = 5, fill = "#ffffff") {
  return addGuide(new (fab().Circle)({ left: p[0], top: p[1], radius: r / zoom(), originX: "center", originY: "center", fill, stroke: "#3554d1", strokeWidth: 1.5 / zoom() }));
}

// ---------------------------------------------------------------- モード（手書き・ペン）

let mode = null; // { kind: "freehand" | "pen", ... }
let banner = null;

function showBanner(text) {
  banner?.remove();
  banner = document.createElement("div");
  banner.className = "mode-banner";
  banner.innerHTML = text;
  document.getElementById("stage").appendChild(banner);
}

function beginMode(kind) {
  if (!store.project) return;
  endMode(false);
  select(null);
  const c = cv();
  for (const o of c.getObjects()) o.set({ evented: false, selectable: false });
  c.selection = false;
  c.defaultCursor = "crosshair";
  c.hoverCursor = "crosshair";
  mode = { kind, strokes: [], current: null, nodes: [], down: null };
  if (kind === "freehand") showBanner("手書き: ドラッグして描きます（何筆でも 1 つの要素になります）。<b>Enter</b> で完成、<b>Esc</b> で完成（何も描いていなければ取り消し）、<b>Ctrl+Z</b> で 1 筆戻す。");
  else showBanner("ベジェ曲線: クリックで角の点、ドラッグで曲がる点を打ちます。最初の点をクリックすると閉じます。<b>Enter</b> かダブルクリックで完成、<b>Backspace</b> で 1 点戻す、<b>Esc</b> で完成（2 点未満なら取り消し）。Alt で吸い付かない。");
}

async function endMode(commit = true) {
  if (!mode) return;
  const m = mode;
  mode = null;
  banner?.remove();
  banner = null;
  clearGuides();
  const c = cv();
  c.selection = true;
  c.defaultCursor = "default";
  c.hoverCursor = "move";
  let el = null;
  if (commit) {
    if (m.kind === "freehand" && m.strokes.length) el = makePathElement("freehand", m.strokes.map((s) => s.nodes), false, m.strokes.map((s) => s.raw), m.tol);
    if (m.kind === "pen" && m.nodes.length >= 2) el = makePathElement("bezier", [m.nodes], !!m.closed);
  }
  if (el) {
    currentSlide().elements.push(el);
    markDirty("add");
  }
  await showSlide(); // 要素の選択・クリックできる状態を元に戻す
  if (el) select(el.id);
}

/** 絶対座標の点から要素を作る（外接矩形の中心を要素の位置にする）。 */
function makePathElement(source, absPaths, closed, absRaw = null, tol = 4) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of absPaths) for (const n of sp) { x0 = Math.min(x0, n[0]); x1 = Math.max(x1, n[0]); y0 = Math.min(y0, n[1]); y1 = Math.max(y1, n[1]); }
  const cx = r1((x0 + x1) / 2), cy = r1((y0 + y1) / 2);
  const s = store.project.settings;
  const el = {
    id: uid("e"), type: "shape", shape: "path", source, var: uniqueVar(source === "freehand" ? "stroke" : "curve"),
    x: cx, y: cy, rotation: 0, visibleAtStart: true, closed,
    paths: absPaths.map((sp) => sp.map((n) => [r1(n[0] - cx), r1(n[1] - cy), n[2], n[3], n[4], n[5]])),
    stroke: { color: s.defaultColor, width: source === "freehand" ? 5 : 4, opacity: 1 },
    fill: { color: null, opacity: 0 }, dashed: false, dashLength: 0.15, smooth: tol,
  };
  if (absRaw) el.raw = absRaw.map((st) => st.map((p) => [r1(p[0] - cx), r1(p[1] - cy)]));
  return el;
}

// ---- 手書き ----
function freehandDown(p) {
  mode.current = { raw: [p] };
  mode.currentGuide = null;
}
function freehandMove(p) {
  const st = mode.current;
  if (!st) return;
  st.raw.push(p);
  if (mode.currentGuide) cv().remove(mode.currentGuide);
  guides = guides.filter((g) => g !== mode.currentGuide);
  mode.currentGuide = addGuide(new (fab().Polyline)(st.raw.map(([x, y]) => ({ x, y })), { fill: "", stroke: "#3554d1", strokeWidth: 3 / zoom(), strokeLineCap: "round", strokeLineJoin: "round" }));
  cv().requestRenderAll();
}
function freehandUp() {
  const st = mode.current;
  mode.current = null;
  if (!st || st.raw.length < 2) return;
  mode.tol = mode.tol ?? 4;
  st.nodes = fitPoints(st.raw, mode.tol);
  if (mode.currentGuide) { cv().remove(mode.currentGuide); guides = guides.filter((g) => g !== mode.currentGuide); }
  st.guide = guidePath([st.nodes], false, "#222222", 3);
  mode.strokes.push(st);
  cv().requestRenderAll();
}

// ---- ペン ----
function penRedraw(hover = null) {
  clearGuides();
  const nodes = mode.nodes;
  if (nodes.length) {
    guidePath([nodes], false, "#222222", 2.5);
    if (hover && !mode.down) {
      const last = nodes[nodes.length - 1];
      guidePath([[last, [hover[0], hover[1], 0, 0, 0, 0]]], false, "#3554d1", 1.5);
    }
    nodes.forEach((n, i) => {
      guideDot([n[0], n[1]], i === 0 ? 6 : 4.5, i === 0 ? "#f2a900" : "#ffffff");
      if (n[4] || n[5]) {
        addGuide(new (fab().Line)([n[0] + n[2], n[1] + n[3], n[0] + n[4], n[1] + n[5]], { stroke: "#3554d1", strokeWidth: 1 / zoom() }));
        guideDot([n[0] + n[4], n[1] + n[5]], 3.5, "#3554d1");
      }
    });
  }
  cv().requestRenderAll();
}
function penDown(p, e) {
  const nodes = mode.nodes;
  // 最初の点をクリックしたら閉じて完成
  if (nodes.length >= 2 && vlen(vsub(p, nodes[0])) < 9 / zoom()) {
    mode.closed = true;
    endMode(true);
    return;
  }
  const q = e.altKey ? p : snap(p);
  nodes.push([q[0], q[1], 0, 0, 0, 0]);
  mode.down = q;
  penRedraw();
}
function penMove(p) {
  if (mode.down) {
    const n = mode.nodes[mode.nodes.length - 1];
    const d = vsub(p, mode.down);
    if (vlen(d) > 2 / zoom()) { n[4] = r1(d[0]); n[5] = r1(d[1]); n[2] = r1(-d[0]); n[3] = r1(-d[1]); }
  }
  penRedraw(p);
}
function penUp() { mode.down = null; penRedraw(); }

// ほかの要素の点（中心・四隅・辺の中点・線の端）に吸い付く
function snap(p) {
  const c = cv();
  let best = null, bd = 10 / zoom();
  for (const o of c.getObjects()) {
    if (!o.elId || !o.visible || o.elId === edit?.el.id) continue;
    const cs = o.getCoords();
    const pts = [o.getCenterPoint(), ...cs, ...cs.map((a, i) => ({ x: (a.x + cs[(i + 1) % 4].x) / 2, y: (a.y + cs[(i + 1) % 4].y) / 2 }))];
    for (const q of pts) { const d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = [q.x, q.y]; } }
  }
  if (best) return best;
  const g = snapPoint(p[0], p[1]); // グリッド・ガイド線（「表示 ▾」の設定）
  return g ? [g.x, g.y] : p;
}

// ---------------------------------------------------------------- 点の編集

let edit = null; // { el, sel: [i, j] }

export const editingPathId = () => edit?.el.id ?? null;

export function startNodeEdit(el) {
  if (!el || el.shape !== "path") return;
  edit = { el, sel: null };
  showBanner("点の編集: 点・取っ手をドラッグ（Alt で取っ手を片方だけ）。点をダブルクリックで角／なめらかの切り替え、線の上をダブルクリックで点を追加、点を選んで <b>Delete</b> で削除。<b>Esc</b> か <b>Enter</b> で終わります。");
  refreshElement(el);
  emit("path-edit", el.id);
}

export function stopNodeEdit() {
  if (!edit) return;
  const el = edit.el;
  edit = null;
  banner?.remove();
  banner = null;
  clearGuides();
  if (currentSlide()?.elements.includes(el)) refreshElement(el);
  emit("path-edit", null);
}

/** オブジェクトの中の、要素の相対座標 (x, y) のキャンバス上の位置。 */
function toAbs(obj, x, y) {
  const f = fab();
  const o = obj.shapePts?.origin ?? [obj.width / 2, obj.height / 2];
  return f.util.transformPoint(new f.Point(o[0] - obj.width / 2 + x, o[1] - obj.height / 2 + y), obj.calcTransformMatrix());
}
function toLocal(obj, p) {
  const f = fab();
  const o = obj.shapePts?.origin ?? [obj.width / 2, obj.height / 2];
  const q = f.util.transformPoint(new f.Point(p.x, p.y), f.util.invertTransform(obj.calcTransformMatrix()));
  return [q.x - (o[0] - obj.width / 2), q.y - (o[1] - obj.height / 2)];
}

/** 編集中の曲線のオブジェクトに、点・取っ手のハンドルを付ける（canvas.js の buildObject から呼ぶ）。 */
export function setupPathControls(obj, el) {
  if (!edit || edit.el.id !== el.id) return;
  const f = fab();
  obj.set({ lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, hasBorders: true, borderDashArray: [4, 4] });
  const controls = {};
  const mk = (key, getLocal, kind) => new f.Control({
    x: 0, y: 0, sizeX: 14, sizeY: 14, cursorStyle: "crosshair",
    positionHandler: (dim, fm, o) => { const [x, y] = getLocal(); return f.util.transformPoint(toAbs(o, x, y), cv().viewportTransform); },
    actionHandler: (e, t, x, y) => { dragNode(t.target, key, kind, [x, y], e); return false; },
    mouseUpHandler: () => { finishNodeDrag(); return true; },
    render: (ctx, left, top, style, o) => {
      ctx.save();
      if (kind !== "a" && o) {
        // 取っ手と点を結ぶ線
        const n = el.paths[key[0]]?.[key[1]];
        if (n) {
          const q = f.util.transformPoint(toAbs(o, n[0], n[1]), cv().viewportTransform);
          ctx.strokeStyle = "#3554d1";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(left, top);
          ctx.stroke();
        }
      }
      const selected = edit?.sel && edit.sel[0] === key[0] && edit.sel[1] === key[1];
      ctx.fillStyle = kind === "a" ? (selected ? "#3554d1" : "#ffffff") : "#3554d1";
      ctx.strokeStyle = "#3554d1";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (kind === "a") ctx.rect(left - 4.5, top - 4.5, 9, 9);
      else ctx.arc(left, top, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  });
  el.paths.forEach((sp, i) => sp.forEach((n, j) => {
    controls[`a_${i}_${j}`] = mk([i, j], () => [el.paths[i][j][0], el.paths[i][j][1]], "a");
    // 取っ手は、選んだ点と、その隣の点だけ出す（多すぎると見づらいため）
    const near = edit.sel && edit.sel[0] === i && Math.abs(edit.sel[1] - j) <= 1;
    if (near && (n[2] || n[3])) controls[`i_${i}_${j}`] = mk([i, j], () => [el.paths[i][j][0] + el.paths[i][j][2], el.paths[i][j][1] + el.paths[i][j][3]], "i");
    if (near && (n[4] || n[5])) controls[`o_${i}_${j}`] = mk([i, j], () => [el.paths[i][j][0] + el.paths[i][j][4], el.paths[i][j][1] + el.paths[i][j][5]], "o");
  }));
  obj.controls = controls;
}

let nodeDrag = null;
function dragNode(obj, key, kind, xy, e) {
  const el = edit?.el;
  if (!el) return;
  const [i, j] = key;
  if (!nodeDrag) {
    nodeDrag = { obj, paths: JSON.parse(JSON.stringify(el.paths)), moved: false };
    edit.sel = [i, j];
  }
  const sp = kind === "a" && !e.altKey ? snap(xy) : xy; // 点（取っ手ではなく）は、ほかの要素の点・グリッド・ガイド線に吸い付く
  const p = toLocal(obj, { x: sp[0], y: sp[1] });
  const n = nodeDrag.paths[i][j];
  if (kind === "a") {
    n[0] = r1(p[0]); n[1] = r1(p[1]);
  } else {
    const hx = r1(p[0] - n[0]), hy = r1(p[1] - n[1]);
    const [a, b] = kind === "i" ? [2, 4] : [4, 2];
    n[a] = hx; n[a + 1] = hy;
    if (!e.altKey) {
      // 反対側の取っ手を、同じ直線上に保つ（長さは今のまま）
      const L = Math.hypot(n[b], n[b + 1]);
      if (L > 0.01) { const l = Math.hypot(hx, hy) || 1; n[b] = r1(-hx / l * L); n[b + 1] = r1(-hy / l * L); }
    }
  }
  nodeDrag.moved = true;
  clearGuides();
  const abs = nodeDrag.paths.map((sp) => sp.map((m) => { const q = toAbs(obj, m[0], m[1]); return [q.x, q.y, m[2], m[3], m[4], m[5]]; }));
  if (!el.rotation) guidePath(abs, el.closed, "#3554d1", 2);
  else guidePath(nodeDrag.paths.map((sp) => sp.map((m) => { const q = toAbs(obj, m[0], m[1]); const qi = toAbs(obj, m[0] + m[2], m[1] + m[3]); const qo = toAbs(obj, m[0] + m[4], m[1] + m[5]); return [q.x, q.y, qi.x - q.x, qi.y - q.y, qo.x - q.x, qo.y - q.y]; })), el.closed, "#3554d1", 2);
  cv().requestRenderAll();
}

async function finishNodeDrag() {
  const d = nodeDrag;
  nodeDrag = null;
  clearGuides();
  if (!d || !edit) return;
  if (d.moved) {
    edit.el.paths = d.paths;
    delete edit.el.raw; // 手で直したので、なめらかさの描き直しはしない
    markDirty("path");
    emit("slide-changed");
  }
  await refreshElement(edit.el);
}

function nearestAnchor(el, obj, pScene) {
  let best = null, bd = 9 / zoom();
  el.paths.forEach((sp, i) => sp.forEach((n, j) => {
    const q = toAbs(obj, n[0], n[1]);
    const d = Math.hypot(q.x - pScene.x, q.y - pScene.y);
    if (d < bd) { bd = d; best = [i, j]; }
  }));
  return best;
}

/** 線の上の、いちばん近い位置（区間と t）。 */
function nearestOnCurve(el, local) {
  let best = null, bd = 12 / zoom();
  el.paths.forEach((sp, i) => {
    const n = sp.length, segs = n - 1 + (el.closed && n > 2 ? 1 : 0);
    for (let k = 0; k < segs; k++) {
      const a = sp[k], b = sp[(k + 1) % n];
      const B = [[a[0], a[1]], [a[0] + a[4], a[1] + a[5]], [b[0] + b[2], b[1] + b[3]], [b[0], b[1]]];
      for (let s = 1; s < 60; s++) {
        const t = s / 60, q = bez(B, t), d = Math.hypot(q[0] - local[0], q[1] - local[1]);
        if (d < bd) { bd = d; best = { i, k, t, B }; }
      }
    }
  });
  return best;
}

function splitAt(el, hit) {
  const { i, k, t, B } = hit;
  const lerp = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const p01 = lerp(B[0], B[1]), p12 = lerp(B[1], B[2]), p23 = lerp(B[2], B[3]);
  const p012 = lerp(p01, p12), p123 = lerp(p12, p23), m = lerp(p012, p123);
  const sp = el.paths[i], n = sp.length;
  const a = sp[k], b = sp[(k + 1) % n];
  a[4] = r1(p01[0] - a[0]); a[5] = r1(p01[1] - a[1]);
  b[2] = r1(p23[0] - b[0]); b[3] = r1(p23[1] - b[1]);
  const node = [r1(m[0]), r1(m[1]), r1(p012[0] - m[0]), r1(p012[1] - m[1]), r1(p123[0] - m[0]), r1(p123[1] - m[1])];
  sp.splice(k + 1, 0, node);
  return [i, k + 1];
}

function toggleCorner(el, i, j) {
  const sp = el.paths[i], n = sp[j];
  if (n[2] || n[3] || n[4] || n[5]) { n[2] = n[3] = n[4] = n[5] = 0; return; }
  // なめらかにする: 前後の点を結ぶ向きに、前後の点までの距離の 1/3 の取っ手
  const prev = sp[j - 1] ?? (el.closed ? sp[sp.length - 1] : null), next = sp[j + 1] ?? (el.closed ? sp[0] : null);
  const dir = vnorm(vsub(next ? [next[0], next[1]] : [n[0], n[1]], prev ? [prev[0], prev[1]] : [n[0], n[1]]));
  const lp = prev ? vlen(vsub([n[0], n[1]], [prev[0], prev[1]])) / 3 : 0, ln = next ? vlen(vsub([next[0], next[1]], [n[0], n[1]])) / 3 : 0;
  n[2] = r1(-dir[0] * lp); n[3] = r1(-dir[1] * lp); n[4] = r1(dir[0] * ln); n[5] = r1(dir[1] * ln);
}

async function editDblClick(pScene) {
  const el = edit.el, obj = cv().getObjects().find((o) => o.elId === el.id);
  if (!obj) return;
  const a = nearestAnchor(el, obj, pScene);
  if (a) { toggleCorner(el, a[0], a[1]); edit.sel = a; }
  else {
    const hit = nearestOnCurve(el, toLocal(obj, pScene));
    if (!hit) { stopNodeEdit(); return; }
    edit.sel = splitAt(el, hit);
  }
  delete el.raw;
  markDirty("path");
  emit("slide-changed");
  await refreshElement(el);
}

async function deleteSelectedNode() {
  const el = edit.el;
  if (!edit.sel) return;
  const [i, j] = edit.sel;
  const sp = el.paths[i];
  if (sp.length <= 2) {
    if (el.paths.length > 1) el.paths.splice(i, 1);
    else { toast("点が 2 つの線からは、点を消せません（要素ごと消すときは、編集を終えてから Delete）。", "warn"); return; }
  } else sp.splice(j, 1);
  edit.sel = null;
  delete el.raw;
  markDirty("path");
  emit("slide-changed");
  await refreshElement(el);
}

// ---------------------------------------------------------------- 手書きのなめらかさ

/** 手書きの元の点から、なめらかさ tol で描き直す。 */
export function refit(el, tol) {
  if (!el.raw?.length) return false;
  el.smooth = tol;
  el.paths = el.raw.map((st) => fitPoints(st, tol));
  return true;
}

// ---------------------------------------------------------------- 準備

export function startFreehand() { beginMode("freehand"); }
export function startPen() { beginMode("pen"); }
export const drawingMode = () => mode?.kind ?? null;

export function setupPathTools() {
  const c = cv();
  const pt = (o) => { const p = o.scenePoint ?? c.getScenePoint(o.e); return [p.x, p.y]; };
  c.on("mouse:down", (o) => {
    if (!mode || o.e.button) return;
    if (mode.kind === "freehand") freehandDown(pt(o));
    else penDown(pt(o), o.e);
  });
  c.on("mouse:move", (o) => {
    if (!mode) return;
    if (mode.kind === "freehand") freehandMove(pt(o));
    else penMove(pt(o));
  });
  c.on("mouse:up", (o) => {
    if (!mode) return;
    if (mode.kind === "freehand") freehandUp();
    else penUp(pt(o));
  });
  c.on("mouse:dblclick", (o) => {
    if (mode?.kind === "pen") {
      // ダブルクリックの 2 回目のクリックで打った点を消してから完成
      const n = mode.nodes;
      if (n.length >= 2 && vlen(vsub([n[n.length - 1][0], n[n.length - 1][1]], [n[n.length - 2][0], n[n.length - 2][1]])) < 4 / zoom()) n.pop();
      endMode(true);
      return;
    }
    if (edit && !o.startedPathEdit) editDblClick(o.scenePoint ?? c.getScenePoint(o.e));
  });
  document.addEventListener("keydown", (e) => {
    if (!mode && !edit) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (mode) {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); endMode(e.key === "Enter" || (mode.kind === "freehand" ? mode.strokes.length > 0 : mode.nodes.length >= 2)); }
      else if (mode.kind === "pen" && e.key === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); mode.nodes.pop(); penRedraw(); }
      else if (mode.kind === "freehand" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); e.stopImmediatePropagation();
        const st = mode.strokes.pop();
        if (st?.guide) { c.remove(st.guide); guides = guides.filter((g) => g !== st.guide); c.requestRenderAll(); }
      } else if (e.key === "Delete") { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (edit) {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stopNodeEdit(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopImmediatePropagation(); deleteSelectedNode(); }
    }
  }, true);
  // 点の編集中に、ほかの要素を選んだり、何も無い所をクリックしたら終える
  on("selection", (id) => { if (edit && id !== edit.el.id) stopNodeEdit(); });
  // 点をクリックして選ぶ（取っ手を出す）
  c.on("mouse:down:before", (o) => {
    if (!edit || mode) return;
    const obj = c.getObjects().find((x) => x.elId === edit.el.id);
    if (!obj) return;
    const a = nearestAnchor(edit.el, obj, o.scenePoint ?? c.getScenePoint(o.e));
    if (a && (!edit.sel || edit.sel[0] !== a[0] || edit.sel[1] !== a[1])) {
      edit.sel = a;
      // 取っ手を出すため、ハンドルを付け直す（点のドラッグは、そのまま続けられる）
      setupPathControls(obj, edit.el);
      obj.setCoords();
      c.requestRenderAll();
    }
  });
}
