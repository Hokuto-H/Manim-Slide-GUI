// 図形のプロパティパネル（形・大きさ・線・塗り・吹き出しの中身）。props.js から呼ぶ。

import { editingPathId, refit, startNodeEdit, stopNodeEdit } from "./pathtools.js";
import { addAxDot, addBalloonContent, addField, addGraph, addGraphPart, addOnAxes, addLineGraph, addTo3dAxes, addVector, angleCcw, angleGeom, angleIsReflex, defaultPolyShape, removeBalloonContent, shapeLabel } from "./shapes.js";
import { fabricObjectOf, refreshElement } from "./canvas.js";
import { statchartFields } from "./statprops.js";
import { confirmCodeLineShift } from "./codelines.js";
import { partFields } from "./parts.js";
import { select } from "./selection.js";
import { pickImageFiles, replaceImage } from "./images.js";
import { KINDS, labelList, refPlan, theoremStyles } from "./refs.js";
import { braceToPoints, cellItemOk, ensureItems, currentSlide, escapeHtml, findElement, fontOptionsHtml, fromManim, emit, markDirty, normalizeHex, on, store, toManim, toast, uid } from "./store.js";

const P = () => store.meta.canvas.h / 8; // Manim の 1 単位のキャンバスでの px
const r2 = (v) => Math.round(v * 100) / 100;
const num = (k, v, { step = "any", min = "", max = "" } = {}) => `<input type="number" class="num" data-k="${k}" step="${step}" min="${min}" max="${max}" value="${v}">`;

/** 色の選択（null = 線と同じ色）。 */
function colorInput(k, value) {
  const v = value || "#000000";
  return `<input type="color" data-k="${k}" value="${v.toLowerCase()}"><input class="hex" data-k="${k}-hex" value="${value || ""}" maxlength="7" spellcheck="false" placeholder="#RRGGBB">`;
}

function bindColor(root, k, get, set) {
  const pick = root.querySelector(`[data-k=${k}]`), hex = root.querySelector(`[data-k=${k}-hex]`);
  pick.addEventListener("input", () => { set(pick.value.toUpperCase()); hex.value = pick.value.toUpperCase(); });
  hex.addEventListener("change", () => {
    const h = normalizeHex(hex.value);
    if (!h) { hex.value = get() || ""; return; }
    set(h); hex.value = h; pick.value = h.toLowerCase();
  });
}

export function shapeFields(sec, el, { field, changed }) {
  sec.querySelector("h3").textContent = `${shapeLabel(el)}（${el.shape === "balloon" ? "吹き出し" : "図形"}）`;
  const u = P();
  const add = (label, html, opts) => { const f = field(label, html, opts); sec.appendChild(f); return f; };
  // 形を作れなかったとき（式の誤り・使えない配置など）は、パネルのいちばん上に理由を出す（作り直すたびに更新）
  const perr = document.createElement("p");
  perr.className = "preview-error";
  sec.querySelector("h3").after(perr);
  const showErr = () => {
    const msg = fabricObjectOf(el.id)?.previewError || "";
    perr.hidden = !msg;
    perr.textContent = msg ? `形を作れませんでした: ${msg.replace(/^(ValueError|式): /, "")}` : "";
  };
  showErr();
  const offErr = on("element-rendered", ({ el: r }) => { if (!document.body.contains(perr)) return offErr(); if (r?.id === el.id) showErr(); });

  if (el.shape === "line") {
    const pts = () => {
      const a = toManim(el.x - el.dx, el.y - el.dy), b = toManim(el.x + el.dx, el.y + el.dy);
      return [a, b];
    };
    const [a, b] = pts();
    const f = add("両端", `<div class="row"><span class="unit">始点 x</span>${num("ax", r2(a[0]), { step: 0.1 })}<span class="unit">y</span>${num("ay", r2(a[1]), { step: 0.1 })}</div>
      <div class="row"><span class="unit">終点 x</span>${num("bx", r2(b[0]), { step: 0.1 })}<span class="unit">y</span>${num("by", r2(b[1]), { step: 0.1 })}</div>
      <div class="field-note">キャンバスでは両端の丸をドラッグします（ほかの要素の端や中心に吸い付きます。Alt で吸い付かない、Shift で 15° 刻み）。</div>`, { top: true });
    const q = (k) => f.querySelector(`[data-k=${k}]`);
    const apply = () => {
      const [x1, y1] = fromManim(Number(q("ax").value), Number(q("ay").value));
      const [x2, y2] = fromManim(Number(q("bx").value), Number(q("by").value));
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;
      el.x = (x1 + x2) / 2; el.y = (y1 + y2) / 2; el.dx = (x2 - x1) / 2; el.dy = (y2 - y1) / 2;
      changed(el);
    };
    ["ax", "ay", "bx", "by"].forEach((k) => q(k).addEventListener("change", apply));
    const off = on("element-moved", (m) => {
      if (!document.body.contains(f)) return off();
      if (m.id !== el.id) return;
      const [c, d] = pts();
      q("ax").value = r2(c[0]); q("ay").value = r2(c[1]); q("bx").value = r2(d[0]); q("by").value = r2(d[1]);
    });
    const ft = add("矢じり", `<label class="row"><input type="checkbox" data-k="st" ${el.startTip ? "checked" : ""}> 始点</label>
      <label class="row"><input type="checkbox" data-k="et" ${el.endTip ? "checked" : ""}> 終点</label>
      <div class="row"><span class="unit">大きさ</span>${num("ts", el.tipSize ?? 0.25, { step: 0.05, min: 0.02 })}<span class="unit">形</span><select data-k="tsh">${TIP_SHAPES.map(([v, t]) => `<option value="${v}" ${v === (el.tipShape ?? "triangle") ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <label class="row"><input type="checkbox" data-k="tsc" ${el.tipScale ? "checked" : ""}> 短い線では矢じりも小さく（Arrow と同じ）</label>`);
    ft.querySelector("[data-k=tsh]").addEventListener("change", (e) => { el.tipShape = e.target.value; changed(el); });
    ft.querySelector("[data-k=tsc]").addEventListener("change", (e) => { el.tipScale = e.target.checked; changed(el); });
    ft.querySelector("[data-k=st]").addEventListener("change", (e) => { el.startTip = e.target.checked; changed(el); });
    ft.querySelector("[data-k=et]").addEventListener("change", (e) => { el.endTip = e.target.checked; changed(el); });
    ft.querySelector("[data-k=ts]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.tipSize = v; changed(el); } });
    const fb = add("曲げる", `<div class="row"><input type="range" min="-355" max="355" step="5" data-k="arc" value="${el.arcAngle ?? 0}"><output>${el.arcAngle ?? 0}°</output></div>
      <div class="field-note">0° で真っすぐ。0° 以外で両端を結ぶ弧になります（ArcBetweenPoints。矢じりを付けると CurvedArrow）。正の角度で、始点から終点へ進む向きの右側に、負の角度で左側に膨らみます。キャンバスでは、線の真ん中のオレンジの丸をドラッグして曲げられます（5° 刻み。Alt で 1° 刻み）。曲げた線には角の印を付けられません。</div>`);
    const ar = fb.querySelector("[data-k=arc]"), ao = fb.querySelector("output");
    ar.addEventListener("input", () => { ao.textContent = `${ar.value}°`; });
    ar.addEventListener("change", () => { el.arcAngle = Number(ar.value); changed(el); });
    labelFields(el, add, changed, true);
  }

  if (["rect", "ellipse", "polygon", "star"].includes(el.shape)) {
    const f = add("大きさ", `<div class="row"><span class="unit">幅</span>${num("w", r2(el.width / u), { step: 0.1, min: 0.01 })}<span class="unit">高さ</span>${num("h", r2(el.height / u), { step: 0.1, min: 0.01 })}</div>
      <label class="row"><input type="checkbox" data-k="keep" ${el.keepAspect ? "checked" : ""}> 縦横比を固定</label>
      <div class="field-note">Manim の単位。キャンバスでは角のハンドルで${el.keepAspect ? "" : "、辺の中央のハンドルで横だけ・縦だけ"}変えます。</div>`, { top: true });
    const iw = f.querySelector("[data-k=w]"), ih = f.querySelector("[data-k=h]"), keep = f.querySelector("[data-k=keep]");
    iw.addEventListener("change", () => {
      const w = Number(iw.value) * u;
      if (!(w > 0)) return;
      if (keep.checked) el.height *= w / el.width;
      el.width = w; ih.value = r2(el.height / u); changed(el);
    });
    ih.addEventListener("change", () => {
      const h = Number(ih.value) * u;
      if (!(h > 0)) return;
      if (keep.checked) el.width *= h / el.height;
      el.height = h; iw.value = r2(el.width / u); changed(el);
    });
    keep.addEventListener("change", () => { el.keepAspect = keep.checked; changed(el); });
    on("element-resized", (els) => { if (els.includes(el) && document.body.contains(iw)) { iw.value = r2(el.width / u); ih.value = r2(el.height / u); } });
    if (el.shape === "rect") {
      const fr = add("角丸", `<div class="row">${num("cr", el.cornerRadius ?? 0, { step: 0.05, min: 0 })}<span class="unit">（0 で角張った長方形）</span></div>`);
      fr.querySelector("input").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.cornerRadius = v; changed(el); } });
    }
    if (el.shape === "polygon" || el.shape === "star") {
      const fs = add(el.shape === "star" ? "角" : "辺の数", `<div class="row">${num("n", el.sides, { step: 1, min: 3, max: 64 })}</div>`);
      fs.querySelector("input").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 3) { el.sides = v; changed(el); } });
    }
    if (el.shape === "polygon") {
      const fe = add("辺の膨らみ", `<div class="row"><input type="range" min="-180" max="180" step="5" data-k="ea" value="${el.edgeArc ?? 0}"><output>${el.edgeArc ?? 0}°</output></div>
        <div class="field-note">0° 以外で、辺を弧にします（ArcPolygon）。正で外側、負で内側に膨らみます。正三角形で 60° にするとルーローの三角形です。</div>`);
      const ea = fe.querySelector("[data-k=ea]"), eo = fe.querySelector("output");
      ea.addEventListener("input", () => { eo.textContent = `${ea.value}°`; });
      ea.addEventListener("change", () => { el.edgeArc = Number(ea.value); changed(el); });
    }
    if (el.shape === "star") {
      const maxD = Math.max(1, Math.floor((el.sides - 1) / 2));
      const fg = add("描き方", `<div class="seg" data-k="pg"><button type="button" data-v="star">輪郭（Star）</button><button type="button" data-v="gram">頂点を結ぶ線（RegularPolygram）</button></div>
        <div class="row" ${el.polygram ? "" : "hidden"}><span class="unit">いくつおきに結ぶか</span>${num("den", Math.min(el.density ?? 2, maxD), { step: 1, min: 1, max: maxD })}</div>
        <div class="field-note">頂点を結ぶ線は、線が交差する星形（五芒星など）です。1 で正多角形、角の数と割り切れる数では、いくつかの多角形が重なります。</div>`);
      bindSeg(fg, "pg", () => (el.polygram ? "gram" : "star"), (v) => { el.polygram = v === "gram"; if (el.polygram && !el.density) el.density = 2; changed(el); reselect(el); });
      fg.querySelector("[data-k=den]").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= maxD) { el.density = v; changed(el); } });
    }
    if (el.shape === "star" && !el.polygram) {
      const fi = add("へこみ", `<div class="row"><input type="range" min="5" max="95" step="5" value="${Math.round((el.innerRatio ?? 0.45) * 100)}"><output>${Math.round((el.innerRatio ?? 0.45) * 100)}%</output></div><div class="field-note">内側の頂点の、外側に対する半径の割合。</div>`);
      const rg = fi.querySelector("input"), out = fi.querySelector("output");
      rg.addEventListener("input", () => { el.innerRatio = Number(rg.value) / 100; out.textContent = `${rg.value}%`; changed(el); });
    }
  }

  if (["rect", "ellipse", "polygon", "star"].includes(el.shape) || (el.shape === "path" && el.closed)) labelFields(el, add, changed, "shape");
  if (el.shape === "arc" || el.shape === "dot") {
    const f = add("半径", `<div class="row">${num("r", r2(el.radius / u), { step: 0.05, min: 0.01 })}<span class="unit">Manim の単位</span></div>`);
    const ir = f.querySelector("input");
    ir.addEventListener("change", () => { const v = Number(ir.value) * u; if (v > 0) { el.radius = v; changed(el); } });
    on("element-resized", (els) => { if (els.includes(el) && document.body.contains(ir)) ir.value = r2(el.radius / u); });
  }
  if (el.shape === "arc") {
    const f = add("角度", `<div class="row"><span class="unit">開始</span>${num("a0", el.startAngle ?? 0, { step: 5 })}<span class="unit">°</span><span class="unit">広がり</span>${num("da", el.angle ?? 90, { step: 5, min: -360, max: 360 })}<span class="unit">°</span></div>
      <label class="row"><input type="checkbox" data-k="sector" ${el.sector ? "checked" : ""}> 扇形にする（中心まで閉じて塗る）</label>
      <div class="field-note">右（x 軸の正の向き）が 0°、反時計回りが正。</div>`);
    f.querySelector("[data-k=a0]").addEventListener("change", (e) => { el.startAngle = Number(e.target.value) || 0; changed(el); });
    f.querySelector("[data-k=da]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== 0) { el.angle = v; changed(el); } });
    f.querySelector("[data-k=sector]").addEventListener("change", (e) => {
      el.sector = e.target.checked;
      if (el.sector && !(el.fill?.opacity > 0)) el.fill = { ...(el.fill ?? {}), opacity: 0.5 };
      changed(el);
    });
  }

  if (el.shape === "dot") {
    const fr = add("輪", `<label class="row"><input type="checkbox" data-k="ring" ${el.ring ? "checked" : ""}> 輪を付ける（AnnotationDot）</label>
      <div class="field-note">点の周りに輪（線の色・太さ）を付けます。背景と同じ色の輪にすると、重なった線から点を浮かせられます。</div>`);
    fr.querySelector("[data-k=ring]").addEventListener("change", (e) => {
      el.ring = e.target.checked;
      if (el.ring && !(el.stroke.width > 0)) el.stroke.width = 5;
      changed(el); reselect(el);
    });
    if (el.onCircle) onCircleFields(el, add, changed);
    labelFields(el, add, changed, false);
    pointNameFields(el, add, changed);
  }
  if (el.shape === "elbow") {
    const f = add("大きさ", `<div class="row">${num("r", r2(el.radius / u), { step: 0.05, min: 0.01 })}<span class="unit">Manim の単位（一辺の長さ）</span></div><div class="field-note">向きは「回転」で変えます。2 本の線の間に付ける直角の印は「直角の印（2 本の線）」を使います。</div>`, { top: true });
    f.querySelector("input").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.radius = v; changed(el); } });
  }
  if (el.shape === "annulus") {
    const f = add("半径", `<div class="row"><span class="unit">外側</span>${num("ro", r2(el.radius / u), { step: 0.05, min: 0.01 })}<span class="unit">内側</span>${num("ri", r2(el.innerRadius / u), { step: 0.05, min: 0 })}</div>
      <label class="row"><input type="checkbox" data-k="sector" ${el.sector ? "checked" : ""}> 扇形にする（AnnularSector）</label>
      <div class="row" ${el.sector ? "" : "hidden"}><span class="unit">開始</span>${num("a0", el.startAngle ?? 0, { step: 5 })}<span class="unit">°</span><span class="unit">広がり</span>${num("da", el.angle ?? 90, { step: 5, min: -360, max: 360 })}<span class="unit">°</span></div>
      <div class="field-note">Manim の単位。角度は右が 0°、反時計回りが正。</div>`, { top: true });
    const q = (k) => f.querySelector(`[data-k=${k}]`);
    q("ro").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.radius = v; el.innerRadius = Math.min(el.innerRadius, v * 0.99); changed(el); } });
    q("ri").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v >= 0) { el.innerRadius = Math.min(v, el.radius * 0.99); changed(el); } });
    q("sector").addEventListener("change", (e) => { el.sector = e.target.checked; changed(el); reselect(el); });
    q("a0").addEventListener("change", (e) => { el.startAngle = Number(e.target.value) || 0; changed(el); });
    q("da").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== 0) { el.angle = v; changed(el); } });
    on("element-resized", (els) => { if (els.includes(el) && document.body.contains(f)) { q("ro").value = r2(el.radius / u); q("ri").value = r2(el.innerRadius / u); } });
  }
  if (el.shape === "samplespace") return samplespaceFields(sec, el, add, changed);
  if (el.shape === "netgraph") return netgraphFields(sec, el, add, changed);
  if (el.shape === "annot") return annotFields(sec, el, add, changed);
  if (el.shape === "vector") return vectorFields(sec, el, add, changed);
  if (el.shape === "linegraph") return linegraphFields(sec, el, add, changed);
  if (el.shape === "points") return pointsFields(sec, el, add, changed);
  if (el.shape === "trace") return traceFields(sec, el, add, changed);
  if (el.shape === "part") return partFields(sec, el, add, changed);
  if (el.shape === "zoom") return zoomFields(sec, el, add, changed);
  if (el.shape === "fcurve") return fcurveFields(sec, el, add, changed);
  if (el.shape === "tangent") return tangentFields(sec, el, add, changed);
  if (el.shape === "code") return codeFields(sec, el, add, changed);
  if (el.shape === "barchart") return barchartFields(sec, el, add, changed);
  if (el.shape === "statchart") return statchartFields(sec, el, add, changed);
  if (el.shape === "theorem") return theoremFields(sec, el, add, changed);
  if (["tex", "title", "bullets"].includes(el.shape)) return texFields(sec, el, add, changed);
  if (el.shape === "boolean") booleanFields(sec, el, add, changed);
  if (el.shape === "path") pathFields(sec, el, add, changed);
  if (el.shape === "axes") axesFields(sec, el, add, changed);
  if (el.shape === "graph") graphFields(sec, el, add, changed);
  if (el.shape === "brace") braceFields(sec, el, add, changed);
  if (el.shape === "table") tableFields(sec, el, add, changed);
  if (el.shape === "field") fieldFields(sec, el, add, changed);
  if (el.shape === "svg") return svgFields(sec, el, add, changed);
  if (el.shape === "matrix") return matrixFields(sec, el, add, changed);
  if (el.shape === "angle") return angleFields(sec, el, add, changed);
  if (el.shape === "graphpart") return graphPartFields(sec, el, add, changed);
  if (el.shape === "curve2d" || el.shape === "implicit") return curve2dFields(sec, el, add, changed);
  if (el.shape === "number") numberFields(sec, el, add, changed);
  if (["solid", "axes3d", "surface", "curve3d", "point3d"].includes(el.shape)) return fields3d(sec, el, add, changed);
  if (el.shape === "axdot") axdotFields(sec, el, add, changed);
  if (el.shape === "balloon") balloonFields(sec, el, add, changed);
  styleFields(sec, el, add, changed);
}

function pathFields(sec, el, add, changed) {
  const nPts = (el.paths ?? []).reduce((a, sp) => a + sp.length, 0);
  const editing = editingPathId() === el.id;
  const f = add("点", `<div class="row"><span class="unit">${(el.paths ?? []).length} 本の線・${nPts} 個の点</span></div>
    <div class="row"><button type="button" class="small ${editing ? "primary" : ""}" data-a="edit">${editing ? "点の編集を終える" : "点を編集"}</button></div>
    <label class="row"><input type="checkbox" data-k="closed" ${el.closed ? "checked" : ""}> 線を閉じる（最後の点から最初の点へつなぐ）</label>
    <div class="field-note">キャンバスでダブルクリックしても点を編集できます。描画で <code>Create</code> を使うと、${el.source === "freehand" ? "描いた順に1筆ずつ" : "最初の点から順に"}描かれます。</div>`, { top: true });
  f.querySelector("[data-a=edit]").addEventListener("click", () => (editingPathId() === el.id ? stopNodeEdit() : startNodeEdit(el)));
  f.querySelector("[data-k=closed]").addEventListener("change", (e) => {
    el.closed = e.target.checked;
    if (el.closed) {
      // 最後の点が最初の点とほぼ同じ所にあるときは、1 つにまとめる（ごく短い「閉じる線」が、取っ手で大きく曲がらないように）
      for (const sp of el.paths ?? []) {
        if (sp.length < 3) continue;
        const a = sp[0], z = sp[sp.length - 1];
        if (Math.hypot(a[0] - z[0], a[1] - z[1]) <= 10) { a[2] = z[2]; a[3] = z[3]; sp.pop(); }
      }
    }
    changed(el);
  });
  if (el.raw?.length) {
    const tol = el.smooth ?? 4;
    const fs = add("なめらかさ", `<div class="row"><input type="range" min="1" max="20" step="0.5" value="${tol}"><output>${tol}</output></div><div class="field-note">大きいほど点が少なく、なめらかになります（手で描いた形からのずれの許容、px）。点を手で直すと、この調整はできなくなります。</div>`);
    const rg = fs.querySelector("input"), out = fs.querySelector("output");
    rg.addEventListener("input", () => { out.textContent = rg.value; if (refit(el, Number(rg.value))) changed(el); });
  }
}

function balloonFields(sec, el, add, changed) {
  const fs = add("形", `<div class="seg" data-k="bshape"><button type="button" data-v="rect" class="${el.balloonShape !== "ellipse" ? "on" : ""}">角丸</button><button type="button" data-v="ellipse" class="${el.balloonShape === "ellipse" ? "on" : ""}">楕円</button></div>`);
  fs.querySelector("[data-k=bshape]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    el.balloonShape = b.dataset.v;
    fs.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
    changed(el);
  });
  // 中身
  const items = (el.contentIds ?? []).map((id) => findElement(id)).filter(Boolean);
  const fc = add("中身", `<ul class="content-list">${items.map((c) => `<li><button type="button" class="link" data-pick="${c.id}">${escapeHtml(c.var)}</button><span class="grow hint">${escapeHtml(c.type === "math" ? c.latex : c.text || "")}</span><button type="button" class="small" data-out="${c.id}" title="吹き出しから外す（要素は残ります）">外す</button></li>`).join("") || `<li class="hint">（中身はありません）</li>`}</ul>
    <div class="row"><button type="button" class="small" data-add="text">＋テキスト</button><button type="button" class="small" data-add="math">＋数式</button></div>
    <div class="field-note">吹き出しは中身（テキスト・数式・画像など、いくつでも）を囲み、中身に合わせて伸び縮みします。ほかの要素を入れるには、その要素と吹き出しを選んで、右クリックの「吹き出しに入れる」を使います。中身はダブルクリックで選んで、自由に動かせます。</div>`, { top: true });
  fc.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => select(b.dataset.pick)));
  fc.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => removeBalloonContent(el, b.dataset.out)));
  fc.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addBalloonContent(el, b.dataset.add)));
  // 余白・角丸
  const fp = add("余白", `<div class="row"><span class="unit">左右</span>${num("px", el.padX ?? 0.3, { step: 0.05, min: 0 })}<span class="unit">上下</span>${num("py", el.padY ?? 0.2, { step: 0.05, min: 0 })}</div>
    <div class="row"><span class="unit">角丸</span>${num("cr", el.cornerRadius ?? 0.25, { step: 0.05, min: 0 })}</div>
    <div class="field-note">中身と吹き出しの縁の間（Manim の単位）。</div>`);
  fp.querySelector("[data-k=px]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.padX = v; changed(el); } });
  fp.querySelector("[data-k=py]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.padY = v; changed(el); } });
  fp.querySelector("[data-k=cr]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.cornerRadius = v; changed(el); } });
  // 尾
  const ft = add("尾", `<label class="row"><input type="checkbox" data-k="on" ${el.tail ? "checked" : ""}> 尾を付ける</label>
    <div class="row"><span class="unit">根元の幅</span>${num("tw", el.tailWidth ?? 0.4, { step: 0.05, min: 0.02 })}</div>
    <div class="field-note">尾の先（オレンジの丸）をドラッグして向きと長さを変えます。</div>`);
  ft.querySelector("[data-k=on]").addEventListener("change", (e) => {
    el.tail = e.target.checked ? (el.tailMemo ?? { dx: -140, dy: 150 }) : null;
    if (!e.target.checked) el.tailMemo = el.tail;
    changed(el);
  });
  ft.querySelector("[data-k=tw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.tailWidth = v; changed(el); } });
}

function styleFields(sec, el, add, changed) {
  const st = el.stroke ?? (el.stroke = { color: store.project.settings.defaultColor, width: 4, opacity: 1 });
  const fi = el.fill ?? (el.fill = { color: null, opacity: 0 });
  if (el.shape === "brace") {
    const f = add("色", `<div class="row">${colorInput("bc", fi.color || st.color)}</div>`);
    bindColor(f, "bc", () => fi.color || st.color, (v) => { fi.color = v; changed(el); });
    return;
  }
  if (el.shape === "number") return; // 色はパネルの「数値」の欄
  if (el.shape === "axdot") {
    const f = add("色", `<div class="row"><span class="unit">点</span>${colorInput("fc", fi.color || "#FC6255")}</div>
      <div class="row"><span class="unit">点線</span>${colorInput("sc", st.color)}</div>`, { top: true });
    bindColor(f, "fc", () => fi.color, (v) => { fi.color = v; changed(el); });
    bindColor(f, "sc", () => st.color, (v) => { st.color = v; changed(el); });
    return;
  }
  if (el.shape === "table" || el.shape === "field") {
    const f = add("線", `<div class="row">${colorInput("sc", st.color)}</div><div class="row"><span class="unit">太さ</span>${num("sw", st.width, { step: 0.5, min: 0 })}${el.shape === "field" ? `<span class="unit">不透明度</span><input type="range" data-k="so" min="0" max="100" step="5" value="${Math.round(st.opacity * 100)}">` : ""}</div>
      <div class="field-note">${el.shape === "table" ? "表の罫線の色と太さ（stroke_width）。" : "矢印・流線の色（「大きさで塗り分け」のときは使いません）と太さ（stroke_width）。"}</div>`, { top: true });
    bindColor(f, "sc", () => st.color, (v) => { st.color = v; changed(el); });
    f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { st.width = v; changed(el); } });
    f.querySelector("[data-k=so]")?.addEventListener("input", (e) => { st.opacity = Number(e.target.value) / 100; changed(el); });
    return;
  }
  if (el.shape === "axes") {
    const f = add("軸", `<div class="row">${colorInput("sc", st.color)}</div><div class="row"><span class="unit">太さ</span>${num("sw", st.width, { step: 0.5, min: 0 })}</div>
      <div class="field-note">軸・目盛り・数字・ラベルの色と、軸の線の太さ（stroke_width）。</div>`, { top: true });
    bindColor(f, "sc", () => st.color, (v) => { st.color = v; changed(el); });
    f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { st.width = v; changed(el); } });
    if (el.axesKind === "plane") {
      const g = add("方眼", `<div class="row">${colorInput("gc", el.gridColor)}</div><div class="row"><span class="unit">不透明度</span><input type="range" data-k="go" min="0" max="100" step="5" value="${Math.round((el.gridOpacity ?? 0.6) * 100)}"></div>`);
      bindColor(g, "gc", () => el.gridColor, (v) => { el.gridColor = v; changed(el); });
      g.querySelector("[data-k=go]").addEventListener("input", (e) => { el.gridOpacity = Number(e.target.value) / 100; changed(el); });
    }
    return;
  }
  if (el.shape !== "dot" || el.ring) {
    const f = add(el.shape === "dot" ? "輪" : "線", `<div class="row">${colorInput("sc", st.color)}</div>
      <div class="row"><span class="unit">太さ</span>${num("sw", st.width, { step: 0.5, min: 0 })}<span class="unit">不透明度</span><input type="range" data-k="so" min="0" max="100" step="5" value="${Math.round(st.opacity * 100)}"></div>
      ${["balloon", "dot"].includes(el.shape) ? "" : `<label class="row"><input type="checkbox" data-k="dash" ${el.dashed ? "checked" : ""}> 破線<span class="unit">長さ</span>${num("dl", el.dashLength ?? 0.15, { step: 0.05, min: 0.01 })}</label>`}
      <div class="field-note">太さは Manim の stroke_width（既定 4）。</div>`, { top: true });
    bindColor(f, "sc", () => st.color, (v) => { st.color = v; changed(el); });
    f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { st.width = v; changed(el); } });
    f.querySelector("[data-k=so]").addEventListener("input", (e) => { st.opacity = Number(e.target.value) / 100; changed(el); });
    f.querySelector("[data-k=dash]")?.addEventListener("change", (e) => { el.dashed = e.target.checked; changed(el); });
    f.querySelector("[data-k=dl]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.dashLength = v; changed(el); } });
    if (["line", "path", "arc", "graph"].includes(el.shape)) gradientFields(el, add, changed);
  }
  if (!["line", "graph", "elbow"].includes(el.shape) && !(el.shape === "arc" && !el.sector)) {
    const f = add("塗り", `<label class="row"><input type="checkbox" data-k="same" ${fi.color ? "" : "checked"}> 線と同じ色</label>
      <div class="row">${colorInput("fc", fi.color || st.color)}</div>
      <div class="row"><span class="unit">不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(fi.opacity * 100)}"><output>${Math.round(fi.opacity * 100)}%</output></div>
      <div class="field-note">不透明度 0% で塗らない。</div>`, { top: true });
    const same = f.querySelector("[data-k=same]");
    bindColor(f, "fc", () => fi.color, (v) => { fi.color = v; same.checked = false; changed(el); });
    same.addEventListener("change", () => { fi.color = same.checked ? null : (fi.color || st.color); changed(el); });
    const fo = f.querySelector("[data-k=fo]"), out = f.querySelector("output");
    fo.addEventListener("input", () => { fi.opacity = Number(fo.value) / 100; out.textContent = `${fo.value}%`; changed(el); });
  }
}


// ---------------------------------------------------------------- 座標軸・グラフ・中かっこ

function rangeRow(prefix, el, label) {
  return `<div class="row"><span class="unit">${label}</span>${num(prefix + "Min", el[prefix + "Min"], { step: 1 })}<span class="unit">〜</span>${num(prefix + "Max", el[prefix + "Max"], { step: 1 })}<span class="unit">目盛り</span>${num(prefix + "Step", el[prefix + "Step"], { step: 0.5, min: 0.01 })}</div>`;
}

function axesFields(sec, el, add, changed) {
  const u = P();
  const isLine = el.axesKind === "numberline";
  const fk = add("種類", `<div class="seg" data-k="kind"><button type="button" data-v="numberline">数直線</button><button type="button" data-v="axes">座標軸</button><button type="button" data-v="plane">座標平面</button><button type="button" data-v="polar">極座標</button><button type="button" data-v="complex">複素平面</button></div>`);
  fk.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.axesKind));
  fk.querySelector("[data-k=kind]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.axesKind) return;
    el.axesKind = b.dataset.v;
    changed(el);
    setTimeout(() => select(el.id), 50); // 欄を作り直す（種類で項目が変わる）
  });
  const isPolar = el.axesKind === "polar";
  const fr = add("範囲", isPolar
    ? `<div class="row"><span class="unit">半径 最大</span>${num("xMax", el.xMax, { step: 1 })}<span class="unit">目盛り</span>${num("xStep", el.xStep, { step: 0.5, min: 0.01 })}</div>
       <div class="row"><span class="unit">角度の目盛り</span>${num("az", el.azimuthStep ?? 30, { step: 5, min: 1 })}<span class="unit">°</span><div class="seg" data-k="au"><button type="button" data-v="degrees">度</button><button type="button" data-v="pi">π</button></div></div>`
    : rangeRow("x", el, "x") + (isLine ? "" : rangeRow("y", el, "y")) + `<div class="field-note">最小〜最大と、目盛りの間隔。${el.xLog || el.yLog ? "対数目盛りの軸は、10 の指数で書きます（例: -2〜3 で 0.01〜1000、間隔 1）。" : ""}</div>`
      + (el.axesKind === "axes" ? `<label class="row"><input type="checkbox" data-k="xlog" ${el.xLog ? "checked" : ""}> x 軸を対数目盛り</label><label class="row"><input type="checkbox" data-k="ylog" ${el.yLog ? "checked" : ""}> y 軸を対数目盛り</label>
        <div class="field-note">対数目盛り（Manim の LogBase）。目盛りの数字は 10<sup>n</sup> の形です。グラフ・点・折れ線グラフ・グラフのラベルは値（例: y = x^2、点 (100, 10)）で書きます。面積・リーマン和・接線などのグラフの補助と、ベクトル場・媒介変数曲線・陰関数は使えません。</div>` : ""), { top: true });
  fr.querySelector("[data-k=xlog]")?.addEventListener("change", (e) => { el.xLog = e.target.checked; if (el.xLog && el.xMin < -6) el.xMin = -2; changed(el); reselect(el); });
  fr.querySelector("[data-k=ylog]")?.addEventListener("change", (e) => { el.yLog = e.target.checked; changed(el); reselect(el); });
  if (isPolar) {
    fr.querySelector("[data-k=az]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.azimuthStep = v; changed(el); } });
    bindSeg(fr, "au", () => el.azimuthUnits ?? "degrees", (v) => { el.azimuthUnits = v; changed(el); });
  }
  for (const k of ["xMin", "xMax", "xStep", "yMin", "yMax", "yStep"]) {
    fr.querySelector(`[data-k=${k}]`)?.addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[k] = v; changed(el); } });
  }
  const fl = add("長さ", `<div class="row"><span class="unit">${isPolar ? "直径" : "横"}</span>${num("w", r2(el.width / u), { step: 0.5, min: 0.1 })}${isLine || isPolar ? "" : `<span class="unit">縦</span>${num("h", r2(el.height / u), { step: 0.5, min: 0.1 })}`}</div><div class="field-note">軸の長さ（Manim の単位）。キャンバスでは角・辺のハンドルで変えます。</div>`);
  fl.querySelector("[data-k=w]").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.width = v; changed(el); } });
  fl.querySelector("[data-k=h]")?.addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.height = v; changed(el); } });
  const fo = add("表示", `<label class="row"><input type="checkbox" data-k="tips" ${el.tips ? "checked" : ""}> 軸の先に矢印</label>
    <label class="row"><input type="checkbox" data-k="numbers" ${el.numbers ? "checked" : ""}> 目盛りの数字</label>
    <div class="row"><span class="unit">数字の大きさ</span>${num("ns", el.numSize ?? 24, { step: 2, min: 4 })}</div>`);
  fo.querySelector("[data-k=tips]").addEventListener("change", (e) => { el.tips = e.target.checked; changed(el); });
  fo.querySelector("[data-k=numbers]").addEventListener("change", (e) => { el.numbers = e.target.checked; changed(el); });
  fo.querySelector("[data-k=ns]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.numSize = v; changed(el); } });
  if (!isLine && !isPolar) {
    const fa = add("軸ラベル", `<div class="row"><span class="unit">x</span><input data-k="xl" value="${escapeHtml(el.xLabel ?? "")}" spellcheck="false" style="width:7em"><span class="unit">y</span><input data-k="yl" value="${escapeHtml(el.yLabel ?? "")}" spellcheck="false" style="width:7em"></div><div class="field-note">LaTeX（数式）で書きます。空欄なら付けません。日本語は自動で \\text{…} になります。</div>
      <div class="row"><button type="button" class="small" data-a="lreset" ${(el.xLabelShift ?? [0, 0]).some(Boolean) || (el.yLabelShift ?? [0, 0]).some(Boolean) ? "" : "disabled"}>ラベルの位置を戻す</button></div>
      <div class="field-note">キャンバスでラベルの上のオレンジの丸をドラッグすると、ラベルを好きな位置に動かせます（Shift で水平・垂直に）。</div>`);
    fa.querySelector("[data-a=lreset]").addEventListener("click", () => { el.xLabelShift = [0, 0]; el.yLabelShift = [0, 0]; changed(el); reselect(el); });
    fa.querySelector("[data-k=xl]").addEventListener("change", (e) => { el.xLabel = e.target.value; changed(el); });
    fa.querySelector("[data-k=yl]").addEventListener("change", (e) => { el.yLabel = e.target.value; changed(el); });
  }
  if (!isLine) {
    // グラフ
    const graphs = currentSlide().elements.filter((g) => ["graph", "field", "axdot", "curve2d", "implicit"].includes(g.shape) && g.axesId === el.id);
    const desc = (g) => (g.shape === "graph" ? `${isPolar ? "r" : "y"} = ${g.expr}` : ["curve2d", "implicit"].includes(g.shape) ? shapeLabel(g) : g.shape === "axdot" ? `点 (${g.xExpr}, ${g.yExpr})` : `${g.fieldKind === "stream" ? "流線" : "ベクトル場"} (${g.fx}, ${g.fy})`);
    const fg = add("グラフ", `<ul class="content-list">${graphs.map((g) => `<li><button type="button" class="link" data-pick="${g.id}">${escapeHtml(g.var)}</button><span class="grow hint">${escapeHtml(desc(g))}</span></li>`).join("") || `<li class="hint">（グラフはありません）</li>`}</ul>
      <div class="row"><button type="button" class="small" data-a="graph">＋グラフ</button><button type="button" class="small" data-a="field">＋ベクトル場</button><button type="button" class="small" data-a="stream">＋流線</button><button type="button" class="small" data-a="axdot">＋点</button><button type="button" class="small" data-a="vector">＋ベクトル</button><button type="button" class="small" data-a="linegraph">＋折れ線グラフ</button><button type="button" class="small" data-a="points">＋計算した点列</button><button type="button" class="small" data-a="curve2d">＋媒介変数曲線</button><button type="button" class="small" data-a="implicit">＋陰関数</button></div>
      <div class="field-note">グラフ・ベクトル場は座標軸と一緒に動きます。ステップで <code>Create(graph1)</code> のように、1 つずつ出せます。</div>`, { top: true });
    fg.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => select(b.dataset.pick)));
    fg.querySelector("[data-a=graph]").addEventListener("click", () => addGraph(el));
    fg.querySelector("[data-a=field]").addEventListener("click", () => addField(el, "arrows"));
    fg.querySelector("[data-a=stream]").addEventListener("click", () => addField(el, "stream"));
    fg.querySelector("[data-a=axdot]").addEventListener("click", () => addAxDot(el));
    fg.querySelector("[data-a=vector]")?.addEventListener("click", () => addVector(el));
    fg.querySelector("[data-a=linegraph]")?.addEventListener("click", () => {
      if (!["axes", "plane"].includes(el.axesKind)) { toast("折れ線グラフは、座標軸・座標平面に追加できます。", "warn"); return; }
      addLineGraph(el);
    });
    fg.querySelector("[data-a=points]")?.addEventListener("click", async () => {
      if (!["axes", "plane"].includes(el.axesKind)) { toast("計算した点列は、座標軸・座標平面に追加できます。", "warn"); return; }
      (await import("./shapes.js")).addPoints(el, "code");
    });
    fg.querySelector("[data-a=curve2d]").addEventListener("click", () => addOnAxes(el, "curve2d"));
    fg.querySelector("[data-a=implicit]").addEventListener("click", () => addOnAxes(el, "implicit"));
  }
  if (el.axesKind === "plane") linearFields(el, add, changed);
}

// 座標平面に付いて、線形変換で一緒に動く要素（書き出しの linear_followers と同じ）
const ON_AXES = ["graph", "axdot", "vector", "linegraph", "points", "curve2d", "implicit", "field"];
function attachedTo(plane) {
  const els = currentSlide().elements;
  const on = new Set(els.filter((e) => ON_AXES.includes(e.shape) && e.axesId === plane.id).map((e) => e.id));
  for (const e of els) if (e.shape === "graphpart" && on.has(e.graphId)) on.add(e.id);
  return on;
}

/** 線形変換の平面（LinearTransformationScene に当たるもの）。 */
function linearFields(el, add, changed) {
  const f = add("線形変換", `<label class="row"><input type="checkbox" data-k="lin" ${el.linear ? "checked" : ""}> 線形変換の平面にする</label>
    ${el.linear ? `<label class="row"><input type="checkbox" data-k="ghost" ${el.ghost !== false ? "checked" : ""}> 変換の前の薄い方眼を残す</label>
    <label class="row"><input type="checkbox" data-k="basis" ${el.basis !== false ? "checked" : ""}> 基底ベクトル î・ĵ（緑・赤）</label>
    <label class="row"><input type="checkbox" data-k="lclip" ${el.linearClip ? "checked" : ""}> 平面の四角形の外は描かない（変換して広がった方眼が、題名などに重ならない）</label>` : ""}
    <div class="field-note">ステップの <code>gui_apply_matrix(self, ${escapeHtml(el.var)}, [[a, b], [c, d]])</code> で、平面と、一緒に動く要素をまとめて変換します（3Blue1Brown の LinearTransformationScene と同じ動き）。
    続けて変換すると、行列の積の順に重なります。基底ベクトルは <code>${escapeHtml(el.var)}.gui_basis[0]</code>（î）・<code>[1]</code>（ĵ）、薄い方眼は <code>${escapeHtml(el.var)}.gui_background</code>。</div>`, { top: true });
  f.querySelector("[data-k=lin]").addEventListener("change", (e) => {
    el.linear = e.target.checked;
    if (el.linear) { el.ghost ??= true; el.basis ??= true; el.followIds ??= []; }
    changed(el); reselect(el);
  });
  f.querySelector("[data-k=ghost]")?.addEventListener("change", (e) => { el.ghost = e.target.checked; changed(el); });
  f.querySelector("[data-k=basis]")?.addEventListener("change", (e) => { el.basis = e.target.checked; changed(el); });
  f.querySelector("[data-k=lclip]")?.addEventListener("change", (e) => { el.linearClip = e.target.checked; changed(el); });
  if (!el.linear) return;
  const on = attachedTo(el);
  const others = currentSlide().elements.filter((e) => e.id !== el.id && !on.has(e.id) && e.type !== "image" && !(e.type === "shape" && e.shape === "zoom"));
  const chosen = new Set(el.followIds ?? []);
  const fl = add("一緒に変換する要素", `<div class="field-note">座標平面に付いた要素（${on.size ? [...on].map((id) => escapeHtml(findElement(id)?.var ?? "")).join("・") : "なし"}）は、いつも一緒に変換します。ほかに一緒に変換する要素を選びます。</div>
    <ul class="content-list">${others.map((e) => `<li><label class="row"><input type="checkbox" data-f="${e.id}" ${chosen.has(e.id) ? "checked" : ""}> ${escapeHtml(e.var)}<span class="grow hint">${escapeHtml(e.type === "shape" ? shapeLabel(e) : e.type === "math" ? "数式" : e.type === "text" ? "テキスト" : "")}</span></label></li>`).join("") || `<li class="hint">（ほかの要素はありません）</li>`}</ul>`);
  fl.querySelectorAll("[data-f]").forEach((cb) => cb.addEventListener("change", () => {
    const ids = new Set(el.followIds ?? []);
    if (cb.checked) ids.add(cb.dataset.f); else ids.delete(cb.dataset.f);
    // 重なり順にそろえる
    el.followIds = currentSlide().elements.filter((e) => ids.has(e.id)).map((e) => e.id);
    changed(el);
  }));
  const fm = add("変換のステップ", `<div class="row"><span class="unit">行列</span><div class="table-grid" style="grid-template-columns: repeat(2, 4.5em)">
      <input class="cell" data-m="0" value="1"><input class="cell" data-m="1" value="1"><input class="cell" data-m="2" value="0"><input class="cell" data-m="3" value="1"></div></div>
    <div class="row"><span class="unit">時間</span>${num("rt", 2, { step: 0.5, min: 0.1 })}<span class="unit">秒</span><button type="button" class="small" data-a="mstep">＋変換のステップ</button></div>
    <div class="field-note">数のほかに、np.cos(1) のような Python の式も書けます。押すと、この平面のステップとして <code>gui_apply_matrix(…)</code> を足します（あとからコードを書き換えられます）。</div>`);
  fm.querySelector("[data-a=mstep]").addEventListener("click", () => {
    const v = [...fm.querySelectorAll("[data-m]")].map((i) => i.value.trim() || "0");
    const rt = Number(fm.querySelector("[data-k=rt]").value) || 2;
    const slide = currentSlide();
    const st = { id: uid("t"), elementId: el.id, code: `gui_apply_matrix(self, ${el.var}, [[${v[0]}, ${v[1]}], [${v[2]}, ${v[3]}]], run_time=${rt})` };
    slide.steps.push(st);
    store.focusStepId = st.id;
    markDirty("steps");
    emit("steps-changed"); // ステップの一覧とパネルを作り直す
  });
}

function graphFields(sec, el, add, changed) {
  const axes = findElement(el.axesId);
  const polar = axes?.axesKind === "polar";
  const cplx = axes?.axesKind === "complex" && !!el.complexCurve;
  if (axes?.axesKind === "complex") {
    const fm = add("グラフの種類", `<div class="seg" data-k="gm"><button type="button" data-v="real">y = f(x)</button><button type="button" data-v="complex">z = f(t)（複素数）</button></div>
      <div class="field-note">複素数の曲線は、t を動かしたときの複素数 z を複素平面に描きます（虚数単位は i）。</div>`, { top: true });
    bindSeg(fm, "gm", () => (el.complexCurve ? "complex" : "real"), (v) => { el.complexCurve = v === "complex"; changed(el); reselect(el); });
  }
  const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
  fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  const f = add("式", `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
    <div class="row"><span class="unit">${polar ? "r =" : cplx ? "z =" : "y ="}</span><input data-k="expr" value="${escapeHtml(el.expr ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
    <div class="field-note" data-k="note"></div>`, { top: true });
  const note = f.querySelector("[data-k=note]"), input = f.querySelector("[data-k=expr]");
  const showLang = () => f.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.lang));
  showLang();
  const help = () => cplx ? `t の式（x と書いても同じ）。虚数単位は i。例: e^{it}、\\exp(ix)、\\cos t + i\\sin 2t、(1 + i)t。${valuesNote()}` : polar ? `θ の式（LaTeX では \\theta、Python では theta）。例: 1 + \\cos\\theta、2\\sin 3\\theta。${valuesNote()}` : el.lang === "latex"
    ? `例: \\sin x、\\frac{x^2}{4} - 1、e^{-x}\\cos 3x、\\sqrt{x}、|x|、\\log_2 x。変数は x。${valuesNote()}`
    : `例: np.sin(x)、x**2/4 - 1、exp(-x)*cos(3*x)。sin・cos・exp・sqrt・log などは np. を付けなくても使えます。${valuesNote()}`;
  const setNote = (text, ng = false) => { note.textContent = text; note.className = `field-note${ng ? " ng" : ""}`; };
  setNote(help());
  f.querySelector("[data-k=lang]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.lang) return;
    el.lang = b.dataset.v; showLang(); setNote(help()); changed(el);
  });
  input.addEventListener("input", () => { el.expr = input.value; changed(el); });
  // プレビューの結果（式の誤り・Python への変換）を表示する
  const showResult = () => {
    const o = fabricObjectOf(el.id);
    if (o?.previewError) setNote(o.previewError.replace(/^.*?式: /, "式の誤り: "), true);
    else if (el.lang === "latex" && o?.python) setNote(`Python の式: ${o.python}`);
    else setNote(help());
  };
  showResult();
  const off = on("element-rendered", ({ el: r }) => {
    if (!document.body.contains(note)) return off();
    if (r.id === el.id) showResult();
  });
  const fx = add(polar ? "θ の範囲" : cplx ? "t の範囲" : "x の範囲", `<div class="row">${num("xf", el.xFrom ?? "", { step: 0.5 })}<span class="unit">〜</span>${num("xt", el.xTo ?? "", { step: 0.5 })}</div><div class="field-note">${polar ? "ラジアン。空欄なら 0〜2π。" : cplx ? "空欄なら 0〜2π。" : "空欄なら座標軸の端まで。y が軸の範囲の外に出る所では、線を切ります。"}</div>`);
  if (!polar && !cplx) {
    const parts = currentSlide().elements.filter((g) => g.shape === "graphpart" && g.graphId === el.id);
    const fp = add("グラフの補助", `<ul class="content-list">${parts.map((g) => `<li><button type="button" class="link" data-pick="${g.id}">${escapeHtml(g.var)}</button><span class="grow hint">${escapeHtml(shapeLabel(g))}</span></li>`).join("") || `<li class="hint">（まだありません）</li>`}</ul>
      <div class="row"><button type="button" class="small" data-p="area">＋面積</button><button type="button" class="small" data-p="riemann">＋リーマン和</button><button type="button" class="small" data-p="tangent">＋接線</button><button type="button" class="small" data-p="secant">＋割線</button></div>
      <div class="row"><button type="button" class="small" data-p="derivative">＋導関数</button><button type="button" class="small" data-p="antiderivative">＋原始関数</button><button type="button" class="small" data-p="glabel">＋ラベル</button><button type="button" class="small" data-p="tlabel">＋T字ラベル</button></div>`, { top: true });
    fp.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => select(b.dataset.pick)));
    fp.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => addGraphPart(el, b.dataset.p)));
  }
  fx.querySelector("[data-k=xf]").addEventListener("change", (e) => { el.xFrom = e.target.value === "" ? null : Number(e.target.value); changed(el); });
  fx.querySelector("[data-k=xt]").addEventListener("change", (e) => { el.xTo = e.target.value === "" ? null : Number(e.target.value); changed(el); });
}

function braceFields(sec, el, add, changed) {
  const fm = add("付け方", `<div class="seg" data-k="mode"><button type="button" data-v="target">要素に付ける</button><button type="button" data-v="points">2 点の間</button></div><div class="field-note" data-k="mnote"></div>`);
  fm.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.mode));
  const target = findElement(el.targetId);
  fm.querySelector("[data-k=mnote]").innerHTML = el.mode === "target"
    ? (target ? `付ける要素: <button type="button" class="link" data-a="target">${escapeHtml(target.var)}</button>（要素を動かすと、かっこもついてきます）` : "付ける要素が見つかりません")
    : "両端の丸をドラッグして動かします。要素に付けるには、その要素を選んでから「＋図形」の「中かっこ」を追加します。";
  fm.querySelector("[data-a=target]")?.addEventListener("click", () => select(target.id));
  fm.querySelector("[data-k=mode]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.mode) return;
    if (b.dataset.v === "points") { braceToPoints(el); changed(el); setTimeout(() => select(el.id), 50); }
    else toast("要素に付けるには、その要素を選んでから「＋図形」の「中かっこ」を追加してください。", "", 5000);
  });
  if (el.mode === "target") {
    const fd = add("向き", `<div class="seg" data-k="dir"><button type="button" data-v="up">上</button><button type="button" data-v="down">下</button><button type="button" data-v="left">左</button><button type="button" data-v="right">右</button></div>`);
    fd.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.direction));
    fd.querySelector("[data-k=dir]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      el.direction = b.dataset.v;
      fd.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
      changed(el);
    });
  } else {
    const ff = add("向き", `<button type="button" class="small" data-a="flip">反対側に向ける</button>`);
    ff.querySelector("[data-a=flip]").addEventListener("click", () => { el.flip = !el.flip; changed(el); });
  }
  const fb = add("かっこ", `<div class="row"><span class="unit">間隔</span>${num("buff", el.buff ?? 0.2, { step: 0.05, min: 0 })}<span class="unit">とがり</span>${num("sh", el.sharpness ?? 2, { step: 0.5, min: 0.2 })}</div><div class="field-note">間隔は要素（または 2 点を結ぶ線）とかっこの間（Manim の単位）。</div>`);
  fb.querySelector("[data-k=buff]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.buff = v; changed(el); } });
  fb.querySelector("[data-k=sh]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.sharpness = v; changed(el); } });
  const fl = add("ラベル", `<div class="seg" data-k="lk"><button type="button" data-v="math">数式</button><button type="button" data-v="text">テキスト</button></div>
    <div class="row"><input data-k="label" value="${escapeHtml(el.label ?? "")}" spellcheck="false" style="flex:1" placeholder="空欄ならラベルなし"></div>
    <div class="row"><span class="unit">大きさ</span>${num("ls", el.labelSize ?? 36, { step: 2, min: 2 })}<label class="row" style="margin:0"><input type="checkbox" data-k="lcs" ${el.labelColor ? "" : "checked"}> かっこと同じ色</label>${colorInput("lc", el.labelColor || el.fill?.color || el.stroke?.color)}</div>
    <div class="field-note">かっこの先に置きます。数式は LaTeX で書きます（表示は MathJax の仮表示）。</div>`, { top: true });
  fl.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.labelKind));
  fl.querySelector("[data-k=lk]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    el.labelKind = b.dataset.v;
    fl.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
    changed(el);
  });
  fl.querySelector("[data-k=label]").addEventListener("input", (e) => { el.label = e.target.value; changed(el); });
  fl.querySelector("[data-k=ls]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  const lcs = fl.querySelector("[data-k=lcs]");
  lcs.addEventListener("change", () => { el.labelColor = lcs.checked ? null : (el.fill?.color || el.stroke?.color); changed(el); });
  bindColor(fl, "lc", () => el.labelColor, (v) => { el.labelColor = v; lcs.checked = false; changed(el); });
}


// ---------------------------------------------------------------- 表

const fontOptions = (selected) => fontOptionsHtml(selected);

const reselect = (el) => setTimeout(() => select(el.id), 50); // 欄を作り直す
const tableCursor = { id: null, r: 0, c: 0 };

/** 表・行列のセルの編集（行・列の挿入・削除、表計算ソフトからの貼り付け）。 */
function cellGridFields(el, add, changed, note) {
  const rows = el.cells.length, cols = el.cells[0]?.length ?? 0;
  const items = ensureItems(el);
  const itemVar = (id) => findElement(id)?.var ?? "?";
  // 要素を入れたセルは、要素の名前（クリックでそのセルを選ぶ）
  const grid = el.cells.map((r, i) => r.map((c, j) => (items[i][j]
    ? `<button type="button" class="cell item" data-r="${i}" data-c="${j}" title="セルに入れた要素">◆ ${escapeHtml(itemVar(items[i][j]))}</button>`
    : `<input class="cell" data-r="${i}" data-c="${j}" value="${escapeHtml(c)}" spellcheck="false">`)).join("")).join("");
  // 選んでいるセル（行・列の挿入・削除の基準）。表を選び直しても、同じ表なら覚えておく
  if (tableCursor.id !== el.id) Object.assign(tableCursor, { id: el.id, r: rows - 1, c: cols - 1 });
  tableCursor.r = Math.min(tableCursor.r, rows - 1);
  tableCursor.c = Math.min(tableCursor.c, cols - 1);
  const fc = add("セル", `<div class="table-grid" style="grid-template-columns: repeat(${cols}, minmax(3.2em, 1fr))">${grid}</div>
    <div class="row"><span class="unit" data-k="cur"></span></div>
    <div class="row"><span class="unit">行</span><button type="button" class="small" data-a="r-above">上に挿入</button><button type="button" class="small" data-a="r-below">下に挿入</button><button type="button" class="small" data-a="r-del">削除</button></div>
    <div class="row"><span class="unit">列</span><button type="button" class="small" data-a="c-left">左に挿入</button><button type="button" class="small" data-a="c-right">右に挿入</button><button type="button" class="small" data-a="c-del">削除</button></div>
    <div class="field-note">行・列の挿入と削除は、選んでいるセル（青い枠）の位置で行います。${note}Excel などからコピーした範囲を、セルに貼り付けられます。</div>`, { top: true });
  const cells = [...fc.querySelectorAll(".cell")];
  const showCursor = () => {
    for (const inp of cells) {
      const r = Number(inp.dataset.r), c = Number(inp.dataset.c);
      inp.classList.toggle("cur", r === tableCursor.r && c === tableCursor.c);
      inp.classList.toggle("cur-line", r === tableCursor.r || c === tableCursor.c);
    }
    fc.querySelector("[data-k=cur]").textContent = `${rows} 行 × ${cols} 列・選択: ${tableCursor.r + 1} 行目 ${tableCursor.c + 1} 列目`;
    fc.querySelector("[data-a=r-del]").disabled = rows <= 1;
    fc.querySelector("[data-a=c-del]").disabled = cols <= 1;
    cellCursorHook?.();
  };
  showCursor();
  cells.forEach((inp) => {
    inp.addEventListener("focus", () => { tableCursor.r = Number(inp.dataset.r); tableCursor.c = Number(inp.dataset.c); showCursor(); });
    if (inp.tagName === "BUTTON") return;
    inp.addEventListener("input", () => { el.cells[Number(inp.dataset.r)][Number(inp.dataset.c)] = inp.value; changed(el); });
    inp.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/[\t\n]/.test(text)) return;
      e.preventDefault();
      // 表計算ソフトの範囲（タブ区切り・行ごと）を、このセルから右下へ書き込む（足りなければ行・列を増やす）
      const block = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
      const r0 = Number(inp.dataset.r), c0 = Number(inp.dataset.c);
      const need = Math.max(cols, c0 + Math.max(...block.map((b) => b.length)));
      for (const r of el.cells) while (r.length < need) r.push("");
      block.forEach((b, i) => {
        while (el.cells.length <= r0 + i) el.cells.push(Array(need).fill(""));
        b.forEach((v, j) => { el.cells[r0 + i][c0 + j] = v; });
      });
      // 貼り付けたセルに入れていた要素は外す
      ensureItems(el);
      block.forEach((b, i) => b.forEach((_, j) => { el.items[r0 + i][c0 + j] = null; }));
      changed(el);
      reselect(el);
    });
  });
  fc.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a, { r, c } = tableCursor;
    // セルの要素（el.items）も、セルと同じように挿入・削除する
    const both = (fn) => { fn(el.cells, ""); fn(el.items, null); };
    if (a === "r-above") { both((g, v) => g.splice(r, 0, Array(cols).fill(v))); tableCursor.r = r + 1; } // 選んでいたセルを選んだまま
    if (a === "r-below") { both((g, v) => g.splice(r + 1, 0, Array(cols).fill(v))); tableCursor.r = r + 1; }
    if (a === "r-del" && rows > 1) { both((g) => g.splice(r, 1)); tableCursor.r = Math.min(r, rows - 2); }
    if (a === "c-left") { both((g, v) => g.forEach((row) => row.splice(c, 0, v))); tableCursor.c = c + 1; }
    if (a === "c-right") { both((g, v) => g.forEach((row) => row.splice(c + 1, 0, v))); tableCursor.c = c + 1; }
    if (a === "c-del" && cols > 1) { both((g) => g.forEach((row) => row.splice(c, 1))); tableCursor.c = Math.min(c, cols - 2); }
    changed(el);
    reselect(el);
  }));
  cellItemFields(el, add, changed);
}

/** 表・行列の、選んでいるセルに要素を入れる・外す（MobjectTable・MobjectMatrix と同じ）。 */
let cellCursorHook = null;
function cellItemFields(el, add, changed) {
  const inUse = new Set(el.items.flat().filter(Boolean));
  const cands = currentSlide().elements.filter((e) => cellItemOk(e, el) && !inUse.has(e.id));
  const f = add("セルに要素を入れる", `<div class="row" data-k="currow"><span class="unit">選んでいるセル:</span><button type="button" class="link" data-a="pick"></button><button type="button" class="small" data-a="out">セルから外す</button></div>
    <div class="row" data-k="inrow"><select data-k="cand">${cands.length ? cands.map((e) => `<option value="${e.id}">${escapeHtml(e.var)}</option>`).join("") : `<option value="">（入れられる要素がありません）</option>`}</select><button type="button" class="small" data-a="in" ${cands.length ? "" : "disabled"}>選んでいるセルに入れる</button></div>
    <div class="field-note">スライドのテキスト・数式・図形を、セルに入れます（${el.shape === "matrix" ? "MobjectMatrix" : "MobjectTable"} と同じ）。要素を選んでから「表・数値・文字」タブの「要素の表」「要素の行列」を追加すると、選んだ要素を順に入れた表を作ります。セルの要素の位置は表が決め、表を動かすと一緒に動きます。要素の変数名はそのままなので、ステップで <code>Indicate(circle1)</code> のように個別に動かせます。「最初から出す」を外した要素は、セルの位置に置いたまま、あとのステップで出せます（例: <code>FadeIn(circle1)</code>）。</div>`);
  const cur = () => el.items?.[tableCursor.r]?.[tableCursor.c] ?? null;
  const refresh = () => {
    const id = cur();
    f.querySelector("[data-k=currow]").hidden = !id;
    f.querySelector("[data-k=inrow]").hidden = !!id;
    if (id) f.querySelector("[data-a=pick]").textContent = findElement(id)?.var ?? "?";
  };
  refresh();
  cellCursorHook = () => { if (document.body.contains(f)) refresh(); };
  f.querySelector("[data-a=pick]").addEventListener("click", () => select(cur()));
  f.querySelector("[data-a=out]").addEventListener("click", () => { el.items[tableCursor.r][tableCursor.c] = null; changed(el); reselect(el); });
  f.querySelector("[data-a=in]").addEventListener("click", () => {
    const id = f.querySelector("[data-k=cand]").value;
    if (!id) return;
    el.items[tableCursor.r][tableCursor.c] = id;
    changed(el); reselect(el);
  });
}

function tableFields(sec, el, add, changed) {
  cellGridFields(el, add, changed, el.cellMode === "math" ? "すべてのセルを LaTeX（数式）で書きます（MathTable と同じ）。" : "<code>$x^2$</code> のように $ で囲んだセルは数式になります。");
  const fk = add("セルの種類", `<div class="seg" data-k="mode"><button type="button" data-v="text">テキスト</button><button type="button" data-v="math">数式</button></div>`);
  fk.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.cellMode));
  fk.querySelector("[data-k=mode]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.cellMode) return;
    el.cellMode = b.dataset.v;
    changed(el);
    reselect(el);
  });
  const ft = add("文字", `<div class="row"><span class="unit">大きさ</span>${num("fs", el.fontSize, { step: 2, min: 2 })}${colorInput("tc", el.color)}</div>
    ${el.cellMode === "text" ? `<div class="row"><select data-k="font">${fontOptions(el.font)}</select></div>
    <label class="row"><input type="checkbox" data-k="hr" ${el.headerRow ? "checked" : ""}> 1 行目を太字（見出し）</label>
    <label class="row"><input type="checkbox" data-k="hc" ${el.headerCol ? "checked" : ""}> 1 列目を太字（見出し）</label>` : ""}`);
  ft.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  bindColor(ft, "tc", () => el.color, (v) => { el.color = v; changed(el); });
  ft.querySelector("[data-k=font]")?.addEventListener("change", (e) => { el.font = e.target.value; changed(el); });
  ft.querySelector("[data-k=hr]")?.addEventListener("change", (e) => { el.headerRow = e.target.checked; changed(el); });
  ft.querySelector("[data-k=hc]")?.addEventListener("change", (e) => { el.headerCol = e.target.checked; changed(el); });
  const fb = add("セルの間隔", `<div class="row"><span class="unit">横</span>${num("hb", el.hBuff, { step: 0.05, min: 0 })}<span class="unit">縦</span>${num("vb", el.vBuff, { step: 0.05, min: 0 })}</div>
    <label class="row"><input type="checkbox" data-k="ol" ${el.outerLines ? "checked" : ""}> 外枠の線</label>
    <div class="field-note">セルの中身どうしの間隔（Manim の単位。h_buff・v_buff）。キャンバスで角のハンドルを動かすと、文字の大きさと間隔をまとめて変えます。</div>`);
  const ih = fb.querySelector("[data-k=hb]"), iv = fb.querySelector("[data-k=vb]");
  ih.addEventListener("change", () => { const v = Number(ih.value); if (v >= 0) { el.hBuff = v; changed(el); } });
  iv.addEventListener("change", () => { const v = Number(iv.value); if (v >= 0) { el.vBuff = v; changed(el); } });
  fb.querySelector("[data-k=ol]").addEventListener("change", (e) => { el.outerLines = e.target.checked; changed(el); });
  on("element-resized", (els) => {
    if (!els.includes(el) || !document.body.contains(ih)) return;
    ih.value = el.hBuff; iv.value = el.vBuff; ft.querySelector("[data-k=fs]").value = el.fontSize;
  });
}

// ---------------------------------------------------------------- ベクトル場・流線

function fieldFields(sec, el, add, changed) {
  const u = P();
  const fk = add("種類", `<div class="seg" data-k="kind"><button type="button" data-v="arrows">矢印</button><button type="button" data-v="stream">流線</button></div><div class="field-note">矢印は Manim の ArrowVectorField、流線は StreamLines です。</div>`);
  fk.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.fieldKind));
  fk.querySelector("[data-k=kind]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.fieldKind) return;
    el.fieldKind = b.dataset.v;
    el.stroke.width = el.fieldKind === "stream" ? 1.5 : 2;
    changed(el);
    reselect(el);
  });
  const axes = el.axesId ? findElement(el.axesId) : null;
  if (axes) {
    const fa = add("座標軸", `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button><div class="field-note">座標軸の範囲・大きさに重ねて描き、座標軸と一緒に動きます。座標軸を消すと、同じ範囲の独立したベクトル場になります。</div>`);
    fa.querySelector("[data-a=axes]").addEventListener("click", () => select(axes.id));
  } else {
    const fr = add("範囲", `<div class="row"><span class="unit">x</span>${num("xMin", el.xMin, { step: 1 })}<span class="unit">〜</span>${num("xMax", el.xMax, { step: 1 })}</div>
      <div class="row"><span class="unit">y</span>${num("yMin", el.yMin, { step: 1 })}<span class="unit">〜</span>${num("yMax", el.yMax, { step: 1 })}</div>
      <div class="row"><span class="unit">横</span>${num("w", r2(el.width / u), { step: 0.5, min: 0.1 })}<span class="unit">縦</span>${num("h", r2(el.height / u), { step: 0.5, min: 0.1 })}</div>
      <div class="field-note">式の x・y の範囲と、画面での大きさ（Manim の単位）。座標軸に重ねるときは、座標軸のパネルの「＋ベクトル場」から追加します。</div>`, { top: true });
    for (const k of ["xMin", "xMax", "yMin", "yMax"]) {
      fr.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[k] = v; changed(el); } });
    }
    const iw = fr.querySelector("[data-k=w]"), ih = fr.querySelector("[data-k=h]");
    iw.addEventListener("change", () => { const v = Number(iw.value) * u; if (v > 0) { el.width = v; changed(el); } });
    ih.addEventListener("change", () => { const v = Number(ih.value) * u; if (v > 0) { el.height = v; changed(el); } });
    on("element-resized", (els) => { if (els.includes(el) && document.body.contains(iw)) { iw.value = r2(el.width / u); ih.value = r2(el.height / u); } });
  }
  const f = add("式", `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
    <div class="row"><span class="unit">x 成分</span><input data-k="fx" value="${escapeHtml(el.fx ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
    <div class="row"><span class="unit">y 成分</span><input data-k="fy" value="${escapeHtml(el.fy ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
    <div class="field-note" data-k="note"></div>`, { top: true });
  const note = f.querySelector("[data-k=note]");
  const showLang = () => f.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.lang));
  showLang();
  const help = () => (el.lang === "latex"
    ? `点 (x, y) でのベクトル (x 成分, y 成分)。例: -y と x（回転）、\\sin y と x - y。${valuesNote()}`
    : `点 (x, y) でのベクトル (x 成分, y 成分)。例: -y と x、np.sin(y) と x - y。${valuesNote()}`);
  const setNote = (text, ng = false) => { note.textContent = text; note.className = `field-note${ng ? " ng" : ""}`; };
  f.querySelector("[data-k=lang]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.lang) return;
    el.lang = b.dataset.v; showLang(); setNote(help()); changed(el);
  });
  f.querySelector("[data-k=fx]").addEventListener("input", (e) => { el.fx = e.target.value; changed(el); });
  f.querySelector("[data-k=fy]").addEventListener("input", (e) => { el.fy = e.target.value; changed(el); });
  const showResult = () => {
    const o = fabricObjectOf(el.id);
    if (o?.previewError) setNote(o.previewError.replace(/^.*?式: /, "式の誤り: "), true);
    else if (el.lang === "latex" && o?.python) setNote(`Python の式: (${o.python[0]}, ${o.python[1]})`);
    else setNote(help());
  };
  showResult();
  const off = on("element-rendered", ({ el: r }) => {
    if (!document.body.contains(note)) return off();
    if (r.id === el.id) showResult();
  });
  const isStream = el.fieldKind === "stream";
  const fs = add(isStream ? "流線" : "矢印", `<div class="row"><span class="unit">間隔</span>${num("step", el.step, { step: 0.1, min: 0.01 })}${isStream
    ? `<span class="unit">長さ</span>${num("vt", el.virtualTime, { step: 0.5, min: 0.1 })}`
    : ""}</div>
    ${isStream ? "" : `<div class="seg" data-k="len"><button type="button" data-v="limit">上限あり</button><button type="button" data-v="same">そろえる</button><button type="button" data-v="linear">比例</button></div>
    <div class="row"><span class="unit">倍率</span>${num("ls", el.lengthScale, { step: 0.1, min: 0.01 })}</div>`}
    <div class="field-note">${isStream
      ? "間隔は線の始点の間隔（座標の値。始点は少しずつずらします）。長さは、流れに沿って進む時間（大きいほど長い線）。"
      : "間隔は矢印を置く間隔（座標の値）。長さ: 上限あり＝大きいほど長いが間隔を超えない（Manim の既定）、そろえる＝向きだけ、比例＝座標での大きさのまま × 倍率。"}</div>`);
  fs.querySelector("[data-k=step]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.step = v; changed(el); } });
  fs.querySelector("[data-k=vt]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.virtualTime = v; changed(el); } });
  fs.querySelector("[data-k=ls]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.lengthScale = v; changed(el); } });
  const seg = fs.querySelector("[data-k=len]");
  if (seg) {
    seg.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.lengthMode));
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      el.lengthMode = b.dataset.v;
      seg.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
      changed(el);
    });
  }
  const fcl = add("色", `<div class="seg" data-k="cm"><button type="button" data-v="single">1 色</button><button type="button" data-v="magnitude">大きさで塗り分け</button></div>
    <div class="row" data-k="cmax"><span class="unit">最大</span>${num("cmax", el.colorMax, { step: 0.5, min: 0.01 })}</div>
    <div class="field-note">大きさで塗り分けると、ベクトルの大きさ 0〜最大 を青→緑→黄→赤で塗ります（Manim の既定の色）。</div>`);
  const cm = fcl.querySelector("[data-k=cm]"), cmaxRow = fcl.querySelector("[data-k=cmax]");
  const showCm = () => { cm.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.colorMode)); cmaxRow.hidden = el.colorMode !== "magnitude"; };
  showCm();
  cm.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    el.colorMode = b.dataset.v; showCm(); changed(el);
  });
  fcl.querySelector("[data-k=cmax]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.colorMax = v; changed(el); } });
}


// ---------------------------------------------------------------- スライドの値に連動する要素

function valuesNote() {
  const names = (currentSlide()?.values ?? []).map((v) => v.name).filter(Boolean);
  return names.length ? `スライドの値 ${names.join("・")} も使えます（値に合わせて形が変わります）。` : "";
}

function numberFields(sec, el, add, changed) {
  const names = (currentSlide()?.values ?? []).map((v) => v.name).filter(Boolean);
  const opts = [`<option value="" ${el.valueName ? "" : "selected"}>（固定の数）</option>`,
    ...names.map((n) => `<option value="${escapeHtml(n)}" ${n === el.valueName ? "selected" : ""}>${escapeHtml(n)}</option>`)];
  if (el.valueName && !names.includes(el.valueName)) opts.push(`<option value="${escapeHtml(el.valueName)}" selected>${escapeHtml(el.valueName)}（見つかりません）</option>`);
  const f = add("表示する値", `<div class="row"><select data-k="vn">${opts.join("")}</select>${el.valueName ? "" : num("num", el.number, { step: 0.1 })}</div>
    <div class="field-note">スライドの値（ValueTracker）を選ぶと、値に合わせて数字が変わります（左端の位置を保ちます）。値はスライドのパネル（要素を選んでいないとき）で作ります。</div>`, { top: true });
  f.querySelector("[data-k=vn]").addEventListener("change", (e) => { el.valueName = e.target.value; changed(el); reselect(el); });
  f.querySelector("[data-k=num]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.number = v; changed(el); } });
  const fn = add("名前のラベル", `<div class="row"><input data-k="nl" value="${escapeHtml(el.nameLabel ?? "")}" spellcheck="false" placeholder="例: x、\\theta、速さ（空欄なら無し）" style="flex:1"></div>
    <div class="field-note">書くと「x = 1.00」のように、名前と = を数字の左に付けます（Manim の Variable と同じ形。LaTeX）。</div>`);
  fn.querySelector("[data-k=nl]").addEventListener("change", (e) => { el.nameLabel = e.target.value; changed(el); });
  const g = add("数値", `<div class="row"><span class="unit">小数点以下</span>${num("dec", el.decimals, { step: 1, min: 0, max: 10 })}<span class="unit">桁</span></div>
    <label class="row"><input type="checkbox" data-k="sign" ${el.includeSign ? "checked" : ""}> + の符号も付ける</label>
    <div class="row"><span class="unit">単位</span><input data-k="unit" value="${escapeHtml(el.unit ?? "")}" spellcheck="false" placeholder="例: \\mathrm{m/s}、個" style="flex:1"></div>
    <div class="row"><span class="unit">大きさ</span>${num("fs", el.fontSize, { step: 2, min: 2 })}${colorInput("tc", el.color)}</div>
    <div class="field-note">単位は LaTeX（日本語は自動で \\text{…} になります）。</div>`);
  g.querySelector("[data-k=dec]").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0) { el.decimals = v; changed(el); } });
  g.querySelector("[data-k=sign]").addEventListener("change", (e) => { el.includeSign = e.target.checked; changed(el); });
  g.querySelector("[data-k=unit]").addEventListener("change", (e) => { el.unit = e.target.value; changed(el); });
  g.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  bindColor(g, "tc", () => el.color, (v) => { el.color = v; changed(el); });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(g)) g.querySelector("[data-k=fs]").value = el.fontSize; });
}

function axdotFields(sec, el, add, changed) {
  const axes = findElement(el.axesId);
  const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
  fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  const f = add("位置", `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
    <div class="row"><span class="unit">x</span><input data-k="px" value="${escapeHtml(el.xExpr ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
    <div class="row"><span class="unit">y</span><input data-k="py" value="${escapeHtml(el.yExpr ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
    <div class="field-note" data-k="note"></div>`, { top: true });
  const note = f.querySelector("[data-k=note]");
  const showLang = () => f.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === el.lang));
  showLang();
  const help = () => `座標軸の座標で、数か式を書きます。${valuesNote() || "スライドの値を作って式に書くと、値に合わせて点が動きます（例: x に t、y に t^2）。"}`;
  const setNote = (text, ng = false) => { note.textContent = text; note.className = `field-note${ng ? " ng" : ""}`; };
  f.querySelector("[data-k=lang]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.lang) return;
    el.lang = b.dataset.v; showLang(); changed(el);
  });
  f.querySelector("[data-k=px]").addEventListener("input", (e) => { el.xExpr = e.target.value; changed(el); });
  f.querySelector("[data-k=py]").addEventListener("input", (e) => { el.yExpr = e.target.value; changed(el); });
  const showResult = () => {
    const o = fabricObjectOf(el.id);
    if (o?.previewError) setNote(o.previewError.replace(/^.*?式: /, "式の誤り: "), true);
    else setNote(help());
  };
  showResult();
  const off = on("element-rendered", ({ el: r }) => {
    if (!document.body.contains(note)) return off();
    if (r.id === el.id) showResult();
  });
  const fd = add("点", `<div class="row"><span class="unit">半径</span>${num("r", r2(el.radius / P()), { step: 0.02, min: 0.01 })}</div>
    <label class="row"><input type="checkbox" data-k="lines" ${el.lines ? "checked" : ""}> 軸への点線（get_lines_to_point）</label>`);
  fd.querySelector("[data-k=r]").addEventListener("change", (e) => { const v = Number(e.target.value) * P(); if (v > 0) { el.radius = v; changed(el); } });
  fd.querySelector("[data-k=lines]").addEventListener("change", (e) => { el.lines = e.target.checked; changed(el); });
}


// ---------------------------------------------------------------- 3D

const QUALITY_SEG = `<div class="seg" data-k="q"><button type="button" data-v="low">粗い</button><button type="button" data-v="mid">普通</button><button type="button" data-v="high">細かい</button></div>`;

/** x・y・z の 3 つの数の欄。 */
function vec3(k, v, step = 0.1) {
  return `<div class="row"><span class="unit">x</span>${num(k + "0", v[0], { step })}<span class="unit">y</span>${num(k + "1", v[1], { step })}<span class="unit">z</span>${num(k + "2", v[2], { step })}</div>`;
}
function bindVec3(f, k, get, set) {
  for (let i = 0; i < 3; i++) {
    f.querySelector(`[data-k=${k}${i}]`).addEventListener("change", (e) => {
      const x = Number(e.target.value);
      if (!Number.isFinite(x)) return;
      const v = [...get()]; v[i] = x; set(v);
    });
  }
}
function bindSeg(f, k, get, set) {
  const seg = f.querySelector(`[data-k=${k}]`);
  const show = () => seg.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === get()));
  show();
  seg.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== get()) { set(b.dataset.v); show(); } });
}
/** LaTeX / Python の式の欄（複数）と、変換結果・誤りの表示。 */
function exprFields(add, el, changed, title, keys, help) {
  const f = add(title, `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
    ${keys.map(([k, label]) => `<div class="row"><span class="unit">${label}</span><input data-k="${k}" value="${escapeHtml(el[k] ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>`).join("")}
    <div class="field-note" data-k="note"></div>`, { top: true });
  const note = f.querySelector("[data-k=note]");
  bindSeg(f, "lang", () => el.lang, (v) => { el.lang = v; changed(el); });
  for (const [k] of keys) f.querySelector(`[data-k=${k}]`).addEventListener("input", (e) => { el[k] = e.target.value; changed(el); });
  const show = () => {
    const o = fabricObjectOf(el.id);
    const ng = !!o?.previewError;
    note.textContent = ng ? o.previewError.replace(/^.*?式: /, "式の誤り: ") : (el.lang === "latex" && o?.python ? `Python の式: ${[].concat(o.python).join(" , ")}` : `${help}${valuesNote()}`);
    note.className = `field-note${ng ? " ng" : ""}`;
  };
  show();
  const off = on("element-rendered", ({ el: r }) => { if (!document.body.contains(note)) return off(); if (r.id === el.id) show(); });
}
function colorRow(f, k, get, set) { bindColor(f, k, get, set); }

function fields3d(sec, el, add, changed) {
  const sh = el.shape;
  const axes = el.axesId ? findElement(el.axesId) : null;
  if (["surface", "curve3d"].includes(sh) || (sh === "point3d" && el.axesId)) {
    const fa = add("3D 座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button><div class="field-note">座標軸の座標で描き、座標軸と一緒に動きます。</div>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
    fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  }
  if (sh === "solid") {
    const fk = add("形", `<div class="seg" data-k="kind"><button type="button" data-v="sphere">球</button><button type="button" data-v="cube">立方体</button><button type="button" data-v="prism">直方体</button><button type="button" data-v="cone">円錐</button><button type="button" data-v="cylinder">円柱</button><button type="button" data-v="torus">トーラス</button></div>
      <div class="seg" data-k="kind2" style="margin-top:4px"><button type="button" data-v="tetrahedron">正四面体</button><button type="button" data-v="octahedron">正八面体</button><button type="button" data-v="dodecahedron">正十二面体</button><button type="button" data-v="icosahedron">正二十面体</button><button type="button" data-v="polyhedron">多面体</button><button type="button" data-v="hull">凸包</button></div>`);
    const setKind = (v) => {
      const wasPoly = POLY_KINDS.includes(el.solidKind);
      el.solidKind = v;
      if (POLY_KINDS.includes(v) && !wasPoly) { el.fill.opacity = 0.6; el.stroke.width = 1.5; }
      if (POLY_SIDES[v]) el.side = POLY_SIDES[v];
      // 多面体（頂点と面）・凸包にしたときは、初めの形を入れる（凸包から多面体にしたときは、面が無いので四角錐に戻す）
      if ((v === "polyhedron" || v === "hull") && (!(el.vertices ?? []).length || (v === "polyhedron" && !(el.faces ?? []).length))) Object.assign(el, defaultPolyShape(v));
      changed(el); reselect(el);
    };
    bindSeg(fk, "kind", () => el.solidKind, setKind);
    bindSeg(fk, "kind2", () => el.solidKind, setKind);
    const k = el.solidKind;
    const dims = POLY_KINDS.includes(k) ? (POLY_SIDES[k] ? `<div class="row"><span class="unit">一辺</span>${num("side", el.side, { step: 0.1, min: 0.01 })}</div>` : "")
      : k === "cube" ? `<div class="row"><span class="unit">一辺</span>${num("side", el.side, { step: 0.1, min: 0.01 })}</div>`
      : k === "prism" ? `<div class="row"><span class="unit">x</span>${num("d0", el.dims[0], { step: 0.1, min: 0.01 })}<span class="unit">y</span>${num("d1", el.dims[1], { step: 0.1, min: 0.01 })}<span class="unit">z</span>${num("d2", el.dims[2], { step: 0.1, min: 0.01 })}</div>`
        : `<div class="row"><span class="unit">${k === "torus" ? "大きい半径" : "半径"}</span>${num("r", el.radius, { step: 0.1, min: 0.01 })}${k === "torus" ? `<span class="unit">管の半径</span>${num("mr", el.minorRadius, { step: 0.05, min: 0.01 })}` : ""}${["cone", "cylinder"].includes(k) ? `<span class="unit">高さ</span>${num("h", el.height, { step: 0.1, min: 0.01 })}` : ""}</div>`;
    const fd = add("大きさ", `${dims}<div class="row"><span class="unit">倍率</span>${num("sc", el.scale, { step: 0.1, min: 0.01 })}</div>
      <div class="field-note">Manim の単位。キャンバスで角のハンドルを動かすと、倍率が変わります。</div>`, { top: true });
    const nb = (key, fn) => fd.querySelector(`[data-k=${key}]`)?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { fn(v); changed(el); } });
    nb("side", (v) => { el.side = v; }); nb("r", (v) => { el.radius = v; }); nb("mr", (v) => { el.minorRadius = v; }); nb("h", (v) => { el.height = v; }); nb("sc", (v) => { el.scale = v; });
    for (let i = 0; i < 3; i++) nb(`d${i}`, (v) => { el.dims = el.dims.map((x, j) => (j === i ? v : x)); });
    on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fd)) fd.querySelector("[data-k=sc]").value = el.scale; });
  }
  if (sh === "solid" && (el.solidKind === "polyhedron" || el.solidKind === "hull")) polyFields(el, add, changed);
  if (sh === "solid" && POLY_KINDS.includes(el.solidKind)) {
    const fv = add("頂点の点", `<label class="row"><input type="checkbox" data-k="sv" ${el.showVertices ? "checked" : ""}> 頂点に点を付ける</label><div class="row"><span class="unit">点の半径</span>${num("vr", el.vertexRadius ?? 0.06, { step: 0.01, min: 0.005 })}</div>
      <div class="field-note">辺は「辺」の色と太さ（0 で辺を描かない）、面は「面の色」で決めます。2 色目を選ぶと、面ごとに交互に塗ります。</div>`);
    fv.querySelector("[data-k=sv]").addEventListener("change", (e) => { el.showVertices = e.target.checked; changed(el); });
    fv.querySelector("[data-k=vr]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.vertexRadius = v; changed(el); } });
  }
  if (sh === "solid" || sh === "axes3d") {
    const fp = add("位置", `${vec3("p", el.pos3)}<div class="field-note">空間の座標（Manim の単位、z は手前が正）。キャンバスでドラッグすると、スライドのカメラから見た画面の向きに動きます。</div>`, { top: true });
    bindVec3(fp, "p", () => el.pos3, (v) => { el.pos3 = v; changed(el); });
    on("element-moved", (m) => { if (m === el && document.body.contains(fp)) el.pos3.forEach((v, i) => { fp.querySelector(`[data-k=p${i}]`).value = v; }); });
  }
  if (sh === "solid") {
    const fr = add("向き", `${vec3("r", el.rot3, 5)}<div class="field-note">x 軸・y 軸・z 軸のまわりに、この順で回す角度（度）。</div>`);
    bindVec3(fr, "r", () => el.rot3, (v) => { el.rot3 = v; changed(el); });
  }
  if (sh === "axes3d") {
    const rows = "xyz".split("").map((a) => `<div class="row"><span class="unit">${a}</span>${num(a + "Min", el[a + "Min"], { step: 1 })}<span class="unit">〜</span>${num(a + "Max", el[a + "Max"], { step: 1 })}<span class="unit">目盛り</span>${num(a + "Step", el[a + "Step"], { step: 0.5, min: 0.01 })}</div>`).join("");
    const fr = add("範囲", rows, { top: true });
    for (const a of "xyz") for (const t of ["Min", "Max", "Step"]) fr.querySelector(`[data-k=${a}${t}]`).addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[a + t] = v; changed(el); } });
    const fl = add("長さ", `<div class="row"><span class="unit">x</span>${num("xLen", el.xLen, { step: 0.5, min: 0.1 })}<span class="unit">y</span>${num("yLen", el.yLen, { step: 0.5, min: 0.1 })}<span class="unit">z</span>${num("zLen", el.zLen, { step: 0.5, min: 0.1 })}</div>`);
    for (const k of ["xLen", "yLen", "zLen"]) fl.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el[k] = v; changed(el); } });
    const fo = add("表示", `<label class="row"><input type="checkbox" data-k="tips" ${el.tips ? "checked" : ""}> 軸の先に矢印</label>
      <label class="row"><input type="checkbox" data-k="labels" ${el.labels ? "checked" : ""}> 軸ラベル</label>
      <div class="row"><span class="unit">x</span><input data-k="xl" value="${escapeHtml(el.xLabel)}" style="width:4em"><span class="unit">y</span><input data-k="yl" value="${escapeHtml(el.yLabel)}" style="width:4em"><span class="unit">z</span><input data-k="zl" value="${escapeHtml(el.zLabel)}" style="width:4em"></div>
      <div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>`);
    fo.querySelector("[data-k=tips]").addEventListener("change", (e) => { el.tips = e.target.checked; changed(el); });
    fo.querySelector("[data-k=labels]").addEventListener("change", (e) => { el.labels = e.target.checked; changed(el); });
    for (const [k, key] of [["xl", "xLabel"], ["yl", "yLabel"], ["zl", "zLabel"]]) fo.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => { el[key] = e.target.value; changed(el); });
    colorRow(fo, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
    fo.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
    const kids = currentSlide().elements.filter((g) => ["surface", "curve3d", "point3d"].includes(g.shape) && g.axesId === el.id);
    const fg = add("座標軸の上", `<ul class="content-list">${kids.map((g) => `<li><button type="button" class="link" data-pick="${g.id}">${escapeHtml(g.var)}</button><span class="grow hint">${escapeHtml(shapeLabel(g))}</span></li>`).join("") || `<li class="hint">（まだありません）</li>`}</ul>
      <div class="row"><button type="button" class="small" data-a="surface">＋曲面 z = f(x, y)</button><button type="button" class="small" data-a="psurface">＋媒介変数曲面</button><button type="button" class="small" data-a="curve3d">＋曲線</button><button type="button" class="small" data-a="dot">＋点</button><button type="button" class="small" data-a="arrow">＋矢印</button></div>`, { top: true });
    fg.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => select(b.dataset.pick)));
    fg.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => addTo3dAxes(el, b.dataset.a)));
  }
  if (sh === "surface") {
    const isParam = el.surfKind === "param";
    const fm = add("種類", `<div class="seg" data-k="sk"><button type="button" data-v="graph">z = f(x, y)</button><button type="button" data-v="param">媒介変数 (u, v)</button></div>`, { top: true });
    bindSeg(fm, "sk", () => el.surfKind ?? "graph", (v) => {
      el.surfKind = v;
      if (v === "param") { el.uMin ??= 0; el.uMax ??= 6.2832; el.vMin ??= 0; el.vMax ??= 3.1416; el.xExpr ??= "2\\cos u \\sin v"; el.yExpr ??= "2\\sin u \\sin v"; el.zExpr ??= "2\\cos v"; }
      else { el.uMin = el.uMax = el.vMin = el.vMax = null; }
      changed(el); reselect(el);
    });
    if (isParam) exprFields(add, el, changed, "式", [["xExpr", "x ="], ["yExpr", "y ="], ["zExpr", "z ="]], "u・v の式（座標軸の座標。Manim の Surface）。例: 球 2\\cos u \\sin v、2\\sin u \\sin v、2\\cos v。スライドの値も使えます。");
    else exprFields(add, el, changed, "式", [["expr", "z ="]], "x・y の式。例: \\sin x \\cos y、\\frac{x^2 - y^2}{4}。");
    const fr = add("範囲", `<div class="row"><span class="unit">${isParam ? "u" : "x"}</span>${num("u0", el.uMin ?? "", { step: 0.5 })}<span class="unit">〜</span>${num("u1", el.uMax ?? "", { step: 0.5 })}</div>
      <div class="row"><span class="unit">${isParam ? "v" : "y"}</span>${num("v0", el.vMin ?? "", { step: 0.5 })}<span class="unit">〜</span>${num("v1", el.vMax ?? "", { step: 0.5 })}</div><div class="field-note">${isParam ? "媒介変数 u・v の範囲（2π ≒ 6.2832、π ≒ 3.1416）。" : "空欄なら座標軸の範囲。"}</div>`);
    for (const [k, key] of [["u0", "uMin"], ["u1", "uMax"], ["v0", "vMin"], ["v1", "vMax"]]) fr.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => {
      if (isParam && e.target.value === "") return;
      el[key] = e.target.value === "" ? null : Number(e.target.value); changed(el);
    });
    const fc = add("色", `<div class="seg" data-k="cm"><button type="button" data-v="checker">市松</button><button type="button" data-v="single">1 色</button><button type="button" data-v="height">高さで塗り分け</button></div>
      <div class="row">${colorInput("c1", el.fill.color)}</div><div class="row" data-k="c2row">${colorInput("c2", el.color2 || "#236B8E")}</div>
      <div class="row"><span class="unit">不透明度</span><input type="range" data-k="op" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>
      <div class="row"><span class="unit">網目</span>${colorInput("mc", el.stroke.color)}<span class="unit">太さ</span>${num("mw", el.stroke.width, { step: 0.25, min: 0 })}</div>`);
    const c2row = fc.querySelector("[data-k=c2row]");
    const showC2 = () => { c2row.hidden = el.colorMode !== "checker"; };
    showC2();
    bindSeg(fc, "cm", () => el.colorMode, (v) => { el.colorMode = v; showC2(); changed(el); });
    colorRow(fc, "c1", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
    colorRow(fc, "c2", () => el.color2, (v) => { el.color2 = v; changed(el); });
    colorRow(fc, "mc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
    fc.querySelector("[data-k=op]").addEventListener("input", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
    fc.querySelector("[data-k=mw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  }
  if (sh === "curve3d") {
    exprFields(add, el, changed, "式", [["xExpr", "x ="], ["yExpr", "y ="], ["zExpr", "z ="]], "t の式（座標軸の座標）。例: \\cos t、\\sin t、\\frac{t}{4}。");
    const ft = add("t の範囲", `<div class="row">${num("t0", el.tMin, { step: 0.5 })}<span class="unit">〜</span>${num("t1", el.tMax, { step: 0.5 })}</div>
      <div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>`);
    ft.querySelector("[data-k=t0]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.tMin = v; changed(el); } });
    ft.querySelector("[data-k=t1]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.tMax = v; changed(el); } });
    colorRow(ft, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
    ft.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  }
  if (sh === "point3d") {
    const fk = add("種類", `<div class="seg" data-k="pk"><button type="button" data-v="dot">点</button><button type="button" data-v="line">線</button><button type="button" data-v="arrow">矢印</button></div>`);
    bindSeg(fk, "pk", () => el.pointKind, (v) => { el.pointKind = v; el.size = v === "dot" ? 0.1 : 0.02; changed(el); reselect(el); });
    const isDot = el.pointKind === "dot";
    // 座標は数か式（スライドの値を使うと、値に合わせて動く）
    const ex3 = (k, v) => `<div class="row"><span class="unit">x</span><input data-k="${k}0" value="${escapeHtml(String(v[0]))}" spellcheck="false" style="width:5.2em;font-family:var(--mono)"><span class="unit">y</span><input data-k="${k}1" value="${escapeHtml(String(v[1]))}" spellcheck="false" style="width:5.2em;font-family:var(--mono)"><span class="unit">z</span><input data-k="${k}2" value="${escapeHtml(String(v[2]))}" spellcheck="false" style="width:5.2em;font-family:var(--mono)"></div>`;
    const fp = add(isDot ? "位置" : "始点・終点", `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
      ${isDot ? "" : `<div class="field-note">始点</div>`}${ex3("a", el.p1)}${isDot ? "" : `<div class="field-note">終点</div>${ex3("b", el.p2)}`}
      <div class="field-note" data-k="note"></div>`, { top: true });
    const note = fp.querySelector("[data-k=note]");
    const help = () => `${el.axesId ? "座標軸の座標。" : "空間の座標（Manim の単位）。"}数か式で書きます。${valuesNote() || "スライドの値を作って式に書くと（例: t、\\cos t）、値に合わせて動きます。"}${el.axesId ? "" : "式を使うと、キャンバスのドラッグでは動かせません。"}`;
    const showNote = () => {
      const o = fabricObjectOf(el.id);
      const ng = !!o?.previewError;
      note.textContent = ng ? o.previewError.replace(/^.*?式: /, "式の誤り: ") : help();
      note.className = `field-note${ng ? " ng" : ""}`;
    };
    showNote();
    const offN = on("element-rendered", ({ el: r }) => { if (!document.body.contains(note)) return offN(); if (r.id === el.id) showNote(); });
    bindSeg(fp, "lang", () => el.lang ?? "latex", (v) => { el.lang = v; changed(el); });
    const parse = (t) => { const x = t.trim(); return x !== "" && Number.isFinite(Number(x)) ? Number(x) : (x || 0); };
    for (const [k, key] of [["a", "p1"], ["b", "p2"]]) {
      for (let i = 0; i < 3; i++) {
        fp.querySelector(`[data-k=${k}${i}]`)?.addEventListener("change", (e) => {
          const v = [...el[key]]; v[i] = parse(e.target.value); el[key] = v;
          const hasExpr = [...el.p1, ...el.p2].some((x) => typeof x === "string");
          changed(el);
          if (hasExpr !== !!fp.dataset.expr) reselect(el); // ドラッグの可否が変わる
        });
      }
    }
    fp.dataset.expr = [...el.p1, ...el.p2].some((x) => typeof x === "string") ? "1" : "";
    on("element-moved", (m) => {
      if (m !== el || !document.body.contains(fp)) return;
      el.p1.forEach((v, i) => { fp.querySelector(`[data-k=a${i}]`).value = v; });
      if (!isDot) el.p2.forEach((v, i) => { fp.querySelector(`[data-k=b${i}]`).value = v; });
    });
    const fs = add("見た目", `<div class="row">${colorInput("c", el.fill.color)}<span class="unit">${isDot ? "半径" : "太さ"}</span>${num("sz", el.size, { step: isDot ? 0.02 : 0.005, min: 0.001 })}</div>`);
    colorRow(fs, "c", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
    fs.querySelector("[data-k=sz]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.size = v; changed(el); } });
  }
  if (sh === "solid") {
    const isPoly = POLY_KINDS.includes(el.solidKind);
    const fc = add(isPoly ? "面の色・辺" : "色", `<div class="row">${colorInput("c1", el.fill.color)}</div>
      <label class="row"><input type="checkbox" data-k="ck" ${el.color2 ? "checked" : ""}> ${isPoly ? "面ごとに交互に塗る（2 色目）" : "市松模様（2 色目）"}</label><div class="row" data-k="c2row">${colorInput("c2", el.color2 || "#236B8E")}</div>
      <div class="row"><span class="unit">不透明度</span><input type="range" data-k="op" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>
      <div class="row"><span class="unit">${isPoly ? "辺" : "網目の線"}</span>${colorInput("mc", el.stroke.color)}<span class="unit">太さ</span>${num("mw", el.stroke.width, { step: 0.5, min: 0 })}</div>`);
    const c2row = fc.querySelector("[data-k=c2row]");
    c2row.hidden = !el.color2;
    fc.querySelector("[data-k=ck]").addEventListener("change", (e) => { el.color2 = e.target.checked ? (el.color2Memo || "#236B8E") : null; if (!e.target.checked) el.color2Memo = null; c2row.hidden = !e.target.checked; changed(el); });
    colorRow(fc, "c1", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
    colorRow(fc, "c2", () => el.color2, (v) => { el.color2 = v; changed(el); });
    colorRow(fc, "mc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
    fc.querySelector("[data-k=op]").addEventListener("input", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
    fc.querySelector("[data-k=mw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  }
  if (["solid", "surface", "point3d"].includes(sh) && !(sh === "solid" && ["cube", "prism", ...POLY_KINDS].includes(el.solidKind))) {
    const fq = add("細かさ", `${QUALITY_SEG}<div class="field-note">細かいほど、なめらかになりますが、描画に時間がかかります。</div>`);
    bindSeg(fq, "q", () => el.quality, (v) => { el.quality = v; changed(el); });
  }
  const fn = document.createElement("p");
  fn.className = "hint";
  fn.textContent = "キャンバスには、スライドの初めのカメラの向きから見た形を、Manim で描いて表示します。3D の物どうしの重なりは、描画ではカメラからの距離で決まります（レイヤーの順は使いません）。";
  sec.appendChild(fn);
}


// ---------------------------------------------------------------- SVG

function svgFields(sec, el, add, changed) {
  const u = P();
  const ff = add("ファイル", `<div class="row"><span class="grow hint" style="overflow-wrap:anywhere">${escapeHtml(el.path)}</span><button type="button" class="small" data-a="rep">差し替え…</button></div>
    <div class="field-note">Manim の SVGMobject で、図形として描きます（拡大してもぼやけません）。SVG の中の文字（text）・埋め込み画像は表示されず、グラデーションは単色になります。</div>`, { top: true });
  ff.querySelector("[data-a=rep]").addEventListener("click", async () => {
    const [file] = await pickImageFiles({ multiple: false });
    if (!file) return;
    try { await replaceImage(el, file); reselect(el); } catch (e) { toast(e.message, "ng"); }
  });
  const natH = () => el.width * el.natH / el.natW;
  const fs = add("大きさ", `<div class="row"><span class="unit">幅</span>${num("w", r2(el.width / u), { step: 0.1, min: 0.01 })}<span class="unit">高さ</span>${num("h", r2(el.height / u), { step: 0.1, min: 0.01 })}</div>
    <label class="row"><input type="checkbox" data-k="keep" ${el.keepAspect ? "checked" : ""}> 縦横比を固定</label>
    <div class="row"><button type="button" class="small" data-a="nat">元の縦横比</button></div>
    <div class="field-note">Manim の単位。キャンバスでは角のハンドルで${el.keepAspect ? "" : "、辺の中央のハンドルで横だけ・縦だけ"}変えます。</div>`, { top: true });
  const iw = fs.querySelector("[data-k=w]"), ih = fs.querySelector("[data-k=h]");
  iw.addEventListener("change", () => { const v = Number(iw.value) * u; if (!(v > 0)) return; if (el.keepAspect) el.height *= v / el.width; el.width = v; ih.value = r2(el.height / u); changed(el); });
  ih.addEventListener("change", () => { const v = Number(ih.value) * u; if (!(v > 0)) return; if (el.keepAspect) el.width *= v / el.height; el.height = v; iw.value = r2(el.width / u); changed(el); });
  fs.querySelector("[data-k=keep]").addEventListener("change", (e) => { el.keepAspect = e.target.checked; if (el.keepAspect) el.height = natH(); changed(el); reselect(el); });
  fs.querySelector("[data-a=nat]").addEventListener("click", () => { el.height = natH(); ih.value = r2(el.height / u); changed(el); });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(iw)) { iw.value = r2(el.width / u); ih.value = r2(el.height / u); } });
  const fc = add("色", `<div class="seg" data-k="cm"><button type="button" data-v="original">元の色</button><button type="button" data-v="single">1 色にする</button></div>
    <div class="row" data-k="fcrow">${colorInput("fc", el.fill?.color || el.stroke.color)}</div>
    <label class="row"><input type="checkbox" data-k="so" ${el.strokeOverride ? "checked" : ""}> 線の色・太さをそろえる</label>
    <div class="row" data-k="srow">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <div class="row"><span class="unit">不透明度</span><input type="range" data-k="op" min="0" max="100" step="5" value="${Math.round((el.opacity ?? 1) * 100)}"></div>`);
  const fcrow = fc.querySelector("[data-k=fcrow]"), srow = fc.querySelector("[data-k=srow]");
  const show = () => { fcrow.hidden = el.colorMode !== "single"; srow.hidden = !el.strokeOverride; };
  show();
  bindSeg(fc, "cm", () => el.colorMode, (v) => { el.colorMode = v; show(); changed(el); });
  bindColor(fc, "fc", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
  bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fc.querySelector("[data-k=so]").addEventListener("change", (e) => { el.strokeOverride = e.target.checked; show(); changed(el); });
  fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fc.querySelector("[data-k=op]").addEventListener("input", (e) => { el.opacity = Number(e.target.value) / 100; changed(el); });
}


// ---------------------------------------------------------------- 行列・角・グラフの補助・曲線

function matrixFields(sec, el, add, changed) {
  cellGridFields(el, add, changed, "セルは LaTeX（数式）で書きます。");
  const fb = add("かっこ", `<div class="seg" data-k="br"><button type="button" data-v="[]">[ ]</button><button type="button" data-v="()">( )</button><button type="button" data-v="||">| |（行列式）</button><button type="button" data-v="{}">{ }</button><button type="button" data-v="none">なし</button></div>`);
  bindSeg(fb, "br", () => el.bracket, (v) => { el.bracket = v; changed(el); });
  const ft = add("文字", `<div class="row"><span class="unit">大きさ</span>${num("fs", el.fontSize, { step: 2, min: 2 })}${colorInput("tc", el.color)}</div>
    <div class="row"><span class="unit">すき間 横</span>${num("hb", el.hBuff, { step: 0.05, min: 0 })}<span class="unit">縦</span>${num("vb", el.vBuff, { step: 0.05, min: 0 })}</div>
    <div class="field-note">成分どうしのすき間（Manim の単位）。間隔は、いちばん大きい成分に合わせて決めます。</div>`);
  ft.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  bindColor(ft, "tc", () => el.color, (v) => { el.color = v; changed(el); });
  ft.querySelector("[data-k=hb]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.hBuff = v; changed(el); } });
  ft.querySelector("[data-k=vb]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.vBuff = v; changed(el); } });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(ft)) ft.querySelector("[data-k=fs]").value = el.fontSize; });
}

/** 円周上の点: 角度（右が 0°、反時計回り）と、円から外すボタン。 */
function onCircleFields(el, add, changed) {
  const c = findElement(el.onCircle.id);
  const f = add("円周上", c ? `<div class="row"><button type="button" class="link" data-a="c">${escapeHtml(c.var)}</button><span class="unit">の</span>${num("oa", el.onCircle.angle, { step: 5 })}<span class="unit">°</span></div>
    <div class="row"><button type="button" class="small" data-a="off">円から外す</button></div>
    <div class="field-note">右（x 軸の正の向き）が 0°、反時計回りが正。点をドラッグすると円周に沿って動き、円を動かす・大きさを変えると点もついていきます。</div>`
    : `<span class="field-note ng">付けた円が見つかりません（ふつうの点として描きます）</span> <button type="button" class="small" data-a="off">円から外す</button>`, { top: true });
  f.querySelector("[data-a=c]")?.addEventListener("click", () => select(c.id));
  f.querySelector("[data-k=oa]")?.addEventListener("change", async (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    const { onCirclePos } = await import("./construct.js");
    el.onCircle = { ...el.onCircle, angle: v };
    const p = onCirclePos(c, v);
    if (p) { el.x = p[0]; el.y = p[1]; }
    changed(el);
    emit("element-moved", el);
  });
  f.querySelector("[data-a=off]").addEventListener("click", () => { delete el.onCircle; changed(el); reselect(el); });
}

// 点の名前の位置: 3×3 のボタン（真ん中は「自動」）
const PNAME_GRID = [["ul", "↖"], ["u", "↑"], ["ur", "↗"], ["l", "←"], ["auto", "自動"], ["r", "→"], ["dl", "↙"], ["d", "↓"], ["dr", "↘"]];

/** 点の外側の名前（A・B・P）。位置は 8 方向・自動（円の外向き・線から離れる向き）・自由（キャンバスのオレンジの丸をドラッグ）。 */
function pointNameFields(el, add, changed) {
  const free = el.pnamePos === "free";
  const f = add("名前", `<div class="row"><input data-k="pn" value="${escapeHtml(el.pname ?? "")}" spellcheck="false" placeholder="例: A、P'、O_1（空欄なら無し）" style="flex:1"></div>
    <div class="pname-grid">${PNAME_GRID.map(([k, t]) => `<button type="button" data-v="${k}" class="${el.pnamePos === k ? "on" : ""}" title="${k === "auto" ? "自動（円の外向き・線から離れる向き）" : "この向きに置く"}">${t}</button>`).join("")}</div>
    ${free ? `<div class="field-note">いまは<b>自由</b>（ドラッグで置いた位置）です。向きのボタンを押すと、その向きに戻ります。</div>` : ""}
    <div class="row"><span class="unit">大きさ</span>${num("pns", el.pnameSize ?? 36, { step: 2, min: 2 })}${colorInput("pnc", el.pnameColor ?? store.project.settings.defaultColor ?? "#222222")}</div>
    <div class="field-note">点の外側に置く名前（数式）。点の一部なので、点と一緒に出る・動きます。キャンバスでは、名前の上のオレンジの丸をドラッグして好きな所に置けます。「自動」は、円の上の点なら円の外向き、線の端の点なら線から離れる向きに置きます。</div>`, { top: true });
  f.querySelector("[data-k=pn]").addEventListener("change", (e) => {
    el.pname = e.target.value.trim();
    if (el.pname && !el.pnamePos) el.pnamePos = "auto";
    changed(el); reselect(el);
  });
  f.querySelectorAll(".pname-grid button").forEach((b) => b.addEventListener("click", () => { el.pnamePos = b.dataset.v; changed(el); reselect(el); }));
  f.querySelector("[data-k=pns]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.pnameSize = v; changed(el); } });
  bindColor(f, "pnc", () => el.pnameColor ?? store.project.settings.defaultColor ?? "#222222", (v) => { el.pnameColor = v; changed(el); });
}

const ANGLE_QS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

/** 「どの角」のボタンの図: 2 本の線と、その角（180° 未満の側）を塗った扇形。geom は angleGeom の結果（Manim の向き）。 */
function angleIcon(geom, q, n) {
  if (!geom) return String(n);
  const c = 13, r = 11, f = (v) => v.toFixed(2);
  const d1 = [geom.u1[0] * q[0], -geom.u1[1] * q[0]], d2 = [geom.u2[0] * q[1], -geom.u2[1] * q[1]]; // SVG（y は下が正）
  const line = (u) => `<line x1="${f(c - u[0] * r)}" y1="${f(c - u[1] * r)}" x2="${f(c + u[0] * r)}" y2="${f(c + u[1] * r)}"/>`;
  const p = (u) => `${f(c + u[0] * 9)} ${f(c + u[1] * 9)}`;
  // 画面で反時計回り（SVG の sweep 0）に 1 本目→2 本目の角が 180° 以下なら、その順に描く
  const small = angleCcw(geom, q) <= Math.PI;
  const [a, b] = small ? [d1, d2] : [d2, d1];
  return `<svg class="angle-ico" width="26" height="26" viewBox="0 0 26 26" aria-label="${n}"><g stroke="currentColor" stroke-width="1.3" opacity="0.55">${line(geom.u1.map((v, i) => (i ? -v : v)))}${line(geom.u2.map((v, i) => (i ? -v : v)))}</g>`
    + `<path d="M${c} ${c} L${p(a)} A9 9 0 0 0 ${p(b)} Z" fill="currentColor" opacity="0.85"/></svg>`;
}

function angleFields(sec, el, add, changed) {
  const l1 = findElement(el.line1Id), l2 = findElement(el.line2Id);
  const fl = add("線", l1 && l2 ? `<button type="button" class="link" data-a="l1">${escapeHtml(l1.var)}</button> と <button type="button" class="link" data-a="l2">${escapeHtml(l2.var)}</button><div class="field-note">2 本の線（を延ばした直線）の交わる所に付けます。線を動かすと、角もついてきます。</div>` : `<span class="field-note ng">線が見つかりません</span>`);
  fl.querySelector("[data-a=l1]")?.addEventListener("click", () => select(l1.id));
  fl.querySelector("[data-a=l2]")?.addEventListener("click", () => select(l2.id));
  const tan = el.angleKind === "tangent";
  const geom = angleGeom(l1, l2);
  const reflexNow = angleIsReflex(el, geom);
  const fk = add("種類", `<div class="seg" data-k="k"><button type="button" data-v="angle">角（弧）</button><button type="button" data-v="right">直角の印</button><button type="button" data-v="tangent">角を丸める弧</button></div>
    <div class="row"><span class="unit">${el.angleKind === "right" ? "大きさ" : "半径"}</span>${num("r", el.radius, { step: 0.05, min: 0.01 })}</div>
    <div class="row"><span class="unit">どの角</span><div class="seg angle-q" data-k="q">${ANGLE_QS.map((q, i) => `<button type="button" data-v="${q.join(",")}" title="${i + 1}">${angleIcon(geom, q, i + 1)}</button>`).join("")}</div></div>
    <label class="row" ${tan ? "hidden" : ""}><input type="checkbox" data-k="reflex" ${reflexNow ? "checked" : ""}> 外側の角（180° を超える角）</label>
    <label class="row" ${tan ? "hidden" : ""}><input type="checkbox" data-k="dot" ${el.dot ? "checked" : ""}> 点を付ける</label>
    <div class="field-note">2 本の直線が交わってできる 4 つの角のうち、どれに付けるかを「どの角」の図で選びます（図は今の線の向きです。Manim の quadrant）。
      ${tan ? "角を丸める弧は、その角で 2 本の線に接する、半径の決まった弧です（TangentialArc）。" : "線を動かしても、内側（180° 未満）・外側の指定は保たれます。"}</div>`, { top: true });
  bindSeg(fk, "k", () => el.angleKind, (v) => { el.angleKind = v; el.radius = v === "right" ? 0.3 : v === "tangent" ? 0.6 : 0.5; changed(el); reselect(el); });
  // 古いプロジェクトの角（reflex の指定が無い）は、触ったときに今の見た目のまま新しい指定に移す
  const adopt = () => { if (typeof el.reflex !== "boolean") { el.reflex = angleIsReflex(el, geom); el.other = false; } };
  bindSeg(fk, "q", () => el.quadrant.join(","), (v) => { adopt(); el.quadrant = v.split(",").map(Number); changed(el); });
  fk.querySelector("[data-k=r]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.radius = v; changed(el); } });
  fk.querySelector("[data-k=reflex]").addEventListener("change", (e) => { adopt(); el.reflex = e.target.checked; el.other = false; changed(el); });
  fk.querySelector("[data-k=dot]").addEventListener("change", (e) => { el.dot = e.target.checked; changed(el); });
  const fb = add("ラベル", `<div class="row"><input data-k="label" value="${escapeHtml(el.label)}" spellcheck="false" placeholder="例: \\theta、90^\\circ（空欄なら無し）" style="flex:1"></div>
    <div class="row"><span class="unit">大きさ</span>${num("ls", el.labelSize, { step: 2, min: 2 })}</div>
    <div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>`);
  fb.querySelector("[data-k=label]").addEventListener("change", (e) => { el.label = e.target.value; changed(el); });
  fb.querySelector("[data-k=ls]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  bindColor(fb, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fb.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
}

function graphPartFields(sec, el, add, changed) {
  const g = findElement(el.graphId);
  const fg = add("グラフ", g ? `<button type="button" class="link" data-a="g">${escapeHtml(g.var)}</button><span class="hint"> y = ${escapeHtml(g.expr)}</span>` : `<span class="field-note ng">グラフが見つかりません</span>`);
  fg.querySelector("[data-a=g]")?.addEventListener("click", () => select(g.id));
  const k = el.partKind;
  // 数か式（スライドの値を使うと、値に合わせて変わる。例: Δx に h）
  const tin = (key) => `<input data-k="${key}" value="${escapeHtml(String(el[key]))}" spellcheck="false" style="width:5.5em;font-family:var(--mono)">`;
  const nf = (key, label) => `<span class="unit">${label}</span>${tin(key)}`;
  const html = {
    area: `<div class="row">${nf("x0", "x")}<span class="unit">〜</span>${tin("x1")}</div>`,
    riemann: `<div class="row">${nf("x0", "x")}<span class="unit">〜</span>${tin("x1")}</div><div class="row">${nf("dx", "幅")}<div class="seg" data-k="smp"><button type="button" data-v="left">左</button><button type="button" data-v="center">中央</button><button type="button" data-v="right">右</button></div></div>`,
    tangent: `<div class="row">${nf("atX", "x =")}${nf("length", "長さ")}</div><label class="row"><input type="checkbox" data-k="dot" ${el.dot ? "checked" : ""}> 接点に点</label>`,
    secant: `<div class="row">${nf("atX", "x =")}${nf("dx", "Δx")}</div><label class="row"><input type="checkbox" data-k="legs" ${el.legs ? "checked" : ""}> Δx・Δy の線</label>`,
    derivative: `<div class="row">${nf("x0", "x")}<span class="unit">〜</span>${tin("x1")}</div>`,
    antiderivative: `<div class="row">${nf("x0", "x")}<span class="unit">〜</span>${tin("x1")}</div><div class="row">${nf("c", "F(0) =")}</div>`,
    glabel: `<div class="row">${nf("atX", "x =")}</div>${dirSeg()}<label class="row"><input type="checkbox" data-k="dot" ${el.dot ? "checked" : ""}> その位置に点</label>`,
    tlabel: `<div class="row">${nf("atX", "x =")}</div><div class="row"><span class="unit">三角の大きさ</span>${num("ts", el.triangleSize ?? 0.25, { step: 0.05, min: 0.02 })}</div>`,
  }[k];
  const fr = add({ area: "面積", riemann: "リーマン和", tangent: "接線", secant: "割線", derivative: "導関数のグラフ", antiderivative: "原始関数のグラフ", glabel: "グラフのラベル", tlabel: "T 字ラベル" }[k], `${html}<div class="field-note">${{ area: el.graph2Id ? "2 つのグラフの間を塗ります（get_area の bounded_graph）。" : "グラフと x 軸の間を塗ります。",
    derivative: "グラフの式を微分したグラフ（plot_derivative_graph）。空欄なら座標軸の端まで。",
    antiderivative: "グラフの式を積分したグラフ（plot_antiderivative_graph）。F(0) の値で上下の位置が決まります。",
    glabel: "グラフの x の位置にラベルを付けます（get_graph_label）。方向はラベルを置く向き。",
    tlabel: "x 軸の上の x の位置に、三角の目印と縦の線とラベル（get_T_label）。", riemann: "区間を幅ごとに分けた長方形。高さは左端・中央・右端の値。", tangent: "長さは画面の単位。", secant: "x と x + Δx の 2 点を通る直線。Δx を小さくすると接線に近づきます。" }[k]}${valuesNote() ? ` グラフの式に値を使っていれば、値に合わせて変わります。` : ""}</div>`, { top: true });
  for (const key of ["x0", "x1", "dx", "atX", "length", "c"]) {
    fr.querySelector(`[data-k=${key}]`)?.addEventListener("change", (e) => {
      const t = e.target.value.trim();
      el[key] = t !== "" && Number.isFinite(Number(t)) ? Number(t) : (t || el[key]);
      changed(el);
    });
  }
  const pnote = document.createElement("div");
  pnote.className = "field-note";
  pnote.textContent = `数のほかに、スライドの値を使った式も書けます（LaTeX の書き方。例: Δx に h、x に a + 1）。${valuesNote() || "値はスライドのパネルで作ります。"}ステップで self.play(h.animate.set_value(0.01), run_time=3) のように値を動かすと、割線が接線に近づくアニメーションなどになります。`;
  fr.lastElementChild.appendChild(pnote);
  const showErr = () => {
    const o = fabricObjectOf(el.id);
    pnote.classList.toggle("ng", !!o?.previewError);
    if (o?.previewError) pnote.textContent = o.previewError.replace(/^.*?式: /, "式の誤り: ");
  };
  showErr();
  const offE = on("element-rendered", ({ el: r }) => { if (!document.body.contains(pnote)) return offE(); if (r.id === el.id) showErr(); });
  if (k === "riemann") bindSeg(fr, "smp", () => el.sample, (v) => { el.sample = v; changed(el); });
  if (k === "glabel") bindSeg(fr, "dir", () => el.direction, (v) => { el.direction = v; changed(el); });
  fr.querySelector("[data-k=ts]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.triangleSize = v; changed(el); } });
  if (k === "area") {
    // もう 1 つのグラフ（同じ座標軸の上のグラフ）
    const others = currentSlide().elements.filter((x) => x.shape === "graph" && x.id !== el.graphId && g && x.axesId === g.axesId && !["polar", "complex"].includes(x.graphKind));
    const fa = add("もう 1 つのグラフ", `<div class="row"><select data-k="g2"><option value="">（x 軸との間）</option>${others.map((x) => `<option value="${x.id}" ${x.id === el.graph2Id ? "selected" : ""}>${escapeHtml(x.var)}  y = ${escapeHtml(x.expr)}</option>`).join("")}</select></div>
      <div class="field-note">選ぶと、2 つのグラフの間を塗ります。同じ座標軸のグラフから選べます。</div>`);
    fa.querySelector("[data-k=g2]").addEventListener("change", (e) => { el.graph2Id = e.target.value || ""; changed(el); reselect(el); });
  }
  if (k === "glabel" || k === "tlabel") {
    const fl = add("ラベル", `<div class="row"><input data-k="lb" value="${escapeHtml(el.label ?? "")}" spellcheck="false" placeholder="例: f(x)、x_0（LaTeX）" style="flex:1"></div>
      <div class="row"><span class="unit">大きさ</span>${num("lsz", el.labelSize ?? 36, { step: 2, min: 2 })}</div>`);
    fl.querySelector("[data-k=lb]").addEventListener("change", (e) => { el.label = e.target.value; changed(el); });
    fl.querySelector("[data-k=lsz]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  }
  fr.querySelector("[data-k=dot]")?.addEventListener("change", (e) => { el.dot = e.target.checked; changed(el); });
  fr.querySelector("[data-k=legs]")?.addEventListener("change", (e) => { el.legs = e.target.checked; changed(el); });
  if (k === "area" || k === "riemann") {
    const fc = add("色", `<div class="row">${colorInput("c1", el.fill.color)}${k === "riemann" ? colorInput("c2", el.color2) : ""}</div>
      <div class="row"><span class="unit">不透明度</span><input type="range" data-k="op" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>
      ${k === "riemann" ? `<div class="row"><span class="unit">枠</span>${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>` : ""}`);
    bindColor(fc, "c1", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
    if (k === "riemann") {
      bindColor(fc, "c2", () => el.color2, (v) => { el.color2 = v; changed(el); });
      bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
      fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
    }
    fc.querySelector("[data-k=op]").addEventListener("input", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
  } else if (k === "tlabel") {
    const fc = add("色", `<div class="row"><span class="unit">三角・ラベル</span>${colorInput("sc", el.stroke.color)}</div>`);
    bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  } else if (k === "glabel") {
    const fc = add("色", `<div class="row">${colorInput("sc", el.stroke.color)}</div>`);
    bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  } else {
    const derived = k === "derivative" || k === "antiderivative";
    const fc = add("線", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
      ${derived ? `<label class="row"><input type="checkbox" data-k="dash" ${el.dashed ? "checked" : ""}> 破線</label>` : ""}`);
    bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
    fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
    fc.querySelector("[data-k=dash]")?.addEventListener("change", (e) => { el.dashed = e.target.checked; changed(el); });
    if (derived) gradientFields(el, add, changed);
  }
}

function dirSeg() {
  return `<div class="seg" data-k="dir">${[["UL", "↖"], ["UP", "↑"], ["UR", "↗"], ["LEFT", "←"], ["RIGHT", "→"], ["DL", "↙"], ["DOWN", "↓"], ["DR", "↘"]].map(([v, t]) => `<button type="button" data-v="${v}" title="${v}">${t}</button>`).join("")}</div>`;
}

/** 線のグラデーション（色が線に沿って変わる）。el.gradient = null か 2〜4 色。 */
function gradientFields(el, add, changed) {
  const cols = el.gradient ?? [];
  const f = add("グラデーション", `<label class="row"><input type="checkbox" data-k="gon" ${cols.length ? "checked" : ""}> 線に沿って色を変える</label>
    ${cols.length ? `<div class="row">${cols.map((c, i) => colorInput(`gc${i}`, c)).join("")}</div>
    <div class="row">${cols.length < 4 ? `<button type="button" class="small" data-a="gadd">＋色</button>` : ""}${cols.length > 2 ? `<button type="button" class="small" data-a="gdel">－色</button>` : ""}</div>` : ""}
    <div class="field-note">始点から終点に向かって色が変わります（Manim の set_color_by_gradient。CurvesAsSubmobjects で線を細かく分けて塗ります）。</div>`);
  f.querySelector("[data-k=gon]").addEventListener("change", (e) => {
    el.gradient = e.target.checked ? [el.stroke.color || "#58C4DD", "#FC6255"] : null;
    changed(el); reselect(el);
  });
  cols.forEach((_, i) => bindColor(f, `gc${i}`, () => el.gradient[i], (v) => { el.gradient[i] = v; changed(el); }));
  f.querySelector("[data-a=gadd]")?.addEventListener("click", () => { el.gradient.push("#FFFF00"); changed(el); reselect(el); });
  f.querySelector("[data-a=gdel]")?.addEventListener("click", () => { el.gradient.pop(); changed(el); reselect(el); });
}

// ---------------------------------------------------------------- 計算した点列

const POINT_SOURCES = [["code", "Python のコード"], ["ode", "微分方程式の数値解"], ["integral", "数値積分（長方形・台形）"], ["montecarlo", "モンテカルロ法（円周率）"], ["trials", "くり返しの試行"]];

function pointsFields(sec, el, add, changed) {
  const axes = findElement(el.axesId);
  const P = el.params ?? (el.params = {});
  const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
  fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  const fs = add("計算", `<select data-k="src">${POINT_SOURCES.map(([k, l]) => `<option value="${k}" ${k === el.source ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="field-note">描画（と、このプレビュー）のときに 1 回だけ計算します。乱数は「乱数の種」で決まるので、毎回同じ図になります。</div>`, { top: true });
  fs.querySelector("[data-k=src]").addEventListener("change", (e) => {
    el.source = e.target.value;
    if (el.source === "montecarlo") { el.style = "scatter"; el.dotRadius = 0.03; P.n = P.n ?? 500; }
    if (el.source === "integral") { P.n = 8; P.f = P.f ?? "\\frac{x^2}{2}"; }
    changed(el); reselect(el);
  });
  const numIn = (k, label, v, o = {}) => `<span class="unit">${label}</span>${num(k, v, o)}`;
  const bindNum = (f, keys, int = false) => keys.forEach((k) => f.querySelector(`[data-k=${k}]`)?.addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) { P[k] = int ? Math.round(v) : v; changed(el); }
  }));
  const fexpr = (title, vars) => {
    const f = add(title, `<div class="seg" data-k="lang"><button type="button" data-v="latex">LaTeX</button><button type="button" data-v="python">Python</button></div>
      <div class="row"><input data-k="f" value="${escapeHtml(P.f ?? "")}" spellcheck="false" style="flex:1;font-family:var(--mono)"></div>
      <div class="field-note">${vars} の式。LaTeX（\\sin x、\\frac{x^2}{2} など）か Python（np.sin(x) や sin(x)）で書きます。</div>`, { top: true });
    bindSeg(f, "lang", () => P.lang ?? "latex", (v) => { P.lang = v; changed(el); });
    f.querySelector("[data-k=f]").addEventListener("change", (e) => { P.f = e.target.value; changed(el); });
  };
  if (el.source === "code") {
    const f = add("コード", `<textarea data-k="code" rows="${Math.min(14, Math.max(4, (el.code ?? "").split("\n").length + 1))}" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px;white-space:pre">${escapeHtml(el.code ?? "")}</textarea>
      <div class="row">${numIn("seed", "乱数の種", P.seed ?? 1, { step: 1, min: 0 })}</div>
      <div class="field-note">変数 <code>pts</code> に (x, y) の並び（座標軸の座標）を入れます。(x, y, 1) のように 3 つ目に 1 を書いた点は、2 つ目の色になります。
        np（numpy）・math・random・rng（numpy の乱数）・sin などが使えます。例: オイラー法のくり返し、ソートの途中の値、シミュレーションの結果など。</div>`, { top: true });
    f.querySelector("[data-k=code]").addEventListener("change", (e) => { el.code = e.target.value; changed(el); });
    bindNum(f, ["seed"], true);
  } else if (el.source === "ode") {
    fexpr("y′ = f(x, y)", "x と y");
    const f = add("解き方", `<div class="row">${numIn("x0", "x₀", P.x0 ?? 0, { step: 0.1 })}${numIn("y0", "y₀", P.y0 ?? 1, { step: 0.1 })}</div>
      <div class="row">${numIn("x1", "x の終わり", P.x1 ?? 6, { step: 0.5 })}${numIn("h", "刻み h", P.h ?? 0.5, { step: 0.05, min: 0.0001 })}</div>
      <div class="row"><select data-k="method"><option value="euler">オイラー法</option><option value="heun">ホイン法（改良オイラー法）</option><option value="rk4">ルンゲクッタ法（4 次）</option><option value="exact">精密（細かい刻みのルンゲクッタ法）</option></select></div>
      <div class="field-note">同じ座標軸に、刻みや解き方を変えた点列をもう 1 つ置くと、誤りの違いを比べられます（「精密」をふつうの線で重ねると、ほぼ本当の解）。</div>`, { top: true });
    f.querySelector("[data-k=method]").value = P.method ?? "euler";
    f.querySelector("[data-k=method]").addEventListener("change", (e) => { P.method = e.target.value; changed(el); });
    bindNum(f, ["x0", "y0", "x1", "h"]);
  } else if (el.source === "integral") {
    fexpr("f(x)", "x");
    const f = add("分け方", `<div class="row">${numIn("a", "a", P.a ?? 0, { step: 0.5 })}${numIn("b", "b", P.b ?? 2, { step: 0.5 })}${numIn("n", "分割数 n", P.n ?? 8, { step: 1, min: 1 })}</div>
      <div class="row"><select data-k="rule"><option value="left">長方形（左端の値）</option><option value="right">長方形（右端の値）</option><option value="mid">長方形（中点の値）</option><option value="trapezoid">台形</option></select></div>
      <div class="field-note">a から b までを n 等分して、長方形・台形を並べます。n を変えた点列を 2 つ置くと、近づいていく様子を比べられます。関数そのもののグラフは、座標軸の「＋グラフ」で重ねます。</div>`, { top: true });
    f.querySelector("[data-k=rule]").value = P.rule ?? "left";
    f.querySelector("[data-k=rule]").addEventListener("change", (e) => { P.rule = e.target.value; changed(el); });
    bindNum(f, ["a", "b"]);
    bindNum(f, ["n"], true);
  } else if (el.source === "montecarlo") {
    const f = add("点の数", `<div class="row">${numIn("n", "点の数", P.n ?? 500, { step: 100, min: 1, max: 20000 })}${numIn("seed", "乱数の種", P.seed ?? 1, { step: 1, min: 0 })}</div>
      <div class="field-note">0〜1 の正方形に点を打ち、原点を中心とする半径 1 の円の内側（1 つ目の色）と外側（2 つ目の色）に分けます。内側の割合 × 4 が円周率の推定値です。
        座標軸は x・y とも 0〜1 を含むようにします。</div>`, { top: true });
    bindNum(f, ["n", "seed"], true);
  } else if (el.source === "trials") {
    const f = add("試行", `<div class="row"><select data-k="kind"><option value="dice">さいころを振った目の平均</option><option value="coin">コインの表の割合</option></select></div>
      <div class="row">${numIn("n", "回数", P.n ?? 200, { step: 10, min: 1, max: 20000 })}${numIn("seed", "乱数の種", P.seed ?? 1, { step: 1, min: 0 })}</div>
      <div class="field-note">横軸が回数、縦軸がそこまでの平均（割合）です。回数を増やすと理論値（3.5・0.5）に近づきます（大数の法則）。</div>`, { top: true });
    f.querySelector("[data-k=kind]").value = P.kind ?? "dice";
    f.querySelector("[data-k=kind]").addEventListener("change", (e) => { P.kind = e.target.value; changed(el); });
    bindNum(f, ["n", "seed"], true);
  }
  const fixed = el.source === "integral" ? "area" : el.source === "montecarlo" ? "scatter" : null;
  const fl = add("見た目", `${fixed ? "" : `<div class="seg" data-k="style"><button type="button" data-v="line">折れ線</button><button type="button" data-v="scatter">点</button><button type="button" data-v="bars">棒</button></div>`}
    <div class="row"><span class="unit">色</span>${colorInput("c1", el.stroke.color)}${el.source === "montecarlo" || el.source === "code" ? `<span class="unit">2 つ目の色</span>${colorInput("c2", el.color2 ?? "#D9534F")}` : ""}</div>
    <div class="row"><span class="unit">線の太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}<span class="unit">点の半径</span>${num("dr", el.dotRadius ?? 0.05, { step: 0.01, min: 0.005 })}</div>
    <div class="row"><span class="unit">塗りの不透明度</span>${num("fo", el.fill?.opacity ?? 0.35, { step: 0.05, min: 0, max: 1 })}</div>
    <div class="field-note" data-k="info">計算しています…</div>
    <div class="field-note">点・棒・長方形は 1 つずつの部品なので、「出す」の動きを「LaggedIn」（少しずつずらして出す）にすると 1 つずつ増えていきます。</div>`, { top: true });
  if (!fixed) bindSeg(fl, "style", () => el.style ?? "line", (v) => { el.style = v; changed(el); });
  bindColor(fl, "c1", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  if (fl.querySelector("[data-k=c2]")) bindColor(fl, "c2", () => el.color2, (v) => { el.color2 = v; changed(el); });
  fl.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fl.querySelector("[data-k=dr]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.dotRadius = v; changed(el); } });
  fl.querySelector("[data-k=fo]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0 && v <= 1) { el.fill.opacity = v; changed(el); } });
  // 計算の結果（プレビューと同じ計算。積分の近似値・π の推定値など）
  const info = fl.querySelector("[data-k=info]");
  let t = null;
  const recompute = async () => {
    const { renderShapePreview } = await import("./shapepreview.js");
    const r = await renderShapePreview(el, null, axes);
    if (!info.isConnected) return;
    info.textContent = r.error ? `計算できません: ${r.error}` : `結果: ${r.info || "（なし）"}`;
    info.className = `field-note${r.error ? " ng" : ""}`;
  };
  recompute();
  on("dirty", () => { if (info.isConnected) { clearTimeout(t); t = setTimeout(recompute, 500); } });
}

function linegraphFields(sec, el, add, changed) {
  const axes = findElement(el.axesId);
  const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
  fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  const text = (el.points ?? []).map(([x, y]) => `${x}, ${y}`).join("\n");
  const f = add("点", `<textarea data-k="pts" rows="6" spellcheck="false" style="width:100%;font-family:var(--mono)">${escapeHtml(text)}</textarea>
    <div class="field-note" data-k="pn">1 行に「x, y」を 1 組（座標軸の座標）。上から順に線でつなぎます（plot_line_graph）。</div>`, { top: true });
  const pn = f.querySelector("[data-k=pn]");
  f.querySelector("[data-k=pts]").addEventListener("change", (e) => {
    const pts = [], bad = [];
    e.target.value.split(/\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t) return;
      const m = t.split(/[,\s\t]+/).filter(Boolean).map(Number);
      if (m.length === 2 && m.every(Number.isFinite)) pts.push(m); else bad.push(i + 1);
    });
    if (bad.length || pts.length < 2) {
      pn.textContent = bad.length ? `${bad.join("・")} 行目が「x, y」の形ではありません。` : "点は 2 つ以上必要です。";
      pn.classList.add("ng");
      return;
    }
    pn.textContent = "1 行に「x, y」を 1 組（座標軸の座標）。上から順に線でつなぎます（plot_line_graph）。";
    pn.classList.remove("ng");
    el.points = pts; changed(el);
  });
  const fl = add("線と点", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <label class="row"><input type="checkbox" data-k="dots" ${el.dots ? "checked" : ""}> 点を付ける</label>
    <div class="row"><span class="unit">点の半径</span>${num("dr", el.dotRadius ?? 0.08, { step: 0.02, min: 0.01 })}<label class="row"><input type="checkbox" data-k="dcs" ${el.dotColor ? "" : "checked"}> 線と同じ色</label>${colorInput("dc", el.dotColor || el.stroke.color)}</div>`);
  bindColor(fl, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fl.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fl.querySelector("[data-k=dots]").addEventListener("change", (e) => { el.dots = e.target.checked; changed(el); });
  fl.querySelector("[data-k=dr]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.dotRadius = v; changed(el); } });
  fl.querySelector("[data-k=dcs]").addEventListener("change", (e) => { el.dotColor = e.target.checked ? null : (el.stroke.color || "#FFFFFF"); changed(el); reselect(el); });
  bindColor(fl, "dc", () => el.dotColor, (v) => { el.dotColor = v; changed(el); });
}

/** 座標軸なしの曲線（FunctionGraph・ParametricFunction・ImplicitFunction）。 */
function fcurveFields(sec, el, add, changed) {
  const k = el.curveKind;
  const fk = add("種類", `<div class="seg" data-k="ck"><button type="button" data-v="function">y = f(x)</button><button type="button" data-v="parametric">媒介変数 (x(t), y(t))</button><button type="button" data-v="implicit">陰関数 f(x, y) = 0</button></div>
    <div class="field-note">座標軸を使わず、画面の座標（Manim の単位）で描きます。要素の位置が原点 (0, 0) です。角のハンドルで大きさ（1 の長さ）を、上の丸いハンドルで向きを変えます。</div>`, { top: true });
  bindSeg(fk, "ck", () => el.curveKind, (v) => {
    el.curveKind = v;
    if (v === "implicit" && !el.expr.includes("=")) el.expr = "x^2 + y^2 = 4";
    if (v === "function" && el.expr.includes("=")) el.expr = "\\sin x";
    changed(el); reselect(el);
  });
  if (k === "parametric") exprFields(add, el, changed, "式", [["xExpr", "x ="], ["yExpr", "y ="]], "t の式。例: \\cos t、\\sin 2t。");
  else if (k === "implicit") exprFields(add, el, changed, "式", [["expr", "式"]], "x・y の式で「左辺 = 右辺」（= が無ければ 式 = 0）。例: x^2 + y^2 = 4、y^2 = x^3 - x。");
  else exprFields(add, el, changed, "式", [["expr", "y ="]], "x の式。例: \\sin x、\\frac{x^2}{4} - 1。");
  const P = store.meta.canvas.h / 8;
  const fr = add("範囲", (k === "parametric" ? `<div class="row"><span class="unit">t</span>${num("t0", el.tMin, { step: 0.5 })}<span class="unit">〜</span>${num("t1", el.tMax, { step: 0.5 })}</div>`
    : `<div class="row"><span class="unit">x</span>${num("x0", el.xMin, { step: 0.5 })}<span class="unit">〜</span>${num("x1", el.xMax, { step: 0.5 })}</div>
       <div class="row"><span class="unit">y</span>${num("y0", el.yMin, { step: 0.5 })}<span class="unit">〜</span>${num("y1", el.yMax, { step: 0.5 })}</div>`)
    + `<div class="row"><span class="unit">1 の長さ</span>${num("sc", el.scale, { step: 0.1, min: 0.01 })}</div>
    <div class="field-note">${k === "function" ? "y がこの範囲の外に出る所では線を切ります。" : k === "implicit" ? "この範囲の中で 式 = 0 の所を描きます。" : ""}1 の長さは Manim の単位（1 なら、座標がそのまま画面の座標）。</div>`);
  const pair = [["t0", "tMin"], ["t1", "tMax"], ["x0", "xMin"], ["x1", "xMax"], ["y0", "yMin"], ["y1", "yMax"]];
  for (const [d, key] of pair) fr.querySelector(`[data-k=${d}]`)?.addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[key] = v; changed(el); } });
  fr.querySelector("[data-k=sc]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.scale = v; changed(el); } });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fr)) fr.querySelector("[data-k=sc]").value = el.scale; });
  const fc = add("線", `<div class="row">${colorInput("sc2", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <label class="row"><input type="checkbox" data-k="dash" ${el.dashed ? "checked" : ""}> 破線</label>`);
  bindColor(fc, "sc2", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fc.querySelector("[data-k=dash]").addEventListener("change", (e) => { el.dashed = e.target.checked; changed(el); });
  gradientFields(el, add, changed);
  void P;
}

/** 任意の曲線の接線（TangentLine）。 */
function tangentFields(sec, el, add, changed) {
  const t = findElement(el.targetId);
  const ft = add("曲線", t ? `<button type="button" class="link" data-a="t">${escapeHtml(t.var)}</button><span class="hint"> ${escapeHtml(shapeLabel(t) || "")}</span>` : `<span class="field-note ng">接線を引く曲線が見つかりません</span>`, { top: true });
  ft.querySelector("[data-a=t]")?.addEventListener("click", () => select(t.id));
  const isNum = typeof el.alpha === "number";
  const f = add("接点", `<div class="row"><input type="range" data-k="ar" min="0" max="1000" step="1" value="${Math.round((isNum ? el.alpha : 0.5) * 1000)}" ${isNum ? "" : "disabled"} style="flex:1"></div>
    <div class="row"><span class="unit">位置（割合）</span><input data-k="alpha" value="${escapeHtml(String(el.alpha))}" spellcheck="false" style="width:8em;font-family:var(--mono)"></div>
    <div class="field-note" data-k="an">曲線の始点を 0、終点を 1 とした、曲線の長さの割合（Manim の TangentLine の alpha）。閉じた形は一周で 0〜1 です。スライドの値を使った式も書けます（例: a。ステップで <code>self.play(a.animate.set_value(1), run_time=3)</code> とすると、接点が曲線に沿って動きます）。${valuesNote()}</div>`, { top: true });
  const ar = f.querySelector("[data-k=ar]"), ai = f.querySelector("[data-k=alpha]");
  ar.addEventListener("input", () => { el.alpha = Number(ar.value) / 1000; ai.value = el.alpha; changed(el); });
  ai.addEventListener("change", () => {
    const v = ai.value.trim();
    el.alpha = v !== "" && Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : (v || 0.5);
    changed(el); reselect(el);
  });
  const an = f.querySelector("[data-k=an]");
  const showErr = () => { const o = fabricObjectOf(el.id); if (o?.previewError) { an.textContent = o.previewError.replace(/^.*?式: /, "式の誤り: "); an.classList.add("ng"); } };
  showErr();
  const off = on("element-rendered", ({ el: r }) => { if (!document.body.contains(an)) return off(); if (r.id === el.id) showErr(); });
  const fl = add("線", `<div class="row">${colorInput("sc2", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <div class="row"><span class="unit">長さ</span>${num("len", el.length, { step: 0.5, min: 0.01 })}</div>
    <label class="row"><input type="checkbox" data-k="dot" ${el.dot ? "checked" : ""}> 接点に点</label>
    <div class="field-note">長さは Manim の単位。ステップでは <code>${escapeHtml(el.var)}.line</code>（線）・<code>${escapeHtml(el.var)}.dot</code>（点）で参照できます。</div>`);
  bindColor(fl, "sc2", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fl.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fl.querySelector("[data-k=len]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.length = v; changed(el); } });
  fl.querySelector("[data-k=dot]").addEventListener("change", (e) => { el.dot = e.target.checked; changed(el); });
}

function zoomFields(sec, el, add, changed) {
  const P = store.meta.canvas.h / 8;
  const f = add("ズーム", `<div class="row"><span class="unit">拡大</span>${num("mag", r2(1 / el.factor), { step: 0.5, min: 0.1 })}<span class="unit">倍</span></div>
    <div class="row"><span class="unit">映す所の大きさ</span>${num("zw", r2(el.width / P), { step: 0.25, min: 0.2 })}<span class="unit">×</span>${num("zh", r2(el.height / P), { step: 0.25, min: 0.2 })}</div>
    <div class="row"><span class="unit">拡大する所の中心</span>${num("fx", r2((el.frameX - store.meta.canvas.w / 2) / P), { step: 0.1 })}${num("fy", r2((store.meta.canvas.h / 2 - el.frameY) / P), { step: 0.1 })}</div>
    <div class="field-note">拡大する所（キャンバスのオレンジの丸で動かす枠）を、映す所（この四角）に拡大して映します（ZoomedScene）。大きさ・位置は Manim の単位。
    拡大する所の大きさは、映す所の大きさ ÷ 拡大の倍率です。1 つのスライドに 1 つまで。</div>`, { top: true });
  f.querySelector("[data-k=mag]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.factor = Math.round(1000 / v) / 1000; changed(el); } });
  f.querySelector("[data-k=zw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.width = Math.round(v * P * 10) / 10; changed(el); } });
  f.querySelector("[data-k=zh]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.height = Math.round(v * P * 10) / 10; changed(el); } });
  f.querySelector("[data-k=fx]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.frameX = Math.round((store.meta.canvas.w / 2 + v * P) * 10) / 10; changed(el); } });
  f.querySelector("[data-k=fy]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.frameY = Math.round((store.meta.canvas.h / 2 - v * P) * 10) / 10; changed(el); } });
  on("element-resized", (els) => {
    if (!els.includes(el) || !document.body.contains(f)) return;
    f.querySelector("[data-k=zw]").value = r2(el.width / P); f.querySelector("[data-k=zh]").value = r2(el.height / P);
    f.querySelector("[data-k=fx]").value = r2((el.frameX - store.meta.canvas.w / 2) / P); f.querySelector("[data-k=fy]").value = r2((store.meta.canvas.h / 2 - el.frameY) / P);
  });
  const fc = add("枠", `<div class="row"><span class="unit">拡大する所</span>${colorInput("sc", el.stroke.color)}</div>
    <div class="row"><span class="unit">映す所</span><label class="row"><input type="checkbox" data-k="same" ${el.displayColor ? "" : "checked"}> 同じ色</label>${colorInput("dc", el.displayColor || el.stroke.color)}</div>
    <div class="row"><span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <div class="field-note">「最初から出す」を外すと、ステップの <code>self.activate_zooming(animate=True)</code> で、画面全体から拡大する所へ縮んで、映す所が飛び出すアニメーションで出します。
    ステップでは <code>self.zoomed_camera.frame</code>（拡大する所の枠）・<code>self.zoomed_display</code>（映す所）を動かせます（例: <code>self.play(self.zoomed_camera.frame.animate.shift(RIGHT))</code>）。</div>`);
  bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fc.querySelector("[data-k=same]").addEventListener("change", (e) => { el.displayColor = e.target.checked ? null : el.stroke.color; changed(el); reselect(el); });
  bindColor(fc, "dc", () => el.displayColor, (v) => { el.displayColor = v; changed(el); });
  fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
}

function traceFields(sec, el, add, changed) {
  const t = findElement(el.targetId);
  // たどる要素は、あとから変えられる（自分・ほかの軌跡・注釈・動画音声は選べない）
  const cands = (currentSlide()?.elements ?? []).filter((e) => e.id !== el.id && e.type !== "media" && !(e.type === "shape" && ["trace", "annot", "zoom"].includes(e.shape)));
  const ft = add("たどる要素", `<div class="row"><select data-k="tg">${t ? "" : `<option value="" selected>（見つかりません）</option>`}${cands.map((e) => `<option value="${e.id}" ${e.id === el.targetId ? "selected" : ""}>${escapeHtml(e.var)}</option>`).join("")}</select>
    ${t ? `<button type="button" class="small" data-a="t">選ぶ</button>` : ""}</div>
    <div class="field-note">軌跡は、この要素の中心が通った跡です。変えると、軌跡はその要素をたどります。</div>`, { top: true });
  ft.querySelector("[data-a=t]")?.addEventListener("click", () => select(t.id));
  ft.querySelector("[data-k=tg]").addEventListener("change", (e) => { if (e.target.value) { el.targetId = e.target.value; changed(el); } });
  const f = add("軌跡", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <div class="row"><span class="unit">消えるまで</span>${num("dis", el.dissipating ?? 0, { step: 0.5, min: 0 })}<span class="unit">秒（0 なら消えない）</span></div>
    <div class="field-note">ステップでたどる要素を動かすと（例: self.play(dot.animate.shift(RIGHT*3)) や値を変えて座標の点を動かす）、要素の中心が通った跡が線で残ります（TracedPath）。キャンバスでは目印だけを出します。</div>`, { top: true });
  bindColor(f, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  f.querySelector("[data-k=dis]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.dissipating = v; changed(el); } });
}

function curve2dFields(sec, el, add, changed) {
  const axes = findElement(el.axesId);
  const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button>` : `<span class="field-note ng">座標軸が見つかりません</span>`);
  fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  if (el.shape === "curve2d") {
    exprFields(add, el, changed, "式", [["xExpr", "x ="], ["yExpr", "y ="]], "t の式（座標軸の座標）。例: \\cos t、\\sin 2t。");
    const ft = add("t の範囲", `<div class="row">${num("t0", el.tMin, { step: 0.5 })}<span class="unit">〜</span>${num("t1", el.tMax, { step: 0.5 })}</div>`);
    ft.querySelector("[data-k=t0]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.tMin = v; changed(el); } });
    ft.querySelector("[data-k=t1]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.tMax = v; changed(el); } });
  } else {
    exprFields(add, el, changed, "式", [["expr", "式"]], "x・y の式で「左辺 = 右辺」（= が無ければ 式 = 0）。例: x^2 + y^2 = 4、y^2 = x^3 - x。");
  }
  const fc = add("線", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    ${el.shape === "curve2d" ? `<label class="row"><input type="checkbox" data-k="dash" ${el.dashed ? "checked" : ""}> 破線</label>` : ""}`);
  bindColor(fc, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  fc.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  fc.querySelector("[data-k=dash]")?.addEventListener("change", (e) => { el.dashed = e.target.checked; changed(el); });
  if (el.shape === "curve2d") gradientFields(el, add, changed);
}


// ---------------------------------------------------------------- ラベル（線・点）・コード・棒グラフ・LaTeX の文章・図形の合成

function labelFields(el, add, changed, mode) {
  // mode: true / "line"（線）・false / "dot"（点）・"shape"（閉じた形）
  const isLine = mode === true || mode === "line", isShape = mode === "shape";
  const f = add("ラベル", `<div class="row"><input data-k="label" value="${escapeHtml(el.label ?? "")}" spellcheck="false" placeholder="例: a、\\vec{v}、P（空欄なら無し）" style="flex:1"></div>
    <div class="row"><span class="unit">大きさ</span>${num("ls", el.labelSize ?? (isLine ? 36 : 30), { step: 2, min: 2 })}<label class="row"><input type="checkbox" data-k="lcs" ${el.labelColor ? "" : "checked"}> ${isLine || isShape ? "線と同じ色" : "黒"}</label>${colorInput("lc", el.labelColor || (isLine || isShape ? el.stroke.color : "#000000"))}</div>
    ${isLine ? `<div class="row"><span class="unit">位置</span><input type="range" data-k="lp" min="0" max="100" step="5" value="${Math.round((el.labelPos ?? 0.5) * 100)}"><output>${Math.round((el.labelPos ?? 0.5) * 100)}%</output></div>` : ""}
    ${isLine || isShape ? `<label class="row"><input type="checkbox" data-k="lbg" ${el.labelBg ? "checked" : ""}> 背景で${isLine ? "線" : "下"}を隠す</label>${colorInput("lb", el.labelBg || store.project.settings.background)}
    <label class="row"><input type="checkbox" data-k="lfr" ${el.labelFrame ? "checked" : ""}> 枠で囲む</label>` : ""}
    <div class="field-note">LaTeX（数式）で書きます。日本語は自動で \\text{…} になります。${isLine ? "線の途中（0% = 始点、100% = 終点）に置きます（LabeledLine と同じ作り）。" : isShape ? "形の内側の、いちばん広い所に置きます（LabeledPolygram と同じ置き方）。" : "点の中に置き、収まるように点を大きくします（LabeledDot と同じ作り）。"}ステップのコードでは <code>${escapeHtml(el.var)}.label</code> で参照できます。</div>`);
  const q = (k) => f.querySelector(`[data-k=${k}]`);
  q("label").addEventListener("change", (e) => { el.label = e.target.value; changed(el); });
  q("ls").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  q("lcs").addEventListener("change", (e) => { el.labelColor = e.target.checked ? null : (el.labelColor || (isLine || isShape ? el.stroke.color : "#000000")); changed(el); });
  bindColor(f, "lc", () => el.labelColor, (v) => { el.labelColor = v; q("lcs").checked = false; changed(el); });
  if (isLine) {
    const lp = q("lp"), lo = f.querySelector("output");
    lp.addEventListener("input", () => { lo.textContent = `${lp.value}%`; });
    lp.addEventListener("change", () => { el.labelPos = Number(lp.value) / 100; changed(el); });
  }
  if (isLine || isShape) {
    q("lbg").addEventListener("change", (e) => { el.labelBg = e.target.checked ? (el.labelBg || store.project.settings.background) : null; changed(el); });
    bindColor(f, "lb", () => el.labelBg, (v) => { el.labelBg = v; q("lbg").checked = true; changed(el); });
    q("lfr").addEventListener("change", (e) => { el.labelFrame = e.target.checked; changed(el); });
  }
}

const CODE_LANGS = [["python", "Python"], ["c", "C"], ["cpp", "C++"], ["java", "Java"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
  ["rust", "Rust"], ["go", "Go"], ["julia", "Julia"], ["matlab", "MATLAB"], ["r", "R"], ["bash", "Bash"], ["html", "HTML"], ["css", "CSS"],
  ["sql", "SQL"], ["latex", "LaTeX"], ["text", "色分けなし"]];
const CODE_STYLES = [["one-dark", "one-dark（暗い・既定）"], ["vim", "vim（暗い。#include などの青が暗い）"], ["monokai", "monokai（暗い）"], ["dracula", "dracula（暗い）"],
  ["github-dark", "github-dark（暗い）"], ["solarized-dark", "solarized-dark（暗い）"], ["native", "native（暗い）"], ["default", "default（明るい）"],
  ["friendly", "friendly（明るい）"], ["solarized-light", "solarized-light（明るい）"], ["vs", "vs（明るい）"], ["xcode", "xcode（明るい）"],
  ["emacs", "emacs（明るい）"], ["tango", "tango（明るい）"], ["gruvbox-light", "gruvbox-light（明るい）"], ["bw", "bw（白黒）"]];

function codeFields(sec, el, add, changed) {
  const fc = add("コード", `<textarea data-k="code" rows="${Math.min(16, Math.max(4, (el.code ?? "").split("\n").length + 1))}" spellcheck="false" style="width:100%;font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre;tab-size:4">${escapeHtml(el.code ?? "")}</textarea>
    <div class="field-note">入力欄から外れると反映します。Tab キーで字下げできます。</div>`, { top: true });
  const ta = fc.querySelector("textarea");
  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.setRangeText("    ", a, b, "end");
  });
  ta.addEventListener("change", () => {
    // 行を足す・消すと、このコードの行を指す動き（行に色の帯・一部分）がずれるので、合わせるかを聞く
    const note = confirmCodeLineShift(currentSlide(), el, el.code ?? "", ta.value);
    el.code = ta.value;
    changed(el);
    if (note) toast(note, "", 7000);
  });
  const fl = add("言語・配色", `<div class="row"><span class="unit">言語</span><select data-k="lang">${CODE_LANGS.map(([v, t]) => `<option value="${v}" ${v === el.language ? "selected" : ""}>${t}</option>`).join("")}${CODE_LANGS.some(([v]) => v === el.language) ? "" : `<option value="${escapeHtml(el.language)}" selected>${escapeHtml(el.language)}</option>`}</select></div>
    <div class="row"><span class="unit">配色</span><select data-k="style">${CODE_STYLES.map(([v, t]) => `<option value="${v}" ${v === el.style ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="field-note">色分けは Pygments です。明るい配色のときは、背景と文字の色を下で変えてください（背景の既定は濃い灰色）。</div>`);
  fl.querySelector("[data-k=lang]").addEventListener("change", (e) => { el.language = e.target.value; changed(el); });
  fl.querySelector("[data-k=style]").addEventListener("change", (e) => { el.style = e.target.value; changed(el); });
  const ft = add("文字", `<div class="row"><span class="unit">大きさ</span>${num("fs", el.fontSize, { step: 2, min: 2 })}<span class="unit">タブ幅</span>${num("tw", el.tabWidth ?? 4, { step: 1, min: 1, max: 16 })}</div>
    <div class="row"><span class="unit">フォント</span><input data-k="font" value="${escapeHtml(el.font ?? "")}" placeholder="空欄で Monospace" spellcheck="false" style="flex:1"></div>
    <label class="row"><input type="checkbox" data-k="tcs" ${el.textColor ? "" : "checked"}> 色分けしない文字は白</label>${colorInput("tc", el.textColor || "#222222")}`);
  ft.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  ft.querySelector("[data-k=tw]").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1) { el.tabWidth = v; changed(el); } });
  ft.querySelector("[data-k=font]").addEventListener("change", (e) => { el.font = e.target.value.trim(); changed(el); });
  ft.querySelector("[data-k=tcs]").addEventListener("change", (e) => { el.textColor = e.target.checked ? null : (el.textColor || "#222222"); changed(el); });
  bindColor(ft, "tc", () => el.textColor, (v) => { el.textColor = v; ft.querySelector("[data-k=tcs]").checked = false; changed(el); });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(ft)) ft.querySelector("[data-k=fs]").value = el.fontSize; });
  const fb = add("行番号・背景", `<label class="row"><input type="checkbox" data-k="ln" ${el.lineNumbers ? "checked" : ""}> 行番号</label><div class="row"><span class="unit">最初の番号</span>${num("lf", el.lineFrom ?? 1, { step: 1 })}</div>
    <div class="seg" data-k="bg"><button type="button" data-v="rectangle">角丸の四角</button><button type="button" data-v="window">ウィンドウ（ボタン付き）</button></div>
    <label class="row"><input type="checkbox" data-k="bcs" ${el.bgColor ? "" : "checked"}> 背景は濃い灰色（既定）</label>${colorInput("bc", el.bgColor || "#222222")}`);
  fb.querySelector("[data-k=ln]").addEventListener("change", (e) => { el.lineNumbers = e.target.checked; changed(el); });
  fb.querySelector("[data-k=lf]").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) { el.lineFrom = v; changed(el); } });
  bindSeg(fb, "bg", () => el.background, (v) => { el.background = v; changed(el); });
  fb.querySelector("[data-k=bcs]").addEventListener("change", (e) => { el.bgColor = e.target.checked ? null : (el.bgColor || "#222222"); changed(el); });
  bindColor(fb, "bc", () => el.bgColor, (v) => { el.bgColor = v; fb.querySelector("[data-k=bcs]").checked = false; changed(el); });
}

function barchartFields(sec, el, add, changed) {
  const u = P();
  const fd = add("棒", `<table class="table-grid"><thead><tr><th>名前</th><th>値</th><th>色</th><th></th></tr></thead><tbody>${el.bars.map((b, i) => `<tr data-i="${i}">
      <td><input data-k="name" value="${escapeHtml(b.name)}" spellcheck="false" style="width:7em"></td>
      <td><input type="number" class="num" data-k="value" step="any" value="${b.value}"></td>
      <td><input type="color" data-k="color" value="${(b.color || "#58C4DD").toLowerCase()}"></td>
      <td><button type="button" class="small" data-a="up" title="上へ" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="small" data-a="del" title="消す" ${el.bars.length <= 1 ? "disabled" : ""}>×</button></td></tr>`).join("")}</tbody></table>
    <div class="row"><button type="button" class="small" data-a="add">＋ 棒を足す</button></div>
    <div class="field-note">名前は LaTeX の文章（Tex）です。日本語もそのまま書け、数式は $x^2$ のように $ で囲みます。棒の値は、ステップのコードで <code>self.play(${escapeHtml(el.var)}.animate.change_bar_values([…]))</code> のように変えられます。</div>`, { top: true });
  const rows = () => fd.querySelectorAll("tbody tr");
  rows().forEach((tr) => {
    const i = Number(tr.dataset.i), b = el.bars[i];
    tr.querySelector("[data-k=name]").addEventListener("change", (e) => { b.name = e.target.value; changed(el); });
    tr.querySelector("[data-k=value]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { b.value = v; changed(el); } });
    tr.querySelector("[data-k=color]").addEventListener("input", (e) => { b.color = e.target.value.toUpperCase(); changed(el); });
    tr.querySelector("[data-a=up]").addEventListener("click", () => { [el.bars[i - 1], el.bars[i]] = [el.bars[i], el.bars[i - 1]]; changed(el); reselect(el); });
    tr.querySelector("[data-a=del]").addEventListener("click", () => { el.bars.splice(i, 1); changed(el); reselect(el); });
  });
  fd.querySelector("[data-a=add]").addEventListener("click", () => {
    const palette = ["#58C4DD", "#83C167", "#FFC300", "#FC6255", "#9A72AC", "#5CD0B3", "#F0AC5F"];
    el.bars.push({ name: String.fromCharCode(65 + el.bars.length % 26), value: 1, color: palette[el.bars.length % palette.length] });
    changed(el); reselect(el);
  });
  const fr = add("縦軸", `<label class="row"><input type="checkbox" data-k="auto" ${el.autoRange ? "checked" : ""}> 値から自動で決める</label>
    <div class="row"><span class="unit">最小</span>${num("yMin", el.yMin, { step: 1 })}<span class="unit">最大</span>${num("yMax", el.yMax, { step: 1 })}<span class="unit">目盛り</span>${num("yStep", el.yStep, { step: 0.5, min: 0.001 })}</div>
    <div class="row"><span class="unit">数字の大きさ</span>${num("ns", el.numSize ?? 24, { step: 2, min: 4 })}</div>`);
  fr.querySelector("[data-k=auto]").addEventListener("change", (e) => { el.autoRange = e.target.checked; changed(el); });
  for (const k of ["yMin", "yMax", "yStep"]) {
    fr.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[k] = v; el.autoRange = false; fr.querySelector("[data-k=auto]").checked = false; changed(el); } });
  }
  fr.querySelector("[data-k=ns]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.numSize = v; changed(el); } });
  const fs = add("大きさ・見た目", `<div class="row"><span class="unit">横</span>${num("w", r2(el.width / u), { step: 0.5, min: 0.1 })}<span class="unit">縦</span>${num("h", r2(el.height / u), { step: 0.5, min: 0.1 })}</div>
    <div class="row"><span class="unit">棒の幅</span><input type="range" data-k="bw" min="5" max="100" step="5" value="${Math.round((el.barWidth ?? 0.6) * 100)}"><span class="unit">塗りの不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>
    <div class="row"><span class="unit">棒の線の太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}<span class="unit">軸の色</span>${colorInput("ac", el.axisColor)}</div>
    <div class="row"><span class="unit">名前・値の大きさ</span>${num("lsz", el.labelSize ?? 30, { step: 2, min: 4 })}</div>
    <label class="row"><input type="checkbox" data-k="sv" ${el.showValues ? "checked" : ""}> 棒の上に値を書く</label><div class="row"><span class="unit">小数点以下</span>${num("dec", el.decimals ?? 0, { step: 1, min: 0, max: 6 })}<span class="unit">桁</span></div>`);
  const q = (k) => fs.querySelector(`[data-k=${k}]`);
  q("w").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.width = v; changed(el); } });
  q("h").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.height = v; changed(el); } });
  q("bw").addEventListener("change", (e) => { el.barWidth = Number(e.target.value) / 100; changed(el); });
  q("fo").addEventListener("change", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
  q("sw").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  bindColor(fs, "ac", () => el.axisColor, (v) => { el.axisColor = v; changed(el); });
  q("lsz").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  q("sv").addEventListener("change", (e) => { el.showValues = e.target.checked; changed(el); });
  q("dec").addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0) { el.decimals = v; changed(el); } });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fs)) { q("w").value = r2(el.width / u); q("h").value = r2(el.height / u); } });
}

function texFields(sec, el, add, changed) {
  const isList = el.shape === "bullets";
  const text = isList ? (el.items ?? []).join("\n") : (el.latex ?? "");
  const ft = add(isList ? "項目" : "文章", `<textarea data-k="t" class="latex-text" rows="${Math.min(10, Math.max(3, text.split("\n").length + 1))}" spellcheck="false" style="width:100%">${escapeHtml(text)}</textarea>
    <div class="field-note">LaTeX の文章（Tex）として書きます。数式は $x^2$ のように $ で囲みます。${isList ? "1 行が 1 項目です。" : "改行は、そのまま改行になります。"}日本語も書けます。入力欄から外れると反映します。</div>`, { top: true });
  ft.querySelector("textarea").addEventListener("change", (e) => {
    if (isList) el.items = e.target.value.split("\n").map((x) => x.trimEnd()).filter((x) => x.trim());
    else el.latex = e.target.value;
    if (el.placeholder) delete el.placeholder; // 自動で置いた題名: 書いたら描画する
    changed(el);
  });
  const fs = add("文字", `<div class="row"><span class="unit">大きさ</span>${num("fs", el.fontSize, { step: 2, min: 2 })}${colorInput("tc", el.color)}</div>
    ${el.shape === "title" ? `<div class="row"><span class="unit">揃え</span><div class="seg" data-k="al"><button type="button" data-v="left">左寄せ</button><button type="button" data-v="center">中央</button><button type="button" data-v="right">右寄せ</button></div></div>
    <label class="row"><input type="checkbox" data-k="ul" ${el.underline ? "checked" : ""}> 下線</label><label class="row"><input type="checkbox" data-k="mw" ${el.matchWidth ? "checked" : ""}> 下線を文字の幅に合わせる（オフで画面の幅いっぱい）</label>
    <div class="field-note">画面の幅の下線のときは、下線の端に文字をそろえます。それ以外の左・右寄せは、画面の端から 1 単位の所に寄せます（横には動かせません。複数行も左・右にそろえます）。</div>` : ""}
    ${isList ? `<div class="row"><span class="unit">項目の間</span>${num("bf", el.buff ?? 0.5, { step: 0.05, min: 0 })}<span class="unit">点の大きさ</span>${num("ds", el.dotScale ?? 2, { step: 0.1, min: 0.1 })}</div>` : ""}`);
  fs.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  bindColor(fs, "tc", () => el.color, (v) => { el.color = v; changed(el); });
  if (el.shape === "title") bindSeg(fs, "al", () => el.align ?? "center", (v) => { el.align = v; changed(el); reselect(el); });
  fs.querySelector("[data-k=ul]")?.addEventListener("change", (e) => { el.underline = e.target.checked; changed(el); reselect(el); });
  fs.querySelector("[data-k=mw]")?.addEventListener("change", (e) => { el.matchWidth = e.target.checked; changed(el); reselect(el); });
  fs.querySelector("[data-k=bf]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.buff = v; changed(el); } });
  fs.querySelector("[data-k=ds]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.dotScale = v; changed(el); } });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fs)) fs.querySelector("[data-k=fs]").value = el.fontSize; });
}

// ---------------------------------------------------------------- 定理・証明のブロック

function theoremFields(sec, el, add, changed) {
  const styles = theoremStyles();
  const plan = refPlan();
  const isProof = el.kind === "proof";
  const curNum = plan.numbers[el.id]?.num;
  const fk = add("種類", `<select data-k="kind">${KINDS.map((k) => `<option value="${k}" ${k === el.kind ? "selected" : ""}>${escapeHtml(styles[k].label)}</option>`).join("")}</select>
    ${isProof ? "" : `<label class="row" style="flex-wrap:nowrap"><input type="checkbox" data-k="numbered" ${el.numbered !== false ? "checked" : ""}><span>番号を付ける${curNum ? `（今は ${escapeHtml(styles[el.kind].label)} ${escapeHtml(curNum)}）` : ""}</span></label>`}
    <div class="field-note">番号は章ごとに、定理・定義・補題などで通して付きます（プロジェクト設定で通し番号にもできます）。種類の名前と色は「プロジェクト設定」で変えられます。</div>`, { top: true });
  fk.querySelector("[data-k=kind]").addEventListener("change", (e) => {
    el.kind = e.target.value;
    if (el.kind === "proof") { el.numbered = false; el.qed = true; }
    else if (isProof) { el.numbered = true; el.qed = false; }
    changed(el); reselect(el);
  });
  fk.querySelector("[data-k=numbered]")?.addEventListener("change", (e) => { el.numbered = e.target.checked; changed(el); reselect(el); });
  if (isProof) {
    const labs = labelList().filter((x) => x.elementId !== el.id);
    const fp = add("何の証明か", `<select data-k="pof" style="width:100%"><option value="">（書かない。見出しは「${escapeHtml(styles.proof.label)}」）</option>
      ${labs.map((x) => `<option value="${escapeHtml(x.label)}" ${x.label === el.proofOf ? "selected" : ""}>${escapeHtml(x.text)} — ${escapeHtml(x.label)}</option>`).join("")}
      ${el.proofOf && !labs.some((x) => x.label === el.proofOf) ? `<option value="${escapeHtml(el.proofOf)}" selected>${escapeHtml(el.proofOf)}（見つかりません）</option>` : ""}</select>
      <label class="row" style="flex-wrap:nowrap"><input type="checkbox" data-k="qed" ${el.qed ? "checked" : ""}><span>最後に ∎（証明の終わりの印）を付ける</span></label>
      <div class="field-note">選ぶと、見出しが「定理 3.1 の${escapeHtml(styles.proof.label)}」のようになります（定理にラベルを付けると選べます）。</div>`, { top: true });
    fp.querySelector("[data-k=pof]").addEventListener("change", (e) => { el.proofOf = e.target.value; changed(el); });
    fp.querySelector("[data-k=qed]").addEventListener("change", (e) => { el.qed = e.target.checked; changed(el); });
  } else {
    const ft = add("名前（任意）", `<input data-k="title" value="${escapeHtml(el.title ?? "")}" placeholder="例: 中間値の定理" spellcheck="false">
      <div class="field-note">見出しの後ろに（ ）で付きます。</div>`);
    ft.querySelector("[data-k=title]").addEventListener("change", (e) => { el.title = e.target.value; changed(el); });
  }
  const fb = add("本文", `<textarea data-k="body" class="latex-text" rows="${Math.min(12, Math.max(4, (el.body ?? "").split("\n").length + 1))}" spellcheck="false" style="width:100%">${escapeHtml(el.body ?? "")}</textarea>
    <div class="field-note">LaTeX の文章（数式は $x^2$ のように $ で囲む）。<b>1 行が 1 段落</b>で、段落ごとに出す動きを作れます。
      「仮定:」「前提:」「条件:」で始めた行は青緑、「結論:」で始めた行は赤で強調します。{ref:ラベル} と書くと、ほかの定理・式・図の番号になります。入力欄から外れると反映します。</div>`, { top: true });
  fb.querySelector("[data-k=body]").addEventListener("change", (e) => { el.body = e.target.value; changed(el); });
  const fs = add("見た目", `<div class="row"><span class="unit">幅</span>${num("w", Math.round(el.width ?? 900), { step: 10, min: 100 })}<span class="unit">px</span></div>
    <div class="row"><span class="unit">文字</span>${num("fs", el.fontSize, { step: 2, min: 2 })}${colorInput("tc", el.color)}</div>
    <div class="row"><span class="unit">枠</span><div class="seg" data-k="bx"><button type="button" data-v="auto">種類の既定</button><button type="button" data-v="on">付ける</button><button type="button" data-v="off">付けない</button></div></div>
    <div class="field-note">左右のハンドルで、文字の大きさを変えずに幅を変えられます（角のハンドルは文字ごと拡大・縮小）。</div>`, { top: true });
  fs.querySelector("[data-k=w]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 100) { el.width = v; changed(el); } });
  fs.querySelector("[data-k=fs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.fontSize = v; changed(el); } });
  bindColor(fs, "tc", () => el.color, (v) => { el.color = v; changed(el); });
  bindSeg(fs, "bx", () => (el.boxed == null ? "auto" : el.boxed ? "on" : "off"), (v) => { el.boxed = v === "auto" ? null : v === "on"; changed(el); });
  on("element-resized", (els) => {
    if (els.includes(el) && document.body.contains(fs)) { fs.querySelector("[data-k=fs]").value = el.fontSize; fs.querySelector("[data-k=w]").value = Math.round(el.width); }
  });
  // 段落の数は、押した時点の本文（まだ反映していない入力も含む）から数える。
  // 表示の数も、入力に合わせて変える（本文を直した直後に押しても、古い数を使わない）
  const countPara = (s) => (s ?? "").replace(/\r\n/g, "\n").split("\n").filter((x) => x.trim()).length;
  const bodyTa = fb.querySelector("[data-k=body]");
  const nPara = countPara(el.body);
  const fa = add("動き", `<button type="button" data-k="steps" style="white-space:normal;text-align:left;max-width:100%">段落ごとに出すステップを作る（<span data-k="npara">${nPara}</span> 段落）</button>
    <div class="field-note">見出し（と枠）を出すステップと、段落を 1 つずつ書くステップを、このスライドの最後に足します${el.qed ? "（∎ は最後の段落と一緒に出ます）" : ""}。
      「仮定」「結論」などの強調は、ステップの対象を ${escapeHtml(el.var)}[2][段落の番号] にすると、その段落だけを光らせる動き（Indicate など）も付けられます。</div>`, { top: true });
  bodyTa.addEventListener("input", () => { fa.querySelector("[data-k=npara]").textContent = countPara(bodyTa.value); });
  fa.querySelector("[data-k=steps]").addEventListener("click", async () => {
    // 入力欄から外れる前に押された場合も、今の本文を先に反映する
    if (document.body.contains(bodyTa) && bodyTa.value !== (el.body ?? "")) { el.body = bodyTa.value; changed(el); }
    const nPara = countPara(el.body);
    if (!nPara) { toast("本文に段落がありません。", "warn"); return; }
    const { newRow } = await import("./animpane.js");
    const slide = currentSlide();
    const boxed = el.boxed ?? !isProof;
    const head = boxed ? [[0], [1]] : [[1]];
    const mk = (anim, paths) => ({ id: uid("t"), elementId: el.id, mode: "gui", rows: [newRow(anim, el.id, { part: { paths } })], code: "" });
    const steps = [mk("FadeIn", head)];
    for (let i = 0; i < nPara; i++) steps.push(mk("Write", i === nPara - 1 && el.qed ? [[2, i], [3]] : [[2, i]]));
    slide.steps.push(...steps);
    el.visibleAtStart = false;
    store.focusStepId = steps[0].id;
    markDirty("steps");
    emit("steps-changed");
    emit("focus-step", steps[0].id);
    refreshElement(el);
    toast(`${steps.length} 個のステップを足しました（「スライド開始時に表示」はオフにしました）。`, "", 5000);
  });
}

function booleanFields(sec, el, add, changed) {
  const ops = (el.operandIds ?? []).map((id) => findElement(id));
  const two = el.op === "difference" || el.op === "exclusion";
  const fo = add("合成", `<div class="seg" data-k="op"><button type="button" data-v="union">和</button><button type="button" data-v="intersection">共通部分</button><button type="button" data-v="difference" ${ops.length !== 2 ? "disabled" : ""}>切り抜き</button><button type="button" data-v="exclusion" ${ops.length !== 2 ? "disabled" : ""}>重ならない部分</button></div>
    <div class="row">元の図形: ${ops.map((o, i) => o ? `<button type="button" class="link" data-i="${i}">${escapeHtml(o.var)}</button>` : `<span class="ng">（見つかりません）</span>`).join(el.op === "difference" ? " から " : "、")}${el.op === "difference" ? " を切り抜く" : ""}</div>
    ${el.op === "difference" ? `<div class="row"><button type="button" class="small" data-a="swap">切り抜く順を入れ替える</button></div>` : ""}
    <div class="field-note">Manim の ${{ union: "Union", intersection: "Intersection", difference: "Difference", exclusion: "Exclusion" }[el.op]}。元の図形の位置・形から作ります（キャンバスで元の図形を動かすと作り直します）。描画では、元の図形をあとで動かしても、合成した図形はついてきません。${two ? "" : ""}</div>`, { top: true });
  bindSeg(fo, "op", () => el.op, (v) => { el.op = v; changed(el); reselect(el); });
  fo.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => select(ops[Number(b.dataset.i)].id)));
  fo.querySelector("[data-a=swap]")?.addEventListener("click", () => { el.operandIds = [...el.operandIds].reverse(); changed(el); reselect(el); });
}


// ---------------------------------------------------------------- 多面体・標本空間

const POLY_KINDS = ["tetrahedron", "octahedron", "dodecahedron", "icosahedron", "polyhedron", "hull"];
const POLY_SIDES = { tetrahedron: 2.6, octahedron: 2, dodecahedron: 1.1, icosahedron: 1.5 };

function polyFields(el, add, changed) {
  const isHull = el.solidKind === "hull";
  const vtext = (el.vertices ?? []).map((v) => v.join(", ")).join("\n");
  const ftext = (el.faces ?? []).map((f) => f.join(" ")).join("\n");
  const f = add(isHull ? "点" : "頂点と面", `<div class="field-note">${isHull ? "点（1 行に x, y, z）。点をすべて含む、いちばん小さい凸の多面体（凸包）を作ります。" : "頂点（1 行に x, y, z。上から 0, 1, 2, … 番）"}</div>
    <textarea data-k="verts" rows="${Math.min(10, Math.max(4, (el.vertices ?? []).length + 1))}" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px">${escapeHtml(vtext)}</textarea>
    ${isHull ? "" : `<div class="field-note">面（1 行に、頂点の番号を周りの順に 3 つ以上。例: 0 1 2 3）</div>
    <textarea data-k="faces" rows="${Math.min(10, Math.max(4, (el.faces ?? []).length + 1))}" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px">${escapeHtml(ftext)}</textarea>`}
    <div class="field-note" data-k="msg">空間の座標（Manim の単位）。「位置」の分だけずらして置きます。入力欄から外れると反映します。</div>`, { top: true });
  const msg = f.querySelector("[data-k=msg]");
  const parseVerts = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,]+/).filter(Boolean).map(Number));
  f.querySelector("[data-k=verts]").addEventListener("change", (e) => {
    const vs = parseVerts(e.target.value);
    const bad = vs.findIndex((v) => v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x)));
    if (bad >= 0) { msg.textContent = `${bad + 1} 行目を読めません（x, y, z の 3 つの数を書きます）。`; msg.className = "field-note ng"; return; }
    el.vertices = vs.map((v) => v.slice(0, 3));
    msg.className = "field-note"; msg.textContent = `${el.vertices.length} 個の${isHull ? "点" : "頂点"}。`;
    changed(el);
  });
  f.querySelector("[data-k=faces]")?.addEventListener("change", (e) => {
    const fs = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,]+/).filter(Boolean).map(Number));
    const n = (el.vertices ?? []).length;
    const bad = fs.findIndex((q) => q.length < 3 || q.some((i) => !Number.isInteger(i) || i < 0 || i >= n));
    if (bad >= 0) { msg.textContent = `面の ${bad + 1} 行目が正しくありません（0〜${n - 1} の番号を 3 つ以上）。`; msg.className = "field-note ng"; return; }
    el.faces = fs;
    msg.className = "field-note"; msg.textContent = `${el.faces.length} 個の面。`;
    changed(el);
  });
}

function samplespaceFields(sec, el, add, changed) {
  const u = P();
  const cols = el.split !== "rows";
  const fk = add("分け方", `<div class="seg" data-k="sp"><button type="button" data-v="columns">横に分ける（列）</button><button type="button" data-v="rows">縦に分ける（行）</button></div>
    <div class="field-note">1 段目の区画のラベルは、中かっこを付けて${cols ? "上" : "左"}に置きます。2 段目は、それぞれの区画をもう一方の向きに分け、ラベルは区画の中に置きます。確率は、合計が 1 になるようにそろえます。</div>`, { top: true });
  bindSeg(fk, "sp", () => el.split, (v) => { el.split = v; changed(el); reselect(el); });
  const row = (q, path, depth) => `<tr data-path="${path}"><td style="padding-left:${depth * 14}px">${depth ? "└" : ""}</td>
    <td><input type="number" class="num" data-k="p" step="0.05" min="0" value="${q.p}"></td>
    <td><input type="color" data-k="color" value="${(q.color || "#58C4DD").toLowerCase()}"></td>
    <td><input data-k="label" value="${escapeHtml(q.label)}" spellcheck="false" style="width:8em" placeholder="空欄で無し"></td>
    <td>${depth ? "" : `<button type="button" class="small" data-a="addsub" title="この区画を分ける">分ける</button>`}<button type="button" class="small" data-a="del" title="消す">×</button></td></tr>`;
  const body = el.parts.map((q, i) => row(q, `${i}`, 0) + (q.sub ?? []).map((r, j) => row(r, `${i}.${j}`, 1)).join("")).join("");
  const fp = add("区画", `<table class="table-grid"><thead><tr><th></th><th>確率</th><th>色</th><th>ラベル（数式）</th><th></th></tr></thead><tbody>${body}</tbody></table>
    <div class="row"><button type="button" class="small" data-a="add">＋ 区画を足す</button></div>
    <div class="field-note">ラベルは LaTeX（数式）で書きます（例: P(A)、P(B|\\bar{A})）。日本語は自動で \\text{…} になります。</div>`, { top: true });
  const at = (path) => { const [i, j] = path.split(".").map(Number); return j === undefined ? el.parts[i] : el.parts[i].sub[j]; };
  fp.querySelectorAll("tbody tr").forEach((tr) => {
    const q = at(tr.dataset.path);
    tr.querySelector("[data-k=p]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { q.p = v; changed(el); } });
    tr.querySelector("[data-k=color]").addEventListener("input", (e) => { q.color = e.target.value.toUpperCase(); changed(el); });
    tr.querySelector("[data-k=label]").addEventListener("change", (e) => { q.label = e.target.value; changed(el); });
    tr.querySelector("[data-a=addsub]")?.addEventListener("click", () => {
      q.sub = q.sub?.length ? [...q.sub, { p: 0.5, color: "#9A72AC", label: "" }] : [{ p: 0.5, color: "#236B8E", label: "" }, { p: 0.5, color: "#9CDCEB", label: "" }];
      changed(el); reselect(el);
    });
    tr.querySelector("[data-a=del]").addEventListener("click", () => {
      const [i, j] = tr.dataset.path.split(".").map(Number);
      if (j === undefined) { if (el.parts.length > 1) el.parts.splice(i, 1); } else el.parts[i].sub.splice(j, 1);
      changed(el); reselect(el);
    });
  });
  fp.querySelector("[data-a=add]").addEventListener("click", () => {
    const pal = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC"];
    el.parts.push({ p: 0.3, color: pal[el.parts.length % pal.length], label: "", sub: [] });
    changed(el); reselect(el);
  });
  const fs = add("見た目", `<div class="row"><span class="unit">横</span>${num("w", r2(el.width / u), { step: 0.5, min: 0.1 })}<span class="unit">縦</span>${num("h", r2(el.height / u), { step: 0.5, min: 0.1 })}</div>
    <div class="row"><span class="unit">題名</span><input data-k="title" value="${escapeHtml(el.title ?? "")}" placeholder="空欄で無し（LaTeX の文章）" style="flex:1"></div>
    <div class="row"><span class="unit">ラベルの大きさ</span>${num("ls", el.labelSize ?? 30, { step: 2, min: 4 })}${colorInput("lc", el.labelColor)}</div>
    <div class="row"><span class="unit">枠の線</span>${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    <div class="row"><span class="unit">塗りの不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>`);
  const q = (k) => fs.querySelector(`[data-k=${k}]`);
  q("w").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.width = v; changed(el); } });
  q("h").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.height = v; changed(el); } });
  q("title").addEventListener("change", (e) => { el.title = e.target.value; changed(el); });
  q("ls").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  bindColor(fs, "lc", () => el.labelColor, (v) => { el.labelColor = v; changed(el); });
  bindColor(fs, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  q("sw").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  q("fo").addEventListener("change", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fs)) { q("w").value = r2(el.width / u); q("h").value = r2(el.height / u); } });
}


// ---------------------------------------------------------------- グラフ理論のグラフ（Graph・DiGraph）

const NET_LAYOUTS = [
  ["kamada_kawai", "kamada_kawai（辺の長さがそろう）"], ["spring", "spring（ばねのつり合い。乱数）"], ["circular", "circular（円周上）"],
  ["shell", "shell（組ごとの同心円）"], ["planar", "planar（辺が交わらない。平面的なグラフだけ）"], ["spectral", "spectral（固有ベクトル）"],
  ["spiral", "spiral（らせん）"], ["tree", "tree（木。根から下へ）"], ["partite", "partite（組ごとの列。2 部グラフなど）"],
  ["random", "random（ばらばら。乱数）"], ["manual", "手で動かす（頂点をドラッグ）"],
];

function netgraphFields(sec, el, add, changed) {
  const lay = el.layout;
  const grouped = lay === "partite" || lay === "shell";
  const fk = add("種類", `<div class="seg" data-k="dir"><button type="button" data-v="u">無向グラフ（Graph）</button><button type="button" data-v="d">有向グラフ（DiGraph）</button></div>`, { top: true });
  bindSeg(fk, "dir", () => (el.directed ? "d" : "u"), (v) => { el.directed = v === "d"; changed(el); reselect(el); });
  // 頂点
  const rows = el.vertices.map((v, i) => `<tr data-i="${i}"><td><input data-k="name" value="${escapeHtml(v.name)}" spellcheck="false" style="width:6em"></td>
    ${grouped ? `<td><input type="number" class="num" data-k="group" step="1" min="0" value="${v.group ?? 0}" style="width:3.5em"></td>` : ""}
    <td><input type="color" data-k="color" value="${(v.color || el.fill.color || "#58C4DD").toLowerCase()}">${v.color ? `<button type="button" class="small" data-a="cr" title="既定の色に戻す">既定</button>` : ""}</td>
    <td><button type="button" class="small" data-a="del" title="消す（この頂点の辺も消えます）" ${el.vertices.length <= 1 ? "disabled" : ""}>×</button></td></tr>`).join("");
  const fv = add("頂点", `<table class="table-grid"><thead><tr><th>名前</th>${grouped ? "<th>組</th>" : ""}<th>色</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row"><button type="button" class="small" data-a="addv">＋ 頂点を足す</button></div>
    <div class="field-note">名前は頂点の中に数式（LaTeX）で書かれます（日本語は自動で \\text{…}）。名前を変えると、辺もそのまま付いてきます。${grouped ? "「組」の番号ごとに、" + (lay === "partite" ? "列に並べます（2 部グラフなら 0 と 1）。" : "同心円に並べます（0 がいちばん内側）。") : ""}</div>`, { top: true });
  fv.querySelectorAll("tbody tr").forEach((tr) => {
    const i = Number(tr.dataset.i), v = el.vertices[i];
    tr.querySelector("[data-k=name]").addEventListener("change", (e) => {
      const nn = e.target.value.trim();
      if (!nn || el.vertices.some((w, j) => j !== i && w.name === nn)) { toast(nn ? `頂点の名前「${nn}」は、ほかの頂点と重なっています。` : "頂点の名前が空です。", "warn"); e.target.value = v.name; return; }
      const old = v.name;
      v.name = nn;
      el.edges = el.edges.map(([a, b]) => [a === old ? nn : a, b === old ? nn : b]);
      if (el.positions?.[old]) { el.positions[nn] = el.positions[old]; delete el.positions[old]; }
      if (el.root === old) el.root = nn;
      changed(el); reselect(el);
    });
    tr.querySelector("[data-k=group]")?.addEventListener("change", (e) => { const g = Math.round(Number(e.target.value)); if (g >= 0) { v.group = g; changed(el); } });
    tr.querySelector("[data-k=color]").addEventListener("input", (e) => { v.color = e.target.value.toUpperCase(); changed(el); });
    tr.querySelector("[data-a=cr]")?.addEventListener("click", () => { v.color = null; changed(el); reselect(el); });
    tr.querySelector("[data-a=del]").addEventListener("click", () => {
      el.vertices.splice(i, 1);
      el.edges = el.edges.filter(([a, b]) => a !== v.name && b !== v.name);
      if (el.positions) delete el.positions[v.name];
      changed(el); reselect(el);
    });
  });
  fv.querySelector("[data-a=addv]").addEventListener("click", () => {
    let k = el.vertices.length, name;
    do { name = k < 26 ? String.fromCharCode(65 + k) : `v${k}`; k++; } while (el.vertices.some((w) => w.name === name));
    el.vertices.push({ name, group: 0, color: null });
    if (el.layout === "manual") el.positions = { ...(el.positions ?? {}), [name]: [0, 0] };
    changed(el); reselect(el);
  });
  // 辺
  const fe = add("辺", `<textarea data-k="edges" rows="${Math.min(10, Math.max(3, el.edges.length + 1))}" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12px">${escapeHtml(el.edges.map(([a, b]) => `${a} ${b}`).join("\n"))}</textarea>
    <div class="field-note" data-k="emsg">1 行に 1 本、両端の頂点の名前を空白（または - や , ）で区切って書きます${el.directed ? "（左から右への向き）" : ""}。例: A B。入力欄から外れると反映します。</div>`, { top: true });
  fe.querySelector("[data-k=edges]").addEventListener("change", (e) => {
    const names = new Set(el.vertices.map((v) => v.name));
    const out = [], bad = [];
    e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).forEach((l, k) => {
      const m = l.split(/\s*(?:->|-|,|\s)\s*/).filter(Boolean);
      if (m.length === 2 && names.has(m[0]) && names.has(m[1]) && m[0] !== m[1]) out.push([m[0], m[1]]); else bad.push(k + 1);
    });
    const msg = fe.querySelector("[data-k=emsg]");
    if (bad.length) { msg.textContent = `${bad.join("・")} 行目を読めません（頂点の名前を 2 つ。自分への辺は不可）。`; msg.className = "field-note ng"; return; }
    msg.className = "field-note"; msg.textContent = `${out.length} 本の辺。`;
    el.edges = out; changed(el);
  });
  // 配置
  const fl = add("配置", `<select data-k="layout">${NET_LAYOUTS.map(([v, t]) => `<option value="${v}" ${v === lay ? "selected" : ""}>${t}</option>`).join("")}</select>
    ${lay === "tree" ? `<div class="row"><span class="unit">根</span><select data-k="root">${el.vertices.map((v) => `<option ${v.name === el.root ? "selected" : ""}>${escapeHtml(v.name)}</option>`).join("")}</select></div>` : ""}
    ${lay === "spring" || lay === "random" ? `<div class="row"><span class="unit">乱数の種</span>${num("seed", el.seed ?? 1, { step: 1, min: 0 })}<button type="button" class="small" data-a="reseed">別の配置にする</button></div>` : ""}
    ${lay === "manual" ? "" : `<div class="row"><span class="unit">大きさ</span>${num("ls", el.layoutScale ?? 2, { step: 0.25, min: 0.1 })}</div>`}
    ${lay === "manual" ? `<div class="row"><button type="button" class="small" data-a="auto">自動の配置に戻す</button></div>` : `<div class="row"><button type="button" class="small" data-a="manual">この配置から手で動かす</button></div>`}
    <div class="field-note">${lay === "manual" ? "キャンバスで頂点の上のオレンジの丸をドラッグして動かします（Shift で水平・垂直に）。" : "Manim（NetworkX）が頂点の位置を自動で決めます。乱数を使う配置は「乱数の種」で毎回同じ配置にします（種を変えると別の配置）。tree は木（閉路の無いつながったグラフ）、planar は辺を交差させずに描けるグラフでだけ使えます。「この配置から手で動かす」で、今の位置から頂点を自由に動かせます。"}</div>`, { top: true });
  fl.querySelector("[data-k=layout]").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "manual") toManual(); else { el.layout = v; changed(el); reselect(el); }
  });
  const toManual = () => {
    const o = fabricObjectOf(el.id);
    el.positions = { ...(o?.layoutPos ?? {}) };
    el.layout = "manual";
    changed(el); reselect(el);
  };
  fl.querySelector("[data-k=root]")?.addEventListener("change", (e) => { el.root = e.target.value; changed(el); });
  fl.querySelector("[data-k=seed]")?.addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0) { el.seed = v; changed(el); } });
  fl.querySelector("[data-a=reseed]")?.addEventListener("click", () => { el.seed = (Number(el.seed) || 0) + 1; fl.querySelector("[data-k=seed]").value = el.seed; changed(el); });
  fl.querySelector("[data-k=ls]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.layoutScale = v; changed(el); } });
  fl.querySelector("[data-a=manual]")?.addEventListener("click", toManual);
  fl.querySelector("[data-a=auto]")?.addEventListener("click", () => { el.layout = "kamada_kawai"; changed(el); reselect(el); });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fl)) { const i = fl.querySelector("[data-k=ls]"); if (i) i.value = el.layoutScale; } });
  // 見た目
  const fs = add("見た目", `<label class="row"><input type="checkbox" data-k="sl" ${el.showLabels ? "checked" : ""}> 頂点に名前を書く</label>
    <div class="row"><span class="unit">名前の大きさ</span>${num("lsz", el.labelSize ?? 30, { step: 2, min: 4 })}${colorInput("lc", el.labelColor || "#000000")}</div>
    <div class="row"><span class="unit">頂点の半径</span>${num("vr", el.vertexRadius ?? 0.15, { step: 0.05, min: 0.01 })}<span class="unit">色</span>${colorInput("vc", el.fill.color)}</div>
    <div class="row"><span class="unit">辺</span>${colorInput("ec", el.stroke.color)}<span class="unit">太さ</span>${num("ew", el.stroke.width, { step: 0.5, min: 0 })}</div>
    ${el.directed ? `<div class="row"><span class="unit">矢じりの大きさ</span>${num("ts", el.tipSize ?? 0.2, { step: 0.05, min: 0.02 })}</div>` : ""}
    <div class="field-note">名前を書くときは、名前が収まるように頂点が大きくなります。</div>`);
  const q = (k) => fs.querySelector(`[data-k=${k}]`);
  q("sl").addEventListener("change", (e) => { el.showLabels = e.target.checked; changed(el); });
  q("lsz").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  bindColor(fs, "lc", () => el.labelColor, (v) => { el.labelColor = v; changed(el); });
  q("vr").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.vertexRadius = v; changed(el); } });
  bindColor(fs, "vc", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
  bindColor(fs, "ec", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  q("ew").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  q("ts")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.tipSize = v; changed(el); } });
}


// ---------------------------------------------------------------- 矢じり・注釈・ベクトル

const TIP_SHAPES = [["triangle", "三角（塗り）"], ["triangle_outline", "三角（輪郭）"], ["stealth", "鋭い三角（Stealth）"],
  ["circle", "丸（塗り）"], ["circle_outline", "丸（輪郭）"], ["square", "四角（塗り）"], ["square_outline", "四角（輪郭）"]];

function annotFields(sec, el, add, changed) {
  const t = findElement(el.targetId);
  const k = el.annotKind;
  const ft = add("付ける要素", t ? `<button type="button" class="link" data-a="t">${escapeHtml(t.var)}</button><div class="field-note">${k === "arcbrace" ? "円弧の中心・半径・角度に合わせて付けます。" : "付ける要素の外接矩形に合わせて付けます。"}要素を動かす・大きさを変えると、注釈もついてきます（描画では、作ったときの形のまま）。</div>` : `<span class="field-note ng">付ける要素が見つかりません</span>`, { top: true });
  ft.querySelector("[data-a=t]")?.addEventListener("click", () => select(t.id));
  if (k === "animated") {
    const cols = el.colors ?? [];
    const f = add("色が流れる枠", `<div class="row">${cols.map((c, i) => colorInput(`ac${i}`, c)).join("")}</div>
      <div class="row">${cols.length < 6 ? `<button type="button" class="small" data-a="cadd">＋色</button>` : ""}${cols.length > 2 ? `<button type="button" class="small" data-a="cdel">－色</button>` : ""}</div>
      <div class="row"><span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}<span class="unit">色が変わる速さ</span>${num("cr", el.cycleRate ?? 0.5, { step: 0.1, min: 0.05 })}</div>
      <div class="field-note">要素の輪郭に沿って、色が流れ続ける線（AnimatedBoundary）。最初の色で一周した所から始まり、アニメーションや待ち（self.wait(3) など）の間、色が流れます（発表で止まっている間は止まります）。速さは cycle_rate（1 秒あたりに進む色の数）。</div>`, { top: true });
    cols.forEach((_, i) => bindColor(f, `ac${i}`, () => el.colors[i], (v) => { el.colors[i] = v; changed(el); }));
    f.querySelector("[data-a=cadd]")?.addEventListener("click", () => { el.colors.push("#FFFF00"); changed(el); reselect(el); });
    f.querySelector("[data-a=cdel]")?.addEventListener("click", () => { el.colors.pop(); changed(el); reselect(el); });
    f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
    f.querySelector("[data-k=cr]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.cycleRate = v; changed(el); } });
    return;
  }
  if (k !== "arcbrace") {
    const fk = add("種類", `<div class="seg" data-k="ak"><button type="button" data-v="box">囲み枠</button><button type="button" data-v="bg">背景の四角</button><button type="button" data-v="underline">下線</button><button type="button" data-v="cross">×印</button></div>`, { top: true });
    bindSeg(fk, "ak", () => el.annotKind, (v) => {
      el.annotKind = v;
      if (v === "bg") el.fill = { color: store.project.settings.background, opacity: 0.75 };
      else if (el.fill.opacity >= 0.75 && v !== "box") el.fill = { color: null, opacity: 0 };
      if (v === "cross") el.stroke = { ...el.stroke, color: "#FC6255", width: 6 };
      changed(el); reselect(el);
    });
  }
  if (k === "bg") {
    const f = add("背景", `<div class="row">${colorInput("fc", el.fill.color || store.project.settings.background)}<span class="unit">不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>
      <div class="row"><span class="unit">余白</span>${num("bf", el.buff, { step: 0.05, min: 0 })}</div>
      <div class="field-note">要素の後ろに敷く四角です（グラフや図の上の文字を読みやすくする。BackgroundRectangle）。背景の四角は要素のすぐ後ろの重なり順に置きます。</div>`, { top: true });
    bindColor(f, "fc", () => el.fill.color, (v) => { el.fill.color = v; changed(el); });
    f.querySelector("[data-k=fo]").addEventListener("change", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
    f.querySelector("[data-k=bf]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.buff = v; changed(el); } });
    return;
  }
  const f = add("線", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}</div>
    ${k === "box" || k === "underline" ? `<div class="row"><span class="unit">${k === "box" ? "余白" : "すき間"}</span>${num("bf", el.buff, { step: 0.05, min: 0 })}${k === "box" ? `<span class="unit">角丸</span>${num("cr", el.cornerRadius, { step: 0.05, min: 0 })}` : ""}</div>` : ""}
    ${k === "box" ? `<div class="row"><span class="unit">塗りの不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(el.fill.opacity * 100)}"></div>` : ""}
    ${k === "cross" ? `<div class="row"><span class="unit">大きさの倍率</span>${num("sf", el.scaleFactor, { step: 0.1, min: 0.05 })}</div>` : ""}
    ${k === "arcbrace" ? `<div class="seg" data-k="out"><button type="button" data-v="1">外側</button><button type="button" data-v="0">内側</button></div>` : ""}`, { top: true });
  bindColor(f, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  f.querySelector("[data-k=bf]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.buff = v; changed(el); } });
  f.querySelector("[data-k=cr]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.cornerRadius = v; changed(el); } });
  f.querySelector("[data-k=fo]")?.addEventListener("change", (e) => { el.fill.opacity = Number(e.target.value) / 100; changed(el); });
  f.querySelector("[data-k=sf]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.scaleFactor = v; changed(el); } });
  if (k === "arcbrace") {
    bindSeg(f, "out", () => (el.outside ? "1" : "0"), (v) => { el.outside = v === "1"; changed(el); });
    const fl = add("ラベル", `<div class="row"><input data-k="label" value="${escapeHtml(el.label ?? "")}" spellcheck="false" placeholder="例: \\theta、r\\theta（空欄なら無し）" style="flex:1"></div>
      <div class="row"><span class="unit">大きさ</span>${num("ls", el.labelSize ?? 30, { step: 2, min: 2 })}</div>`);
    fl.querySelector("[data-k=label]").addEventListener("change", (e) => { el.label = e.target.value; changed(el); });
    fl.querySelector("[data-k=ls]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  }
}

function vectorFields(sec, el, add, changed) {
  const axes = el.axesId ? findElement(el.axesId) : null;
  if (el.axesId) {
    const fa = add("座標軸", axes ? `<button type="button" class="link" data-a="axes">${escapeHtml(axes.var)}</button><div class="field-note">座標軸の座標で描き、座標軸と一緒に動きます。</div>` : `<span class="field-note ng">座標軸が見つかりません</span>`, { top: true });
    fa.querySelector("[data-a=axes]")?.addEventListener("click", () => select(axes.id));
  }
  exprFields(add, el, changed, "成分と始点", [["xExpr", "x 成分"], ["yExpr", "y 成分"], ["x0Expr", "始点 x"], ["y0Expr", "始点 y"]],
    `${el.axesId ? "座標軸の座標。" : "Manim の単位（始点は要素の位置からのずれ）。"}数か式で書けます。スライドの値を使うと（例: \\cos t）、値に合わせて動きます。`);
  const f = add("見た目", `<div class="row">${colorInput("sc", el.stroke.color)}<span class="unit">太さ</span>${num("sw", el.stroke.width, { step: 0.5, min: 0 })}<span class="unit">矢じり</span>${num("ts", el.tipSize, { step: 0.05, min: 0.02 })}</div>
    <label class="row"><input type="checkbox" data-k="co" ${el.coords ? "checked" : ""}> 先に成分を書く（縦の行列）</label><div class="row"><span class="unit">成分の大きさ</span>${num("cs", el.coordSize ?? 30, { step: 2, min: 4 })}</div>`);
  bindColor(f, "sc", () => el.stroke.color, (v) => { el.stroke.color = v; changed(el); });
  f.querySelector("[data-k=sw]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.stroke.width = v; changed(el); } });
  f.querySelector("[data-k=ts]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.tipSize = v; changed(el); } });
  f.querySelector("[data-k=co]").addEventListener("change", (e) => { el.coords = e.target.checked; changed(el); });
  f.querySelector("[data-k=cs]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.coordSize = v; changed(el); } });
}
