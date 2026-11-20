// 動きのプリセット: 選んだ要素に、よく使う動き（組み込み・自分で保存したもの）を当てる。
// プリセットの形: {id, name, steps: [[行, …], …]}（steps の 1 つが 1 クリック）。行の anim が "@in" なら、
// 要素に合った出し方（文字・数式は書く、図形は線を描く、画像はフェードイン）にする。

import { api } from "./api.js";
import { animSpec, ensureHiddenForIntro, loadCatalog, newRow } from "./animpane.js";
import { elementBounds } from "./canvas.js";
import { currentSlide, emit, escapeHtml, findElement, findGroup, groupMembers, markDirty, store, toast, uid } from "./store.js";

const $ = (id) => document.getElementById(id);

const BUILTIN = [
  ["出す", [
    { id: "b-in", name: "出す（要素に合った出し方）", steps: [[{ anim: "@in" }]] },
    { id: "b-fade", name: "フェードで出す", steps: [[{ anim: "FadeIn" }]] },
    { id: "b-left", name: "左から滑り込む", steps: [[{ anim: "FadeIn", params: { dir: "RIGHT", dist: 1.5 } }]] },
    { id: "b-right", name: "右から滑り込む", steps: [[{ anim: "FadeIn", params: { dir: "LEFT", dist: 1.5 } }]] },
    { id: "b-up", name: "下から浮き上がる", steps: [[{ anim: "FadeIn", params: { dir: "UP", dist: 0.8 } }]] },
    { id: "b-down", name: "上から降りてくる", steps: [[{ anim: "FadeIn", params: { dir: "DOWN", dist: 0.8 } }]] },
    { id: "b-grow", name: "中心から大きくなる", steps: [[{ anim: "Grow" }]] },
    { id: "b-pop", name: "小さくから浮かび上がる", steps: [[{ anim: "FadeIn", params: { scale: 0.4 }, rate: "rush_from" }]] },
    { id: "b-type", name: "1 文字ずつ打つ（文字）", steps: [[{ anim: "TypeIn" }]] },
  ]],
  ["強調", [
    { id: "b-ind", name: "大きく光る", steps: [[{ anim: "Indicate" }]] },
    { id: "b-circ", name: "囲む", steps: [[{ anim: "Circumscribe" }]] },
    { id: "b-wig", name: "揺らす", steps: [[{ anim: "Wiggle" }]] },
    { id: "b-flash", name: "光を放つ", steps: [[{ anim: "Flash" }]] },
  ]],
  ["消す", [
    { id: "b-out", name: "フェードで消す", steps: [[{ anim: "FadeOut" }]] },
    { id: "b-outdown", name: "下へ消える", steps: [[{ anim: "FadeOut", params: { dir: "DOWN", dist: 0.8 } }]] },
    { id: "b-shrink", name: "縮んで消える", steps: [[{ anim: "ShrinkToCenter" }]] },
  ]],
  ["組み合わせ", [
    { id: "b-in-ind", name: "出して強調", steps: [[{ anim: "@in" }, { anim: "Indicate" }]] },
    { id: "b-in-circ", name: "出して囲む", steps: [[{ anim: "@in" }, { anim: "Circumscribe" }]] },
    { id: "b-in-out", name: "出して、次のクリックで消す", steps: [[{ anim: "@in" }], [{ anim: "FadeOut" }]] },
  ]],
];

let mine = null; // 自分で保存したプリセット
let mode = "each";
let gap = 0.3;

const MODES = [["each", "1 クリックずつ（上から）"], ["each-x", "1 クリックずつ（左から）"], ["stagger", "同じクリックで少しずつずらす"], ["together", "同じクリックで同時に"]];

/** 当てる単位（グループはまとめて 1 つ）。並びは mode で上から・左から。 */
function units(order) {
  const out = [];
  const seen = new Set();
  for (const id of store.selectedIds) {
    if (seen.has(id)) continue;
    const el = findElement(id);
    if (!el || el.type === "media" || (el.type === "shape" && el.shape === "zoom")) continue;
    const g = el.groupId && el.groupId !== store.enteredGroup ? findGroup(el.groupId) : null;
    const ids = g ? groupMembers(g.id).map((e) => e.id) : [id];
    ids.forEach((x) => seen.add(x));
    const b = elementBounds(ids) ?? { x0: 0, y0: 0 };
    out.push({ id: g ? g.id : id, x: b.x0, y: b.y0, els: g ? groupMembers(g.id) : [el] });
  }
  const byX = order === "each-x";
  return out.sort((a, b) => (byX ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
}

function autoIn(u) {
  const el = u.els.length === 1 ? u.els[0] : null;
  if (u.els.some((e) => e.type === "image")) return "FadeIn";
  if (el?.shape === "statchart") return "LaggedIn";
  if (el && (["text", "math"].includes(el.type) || ["tex", "title", "bullets", "theorem"].includes(el.shape))) return "Write";
  return "Create";
}

/** プリセットの行 → この要素の行（使えない動きは、似た動きに替えるか、外す）。 */
function rowFor(r, u) {
  let anim = r.anim === "@in" ? autoIn(u) : r.anim;
  let spec = animSpec(anim);
  if (!spec && r.kind !== "wait") return null;
  if (r.kind === "wait") return { id: uid("r"), kind: "wait", start: r.start ?? "after", lag: r.lag ?? 0.5, runTime: r.runTime ?? 1 };
  const shapes = u.els.map((e) => e.shape);
  if (spec.only && !(u.els.length === 1 && spec.only.includes(shapes[0]))) return null;
  const isText = u.els.length === 1 && (["text"].includes(u.els[0].type) || ["tex", "title", "bullets", "code"].includes(u.els[0].shape));
  if ((anim === "TypeIn" || anim === "TypeOut" || anim === "WordByWord") && !isText) anim = anim === "TypeOut" ? "FadeOut" : "FadeIn";
  if (spec.vecOnly && u.els.some((e) => e.type === "image")) anim = { in: "FadeIn", out: "FadeOut" }[spec.group] ?? "Indicate";
  spec = animSpec(anim);
  const row = newRow(anim, u.id, { start: r.start ?? "after", lag: r.lag ?? 0.5, runTime: r.runTime ?? null, rate: r.rate ?? null });
  if (r.speed) row.speed = structuredClone(r.speed);
  if (anim === r.anim) for (const p of spec.params ?? []) if (r.params && p.key in r.params && p.type !== "elem") row.params[p.key] = structuredClone(r.params[p.key]);
  return row;
}

export async function applyPreset(p, how = mode) {
  await loadCatalog();
  const slide = currentSlide();
  const us = units(how);
  if (!slide || !us.length) { toast("動きを当てる要素を、キャンバスで選んでください（複数でも選べます）。", "warn"); return 0; }
  const added = [];
  const mkStep = (elementId, rows) => {
    const st = { id: uid("t"), elementId, mode: "gui", rows, code: "" };
    slide.steps.push(st);
    added.push(st);
  };
  if (us.length === 1 || how === "each" || how === "each-x") {
    for (const u of us) for (const click of p.steps) {
      const rows = click.map((r) => rowFor(r, u)).filter(Boolean);
      if (rows.length) mkStep(u.id, rows);
    }
  } else {
    for (const click of p.steps) {
      const per = us.map((u) => click.map((r) => rowFor(r, u)));
      const rows = [];
      for (let j = 0; j < click.length; j++) {
        per.forEach((rs, i) => {
          const r = rs[j];
          if (!r) return;
          if (i > 0) { r.start = how === "together" ? "with" : "lag"; r.lag = how === "together" ? 0 : gap; }
          rows.push(r);
        });
      }
      if (rows.length) mkStep(us[0].id, rows);
    }
  }
  if (!added.length) { toast("選んだ要素には、このプリセットの動きを使えません。", "warn"); return 0; }
  for (const st of added) for (const r of st.rows) ensureHiddenForIntro(r);
  store.focusStepId = added[0].id;
  markDirty("steps");
  emit("steps-changed");
  emit("focus-step", added[0].id);
  toast(`「${p.name}」を当てました（${added.length} ステップ）。`);
  return added.length;
}

// ---------------------------------------------------------------- 自分のプリセットの保存

function focusedStep() {
  const st = currentSlide()?.steps.find((s) => s.id === store.focusStepId);
  return st?.mode === "gui" ? st : null;
}

/** 今のステップの、その要素を動かす行。 */
function rowsToSave(st) {
  const main = st.elementId ?? st.rows.find((r) => r.kind === "anim")?.target;
  const rows = st.rows.filter((r) => r.kind === "wait" || (r.kind === "anim" && r.target === main));
  return rows.map((r) => {
    const o = structuredClone(r);
    delete o.id; delete o.part;
    if (o.kind === "anim") o.target = "@";
    return o;
  });
}

async function savePreset(name, withNext) {
  const slide = currentSlide();
  const st = focusedStep();
  if (!st) { toast("保存する動きのステップ（GUI のステップ）を、下の欄で開いてください。", "warn"); return; }
  const steps = [rowsToSave(st)];
  if (withNext) { // 同じ要素の、続くステップも（例: 出して、次のクリックで消す）
    const main = st.elementId;
    for (const nx of slide.steps.slice(slide.steps.indexOf(st) + 1)) {
      if (nx.mode !== "gui" || nx.elementId !== main) break;
      steps.push(rowsToSave(nx));
    }
  }
  try {
    const r = await api.post("/api/presets", { name, steps });
    mine = r.items;
    toast(`プリセット「${name}」を保存しました（${steps.length} クリック）。`);
    draw();
  } catch (e) { toast(e.message, "ng", 6000); }
}

// ---------------------------------------------------------------- メニュー

const desc = (p) => p.steps.map((rows) => rows.filter((r) => r.kind !== "wait").map((r) => (r.anim === "@in" ? "出す" : animSpec(r.anim)?.label ?? r.anim)).join("→")).join(" ／ ");

function item(p, own) {
  return `<li><button type="button" class="pm-apply" data-p="${escapeHtml(p.id)}" title="${escapeHtml(desc(p))}">${escapeHtml(p.name)}${p.steps.length > 1 ? ` <span class="pm-n">${p.steps.length} クリック</span>` : ""}</button>${own ? `<button type="button" class="icon small pm-del" data-del="${escapeHtml(p.id)}" title="このプリセットを消す">×</button>` : ""}</li>`;
}

function draw() {
  const m = $("preset-menu");
  const n = units(mode).length;
  const st = focusedStep();
  m.innerHTML = `
    <div class="pm-target">${n ? `選んでいる要素: ${n} 個` : `<span class="note-ng">要素を選ぶと当てられます</span>`}</div>
    <div class="pm-mode" ${n > 1 ? "" : "hidden"}>複数のとき:
      <select data-k="mode">${MODES.map(([k, t]) => `<option value="${k}" ${k === mode ? "selected" : ""}>${t}</option>`).join("")}</select>
      <label ${mode === "stagger" ? "" : "hidden"}>ずらす <input type="number" data-k="gap" value="${gap}" min="0.05" max="5" step="0.05" style="width:4.5em"> 秒</label></div>
    <div class="pm-cols">${BUILTIN.map(([h, list]) => `<div><h4>${h}</h4><ul>${list.map((p) => item(p, false)).join("")}</ul></div>`).join("")}</div>
    <h4>自分のプリセット</h4>
    <ul class="pm-mine">${mine?.length ? mine.map((p) => item(p, true)).join("") : `<li class="hint">まだありません。</li>`}</ul>
    <div class="pm-save">
      <input type="text" data-k="name" placeholder="名前（例: 出して青く光る）" maxlength="60" ${st ? "" : "disabled"}>
      <label title="開いているステップの後ろに続く、同じ要素のステップも 1 つのプリセットにする"><input type="checkbox" data-k="next" ${st ? "" : "disabled"}> 続くステップも</label>
      <button type="button" class="small" data-a="save" ${st ? "" : "disabled"}>今のステップを保存</button>
    </div>
    <p class="hint">${st ? "開いているステップの、その要素の動き（時間・緩急・向きなど）を保存します。どのプロジェクトでも使えます。" : "保存するには、下の欄で GUI のステップを開いてください。"}</p>`;
}

function find(id) {
  for (const [, list] of BUILTIN) { const p = list.find((x) => x.id === id); if (p) return p; }
  return mine?.find((x) => x.id === id) ?? null;
}

export async function openPresets() {
  const m = $("preset-menu");
  if (!m.hidden) { m.hidden = true; return; }
  if (!mine) mine = (await api.get("/api/presets").catch(() => ({ items: [] }))).items;
  await loadCatalog();
  draw();
  m.hidden = false;
  const r = $("btn-presets").getBoundingClientRect();
  const h = m.offsetHeight, w = m.offsetWidth;
  Object.assign(m.style, { left: `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`, top: `${Math.max(8, r.top - h - 4)}px` });
}

export function setupPresets() {
  const m = $("preset-menu");
  $("btn-presets").addEventListener("click", (e) => { e.stopPropagation(); openPresets(); });
  document.addEventListener("pointerdown", (e) => { if (!m.hidden && !m.contains(e.target) && e.target !== $("btn-presets")) m.hidden = true; });
  m.addEventListener("change", (e) => {
    const k = e.target.dataset.k;
    if (k === "mode") { mode = e.target.value; draw(); }
    if (k === "gap") gap = Math.max(0.05, Math.min(5, Number(e.target.value) || 0.3));
  });
  m.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-p]");
    if (a) { const p = find(a.dataset.p); if (p && await applyPreset(p)) m.hidden = true; return; }
    const d = e.target.closest("[data-del]");
    if (d) { mine = (await api.post("/api/presets/delete", { id: d.dataset.del })).items; draw(); return; }
    if (e.target.closest("[data-a=save]")) {
      const name = m.querySelector("[data-k=name]").value.trim();
      if (!name) { toast("プリセットの名前を入れてください。", "warn"); return; }
      await savePreset(name, m.querySelector("[data-k=next]").checked);
    }
  });
  m.addEventListener("keydown", (e) => e.stopPropagation()); // 名前の入力で、キャンバスの操作をしない
}

/** 自動テスト用。 */
export const builtinPresets = () => BUILTIN.flatMap(([, l]) => l);
