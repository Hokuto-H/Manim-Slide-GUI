// 発表の録画: マイク・カメラの設定と、録画した動画の一覧（動画にする・開く・消す）。
// 録画そのものは発表ウィンドウで行う（Ctrl+R）。終わった録画は、操作アプリが自動で mp4 にする。

import { api } from "./api.js";
import { escapeHtml, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let saveFn = null;
let settings = null;
let devices = null;
let timer = null;
let known = new Map(); // 録画の名前 → 前に見た状態（終わったときに知らせる）

const STATUS = {
  recording: "録画中",
  queued: "動画にする順番待ち",
  running: "動画にしています",
  done: "動画にしました",
  error: "動画にできませんでした",
  cancelled: "動画にするのをやめました",
  missing: "動画のファイルがありません",
};

const fmtTime = (s) => {
  if (s == null) return "";
  s = Math.round(s);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtDate = (s) => (s ? s.replace("T", " ").slice(0, 16) : "");

function devOptions(sel, list, id, name) {
  const opts = [`<option value="">いつも使うもの（パソコンの既定）</option>`];
  let found = !id && !name;
  for (const d of list ?? []) {
    const on = d.id === id || (!found && d.name === name);
    if (on) found = true;
    opts.push(`<option value="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}"${on ? " selected" : ""}>${escapeHtml(d.name)}${d.default ? "（既定）" : ""}</option>`);
  }
  if (!found) opts.push(`<option value="${escapeHtml(id)}" data-name="${escapeHtml(name)}" selected>${escapeHtml(name || id)}（今は見つかりません）</option>`);
  sel.innerHTML = opts.join("");
}

function drawSettings() {
  const s = settings;
  $("rc-mic").checked = s.mic;
  $("rc-cam").checked = s.camera;
  devOptions($("rc-mic-dev"), devices?.mics, s.micId, s.micName);
  devOptions($("rc-cam-dev"), devices?.cams, s.camId, s.camName);
  $("rc-mic-dev").disabled = !s.mic;
  $("rc-cam-dev").disabled = !s.camera;
  $("rc-corner").value = s.camCorner;
  const size = ["0.18", "0.25", "0.33"].reduce((a, b) => (Math.abs(b - s.camSize) < Math.abs(a - s.camSize) ? b : a));
  $("rc-size").value = size;
  $("rc-round").checked = s.camRound;
  $("rc-slide").checked = s.slideSound;
  $("rc-slidevol").value = s.slideVol;
  $("rc-micvol").value = s.micVol;
  $("rc-slidevol-v").textContent = `${Math.round(s.slideVol * 100)}%`;
  $("rc-micvol-v").textContent = `${Math.round(s.micVol * 100)}%`;
  $("rc-slidevol").disabled = !s.slideSound;
  if (devices && !devices.ok) $("rc-dev-note").textContent = devices.message || "";
  else if (devices) $("rc-dev-note").textContent = `マイク ${devices.mics.length} 個・カメラ ${devices.cams.length} 個が見つかりました。`;
}

async function saveSettings() {
  const pick = (sel) => { const o = sel.selectedOptions[0]; return { id: o?.value ?? "", name: o?.dataset.name ?? "" }; };
  const mic = pick($("rc-mic-dev")), cam = pick($("rc-cam-dev"));
  try {
    settings = await api.post("/api/record/settings", {
      mic: $("rc-mic").checked, micId: mic.id, micName: mic.name,
      camera: $("rc-cam").checked, camId: cam.id, camName: cam.name,
      camCorner: $("rc-corner").value, camSize: Number($("rc-size").value), camRound: $("rc-round").checked,
      slideSound: $("rc-slide").checked, slideVol: Number($("rc-slidevol").value), micVol: Number($("rc-micvol").value),
    });
  } catch (e) {
    toast(e.message || String(e), "error");
  }
  drawSettings();
}

async function loadDevices() {
  $("rc-dev-note").textContent = "マイク・カメラを調べています…";
  devices = await api.get("/api/record/devices").catch((e) => ({ ok: false, mics: [], cams: [], message: e.message }));
  drawSettings();
}

function itemHtml(it) {
  const st = STATUS[it.status] ?? it.status;
  const busy = it.status === "running";
  const parts = [];
  if (it.duration != null) parts.push(`長さ ${fmtTime(it.duration)}`);
  if (it.video) parts.push(`動画 ${fmtSize(it.videoSize)}`);
  if (it.raw) parts.push(`元の記録 ${fmtSize(it.rawSize)}`);
  if (it.mic) parts.push(`マイク: ${escapeHtml(it.mic)}`);
  if (it.camera) parts.push(`カメラ: ${escapeHtml(it.camera)}`);
  const msg = it.status === "running" ? escapeHtml(it.message || "")
    : it.crashed ? "発表ウィンドウが途中で閉じたため、記録が残っている所までを動画にしました。"
    : (it.status === "error" || it.status === "missing" || it.status === "cancelled") ? escapeHtml(it.message || "") : "";
  const btn = (a, label, extra = "", cls = "small") => `<button type="button" class="${cls}" data-rc="${a}" data-id="${escapeHtml(it.id)}" ${extra}>${label}</button>`;
  const actions = [];
  if (it.video && !busy) actions.push(btn("play", "▶ 見る"));
  if (it.video) actions.push(btn("show", "場所を開く"));
  if (busy) actions.push(btn("cancel", "やめる"));
  else if (it.raw && it.status !== "recording") actions.push(btn("compose", it.video ? "動画にし直す" : "動画にする", `title="今の「動画にするときの設定」で作り直します"`));
  if (it.raw && it.video && !busy && it.status !== "recording") actions.push(btn("drop-raw", "元の記録を消す", `title="動画だけを残します（動画にし直すことはできなくなります）"`));
  if (it.status !== "recording") actions.push(btn("delete", "削除", "", "small danger"));
  return `<li class="rc-item st-${it.status}">
    <div class="rc-top"><b>${escapeHtml(fmtDate(it.created))}</b> <span class="rc-name">${escapeHtml(it.id)}</span>
      <span class="rc-st">${st}${busy ? ` ${Math.round(it.progress * 100)}%` : ""}</span></div>
    ${busy ? `<progress max="1" value="${it.progress}"></progress>` : ""}
    <div class="rc-meta">${parts.join(" ／ ")}</div>
    ${msg ? `<div class="rc-msg">${msg}</div>` : ""}
    <div class="rc-actions">${actions.join("")}</div>
  </li>`;
}

async function refresh(notify = true) {
  let r;
  try {
    r = await api.get("/api/recordings");
  } catch {
    return null;
  }
  // 動画にし終わったら知らせる
  for (const it of r.items) {
    const before = known.get(it.id);
    if (notify && before && before !== it.status) {
      if (it.status === "done") toast(`録画を動画にしました（${it.video}）。「● 録画」から見られます。`);
      else if (it.status === "error") toast(`録画を動画にできませんでした: ${it.message}`, "error", 8000);
      else if (it.status === "running" && before === "recording") toast("録画を動画にしています…");
    }
    known.set(it.id, it.status);
  }
  const btn = $("btn-record");
  const active = r.items.some((it) => it.status === "running" || it.status === "queued");
  const rec = r.items.some((it) => it.status === "recording");
  btn.classList.toggle("rc-busy", active || rec);
  btn.textContent = rec ? "● 録画（録画中）" : active ? "● 録画（動画にしています…）" : "● 録画";
  if ($("dlg-record").open) {
    $("rc-list").innerHTML = r.items.length ? r.items.map(itemHtml).join("")
      : `<li class="rc-empty">まだ録画はありません。発表ウィンドウを開いて Ctrl+R を押すと録画を始めます。</li>`;
  }
  return r;
}

function poll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (document.querySelector("[data-needs-project]:not([disabled])")) await refresh();
    poll();
  }, $("dlg-record").open ? 1000 : 3000);
}

export async function openRecord() {
  try {
    settings = await api.get("/api/record/settings");
  } catch (e) {
    toast(e.message || String(e), "error");
    return;
  }
  drawSettings();
  $("rc-list").innerHTML = `<li class="rc-empty">読み込んでいます…</li>`;
  $("dlg-record").showModal();
  refresh(false);
  if (!devices) loadDevices();
}

async function act(a, id) {
  try {
    if (a === "play") await api.post("/api/recordings/open", { id, what: "video" });
    else if (a === "show") await api.post("/api/recordings/open", { id, what: "folder" });
    else if (a === "compose") { const r = await api.post("/api/recordings/compose", { id }); if (!r.ok) toast(r.message, "error"); }
    else if (a === "cancel") await api.post("/api/recordings/cancel", { id });
    else if (a === "drop-raw") {
      if (!confirm("元の記録（マイク・カメラの録音と、発表の記録）を消して、動画だけを残します。\nあとから設定を変えて動画にし直すことはできなくなります。消しますか？")) return;
      const r = await api.post("/api/recordings/delete", { id, keepVideo: true });
      if (!r.ok) toast(r.message, "error");
    } else if (a === "delete") {
      if (!confirm(`録画「${id}」を削除します（動画と元の記録の両方）。元に戻せません。削除しますか？`)) return;
      const r = await api.post("/api/recordings/delete", { id, keepVideo: false });
      if (!r.ok) toast(r.message, "error");
    }
  } catch (e) {
    toast(e.message || String(e), "error");
  }
  refresh(false);
}

export function setupRecord(save) {
  saveFn = save;
  for (const id of ["rc-mic", "rc-cam", "rc-mic-dev", "rc-cam-dev", "rc-corner", "rc-size", "rc-round", "rc-slide", "rc-slidevol", "rc-micvol"]) {
    $(id).addEventListener("change", saveSettings);
  }
  for (const [id, out] of [["rc-slidevol", "rc-slidevol-v"], ["rc-micvol", "rc-micvol-v"]]) {
    $(id).addEventListener("input", () => { $(out).textContent = `${Math.round($(id).value * 100)}%`; });
  }
  $("rc-refresh").addEventListener("click", loadDevices);
  $("rc-folder").addEventListener("click", () => api.post("/api/recordings/open", { what: "folder" }).catch((e) => toast(e.message, "error")));
  $("rc-present").addEventListener("click", async () => {
    if (saveFn && !(await saveFn())) return;
    $("dlg-record").close();
    $("btn-present").click();
  });
  $("rc-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rc]");
    if (b) act(b.dataset.rc, b.dataset.id);
  });
  poll();
}
