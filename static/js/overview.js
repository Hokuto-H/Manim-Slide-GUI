// 発表全体の見通し: スライドごとの動きの時間・目安の時間・リハーサルの時間を横棒で並べ、章ごとの小計と全体の合計を出す。

import { slideTitleText } from "./slidetitle.js";
import { api } from "./api.js";
import { loadCatalog } from "./animpane.js";
import { selectSlide } from "./slides.js";
import { escapeHtml, pagePlan, sectionPlan, store } from "./store.js";
import { stepTimes } from "./timeline.js";

const $ = (id) => document.getElementById(id);
let records = [];

const fmt = (t) => (t == null ? "—" : t >= 60 ? `${Math.floor(t / 60)}分${String(Math.round(t % 60)).padStart(2, "0")}秒` : `${t.toFixed(1)}秒`);

function slideTitle(s, i) {
  return slideTitleText(s).slice(0, 40) || `スライド ${i + 1}`;
}

/** スライドの動きの時間（GUI のステップの合計）と、コードのステップがあるか。 */
export function slideAnimTime(s) {
  let t = 0, code = false;
  for (const st of s.steps ?? []) {
    if (st.mode !== "gui") { code = true; continue; }
    const r = stepTimes(st);
    t += r.total;
    if (r.hasCode) code = true;
  }
  return { t, code };
}

function draw() {
  const slides = store.project.slides;
  const plan = pagePlan(), secs = sectionPlan();
  const rec = records.find((r) => r.id === $("ov-rh").value);
  const real = new Map((rec?.pages ?? []).map((p) => [p.slide, Number(p.time) || 0]));
  const showAppx = $("ov-appx").checked;
  const rows = slides.map((s, i) => ({ s, i, plan: plan[i], sec: secs[i], anim: slideAnimTime(s), target: s.targetTime ?? null, real: real.has(s.id) ? real.get(s.id) : null }))
    .filter((r) => !r.plan?.skip && (showAppx || !r.s.appendix));
  const max = Math.max(1, ...rows.flatMap((r) => [r.anim.t, r.target ?? 0, r.real ?? 0]));
  const bar = (v, cls) => (v == null ? "" : `<i class="${cls}" style="width:${Math.max(1, (v / max) * 100)}%"></i>`);
  const sum = (list, k) => list.reduce((a, r) => a + (k === "anim" ? r.anim.t : r[k] ?? 0), 0);
  const groups = [];
  for (const r of rows) {
    const name = r.s.appendix ? "付録" : r.sec?.name || "（章なし）";
    if (!groups.length || groups.at(-1).name !== name) groups.push({ name, rows: [] });
    groups.at(-1).rows.push(r);
  }
  const line = (r) => {
    const over = r.target != null && r.real != null && r.real > r.target * 1.2;
    const overAnim = r.target != null && r.anim.t > r.target;
    return `<tr data-i="${r.i}" class="${over || overAnim ? "ov-over" : ""}">
      <td class="ov-no">${escapeHtml(String(r.plan?.number ?? r.i + 1))}</td>
      <td class="ov-title">${escapeHtml(slideTitle(r.s, r.i))}</td>
      <td class="ov-bars">${bar(r.anim.t, "ov-anim")}${bar(r.target, "ov-target")}${bar(r.real, "ov-real")}</td>
      <td class="ov-num">${fmt(r.anim.t)}${r.anim.code ? "＋コード" : ""}</td><td class="ov-num">${fmt(r.target)}</td>
      <td class="ov-num">${fmt(r.real)}${over ? ` <b class="ov-warn">目安の ${Math.round((r.real / r.target) * 100)}%</b>` : ""}${overAnim && !over ? ` <b class="ov-warn">動きだけで目安を超えます</b>` : ""}</td></tr>`;
  };
  const tgtAll = rows.some((r) => r.target != null);
  $("ov-table").innerHTML = `<table class="ov-table"><thead><tr><th>ページ</th><th>スライド</th><th></th><th>動き</th><th>目安</th><th>リハーサル</th></tr></thead>
    ${groups.map((g) => `<tbody><tr class="ov-sec"><td colspan="3">${escapeHtml(g.name)}（${g.rows.length} 枚）</td>
      <td class="ov-num">${fmt(sum(g.rows, "anim"))}</td><td class="ov-num">${tgtAll ? fmt(sum(g.rows, "target")) : "—"}</td><td class="ov-num">${rec ? fmt(sum(g.rows, "real")) : "—"}</td></tr>
      ${g.rows.map(line).join("")}</tbody>`).join("")}
    <tfoot><tr><td colspan="3">合計（${rows.length} 枚）</td><td class="ov-num">${fmt(sum(rows, "anim"))}</td><td class="ov-num">${tgtAll ? fmt(sum(rows, "target")) : "—"}</td>
      <td class="ov-num">${rec ? fmt(rec.total) : "—"}</td></tr></tfoot></table>
    ${tgtAll ? "" : `<p class="hint">目安の時間は、スライドのパネルの「目安の時間」で決めます。</p>`}
    ${rec ? "" : `<p class="hint">リハーサルの記録はまだありません（「リハーサル」を参照）。</p>`}`;
}

export async function openOverview() {
  await loadCatalog();
  records = (await api.get("/api/rehearsals").catch(() => ({ items: [] }))).items ?? [];
  $("ov-rh").innerHTML = records.length ? records.map((r, k) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.created.replace("T", " "))}（${fmt(r.total)}）${k === 0 ? " 最新" : ""}</option>`).join("") + `<option value="">出さない</option>`
    : `<option value="">記録なし</option>`;
  draw();
  $("dlg-overview").showModal();
}

export function setupOverview() {
  $("ov-rh").addEventListener("change", draw);
  $("ov-appx").addEventListener("change", draw);
  $("ov-table").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    $("dlg-overview").close();
    await selectSlide(Number(tr.dataset.i));
  });
}
