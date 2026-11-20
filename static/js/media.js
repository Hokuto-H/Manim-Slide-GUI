// 動画・音声の要素（取り込み・ポスターの読み込み・追加）。
// 再生は、発表ウィンドウ（と Ctrl+Enter の試し描画）が Manim の映像の上に重ねて行う（発表で再生）。

import { ApiError, appHeaders } from "./api.js";
import { refreshElement } from "./canvas.js";
import { select } from "./selection.js";
import { currentSlide, markDirty, store, toast, uid, uniqueVar } from "./store.js";

export const MEDIA_ACCEPT = ".mp4,.mov,.m4v,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,video/*,audio/*";
export const isMediaFile = (f) => !!f && (f.type?.startsWith("video/") || f.type?.startsWith("audio/")
  || /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i.test(f.name || ""));

/** ファイルをサーバーに送って clips/ に取り込む。 */
export async function uploadClip(file, extraHeaders = {}) {
  let res;
  try {
    res = await fetch("/api/project/clip", {
      method: "POST",
      headers: { ...appHeaders(), "X-File-Name": encodeURIComponent(file.name || "clip.mp4"), "Content-Type": "application/octet-stream", ...extraHeaders },
      body: file,
    });
  } catch {
    throw new ApiError(0, "サーバーに接続できません。");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail ?? res.statusText);
  return data;
}

const posters = new Map();
/** 動画の t 秒のコマ（HTMLImageElement）。 */
export function loadPoster(path, t = 0) {
  const key = `${store.folder}|${path}|${Number(t).toFixed(3)}`;
  if (!posters.has(key)) {
    const p = (async () => {
      const res = await fetch(`/api/project/clip/poster?path=${encodeURIComponent(path)}&t=${Number(t) || 0}`, { headers: appHeaders() });
      if (!res.ok) {
        let msg = `動画のコマを読み込めません（${res.status}）`;
        try { msg = (await res.json()).detail || msg; } catch { /* そのまま */ }
        throw new Error(msg);
      }
      const img = new Image();
      img.src = URL.createObjectURL(await res.blob());
      await img.decode();
      return img;
    })();
    p.catch(() => posters.delete(key));
    posters.set(key, p);
  }
  return posters.get(key);
}

const blobs = new Map();
/** 動画・音声のファイル（object URL。ブラウザでの再生用）。 */
export function clipUrl(path) {
  const key = `${store.folder}|${path}`;
  if (!blobs.has(key)) {
    const p = (async () => {
      const res = await fetch(`/api/project/clip?path=${encodeURIComponent(path)}`, { headers: appHeaders() });
      if (!res.ok) throw new Error(`ファイルを読み込めません（${res.status}）`);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => blobs.delete(key));
    blobs.set(key, p);
  }
  return blobs.get(key);
}

export function pickMediaFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MEDIA_ACCEPT;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...input.files]));
    input.click();
  });
}

/** 新しい要素の値（取り込んだ情報から）。 */
export function mediaFields(info) {
  const { w: cw, h: ch } = store.meta.canvas;
  const base = { path: info.path, name: info.name, kind: info.kind, duration: info.duration, hasAudio: !!info.hasAudio };
  if (info.kind !== "video") return base;
  const k = Math.min(1, (cw * 0.5) / info.width, (ch * 0.5) / info.height);
  const width = Math.round(info.width * k * 10) / 10;
  return { ...base, natW: info.width, natH: info.height, width, height: Math.round(width * info.height / info.width * 10) / 10 };
}

/** ファイルを取り込んで、動画・音声の要素として置く。at はキャンバスの位置（省略時は中央付近）。 */
export async function addMediaFiles(files, at = null) {
  const slide = currentSlide();
  if (!slide) return;
  const list = [...files].filter(isMediaFile);
  if (!list.length) { toast("動画・音声のファイルではありません。", "warn"); return; }
  const added = [];
  for (const [k, file] of list.entries()) {
    toast(`${file.name} を取り込んでいます…`, "", 3000);
    let info;
    try {
      info = await uploadClip(file);
    } catch (e) {
      toast(`${file.name || "ファイル"}: ${e.message}`, "ng", 8000);
      continue;
    }
    added.push(await placeMedia(slide, info, at, k));
  }
  if (added.length) {
    select(added.at(-1).id);
    toast(added.some((e) => e.kind === "video")
      ? "動画は、ステップの gui_media(self, video1, \"play\") で再生します（パネルの「開始」で「自動」にすると、スライドの初めに再生）。発表ウィンドウと Ctrl+Enter の試し描画で再生されます。"
      : "音声は、スライドの初めに自動で再生します（パネルで変えられます）。発表ウィンドウと Ctrl+Enter の試し描画で再生されます。", "", 9000);
  }
}

/** 取り込んだ動画・音声（info）を、要素としてスライドに置く。over は既定の値を上書きする。 */
export async function placeMedia(slide, info, at = null, k = 0, over = {}) {
  {
    const { w, h } = store.meta.canvas;
    const offset = ((slide.elements.length % 6) + k) * 30;
    const video = info.kind === "video";
    const el = {
      id: uid("e"), type: "media", var: uniqueVar(video ? "video" : "audio"), rotation: 0, visibleAtStart: true,
      x: (at?.x ?? (video ? w / 2 : 120)) + (at ? k * 30 : offset), y: (at?.y ?? (video ? h / 2 : 120)) + (at ? k * 30 : offset),
      ...mediaFields(info), mode: "live", start: video ? "step" : "auto", trimStart: 0, trimEnd: null, volume: 1, fadeIn: 0, fadeOut: 0,
      loop: false, after: "hold", controls: true, posterTime: 0, hideIdle: false, across: false, acrossUntil: null, hideIcon: true,
      color: store.project.settings.defaultColor, fontSize: store.project.settings.defaultFontSize,
    };
    if (!video) Object.assign(el, { width: 96, height: 96 });
    Object.assign(el, over);
    slide.elements.push(el);
    markDirty("add");
    await refreshElement(el);
    return el;
  }
}

/** 動画・音声の要素のファイルを差し替える（種類が同じときだけ）。 */
export async function replaceMedia(el, file) {
  const info = await uploadClip(file);
  if (info.kind !== el.kind) {
    toast(el.kind === "video" ? "動画は動画のファイルで差し替えてください。" : "音声は音声のファイルで差し替えてください。", "warn", 6000);
    return;
  }
  const f = mediaFields(info);
  if (el.kind === "video") { f.width = el.width; f.height = Math.round(el.width * info.height / info.width * 10) / 10; }
  Object.assign(el, f, { trimStart: 0, trimEnd: null, posterTime: 0 });
  markDirty("prop");
  await refreshElement(el);
}
