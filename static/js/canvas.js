// 編集キャンバス（Fabric.js 7）。論理座標 1920×1080 の固定枠に要素を置き、表示倍率だけを変える（F1）。

import { drawCam3dOverlay } from "./cam3d.js";
import { backgroundOf, masterElementsFor, syncTitles, titleTemplate } from "./masters.js";
import { setupGuides, snapMove, snapPoint, snapScale } from "./guides.js";
import { api } from "./api.js";
import { loadImage } from "./images.js";
import { loadPoster } from "./media.js";
import { previewLatex } from "./mathalign.js";
import { colorize } from "./texcolor.js";
import { renderMath } from "./mathjax.js";
import { resolveForPreview } from "./refs.js";
import { editingPathId, setupPathControls, startNodeEdit } from "./pathtools.js";
import { previewPayload, renderShapePreview, SHAPES_3D } from "./shapepreview.js";
import { renderTextPreview } from "./textpreview.js";
import { onCircleAngle, onCirclePos } from "./construct.js";
import { hasOwnIntro } from "./animpane.js";
import {
  cellContainerOf, cssFontFamily, currentSlide, emit, on, findElement, fromManim, findGroup, groupMembers, markDirty, pagePlan, sectionPlan, selectionTarget, store, masterOf } from "./store.js";

const HIDDEN_OPACITY = 0.4;
// 拡大・縮小は縦横比を保つので、辺の中央のハンドル（片方向だけ伸ばす）は出さない
const MID_HIDDEN = { ml: false, mr: false, mt: false, mb: false };
const CONTROL_STYLE = {
  cornerColor: "#ffffff", cornerStrokeColor: "#3554d1", cornerStyle: "circle", cornerSize: 11, transparentCorners: false,
  lockScalingFlip: true, lockSkewingX: true, lockSkewingY: true,
};
const SNAP_DEG = 15;
// スライドの周りの余白（画面の px）。端の近くの要素でも、回転・拡大のハンドルをつかめるようにする
const MARGIN = 56;
let slideRect = null; // スライドの範囲を塗る背景（キャンバスの背景画像として、表示倍率に合わせて描く） // Shift を押しながら回すと 15° 刻み // 「スライド開始時に表示」がオフの要素は薄く表示する

let canvas = null;
let stageEl = null;
let buildToken = 0;
// プログラムから選択や置き換えをしている間は、選択のイベントを利用者の操作として扱わない
let quiet = false;
function quietly(fn) {
  quiet = true;
  try { fn(); } finally { quiet = false; }
}

const fab = () => window.fabric;

function fontPx(el, kind) {
  const s = store.project.settings;
  const size = (Number(el.fontSize) || s.defaultFontSize) * (Number(s.fontSizeScale) || 1);
  return size * (kind === "math" ? store.meta.mathPxPerFontSize : store.meta.textPxPerFontSize);
}

/** 要素から Fabric のオブジェクトを作る。 */
export async function buildObject(el, { forThumbnail = false } = {}) {
  const f = fab();
  let obj;
  let previewError = "";
  if (el.type === "text") {
    // まず、書き出しと同じ関数で Manim が作った実際の形を使う
    const r = await renderTextPreview(el);
    if (r.url) {
      const img = new Image();
      img.src = r.url;
      try { await img.decode(); } catch { /* 空の画像になる */ }
      obj = new f.FabricImage(img, { width: r.width, height: r.height });
      obj.inset = r.margin || 0;
      if (r.layout) obj.layoutPos = r.layout; // グラフ理論のグラフ: 頂点の位置（Manim の単位、要素の基準点から）
    } else {
      previewError = r.error;
    }
  }
  if (el.type === "text" && !obj) {
    // 実際の形を作れないとき（Manim を読み込めないなど）は、ブラウザで近似して表示する
    obj = new f.FabricText(el.text || " ", {
      fontFamily: cssFontFamily(el.font || store.project.settings.defaultFont),
      fontSize: fontPx(el, "text"),
      fill: el.color,
      // Manim の Text（Pango）に合わせる: 複数行は左寄せ、行の間隔は 0.975em
      textAlign: ["center", "right"].includes(el.align) ? el.align : "left",
    });
    // Fabric の行の高さは fontSize × _fontSizeMult(1.13) × lineHeight なので、行の間隔が Manim と同じになるように決める
    obj.set({ lineHeight: (store.meta.textLinePitchEm ?? 0.975) / (obj._fontSizeMult || 1.13) });
  } else if (el.type === "math") {
    const r = await renderMath(previewLatex(colorize(resolveForPreview(el).latex, el.colorMap).latex, el.mathAlign), fontPx(el, "math"), el.color);
    const img = new Image();
    img.src = r.url;
    try { await img.decode(); } catch { /* 表示できない場合は空の画像になる */ }
    obj = new f.FabricImage(img, { width: r.width, height: r.height });
    obj.mathError = r.error;
  } else if (el.type === "image") {
    let img = null;
    try { img = await loadImage(el.path); } catch (e) { previewError = e.message; }
    const w = Number(el.width) || el.natW || 200;
    const h = Number(el.height) || w * (el.natH || 1) / (el.natW || 1);
    if (img) {
      // トリミング: 元の画像の残す範囲（割合）を、画素の範囲にして切り出す
      const c = el.crop ?? { l: 0, t: 0, r: 1, b: 1 };
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      const cw = Math.max(1, (c.r - c.l) * nw), ch = Math.max(1, (c.b - c.t) * nh);
      obj = new f.FabricImage(img, { imageSmoothing: el.smooth !== false, cropX: c.l * nw, cropY: c.t * nh, width: cw, height: ch });
      obj.set({ scaleX: w / cw, scaleY: h / ch });
      // 図形の形で切り抜く: 型の要素の輪郭（Manim で作った形）を、キャンバスの位置の切り抜きにする
      if (el.mask?.id) {
        const shape = currentSlide()?.elements.find((e) => e.id === el.mask.id);
        const polys = shape ? await maskOutline(shape) : null;
        if (polys?.length) {
          const d = polys.map((p) => "M " + p.map(([x, y]) => fromManim(x, y).map((v) => v.toFixed(2)).join(" ")).join(" L ") + " Z").join(" ");
          obj.clipPath = new f.Path(d, { absolutePositioned: true, fillRule: "evenodd", inverted: !!el.mask.invert });
        }
      }
    } else {
      // ファイルが見つからないときは、同じ大きさの枠を出す
      obj = new f.Group([
        new f.Rect({ width: w, height: h, fill: "#fbecec", stroke: "#c62828", strokeWidth: 3, strokeDashArray: [12, 8], originX: "center", originY: "center" }),
        new f.FabricText("画像が見つかりません", { fontSize: Math.max(24, Math.min(48, w / 8)), fill: "#c62828", originX: "center", originY: "center" }),
      ]);
    }
  } else if (el.type === "media") {
    // 動画: ポスター（指定の時刻のコマ）。音声: スピーカーのアイコン（発表中は隠せる。書き出しには描かない）
    const w = Number(el.width) || 320, h = Number(el.height) || 180;
    if (el.kind === "video") {
      let img = null;
      try { img = await loadPoster(el.path, el.posterTime || 0); } catch (e) { previewError = e.message; }
      const parts = [];
      if (img) {
        const im = new f.FabricImage(img, { originX: "center", originY: "center" });
        im.set({ scaleX: w / (img.naturalWidth || 1), scaleY: h / (img.naturalHeight || 1) });
        parts.push(im);
      } else parts.push(new f.Rect({ width: w, height: h, fill: "#fbecec", stroke: "#c62828", strokeWidth: 3, strokeDashArray: [12, 8], originX: "center", originY: "center" }));
      // 右下に「▶ 動画」の目印（発表で再生する動画だと分かるように）
      const tag = Math.max(18, Math.min(32, w / 14));
      parts.push(new f.Rect({ width: tag * 3.6, height: tag * 1.5, rx: tag * 0.3, ry: tag * 0.3, fill: "rgba(0,0,0,0.6)", originX: "right", originY: "bottom", left: w / 2 - tag * 0.4, top: h / 2 - tag * 0.4 }));
      parts.push(new f.FabricText(`▶ ${img ? "動画" : "見つかりません"}`, { fontSize: tag, fill: "#ffffff", originX: "right", originY: "bottom", left: w / 2 - tag * 0.7, top: h / 2 - tag * 0.6 }));
      obj = new f.Group(parts);
    } else {
      obj = new f.Group([
        new f.Rect({ width: 96, height: 96, rx: 18, ry: 18, fill: "#eef2ff", stroke: "#3554d1", strokeWidth: 3, originX: "center", originY: "center" }),
        new f.FabricText("🔊", { fontSize: 44, originX: "center", originY: "center", top: -8 }),
        new f.FabricText((el.name || "音声").slice(0, 10), { fontSize: 13, fill: "#3554d1", originX: "center", originY: "center", top: 32 }),
      ]);
    }
  } else if (el.type === "shape" && el.shape === "zoom") {
    // ズーム: 拡大を映す所の枠（この四角）。中身と、拡大する所の枠は after:render で描く（書き出しの見た目と同じ）
    obj = new f.Rect({ width: Number(el.width), height: Number(el.height), fill: "rgba(0,0,0,0)", stroke: el.displayColor || el.stroke?.color || "#FFC300",
      strokeWidth: (el.stroke?.width ?? 3) * 1.35, strokeUniform: true });
    obj.shapePts = { frame: [Number(el.width) / 2 + (Number(el.frameX) - Number(el.x)), Number(el.height) / 2 + (Number(el.frameY) - Number(el.y))] };
  } else if (el.type === "shape" && el.shape === "trace") {
    // 軌跡（TracedPath）: 描画では、たどる要素が動いた跡が残る。キャンバスでは、たどる要素の所に目印を出す（書き出しには影響しない）
    const t = findElement(el.targetId);
    if (t) { el.x = t.x; el.y = t.y; }
    const col = el.stroke?.color || "#FC6255";
    obj = new f.Group([
      new f.Circle({ radius: 34, fill: "transparent", stroke: col, strokeWidth: 3, strokeDashArray: [8, 6], originX: "center", originY: "center" }),
      new f.FabricText("軌跡", { fontSize: 22, fill: col, originX: "center", originY: "center", top: 52 }),
    ]);
  } else if (el.type === "shape") {
    let box = null, axes = null;
    if (el.shape === "balloon") box = balloonBox(el, forThumbnail);
    if (el.shape === "brace" && el.mode !== "points") box = braceBox(el, forThumbnail);
    if (el.shape === "annot" && el.annotKind !== "arcbrace") box = braceBox(el, forThumbnail); // 注釈も、付ける要素の外接矩形から
    if (el.shape === "annot" && el.annotKind === "arcbrace") {
      const a = findElement(el.targetId);
      if (a) { el.x = a.x; el.y = a.y; } // 円弧の中心
    }
    if (["surface", "curve3d"].includes(el.shape) || (el.shape === "point3d" && el.axesId)) axes = findElement(el.axesId);
    if (el.shape === "dot" && el.onCircle) {
      // 円周上の点: 円の今の位置・大きさから、角度の所に置く
      const p = onCirclePos(findElement(el.onCircle.id), el.onCircle.angle);
      if (p) { el.x = p[0]; el.y = p[1]; }
    }
    if (el.shape === "graphpart") {
      // グラフの補助は、グラフの座標軸と同じ位置に置く
      const g = findElement(el.graphId);
      axes = g ? findElement(g.axesId) : null;
      if (axes) { el.x = axes.x; el.y = axes.y; }
    }
    if (el.shape === "curve2d" || el.shape === "implicit") {
      axes = findElement(el.axesId);
      if (axes) { el.x = axes.x; el.y = axes.y; }
    }
    if (el.shape === "graph" || el.shape === "axdot" || el.shape === "linegraph" || el.shape === "points" || (el.shape === "field" && el.axesId) || (el.shape === "vector" && el.axesId)) {
      // グラフ・座標軸に重ねたベクトル場は、座標軸と同じ位置に置く（座標軸の原点からの形）
      axes = findElement(el.axesId);
      if (axes) {
        el.x = axes.x; el.y = axes.y;
        // ベクトル場は座標軸の範囲・大きさも覚えておく（座標軸を消したとき、同じ見た目の独立したベクトル場にするため）
        if (el.shape === "field") for (const k of ["xMin", "xMax", "yMin", "yMax", "width", "height"]) el[k] = axes[k];
      }
    }
    const r = await renderShapePreview(el, box, axes);
    if (r.url) {
      const img = new Image();
      img.src = r.url;
      try { await img.decode(); } catch { /* 空の画像になる */ }
      obj = new f.FabricImage(img, { width: r.width, height: r.height });
      obj.shapePts = r.points; // 基準点・線の両端・尾の先（SVG の中の px）
      obj.inset = r.margin || 0;
      if (r.layout) obj.layoutPos = r.layout; // グラフ理論のグラフ: 頂点の位置（Manim の単位、要素の基準点から）
      if (["graph", "field", "axdot", "surface", "curve3d", "graphpart", "curve2d", "implicit", "vector", "fcurve"].includes(el.shape)) obj.python = r.python;
      if (r.anchor) {
        // 3D の要素: 基準点がスライドのカメラから見て写る位置。ドラッグした量を空間の向きに直すため、画面の向きも覚える
        el.x = r.anchor[0]; el.y = r.anchor[1];
        obj.anchor3 = { x: r.anchor[0], y: r.anchor[1] };
        obj.basis3 = r.basis;
        if (Number.isFinite(r.depth)) obj.depth3 = r.depth; // カメラからの近さ（奥行きの順に重ねるとき）
      }
      if (el.shape === "brace" && el.label) obj = await composeBraceLabel(obj, el, r);
    } else {
      previewError = r.error;
      obj = new f.Rect({ width: Number(el.width) || 200, height: Number(el.height) || 120, fill: "rgba(200,40,40,0.08)", stroke: "#c62828", strokeDashArray: [10, 6] });
    }
  } else if (!obj) {
    obj = new f.Rect({ width: 200, height: 120, fill: "#ccc" });
  }
  obj.baseScale = obj.scaleX || 1;
  obj.baseScaleY = obj.scaleY || 1; // 画像は元の画素数からの倍率。ハンドルでの拡大・縮小はこれに対する比で読む
  obj.set({
    left: Number(el.x), top: Number(el.y), originX: "center", originY: "center",
    // 回転は Manim と同じく反時計回りを正として持つ。Fabric は時計回りが正なので符号を反転する
    angle: -(Number(el.rotation) || 0),
    ...CONTROL_STYLE,
    hasControls: !el.locked, lockScalingX: !!el.locked, lockScalingY: !!el.locked, lockRotation: !!el.locked,
    borderColor: "#3554d1", borderScaleFactor: 2, padding: 4,
    opacity: (el.type === "image" ? Number(el.opacity ?? 1) : 1) * (startsHidden(el) || el.placeholder ? HIDDEN_OPACITY : 1),
    hoverCursor: el.locked ? "default" : "move",
    // 非表示（編集中だけ隠す）とロック（クリックも通り抜け、レイヤー一覧からだけ選べる）。サムネイルには影響しない
    visible: forThumbnail || !el.hidden,
    selectable: !el.locked, evented: !el.locked,
    lockMovementX: !!el.locked, lockMovementY: !!el.locked,
  });
  // 位置の基準が左端・右端の文字: 端の位置（edgeX）から、今の幅で中心を決める（文字の長さが変わっても端はそのまま）
  if (anchorOf(el) && Number.isFinite(Number(el.edgeX))) {
    const w = tightWidth(obj);
    const cx = Math.round((anchorOf(el) === "left" ? Number(el.edgeX) + w / 2 : Number(el.edgeX) - w / 2) * 10) / 10;
    obj.set({ left: cx });
    // マスターの要素をスライドで描くときは、スライドごとに幅が違う（{章} など）ので、要素の x は変えない
    if (store.masterId || currentSlide()?.elements.includes(el)) el.x = cx;
  }
  // 図形は基準点（線: 両端の中点、吹き出し: 箱の中心、ほか: 外接矩形の中心）を位置・回転の軸にする
  if (obj.shapePts?.origin && obj.width && obj.height) {
    obj.set({ originX: obj.shapePts.origin[0] / obj.width, originY: obj.shapePts.origin[1] / obj.height, left: Number(el.x), top: Number(el.y) });
  }
  // 画像と、縦横比を固定しない図形は、辺の中央のハンドルで横だけ・縦だけ伸び縮みできる（角のハンドルは縦横比を保つ）
  const stretchable = el.type === "image" || (el.type === "shape" && ["rect", "ellipse", "polygon", "star"].includes(el.shape) && !el.keepAspect)
    || (el.type === "shape" && ["axes", "barchart", "samplespace", "statchart"].includes(el.shape)) || (el.type === "shape" && el.shape === "field" && !el.axesId)
    || (el.type === "shape" && el.shape === "svg" && !el.keepAspect) || (el.type === "shape" && el.shape === "zoom")
    || (el.type === "shape" && el.shape === "balloon" && !(el.contentIds ?? []).length);
  if (!stretchable) obj.setControlsVisibility(MID_HIDDEN);
  // 折り返すテキストは、左右のハンドルで「文字の大きさはそのまま、折り返す幅を変える」（上下のハンドルは出さない）
  if ((el.type === "text" && el.wrapWidth != null && !el.vertical) || (el.type === "shape" && el.shape === "theorem")) obj.setControlsVisibility({ ml: true, mr: true });
  if (el.type === "media") {
    // 動画・音声は回さない（重ねて再生する映像は回せない）。音声のアイコンは大きさも変えない
    obj.setControlsVisibility({ mtr: false });
    obj.set({ lockRotation: true });
    if (el.kind === "audio") obj.set({ hasControls: false, lockScalingX: true, lockScalingY: true });
  }
  if (!forThumbnail && cellContainerOf(el.id)) {
    // 表・行列のセルに入れた要素は、表が位置を決める（動かすときは表を動かす）
    obj.set({ lockMovementX: true, lockMovementY: true, hoverCursor: "default" });
  }
  if (el.type === "shape") setupShapeControls(obj, el);
  if (el.type === "shape" && el.shape === "path" && !forThumbnail) setupPathControls(obj, el);
  obj.elId = el.id;
  if (previewError) obj.previewError = previewError;
  return obj;
}

export function initCanvas(canvasEl, stage) {
  stageEl = stage;
  const f = fab();
  canvas = new f.Canvas(canvasEl, {
    width: store.meta.canvas.w, height: store.meta.canvas.h,
    preserveObjectStacking: true, enableRetinaScaling: true, backgroundVpt: true,
    targetFindTolerance: 6, // 細い線（グラフなど）も、少し離れた所からクリックできる
    // 空いている所からドラッグで範囲選択。Ctrl / Shift を押しながらのクリックで、選択を切り替える
    selection: true, selectionKey: ["ctrlKey", "metaKey", "shiftKey"],
    selectionColor: "rgba(53,84,209,0.08)", selectionBorderColor: "#3554d1", selectionLineWidth: 1,
  });
  slideRect = new f.Rect({
    left: 0, top: 0, originX: "left", originY: "top", width: store.meta.canvas.w, height: store.meta.canvas.h,
    fill: "#ffffff", selectable: false, evented: false, objectCaching: false,
    shadow: new f.Shadow({ color: "rgba(0,0,0,0.25)", blur: 18, offsetY: 3 }),
  });
  canvas.backgroundImage = slideRect;
  // スライドの外にはみ出した部分は、描画では切れるので薄く見せる（スライドの形に穴を開けた覆い。
  // 前面の覆いとして描くと、選択枠・ハンドルはその上に描かれる）
  {
    const W = store.meta.canvas.w, H = store.meta.canvas.h, B = 20000;
    canvas.overlayImage = new f.Path(`M ${-B} ${-B} H ${W + B} V ${H + B} H ${-B} Z M 0 0 V ${H} H ${W} V 0 Z`, {
      fill: getComputedStyle(stage).backgroundColor || "#e6e8ed", opacity: 0.65, fillRule: "evenodd",
      selectable: false, evented: false, objectCaching: false,
    });
    canvas.controlsAboveOverlay = true;
  }
  // ページ番号（書き出しと同じ gui_text の形）。2D はスライドのカメラの枠の隅、3D は画面の隅に描く。選べない
  canvas.on("after:render", ({ ctx }) => {
    const pg = pageOverlay;
    if (!pg?.img || !ctx || pg.slide !== currentSlide()) return;
    const W = store.meta.canvas.w, H = store.meta.canvas.h, P = H / 8, vt = canvas.viewportTransform;
    const ps = store.project.settings.pageNumbers ?? {};
    const b = (ps.buff ?? 0.3) * P, tw = pg.w - 2 * pg.margin, th = pg.h - 2 * pg.margin, pos = ps.position ?? "br";
    const left = pos.endsWith("l") ? b : pos.endsWith("r") ? W - b - tw : (W - tw) / 2;
    const top = pos.startsWith("t") ? b : H - b - th;
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    const cam = currentSlide()?.camera;
    if (cam && !store.project.settings.use3d) {
      // カメラの枠に合わせて（書き出しでは、ページ番号はカメラの枠について動く）
      const k = cam.width * P / W;
      ctx.translate(W / 2 + cam.x * P, H / 2 - cam.y * P);
      ctx.scale(k, k);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.drawImage(pg.img, left - pg.margin, top - pg.margin, pg.w, pg.h);
    ctx.restore();
  });
  // 章の名前・進み具合のバー（書き出しの gui_section_mark と同じ位置）
  canvas.on("after:render", ({ ctx }) => {
    const sg = sectionOverlay;
    if (!sg || !ctx || sg.slide !== currentSlide() || ctx === canvas.contextTop) return;
    const W = store.meta.canvas.w, H = store.meta.canvas.h, P = H / 8, vt = canvas.viewportTransform;
    const ss = store.project.settings.sections ?? {};
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    const cam = currentSlide()?.camera;
    if (cam && !store.project.settings.use3d) {
      const k = cam.width * P / W;
      ctx.translate(W / 2 + cam.x * P, H / 2 - cam.y * P);
      ctx.scale(k, k);
      ctx.translate(-W / 2, -H / 2);
    }
    if (sg.progress != null) {
      const y = ss.bar === "bottom" ? H - 0.04 * P : 0.04 * P;
      const segs = sg.spans.length ? sg.spans : [[0, 1]];
      const gap = segs.length > 1 ? 0.03 * P : 0;
      ctx.lineWidth = 7 * W / 1920; // Manim の stroke_width=6 の太さ（1920 px の幅で約 7 px）
      ctx.lineCap = "butt";
      segs.forEach(([a, b], k) => {
        const x0 = a * W + (k ? gap / 2 : 0), x1 = b * W - (k < segs.length - 1 ? gap / 2 : 0);
        if (x1 <= x0) return;
        ctx.strokeStyle = ss.barColor || "#58C4DD";
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        const done = Math.min(x1, sg.progress * W);
        if (done > x0) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(done, y); ctx.stroke(); }
      });
      ctx.globalAlpha = 1;
    }
    if (sg.img) {
      const b = 0.3 * P, tw = sg.w - 2 * sg.margin, th = sg.h - 2 * sg.margin, pos = ss.position ?? "tl";
      const left = pos.endsWith("l") ? b : pos.endsWith("r") ? W - b - tw : (W - tw) / 2;
      const top = pos.startsWith("t") ? b : H - b - th;
      ctx.drawImage(sg.img, left - sg.margin, top - sg.margin, sg.w, sg.h);
    }
    ctx.restore();
  });
  // ズーム（ZoomedScene）: 拡大する所の枠と、映す所の中身（キャンバスのその部分を拡大して写す）
  canvas.on("after:render", ({ ctx }) => {
    const z = currentSlide()?.elements.find((e) => e.type === "shape" && e.shape === "zoom");
    // 選択の枠などを描く上の層（contextTop）にも after:render が来る。そこに描くと、下の層の映す所を背景色で隠してしまう
    if (!z || !ctx || z.hidden || store.project?.settings?.use3d || ctx === canvas.contextTop) return;
    const vt = canvas.viewportTransform;
    // キャンバスの座標 → この描画先の画素（書き出し用の描画でも、画面でも同じ計算になるように、今の変換から求める）
    const full = ctx.getTransform().multiply(new DOMMatrix([vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]]));
    const fw = Number(z.width) * z.factor, fh = Number(z.height) * z.factor;
    const dev = (x, y) => { const q = full.transformPoint({ x, y }); return [q.x, q.y]; };
    const [sx, sy] = dev(z.frameX - fw / 2, z.frameY - fh / 2), [sx2, sy2] = dev(z.frameX + fw / 2, z.frameY + fh / 2);
    const [dx, dy] = dev(z.x - z.width / 2, z.y - z.height / 2), [dx2, dy2] = dev(z.x + z.width / 2, z.y + z.height / 2);
    const alpha = z.visibleAtStart === false ? HIDDEN_OPACITY : 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    try {
      // 拡大する所に入る要素を、映す所の大きさで描き直す（選択の枠・ハンドルは写さない。描画の結果と同じ）
      const W = Math.max(1, Math.round(dx2 - dx)), H = Math.max(1, Math.round(dy2 - dy));
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const c2 = off.getContext("2d");
      c2.fillStyle = store.project.settings.background;
      c2.fillRect(0, 0, W, H);
      const k = W / fw;
      c2.setTransform(k, 0, 0, H / fh, -(z.frameX - fw / 2) * k, -(z.frameY - fh / 2) * (H / fh));
      for (const o of canvas.getObjects()) if (o.visible && o.elId && o.elId !== z.id && !o.excludeFromExport) o.render(c2);
      ctx.drawImage(off, dx, dy, dx2 - dx, dy2 - dy);
    } catch { /* 描けない物があれば写さない */ }
    const lw = (z.stroke?.width ?? 3) * 1.35 * full.a;
    ctx.lineWidth = lw;
    ctx.strokeStyle = z.stroke?.color || "#FFC300";
    ctx.strokeRect(sx, sy, sx2 - sx, sy2 - sy);
    ctx.strokeStyle = z.displayColor || z.stroke?.color || "#FFC300";
    ctx.strokeRect(dx, dy, dx2 - dx, dy2 - dy);
    ctx.restore();
  });
  // スライドのカメラの初期位置（設定したときだけ）を、点線の枠で示す（書き出しには影響しない）
  canvas.on("after:render", ({ ctx }) => {
    const cam = currentSlide()?.camera;
    if (!cam || !ctx || store.project?.settings?.use3d) return;
    const P = store.meta.canvas.h / 8, vt = canvas.viewportTransform;
    const w = cam.width * P, h = w * 9 / 16, cx = store.meta.canvas.w / 2 + cam.x * P, cy = store.meta.canvas.h / 2 - cam.y * P;
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    ctx.lineWidth = 3 / vt[0];
    ctx.setLineDash([14 / vt[0], 8 / vt[0]]);
    ctx.strokeStyle = "#e0730b";
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#e0730b";
    ctx.font = `${14 / vt[0]}px sans-serif`;
    ctx.fillText("カメラの初期位置", cx - w / 2 + 6 / vt[0], cy - h / 2 - 6 / vt[0]);
    ctx.restore();
  });
  // 移動の行の、移動先の影（animpane.js が setGhosts で渡す）。今の形を移動先へずらして薄く描き、ドラッグで動かせる
  // 3D のカメラをマウスで動かしている間の、軸と外形（cam3d.js）
  canvas.on("after:render", ({ ctx }) => {
    if (!ctx || ctx === canvas.contextTop || !store.project?.settings?.use3d) return;
    const vt = canvas.viewportTransform;
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    drawCam3dOverlay(ctx);
    ctx.restore();
  });
  canvas.on("after:render", ({ ctx }) => {
    if ((!ghosts.length && !picker) || !ctx || ctx === canvas.contextTop) return;
    const vt = canvas.viewportTransform;
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    if (picker) drawPicker(ctx, vt);
    for (const g of ghosts) {
      if (g.kind === "rect" || g.kind === "point" || g.kind === "poly" || g.kind === "arc") { drawMarkGhost(ctx, g, vt); continue; }
      const objs = canvas.getObjects().filter((o) => g.ids.includes(o.elId));
      if (!objs.length) { g._box = null; continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of objs) for (const q of o.getCoords()) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      const pad = 4 / vt[0];
      g._box = { x0: x0 + g.dx - pad, y0: y0 + g.dy - pad, x1: x1 + g.dx + pad, y1: y1 + g.dy + pad };
      // 動く前の位置から移動先への矢印
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      ctx.strokeStyle = "#7a4fd6"; ctx.fillStyle = "#7a4fd6";
      ctx.lineWidth = 2 / vt[0];
      ctx.setLineDash([8 / vt[0], 6 / vt[0]]);
      ctx.beginPath(); ctx.moveTo(cx + (g.fromDx ?? 0), cy + (g.fromDy ?? 0)); ctx.lineTo(cx + g.dx, cy + g.dy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(g.dx, g.dy);
      ctx.globalAlpha = 0.4;
      for (const o of objs) { try { o.render(ctx); } catch { /* 描けない物は飛ばす */ } }
      ctx.restore();
      ctx.setLineDash([5 / vt[0], 4 / vt[0]]);
      ctx.strokeRect(g._box.x0, g._box.y0, g._box.x1 - g._box.x0, g._box.y1 - g._box.y0);
      ctx.setLineDash([]);
      ctx.font = `${13 / vt[0]}px sans-serif`;
      ctx.fillText(g.label ?? "移動先", g._box.x0, g._box.y0 - 5 / vt[0]);
    }
    ctx.restore();
  });
  const ghostAt = (e) => {
    if (!ghosts.length) return null;
    const pt = canvas.getScenePoint(e);
    return [...ghosts].reverse().find((g) => g._box && g.onDrag && pt.x >= g._box.x0 && pt.x <= g._box.x1 && pt.y >= g._box.y0 && pt.y <= g._box.y1) ?? null;
  };
  // 影のドラッグは、Fabric より先に（要素の選択・ハンドルの操作にならないように）、キャンバスの枠の要素で受ける
  {
    const host = canvas.wrapperEl ?? canvas.upperCanvasEl.parentElement;
    const down = (e) => {
      if (e.button !== 0) return;
      if (picker) {
        // 一部分を選んでいる間は、キャンバスのほかの操作をしない（押した部品を選ぶ・外す）
        e.stopPropagation(); e.preventDefault();
        if (e.type !== "pointerdown") return;
        const pt = canvas.getScenePoint(e);
        const hit = [...picker.boxes].map((b, i) => [b, i]).filter(([b]) => pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1)
          .sort((a, b) => (a[0].x1 - a[0].x0) * (a[0].y1 - a[0].y0) - (b[0].x1 - b[0].x0) * (b[0].y1 - b[0].y0))[0];
        if (hit) picker.onClick?.(hit[1], e.shiftKey);
        canvas.requestRenderAll();
        return;
      }
      const g = ghostAt(e);
      if (!g) return;
      e.stopPropagation();
      e.preventDefault();
      if (ghostDrag) return; // pointerdown と mousedown の両方が来る
      const pt = canvas.getScenePoint(e);
      ghostDrag = { g, sx: pt.x, sy: pt.y, dx0: g.dx, dy0: g.dy };
      const move = (ev) => {
        const q = canvas.getScenePoint(ev);
        let ddx = q.x - ghostDrag.sx, ddy = q.y - ghostDrag.sy;
        if (ev.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; } // Shift で横か縦だけ
        g.dx = ghostDrag.dx0 + ddx; g.dy = ghostDrag.dy0 + ddy;
        g.onDrag?.(g.dx, g.dy, false);
        canvas.requestRenderAll();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        ghostDrag = null;
        g.onDrag?.(g.dx, g.dy, true);
        canvas.requestRenderAll();
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("mousedown", (e) => { if (e.button === 0 && (picker || ghostAt(e))) { e.stopPropagation(); e.preventDefault(); } }, true);
    host.addEventListener("pointermove", (e) => { if (!ghostDrag && ghosts.length) canvas.upperCanvasEl.style.cursor = ghostAt(e) ? "move" : ""; });
  }
  canvas.on("object:moving", (e) => { liftComposite3d(e.target); snapMove(e); syncPosition(e.target, false); });
  canvas.on("object:scaling", (e) => liftComposite3d(e.target));
  canvas.on("object:rotating", (e) => liftComposite3d(e.target));
  canvas.on("object:modified", (e) => commitTransform(e.target));
  canvas.on("object:rotating", (e) => {
    if (e.e?.shiftKey) {
      const a = Math.round(e.target.angle / SNAP_DEG) * SNAP_DEG;
      e.target.rotate(a);
    }
    showTransformTip(e.target, `${fmtDeg(-e.target.angle)}°`);
  });
  canvas.on("object:scaling", (e) => {
    snapScale(e);
    const t = e.target;
    const x = Math.round(t.scaleX / (t.baseScale || 1) * 100), y = Math.round(t.scaleY / (t.baseScaleY || t.baseScale || 1) * 100);
    showTransformTip(t, x === y ? `${x}%` : `横 ${x}% × 縦 ${y}%`);
  });
  canvas.on("mouse:up", () => showTransformTip(null));
  setupGuides(canvas);
  canvas.on("selection:created", (o) => { if (!quiet) onUserSelection(o.e); });
  canvas.on("selection:updated", (o) => { if (!quiet) onUserSelection(o.e); });
  canvas.on("selection:cleared", (o) => { if (!quiet) onUserSelection(o.e); });
  // ダブルクリックで、グループの中の要素を1つだけ選ぶ（グループの中に入る）
  canvas.on("mouse:dblclick", (e) => {
    if (editingPathId()) return; // 点の編集中のダブルクリックは pathtools.js が扱う
    const id = canvasObjectAt(e.e);
    const el = findElement(id);
    if (!el) return;
    // グループの要素なら、まずグループの中に入る（その要素だけを選ぶ）
    if (el.groupId && store.enteredGroup !== el.groupId) {
      store.enteredGroup = el.groupId;
      applySelection([id]);
      commitSelection([id]);
      return;
    }
    // 手書き・ベジェ曲線なら、点の編集を始める
    if (el.type === "shape" && el.shape === "path") {
      if (store.selectedId !== id) { applySelection([id]); commitSelection([id]); }
      startNodeEdit(el);
      e.startedPathEdit = true; // 同じダブルクリックを、編集中の操作として扱わない（pathtools.js）
    }
  });
  new ResizeObserver(() => fit()).observe(stage);
  fit();
  return canvas;
}

const activeIds = () => canvas.getActiveObjects().map((o) => o.elId).filter(Boolean);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** 利用者がキャンバスで選択を変えたとき。グループの要素は、グループごと選ぶ（中に入っているグループを除く）。 */
function onUserSelection(ev) {
  if (canvas.getObjects().some((o) => o._guiCrop)) return; // 画像のトリミング中（範囲の四角を選んでいる）
  const prev = new Set(store.selectedIds);
  const cur = new Set(activeIds());
  // 中に入っているグループの外を選んだら、グループの外に出る
  if (store.enteredGroup && [...cur].some((id) => findElement(id)?.groupId !== store.enteredGroup)) store.enteredGroup = null;
  if (!cur.size) store.enteredGroup = null;
  const groupOf = (id) => {
    const g = findElement(id)?.groupId;
    return g && g !== store.enteredGroup ? g : null;
  };
  // 選択から外れたグループの要素があれば、そのグループごと外す
  for (const id of prev) {
    if (!cur.has(id) && groupOf(id)) for (const m of groupMembers(groupOf(id))) cur.delete(m.id);
  }
  // 新しく選んだ要素がグループに入っていれば、グループの要素をすべて選ぶ
  for (const id of [...cur]) {
    if (!prev.has(id) && groupOf(id)) for (const m of groupMembers(groupOf(id))) if (m.selectable !== false && !m.locked && !m.hidden) cur.add(m.id);
  }
  const ids = currentSlide().elements.map((e) => e.id).filter((id) => cur.has(id)); // 重なり順にそろえる
  // 向きを持つグループ・選択は、その向きの枠で選び直す
  const active = canvas.getActiveObject();
  const needOrient = ids.length > 1 && Math.abs(-selectionAngle(ids) - (isSelection(active) ? active.angle : 0)) > 1e-6;
  if (!sameSet(ids, activeIds()) || needOrient) {
    applySelection(ids);
    // グループの要素を押してそのままドラッグしたとき、グループ全体が動くようにする
    // （Fabric は押した要素を動かす準備をするが、選択をグループ全体に置き換えたため）
    const sel = canvas.getActiveObject();
    if (sel && ev && /down|start/.test(ev.type) && ev.button === 0 && !canvas._currentTransform && canvas._setupCurrentTransform) {
      canvas._setupCurrentTransform(ev, sel, true);
    }
  }
  commitSelection(ids);
}

/** 選んだ順（Ctrl＋クリックで足した順）。範囲で選んだものは重なり順。 */
function pickOrder(ids) {
  const keep = (store.pickOrder ?? []).filter((id) => ids.includes(id));
  return [...keep, ...ids.filter((id) => !keep.includes(id))];
}

function commitSelection(ids) {
  const target = selectionTarget(ids);
  const changed = !sameSet(ids, store.selectedIds) || target !== store.selectedId;
  store.pickOrder = pickOrder(ids);
  store.selectedIds = ids;
  store.selectedId = target;
  if (changed) {
    // GUI のステップ（画面の下の編集欄）は、ほかの要素を選んでも開いたままにする（その要素の動きを同じクリックに足せるように）
    if (currentSlide()?.steps.find((s) => s.id === store.focusStepId)?.mode !== "gui") store.focusStepId = null;
    emit("selection", target);
  }
}

/** キャンバスの選択を ids にする（イベントは出さない）。 */
// ---- 選択範囲の向き ----
// グループは向き（group.rotation、反時計回りが正）を持ち、選択枠もその向きで出す。グループでない複数選択は、
// 選んでいる間だけ向きを覚える（選び直すと 0°）。回転の軸は、その向きでの外接矩形の中心（回しても動かない）。
const idsKey = (ids) => [...ids].sort().join(",");

/** ids をまとめて選んだときの向き（Manim の向きの度）。 */
export function selectionAngle(ids = store.selectedIds) {
  const g = findGroup(selectionTarget(ids));
  if (g) return Number(g.rotation) || 0;
  return store.selAngleKey === idsKey(ids) ? (store.selAngle || 0) : 0;
}

function setSelectionAngle(ids, deg) {
  const g = findGroup(selectionTarget(ids));
  if (g) g.rotation = deg;
  else { store.selAngle = deg; store.selAngleKey = idsKey(ids); }
}

/** objs を、Fabric の角度 angle の向きの枠で囲む選択を作る（中の要素の位置は変えない）。 */
function orientedSelection(objs, angle) {
  const f = fab();
  const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of objs) {
    o.setCoords();
    for (const p of o.getCoords()) {
      const u = p.x * cos + p.y * sin, v = -p.x * sin + p.y * cos;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
  }
  const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2;
  const sel = new f.ActiveSelection([], {
    canvas, layoutManager: new f.LayoutManager(new f.FixedLayout()),
    angle, width: x1 - x0, height: y1 - y0, left: cu * cos - cv * sin, top: cu * sin + cv * cos, originX: "center", originY: "center",
  });
  sel.add(...objs);
  return sel;
}

export function applySelection(ids) {
  if (!canvas) return;
  if (canvas.getObjects().some((o) => o._guiCrop)) return; // 画像のトリミング中は、範囲の四角を選んだままにする
  const f = fab();
  const objs = ids.map((id) => canvas.getObjects().find((o) => o.elId === id)).filter((o) => o && o.visible);
  quietly(() => {
    canvas.discardActiveObject();
    if (objs.length === 1) canvas.setActiveObject(objs[0]);
    else if (objs.length > 1) {
      const angle = -selectionAngle(ids);
      const sel = angle ? orientedSelection(objs, angle) : new f.ActiveSelection(objs, { canvas });
      sel.set({ ...CONTROL_STYLE, hasControls: true, borderColor: "#3554d1", borderScaleFactor: 2 });
      sel.setControlsVisibility(MID_HIDDEN);
      canvas.setActiveObject(sel);
    }
  });
  canvas.requestRenderAll();
}

/** 選択中の範囲（複数・グループ）の向きを deg（Manim の向き）にする。中心を軸に、中の要素ごと回す。 */
export function rotateSelectionTo(deg) {
  const sel = canvas?.getActiveObject();
  if (!isSelection(sel)) return;
  sel.rotate(-deg);
  sel.setCoords();
  commitTransform(sel);
  canvas.requestRenderAll();
}

const round1 = (v) => Math.round(v * 10) / 10;
function fmtDeg(a) {
  let d = ((a % 360) + 540) % 360 - 180; // -180〜180
  d = Math.round(d * 10) / 10;
  return Object.is(d, -0) || d === -180 ? Math.abs(d) : d;
}

/** 回転・拡大縮小の途中で、角度や倍率を小さく表示する。 */
let tipEl = null;
function showTransformTip(target, text) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "transform-tip";
    stageEl.appendChild(tipEl);
  }
  if (!target) { tipEl.hidden = true; return; }
  const r = target.getBoundingRect();
  const vt = canvas.viewportTransform;
  const off = canvas.upperCanvasEl.getBoundingClientRect(), st = stageEl.getBoundingClientRect();
  tipEl.hidden = false;
  tipEl.textContent = text;
  tipEl.style.left = `${off.left - st.left + (r.left + r.width / 2) * vt[0] + vt[4]}px`;
  tipEl.style.top = `${off.top - st.top + r.top * vt[3] + vt[5] - 34}px`;
}

const isSelection = (t) => t?.type === "activeselection" || t?.isType?.("ActiveSelection");

/**
 * 移動・回転・拡大縮小が終わったとき: 各要素の実際の変形（キャンバス上の中心・角度・倍率）を読み、要素のデータに反映する。
 * 大きさは、テキストと数式は文字サイズ、画像は幅として持つ（形をそのまま引き伸ばさない）。
 */
function commitTransform(target) {
  const f = fab();
  const objs = isSelection(target) ? target.getObjects() : [target];
  const resized = [];
  if (isSelection(target)) {
    // 選択範囲（グループ）の向きを覚える（次に選んだときも、この向きの枠で囲む）
    const ids = objs.map((o) => o.elId).filter(Boolean);
    setSelectionAngle(ids, fmtDeg(-f.util.qrDecompose(target.calcTransformMatrix()).angle));
  }
  for (const obj of objs) {
    const el = findElement(obj?.elId);
    if (!el) continue;
    const d = f.util.qrDecompose(obj.calcTransformMatrix());
    const o = absPt(obj, "origin");
    el.x = round1(o.x);
    el.y = round1(o.y);
    if (el.type === "shape" && SHAPES_3D.includes(el.shape)) {
      if (move3d(el, obj, o.x - (obj.anchor3?.x ?? el.x), o.y - (obj.anchor3?.y ?? el.y), Math.abs(d.scaleX) / (obj.baseScale || 1))) resized.push(el);
      emit("element-moved", el);
      continue;
    }
    if (el.type === "shape" && (el.shape === "line" || (el.shape === "brace" && el.mode === "points"))) {
      // 線は両端の位置で持つ（回転・拡大の結果も両端に反映する）
      const p1 = absPt(obj, "p1"), p2 = absPt(obj, "p2");
      el.x = round1((p1.x + p2.x) / 2); el.y = round1((p1.y + p2.y) / 2);
      const ndx = round1((p2.x - p1.x) / 2), ndy = round1((p2.y - p1.y) / 2);
      if (ndx !== el.dx || ndy !== el.dy) { el.dx = ndx; el.dy = ndy; resized.push(el); }
      emit("element-moved", el);
      continue;
    }
    el.rotation = fmtDeg(-d.angle); // 吹き出しも、グループごと回したときは一緒に回る
    const k = Math.abs(d.scaleX) / (obj.baseScale || 1);
    const ky = Math.abs(d.scaleY) / (obj.baseScaleY || 1);
    if (Math.abs(k - 1) > 1e-3 || Math.abs(ky - 1) > 1e-3) {
      if (el.type === "shape") {
        if (el.shape === "path") {
          // 点（と取っ手）を、回す前の向きのまま横 k・縦 ky 倍にする
          el.paths = el.paths.map((sp) => sp.map((n) => [n[0] * k, n[1] * ky, n[2] * k, n[3] * ky, n[4] * k, n[5] * ky].map((v) => Math.round(v * 100) / 100)));
          if (el.raw) el.raw = el.raw.map((st) => st.map((q) => [q[0] * k, q[1] * ky]));
        } else if (["arc", "dot", "elbow"].includes(el.shape)) el.radius = Math.max(1, round1(Number(el.radius) * k));
        else if (el.shape === "netgraph") {
          // 手で動かした配置は頂点の位置を、自動の配置は大きさ（layout_scale）を、同じ倍率で変える
          if (el.layout === "manual") el.positions = Object.fromEntries(Object.entries(el.positions ?? {}).map(([n, p]) => [n, [Math.round(p[0] * k * 1000) / 1000, Math.round(p[1] * k * 1000) / 1000]]));
          else el.layoutScale = Math.max(0.1, Math.round(Number(el.layoutScale) * k * 1000) / 1000);
        }
        else if (el.shape === "part") el.scale = Math.max(0.01, Math.round(Number(el.scale || 1) * k * 1000) / 1000); // 部品: 倍率
        else if (el.shape === "fcurve") el.scale = Math.max(0.01, Math.round(Number(el.scale || 1) * k * 1000) / 1000); // 座標軸なしの曲線: 1 の長さ
        else if (el.shape === "annulus") { el.radius = Math.max(1, round1(Number(el.radius) * k)); el.innerRadius = Math.max(0, round1(Number(el.innerRadius) * k)); }
        else if (["number", "code", "tex", "title", "bullets"].includes(el.shape)) el.fontSize = Math.max(1, round1(Number(el.fontSize) * k));
        else if (el.shape === "theorem") {
          if (Math.abs(ky - 1) < 1e-3) { // 左右のハンドル: 文字の大きさはそのまま、幅だけ（見えている幅の伸び縮みの分）
            const inner = Math.max(1, (obj.width || 0) - 2 * (obj.inset || 0));
            el.width = Math.max(100, Math.round(Number(el.width) + inner * (obj.baseScale || 1) * (k - 1)));
          } else {
            el.fontSize = Math.max(1, round1(Number(el.fontSize) * k));
            el.width = Math.max(100, Math.round(Number(el.width) * k));
          }
        }
        else if (el.shape === "table") {
          // 表は文字の大きさとセルの間隔を同じ倍率で変える（線の太さはそのまま）
          el.fontSize = Math.max(1, round1(Number(el.fontSize) * k));
          el.hBuff = Math.round(Number(el.hBuff) * k * 1000) / 1000;
          el.vBuff = Math.round(Number(el.vBuff) * k * 1000) / 1000;
        }
        else { el.width = Math.max(2, round1(Number(el.width) * k)); el.height = Math.max(2, round1(Number(el.height) * ky)); if (el.shape === "axes" && el.axesKind === "polar") el.height = el.width; }
      } else if (el.type === "media") {
        if (el.kind === "video") { el.width = Math.max(8, round1(Number(el.width) * k)); el.height = round1(el.width * (el.natH || 9) / (el.natW || 16)); }
      } else if (el.type === "image") {
        const h0 = Number(el.height) || Number(el.width) * (el.natH || 1) / (el.natW || 1);
        el.width = Math.max(2, round1(Number(el.width) * k));
        el.height = Math.max(2, round1(h0 * ky));
      } else if (el.type === "text" && el.wrapWidth != null && !el.vertical && Math.abs(ky - 1) < 1e-3) {
        // 左右のハンドル: 文字の大きさは変えず、折り返す幅だけを変える（見えている幅の伸び縮みの分）
        const inner = Math.max(1, (obj.width || 0) - 2 * (obj.inset || 0));
        el.wrapWidth = Math.max(20, Math.round(Number(el.wrapWidth) + inner * (obj.baseScale || 1) * (k - 1)));
      } else {
        el.fontSize = Math.max(1, round1(Number(el.fontSize) * k));
        if (el.type === "text" && el.wrapWidth != null) el.wrapWidth = Math.max(20, Math.round(Number(el.wrapWidth) * k)); // 角: 幅も一緒に
      }
      resized.push(el);
    }
    emit("element-moved", el);
  }
  markDirty("move");
  emit("slide-changed");
  if (resized.length) {
    // 新しい大きさで作り直す（テキストは Manim の形を作り直すので、拡大してもぼやけない）
    Promise.all(resized.map((el) => refreshElement(el))).then(() => emit("element-resized", resized));
  }
}

function syncPosition(target, done) {
  // 複数を選んで動かしたときは、中の要素それぞれの位置（キャンバス上の中心）を反映する
  const objs = target?.type === "activeselection" || target?.isType?.("ActiveSelection") ? target.getObjects() : [target];
  for (const obj of objs) {
    const el = findElement(obj?.elId);
    if (!el) continue;
    const c = absPt(obj, "origin");
    el.x = Math.round(c.x * 10) / 10;
    el.y = Math.round(c.y * 10) / 10;
    emit("element-moved", el);
  }
  if (done) {
    markDirty("move");
    emit("slide-changed");
  }
}

/** 要素をまとめて dx, dy だけ動かす（矢印キー・座標の入力）。 */
export function moveElements(ids, dx, dy) {
  const re3d = [];
  for (const id of ids) {
    const el = findElement(id);
    if (!el || el.locked) continue;
    if (el.type === "shape" && SHAPES_3D.includes(el.shape)) {
      const obj = canvas.getObjects().find((o) => o.elId === id);
      if (obj && move3d(el, obj, dx, dy, 1)) re3d.push(el);
    }
    el.x = Math.round((Number(el.x) + dx) * 10) / 10;
    el.y = Math.round((Number(el.y) + dy) * 10) / 10;
  }
  quietly(() => canvas.discardActiveObject());
  for (const id of ids) {
    const el = findElement(id);
    const obj = canvas.getObjects().find((o) => o.elId === id);
    if (el && obj) { obj.set({ left: el.x, top: el.y }); obj.setCoords(); emit("element-moved", el); }
  }
  applySelection(store.selectedIds);
  markDirty("move");
  emit("slide-changed");
  for (const el of re3d) refreshElement(el);
}

/**
 * 3D の要素を、画面の上で (dx, dy) px 動かした・k 倍にした分だけ、空間で動かす・大きくする。
 * 画面の右・上の向き（スライドのカメラから求めたもの）に沿って動かす。変わったら true（作り直す）。
 */
function move3d(el, obj, dx, dy, k) {
  const b = obj.basis3;
  let changed = false;
  if (b && (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
    const w = [0, 1, 2].map((i) => (dx * b.r[i] - dy * b.u[i]) / b.s);
    const add = (v) => v.map((x, i) => (typeof x === "string" ? x : Math.round((x + w[i]) * 1000) / 1000));
    if (el.pos3) el.pos3 = add(el.pos3);
    else if (el.shape === "point3d" && !el.axesId && ![...el.p1, ...el.p2].some((v) => typeof v === "string")) { el.p1 = add(el.p1); el.p2 = add(el.p2); }
    changed = true;
  }
  if (Math.abs(k - 1) > 1e-3) {
    if (el.shape === "solid") el.scale = Math.round(el.scale * k * 1000) / 1000;
    if (el.shape === "axes3d") for (const key of ["xLen", "yLen", "zLen"]) el[key] = Math.round(el[key] * k * 1000) / 1000;
    changed = true;
  }
  return changed;
}

/** 枠の大きさに合わせて表示倍率を変える（座標は 1920×1080 のまま）。 */
export function fit() {
  if (!canvas || !stageEl) return;
  const { w, h } = store.meta.canvas;
  const z = Math.max(0.05, Math.min((stageEl.clientWidth - MARGIN * 2) / w, (stageEl.clientHeight - MARGIN * 2) / h));
  canvas.setDimensions({ width: Math.floor(w * z + MARGIN * 2), height: Math.floor(h * z + MARGIN * 2) });
  canvas.setViewportTransform([z, 0, 0, z, MARGIN, MARGIN]);
  canvas.requestRenderAll();
}

export function setBackground(color) {
  if (!canvas) return;
  slideRect.set({ fill: color });
  canvas.requestRenderAll();
}

/** 現在のスライドを描き直す。 */
export async function showSlide() {
  const token = ++buildToken;
  const slide = currentSlide();
  if (!canvas || !slide) return;
  // マスターの題名の型があれば、このスライドの題名をそろえる（スライドで動かした題名も、型の位置に戻す）
  if (!store.masterId && syncTitles(masterOf(slide), [slide])) markDirty("master-title");
  setBackground(backgroundOf(slide));
  const objs = [];
  const seqs = new Map();
  // マスターの要素（いちばん奥。薄く出して、選べない）
  for (const el of masterElementsFor(slide)) {
    try {
      const o = await buildObject(el);
      if (!o) continue;
      o.set({ selectable: false, evented: false, hoverCursor: "default", opacity: (o.opacity ?? 1) * 0.6 });
      o.elId = null;
      o._guiMaster = true;
      objs.push(o);
    } catch (e) { console.warn(e); }
  }
  for (const el of slide.elements) { seqs.set(el.id, nextSeq(el.id)); objs.push(await buildObject(el)); }
  if (token !== buildToken) return; // 途中で別のスライドに切り替わった
  // 作っている間に、要素ごとの作り直しを頼まれた要素は、並べたあとで作り直す（古い内容のまま残さない）
  const stale = slide.elements.filter((e) => seqs.has(e.id) && buildSeq.get(e.id) !== seqs.get(e.id));
  quietly(() => {
    canvas.discardActiveObject();
    comp3d.obj = null; comp3d.token++;
    canvas.remove(...canvas.getObjects());
    for (const o of objs) canvas.add(o);
    orderDepth3d();
  });
  if (store.project?.settings?.use3d) scheduleComposite3d(0);
  // 消えた要素を選択から外して、選択を作り直す
  const ids = store.selectedIds.filter((id) => slide.elements.some((e) => e.id === id));
  applySelection(ids);
  if (!sameSet(ids, store.selectedIds)) commitSelection(ids);
  canvas.requestRenderAll();
  // 吹き出しは、中身がキャンバスに並んでから大きさを確かめ直す（変わらなければ、作り直しは一瞬で済む）
  for (const e of slide.elements) {
    if (e.type === "shape" && e.shape === "balloon" && e.contentIds?.length) scheduleBalloonsFor(e.contentIds[0]);
    if (e.type === "shape" && e.shape === "brace" && e.mode !== "points" && e.targetId) scheduleBalloonsFor(e.targetId);
  }
  for (const e of stale) refreshElement(e);
  for (const e of slide.elements) placeCellItems(e);
  // 左・右寄せの題名は、文字の幅に合わせて端に寄せる（描画と同じ位置にする）
  for (const e of slide.elements) if (e.type === "shape" && e.shape === "title") snapTitle(e);
  emit("canvas-rendered", slide);
}

// 要素ごとの作り直しの番号。プレビューは時間がかかり、応答の順番も入れ替わることがあるので、
// 最後に頼んだ作り直しの結果だけを使う（古い内容の結果が、あとから届いて上書きしないように）
const buildSeq = new Map();
const nextSeq = (id) => { const n = (buildSeq.get(id) ?? 0) + 1; buildSeq.set(id, n); return n; };

/** 1つの要素だけを作り直す（プロパティ変更時）。 */
// 切り抜きの型の輪郭（Manim の座標の折れ線）。要素の内容が同じ間は覚えておく
const outlineCache = new Map();
async function maskOutline(shape) {
  const key = JSON.stringify(shape);
  if (outlineCache.has(key)) return outlineCache.get(key);
  let polys = null;
  try { polys = (await api.post("/api/image/outline", { el: shape })).polys; } catch { polys = null; }
  if (outlineCache.size > 100) outlineCache.clear();
  outlineCache.set(key, polys);
  return polys;
}

/** 要素 el を切り抜きの型にしている画像を作り直す（型を動かした・変えたとき）。 */
function refreshMasked(el) {
  if (!el || el.type === "image") return;
  for (const im of currentSlide()?.elements ?? []) if (im.type === "image" && im.mask?.id === el.id) refreshElement(im);
}
on("element-moved", (el) => refreshMasked(el));

export async function refreshElement(el) {
  if (!canvas) return;
  const token = buildToken;
  const seq = nextSeq(el.id);
  const obj = await buildObject(el);
  if (token !== buildToken) return;
  if (buildSeq.get(el.id) !== seq) return; // このあとに頼んだ作り直しがある
  if (!currentSlide()?.elements.includes(el)) return; // 別のスライドに移った・削除された
  quietly(() => {
    const old = canvas.getObjects().find((o) => o.elId === el.id);
    if (!canvas.getObjects().some((o) => o._guiCrop)) canvas.discardActiveObject(); // 複数選択の中の物を置き換えるため、いったん選択を解いて作り直す（トリミング中は除く）
    if (old) {
      const idx = canvas.getObjects().indexOf(old);
      canvas.remove(old);
      canvas.insertAt(idx, obj);
    } else {
      canvas.add(obj);
    }
    if (obj.depth3 !== undefined || old?.depth3 !== undefined) orderDepth3d();
    if (obj.anchor3 || old?.anchor3) {
      if (comp3d.obj) { obj._compOp = obj.opacity ?? 1; obj.set("opacity", 0); } // 描き直すまでは、まとめた絵のまま
      scheduleComposite3d();
    }
  });
  applySelection(store.selectedIds);
  canvas.requestRenderAll();
  emit("element-rendered", { el, error: obj.mathError || "" });
  refreshMasked(el);
}

/** 3D の物どうしの重なりを、カメラからの距離の順にする（プロジェクト設定「キャンバスでの 3D の重なり」が「奥行きの順」のとき。既定）。
 * 3D の物が並んでいる位置（レイヤーの中の場所）は変えず、その中で奥から順に並べ替える。保存されるレイヤーの順は変えない。
 * 物の中心で比べるので、大きさが大きく違う物・食い込んでいる物は、描画と違うことがある。 */
export function orderDepth3d() {
  // 「まとめて描く」（既定）でも、物ごとの絵（選ぶ・ドラッグ用）は奥行きの順に（重なった所では手前の物を選ぶ）
  if (!canvas || !store.project?.settings?.use3d || store.project.settings.view3d === "layer") return;
  const all = canvas.getObjects();
  const slots = [], objs = [];
  all.forEach((o, i) => { if (o.depth3 !== undefined && o.elId) { slots.push(i); objs.push(o); } });
  if (objs.length < 2) return;
  objs.sort((a, b) => a.depth3 - b.depth3); // 奥（小さい）から手前（大きい）へ
  const want = [...all];
  slots.forEach((i, k) => { want[i] = objs[k]; });
  want.forEach((o, i) => { if (canvas.getObjects()[i] !== o) canvas.moveObjectTo(o, i); }); // 先頭から順に置けば、ほかの物の順は変わらない
}

// ---------------------------------------------------------------- 3D をまとめて描く（プロジェクト設定「キャンバスでの 3D の重なり」が「描画と同じ」のとき。既定）
// スライドの 3D の物を Manim でまとめて 1 枚に描き（描画と同じく、すべての物の面を近さの順に重ねる）、その絵を見せる。
// 物ごとの絵は見えなくして（不透明度 0）、選ぶ・ドラッグするためにだけ使う。ドラッグの間は、まとめた絵を外して物ごとの絵を見せる。
const comp3d = { obj: null, token: 0, timer: null };

export function scheduleComposite3d(delay = 350) {
  clearTimeout(comp3d.timer);
  comp3d.timer = setTimeout(updateComposite3d, delay);
}

function compositeMode() {
  const s = store.project?.settings;
  return !!(s?.use3d && (s.view3d ?? "scene") === "scene");
}

function removeComposite3d() {
  if (comp3d.obj && canvas) canvas.remove(comp3d.obj);
  comp3d.obj = null;
  for (const o of canvas?.getObjects() ?? []) {
    if (o._compOp !== undefined) { o.set("opacity", o._compOp); delete o._compOp; }
  }
  canvas?.requestRenderAll();
}

async function updateComposite3d() {
  if (!canvas || !compositeMode()) { removeComposite3d(); return; }
  const slide = currentSlide();
  const objs3 = canvas.getObjects().filter((o) => o.anchor3 && o.elId && o.visible !== false);
  const els = objs3.map((o) => findElement(o.elId)).filter((e) => e && e.type === "shape" && SHAPES_3D.includes(e.shape));
  if (els.length < 1) { removeComposite3d(); return; }
  const tok = ++comp3d.token;
  const items = els.map((e) => previewPayload(e, null, ["surface", "curve3d", "point3d"].includes(e.shape) && e.axesId ? findElement(e.axesId) : null));
  let r;
  try {
    r = await api.postRetry("/api/preview/scene3d", { items });
  } catch {
    return; // まとめて描けないときは、物ごとの絵のまま
  }
  if (tok !== comp3d.token || slide !== currentSlide() || !compositeMode()) return;
  removeComposite3d();
  if (!r?.png) return;
  const f = fab();
  const img = await f.FabricImage.fromURL(`data:image/png;base64,${r.png}`);
  if (tok !== comp3d.token || slide !== currentSlide()) return;
  img.set({ left: r.x, top: r.y, originX: "left", originY: "top", selectable: false, evented: false, objectCaching: false, hoverCursor: "default" });
  img.comp3d = true;
  const list = canvas.getObjects();
  const at = list.findIndex((o) => o.anchor3);
  canvas.insertAt(at < 0 ? list.length : at, img);
  comp3d.obj = img;
  for (const o of canvas.getObjects()) {
    if (o.anchor3 && o.elId && o._compOp === undefined) { o._compOp = o.opacity ?? 1; o.set("opacity", 0); }
  }
  canvas.requestRenderAll();
}

/** 3D の物をドラッグ・拡大などしている間は、まとめた絵を外し、物ごとの絵を見せる（離したら描き直す）。 */
function liftComposite3d(target) {
  if (!comp3d.obj || !target) return;
  const list = target.type === "activeselection" || target.type === "activeSelection" ? target.getObjects() : [target];
  if (list.some((o) => o.anchor3)) { comp3d.token++; removeComposite3d(); }
}

/** ほかのモジュール（cam3d.js）から、キャンバスの入れ物を使うため（キャンバスは fabricCanvas）。 */
export function stageElement() { return stageEl; }

export function moveObject(el) {
  const obj = canvas?.getObjects().find((o) => o.elId === el.id);
  if (!obj) return;
  quietly(() => canvas.discardActiveObject());
  obj.set({ left: el.x, top: el.y, angle: -(Number(el.rotation) || 0) });
  obj.setCoords();
  applySelection(store.selectedIds);
  emit("element-moved", el); // 吹き出しの中身なら、吹き出しも合わせる
}

/**
 * id（要素またはグループ）を選ぶ。呼び出し側が store.selectedId を設定して selection を出す前提で、
 * store.selectedIds とキャンバスの選択をそろえる。要素の id なら、その要素だけを選ぶ（グループの中に入る）。
 */
export function selectObject(id) {
  if (!canvas) return;
  let ids = [];
  if (findGroup(id)) {
    ids = groupMembers(id).map((e) => e.id);
    store.enteredGroup = null;
  } else if (findElement(id)) {
    ids = [id];
    store.enteredGroup = findElement(id).groupId ?? null;
  }
  store.selectedIds = ids;
  applySelection(ids);
}

/** id の一覧を選び、パネルにも知らせる。 */
export function selectIds(ids) {
  store.enteredGroup = null;
  applySelection(ids);
  commitSelection(currentSlide().elements.map((e) => e.id).filter((id) => ids.includes(id)));
}

/** マウスなどのイベントの位置（キャンバスの論理座標、枠の中に収める）。 */
export function scenePointOf(e) {
  const pt = canvas.getScenePoint(e);
  const { w, h } = store.meta.canvas;
  return { x: Math.min(w, Math.max(0, pt.x)), y: Math.min(h, Math.max(0, pt.y)) };
}

/** マウスの位置にある（いちばん手前の、クリックできる）要素の id。 */
export function canvasObjectAt(e) {
  if (!canvas) return null;
  const pt = canvas.getScenePoint(e);
  const objs = canvas.getObjects();
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.visible && o.evented !== false && o.containsPoint(pt)) return o.elId;
  }
  return null;
}

export function mathErrorOf(id) {
  return canvas?.getObjects().find((o) => o.elId === id)?.mathError || "";
}

/** スライドのサムネイルを、画面外のキャンバスで作る。 */
export async function renderThumbnail(slide) {
  const f = fab();
  const el = document.createElement("canvas");
  const sc = new f.StaticCanvas(el, {
    width: store.meta.canvas.w, height: store.meta.canvas.h,
    backgroundColor: backgroundOf(slide), enableRetinaScaling: false,
  });
  for (const e of masterElementsFor(slide)) { try { sc.add(await buildObject(e, { forThumbnail: true })); } catch { /* 描けない物は飛ばす */ } }
  for (const e of slide.elements) sc.add(await buildObject(e, { forThumbnail: true }));
  sc.renderAll();
  const url = sc.toDataURL({ format: "png", multiplier: 240 / store.meta.canvas.w });
  sc.dispose();
  return url;
}

/** スライドの要素ごとの外接矩形（キャンバスの px）と数式のエラー。今のスライドは画面のキャンバスから、ほかは見えない所で作って調べる（点検に使う）。 */
export async function slideBoxes(slide) {
  const box = (o) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of o.getCoords()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  if (slide === currentSlide() && canvas) {
    return canvas.getObjects().filter((o) => o.elId).map((o) => ({ id: o.elId, box: box(o), mathError: o.mathError || "" }));
  }
  const f = fab();
  const sc = new f.StaticCanvas(document.createElement("canvas"), { width: store.meta.canvas.w, height: store.meta.canvas.h, enableRetinaScaling: false });
  const out = [];
  for (const e of slide.elements) {
    try {
      const o = await buildObject(e, { forThumbnail: true });
      if (!o) continue;
      sc.add(o);
      o.setCoords();
      out.push({ id: e.id, box: box(o), mathError: o.mathError || "" });
    } catch (err) { out.push({ id: e.id, box: null, mathError: String(err?.message || err) }); }
  }
  sc.dispose();
  return out;
}

/** 要素をまとめた外接矩形の中心（キャンバスの px）。 */
export function boundsCenter(ids) {
  const act = canvas?.getActiveObject();
  if (isSelection(act) && sameSet(act.getObjects().map((o) => o.elId), ids)) {
    const c = act.getCenterPoint(); // 向きのある枠の中心（回しても動かない）
    return { x: c.x, y: c.y };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const o = canvas?.getObjects().find((x) => x.elId === id);
    if (!o) continue;
    for (const p of o.getCoords()) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) {
    const els = ids.map((id) => findElement(id)).filter(Boolean);
    if (!els.length) return null;
    return { x: els.reduce((a, e) => a + e.x, 0) / els.length, y: els.reduce((a, e) => a + e.y, 0) / els.length };
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * 枠・点の影（kind: "rect" はズームの拡大する所などの枠、"point" は回転の中心など）。中心は (bx + dx, by + dy)（キャンバスの px）。
 * rect は w・h の大きさで、動く前の枠（fromX・fromY・fromW・fromH）を点線で描き、矢印でつなぐ。
 */
function arrowHead(ctx, x0, y0, x1, y1, s) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = 12 * s;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - L * Math.cos(a - 0.45), y1 - L * Math.sin(a - 0.45));
  ctx.lineTo(x1 - L * Math.cos(a + 0.45), y1 - L * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawMarkGhost(ctx, g, vt) {
  const cx = (g.bx ?? 0) + (g.dx ?? 0), cy = (g.by ?? 0) + (g.dy ?? 0), s = 1 / vt[0];
  ctx.strokeStyle = g.color ?? "#7a4fd6"; ctx.fillStyle = g.color ?? "#7a4fd6";
  ctx.lineWidth = 2 * s;
  ctx.font = `${13 * s}px sans-serif`;
  if (g.kind === "poly") {
    // 動きの道筋（線に沿って動く）: 点線と、終わりの矢印
    const P = g.pts;
    if (P.length < 2) return;
    ctx.setLineDash([7 * s, 5 * s]);
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (const q of P.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(ctx, P.at(-2)[0], P.at(-2)[1], P.at(-1)[0], P.at(-1)[1], s);
    ctx.beginPath(); ctx.arc(P[0][0], P[0][1], 3.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(g.label ?? "", P[0][0] + 6 * s, P[0][1] - 6 * s);
    g._box = null;
    return;
  }
  if (g.kind === "arc") {
    // 回転の道筋: 中心のまわりの弧と、回る向きの矢印（a0 から a0 + sweep まで。キャンバスの角度は下向きが正なので符号を反転）
    const steps = Math.max(8, Math.ceil(Math.abs(g.sweep) / 6));
    ctx.setLineDash([7 * s, 5 * s]);
    ctx.beginPath();
    let px = 0, py = 0, qx = 0, qy = 0;
    for (let i = 0; i <= steps; i++) {
      const a = (g.a0 + g.sweep * i / steps) * Math.PI / 180;
      const x = g.cx + g.r * Math.cos(a), y = g.cy - g.r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      if (i === steps - 1) { px = x; py = y; }
      if (i === steps) { qx = x; qy = y; }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(ctx, px, py, qx, qy, s);
    ctx.fillText(g.label ?? "", g.cx + g.r * Math.cos(g.a0 * Math.PI / 180) + 6 * s, g.cy - g.r * Math.sin(g.a0 * Math.PI / 180) - 6 * s);
    g._box = null;
    return;
  }
  if (g.kind === "point") {
    const r = 9 * s;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r * 1.6, cy); ctx.lineTo(cx + r * 1.6, cy); ctx.moveTo(cx, cy - r * 1.6); ctx.lineTo(cx, cy + r * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(g.label ?? "", cx + r * 1.4, cy - r * 1.2);
    const h = r * 1.8;
    g._box = { x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h };
    return;
  }
  const w = g.w, h = g.h;
  if (g.fromX !== undefined) {
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(g.fromX - g.fromW / 2, g.fromY - g.fromH / 2, g.fromW, g.fromH);
    ctx.globalAlpha = 1;
    ctx.setLineDash([8 * s, 6 * s]);
    ctx.beginPath(); ctx.moveTo(g.fromX, g.fromY); ctx.lineTo(cx, cy); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5 * s;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  ctx.globalAlpha = 0.08; ctx.fillRect(cx - w / 2, cy - h / 2, w, h); ctx.globalAlpha = 1;
  ctx.fillText(g.label ?? "", cx - w / 2, cy - h / 2 - 5 * s);
  g._box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

/** 移動先の影の一覧（[{ids, dx, dy, fromDx, fromDy, label, onDrag(dx, dy, done)}]。dx・dy はキャンバスの px のずれ）。 */
let ghosts = [];
let ghostDrag = null;

/** 一部分を選ぶ（{boxes: [{x0, y0, x1, y1, label, on}], onClick(i, shift)}。キャンバスの px）。null で終わる。 */
let picker = null;
let pickerDim = null; // 部品を選ぶ間: 選ぶ要素だけをはっきり見せ、ほかを薄くする（元の濃さを覚えておく）
function dimForPicker(focusId) {
  if (pickerDim) {
    for (const [o, op] of pickerDim) o.set({ opacity: op });
    pickerDim = null;
  }
  if (!canvas || !focusId) return;
  pickerDim = new Map();
  for (const o of canvas.getObjects()) {
    if (!o.elId) continue;
    pickerDim.set(o, o.opacity);
    o.set({ opacity: o.elId === focusId ? 1 : Math.min(o.opacity ?? 1, 0.12) });
  }
}
export function setPartPicker(p) {
  const was = !!picker;
  picker = p;
  dimForPicker(p?.focusId ?? null);
  if (canvas && p && !was) quietly(() => canvas.discardActiveObject()); // 選択の枠・ハンドルを隠して、部品を押しやすくする
  if (canvas && !p && was) applySelection(store.selectedIds);
  canvas?.requestRenderAll();
}
function drawPicker(ctx, vt) {
  const s = 1 / vt[0];
  ctx.font = `${11 * s}px sans-serif`;
  ctx.lineWidth = 1.5 * s;
  for (const b of picker.boxes) {
    ctx.strokeStyle = b.on ? "#e0730b" : b.used ? "rgba(120,120,120,0.8)" : "rgba(53,84,209,0.7)";
    ctx.fillStyle = b.on ? "rgba(224,115,11,0.25)" : b.used ? "rgba(120,120,120,0.22)" : "rgba(53,84,209,0.06)";
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.fillStyle = b.on ? "#b85500" : "#3554d1";
    ctx.fillText(b.used && !b.on ? `${b.label}✓` : b.label, b.x0, b.y0 - 2 * s);
  }
}
export function setGhosts(list) {
  ghosts = list ?? [];
  canvas?.requestRenderAll();
}
export const ghostList = () => ghosts; // 自動テスト用

/** 要素（id の一覧）の外接矩形（キャンバスの px）。キャンバスに無ければ null。 */
export function elementBounds(ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const o = canvas?.getObjects().find((x) => x.elId === id);
    if (!o) continue;
    for (const p of o.getCoords()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** 要素の字面（プレビューの余白を除く）の外接矩形（キャンバスの px）。 */
export function tightBounds(ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const o = canvas?.getObjects().find((x) => x.elId === id);
    if (!o) continue;
    for (const p of tightCorners(o)) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** 自動テスト用: Fabric のキャンバス（アプリ内では使わない）。 */
export const fabricCanvas = () => canvas;


// ---------------------------------------------------------------- 図形の補助（基準点・線の両端・吹き出し）

/** オブジェクトの中の点 name（図形のプレビューが返した SVG の中の px）の、キャンバス上の位置。無ければ中心。 */
function absPt(obj, name) {
  const f = fab();
  const p = obj.shapePts?.[name];
  const local = p ? new f.Point(p[0] - obj.width / 2, p[1] - obj.height / 2) : new f.Point(0, 0);
  return f.util.transformPoint(local, obj.calcTransformMatrix());
}

/** 要素のオブジェクトの、字面にぴったりの四隅（プレビューの余白 inset を除く）。 */
/** スライドの初めに見えていないか。表・行列のセルの要素（自分の「出す」が無いもの）は、表に従う。 */
function startsHidden(el) {
  const box = cellContainerOf(el.id);
  if (box && !hasOwnIntro(el.id)) return box.visibleAtStart === false;
  return el.visibleAtStart === false;
}

/** 位置の基準（テキスト・数式・LaTeX の文章で、回していないもの）。"left"・"right"、中心なら null。 */
export function anchorOf(el) {
  if (!el || !["left", "right"].includes(el.anchor) || Number(el.rotation)) return null;
  return el.type === "text" || el.type === "math" || (el.type === "shape" && el.shape === "tex") ? el.anchor : null;
}

function tightWidth(obj) {
  const xs = tightCorners(obj).map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

// 位置の基準が端の文字を動かしたら、端の位置を覚え直す
on("element-moved", (el) => {
  const a = anchorOf(el);
  if (!a) return;
  const w = objectWidth(el.id);
  if (!w) return;
  el.edgeX = Math.round((a === "left" ? el.x - w / 2 : el.x + w / 2) * 10) / 10;
});

function tightCorners(obj) {
  const f = fab();
  const m = obj.calcTransformMatrix(), i = obj.inset || 0;
  const hw = Math.max(0, obj.width / 2 - i), hh = Math.max(0, obj.height / 2 - i);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => f.util.transformPoint(new f.Point(x, y), m));
}

/** 吹き出しの箱（中身の外接矩形＋余白、キャンバスの px）。中身がキャンバスに無いとき（サムネイルなど）は前回の値。 */
function balloonBox(el, forThumbnail = false) {
  const P = store.meta.canvas.h / 8;
  const ids = el.contentIds ?? [];
  const objs = forThumbnail || !canvas ? [] : ids.map((id) => canvas.getObjects().find((o) => o.elId === id)).filter(Boolean);
  if (ids.length && objs.length) {
    // 吹き出しの向き（Fabric の角度 φ = -rotation）で測る: 点を -φ 回した座標の外接矩形
    const phi = -(Number(el.rotation) || 0) * Math.PI / 180, c = Math.cos(phi), sn = Math.sin(phi);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) {
      for (const p of tightCorners(o)) {
        const u = p.x * c + p.y * sn, v = -p.x * sn + p.y * c;
        x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
      }
    }
    const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2;
    el.x = round1(cu * c - cv * sn);
    el.y = round1(cu * sn + cv * c);
    el.width = round1(Math.max(x1 - x0 + 2 * el.padX * P, 0.6 * P));
    el.height = round1(Math.max(y1 - y0 + 2 * el.padY * P, 0.4 * P));
  }
  return { w: Number(el.width) || 300, h: Number(el.height) || 150 };
}

// ほかの要素から形が決まる要素（吹き出し: 中身、グラフ: 座標軸、中かっこ: 付ける要素）
function dependsOn(b, elId) {
  if (b.type !== "shape") return false;
  if (["table", "matrix"].includes(b.shape)) return (b.items ?? []).some((r) => r.includes(elId)); // セルの要素の形・大きさ
  if (b.shape === "balloon") return (b.contentIds ?? []).includes(elId);
  if (["graph", "field", "axdot", "surface", "curve3d", "point3d", "curve2d", "implicit"].includes(b.shape)) return b.axesId === elId;
  if (b.shape === "graphpart") return b.graphId === elId || findElement(b.graphId)?.axesId === elId;
  if (b.shape === "angle") return b.line1Id === elId || b.line2Id === elId;
  if (b.shape === "boolean") return (b.operandIds ?? []).includes(elId);
  if (b.shape === "annot") return b.targetId === elId;
  if (b.shape === "trace") return b.targetId === elId;
  if (b.shape === "tangent") {
    // 接線: 付ける曲線と、その曲線の座標軸など（曲線が変われば引き直す）
    if (b.targetId === elId) return true;
    const t = findElement(b.targetId);
    return !!t && (t.axesId === elId || (t.operandIds ?? []).includes(elId));
  }
  if (b.shape === "linegraph" || b.shape === "points") return b.axesId === elId;
  if (b.shape === "graphpart" && b.graph2Id === elId) return true;
  if (b.shape === "vector") return !!b.axesId && b.axesId === elId;
  if (b.shape === "brace") return b.mode !== "points" && b.targetId === elId;
  if (b.shape === "dot") {
    // 円周上の点: 円が動けば付いていく。名前の向き（自動）: 円・線が動けば向きを決め直す
    if (b.onCircle?.id === elId) return true;
    if (b.pname && b.pnamePos === "auto") { const o = findElement(elId); return !!o && o.type === "shape" && ["line", "ellipse", "arc"].includes(o.shape); }
  }
  return false;
}

// 頼っている要素が変わった・動いたら作り直す（少し待ってまとめて。ドラッグの途中は待つ）
const balloonTimers = new Map();
function scheduleBalloonsFor(elId, moved = false) {
  const slide = currentSlide();
  if (!slide) return;
  for (const b of slide.elements) {
    if (!dependsOn(b, elId)) continue;
    if (moved && ["table", "matrix"].includes(b.shape)) continue; // セルの要素の位置は表が決める（動いても表の形は変わらない）
    clearTimeout(balloonTimers.get(b.id));
    const run = () => {
      if (canvas?._currentTransform) { balloonTimers.set(b.id, setTimeout(run, 120)); return; }
      balloonTimers.delete(b.id);
      if (currentSlide()?.elements.includes(b)) refreshElement(b);
    };
    balloonTimers.set(b.id, setTimeout(run, 80));
  }
}
on("element-moved", (el) => { if (el) { scheduleBalloonsFor(el.id, true); placeCellItems(el); } });
on("element-rendered", ({ el }) => { if (el) { scheduleBalloonsFor(el.id); placeCellItems(el); } });

/** 表・行列のセルに入れた要素を、セルの位置（表のプレビューが返した e<id> の点）に置く。 */
function placeCellItems(t) {
  if (t?.type !== "shape" || !["table", "matrix"].includes(t.shape)) return;
  const obj = canvas?.getObjects().find((o) => o.elId === t.id);
  if (!obj?.shapePts) return;
  let moved = false;
  for (const id of (t.items ?? []).flat()) {
    if (!id || !obj.shapePts[`e${id}`]) continue;
    const it = findElement(id);
    if (!it) continue;
    const p = absPt(obj, `e${id}`);
    const x = round1(p.x), y = round1(p.y);
    if (Math.abs(x - it.x) < 0.5 && Math.abs(y - it.y) < 0.5) continue;
    it.x = x; it.y = y;
    moveObject(it); // セルの要素に付けた注釈なども動く（element-moved）
    moved = true;
  }
  if (moved) { markDirty("move"); canvas.requestRenderAll(); }
}

// ---- ページ番号の表示 ----
let pageOverlay = null; // { slide, img, w, h, margin }
let pageSeq = 0;
async function updatePageOverlay() {
  const seq = ++pageSeq;
  const slide = currentSlide();
  const plan = slide && !store.masterId ? pagePlan()[store.slideIndex] : null;
  if (!slide || !plan?.show) { pageOverlay = null; canvas?.requestRenderAll(); return; }
  const s = store.project.settings, ps = s.pageNumbers ?? {};
  const r = await renderTextPreview({ type: "text", runs: [{ t: plan.text }], text: plan.text, font: s.defaultFont, fontSize: ps.fontSize ?? 24, color: ps.color || s.defaultColor });
  if (seq !== pageSeq || !r?.url) return;
  const img = new Image();
  img.src = r.url;
  try { await img.decode(); } catch { return; }
  if (seq !== pageSeq) return;
  pageOverlay = { slide, img, w: r.width, h: r.height, margin: r.margin || 0 };
  canvas?.requestRenderAll();
}
// ---- 章の表示 ----
let sectionOverlay = null; // { slide, img, w, h, margin, progress, spans }
let sectionSeq = 0;
async function updateSectionOverlay() {
  const seq = ++sectionSeq;
  const slide = currentSlide();
  const ss = store.project?.settings?.sections ?? {};
  const mode = ss.display ?? "none";
  const sec = slide && !store.masterId ? sectionPlan()[store.slideIndex] : null;
  if (!slide || mode === "none" || !sec || sec.appendix || slide.sectionShow === "off" || masterOf(slide)?.sections === "off") { sectionOverlay = null; canvas?.requestRenderAll(); return; }
  const out = { slide, img: null, w: 0, h: 0, margin: 0, progress: mode === "bar" || mode === "both" ? sec.progress : null, spans: sec.spans };
  if ((mode === "name" || mode === "both") && sec.name) {
    const s = store.project.settings;
    const r = await renderTextPreview({ type: "text", runs: [{ t: sec.name }], text: sec.name, font: s.defaultFont, fontSize: ss.fontSize ?? 20, color: ss.color || s.defaultColor });
    if (seq !== sectionSeq) return;
    if (r?.url) {
      const img = new Image();
      img.src = r.url;
      try { await img.decode(); } catch { /* 名前なしで */ }
      if (seq !== sectionSeq) return;
      Object.assign(out, { img, w: r.width, h: r.height, margin: r.margin || 0 });
    }
  }
  sectionOverlay = out;
  canvas?.requestRenderAll();
}
on("canvas-rendered", updateSectionOverlay);
on("page-numbers-changed", updateSectionOverlay);
on("settings-changed", updateSectionOverlay);
on("slides-changed", updateSectionOverlay);
on("canvas-rendered", updatePageOverlay);
on("page-numbers-changed", updatePageOverlay);
on("settings-changed", updatePageOverlay);
on("element-rendered", ({ el }) => { if (el?.type === "shape" && el.shape === "title") snapTitle(el); });

/** 題名の横の位置。
 * ・画面の幅の下線: 下線が画面の中央にあり、文字は下線の端にそろう（gui_title が寄せる）ので、中央に置く
 * ・左・右寄せに切り替えたとき: 一度だけ、画面の端から 1 単位の所に寄せる（そのあとは自由に動かせる）
 * ・マスターの題名の型にそろえるスライドの題名（左・右寄せ）: マスターの題名の左端（右端）に、文字の端をそろえる
 * ・マスターの編集中の題名（左・右寄せ）: 今の左端（右端）を el.edge に覚える（スライドの題名をそろえる所） */
const titleSeen = new Map();
function snapTitle(el) {
  const W = store.meta.canvas.w, P = store.meta.canvas.h / 8;
  const key = `${el.align}|${el.underline}|${el.matchWidth}`;
  const prev = titleSeen.get(el.id);
  titleSeen.set(el.id, key);
  const side = el.align === "left" || el.align === "right";
  const full = el.underline && !el.matchWidth;
  const inMasterNow = !!store.masterId && currentSlide()?.elements.includes(el);
  const tpl = !store.masterId && currentSlide()?.elements.includes(el) ? titleTemplate(masterOf(currentSlide())) : null;
  let x = el.x;
  if (full) x = W / 2;
  else if (side) {
    const w = objectWidth(el.id);
    if (!w) return;
    if (tpl && tpl.edge != null && (tpl.align === "left" || tpl.align === "right")) x = el.align === "left" ? tpl.edge + w / 2 : tpl.edge - w / 2;
    else if (prev !== undefined && prev !== key) x = el.align === "left" ? P + w / 2 : W - P - w / 2; // 寄せ方を変えた直後だけ
    if (inMasterNow) {
      const edge = round1(el.align === "left" ? x - w / 2 : x + w / 2);
      if (el.edge !== edge) { el.edge = edge; markDirty("master-title"); }
    }
  } else {
    if (inMasterNow && el.edge != null) { el.edge = null; markDirty("master-title"); }
    return;
  }
  x = round1(x);
  if (Math.abs(x - el.x) < 0.5) return;
  el.x = x;
  moveObject(el);
  markDirty("move");
  emit("element-moved", el);
}
// 円周上の点をドラッグしたら、円周に沿わせる（動かした位置に近い円周上の点。角度を覚え直す）
on("element-moved", (el) => {
  if (!(el?.type === "shape" && el.shape === "dot" && el.onCircle)) return;
  const c = findElement(el.onCircle.id);
  if (!c) return;
  el.onCircle = { ...el.onCircle, angle: onCircleAngle(c, [el.x, el.y]) };
  const p = onCirclePos(c, el.onCircle.angle);
  if (p && (Math.abs(p[0] - el.x) > 0.05 || Math.abs(p[1] - el.y) > 0.05)) { el.x = p[0]; el.y = p[1]; moveObject(el); markDirty("move"); }
});
// マスターの題名をドラッグで動かしたときも、端を覚え直す
on("element-moved", (el) => { if (store.masterId && el?.type === "shape" && el.shape === "title" && (el.align === "left" || el.align === "right")) snapTitle(el); });

/** 図形のハンドル: 線は両端、吹き出しは尾の先。吹き出しは中身から大きさが決まるので、拡大・回転のハンドルを出さない。 */
function setupShapeControls(obj, el) {
  const f = fab();
  if (el.locked) return;
  const handle = (name, cursor) => new f.Control({
    x: 0, y: 0, cursorStyle: cursor,
    positionHandler: (dim, finalMatrix, o) => f.util.transformPoint(name === "bulge" ? bulgePt(o) : absPt(o, name), canvas.viewportTransform),
    actionHandler: (e, transform, x, y) => { dragPoint(transform.target, name, x, y, e); return false; },
    mouseUpHandler: () => { finishPointDrag(); return true; },
    render: (ctx, left, top) => {
      ctx.save();
      ctx.fillStyle = ["tail", "xl", "yl", "nm", "bulge"].includes(name) || /^n\d+$/.test(name) ? "#f2a900" : "#ffffff";
      ctx.strokeStyle = "#3554d1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(left, top, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
    sizeX: 14, sizeY: 14,
  });
  if (SHAPES_3D.includes(el.shape)) {
    // 3D の要素は回さない（向きはパネルで）。座標軸に付けた曲面・曲線・点は、座標軸と一緒に動く
    obj.setControlsVisibility({ mtr: false, ...MID_HIDDEN });
    obj.set({ lockRotation: true });
    const attached = ["surface", "curve3d"].includes(el.shape) || (el.shape === "point3d" && el.axesId);
    if (attached) obj.set({ hasControls: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, perPixelTargetFind: true });
    if (el.shape === "point3d") obj.set({ hasControls: false, lockScalingX: true, lockScalingY: true });
    // 座標に式（スライドの値など）があるときは、ドラッグでは動かさない（パネルの式で決める）
    if (el.shape === "point3d" && [...el.p1, ...el.p2].some((v) => typeof v === "string")) obj.set({ lockMovementX: true, lockMovementY: true });
    return;
  }
  if (["graphpart", "curve2d", "implicit", "angle", "boolean", "annot", "linegraph", "points", "trace", "tangent"].includes(el.shape) || (el.shape === "vector" && el.axesId)) {
    // グラフ・座標軸・線・元の図形から形が決まる（自分では動かさない）。線の上だけで選べる
    obj.setControlsVisibility({ mtr: false });
    obj.set({ hasControls: false, lockRotation: true, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, perPixelTargetFind: true });
    return;
  }
  if (el.shape === "zoom") {
    // 映す所は回さない。拡大する所は、オレンジの丸（枠の中心）をドラッグして動かす
    obj.setControlsVisibility({ mtr: false });
    obj.set({ lockRotation: true });
    obj.controls = { ...obj.controls, frame: handle("frame", "move") };
  }
  if (el.shape === "part") obj.setControlsVisibility(MID_HIDDEN); // 部品は縦横同じ倍率で
  if (el.shape === "vector") { obj.setControlsVisibility({ mtr: false, ...MID_HIDDEN }); obj.set({ lockRotation: true, lockScalingX: true, lockScalingY: true }); }
  if (["barchart", "samplespace", "netgraph", "statchart"].includes(el.shape)) { obj.setControlsVisibility({ mtr: false }); obj.set({ lockRotation: true }); } // 棒グラフ・標本空間・グラフは回さない
  if (el.shape === "netgraph" && el.layout === "manual") {
    // 手で動かす配置: 頂点の上のオレンジの丸をドラッグする
    obj.controls = { ...obj.controls };
    for (const k of Object.keys(obj.shapePts ?? {})) if (/^n\d+$/.test(k)) obj.controls[k] = handle(k, "move");
  }
  // 画面の幅の下線の題名は、横には動かさない（中央に合わせる）。マスターの題名の型にそろえる題名も動かさない
  if (el.shape === "title" && ((el.underline && !el.matchWidth) || (!store.masterId && titleTemplate(masterOf(currentSlide()))))) obj.set({ lockMovementX: true, lockMovementY: true });
  if (["axes", "graph", "brace", "field", "axdot"].includes(el.shape)) {
    // 座標軸・グラフ・中かっこ・ベクトル場は回さない（グラフ・中かっこは座標軸・付ける要素と一緒に動く）
    obj.setControlsVisibility({ mtr: false });
    obj.set({ lockRotation: true });
    if (el.shape === "axes" && el.axesKind === "numberline") obj.setControlsVisibility({ mt: false, mb: false });
    if (el.shape === "axes" && el.axesKind === "polar") obj.setControlsVisibility(MID_HIDDEN); // 極座標は円なので、縦横比を保つ
    // 軸ラベルは、オレンジの丸をドラッグして動かす
    if (el.shape === "axes" && (obj.shapePts?.xl || obj.shapePts?.yl)) {
      obj.controls = { ...obj.controls };
      for (const n of ["xl", "yl"]) if (obj.shapePts[n]) obj.controls[n] = handle(n, "move");
    }
    if (el.shape === "graph" || el.shape === "axdot" || (el.shape === "brace" && el.mode !== "points") || (el.shape === "field" && el.axesId)) {
      obj.set({ hasControls: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true });
    }
    // 線の上だけで選べる（下の座標軸を選べるように）
    if (el.shape === "graph" || (el.shape === "field" && el.axesId)) obj.set({ perPixelTargetFind: true });
  }
  if (el.shape === "dot" && obj.shapePts?.nm) {
    // 点の名前: オレンジの丸をドラッグして、好きな所に置く（位置は「自由」になる）
    obj.controls = { ...obj.controls, nm: handle("nm", "move") };
  }
  if (el.shape === "line" || (el.shape === "brace" && el.mode === "points")) {
    obj.controls = { p1: handle("p1", "crosshair"), p2: handle("p2", "crosshair") };
    // 線の膨らみ: 真ん中のオレンジの丸をドラッグして曲げる（まっすぐな線は、線の真ん中に出る）
    if (el.shape === "line") obj.controls.bulge = handle("bulge", "pointer");
    obj.set({ lockScalingX: true, lockScalingY: true, lockRotation: true });
  } else if (el.shape === "balloon") {
    const hasContents = (el.contentIds ?? []).length > 0;
    obj.controls = hasContents ? {} : { ...obj.controls };
    if (!hasContents) obj.setControlsVisibility({ mtr: false });
    if (obj.shapePts?.tail) obj.controls.tail = handle("tail", "crosshair");
    obj.set({ lockRotation: true, lockScalingX: hasContents, lockScalingY: hasContents, lockMovementX: hasContents, lockMovementY: hasContents });
  }
}

// ---- 線の端・吹き出しの尾のドラッグ（ほかの要素の点に吸い付く。Alt で吸い付かない。Shift で 15° 刻み）----
let pointDrag = null;

function snapCandidates(exceptId) {
  const pts = [];
  for (const o of canvas.getObjects()) {
    if (!o.elId || o.elId === exceptId || !o.visible) continue;
    const c = o.getCoords();
    pts.push(absPt(o, "origin"), ...c);
    for (let i = 0; i < 4; i++) pts.push(new (fab().Point)((c[i].x + c[(i + 1) % 4].x) / 2, (c[i].y + c[(i + 1) % 4].y) / 2));
    if (o.shapePts?.p1) pts.push(absPt(o, "p1"), absPt(o, "p2"));
  }
  return pts;
}

function dragPoint(obj, name, x, y, e) {
  const f = fab();
  const el = findElement(obj.elId);
  if (!el) return;
  if (name === "frame") {
    // ズームの拡大する所: その場で動かす（Shift で水平・垂直）
    if (!pointDrag) pointDrag = { el, obj, name, start: { x: el.frameX, y: el.frameY }, pt: null };
    let p = new f.Point(x, y);
    if (e.shiftKey) { const o = pointDrag.start; p = Math.abs(p.x - o.x) > Math.abs(p.y - o.y) ? new f.Point(p.x, o.y) : new f.Point(o.x, p.y); }
    el.frameX = round1(p.x); el.frameY = round1(p.y);
    obj.shapePts = { frame: [obj.width / 2 + (el.frameX - el.x), obj.height / 2 + (el.frameY - el.y)] };
    pointDrag.pt = p;
    canvas.requestRenderAll();
    return;
  }
  if (name === "bulge") { dragBulge(obj, el, x, y, e); return; }
  if (!pointDrag) {
    const other = name === "p1" ? absPt(obj, "p2") : name === "p2" ? absPt(obj, "p1")
      : ["xl", "yl", "nm"].includes(name) || /^n\d+$/.test(name) ? absPt(obj, name) : new f.Point(el.x, el.y);
    pointDrag = { el, obj, name, other, cands: snapCandidates(el.id), guide: null, pt: null };
  }
  let p = new f.Point(x, y);
  const z = canvas.viewportTransform[0];
  const isLabel = name === "xl" || name === "yl" || name === "nm" || /^n\d+$/.test(name); // 軸ラベル・グラフの頂点は吸い付かせない（Shift で水平・垂直に）
  if (isLabel) {
    if (e.shiftKey) {
      const o = pointDrag.other;
      p = Math.abs(p.x - o.x) > Math.abs(p.y - o.y) ? new f.Point(p.x, o.y) : new f.Point(o.x, p.y);
    }
  } else if (e.shiftKey && name !== "tail") {
    // 角度を 15° 刻みに
    const o = pointDrag.other, a = Math.atan2(p.y - o.y, p.x - o.x), r = Math.hypot(p.x - o.x, p.y - o.y);
    const q = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    p = new f.Point(o.x + r * Math.cos(q), o.y + r * Math.sin(q));
  } else if (!e.altKey) {
    let best = null, bd = 10 / z;
    for (const c of pointDrag.cands) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) p = new f.Point(best.x, best.y);
    else {
      // ほかの要素の点に吸い付かないときは、グリッド・ガイド線に（「表示 ▾」の設定）
      const q = snapPoint(p.x, p.y, e.altKey);
      if (q) p = new f.Point(q.x, q.y);
    }
  }
  pointDrag.pt = p;
  const o = pointDrag.other;
  if (!pointDrag.guide) {
    pointDrag.guide = new f.Line([o.x, o.y, p.x, p.y], { stroke: "#3554d1", strokeWidth: 2 / z, strokeDashArray: [8 / z, 6 / z], selectable: false, evented: false, excludeFromExport: true });
    canvas.add(pointDrag.guide);
  } else pointDrag.guide.set({ x1: o.x, y1: o.y, x2: p.x, y2: p.y });
  canvas.requestRenderAll();
}

// ---- 線の膨らみ（arcAngle）。ArcBetweenPoints は、角度が正なら始点→終点の向きの右（Manim の座標）に膨らむ ----

/** 線の弧の真ん中の点（キャンバスの座標）。 */
function bulgePt(obj) {
  const el = findElement(obj.elId);
  const a = absPt(obj, "p1"), b = absPt(obj, "p2");
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const th = (Number(el?.arcAngle) || 0) * Math.PI / 180;
  const h = (L / 2) * Math.tan(th / 4);
  return new (fab().Point)((a.x + b.x) / 2 + (-dy / L) * h, (a.y + b.y) / 2 + (dx / L) * h);
}

/** 弧の真ん中の点 q から、曲げる角度（度）。 */
function bulgeAngle(a, b, q) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const h = ((q.x - (a.x + b.x) / 2) * (-dy / L) + (q.y - (a.y + b.y) / 2) * (dx / L));
  return 4 * Math.atan(2 * h / L) * 180 / Math.PI;
}

function dragBulge(obj, el, x, y, e) {
  const f = fab();
  if (!pointDrag) pointDrag = { el, obj, name: "bulge", a: absPt(obj, "p1"), b: absPt(obj, "p2"), guide: null, angle: Number(el.arcAngle) || 0 };
  const { a, b } = pointDrag;
  let ang = bulgeAngle(a, b, { x, y });
  ang = e.altKey ? Math.round(ang) : Math.round(ang / 5) * 5; // 5° 刻み（Alt で 1° 刻み）
  ang = Math.max(-355, Math.min(355, ang));
  pointDrag.angle = ang;
  // 弧の形の目安（点線）
  const z = canvas.viewportTransform[0];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  let d;
  if (Math.abs(ang) < 0.5) d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  else {
    const r = L / (2 * Math.abs(Math.sin(ang * Math.PI / 360)));
    // 正の角度は始点→終点の右に膨らむ。SVG（y が下向き）の sweep=1 は画面で時計回りで、左→右なら上を通るので、正は sweep=0
    d = `M ${a.x} ${a.y} A ${r} ${r} 0 ${Math.abs(ang) > 180 ? 1 : 0} ${ang > 0 ? 0 : 1} ${b.x} ${b.y}`;
  }
  if (pointDrag.guide) canvas.remove(pointDrag.guide);
  pointDrag.guide = new f.Path(d, { fill: "", stroke: "#f2a900", strokeWidth: 2 / z, strokeDashArray: [8 / z, 6 / z], selectable: false, evented: false, excludeFromExport: true });
  canvas.add(pointDrag.guide);
  showDragHint(`${ang}°`);
  canvas.requestRenderAll();
}

function showDragHint(text) {
  let h = document.getElementById("drag-hint");
  if (!h) { h = document.createElement("div"); h.id = "drag-hint"; h.className = "drag-hint"; document.body.appendChild(h); }
  h.textContent = text;
  h.hidden = false;
}

function finishPointDrag() {
  const d = pointDrag;
  pointDrag = null;
  if (!d) return;
  if (d.guide) canvas.remove(d.guide);
  if (d.name === "bulge") {
    const h = document.getElementById("drag-hint");
    if (h) h.hidden = true;
    if (d.angle === (Number(d.el.arcAngle) || 0)) return;
    d.el.arcAngle = d.angle;
    markDirty("prop");
    emit("slide-changed");
    refreshElement(d.el).then(() => { emit("element-resized", [d.el]); emit("selection", store.selectedId); });
    return;
  }
  if (!d.pt) return;
  const el = d.el, p = d.pt, o = d.other;
  if (d.name === "frame") {
    markDirty("move");
    emit("slide-changed");
    emit("element-resized", [el]);
    return;
  }
  if (/^n\d+$/.test(d.name)) {
    // グラフの頂点: 動かした分を、その頂点の位置（Manim の単位、上が正）に足す
    const P = store.meta.canvas.h / 8, v = el.vertices?.[Number(d.name.slice(1))];
    if (v) {
      const cur = el.positions?.[v.name] ?? d.obj.layoutPos?.[v.name] ?? [0, 0];
      el.positions = { ...(el.positions ?? {}), [v.name]: [Math.round((cur[0] + (p.x - o.x) / P) * 1000) / 1000, Math.round((cur[1] - (p.y - o.y) / P) * 1000) / 1000] };
    }
  } else if (d.name === "nm") {
    // 点の名前: 点の中心からのずれ（Manim の単位、上が正）。位置は「自由」にする
    const P = store.meta.canvas.h / 8;
    const c = absPt(d.obj, "origin"), q = absPt(d.obj, "nm");
    const cur = [(q.x - c.x) / P, -(q.y - c.y) / P];
    el.pnameShift = [Math.round((cur[0] + (p.x - o.x) / P) * 1000) / 1000, Math.round((cur[1] - (p.y - o.y) / P) * 1000) / 1000];
    el.pnamePos = "free";
  } else if (d.name === "xl" || d.name === "yl") {
    // 既定の位置からのずれ（Manim の単位、上が正）に、動かした分を足す
    const P = store.meta.canvas.h / 8, k = d.name === "xl" ? "xLabelShift" : "yLabelShift";
    const cur = el[k] ?? [0, 0];
    el[k] = [Math.round((cur[0] + (p.x - o.x) / P) * 1000) / 1000, Math.round((cur[1] - (p.y - o.y) / P) * 1000) / 1000];
  } else if (d.name === "tail") {
    // 尾の先は、吹き出しの向きでの位置として持つ（吹き出しを回すと、尾も一緒に回る）
    const phi = -(Number(el.rotation) || 0) * Math.PI / 180, c = Math.cos(phi), sn = Math.sin(phi);
    const dx = p.x - el.x, dy = p.y - el.y;
    el.tail = { dx: round1(dx * c + dy * sn), dy: round1(-dx * sn + dy * c) };
  } else {
    const p1 = d.name === "p1" ? p : o, p2 = d.name === "p2" ? p : o;
    el.x = round1((p1.x + p2.x) / 2); el.y = round1((p1.y + p2.y) / 2);
    el.dx = round1((p2.x - p1.x) / 2); el.dy = round1((p2.y - p1.y) / 2);
  }
  markDirty("move");
  emit("element-moved", el);
  emit("slide-changed");
  refreshElement(el).then(() => emit("element-resized", [el]));
}

/** 要素の見た目の幅（キャンバスの px、プレビューの余白を除く）。 */
export function objectWidth(id) {
  const o = canvas?.getObjects().find((x) => x.elId === id);
  if (!o) return 0;
  const xs = tightCorners(o).map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

/** 要素の見た目の高さ（キャンバスの px、プレビューの余白を除く）。phi を渡すと、その向きで測る。 */
export function objectHeight(id, phi = 0) {
  const o = canvas?.getObjects().find((x) => x.elId === id);
  if (!o) return 0;
  // phi（Fabric の角度、ラジアン）の向きで測った高さ
  const ys = tightCorners(o).map((p) => -p.x * Math.sin(phi) + p.y * Math.cos(phi));
  return Math.max(...ys) - Math.min(...ys);
}


// ---------------------------------------------------------------- 中かっこ・グラフの補助

/** 中かっこを付ける要素の外接矩形（字面）。要素がキャンバスに無いときは前回の値。 */
function braceBox(el, forThumbnail = false) {
  const o = forThumbnail || !canvas ? null : canvas.getObjects().find((x) => x.elId === el.targetId);
  if (o) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of tightCorners(o)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    el.x = round1((x0 + x1) / 2); el.y = round1((y0 + y1) / 2);
    el.width = round1(x1 - x0); el.height = round1(y1 - y0);
  }
  return { w: Number(el.width) || 100, h: Number(el.height) || 40 };
}

/** 中かっこのラベルを、かっこの先に置いて 1 つのオブジェクトにまとめる（Manim の put_at_tip と同じ置き方）。 */
async function composeBraceLabel(braceObj, el, r) {
  const f = fab();
  const color = el.labelColor || el.fill?.color || el.stroke?.color || "#222222";
  let img = null, inset = 0;
  if (el.labelKind === "text") {
    const t = await renderTextPreview({
      runs: [{ t: el.label }], text: el.label, font: el.labelFont || store.project.settings.defaultFont, fontSize: el.labelSize, color,
      opacity: 1, align: "left", letterSpacing: 0, lineSpacing: 1, vertical: false, arc: 0,
      outline: { mode: "none", width: 0.06, color: null }, box: { on: false, color: "#FFFFFF", opacity: 1, padding: 0.3, radius: 0.2, follow: true },
    });
    if (t.url) { img = t; inset = t.margin || 0; }
  } else {
    img = await renderMath(previewLatex(el.label, "center"), fontPx({ fontSize: el.labelSize }, "math"), color);
  }
  if (!img?.url) return braceObj;
  const im = new Image();
  im.src = img.url;
  try { await im.decode(); } catch { /* 空の画像 */ }
  // かっこを、基準点を位置に合わせて置く
  braceObj.set({ originX: braceObj.shapePts.origin[0] / braceObj.width, originY: braceObj.shapePts.origin[1] / braceObj.height, left: Number(el.x), top: Number(el.y) });
  braceObj.setCoords();
  const tip = absPt(braceObj, "tip");
  const d = r.tipDir ?? [0, -1]; // Manim の向き（上が正）を丸めたもの
  const buff = 0.25 * store.meta.canvas.h / 8; // Manim の既定の間隔（DEFAULT_MOBJECT_TO_MOBJECT_BUFFER）
  const w = img.width - 2 * inset, h = img.height - 2 * inset;
  const cx = tip.x + d[0] * (buff + w / 2), cy = tip.y - d[1] * (buff + h / 2);
  const label = new f.FabricImage(im, { width: img.width, height: img.height, left: cx, top: cy, originX: "center", originY: "center" });
  const pts = { origin: [el.x, el.y], tip: [tip.x, tip.y] };
  if (braceObj.shapePts.p1) { const a = absPt(braceObj, "p1"), b = absPt(braceObj, "p2"); pts.p1 = [a.x, a.y]; pts.p2 = [b.x, b.y]; }
  const g = new f.Group([braceObj, label]);
  // まとめたオブジェクトの中での位置（px）に直す
  const c = g.getCenterPoint(), x0 = c.x - g.width / 2, y0 = c.y - g.height / 2;
  g.shapePts = Object.fromEntries(Object.entries(pts).map(([k, [x, y]]) => [k, [x - x0, y - y0]]));
  g.inset = 0;
  return g;
}

/** 要素のキャンバス上のオブジェクト（プレビューの誤りなどを見るため）。 */
export const fabricObjectOf = (id) => canvas?.getObjects().find((o) => o.elId === id) ?? null;
