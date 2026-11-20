// 画像のトリミング: 数値で決める・キャンバスで範囲をドラッグして決める。
// el.crop = { l, t, r, b } は、元の画像の残す範囲（0〜1 の割合）。el.width・el.height・el.x・el.y は残した部分の大きさと中心。

import { fabricCanvas, fabricObjectOf, refreshElement } from "./canvas.js";
import { loadImage } from "./images.js";
import { markDirty, toast } from "./store.js";

const FULL = { l: 0, t: 0, r: 1, b: 1 };

/** 今の表示から、元の画像全体がキャンバスで占める四角（左上・幅・高さ）。回転はしていない前提。 */
export function fullRect(el) {
  const c = el.crop ?? FULL;
  const fw = Number(el.width) / Math.max(1e-6, c.r - c.l), fh = Number(el.height) / Math.max(1e-6, c.b - c.t);
  return { x: Number(el.x) - Number(el.width) / 2 - c.l * fw, y: Number(el.y) - Number(el.height) / 2 - c.t * fh, w: fw, h: fh };
}

/** 残す範囲を変える。元の画像全体の位置はそのままで、残した部分の大きさ・中心を合わせる。 */
export function setCrop(el, crop) {
  const F = fullRect(el);
  const c = {
    l: Math.min(1, Math.max(0, crop.l)), t: Math.min(1, Math.max(0, crop.t)),
    r: Math.min(1, Math.max(0, crop.r)), b: Math.min(1, Math.max(0, crop.b)),
  };
  if (c.r - c.l < 0.005 || c.b - c.t < 0.005) return false;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  el.crop = { l: r4(c.l), t: r4(c.t), r: r4(c.r), b: r4(c.b) };
  el.width = Math.round(F.w * (c.r - c.l) * 10) / 10;
  el.height = Math.round(F.h * (c.b - c.t) * 10) / 10;
  el.x = Math.round((F.x + F.w * (c.l + c.r) / 2) * 10) / 10;
  el.y = Math.round((F.y + F.h * (c.t + c.b) / 2) * 10) / 10;
  return true;
}

let session = null;

/** キャンバスで範囲を決める（元の画像全体を薄く出し、残す範囲の四角をドラッグ・角で大きさを変える）。 */
export async function startCropMode(el, onDone) {
  if (session) endCropMode(false);
  if (Math.abs(Number(el.rotation) || 0) > 1e-6) { toast("回転した画像は、数値でトリミングしてください（キャンバスでの範囲の指定は、回転していない画像だけ）。", "warn", 5000); return; }
  await refreshElement(el); // 作り直しの途中なら、終わってから（古い物を隠さないように）
  const cv = fabricCanvas(), f = window.fabric;
  const obj = fabricObjectOf(el.id);
  if (!cv || !obj) return;
  let img;
  try { img = await loadImage(el.path); } catch (e) { toast(e.message, "ng"); return; }
  const F = fullRect(el);
  const c = el.crop ?? FULL;
  const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
  const common = { originX: "left", originY: "top", left: F.x, top: F.y, scaleX: F.w / nw, scaleY: F.h / nh, selectable: false, evented: false, excludeFromExport: true };
  const dim = new f.FabricImage(img, { ...common, opacity: 0.3 });
  const box = new f.Rect({
    left: F.x + c.l * F.w, top: F.y + c.t * F.h, width: (c.r - c.l) * F.w, height: (c.b - c.t) * F.h, originX: "left", originY: "top",
    fill: "rgba(0,0,0,0)", stroke: "#3554d1", strokeWidth: 2, strokeDashArray: [8, 6], strokeUniform: true,
    cornerColor: "#ffffff", cornerStrokeColor: "#3554d1", cornerStyle: "circle", cornerSize: 12, transparentCorners: false,
    lockRotation: true, hasRotatingPoint: false, lockScalingFlip: true, excludeFromExport: true,
  });
  box.setControlsVisibility({ mtr: false });
  box._guiCrop = true;
  const clip = new f.Rect({ left: box.left, top: box.top, width: box.width, height: box.height, originX: "left", originY: "top", absolutePositioned: true });
  const bright = new f.FabricImage(img, { ...common, clipPath: clip });
  // 四角を、元の画像の外に出さない
  const clamp = () => {
    let w = box.width * box.scaleX, h = box.height * box.scaleY;
    w = Math.min(w, F.w); h = Math.min(h, F.h);
    let x = Math.min(Math.max(box.left, F.x), F.x + F.w - w), y = Math.min(Math.max(box.top, F.y), F.y + F.h - h);
    box.set({ left: x, top: y, width: w, height: h, scaleX: 1, scaleY: 1 });
    box.setCoords();
    clip.set({ left: x, top: y, width: w, height: h });
    bright.set("dirty", true);
  };
  box.on("moving", clamp);
  box.on("scaling", clamp);
  box.on("modified", clamp);
  const prevOpacity = obj.opacity;
  obj.set({ opacity: 0, evented: false, selectable: false });
  cv.discardActiveObject();
  const prevUniform = cv.uniformScaling;
  cv.uniformScaling = false; // 角のハンドルで、縦横を別々に変えられるように（Shift で縦横比を保つ）
  cv.add(dim, bright, box);
  cv.setActiveObject(box);
  cv.requestRenderAll();
  // 決定・やめるの帯
  const bar = document.createElement("div");
  bar.className = "crop-bar";
  bar.innerHTML = `<span>残す範囲を、青い四角のドラッグと、角・辺のハンドルで決めます（Enter で決定、Esc でやめる）。</span>
    <button type="button" data-a="all" class="small">全体</button>
    <button type="button" data-a="ok" class="primary small">決定</button><button type="button" data-a="cancel" class="small">やめる</button>`;
  (document.querySelector("#stage") ?? document.body).appendChild(bar);
  session = { el, cv, obj, prevOpacity, prevUniform, items: [dim, bright, box], bar, box, F, onDone, clamp };
  bar.querySelector("[data-a=ok]").addEventListener("click", () => endCropMode(true));
  bar.querySelector("[data-a=cancel]").addEventListener("click", () => endCropMode(false));
  bar.querySelector("[data-a=all]").addEventListener("click", () => { box.set({ left: F.x, top: F.y, width: F.w, height: F.h, scaleX: 1, scaleY: 1 }); clamp(); cv.requestRenderAll(); });
  session.key = (e) => { if (e.key === "Escape") endCropMode(false); else if (e.key === "Enter") endCropMode(true); };
  document.addEventListener("keydown", session.key);
}

export function endCropMode(apply) {
  if (!session) return;
  const { el, cv, obj, prevOpacity, prevUniform, items, bar, box, F, onDone, clamp, key } = session;
  cv.uniformScaling = prevUniform;
  session = null;
  document.removeEventListener("keydown", key);
  if (apply) clamp();
  const crop = { l: (box.left - F.x) / F.w, t: (box.top - F.y) / F.h, r: (box.left + box.width - F.x) / F.w, b: (box.top + box.height - F.y) / F.h };
  box._guiCrop = false;
  for (const it of items) cv.remove(it);
  bar.remove();
  obj.set({ opacity: prevOpacity, evented: true, selectable: !el.locked });
  cv.requestRenderAll();
  if (apply && setCrop(el, crop)) {
    markDirty("prop");
    refreshElement(el).then(() => onDone?.());
  }
}

export const cropModeActive = () => !!session;
