// 図形・吹き出しのプレビュー。サーバーの常駐 Manim が、書き出しと同じ gui_shape / gui_balloon_shape で作った形（SVG）と、
// 基準点・線の両端・尾の先の位置（SVG の中の px）を受け取る。

import { api } from "./api.js";
import { store } from "./store.js";
import { resolveForPreview } from "./refs.js";

const cache = new Map();
/** フォントが増えた・減ったときは、前に作った形を使わない。 */
export const clearShapePreviewCache = () => cache.clear();
const KEYS = ["shape", "targetId", "linear", "basis", "xLog", "yLog", "curveKind", "xExpr", "yExpr", "tMin", "tMax", "scale", "alpha", "length", "stroke", "fill", "dashed", "dashLength", "dx", "dy", "startTip", "endTip", "tipSize", "width", "height",
  "keepAspect", "cornerRadius", "sides", "innerRatio", "radius", "startAngle", "angle", "sector", "balloonShape", "padX", "padY",
  "tailWidth", "tail", "paths", "closed", "axesKind", "xMin", "xMax", "xStep", "yMin", "yMax", "yStep", "tips", "numbers",
  "numSize", "xLabel", "yLabel", "gridColor", "gridOpacity", "expr", "lang", "xFrom", "xTo", "mode", "direction", "flip", "buff",
  "sharpness", "cells", "cellMode", "headerRow", "headerCol", "fontSize", "font", "color", "hBuff", "vBuff", "outerLines",
  "fieldKind", "fx", "fy", "step", "lengthMode", "lengthScale", "colorMode", "colorMax", "virtualTime", "xLabelShift", "yLabelShift",
  "valueName", "number", "decimals", "unit", "includeSign", "xExpr", "yExpr", "lines",
  "solidKind", "pos3", "rot3", "scale", "dims", "minorRadius", "quality", "color2", "zMin", "zMax", "zStep", "xLen", "yLen", "zLen",
  "labels", "zLabel", "uMin", "uMax", "vMin", "vMax", "zExpr", "tMin", "tMax", "pointKind", "p1", "p2", "size",
  "path", "natW", "natH", "strokeOverride", "opacity",
  "bracket", "angleKind", "quadrant", "other", "reflex", "dot", "labelSize", "labelColor", "partKind", "x0", "x1", "dx", "atX", "length", "sample",
  "legs", "azimuthStep", "azimuthUnits", "label", "complexCurve",
  "arcAngle", "labelPos", "labelBg", "labelFrame", "ring", "innerRadius", "edgeArc", "polygram", "density",
  "code", "language", "style", "lineNumbers", "lineFrom", "background", "bgColor", "textColor", "tabWidth",
  "bars", "autoRange", "barWidth", "axisColor", "showValues", "latex", "underline", "matchWidth", "items", "dotScale",
  "op", "operandIds", "align", "vertices", "faces", "showVertices", "vertexRadius", "surfKind", "split", "parts", "title", "side",
  "directed", "vertices", "edges", "layout", "layoutScale", "seed", "root", "positions", "showLabels", "vertexRadius", "tipSize",
  "tipShape", "tipScale", "annotKind", "scaleFactor", "outside", "x0Expr", "y0Expr", "coords", "coordSize",
  "gradient", "c", "graph2Id", "triangleSize", "points", "dots", "dotRadius", "dotColor", "nameLabel", "dissipating", "colors", "cycleRate",
  // 統計のグラフ
  "chartKind", "table", "xCol", "series", "valueCol", "boxCols", "pieColors", "bins", "binWidth", "autoX", "autoY", "xLabel", "yLabel",
  "numSize", "labelSize", "dotSize", "lineWidth", "fillOpacity", "legend", "grid", "showPercent", "showNames", "donut", "startAngle",
  "fitLabel", "decimals", "whisker", "quartile", "binClosed", "horizontal", "percent", "segLabels", "segOutside",
  // 定理のブロック
  "kind", "body", "numbered", "proofOf", "qed", "boxed", "_number", "_proofOf",
  // 計算した点列
  "source", "params", "color2",
  // 点の名前
  "pname", "pnamePos", "pnameShift", "pnameSize", "pnameColor",
  // 部品
  "partId"];
export const SHAPES_3D = ["solid", "axes3d", "surface", "curve3d", "point3d"];
const AXES3D_KEYS = ["pos3", "xMin", "xMax", "xStep", "yMin", "yMax", "yStep", "zMin", "zMax", "zStep", "xLen", "yLen", "zLen", "tips"];
const AXES_KEYS = ["xLog", "yLog", "axesKind", "xMin", "xMax", "xStep", "yMin", "yMax", "yStep", "width", "height", "tips", "azimuthStep", "azimuthUnits"];

/** 戻り値: { url, width, height, points: {origin, p1, p2, tail}, error }。box は吹き出しの箱の大きさ（px）。 */
export async function renderShapePreview(el, box = null, axes = null) {
  const payload = previewPayload(el, box, axes);
  // 書体（明朝・ゴシック）が変わったら、描き直す（サーバーは保存した設定から書体を決める）
  const key = JSON.stringify(payload) + (store.project?.settings?.texFont ?? "");
  return requestPreview(key, payload);
}

/** プレビューの要求の中身（/api/preview/shape と、3D をまとめて描く /api/preview/scene3d で使う）。 */
export function previewPayload(el, box = null, axes = null) {
  const s = store.project.settings;
  const src = el;
  el = resolveForPreview(el); // 参照（{ref:…}）・定理の番号を番号の文字に
  const payload = { el: Object.fromEntries(KEYS.map((k) => [k, el[k]])), settings: { defaultColor: s.defaultColor, background: s.background, defaultFont: s.defaultFont, fontSizeScale: s.fontSizeScale, defaultFontSize: s.defaultFontSize, theorems: s.theorems, proofTitle: s.proofTitle } };
  if (box) payload.box = { w: Math.round(box.w * 10) / 10, h: Math.round(box.h * 10) / 10 };
  if (axes) payload.axes = Object.fromEntries((SHAPES_3D.includes(el.shape) ? AXES3D_KEYS : AXES_KEYS).map((k) => [k, axes[k]]));
  if (el.shape === "angle") {
    // 角を付ける 2 本の線（位置と両端）
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    payload.lines = [el.line1Id, el.line2Id].map((id) => slide?.elements.find((e) => e.id === id)).filter(Boolean).map((l) => ({ x: l.x, y: l.y, dx: l.dx, dy: l.dy }));
  }
  if (el.shape === "dot" && el.pname && el.pnamePos === "auto") {
    // 名前の向き（自動）: 同じスライドの円・線。点の位置も（向きは点と円・線の位置で決まる）
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    payload.el.x = el.x; payload.el.y = el.y; payload.el.id = el.id; payload.el.type = el.type;
    payload.nameCtx = (slide?.elements ?? []).filter((e) => e.id !== el.id && e.type === "shape" && ["line", "ellipse", "arc"].includes(e.shape))
      .map((e) => ({ id: e.id, type: e.type, shape: e.shape, x: e.x, y: e.y, width: e.width, height: e.height, radius: e.radius, dx: e.dx, dy: e.dy, arcAngle: e.arcAngle }));
  }
  if (el.shape === "part") {
    // 部品: 中身（プロジェクトの写し）
    payload.part = (store.project.parts ?? []).find((p) => p.id === el.partId) ?? null;
  }
  if (el.shape === "boolean") {
    // 合成する図形（合成した図形を元にするときは、その元の図形も）。位置・向きも含めて送る
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const byId = new Map((slide?.elements ?? []).map((e) => [e.id, e]));
    const seen = new Set(), related = [];
    const visit = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const o = byId.get(id);
      if (!o) return;
      for (const sub of o.shape === "boolean" ? (o.operandIds ?? []) : []) visit(sub);
      related.push({ ...Object.fromEntries(KEYS.map((k) => [k, o[k]])), id: o.id, var: o.var, type: o.type, x: o.x, y: o.y, rotation: o.rotation });
    };
    for (const id of el.operandIds ?? []) visit(id);
    payload.related = related;
  }
  if (["table", "matrix"].includes(el.shape) && (el.items ?? []).some((r) => r.some(Boolean))) {
    // 要素を入れた表・行列: セルの要素そのもの（形・大きさで表の形が決まる）。位置は関係ないので外す
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const ids = new Set(el.items.flat().filter(Boolean));
    payload.related = (slide?.elements ?? []).filter((e) => ids.has(e.id)).map((e) => ({ ...JSON.parse(JSON.stringify(e)), x: 960, y: 540 }));
  }
  if (el.shape === "tangent") {
    // 接線: 付ける曲線と、その曲線が頼る要素（グラフの座標軸など）をたどって全部
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const els = slide?.elements ?? [];
    const need = new Set(), stack = [el.targetId];
    while (stack.length) {
      const id = stack.pop();
      if (!id || need.has(id)) continue;
      const e = els.find((x) => x.id === id);
      if (!e) continue;
      need.add(id);
      for (const k of ["axesId", "graphId", "graph2Id", "line1Id", "line2Id", "targetId"]) if (e[k]) stack.push(e[k]);
      for (const k of ["operandIds", "contentIds"]) for (const x of e[k] ?? []) stack.push(x);
    }
    payload.related = els.filter((e) => need.has(e.id)).map((e) => JSON.parse(JSON.stringify(e)));
    payload.values = Object.fromEntries((slide?.values ?? []).filter((v) => v.name).map((v) => [v.name, Number(v.value) || 0]));
  }
  if (el.shape === "annot" && el.annotKind === "animated") {
    // 色が流れる枠: 付ける要素そのもの（形に沿って枠を作るため）
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const t = slide?.elements.find((e) => e.id === el.targetId);
    payload.related = t ? [JSON.parse(JSON.stringify(t))] : [];
  }
  if (el.shape === "annot" && el.annotKind === "arcbrace") {
    // 円弧の中かっこ: 付ける円弧の半径・角度（中心は円弧の位置）
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const a = slide?.elements.find((e) => e.id === el.targetId);
    if (a) payload.arc = { radius: a.radius, startAngle: a.startAngle, angle: a.angle, rotation: a.rotation };
  }
  if (el.shape === "graphpart") {
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    const g = slide?.elements.find((e) => e.id === el.graphId);
    if (g) payload.graph = { expr: g.expr, lang: g.lang };
    const g2 = el.partKind === "area" && el.graph2Id ? slide?.elements.find((e) => e.id === el.graph2Id) : null;
    if (g2) payload.graph2 = { expr: g2.expr, lang: g2.lang };
  }
  if (["graph", "field", "axdot", "number", "graphpart", "curve2d", "implicit", "vector", "fcurve", "tangent", ...SHAPES_3D].includes(el.shape)) {
    // 式・数値で使うスライドの値（初めの値でプレビューする）。サムネイルでは、その要素のスライドの値
    const slide = store.project.slides.find((x) => x.elements.includes(src));
    payload.values = Object.fromEntries((slide?.values ?? []).filter((v) => v.name).map((v) => [v.name, Number(v.value) || 0]));
    // 3D の要素は、そのスライドの初めのカメラの向きから見た形
    if (SHAPES_3D.includes(el.shape)) payload.camera = slide?.camera3d ?? { phi: 0, theta: -90, zoom: 1, x: 0, y: 0 };
  }
  return payload;
}

function requestPreview(key, payload) {
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    try {
      const r = await api.postRetry("/api/preview/shape", payload);
      const url = r.png ? `data:image/png;base64,${r.png}` : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`;
      return { url, layout: r.layout, anchor: r.anchor, basis: r.basis, depth: r.depth, width: r.width, height: r.height, margin: r.margin || 0, points: r.points, tipDir: r.tipDir, python: r.python, info: r.info, error: "" };
    } catch (e) {
      cache.delete(key);
      return { url: null, width: 0, height: 0, points: {}, error: e.message };
    }
  })();
  cache.set(key, p);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return p;
}
