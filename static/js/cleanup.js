// 使っていない画像・動画・音声のファイルの整理（プロジェクトの unused フォルダへ移す・戻す・完全に削除する）。

import { api } from "./api.js";
import { historyPaths } from "./history.js";
import { escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let saveFn = null;
let data = null;

const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const KIND = { image: "画像", video: "動画", audio: "音声" };

function row(it, checked, extra = "") {
  return `<li><label><input type="checkbox" data-path="${escapeHtml(it.path)}" ${checked ? "checked" : ""}>
    <span class="cl-kind">${KIND[it.kind] ?? ""}</span> <span class="cl-name">${escapeHtml(it.path)}</span>
    <span class="cl-size">${fmtSize(it.size)}</span>${extra}</label></li>`;
}

function draw() {
  const unused = data.items.filter((x) => x.status === "unused");
  const kept = data.items.filter((x) => x.status === "kept");
  const used = data.items.filter((x) => x.status === "used");
  $("cl-summary").textContent = `images・clips のファイル ${data.items.length} 個（使っている ${used.length} 個・使っていない ${unused.length} 個・バックアップや履歴だけ ${kept.length} 個）`;
  $("cl-unused").innerHTML = unused.length ? unused.map((x) => row(x, true)).join("") : `<li class="rc-empty">使っていないファイルはありません。</li>`;
  $("cl-kept-box").hidden = !kept.length;
  $("cl-kept").innerHTML = kept.map((x) => row(x, false, ` <span class="cl-where">${escapeHtml(x.where.join("・"))}で使用</span>`)).join("");
  $("cl-trash-box").hidden = !data.trash.length;
  $("cl-trash-total").textContent = data.trash.length ? `${data.trash.length} 個・${fmtSize(data.trashSize)}` : "";
  $("cl-trash").innerHTML = data.trash.map((x) => row(x, x.needed,
    x.needed ? ` <span class="cl-warn">今のスライドで使っています（戻してください）</span>` : x.conflict ? ` <span class="cl-where">元の場所に同じ名前のファイルがあります</span>` : "")).join("");
  $("cl-all-unused").checked = true;
  $("cl-all-trash").checked = false;
  updateButtons();
}

function checked(listId) {
  return [...$(listId).querySelectorAll("input[type=checkbox]:checked")].map((c) => c.dataset.path);
}

function updateButtons() {
  const sel = [...checked("cl-unused"), ...checked("cl-kept")];
  const size = data.items.filter((x) => sel.includes(x.path)).reduce((a, x) => a + x.size, 0);
  $("cl-move").disabled = !sel.length;
  $("cl-move").textContent = sel.length ? `選んだ ${sel.length} 個（${fmtSize(size)}）を unused フォルダへ移す` : "unused フォルダへ移す";
  const t = checked("cl-trash");
  $("cl-restore").disabled = !t.length;
  $("cl-purge").disabled = !t.length;
}

async function scan() {
  $("cl-summary").textContent = "調べています…";
  try {
    data = await api.post("/api/cleanup/scan", { historyPaths: historyPaths() });
  } catch (e) {
    toast(e.message || String(e), "error");
    return;
  }
  draw();
}

export async function openCleanup() {
  if (saveFn && store.dirty && !(await saveFn())) return; // 保存してから調べる（保存していない変更で使い始めたファイルを、使っていないと見なさないように）
  $("dlg-cleanup").showModal();
  await scan();
}

export function setupCleanup(save) {
  saveFn = save;
  $("dlg-cleanup").addEventListener("change", (e) => { if (e.target.matches("input[type=checkbox]")) updateButtons(); });
  $("cl-move").addEventListener("click", async () => {
    const paths = [...checked("cl-unused"), ...checked("cl-kept")];
    if (checked("cl-kept").length && !confirm("バックアップや「元に戻す」の履歴で使っているファイルも移します。\nそのバックアップに戻したときや元に戻したときに、ファイルが見つからなくなります（unused フォルダから戻せば直ります）。移しますか？")) return;
    try {
      const r = await api.post("/api/cleanup/move", { paths });
      toast(`${r.moved} 個のファイルを unused フォルダへ移しました（「戻す」で元に戻せます）。`);
    } catch (e) { toast(e.message || String(e), "error"); }
    scan();
  });
  $("cl-restore").addEventListener("click", async () => {
    try {
      const r = await api.post("/api/cleanup/restore", { paths: checked("cl-trash") });
      toast(`${r.restored} 個のファイルを元の場所に戻しました。${r.skipped.length ? `（${r.skipped.length} 個は、元の場所に同じ名前のファイルがあるので戻していません）` : ""}`);
    } catch (e) { toast(e.message || String(e), "error"); }
    scan();
  });
  $("cl-purge").addEventListener("click", async () => {
    const paths = checked("cl-trash");
    if (!confirm(`unused フォルダの ${paths.length} 個のファイルを、完全に削除します。元に戻せません。削除しますか？`)) return;
    try {
      const r = await api.post("/api/cleanup/purge", { paths });
      toast(`${r.deleted} 個のファイルを削除しました。`);
    } catch (e) { toast(e.message || String(e), "error"); }
    scan();
  });
  $("cl-all-unused").addEventListener("change", (e) => { $("cl-unused").querySelectorAll("input").forEach((c) => { c.checked = e.target.checked; }); updateButtons(); });
  $("cl-all-trash").addEventListener("change", (e) => { $("cl-trash").querySelectorAll("input").forEach((c) => { c.checked = e.target.checked; }); updateButtons(); });
  $("cl-folder").addEventListener("click", () => api.post("/api/cleanup/open-folder", {}).catch((e) => toast(e.message, "error")));
}
