// プロジェクトの持ち運び: 1 つの zip に固める・zip から取り込む（取り込んだあと、作った環境と今の環境を見比べる）。

import { api } from "./api.js";
import { escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let saveFn = null;
let openEnv = null;
let groups = [];
let lastZip = "";

const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 0 ? `${Math.max(1, Math.round(n / 1e3))} KB` : "0 KB");

// ---------------------------------------------------------------- zip に固める

function drawTotal() {
  let n = 0, b = 0;
  for (const g of groups) {
    const box = document.querySelector(`#pk-groups input[data-key="${g.key}"]`);
    if (g.always || box?.checked) { n += g.count; b += g.bytes; }
  }
  $("pk-total").textContent = `入れるファイル: ${n} 個・およそ ${fmtSize(b)}（圧縮する前の大きさ）`;
}

export async function openPack() {
  if (!(await saveFn())) return;
  let res;
  try { res = await api.get("/api/portable/summary"); } catch (e) { toast(e.message, "ng", 6000); return; }
  groups = res.groups;
  $("pk-groups").innerHTML = groups.map((g) => {
    const empty = !g.always && !g.count;
    const on = g.always || (res.include[g.key] && !empty);
    return `<li><label class="${empty ? "pk-empty" : ""}"><input type="checkbox" data-key="${g.key}" ${on ? "checked" : ""} ${g.always || empty ? "disabled" : ""}>
      <span>${escapeHtml(g.label)}${g.always ? "（いつも入れる）" : empty ? "（ありません）" : ""}</span>
      <span class="pk-size">${g.count} 個・${fmtSize(g.bytes)}</span></label></li>`;
  }).join("");
  $("pk-dest").value = res.dest;
  $("pk-error").textContent = "";
  $("pk-done").hidden = true;
  $("pk-reveal").hidden = true;
  $("pk-run").disabled = false;
  drawTotal();
  $("dlg-pack").showModal();
}

async function runPack() {
  const include = {};
  document.querySelectorAll("#pk-groups input[data-key]").forEach((b) => { if (b.dataset.key !== "core") include[b.dataset.key] = b.checked && !b.disabled; });
  $("pk-error").textContent = "";
  $("pk-done").hidden = true;
  $("pk-run").disabled = true;
  $("pk-run").textContent = "作っています…";
  try {
    if (!(await saveFn())) throw new Error("保存できなかったため、zip を作りませんでした。");
    const r = await api.post("/api/portable/export", { dest: $("pk-dest").value.trim(), include });
    lastZip = r.path;
    $("pk-dest").value = r.path;
    $("pk-done").textContent = `zip を作りました: ${r.path}（${r.files} 個のファイル・${fmtSize(r.bytes)}）`;
    $("pk-done").hidden = false;
    $("pk-reveal").hidden = false;
  } catch (e) {
    $("pk-error").textContent = e.message;
  } finally {
    $("pk-run").disabled = false;
    $("pk-run").textContent = "zip を作る";
  }
}

// ---------------------------------------------------------------- zip から取り込む

let inspectTimer = 0;
function scheduleInspect() {
  clearTimeout(inspectTimer);
  inspectTimer = setTimeout(inspect, 250);
}

async function inspect() {
  const zip = $("up-zip").value.trim();
  $("up-info").textContent = "";
  $("up-error").textContent = "";
  if (!zip) return;
  try {
    const r = await api.post("/api/portable/inspect", { zip, parent: $("up-parent").value.trim() });
    const v = r.info.versions || {};
    const parts = [`プロジェクト「${r.info.name || r.folder}」・${fmtSize(r.bytes)}`];
    if (r.info.created) parts.push(`${r.info.created} に作成`);
    if (v.os) parts.push(`作った環境: ${v.os}・Manim ${v.manim || "?"}・Manim Slides ${v.manim_slides || "?"}`);
    if (r.dest) parts.push(`取り出す先: ${r.dest}`);
    $("up-info").textContent = parts.join(" ／ ");
  } catch (e) {
    $("up-error").textContent = e.message;
  }
}

export async function openUnpack() {
  if (store.project && store.dirty && !(await saveFn())) return;
  const cfg = await api.get("/api/userconfig").catch(() => ({}));
  $("up-step1").hidden = false;
  $("up-step2").hidden = true;
  $("up-run").hidden = false;
  $("up-run").disabled = false;
  $("up-env").hidden = true;
  $("up-close").textContent = "キャンセル";
  $("up-error").textContent = "";
  $("up-info").textContent = "";
  if (!$("up-parent").value) $("up-parent").value = cfg.lastDir || "";
  $("dlg-unpack").showModal();
  if ($("up-zip").value) inspect();
}

const mark = (ok) => (ok === true ? `<span class="st-ok">✓ あり</span>` : ok === false ? `<span class="st-ng">✗ ありません</span>` : `<span class="st-unk">— 確かめられません</span>`);

function drawCompare(cmp) {
  const out = [];
  const missFonts = cmp.fonts.filter((f) => f.ok === false);
  const missPk = cmp.packages.filter((p) => p.ok === false);
  const verDiff = cmp.versions.filter((v) => v.same === false && (v.key === "manim" || v.key === "manim_slides"));
  if (!missFonts.length && !missPk.length && !verDiff.length) {
    out.push(`<p>作った環境との違いで、困るものは見つかりませんでした。</p>`);
  } else {
    const msg = [];
    if (missFonts.length) msg.push(`フォント ${missFonts.length} 個（文字が別のフォントで描かれます）`);
    if (missPk.length) msg.push(`LaTeX のパッケージ ${missPk.length} 個（数式やテキストが描けないことがあります）`);
    if (verDiff.length) msg.push(`Manim の版の違い（描画の見た目が変わることがあります）`);
    out.push(`<p class="note-ng">この環境に足りないもの: ${msg.join("・")}</p>`);
  }
  if (cmp.fonts.length) {
    out.push(`<h3>使っているフォント</h3><table class="up-table">` + cmp.fonts.map((f) => `<tr><td>${escapeHtml(f.name)}</td><td>${f.bundled ? "✓ zip に同梱" : mark(f.ok)}${f.as ? `（この PC では ${escapeHtml(f.as)}）` : ""}</td></tr>`).join("") + `</table>`);
  }
  if (cmp.packages.length) {
    out.push(`<h3>LaTeX のパッケージ${cmp.texChecked ? "" : "（kpsewhich が見つからず、確かめられません）"}</h3><table class="up-table">`
      + cmp.packages.map((p) => `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${mark(p.ok)}</td></tr>`).join("") + `</table>`);
  }
  out.push(`<h3>版</h3><table class="up-table"><tr><th></th><th>作った環境</th><th>この環境</th><th></th></tr>`
    + cmp.versions.map((v) => `<tr><td>${v.label}</td><td>${escapeHtml(v.there || "—")}</td><td>${escapeHtml(v.here || "—")}</td>
      <td>${v.same === true ? `<span class="st-ok">同じ</span>` : v.same === false ? `<span class="${v.key === "manim" || v.key === "manim_slides" ? "st-ng" : "st-unk"}">違う</span>` : ""}</td></tr>`).join("") + `</table>`);
  if (missFonts.length) out.push(`<p class="field-note">フォントは、ファイルを右クリックして「すべてのユーザーに対してインストール」で入れてから、アプリを起動し直してください。</p>`);
  if (missPk.length) out.push(`<p class="field-note">パッケージは TeX Live Manager（tlmgr install パッケージ名）で入れられます。</p>`);
  $("up-compare").innerHTML = out.join("");
}

async function runUnpack(onLoaded) {
  $("up-error").textContent = "";
  $("up-run").disabled = true;
  $("up-run").textContent = "取り出しています…";
  try {
    const payload = await api.post("/api/portable/import", { zip: $("up-zip").value.trim(), parent: $("up-parent").value.trim() });
    onLoaded(payload);
    const im = payload.imported;
    $("up-step1").hidden = true;
    $("up-step2").hidden = false;
    $("up-opened").textContent = `取り出して開きました: ${im.folder}`;
    drawCompare(im.compare);
    $("up-run").hidden = true;
    $("up-env").hidden = false;
    $("up-close").textContent = "閉じる";
    $("up-zip").value = "";
  } catch (e) {
    $("up-error").textContent = e.message;
  } finally {
    $("up-run").disabled = false;
    $("up-run").textContent = "取り出して開く";
  }
}

export function setupPortable(save, onLoaded, openEnvDialog) {
  saveFn = save;
  openEnv = openEnvDialog;
  $("pk-groups").addEventListener("change", drawTotal);
  $("pk-browse").addEventListener("click", async () => {
    const cur = $("pk-dest").value.trim();
    const sep = Math.max(cur.lastIndexOf("\\"), cur.lastIndexOf("/"));
    try {
      const r = await api.post("/api/dialog/zip", { mode: "save", initial: sep > 0 ? cur.slice(0, sep) : "", name: sep >= 0 ? cur.slice(sep + 1) : cur });
      if (r.path) $("pk-dest").value = r.path;
    } catch (e) { $("pk-error").textContent = e.message; }
  });
  $("pk-run").addEventListener("click", runPack);
  $("pk-reveal").addEventListener("click", () => api.post("/api/portable/reveal", { path: lastZip }).catch((e) => toast(e.message, "ng")));

  $("up-browse-zip").addEventListener("click", async () => {
    try {
      const r = await api.post("/api/dialog/zip", { mode: "open", initial: $("up-parent").value.trim() });
      if (r.path) { $("up-zip").value = r.path; inspect(); }
    } catch (e) { $("up-error").textContent = e.message; }
  });
  $("up-browse-parent").addEventListener("click", async () => {
    try {
      const r = await api.post("/api/dialog/folder", { initial: $("up-parent").value.trim(), title: "取り出し先のフォルダを選択" });
      if (r.path) { $("up-parent").value = r.path; inspect(); }
    } catch (e) { $("up-error").textContent = e.message; }
  });
  $("up-zip").addEventListener("input", scheduleInspect);
  $("up-parent").addEventListener("input", scheduleInspect);
  $("up-run").addEventListener("click", () => runUnpack(onLoaded));
  $("up-env").addEventListener("click", () => { $("dlg-unpack").close(); openEnv?.(); });
}
