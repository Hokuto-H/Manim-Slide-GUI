// 要素のコピー・切り取り・貼り付け・複製（Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D）。
// クリップボードには、このアプリ用の形式（JSON）で書く。別のスライドや、別のプロジェクトにも貼り付けられる
// （別のプロジェクトの画像は、貼り付け先の images/ に取り込む）。アニメーションのステップは貼り付けない。

import { api } from "./api.js";
import { refreshElement, showSlide } from "./canvas.js";
import { deleteSelection, select, selectMany } from "./selection.js";
import {
  compactGroups, currentSlide, findElement, findGroup, groupMembers, markDirty, slideGroups, store, toast, uid, uniqueVar,
} from "./store.js";

const MIME = "application/x-manim-slide-gui+json";
const OFFSET = 30; // 同じスライドに貼り付けるとき、ずらす量（px）
let lastClip = null; // { json, text }（メニューからの貼り付けや、独自形式を読めないときに使う）
const pasteCount = new Map(); // 「コピーした内容 × スライド」ごとの貼り付け回数（同じ所に重ならないようにずらす）

const inField = (t) => t?.closest?.("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]");
// ページの文字（描画ログ・エラーの表示など）を選んでいるときは、ブラウザのふつうのコピーにする
const hasTextSelection = () => {
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
};

/** 選択中の要素（グループを選んでいればグループごと）を、貼り付け用のデータにする。 */
function buildPayload() {
  const slide = currentSlide();
  const ids = new Set(store.selectedIds);
  if (!slide || !ids.size) return null;
  const elements = slide.elements.filter((e) => ids.has(e.id)).map((e) => JSON.parse(JSON.stringify(e)));
  // 要素がすべて含まれるグループだけ、グループとして写す
  const groups = slideGroups(slide).filter((g) => groupMembers(g.id).length && groupMembers(g.id).every((m) => ids.has(m.id)))
    .map((g) => ({ ...g }));
  const hadSteps = slide.steps.some((s) => ids.has(s.elementId) || groups.some((g) => g.id === s.elementId));
  // 部品の中身（別のプロジェクトに貼り付けても描けるように）
  const partIds = new Set(elements.filter((e) => e.shape === "part").map((e) => e.partId));
  const parts = (store.project.parts ?? []).filter((p) => partIds.has(p.id)).map((p) => JSON.parse(JSON.stringify(p)));
  return { app: "manim-slide-gui", version: 1, stamp: uid("c"), folder: store.folder, slideId: slide.id, elements, groups, hadSteps, parts };
}

function plainText(payload) {
  return payload.elements.map((e) => (e.type === "math" ? e.latex : e.type === "image" ? e.name || e.path : e.text) || "").join("\n");
}

export function copySelection(clipboardData = null) {
  const payload = buildPayload();
  if (!payload) return false;
  const json = JSON.stringify(payload);
  lastClip = { json, text: plainText(payload) };
  if (clipboardData) {
    clipboardData.setData(MIME, json);
    clipboardData.setData("text/plain", lastClip.text);
  }
  toast(`${payload.elements.length} 個の要素をコピーしました。`);
  return true;
}

/** 貼り付け用のデータから、今のスライドに要素を作る。 */
const SHAPES_3D = ["solid", "axes3d", "surface", "curve3d", "point3d"];

export async function pastePayload(payload, { offsetOverride = null } = {}) {
  const slide = currentSlide();
  if (!slide || !payload?.elements?.length) return;
  // 3D を使わないプロジェクトには、3D の要素を貼らない（置くときと同じく止めて知らせる。描画の前の検査で止まるため）
  if (!store.project.settings.use3d && payload.elements.some((e) => e.type === "shape" && SHAPES_3D.includes(e.shape))) {
    const rest = payload.elements.filter((e) => !(e.type === "shape" && SHAPES_3D.includes(e.shape)));
    const n = payload.elements.length - rest.length;
    toast(`3D の要素（${n} 個）は貼り付けませんでした。3D の要素は、プロジェクト設定で「3D を使う」をオンにすると置けます。`, "warn", 8000);
    if (!rest.length) return;
    payload = { ...payload, elements: rest };
  }
  const key = `${payload.stamp}|${slide.id}`;
  const n = (pasteCount.get(key) ?? 0) + 1;
  pasteCount.set(key, n);
  // 元と同じスライドなら少しずらす（貼り付けるたびに、さらにずらす）
  const off = offsetOverride ?? (payload.slideId === slide.id ? OFFSET * n : OFFSET * (n - 1));
  const gidMap = new Map();
  for (const g of payload.groups ?? []) {
    const ng = { ...g, id: uid("g"), var: uniqueVar((g.var || "").replace(/\d+$/, "") || "group") };
    gidMap.set(g.id, ng.id);
    slideGroups(slide).push(ng);
  }
  const added = [];
  let shownAgain = 0;
  const idMap = new Map(payload.elements.map((e) => [e.id, uid("e")]));
  for (const src of payload.elements) {
    const el = JSON.parse(JSON.stringify(src));
    el.id = idMap.get(src.id);
    // 吹き出しの中身は、一緒に貼り付けた要素だけ
    if (Array.isArray(el.contentIds)) el.contentIds = el.contentIds.filter((id) => idMap.has(id)).map((id) => idMap.get(id));
    // グラフの座標軸・中かっこを付ける要素: 一緒に貼り付けたならその要素、貼り付け先に元の要素があればそれのまま
    for (const k of ["graphId", "line1Id", "line2Id"]) {
      if (!el[k]) continue;
      if (idMap.has(el[k])) el[k] = idMap.get(el[k]);
      else if (!slide.elements.some((e) => e.id === el[k])) { toast(`「${src.var}」は、付いているグラフ・線と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
    }
    // 円周上の点: 円と一緒に貼り付けたならその円、貼り付け先に元の円があればそのまま、無ければふつうの点にする
    if (el.onCircle?.id) {
      if (idMap.has(el.onCircle.id)) el.onCircle = { ...el.onCircle, id: idMap.get(el.onCircle.id) };
      else if (!slide.elements.some((e) => e.id === el.onCircle.id)) delete el.onCircle;
    }
    // 表・行列のセルの要素: 一緒に貼り付けた要素だけ（ほかのセルは空にする。要素が 2 つの表に入らないように）
    if (["table", "matrix"].includes(el.shape) && Array.isArray(el.items)) el.items = el.items.map((r) => r.map((id) => (id && idMap.has(id) ? idMap.get(id) : null)));
    if (Array.isArray(el.followIds)) el.followIds = el.followIds.filter((id) => idMap.has(id) || slide.elements.some((e) => e.id === id)).map((id) => idMap.get(id) ?? id);
    // 合成した図形の元の図形: 一緒に貼り付けたならその図形、貼り付け先に元の図形がすべてあればそのまま
    if (Array.isArray(el.operandIds)) {
      if (el.operandIds.every((id) => idMap.has(id))) el.operandIds = el.operandIds.map((id) => idMap.get(id));
      else if (!el.operandIds.every((id) => idMap.has(id) || slide.elements.some((e) => e.id === id))) {
        toast(`合成した図形「${src.var}」は、元の図形と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true;
      } else el.operandIds = el.operandIds.map((id) => idMap.get(id) ?? id);
    }
    for (const k of ["axesId", "targetId"]) {
      if (!el[k]) continue;
      if (idMap.has(el[k])) el[k] = idMap.get(el[k]);
      else if (!slide.elements.some((e) => e.id === el[k])) {
        if (["curve2d", "implicit"].includes(el.shape)) { toast(`「${src.var}」は、座標軸と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (["surface", "curve3d", "point3d"].includes(el.shape)) { toast(`「${src.var}」は、3D の座標軸と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (el.shape === "axdot") { toast(`座標の点「${src.var}」は、座標軸と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (el.shape === "graph") { toast(`グラフ「${src.var}」は、座標軸と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (el.shape === "field" || el.shape === "vector") el.axesId = ""; // ベクトル場・ベクトルは、座標軸の無い独立したものにする
        if (el.shape === "annot") { toast(`注釈「${src.var}」は、付ける要素と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (el.shape === "trace") { toast(`軌跡「${src.var}」は、たどる要素と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        if (el.shape === "linegraph") { toast(`折れ線グラフ「${src.var}」は、座標軸と一緒にコピーしないと貼り付けられません。`, "warn", 6000); el.skip = true; }
        // 中かっこは、compactGroups で「2 点の間」の中かっこになる
      }
    }
    if (el.skip) continue;
    // ステップは写さないので、「出す」の動きのために初めは隠していた要素も、貼り付け先では初めから見せる
    // （そのままだと、出す動きの無い要素が薄いまま描画にも出ない）
    if (el.visibleAtStart === false) { el.visibleAtStart = true; shownAgain++; }
    const base = (el.var || "").replace(/\d+$/, "") || ({ math: "eq", image: "img" }[el.type] ?? "text");
    el.var = uniqueVar(base);
    el.x = Number(el.x) + off;
    el.y = Number(el.y) + off;
    // 3D の要素は、空間の位置を少しずらす（右下へ）
    const dw = off / (store.meta.canvas.h / 8);
    if (Array.isArray(el.pos3)) el.pos3 = [el.pos3[0] + dw, el.pos3[1] - dw, el.pos3[2]];
    const sh = (p) => p.map((v, i) => (typeof v === "string" || i === 2 ? v : v + (i === 0 ? dw : -dw)));
    if (el.shape === "point3d" && !el.axesId) { el.p1 = sh(el.p1); el.p2 = sh(el.p2); }
    if (el.groupId) {
      if (gidMap.has(el.groupId)) el.groupId = gidMap.get(el.groupId);
      else delete el.groupId;
    }
    if ((el.type === "image" || el.shape === "svg") && payload.folder && payload.folder !== store.folder) {
      // 別のプロジェクトの画像は、このプロジェクトの images/ に取り込む
      try {
        const info = await api.post("/api/project/image/copy", { folder: payload.folder, path: el.path, name: el.name });
        el.path = info.path;
      } catch (e) {
        toast(`画像「${el.name || el.path}」を取り込めませんでした: ${e.message}`, "ng", 6000);
      }
    }
    if (el.type === "media" && payload.folder && payload.folder !== store.folder) {
      // 別のプロジェクトの動画・音声は、このプロジェクトの clips/ に取り込む
      try {
        const info = await api.post("/api/project/clip/copy", { folder: payload.folder, path: el.path, name: el.name });
        el.path = info.path;
      } catch (e) {
        toast(`「${el.name || el.path}」を取り込めませんでした: ${e.message}`, "ng", 6000);
      }
    }
    if (el.shape === "part") {
      // 部品: このプロジェクトに中身が無ければ（または古ければ）、貼り付けたものの中身を写す
      const src = (payload.parts ?? []).find((p) => p.id === el.partId);
      const list = (store.project.parts ??= []);
      const i = list.findIndex((p) => p.id === el.partId);
      if (src && (i < 0 || Number(src.updatedAt) > Number(list[i].updatedAt))) { if (i < 0) list.push(src); else list[i] = src; }
    }
    slide.elements.push(el); // いちばん手前に置く
    added.push(el);
  }
  compactGroups(slide);
  markDirty("paste");
  await showSlide();
  const gids = [...gidMap.values()];
  if (gids.length === 1 && groupMembers(gids[0]).length === added.length) select(gids[0]);
  else selectMany(added.map((e) => e.id));
  const again = shownAgain ? `「スライド開始時に表示」がオフだった ${shownAgain} 個は、オンにしました（出す動きを足すと、またオフになります）。` : "";
  if (payload.hadSteps || again) toast(`${added.length} 個の要素を貼り付けました（アニメーションのステップは貼り付けません）。${again}`, "", 6000);
}

export async function pasteInternal() {
  if (!lastClip) { toast("コピーした要素がありません。", "warn"); return; }
  await pastePayload(JSON.parse(lastClip.json));
}

export async function duplicateSelection() {
  const payload = buildPayload();
  if (!payload) return;
  await pastePayload(payload, { offsetOverride: OFFSET });
}

export async function cutSelection(clipboardData = null) {
  if (!copySelection(clipboardData)) return;
  deleteSelection();
}

export const hasClip = () => !!lastClip;

export function setupClipboard() {
  // キーボードの Ctrl+C / Ctrl+X / Ctrl+V は、ブラウザの copy / cut / paste の出来事で受け取る（OS のクリップボードに書ける）
  document.addEventListener("copy", (e) => {
    if (!store.project || inField(e.target) || !store.selectedIds.length || hasTextSelection()) return;
    e.preventDefault();
    copySelection(e.clipboardData);
  });
  document.addEventListener("cut", (e) => {
    if (!store.project || inField(e.target) || !store.selectedIds.length || hasTextSelection()) return;
    e.preventDefault();
    cutSelection(e.clipboardData);
  });
  document.addEventListener("paste", (e) => {
    if (!store.project || inField(e.target)) return;
    const dt = e.clipboardData;
    let json = dt?.getData(MIME);
    // 独自形式が読めない環境でも、直前にこのアプリでコピーした内容なら貼り付ける
    if (!json && lastClip && dt && !dt.files?.length && dt.getData("text/plain") === lastClip.text) json = lastClip.json;
    if (!json) return; // 画像の貼り付けなどは、ほかの処理に任せる
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      pastePayload(JSON.parse(json));
    } catch {
      toast("貼り付ける内容を読めませんでした。", "ng");
    }
  }, true); // 画像の貼り付け（images.js）より先に受け取る
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "d") return;
    if (!store.project || inField(e.target) || !store.selectedIds.length) return;
    e.preventDefault(); // ブラウザのブックマーク（Ctrl+D）を止める
    duplicateSelection();
  });
}
