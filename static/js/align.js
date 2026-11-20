// 整列・等間隔: 選んだ要素（グループは、まとめて 1 つ）を、左・中央・右・上・中・下にそろえる、間隔をそろえる。
// 1 つだけ選んでいるときは、スライドに対してそろえる。

import { elementBounds, moveElements } from "./canvas.js";
import { emit, findElement, findGroup, groupMembers, store, toast } from "./store.js";

/** 選択を、動かす単位（グループの要素はまとめて 1 つ。グループの中に入っているときは要素ごと）に分ける。 */
function units() {
  const out = [];
  const seen = new Set();
  for (const id of store.selectedIds) {
    if (seen.has(id)) continue;
    const el = findElement(id);
    if (!el || el.locked) continue;
    const g = el.groupId && el.groupId !== store.enteredGroup ? findGroup(el.groupId) : null;
    const ids = g ? groupMembers(g.id).map((e) => e.id).filter((x) => store.selectedIds.includes(x)) : [id];
    ids.forEach((x) => seen.add(x));
    const b = elementBounds(ids);
    if (b) out.push({ ids, ...b });
  }
  return out;
}

const NAMES = { left: "左", hcenter: "左右の中央", right: "右", top: "上", vcenter: "上下の中央", bottom: "下" };

/** そろえる（mode: left・hcenter・right・top・vcenter・bottom）。 */
export function alignSelection(mode) {
  const us = units();
  if (!us.length) return;
  const { w, h } = store.meta.canvas;
  // 1 つならスライドに（端から少し余白を取る: 0.3 単位）、2 つ以上なら選んだ物全体の枠に
  const M = us.length === 1 && mode !== "hcenter" && mode !== "vcenter" ? Math.round(h / 8 * 0.3) : 0;
  // テキスト・数式・LaTeX の文章 1 つをスライドの左・右にそろえたら、位置の基準もその端にする（文字の長さが変わっても端が動かない）
  if (us.length === 1 && us[0].ids.length === 1 && ["left", "right", "hcenter"].includes(mode)) {
    const el = findElement(us[0].ids[0]);
    if (el && !Number(el.rotation) && (el.type === "text" || el.type === "math" || (el.type === "shape" && el.shape === "tex"))) {
      if (mode === "hcenter") { delete el.anchor; delete el.edgeX; } else el.anchor = mode;
    }
  }
  const box = us.length === 1 ? { x0: M, y0: M, x1: w - M, y1: h - M }
    : { x0: Math.min(...us.map((u) => u.x0)), y0: Math.min(...us.map((u) => u.y0)), x1: Math.max(...us.map((u) => u.x1)), y1: Math.max(...us.map((u) => u.y1)) };
  for (const u of us) {
    let dx = 0, dy = 0;
    if (mode === "left") dx = box.x0 - u.x0;
    if (mode === "right") dx = box.x1 - u.x1;
    if (mode === "hcenter") dx = (box.x0 + box.x1) / 2 - (u.x0 + u.x1) / 2;
    if (mode === "top") dy = box.y0 - u.y0;
    if (mode === "bottom") dy = box.y1 - u.y1;
    if (mode === "vcenter") dy = (box.y0 + box.y1) / 2 - (u.y0 + u.y1) / 2;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) moveElements(u.ids, dx, dy);
    if (u.ids.length === 1) {
      const el = findElement(u.ids[0]);
      if (el && ["left", "right"].includes(el.anchor) && (mode === "left" || mode === "right")) el.edgeX = Math.round((mode === "left" ? box.x0 : box.x1) * 10) / 10;
    }
  }
  if (us.length === 1 && us[0].ids.length === 1 && ["left", "right", "hcenter"].includes(mode)) emit("selection", store.selectedId); // 位置の基準の表示を新しく
  toast(`${us.length === 1 ? "スライドの" : ""}${NAMES[mode]}にそろえました${M ? "（端から 0.3 の余白）" : ""}${us.length === 1 && ["left", "right"].includes(findElement(us[0].ids[0])?.anchor) && mode !== "hcenter" ? "。位置の基準を" + (mode === "left" ? "左端" : "右端") + "にしました" : ""}。`, "", 3000);
}

/** 間隔をそろえる（axis: "x" は横、"y" は縦）。端の 2 つは動かさず、間のすき間を等しくする。3 つ以上で使う。 */
export function distributeSelection(axis) {
  const us = units();
  if (us.length < 3) { toast("間隔をそろえるには、3 つ以上（グループは 1 つと数えます）選んでください。", "warn"); return; }
  const a0 = axis === "x" ? "x0" : "y0", a1 = axis === "x" ? "x1" : "y1";
  us.sort((p, q) => (p[a0] + p[a1]) - (q[a0] + q[a1]));
  const total = us.at(-1)[a1] - us[0][a0];
  const sizes = us.reduce((s, u) => s + (u[a1] - u[a0]), 0);
  const gap = (total - sizes) / (us.length - 1);
  let at = us[0][a1] + gap;
  for (const u of us.slice(1, -1)) {
    const d = at - u[a0];
    if (Math.abs(d) > 0.05) moveElements(u.ids, axis === "x" ? d : 0, axis === "y" ? d : 0);
    at += (u[a1] - u[a0]) + gap;
  }
  toast(`${axis === "x" ? "横" : "縦"}の間隔をそろえました。`, "", 1500);
}

/** 整列のボタン（パネル・右クリックで使う）。 */
export function alignButtonsHtml(n) {
  const b = (m, t, title) => `<button type="button" class="small" data-align="${m}" title="${title}">${t}</button>`;
  return `<div class="row align-row">${b("left", "⇤ 左", "左端をそろえる")}${b("hcenter", "↔ 中央", "左右の中央をそろえる")}${b("right", "右 ⇥", "右端をそろえる")}</div>
    <div class="row align-row">${b("top", "⤒ 上", "上端をそろえる")}${b("vcenter", "↕ 中央", "上下の中央をそろえる")}${b("bottom", "下 ⤓", "下端をそろえる")}</div>
    ${n >= 3 ? `<div class="row align-row">${b("dx", "横に等間隔", "左右の端の物は動かさず、間のすき間を等しくする")}${b("dy", "縦に等間隔", "上下の端の物は動かさず、間のすき間を等しくする")}</div>` : ""}`;
}

export function bindAlignButtons(root) {
  root.querySelectorAll("[data-align]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.align;
    if (m === "dx" || m === "dy") distributeSelection(m === "dx" ? "x" : "y");
    else alignSelection(m);
  }));
}
