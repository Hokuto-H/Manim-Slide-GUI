// プロジェクトの削除（フォルダをごみ箱へ移す）と、「最近のプロジェクト」から外す。

import { api } from "./api.js";
import { emit, escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
let target = null;

/** 最近の一覧の 1 行（開くボタン・一覧から外す・削除）。open は開くボタンに付ける data 属性の名前。 */
export function recentRow(path, open = "data-path") {
  const p = escapeHtml(path);
  return `<li class="rc-row"><button type="button" class="rc-open" ${open}="${p}">${p}</button>
    <span class="rc-act"><button type="button" class="small" data-forget="${p}" title="この一覧から外す（フォルダはそのまま残す）">一覧から外す</button>
    <button type="button" class="small danger" data-delete="${p}" title="フォルダごとごみ箱へ移す">削除…</button></span></li>`;
}

/** 一覧の「一覧から外す」「削除…」を受け持つ（一覧を作り直したあとでもよいよう、親で受ける）。 */
export function bindRecentActions(listEl) {
  listEl.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-forget]");
    const d = e.target.closest("[data-delete]");
    if (f) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await api.post("/api/project/forget", { folder: f.dataset.forget });
        emit("recent-changed");
      } catch (err) { toast(err.message, "ng"); }
    } else if (d) {
      e.preventDefault();
      e.stopPropagation();
      openDeleteProject(d.dataset.delete);
    }
  }, true);
}

export async function openDeleteProject(folder) {
  let info;
  try { info = await api.post("/api/project/delete-info", { folder }); } catch (e) {
    // フォルダが無いときは、一覧から外すかを聞く
    if (/見つかりません/.test(e.message) && confirmMissing(folder, e.message)) return;
    toast(e.message, "ng", 6000);
    return;
  }
  target = info;
  $("dp-name").textContent = info.name;
  $("dp-folder").textContent = info.folder;
  $("dp-size").textContent = `${info.files} 個のファイル・${fmtSize(info.bytes)}`;
  $("dp-current").hidden = !info.current;
  $("dp-ok").checked = false;
  $("dp-run").disabled = true;
  $("dp-error").textContent = "";
  $("dlg-delproj").showModal();
}

function confirmMissing(folder, msg) {
  // window.confirm は使わず、トーストで知らせて一覧から外す
  api.post("/api/project/forget", { folder }).then(() => emit("recent-changed")).catch(() => {});
  toast(`${msg}\n一覧から外しました。`, "warn", 6000);
  return true;
}

async function runDelete() {
  if (!target) return;
  $("dp-run").disabled = true;
  $("dp-error").textContent = "";
  try {
    const r = await api.post("/api/project/delete", { folder: target.folder });
    $("dlg-delproj").close();
    for (const id of ["dlg-open", "dlg-project"]) if ($(id)?.open) $(id).close();
    if (r.current) {
      store.dirty = false; // 消したプロジェクトの「未保存」の警告を出さない
      sessionStorage.setItem("deletedToast", `「${target.name}」をごみ箱へ移しました。`);
      location.reload();
      return;
    }
    toast(`「${target.name}」をごみ箱へ移しました。`);
    emit("recent-changed");
  } catch (e) {
    $("dp-error").textContent = e.message;
    $("dp-run").disabled = !$("dp-ok").checked;
  }
}

export function setupProjectDelete() {
  $("dp-ok").addEventListener("change", () => { $("dp-run").disabled = !$("dp-ok").checked; });
  $("dp-run").addEventListener("click", runDelete);
  $("pj-delete").addEventListener("click", () => { if (store.project) openDeleteProject(store.folder); });
  try {
    const msg = sessionStorage.getItem("deletedToast");
    if (msg) { sessionStorage.removeItem("deletedToast"); setTimeout(() => toast(msg), 300); }
  } catch { /* 使えなくてもよい */ }
}
