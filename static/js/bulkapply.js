// 選んだ要素の位置・大きさ・色・フォントを、左の一覧で選んだほかのスライドの「同じ要素」にもそろえる。
// 同じ要素: 種類（図形はその形）が同じで、変数名の末尾の数字を除いた部分が同じもの（code4 と code5、title4 と title5）。
// 1 枚に候補が 2 つ以上あるときは、位置がいちばん近いもの。

import { selectedSlideIds } from "./slideops.js";
import { refreshAllThumbs } from "./slides.js";
import { escapeHtml, markDirty, store, toast } from "./store.js";

const baseName = (v) => String(v ?? "").replace(/\d+$/, "");
const kindOf = (e) => (e.type === "shape" ? `shape:${e.shape}` : e.type);

const GROUPS = {
  pos: { label: "位置", keys: ["x", "y", "anchor", "edgeX", "rotation"] },
  size: { label: "大きさ", keys: ["fontSize", "width", "height", "radius", "innerRadius", "wrapWidth", "dx", "dy", "hBuff", "vBuff", "lineSpacing", "letterSpacing", "keepAspect"] },
  color: { label: "色", keys: ["color", "stroke", "fill", "textColor", "bgColor", "opacity", "box", "outline"] },
  font: { label: "フォント", keys: ["font", "style", "language"] },
};

/** ほかの選んだスライドの、el と同じ要素（スライドごとに 1 つ）。 */
export function matchesOf(el) {
  const ids = selectedSlideIds();
  const here = store.project.slides[store.slideIndex];
  const out = [];
  for (const sl of store.project.slides) {
    if (sl === here || !ids.includes(sl.id)) continue;
    const cands = sl.elements.filter((e) => kindOf(e) === kindOf(el) && baseName(e.var) === baseName(el.var));
    if (!cands.length) { out.push({ slide: sl, el: null }); continue; }
    cands.sort((a, b) => Math.hypot(a.x - el.x, a.y - el.y) - Math.hypot(b.x - el.x, b.y - el.y));
    out.push({ slide: sl, el: cands[0] });
  }
  return out;
}

/** 要素のパネルに出す欄（ほかのスライドを選んでいないときは null）。 */
export function bulkApplyField(el) {
  if (!store.project || selectedSlideIds().length < 2) return null;
  const ms = matchesOf(el);
  if (!ms.length) return null;
  const found = ms.filter((m) => m.el);
  const pages = (list) => list.map((m) => store.project.slides.indexOf(m.slide) + 1).join("・");
  const box = document.createElement("div");
  box.className = "field-block bulk-apply";
  box.innerHTML = `<label class="block-label">選んだスライドにもそろえる</label>
    <div class="row">${Object.entries(GROUPS).map(([k, g]) => `<label><input type="checkbox" data-g="${k}" ${k === "pos" || k === "size" ? "checked" : ""}> ${g.label}</label>`).join(" ")}</div>
    <div class="row"><button type="button" class="small primary" data-a="apply" ${found.length ? "" : "disabled"}>${found.length} 枚の「${escapeHtml(baseName(el.var))}…」にそろえる</button></div>
    <div class="field-note">左の一覧で選んでいるスライド（${pages(ms)} 枚目）の、同じ種類で同じ名前（末尾の数字を除く）の要素に、この要素の値を写します。${
      found.length < ms.length ? `${pages(ms.filter((m) => !m.el))} 枚目には同じ要素がありません。` : ""}元に戻すで戻せます。</div>`;
  box.querySelector("[data-a=apply]").addEventListener("click", () => {
    const keys = Object.entries(GROUPS).filter(([k]) => box.querySelector(`[data-g=${k}]`).checked).flatMap(([, g]) => g.keys);
    if (!keys.length) { toast("そろえる項目を選んでください。", "warn"); return; }
    let n = 0;
    for (const m of matchesOf(el)) {
      if (!m.el) continue;
      for (const k of keys) {
        if (el[k] === undefined) { if (k === "anchor" || k === "edgeX") delete m.el[k]; continue; }
        m.el[k] = structuredClone(el[k]);
      }
      n++;
    }
    markDirty("bulk-apply");
    refreshAllThumbs();
    toast(`${n} 枚のスライドの「${baseName(el.var)}…」に、${Object.entries(GROUPS).filter(([k]) => box.querySelector(`[data-g=${k}]`).checked).map(([, g]) => g.label).join("・")}をそろえました。`, "", 5000);
  });
  return box;
}
