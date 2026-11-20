// 幾何の作図: 選んだ点・線・円・三角形から、中点・垂直二等分線・垂線・平行線・角の二等分線・交点・三角形の五心・接線を作る。
// 作った時に一度だけ計算し、ふつうの点・線・円として置く（元の図形を動かしても、ついてはこない）。
// 「作図の跡も描く」がオンなら、コンパスの弧（灰色）も置き、弧→結果の順に描くステップを足す。
// 座標はキャンバスの px（y は下向き）。線は (x±dx, y±dy) が両端、円は幅＝高さの楕円、円弧は中心が (x, y)。

import { refreshElement } from "./canvas.js";
import { newShape } from "./shapes.js";
import { newRow } from "./animpane.js";
import { selectMany } from "./selection.js";
import { currentSlide, emit, findElement, markDirty, store, toast, uid, uniqueVar } from "./store.js";

const PREF = "construct.trace";
export const traceOn = () => { try { return localStorage.getItem(PREF) === "1"; } catch { return false; } };
export const setTraceOn = (v) => { try { localStorage.setItem(PREF, v ? "1" : "0"); } catch { /* 覚えられなくても続ける */ } };

const EPS = 1e-6;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a, b) => len(sub(a, b));
/** キャンバスの向き（y 下向き）→ Manim の角度（度、反時計回り）。 */
const angOf = (v) => Math.atan2(-v[1], v[0]) * 180 / Math.PI;

// ---------------------------------------------------------------- 選んだ要素を読む

const isLine = (e) => e?.type === "shape" && e.shape === "line" && !e.arcAngle;
const isDot = (e) => e?.type === "shape" && e.shape === "dot";
const isCircle = (e) => e?.type === "shape" && e.shape === "ellipse" && Math.abs(Number(e.width) - Number(e.height)) < 1 && Math.abs(Number(e.rotation) || 0) < 1e-6;
const isTriPath = (e) => e?.type === "shape" && e.shape === "path" && e.closed && e.paths?.length === 1 && e.paths[0].length === 3;
const isTriPoly = (e) => e?.type === "shape" && e.shape === "polygon" && Number(e.sides) === 3 && !e.edgeArc;

const pointOf = (e) => [Number(e.x), Number(e.y)];
const segOf = (e) => [[e.x - e.dx, e.y - e.dy], [e.x + e.dx, e.y + e.dy]];
const circleOf = (e) => ({ c: [Number(e.x), Number(e.y)], r: Number(e.width) / 2 });
function triOf(e) {
  if (isTriPath(e)) return e.paths[0].map((n) => [e.x + n[0], e.y + n[1]]);
  // 正三角形（RegularPolygon を外接矩形に合わせたもの）: 上の中央と、下の両端。回転（反時計回り）は中心まわり
  const w = Number(e.width), h = Number(e.height), rot = -(Number(e.rotation) || 0) * Math.PI / 180;
  return [[0, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]].map(([x, y]) => [e.x + x * Math.cos(rot) - y * Math.sin(rot), e.y + x * Math.sin(rot) + y * Math.cos(rot)]);
}

function picked() {
  const els = store.selectedIds.map((id) => findElement(id)).filter(Boolean);
  return {
    els,
    dots: els.filter(isDot), lines: els.filter(isLine), circles: els.filter(isCircle),
    tris: els.filter((e) => isTriPath(e) || isTriPoly(e)),
  };
}

// ---------------------------------------------------------------- 交わり（直線は両方向に延ばして考える）

function lineLine(a1, a2, b1, b2) {
  const d1 = sub(a2, a1), d2 = sub(b2, b1);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < EPS) return [];
  const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / den;
  return [add(a1, mul(d1, t))];
}

function lineCircle(a, b, { c, r }) {
  const d = unit(sub(b, a));
  const f = sub(a, c);
  const B = dot(f, d), C = dot(f, f) - r * r;
  const disc = B * B - C;
  if (disc < -EPS) return [];
  if (Math.abs(disc) < 1e-3) return [add(a, mul(d, -B))];
  const s = Math.sqrt(disc);
  return [add(a, mul(d, -B - s)), add(a, mul(d, -B + s))];
}

function circleCircle(A, B) {
  const d = dist(A.c, B.c);
  if (d < EPS || d > A.r + B.r + 1e-6 || d < Math.abs(A.r - B.r) - 1e-6) return [];
  const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const u = unit(sub(B.c, A.c));
  const p = add(A.c, mul(u, a));
  if (h < 1e-3) return [p];
  return [add(p, mul(perp(u), h)), add(p, mul(perp(u), -h))];
}

const foot = (p, a, b) => { const d = unit(sub(b, a)); return add(a, mul(d, dot(sub(p, a), d))); };

// ---------------------------------------------------------------- 置く

const C_RESULT = () => store.project.settings.defaultColor;
const C_POINT = "#D9534F";
const C_AUX = "#8A8F98";
const C_TRACE = "#9AA0A8";

function mkDot(p, base = "pt", color = C_POINT) {
  return newShape(base, { shape: "dot", radius: 9, strokeColor: color, fill: { color, opacity: 1 } }, round(p[0]), round(p[1]));
}
function mkLine(a, b, base = "line", { aux = false } = {}) {
  const m = mid(a, b);
  const e = newShape(base, { shape: "line", dx: round((b[0] - a[0]) / 2), dy: round((b[1] - a[1]) / 2), strokeColor: aux ? C_AUX : C_RESULT(), strokeWidth: aux ? 2.5 : 4 }, round(m[0]), round(m[1]));
  if (aux) e.dashed = true;
  return e;
}
function mkCircle(c, r, base = "circle", { aux = false } = {}) {
  const e = newShape(base, { shape: "ellipse", width: round(2 * r), height: round(2 * r), strokeColor: aux ? C_AUX : C_RESULT(), strokeWidth: aux ? 2.5 : 4 }, round(c[0]), round(c[1]));
  if (aux) e.dashed = true;
  return e;
}
/** コンパスの跡: 中心 c・半径 r の円の、点 p のあたり（±spread 度）の弧。 */
function mkTrace(c, r, p, spread = 14) {
  const a = angOf(sub(p, c));
  return newShape("arc", { shape: "arc", radius: round(r), startAngle: round(a - spread), angle: spread * 2, strokeColor: C_TRACE, strokeWidth: 2.5 }, round(c[0]), round(c[1]));
}
/** a から b の向きに、両側へ k の割合だけ延ばした線分。 */
const extend = (a, b, k = 0.15) => { const d = sub(b, a); return [sub(a, mul(d, k)), add(b, mul(d, k))]; };
const round = (v) => Math.round(v * 10) / 10;

/** 作った要素を置き、（跡を描くときは）ステップを足す。phases: [[要素…], …]（描く順。最後が結果）。 */
async function place(phases, what) {
  const slide = currentSlide();
  const all = phases.flat();
  if (!all.length) return;
  const trace = traceOn();
  for (const e of all) {
    if (trace) e.visibleAtStart = false;
    e.var = uniqueVar(e.var.replace(/\d+$/, "")); // 一度に作ったものどうしで名前が重ならないよう、置くたびに決め直す
    slide.elements.push(e);
  }
  if (trace) {
    for (const ph of phases) {
      if (!ph.length) continue;
      const rows = ph.map((e, i) => newRow(e.shape === "dot" ? "FadeIn" : "Create", e.id, { start: i === 0 ? "after" : "with" }));
      slide.steps.push({ id: uid("t"), elementId: ph[0].id, mode: "gui", rows, code: "" });
    }
    emit("steps-changed");
  }
  markDirty("add");
  for (const e of all) await refreshElement(e);
  selectMany(phases[phases.length - 1].map((e) => e.id));
  toast(`${what}を作りました${trace ? `（作図の跡と、描く順のステップ ${phases.filter((p) => p.length).length} 個も足しました）` : ""}。元の図形を動かしても、ついてはきません。`, "", 6000);
}

const need = (msg) => { toast(msg, "warn", 7000); };

/** 2 点（線分 1 本、または点 2 つ）。 */
function twoPoints(p) {
  if (p.lines.length === 1 && p.els.length === 1) return segOf(p.lines[0]);
  if (p.dots.length === 2 && p.els.length === 2) return p.dots.map(pointOf);
  return null;
}

/** 線分 AB の垂直二等分線の、コンパスの交点 P・Q と跡。 */
function bisectorTrace(A, B) {
  const r = dist(A, B) * 0.75;
  const pq = circleCircle({ c: A, r }, { c: B, r });
  const traces = pq.length === 2 ? [mkTrace(A, r, pq[0]), mkTrace(A, r, pq[1]), mkTrace(B, r, pq[0]), mkTrace(B, r, pq[1])] : [];
  return { pq, traces };
}

// ---------------------------------------------------------------- 作図

const TOOLS = {
  midpoint() {
    const ab = twoPoints(picked());
    if (!ab) return need("中点: 線分 1 本か、点 2 つを選んでください。");
    const [A, B] = ab;
    const { pq, traces } = bisectorTrace(A, B);
    const aux = traceOn() && pq.length === 2 ? [mkLine(...extend(pq[0], pq[1], 0.1), "aux", { aux: true })] : [];
    return place([traceOn() ? traces : [], aux, [mkDot(mid(A, B), "mid")]], "中点");
  },
  bisector() {
    const ab = twoPoints(picked());
    if (!ab) return need("垂直二等分線: 線分 1 本か、点 2 つを選んでください。");
    const [A, B] = ab;
    const { pq, traces } = bisectorTrace(A, B);
    const [p, q] = pq.length === 2 ? pq : [add(mid(A, B), mul(unit(perp(sub(B, A))), dist(A, B) * 0.6)), add(mid(A, B), mul(unit(perp(sub(B, A))), -dist(A, B) * 0.6))];
    return place([traceOn() ? traces : [], [mkLine(...extend(p, q, 0.15), "bisector"), mkDot(mid(A, B), "mid")]], "垂直二等分線");
  },
  perpendicular() {
    const p = picked();
    if (!(p.dots.length === 1 && p.lines.length === 1 && p.els.length === 2)) return need("垂線: 点 1 つと線 1 本を選んでください（点から線へ垂線を下ろします。点が線の上なら、その点で垂直な線）。");
    const P = pointOf(p.dots[0]);
    const [A, B] = segOf(p.lines[0]);
    const F = foot(P, A, B);
    const d = dist(P, F);
    const u = unit(sub(B, A));
    const traces = [];
    let Z;
    if (d < 2) { // 線の上の点: その点で垂直な線
      const r = dist(A, B) * 0.25;
      const X = add(P, mul(u, -r)), Y = add(P, mul(u, r));
      const r2 = r * 1.5;
      Z = circleCircle({ c: X, r: r2 }, { c: Y, r: r2 })[0] ?? add(P, mul(perp(u), r));
      traces.push(mkTrace(P, r, X), mkTrace(P, r, Y), mkTrace(X, r2, Z), mkTrace(Y, r2, Z));
      const v = unit(sub(Z, P));
      return place([traceOn() ? traces : [], [mkLine(add(P, mul(v, -r * 1.2)), add(P, mul(v, r * 1.6)), "perp")]], "垂線");
    }
    const r = d * 1.5;
    const [X, Y] = lineCircle(A, B, { c: P, r });
    const r2 = dist(X, Y) * 0.8;
    const zs = circleCircle({ c: X, r: r2 }, { c: Y, r: r2 });
    Z = zs.sort((a, b) => dist(b, P) - dist(a, P))[0]; // 線の反対側
    traces.push(mkTrace(P, r, X), mkTrace(P, r, Y));
    if (Z) traces.push(mkTrace(X, r2, Z), mkTrace(Y, r2, Z));
    const end = add(F, mul(unit(sub(F, P)), Math.min(d * 0.25, 60)));
    return place([traceOn() ? traces : [], [mkLine(P, end, "perp"), mkDot(F, "foot")]], "垂線（と足）");
  },
  parallel() {
    const p = picked();
    if (!(p.dots.length === 1 && p.lines.length === 1 && p.els.length === 2)) return need("平行線: 点 1 つと線 1 本を選んでください（点を通り、線に平行な線を引きます）。");
    const P = pointOf(p.dots[0]);
    const [A, B] = segOf(p.lines[0]);
    const h = sub(B, A);
    return place([[], [mkLine(sub(P, mul(h, 0.5)), add(P, mul(h, 0.5)), "parallel")]], "平行線");
  },
  angleBisector() {
    const p = picked();
    if (!(p.lines.length === 2 && p.els.length === 2)) return need("角の二等分線: 線を 2 本選んでください（2 本の線が交わる所の角を二等分します）。");
    const [s1, s2] = p.lines.map(segOf);
    const V = lineLine(s1[0], s1[1], s2[0], s2[1])[0];
    if (!V) return need("角の二等分線: 2 本の線が平行です。");
    const far = (s) => (dist(s[0], V) > dist(s[1], V) ? s[0] : s[1]);
    const u1 = unit(sub(far(s1), V)), u2 = unit(sub(far(s2), V));
    const L = Math.min(dist(far(s1), V), dist(far(s2), V));
    let w = add(u1, u2);
    if (len(w) < 1e-6) w = perp(u1);
    w = unit(w);
    const r = L * 0.45;
    const X1 = add(V, mul(u1, r)), X2 = add(V, mul(u2, r));
    const r2 = dist(X1, X2) * 0.8;
    const Z = circleCircle({ c: X1, r: r2 }, { c: X2, r: r2 }).sort((a, b) => dist(b, V) - dist(a, V))[0];
    const a1 = angOf(u1), a2 = angOf(u2);
    let sweep = ((a2 - a1 + 540) % 360) - 180;
    const arc = newShape("arc", { shape: "arc", radius: round(r), startAngle: round(a1 - Math.sign(sweep) * 6), angle: round(sweep + Math.sign(sweep) * 12), strokeColor: C_TRACE, strokeWidth: 2.5 }, round(V[0]), round(V[1]));
    const traces = Z ? [arc, mkTrace(X1, r2, Z), mkTrace(X2, r2, Z)] : [arc];
    return place([traceOn() ? traces : [], [mkLine(V, add(V, mul(w, L * 0.95)), "bisector")]], "角の二等分線");
  },
  intersection() {
    const p = picked();
    let pts = null;
    if (p.lines.length === 2 && p.els.length === 2) { const [a, b] = p.lines.map(segOf); pts = lineLine(a[0], a[1], b[0], b[1]); }
    else if (p.lines.length === 1 && p.circles.length === 1 && p.els.length === 2) { const [a, b] = segOf(p.lines[0]); pts = lineCircle(a, b, circleOf(p.circles[0])); }
    else if (p.circles.length === 2 && p.els.length === 2) pts = circleCircle(...p.circles.map(circleOf));
    if (!pts) return need("交点: 線 2 本、線と円、円 2 つのどれかを選んでください（円は、縦横が同じ楕円）。線は両側に延ばして考えます。");
    if (!pts.length) return need("交わる所がありません。");
    return place([[], pts.map((q) => mkDot(q, "cross"))], `交点（${pts.length} 個）`);
  },
  tangent() {
    const p = picked();
    if (!(p.dots.length === 1 && p.circles.length === 1 && p.els.length === 2)) return need("接線: 点 1 つと円 1 つを選んでください（点から円へ接線を引きます。点が円の上なら、その点での接線）。");
    const P = pointOf(p.dots[0]);
    const { c, r } = circleOf(p.circles[0]);
    const d = dist(P, c);
    if (d < r - 2) return need("点が円の内側にあるので、接線は引けません。");
    if (Math.abs(d - r) <= 2) {
      const t = unit(perp(sub(P, c)));
      return place([[], [mkLine(add(P, mul(t, -r)), add(P, mul(t, r)), "tangent")]], "接線");
    }
    const M = mid(P, c);
    const ts = circleCircle({ c: M, r: d / 2 }, { c, r });
    const traces = [mkDot(M, "mid", C_AUX), ...ts.map((T) => mkTrace(M, d / 2, T, 18))];
    const lines = ts.flatMap((T) => [mkLine(P, add(T, mul(sub(T, P), 0.3)), "tangent"), mkDot(T, "touch")]);
    return place([traceOn() ? traces : [], lines], "接線（2 本）と接点");
  },
};

// ---------------------------------------------------------------- 円周上の点（円についていく）

/** 円（縦横が同じ楕円）・円弧の、中心と半径（キャンバスの px）。円でなければ null。 */
export function circleGeom(e) {
  if (isCircle(e)) return circleOf(e);
  if (e?.type === "shape" && e.shape === "arc") return { c: [Number(e.x), Number(e.y)], r: Number(e.radius), rot: Number(e.rotation) || 0 };
  return null;
}

/** 円周上の点の位置（角度は度、右が 0°・反時計回り）。円弧は回転も足す。 */
export function onCirclePos(circle, angle) {
  const g = circleGeom(circle);
  if (!g) return null;
  const a = (Number(angle) + (g.rot ?? 0)) * Math.PI / 180;
  return [round(g.c[0] + g.r * Math.cos(a)), round(g.c[1] - g.r * Math.sin(a))];
}

/** 点の位置から、円周上の角度（度）。 */
export function onCircleAngle(circle, p) {
  const g = circleGeom(circle);
  if (!g) return 0;
  return Math.round((angOf(sub(p, g.c)) - (g.rot ?? 0)) * 10) / 10;
}

Object.assign(TOOLS, {
  /** 円周上の点: 円だけを選ぶと 90°（真上）に点を置く。円と点を選ぶと、その点を円周上に移して円に付ける。 */
  async onCircle() {
    const els = store.selectedIds.map((id) => findElement(id)).filter(Boolean);
    const circles = els.filter((e) => circleGeom(e));
    const dots = els.filter(isDot);
    if (circles.length !== 1 || circles.length + dots.length !== els.length) return need("円周上の点: 円（縦横が同じ楕円・円弧）を 1 つ選んでください（点も一緒に選ぶと、その点を円周上に移して円に付けます）。");
    const C = circles[0];
    const slide = currentSlide();
    let targets = dots;
    if (!dots.length) {
      const d = mkDot([0, 0], "P");
      d.var = uniqueVar("P");
      d.onCircle = { id: C.id, angle: 90 };
      slide.elements.splice(slide.elements.indexOf(C) + 1, 0, d);
      targets = [d];
    } else {
      for (const d of dots) d.onCircle = { id: C.id, angle: onCircleAngle(C, pointOf(d)) };
    }
    for (const d of targets) { const p = onCirclePos(C, d.onCircle.angle); d.x = p[0]; d.y = p[1]; }
    markDirty("add");
    for (const d of targets) await refreshElement(d);
    selectMany(targets.map((d) => d.id));
    toast(`${dots.length ? "点を円周上に移して、円に付けました" : "円周上に点を置きました（90°・真上）"}。点のパネルの「円周上」で角度を変えられます。点をドラッグすると円周に沿って動き、円を動かすと点もついていきます。`, "", 8000);
  },
});

/** 三角形（点 3 つ・三角形の図形）。 */
function triangle() {
  const p = picked();
  if (p.dots.length === 3 && p.els.length === 3) return p.dots.map(pointOf);
  if (p.tris.length === 1 && p.els.length === 1) return triOf(p.tris[0]);
  need("三角形: 点を 3 つ選ぶか、頂点が 3 つの閉じた線（ベジェ曲線で 3 点を結んで閉じたもの）・正三角形を選んでください。");
  return null;
}

function circumcenter(A, B, C) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < EPS) return null;
  const s = (P) => P[0] * P[0] + P[1] * P[1];
  return [(s(A) * (B[1] - C[1]) + s(B) * (C[1] - A[1]) + s(C) * (A[1] - B[1])) / d, (s(A) * (C[0] - B[0]) + s(B) * (A[0] - C[0]) + s(C) * (B[0] - A[0])) / d];
}

Object.assign(TOOLS, {
  circumcenter() {
    const t = triangle(); if (!t) return;
    const O = circumcenter(...t);
    if (!O) return need("3 点が一直線に並んでいます。");
    const [A, B, C] = t;
    const aux = [[A, B], [B, C]].map(([a, b]) => { const m = mid(a, b); return mkLine(m, add(m, mul(unit(sub(O, m)), dist(m, O) * 1.2 || 40)), "aux", { aux: true }); });
    return place([aux, [mkDot(O, "circum"), mkCircle(O, dist(O, A), "circumcircle")]], "外心と外接円");
  },
  incenter() {
    const t = triangle(); if (!t) return;
    const [A, B, C] = t;
    const a = dist(B, C), b = dist(C, A), c = dist(A, B), s = a + b + c;
    const I = [(a * A[0] + b * B[0] + c * C[0]) / s, (a * A[1] + b * B[1] + c * C[1]) / s];
    const r = dist(I, foot(I, A, B));
    const aux = [A, B].map((V) => mkLine(V, I, "aux", { aux: true }));
    return place([aux, [mkDot(I, "incenter"), mkCircle(I, r, "incircle")]], "内心と内接円");
  },
  centroid() {
    const t = triangle(); if (!t) return;
    const [A, B, C] = t;
    const G = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    const aux = [[A, mid(B, C)], [B, mid(C, A)], [C, mid(A, B)]].map(([v, m]) => mkLine(v, m, "median", { aux: true }));
    return place([aux, [mkDot(G, "centroid")]], "重心（中線つき）");
  },
  orthocenter() {
    const t = triangle(); if (!t) return;
    const [A, B, C] = t;
    const fa = foot(A, B, C), fb = foot(B, C, A);
    const H = lineLine(A, fa, B, fb)[0];
    if (!H) return need("3 点が一直線に並んでいます。");
    const ext = (v, f) => (dot(sub(H, v), sub(f, v)) > dot(sub(f, v), sub(f, v)) ? H : f); // 鈍角なら垂心まで延ばす
    const aux = [[A, ext(A, fa)], [B, ext(B, fb)], [C, ext(C, foot(C, A, B))]].map(([v, f]) => mkLine(v, f, "altitude", { aux: true }));
    return place([aux, [mkDot(H, "ortho")]], "垂心（垂線つき）");
  },
  excenter() {
    const t = triangle(); if (!t) return;
    const [A, B, C] = t;
    const a = dist(B, C), b = dist(C, A), c = dist(A, B);
    const ex = [[-a, b, c], [a, -b, c], [a, b, -c]].map(([x, y, z]) => { const s = x + y + z; return [(x * A[0] + y * B[0] + z * C[0]) / s, (x * A[1] + y * B[1] + z * C[1]) / s]; });
    const sides = [[B, C], [C, A], [A, B]];
    const out = ex.flatMap((J, i) => [mkDot(J, "excenter"), mkCircle(J, dist(J, foot(J, ...sides[i])), "excircle", { aux: true })]);
    return place([[], out], "傍心と傍接円（3 つ）");
  },
});

/** 作図を実行する（「＋図形」の「定理・作図・計算」タブから）。 */
export function runConstruct(name) {
  if (!currentSlide()) return;
  const f = TOOLS[name];
  if (f) return f();
}
