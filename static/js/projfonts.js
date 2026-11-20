// プロジェクトに入れたフォント（プロジェクトのフォルダの fonts/）
// ・一覧を読み、ブラウザにも FontFace で読み込む（キャンバスの仮の文字・入力欄の見た目を合わせる）
// ・「プロジェクト設定」の「プロジェクトのフォント」の欄（追加・削除・ライセンスの注意）

import { api, appHeaders } from "./api.js";
import { emit, escapeHtml, fontOptionsHtml, on, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
const loaded = new Set(); // ブラウザに読み込んだ「ファイル名:ファミリー名」

async function loadFaces() {
  for (const f of store.projectFonts) {
    for (const fam of f.families) {
      const key = `${f.file}:${fam}`;
      if (loaded.has(key)) continue;
      loaded.add(key);
      try {
        const res = await fetch(`/api/project/fonts/file?name=${encodeURIComponent(f.file)}`, { headers: appHeaders() });
        if (!res.ok) continue;
        const face = new FontFace(fam, await res.arrayBuffer());
        await face.load();
        document.fonts.add(face);
      } catch { /* 読めないフォントは、ブラウザでは別のフォントで出す（描画には影響しない） */ }
    }
  }
}

function apply(res) {
  const before = JSON.stringify(store.projectFonts ?? []);
  store.projectFonts = res.fonts ?? [];
  renderFontBox();
  loadFaces();
  if (JSON.stringify(store.projectFonts) !== before) emit("fonts-changed");
}

export async function loadProjectFonts() {
  if (!store.project) { store.projectFonts = []; return; }
  try { apply(await api.get("/api/project/fonts")); } catch { /* 一覧が読めなくても続ける */ }
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 使っている要素の数（そのファミリー名を font に持つ要素・既定のフォント）。 */
function usage(families) {
  let n = 0;
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && (k === "font" || k.endsWith("Font")) && families.includes(v)) n++;
        else if (v && typeof v === "object") walk(v);
      }
    }
  };
  walk(store.project?.slides ?? []);
  walk(store.project?.masters ?? []);
  if (families.includes(store.project?.settings?.defaultFont)) n++;
  return n;
}

export function renderFontBox() {
  const box = $("pj-pfonts");
  if (!box) return;
  const list = store.projectFonts ?? [];
  box.innerHTML = `
    ${list.length ? `<ul class="pf-list">${list.map((f) => `
      <li><span class="pf-fam">${f.families.length ? f.families.map(escapeHtml).join("・") : `<span class="warn">（フォントとして読めませんでした）</span>`}</span>
        <span class="pf-file">${escapeHtml(f.file)}・${kb(f.bytes)}</span>
        <button type="button" class="small" data-pf-del="${escapeHtml(f.file)}">削除</button></li>`).join("")}</ul>`
      : `<div class="field-note">まだありません。</div>`}
    <div class="row"><button type="button" id="pf-add">＋ フォントを追加…</button></div>
    <div class="field-note">フォントのファイル（.ttf・.otf・.ttc）を、プロジェクトの <code>fonts</code> フォルダにコピーします。PC にインストールしなくても、
      プレビューと描画で使えます。持ち運び用の zip には、「zip に固める」で「プロジェクトのフォント」を選んだときだけ入ります。追加したフォントは、フォントの選択肢の「プロジェクトのフォント」に出ます。</div>
    <div class="field-note warn">フォントには、ほかの人に渡す（zip で配る・プロジェクトを共有する）ことを認めていないライセンスのものがあります。
      配る前に、そのフォントのライセンスを確かめてください（Google Fonts などの OFL のフォントは配れます）。</div>`;
  $("pf-add").onclick = addFonts;
  box.querySelectorAll("[data-pf-del]").forEach((b) => {
    b.onclick = async () => {
      const f = list.find((x) => x.file === b.dataset.pfDel);
      const n = usage(f?.families ?? []);
      if (!confirm(`「${b.dataset.pfDel}」をプロジェクトから削除しますか？${n ? `\n\nこのフォントを使っている所が ${n} か所あります。描画では別のフォントに置き換わります。` : ""}`)) return;
      try { apply(await api.post("/api/project/fonts/remove", { file: b.dataset.pfDel })); toast("フォントを削除しました。"); }
      catch (e) { toast(e.message, "error", 6000); }
    };
  });
}

async function addFonts() {
  const btn = $("pf-add");
  btn.disabled = true;
  btn.textContent = "選んでいます…";
  try {
    const res = await api.post("/api/project/fonts/add", {});
    apply(res);
    if (res.added?.length) {
      const fams = store.projectFonts.filter((f) => res.added.includes(f.file)).flatMap((f) => f.families);
      toast(fams.length ? `追加しました: ${fams.join("・")}` : "追加しましたが、フォントとして読めませんでした。", fams.length ? "" : "warn", 5000);
    }
  } catch (e) {
    toast(e.message, "error", 6000);
  } finally {
    if ($("pf-add")) { $("pf-add").disabled = false; $("pf-add").textContent = "＋ フォントを追加…"; }
  }
}

export function setupProjectFonts() {
  let folder = null; // 元に戻す・やり直すでは、読み直さない（同じプロジェクト）
  on("project-loaded", () => {
    const f = store.folder;
    if (f !== folder) { folder = f; loadProjectFonts(); }
  });
  on("load-project", () => { folder = null; });
  on("fonts-changed", () => {
    const sel = $("pj-font");
    if (sel && sel.options.length) { const v = sel.value; sel.innerHTML = fontOptionsHtml(v); sel.value = v; }
  });
}
