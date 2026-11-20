// スライドマスター: 全スライドに共通で出す要素（ロゴ・帯・フッターの文字など）と、題名の型・背景色・ページ番号と章の表示。
// ・マスターは project.masters = [{id, name, elements, groups, background, pageNumbers, sections}]。スライドは slide.master で選ぶ
// ・マスターの編集中（store.masterId）は、キャンバス・レイヤー・要素のパネルがマスターを相手にする（currentSlide() がマスターを返す）
// ・スライドでは、マスターの要素を薄く後ろに出す（選べない）。書き出しは app/masters.py がスライドに入れる
// ・マスターの「題名」の図形は描かずに、そのマスターのスライドの題名の型（位置・大きさ・色・寄せ方・下線）にする

import { renderThumbnail, showSlide } from "./canvas.js";
import { currentSlide, emit, escapeHtml, findMaster, markDirty, masterOf, on, pagePlan, sectionPlan, store, toast, uid } from "./store.js";

const $ = (id) => document.getElementById(id);
export const TOKENS = [["{プロジェクト名}", "プロジェクト名"], ["{日付}", "日付"], ["{章}", "章の名前"], ["{ページ}", "ページ番号"], ["{総ページ}", "全体のページ数"]];
const TITLE_KEYS = ["x", "y", "fontSize", "color", "align", "underline", "matchWidth", "edge"];
const isTitle = (e) => e?.type === "shape" && e.shape === "title";
const thumbs = new Map();

export const masters = () => (store.project.masters ??= []);

// ---------------------------------------------------------------- スライドへの反映（キャンバスの表示・題名の型）

const isSlide = (s) => (store.project?.slides ?? []).includes(s);

/** スライド（またはマスター）の背景色（マスターに背景色があれば、それ）。 */
export function backgroundOf(slide) {
  const m = isSlide(slide) ? masterOf(slide) : slide;
  return m?.background || store.project.settings.background;
}

function tokenValues(slide) {
  const i = store.project.slides.indexOf(slide);
  const pg = pagePlan()[i];
  const sec = sectionPlan()[i];
  const d = new Date();
  return { "{プロジェクト名}": store.project.settings.name ?? "", "{日付}": `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    "{章}": sec?.name ?? "", "{ページ}": String(pg?.number ?? ""), "{総ページ}": String(pg?.total ?? "") };
}

/** 文字の中の {ページ} などを、そのスライドの値にする（app/masters.py の fill_tokens と同じ）。 */
export function fillTokens(e, values) {
  const sub = (t) => (typeof t === "string" ? t.replace(/\{(プロジェクト名|日付|章|ページ|総ページ)\}/g, (m) => values[m] ?? m) : t);
  if (e.type === "text") { for (const r of e.runs ?? []) r.t = sub(r.t); e.text = (e.runs ?? []).map((r) => r.t).join(""); }
  else if (e.type === "math" || (e.type === "shape" && ["tex", "title"].includes(e.shape))) e.latex = sub(e.latex);
  else if (e.type === "shape" && e.shape === "bullets") e.items = (e.items ?? []).map(sub);
  return e;
}

/** スライドに出すマスターの要素（写し。id は "M:…"、文字は差し込み済み）。題名の型は出さない。 */
export function masterElementsFor(slide) {
  if (!isSlide(slide)) return [];
  const m = masterOf(slide);
  if (!m) return [];
  const vals = tokenValues(slide);
  return m.elements.filter((e) => !isTitle(e) && !e.hidden).map((e) => fillTokens({ ...structuredClone(e), id: `M:${m.id}:${e.id}`, groupId: null }, vals));
}

export function titleTemplate(m) {
  const t = m?.elements.find(isTitle);
  return t ? Object.fromEntries(TITLE_KEYS.filter((k) => k in t).map((k) => [k, structuredClone(t[k])])) : null;
}

/** そのマスターのスライドの題名を、マスターの題名の型にそろえる。変えたら true。 */
export function syncTitles(m, slides = store.project.slides.filter((s) => s.master === m?.id)) {
  const tpl = m ? titleTemplate(m) : null;
  if (!tpl) return false;
  let changed = false;
  for (const s of slides) {
    for (const e of s.elements) {
      if (!isTitle(e)) continue;
      const edge = (tpl.align === "left" || tpl.align === "right") && !(tpl.underline && !tpl.matchWidth) && tpl.edge != null;
      for (const [k, v] of Object.entries(tpl)) {
        if (k === "edge") continue;
        if (k === "x" && edge) continue; // 左・右寄せは、マスターの題名の端に文字の端をそろえる（キャンバスの snapTitle が幅から求める）
        if (JSON.stringify(e[k]) !== JSON.stringify(v)) { e[k] = structuredClone(v); changed = true; }
      }
    }
  }
  return changed;
}

// ---------------------------------------------------------------- マスターの編集

export async function enterMaster(id) {
  if (!findMaster(id)) return;
  store.masterId = id;
  store.selectedId = null;
  store.selectedIds = [];
  store.enteredGroup = null;
  store.focusStepId = null;
  document.body.classList.add("master-mode");
  drawPane();
  emit("master-mode", true);
  emit("selection", null);
  await showSlide();
}

export async function exitMaster() {
  if (!store.masterId) return;
  const m = findMaster(store.masterId);
  store.masterId = null;
  store.selectedId = null;
  store.selectedIds = [];
  document.body.classList.remove("master-mode");
  if (m && syncTitles(m)) markDirty("master-title");
  drawPane();
  emit("master-mode", false);
  emit("slides-changed");
  emit("selection", null);
  await showSlide();
  emit("refresh-thumbs");
}

function newMaster(from = null) {
  const m = from ? { ...structuredClone(from), id: uid("m"), name: `${from.name} の写し` }
    : { id: uid("m"), name: `マスター ${masters().length + 1}`, elements: [], groups: [], steps: [], values: [], background: "", pageNumbers: "inherit", sections: "inherit" };
  if (from) { // 要素の id・変数名は付け直す（ほかのマスターと重ならないように）
    const idMap = new Map();
    for (const e of m.elements) { const nid = uid("e"); idMap.set(e.id, nid); e.id = nid; }
    for (const g of m.groups ?? []) { const nid = uid("g"); idMap.set(g.id, nid); g.id = nid; }
    for (const e of m.elements) {
      if (e.groupId) e.groupId = idMap.get(e.groupId) ?? null;
      for (const k of ["axesId", "targetId"]) if (e[k]) e[k] = idMap.get(e[k]) ?? e[k];
      if (e.contentIds) e.contentIds = e.contentIds.map((x) => idMap.get(x) ?? x);
    }
    uniqueVars(m);
  }
  masters().push(m);
  markDirty("master");
  return m;
}

/** マスターの要素の変数名を、プロジェクトの中で重ならない名前にする（写したとき）。 */
function uniqueVars(m) {
  const used = new Set([...store.project.slides.flatMap((s) => [...s.elements, ...(s.groups ?? [])].map((e) => e.var)),
    ...masters().filter((x) => x !== m).flatMap((x) => [...x.elements, ...(x.groups ?? [])].map((e) => e.var))]);
  for (const e of [...m.elements, ...(m.groups ?? [])]) {
    let v = e.var, k = 2;
    while (used.has(v)) v = `${e.var}_${k++}`;
    e.var = v;
    used.add(v);
  }
}

function deleteMaster(id) {
  const m = findMaster(id);
  if (!m) return;
  const n = store.project.slides.filter((s) => s.master === id).length;
  if (!confirm(`マスター「${m.name}」を削除しますか？${n ? `（使っている ${n} 枚のスライドは「マスターなし」になります）` : ""}`)) return;
  store.project.masters = masters().filter((x) => x.id !== id);
  for (const s of store.project.slides) if (s.master === id) s.master = "";
  if (store.project.settings.defaultMaster === id) store.project.settings.defaultMaster = "";
  markDirty("master");
  if (store.masterId === id) {
    if (masters().length) enterMaster(masters()[0].id);
    else exitMaster();
  } else drawPane();
}

// ---------------------------------------------------------------- 左の一覧（マスターの編集中）

async function paneThumb(m) {
  const key = JSON.stringify(m) + store.project.settings.background;
  if (thumbs.get(m.id)?.key === key) return thumbs.get(m.id).url;
  const url = await renderThumbnail(m);
  thumbs.set(m.id, { key, url });
  return url;
}

export function drawPane() {
  const pane = $("master-pane");
  const on = !!store.masterId && !!store.project;
  pane.hidden = !on;
  $("slide-list").hidden = on;
  if (!on) return;
  const def = store.project.settings.defaultMaster;
  const uses = (id) => store.project.slides.filter((s) => s.master === id).length;
  pane.innerHTML = `<div class="mp-banner"><b>マスターの編集中</b><button type="button" class="small primary" data-a="exit">スライドに戻る</button></div>
    <ol class="mp-list">${masters().map((m) => `<li data-mid="${m.id}" class="${m.id === store.masterId ? "active" : ""}">
      <span class="thumb" data-thumb="${m.id}" style="background-color:${escapeHtml(m.background || store.project.settings.background)}"></span>
      <span class="mp-name">${escapeHtml(m.name)}${m.id === def ? ` <span class="mp-def">既定</span>` : ""}</span>
      <span class="mp-uses">${uses(m.id)} 枚</span></li>`).join("")}</ol>
    <div class="mp-actions"><button type="button" class="small" data-a="new">＋ 新しいマスター</button>
      <button type="button" class="small" data-a="copy">写す</button>
      <button type="button" class="small danger" data-a="del">削除</button></div>`;
  for (const m of masters()) {
    paneThumb(m).then((url) => { const t = pane.querySelector(`[data-thumb="${m.id}"]`); if (t) t.style.backgroundImage = `url("${url}")`; }).catch(() => {});
  }
}

function setupPane() {
  const pane = $("master-pane");
  pane.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-mid]");
    if (li) { if (li.dataset.mid !== store.masterId) enterMaster(li.dataset.mid); return; }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "exit") exitMaster();
    else if (a === "new") enterMaster(newMaster().id);
    else if (a === "copy") { const cur = findMaster(store.masterId); if (cur) enterMaster(newMaster(cur).id); }
    else if (a === "del") deleteMaster(store.masterId);
  });
}

/** ツールバーの「マスター」: 今のスライドのマスター（無ければ最初のマスター・無ければ新しいマスター）を編集する。 */
export function openMasters() {
  if (store.masterId) { exitMaster(); return; }
  const m = masterOf(currentSlide()) ?? masters()[0] ?? newMaster();
  enterMaster(m.id);
}

// ---------------------------------------------------------------- 右のパネル

/** マスターの編集中で、要素を選んでいないときのパネル。 */
export function renderMasterInfo(panel, titleEl) {
  const m = findMaster(store.masterId);
  if (!m) return;
  titleEl.textContent = `マスター「${m.name}」`;
  const n = store.project.slides.filter((s) => s.master === m.id).length;
  const tpl = titleTemplate(m);
  const isDef = store.project.settings.defaultMaster === m.id;
  panel.innerHTML = `
    <h3>マスター</h3>
    <label class="row"><span class="unit">名前</span><input type="text" data-k="name" value="${escapeHtml(m.name)}" maxlength="40" style="flex:1"></label>
    <p class="hint">このマスターを使うスライド: ${n} 枚（スライドのパネルの「マスター」で選びます）。</p>
    <label class="row"><input type="checkbox" data-k="def" ${isDef ? "checked" : ""}> 新しいスライドの既定にする</label>
    <h3>背景色</h3>
    <div class="row"><label class="row"><input type="checkbox" data-k="bgon" ${m.background ? "checked" : ""}> このマスターの背景色</label>
      <input type="color" data-k="bg" value="${escapeHtml((m.background || store.project.settings.background).toLowerCase())}" ${m.background ? "" : "disabled"}></div>
    <p class="hint">オフのときは、プロジェクトの背景色です。</p>
    <h3>ページ番号・章の表示</h3>
    <div class="row"><span class="unit">ページ番号</span><select data-k="pn" style="flex:1">
      <option value="inherit" ${m.pageNumbers === "inherit" ? "selected" : ""}>プロジェクトの設定に従う</option>
      <option value="on" ${m.pageNumbers === "on" ? "selected" : ""}>出す</option>
      <option value="off" ${m.pageNumbers === "off" ? "selected" : ""}>出さない</option></select></div>
    <label class="row"><input type="checkbox" data-k="secoff" ${m.sections === "off" ? "checked" : ""}> 章の名前・進み具合のバーを出さない</label>
    <p class="hint">スライドのパネルで、スライドごとに決めたものが優先です。</p>
    <h3>題名の型</h3>
    <p class="hint">${tpl ? "このマスターの「題名」の図形の位置・大きさ・色・寄せ方・下線に、このマスターのスライドの題名をそろえます（マスターの題名そのものは、スライドには描きません）。"
      : "「＋図形 ▾」の「題名」をこのマスターに置くと、その位置・大きさ・色などが、このマスターのスライドの題名の型になります。"}</p>
    <h3>自動で入る文字</h3>
    <p class="hint">マスターのテキスト・数式に次の文字を書くと、スライドごとの値になります（ページ番号はページ番号の設定の番号）。押すと、選んでいる位置に入れられるよう写します。</p>
    <div class="mp-tokens">${TOKENS.map(([t, l]) => `<button type="button" class="small" data-tok="${t}" title="${l}">${t}</button>`).join("")}</div>
    <h3>使い方</h3>
    <p class="hint">ここに置いた要素は、このマスターのスライドのいちばん奥に出ます（スライドでは選べず、動きも付けられません）。編集が終わったら、左上の「スライドに戻る」を押します。
      「発表で再生」の動画・音声は、マスターには置けません。</p>`;
  const q = (k) => panel.querySelector(`[data-k="${k}"]`);
  const done = (redraw = false) => { markDirty("master"); drawPane(); if (redraw) showSlide(); };
  q("name").addEventListener("change", (e) => { m.name = e.target.value.trim() || m.name; titleEl.textContent = `マスター「${m.name}」`; done(); });
  q("def").addEventListener("change", (e) => { store.project.settings.defaultMaster = e.target.checked ? m.id : ""; done(); });
  q("bgon").addEventListener("change", (e) => { m.background = e.target.checked ? q("bg").value.toUpperCase() : ""; q("bg").disabled = !e.target.checked; done(true); });
  q("bg").addEventListener("input", (e) => { m.background = e.target.value.toUpperCase(); done(true); });
  q("pn").addEventListener("change", (e) => { m.pageNumbers = e.target.value; done(); emit("page-numbers-changed"); });
  q("secoff").addEventListener("change", (e) => { m.sections = e.target.checked ? "off" : "inherit"; done(); });
  panel.querySelectorAll("[data-tok]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.tok); toast(`「${b.dataset.tok}」を写しました。テキストに貼り付けてください。`); }
    catch { toast(`「${b.dataset.tok}」をテキストに書いてください。`); }
  }));
}

/** スライドのパネルの「マスター」の欄。 */
export function masterSection(box, slide) {
  const list = masters();
  const draw = () => {
    box.innerHTML = `<div class="row"><select data-k="m" style="flex:1"><option value="">マスターなし</option>
      ${list.map((m) => `<option value="${m.id}" ${slide.master === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select>
      <button type="button" class="small" data-k="edit">${list.length ? "マスターの編集" : "マスターを作る"}</button></div>
      <p class="hint">マスターの要素（ロゴ・帯・自動で入る文字など）は、スライドのいちばん奥に出ます。題名は、マスターの題名の型にそろえます。</p>`;
    box.querySelector("[data-k=m]").addEventListener("change", (e) => {
      slide.master = e.target.value;
      syncTitles(findMaster(slide.master), [slide]);
      markDirty("slide-master");
      emit("page-numbers-changed");
      showSlide();
    });
    box.querySelector("[data-k=edit]").addEventListener("click", () => {
      const m = findMaster(slide.master) ?? list[0] ?? newMaster();
      enterMaster(m.id);
    });
  };
  draw();
}

export function setupMasters() {
  setupPane();
  on("load-project", () => { store.masterId = null; document.body.classList.remove("master-mode"); thumbs.clear(); });
  on("project-loaded", drawPane);
  // マスターの要素を変えたら、左の一覧のサムネイルを描き直す
  let t = null;
  on("dirty", () => { if (!store.masterId) return; clearTimeout(t); t = setTimeout(drawPane, 600); });
}
