// アプリの状態と、小さなイベント通知の仕組み。

const listeners = new Map();

export const store = {
  meta: null,          // /api/meta の内容（キャンバスの大きさ、換算係数、プリセットなど）
  fonts: null,         // /api/fonts の内容
  projectFonts: [],    // プロジェクトに入れたフォント（[{file, families, bytes}]）
  folder: null,        // プロジェクトのフォルダ
  project: null,       // project.json の内容
  preamble: "",
  macros: { macros: {}, unsupported: [], defs: [] },
  mathWarnings: [],    // MathJax で展開できなかったマクロ
  slideIndex: 0,
  selectedId: null,    // 選択中の要素またはグループの id（複数の要素をばらばらに選んでいるときは null）
  selectedIds: [],     // 選択中の要素の id（グループを選んでいるときは、その中の要素すべて）
  enteredGroup: null,  // ダブルクリックで中に入っているグループ（中の要素を1つずつ選べる）
  focusStepId: null,   // プロパティパネルで強調するステップ
  dirty: false,
  env: null,
  lastError: null,     // 直近の描画エラー（位置の強調表示に使う）
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

export function markDirty(reason = "edit") {
  store.rev = (store.rev ?? 0) + 1; // 保存の途中に変わったかを見分ける
  store.dirty = true;
  emit("dirty", reason);
}

/** 編集中のスライド。マスターの編集中は、そのマスター（スライドと同じ形: elements・groups。steps は空）。 */
export const currentSlide = () => (store.masterId ? findMaster(store.masterId) : store.project?.slides[store.slideIndex] ?? null);
export const findMaster = (id, project = store.project) => (id ? (project?.masters ?? []).find((m) => m.id === id) ?? null : null);
/** スライドのマスター（無ければ null）。 */
export const masterOf = (slide, project = store.project) => findMaster(slide?.master, project);
/** マスターの編集中か。 */
export const inMaster = () => !!store.masterId;

export function findElement(id, slide = currentSlide()) {
  return slide?.elements.find((e) => e.id === id) ?? null;
}

/** 表・行列のセルの要素の id（セルと同じ形。無ければ作る）。 */
export function ensureItems(el) {
  const rows = el.cells ?? [];
  const src = Array.isArray(el.items) ? el.items : [];
  el.items = rows.map((r, i) => r.map((_, j) => src[i]?.[j] ?? null));
  return el.items;
}

/** 要素 id を入れている表・行列（無ければ null）。 */
export function cellContainerOf(id, slide = currentSlide()) {
  if (!id) return null;
  return slide?.elements.find((e) => e.type === "shape" && ["table", "matrix"].includes(e.shape) && (e.items ?? []).some((r) => r.includes(id))) ?? null;
}

// セルに入れられない要素（ほかの要素から作る物・3D・画像・グループ。書き出しの検査と同じ）
const CELL_EXCLUDED = ["graph", "graphpart", "axdot", "curve2d", "implicit", "angle", "brace", "balloon", "annot", "boolean", "vector",
  "linegraph", "points", "trace", "field", "surface", "curve3d", "point3d", "solid", "axes3d", "zoom"];
export function cellItemOk(e, table) {
  if (!e || e.id === table?.id || e.groupId) return false;
  const box = cellContainerOf(e.id);
  if (box && box.id !== table?.id) return false; // ほかの表に入っている
  if (["text", "math"].includes(e.type)) return true;
  if (e.type !== "shape" || CELL_EXCLUDED.includes(e.shape)) return false;
  if (["table", "matrix"].includes(e.shape) && (e.items ?? []).some((r) => r.some(Boolean))) return false;
  return true;
}

/** 消した要素への参照を外す（2 つのグラフの間の面積のもう 1 つのグラフ・表のセルの要素・一緒に変換する要素）。 */
export function detachRefs(slide, ids) {
  const gone = new Set(ids);
  for (const e of slide.elements) {
    if (e.shape === "graphpart" && e.graph2Id && gone.has(e.graph2Id)) e.graph2Id = "";
    if (["table", "matrix"].includes(e.shape) && Array.isArray(e.items)) e.items = e.items.map((r) => r.map((x) => (x && gone.has(x) ? null : x)));
    if (Array.isArray(e.followIds)) e.followIds = e.followIds.filter((x) => !gone.has(x));
  }
}

/** ids の要素・グループに関わるステップ（コードのステップは対象の要素、GUI のステップは動きの行の対象）。 */
export function stepsTouching(slide, ids) {
  const set = new Set(ids);
  return slide.steps.filter((s) => (s.mode === "gui" ? (s.rows ?? []).some((r) => r.kind === "anim" && set.has(r.target)) : set.has(s.elementId)));
}

/** ids の要素・グループを消したときのステップの後始末: コードのステップは消し、GUI のステップは対象の行を消す（動きが無くなったら消す）。 */
export function dropStepsOf(slide, ids) {
  const set = new Set(ids);
  slide.steps = slide.steps.filter((s) => {
    if (s.mode !== "gui") return !set.has(s.elementId);
    const had = (s.rows ?? []).some((r) => r.kind === "anim");
    s.rows = (s.rows ?? []).filter((r) => !(r.kind === "anim" && set.has(r.target)));
    for (const r of s.rows) for (const k of ["to", "path", "elem", "with", "target"]) if (r.params?.[k] && set.has(r.params[k])) r.params[k] = ""; // 消した要素を指す引数は空に
    const left = s.rows.find((r) => r.kind === "anim");
    if (set.has(s.elementId)) s.elementId = left?.target ?? null;
    return !had || !!left;
  });
}

export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function allVars(exceptId = null) {
  const set = new Set();
  for (const s of [...(store.project?.slides ?? []), ...(store.project?.masters ?? [])]) {
    for (const e of s.elements) if (e.id !== exceptId) set.add(e.var);
    for (const g of s.groups ?? []) if (g.id !== exceptId) set.add(g.var);
  }
  return set;
}

// ---- グループ ----
export const slideGroups = (slide = currentSlide()) => (slide ? (slide.groups ??= []) : []);
export const findGroup = (id, slide = currentSlide()) => slideGroups(slide).find((g) => g.id === id) ?? null;
export const groupMembers = (gid, slide = currentSlide()) => (slide?.elements ?? []).filter((e) => e.groupId === gid);

/** 要素またはグループ（ステップの対象になるもの）を id で探す。 */
export function findTarget(id, slide = currentSlide()) {
  return findElement(id, slide) ?? findGroup(id, slide);
}

/** 重なり順の上で、同じグループの要素が連続するように並べ直す（サーバー側の compact_groups と同じ）。 */
export function compactGroups(slide = currentSlide()) {
  const els = slide.elements;
  const last = new Map();
  els.forEach((e, i) => { if (e.groupId) last.set(e.groupId, i); });
  const out = [];
  els.forEach((e, i) => {
    if (!e.groupId) out.push(e);
    else if (last.get(e.groupId) === i) out.push(...els.filter((x) => x.groupId === e.groupId));
  });
  slide.elements = out;
  // 吹き出しの中身から、無くなった要素を外す
  const ids = new Set(out.map((e) => e.id));
  for (const e of out) if (e.type === "shape" && e.shape === "balloon") e.contentIds = (e.contentIds ?? []).filter((id) => ids.has(id));
  // 付けていた要素が無くなった中かっこは、最後の位置のまま「2 点の間」の中かっこにする
  for (const e of out) if (e.type === "shape" && e.shape === "brace" && e.mode !== "points" && !ids.has(e.targetId)) braceToPoints(e);
  // 座標軸が無くなったベクトル場は、同じ範囲・大きさのまま独立したベクトル場にする
  for (const e of out) if (e.type === "shape" && e.shape === "field" && e.axesId && !ids.has(e.axesId)) e.axesId = "";
  // 要素の無くなったグループは消す
  const used = new Set(out.map((e) => e.groupId).filter(Boolean));
  slide.groups = slideGroups(slide).filter((g) => used.has(g.id));
}

/** 選択中の要素の id から、パネルに出す対象（要素 id・グループ id・複数なら null）を決める。 */
export function selectionTarget(ids) {
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  const gid = findElement(ids[0])?.groupId;
  if (gid && ids.every((id) => findElement(id)?.groupId === gid) && groupMembers(gid).length === ids.length) return gid;
  return null;
}

export function uniqueVar(base) {
  const used = allVars();
  let i = 1;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

const PY_KEYWORDS = new Set(("False None True and as assert async await break class continue def del elif else except finally for from " +
  "global if import in is lambda nonlocal not or pass raise return try while with yield match case").split(" "));
const RESERVED = new Set(["self", "tpl", "config", "np", "gui_text", "gui_layer"]);

/** 変数名の検査。問題があればメッセージ、無ければ ""。 */
export function checkVarName(name, elementId) {
  if (!name) return "変数名を入力してください。";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "半角英数字と _ だけが使えます（先頭は数字以外）。";
  if (PY_KEYWORDS.has(name)) return "Python の予約語は使えません。";
  if (RESERVED.has(name) || name.startsWith("_gui")) return "アプリが使う名前のため使えません。";
  if (allVars(elementId).has(name)) return "ほかの要素と重複しています（プロジェクト全体で一意にしてください）。";
  return "";
}

// ---- 色 ----
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** 背景色に対して読みやすい既定の文字色（明るい背景→濃い色、暗い背景→明るい色）。 */
export function suggestTextColor(bg) {
  return luminance(bg) > 0.18 ? "#222222" : "#EEEEEE";
}

export function normalizeHex(v) {
  const s = String(v || "").trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s) || /^#?([0-9a-f]{3})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toUpperCase()}`;
}

// ---- 座標の変換（キャンバス 1920×1080 ⇔ Manim）----
export function toManim(x, y) {
  const { w, h } = store.meta.canvas;
  const fw = 8 * w / h;
  return [((x - w / 2) / w) * fw, ((h / 2 - y) / h) * 8];
}

export function fromManim(mx, my) {
  const { w, h } = store.meta.canvas;
  const fw = 8 * w / h;
  return [mx / fw * w + w / 2, h / 2 - my / 8 * h];
}

// ---- フォント ----
export function fontPresetFor(family) {
  const presets = store.fonts?.presets ?? [];
  return presets.find((p) => p.family === family || p.candidates.includes(family)) ?? null;
}

export function cssFontFamily(family) {
  const p = fontPresetFor(family);
  const names = p ? [family, ...p.candidates.filter((c) => c !== family)] : [family];
  return [...names.map((n) => `"${n.replace(/"/g, "")}"`), p?.generic || "sans-serif"].join(", ");
}

/** プロジェクトに入れたフォント（fonts/）のファミリー名。 */
export const projectFontFamilies = () => [...new Set((store.projectFonts ?? []).flatMap((f) => f.families))];

/** フォントの選択肢（よく使うフォント＋プロジェクトのフォント＋この PC のフォント）。selected が一覧に無ければ、そのまま足す。
 * プリセットの別の候補の名前（Noto Sans CJK JP など）が入っているときは、その名前のまま選ぶ（書き換えない。描画で、この PC にある候補を使う）。 */
export function fontOptionsHtml(selected) {
  const presets = store.fonts?.presets ?? [];
  let found = false;
  const opts = presets.map((p) => {
    const sel = p.family === selected || p.candidates.includes(selected);
    found ||= sel;
    const value = sel ? selected : p.family;
    const here = sel && selected !== p.family && p.installed ? `（この PC では ${p.family}）` : "";
    return `<option value="${escapeHtml(value)}" ${sel ? "selected" : ""}>${escapeHtml(p.label)}${p.installed === false ? "（未導入）" : ""}${escapeHtml(here)}</option>`;
  }).join("");
  const proj = projectFontFamilies();
  const projOpts = proj.map((f) => {
    const sel = !found && f === selected;
    found ||= sel;
    return `<option value="${escapeHtml(f)}" ${sel ? "selected" : ""}>${escapeHtml(f)}</option>`;
  }).join("");
  // この PC のフォント（プリセットの候補・プロジェクトのフォントは除く）
  const taken = new Set([...presets.flatMap((p) => p.candidates), ...proj].map((f) => f.toLowerCase()));
  const pc = (store.fonts?.families ?? []).filter((f) => !taken.has(f.toLowerCase()));
  const pcOpts = pc.map((f) => {
    const sel = !found && f === selected;
    found ||= sel;
    return `<option value="${escapeHtml(f)}" ${sel ? "selected" : ""}>${escapeHtml(f)}</option>`;
  }).join("");
  return opts + (proj.length ? `<optgroup label="プロジェクトのフォント">${projOpts}</optgroup>` : "")
    + (pc.length ? `<optgroup label="この PC のフォント">${pcOpts}</optgroup>` : "")
    + (found || !selected ? "" : `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
}

/** フォントの種類: preset（よく使うフォント）・project（プロジェクトのフォント）・pc（この PC のフォント）・missing（どこにも無い）・unknown */
export function fontKind(family) {
  if (projectFontFamilies().includes(family)) return "project";
  const p = fontPresetFor(family);
  if (p) return p.installed === false ? "missing" : "preset";
  const fams = store.fonts?.families;
  if (!fams?.length) return "unknown";
  return fams.some((f) => f.toLowerCase() === String(family).toLowerCase()) ? "pc" : "missing";
}

/** フォントの欄の下に出す注意（無ければ ""）。 */
export function fontNoteText(family) {
  const k = fontKind(family);
  if (k === "missing") return "このフォントは PC に導入されていません。描画では別のフォントに置き換わります。";
  if (k === "pc") return "この PC のフォントです。ほかの PC で開くと無いことがあります。持ち運ぶときは、プロジェクト設定の「プロジェクトのフォント」にも入れてください（ライセンスに注意）。";
  return "";
}

export function fontInstalled(family) {
  const k = fontKind(family);
  return k === "missing" ? false : k === "unknown" ? null : true;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(message, kind = "", ms = 3500, action = null) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  if (action) {
    // 「元に戻す」などのボタン（押したら消える）
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => { el.remove(); action.run(); });
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---- 新しい要素 ----
export const isBalloon = (e) => e?.type === "shape" && e.shape === "balloon";

/** 新しいテキスト・数式の要素（スライドには加えない）。 */
export function makeElement(type, x, y) {
  const s = store.project.settings;
  const el = {
    id: uid("e"), type, var: uniqueVar(type === "math" ? "eq" : "text"), x, y,
    fontSize: s.defaultFontSize, color: s.defaultColor, visibleAtStart: true,
  };
  if (type === "text") {
    Object.assign(el, {
      text: "テキスト", runs: [{ t: "テキスト" }], font: s.defaultFont, align: "left", letterSpacing: 0, lineSpacing: 1,
      vertical: false, opacity: 1, arc: 0, outline: { mode: "none", width: 0.06, color: null },
      box: { on: false, color: "#FFFFFF", opacity: 1, padding: 0.3, radius: 0.2, follow: true },
    });
  } else Object.assign(el, { latex: "x^2 + y^2 = r^2", mathAlign: "center" });
  return el;
}

/** 要素に付けた中かっこを、同じ位置の「2 点の間」の中かっこにする（付けていた要素の外接矩形の、向きの側の辺）。 */
export function braceToPoints(e) {
  const w = Number(e.width) || 100, h = Number(e.height) || 40, x = Number(e.x), y = Number(e.y);
  // 始点→終点を時計回りに 90° 回した向きが、かっこの向きになるように端を選ぶ
  const seg = {
    down: [[x - w / 2, y + h / 2], [x + w / 2, y + h / 2]], up: [[x + w / 2, y - h / 2], [x - w / 2, y - h / 2]],
    left: [[x - w / 2, y - h / 2], [x - w / 2, y + h / 2]], right: [[x + w / 2, y + h / 2], [x + w / 2, y - h / 2]],
  }[e.direction ?? "down"];
  e.mode = "points";
  e.flip = false;
  e.x = (seg[0][0] + seg[1][0]) / 2; e.y = (seg[0][1] + seg[1][1]) / 2;
  e.dx = (seg[1][0] - seg[0][0]) / 2; e.dy = (seg[1][1] - seg[0][1]) / 2;
}

/** 消す要素に、それに付いているグラフ（座標軸を消すとき）を加える。 */
export function withDependents(ids, slide = currentSlide()) {
  const set = new Set(ids);
  // 座標軸 → グラフ → グラフの補助、線 → 角、元の図形 → 合成した図形、のように、つながっている物をたどって全部消す
  for (let changed = true; changed;) {
    changed = false;
    for (const e of slide?.elements ?? []) {
      if (set.has(e.id) || e.type !== "shape") continue;
      const dep = (["graph", "axdot", "surface", "curve3d", "point3d", "curve2d", "implicit"].includes(e.shape) && set.has(e.axesId))
        || (e.shape === "graphpart" && set.has(e.graphId)) || (e.shape === "angle" && (set.has(e.line1Id) || set.has(e.line2Id)))
        || (e.shape === "boolean" && (e.operandIds ?? []).some((id) => set.has(id)))
        || (e.shape === "annot" && set.has(e.targetId)) || (e.shape === "vector" && !!e.axesId && set.has(e.axesId))
        || (e.shape === "trace" && set.has(e.targetId)) || (e.shape === "tangent" && set.has(e.targetId)) || ((e.shape === "linegraph" || e.shape === "points") && set.has(e.axesId));
      if (dep) { set.add(e.id); changed = true; }
    }
  }
  return [...set];
}


/** 描画するスライドの番号（0 始まり）。include（今回だけ選んだスライド）が無ければ、「描画しない」の印の無いスライド。 */
export function renderIndices(project = store.project, include = null) {
  const n = project?.slides?.length ?? 0;
  if (Array.isArray(include)) return [...new Set(include.filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
  return (project?.slides ?? []).flatMap((sl, i) => (sl.skip ? [] : [i]));
}

/** スライドごとのページ番号（サーバーの project.page_plan と同じ）。描画するスライドだけを数える（描画しないスライドは飛ばして詰める）。
 * 前の描画するスライドの番号 + 1（指定があればその番号から数え直す）。描画しないスライドには、もし描画したらの番号を付ける。 */
export function pagePlan(project = store.project, include = null) {
  const ps = project?.settings?.pageNumbers ?? {};
  const incl = new Set(renderIndices(project, include));
  const nums = [];
  let n = 0, a = 0;
  (project?.slides ?? []).forEach((sl, i) => {
    if (sl.appendix) { // 付録は「A1」「A2」…（本編の番号は進めない）
      const k = a + 1;
      if (incl.has(i)) a = k;
      nums.push(`A${k}`);
      return;
    }
    const num = sl.pageNumber?.number;
    const k = num !== null && num !== undefined && num !== "" ? Number(num) : n + 1;
    if (incl.has(i)) n = k;
    nums.push(k);
  });
  const mains = [...incl].filter((i) => !project.slides[i].appendix);
  const total = mains.length ? nums[Math.max(...mains)] : 0;
  return (project?.slides ?? []).map((sl, i) => {
    let mode = sl.pageNumber?.mode ?? "inherit";
    if (mode === "inherit") mode = masterOf(sl, project)?.pageNumbers ?? "inherit"; // マスターの指定（あれば）
    const show = mode === "inherit" ? !!ps.enabled : mode === "on";
    const text = typeof nums[i] === "string" || ps.format !== "n/N" ? String(nums[i]) : `${nums[i]} / ${total}`;
    return { show, number: nums[i], text, total, skip: !incl.has(i), appendix: !!sl.appendix };
  });
}

/** スライドごとの章（サーバーの project.section_plan と同じ）: { name, index, progress（本編の中の割合）, spans: [[始まり, 終わり]], appendix }。 */
export function sectionPlan(project = store.project, include = null) {
  const slides = project?.slides ?? [];
  const incl = renderIndices(project, include);
  const mains = incl.filter((i) => !slides[i].appendix);
  let name = "", idx = -1;
  const cur = slides.map((sl) => {
    if (sl.appendix) return null;
    if (sl.section) { name = sl.section; idx++; }
    return [name, idx];
  });
  const n = Math.max(1, mains.length);
  const spans = [];
  mains.forEach((i, k) => {
    const [nm, ix] = cur[i];
    if (!spans.length || spans.at(-1)[3] !== ix) spans.push([nm, k / n, (k + 1) / n, ix]);
    else spans.at(-1)[2] = (k + 1) / n;
  });
  return slides.map((sl, i) => {
    const c = cur[i];
    if (!c) return { name: "", index: -1, progress: null, spans: [], appendix: true };
    return { name: c[0], index: c[1], progress: mains.filter((j) => j <= i).length / n, spans: spans.filter((x) => x[0]).map((x) => [x[1], x[2]]), appendix: false };
  });
}

/** 描画する順（本編のあとに付録）。サーバーの project.render_order と同じ。 */
export function renderOrder(project = store.project, include = null) {
  const idx = renderIndices(project, include);
  return [...idx.filter((i) => !project.slides[i].appendix), ...idx.filter((i) => project.slides[i].appendix)];
}
