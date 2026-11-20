// テキスト要素のプレビュー。サーバーの常駐 Manim プロセスが、書き出しと同じ gui_text で作った形（SVG）を受け取る。

import { api } from "./api.js";
import { store, toast } from "./store.js";
import { resolveForPreview } from "./refs.js";

const cache = new Map();
/** フォントが増えた・減ったときは、前に作った形を使わない。 */
export const clearTextPreviewCache = () => cache.clear();
const KEYS = ["runs", "text", "font", "fontSize", "color", "opacity", "align", "letterSpacing", "lineSpacing", "vertical", "outline", "box", "arc", "wrapWidth"];
let unavailable = false;

export function textPreviewAvailable() {
  return !unavailable;
}

/** 戻り値: { url, width, height } または null（プレビューを作れないとき）。 */
export async function renderTextPreview(el) {
  el = resolveForPreview(el); // 参照（{ref:…}）・番号（{番号}）を番号の文字に
  const s = store.project.settings;
  const payload = { el: Object.fromEntries(KEYS.map((k) => [k, el[k]])), settings: { defaultFont: s.defaultFont, defaultColor: s.defaultColor, defaultFontSize: s.defaultFontSize, fontSizeScale: s.fontSizeScale } };
  const key = JSON.stringify(payload);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    try {
      const r = await api.postRetry("/api/preview/text", payload);
      unavailable = false;
      return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`, width: r.width, height: r.height, margin: r.margin || 0, error: "" };
    } catch (e) {
      if (e.status === 503 && !unavailable) {
        unavailable = true;
        toast(`テキストを Manim の形で表示できません（${e.message}）。ブラウザでの近似表示に切り替えます。`, "warn", 8000);
      }
      cache.delete(key);
      return { url: null, width: 0, height: 0, error: e.message };
    }
  })();
  cache.set(key, p);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return p;
}
