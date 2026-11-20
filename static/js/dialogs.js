// ダイアログ: 新規プロジェクト（F19）、プロジェクト設定（F20）、開く、共通プリアンブル（F4）、環境チェック（F16）。

import { bindRecentActions, recentRow } from "./projdelete.js";
import { DEFAULT_THEOREMS, KINDS, theoremStyles } from "./refs.js";
import { api } from "./api.js";
import { createCodeEditor } from "./codeedit.js";
import { contrastRatio, emit, escapeHtml, fontInstalled, fontNoteText, fontOptionsHtml, fontPresetFor, markDirty, normalizeHex, store, suggestTextColor, toast } from "./store.js";

const $ = (id) => document.getElementById(id);

async function ensureFonts() {
  if (!store.fonts) {
    try { store.fonts = await api.get("/api/fonts"); } catch { store.fonts = { presets: [], source: "none" }; }
  }
  return store.fonts;
}

const fontOptions = (selected) => fontOptionsHtml(selected);

function defaultFontFamily() {
  const presets = store.fonts?.presets ?? [];
  // 既定はゴシック系。導入済みのゴシック系を優先する
  for (const id of ["noto-sans-jp", "biz-ud-gothic", "ipaex-gothic"]) {
    const p = presets.find((x) => x.id === id);
    if (p?.installed) return p.family;
  }
  return presets[0]?.family || "Noto Sans JP";
}

// ================================================================ 新規作成・プロジェクト設定

let pjMode = "new";
let colorTouched = false;
let nameTimer = null;

export async function openProjectDialog(mode) {
  pjMode = mode;
  await ensureFonts();
  const dlg = $("dlg-project");
  dlg.classList.toggle("mode-new", mode === "new");
  dlg.classList.toggle("mode-settings", mode === "settings");
  $("dlg-project-title").textContent = mode === "new" ? "新規プロジェクト" : "プロジェクト設定";
  $("pj-ok").textContent = mode === "new" ? "作成" : "変更";
  $("pj-error").textContent = "";
  colorTouched = mode === "settings";

  let s;
  if (mode === "new") {
    const cfg = await api.get("/api/userconfig").catch(() => ({}));
    s = { ...store.meta.defaults, defaultFont: defaultFontFamily() };
    $("pj-name").value = "";
    $("pj-name").disabled = false;
    $("pj-parent").value = cfg.lastDir || "";
    const hasTpl = typeof cfg.templatePreamble === "string";
    $("pj-pre-template").disabled = !hasTpl;
    document.querySelector(`input[name=pj-pre][value=${hasTpl ? "template" : "empty"}]`).checked = true;
    $("pj-pre-template").parentElement.title = hasTpl ? "" : "定番テンプレートはまだ保存されていません（共通プリアンブルの画面で保存できます）";
    $("pj-pre-preview").dataset.tpl = hasTpl ? cfg.templatePreamble : "";
    updatePreamblePreview();
    $("pj-name-note").textContent = "フォルダ名になります。";
    $("pj-name-note").className = "field-note";
  } else {
    s = { ...store.project.settings };
    $("pj-name").value = s.name;
    $("pj-name").disabled = true;
    $("pj-name-note").textContent = `フォルダ名は変更できません（クラス名: ${s.className}）。`;
    $("pj-name-note").className = "field-note";
  }
  $("pj-bg").value = s.background;
  $("pj-bg-hex").value = s.background;
  $("pj-font").innerHTML = fontOptions(s.defaultFont);
  $("pj-refnum").value = s.refNumbering ?? "chapter";
  $("pj-prooftitle").value = s.proofTitle || "{対象} の{証明}";
  $("pj-texfont").value = s.texFont === "sans" ? "sans" : "serif";
  $("pj-autotitle").checked = s.autoTitle !== false;
  const thm = theoremStyles({ settings: s });
  $("pj-thm").innerHTML = KINDS.map((k) => `<div class="row"><span class="unit thm-kind">${{ definition: "定義", theorem: "定理", lemma: "補題", corollary: "系", proposition: "命題", example: "例", remark: "注意", proof: "証明" }[k]}</span>
    <input data-thm="${k}" value="${escapeHtml(thm[k].label)}" maxlength="20" style="width:7em"><input type="color" data-thm-color="${k}" value="${thm[k].color.toLowerCase()}"></div>`).join("");
  $("pj-size").value = s.defaultFontSize;
  $("pj-scale").value = s.fontSizeScale ?? 1;
  $("pj-use3d").checked = !!s.use3d;
  $("pj-depth3d").value = ["scene", "depth", "layer"].includes(s.view3d) ? s.view3d : "scene";
  const pn = s.pageNumbers ?? {};
  $("pj-pn").checked = !!pn.enabled;
  $("pj-pn-pos").value = pn.position ?? "br";
  $("pj-pn-fmt").value = pn.format ?? "n";
  $("pj-pn-size").value = pn.fontSize ?? 24;
  $("pj-pn-same").checked = !pn.color;
  $("pj-pn-color").oninput = () => { $("pj-pn-same").checked = false; };
  $("pj-pn-color").value = (pn.color || s.defaultColor || "#222222").toLowerCase();
  const sc = s.sections ?? {};
  $("pj-sec-disp").value = sc.display ?? "none";
  $("pj-sec-pos").value = sc.position ?? "tl";
  $("pj-sec-bar").value = sc.bar ?? "top";
  $("pj-sec-size").value = sc.fontSize ?? 20;
  $("pj-sec-same").checked = !sc.color;
  $("pj-sec-color").oninput = () => { $("pj-sec-same").checked = false; };
  $("pj-sec-color").value = (sc.color || s.defaultColor || "#222222").toLowerCase();
  $("pj-sec-barcolor").value = (sc.barColor || "#58C4DD").toLowerCase();
  setColor(mode === "new" ? suggestTextColor(s.background) : s.defaultColor);
  updateFontNote();
  themePreamble = null;
  $("pj-pre-theme-row").hidden = true;
  $("pj-tpl-note").textContent = "選ぶと、背景色・フォント・文字サイズ・文字色・ページ番号など（と共通プリアンブル）を、下の欄に入れます。";
  await loadTemplateList("");
  dlg.showModal();
  // 開き直したときは一番上から（前に「決定」「キャンセル」のために下までスクロールした位置を残さない）
  dlg.scrollTop = 0;
  dlg.querySelectorAll("form, .dlg-scroll").forEach((x) => { x.scrollTop = 0; });
  if (mode === "new") $("pj-name").focus();
}

function setColor(c) {
  $("pj-color").value = c;
  $("pj-color-hex").value = c.toUpperCase();
  updateColorNote();
}

function updateColorNote() {
  const r = contrastRatio($("pj-color-hex").value, $("pj-bg-hex").value);
  const note = $("pj-color-note");
  note.textContent = `背景とのコントラスト比 ${r.toFixed(1)} : 1${r < 4.5 ? "（読みにくい可能性があります）" : ""}`;
  note.className = `field-note${r < 4.5 ? " warn" : ""}`;
}

function updateFontNote() {
  const fam = $("pj-font").value;
  const p = fontPresetFor(fam);
  const note = $("pj-font-note");
  const warn = fontNoteText(fam);
  if (warn) {
    note.textContent = warn;
    note.className = `field-note${p?.installed === false || !p && fontInstalled(fam) === false ? " warn" : ""}`;
  } else {
    // プリセットの別の候補の名前なら、この PC で使う名前を出す（プロジェクトの値は書き換えない）
    note.textContent = p ? (p.family !== fam ? `この PC では「${p.family}」で描きます（同じ書体の別名）。` : `描画に使う名前: ${p.family}`) : "";
    note.className = "field-note";
  }
}

function updatePreamblePreview() {
  const v = document.querySelector("input[name=pj-pre]:checked")?.value;
  $("pj-pre-preview").textContent = v === "template" ? $("pj-pre-preview").dataset.tpl || "" : v === "theme" ? themePreamble ?? "" : "";
}

// ---------------------------------------------------------------- 設定のテンプレート

let themePreamble = null; // 選んだテンプレートの共通プリアンブル（無ければ null）

async function loadTemplateList(selected = "") {
  const r = await api.get("/api/templates").catch(() => ({ settings: [] }));
  $("pj-tpl").innerHTML = `<option value="">（使わない）</option>` + r.settings.map((t) => `<option value="${escapeHtml(t.name)}" ${t.name === selected ? "selected" : ""}>${escapeHtml(t.name)}${t.hasPreamble ? "（プリアンブル付き）" : ""}</option>`).join("");
  $("pj-tpl-del").disabled = !$("pj-tpl").value;
}

/** テンプレートの設定を、ダイアログの欄に入れる。 */
async function applyTemplate(name) {
  themePreamble = null;
  $("pj-tpl-del").disabled = !name;
  $("pj-pre-theme-row").hidden = true;
  if (!name) { updatePreamblePreview(); return; }
  const t = await api.post("/api/templates/settings/get", { name });
  const s = t.settings ?? {};
  if (s.background) { $("pj-bg").value = s.background.toLowerCase(); $("pj-bg-hex").value = s.background; }
  if (s.defaultFont) $("pj-font").innerHTML = fontOptions(s.defaultFont);
  if (s.defaultFontSize) $("pj-size").value = s.defaultFontSize;
  if (s.fontSizeScale) $("pj-scale").value = s.fontSizeScale;
  if (s.use3d !== undefined) $("pj-use3d").checked = !!s.use3d;
  if (s.defaultColor) { colorTouched = true; setColor(s.defaultColor); }
  const pn = s.pageNumbers;
  if (pn) {
    $("pj-pn").checked = !!pn.enabled;
    $("pj-pn-pos").value = pn.position ?? "br";
    $("pj-pn-fmt").value = pn.format ?? "n";
    $("pj-pn-size").value = pn.fontSize ?? 24;
    $("pj-pn-same").checked = !pn.color;
    if (pn.color) $("pj-pn-color").value = pn.color.toLowerCase();
  }
  updateFontNote();
  if (typeof t.preamble === "string") {
    themePreamble = t.preamble;
    $("pj-pre-theme-row").hidden = pjMode !== "new";
    if (pjMode === "new") $("pj-pre-theme").checked = true;
  }
  updatePreamblePreview();
  $("pj-tpl-note").textContent = `「${name}」の設定を入れました${typeof t.preamble === "string" ? (pjMode === "new" ? "（共通プリアンブルも、テンプレートのものにします）" : "（「変更」を押すと、共通プリアンブルをテンプレートのものに置き換えるか確かめます）") : ""}。`;
}

function formSettings() {
  return {
    background: normalizeHex($("pj-bg-hex").value) || "#FFFFFF",
    defaultFont: $("pj-font").value,
    defaultFontSize: Number($("pj-size").value) || 48,
    defaultColor: normalizeHex($("pj-color-hex").value) || "#222222",
    fontSizeScale: Number($("pj-scale").value) > 0 ? Number($("pj-scale").value) : 1,
    use3d: $("pj-use3d").checked,
    texFont: $("pj-texfont").value,
    pageNumbers: {
      ...(store.project?.settings?.pageNumbers ?? {}),
      enabled: $("pj-pn").checked, position: $("pj-pn-pos").value, format: $("pj-pn-fmt").value,
      fontSize: Number($("pj-pn-size").value) > 0 ? Number($("pj-pn-size").value) : 24,
      color: $("pj-pn-same").checked ? null : $("pj-pn-color").value.toUpperCase(),
    },
    sections: {
      display: $("pj-sec-disp").value, position: $("pj-sec-pos").value, bar: $("pj-sec-bar").value,
      fontSize: Number($("pj-sec-size").value) > 0 ? Number($("pj-sec-size").value) : 20,
      color: $("pj-sec-same").checked ? null : $("pj-sec-color").value.toUpperCase(), barColor: $("pj-sec-barcolor").value.toUpperCase(),
    },
  };
}

function setupTemplateControls() {
  $("pj-tpl").addEventListener("change", (e) => applyTemplate(e.target.value).catch((err) => { $("pj-error").textContent = err.message; }));
  $("pj-tpl-save").addEventListener("click", async () => {
    const name = prompt("テンプレートの名前（同じ名前があれば上書きします）", $("pj-tpl").value || "");
    if (!name) return;
    // 共通プリアンブル: 設定の画面ではプロジェクトのもの、新規作成では選んでいる始め方のもの
    const v = document.querySelector("input[name=pj-pre]:checked")?.value;
    const pre = pjMode === "settings" ? store.preamble : v === "template" ? $("pj-pre-preview").dataset.tpl || "" : v === "theme" ? themePreamble : "";
    try {
      await api.post("/api/templates/settings", { name, settings: formSettings(), preamble: pre });
      await loadTemplateList(name);
      toast(`テンプレート「${name}」を保存しました。`);
    } catch (err) { $("pj-error").textContent = err.message; }
  });
  $("pj-tpl-del").addEventListener("click", async () => {
    const name = $("pj-tpl").value;
    if (!name || !confirm(`テンプレート「${name}」を削除しますか？`)) return;
    await api.post("/api/templates/delete", { kind: "settings", name }).catch((err) => { $("pj-error").textContent = err.message; });
    await loadTemplateList("");
    themePreamble = null;
    $("pj-pre-theme-row").hidden = true;
  });
}

function setupProjectDialog() {
  setupTemplateControls();
  const bgChanged = (v) => {
    const h = normalizeHex(v);
    if (!h) return;
    $("pj-bg").value = h;
    $("pj-bg-hex").value = h;
    if (!colorTouched) setColor(suggestTextColor(h));
    updateColorNote();
  };
  $("pj-bg").addEventListener("input", (e) => bgChanged(e.target.value));
  $("pj-bg-hex").addEventListener("change", (e) => bgChanged(e.target.value));
  $("pj-color").addEventListener("input", (e) => { colorTouched = true; setColor(e.target.value); });
  $("pj-color-hex").addEventListener("change", (e) => {
    const h = normalizeHex(e.target.value);
    if (h) { colorTouched = true; setColor(h); } else $("pj-color-hex").value = $("pj-color").value.toUpperCase();
  });
  $("pj-color-suggest").addEventListener("click", () => { colorTouched = false; setColor(suggestTextColor($("pj-bg-hex").value)); });
  $("pj-font").addEventListener("change", updateFontNote);
  document.querySelectorAll("input[name=pj-pre]").forEach((r) => r.addEventListener("change", updatePreamblePreview));
  $("pj-browse").addEventListener("click", async () => {
    try {
      const r = await api.post("/api/dialog/folder", { initial: $("pj-parent").value, title: "保存先のフォルダを選択" });
      if (r.path) { $("pj-parent").value = r.path; validateName(); }
    } catch (e) { $("pj-error").textContent = e.message; }
  });
  const validateName = () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      if (pjMode !== "new") return;
      const name = $("pj-name").value;
      if (!name.trim()) { $("pj-name-note").textContent = "フォルダ名になります。"; $("pj-name-note").className = "field-note"; return; }
      const r = await api.post("/api/project/validate-name", { name, parent: $("pj-parent").value }).catch(() => null);
      if (!r) return;
      const note = $("pj-name-note");
      if (!r.ok) { note.textContent = r.message; note.className = "field-note ng"; return; }
      note.textContent = r.exists ? "同じ名前のフォルダが既にあります（空のフォルダなら使えます）。" : `クラス名: ${r.className}`;
      note.className = `field-note${r.exists ? " warn" : ""}`;
    }, 200);
  };
  $("pj-name").addEventListener("input", validateName);
  $("pj-parent").addEventListener("change", validateName);

  $("form-project").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const settings = {
      name: $("pj-name").value.trim(),
      background: normalizeHex($("pj-bg-hex").value) || "#FFFFFF",
      defaultFont: $("pj-font").value,
      defaultFontSize: Number($("pj-size").value) || 48,
      defaultColor: normalizeHex($("pj-color-hex").value) || "#222222",
      texFont: $("pj-texfont").value === "sans" ? "sans" : "serif", // LaTeX で組む文字の書体（新規作成・設定の変更の両方で使う）
      pageNumbers: {
        ...(store.project?.settings?.pageNumbers ?? {}),
        enabled: $("pj-pn").checked, position: $("pj-pn-pos").value, format: $("pj-pn-fmt").value,
        fontSize: Number($("pj-pn-size").value) > 0 ? Number($("pj-pn-size").value) : 24,
        color: $("pj-pn-same").checked ? null : $("pj-pn-color").value.toUpperCase(),
      },
      sections: {
      display: $("pj-sec-disp").value, position: $("pj-sec-pos").value, bar: $("pj-sec-bar").value,
      fontSize: Number($("pj-sec-size").value) > 0 ? Number($("pj-sec-size").value) : 20,
      color: $("pj-sec-same").checked ? null : $("pj-sec-color").value.toUpperCase(), barColor: $("pj-sec-barcolor").value.toUpperCase(),
    },
    };
    $("pj-error").textContent = "";
    if (pjMode === "new") {
      const v = document.querySelector("input[name=pj-pre]:checked")?.value;
      const fs = formSettings();
      try {
        const body = {
          parent: $("pj-parent").value.trim(), settings: { ...settings, fontSizeScale: fs.fontSizeScale, use3d: fs.use3d },
          preamble: v === "template" ? $("pj-pre-preview").dataset.tpl || "" : v === "theme" ? themePreamble ?? "" : "",
        };
        let payload;
        try {
          payload = await api.post("/api/project/new", body);
        } catch (e) {
          // 保存先のフォルダが無いときは、作るかを聞く
          if (!String(e.message).includes("保存先のフォルダが見つかりません")) throw e;
          if (!confirm(`保存先のフォルダがありません。\n${body.parent}\nこのフォルダを作って、その中にプロジェクトを作りますか？`)) throw e;
          payload = await api.post("/api/project/new", { ...body, makeParent: true });
        }
        $("dlg-project").close();
        emit("load-project", payload);
        toast(`プロジェクトを作成しました: ${payload.folder}`);
      } catch (err) {
        $("pj-error").textContent = err.message;
      }
    } else {
      const s = store.project.settings;
      const scale = Number($("pj-scale").value);
      const bgChangedNow = s.background !== settings.background;
      const texFontChanged = (s.texFont ?? "serif") !== settings.texFont;
      Object.assign(s, {
        background: settings.background, defaultFont: settings.defaultFont,
        defaultFontSize: settings.defaultFontSize, defaultColor: settings.defaultColor,
        fontSizeScale: scale > 0 ? scale : 1, pageNumbers: settings.pageNumbers, sections: settings.sections,
        refNumbering: $("pj-refnum").value,
        proofTitle: ($("pj-prooftitle").value.trim() || "{対象} の{証明}").slice(0, 40),
        texFont: settings.texFont,
        autoTitle: $("pj-autotitle").checked,
        theorems: Object.fromEntries(KINDS.map((k) => [k, {
          label: document.querySelector(`[data-thm="${k}"]`)?.value.trim() || DEFAULT_THEOREMS[k].label,
          color: (document.querySelector(`[data-thm-color="${k}"]`)?.value || DEFAULT_THEOREMS[k].color).toUpperCase(),
        }])),
      });
      const use3dChanged = !!s.use3d !== $("pj-use3d").checked || (s.view3d ?? "scene") !== $("pj-depth3d").value;
      s.use3d = $("pj-use3d").checked;
      s.view3d = $("pj-depth3d").value;
      $("dlg-project").close();
      markDirty("settings");
      emit("settings-changed", { background: bgChangedNow, use3d: use3dChanged, texFont: texFontChanged });
      // テンプレートの共通プリアンブル
      if (typeof themePreamble === "string" && themePreamble !== store.preamble
        && confirm("共通プリアンブルも、テンプレートのものに置き換えますか？（今のプリアンブルは消えます）")) {
        try {
          const r = await api.put("/api/preamble", { text: themePreamble, test: true });
          await applyPreambleResult(r);
          toast(r.test?.ok ? "共通プリアンブルを置き換えました。" : "共通プリアンブルを置き換えました（テスト描画でエラーがあります）。", r.test?.ok ? "" : "warn");
        } catch (err) { toast(err.message, "ng", 6000); }
      }
    }
  });
}

// ================================================================ 開く

export async function openOpenDialog() {
  const cfg = await api.get("/api/userconfig").catch(() => ({}));
  $("op-error").textContent = "";
  $("op-folder").value = cfg.recentProjects?.[0] || "";
  drawOpenRecent(cfg.recentProjects || []);
  $("dlg-open").showModal();
}

function drawOpenRecent(list) {
  $("op-recent").innerHTML = list.length ? list.map((p) => recentRow(p)).join("") : `<li class="hint">最近のプロジェクトはありません。</li>`;
}

export async function refreshOpenRecent() {
  if (!$("dlg-open").open) return;
  const cfg = await api.get("/api/userconfig").catch(() => ({}));
  const list = cfg.recentProjects || [];
  if (!list.includes($("op-folder").value)) $("op-folder").value = list[0] || "";
  drawOpenRecent(list);
}

export async function openProjectAt(folder) {
  const payload = await api.post("/api/project/open", { folder });
  emit("load-project", payload);
  return payload;
}

function setupOpenDialog() {
  bindRecentActions($("op-recent"));
  $("op-recent").addEventListener("click", (e) => {
    const b = e.target.closest("[data-path]");
    if (b) $("op-folder").value = b.dataset.path;
  });
  $("op-recent").addEventListener("dblclick", (e) => {
    const b = e.target.closest("[data-path]");
    if (b) $("form-open").requestSubmit($("form-open").querySelector("button.primary"));
  });
  $("op-browse").addEventListener("click", async () => {
    try {
      const r = await api.post("/api/dialog/folder", { initial: $("op-folder").value, title: "プロジェクトのフォルダを選択" });
      if (r.path) $("op-folder").value = r.path;
    } catch (e) { $("op-error").textContent = e.message; }
  });
  $("form-open").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    try {
      await openProjectAt($("op-folder").value.trim());
      $("dlg-open").close();
    } catch (err) {
      $("op-error").textContent = err.message;
    }
  });
}

// ================================================================ 共通プリアンブル（F4）

let preEditor = null;
let preSaved = "";

export function openPreambleDialog(focusLine = null) {
  preSaved = store.preamble;
  preEditor.value = store.preamble;
  preEditor.setErrorLine(focusLine);
  showPreambleInfo(null);
  $("dlg-preamble").showModal();
  if (focusLine) setTimeout(() => preEditor.revealLine(focusLine), 50);
  else preEditor.textarea.focus();
}

function showPreambleInfo(test) {
  const box = $("pre-result");
  const parts = [];
  if (test) {
    if (test.ok) parts.push(`<div class="ok">XeLaTeX のテスト描画に成功しました。</div>`);
    else {
      parts.push(`<div class="note-ng"><b>XeLaTeX のテスト描画でエラーが見つかりました。</b></div><ul>` + test.errors.map((e) =>
        `<li class="note-ng">${e.line ? `<b>${e.line}行目${e.guessed ? "（推定）" : ""}:</b> ` : ""}${escapeHtml(e.message)}${e.context ? ` <code>${escapeHtml(e.context)}</code>` : ""}</li>`).join("") + "</ul>");
    }
  }
  const un = store.macros?.unsupported ?? [];
  const mw = store.mathWarnings ?? [];
  if (un.length || mw.length) {
    parts.push(`<div class="note-warn">仮表示では展開できません（描画には反映されます）:</div><ul>` +
      un.map((u) => `<li class="note-warn">${u.line}行目: <code>${escapeHtml(u.text)}</code> — ${escapeHtml(u.reason)}</li>`).join("") +
      mw.map((w) => `<li class="note-warn">${w.line ?? "?"}行目: <code>\\${escapeHtml(w.name)}</code> — ${escapeHtml(w.message)}</li>`).join("") + "</ul>");
  }
  const n = Object.keys(store.macros?.macros ?? {}).length;
  if (n) parts.push(`<div class="hint">仮表示に使うマクロ: ${n} 個（${Object.keys(store.macros.macros).map((k) => "\\" + escapeHtml(k)).join(" ")}）</div>`);
  box.innerHTML = parts.join("");
}

async function applyPreambleResult(r) {
  store.preamble = r.text;
  store.macros = r.macros;
  preSaved = r.text;
  emit("preamble-changed");
}

function setupPreambleDialog() {
  preEditor = createCodeEditor({ rows: 14, placeholder: "\\newcommand{\\R}{\\mathbb{R}}" });
  $("pre-editor").appendChild(preEditor.el);
  $("pre-save").addEventListener("click", async () => {
    const btn = $("pre-save");
    btn.disabled = true;
    $("pre-result").innerHTML = `<span class="spinner"></span> 保存して XeLaTeX でテスト描画しています…`;
    try {
      const r = await api.put("/api/preamble", { text: preEditor.value, test: true });
      await applyPreambleResult(r);
      await store.macrosApplied;
      const firstLine = r.test?.errors?.find((e) => e.line)?.line ?? null;
      preEditor.setErrorLine(firstLine);
      if (firstLine) preEditor.revealLine(firstLine);
      showPreambleInfo(r.test);
      toast(r.test?.ok ? "共通プリアンブルを保存しました。" : "保存しました（テスト描画でエラーがあります）。", r.test?.ok ? "" : "warn");
    } catch (e) {
      $("pre-result").innerHTML = `<span class="note-ng">${escapeHtml(e.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  });
  $("pre-reload").addEventListener("click", async () => {
    if (preEditor.value !== preSaved && !confirm("編集中の内容を破棄して、preamble.tex を読み込み直しますか？")) return;
    try {
      const r = await api.get("/api/preamble");
      preEditor.value = r.text;
      preEditor.setErrorLine(null);
      await applyPreambleResult(r);
      await store.macrosApplied;
      showPreambleInfo(null);
      toast("preamble.tex を読み込み直しました。");
    } catch (e) { toast(e.message, "ng"); }
  });
  $("pre-save-template").addEventListener("click", async () => {
    if (!confirm("この内容を、新規プロジェクトで使う定番テンプレートとして保存しますか？（以前の定番テンプレートは上書きされます）")) return;
    try {
      await api.put("/api/userconfig", { templatePreamble: preEditor.value });
      toast("定番テンプレートとして保存しました。");
    } catch (e) { toast(e.message, "ng"); }
  });
  $("dlg-preamble").addEventListener("cancel", (e) => {
    if (preEditor.value !== preSaved && !confirm("保存していない変更があります。閉じますか？")) e.preventDefault();
  });
  $("form-preamble").addEventListener("submit", (e) => {
    if (preEditor.value !== preSaved && !confirm("保存していない変更があります。閉じますか？")) e.preventDefault();
  });
}

// ================================================================ 環境チェック（F16）

export async function runEnvCheck(refresh = false) {
  setEnvBadge(null);
  $("env-summary").innerHTML = `<span class="spinner"></span> 確認しています…（XeLaTeX の実際のコンパイルを含むため、初回は時間がかかることがあります）`;
  $("env-summary").className = "env-summary";
  try {
    const env = await api.get(`/api/env/check${refresh ? "?refresh=true" : ""}`);
    store.env = env;
    if (refresh) store.fonts = null;
    await ensureFonts();
    renderEnv(env);
    emit("env-changed", env);
    return env;
  } catch (e) {
    $("env-summary").textContent = e.message;
    setEnvBadge(false);
    return null;
  }
}

function setEnvBadge(ok) {
  const b = $("env-badge");
  if (ok === null) { b.className = "badge"; b.innerHTML = `<span class="spinner"></span>`; return; }
  b.className = `badge ${ok ? "ok" : "ng"}`;
  b.textContent = ok ? "OK" : "要確認";
}

function renderEnv(env) {
  setEnvBadge(env.renderReady);
  const sum = $("env-summary");
  sum.className = `env-summary ${env.renderReady ? "ok" : "ng"}`;
  sum.innerHTML = env.renderReady
    ? (env.presentReady ? "描画・発表に必要なものはそろっています。" : "描画はできますが、発表ウィンドウ（Qt）が使えません。")
    : `<b>描画・発表ボタンは使えません。</b> 不足している必須項目: ${env.missing.map(escapeHtml).join("、")}<br><span class="hint">編集と書き出しは使えます。</span>`;
  $("env-rows").innerHTML = env.items.map((i) => {
    const st = i.ok === true ? `<span class="st-ok">✓</span>` : i.ok === false ? `<span class="st-ng">✕</span>` : `<span class="st-na">−</span>`;
    return `<tr><td class="st">${st}</td><td>${escapeHtml(i.label)}${i.required ? `<span class="req">必須</span>` : ""}</td>
      <td class="ver">${escapeHtml(i.version || "")}</td>
      <td>${escapeHtml(i.detail || "")}${i.hint ? `<div class="hint-text">${escapeHtml(i.hint)}</div>` : ""}</td></tr>`;
  }).join("");
  $("env-meta").textContent = `確認日時 ${env.checkedAt}（${env.seconds} 秒）・Python ${env.python}`;
}

export function openEnvDialog() {
  if (store.env) renderEnv(store.env);
  $("dlg-env").showModal();
}

function setupEnvDialog() {
  $("env-recheck").addEventListener("click", () => runEnvCheck(true));
}

export function setupDialogs() {
  setupProjectDialog();
  setupOpenDialog();
  setupPreambleDialog();
  setupEnvDialog();
}
