// リハーサルの記録: 回ごとの全体の時間、ページごとの時間の比べ表、目安・動画の待ち時間へ入れる、削除。
// リハーサルは発表ウィンドウの情報ウィンドウで行う（「● リハーサルを始める」）。

import { api } from "./api.js";
import { escapeHtml, markDirty, emit, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let items = [];
let saveFn = null;

const fmt = (s) => {
  if (s == null || Number.isNaN(s)) return "—";
  s = Math.round(s);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtDiff = (d) => (d == null ? "" : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt(Math.abs(d))}`);
const fmtDate = (s) => (s ? s.replace("T", " ").slice(0, 16) : "");

function options(sel, value) {
  sel.innerHTML = items.map((it, i) => `<option value="${i}" ${String(i) === String(value) ? "selected" : ""}>${escapeHtml(fmtDate(it.created))}（${fmt(it.total)}）</option>`).join("")
    + (sel.id === "rh-b" ? `<option value="" ${value === "" ? "selected" : ""}>比べない</option>` : "");
}

function draw() {
  const a = items[Number($("rh-a").value)], bv = $("rh-b").value, b = bv === "" ? null : items[Number(bv)];
  if (!a) {
    $("rh-table").innerHTML = `<p class="rc-empty">まだリハーサルの記録はありません。発表ウィンドウの情報ウィンドウで「● リハーサルを始める」を押すと、ページごとの時間を記録します。</p>`;
    $("rh-apply-target").disabled = $("rh-apply-wait").disabled = $("rh-delete").disabled = true;
    return;
  }
  $("rh-apply-target").disabled = $("rh-apply-wait").disabled = $("rh-delete").disabled = false;
  const slides = store.project.slides;
  const byId = (rec) => Object.fromEntries((rec?.pages ?? []).map((p) => [p.slide, p]));
  const A = byId(a), B = byId(b);
  // 今のスライドの順に、どちらかの記録にあるページを並べる（消したスライドは最後に）
  const ids = slides.map((s) => s.id).filter((id) => A[id] || B[id]);
  for (const id of [...Object.keys(A), ...Object.keys(B)]) if (!ids.includes(id)) ids.push(id);
  const rows = ids.map((id) => {
    const s = slides.find((x) => x.id === id);
    const pa = A[id], pb = B[id];
    const target = s?.targetTime ?? null;
    const ta = pa?.time ?? null, tb = pb?.time ?? null;
    const over = target != null && ta != null ? ta - target : null;
    return `<tr>
      <td>${escapeHtml(String(pa?.page ?? pb?.page ?? ""))}</td>
      <td class="rh-title">${escapeHtml((pa?.title || pb?.title || (s ? "" : "（消したスライド）")).slice(0, 40))}${pa?.section || pb?.section ? `<span class="rh-sec">${escapeHtml(pa?.section || pb?.section)}</span>` : ""}</td>
      <td>${fmt(target)}</td>
      <td class="${over != null && over > 0 ? "rh-over" : ""}">${fmt(ta)}${over != null ? `<span class="rh-d">${fmtDiff(over)}</span>` : ""}</td>
      ${b ? `<td>${fmt(tb)}</td><td class="rh-d">${ta != null && tb != null ? fmtDiff(ta - tb) : ""}</td>` : ""}
    </tr>`;
  }).join("");
  const sum = (rec) => (rec?.pages ?? []).reduce((x, p) => x + (p.time || 0), 0);
  const tsum = slides.filter((s) => !s.appendix && !s.skip).reduce((x, s) => x + (s.targetTime || 0), 0);
  $("rh-table").innerHTML = `<table class="rh-tab"><thead><tr><th>ページ</th><th>題名・章</th><th>目安</th><th>${escapeHtml(fmtDate(a.created))}</th>${b ? `<th>${escapeHtml(fmtDate(b.created))}</th><th>差</th>` : ""}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td></td><td>合計（リハーサルの全体: ${fmt(a.total)}${b ? ` ／ ${fmt(b.total)}` : ""}）</td><td>${tsum ? fmt(tsum) : "—"}</td><td>${fmt(sum(a))}</td>${b ? `<td>${fmt(sum(b))}</td><td class="rh-d">${fmtDiff(sum(a) - sum(b))}</td>` : ""}</tr></tfoot></table>`;
}

async function load() {
  try {
    items = (await api.get("/api/rehearsals")).items;
  } catch (e) {
    toast(e.message || String(e), "error");
    items = [];
  }
  options($("rh-a"), 0);
  options($("rh-b"), items.length > 1 ? 1 : "");
  draw();
}

export async function openRehearsal() {
  $("dlg-rehearsal").showModal();
  $("rh-table").innerHTML = `<p class="rc-empty">読み込んでいます…</p>`;
  await load();
}

export function setupRehearsal(save) {
  saveFn = save;
  $("rh-a").addEventListener("change", draw);
  $("rh-b").addEventListener("change", draw);
  $("rh-apply-target").addEventListener("click", () => {
    const a = items[Number($("rh-a").value)];
    if (!a) return;
    const round = Number($("rh-round").value) || 1;
    let n = 0;
    for (const p of a.pages) {
      const s = store.project.slides.find((x) => x.id === p.slide);
      if (!s || !(p.time > 0)) continue;
      s.targetTime = Math.max(round, Math.round(p.time / round) * round);
      n++;
    }
    if (!n) { toast("目安に入れられるページがありませんでした（スライドを消したか、記録が短すぎます）。", "warn"); return; }
    markDirty("prop");
    emit("slides-changed");
    toast(`${n} ページの「発表の目安」に、このリハーサルの時間を入れました（「元に戻す」で戻せます）。`);
    draw();
  });
  $("rh-apply-wait").addEventListener("click", async () => {
    const a = items[Number($("rh-a").value)];
    if (!a) return;
    let waits;
    try {
      waits = (await api.post("/api/rehearsals/waits", { id: a.id })).waits;
    } catch (e) { toast(e.message || String(e), "error"); return; }
    let n = 0;
    for (const [key, w] of Object.entries(waits)) {
      const [sid, stid] = key.split(":");
      const s = store.project.slides.find((x) => x.id === sid);
      if (!s) continue;
      if (stid === "start") { s.videoWait = w; n++; }
      else { const st = s.steps.find((x) => x.id === stid); if (st) { st.videoWait = w; n++; } }
    }
    if (!n) { toast("今の描画結果と、リハーサルの区切りが合いません（リハーサルのあとに描画し直した場合は、もう一度リハーサルしてください）。", "warn"); return; }
    markDirty("steps");
    emit("slides-changed");
    toast(`${n} か所の「動画での待ち」に、リハーサルでクリックを待った時間を入れました（「元に戻す」で戻せます）。`);
  });
  $("rh-delete").addEventListener("click", async () => {
    const a = items[Number($("rh-a").value)];
    if (!a || !confirm(`${fmtDate(a.created)} のリハーサルの記録を削除します。よろしいですか？`)) return;
    try { await api.post("/api/rehearsals/delete", { id: a.id }); } catch (e) { toast(e.message || String(e), "error"); }
    load();
  });
  $("rh-present").addEventListener("click", async () => {
    if (saveFn && !(await saveFn())) return;
    $("dlg-rehearsal").close();
    $("btn-present").click();
  });
}
