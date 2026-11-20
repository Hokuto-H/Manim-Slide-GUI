// 部品（要素のテンプレート）。よく使う要素の組（ベンゼン環・記号・図のひな形など）を 1 回作って保存し、
// 2 回目からは 1 つの要素（部品）として置く。
// ・保存先はこのパソコン全体（ユーザー設定の parts/）。置くと、プロジェクトに中身の写しを持つ（zip でも持ち運べる）
// ・部品を直す（同じ部品に上書きする）と、置いた所がすべて変わる（マスターと同じ考え方）
// ・その場所だけ変えたいときは「ばらす」で普通の要素に戻す（部品とのつながりは切れる）
// ・動きの中では 1 つの要素。一部分だけ動かすときは「一部分…」で中の部品を選ぶ

import { api } from "./api.js";
import { fabricCanvas, refreshElement, showSlide, tightBounds } from "./canvas.js";
import { newShape } from "./shapes.js";
import { select, selectMany } from "./selection.js";
import {
  compactGroups, currentSlide, escapeHtml, findElement, findGroup, groupMembers, markDirty, slideGroups, store, toast, uid, uniqueVar,
} from "./store.js";

// サーバー（app/project.py の part_child_ok）と同じ: 部品に入れられない図形
const EXCLUDED = ["zoom", "trace", "part", "statchart", "points", "graph", "graphpart", "axdot", "curve2d", "implicit",
  "linegraph", "tangent", "field", "vector", "solid", "axes3d", "surface", "curve3d", "point3d", "svg"];
export const partChildOk = (e) => ["text", "math"].includes(e.type) || (e.type === "shape" && !EXCLUDED.includes(e.shape));

let templates = null; // サーバーの部品の一覧（中身も）

export async function loadParts(force = false) {
  if (!templates || force) templates = (await api.get("/api/parts")).parts ?? [];
  return templates;
}

const projParts = () => (store.project.parts ??= []);
export const partOf = (el) => projParts().find((p) => p.id === el?.partId) ?? null;

/** プロジェクトの写しを、テンプレートの中身にする（無ければ足す）。 */
function syncCopy(t) {
  const list = projParts();
  const copy = { id: t.id, name: t.name, updatedAt: t.updatedAt, elements: structuredClone(t.elements) };
  const i = list.findIndex((p) => p.id === t.id);
  if (i >= 0) list[i] = copy; else list.push(copy);
  // 置いてある部品の名前も合わせる
  for (const sl of [...store.project.slides, ...(store.project.masters ?? [])]) for (const e of sl.elements) if (e.shape === "part" && e.partId === t.id) e.partName = t.name;
}

/** 部品の中身（選んだ要素の写し）。位置は、まとめた外接矩形の中心からのずれ。 */
function childrenOf(els, { scale = 1, rotation = 0, origin = null } = {}) {
  const b = tightBounds(els.map((e) => e.id)) ?? { x0: 960, y0: 540, x1: 960, y1: 540 };
  const cx = origin?.x ?? (b.x0 + b.x1) / 2, cy = origin?.y ?? (b.y0 + b.y1) / 2;
  const kids = els.map((e) => {
    const c = structuredClone(e);
    delete c.groupId; delete c.link; delete c.refLabel; delete c.hidden; delete c.locked;
    c.visibleAtStart = true;
    c.x = Number(c.x) - cx;
    c.y = Number(c.y) - cy;
    // 置いた部品を直したとき: その部品の拡大・回転を戻してから保存する（ほかの所に置いた部品の大きさ・向きを変えない）
    if (scale !== 1 || rotation) transformChild(c, 1 / scale, -rotation);
    c.x = Math.round(c.x * 10) / 10;
    c.y = Math.round(c.y * 10) / 10;
    if (c.edgeX != null) c.edgeX = Math.round((Number(c.edgeX) - cx) * 10) / 10;
    return c;
  });
  return { kids, cx, cy };
}

/** 選んでいる要素の縮小図（PNG）。 */
function thumbOf(els) {
  const cv = fabricCanvas();
  const b = tightBounds(els.map((e) => e.id));
  if (!cv || !b) return "";
  const objs = cv.getObjects().filter((o) => els.some((e) => e.id === o.elId));
  const hiddenOthers = cv.getObjects().filter((o) => !objs.includes(o) && o.visible);
  const active = cv.getActiveObject();
  cv.discardActiveObject();
  hiddenOthers.forEach((o) => { o.visible = false; });
  const vt = cv.viewportTransform.slice();
  try {
    cv.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const pad = 8, w = Math.max(1, b.x1 - b.x0 + 2 * pad), h = Math.max(1, b.y1 - b.y0 + 2 * pad);
    const m = Math.min(1, 160 / Math.max(w, h));
    return cv.toDataURL({ format: "png", left: b.x0 - pad, top: b.y0 - pad, width: w, height: h, multiplier: m });
  } catch { return ""; } finally {
    cv.setViewportTransform(vt);
    hiddenOthers.forEach((o) => { o.visible = true; });
    if (active) cv.setActiveObject(active);
    cv.requestRenderAll();
  }
}

/** 選んでいる要素（グループも）を、部品として保存し、その場所を部品 1 つに置き換える。overwriteId で上書き。 */
export async function saveSelectionAsPart({ overwriteId = null } = {}) {
  const slide = currentSlide();
  const ids = [...new Set(store.selectedIds.flatMap((id) => (findGroup(id) ? groupMembers(id).map((e) => e.id) : [id])))];
  const els = slide.elements.filter((e) => ids.includes(e.id)); // 重なり順（背面が先）
  if (!els.length) { toast("部品にする要素を選んでください（複数を選ぶか、グループを選ぶ）。", "warn"); return; }
  const bad = els.filter((e) => !partChildOk(e));
  if (bad.length) {
    toast(`部品に入れられない要素があります: ${bad.map((e) => e.var).join("、")}（入れられるのは、テキスト・数式と、ほかの要素に付かない図形です。画像・動画・座標軸に付くグラフなどは入れられません）。`, "warn", 8000);
    return;
  }
  const outside = els.filter((e) => [e.line1Id, e.line2Id, e.targetId, ...(e.contentIds ?? []), ...(e.operandIds ?? [])].some((d) => d && !ids.includes(d)));
  if (outside.length) {
    toast(`「${outside.map((e) => e.var).join("、")}」は、選んでいない要素に付いています。付いている要素も一緒に選んでください。`, "warn", 8000);
    return;
  }
  await loadParts();
  let name = overwriteId ? templates.find((t) => t.id === overwriteId)?.name : "";
  if (!overwriteId) {
    name = (prompt("部品の名前（例: ベンゼン環）", "") ?? "").trim();
    if (!name) return;
    const same = templates.find((t) => t.name === name);
    if (same && confirm(`部品「${name}」は、もうあります。上書きしますか？（置いた所もすべて変わります。「キャンセル」で、別の部品として保存します）`)) overwriteId = same.id;
  }
  // 部品を直しているとき（ばらしたグループ）: その部品の倍率・向き・基準点を使う
  const g = findGroup(store.selectedId) ?? null;
  const tf = overwriteId && g?.fromPart === overwriteId
    ? { scale: Number(g.partScale) || 1, rotation: Number(g.partRot) || 0, origin: movedOrigin(g, slide) }
    : { scale: 1, rotation: 0, origin: null };
  const { kids, cx, cy } = childrenOf(els, tf);
  let t;
  try {
    t = await api.post("/api/parts", { id: overwriteId, name, elements: kids, thumb: thumbOf(els) });
  } catch (e) { toast(e.message, "ng", 8000); return; }
  await loadParts(true);
  syncCopy(t);
  // 選んだ要素を、部品 1 つに置き換える（いちばん手前の要素の重なり順に置く）
  const k = Math.max(...els.map((e) => slide.elements.indexOf(e)));
  const inst = newPartElement(t, cx, cy);
  inst.scale = tf.scale;
  inst.rotation = tf.rotation;
  slide.elements.splice(k + 1, 0, inst);
  // 置き換える要素の動きは、部品の動きにする（グループ・要素を指していた行）
  const gids = new Set(els.map((e) => e.groupId).filter(Boolean));
  for (const st of slide.steps) {
    if (st.elementId && (ids.includes(st.elementId) || gids.has(st.elementId))) st.elementId = inst.id;
    for (const r of st.rows ?? []) if (r.target && (ids.includes(r.target) || gids.has(r.target))) { r.target = inst.id; delete r.part; }
  }
  slide.elements = slide.elements.filter((e) => !ids.includes(e.id));
  compactGroups(slide);
  markDirty("part");
  await refreshAllParts(t.id);
  await showSlide();
  select(inst.id);
  toast(overwriteId ? `部品「${t.name}」を上書きしました（置いた所がすべて変わります）。` : `部品「${t.name}」を保存し、選んだ要素を部品 1 つに置き換えました。「＋部品」から、ほかのスライド・プロジェクトにも置けます。`, "", 7000);
}

/** 直しているグループを動かしていたら、基準点も同じだけ動かす（残っている目印の、動いた量の中央値）。 */
function movedOrigin(g, slide) {
  if (!g.partOrigin) return null;
  const ds = (g.partRefs ?? []).map((r) => { const e = slide.elements.find((x) => x.id === r.id); return e ? [e.x - r.x, e.y - r.y] : null; }).filter(Boolean);
  if (!ds.length) return g.partOrigin;
  const med = (a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  return { x: g.partOrigin.x + med(ds.map((d) => d[0])), y: g.partOrigin.y + med(ds.map((d) => d[1])) };
}

function newPartElement(t, x, y) {
  const el = newShape("part", { shape: "part" }, x, y);
  Object.assign(el, { partId: t.id, partName: t.name, scale: 1 });
  return el;
}

/** 部品を置く（スライドの中央）。 */
export async function placePart(id) {
  await loadParts();
  const cur = partOf({ partId: id });
  // この PC に保存されていない部品（別の PC で作ったプロジェクトの部品）は、プロジェクトの写しから置く
  const t = templates.find((x) => x.id === id) ?? cur;
  if (!t) { toast("部品が見つかりません。", "ng"); return; }
  if (!cur || Number(t.updatedAt) > Number(cur.updatedAt)) syncCopy(t);
  const slide = currentSlide();
  const el = newPartElement(t, store.meta.canvas.w / 2, store.meta.canvas.h / 2);
  slide.elements.push(el);
  markDirty("add");
  await refreshElement(el);
  select(el.id);
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * 部品の中の要素 e（位置は基準点からのずれ）に、基準点のまわりの拡大 s 倍・回転 deg 度（反時計回りが正）をかける（その場で書き換える）。
 * 位置のずれ・大きさ・線の向きと長さ・要素の回転を変える。逆にかければ（1/s 倍・−deg 度）元に戻る。
 */
function transformChild(e, s, deg) {
  const th = -(Number(deg) || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th); // キャンバスは y が下向き
  const dx = Number(e.x) * s, dy = Number(e.y) * s;
  e.x = r2(dx * c - dy * sn);
  e.y = r2(dx * sn + dy * c);
  if (s !== 1) {
    for (const k of ["fontSize", "width", "height", "radius", "innerRadius", "labelSize", "pnameSize", "wrapWidth"]) if (e[k] != null && Number.isFinite(Number(e[k]))) e[k] = r2(Number(e[k]) * s);
    if (e.shape === "line") { e.dx = Number(e.dx) * s; e.dy = Number(e.dy) * s; }
    if (e.shape === "path") e.paths = e.paths.map((sp) => sp.map((n) => n.map((v) => r2(v * s))));
  }
  if (deg) {
    if (e.shape === "line") { const ddx = Number(e.dx), ddy = Number(e.dy); e.dx = r2(ddx * c - ddy * sn); e.dy = r2(ddx * sn + ddy * c); }
    else e.rotation = r2((((Number(e.rotation) || 0) + Number(deg)) + 180) % 360 - 180);
  }
  if (e.shape === "line") { e.dx = r2(Number(e.dx)); e.dy = r2(Number(e.dy)); }
  delete e.edgeX; delete e.anchor;
  return e;
}

/** 部品の中身の要素（スライドの座標。倍率・回転をかけたもの）。新しい id を付ける。 */
function explodedChildren(el, part) {
  const s = Number(el.scale) || 1, deg = Number(el.rotation) || 0;
  const idMap = new Map(part.elements.map((e) => [e.id, uid("e")]));
  const map = (v) => (typeof v === "string" && idMap.has(v) ? idMap.get(v) : v);
  return part.elements.map((src) => {
    const e = transformChild(structuredClone(src), s, deg);
    e.id = idMap.get(src.id);
    for (const k of ["line1Id", "line2Id", "targetId", "graphId", "axesId"]) if (e[k]) e[k] = map(e[k]);
    for (const k of ["contentIds", "operandIds"]) if (Array.isArray(e[k])) e[k] = e[k].map(map);
    if (e.onCircle?.id) e.onCircle = { ...e.onCircle, id: map(e.onCircle.id) };
    e.x = Math.round((el.x + e.x) * 10) / 10;
    e.y = Math.round((el.y + e.y) * 10) / 10;
    e.var = uniqueVar((src.var || "").replace(/^_gui_pc\d+$/, "") || (e.type === "math" ? "eq" : e.type === "text" ? "text" : e.shape));
    return e;
  });
}

/** 部品をばらして、普通の要素（グループ）に戻す。forEdit なら、あとで「部品を上書き」できるように、グループに部品を覚える。 */
export async function explodePart(el, { forEdit = false } = {}) {
  const part = partOf(el);
  if (!part) { toast("部品の中身が見つかりません。", "ng"); return; }
  const slide = currentSlide();
  const kids = explodedChildren(el, part);
  const g = { id: uid("g"), var: uniqueVar("group"), rotation: 0 };
  // 直すとき: 部品の倍率・向き・基準点と、動かしたかを調べる目印（中の要素 1 つの、ばらした時の位置）を覚える
  if (forEdit) Object.assign(g, { fromPart: part.id, partScale: Number(el.scale) || 1, partRot: Number(el.rotation) || 0, partOrigin: { x: el.x, y: el.y },
    partRefs: kids.map((k) => ({ id: k.id, x: k.x, y: k.y })) });
  for (const k of kids) k.groupId = g.id;
  slideGroups(slide).push(g);
  const at = slide.elements.indexOf(el);
  slide.elements.splice(at, 1, ...kids);
  // 部品を指していた動きは、グループの動きにする
  for (const st of slide.steps) {
    if (st.elementId === el.id) st.elementId = g.id;
    for (const r of st.rows ?? []) if (r.target === el.id) { r.target = g.id; delete r.part; }
  }
  compactGroups(slide);
  markDirty("part");
  await showSlide();
  select(g.id);
  toast(forEdit
    ? `部品「${part.name}」をばらしました。直したら、グループのパネルの「部品「${part.name}」を上書き」を押すと、置いた所がすべて変わります。`
    : `部品「${part.name}」をばらして、普通の要素（グループ）に戻しました。`, "", 8000);
}

/** 部品を置いた要素を、すべて描き直す（テンプレートを直したとき）。 */
export async function refreshAllParts(partId) {
  const slide = currentSlide();
  for (const e of slide?.elements ?? []) if (e.shape === "part" && e.partId === partId) await refreshElement(e);
  (await import("./slides.js")).refreshAllThumbs?.();
}

/** 開いたとき: テンプレートの方が新しかった部品を知らせる。 */
export function noteUpdated(names) {
  if (names?.length) toast(`部品「${names.join("」「")}」を、新しい版にしました（ほかのプロジェクトで直した部品です）。`, "", 7000);
}

// ---------------------------------------------------------------- パネル

/** 部品の要素のパネル。 */
export function partFields(sec, el, add, changed) {
  const part = partOf(el);
  const n = part?.elements.length ?? 0;
  const f = add("部品", `${part ? `<div class="row"><b>${escapeHtml(part.name)}</b><span class="unit">（中の要素 ${n} 個）</span></div>` : `<div class="field-note ng">部品の中身が見つかりません（「＋部品」から置き直してください）。</div>`}
    <div class="row"><span class="unit">大きさ</span><input type="number" class="num" data-k="scale" step="0.1" min="0.01" value="${Number(el.scale) || 1}"><span class="unit">倍</span></div>
    <div class="row"><button type="button" class="small" data-a="edit" ${part ? "" : "disabled"}>部品を直す…</button><button type="button" class="small" data-a="explode" ${part ? "" : "disabled"}>ばらす（普通の要素に）</button></div>
    <div class="field-note">部品は 1 つの要素として動きます（一部分だけ動かすときは、動きの行の「一部分…」で中の要素を選びます）。
      「部品を直す」では、ばらして直したあと、グループのパネルの「部品を上書き」で、置いた所がすべて変わります（ほかのプロジェクトは、次に開いたとき）。
      「ばらす」では、ここだけ普通の要素に戻ります（部品とのつながりは切れます）。コードでは <code>${escapeHtml(el.var)}[0]</code> などで中の要素を参照できます（重なり順、背面が 0）。</div>`, { top: true });
  f.querySelector("[data-k=scale]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.scale = v; changed(el); } });
  f.querySelector("[data-a=explode]")?.addEventListener("click", () => explodePart(el));
  f.querySelector("[data-a=edit]")?.addEventListener("click", () => explodePart(el, { forEdit: true }));
}

/** グループ・複数選択のパネルに出す「部品として保存」の欄。 */
export function partSaveField(group = null) {
  const box = document.createElement("div");
  box.className = "row part-save";
  const from = group?.fromPart ? (store.project.parts ?? []).find((p) => p.id === group.fromPart) : null;
  box.innerHTML = `${from ? `<button type="button" class="small primary" data-a="over" title="置いた所がすべて、この形に変わります">部品「${escapeHtml(from.name)}」を上書き</button>` : ""}
    <button type="button" class="small" data-a="save" title="よく使う要素の組を保存して、次から 1 つの要素（部品）として置きます">部品として保存…</button>`;
  box.querySelector("[data-a=save]").addEventListener("click", () => saveSelectionAsPart());
  box.querySelector("[data-a=over]")?.addEventListener("click", () => saveSelectionAsPart({ overwriteId: from.id }));
  return box;
}

// ---------------------------------------------------------------- 「＋部品 ▾」のメニュー

let menu = null;
const closeMenu = () => { menu?.remove(); menu = null; };

export function setupPartMenu(button) {
  if (!button) return;
  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    await loadParts(true);
    menu = document.createElement("div");
    menu.className = "shape-menu part-menu";
    const canSave = store.selectedIds.length > 1 || !!findGroup(store.selectedId);
    // このプロジェクトにだけある部品（別の PC で作った部品。zip で持ってきたときなど）
    const known = new Set(templates.map((t) => t.id));
    const onlyHere = projParts().filter((p) => !known.has(p.id));
    menu.innerHTML = `<div class="part-head"><b>部品</b><span class="hint">よく使う要素の組を 1 つの要素として置きます</span></div>
      <div class="part-grid">${templates.map((t) => `<div class="part-item" data-id="${t.id}" title="${escapeHtml(t.name)}">
          <button type="button" class="part-place" data-a="place">${t.thumb ? `<img src="${t.thumb}" alt="">` : `<span class="part-noimg">${escapeHtml(t.name.slice(0, 2))}</span>`}<span>${escapeHtml(t.name)}</span></button>
          <div class="part-ops"><button type="button" class="small" data-a="rename" title="名前を変える">名前</button><button type="button" class="small danger" data-a="del" title="部品を削除">×</button></div></div>`).join("")
        || `<p class="hint" style="grid-column: 1 / -1">${onlyHere.length ? "この PC に保存した部品は、まだありません。" : "まだ部品がありません。"}要素を複数選ぶ（グループを選ぶ）と、下の「選んだ要素を部品にする…」で作れます。</p>`}</div>
${onlyHere.length ? `<div class="part-head"><b>このプロジェクトの部品</b><span class="hint">この PC には保存されていません（別の PC で作った部品）</span></div>
      <div class="part-grid">${onlyHere.map((t) => `<div class="part-item" data-pid="${t.id}" title="${escapeHtml(t.name)}">
          <button type="button" class="part-place" data-a="place-proj"><span class="part-noimg">${escapeHtml(t.name.slice(0, 2))}</span><span>${escapeHtml(t.name)}</span></button>
          <div class="part-ops"><button type="button" class="small" data-a="keep" title="この PC の部品として保存し、ほかのプロジェクトでも使えるようにする">この PC に保存</button></div></div>`).join("")}</div>` : ""}
      <div class="row"><button type="button" class="small primary" data-a="save" ${canSave ? "" : "disabled"}>選んだ要素を部品にする…</button></div>
      <p class="hint">部品は、このパソコンのどのプロジェクトでも使えます。直すと、置いた所がすべて変わります。</p>`;
    document.body.appendChild(menu);
    const r = button.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(4, Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.addEventListener("click", async (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      const id = ev.target.closest("[data-id]")?.dataset.id;
      const t = templates.find((x) => x.id === id);
      if (a === "save") { closeMenu(); saveSelectionAsPart(); return; }
      const pp = projParts().find((x) => x.id === ev.target.closest("[data-pid]")?.dataset.pid);
      if (a === "place-proj" && pp) { closeMenu(); placePart(pp.id); return; }
      if (a === "keep" && pp) {
        try {
          const inst = currentSlide().elements.find((e) => e.shape === "part" && e.partId === pp.id);
          const saved = await api.post("/api/parts", { id: pp.id, name: pp.name, elements: pp.elements, thumb: inst ? thumbOf([inst]) : "" });
          syncCopy(saved); markDirty("part"); await loadParts(true);
          toast(`部品「${saved.name}」を、この PC に保存しました。ほかのプロジェクトの「＋部品 ▾」にも出ます。`);
        } catch (err) { toast(err.message, "ng"); }
        closeMenu();
        return;
      }
      if (a === "place" && t) { closeMenu(); placePart(t.id); return; }
      if (a === "rename" && t) {
        const name = (prompt("部品の新しい名前", t.name) ?? "").trim();
        if (!name || name === t.name) return;
        try {
          const nt = await api.post("/api/parts/rename", { id: t.id, name });
          const cp = partOf({ partId: t.id });
          if (cp) { cp.name = nt.name; syncCopy({ ...cp }); markDirty("part"); }
        } catch (err) { toast(err.message, "ng"); }
        closeMenu();
        return;
      }
      if (a === "del" && t) {
        const used = store.project.slides.reduce((n, sl) => n + sl.elements.filter((x) => x.shape === "part" && x.partId === t.id).length, 0);
        if (!confirm(`部品「${t.name}」を削除しますか？（このパソコンのどのプロジェクトでも、新しく置けなくなります。${used ? `このプロジェクトに置いた ${used} 個は、プロジェクトの写しで描けるので、そのまま残ります。` : ""}元に戻せません）`)) return;
        try { await api.post("/api/parts/delete", { id: t.id }); } catch (err) { toast(err.message, "ng"); return; }
        closeMenu();
        toast(`部品「${t.name}」を削除しました。`);
      }
    });
  });
  document.addEventListener("mousedown", (e) => { if (menu && !menu.contains(e.target) && e.target !== button) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
}

export { selectMany };
