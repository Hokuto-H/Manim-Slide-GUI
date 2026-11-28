// 図形の追加（「＋図形」のメニュー）と、吹き出し（中身のテキスト・数式を囲む）の作成・中身の出し入れ。

import { titleTemplate } from "./masters.js";
import { moveObject, objectHeight, refreshElement, showSlide } from "./canvas.js";
import { startFreehand, startPen } from "./pathtools.js";
import { groupSelection, select, selectMany } from "./selection.js";
import {
  cellItemOk, compactGroups, currentSlide, findElement, isBalloon, makeElement, markDirty, slideGroups, store, toast, uid,
  uniqueVar,
  masterOf,
} from "./store.js";

// メニューの分類（タブ）
export const SHAPE_CATEGORIES = [["basic", "基本図形"], ["line", "線・注釈"], ["graph", "グラフ・座標"], ["data", "表・数値・文字"], ["stat", "統計のグラフ"], ["math", "定理・作図・計算"], ["3d", "3D"]];
// メニューの項目: [見出し, 変数名のもと, 図形の内容, 分類]
export const SHAPE_PRESETS = [
  ["直線", "line", { shape: "line", dx: 160, dy: 0 }, "line"],
  ["矢印", "arrow", { shape: "line", dx: 160, dy: 0, endTip: true }, "line"],
  ["両矢印", "arrow", { shape: "line", dx: 160, dy: 0, startTip: true, endTip: true }, "line"],
  ["破線", "line", { shape: "line", dx: 160, dy: 0, dashed: true }, "line"],
  ["弧（2 点の間。ArcBetweenPoints）", "arcline", { shape: "line", dx: 160, dy: 0, arcAngle: 90 }, "line"],
  ["曲がった矢印（CurvedArrow）", "carrow", { shape: "line", dx: 160, dy: 0, endTip: true, arcAngle: 60 }, "line"],
  ["ラベル付きの線（LabeledLine）", "lline", { shape: "line", dx: 200, dy: 0, label: "a", labelBg: "__bg__" }, "line"],
  ["ラベル付きの矢印（LabeledArrow）", "larrow", { shape: "line", dx: 200, dy: 0, endTip: true, label: "v", labelBg: "__bg__" }, "line"],
  ["直角の印（Elbow）", "elbow", { shape: "elbow", radius: 68 }, "line"],
  ["囲み枠（SurroundingRectangle）", "box", { shape: "annot", annotKind: "box" }, "line"],
  ["背景の四角（BackgroundRectangle）", "bgrect", { shape: "annot", annotKind: "bg" }, "line"],
  ["下線（Underline）", "uline", { shape: "annot", annotKind: "underline" }, "line"],
  ["×印（Cross）", "cross", { shape: "annot", annotKind: "cross" }, "line"],
  ["円弧の中かっこ（ArcBrace）", "abrace", { shape: "annot", annotKind: "arcbrace" }, "line"],
  ["角を丸める弧（TangentialArc。2 本の線）", "tarc", { shape: "angle", angleKind: "tangent" }, "line"],
  ["ベクトル（Vector）", "vec", { shape: "vector" }, "line"],
  ["色が流れる枠（AnimatedBoundary）", "aframe", { shape: "annot", annotKind: "animated" }, "line"],
  ["軌跡（TracedPath）", "trace", { shape: "trace" }, "line"],
  ["接線（曲線を選んで。TangentLine）", "tline", { shape: "tangent" }, "line"],
  ["ズーム（一部を拡大して映す。ZoomedScene）", "zoom", { shape: "zoom" }, "line"],
  ["長方形", "rect", { shape: "rect", width: 360, height: 220 }, "basic"],
  ["正方形", "square", { shape: "rect", width: 240, height: 240, keepAspect: true }, "basic"],
  ["角丸長方形", "rect", { shape: "rect", width: 360, height: 220, cornerRadius: 0.3 }, "basic"],
  ["円", "circle", { shape: "ellipse", width: 240, height: 240, keepAspect: true }, "basic"],
  ["楕円", "ellipse", { shape: "ellipse", width: 360, height: 220 }, "basic"],
  ["三角形", "triangle", { shape: "polygon", sides: 3, width: 260, height: 225, keepAspect: true }, "basic"],
  ["正六角形", "hexagon", { shape: "polygon", sides: 6, width: 260, height: 225, keepAspect: true }, "basic"],
  ["星", "star", { shape: "star", sides: 5, width: 260, height: 247, keepAspect: true }, "basic"],
  ["円弧", "arc", { shape: "arc", radius: 150, startAngle: 0, angle: 120 }, "basic"],
  ["扇形", "sector", { shape: "arc", radius: 150, startAngle: 0, angle: 90, sector: true, fill: { opacity: 0.5 } }, "basic"],
  ["点", "dot", { shape: "dot", radius: 12 }, "basic"],
  ["ラベル付きの点（LabeledDot）", "ldot", { shape: "dot", radius: 12, label: "A", labelSize: 30, fill: { color: "#58C4DD", opacity: 1 } }, "basic"],
  ["輪の付いた点（AnnotationDot）", "adot", { shape: "dot", radius: 14, ring: true, fill: { color: "#58C4DD", opacity: 1 }, strokeColor: "__bg__", strokeWidth: 5 }, "basic"],
  ["円環（Annulus）", "annulus", { shape: "annulus", radius: 150, innerRadius: 80, fill: { opacity: 0.6 } }, "basic"],
  ["扇形の円環（AnnularSector）", "asector", { shape: "annulus", radius: 150, innerRadius: 80, sector: true, startAngle: 0, angle: 120, fill: { opacity: 0.6 } }, "basic"],
  ["辺が弧の三角形（ArcPolygon）", "reuleaux", { shape: "polygon", sides: 3, width: 260, height: 225, keepAspect: true, edgeArc: 60 }, "basic"],
  ["星形多角形（RegularPolygram）", "polygram", { shape: "star", sides: 5, width: 260, height: 247, keepAspect: true, polygram: true, density: 2 }, "basic"],
  ["合成: 和（Union）", "union", { shape: "boolean", op: "union" }, "basic"],
  ["合成: 共通部分（Intersection）", "inter", { shape: "boolean", op: "intersection" }, "basic"],
  ["合成: 切り抜き（Difference）", "diff", { shape: "boolean", op: "difference" }, "basic"],
  ["合成: 重ならない部分（Exclusion）", "excl", { shape: "boolean", op: "exclusion" }, "basic"],
  ["中かっこ", "brace", { shape: "brace" }, "line"],
  ["角（2 本の線）", "angle", { shape: "angle", angleKind: "angle" }, "line"],
  ["直角の印（2 本の線）", "rangle", { shape: "angle", angleKind: "right" }, "line"],
  ["数直線", "numberline", { shape: "axes", axesKind: "numberline", xMin: 0, xMax: 10, xStep: 1, width: 8 * 135, height: 135 }, "graph"],
  ["座標軸", "axes", { shape: "axes", axesKind: "axes", xMin: -1, xMax: 5, xStep: 1, yMin: -1, yMax: 3, yStep: 1, width: 6 * 135, height: 4 * 135 }, "graph"],
  ["座標平面", "plane", { shape: "axes", axesKind: "plane", xMin: -4, xMax: 4, xStep: 1, yMin: -3, yMax: 3, yStep: 1, width: 8 * 135, height: 6 * 135 }, "graph"],
  ["線形変換の平面（LinearTransformationScene）", "plane", { shape: "axes", axesKind: "plane", xMin: -7, xMax: 7, xStep: 1, yMin: -4, yMax: 4, yStep: 1, width: 14 * 135, height: 8 * 135, numbers: false, linear: true, ghost: true, basis: true, followIds: [] }, "graph"],
  ["極座標の平面", "polar", { shape: "axes", axesKind: "polar", xMin: 0, xMax: 3, xStep: 1, yMin: -3, yMax: 3, yStep: 1, width: 6 * 135, height: 6 * 135 }, "graph"],
  ["複素平面", "cplane", { shape: "axes", axesKind: "complex", xMin: -3, xMax: 3, xStep: 1, yMin: -2, yMax: 2, yStep: 1, width: 6 * 135, height: 4 * 135, xLabel: "\\mathrm{Re}", yLabel: "\\mathrm{Im}" }, "graph"],
  ["表", "table", { shape: "table" }, "data"],
  ["行列", "matrix", { shape: "matrix" }, "data"],
  ["要素の表（選んだ要素を入れる。MobjectTable）", "mtable", { shape: "table", withItems: true }, "data"],
  ["要素の行列（選んだ要素を入れる。MobjectMatrix）", "mmatrix", { shape: "matrix", withItems: true }, "data"],
  ["数値（DecimalNumber）", "num", { shape: "number" }, "data"],
  ["棒グラフ（BarChart）", "chart", { shape: "barchart" }, "data"],
  ["散布図（回帰直線・誤差棒も）", "scatter", { shape: "statchart", chartKind: "scatter" }, "stat"],
  ["折れ線グラフ", "lineplot", { shape: "statchart", chartKind: "line" }, "stat"],
  ["集合縦棒グラフ（系列を並べる）", "chart", { shape: "statchart", chartKind: "bar" }, "stat"],
  ["積み上げ縦棒グラフ", "chart", { shape: "statchart", chartKind: "stacked" }, "stat"],
  ["帯グラフ（100% 積み上げ横棒）", "band", { shape: "statchart", chartKind: "stacked", band: true }, "stat"],
  ["ヒストグラム", "hist", { shape: "statchart", chartKind: "hist" }, "stat"],
  ["箱ひげ図", "box", { shape: "statchart", chartKind: "box" }, "stat"],
  ["円グラフ（ドーナツも）", "pie", { shape: "statchart", chartKind: "pie" }, "stat"],
  ["定理", "thm", { shape: "theorem", kind: "theorem" }, "math"],
  ["定義", "defn", { shape: "theorem", kind: "definition" }, "math"],
  ["補題", "lem", { shape: "theorem", kind: "lemma" }, "math"],
  ["命題", "prop", { shape: "theorem", kind: "proposition" }, "math"],
  ["系", "cor", { shape: "theorem", kind: "corollary" }, "math"],
  ["例", "ex", { shape: "theorem", kind: "example" }, "math"],
  ["注意", "rem", { shape: "theorem", kind: "remark" }, "math"],
  ["証明（∎ 付き）", "proof", { shape: "theorem", kind: "proof" }, "math"],
  ["円周上の点（円。円と点なら点を円に付ける）", "P", { construct: "onCircle" }, "math"],
  ["中点（線分か点 2 つ）", "mid", { construct: "midpoint" }, "math"],
  ["垂直二等分線（線分か点 2 つ）", "bisector", { construct: "bisector" }, "math"],
  ["垂線（点と線）", "perp", { construct: "perpendicular" }, "math"],
  ["平行線（点と線）", "parallel", { construct: "parallel" }, "math"],
  ["角の二等分線（線 2 本）", "bisector", { construct: "angleBisector" }, "math"],
  ["交点（線・円の 2 つ）", "cross", { construct: "intersection" }, "math"],
  ["接線（点と円）", "tangent", { construct: "tangent" }, "math"],
  ["外心と外接円（三角形）", "circum", { construct: "circumcenter" }, "math"],
  ["内心と内接円（三角形）", "incenter", { construct: "incenter" }, "math"],
  ["重心（三角形）", "centroid", { construct: "centroid" }, "math"],
  ["垂心（三角形）", "ortho", { construct: "orthocenter" }, "math"],
  ["傍心と傍接円（三角形）", "excenter", { construct: "excenter" }, "math"],
  ["計算した点列（Python で）", "pts", { points: "code" }, "math"],
  ["微分方程式の数値解（オイラー法・ルンゲクッタ法）", "ode", { points: "ode" }, "math"],
  ["数値積分（長方形・台形）", "integral", { points: "integral" }, "math"],
  ["モンテカルロ法（円周率）", "mc", { points: "montecarlo" }, "math"],
  ["くり返しの試行（さいころ・コイン）", "trials", { points: "trials" }, "math"],
  ["コード（Code）", "code", { shape: "code" }, "data"],
  ["LaTeX の文章（Tex）", "tex", { shape: "tex" }, "data"],
  ["題名（Title）", "title", { shape: "title" }, "data"],
  ["箇条書き（BulletedList）", "list", { shape: "bullets" }, "data"],
  ["標本空間（SampleSpace）", "space", { shape: "samplespace" }, "data"],
  ["関数のグラフ（座標軸なし。FunctionGraph）", "fgraph", { shape: "fcurve", curveKind: "function", expr: "\\sin x" }, "graph"],
  ["媒介変数曲線（座標軸なし。ParametricFunction）", "pcurve", { shape: "fcurve", curveKind: "parametric", xExpr: "\\cos t", yExpr: "\\sin 2t", xMin: -4, xMax: 4, yMin: -3, yMax: 3, tMin: 0, tMax: 6.283 }, "graph"],
  ["陰関数の曲線（座標軸なし。ImplicitFunction）", "icurve", { shape: "fcurve", curveKind: "implicit", expr: "x^2 + y^2 = 4" }, "graph"],
  ["折れ線グラフ（座標軸を選んで。plot_line_graph）", "lgraph", { shape: "linegraph" }, "graph"],
  ["グラフ（頂点と辺。Graph）", "graph", { shape: "netgraph", directed: false }, "graph"],
  ["有向グラフ（DiGraph）", "digraph", { shape: "netgraph", directed: true }, "graph"],
  ["ベクトル場（矢印）", "field", { shape: "field", fieldKind: "arrows" }, "graph"],
  ["ベクトル場（流線）", "stream", { shape: "field", fieldKind: "stream" }, "graph"],
  ["手書き", "stroke", { tool: "freehand" }, "line"],
  ["ベジェ曲線", "curve", { tool: "pen" }, "line"],
  ["3D 球", "sphere", { shape: "solid", solidKind: "sphere" }, "3d"],
  ["3D 立方体", "cube", { shape: "solid", solidKind: "cube" }, "3d"],
  ["3D 直方体", "prism", { shape: "solid", solidKind: "prism" }, "3d"],
  ["3D 円錐", "cone", { shape: "solid", solidKind: "cone" }, "3d"],
  ["3D 円柱", "cylinder", { shape: "solid", solidKind: "cylinder" }, "3d"],
  ["3D トーラス", "torus", { shape: "solid", solidKind: "torus" }, "3d"],
  ["正四面体（Tetrahedron）", "tetra", { shape: "solid", solidKind: "tetrahedron" }, "3d"],
  ["正八面体（Octahedron）", "octa", { shape: "solid", solidKind: "octahedron" }, "3d"],
  ["正十二面体（Dodecahedron）", "dodeca", { shape: "solid", solidKind: "dodecahedron" }, "3d"],
  ["正二十面体（Icosahedron）", "icosa", { shape: "solid", solidKind: "icosahedron" }, "3d"],
  ["多面体（頂点と面。Polyhedron）", "poly", { shape: "solid", solidKind: "polyhedron" }, "3d"],
  ["凸包（点から。ConvexHull3D）", "hull", { shape: "solid", solidKind: "hull" }, "3d"],
  ["3D 座標軸", "axes3d", { shape: "axes3d" }, "3d"],
  ["3D の点", "dot3d", { shape: "point3d", pointKind: "dot" }, "3d"],
  ["3D の線", "line3d", { shape: "point3d", pointKind: "line" }, "3d"],
  ["3D の矢印", "arrow3d", { shape: "point3d", pointKind: "arrow" }, "3d"],
  ["吹き出し（角丸）", "balloon", { shape: "balloon", balloonShape: "rect" }, "line"],
  ["吹き出し（楕円）", "balloon", { shape: "balloon", balloonShape: "ellipse" }, "line"],
];

const traceOnNow = () => { try { return localStorage.getItem("construct.trace") === "1"; } catch { return false; } };

export function newShape(base, spec, x, y) {
  const s = store.project.settings;
  const { fill, strokeColor, strokeWidth, ...rest } = spec;
  if (rest.labelBg === "__bg__") rest.labelBg = s.background; // ラベルの背景は、スライドの背景色で線を隠す
  return {
    id: uid("e"), type: "shape", var: uniqueVar(base), x, y, rotation: 0, visibleAtStart: true,
    stroke: { color: strokeColor === "__bg__" ? s.background : (strokeColor ?? s.defaultColor), width: strokeWidth ?? (spec.shape === "balloon" ? 3 : 4), opacity: 1 },
    fill: { color: spec.shape === "balloon" ? s.background : null, opacity: ["dot", "balloon"].includes(spec.shape) ? 1 : 0, ...(fill ?? {}) },
    dashed: false, dashLength: 0.15, ...rest,
  };
}

/** 吹き出しの要素（中身は contentIds）。 */
function newBalloon(spec, x, y, contentIds) {
  const el = newShape("balloon", spec, x, y);
  Object.assign(el, { contentIds, padX: 0.3, padY: 0.2, cornerRadius: 0.25, tailWidth: 0.4, tail: { dx: -140, dy: 150 }, width: 300, height: 150 });
  return el;
}

/** 「＋図形」のメニューから図形を加える。 */
export async function addShape(index) {
  const slide = currentSlide();
  if (!slide) return;
  const [, base, spec] = SHAPE_PRESETS[index];
  if (spec.points) {
    const axes = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
    if (!(axes?.type === "shape" && axes.shape === "axes" && ["axes", "plane"].includes(axes.axesKind))) {
      toast("計算した点列は、座標軸・座標平面を選んでから追加します（座標軸のパネルの「＋計算した点列」でも追加できます）。", "warn", 7000);
      return;
    }
    return addPoints(axes, spec.points);
  }
  if (spec.construct) return (await import("./construct.js")).runConstruct(spec.construct);
  if (spec.tool === "freehand") return startFreehand();
  if (spec.tool === "pen") return startPen();
  const { w, h } = store.meta.canvas;
  const off = (slide.elements.length % 6) * 40;
  const x = w / 2 + (spec.linear ? 0 : off), y = h / 2 + (spec.linear ? 0 : off); // 線形変換の平面は画面の中央
  if (spec.shape === "balloon") return addBalloon(spec, x, y);
  if (spec.shape === "brace") return addBrace(x, y);
  if (spec.withItems) return addItemsTable(spec.shape, x, y);
  if (spec.shape === "table") return addTable(x, y);
  if (["solid", "axes3d", "point3d"].includes(spec.shape)) return add3d(base, spec);
  if (spec.shape === "number") return addNumber(x, y);
  if (spec.shape === "matrix") return addMatrix(x, y);
  if (spec.shape === "boolean") return addBoolean(spec.op);
  if (spec.shape === "annot") return addAnnot(spec.annotKind);
  if (spec.shape === "vector") return addVector(null, x, y);
  if (spec.shape === "trace") return addTrace();
  if (spec.shape === "zoom") return addZoom();
  if (spec.shape === "tangent") return addTangent();
  if (spec.shape === "linegraph") {
    const axes = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
    if (!(axes?.type === "shape" && axes.shape === "axes" && ["axes", "plane"].includes(axes.axesKind))) {
      toast("折れ線グラフは、座標軸・座標平面を選んでから追加します（座標軸のパネルの「＋折れ線グラフ」でも追加できます）。", "warn", 7000);
      return;
    }
    return addLineGraph(axes);
  }
  if (["code", "barchart", "tex", "title", "bullets", "samplespace", "theorem"].includes(spec.shape)) return addTextLike(base, spec.shape, x, y, spec);
  if (spec.shape === "statchart") return addStatChart(spec.chartKind, base, spec.band);
  if (spec.shape === "netgraph") return addNetGraph(base, spec.directed, x, y);
  if (spec.shape === "angle") return addAngle(spec.angleKind);
  if (spec.shape === "field") return addField(null, spec.fieldKind);
  if (spec.shape === "axes") {
    const el = newShape(base, { tips: true, numbers: true, numSize: 24, xLabel: spec.axesKind === "numberline" ? "" : "x", yLabel: spec.axesKind === "numberline" ? "" : "y", ...spec }, w / 2, h / 2);
    el.stroke.width = 2;
    slide.elements.push(el);
    markDirty("add");
    toast("座標軸を作っています（目盛りの数字の LaTeX を初めて使うときは、数秒かかります）…", "", 4000);
    await refreshElement(el);
    select(el.id);
    return;
  }
  const el = newShape(base, spec, x, y);
  slide.elements.push(el);
  markDirty("add");
  await refreshElement(el);
  select(el.id);
}

/** 中かっこ。要素を 1 つ選んでいればその要素の下に付け、選んでいなければ 2 点の間の中かっこにする。 */
async function addBrace(x, y) {
  const slide = currentSlide();
  const target = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
  const el = newShape("brace", { shape: "brace" }, x, y);
  Object.assign(el, { fill: { color: null, opacity: 1 }, buff: 0.2, sharpness: 2, label: "", labelKind: "math", labelSize: 36, labelColor: null, flip: false, direction: "down" });
  if (target && !(target.type === "shape" && ["brace", "graph"].includes(target.shape))) Object.assign(el, { mode: "target", targetId: target.id });
  else Object.assign(el, { mode: "points", dx: 200, dy: 0 });
  // 付ける要素のすぐ上の重なり順に置く
  const k = target ? slide.elements.indexOf(target) + 1 : slide.elements.length;
  slide.elements.splice(k, 0, el);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 座標軸にグラフを加える（座標軸のすぐ上の重なり順）。 */
export async function addGraph(axes) {
  const slide = currentSlide();
  const n = slide.elements.filter((e) => e.shape === "graph" && e.axesId === axes.id).length;
  const colors = ["#FC6255", "#58C4DD", "#83C167", "#FFC300", "#9A72AC"];
  const el = newShape("graph", { shape: "graph" }, axes.x, axes.y);
  const ex = axes.axesKind === "polar" ? ["1 + \\cos\\theta", "2\\sin 3\\theta", "\\frac{\\theta}{2}", "1"] : ["\\sin x", "\\frac{x^2}{4}", "e^{-x}", "\\cos x"];
  Object.assign(el, { axesId: axes.id, expr: ex[n % 4], lang: "latex", xFrom: null, xTo: null });
  if (axes.axesKind === "complex") Object.assign(el, { complexCurve: true, expr: ["e^{it}", "\\cos t + i\\sin 2t", "e^{(-0.2 + i)t}", "(1 + i)t"][n % 4] });
  el.stroke = { color: colors[n % colors.length], width: 4, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["graph", "field", "axdot"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 表。セルはパネルで編集する。 */
async function addTable(x, y) {
  const slide = currentSlide();
  const s = store.project.settings;
  const el = newShape("table", { shape: "table" }, x, y);
  Object.assign(el, {
    cells: [["x", "0", "1", "2", "3"], ["$x^2$", "0", "1", "4", "9"]], cellMode: "text", headerRow: false, headerCol: true,
    fontSize: 36, font: s.defaultFont, color: s.defaultColor, hBuff: 0.6, vBuff: 0.35, outerLines: true,
  });
  el.stroke.width = 2;
  slide.elements.push(el);
  markDirty("add");
  toast("表を作っています（数式のセルを初めて使うときは、数秒かかります）…", "", 4000);
  await refreshElement(el);
  select(el.id);
}

/** 3D の要素（立体・3D 座標軸・空間の点・線・矢印）。3D を使うプロジェクトだけ。 */
const SOLID_COLORS = { sphere: ["#58C4DD", "#236B8E"], cube: ["#58C4DD", null], prism: ["#83C167", null], cone: ["#FC6255", null], cylinder: ["#83C167", null], torus: ["#FFC300", null],
  tetrahedron: ["#FC6255", null], octahedron: ["#83C167", null], dodecahedron: ["#9A72AC", null], icosahedron: ["#58C4DD", null], polyhedron: ["#FFC300", null], hull: ["#5CD0B3", null] };
// 多面体の一辺の既定（だいたい同じ大きさに見えるように）
const POLY_SIDE = { tetrahedron: 2.6, octahedron: 2, dodecahedron: 1.1, icosahedron: 1.5 };
const POLYHEDRA = ["tetrahedron", "octahedron", "dodecahedron", "icosahedron", "polyhedron", "hull"];
// 多面体（頂点と面）・凸包の初めの形（四角錐・7 つの点）。サーバーの shapemodel.py と同じ
export const DEFAULT_PYRAMID = { vertices: [[1, 1, -0.75], [-1, 1, -0.75], [-1, -1, -0.75], [1, -1, -0.75], [0, 0, 1.25]], faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
export const DEFAULT_HULL = [[1.2, 0, -0.6], [-0.6, 1.04, -0.6], [-0.6, -1.04, -0.6], [0, 0, 1.4], [0.8, 0.8, 0.5], [-0.9, 0.2, 0.7], [0.1, -1, 0.6]];
export function defaultPolyShape(kind) {
  if (kind === "hull") return { vertices: DEFAULT_HULL.map((v) => [...v]), faces: [] };
  return { vertices: DEFAULT_PYRAMID.vertices.map((v) => [...v]), faces: DEFAULT_PYRAMID.faces.map((f) => [...f]) };
}
export function need3d() {
  if (store.project.settings.use3d) return true;
  toast("3D の要素は、プロジェクト設定で「3D を使う」をオンにすると置けます（カメラの操作は 3D 用になります）。", "warn", 7000);
  return false;
}

async function add3d(base, spec, axes = null) {
  if (!need3d()) return;
  const slide = currentSlide();
  const n = slide.elements.filter((e) => ["solid", "axes3d", "point3d"].includes(e.shape)).length;
  const off = (n % 5) * 0.6;
  const el = newShape(base, { shape: spec.shape }, 0, 0);
  if (spec.shape === "solid") {
    const [c1, c2] = SOLID_COLORS[spec.solidKind];
    Object.assign(el, { solidKind: spec.solidKind, pos3: [off, -off, 0], rot3: [0, 0, 0], scale: 1, radius: spec.solidKind === "torus" ? 1.2 : 1,
      side: 2, dims: [2.5, 1.5, 1], height: 2, minorRadius: 0.35, quality: "mid", color2: c2 });
    el.fill = { color: c1, opacity: ["cube", "prism"].includes(spec.solidKind) ? 0.85 : POLYHEDRA.includes(spec.solidKind) ? 0.6 : 1 };
    el.stroke = { color: store.project.settings.defaultColor, width: POLYHEDRA.includes(spec.solidKind) ? 1.5 : 0, opacity: 1 };
    if (POLY_SIDE[spec.solidKind]) el.side = POLY_SIDE[spec.solidKind];
    if (POLYHEDRA.includes(spec.solidKind)) Object.assign(el, { showVertices: false, vertexRadius: 0.06 });
    if (spec.solidKind === "polyhedron" || spec.solidKind === "hull") Object.assign(el, defaultPolyShape(spec.solidKind));
  } else if (spec.shape === "axes3d") {
    Object.assign(el, { pos3: [0, 0, 0], xMin: -4, xMax: 4, xStep: 1, yMin: -4, yMax: 4, yStep: 1, zMin: -3, zMax: 3, zStep: 1, xLen: 8, yLen: 8, zLen: 6,
      tips: true, labels: true, xLabel: "x", yLabel: "y", zLabel: "z", quality: "mid" });
    el.stroke.width = 2;
  } else {
    Object.assign(el, { pointKind: spec.pointKind, axesId: axes ? axes.id : "", p1: spec.pointKind === "dot" ? [1, 1, 1] : [0, 0, 0], p2: [1, 1, 1],
      size: spec.pointKind === "dot" ? 0.1 : 0.02, quality: "mid" });
    if (!axes) { const sh = (v, i) => Math.round((v + (i === 0 ? off : i === 1 ? -off : 0)) * 1000) / 1000; el.p1 = el.p1.map(sh); el.p2 = el.p2.map(sh); }
    el.fill = { color: spec.pointKind === "dot" ? "#FC6255" : "#9A72AC", opacity: 1 };
  }
  insert3d(slide, el, axes);
  markDirty("add");
  toast("3D の形を作っています（数秒かかります）…", "", 3000);
  await showSlide();
  select(el.id);
}

function insert3d(slide, el, axes) {
  if (!axes) { slide.elements.push(el); return; }
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["surface", "curve3d", "point3d"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
}

/** 3D の座標軸に、曲面・曲線・点・矢印を加える。 */
export async function addTo3dAxes(axes, what) {
  if (!need3d()) return;
  const slide = currentSlide();
  if (what === "dot" || what === "arrow") return add3d(what === "dot" ? "dot3d" : "arrow3d", { shape: "point3d", pointKind: what }, axes);
  const el = newShape(what, { shape: what }, axes.x, axes.y);
  if (what === "psurface") {
    Object.assign(el, { shape: "surface", surfKind: "param", axesId: axes.id, expr: "\\sin x \\cos y", xExpr: "2\\cos u \\sin v", yExpr: "2\\sin u \\sin v", zExpr: "2\\cos v",
      lang: "latex", uMin: 0, uMax: 6.2832, vMin: 0, vMax: 3.1416, quality: "mid", colorMode: "checker", color2: "#236B8E" });
    el.fill = { color: "#29ABCA", opacity: 0.85 };
    el.stroke = { color: "#BBBBBB", width: 0.5, opacity: 1 };
  } else if (what === "surface") {
    Object.assign(el, { axesId: axes.id, expr: "\\sin x \\cos y", lang: "latex", uMin: null, uMax: null, vMin: null, vMax: null, quality: "mid", colorMode: "checker", color2: "#236B8E" });
    el.fill = { color: "#29ABCA", opacity: 0.85 };
    el.stroke = { color: "#BBBBBB", width: 0.5, opacity: 1 };
  } else {
    Object.assign(el, { axesId: axes.id, xExpr: "\\cos t", yExpr: "\\sin t", zExpr: "\\frac{t}{4}", lang: "latex", tMin: 0, tMax: 6.283 });
    el.stroke = { color: "#FC6255", width: 4, opacity: 1 };
    el.fill = { color: null, opacity: 0 };
  }
  insert3d(slide, el, axes);
  markDirty("add");
  toast("3D の形を作っています（数秒かかります）…", "", 3000);
  await showSlide();
  select(el.id);
}

/** 要素の表・行列: 選んでいる要素（テキスト・数式・図形）を、重なり順に左上から入れる。何も選んでいなければ、空の 2×2。 */
async function addItemsTable(shape, x, y) {
  const slide = currentSlide();
  const s = store.project.settings;
  const sel = slide.elements.filter((e) => store.selectedIds.includes(e.id));
  const ok = sel.filter((e) => cellItemOk(e, null));
  if (sel.length && ok.length < sel.length) toast(`${sel.length - ok.length} 個の要素は、セルに入れられないので外しました（入れられるのは、グループに入っていないテキスト・数式・図形）。`, "warn", 7000);
  const n = ok.length;
  const cols = n ? Math.ceil(Math.sqrt(n)) : 2, rows = n ? Math.ceil(n / cols) : 2;
  const items = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => ok[i * cols + j]?.id ?? null));
  if (n) { x = ok.reduce((a, e) => a + Number(e.x), 0) / n; y = ok.reduce((a, e) => a + Number(e.y), 0) / n; }
  const el = newShape(shape === "matrix" ? "mmatrix" : "mtable", { shape }, x, y);
  const cells = Array.from({ length: rows }, () => Array(cols).fill(""));
  if (shape === "matrix") Object.assign(el, { cells, items, bracket: "[]", hBuff: 0.5, vBuff: 0.3, fontSize: 36, color: s.defaultColor });
  else {
    Object.assign(el, { cells, items, cellMode: "text", headerRow: false, headerCol: false, fontSize: 36, font: s.defaultFont, color: s.defaultColor, hBuff: 0.6, vBuff: 0.35, outerLines: true });
    el.stroke.width = 2;
  }
  slide.elements.push(el);
  markDirty("add");
  if (!n) toast("空の表を作りました。セルを選んで、パネルの「セルに要素を入れる」で要素を入れます（先に要素を選んでから追加すると、その要素を入れた表になります）。", "", 8000);
  await refreshElement(el);
  select(el.id);
}

/** 行列。 */
async function addMatrix(x, y) {
  const slide = currentSlide();
  const el = newShape("matrix", { shape: "matrix" }, x, y);
  Object.assign(el, { cells: [["a", "b"], ["c", "d"]], bracket: "[]", hBuff: 0.5, vBuff: 0.3, fontSize: 36, color: store.project.settings.defaultColor });
  slide.elements.push(el);
  markDirty("add");
  toast("行列を作っています（LaTeX を初めて使うときは、数秒かかります）…", "", 4000);
  await refreshElement(el);
  select(el.id);
}

// ---------------------------------------------------------------- 統計のグラフ

const STAT_PALETTE = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC", "#5CD0B3", "#F0AC5F", "#E65A4C", "#236B8E", "#C55F73"];

/** 種類ごとの、初めのデータ（表）と列の使い方。 */
export function statSample(kind) {
  const ser = (cols, more = {}) => cols.map((col, i) => ({ col, color: STAT_PALETTE[i], errCol: -1, fit: false, ...more }));
  if (kind === "scatter") {
    return { table: { headers: ["勉強時間", "点数"], rows: [[1, 42], [2, 51], [2.5, 55], [3, 61], [4, 64], [4.5, 72], [5, 70], [6, 83]].map((r) => r.map(String)) },
      xCol: 0, series: ser([1], { fit: true }), xLabel: "勉強時間（時間）", yLabel: "点数" };
  }
  if (kind === "line") {
    return { table: { headers: ["月", "A店", "B店"], rows: [[1, 12, 8], [2, 15, 9], [3, 14, 13], [4, 18, 15], [5, 21, 14], [6, 19, 18]].map((r) => r.map(String)) },
      xCol: 0, series: ser([1, 2]), xLabel: "月", yLabel: "売上" };
  }
  if (kind === "bar" || kind === "stacked") {
    return { table: { headers: ["分類", "2024 年", "2025 年"], rows: [["A", 3, 4], ["B", 5, 6], ["C", 2, 3], ["D", 4, 3]].map((r) => r.map(String)) },
      xCol: 0, series: ser([1, 2]) };
  }
  if (kind === "hist") {
    const v = [45, 52, 55, 58, 61, 62, 64, 66, 67, 68, 70, 71, 72, 74, 75, 77, 79, 82, 85, 91];
    return { table: { headers: ["点数"], rows: v.map((x) => [String(x)]) }, valueCol: 0, series: ser([0]), xLabel: "点数", yLabel: "人数" };
  }
  if (kind === "box") {
    const a = [52, 58, 61, 63, 65, 68, 70, 72, 75, 98], b = [45, 55, 60, 66, 70, 71, 74, 78, 82, 88], c = [60, 62, 65, 66, 67, 69, 70, 72, 73, 75];
    return { table: { headers: ["1 組", "2 組", "3 組"], rows: a.map((x, i) => [String(x), String(b[i]), String(c[i])]) },
      boxCols: [0, 1, 2].map((col) => ({ col, color: STAT_PALETTE[col] })), yLabel: "点数" };
  }
  return { table: { headers: ["名前", "割合"], rows: [["A", 40], ["B", 25], ["C", 20], ["その他", 15]].map((r) => r.map(String)) },
    xCol: 0, valueCol: 1, pieColors: STAT_PALETTE.slice(0, 4) };
}

async function addStatChart(kind, base = "chart", band = false) {
  const slide = currentSlide();
  const s = store.project.settings;
  const { w, h } = store.meta.canvas;
  const el = newShape(base, { shape: "statchart" }, w / 2, h / 2);
  Object.assign(el, {
    chartKind: kind, ...statSample(kind), autoX: true, autoY: true, axisColor: s.defaultColor, numSize: 20, labelSize: 26,
    dotSize: 0.06, lineWidth: 3, barWidth: 0.7, fillOpacity: 0.8, legend: "inside", grid: false, showPercent: true, showNames: true,
    donut: 0, startAngle: 90, fitLabel: true, decimals: 1, bins: 0, binWidth: 0, density: false,
    width: (kind === "pie" ? 4 : 7) * 135, height: (kind === "pie" ? 4 : 4.5) * 135,
    horizontal: false, percent: false, segLabels: false,
  });
  if (band) {  // 帯グラフ: アンケートの回答の割合
    Object.assign(el, {
      table: { headers: ["年代", "賛成", "どちらでもない", "反対"], rows: [["10 代", 42, 25, 33], ["20 代", 35, 30, 35], ["30 代", 28, 32, 40], ["40 代", 22, 30, 48]].map((r) => r.map(String)) },
      xCol: 0, series: [1, 2, 3].map((col, i) => ({ col, color: STAT_PALETTE[i], errCol: -1, fit: false })),
      horizontal: true, percent: true, segLabels: true, decimals: 0, xLabel: "割合（\\%）", yLabel: "", height: 3.5 * 135,
    });
  }
  el.x = w / 2; el.y = h / 2;
  slide.elements.push(el);
  markDirty("add");
  toast("グラフを作っています（数字・名前の LaTeX を初めて使うときは、数秒かかります）…", "", 4000);
  await refreshElement(el);
  select(el.id);
}

/** コード・棒グラフ・LaTeX の文章・題名・箇条書き。 */
async function addTextLike(base, shape, x, y, spec = {}) {
  const slide = currentSlide();
  const s = store.project.settings;
  const { w } = store.meta.canvas;
  const ph = shape === "title" ? slide.elements.find((e) => e.type === "shape" && e.shape === "title" && e.placeholder) : null;
  if (ph) { select(ph.id); toast("このスライドには、自動で置いた題名があります。パネルで文字を書いてください。", "", 4000); return; }
  const el = newShape(base, { shape }, x, y);
  if (shape === "code") {
    Object.assign(el, { code: "def f(x):\n    return x ** 2\n\nprint(f(3))", language: "python", style: "one-dark", fontSize: 24, font: "", lineNumbers: true,
      lineFrom: 1, background: "rectangle", bgColor: null, textColor: null, tabWidth: 4 });
  } else if (shape === "barchart") {
    Object.assign(el, { bars: [{ name: "A", value: 3, color: "#58C4DD" }, { name: "B", value: 5, color: "#83C167" }, { name: "C", value: 2, color: "#FFC300" }, { name: "D", value: 4, color: "#FC6255" }],
      autoRange: true, width: 6 * 135, height: 4 * 135, barWidth: 0.6, axisColor: s.defaultColor, numSize: 24, labelSize: 30, showValues: false, decimals: 0 });
    el.fill = { color: null, opacity: 0.7 };
    el.stroke.width = 3;
    el.x = w / 2; el.y = store.meta.canvas.h / 2;
  } else if (shape === "samplespace") {
    Object.assign(el, { width: 4 * 135, height: 3 * 135, split: "columns", title: "", labelSize: 30, labelColor: s.defaultColor,
      parts: [{ p: 0.4, color: "#58C4DD", label: "P(A)", sub: [{ p: 0.7, color: "#236B8E", label: "P(B|A)" }, { p: 0.3, color: "#9CDCEB", label: "" }] },
        { p: 0.6, color: "#FC6255", label: "P(\\bar{A})", sub: [{ p: 0.2, color: "#CF5044", label: "P(B|\\bar{A})" }, { p: 0.8, color: "#FF8080", label: "" }] }] });
    el.fill = { color: null, opacity: 0.8 };
    el.stroke.width = 2;
  } else if (shape === "theorem") {
    const kind = spec.kind ?? "theorem";
    const body = {
      theorem: "仮定: $f$ は閉区間 $[a,b]$ で連続で、$f(a)<0<f(b)$\n結論: $f(c)=0$ となる $c\\in(a,b)$ が存在する",
      definition: "関数 $f$ が点 $a$ で連続であるとは、$\\lim_{x\\to a} f(x) = f(a)$ が成り立つことをいう。",
      proof: "1 行が 1 段落です。段落ごとに出す動きを作れます。\n最後の段落の右下に、証明の終わりの印が付きます。",
    }[kind] ?? "ここに内容を書きます。数式は $x^2$ のように \\$ で囲みます（\\$ と書くと、ドル記号そのものになります）。";
    Object.assign(el, { kind, title: "", body, width: 900, numbered: kind !== "proof", proofOf: "", qed: kind === "proof", boxed: null,
      fontSize: 32, color: s.defaultColor });
  } else if (shape === "bullets") {
    Object.assign(el, { items: ["1 つ目の項目", "2 つ目の項目", "3 つ目の項目"], fontSize: 36, color: s.defaultColor, buff: 0.5, dotScale: 2 });
  } else {
    Object.assign(el, { latex: shape === "title" ? "題名" : "LaTeX の文章（$x^2$ のように数式も書けます）", fontSize: 48, color: s.defaultColor });
    if (shape === "title") Object.assign(el, { underline: true, matchWidth: false, x: w / 2 });
  }
  slide.elements.push(el);
  markDirty("add");
  toast(shape === "code" ? "コードを作っています…" : "LaTeX で作っています（初めて使うときは、数秒かかります）…", "", 4000);
  await refreshElement(el);
  if (shape === "title") {
    const tpl = store.masterId ? null : titleTemplate(masterOf(slide));
    if (tpl) { Object.assign(el, structuredClone(tpl)); await refreshElement(el); } // マスターの題名の型にそろえる
    else {
      // Manim の Title と同じく、上の端から 0.5 単位の所に置く
      const h = objectHeight(el.id);
      if (h) { el.y = Math.round((0.5 * 135 + h / 2) * 10) / 10; moveObject(el); }
    }
  }
  select(el.id);
}

/** グラフ理論のグラフ（Graph・DiGraph）。頂点と辺はパネルで編集する。 */
async function addNetGraph(base, directed, x, y) {
  const slide = currentSlide();
  const el = newShape(directed ? "digraph" : "graph", { shape: "netgraph" }, x, y);
  Object.assign(el, {
    directed, layout: directed ? "tree" : "kamada_kawai", layoutScale: 2, seed: 1, root: "A", positions: {},
    vertices: ["A", "B", "C", "D", "E"].map((name, i) => ({ name, group: i < 2 ? 0 : 1, color: null })),
    edges: directed ? [["A", "B"], ["A", "C"], ["C", "D"], ["C", "E"]] : [["A", "B"], ["B", "C"], ["C", "A"], ["C", "D"], ["D", "E"]],
    showLabels: true, labelSize: 30, labelColor: "#000000", vertexRadius: 0.15, tipSize: 0.2,
  });
  el.fill = { color: "#58C4DD", opacity: 1 };
  el.stroke.width = 3;
  slide.elements.push(el);
  markDirty("add");
  toast("グラフを作っています（頂点の名前の LaTeX を初めて使うときは、数秒かかります）…", "", 4000);
  await refreshElement(el);
  select(el.id);
}

/** 注釈（囲み枠・背景の四角・下線・×印・円弧の中かっこ）。選んでいる要素に付ける。 */
async function addAnnot(kind) {
  const slide = currentSlide();
  const target = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
  const names = { box: "囲み枠", bg: "背景の四角", underline: "下線", cross: "×印", arcbrace: "円弧の中かっこ", animated: "色が流れる枠" };
  if (!target || (kind === "arcbrace" && !(target.type === "shape" && target.shape === "arc"))) {
    toast(kind === "arcbrace" ? "円弧の中かっこは、円弧（または扇形）を 1 つ選んでから追加します。" : `${names[kind]}は、付ける要素（テキスト・数式・図形など）を 1 つ選んでから追加します。`, "warn", 7000);
    return;
  }
  if (target.type === "shape" && target.shape === "annot") { toast("注釈に注釈は付けられません。", "warn"); return; }
  const dep = ["graph", "graphpart", "axdot", "curve2d", "implicit", "angle", "brace", "balloon", "boolean", "vector", "linegraph", "points", "trace", "field", "surface", "curve3d", "point3d"];
  if (kind === "animated" && (target.type === "image" || target.type === "group" || (target.type === "shape" && dep.includes(target.shape)))) {
    toast("色が流れる枠は、テキスト・数式・図形（座標軸などに付いていないもの）に付けられます。", "warn", 7000);
    return;
  }
  const el = newShape({ box: "box", bg: "bgrect", underline: "uline", cross: "cross", arcbrace: "abrace", animated: "aframe" }[kind], { shape: "annot" }, target.x, target.y);
  const s = store.project.settings;
  Object.assign(el, { annotKind: kind, targetId: target.id, buff: kind === "bg" ? 0.1 : 0.1, cornerRadius: kind === "box" ? 0.1 : 0, scaleFactor: 1, outside: true, label: "", labelSize: 30, labelColor: null, width: 300, height: 100,
    colors: ["#29ABCA", "#9CDCEB", "#236B8E", "#736357"], cycleRate: 0.5 });
  el.stroke = { color: { box: "#FFC300", cross: "#FC6255" }[kind] ?? s.defaultColor, width: kind === "cross" ? 6 : kind === "animated" ? 3 : 4, opacity: 1 };
  el.fill = kind === "bg" ? { color: s.background, opacity: 0.75 } : { color: null, opacity: 0 };
  if (target.groupId) el.groupId = target.groupId;
  // 背景の四角は付ける要素のすぐ後ろ、ほかはすぐ前の重なり順
  const k = slide.elements.indexOf(target) + (kind === "bg" ? 0 : 1);
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

// 接線を引ける要素（書き出しの TANGENT_TARGETS と同じ）
const TANGENT_TARGETS = ["line", "rect", "ellipse", "polygon", "star", "arc", "path", "annulus", "elbow", "graph", "curve2d", "implicit", "fcurve", "linegraph", "boolean"];
/** 任意の曲線の接線（TangentLine）。選んでいる曲線に、長さの割合 0.25 の所で引く。 */
async function addTangent() {
  const slide = currentSlide();
  const target = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
  if (!(target?.type === "shape" && TANGENT_TARGETS.includes(target.shape))) {
    toast("接線は、線・図形・パス・グラフ・曲線を 1 つ選んでから追加します。", "warn", 7000);
    return;
  }
  const el = newShape("tline", { shape: "tangent" }, target.x, target.y);
  Object.assign(el, { targetId: target.id, alpha: 0.25, length: 2, dot: true });
  el.stroke = { color: "#FFC300", width: 4, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (target.groupId) el.groupId = target.groupId;
  slide.elements.splice(slide.elements.indexOf(target) + 1, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** ズーム（ZoomedScene）。スライドに 1 つ。拡大を映す所は右上、拡大する所は画面の中央から。 */
async function addZoom() {
  const slide = currentSlide();
  if (store.project.settings.use3d) { toast("ズームは、3D を使うプロジェクトでは使えません（Manim の ZoomedScene は 2D のシーン）。", "warn", 7000); return; }
  const had = slide.elements.find((e) => e.type === "shape" && e.shape === "zoom");
  if (had) { toast("ズームは 1 つのスライドに 1 つまでです（Manim のズームのカメラは 1 つ）。", "warn", 6000); select(had.id); return; }
  const { w, h } = store.meta.canvas, P = h / 8;
  const el = newShape("zoom", { shape: "zoom" }, w - P * 0.5 - 1.5 * P, P * 0.5 + 1.5 * P);
  Object.assign(el, { width: 3 * P, height: 3 * P, frameX: w / 2, frameY: h / 2, factor: 0.3, displayColor: null });
  el.stroke = { color: "#FFC300", width: 3, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  slide.elements.push(el); // 映す所はいちばん手前
  markDirty("add");
  await showSlide();
  select(el.id);
  toast("オレンジの丸をドラッグすると、拡大する所が動きます。", "", 6000);
}

/** 軌跡（TracedPath）。選んでいる要素（点など）が動いた跡を線で残す。 */
async function addTrace() {
  const slide = currentSlide();
  const target = store.selectedIds.length === 1 ? findElement(store.selectedIds[0]) : null;
  if (!target || target.type === "group" || (target.type === "shape" && ["trace", "annot"].includes(target.shape))) {
    toast("軌跡は、たどる要素（点・座標の点・図形など）を 1 つ選んでから追加します。ステップでその要素を動かすと、通った跡が線で残ります。", "warn", 8000);
    return;
  }
  const el = newShape("trace", { shape: "trace" }, target.x, target.y);
  Object.assign(el, { targetId: target.id, dissipating: 0 });
  el.stroke = { color: "#FC6255", width: 3, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (target.groupId) el.groupId = target.groupId;
  slide.elements.splice(slide.elements.indexOf(target), 0, el); // 跡はたどる要素の後ろ
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
  toast("キャンバスでは、たどる要素の所に「軌跡」の目印を出します（描画では、要素が動いた跡が線で残ります）。", "", 6000);
}

/** 計算した点列（座標軸の上）。source: code・ode・integral・montecarlo・trials。 */
export async function addPoints(axes, source = "code") {
  const slide = currentSlide();
  const el = newShape("pts", { shape: "points" }, axes.x, axes.y);
  const x0 = Number(axes.xMin), x1 = Number(axes.xMax);
  const params = {
    ode: { f: "-y + \\sin x", lang: "latex", x0: Math.max(0, x0), y0: 1, x1: Math.min(x1, 6), h: 0.5, method: "euler" },
    integral: { f: "\\frac{x^2}{2}", lang: "latex", a: Math.max(0, x0), b: Math.min(x1, Math.max(0, x0) + 2), n: 8, rule: "left" },
    montecarlo: { n: 500, seed: 1 },
    trials: { n: 200, seed: 1, kind: "dice" },
    code: { seed: 1 },
  }[source];
  Object.assign(el, { axesId: axes.id, source, params, style: source === "montecarlo" ? "scatter" : "line", color2: "#D9534F", dotRadius: source === "montecarlo" ? 0.03 : 0.05,
    code: "# pts に (x, y) の並びを入れます。np（numpy）・math・random・rng（乱数）が使えます\npts = [(x, np.sin(x)) for x in np.linspace(0, 6, 61)]" });
  el.stroke = { color: "#2E6FD8", width: 4, opacity: 1 };
  el.fill = { color: null, opacity: 0.35 };
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["graph", "field", "axdot", "vector", "linegraph", "points"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  toast("計算して描いています…", "", 3000);
  await showSlide();
  select(el.id);
}

/** 折れ線グラフ（座標軸の上）。 */
export async function addLineGraph(axes) {
  const slide = currentSlide();
  const el = newShape("lgraph", { shape: "linegraph" }, axes.x, axes.y);
  const x0 = Math.max(0, Number(axes.xMin)), y0 = Math.max(0, Number(axes.yMin)), y1 = Number(axes.yMax);
  const mid = (y0 + y1) / 2;
  Object.assign(el, { axesId: axes.id, points: [0, 1, 2, 3].map((k) => [x0 + k, Math.round((mid + (k % 2 ? 0.6 : -0.4) * (y1 - y0) / 3) * 100) / 100]), dots: true, dotRadius: 0.08, dotColor: null });
  el.stroke = { color: "#FC6255", width: 4, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["graph", "field", "axdot", "vector", "linegraph", "points"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** ベクトル。axes を渡すと、その座標軸の座標で（原点から）。 */
export async function addVector(axes, x, y) {
  const slide = currentSlide();
  const el = newShape("vec", { shape: "vector" }, axes ? axes.x : x, axes ? axes.y : y);
  Object.assign(el, { axesId: axes ? axes.id : "", xExpr: "2", yExpr: "1", x0Expr: "0", y0Expr: "0", lang: "latex", coords: false, coordSize: 30, tipSize: 0.25 });
  el.stroke = { color: axes?.linear ? "#FFC300" : "#FC6255", width: 6, opacity: 1 }; // 線形変換の平面では、基底ベクトル（緑・赤）と分かれる黄色
  el.fill = { color: null, opacity: 0 };
  if (axes?.groupId) el.groupId = axes.groupId;
  if (axes) {
    let k = slide.elements.indexOf(axes) + 1;
    while (["graph", "field", "axdot", "vector"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
    slide.elements.splice(k, 0, el);
  } else slide.elements.push(el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 図形の合成（和・共通部分・切り抜き・重ならない部分）。選んでいる図形から作る。 */
const BOOLEAN_OK = ["rect", "ellipse", "polygon", "star", "arc", "dot", "path", "annulus", "boolean"];
async function addBoolean(op) {
  const slide = currentSlide();
  const sel = store.selectedIds.map((id) => findElement(id)).filter(Boolean);
  const shapes = sel.filter((e) => e.type === "shape" && BOOLEAN_OK.includes(e.shape));
  const two = op === "difference" || op === "exclusion";
  if (shapes.length !== sel.length || (two ? shapes.length !== 2 : shapes.length < 2)) {
    toast(`図形の合成は、${two ? "2 つ" : "2 つ以上"}の図形（長方形・円・多角形・星・扇形・点・曲線・円環・合成した図形）を選んでから追加します（Ctrl を押しながらクリックで選べます）。${op === "difference" ? "切り抜きは、先に選んだ図形から後に選んだ図形を切り抜きます。" : ""}`, "warn", 8000);
    return;
  }
  if (shapes.some((e) => e.dashed)) { toast("破線の図形は合成に使えません（合成した図形の方を破線にできます）。", "warn", 6000); return; }
  const el = newShape(op === "union" ? "union" : op === "intersection" ? "inter" : op === "difference" ? "diff" : "excl", { shape: "boolean" }, 960, 540);
  Object.assign(el, { op, operandIds: shapes.map((e) => e.id) });
  el.fill = { color: "#58C4DD", opacity: 0.6 };
  // 元の図形は、初めは表示しない（合成した図形だけが見える）。キャンバスでは薄く表示される
  for (const e of shapes) e.visibleAtStart = false;
  const k = Math.max(...shapes.map((e) => slide.elements.indexOf(e))) + 1;
  slide.elements.splice(k, 0, el);
  markDirty("add");
  await showSlide();
  select(el.id);
  toast("元の図形は「初めから表示」をオフにしました（キャンバスでは薄く表示されます）。元の図形を動かすと、合成した図形も作り直されます。", "", 7000);
}

/**
 * 角の印の形（2 本の線の交わる所と、Manim の向きの単位ベクトル）。線が平行なら null。
 * 線は中心 (x, y) と、始点→終点の半分 (dx, dy)（キャンバスの px。始点 (x−dx, y−dy)、終点 (x+dx, y+dy)）。
 */
export function angleGeom(l1, l2) {
  if (!l1 || !l2) return null;
  const S1 = [l1.x - l1.dx, l1.y - l1.dy], E1 = [l1.x + l1.dx, l1.y + l1.dy];
  const S2 = [l2.x - l2.dx, l2.y - l2.dy], E2 = [l2.x + l2.dx, l2.y + l2.dy];
  const d1 = [E1[0] - S1[0], E1[1] - S1[1]], d2 = [E2[0] - S2[0], E2[1] - S2[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  const n1 = Math.hypot(...d1), n2 = Math.hypot(...d2);
  if (!n1 || !n2 || Math.abs(den) < 1e-9 * n1 * n2) return null;
  const t = ((S2[0] - S1[0]) * d2[1] - (S2[1] - S1[1]) * d2[0]) / den;
  const X = [S1[0] + t * d1[0], S1[1] + t * d1[1]];
  // Manim の向き（y は上が正）
  const u1 = [d1[0] / n1, -d1[1] / n1], u2 = [d2[0] / n2, -d2[1] / n2];
  const far = (S, E) => (Math.hypot(E[0] - X[0], E[1] - X[1]) >= Math.hypot(S[0] - X[0], S[1] - X[1]) ? 1 : -1);
  return { X, u1, u2, body: [far(S1, E1), far(S2, E2)] };
}

/** quadrant の角を、1 本目の向きから反時計回りに測った大きさ（ラジアン、0〜2π）。 */
export function angleCcw(g, q) {
  const a1 = Math.atan2(g.u1[1] * q[0], g.u1[0] * q[0]), a2 = Math.atan2(g.u2[1] * q[1], g.u2[0] * q[1]);
  return (((a2 - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** 今の形で、角の印が外側（180° を超える角）になっているか。reflex の指定があればそれ、古いプロジェクトは other から求める。 */
export function angleIsReflex(el, g) {
  if (typeof el.reflex === "boolean") return el.reflex;
  if (!g) return false;
  const ccw = angleCcw(g, el.quadrant);
  return (el.other ? 2 * Math.PI - ccw : ccw) > Math.PI;
}

/** 2 本の線（直線・矢印）の間の角の印。選んでいる 2 本の線に付ける。 */
async function addAngle(angleKind) {
  const slide = currentSlide();
  const lines = store.selectedIds.map((id) => findElement(id)).filter((e) => e?.type === "shape" && e.shape === "line" && !e.arcAngle);
  if (lines.length !== 2) { toast("角の印は、2 本の真っすぐな線（矢印も可。曲げた線は不可）を選んでから追加します（Ctrl を押しながらクリックで 2 本選べます）。", "warn", 7000); return; }
  const el = newShape(angleKind === "right" ? "rangle" : angleKind === "tangent" ? "tarc" : "angle", { shape: "angle" }, lines[0].x, lines[0].y);
  // 最初は、2 本の線の「線のある側」どうしの内側の角（三角形の頂点なら、三角形の内側の角）
  const g = angleGeom(lines[0], lines[1]);
  Object.assign(el, { line1Id: lines[0].id, line2Id: lines[1].id, angleKind, radius: angleKind === "right" ? 0.3 : angleKind === "tangent" ? 0.6 : 0.5,
    quadrant: g ? g.body : [1, 1], other: false, reflex: false, dot: false, label: "", labelSize: 36, labelColor: null });
  el.stroke.width = 3;
  const k = Math.max(slide.elements.indexOf(lines[0]), slide.elements.indexOf(lines[1])) + 1;
  slide.elements.splice(k, 0, el);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** グラフの補助（面積・リーマン和・接線・割線）。 */
export async function addGraphPart(graph, partKind) {
  const slide = currentSlide();
  const axes = findElement(graph.axesId);
  const el = newShape(partKind, { shape: "graphpart" }, graph.x, graph.y);
  const xm = axes ? (Number(axes.xMin) + Number(axes.xMax)) / 2 : 1;
  Object.assign(el, { graphId: graph.id, partKind, x0: axes ? Math.max(0, Number(axes.xMin)) : 0, x1: axes ? Math.min(xm + 1, Number(axes.xMax)) : 2, dx: partKind === "secant" ? 1 : 0.5, atX: xm, length: 3, sample: "left", color2: "#83C167", legs: true, dot: true });
  Object.assign(el, { c: 0, graph2Id: null, label: { glabel: "f(x)", tlabel: "x_0" }[partKind] ?? "", labelSize: 36, direction: "UR", triangleSize: 0.25, gradient: null });
  el.fill = { color: partKind === "tlabel" ? "#FFFFFF" : "#58C4DD", opacity: partKind === "area" ? 0.4 : partKind === "tlabel" ? 1 : 0.6 };
  el.stroke = { color: { tangent: "#FFC300", secant: "#FC6255", derivative: "#83C167", antiderivative: "#9A72AC" }[partKind] ?? store.project.settings.defaultColor, width: partKind === "riemann" ? 1 : 4, opacity: 1 };
  if (["glabel", "tlabel"].includes(partKind)) el.dot = partKind === "glabel" ? false : true;
  if (graph.groupId) el.groupId = graph.groupId;
  // 面積・リーマン和はグラフの後ろ、接線・割線は前
  const k = slide.elements.indexOf(graph) + (["area", "riemann"].includes(partKind) ? 0 : 1);
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 座標軸の上の媒介変数曲線・陰関数の曲線。 */
export async function addOnAxes(axes, kind) {
  const slide = currentSlide();
  const el = newShape(kind === "curve2d" ? "pcurve" : "implicit", { shape: kind }, axes.x, axes.y);
  if (kind === "curve2d") Object.assign(el, { axesId: axes.id, xExpr: "\\cos t", yExpr: "\\sin 2t", lang: "latex", tMin: 0, tMax: 6.283 });
  else Object.assign(el, { axesId: axes.id, expr: "x^2 + y^2 = 4", lang: "latex" });
  el.stroke = { color: "#9A72AC", width: 4, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["graph", "field", "axdot", "curve2d", "implicit", "graphpart"].includes(slide.elements[k]?.shape) && (slide.elements[k].axesId === axes.id || slide.elements[k].graphId)) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 数値の表示（DecimalNumber）。スライドに値があれば、最初の値を表示する。 */
async function addNumber(x, y) {
  const slide = currentSlide();
  const s = store.project.settings;
  const el = newShape("num", { shape: "number" }, x, y);
  const v = (slide.values ?? []).find((q) => q.name);
  Object.assign(el, { valueName: v ? v.name : "", number: 0, decimals: 2, fontSize: 48, color: s.defaultColor, unit: "", includeSign: false });
  slide.elements.push(el);
  markDirty("add");
  if (!v) toast("スライドの値（ValueTracker）はまだありません。スライドのパネル（要素を選んでいないとき）の「＋値」で作ると、値に連動して数字が変わります。", "", 7000);
  await refreshElement(el);
  select(el.id);
}

/** 座標軸の上の点（x・y は式。スライドの値を使うと、値に合わせて動く）。 */
export async function addAxDot(axes) {
  const slide = currentSlide();
  const el = newShape("point", { shape: "axdot" }, axes.x, axes.y);
  const v = (slide.values ?? []).find((q) => q.name);
  Object.assign(el, { axesId: axes.id, xExpr: v ? v.name : "1", yExpr: v ? `${v.name}^2` : "1", lang: "latex", radius: 0.08 * 135, lines: true });
  el.stroke = { color: store.project.settings.defaultColor, width: 2, opacity: 1 };
  el.fill = { color: "#FC6255", opacity: 1 };
  if (axes.groupId) el.groupId = axes.groupId;
  let k = slide.elements.indexOf(axes) + 1;
  while (["graph", "field", "axdot"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
  slide.elements.splice(k, 0, el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** ベクトル場（矢印・流線）。axes を渡すと、その座標軸に重ねる（座標軸のすぐ上の重なり順）。 */
export async function addField(axes, fieldKind = "arrows") {
  const slide = currentSlide();
  const { w, h } = store.meta.canvas;
  const el = newShape(fieldKind === "stream" ? "stream" : "field", { shape: "field" }, axes ? axes.x : w / 2, axes ? axes.y : h / 2);
  Object.assign(el, {
    fieldKind, axesId: axes ? axes.id : "", fx: "-y", fy: "x", lang: "latex", xMin: -3, xMax: 3, yMin: -2, yMax: 2,
    width: 6 * 135, height: 4 * 135, step: 0.5, lengthMode: "limit", lengthScale: 1, colorMode: "single", colorMax: 2, virtualTime: 3,
  });
  el.stroke = { color: fieldKind === "stream" ? "#236B8E" : store.project.settings.defaultColor, width: fieldKind === "stream" ? 1.5 : 2, opacity: 1 };
  el.fill = { color: null, opacity: 0 };
  if (axes) {
    if (axes.groupId) el.groupId = axes.groupId;
    let k = slide.elements.indexOf(axes) + 1;
    while (["graph", "field", "axdot"].includes(slide.elements[k]?.shape) && slide.elements[k].axesId === axes.id) k++;
    slide.elements.splice(k, 0, el);
    compactGroups(slide);
  } else slide.elements.push(el);
  markDirty("add");
  await showSlide();
  select(el.id);
}

/** 新しい吹き出し（中にテキストを 1 つ入れ、吹き出しと中身をグループにする）。 */
async function addBalloon(spec, x, y) {
  const slide = currentSlide();
  const text = makeElement("text", x, y);
  const b = newBalloon(spec, x, y, [text.id]);
  const g = { id: uid("g"), var: uniqueVar("group"), rotation: 0 };
  b.groupId = g.id;
  text.groupId = g.id;
  slideGroups(slide).push(g);
  slide.elements.push(b, text); // 吹き出しを中身の後ろに
  markDirty("add");
  await showSlide();
  select(text.id); // すぐに文字を打てるように、中のテキストを選ぶ
  document.querySelector("#props .rt-area")?.focus();
}

/** 選択中の要素を吹き出しで囲む（吹き出しと中身をグループにする）。 */
export async function wrapInBalloon(balloonShape = "rect") {
  const slide = currentSlide();
  const ids = store.selectedIds.filter((id) => !isBalloon(findElement(id)));
  if (!ids.length) { toast("囲む要素を選んでください。", "warn"); return; }
  const first = slide.elements.findIndex((e) => ids.includes(e.id));
  const b = newBalloon({ shape: "balloon", balloonShape }, 0, 0, ids);
  slide.elements.splice(first, 0, b); // いちばん後ろの中身の、さらに後ろ
  markDirty("add");
  await showSlide();
  selectMany([b.id, ...ids]);
  groupSelection();
}

/** 選択中の吹き出し 1 つに、ほかの選択中の要素を中身として入れる（同じグループにする）。 */
export async function putIntoBalloon() {
  const slide = currentSlide();
  const els = store.selectedIds.map((id) => findElement(id)).filter(Boolean);
  const b = els.find(isBalloon);
  const add = els.filter((e) => e !== b && !isBalloon(e));
  if (!b || !add.length) return;
  b.contentIds = [...new Set([...(b.contentIds ?? []), ...add.map((e) => e.id)])];
  if (b.groupId) {
    for (const e of add) e.groupId = b.groupId;
    compactGroups(slide);
    markDirty("prop");
    await showSlide();
    select(b.groupId);
  } else {
    // 吹き出しにグループが無ければ、吹き出しと中身でグループを作る
    markDirty("prop");
    await showSlide();
    selectMany([b.id, ...b.contentIds]);
    groupSelection();
  }
}

/** 吹き出しに中身（テキスト・数式）を加える。いまの中身のすぐ下に、左右の中央をそろえて置く。 */
export async function addBalloonContent(b, type) {
  const slide = currentSlide();
  const P = store.meta.canvas.h / 8;
  // 吹き出しの向きで考える: 中心から下へ「いまの中身の下端」まで → そこから少し空けた所に置く
  const phi = -(Number(b.rotation) || 0) * Math.PI / 180, c = Math.cos(phi), sn = Math.sin(phi);
  const at = (v) => [b.x - v * sn, b.y + v * c]; // 吹き出しの向きで、中心から下へ v 進んだ点
  const bottom = b.height / 2 - b.padY * P;
  const [x0, y0] = at(bottom + 60);
  const el = makeElement(type, x0, y0);
  el.rotation = Number(b.rotation) || 0; // 吹き出しと同じ向き
  if (b.groupId) el.groupId = b.groupId;
  b.contentIds = [...(b.contentIds ?? []), el.id];
  slide.elements.push(el);
  compactGroups(slide);
  markDirty("add");
  await showSlide();
  // 実際の高さが分かったので、中身の下端から少し空けた位置に置き直す
  const h = objectHeight(el.id, phi);
  if (h) {
    const [x, y] = at(bottom + 0.15 * P + h / 2);
    el.x = Math.round(x * 10) / 10;
    el.y = Math.round(y * 10) / 10;
    moveObject(el);
  }
  select(el.id);
}

/** 吹き出しから中身を外す（グループからも出す）。 */
export async function removeBalloonContent(b, id) {
  const slide = currentSlide();
  b.contentIds = (b.contentIds ?? []).filter((x) => x !== id);
  const el = findElement(id);
  if (el && el.groupId && el.groupId === b.groupId) delete el.groupId;
  compactGroups(slide);
  markDirty("prop");
  await showSlide();
  select(b.id);
}

// ---------------------------------------------------------------- メニュー

let menu = null;
function closeMenu() { menu?.remove(); menu = null; }

/** メニューの項目: 「円環（Annulus）」は、名前と、2 行目に小さく括弧の中（Manim のクラス名など）。 */
function menuLabel(label) {
  const m = /^(.*?)（([^（）]*)）$/.exec(label);
  return m ? `<span>${m[1]}</span><small>${m[2]}</small>` : `<span>${label}</span>`;
}

let menuTab = "basic"; // 前回開いた分類

export function setupShapeMenu(button) {
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    menu = document.createElement("div");
    menu.className = "shape-menu";
    const use3d = !!store.project?.settings?.use3d;
    menu.innerHTML = `<div class="shape-tabs">${SHAPE_CATEGORIES.map(([k, l]) => `<button type="button" data-cat="${k}">${l}</button>`).join("")}</div>
      ${SHAPE_CATEGORIES.map(([k]) => `<div class="shape-items" data-items="${k}">${SHAPE_PRESETS.map(([label, , , c], i) => (c === k ? `<button type="button" data-i="${i}" title="${label}">${menuLabel(label)}</button>` : "")).join("")}
        ${k === "3d" && !use3d ? `<p class="hint shape-note">3D の要素は、プロジェクト設定で「3D を使う」をオンにすると置けます。</p>` : ""}
        ${k === "math" ? `<p class="hint shape-note">作図（中点〜傍心）は、先に元の点・線・円・三角形を選んでから押します（Ctrl＋クリックで複数選ぶ）。作った時に一度だけ計算するので、元の図形を動かしてもついてきません。</p>
          <label class="row shape-note"><input type="checkbox" data-trace ${traceOnNow() ? "checked" : ""}> 作図の跡（コンパスの弧）も描き、描く順のステップを足す</label>` : ""}</div>`).join("")}`;
    const show = (k) => {
      menuTab = k;
      menu.querySelectorAll("[data-cat]").forEach((b) => b.classList.toggle("on", b.dataset.cat === k));
      menu.querySelectorAll("[data-items]").forEach((d) => { d.hidden = d.dataset.items !== k; });
    };
    show(menuTab);
    document.body.appendChild(menu);
    const r = button.getBoundingClientRect();
    // 画面の右端・下端からはみ出さないようにする
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - mw - 8))}px`;
    menu.style.top = `${Math.max(4, Math.min(r.bottom + 4, window.innerHeight - mh - 8))}px`;
    menu.querySelector("[data-trace]")?.addEventListener("change", (ev) => { try { localStorage.setItem("construct.trace", ev.target.checked ? "1" : "0"); } catch { /* 覚えられなくても続ける */ } });
    menu.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-trace]") || ev.target.closest("label")) return;
      const t = ev.target.closest("[data-cat]");
      if (t) { show(t.dataset.cat); return; }
      const b = ev.target.closest("[data-i]");
      if (!b) return;
      closeMenu();
      addShape(Number(b.dataset.i));
    });
  });
  document.addEventListener("mousedown", (e) => { if (menu && !menu.contains(e.target) && e.target !== button) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
}

export const SHAPE_LABEL = {
  line: "線", rect: "長方形", ellipse: "楕円", polygon: "多角形", star: "星", arc: "円弧", dot: "点", balloon: "吹き出し",
};

export function shapeLabel(el) {
  if (el.shape === "line") {
    const base = el.startTip && el.endTip ? "両矢印" : (el.startTip || el.endTip) ? "矢印" : el.dashed ? "破線" : el.arcAngle ? "弧" : "直線";
    return `${el.arcAngle && base !== "弧" ? "曲がった" : ""}${base}${el.label ? ` ${el.label}` : ""}`;
  }
  if (el.shape === "dot") return el.pname ? `点 ${el.pname}` : el.label ? `点 ${el.label}` : el.ring ? "輪の付いた点" : "点";
  if (el.shape === "annulus") return el.sector ? "扇形の円環" : "円環";
  if (el.shape === "elbow") return "直角の印（Elbow）";
  if (el.shape === "star" && el.polygram) return "星形多角形";
  if (el.shape === "code") return `コード（${el.language ?? ""}）`;
  if (el.shape === "part") return `部品「${el.partName || "?"}」`;
  if (el.shape === "barchart") return `棒グラフ ${el.bars?.length ?? 0} 本`;
  if (el.shape === "statchart" && el.chartKind === "stacked" && el.percent && el.horizontal) return `帯グラフ（${el.table?.rows?.length ?? 0} 行）`;
  if (el.shape === "statchart") return `${{ scatter: "散布図", line: "折れ線グラフ", bar: "集合縦棒グラフ", stacked: "積み上げ縦棒グラフ", hist: "ヒストグラム", box: "箱ひげ図", pie: "円グラフ" }[el.chartKind] ?? "統計のグラフ"}（${el.table?.rows?.length ?? 0} 行）`;
  if (el.shape === "tex") return `文章 ${(el.latex ?? "").split("\n")[0].slice(0, 16)}`;
  if (el.shape === "title") return `題名 ${(el.latex ?? "").slice(0, 16)}`;
  if (el.shape === "bullets") return `箇条書き ${el.items?.length ?? 0} 項目`;
  if (el.shape === "annot") return { box: "囲み枠", bg: "背景の四角", underline: "下線", cross: "×印", arcbrace: "円弧の中かっこ", animated: "色が流れる枠" }[el.annotKind] ?? "注釈";
  if (el.shape === "trace") return "軌跡";
  if (el.shape === "zoom") return "ズーム";
  if (el.shape === "tangent") return "接線";
  if (el.shape === "fcurve") return { function: `y = ${el.expr ?? ""}`, parametric: "媒介変数曲線", implicit: el.expr ?? "陰関数" }[el.curveKind] ?? "曲線";
  if (el.shape === "linegraph") return `折れ線グラフ ${el.points?.length ?? 0} 点`;
  if (el.shape === "vector") return `ベクトル (${el.xExpr}, ${el.yExpr})`;
  if (el.shape === "boolean") return { union: "和", intersection: "共通部分", difference: "切り抜き", exclusion: "重ならない部分" }[el.op] ?? "図形の合成";
  if (el.shape === "ellipse" && el.keepAspect) return "円";
  if (el.shape === "arc" && el.sector) return "扇形";
  if (el.shape === "path") return el.source === "freehand" ? "手書き" : "ベジェ曲線";
  if (el.shape === "axes") return { numberline: "数直線", axes: "座標軸", plane: "座標平面", polar: "極座標の平面", complex: "複素平面" }[el.axesKind] ?? "座標軸";
  if (el.shape === "graph") return `グラフ ${el.expr ?? ""}`;
  if (el.shape === "brace") return el.label ? `中かっこ ${el.label}` : "中かっこ";
  if (el.shape === "number") return el.valueName ? `数値 ${el.valueName}` : `数値 ${el.number}`;
  if (el.shape === "axdot") return `座標の点 (${el.xExpr}, ${el.yExpr})`;
  if (el.shape === "svg") return `SVG ${el.name ?? ""}`;
  if (el.shape === "matrix") return `行列 ${el.cells?.length ?? 0}×${el.cells?.[0]?.length ?? 0}`;
  if (el.shape === "angle") return el.angleKind === "right" ? "直角の印" : el.angleKind === "tangent" ? "角を丸める弧" : `角 ${el.label ?? ""}`;
  if (el.shape === "graphpart") return { area: el.graph2Id ? "2 つのグラフの間の面積" : "面積", riemann: "リーマン和", tangent: "接線", secant: "割線", derivative: "導関数のグラフ", antiderivative: "原始関数のグラフ", glabel: `グラフのラベル ${el.label ?? ""}`, tlabel: "T 字ラベル" }[el.partKind] ?? "グラフの補助";
  if (el.shape === "curve2d") return `媒介変数曲線 (${el.xExpr}, ${el.yExpr})`;
  if (el.shape === "implicit") return `陰関数 ${el.expr}`;
  if (el.shape === "solid") return { sphere: "球", cube: "立方体", prism: "直方体", cone: "円錐", cylinder: "円柱", torus: "トーラス", tetrahedron: "正四面体", octahedron: "正八面体", dodecahedron: "正十二面体", icosahedron: "正二十面体", polyhedron: "多面体", hull: "凸包" }[el.solidKind] ?? "立体";
  if (el.shape === "netgraph") return `${el.directed ? "有向グラフ" : "グラフ"} ${el.vertices?.length ?? 0} 頂点`;
  if (el.shape === "samplespace") return `標本空間 ${el.parts?.length ?? 0} 区画`;
  if (el.shape === "axes3d") return "3D 座標軸";
  if (el.shape === "surface") return el.surfKind === "param" ? "媒介変数曲面" : `曲面 z = ${el.expr}`;
  if (el.shape === "curve3d") return "空間の曲線";
  if (el.shape === "point3d") return { dot: "3D の点", line: "3D の線", arrow: "3D の矢印" }[el.pointKind] ?? "3D の点";
  if (el.shape === "table") return `表 ${el.cells?.length ?? 0}×${el.cells?.[0]?.length ?? 0}`;
  if (el.shape === "field") return el.fieldKind === "stream" ? "流線" : "ベクトル場";
  if (el.shape === "polygon") return `${el.edgeArc ? "辺が弧の" : ""}${el.sides === 3 ? "三角形" : `正${el.sides}角形`}`;
  return SHAPE_LABEL[el.shape] ?? "図形";
}

