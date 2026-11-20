// 自動保存の設定と、バックアップ（少し前の状態）の一覧・戻す・消す。

import { openCompare } from "./bkcompare.js";
import { api } from "./api.js";
import { escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let hooks = null; // { save, loadProject, setAutosave }
let settings = null;

const fmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtDate = (s) => {
  const d = new Date(s);
  const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `今日 ${hm}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨日 ${hm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hm}`;
};

function drawSettings() {
  $("bk-auto").checked = settings.autosave;
  $("bk-delay").value = String(settings.delay);
  if ($("bk-delay").value !== String(settings.delay)) $("bk-delay").insertAdjacentHTML("beforeend", `<option value="${settings.delay}" selected>${settings.delay} 秒</option>`);
  $("bk-on").checked = settings.backup;
  $("bk-every").value = String(settings.every);
  if ($("bk-every").value !== String(settings.every)) $("bk-every").insertAdjacentHTML("beforeend", `<option value="${settings.every}" selected>${settings.every} 分</option>`);
  $("bk-delay").disabled = !settings.autosave;
  $("bk-every").disabled = !settings.backup;
}

async function saveSettings() {
  try {
    settings = await api.post("/api/autosave/settings", {
      autosave: $("bk-auto").checked, delay: Number($("bk-delay").value),
      backup: $("bk-on").checked, every: Number($("bk-every").value),
    });
    hooks.setAutosave(settings);
  } catch (e) {
    toast(e.message || String(e), "error");
  }
  drawSettings();
}

function itemHtml(it) {
  const counts = `スライド ${it.slides} 枚・要素 ${it.elements} 個・ステップ ${it.steps} 個`;
  return `<li class="rc-item bk-${it.reason}">
    <div class="rc-top"><b>${escapeHtml(fmtDate(it.created))}</b>
      <span class="bk-reason">${escapeHtml(it.reasonLabel)}</span>
      ${it.label ? `<span class="bk-label">${escapeHtml(it.label)}</span>` : ""}
      ${it.same ? `<span class="rc-st bk-same">今と同じ内容</span>` : ""}</div>
    <div class="rc-meta">${counts} ／ ${fmtSize(it.size)}</div>
    <div class="rc-actions">
      <button type="button" class="small" data-bk="compare" data-id="${escapeHtml(it.id)}" ${it.same ? "disabled" : ""} title="今の内容と比べて、スライドを 1 枚ずつ戻す">今と比べる</button>
      <button type="button" class="small" data-bk="restore" data-id="${escapeHtml(it.id)}" ${it.same ? "disabled" : ""}>この状態に戻す</button>
      <button type="button" class="small danger" data-bk="delete" data-id="${escapeHtml(it.id)}">削除</button>
    </div>
  </li>`;
}

async function refresh() {
  let r;
  try {
    r = await api.get("/api/backups");
  } catch (e) {
    $("bk-list").innerHTML = `<li class="rc-empty">${escapeHtml(e.message || String(e))}</li>`;
    return;
  }
  $("bk-total").textContent = r.items.length ? `${r.items.length} 個・${fmtSize(r.totalSize)}` : "";
  $("bk-list").innerHTML = r.items.length ? r.items.map(itemHtml).join("")
    : `<li class="rc-empty">まだバックアップはありません。保存すると作られます（「今の状態を控える」でも作れます）。</li>`;
}

export async function openBackup() {
  // 保存していない変更があれば、先に保存する（一覧の「今と同じ内容」が正しくなるように）
  if (store.dirty && !(await hooks.save())) return;
  try {
    settings = await api.get("/api/autosave/settings");
  } catch (e) {
    toast(e.message || String(e), "error");
    return;
  }
  drawSettings();
  $("bk-label").value = "";
  $("bk-list").innerHTML = `<li class="rc-empty">読み込んでいます…</li>`;
  $("dlg-backup").showModal();
  refresh();
}

async function act(a, id) {
  if (a === "compare") {
    const it = $("bk-list").querySelector(`[data-bk="compare"][data-id="${CSS.escape(id)}"]`)?.closest(".rc-item")?.querySelector(".rc-top b")?.textContent ?? "";
    $("dlg-backup").close();
    openCompare(id, it);
    return;
  }
  if (a === "restore") {
    if (!confirm("このバックアップの状態に戻します。\n今の状態も、戻す前にバックアップに残すので、あとからそちらに戻すこともできます。戻しますか？")) return;
    if (store.dirty && !(await hooks.save())) return;
    try {
      const payload = await api.post("/api/backups/restore", { id });
      await hooks.loadProject(payload);
      toast("バックアップの状態に戻しました。戻す前の状態も、バックアップの一覧に残っています。");
    } catch (e) {
      toast(e.message || String(e), "error");
    }
  } else if (a === "delete") {
    if (!confirm("このバックアップを削除します。元に戻せません。削除しますか？")) return;
    try { await api.post("/api/backups/delete", { id }); } catch (e) { toast(e.message || String(e), "error"); }
  }
  refresh();
}

export function setupBackup(h) {
  hooks = h;
  for (const id of ["bk-auto", "bk-delay", "bk-on", "bk-every"]) $(id).addEventListener("change", saveSettings);
  $("bk-make").addEventListener("click", async () => {
    if (store.dirty && !(await hooks.save())) return;
    try {
      await api.post("/api/backups/make", { label: $("bk-label").value.trim() });
      $("bk-label").value = "";
      toast("今の状態を控えました。");
    } catch (e) {
      toast(e.message || String(e), "error");
    }
    refresh();
  });
  $("bk-folder").addEventListener("click", () => api.post("/api/backups/open-folder", {}).catch((e) => toast(e.message, "error")));
  $("bk-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bk]");
    if (b) act(b.dataset.bk, b.dataset.id);
  });
  api.get("/api/autosave/settings").then((s) => { settings = s; hooks.setAutosave(s); }).catch(() => {});
}
