// バックアップと今の内容を比べる: 足した・消した・変えたスライドの一覧（左右にサムネイル）と、変えた所の説明。
// 「このスライドに戻す」（今のスライドを置き換える）・「このスライドを戻す」（消したスライドを元の位置へ）。どちらも元に戻せる。

import { api } from "./api.js";
import { renderThumbnail, showSlide } from "./canvas.js";
import { emit, escapeHtml, markDirty, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let old = null; // バックアップのプロジェクト
let oldPre = "";
let title = "";

/** キーの順に左右されない比べ方。 */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a, b) => stable(a) === stable(b);

const GROUPS = [
  ["文字・中身", ["text", "runs", "latex", "items", "code", "expr", "cells", "bars", "values", "rows", "cols", "label", "labels", "vertices", "edges", "src", "path", "file"]],
  ["位置・向き", ["x", "y", "dx", "dy", "rotation", "tail", "p1", "p2", "paths"]],
  ["大きさ", ["width", "height", "fontSize", "radius", "scale", "innerRadius", "size"]],
  ["色・見た目", ["color", "stroke", "fill", "opacity", "font", "bold", "italic", "background", "dashed", "effects", "align"]],
];

function elName(e) {
  const kind = e.type === "shape" ? e.shape : e.type;
  return `${e.var ?? "?"}（${kind}）`;
}

function elementDiff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !same(a[k], b[k])));
  const parts = [];
  for (const [label, ks] of GROUPS) if (ks.some((k) => keys.has(k))) { parts.push(label); ks.forEach((k) => keys.delete(k)); }
  keys.delete("id");
  if (keys.size) parts.push("そのほかの設定");
  return parts;
}

/** 1 枚のスライドの違いの説明（文の並び）。 */
function slideDiff(a, b) {
  const out = [];
  const ea = new Map(a.elements.map((e) => [e.id, e])), eb = new Map(b.elements.map((e) => [e.id, e]));
  const added = b.elements.filter((e) => !ea.has(e.id)), removed = a.elements.filter((e) => !eb.has(e.id));
  if (added.length) out.push(`要素を足した: ${added.map(elName).join("、")}`);
  if (removed.length) out.push(`要素を消した: ${removed.map(elName).join("、")}`);
  for (const e of b.elements) {
    const o = ea.get(e.id);
    if (o && !same(o, e)) out.push(`${elName(e)}: ${elementDiff(o, e).join("・")}を変えた`);
  }
  const orderA = a.elements.filter((e) => eb.has(e.id)).map((e) => e.id), orderB = b.elements.filter((e) => ea.has(e.id)).map((e) => e.id);
  if (!same(orderA, orderB)) out.push("要素の重なり順を変えた");
  if (!same(a.groups ?? [], b.groups ?? [])) out.push("グループを変えた");
  const sa = new Map((a.steps ?? []).map((s) => [s.id, s])), sb = new Map((b.steps ?? []).map((s) => [s.id, s]));
  const stAdd = (b.steps ?? []).filter((s) => !sa.has(s.id)).length, stDel = (a.steps ?? []).filter((s) => !sb.has(s.id)).length;
  const stChg = (b.steps ?? []).filter((s) => sa.has(s.id) && !same(sa.get(s.id), s)).length;
  const stOrder = !same((a.steps ?? []).filter((s) => sb.has(s.id)).map((s) => s.id), (b.steps ?? []).filter((s) => sa.has(s.id)).map((s) => s.id));
  const st = [stAdd && `${stAdd} 個足した`, stDel && `${stDel} 個消した`, stChg && `${stChg} 個変えた`, stOrder && "順番を変えた"].filter(Boolean);
  if (st.length) out.push(`ステップ（動き）: ${st.join("・")}`);
  if ((a.notes ?? "") !== (b.notes ?? "")) out.push("発表者ノートを変えた");
  const skip = new Set(["elements", "groups", "steps", "notes", "id"]);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.has(k) && !same(a[k], b[k]));
  if (other.length) out.push(`スライドの設定を変えた（${other.join("・")}）`);
  return out;
}

/** 比べた結果: [{kind: same|changed|added|removed, old, now, oldIndex, nowIndex, notes}] */
function compare() {
  const now = store.project.slides;
  const prev = old.slides;
  const pIdx = new Map(prev.map((s, i) => [s.id, i]));
  const nIdx = new Map(now.map((s, i) => [s.id, i]));
  const out = [];
  now.forEach((s, i) => {
    if (!pIdx.has(s.id)) out.push({ kind: "added", now: s, nowIndex: i });
    else {
      const o = prev[pIdx.get(s.id)];
      out.push(same(o, s) ? { kind: "same", old: o, now: s, nowIndex: i, oldIndex: pIdx.get(s.id) } : { kind: "changed", old: o, now: s, nowIndex: i, oldIndex: pIdx.get(s.id), notes: slideDiff(o, s) });
    }
  });
  // 消したスライドは、バックアップでの前のスライドの後ろに入れて見せる
  prev.forEach((o, j) => {
    if (nIdx.has(o.id)) return;
    let at = out.length;
    for (let k = j - 1; k >= 0; k--) {
      const p = out.findIndex((x) => (x.now ?? x.old)?.id === prev[k].id);
      if (p >= 0) { at = p + 1; break; }
      if (k === 0) at = 0;
    }
    if (j === 0) at = 0;
    out.splice(at, 0, { kind: "removed", old: o, oldIndex: j });
  });
  return out;
}

function projectNotes() {
  const out = [];
  if (!same(old.settings, store.project.settings)) {
    const ks = Object.keys({ ...old.settings, ...store.project.settings }).filter((k) => !same(old.settings[k], store.project.settings[k]));
    out.push(`プロジェクト設定を変えた（${ks.join("・")}）`);
  }
  if (!same(old.masters ?? [], store.project.masters ?? [])) out.push("スライドマスターを変えた");
  if (!same(old.slides.map((s) => s.id).filter((id) => store.project.slides.some((x) => x.id === id)), store.project.slides.map((s) => s.id).filter((id) => old.slides.some((x) => x.id === id)))) out.push("スライドの並びを変えた");
  return out;
}

const LABEL = { same: "同じ", changed: "変えた", added: "足した", removed: "消した" };

async function thumb(el, slide) {
  try { el.style.backgroundImage = `url("${await renderThumbnail(slide)}")`; } catch { /* 描けなくてもよい */ }
}

function draw() {
  const list = compare();
  const showSame = $("bc-same").checked;
  const counts = Object.fromEntries(Object.keys(LABEL).map((k) => [k, list.filter((x) => x.kind === k).length]));
  const pn = projectNotes();
  $("bc-summary").innerHTML = `バックアップ（${escapeHtml(title)}）→ 今: 変えた ${counts.changed} 枚・足した ${counts.added} 枚・消した ${counts.removed} 枚・同じ ${counts.same} 枚`
    + (pn.length ? `<br>${pn.map(escapeHtml).join("<br>")}` : "")
    + (oldPre !== (store.preamble ?? "") ? "<br>共通プリアンブルを変えた（プリアンブルは、バックアップの「この状態に戻す」で戻せます）" : "");
  const rows = list.filter((x) => showSame || x.kind !== "same");
  $("bc-list").innerHTML = rows.length ? rows.map((x, k) => `<li class="bc-item bc-${x.kind}" data-k="${k}">
      <div class="bc-head"><span class="bc-st">${LABEL[x.kind]}</span>
        <b>${x.now ? `今の ${x.nowIndex + 1} 枚目` : `バックアップの ${x.oldIndex + 1} 枚目`}</b>
        ${x.kind === "changed" && x.oldIndex !== x.nowIndex ? `<span class="hint">（バックアップでは ${x.oldIndex + 1} 枚目）</span>` : ""}
        <span class="grow"></span>
        ${x.kind === "changed" ? `<button type="button" class="small" data-a="revert" data-k="${k}" title="今のこのスライドを、バックアップのスライドで置き換える">このスライドに戻す</button>` : ""}
        ${x.kind === "removed" ? `<button type="button" class="small primary" data-a="restore" data-k="${k}" title="消したスライドを、元の位置に戻す">このスライドを戻す</button>` : ""}
      </div>
      <div class="bc-pics"><div><span class="hint">バックアップ</span><span class="thumb" data-t="old-${k}">${x.old ? "" : "（無し）"}</span></div>
        <div><span class="hint">今</span><span class="thumb" data-t="now-${k}">${x.now ? "" : "（無し）"}</span></div></div>
      ${x.notes?.length ? `<ul class="bc-notes">${x.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
    </li>`).join("") : `<li class="hint">違いはありません。</li>`;
  // サムネイルは、見えてから描く
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const [side, k] = en.target.dataset.t.split("-");
      const x = rows[Number(k)];
      const s = side === "old" ? x.old : x.now;
      if (s) thumb(en.target, s);
    }
  }, { root: $("bc-list") });
  $("bc-list").querySelectorAll("[data-t]").forEach((t) => io.observe(t));
  $("bc-list").onclick = (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const x = rows[Number(b.dataset.k)];
    if (b.dataset.a === "revert") revert(x);
    else restore(x);
  };
}

/** 戻したスライドの変数名が、ほかのスライドと重なっていないか。 */
function warnVars(slide) {
  const others = new Set(store.project.slides.filter((s) => s !== slide).flatMap((s) => [...s.elements, ...(s.groups ?? [])].map((e) => e.var)));
  const dup = [...slide.elements, ...(slide.groups ?? [])].map((e) => e.var).filter((v) => others.has(v));
  if (dup.length) toast(`戻したスライドの変数名「${[...new Set(dup)].join("」「")}」が、ほかのスライドと重なっています。「点検」で確かめて、名前を変えてください。`, "warn", 8000);
}

async function revert(x) {
  const i = store.project.slides.indexOf(x.now);
  if (i < 0) return;
  const copy = structuredClone(x.old);
  store.project.slides.splice(i, 1, copy);
  markDirty("restore-slide");
  emit("slides-changed");
  if (store.slideIndex === i) await showSlide();
  emit("refresh-thumbs");
  warnVars(copy);
  toast(`${i + 1} 枚目を、バックアップのスライドに戻しました（元に戻すで取り消せます）。`);
  draw();
}

async function restore(x) {
  if (store.project.slides.some((s) => s.id === x.old.id)) return;
  // バックアップで前にあったスライドの後ろへ（無ければ、バックアップと同じ番号の所へ）
  let at = Math.min(x.oldIndex, store.project.slides.length);
  for (let k = x.oldIndex - 1; k >= 0; k--) {
    const p = store.project.slides.findIndex((s) => s.id === old.slides[k].id);
    if (p >= 0) { at = p + 1; break; }
  }
  const copy = structuredClone(x.old);
  store.project.slides.splice(at, 0, copy);
  if (store.slideIndex >= at) store.slideIndex += 1;
  markDirty("restore-slide");
  emit("slides-changed");
  emit("refresh-thumbs");
  warnVars(copy);
  toast(`消したスライドを ${at + 1} 枚目に戻しました（元に戻すで取り消せます）。`);
  draw();
}

export async function openCompare(id, label) {
  try {
    const r = await api.post("/api/backups/get", { id });
    old = r.project;
    oldPre = r.preamble;
  } catch (e) { toast(e.message, "ng", 6000); return; }
  title = label || id;
  draw();
  $("dlg-bkcmp").showModal();
}

export function setupCompare() {
  $("bc-same").addEventListener("change", draw);
}
