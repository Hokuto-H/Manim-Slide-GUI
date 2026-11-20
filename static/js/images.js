// 画像（F10）: 取り込み（ボタン・ドラッグ＆ドロップ・貼り付け）と、プレビュー用の読み込み。
// 画像はプロジェクトの images/ にコピーし、要素には相対パス（images/名前-ハッシュ.png）を持たせる。

import { ApiError, appHeaders } from "./api.js";
import { addMediaFiles, isMediaFile, placeMedia, uploadClip } from "./media.js";
import { refreshElement } from "./canvas.js";
import { backgroundOf } from "./masters.js";
import { select } from "./selection.js";
import { currentSlide, markDirty, store, toast, uid, uniqueVar } from "./store.js";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.svg,.svgz";
const cache = new Map(); // path → Promise<HTMLImageElement>

/** プロジェクトの画像を読み込む（トークンを付けて取得し、blob の URL にする）。 */
export function loadImage(path) {
  const key = `${store.folder}|${path}`;
  if (!cache.has(key)) {
    const p = (async () => {
      const res = await fetch(`/api/project/image?path=${encodeURIComponent(path)}`, { headers: appHeaders() });
      if (!res.ok) {
        let msg = `画像を読み込めません（${res.status}）`;
        try { msg = (await res.json()).detail || msg; } catch { /* そのまま */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await res.blob());
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    })();
    p.catch(() => cache.delete(key)); // 失敗したら次の機会に読み直す
    cache.set(key, p);
  }
  return cache.get(key);
}

/** ファイルをサーバーに送って images/ に取り込む。 */
export async function uploadImage(file) {
  let res;
  try {
    res = await fetch("/api/project/image", {
      method: "POST",
      headers: { ...appHeaders(), "X-File-Name": encodeURIComponent(file.name || "pasted.png"), "Content-Type": "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError(0, "サーバーに接続できません。");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail ?? res.statusText);
  return data;
}

/** 新しい画像要素の大きさ: 元の画素数（1080p で 1 画素 = 1px、Manim の既定と同じ）。大きすぎればスライドの 60% に収める。 */
function initialWidth(w, h) {
  const { w: cw, h: ch } = store.meta.canvas;
  const k = Math.min(1, (cw * 0.6) / w, (ch * 0.6) / h);
  return Math.round(w * k * 10) / 10;
}

/** ファイルを取り込んで、画像要素として置く。at はキャンバスの位置（省略時は中央付近）。 */
export async function addImageFiles(files, at = null) {
  const slide = currentSlide();
  if (!slide) return;
  const list = [...files].filter((f) => f && (f.type?.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?|svgz?)$/i.test(f.name || "")));
  if (!list.length) { toast("画像のファイルではありません。", "warn"); return; }
  const added = [];
  for (const [k, file] of list.entries()) {
    // 動く画像（アニメーション GIF など）: 動画にして、くり返し再生する要素として置くか聞く
    const frames = await animFrameCount(file);
    if (frames > 1 && confirm(`「${file.name || "画像"}」は動く画像です（${frames} コマ）。\n\nOK: 動かす（音の無い動画にして、スライドの初めから、くり返し再生します）\nキャンセル: 最初のコマだけの画像として置く`)) {
      const bg = slideBackground(slide);
      toast(`${file.name} を動画にしています…`, "", 3000);
      try {
        const info = await uploadClip(file, { "X-Anim-Image": "1", "X-Background": bg });
        const el = await placeMedia(slide, info, at, k, {
          var: uniqueVar("gif"), start: "auto", loop: true, controls: false, volume: 0, after: "hold", animImage: { name: file.name, frames: info.frames, background: info.background },
        });
        added.push(el);
        toast(`動く画像として置きました。発表ウィンドウと Ctrl+Enter の試し描画で、スライドの初めからくり返し再生します（透明な部分は、背景の色 ${info.background} で塗りました）。`, "", 9000);
      } catch (e) {
        toast(`${file.name || "画像"}: ${e.message}`, "ng", 8000);
      }
      continue;
    }
    let info;
    try {
      info = await uploadImage(file);
    } catch (e) {
      toast(`${file.name || "画像"}: ${e.message}`, "ng", 7000);
      continue;
    }
    if (info.note) toast(`${file.name}: ${info.note}`, "", 6000);
    const { w, h } = store.meta.canvas;
    const offset = ((slide.elements.length % 6) + k) * 30;
    if (info.kind === "svg") {
      // SVG は図形（Manim の SVGMobject）として置く。拡大してもぼやけない
      const s = store.project.settings;
      const iw = initialWidth(info.width * 3, info.height * 3);
      const el = {
        id: uid("e"), type: "shape", shape: "svg", var: uniqueVar("svg"), rotation: 0, visibleAtStart: true,
        x: (at?.x ?? w / 2) + (at ? k * 30 : offset), y: (at?.y ?? h / 2) + (at ? k * 30 : offset),
        path: info.path, name: info.name, natW: info.width, natH: info.height, width: iw, height: Math.round(iw * info.height / info.width * 10) / 10,
        keepAspect: true, colorMode: "original", strokeOverride: false, opacity: 1,
        stroke: { color: s.defaultColor, width: 2, opacity: 1 }, fill: { color: s.defaultColor, opacity: 1 }, dashed: false, dashLength: 0.15,
      };
      slide.elements.push(el);
      added.push(el);
      markDirty("add");
      await refreshElement(el);
      continue;
    }
    const el = {
      id: uid("e"), type: "image", var: uniqueVar("img"),
      x: (at?.x ?? w / 2) + (at ? k * 30 : offset), y: (at?.y ?? h / 2) + (at ? k * 30 : offset),
      path: info.path, name: info.name, natW: info.width, natH: info.height, width: initialWidth(info.width, info.height),
      height: Math.round(initialWidth(info.width, info.height) * info.height / info.width * 10) / 10, keepAspect: true,
      opacity: 1, smooth: true, visibleAtStart: true, color: store.project.settings.defaultColor, fontSize: store.project.settings.defaultFontSize,
    };
    slide.elements.push(el);
    added.push(el);
    markDirty("add");
    await refreshElement(el);
  }
  if (added.length) select(added.at(-1).id);
}

/** 画像要素のファイルを差し替える（幅はそのまま、高さは新しい画像の縦横比に合わせる）。 */
export async function replaceImage(el, file) {
  const info = await uploadImage(file);
  if (info.note) toast(info.note, "", 6000);
  if ((info.kind === "svg") !== (el.shape === "svg")) {
    toast(el.shape === "svg" ? "SVG は SVG のファイルで差し替えてください。" : "画像は PNG・JPEG などで差し替えてください（SVG は図形として「＋画像」で追加します）。", "warn", 6000);
    return;
  }
  Object.assign(el, {
    path: info.path, name: info.name, natW: info.width, natH: info.height,
    height: Math.round(el.width * info.height / info.width * 10) / 10, // 幅はそのまま、新しい画像の縦横比に
  });
  markDirty("prop");
  await refreshElement(el);
}

/** ファイルを選ぶダイアログを開く。 */
export function pickImageFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...input.files]));
    input.click();
  });
}

export function setupImages({ stage, toScene }) {
  // ドラッグ＆ドロップ（キャンバスの上に落とした位置に置く）
  stage.addEventListener("dragover", (e) => {
    if (!store.project || ![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    stage.classList.add("drop-target");
  });
  stage.addEventListener("dragleave", (e) => { if (!stage.contains(e.relatedTarget)) stage.classList.remove("drop-target"); });
  stage.addEventListener("drop", (e) => {
    stage.classList.remove("drop-target");
    if (!store.project || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    // 動画・音声のファイルは動画・音声の要素に、ほかは画像に
    const all = [...e.dataTransfer.files], av = all.filter(isMediaFile), rest = all.filter((f) => !isMediaFile(f));
    if (av.length) addMediaFiles(av, toScene(e));
    if (rest.length) addImageFiles(rest, toScene(e));
  });
  // 貼り付け（Ctrl+V）。入力欄の中での貼り付けは、そのまま文字の貼り付けとして扱う
  document.addEventListener("paste", (e) => {
    if (!store.project || document.querySelector("dialog[open]")) return;
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    const files = [...(e.clipboardData?.items ?? [])].filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    const named = files.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted${i ? i + 1 : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }));
    addImageFiles(named);
  });
}

/** 動く画像（GIF・WebP・APNG）のコマ数。調べられないときや静止画は 1 以下。Chrome・Edge の ImageDecoder を使う。 */
async function animFrameCount(file) {
  const m = /\.(gif|webp|png|apng)$/i.exec(file?.name || "");
  if (!m || !("ImageDecoder" in window)) return 0;
  const type = file.type || { gif: "image/gif", webp: "image/webp", png: "image/png", apng: "image/apng" }[m[1].toLowerCase()];
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return 0;
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack?.frameCount ?? 1;
    dec.close();
    return n;
  } catch {
    return 0;
  }
}

/** 動く画像の透明な部分を塗る色（スライドの背景色）。 */
function slideBackground(slide) {
  return backgroundOf(slide) || "#FFFFFF";
}

