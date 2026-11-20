// アニメーションの一覧（画面の下）: スライドのステップ（クリック 1 回分）を並べ、選んだステップの「動きの行」を編集する。
// GUI のステップ（mode: "gui"）は動きの行から、コードのステップ（mode: "code"）はコード欄から、書き出しのコードを作る。

import { pickStepCamera } from "./cam3d.js";
import { api } from "./api.js";
import { boundsCenter, refreshElement, setGhosts, setPartPicker } from "./canvas.js";
import { createCodeEditor } from "./codeedit.js";
import { previewStep } from "./render.js";
import { select } from "./selection.js";
import { currentSlide, emit, escapeHtml, findElement, findGroup, fromManim, groupMembers, markDirty, on, slideGroups, store, toast, toManim, uid } from "./store.js";

let catalog = null;
let codeTimer = null;
let editorRef = null; // コードのステップのコード欄（エラーの行の表示用）
let shownKey = null;
let picking = null; // 一部分を選んでいる行（{rowId, items, level, sel: Set, last}）
let curStep = null; // 描いているステップ（行の注意で、あとの行を見る）
let canMerge = null; // 前のステップが GUI のステップなら、その番号（最初の行を、前のステップと同じクリックにできる）  // いま表示している（スライド・ステップ・ステップの数）

export async function loadCatalog() {
  if (!catalog) catalog = await api.get("/api/anim/catalog");
  return catalog;
}

export const animSpec = (id) => catalog?.anims.find((a) => a.id === id);
const groupOf = (id) => animSpec(id)?.group;

/** スライドの要素とグループ（動きの対象の候補）。kind はカタログの対象の種類。 */
function targets(slide = currentSlide(), kind = "element") {
  const els = slide?.elements ?? [];
  if (kind === "value") return (slide?.values ?? []).filter((v) => v.name).map((v) => ({ id: `v:${v.name}`, var: v.name }));
  if (kind === "media") return els.filter((e) => e.type === "media").map((e) => ({ id: e.id, var: e.var }));
  if (kind === "zoom") return els.filter((e) => e.type === "shape" && e.shape === "zoom").map((e) => ({ id: e.id, var: e.var }));
  if (kind === "linear") return els.filter((e) => e.type === "shape" && e.shape === "axes" && e.linear).map((e) => ({ id: e.id, var: e.var }));
  if (kind === "camera") return [{ id: "camera", var: "カメラ" }];
  if (kind === "camera3d") return [{ id: "camera", var: "3D のカメラ" }];
  const ok = els.filter((e) => !(e.type === "shape" && e.shape === "zoom") && e.type !== "media");
  return [...ok.map((e) => ({ id: e.id, var: e.var })), ...slideGroups(slide).map((g) => ({ id: g.id, var: g.var, group: true }))];
}
/** 要素・グループの id → 変数名（書き出すコードの表示用）。 */
const allVars = () => Object.fromEntries([...(currentSlide()?.elements ?? []), ...slideGroups()].map((e) => [e.id, e.var]));
const kindOf = (anim) => animSpec(anim)?.target ?? "element";
/** 対象が画像か、画像を含むグループか（線を描く・書くなどが使えない）。 */
const hasImage = (id) => (currentSlide()?.elements ?? []).some((e) => e.type === "image" && (e.id === id || e.groupId === id));
const varOf = (id) => (id === "camera" ? "カメラ" : String(id ?? "").startsWith("v:") ? id.slice(2) : findElement(id)?.var ?? findGroup(id)?.var ?? null);

/** この要素に、自分の「出す」の動きがあるか（表・行列のセルの要素は、あるときだけ表とは別に出す）。 */
export function hasOwnIntro(id, slide = currentSlide()) {
  return (slide?.steps ?? []).some((st) => (st.rows ?? []).some((r) => r.kind === "anim" && r.target === id && groupOf(r.anim) === "in"));
}

/** 新しい動きの行。 */
export function newRow(anim, target, extra = {}) {
  const spec = animSpec(anim);
  const params = Object.fromEntries((spec?.params ?? []).map((p) => [p.key, structuredClone(p.default)]));
  return { id: uid("r"), kind: "anim", anim, target, start: "after", lag: 0.5, runTime: null, rate: null, params, ...extra };
}

/** 出す動きの対象が「最初から出す」なら、最初は隠す（出す前に見えていると、出す動きにならないため）。変形は、変えた先を隠す。 */
export function ensureHiddenForIntro(row) {
  if (row.kind !== "anim") return;
  if (groupOf(row.anim) === "transform") return hideAtStart(row.params?.to, "変えた先の要素は、変形で現れるように");
  if (groupOf(row.anim) !== "in") return;
  return hideAtStart(row.target, "出す動きで現れるように");
}

function hideAtStart(id, why) {
  if (!id) return;
  const g = findGroup(id);
  const els = g ? groupMembers(g.id) : [findElement(id)].filter(Boolean);
  const shown = els.filter((e) => e.visibleAtStart !== false);
  if (!shown.length) return;
  for (const e of shown) { e.visibleAtStart = false; refreshElement(e); }
  toast(`「${g?.var ?? shown[0].var}」を「スライド開始時に表示」しないようにしました（${why}）。`, "", 6000);
  if (store.selectedIds.some((x) => x === id || els.some((e) => e.id === x))) emit("selection", store.selectedId);
}

const isTexty = (e) => !!e && (["text", "math"].includes(e.type) || (e.type === "shape" && ["tex", "title", "bullets", "theorem"].includes(e.shape)));

/** 「＋出す」の対象: 式・図だけを選んでいても、番号（キャプション）と 2 つだけのグループなら、グループごと出す。 */
function introTarget(target) {
  const el = findElement(target);
  if (!el?.groupId) return { target, note: "" };
  const comp = (currentSlide()?.elements ?? []).find((e) => e.type === "text" && e.numberOf === el.id && e.groupId === el.groupId);
  const g = findGroup(el.groupId);
  if (!comp || !g || groupMembers(g.id).length !== 2) return { target, note: "" };
  return { target: g.id, note: `${comp.numberKind === "fig" ? "図の番号" : "式の番号"}と一緒に出すので、グループ「${g.var}」を対象にしました。` };
}

/** 動きの種類の既定: 文字（テキスト・数式・LaTeX の文章・題名・箇条書き・定理）は Write、画像は FadeIn、ほかは Create。
 *  グループは、中が文字だけなら Write。 */
function introAnim(target) {
  if (hasImage(target)) return "FadeIn";
  const el = findElement(target);
  if (el?.shape === "statchart") return "LaggedIn";
  const g = !el ? findGroup(target) : null;
  if (g) { const ms = groupMembers(g.id); return ms.length && ms.every(isTexty) ? "Write" : "Create"; }
  return isTexty(el) ? "Write" : "Create";
}

/**
 * 選んでいる複数の要素に、同じクリックで出す・消す動きを足す（新しいステップ 1 つ）。
 * lag 秒（0 なら同時）ずつ、前の始まりから遅らせる。グループの中の要素はグループごと。
 */
export async function addAnimStepMulti(ids, group, { lag = 0, intoStep = "" } = {}) {
  await loadCatalog();
  const slide = currentSlide();
  const seen = new Set(), targets = [];
  for (const id of ids) {
    const el = findElement(id);
    let t = el?.groupId && el.groupId !== store.enteredGroup ? el.groupId : id;
    if (group === "in") t = introTarget(t).target;
    if (!seen.has(t)) { seen.add(t); targets.push(t); }
  }
  if (!targets.length) return;
  const rows = targets.map((t, i) => {
    const anim = group === "in" ? introAnim(t) : "FadeOut";
    return newRow(anim, t, { start: i === 0 ? "after" : lag > 0 ? "lag" : "with", lag: lag > 0 ? lag : 0.5 });
  });
  // 決めたステップ（GUI）に足すときは、その最後の動きの後に続ける
  const into = intoStep ? slide.steps.find((s) => s.id === intoStep && s.mode === "gui") : null;
  if (into) {
    into.rows = [...(into.rows ?? []), ...rows];
    for (const r of rows) ensureHiddenForIntro(r);
    store.focusStepId = into.id;
    markDirty("steps");
    emit("steps-changed");
    emit("focus-step", into.id);
    toast(`${targets.length} 個を、ステップ ${slide.steps.indexOf(into) + 1} で${group === "in" ? "出す" : "消す"}動きとして足しました${lag > 0 ? `（${lag} 秒ずつずらす）` : "（同時）"}。`, "", 5000);
    return;
  }
  const st = { id: uid("t"), elementId: targets[0], mode: "gui", rows, code: "" };
  slide.steps.push(st);
  for (const r of rows) ensureHiddenForIntro(r);
  store.focusStepId = st.id;
  markDirty("steps");
  emit("steps-changed");
  emit("focus-step", st.id);
  toast(`${targets.length} 個を、同じクリックで${group === "in" ? "出す" : "消す"}ステップを足しました（ステップ ${slide.steps.indexOf(st) + 1}${lag > 0 ? `、${lag} 秒ずつずらす` : "、同時"}）。`, "", 5000);
  document.getElementById("step-order")?.scrollIntoView({ block: "nearest" });
}

/** 要素に動きを足す（新しいステップを作る）。要素のパネルの「＋出す」などから。 */
export async function addAnimStep(target, group, { into = null } = {}) {
  await loadCatalog();
  const slide = currentSlide();
  if (group === "in") {
    const it = introTarget(target);
    if (it.note) { target = it.target; toast(it.note, "", 5000); }
  }
  const el = findElement(target);
  const zoomOn = group === "zoom" && el?.visibleAtStart === false && !slide.steps.some((x) => (x.rows ?? []).some((r) => r.anim === "ZoomOn"));
  const SPECIAL = { barchart: "BarValues", netgraph: "Relayout", code: "CodeHighlight", number: "CountTo" };
  const anim = group === "in" ? introAnim(target)
    : group === "out" ? "FadeOut" : group === "move" ? "Move" : group === "media" ? "Media" : group === "zoom" ? (zoomOn ? "ZoomOn" : "ZoomMove")
      : group === "linear" ? "ApplyMatrix" : group === "special" ? (SPECIAL[el?.shape] ?? "Indicate") : group === "always" ? "AlwaysRotate" : "Indicate";
  const row = newRow(anim, target);
  if (anim === "ZoomMove" && el) [row.params.x, row.params.y] = toManim(el.frameX, el.frameY).map((v) => Math.round(v * 100) / 100);
  if (anim === "Media" && el?.mode === "bake") row.params.waitMode = "end";
  if (anim === "LaggedIn" && el?.shape === "statchart" && ["bar", "stacked", "hist"].includes(el.chartKind) && !el.horizontal) row.params.how = "up";
  if (anim === "BarValues" && el?.bars) row.params.values = el.bars.map((b) => Math.round((Number(b.value) || 0) * 1.5 * 100) / 100).join(", "); // 焼き込む動画は、描いた時間しか進まないので、終わるまで待つ
  // into: 選んでいるステップ（同じクリック）の最後に足す（始まりは「前の後に」。編集欄で「前と同時」などに変えられる）
  let st = into ? slide.steps.find((x) => x.id === into && x.mode === "gui") : null;
  if (st) st.rows.push(row);
  else {
    st = { id: uid("t"), elementId: target, mode: "gui", rows: [row], code: "" };
    slide.steps.push(st);
  }
  ensureHiddenForIntro(row);
  store.focusStepId = st.id;
  markDirty("steps");
  emit("steps-changed");
  emit("focus-step", st.id);
  document.getElementById("step-order")?.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------- 描く

const DIR_TXT = { none: "なし", UP: "上", DOWN: "下", LEFT: "左", RIGHT: "右", UL: "左上", UR: "右上", DL: "左下", DR: "右下" };

function paramField(row, p) {
  const v = row.params?.[p.key] ?? p.default;
  const shown = !p.show || Object.entries(p.show).every(([k, vs]) => vs.includes(row.params?.[k] ?? animSpec(row.anim)?.params.find((q) => q.key === k)?.default));
  const hid = shown ? "" : "hidden";
  if (p.type === "number") return `<label class="af" ${hid}><span>${escapeHtml(p.label)}</span><input type="number" class="num" data-p="${p.key}" value="${v}" step="${p.step ?? 0.1}"></label>`;
  if (p.type === "color") return `<label class="af" ${hid}><span>${escapeHtml(p.label)}</span><input type="color" data-p="${p.key}" value="${String(v).toLowerCase()}"></label>`;
  if (p.type === "bool") return `<label class="af" ${hid}><input type="checkbox" data-p="${p.key}" ${v ? "checked" : ""}><span>${escapeHtml(p.label)}</span></label>`;
  if (p.type === "expr") return `<label class="af" ${hid}><span>${escapeHtml(p.label)}</span><input type="text" class="expr" data-p="${p.key}" value="${escapeHtml(String(v))}" spellcheck="false"></label>`;
  if (p.type === "pairs") return ""; // 対応を決めて変える: 下の「対応」の欄で選ぶ
  if (p.type === "elem") {
    const els = targets().filter((t) => t.id !== row.target && (!p.elemOnly || p.elemOnly.includes(findElement(t.id)?.shape)));
    return `<label class="af" ${hid}><span>${escapeHtml(p.label)}</span><select data-p="${p.key}">${els.some((t) => t.id === v) ? "" : `<option value="" selected>（選ぶ）</option>`}${els.map((t) => `<option value="${t.id}" ${t.id === v ? "selected" : ""}>${escapeHtml(t.var)}${t.group ? "（グループ）" : ""}</option>`).join("")}</select></label>`;
  }
  const opts = p.type === "dir" ? catalog.dirs : p.options;
  return `<label class="af" ${hid}><span>${escapeHtml(p.label)}</span><select data-p="${p.key}">${opts.map(([k, t]) => `<option value="${k}" ${k === v ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>`;
}

// 速さの変化（ChangeSpeed）: [進み 0〜1, 速さの倍率] の並び
const SPEED_PRESETS = [
  ["slowmid", "途中でゆっくり", [[0, 1], [0.35, 1], [0.45, 0.2], [0.55, 0.2], [0.65, 1], [1, 1]]],
  ["accel", "だんだん速く", [[0, 0.4], [1, 2]]],
  ["decel", "だんだん遅く", [[0, 2], [1, 0.4]]],
  ["pause", "途中で止まりかける", [[0, 1], [0.45, 1], [0.5, 0.05], [0.55, 1], [1, 1]]],
];
const speedCustom = new Set(); // 「自分で決める…」を選んだ行（決まった形と同じ値でも、入力欄を出す）
const speedPreset = (sp, id) => !sp ? "" : speedCustom.has(id) ? "custom" : (SPEED_PRESETS.find(([, , v]) => JSON.stringify(v) === JSON.stringify(sp))?.[0] ?? "custom");
const speedText = (sp) => (sp ?? []).map(([p, v]) => `${p}:${v}`).join(", ");
/** 速さの変化で、動きの長さが何倍になるか（app/animgen.py の speed_factor と同じ）。 */
export function speedFactor(sp) {
  if (!sp?.length) return 1;
  const pts = sp.map((x) => [...x]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts.at(-1)[0] < 1) pts.push([1, pts.at(-1)[1]]);
  let t = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] > pts[i - 1][0]) t += 2 * (pts[i][0] - pts[i - 1][0]) / (pts[i - 1][1] + pts[i][1]);
  return t || 1;
}
/** 「0:1, 0.5:0.2, 1:1」→ [[0,1],[0.5,0.2],[1,1]]。読めなければ null。 */
function parseSpeed(text) {
  const pts = [];
  for (const part of String(text).split(/[,、\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([0-9.]+)\s*[:：]\s*([0-9.]+)$/.exec(part);
    if (!m) return null;
    const p = Math.min(1, Math.max(0, Number(m[1]))), v = Math.min(20, Math.max(0.05, Number(m[2])));
    if (!Number.isFinite(p) || !Number.isFinite(v)) return null;
    pts.push([p, v]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts.length >= 2 ? pts : null;
}
function speedHtml(row, spec) {
  const pre = speedPreset(row.speed, row.id);
  const base = row.runTime ?? spec?.rt ?? 1;
  const opts = [["", "変えない"], ...SPEED_PRESETS.map(([k, t]) => [k, t]), ["custom", "自分で決める…"]];
  return `<label class="af" title="動きの途中で速さを変えます（Manim の ChangeSpeed）。遅くした分だけ、動きは長くなります"><span>速さの変化</span><select data-k="speedp">${opts.map(([k, t]) => `<option value="${k}" ${k === pre ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    ${pre === "custom" ? `<label class="af" title="「進み:速さ」を , で区切って並べます。進みは動きの割合（0〜1）、速さは倍率（1 がそのまま、0.2 は 5 分の 1 の速さ）。間は、なめらかにつなぎます"><span>進み:速さ</span><input type="text" data-k="speedtxt" class="speedtxt" value="${escapeHtml(speedText(row.speed))}" placeholder="0:1, 0.5:0.2, 1:1"></label>` : ""}
    ${row.speed ? `<span class="hint" data-k="speedlen">長さ ${Math.round(base * speedFactor(row.speed) * 100) / 100} 秒</span>` : ""}`;
}

function rowHtml(row, k, n) {
  const merge = canMerge ? `<optgroup label="前のステップ（${canMerge}）と同じクリックにする"><option value="m-with">前と同時</option><option value="m-after">前の後に</option><option value="m-lag">前の始まりから○秒後</option></optgroup>` : "";
  const startSel = k === 0 ? `<select data-k="start"><optgroup label="このクリックで"><option value="after" ${row.start !== "lag" ? "selected" : ""}>クリックですぐ</option><option value="lag" ${row.start === "lag" ? "selected" : ""}>クリックから○秒後</option></optgroup>${merge}</select>`
    : `<select data-k="start"><option value="with" ${row.start === "with" ? "selected" : ""}>前と同時</option><option value="after" ${row.start === "after" ? "selected" : ""}>前の後に</option><option value="lag" ${row.start === "lag" ? "selected" : ""}>前の始まりから○秒後</option></select>`;
  const lag = `<input type="number" class="num" data-k="lag" value="${row.lag ?? 0.5}" step="0.1" min="0" ${row.start === "lag" ? "" : "hidden"} title="秒">`;
  const tools = `<span class="grow"></span><button type="button" class="icon" data-a="copy-row" title="この行を写す（「貼り付け」で、このステップや別のステップに足せます）">⧉</button><button type="button" class="icon" data-a="up" title="上へ" ${k === 0 ? "disabled" : ""}>↑</button><button type="button" class="icon" data-a="down" title="下へ" ${k === n - 1 ? "disabled" : ""}>↓</button><button type="button" class="icon" data-a="del" title="この行を消す">×</button>`;
  if (row.kind === "code") {
    return `<li class="arow code" data-row="${row.id}"><div class="ahead"><span class="no">${k + 1}</span><b>自由なコード</b><span class="hint">前の動きが終わってから実行します</span>${tools}</div><div class="acode"></div></li>`;
  }
  if (row.kind === "wait") {
    return `<li class="arow" data-row="${row.id}"><div class="ahead"><span class="no">${k + 1}</span>${startSel}${lag}<b>待つ</b><input type="number" class="num" data-k="rt" value="${row.runTime}" step="0.5" min="0.01"><span class="unit">秒</span>${tools}</div></li>`;
  }
  const spec = animSpec(row.anim);
  const kind = kindOf(row.anim);
  const tg = targets(undefined, kind);
  const tsel = kind === "camera" || kind === "camera3d" ? `<b class="tcam">${kind === "camera3d" ? "3D のカメラ" : "カメラ"}</b>` : `<select data-k="target">${tg.some((t) => t.id === row.target) ? "" : `<option value="" selected>（対象を選ぶ）</option>`}${tg.map((t) => `<option value="${t.id}" ${t.id === row.target ? "selected" : ""}>${escapeHtml(t.var)}${t.group ? "（グループ）" : ""}</option>`).join("")}</select>`;
  const img = hasImage(row.target);
  const use3d = !!store.project.settings.use3d;
  const tel = findElement(row.target);
  const notFor = (a) => !!a.only && !(tel && (a.only.includes(tel.shape) || a.only.includes(tel.type)));
  const asel = `<select data-k="anim">${catalog.groups.filter(([g]) => !["wait", "code"].includes(g) && !(g === "camera" && use3d) && !(g === "camera3d" && !use3d)).map(([g, gl]) => {
    const items = catalog.anims.filter((a) => a.group === g);
    const none = !targets(undefined, items[0]?.target).length;
    return `<optgroup label="${gl}${none ? "（このスライドに対象がありません）" : ""}">${items.map((a) => {
      const ng = (img && a.vecOnly) || none || notFor(a);
      return `<option value="${a.id}" ${a.id === row.anim ? "selected" : ""} ${ng && a.id !== row.anim ? "disabled" : ""}>${escapeHtml(a.label)}${img && a.vecOnly ? "（画像には使えません）" : notFor(a) ? "（この要素には使えません）" : ""}</option>`;
    }).join("")}</optgroup>`;
  }).join("")}</select>`;
  const inout = ["in", "out"].includes(spec?.group);
  const rsel = `<select data-k="rate"><option value="">既定</option>${catalog.rates.map(([r, t]) => {
    const ng = inout && catalog.returningRates?.includes(r);
    return `<option value="${r}" ${r === row.rate ? "selected" : ""} ${ng && r !== row.rate ? "disabled" : ""}>${escapeHtml(t)}${ng ? "（出す・消すには使えません）" : ""}</option>`;
  }).join("")}</select>`;
  const gl = Object.fromEntries(catalog.groups)[spec?.group] ?? "";
  const stmt = !!spec?.stmt;
  const timed = !stmt || row.anim === "ApplyMatrix" || row.anim === "Cam3dMove";
  const head = stmt ? `<span class="tag stmt" title="前の行の動きが終わってから実行します">前の動きの後に</span>` : `${startSel}${lag}`;
  const partUi = kind === "element" && !spec?.noPart && canPart(row.target)
    ? (row.part?.paths?.length ? `<span class="ptag" title="${escapeHtml(partCode(row))}">一部分（${row.part.paths.length} 個）<button type="button" class="icon" data-a="part-clear" title="要素全体に戻す">×</button></span><button type="button" class="small" data-a="part">選び直す</button>`
      : `<button type="button" class="small" data-a="part" title="文字・行・セルなど、要素の一部分だけを動かす">一部分…</button>`) : "";
  return `<li class="arow g-${spec?.group}" data-row="${row.id}">
    <div class="ahead"><span class="no">${k + 1}</span>${head}${tsel}${partUi}<span class="tag">${gl}</span>${asel}${tools}</div>
    ${picking?.rowId === row.id && picking.mode === "part" ? pickerBar() : ""}
    <div class="aparams">${timed ? `<label class="af"><span>時間</span><input type="number" class="num" data-k="rt" value="${row.runTime ?? ""}" placeholder="${spec?.rt ?? 1}" step="0.25" min="0.01"><span class="unit">秒</span></label>
      <label class="af"><span>緩急</span>${rsel}</label>${stmt ? "" : speedHtml(row, spec)}` : ""}${(spec?.params ?? []).map((p) => paramField(row, p)).join("")}
      ${row.anim === "Move" ? `<button type="button" class="small" data-a="here" title="キャンバスの影（移動先）を、今の位置に戻す">影を元の位置に</button>` : ""}
      ${row.anim === "Cam3dMove" ? `<button type="button" class="small" data-a="campick" title="キャンバスで、中ボタンのドラッグ（回す）・Shift＋中ボタン（中心）・Ctrl＋ホイール（寄り・引き）で向き・中心・寄り方を決め、「決定」でこの行に入れます">キャンバスで決める</button>` : ""}</div>
    ${row.anim === "MatchTransform" ? pairsHtml(row) : ""}
    ${bakeNote(row, curStep)}<div class="adesc">${escapeHtml(spec?.desc ?? "")}${row.rate && catalog.rateDesc?.[row.rate] ? `<br>緩急: ${escapeHtml(catalog.rateDesc[row.rate])}` : ""}</div></li>`;
}

// ---------------------------------------------------------------- 要素の一部分（文字・行・セルなど）

const PART_SHAPES = ["table", "matrix", "bullets", "title", "tex", "code", "theorem"];
function canPart(id) {
  const el = findElement(id);
  return !!el && (["math", "text"].includes(el.type) || (el.type === "shape" && PART_SHAPES.includes(el.shape)));
}
/** 一部分のコード（書き出しの part_expr と同じ。表示用）。 */
function partCode(row) {
  return pathsCode(varOf(row.target) ?? "?", row.part?.paths ?? []);
}
function pathsCode(v, paths) {
  const ps = [...new Map(paths.map((q) => [q.join(","), q])).values()].sort((a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
    return 0;
  });
  const runs = [];
  for (const q of ps) {
    const last = runs.at(-1)?.at(-1);
    if (last && last.length === q.length && last.slice(0, -1).join() === q.slice(0, -1).join() && q.at(-1) === last.at(-1) + 1) runs.at(-1).push(q);
    else runs.push([q]);
  }
  const parts = runs.map((r) => {
    const head = v + r[0].slice(0, -1).map((i) => `[${i}]`).join("");
    return r.length === 1 ? `${head}[${r[0].at(-1)}]` : `${head}[${r[0].at(-1)}:${r.at(-1).at(-1) + 1}]`;
  });
  return parts.length === 1 ? parts[0] : `VGroup(${parts.join(", ")})`;
}
const pkey = (q) => q.join(",");

const PICK_MSG = { part: "", pairFrom: "① 対象の、変える部品を選びます。", pairTo: "② 変えた先の、変わった後の部品を選びます。" };
function pickerBar() {
  const n = picking.sel.size;
  const pair = picking.mode !== "part";
  return `<div class="pickbar">${pair ? `<b class="pickstep">${PICK_MSG[picking.mode]}</b>` : ""}<span class="unit">まとまり</span><select data-k="plevel">
      <option value="1" ${picking.level === 1 ? "selected" : ""}>1 段目（行・大きなまとまり）</option>
      <option value="2" ${picking.level === 2 ? "selected" : ""}>2 段目（文字など）</option></select>
    <span class="hint" data-k="pcount">キャンバスで部品を押して選びます（Shift で範囲）。選んだ数: ${n}</span><span class="grow"></span>
    ${pair ? "" : `<button type="button" class="small" data-a="pick-rest" title="この行より前の行で、この要素の一部分として選んだ部品を除いた残りを選ぶ">前の行の残り</button>`}
    <button type="button" class="small" data-a="pick-all">全部</button><button type="button" class="small" data-a="pick-none">外す</button>
    <button type="button" class="small primary" data-a="pick-ok">${picking.mode === "pairFrom" ? "次へ" : "決める"}</button><button type="button" class="small" data-a="pick-cancel">やめる</button></div>`;
}

function endPick() {
  picking = null;
  setPartPicker(null);
}

/** 部品を選び始める。mode: "part"（行の対象の一部分）・"pairFrom" / "pairTo"（対応を決めて変える の、対象 → 変えた先）。 */
async function startPick(row, rerender, mode = "part", from = null) {
  const elId = mode === "pairTo" ? row.params?.to : row.target;
  const el = findElement(elId);
  if (!el) return;
  try {
    const r = await api.post("/api/anim/parts", { el });
    const items = r.items ?? [];
    const lv2 = items.filter((x) => x.path.length === 2).length, lv1 = items.filter((x) => x.path.length === 1).length;
    const cur = mode === "part" ? row.part?.paths ?? [] : [];
    const level = cur.length ? cur[0].length : (["math", "text"].includes(el.type) && lv2 ? 2 : lv1 ? 1 : 2);
    picking = { rowId: row.id, elId, mode, from, items, level, sel: new Set(cur.filter((q) => q.length === level).map(pkey)), last: null };
    rerender();
  } catch (e) { toast(e.message, "ng", 7000); }
}

/** 対応を決めて変える: 決めた対応の一覧と、足すボタン。 */
function pairsHtml(row) {
  const pairs = row.params?.pairs ?? [];
  const va = varOf(row.target) ?? "?", vb = varOf(row.params?.to) ?? "?";
  const okTo = !!findElement(row.params?.to) && canPart(row.params?.to) && canPart(row.target);
  const busy = picking?.rowId === row.id;
  return `<div class="pairs"><span class="unit">対応</span><ol class="pair-list">${pairs.map((pr, i) => `<li data-i="${i}"><code>${escapeHtml(pathsCode(va, pr.from))}</code><span class="arr">→</span><code>${escapeHtml(pathsCode(vb, pr.to))}</code><button type="button" class="icon" data-a="pair-del" title="この対応を消す">×</button></li>`).join("")
    || `<li class="hint">（まだありません。残りの決め方だけで変えます）</li>`}</ol>
    <button type="button" class="small" data-a="pair-add" ${okTo && !busy ? "" : "disabled"} title="${okTo ? "対象の部品 → 変えた先の部品の順に、キャンバスで選ぶ" : "先に「変えた先」に、数式・テキストなどを選んでください"}">＋ 対応を足す</button>
    ${pairs.length ? `<button type="button" class="small" data-a="pair-clear">全部消す</button>` : ""}</div>
    ${busy && picking.mode !== "part" ? pickerBar() : ""}`;
}

function updatePicker(box, row) {
  if (!picking || picking.rowId !== row.id) return;
  const list = picking.items.filter((x) => x.path.length === picking.level);
  // 対応を決めるときは、ほかの対応で選んだ部品に印を付ける（その部品の中を含む）
  const side = picking.mode === "pairFrom" ? "from" : picking.mode === "pairTo" ? "to" : null;
  const used = side ? (row.params?.pairs ?? []).flatMap((pr) => pr[side]).map(pkey) : [];
  const isUsed = (q) => used.some((u) => pkey(q) === u || pkey(q).startsWith(u + ",") || u.startsWith(pkey(q) + ","));
  const boxes = list.map((x, i) => {
    const [ax, ay] = fromManim(x.box[0], x.box[3]), [bx, by] = fromManim(x.box[2], x.box[1]);
    return { x0: Math.min(ax, bx) - 2, y0: Math.min(ay, by) - 2, x1: Math.max(ax, bx) + 2, y1: Math.max(ay, by) + 2, label: String(i + 1), on: picking.sel.has(pkey(x.path)), used: isUsed(x.path) };
  });
  setPartPicker({
    boxes,
    focusId: picking.elId,
    onClick: (i, shift) => {
      const k = pkey(list[i].path);
      if (shift && picking.last !== null) {
        const [a, b] = [Math.min(picking.last, i), Math.max(picking.last, i)];
        for (let j = a; j <= b; j++) picking.sel.add(pkey(list[j].path));
      } else if (picking.sel.has(k)) picking.sel.delete(k);
      else picking.sel.add(k);
      picking.last = i;
      boxes.forEach((bx, j) => { bx.on = picking.sel.has(pkey(list[j].path)); });
      const c = box.querySelector("[data-k=pcount]");
      if (c) c.textContent = `キャンバスで部品を押して選びます（Shift で範囲）。選んだ数: ${picking.sel.size}`;
    },
  });
}

/** 焼き込む動画・音声を、待たずに再生する行への注意（あとに動き・待つが無いと、再生した瞬間しか映らない）。 */
function bakeNote(row, st) {
  if (row.anim !== "Media" || findElement(row.target)?.mode !== "bake") return "";
  const p = row.params ?? {};
  const el = findElement(row.target);
  const what = el.kind === "video" ? "動画" : "音声";
  let html = "";
  // 焼き込むと、クリックの瞬間に合わせた操作はできない（クリックを待つ間、動画は止まっている）
  if (["volume", "hide", "show", "pause", "seek", "stop"].includes(p.action)) {
    html += `<div class="clash bnote info">ⓘ 「動画に焼き込む」では、クリックした瞬間の再生位置に合わせて操作することはできません。焼き込んだ${what}は、描いた時間の分しか進まず、クリックを待っている間は止まっているため、この操作は「前の行・前のステップで描いた所まで再生した位置」で行われます。
      クリックした瞬間に合わせて${p.action === "volume" ? "音量を変え" : p.action === "hide" || p.action === "show" ? "表示・非表示を切り替え" : "操作し"}たいときは、要素の「再生」を「発表で再生」にしてください。</div>`;
    // 前のステップで、終わりまで再生し切っているとき
    if (endedBefore(row, el)) html += `<div class="clash bnote">⚠ この行より前に、${what}を終わりまで再生しています（「終わるまで待つ」）。このあとに再生は続きません（「再生」を足すと、最初から再生します）。続きを流したいときは、前の「再生」の「そのあと」を「決めた秒数だけ待つ」にしてください。</div>`;
  }
  return html + bakeWaitNote(row, st, p, what);
}

/** このスライドで、行 row より前に、焼き込む動画・音声 el を終わりまで再生し切っているか（その後に再生・停止・位置の変更が無い）。 */
function endedBefore(row, el) {
  if (el.loop) return false;
  let ended = false, playing = el.start === "auto";
  if (playing && !el.loop) ended = true; // 「自動」は、スライドの初めに終わりまで再生する
  for (const s of currentSlide().steps) {
    for (const r of s.rows ?? []) {
      if (r === row) return ended;
      if (r.anim !== "Media" || r.target !== el.id) continue;
      const a = r.params?.action ?? "play", wm = r.params?.waitMode ?? "none";
      if (a === "play") { playing = true; ended = false; }
      if (a === "pause" || a === "stop") playing = false;
      if (a === "stop" || a === "seek") ended = false;
      if (wm === "end" && playing) { ended = true; playing = false; }
    }
  }
  return false;
}

function bakeWaitNote(row, st, p, what) {
  if (!["play", "seek", "volume", "show", "hide"].includes(p.action ?? "play") || (p.waitMode ?? "none") !== "none") return "";
  const rows = st?.rows ?? [];
  if (rows.slice(rows.indexOf(row) + 1).some((r) => r.kind === "wait" || (r.kind === "anim" && !animSpec(r.anim)?.stmt) || (r.anim === "Media" && (r.params?.waitMode ?? "none") !== "none"))) return "";
  return `<div class="clash bnote">⚠ 焼き込む${what}は、描いた時間の分しか進みません（クリックを待っている間は止まります）。「そのあと」を「終わるまで待つ」か「決めた秒数だけ待つ」にするか、このあとに動きや「待つ」を置いてください（何も無いと、このクリックの${what}は、ここで止まります）。</div>`;
}

const keyNow = () => { const sl = currentSlide(); return `${sl?.id}|${store.focusStepId}|${sl?.steps.length}|${sl?.steps.find((s) => s.id === store.focusStepId)?.mode}`; };

/** 表示中のステップが変わったときだけ描き直す（ステップの一覧を描くたびに呼ばれる）。 */
export function syncAnimEditor() {
  if (keyNow() !== shownKey) renderAnimEditor();
}

export async function renderAnimEditor() {
  const box = document.getElementById("anim-editor");
  if (!box) return;
  shownKey = keyNow();
  const slide = currentSlide();
  const st = slide?.steps.find((s) => s.id === store.focusStepId);
  if (picking && !(st?.rows ?? []).some((r) => r.id === picking.rowId)) endPick();
  editorRef = null;
  if (!slide) { box.innerHTML = ""; setGhosts([]); return; }
  await loadCatalog();
  if (!st || st.mode !== "gui") setGhosts([]);
  if (!st) {
    box.innerHTML = `<div class="hint anim-empty">上のステップを押すと、ここで動きを編集できます。「＋ステップ」で、新しいクリックの動きを足します（要素を選んでいれば、その要素の動きから始めます）。
      ${animClip?.kind === "steps" ? `<div class="row">${pasteButtons(false)}</div>` : ""}</div>`;
    bindPaste(box, null, slide);
    return;
  }
  const k = slide.steps.indexOf(st) + 1;
  const gui = st.mode === "gui";
  canMerge = k > 1 && slide.steps[k - 2].mode === "gui" ? `ステップ ${k - 1}` : null;
  curStep = st;
  box.innerHTML = `<div class="anim-head"><b>ステップ ${k}</b><span class="hint">（${k} 回目のクリック）</span>
      <button type="button" class="small" data-a="try" title="このスライドを低い画質で描画して、このステップの動きから見る（Ctrl+Enter の試し描画と同じ）">▷ このステップを試す</button><span class="grow"></span>
      ${gui ? `<button type="button" class="small" data-a="add-anim">＋動き</button><button type="button" class="small" data-a="add-wait">＋待つ</button><button type="button" class="small" data-a="add-code">＋コード</button>
      <button type="button" class="small" data-a="to-code" title="このステップを、書き出すコードのコード欄にする（GUI には戻せません）">コードにする</button>` : `<span class="hint">コードのステップ</span>`}
      <button type="button" class="small" data-a="copy-step" title="このステップを写す（「貼り付け」で、このあとに新しいステップとして足せます）">⧉ ステップを写す</button>
      ${pasteButtons(gui)}
      <button type="button" class="small danger" data-a="del-step">ステップを削除</button></div>
    ${playHtml(st)}
    ${gui ? `<ol class="anim-rows">${st.rows.map((r, i) => rowHtml(r, i, st.rows.length)).join("") || `<li class="hint">（動きがありません。「＋動き」で足します）</li>`}</ol>
      <details class="anim-code" ${store.animCodeOpen ? "open" : ""}><summary>書き出すコード</summary><pre data-k="code"></pre></details>` : `<div data-k="editor"></div>`}`;
  bindHead(box, st, slide);
  bindPlay(box, st);
  bindPaste(box, st, slide);
  if (gui) {
    bindRows(box, st);
    updateCode(box, st);
    box.querySelector("details.anim-code").addEventListener("toggle", (e) => { store.animCodeOpen = e.target.open; });
  } else {
    const ed = createCodeEditor({
      value: st.code || "", rows: 4, placeholder: "self.play(Write(eq1))",
      onInput: (v) => { st.code = v; markDirty("code"); emit("step-code-input", { id: st.id, value: v, src: "pane" }); },
    });
    box.querySelector("[data-k=editor]").appendChild(ed.el);
    editorRef = { stepId: st.id, ed };
    showError();
  }
}

/** ステップの発表の仕方（manim-slides の next_slide の引数）: くり返す・終わったら自動で次へ・発表者ノート。 */
function playHtml(st) {
  const notes = (st.notes || "").trim();
  return `<div class="anim-play">
      <label title="このステップの動きを、次のクリックまでくり返し再生する（next_slide(loop=True)）"><input type="checkbox" data-k="loop" ${st.loop ? "checked" : ""}> くり返す（次のクリックまで）</label>
      <label title="このステップの動きが終わったら、クリックを待たずに次のステップへ進む（next_slide(auto_next=True)）"><input type="checkbox" data-k="autoNext" ${st.autoNext ? "checked" : ""}> 終わったら自動で次へ</label>
      <label title="「ファイルに出力」の動画（mp4）で、このステップの動きのあとに待つ秒数（空欄なら、出力するときに決める全体の秒数）。自動で次へのステップは待ちません"
        class="vwait">動画での待ち <input type="number" data-k="videoWait" min="0" max="600" step="0.5" placeholder="全体" value="${st.videoWait ?? ""}" style="width:4.5em"> 秒</label>
      <details class="notes" ${notes ? "open" : ""}><summary>発表者ノート${notes ? "（あり）" : ""}</summary>
        <textarea data-k="notes" rows="2" placeholder="このステップを見せている間、発表者用の画面に出すメモ（Markdown が使えます）">${escapeHtml(st.notes || "")}</textarea></details>
    </div>`;
}

function bindPlay(box, st) {
  const loop = box.querySelector(".anim-play [data-k=loop]"), auto = box.querySelector(".anim-play [data-k=autoNext]");
  const changed = () => { markDirty("steps"); emit("steps-rows-changed"); };
  loop.addEventListener("change", () => {
    st.loop = loop.checked;
    if (st.loop && st.autoNext) { st.autoNext = false; auto.checked = false; toast("くり返すステップは終わらないので、「終わったら自動で次へ」を外しました。"); }
    changed();
  });
  auto.addEventListener("change", () => {
    st.autoNext = auto.checked;
    if (st.loop && st.autoNext) { st.loop = false; loop.checked = false; toast("「くり返す」を外しました（くり返すステップは、自動で次へ進めません）。"); }
    changed();
  });
  const vw = box.querySelector(".anim-play [data-k=videoWait]");
  vw.addEventListener("change", () => {
    const v = vw.value.trim() === "" ? null : Number(vw.value);
    st.videoWait = v == null || !Number.isFinite(v) ? null : Math.min(600, Math.max(0, v));
    vw.value = st.videoWait ?? "";
    markDirty("steps");
  });
  const ta = box.querySelector(".anim-play [data-k=notes]");
  // ステップの一覧の印は、打ち終わって少ししてから更新する（欄から出たときに一覧を描き直すと、一覧のクリックが失われるため）
  let timer = null;
  ta.addEventListener("input", () => {
    st.notes = ta.value;
    markDirty("steps");
    box.querySelector(".anim-play .notes summary").textContent = `発表者ノート${ta.value.trim() ? "（あり）" : ""}`;
    clearTimeout(timer);
    timer = setTimeout(() => emit("steps-rows-changed"), 600);
  });
}

function showError() {
  const err = store.lastError?.location;
  if (editorRef && err?.kind === "step" && err.stepId === editorRef.stepId) {
    editorRef.ed.setErrorLine(err.codeLine);
    editorRef.ed.revealLine(err.codeLine);
  }
  if (err?.kind === "step" && err.rowId) {
    document.querySelectorAll(`#anim-editor .arow[data-row="${err.rowId}"]`).forEach((li) => li.classList.add("err"));
  }
}

function bindHead(box, st, slide) {
  const changed = () => { markDirty("steps"); emit("steps-changed"); };
  box.querySelector("[data-a=try]")?.addEventListener("click", () => previewStep(slide.steps.indexOf(st) + 1));
  box.querySelector("[data-a=add-anim]")?.addEventListener("click", () => {
    const last = [...st.rows].reverse().find((r) => r.kind === "anim");
    const sel = store.selectedIds.length === 1 ? store.selectedIds[0] : null;
    const row = newRow("Indicate", sel ?? last?.target ?? "");
    st.rows.push(row);
    changed();
  });
  box.querySelector("[data-a=add-wait]")?.addEventListener("click", () => { st.rows.push({ id: uid("r"), kind: "wait", start: "after", lag: 0.5, runTime: 1 }); changed(); });
  box.querySelector("[data-a=add-code]")?.addEventListener("click", () => { st.rows.push({ id: uid("r"), kind: "code", code: "self.wait()" }); changed(); });
  box.querySelector("[data-a=to-code]")?.addEventListener("click", async () => {
    if (!confirm("このステップをコードのステップにしますか？（動きの行は、書き出すコードになります。GUI には戻せません）")) return;
    const r = await api.post("/api/anim/code", { step: st, vars: allVars() });
    st.mode = "code";
    st.code = r.code;
    st.elementId = st.rows.find((x) => x.kind === "anim" && (findElement(x.target) || findGroup(x.target)))?.target ?? st.elementId ?? null;
    delete st.rows;
    changed();
  });
  box.querySelector("[data-a=copy-step]")?.addEventListener("click", () => setClip({ kind: "steps", steps: [{ ...JSON.parse(JSON.stringify(st)), _gvar: varOf(st.elementId) }] }, "ステップを写しました。"));
  box.querySelector("[data-a=del-step]").addEventListener("click", () => {
    // 元に戻せるので確かめずに消し、「元に戻す」のボタン付きで知らせる
    const n = slide.steps.indexOf(st) + 1;
    slide.steps = slide.steps.filter((s) => s !== st);
    store.focusStepId = null;
    changed();
    toast(`ステップ ${n} を削除しました。`, "", 6000, { label: "元に戻す", run: async () => (await import("./history.js")).undo() });
  });
}

function bindRows(box, st) {
  const changedRows = (rerender = false) => {
    markDirty("steps");
    if (rerender) emit("steps-changed");
    else { updateCode(box, st); updateGhosts(box, st); emit("steps-rows-changed"); }
  };
  box.querySelectorAll(".arow[data-row]").forEach((li) => {
    const row = st.rows.find((r) => r.id === li.dataset.row);
    if (!row) return;
    const q = (s) => li.querySelector(s);
    q("[data-a=up]")?.addEventListener("click", () => { const i = st.rows.indexOf(row); st.rows.splice(i, 1); st.rows.splice(i - 1, 0, row); changedRows(true); });
    q("[data-a=down]")?.addEventListener("click", () => { const i = st.rows.indexOf(row); st.rows.splice(i, 1); st.rows.splice(i + 1, 0, row); changedRows(true); });
    q("[data-a=del]")?.addEventListener("click", () => { st.rows = st.rows.filter((r) => r !== row); changedRows(true); });
    q("[data-a=copy-row]")?.addEventListener("click", () => setClip({ kind: "rows", rows: [JSON.parse(JSON.stringify(row))] }, "行を 1 つ写しました。"));
    if (row.kind === "code") {
      const ed = createCodeEditor({ value: row.code || "", rows: 2, placeholder: "self.wait()", onInput: (v) => { row.code = v; li.classList.remove("err"); changedRows(); } });
      q(".acode").appendChild(ed.el);
      const err = store.lastError?.location;
      if (err?.kind === "step" && err.rowId === row.id && err.rowLine) ed.setErrorLine(err.rowLine);
      return;
    }
    q("[data-k=start]")?.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v.startsWith("m-")) { mergeIntoPrevious(st, v.slice(2)); return; }
      row.start = v; q("[data-k=lag]").hidden = row.start !== "lag"; changedRows();
    });
    q("[data-k=lag]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { row.lag = v; changedRows(); } });
    q("[data-k=rt]")?.addEventListener("change", (e) => {
      const t = e.target.value.trim();
      if (row.kind === "wait") { const v = Number(t); if (v > 0) row.runTime = v; } else row.runTime = t === "" ? null : Math.max(0.01, Number(t) || 0.01);
      const len = li.querySelector("[data-k=speedlen]");
      if (len) len.textContent = `長さ ${Math.round((row.runTime ?? catalog.anims.find((a) => a.id === row.anim)?.rt ?? 1) * speedFactor(row.speed) * 100) / 100} 秒`;
      changedRows();
    });
    if (row.kind === "wait") return;
    q("[data-k=target]")?.addEventListener("change", (e) => {
      row.target = e.target.value;
      delete row.part;
      if (row.params?.pairs?.length) { row.params.pairs = []; toast("対象を変えたので、決めた対応を消しました。", "warn"); }
      if (picking?.rowId === row.id) endPick();
      if (row.anim === "Media") (row.params ??= {}).waitMode = findElement(row.target)?.mode === "bake" ? "end" : "none";
      if (hasImage(row.target) && animSpec(row.anim)?.vecOnly) { row.anim = groupOf(row.anim) === "out" ? "FadeOut" : groupOf(row.anim) === "in" ? "FadeIn" : "Indicate"; row.params = {}; toast("画像には使えない動きなので、変えました。", "warn"); }
      ensureHiddenForIntro(row);
      changedRows(true);
    });
    q("[data-k=anim]").addEventListener("change", (e) => {
      const oldKind = kindOf(row.anim);
      row.anim = e.target.value;
      const spec = animSpec(row.anim);
      if (spec.target !== oldKind) row.target = targets(undefined, spec.target)[0]?.id ?? "";  // 対象の種類が変わったら、その種類の最初のもの
      if (row.anim === "Move") row.params = {};  // 移動は、今の位置からのずれ（0）から始める
      row.params = Object.fromEntries((spec?.params ?? []).map((p) => [p.key, p.type === "pairs" ? [] : row.params?.[p.key] ?? structuredClone(p.default)]));
      if (spec?.noPart) delete row.part;
      if (picking?.rowId === row.id) endPick();
      row.runTime = null;
      if (["in", "out"].includes(spec?.group) && catalog.returningRates?.includes(row.rate)) row.rate = null;
      ensureHiddenForIntro(row);
      changedRows(true);
    });
    q("[data-k=rate]")?.addEventListener("change", (e) => { row.rate = e.target.value || null; changedRows(true); });
    q("[data-k=speedp]")?.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "custom") speedCustom.add(row.id); else speedCustom.delete(row.id);
      if (!v) delete row.speed;
      else if (v === "custom") row.speed = row.speed ?? [[0, 1], [0.5, 0.3], [1, 1]];
      else row.speed = structuredClone(SPEED_PRESETS.find(([k2]) => k2 === v)[2]);
      changedRows(true);
    });
    q("[data-k=speedtxt]")?.addEventListener("change", (e) => {
      const sp = parseSpeed(e.target.value);
      if (!sp) { toast("「進み:速さ」を、0:1, 0.5:0.2, 1:1 のように 2 つ以上書いてください（進みは 0〜1、速さは 0.05〜20）。", "warn", 6000); e.target.value = speedText(row.speed); return; }
      row.speed = sp;
      changedRows(true);
    });
    q("[data-a=part]")?.addEventListener("click", () => startPick(row, () => renderAnimEditor()));
    q("[data-a=part-clear]")?.addEventListener("click", () => { delete row.part; endPick(); changedRows(true); });
    q("[data-a=pair-add]")?.addEventListener("click", () => startPick(row, () => renderAnimEditor(), "pairFrom"));
    q("[data-a=pair-clear]")?.addEventListener("click", () => { row.params.pairs = []; changedRows(true); });
    li.querySelectorAll("[data-a=pair-del]").forEach((b) => b.addEventListener("click", () => {
      row.params.pairs.splice(Number(b.closest("li").dataset.i), 1);
      changedRows(true);
    }));
    if (picking?.rowId === row.id) {
      updatePicker(li, row);
      q("[data-k=plevel]").addEventListener("change", (e) => { picking.level = Number(e.target.value); picking.sel.clear(); picking.last = null; renderAnimEditor(); });
      q("[data-a=pick-all]").addEventListener("click", () => { picking.items.filter((x) => x.path.length === picking.level).forEach((x) => picking.sel.add(pkey(x.path))); updatePicker(li, row); renderAnimEditor(); });
      q("[data-a=pick-none]").addEventListener("click", () => { picking.sel.clear(); updatePicker(li, row); renderAnimEditor(); });
      q("[data-a=pick-rest]")?.addEventListener("click", () => {
        // この行より前（前のステップも）で、同じ要素の一部分として選んだ部品（同じ段）を除いた残り
        const used = new Set();
        for (const s2 of currentSlide().steps) {
          let done = false;
          for (const r of s2.rows ?? []) {
            if (r === row) { done = true; break; }
            if (r.kind === "anim" && r.target === row.target) for (const q2 of r.part?.paths ?? []) if (q2.length === picking.level) used.add(pkey(q2));
          }
          if (done) break;
        }
        picking.sel = new Set(picking.items.filter((x) => x.path.length === picking.level && !used.has(pkey(x.path))).map((x) => pkey(x.path)));
        if (!used.size) toast("この行より前に、この要素の一部分を選んだ行がありません（全部を選びました）。", "warn");
        renderAnimEditor();
      });
      q("[data-a=pick-cancel]").addEventListener("click", () => { endPick(); renderAnimEditor(); });
      q("[data-a=pick-ok]").addEventListener("click", () => {
        const all = picking.items.filter((x) => x.path.length === picking.level);
        const paths = all.filter((x) => picking.sel.has(pkey(x.path))).map((x) => x.path);
        if (picking.mode === "pairFrom") {
          if (!paths.length) { toast("対象の部品を、1 つ以上選んでください。", "warn"); return; }
          startPick(row, () => renderAnimEditor(), "pairTo", paths);
          return;
        }
        if (picking.mode === "pairTo") {
          if (!paths.length) { toast("変えた先の部品を、1 つ以上選んでください。", "warn"); return; }
          (row.params.pairs ??= []).push({ from: picking.from, to: paths });
          endPick();
          changedRows(true);
          return;
        }
        if (paths.length && paths.length < all.length) row.part = { paths }; else delete row.part; // 全部なら要素全体と同じ
        endPick();
        changedRows(true);
      });
    }
    const specP = animSpec(row.anim)?.params ?? [];
    li.querySelectorAll("[data-p]").forEach((inp) => {
      const p = specP.find((x) => x.key === inp.dataset.p);
      const ev = inp.type === "color" ? "input" : "change";
      inp.addEventListener(ev, () => {
        row.params ??= {};
        const before = row.params[p.key];
        row.params[p.key] = p.type === "number" ? Number(inp.value) : p.type === "bool" ? inp.checked : p.type === "color" ? inp.value.toUpperCase() : inp.value;
        if (row.anim === "Move" && p.key === "mode" && before !== row.params.mode) {
          // 「ずらす」と「決めた位置へ」を切り替えたら、移動先が変わらないように数を付け替える
          const from = posBefore(st, row);
          if (from) {
            const [x, y] = [Number(row.params.x) || 0, Number(row.params.y) || 0];
            [row.params.x, row.params.y] = row.params.mode === "to" ? [from[0] + x, from[1] + y] : [x - from[0], y - from[1]];
            [row.params.x, row.params.y] = [r2(row.params.x), r2(row.params.y)];
          }
        }
        if (p.key === "to") ensureHiddenForIntro(row);
        if (p.key === "to" && before !== row.params.to && row.params.pairs?.length) {
          row.params.pairs = [];
          toast("変えた先を変えたので、決めた対応を消しました。", "warn");
          if (picking?.rowId === row.id) endPick();
        }
        // ほかの引数の表示が、この引数で変わるなら描き直す
        if (specP.some((x) => x.show && p.key in x.show) || (row.anim === "Move" && p.key === "mode") || row.anim === "Media" || (row.anim === "MatchTransform" && p.key === "to")) changedRows(true);
        else changedRows();
      });
    });
    q("[data-a=campick]")?.addEventListener("click", () => pickStepCamera(row, (ok) => { if (ok) changedRows(true); }));
    q("[data-a=here]")?.addEventListener("click", () => {
      const from = posBefore(st, row);
      if (row.params?.mode === "to" && from) [row.params.x, row.params.y] = [r2(from[0]), r2(from[1])];
      else Object.assign(row.params, { x: 0, y: 0 });
      changedRows(true);
    });
    // 行の対象を押すと、キャンバスでその要素を選ぶ
    q(".no")?.addEventListener("click", () => { if (findElement(row.target) || findGroup(row.target)) select(row.target); });
  });
  showError();
  updateGhosts(box, st);
}

// ---------------------------------------------------------------- 移動先の影（キャンバス）

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const P = () => store.meta.canvas.h / 8;
const idsOf = (id) => (findGroup(id) ? groupMembers(id).map((e) => e.id) : findElement(id) ? [id] : []);

/** 要素の、スライドの初めの中心（Manim の座標）。 */
function startCenter(id) {
  const c = boundsCenter(idsOf(id));
  return c ? toManim(c.x, c.y) : null;
}

/**
 * 行 row の直前の、対象の中心（Manim の座標）の目安。スライドの初めの位置から、その行より前の「移動」「回転（決めた点のまわり）」を
 * 順にたどる（グループを動かすと中の要素も動く。自由なコードや、線に沿った動きは数えない）。
 */
function posBefore(st, row) {
  const slide = currentSlide();
  const tgt = row.target;
  const c0 = startCenter(tgt);
  if (!c0) return null;
  let c = [...c0];
  const saved = new Map(); // 「今の状態を覚える」で覚えた位置（対象ごと）
  const parent = findElement(tgt)?.groupId;
  for (const s of slide.steps) {
    if (s.mode !== "gui") continue;
    for (const r of s.rows ?? []) {
      if (r === row) return c;
      if (r.kind !== "anim") continue;
      const hit = r.target === tgt || (parent && r.target === parent);
      if (!hit) continue;
      const p = r.params ?? {};
      if (r.anim === "SaveState") saved.set(r.target, [...c]);
      else if (r.anim === "Restore") c = [...(saved.get(r.target) ?? (r.target === tgt ? c0 : c))];
      else if (r.anim === "Move") {
        if (p.mode === "to") {
          if (r.target === tgt) c = [Number(p.x) || 0, Number(p.y) || 0];
          else { const g = posBefore(s, r) ?? c; c = [c[0] + (Number(p.x) || 0) - g[0], c[1] + (Number(p.y) || 0) - g[1]]; }
        } else c = [c[0] + (Number(p.x) || 0), c[1] + (Number(p.y) || 0)];
      } else if (r.anim === "MoveAlongPath") {
        const P = pathPts(p.path);
        if (P) c = p.how === "on" ? [...P.at(-1)] : [c[0] + P.at(-1)[0] - P[0][0], c[1] + P.at(-1)[1] - P[0][1]];
      } else if (r.anim === "Rotate" && p.about === "point") {
        const a = (Number(p.angle) || 0) * Math.PI / 180, ax = Number(p.ax) || 0, ay = Number(p.ay) || 0;
        const dx = c[0] - ax, dy = c[1] - ay;
        c = [ax + dx * Math.cos(a) - dy * Math.sin(a), ay + dx * Math.sin(a) + dy * Math.cos(a)];
      }
    }
  }
  return c;
}

/** 選んでいるステップの「移動」の行の、移動先の影をキャンバスに出す（ドラッグで移動先を決める）。 */
// 線に沿って動くときの線の点（Manim の座標）。要素の中身が変わったら取り直す
const pathCache = new Map(); // id → {key, pts | null, busy}
function pathPts(id) {
  const el = findElement(id);
  if (!el) return null;
  const key = JSON.stringify(el);
  const c = pathCache.get(id);
  if (c && c.key === key) return c.pts;
  if (c?.busy === key) return null;
  pathCache.set(id, { key: c?.key, pts: c?.pts ?? null, busy: key });
  const slide = currentSlide();
  api.post("/api/anim/pathpts", { id, elements: slide.elements, values: slide.values ?? [] })
    .then((r) => { pathCache.set(id, { key, pts: r.pts }); if (ghostCtx) updateGhosts(ghostCtx.box, ghostCtx.st); })
    .catch(() => pathCache.set(id, { key, pts: null }));
  return c?.key === key ? c.pts : null;
}

/** 行 row の直前のカメラの枠（中心・幅。Manim の座標）。スライドのカメラの初期位置から、前のカメラの動きをたどる。 */
function cameraBefore(row) {
  const cam0 = currentSlide().camera;
  const init = cam0 ? { x: cam0.x, y: cam0.y, w: cam0.width } : { x: 0, y: 0, w: 8 * store.meta.canvas.w / store.meta.canvas.h };
  let c = { ...init };
  for (const s of currentSlide().steps) {
    if (s.mode !== "gui") continue;
    for (const r of s.rows ?? []) {
      if (r === row) return c;
      if (r.kind !== "anim") continue;
      c = cameraAfter(r, c, init) ?? c;
    }
  }
  return c;
}
function cameraAfter(r, c, init) {
  const p = r.params ?? {};
  if (r.anim === "CamMove") {
    if (p.mode === "elem") { const e = startCenter(p.elem); return e ? { ...c, x: e[0], y: e[1] } : c; }
    return { ...c, x: Number(p.x) || 0, y: Number(p.y) || 0 };
  }
  if (r.anim === "CamZoom") return { ...c, w: c.w / Math.max(1e-3, Number(p.zoom) || 1) };
  if (r.anim === "CamRestore") return { ...init };
  return null;
}

let ghostCtx = null;
function updateGhosts(box, st) {
  ghostCtx = { box, st };
  const list = [];
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || row.anim !== "Move" || !idsOf(row.target).length) return;
    const from = posBefore(st, row), now = startCenter(row.target);
    if (!from || !now) return;
    const p = row.params ?? {};
    const dest = p.mode === "to" ? [Number(p.x) || 0, Number(p.y) || 0] : [from[0] + (Number(p.x) || 0), from[1] + (Number(p.y) || 0)];
    // 影は、キャンバスの今の形を、移動先へずらして描く（ずらす量は、キャンバスの px）
    const [fx, fy] = fromManim(...dest), [nx, ny] = fromManim(...now), [bx, by] = fromManim(...from);
    list.push({
      ids: idsOf(row.target), dx: fx - nx, dy: fy - ny, fromDx: bx - nx, fromDy: by - ny, label: `${k + 1}. ${varOf(row.target)} の移動先`,
      onDrag: (dx, dy, done) => {
        const [mx, my] = toManim(nx + dx, ny + dy);
        if (p.mode === "to") [p.x, p.y] = [r2(mx), r2(my)];
        else [p.x, p.y] = [r2(mx - from[0]), r2(my - from[1])];
        row.params = p;
        const li = box.querySelector(`.arow[data-row="${row.id}"]`);
        if (li) { li.querySelector("[data-p=x]").value = p.x; li.querySelector("[data-p=y]").value = p.y; }
        if (done) { markDirty("steps"); updateCode(box, st); }
      },
    });
  });
  // 回転の中心（決めた点）: 点の印をドラッグして決める
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || row.anim !== "Rotate" || row.params?.about !== "point") return;
    const p = row.params;
    const [bx, by] = fromManim(Number(p.ax) || 0, Number(p.ay) || 0);
    list.push({
      kind: "point", bx, by, dx: 0, dy: 0, label: `${k + 1}. 回転の中心`,
      onDrag: (dx, dy, done) => {
        [p.ax, p.ay] = toManim(bx + dx, by + dy).map(r2);
        const li = box.querySelector(`.arow[data-row="${row.id}"]`);
        if (li) { li.querySelector("[data-p=ax]").value = p.ax; li.querySelector("[data-p=ay]").value = p.ay; }
        if (done) { markDirty("steps"); updateCode(box, st); updateGhosts(box, st); }
      },
    });
  });
  // ズームの拡大する所の移動: 動く前の枠（点線）と、移動先の枠
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || row.anim !== "ZoomMove") return;
    const z = findElement(row.target);
    if (!z) return;
    const before = zoomBefore(st, row, z);
    const p = row.params ?? {};
    const [bx, by] = fromManim(Number(p.x) || 0, Number(p.y) || 0);
    const [fx, fy] = fromManim(...before.c);
    list.push({
      kind: "rect", bx, by, dx: 0, dy: 0, w: before.w, h: before.h, fromX: fx, fromY: fy, fromW: before.w, fromH: before.h,
      color: z.stroke?.color || "#FFC300", label: `${k + 1}. 拡大する所の移動先`,
      onDrag: (dx, dy, done) => {
        [p.x, p.y] = toManim(bx + dx, by + dy).map(r2);
        row.params = p;
        const li = box.querySelector(`.arow[data-row="${row.id}"]`);
        if (li) { li.querySelector("[data-p=x]").value = p.x; li.querySelector("[data-p=y]").value = p.y; }
        if (done) { markDirty("steps"); updateCode(box, st); updateGhosts(box, st); }
      },
    });
  });
  // 線に沿って動く: 動く道筋（点線と矢印）
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || row.anim !== "MoveAlongPath" || !idsOf(row.target).length) return;
    const P = pathPts(row.params?.path);
    const from = posBefore(st, row);
    if (!P || !from) return;
    const off = row.params?.how === "on" ? [0, 0] : [from[0] - P[0][0], from[1] - P[0][1]];
    list.push({ kind: "poly", pts: P.map((q) => fromManim(q[0] + off[0], q[1] + off[1])), label: `${k + 1}. ${varOf(row.target)} の道筋` });
  });
  // 回転: 回る道筋の弧（決めた点のまわりなら、要素の中心が通る弧。要素の中心のまわりなら、小さい弧）
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || row.anim !== "Rotate" || !idsOf(row.target).length) return;
    const p = row.params ?? {}, from = posBefore(st, row);
    if (!from) return;
    const [fx, fy] = fromManim(...from);
    const ang = Number(p.angle) || 0;
    if (p.about === "point") {
      const [px, py] = fromManim(Number(p.ax) || 0, Number(p.ay) || 0);
      const r = Math.hypot(fx - px, fy - py);
      if (r > 2) list.push({ kind: "arc", cx: px, cy: py, r, a0: Math.atan2(py - fy, fx - px) * 180 / Math.PI, sweep: ang, label: `${k + 1}. 回転` });
    } else {
      list.push({ kind: "arc", cx: fx, cy: fy, r: 40, a0: 90, sweep: Math.max(-350, Math.min(350, ang)), label: `${k + 1}. 回転 ${ang}°` });
    }
  });
  // カメラ: 動いたあとの映す枠（決めた点へ動かすときは、ドラッグで決める）
  (st?.rows ?? []).forEach((row, k) => {
    if (row.kind !== "anim" || !["CamMove", "CamZoom", "CamRestore"].includes(row.anim)) return;
    const cam0 = currentSlide().camera;
    const init = cam0 ? { x: cam0.x, y: cam0.y, w: cam0.width } : { x: 0, y: 0, w: 8 * store.meta.canvas.w / store.meta.canvas.h };
    const before = cameraBefore(row), after = cameraAfter(row, before, init);
    const Pp = P(), [bx, by] = fromManim(after.x, after.y), [fx, fy] = fromManim(before.x, before.y);
    const p = row.params ?? {};
    const drag = row.anim === "CamMove" && p.mode !== "elem";
    list.push({
      kind: "rect", bx, by, dx: 0, dy: 0, w: after.w * Pp, h: after.w * Pp * 9 / 16, fromX: fx, fromY: fy, fromW: before.w * Pp, fromH: before.w * Pp * 9 / 16,
      color: "#e0730b", label: `${k + 1}. カメラ（動いたあと）`,
      onDrag: drag ? (dx, dy, done) => {
        [p.x, p.y] = toManim(bx + dx, by + dy).map(r2);
        row.params = p;
        const li = box.querySelector(`.arow[data-row="${row.id}"]`);
        if (li) { li.querySelector("[data-p=x]").value = p.x; li.querySelector("[data-p=y]").value = p.y; }
        if (done) { markDirty("steps"); updateCode(box, st); updateGhosts(box, st); }
      } : null,
    });
  });
  setGhosts(list);
}

/** 行 row の直前の、ズームの拡大する所の中心（Manim の座標）と大きさ（キャンバスの px）。前の「動かす」「拡大率」をたどる。 */
function zoomBefore(st, row, z) {
  let c = toManim(z.frameX, z.frameY), w = Number(z.width) * z.factor, h = Number(z.height) * z.factor;
  for (const s of currentSlide().steps) {
    if (s.mode !== "gui") continue;
    for (const r of s.rows ?? []) {
      if (r === row) return { c, w, h };
      if (r.kind !== "anim" || r.target !== z.id) continue;
      if (r.anim === "ZoomMove") c = [Number(r.params?.x) || 0, Number(r.params?.y) || 0];
      if (r.anim === "ZoomScale") { const f = Number(r.params?.factor) || 1; w *= f; h *= f; }
    }
  }
  return { c, w, h };
}

// ---------------------------------------------------------------- 写す・貼り付け（動きの行・ステップ）

let animClip = null; // {kind: "rows" | "steps", rows?: [...], steps?: [...]}
try { animClip = JSON.parse(localStorage.getItem("animClip") || "null"); } catch { animClip = null; }

function setClip(c, msg) {
  animClip = c;
  try { localStorage.setItem("animClip", JSON.stringify(c)); } catch { /* 覚えられなくてもよい */ }
  toast(`${msg}「貼り付け」で足せます。`, "", 2500);
  renderAnimEditor();
}

/** 貼り付けのボタン。gui: 今のステップが GUI のステップか（行を足せるか）。 */
function pasteButtons(gui) {
  if (!animClip) return "";
  const n = animClip.kind === "rows" ? `行 ${animClip.rows.length} 個` : `ステップ ${animClip.steps.length} 個`;
  const tgt = selectedTarget();
  const canRows = animClip.kind === "rows" ? gui : true;
  if (!canRows) return "";
  return `<span class="paste-group"><button type="button" class="small" data-a="paste" title="写した${n}を貼り付ける${animClip.kind === "rows" ? "（このステップの最後に足す）" : "（このステップのあとに足す）"}">貼り付け（${n}）</button>${tgt
    ? `<button type="button" class="small" data-a="paste-to" title="写した動きの対象を、選んでいる「${escapeHtml(varOf(tgt) ?? "")}」に替えて貼り付ける">「${escapeHtml(varOf(tgt) ?? "")}」に替えて貼り付け</button>` : ""}</span>`;
}

/** 選んでいる要素・グループ（1 つ）。 */
function selectedTarget() {
  const id = store.selectedId;
  return id && targets().some((t) => t.id === id) ? id : null;
}

/** 写した行を、新しい id で作り直す（retarget: 対象を替える要素）。いちばん多く出てくる対象を、選んだ要素に替える。 */
function cloneRows(rows, retarget) {
  const out = JSON.parse(JSON.stringify(rows));
  let main = null;
  if (retarget) {
    const count = new Map();
    for (const r of out) if (r.kind === "anim" && kindOf(r.anim) === "element" && r.target) count.set(r.target, (count.get(r.target) ?? 0) + 1);
    main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  for (const r of out) {
    r.id = uid("r");
    if (retarget && main && r.kind === "anim" && r.target === main) { r.target = retarget; delete r.part; }
  }
  return out;
}

function bindPaste(box, st, slide) {
  const run = (retarget) => {
    if (!animClip) return;
    let added = [];
    if (animClip.kind === "rows" && st?.mode === "gui") {
      added = cloneRows(animClip.rows, retarget);
      st.rows.push(...added);
    } else if (animClip.kind === "steps") {
      const at = st ? slide.steps.indexOf(st) + 1 : slide.steps.length;
      const add = animClip.steps.map((s0) => {
        const s1 = JSON.parse(JSON.stringify(s0));
        s1.id = uid("t");
        if (s1.mode === "gui") s1.rows = cloneRows(s1.rows ?? [], retarget);
        else if (retarget) {
          // コードのステップ: コードの中の元の変数名も、替えた要素の変数名にする
          const ov = s1._gvar, nv = varOf(retarget);
          if (ov && nv && ov !== nv) s1.code = (s1.code || "").replace(new RegExp(`(?<![A-Za-z0-9_.])${ov}(?![A-Za-z0-9_])`, "g"), nv);
          s1.elementId = retarget;
        }
        delete s1._gvar;
        s1.elementId = s1.mode === "gui" ? (s1.rows.find((r) => r.kind === "anim")?.target ?? null) : s1.elementId;
        return s1;
      });
      slide.steps.splice(at, 0, ...add);
      added = add.flatMap((x) => x.rows ?? []);
      store.focusStepId = add[0].id;
    } else return;
    const here = new Set(targets().map((t) => t.id).concat(targets(slide, "value").map((t) => t.id), ["camera"],
      slide.elements.map((e) => e.id)));
    for (const r of added) if (r.kind === "anim") ensureHiddenForIntro(r);
    if (added.some((r) => r.kind === "anim" && r.target && !here.has(r.target))) {
      toast("このスライドに無い要素を対象にした行があります。行の対象を選び直してください。", "warn", 6000);
    }
    markDirty("paste");
    emit("steps-changed");
    if (store.focusStepId) emit("focus-step", store.focusStepId);
  };
  box.querySelector("[data-a=paste]")?.addEventListener("click", () => run(null));
  box.querySelector("[data-a=paste-to]")?.addEventListener("click", () => run(selectedTarget()));
}

/** ステップ st の動きを、前のステップ（同じクリック）の後ろへ移す。最初の行の始まりを how（with・after・lag）にする。 */
function mergeIntoPrevious(st, how) {
  const slide = currentSlide();
  const i = slide.steps.indexOf(st);
  const prev = slide.steps[i - 1];
  if (i < 1 || prev?.mode !== "gui") return;
  const rows = st.rows ?? [];
  if (rows[0]) { rows[0].start = how; rows[0].lag ??= 0.5; }
  prev.rows.push(...rows);
  slide.steps.splice(i, 1);
  store.focusStepId = prev.id;
  markDirty("steps");
  emit("steps-changed");
  emit("focus-step", prev.id);
  toast(`ステップ ${i + 1} の動きを、ステップ ${i}（同じクリック）にまとめました。`);
}

function updateCode(box, st) {
  clearTimeout(codeTimer);
  codeTimer = setTimeout(async () => {
    const pre = box.querySelector("pre[data-k=code]");
    if (!pre || !document.body.contains(pre)) return;
    try {
      const groupOf = Object.fromEntries((currentSlide()?.elements ?? []).filter((e) => e.groupId).map((e) => [e.id, e.groupId]));
      const r = await api.post("/api/anim/code", { step: st, vars: allVars(), groupOf });
      pre.textContent = r.code || "（動きがありません）";
      // 同じ時間に同じ要素を動かす行を示す（Manim では一緒に動かせない）
      box.querySelectorAll(".arow .clash:not(.bnote)").forEach((n) => n.remove());
      box.querySelectorAll(".arow.warn").forEach((n) => n.classList.remove("warn"));
      for (const [, b] of r.clash ?? []) {
        const li = box.querySelector(`.arow[data-row="${b}"]`);
        if (!li || li.classList.contains("warn")) continue;
        li.classList.add("warn");
        li.insertAdjacentHTML("beforeend", `<div class="clash">⚠ 前の行と同じ時間に、同じ要素を出す・消す動きです。出す・消す動きは同じ要素に同時に 2 つ使えないので、始まりを「前の後に」にしてください（強調は、出す・消す動きと同時にできます）。</div>`);
      }
    } catch (e) { pre.textContent = e.message; }
  }, 200);
}

/** ステップの短い説明（一覧のチップ用）。 */
export function stepSummary(st) {
  if (st.mode !== "gui") return null;
  const anims = (st.rows ?? []).filter((r) => r.kind === "anim");
  if (!anims.length) return (st.rows ?? []).length ? "コード・待つ" : "（空）";
  const first = anims[0];
  const lab = animSpec(first.anim)?.label ?? first.anim;
  return `${varOf(first.target) ?? "?"} ${lab}${anims.length > 1 ? ` ほか ${anims.length - 1}` : ""}`;
}

/** 「＋ステップ」: 選んでいる要素があれば、その要素の動き（最初から出さない要素なら出す動き）から始める。 */
async function addStepButton() {
  const slide = currentSlide();
  if (!slide) return;
  await loadCatalog();
  const id = store.selectedIds.length === 1 ? store.selectedIds[0] : null;
  if (id && targets().some((t) => t.id === id)) {
    const el = findElement(id);
    const intro = el && el.visibleAtStart === false && !slide.steps.some((s) => (s.rows ?? []).some((r) => r.target === id && groupOf(r.anim) === "in"));
    return addAnimStep(id, intro ? "in" : "emph");
  }
  const st = { id: uid("t"), elementId: null, mode: "gui", rows: [], code: "" };
  slide.steps.push(st);
  store.focusStepId = st.id;
  markDirty("steps");
  emit("steps-changed");
  emit("focus-step", st.id);
}

export function setupAnimPane() {
  loadCatalog().catch(() => {});
  document.getElementById("add-step")?.addEventListener("click", addStepButton);
  const fold = document.getElementById("anim-fold");
  const setFold = (v) => {
    document.getElementById("anim-editor").hidden = v;
    fold.textContent = v ? "編集欄を出す" : "編集欄を隠す";
    try { localStorage.setItem("animFold", v ? "1" : ""); } catch { /* 保存できなくてもよい */ }
  };
  let folded = false;
  try { folded = localStorage.getItem("animFold") === "1"; } catch { /* なし */ }
  setFold(folded);
  fold.addEventListener("click", () => { folded = !folded; setFold(folded); });
  on("focus-step", () => { if (folded) { folded = false; setFold(false); } });
  on("step-code-input", ({ id, value, src }) => { if (src !== "pane" && editorRef?.stepId === id && editorRef.ed.value !== value) editorRef.ed.value = value; });
  on("steps-changed", () => renderAnimEditor());
  on("focus-step", () => renderAnimEditor());
  on("project-loaded", () => renderAnimEditor());
  on("render-error", () => renderAnimEditor());
  // 要素を動かした・作り直したら、移動先の影も描き直す（「ずらす」の影は、動かした要素と一緒に動く）
  const reGhost = () => {
    const st = currentSlide()?.steps.find((x) => x.id === store.focusStepId);
    if (ghostCtx && st && st === ghostCtx.st && st.mode === "gui" && document.body.contains(ghostCtx.box)) updateGhosts(ghostCtx.box, st);
  };
  for (const ev of ["element-moved", "canvas-rendered", "element-rendered", "slide-changed"]) on(ev, () => setTimeout(reGhost, 0));
}
