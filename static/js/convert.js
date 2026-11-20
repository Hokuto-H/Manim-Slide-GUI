// HTML・PDF・PowerPoint への出力（manim-slides convert）。直前の描画結果（slides/）から作る。

import { api } from "./api.js";
import { escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let saveFn = null;
let info = null;
let busy = false;
/** 出力の最中か（窓を閉じる前の確認に使う）。 */
export const convertBusy = () => busy;

const fmt = () => document.querySelector("#dlg-convert input[name=cv-fmt]:checked").value;
const pdfPages = () => document.querySelector("#dlg-convert input[name=cv-pdf]:checked")?.value === "pages";
const LABEL = { html: "HTML", pdf: "PDF", pptx: "PowerPoint", mp4: "動画（mp4）", handout: "配布資料（PDF）", png: "画像（PNG）", gif: "動く画像（GIF）" };
let jobId = null;

function status(text, cls = "") {
  const s = $("cv-status");
  s.textContent = text;
  s.className = `cv-status ${cls}`;
}

/** 形式ごとの注意を並べる。 */
// 配布資料の用紙が横向きか（おまかせでは 4 枚だけ横）
function hoLand() {
  const o = $("cv-ho-orient").value;
  return o === "landscape" || (o === "auto" && $("cv-ho-layout").value === "grid4");
}

function drawNotes() {
  const f = fmt();
  $("cv-onefile").disabled = f !== "html";
  document.querySelectorAll("#dlg-convert input[name=cv-pdf]").forEach((r) => { r.disabled = f !== "pdf"; });
  $("cv-wait").disabled = f !== "mp4";
  $("cv-srt").disabled = f !== "mp4";
  $("cv-srtmode").disabled = f !== "mp4" || !$("cv-srt").checked;
  // 配布資料・PNG・GIF の設定は、選んでいなくても変えられる（変えると、その形式を選んだことにする）
  $("cv-cancel").hidden = !busy;
  const items = [];
  if (!info?.rendered) items.push(["warn", "まだ描画していません。先に「▶ 描画・発表」で描画してください。"]);
  else if (info.stale) items.push(["warn", "描画したあとに内容が変わっています。最新の内容にするには、先に「▶ 描画・発表」で描画し直してください（今のまま出力すると、前に描画した内容になります）。"]);
  if (info?.liveMedia && !["png", "gif"].includes(f)) {
    items.push(["", {
      handout: "「発表で再生」の動画は、その画面の時点のコマ（再生前なら表紙のコマ）を、その位置に入れます。",
      html: "「発表で再生」の動画・音声も入れます。発表ウィンドウと同じく、ステップの操作（再生・止める・音量など）の時刻に動き、再生バー付きの動画はクリックでも操作できます。",
      pdf: "「発表で再生」の動画は、各ページの最後の時点のコマ（再生前なら表紙のコマ）を、その位置に入れます。音声は入りません。",
      pptx: "「発表で再生」の動画・音声も、そのスライドに置きます（クリックで再生。音声は左上の小さな印）。ステップの時刻どおりの自動の再生・音量の操作は入りません。",
      mp4: "「発表で再生」の動画・音声も、発表と同じく、ステップの操作（再生・止める・音量など）の時刻どおりに入ります（操作バーでの手動の再生は入りません）。",
    }[f]]);
  }
  if (f === "html") {
    items.push(["", "reveal.js（ブラウザで発表するための部品）を、出力先のフォルダに一緒に入れます。インターネットにつながっていなくても発表できます。"]);
    if (info?.renderedSlides != null && info.renderedSlides < info.totalSlides) items.push(["", `直前の描画では、${info.totalSlides} 枚のうち ${info.renderedSlides} 枚を描画しました（描画しないスライドは、出力にも入りません）。`]);
    if (info?.loopEdge) items.push(["warn", "最初または最後の区切りが「くり返す」になっています。HTML では、最初と最後の区切りのくり返しはうまく動きません。"]);
    if (!$("cv-onefile").checked) items.push(["", `${escapeHtml(info?.className ?? "")}.html と、${escapeHtml(info?.className ?? "")}_assets フォルダ（動画など）を一緒に持ち運んでください。`]);
  } else if (f === "pdf") {
    items.push(["", pdfPages()
      ? "スライドごとに、最後のステップまで進めた画面を 1 ページにします（スライドの数とページの数が同じになります）。"
      : "ステップ（クリックの区切り）ごとに 1 ページにします。途中の様子も残ります。"]);
    items.push(["", "動き・くり返し・発表者ノートは入りません。"]);
  } else if (f === "handout") {
    const lay = $("cv-ho-layout").value;
    items.push(["", `${$("cv-ho-unit").value === "step" ? "ステップ（クリックの区切り）ごと" : "スライドごとに最後"}の画面を、${$("cv-ho-layout").selectedOptions[0].textContent}ずつ ${$("cv-ho-paper").value} の${hoLand() ? "横" : "縦"}向きの用紙に並べます（上に題名と日付、下にページ番号）。`]);
    if (lay.startsWith("notes")) items.push(["", "ノートは、スライドのノートと、ステップのノート（「（クリック 1）…」のように）を載せます。Markdown の飾りは外します。入りきらないときは文字を小さくし、それでも入らなければ「…（以下略）」にします。"]);
    if (lay.startsWith("memo")) items.push(["", hoLand() ? "スライドの下に、罫線のメモ欄を付けます。" : "スライドの右に、罫線のメモ欄を付けます。"]);
    if (hoLand() && (lay === "notes2" || lay === "notes3")) items.push(["", "横向きでは、スライドを横に並べ、それぞれの下にノートを載せます。"]);
    if (lay === "grid6") items.push(["", hoLand() ? "横 3 列 × 縦 2 段に並べます。" : "横 2 列 × 縦 3 段に並べます。"]);
    items.push(["", "日本語は、このパソコンにある TrueType のフォント（游ゴシック・メイリオ・BIZ UD ゴシックなど）を探して埋め込みます。プロジェクトの既定のフォントが埋め込める形なら、それを使います。"]);
  } else if (f === "png" || f === "gif") {
    items.push(["", f === "png"
      ? "export フォルダの中の、<クラス名>_png フォルダに p01.png・p03-2.png（3 ページの 2 回目のクリック）・pA1.png（付録）の名前で出力します（前の PNG は消して入れ替えます）。「発表で再生」の動画は、その時点のコマを重ねます。"
      : "export フォルダの中の、<クラス名>_gif フォルダに、ページごとの p01.gif…を出力します。そのページの動きを初めから順につなぎ（くり返しは 1 回）、最後の画面で 1.5 秒止まって、くり返し再生します。「発表で再生」の動画・音は入りません。"]);
    if (f === "gif") items.push(["", "GIF は色の数が 256 色までなので、グラデーションなどは粗くなります。幅を大きく・コマの数を多くすると、ファイルが大きくなります。"]);
  } else if (f === "pptx") {
    items.push(["", "スライドごとの動画は、クリックで再生されます。くり返し・自動で次へは、PowerPoint では働かないことがあります。"]);
  } else {
    items.push(["", "区切りごとの動きを最後まで流し、クリックの区切りでは決めた秒数だけ待って進みます（「終わったら自動で次へ」は待たずに進み、「くり返す」は待つ間くり返します）。最後の区切りのあとも同じだけ待ちます。"]);
    items.push(["", "スライドの音・「発表で再生」の動画や音声も、発表と同じ時刻に入ります。ペンなどの書き込みを入れたいときは、「● 録画」で発表を録画してください。"]);
    if (info?.videoWaits) {
      items.push([info.videoKeys ? "" : "warn", info.videoKeys
        ? `ステップ・スライドの初めの表示ごとに決めた待ち時間（${info.videoWaits} か所）を使います。`
        : `ステップごとの待ち時間（${info.videoWaits} か所）を使うには、一度「▶ 描画・発表」で描画し直してください（前の描画には、区切りとステップの対応の記録がありません。今のまま出力すると、すべて全体の秒数になります）。`]);
    } else {
      items.push(["", "待ち時間は、画面の下のステップ（とスライドのパネルの「発表」）で、場所ごとに変えられます。"]);
    }
    if ($("cv-srt").checked && !info?.hasNotes) items.push(["warn", "発表者ノートがありません。字幕ファイルは空になります。"]);
    else if ($("cv-srt").checked) items.push(["", ($("cv-srtmode").value === "step"
      ? "字幕の中身: ステップを映している間は、そのステップのノートだけを出します（ステップのノートが無い所や、スライドの初めの表示では、スライドのノート）。"
      : "字幕の中身: スライドのノートと、ステップのノートを続けて出します（発表ウィンドウのノートから「【クリック n】」の見出しを外したもの）。")
      + "字幕は、Markdown の飾り（見出しの #・太字・箇条書きの記号など）を外し、1 つの字幕を 2 行まで（スライドとステップのノートを続けて出すときは 4 行まで。1 行は全角 36 文字まで）にします。長いノートは、映している時間を文の長さで分けて、何枚かの字幕に続けて出します。発表ウィンドウのノートは今のままです。"]);
    items.push(["", "動きの多い所は、動画の長さの半分〜同じくらいの時間がかかります（動きの少ない所は速く進みます）。"]);
  }
  const apx = (store.project?.slides ?? []).filter((x) => x.appendix && !x.skip).length;
  if (apx) items.push(["", f === "mp4" ? `付録のスライド（${apx} 枚）は、動画には入れません。` : `付録のスライド（${apx} 枚）は、最後にまとめて入ります${f === "html" ? "（本編の最後で「次へ」を押しても入らず、リンクか Esc の一覧で開きます）" : ""}。`]);
  if (f === "html" || f === "pdf") items.push(["", f === "html" ? "押すと飛ぶ要素（リンク）は、HTML でも押せます（「戻る」も働きます）。" : "押すと飛ぶ要素（リンク）は、PDF でも押せます（「戻る」は、飛んでくる元が 1 か所ならそのページへ、いくつもあれば「前に見たページへ戻る」の命令になります。後者はブラウザの PDF 表示などでは働かないことがあります）。"]);
  if (info?.exists?.[f]) items.push(["", `前に出力した ${LABEL[f]} のファイルは上書きされます。`]);
  $("cv-notes").innerHTML = items.map(([c, t]) => `<li class="${c}">${t}</li>`).join("");
  $("cv-go").disabled = busy || !info?.rendered;
}

async function openConvert() {
  if (saveFn && !(await saveFn())) return;
  status("");
  $("cv-logbox").hidden = true;
  try {
    info = await api.get("/api/convert/info");
  } catch (e) {
    toast(e.message || String(e), "error");
    return;
  }
  if (info.video && !busy) { $("cv-wait").value = info.video.wait; $("cv-srt").checked = !!info.video.srt; $("cv-srtmode").value = info.video.srtMode || "all"; }
  if (!busy) {
    const ho = info.handout ?? {}, im = info.images ?? {};
    if (ho.layout) $("cv-ho-layout").value = ho.layout;
    if (ho.paper) $("cv-ho-paper").value = ho.paper;
    if (ho.unit) $("cv-ho-unit").value = ho.unit;
    if (ho.orient) $("cv-ho-orient").value = ho.orient;
    if (im.unit) $("cv-png-unit").value = im.unit;
    if (im.width) $("cv-gif-width").value = String(im.width);
    if (im.fps) $("cv-gif-fps").value = String(im.fps);
    $("cv-img-pages").value = im.pages ?? "";
  }
  drawNotes();
  await loadPresets();
  if (!busy) drawBatch(true); // 開くたびに、まとめて出力のチェックは外す（出力中は、そのまま）
  $("dlg-convert").showModal();
}

async function poll(job) {
  while (job.status === "running") {
    await new Promise((r) => setTimeout(r, 600));
    job = await api.get(`/api/convert/${job.id}`);
    status(job.progress != null ? `${job.message}（${Math.round(job.elapsed)} 秒）` : `${LABEL[job.format]} に出力しています…（${Math.round(job.elapsed)} 秒）`, "running");
  }
  return job;
}

/** 今の画面の形式と設定（/api/convert に渡す中身）。 */
function currentBody(f = fmt()) {
  return { format: f, oneFile: $("cv-onefile").checked, pdfPages: pdfPages(),
    wait: Number($("cv-wait").value) || 0, srt: $("cv-srt").checked, srtMode: $("cv-srtmode").value,
    layout: $("cv-ho-layout").value, paper: $("cv-ho-paper").value, orient: $("cv-ho-orient").value, unit: f === "png" ? $("cv-png-unit").value : $("cv-ho-unit").value,
    pages: $("cv-img-pages").value, width: Number($("cv-gif-width").value), fps: Number($("cv-gif-fps").value) };
}

/** 保存した設定を画面に入れる。 */
function applyBody(b) {
  const radio = (name, v) => { const r = document.querySelector(`#dlg-convert input[name=${name}][value="${v}"]`); if (r) r.checked = true; };
  radio("cv-fmt", b.format);
  if (b.pdfPages) radio("cv-pdf", b.pdfPages);
  if ("oneFile" in b) $("cv-onefile").checked = !!b.oneFile;
  if ("wait" in b) $("cv-wait").value = String(b.wait);
  if ("srt" in b) $("cv-srt").checked = !!b.srt;
  for (const [k, id] of [["srtMode", "cv-srtmode"], ["layout", "cv-ho-layout"], ["paper", "cv-ho-paper"], ["orient", "cv-ho-orient"], ["pages", "cv-img-pages"]]) if (k in b) $(id).value = String(b[k]);
  if ("width" in b) $("cv-gif-width").value = String(b.width);
  if ("fps" in b) $("cv-gif-fps").value = String(b.fps);
  if ("unit" in b) { if (b.format === "png") $("cv-png-unit").value = b.unit; else $("cv-ho-unit").value = b.unit; }
  drawNotes();
}

/** 設定の短い説明（一覧に出す）。 */
function describe(b) {
  const extra = {
    html: b.oneFile ? "1 つのファイル" : "", pdf: b.pdfPages === "pages" ? "スライドごと" : "ステップごと", pptx: "",
    mp4: `${b.wait} 秒待つ${b.srt ? "・字幕" : ""}`,
    handout: `${{ notes1: "1 枚＋ノート", notes2: "2 枚＋ノート", notes3: "3 枚＋ノート", memo2: "2 枚＋メモ欄", memo3: "3 枚＋メモ欄", grid4: "4 枚", grid6: "6 枚", grid9: "9 枚" }[b.layout] ?? ""}・${b.paper}・${{ auto: "おまかせ", portrait: "縦", landscape: "横" }[b.orient] ?? ""}`,
    png: b.unit === "step" ? "ステップごと" : "スライドごと", gif: `幅 ${b.width}・${b.fps} コマ`,
  }[b.format];
  return `${LABEL[b.format]}${extra ? `（${extra}）` : ""}`;
}

/** 1 つ出力する。戻り値は終わったときの job（needDownload は呼び出し側で）。 */
async function convertOnce(body, allowDownload) {
  const started = await api.post("/api/convert", { ...body, allowDownload });
  jobId = started.id;
  drawNotes();
  try { return await poll(started); } finally { jobId = null; }
}

async function run(allowDownload = false) {
  const f = fmt();
  busy = true;
  drawNotes();
  status(`${LABEL[f]} に出力しています…`, "running");
  let job;
  try {
    const started = await api.post("/api/convert", { ...currentBody(), allowDownload });
    jobId = started.id;
    drawNotes();
    job = await poll(started);
  } catch (e) {
    busy = false;
    drawNotes();
    status(e.message || String(e), "error");
    return;
  }
  busy = false;
  jobId = null;
  if (job.status === "needDownload") {
    status(job.message);
    // 初めの 1 回だけ、インターネットから reveal.js を取り込む（利用者に確かめてから）
    const ok = confirm("HTML の発表には reveal.js（ブラウザで発表するための部品、約 1 MB）が要ります。まだこのパソコンに無いので、インターネット（cdn.jsdelivr.net）から 1 回だけダウンロードします。\n\nダウンロードしたものはパソコンに保存され、次からはインターネットにつながずに出力できます。ダウンロードしますか？");
    if (ok) return run(true);
    drawNotes();
    status("出力をやめました（reveal.js をダウンロードしなかったため）。PDF・PowerPoint は、ダウンロードせずに出力できます。");
    return;
  }
  info = await api.get("/api/convert/info").catch(() => info);
  drawNotes();
  if (job.status === "ok") {
    status(job.message, "ok");
    toast(`${LABEL[f]} に出力しました。`);
  } else if (job.status === "cancelled") {
    status("出力をやめました。");
  } else {
    status(job.message || "出力に失敗しました。", "error");
    $("cv-log").textContent = job.log || "";
    $("cv-logbox").hidden = !job.log;
    $("cv-logbox").open = true;
  }
}

export function setupConvert(save) {
  saveFn = save;
  setupConvertPresets();
  document.querySelectorAll("#dlg-convert input[name=cv-fmt]").forEach((r) => r.addEventListener("change", () => { status(""); drawNotes(); }));
  $("cv-onefile").addEventListener("change", drawNotes);
  $("cv-srt").addEventListener("change", drawNotes);
  $("cv-srtmode").addEventListener("change", drawNotes);
  // 形式ごとの設定を変えたら、その形式を選んだことにする
  $("cv-img-pages").addEventListener("input", () => {
    const cur = fmt();
    if (cur !== "png" && cur !== "gif") document.querySelector("#dlg-convert input[name=cv-fmt][value=png]").checked = true;
    drawNotes();
  });
  for (const [ids, fmtv] of [[["cv-ho-layout", "cv-ho-paper", "cv-ho-unit", "cv-ho-orient"], "handout"], [["cv-png-unit"], "png"], [["cv-gif-width", "cv-gif-fps"], "gif"]]) {
    for (const id of ids) $(id).addEventListener("change", () => { document.querySelector(`#dlg-convert input[name=cv-fmt][value=${fmtv}]`).checked = true; drawNotes(); });
  }
  $("cv-wait").addEventListener("focus", () => { document.querySelector("#dlg-convert input[name=cv-fmt][value=mp4]").checked = true; drawNotes(); });
  $("cv-cancel").addEventListener("click", async () => {
    if (!jobId) return;
    try { await api.post(`/api/convert/${jobId}/cancel`, {}); } catch (e) { toast(e.message || String(e), "error"); }
  });
  document.querySelectorAll("#dlg-convert input[name=cv-pdf]").forEach((r) => r.addEventListener("change", () => {
    document.querySelector("#dlg-convert input[name=cv-fmt][value=pdf]").checked = true;
    drawNotes();
  }));
  $("cv-go").addEventListener("click", () => run(false));
  $("cv-open").addEventListener("click", async () => {
    try { await api.post("/api/convert-open", { format: fmt() }); } catch (e) { toast(e.message || String(e), "error"); }
  });
}

// ---------------------------------------------------------------- 保存した設定・まとめて出力

let presets = [];

async function loadPresets() {
  presets = (await api.get("/api/export-presets").catch(() => ({ items: [] }))).items ?? [];
  drawPresets();
}

function drawPresets() {
  $("cv-pr").innerHTML = presets.length ? presets.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${escapeHtml(describe(p.body))}</option>`).join("")
    : `<option value="">（まだありません）</option>`;
  for (const id of ["cv-pr-load", "cv-pr-del"]) $(id).disabled = !presets.length;
  drawBatch();
}

/** まとめて出力の候補: 形式ごと（今の画面の設定で）と、保存した設定。 */
function batchItems() {
  return [
    ...Object.keys(LABEL).map((f) => ({ id: `fmt:${f}`, name: LABEL[f], body: () => currentBody(f) })),
    ...presets.map((p) => ({ id: `pr:${p.id}`, name: p.name, body: () => p.body, saved: true })),
  ];
}

/** まとめて出力の一覧を描く。clear なら、チェックをすべて外す（「ファイルに出力」を開くたび）。 */
function drawBatch(clear = false) {
  const keep = clear ? new Set() : new Set([...$("cv-batch-list").querySelectorAll("input:checked")].map((x) => x.value));
  // 形式の行は、名前と同じ形式名を説明から除く（「HTML HTML」にならないように）
  const desc = (it) => { const d = describe(it.body()); return it.saved ? d : d.replace(it.name, "").replace(/^（(.*)）$/, "$1").trim(); };
  const row = (it) => `<li><label><input type="checkbox" value="${escapeHtml(it.id)}"${keep.has(it.id) ? " checked" : ""}> ${escapeHtml(it.name)} <span class="hint">${escapeHtml(desc(it))}</span></label><span class="cv-bst" data-st="${escapeHtml(it.id)}"></span></li>`;
  const items = batchItems();
  const fmts = items.filter((x) => !x.saved), saved = items.filter((x) => x.saved);
  $("cv-batch-list").innerHTML = `<li class="cv-bhead">形式（今の設定で）</li>${fmts.map(row).join("")}`
    + (saved.length ? `<li class="cv-bhead">保存した設定</li>${saved.map(row).join("")}` : "");
  syncBatchAll();
}

/** 「すべて選ぶ」のチェックを、一覧のチェックに合わせる（一部だけなら中間の表示）。 */
function syncBatchAll() {
  const boxes = [...$("cv-batch-list").querySelectorAll("input[type=checkbox]")];
  const n = boxes.filter((x) => x.checked).length;
  $("cv-batch-all").checked = n > 0 && n === boxes.length;
  $("cv-batch-all").indeterminate = n > 0 && n < boxes.length;
  $("cv-batch-go").textContent = n ? `チェックした ${n} 個を出力` : "チェックしたものを出力";
}

async function runBatch() {
  const ids = [...$("cv-batch-list").querySelectorAll("input:checked")].map((x) => x.value);
  // 形式の設定は、始めた時点の画面の設定で決める
  const todo = batchItems().filter((p) => ids.includes(p.id)).map((p) => ({ ...p, body: p.body() }));
  if (!todo.length) { toast("出力する形式・設定をチェックしてください。", "warn"); return; }
  if (busy) return;
  busy = true;
  batchStop = false;
  drawNotes();
  $("cv-batch-go").disabled = true;
  let allowDownload = false, ok = 0;
  const mark = (p, text, cls = "") => { const e = $("cv-batch-list").querySelector(`[data-st="${CSS.escape(p.id)}"]`); if (e) { e.textContent = text; e.className = `cv-bst ${cls}`; } };
  todo.forEach((p) => mark(p, "待っています"));
  for (const [k, p] of todo.entries()) {
    if (batchStop) { mark(p, "やめました"); continue; }
    status(`まとめて出力（${k + 1} / ${todo.length}）: ${p.name}`, "running");
    mark(p, "出力しています…", "running");
    try {
      let job = await convertOnce(p.body, allowDownload);
      if (job.status === "needDownload") {
        const yes = confirm("HTML の発表には reveal.js（約 1 MB）が要ります。インターネット（cdn.jsdelivr.net）から 1 回だけダウンロードしますか？（しないときは、HTML を飛ばします）");
        if (yes) { allowDownload = true; job = await convertOnce(p.body, true); }
      }
      if (job.status === "ok") { ok += 1; mark(p, "できました", "ok"); }
      else if (job.status === "cancelled") { batchStop = true; mark(p, "やめました"); }
      else mark(p, job.status === "needDownload" ? "飛ばしました（reveal.js が無いため）" : (job.message || "失敗しました"), "error");
    } catch (e) { mark(p, e.message || String(e), "error"); }
  }
  busy = false;
  $("cv-batch-go").disabled = false;
  info = await api.get("/api/convert/info").catch(() => info);
  drawNotes();
  status(`まとめて出力: ${ok} / ${todo.length} 個できました。`, ok === todo.length ? "ok" : "error");
}
let batchStop = false;

export function setupConvertPresets() {
  $("cv-pr-save").addEventListener("click", async () => {
    const name = prompt(`この設定に名前を付けて保存します（${describe(currentBody())}）。同じ名前は置き換えます。`, describe(currentBody()));
    if (!name?.trim()) return;
    try { presets = (await api.post("/api/export-presets", { name: name.trim(), body: currentBody() })).items; drawPresets(); toast(`「${name.trim()}」を保存しました。`); }
    catch (e) { toast(e.message, "ng"); }
  });
  $("cv-pr-load").addEventListener("click", () => { const p = presets.find((x) => x.id === $("cv-pr").value); if (p) { applyBody(p.body); status(`「${p.name}」の設定を読み込みました。`); } });
  $("cv-pr-del").addEventListener("click", async () => {
    const p = presets.find((x) => x.id === $("cv-pr").value);
    if (!p || !confirm(`保存した設定「${p.name}」を消しますか？`)) return;
    presets = (await api.post("/api/export-presets/delete", { id: p.id })).items;
    drawPresets();
  });
  $("cv-batch-open").addEventListener("click", () => { drawBatch(); $("cv-batch").hidden = false; });
  $("cv-batch-all").addEventListener("change", (e) => {
    $("cv-batch-list").querySelectorAll("input[type=checkbox]").forEach((x) => { x.checked = e.target.checked; });
    syncBatchAll();
  });
  $("cv-batch-list").addEventListener("change", syncBatchAll);
  // 下の画面で設定を変えたら、一覧の説明（形式の今の設定）も描き直す。チェックはそのまま
  $("dlg-convert").addEventListener("change", (e) => { if (!$("cv-batch").hidden && !e.target.closest("#cv-batch") && !busy) drawBatch(); });
  $("cv-batch-close").addEventListener("click", () => { $("cv-batch").hidden = true; });
  $("cv-batch-go").addEventListener("click", runBatch);
  $("cv-cancel").addEventListener("click", () => { if (busy) batchStop = true; });
  $("dlg-convert").addEventListener("close", () => { $("cv-batch").hidden = true; });
}

export { loadPresets as loadConvertPresets, openConvert };
