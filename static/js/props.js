// 右: プロパティパネル（テキスト・数式・共通の項目と、アニメーションのステップ）。

import { slideTitleText } from "./slidetitle.js";
import { masterSection, renderMasterInfo, titleTemplate } from "./masters.js";
import { setCrop, startCropMode } from "./imagecrop.js";
import {
  boundsCenter, mathErrorOf, moveElements, objectHeight, objectWidth, moveObject, refreshElement, rotateSelectionTo, selectionAngle, selectObject, showSlide,
} from "./canvas.js";
import { createCodeEditor } from "./codeedit.js";
import { loadImage, pickImageFiles, replaceImage } from "./images.js";
import { mediaPanel } from "./mediaprops.js";
import { hasAmp, hasLineBreak } from "./mathalign.js";
import { colorize, ruleTokens } from "./texcolor.js";
import { shapeFields } from "./shapeprops.js";
import { shapeLabel } from "./shapes.js";
import { createRichEditor, plainOf } from "./richtext.js";
import { labelList, refPlan } from "./refs.js";
import { renderStepChips } from "./slides.js";
import { addAnimStep, hasOwnIntro, stepSummary } from "./animpane.js";
import { alignButtonsHtml, bindAlignButtons } from "./align.js";
import { bulkApplyField } from "./bulkapply.js";
import { partSaveField } from "./parts.js";
import {
  checkVarName, compactGroups, currentSlide, emit, escapeHtml, masterOf, findElement, findGroup, fontInstalled, fontNoteText, fontOptionsHtml, fromManim,
  groupMembers, makeElement, markDirty, normalizeHex, on, pagePlan, store, toManim, toast, uid, uniqueVar, withDependents, detachRefs, cellContainerOf,
} from "./store.js";

const TYPE_LABEL = { text: "テキスト", math: "数式", image: "画像", shape: "図形", media: "動画・音声" };
const panel = () => document.getElementById("props");
const title = () => document.getElementById("props-title");
let editors = new Map(); // step.id → code editor
let richEditor = null;
let refreshTimer = null;

function scheduleRefresh(el) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshElement(el), 180);
}

export function renderProps() {
  editors = new Map();
  richEditor?.destroy();
  richEditor = null;
  const p = panel();
  if (!store.project) {
    title().textContent = "プロパティ";
    p.innerHTML = `<p class="hint">プロジェクトを作成するか、開いてください。</p>`;
    return;
  }
  const group = findGroup(store.selectedId);
  if (group) return renderGroup(group);
  if (!store.selectedId && store.selectedIds.length > 1) return renderMulti();
  const el = findElement(store.selectedId);
  if (!el) return renderSlideInfo();
  title().textContent = el.type === "shape" ? (el.shape === "balloon" ? "吹き出し" : "図形") : TYPE_LABEL[el.type] ?? "要素";
  p.innerHTML = "";
  if (el.groupId) p.appendChild(memberNote(el));
  p.appendChild(basicSection(el));
  if (el.type === "text") {
    p.appendChild(paragraphSection(el));
    p.appendChild(effectsSection(el));
  }
  p.appendChild(positionSection(el));
  if (!store.masterId && el.type === "shape" && el.shape === "title" && titleTemplate(masterOf(currentSlide()))) {
    const mn = masterOf(currentSlide()).name;
    p.insertAdjacentHTML("afterbegin", `<p class="hint note-master">この題名の位置・大きさ・色・寄せ方・下線は、マスター「${escapeHtml(mn)}」の題名の型にそろえます（ここで変えても、スライドを開き直すと型に戻ります）。変えるときは「マスターの編集」で、マスターの題名を変えてください。文字はスライドごとに書けます。</p>`);
  }
  if (store.masterId) { // マスターの要素: 動き・リンクは付けない
    if (el.type === "shape" && el.shape === "title") p.insertAdjacentHTML("afterbegin", `<p class="hint note-master"><b>これは「題名の型」（見本）です。</b>スライドには描きません。このマスターを使うスライドに置いた「題名」の図形を、この見本と同じ位置・大きさ・色・寄せ方・下線にそろえます（文字はスライドごとに書きます）。スライドに題名が無いときは、何も出ません。</p>`);
    p.insertAdjacentHTML("beforeend", `<p class="hint">マスターの要素には、動き・リンクは付けません。テキストに {ページ}・{章} などを書くと、スライドごとの値になります。</p>`);
    return;
  }
  p.appendChild(refSection(el));
  p.appendChild(linkSection(el));
  p.appendChild(stepsSection(el));
  if (store.focusStepId) focusStep(store.focusStepId);
  else highlightErrorStep();
}

// ---------------------------------------------------------------- 未選択時

function renderSlideInfo() {
  if (store.masterId) return renderMasterInfo(panel(), title());
  const slide = currentSlide();
  title().textContent = `スライド ${store.slideIndex + 1}`;
  const items = slide.elements.map((e) => `
    <li><button data-pick="${e.id}"><span class="kind">${TYPE_LABEL[e.type] ?? ""}</span>${escapeHtml(e.var)}
    <span class="hint">${escapeHtml(elementLabel(e)).slice(0, 28)}</span></button></li>`).join("");
  panel().innerHTML = `
    <h3>このスライドの要素</h3>
    ${slide.elements.length ? `<ul class="elem-list">${items}</ul>` : `<p class="hint">要素はまだありません。上の「＋テキスト」「＋数式」で追加します。</p>`}
    <h3>マスター</h3>
    <div data-k="master"></div>
    <h3>値（ValueTracker）</h3>
    <div data-k="values"></div>
    <h3>カメラ</h3>
    <div data-k="camera"></div>
    <h3>章・付録・時間</h3>
    <div data-k="deck"></div>
    <h3>ページ番号</h3>
    <div data-k="pagenum"></div>
    <h3>発表（切り替え・自動・ノート）</h3>
    <div data-k="play"></div>
    <h3>使い方</h3>
    <p class="hint">要素を選ぶと、内容・位置・アニメーションを編集できます。アニメーションは、クリック1回分ごとの「ステップ」として Manim のコードで書きます。クリックせずに続けて起きる動きは、1つのステップにまとめて書きます。</p>
    <p class="hint">薄く表示されている要素は「スライド開始時に表示」がオフの要素です。ステップのコード（例: <code>self.play(Write(eq))</code>）で出現させます。</p>`;
  panel().querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    store.selectedId = b.dataset.pick;
    selectObject(store.selectedId);
    emit("selection", store.selectedId);
  }));
  masterSection(panel().querySelector("[data-k=master]"), slide);
  valuesSection(panel().querySelector("[data-k=values]"), slide);
  deckSection(panel().querySelector("[data-k=deck]"), slide);
  pageNumberSection(panel().querySelector("[data-k=pagenum]"), slide);
  slidePlaySection(panel().querySelector("[data-k=play]"), slide);
  if (store.project.settings.use3d) camera3dSection(panel().querySelector("[data-k=camera]"), slide);
  else cameraSection(panel().querySelector("[data-k=camera]"), slide);
}

// 要素ごとの動き（棒の値・グラフの並び・コードの行・数を数える）のボタン
const SPECIAL_LABEL = { barchart: "＋棒の値を変える", netgraph: "＋並びを変える", code: "＋行に色の帯", number: "＋数を数える" };

// ---------------------------------------------------------------- 発表（切り替え効果・初めから自動・ノート）

const TRANSITIONS = [["none", "なし（すぐ切り替える）"], ["fade", "重ねて切り替え（フェード）"], ["wipe", "押し出す（ワイプ）"], ["zoom", "ズーム"]];
const TRANS_DIRS = [["left", "← 左へ"], ["right", "→ 右へ"], ["up", "↑ 上へ"], ["down", "↓ 下へ"]];

function slidePlaySection(box, slide) {
  const t = slide.transition ??= { kind: "none", dir: "left", out: false, runTime: 1 };
  const first = store.slideIndex === 0;
  const draw = () => {
    box.innerHTML = `
      <label class="row"><input type="checkbox" data-k="skip" ${slide.skip ? "checked" : ""}> このスライドを描画しない</label>
      <p class="hint" style="margin-top:2px">描画・発表・ファイルへの出力に入れません（ページ番号は、このスライドを飛ばして詰めます）。
        編集と、1 枚だけの試し描画（▷試す）はできます。今回だけ描画するスライドを選ぶこともできます（ツールバーの「描画するスライド」）。</p>
      <div class="row"><span class="unit">切り替え効果</span>
        <select data-k="kind" ${first ? "disabled" : ""} style="flex:1">${TRANSITIONS.map(([v, l]) => `<option value="${v}" ${t.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      ${!first && t.kind === "wipe" ? `<div class="row"><span class="unit">押し出す向き</span><select data-k="dir" style="flex:1">${TRANS_DIRS.map(([v, l]) => `<option value="${v}" ${t.dir === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>` : ""}
      ${!first && t.kind === "zoom" ? `<div class="row"><span class="unit">ズーム</span><select data-k="out" style="flex:1"><option value="in" ${!t.out ? "selected" : ""}>近づく（前のスライドが大きくなって消える）</option><option value="out" ${t.out ? "selected" : ""}>遠ざかる（前のスライドが小さくなって消える）</option></select></div>` : ""}
      ${!first && t.kind !== "none" ? `<div class="row"><span class="unit">時間</span><input type="number" class="num" data-k="rt" min="0.1" max="10" step="0.1" value="${t.runTime}" style="width:5em;flex:none"><span class="unit">秒</span></div>` : ""}
      <p class="hint" style="margin-top:2px">${first ? "最初のスライドには、切り替え効果は付きません。" : "このスライドへ進むクリックで、前のスライド（描画しないスライドは飛ばし、その前に描画するスライド）の最後の画面から切り替えます（manim-slides の wipe・zoom と同じ動き）。描画するスライドの最初になったときは付きません。このスライドの初めの区切りに入ります。1 枚だけの試し描画（Ctrl+Enter・▷試す）では見えません。"}</p>
      <label class="row"><input type="checkbox" data-k="auto" ${slide.autoStart ? "checked" : ""}> 初めの表示のあと、自動でステップ 1 へ</label>
      <p class="hint" style="margin-top:2px">このスライドに入ったら（切り替え効果のあと）、クリックを待たずにステップ 1 の動きを始めます。</p>
      <div class="row"><span class="unit">動画での待ち</span><input type="number" class="num" data-k="vwait" min="0" max="600" step="0.5" placeholder="全体" value="${slide.videoWait ?? ""}" style="width:5em;flex:none"><span class="unit">秒</span></div>
      <p class="hint" style="margin-top:2px">「ファイルに出力」の動画（mp4）で、このスライドの初めの表示のあとに待つ秒数です（空欄なら、出力するときに決める全体の秒数）。ステップのあとの待ち時間は、下のステップの欄で決めます。</p>
      <div class="unit" style="margin-top:6px">発表者ノート（このスライドの初めの表示）</div>
      <textarea data-k="notes" rows="3" placeholder="発表者用の画面に出すメモ（Markdown が使えます）。ステップごとのノートは、下のステップの欄で書きます" style="width:100%">${escapeHtml(slide.notes || "")}</textarea>`;
    const q = (k) => box.querySelector(`[data-k=${k}]`);
    q("kind").addEventListener("change", (e) => { t.kind = e.target.value; done(true); });
    q("dir")?.addEventListener("change", (e) => { t.dir = e.target.value; done(); });
    q("out")?.addEventListener("change", (e) => { t.out = e.target.value === "out"; done(); });
    q("rt")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0.1 && v <= 10) { t.runTime = v; done(); } else e.target.value = t.runTime; });
    q("auto").addEventListener("change", (e) => { slide.autoStart = e.target.checked; done(); });
    q("vwait").addEventListener("change", (e) => {
      const v = e.target.value.trim() === "" ? null : Number(e.target.value);
      slide.videoWait = v == null || !Number.isFinite(v) ? null : Math.min(600, Math.max(0, v));
      e.target.value = slide.videoWait ?? "";
      done();
    });
    q("skip").addEventListener("change", (e) => {
      if (e.target.checked && store.project.slides.every((x) => x === slide || x.skip)) {
        e.target.checked = false;
        toast("すべてのスライドを「描画しない」にはできません（描画するスライドが無くなります）。", "warn");
        return;
      }
      slide.skip = e.target.checked;
      done();
      emit("slide-skip-changed");
    });
    let timer = null;  // スライドの一覧の印は、打ち終わって少ししてから更新する（欄から出たときに描き直すと、一覧のクリックが失われる）
    q("notes").addEventListener("input", (e) => {
      slide.notes = e.target.value;
      markDirty("prop");
      clearTimeout(timer);
      timer = setTimeout(() => emit("slides-changed"), 600);
    });
  };
  const done = (redraw = false) => { markDirty("prop"); emit("slides-changed"); if (redraw) draw(); };
  draw();
}

// ---------------------------------------------------------------- 章・付録・目安の時間

const fmtSec = (v) => (v == null ? "" : `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`);
/** 「1:30」「90」「1分30秒」などを秒にする。空・読めないなら null。 */
function parseSec(text) {
  const t = String(text ?? "").trim().replace(/[：]/g, ":").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (!t) return null;
  let m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(?:(\d+(?:\.\d+)?)\s*分)?\s*(?:(\d+(?:\.\d+)?)\s*秒?)?$/.exec(t);
  if (m && (m[1] || m[2])) return Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return null;
}

function deckSection(box, slide) {
  const draw = () => {
    const plan = pagePlan()[store.slideIndex];
    const sd = store.project.settings.sections?.display ?? "none";
    box.innerHTML = `
      <label class="row"><input type="checkbox" data-k="secon" ${slide.section ? "checked" : ""}> このスライドから新しい章</label>
      <div class="row" ${slide.section ? "" : "hidden"}><span class="unit">章の名前</span><input type="text" data-k="secname" maxlength="60" value="${escapeHtml(slide.section || "")}" style="flex:1"></div>
      <p class="hint" style="margin-top:2px">スライドの一覧と、発表者用の一覧が章ごとに分かれ、発表中に章の初めへ飛べます。
        ${sd === "none" ? "章の名前・進み具合のバーをスライドに出すには、「プロジェクト設定」の「章の表示」をオンにします。" : `<label><input type="checkbox" data-k="sechide" ${slide.sectionShow === "off" ? "checked" : ""}> このスライドでは章の表示を隠す</label>`}</p>
      <label class="row"><input type="checkbox" data-k="appendix" ${slide.appendix ? "checked" : ""}> 付録のスライド</label>
      <p class="hint" style="margin-top:2px">付録は、どこに置いても本編の後ろにまとめて描画し、ページ番号は「A1」「A2」…になります（このスライドは <b>${escapeHtml(String(plan.number))}</b>）。
        発表では、本編の最後で「次へ」を押しても付録には入らず、一覧・番号（「A1」Enter）・リンクで開きます。HTML・PDF・PowerPoint には最後に入り、動画（mp4）には入りません。</p>
      <div class="row"><span class="unit">発表の目安</span><input type="text" data-k="target" placeholder="例: 1:30" value="${fmtSec(slide.targetTime)}" style="width:6em;flex:none"><span class="unit">（分:秒）</span></div>
      <p class="hint" style="margin-top:2px">発表者用の画面に、このページにかけている時間と目安を出し、目安の 8 割で橙、過ぎると赤にします。全体の目安が空なら、ページの目安の合計を入れます。
        リハーサルの記録（ツールバーの「リハーサル」）から、まとめて入れることもできます。</p>`;
    const q = (k) => box.querySelector(`[data-k=${k}]`);
    q("secon").addEventListener("change", (e) => {
      slide.section = e.target.checked ? (slide.section || `章 ${store.project.slides.slice(0, store.slideIndex + 1).filter((x) => x.section || x === slide).length}`) : "";
      done(true);
      if (e.target.checked) box.querySelector("[data-k=secname]")?.select();
    });
    q("secname").addEventListener("change", (e) => {
      const v = e.target.value.trim().slice(0, 60);
      slide.section = v || slide.section;
      e.target.value = slide.section;
      done();
    });
    q("sechide")?.addEventListener("change", (e) => { slide.sectionShow = e.target.checked ? "off" : "inherit"; done(); });
    q("appendix").addEventListener("change", (e) => {
      if (e.target.checked && store.project.slides.every((x) => x === slide || x.appendix || x.skip)) {
        e.target.checked = false;
        toast("本編のスライドが無くなるので、付録にはできません。", "warn");
        return;
      }
      slide.appendix = e.target.checked;
      done(true);
      emit("page-numbers-changed");
    });
    q("target").addEventListener("change", (e) => {
      const v = parseSec(e.target.value);
      if (e.target.value.trim() && v == null) { toast("目安は「1:30」（1 分 30 秒）や「90」（秒）のように入れてください。", "warn"); e.target.value = fmtSec(slide.targetTime); return; }
      slide.targetTime = v == null ? null : Math.min(36000, Math.max(0, v));
      e.target.value = fmtSec(slide.targetTime);
      done();
    });
  };
  const done = (redraw = false) => { markDirty("prop"); emit("slides-changed"); if (redraw) draw(); };
  draw();
}

// ---------------------------------------------------------------- ページ番号

function pageNumberSection(box, slide) {
  const pn = slide.pageNumber ?? (slide.pageNumber = { mode: "inherit", number: null });
  const projOn = !!store.project.settings.pageNumbers?.enabled;
  const draw = () => {
    const plan = pagePlan()[store.slideIndex];
    box.innerHTML = `<div class="seg" data-k="mode"><button type="button" data-v="inherit">プロジェクトの設定（${projOn ? "付ける" : "付けない"}）</button><button type="button" data-v="on">付ける</button><button type="button" data-v="off">付けない</button></div>
      <label class="row"><input type="checkbox" data-k="fix" ${pn.number !== null && pn.number !== undefined ? "checked" : ""}> 番号を指定する <input type="number" class="num" step="1" data-k="n" value="${pn.number ?? plan.number}" style="width:5em"></label>
      <p class="hint" style="margin-top:2px">このスライドの番号: <b>${plan.number}</b>（${plan.skip ? "描画しないスライドなので、番号は数えません。試し描画では、もし描画したらの番号" : plan.show ? `「${escapeHtml(plan.text)}」と表示` : "表示しない"}）。番号を指定すると、次のスライドからはその続きの番号になります。
      位置・大きさ・色・書き方は「プロジェクト設定」で変えます。ステップのコードでは <code>self.page_number</code> で参照できます。</p>`;
    box.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === pn.mode));
    box.querySelector("[data-k=mode]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      pn.mode = b.dataset.v;
      done();
    });
    const fix = box.querySelector("[data-k=fix]"), n = box.querySelector("[data-k=n]");
    n.disabled = !fix.checked;
    fix.addEventListener("change", () => { pn.number = fix.checked ? Math.round(Number(n.value) || plan.number) : null; done(); });
    n.addEventListener("change", () => { const v = Math.round(Number(n.value)); if (Number.isFinite(v)) { pn.number = v; done(); } });
  };
  const done = () => { markDirty("prop"); emit("page-numbers-changed"); draw(); };
  draw();
}

// ---------------------------------------------------------------- スライドの値・カメラ

/** 値の名前を変えたとき、このスライドの式・数値・ステップのコードの中の名前も変える。 */
function renameValue(slide, oldName, newName) {
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const py = new RegExp(`(?<![A-Za-z0-9_.])${esc}(?![A-Za-z0-9_])`, "g");
  // LaTeX の式: 1 文字の名前は前後の文字と並んでいてもよい（ax は a×x）。\alpha のような名前は \ 付きで書く
  const tex = oldName.length === 1 ? new RegExp(`(?<!\\\\[A-Za-z]*)${esc}`, "g") : new RegExp(`\\\\${esc}(?![A-Za-z])`, "g");
  const texNew = newName.length === 1 || !/^[A-Za-z]+$/.test(newName) ? newName : `\\${newName}`;
  for (const e of slide.elements) {
    for (const k of ["expr", "fx", "fy", "xExpr", "yExpr"]) {
      if (typeof e[k] !== "string") continue;
      e[k] = e.lang === "latex" ? e[k].replace(tex, texNew) : e[k].replace(py, newName);
    }
    if (e.shape === "graphpart") for (const k of ["x0", "x1", "dx", "atX", "length"]) if (typeof e[k] === "string") e[k] = e[k].replace(tex, texNew);
    for (const k of ["p1", "p2", "zExpr"]) {
      if (k === "zExpr" && typeof e[k] === "string") e[k] = e.lang === "latex" ? e[k].replace(tex, texNew) : e[k].replace(py, newName);
      if (Array.isArray(e[k])) e[k] = e[k].map((v) => (typeof v !== "string" ? v : e.lang === "latex" ? v.replace(tex, texNew) : v.replace(py, newName)));
    }
    if (e.valueName === oldName) e.valueName = newName;
  }
  for (const st of slide.steps) st.code = (st.code || "").replace(py, newName);
}

function valuesSection(box, slide) {
  slide.values ??= [];
  const draw = () => {
    box.innerHTML = `${slide.values.map((v, i) => `<div class="row value-row" data-i="${i}"><input data-k="name" value="${escapeHtml(v.name)}" spellcheck="false" placeholder="名前" style="width:6em;flex:none"><span class="unit">初めの値</span><input type="number" class="num" step="any" data-k="value" value="${v.value}"><button type="button" class="small" data-a="del" title="この値を消す">×</button></div>`).join("")}
      <div class="row"><button type="button" class="small" data-a="add">＋値</button></div>
      <p class="hint">スライドの間だけ使う数（Manim の ValueTracker）です。グラフ・ベクトル場・座標の点の式に名前で書くと、値に合わせて形が変わり（always_redraw）、「数値」の図形で値を表示できます。ステップで <code>self.play(${escapeHtml(slide.values[0]?.name || "t")}.animate.set_value(3), run_time=2)</code> のように動かします。キャンバスは初めの値で表示します。LaTeX の式では、1 文字の名前はそのまま、<code>alpha</code> のような名前は <code>\\alpha</code> と書きます。</p>`;
    box.querySelector("[data-a=add]").addEventListener("click", () => {
      const used = new Set(slide.values.map((v) => v.name));
      const name = ["t", "a", "b", "k", "s", "u", "v", "w"].find((n) => !used.has(n)) ?? `v${slide.values.length + 1}`;
      slide.values.push({ name, value: 0 });
      markDirty("prop");
      draw();
    });
    box.querySelectorAll(".value-row").forEach((row) => {
      const v = slide.values[Number(row.dataset.i)];
      row.querySelector("[data-k=name]").addEventListener("change", (e) => {
        const name = e.target.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { toast("値の名前は半角英数字と _ で、先頭は英字にしてください。", "warn"); e.target.value = v.name; return; }
        if (slide.values.some((x) => x !== v && x.name === name)) { toast(`「${name}」は、このスライドの値で使っています。`, "warn"); e.target.value = v.name; return; }
        if (v.name && v.name !== name) renameValue(slide, v.name, name);
        v.name = name;
        markDirty("prop");
        showSlide();
        renderStepChips();
      });
      row.querySelector("[data-k=value]").addEventListener("change", (e) => {
        const x = Number(e.target.value);
        if (!Number.isFinite(x)) return;
        v.value = x;
        markDirty("prop");
        showSlide(); // 値を使う要素のプレビューを、新しい初めの値で作り直す
      });
      row.querySelector("[data-a=del]").addEventListener("click", () => {
        slide.values.splice(Number(row.dataset.i), 1);
        markDirty("prop");
        showSlide();
        draw();
      });
    });
  };
  draw();
}

function camera3dSection(box, slide) {
  const c = slide.camera3d ??= { phi: 0, theta: -90, zoom: 1, x: 0, y: 0 };
  const presets = [["真上（2D と同じ）", 0, -90], ["斜め", 65, -45], ["斜め（左から）", 65, -135], ["真横", 90, -90]];
  box.innerHTML = `<div class="row"><span class="unit">φ（傾き）</span><input type="number" class="num" step="5" data-k="phi" value="${c.phi}"><span class="unit">θ（向き）</span><input type="number" class="num" step="5" data-k="theta" value="${c.theta}"></div>
    <div class="row"><span class="unit">拡大率</span><input type="number" class="num" step="0.1" min="0.05" data-k="zoom" value="${c.zoom}"><span class="unit">中心 x</span><input type="number" class="num" step="0.5" data-k="x" value="${c.x}"><span class="unit">y</span><input type="number" class="num" step="0.5" data-k="y" value="${c.y}"></div>
    <div class="row">${presets.map(([l], i) => `<button type="button" class="small" data-p="${i}">${l}</button>`).join("")}</div>
    <p class="hint">キャンバスの上で、中ボタン（ホイール）を押したままドラッグすると回せます。Shift＋中ボタンのドラッグで中心を動かし、Ctrl＋ホイールで寄る・引く。</p>
    <p class="hint">スライドの初めのカメラの向き（度）。φ は真上からの傾き、θ は水平の向きです。キャンバスの 3D の要素は、この向きから見た形で表示します。ステップで <code>self.move_camera(phi=60 * DEGREES, theta=-30 * DEGREES, run_time=2)</code>、回し続けるときは <code>self.begin_ambient_camera_rotation(rate=0.2)</code> と <code>self.wait(3)</code>。カメラは各スライドの初めに、この向きに戻ります。</p>`;
  const apply = () => { markDirty("prop"); showSlide(); };
  for (const k of ["phi", "theta", "zoom", "x", "y"]) {
    box.querySelector(`[data-k=${k}]`).addEventListener("change", (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v) || (k === "zoom" && v <= 0)) return;
      c[k] = v; apply();
    });
  }
  box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
    const [, phi, theta] = presets[Number(b.dataset.p)];
    Object.assign(c, { phi, theta });
    box.querySelector("[data-k=phi]").value = phi; box.querySelector("[data-k=theta]").value = theta;
    apply();
  }));
}

function cameraSection(box, slide) {
  const FW = 128 / 9; // Manim の画面の幅（14.22）
  const draw = () => {
    const cam = slide.camera;
    box.innerHTML = `<label class="row"><input type="checkbox" data-k="on" ${cam ? "checked" : ""}> スライドの初めのカメラの位置を決める</label>
      ${cam ? `<div class="row"><span class="unit">中心 x</span><input type="number" class="num" step="0.1" data-k="x" value="${cam.x}"><span class="unit">y</span><input type="number" class="num" step="0.1" data-k="y" value="${cam.y}"></div>
      <div class="row"><span class="unit">幅</span><input type="number" class="num" step="0.5" min="0.1" data-k="w" value="${cam.width}"><span class="unit">（拡大 ${Math.round(FW / cam.width * 100)}%）</span></div>` : ""}
      <p class="hint">カメラは各スライドの初めに、${cam ? "この位置（キャンバスのオレンジの点線の枠）" : "画面全体"}に戻ります。ステップで <code>self.play(self.camera.frame.animate.scale(0.5).move_to(eq1))</code> のように動かせます（MovingCameraScene）。</p>`;
    box.querySelector("[data-k=on]").addEventListener("change", (e) => {
      slide.camera = e.target.checked ? { x: 0, y: 0, width: Math.round(FW / 1.5 * 100) / 100 } : null;
      markDirty("prop");
      showSlide();
      draw();
    });
    const upd = () => {
      const x = Number(box.querySelector("[data-k=x]").value), y = Number(box.querySelector("[data-k=y]").value), w = Number(box.querySelector("[data-k=w]").value);
      if (![x, y, w].every(Number.isFinite) || w <= 0) return;
      slide.camera = { x, y, width: w };
      markDirty("prop");
      showSlide();
      draw();
    };
    box.querySelectorAll("[data-k=x],[data-k=y],[data-k=w]").forEach((i) => i.addEventListener("change", upd));
  };
  draw();
}

// ---------------------------------------------------------------- グループ・複数選択

const sel = () => import("./selection.js");

function memberNote(el) {
  const g = findGroup(el.groupId);
  const d = document.createElement("div");
  d.className = "member-note";
  d.innerHTML = `グループ <code>${escapeHtml(g?.var ?? "?")}</code> の中の要素です。<button type="button" class="small">グループを選ぶ</button>`;
  d.querySelector("button").addEventListener("click", async () => (await sel()).select(el.groupId));
  return d;
}

/** 選択中の要素をまとめて動かす「座標」欄（外接矩形の中心を Manim の座標で表示する）。 */
function centerField(ids, note) {
  const c = boundsCenter(ids) ?? { x: 0, y: 0 };
  const [mx, my] = toManim(c.x, c.y);
  const f = field("中心", `<div class="row"><span class="unit">x</span><input type="number" class="num" step="0.1" data-k="mx" value="${mx.toFixed(2)}"><span class="unit">y</span><input type="number" class="num" step="0.1" data-k="my" value="${my.toFixed(2)}"></div><div class="field-note">${note}</div>`);
  const [ix, iy] = f.querySelectorAll("input");
  const apply = () => {
    const x = Number(ix.value), y = Number(iy.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cur = boundsCenter(ids);
    const [tx, ty] = fromManim(x, y);
    moveElements(ids, tx - cur.x, ty - cur.y);
  };
  ix.addEventListener("change", apply);
  iy.addEventListener("change", apply);
  let t = null;
  const off = on("element-moved", (m) => {
    if (!document.body.contains(ix)) return off();
    if (!ids.includes(m.id)) return;
    clearTimeout(t);
    t = setTimeout(() => {
      const cc = boundsCenter(ids);
      if (!cc) return;
      const [a, b] = toManim(cc.x, cc.y);
      if (document.activeElement !== ix) ix.value = a.toFixed(2);
      if (document.activeElement !== iy) iy.value = b.toFixed(2);
    }, 30);
  });
  return f;
}

/** 選択範囲（複数・グループ）の向き。変えると、範囲の中心を軸に中の要素をまとめて回す。 */
function selectionRotationField(ids, note) {
  const f = field("回転", `<div class="row"><input type="number" class="num" step="any" data-k="srot" value="${selectionAngle(ids)}"><span class="unit">°</span><button type="button" class="small" data-a="srot0">0° に戻す</button></div><div class="field-note">${note}</div>`);
  const ir = f.querySelector("input");
  const apply = (v) => {
    if (!Number.isFinite(v)) return;
    let d = ((v % 360) + 540) % 360 - 180;
    if (d === -180) d = 180;
    rotateSelectionTo(Math.round(d * 100) / 100);
  };
  ir.addEventListener("change", () => apply(Number(ir.value)));
  f.querySelector("[data-a=srot0]").addEventListener("click", () => apply(0));
  let t = null;
  const off = on("element-moved", (m) => {
    if (!document.body.contains(ir)) return off();
    if (!ids.includes(m.id)) return;
    clearTimeout(t);
    t = setTimeout(() => { if (document.activeElement !== ir) ir.value = selectionAngle(ids); }, 30);
  });
  return f;
}

function visibleField(els) {
  const all = els.every((e) => e.visibleAtStart !== false), none = els.every((e) => e.visibleAtStart === false);
  const vis = document.createElement("label");
  vis.className = "row";
  vis.style.margin = "4px 0 8px";
  vis.innerHTML = `<input type="checkbox" ${all ? "checked" : ""}> スライド開始時に表示（self.add）`;
  const cb = vis.querySelector("input");
  cb.indeterminate = !all && !none;
  cb.addEventListener("change", () => {
    for (const e of els) { e.visibleAtStart = cb.checked; refreshElement(e); }
    markDirty("prop");
  });
  return vis;
}

function zField() {
  const fz = field("重なり順", `<div class="seg">
    <button type="button" data-z="back" title="最背面へ（Ctrl+Shift+[）">最背面</button>
    <button type="button" data-z="backward" title="背面へ（Ctrl+[）">背面</button>
    <button type="button" data-z="forward" title="前面へ（Ctrl+]）">前面</button>
    <button type="button" data-z="front" title="最前面へ（Ctrl+Shift+]）">最前面</button></div>`);
  fz.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", async () => (await sel()).moveSelectionLayer(b.dataset.z)));
  return fz;
}

function memberList(els) {
  const items = [...els].reverse().map((e) => `
    <li><button data-pick="${e.id}"><span class="kind">${TYPE_LABEL[e.type] ?? ""}</span>${escapeHtml(e.var)}
    <span class="hint">${escapeHtml(elementLabel(e)).slice(0, 24)}</span></button></li>`).join("");
  const ul = document.createElement("ul");
  ul.className = "elem-list";
  ul.innerHTML = items;
  ul.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => (await sel()).select(b.dataset.pick)));
  return ul;
}

function renderGroup(g) {
  const p = panel();
  const els = groupMembers(g.id);
  title().textContent = "グループ";
  p.innerHTML = "";
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>グループ（${els.some((e) => e.type === "image") ? "Group" : "VGroup"}・${els.length} 個の要素）</h3>`;
  const fVar = field("変数名", `<input data-k="var" value="${escapeHtml(g.var)}" spellcheck="false"><div class="field-note" data-note="var">コードからこの名前でグループ全体を参照します。</div>`);
  sec.appendChild(fVar);
  const varInput = fVar.querySelector("input");
  const varNote = fVar.querySelector("[data-note=var]");
  varInput.addEventListener("input", () => {
    const msg = checkVarName(varInput.value.trim(), g.id);
    varNote.textContent = msg || "コードからこの名前でグループ全体を参照します。";
    varNote.className = `field-note${msg ? " ng" : ""}`;
  });
  varInput.addEventListener("change", () => {
    const nv = varInput.value.trim();
    if (checkVarName(nv, g.id) || nv === g.var) { if (nv !== g.var) toast("変数名を確認してください。", "warn"); return; }
    const n = renameVar(g.var, nv);
    g.var = nv;
    markDirty("var");
    renderStepChips();
    emit("layers-changed");
    renderProps();
    if (n) toast(`コード欄の「${nv}」への置き換え: ${n} か所`);
  });
  const fm = document.createElement("div");
  fm.className = "field-block";
  fm.innerHTML = `<label class="block-label">中の要素（上が手前）</label>`;
  fm.appendChild(memberList(els));
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "キャンバスで要素をダブルクリックすると、グループの中の要素を1つだけ選んで編集できます（Esc でグループに戻る）。";
  fm.appendChild(hint);
  sec.appendChild(fm);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<button type="button" data-a="ungroup" title="Ctrl+Shift+G">グループ解除</button><button type="button" class="danger" data-a="delete">グループごと削除</button>`;
  row.querySelector("[data-a=ungroup]").addEventListener("click", async () => (await sel()).ungroup(g.id));
  row.querySelector("[data-a=delete]").addEventListener("click", async () => (await sel()).deleteSelection());
  sec.appendChild(row);
  if (!store.masterId) sec.appendChild(partSaveField(g)); // 部品として保存（部品を直しているときは、部品を上書き）
  p.appendChild(sec);

  const pos = document.createElement("section");
  pos.innerHTML = `<h3>位置と表示</h3>`;
  pos.appendChild(centerField(els.map((e) => e.id), "グループ全体の中心（Manim の座標）。変えると中の要素がまとめて動きます。"));
  pos.appendChild(selectionRotationField(els.map((e) => e.id), "グループの向き（反時計回りが正）。変えると、グループの中心を軸に中の要素をまとめて回します。0° で回す前の向きに戻ります。"));
  pos.appendChild(alignField(1));
  pos.appendChild(visibleField(els));
  pos.appendChild(zField());
  p.appendChild(pos);
  p.appendChild(stepsSection({ id: g.id, var: g.var, type: "group" }));
  if (store.focusStepId) focusStep(store.focusStepId);
  else highlightErrorStep();
}

function renderMulti() {
  const p = panel();
  const ids = store.selectedIds;
  // グループを選んでいるときは、中の要素（位置・表示の欄がグループを含めて効くように）
  const els = [...new Set(ids.flatMap((id) => (findGroup(id) ? groupMembers(id) : [findElement(id)])).filter(Boolean))];
  title().textContent = `${ids.length} 個を選択中`;
  p.innerHTML = "";
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>選択中の要素</h3>`;
  sec.appendChild(memberList(els));
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<button type="button" class="primary" data-a="group" title="Ctrl+G">グループ化</button><button type="button" data-a="balloon" title="選んだ要素を囲む吹き出しを作る">吹き出しで囲む</button><button type="button" class="danger" data-a="delete">まとめて削除</button>`;
  row.querySelector("[data-a=balloon]").addEventListener("click", async () => (await import("./shapes.js")).wrapInBalloon());
  row.querySelector("[data-a=group]").addEventListener("click", async () => (await sel()).groupSelection());
  row.querySelector("[data-a=delete]").addEventListener("click", async () => (await sel()).deleteSelection());
  sec.appendChild(row);
  if (!store.masterId) sec.appendChild(partSaveField());
  // 選んだ要素を、同じクリックで出す・消す（グループにしなくてよい）
  const an = document.createElement("div");
  an.className = "gui-steps";
  const steps = currentSlide()?.steps ?? [];
  const guiSteps = steps.map((st, k) => [st, k]).filter(([st]) => st.mode === "gui");
  const focusK = steps.findIndex((st) => st.id === store.focusStepId && st.mode === "gui");
  an.innerHTML = `<div class="row"><span class="unit">足す所</span><select data-k="into"><option value="">新しいクリック（新しいステップ）</option>${guiSteps.map(([st, k]) => `<option value="${st.id}" ${k === focusK ? "selected" : ""}>ステップ ${k + 1} に足す</option>`).join("")}</select></div>
    <div class="row"><button type="button" class="small" data-g="in">＋出す</button><button type="button" class="small" data-g="out">＋消す</button></div>
    <div class="row"><span class="unit">少しずつずらす</span><input type="number" class="num" data-k="mlag" value="0" step="0.1" min="0"><span class="unit">秒（0 で同時）</span></div>
    <div class="hint">選んだ要素を 1 つのステップ（同じクリック）で出す・消します。グループの中の要素はグループごと動きます。順番は選んだ順（Ctrl＋クリックで足した順。範囲で選んだものは重なり順）です。「ステップ k に足す」では、そのステップの最後の動きの後に続けます。</div>`;
  an.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
    const lag = Math.max(0, Number(an.querySelector("[data-k=mlag]").value) || 0);
    // 選んだ順（Ctrl＋クリックで足した順）に並べる
    const order = (store.pickOrder ?? []).filter((id) => store.selectedIds.includes(id));
    const ids = [...order, ...store.selectedIds.filter((id) => !order.includes(id))];
    const into = an.querySelector("[data-k=into]")?.value ?? "";
    (await import("./animpane.js")).addAnimStepMulti(ids, b.dataset.g, { lag, intoStep: into });
  }));
  sec.appendChild(an);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.innerHTML = "ドラッグ・矢印キー（Shift で 10px）でまとめて動かせます。グループにすると、コードで <code>group1</code> のように1つの名前で動かせます（<code>VGroup</code>）。";
  sec.appendChild(hint);
  p.appendChild(sec);
  const pos = document.createElement("section");
  pos.innerHTML = `<h3>位置と表示</h3>`;
  pos.appendChild(centerField(els.map((e) => e.id), "選択中の要素全体の中心（Manim の座標）。"));
  pos.appendChild(selectionRotationField(els.map((e) => e.id), "選択範囲の向き（反時計回りが正）。選んでいる間だけ覚えます。続けて回す・0° に戻すときに使います（いつも同じ組で回すならグループにすると、向きを保存できます）。"));
  pos.appendChild(alignField(new Set(els.map((e) => (e.groupId && e.groupId !== store.enteredGroup ? e.groupId : e.id))).size));
  pos.appendChild(visibleField(els));
  pos.appendChild(zField());
  p.appendChild(pos);
}

// ---------------------------------------------------------------- 画像

const UNIT_PER_PX = () => 8 / store.meta.canvas.h; // キャンバスの px → Manim の単位

function elementLabel(e) {
  if (e.type === "shape") return shapeLabel(e);
  if (e.type === "math") return e.latex || "";
  if (e.type === "image") return e.name || e.path || "";
  if (e.type === "media") return `${e.kind === "video" ? "動画" : "音声"} ${e.name || ""}`;
  return e.text || "";
}

function imageFields(sec, el) {
  const f = document.createElement("div");
  f.className = "field-block";
  f.innerHTML = `<label class="block-label">ファイル</label>
    <img class="img-thumb" alt="">
    <div class="field-note"><span data-k="name"></span><br><code data-k="path"></code>（<span data-k="nat"></span>）</div>
    <div class="field-note ng" data-k="missing" hidden>ファイルが見つかりません。プロジェクトの images フォルダに戻すか、「差し替え…」で選び直してください。</div>
    <div class="row"><button type="button" data-a="replace">差し替え…</button></div>`;
  sec.appendChild(f);
  const thumb = f.querySelector("img");
  const showFile = () => {
    f.querySelector("[data-k=name]").textContent = el.name || "";
    f.querySelector("[data-k=path]").textContent = el.path;
    f.querySelector("[data-k=nat]").textContent = `${el.natW}×${el.natH} 画素`;
    const miss = f.querySelector("[data-k=missing]");
    loadImage(el.path).then((img) => { thumb.src = img.src; thumb.hidden = false; miss.hidden = true; })
      .catch(() => { thumb.hidden = true; miss.hidden = false; });
  };
  showFile();
  f.querySelector("[data-a=replace]").addEventListener("click", async () => {
    const [file] = await pickImageFiles({ multiple: false });
    if (!file) return;
    try {
      await replaceImage(el, file);
      showFile();
      showSize();
    } catch (e) { toast(e.message, "ng", 6000); }
  });

  const u = UNIT_PER_PX();
  const cr = () => el.crop ?? { l: 0, t: 0, r: 1, b: 1 };
  const natRatio = () => ((el.natH || 1) * (cr().b - cr().t)) / ((el.natW || 1) * (cr().r - cr().l)); // トリミングした部分の縦横比
  if (!(el.height > 0)) el.height = Math.round(el.width * natRatio() * 10) / 10;
  const fz = field("大きさ", `<div class="row"><span class="unit">幅</span><input type="number" class="num" min="0.01" step="0.1" data-k="w"><span class="unit">高さ</span><input type="number" class="num" min="0.01" step="0.1" data-k="h"></div>
    <label class="row"><input type="checkbox" data-k="keep" ${el.keepAspect !== false ? "checked" : ""}> 縦横比を固定（幅・高さの入力で、もう一方も変える）</label>
    <div class="row"><button type="button" class="small" data-fit="orig" title="1 画素 = 1080p の 1 画素（Manim の既定の大きさ）">元の大きさ</button><button type="button" class="small" data-fit="fw">画面の幅</button><button type="button" class="small" data-fit="fh">画面の高さ</button><button type="button" class="small" data-fit="ratio" title="幅はそのままで、高さを元の画像の縦横比に戻す">元の縦横比</button></div>
    <div class="field-note">Manim の単位（画面は 横 14.22 × 縦 8）。キャンバスでは、角のハンドルで縦横比を保って、辺の中央のハンドルで横だけ・縦だけ伸び縮みします。</div>`, { top: true });
  sec.appendChild(fz);
  const iw = fz.querySelector("[data-k=w]"), ih = fz.querySelector("[data-k=h]"), keep = fz.querySelector("[data-k=keep]");
  function showSize() {
    iw.value = (el.width * u).toFixed(2);
    ih.value = (el.height * u).toFixed(2);
  }
  showSize();
  const setSizePx = (w, h) => {
    if (!(w > 0) || !(h > 0)) return;
    el.width = Math.round(w * 10) / 10;
    el.height = Math.round(h * 10) / 10;
    showSize();
    changed(el);
  };
  keep.addEventListener("change", () => { el.keepAspect = keep.checked; markDirty("prop"); });
  iw.addEventListener("change", () => {
    const w = Number(iw.value) / u;
    setSizePx(w, keep.checked ? el.height * w / el.width : el.height);
  });
  ih.addEventListener("change", () => {
    const h = Number(ih.value) / u;
    setSizePx(keep.checked ? el.width * h / el.height : el.width, h);
  });
  fz.querySelectorAll("[data-fit]").forEach((b) => b.addEventListener("click", () => {
    const { w, h } = store.meta.canvas;
    const r = el.height / el.width; // 今の縦横比
    const k = b.dataset.fit;
    if (k === "orig") setSizePx(el.natW * (cr().r - cr().l), el.natH * (cr().b - cr().t));
    else if (k === "fw") setSizePx(w, w * r);
    else if (k === "fh") setSizePx(h / r, h);
    else if (k === "ratio") setSizePx(el.width, el.width * natRatio());
  }));
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(iw)) showSize(); });

  imageCropFields(sec, el, showSize);

  const fo = field("不透明度", `<div class="row"><input type="range" min="0" max="100" step="5" value="${Math.round((el.opacity ?? 1) * 100)}"><output>${Math.round((el.opacity ?? 1) * 100)}%</output></div>`);
  sec.appendChild(fo);
  const or = fo.querySelector("input"), oo = fo.querySelector("output");
  or.addEventListener("input", () => { el.opacity = Number(or.value) / 100; oo.textContent = `${or.value}%`; changed(el); });

  const sm = document.createElement("label");
  sm.className = "row";
  sm.innerHTML = `<input type="checkbox" ${el.smooth !== false ? "checked" : ""}> 拡大・縮小をなめらかにする（オフ: ドット絵などの画素をぼかさない）`;
  sm.querySelector("input").addEventListener("change", (e) => { el.smooth = e.target.checked; changed(el); });
  sec.appendChild(sm);
}

// ---------------------------------------------------------------- 画像のトリミング・図形の形での切り抜き

function imageCropFields(sec, el, showSize) {
  const pc = (v) => Math.round(v * 1000) / 10;
  const c = el.crop ?? { l: 0, t: 0, r: 1, b: 1 };
  const ft = field("トリミング", `<div class="row"><span class="unit">左</span><input type="number" class="num" data-c="l" min="0" max="99" step="1" value="${pc(c.l)}"><span class="unit">右</span><input type="number" class="num" data-c="r" min="0" max="99" step="1" value="${pc(1 - c.r)}"><span class="unit">%</span></div>
    <div class="row"><span class="unit">上</span><input type="number" class="num" data-c="t" min="0" max="99" step="1" value="${pc(c.t)}"><span class="unit">下</span><input type="number" class="num" data-c="b" min="0" max="99" step="1" value="${pc(1 - c.b)}"><span class="unit">%</span></div>
    <div class="row"><button type="button" class="small" data-a="cropmode">キャンバスで範囲を決める</button><button type="button" class="small" data-a="cropreset">トリミングを外す</button></div>
    <div class="field-note">元の画像の端から切り落とす割合。残した部分は、今の位置のまま残ります（元の画像は書き換えません）。</div>`, { top: true });
  sec.appendChild(ft);
  ft.querySelectorAll("[data-c]").forEach((inp) => inp.addEventListener("change", () => {
    const v = (k) => Math.min(99, Math.max(0, Number(ft.querySelector(`[data-c=${k}]`).value) || 0)) / 100;
    const next = { l: v("l"), t: v("t"), r: 1 - v("r"), b: 1 - v("b") };
    if (!setCrop(el, next)) { toast("残す範囲がありません（左＋右、上＋下を 100% より小さくしてください）。", "warn"); return; }
    showSize(); changed(el);
  }));
  ft.querySelector("[data-a=cropmode]").addEventListener("click", () => startCropMode(el, () => { emit("selection"); }));
  ft.querySelector("[data-a=cropreset]").addEventListener("click", () => { setCrop(el, { l: 0, t: 0, r: 1, b: 1 }); showSize(); changed(el); emit("selection"); });

  // 図形の形で切り抜く
  const slide = currentSlide();
  const cands = slide.elements.filter((e) => e.id !== el.id && !["image", "media"].includes(e.type) && e.shape !== "zoom");
  const mk = el.mask ?? { id: "", invert: false };
  const fm = field("図形の形で切り抜く", `<div class="row"><select data-k="mid"><option value="">（切り抜かない）</option>${cands.map((e) => `<option value="${e.id}" ${e.id === mk.id ? "selected" : ""}>${escapeHtml(e.var)}</option>`).join("")}</select></div>
    ${mk.id ? `<label class="row"><input type="checkbox" data-k="inv" ${mk.invert ? "checked" : ""}> 形の外側を残す（形の所をくり抜く）</label>
    <div class="row"><button type="button" class="small" data-a="hideshape">型の要素を最初は出さない</button></div>` : ""}
    <div class="field-note">選んだ要素（図形・手書き・ベジェ曲線・文字・数式など）の形と重なる所だけを見せます（共通部分）。開いた線は、始めと終わりを結んだ形にします。
    今の画像と型の位置で切り抜くので、あとで画像を動かすと、切り抜いた形のまま動きます。型の要素はふつうの要素として残るので、見せたくなければ「最初は出さない」にします。</div>`, { top: true });
  sec.appendChild(fm);
  fm.querySelector("[data-k=mid]").addEventListener("change", (e) => { el.mask = { id: e.target.value, invert: !!el.mask?.invert }; changed(el); emit("selection"); });
  fm.querySelector("[data-k=inv]")?.addEventListener("change", (e) => { el.mask = { ...el.mask, invert: e.target.checked }; changed(el); });
  fm.querySelector("[data-a=hideshape]")?.addEventListener("click", () => {
    const t = slide.elements.find((e) => e.id === mk.id);
    if (!t) return;
    t.visibleAtStart = false;
    markDirty("prop");
    refreshElement(t);
    toast(`「${t.var}」を最初は出さない要素にしました（キャンバスでは薄く表示されます）。`);
  });
}

// ---------------------------------------------------------------- 基本の項目

function field(label, inner, { top = false } = {}) {
  const d = document.createElement("div");
  d.className = `field${top ? " top" : ""}`;
  d.innerHTML = `<label>${label}</label><div>${inner}</div>`;
  return d;
}

function basicSection(el) {
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>${{ math: "数式（MathTex）", text: "テキスト（Text）", image: "画像（ImageMobject）", media: el.kind === "video" ? "動画" : "音声" }[el.type] ?? el.type}</h3>`;

  // 変数名
  const fVar = field("変数名", `<input data-k="var" value="${escapeHtml(el.var)}" spellcheck="false"><div class="field-note" data-note="var">コードからこの名前で参照します。</div>`);
  sec.appendChild(fVar);
  const varInput = fVar.querySelector("input");
  const varNote = fVar.querySelector("[data-note=var]");
  varInput.addEventListener("input", () => {
    const msg = checkVarName(varInput.value.trim(), el.id);
    varNote.textContent = msg || "コードからこの名前で参照します。";
    varNote.className = `field-note${msg ? " ng" : ""}`;
  });
  varInput.addEventListener("change", () => {
    const nv = varInput.value.trim();
    if (checkVarName(nv, el.id) || nv === el.var) { if (nv !== el.var) toast("変数名を確認してください。", "warn"); return; }
    const n = renameVar(el.var, nv);
    el.var = nv;
    markDirty("var");
    renderStepChips();
    if (n) toast(`コード欄の「${nv}」への置き換え: ${n} か所`);
  });

  if (el.type === "image") {
    imageFields(sec, el);
    return sec;
  }
  if (el.type === "media") {
    mediaPanel(sec, el, { field, changed, rerender: () => renderProps() });
    return sec;
  }
  if (el.type === "shape") {
    shapeFields(sec, el, { field, changed });
    return sec;
  }
  if (el.type === "text") {
    if (!Array.isArray(el.runs) || !el.runs.length) el.runs = [{ t: el.text || "" }];
    const f = document.createElement("div");
    f.className = "field-block";
    f.innerHTML = `<label class="block-label">内容</label>`;
    richEditor = createRichEditor({
      runs: el.runs, defaultColor: el.color, defaultOpacity: el.opacity ?? 1,
      onChange: (runs) => { el.runs = runs; el.text = plainOf(runs); changed(el); },
    });
    f.appendChild(richEditor.el);
    // 参照（{ref:ラベル}）を入れる: ラベルを付けた定理・式・図の番号になる
    const labs = labelList();
    if (labs.length || el.numberOf) {
      const rf = document.createElement("div");
      rf.className = "row ref-insert";
      rf.innerHTML = `<select data-k="ref-ins"><option value="">参照を入れる…</option>
        ${el.numberOf ? `<option value="{番号}">{番号}（この番号のテキストが付いた式・図の番号）</option>` : ""}
        ${labs.map((x) => `<option value="{ref:${escapeHtml(x.label)}}">${escapeHtml(x.text)} — ${escapeHtml(x.label)}</option>`).join("")}</select>`;
      rf.querySelector("select").addEventListener("mousedown", () => {}, { passive: true });
      rf.querySelector("select").addEventListener("change", (e) => {
        if (e.target.value) richEditor.insertText(e.target.value);
        e.target.value = "";
      });
      f.appendChild(rf);
    }
    sec.appendChild(f);

    const opts = fontOptionsHtml(el.font);
    const ff = field("フォント", `<select data-k="font">${opts}</select><div class="field-note" data-note="font"></div>`);
    sec.appendChild(ff);
    const fontSel = ff.querySelector("select");
    const fontNote = ff.querySelector("[data-note=font]");
    const updateFontNote = () => {
      const inst = fontInstalled(fontSel.value);
      fontNote.textContent = fontNoteText(fontSel.value);
      fontNote.className = `field-note${inst === false ? " warn" : ""}`;
    };
    updateFontNote();
    fontSel.addEventListener("change", () => {
      el.font = fontSel.value;
      updateFontNote();
      if (fontInstalled(el.font) === false) toast(`「${el.font}」は導入されていません。`, "warn", 5000);
      changed(el);
    });
  } else {
    const f = field("LaTeX", `<textarea class="latex" data-k="latex" rows="3" spellcheck="false">${escapeHtml(el.latex)}</textarea><div class="field-note" data-note="latex"></div>`, { top: true });
    sec.appendChild(f);
    const note = f.querySelector("[data-note=latex]");
    const showNote = (err) => {
      note.textContent = err ? `仮表示: ${err}` : "日本語は \\text{…} で書けます。表示は MathJax による仮表示です。";
      note.className = `field-note${err ? " warn" : ""}`;
    };
    showNote(mathErrorOf(el.id));
    // 複数行（\\ で改行）の揃え方。& がある数式は & の位置で揃う（Manim の align*）
    const fa = field("複数行の揃え", `<div class="seg" data-k="malign">
      <button type="button" data-v="left">左</button><button type="button" data-v="center">中央</button><button type="button" data-v="right">右</button></div>
      <div class="field-note" data-note="malign"></div>`);
    sec.appendChild(fa);
    const segA = fa.querySelector("[data-k=malign]"), noteA = fa.querySelector("[data-note=malign]");
    const showAlign = () => {
      const amp = hasAmp(el.latex);
      segA.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.v === (el.mathAlign || "center")); b.disabled = amp; });
      noteA.textContent = amp ? "& があるので、& の位置で行を揃えます（align*）。" : (hasLineBreak(el.latex) ? "\\\\ で改行した行の揃え方です。" : "\\\\ で改行したときの行の揃え方です。");
    };
    showAlign();
    segA.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b || b.disabled) return;
      el.mathAlign = b.dataset.v;
      showAlign();
      changed(el);
    });
    // 一部の色（tex_to_color_map と同じ）: 数式の中の同じ文字に、すべて色を付ける
    const fcm = field("一部の色", `<ul class="cmap"></ul><div class="row"><button type="button" class="small" data-a="cm-add">＋ 色を付ける文字</button>
      <button type="button" class="small" data-a="cm-sel" title="上の LaTeX の欄で選んだ文字を、色を付ける文字として足す">LaTeX で選んだ文字を足す</button></div>
      <div class="field-note">数式の中の同じ文字（LaTeX の書き方。空白は無視）すべてに色を付けます（Manim の tex_to_color_map と同じ）。例: <code>x</code>・<code>\\pi</code>・<code>x^2</code>・<code>\\frac{1}{2}</code>。長い文字を先に探します。</div>`, { top: true });
    sec.appendChild(fcm);
    const cmList = fcm.querySelector(".cmap");
    const CM_PAL = ["#FC6255", "#58C4DD", "#83C167", "#FFFF00", "#FF862F", "#9A72AC", "#5CD0B3", "#D147BD"];
    const cmCounts = () => {
      const { counts } = colorize(el.latex, el.colorMap ?? []);
      cmList.querySelectorAll("[data-cnt]").forEach((sp) => {
        const i = Number(sp.dataset.cnt), r = el.colorMap[i], n = counts[i] ?? 0;
        sp.textContent = !ruleTokens(r?.tex ?? "") ? "使えない文字" : n ? `${n} か所` : "見つかりません";
        sp.classList.toggle("warn", !n);
      });
    };
    const drawCm = () => {
      el.colorMap ??= [];
      cmList.innerHTML = el.colorMap.map((r, i) => `<li data-i="${i}"><input type="text" class="cm-tex" value="${escapeHtml(r.tex)}" spellcheck="false" placeholder="x">
        <input type="color" value="${String(r.color).toLowerCase()}"><span class="hint" data-cnt="${i}"></span><span class="grow"></span><button type="button" class="icon" data-a="cm-del" title="消す">×</button></li>`).join("");
      cmList.querySelectorAll("li").forEach((li) => {
        const i = Number(li.dataset.i);
        li.querySelector(".cm-tex").addEventListener("input", (e) => { el.colorMap[i].tex = e.target.value; cmCounts(); changed(el); });
        li.querySelector("input[type=color]").addEventListener("input", (e) => { el.colorMap[i].color = e.target.value.toUpperCase(); changed(el); });
        li.querySelector("[data-a=cm-del]").addEventListener("click", () => { el.colorMap.splice(i, 1); drawCm(); changed(el); });
      });
      cmCounts();
    };
    const addCm = (tex) => {
      el.colorMap ??= [];
      el.colorMap.push({ tex, color: CM_PAL[el.colorMap.length % CM_PAL.length] });
      drawCm();
      changed(el);
      cmList.querySelector("li:last-child .cm-tex")?.focus();
    };
    fcm.querySelector("[data-a=cm-add]").addEventListener("click", () => addCm(""));
    fcm.querySelector("[data-a=cm-sel]").addEventListener("click", () => {
      const ta = f.querySelector("textarea");
      const t = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (!t) { toast("上の LaTeX の欄で、色を付ける文字を選んでから押してください。", "warn"); return; }
      if (!ruleTokens(t)) { toast("その文字は使えません（中かっこ { } の対が合わない・& や \\\\ を含む・^ や _ で始まる／終わるなど）。", "warn", 6000); return; }
      addCm(t);
    });
    drawCm();
    f.querySelector("textarea").addEventListener("input", (e) => { el.latex = e.target.value; showAlign(); cmCounts(); changed(el); });
    sec._showNote = showNote;
    const off = on("element-rendered", ({ el: r, error }) => {
      if (!document.body.contains(note)) return off();
      if (r.id === el.id) showNote(error);
    });
  }

  const fs = field("文字サイズ", `<div class="row"><input type="number" class="num" min="1" max="400" step="any" data-k="fontSize" value="${el.fontSize}"><span class="unit">font_size</span></div>`);
  sec.appendChild(fs);
  fs.querySelector("input").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    if (v > 0) { el.fontSize = v; changed(el); }
  });

  const fc = field("文字色", `<div class="row"><input type="color" value="${el.color}"><input class="hex" value="${el.color}" maxlength="7" spellcheck="false"></div>`);
  sec.appendChild(fc);
  const [cPick, cHex] = fc.querySelectorAll("input");
  cPick.addEventListener("input", () => { el.color = cPick.value.toUpperCase(); cHex.value = el.color; richEditor?.setDefaults(el.color, el.opacity ?? 1); changed(el); });
  cHex.addEventListener("change", () => {
    const h = normalizeHex(cHex.value);
    if (!h) { cHex.value = el.color; return; }
    el.color = h; cPick.value = h; cHex.value = h; richEditor?.setDefaults(el.color, el.opacity ?? 1); changed(el);
  });
  return sec;
}

function changed(el) {
  markDirty("prop");
  scheduleRefresh(el);
}

/** 変数名の変更に合わせて、プロジェクト中のコード欄の参照を置き換える。置き換えた数を返す。 */
function renameVar(oldName, newName) {
  let n = 0;
  const re = new RegExp(`(?<![A-Za-z0-9_.])${oldName}(?![A-Za-z0-9_])`, "g");
  for (const s of store.project.slides) {
    for (const st of s.steps) {
      st.code = (st.code || "").replace(re, () => { n++; return newName; });
      for (const r of st.rows ?? []) if (r.kind === "code") r.code = (r.code || "").replace(re, () => { n++; return newName; });
    }
  }
  for (const [id, ed] of editors) {
    const st = currentSlide().steps.find((x) => x.id === id);
    if (st) ed.value = st.code;
  }
  return n;
}

// ---------------------------------------------------------------- 段落（配置・間隔・縦書き・不透明度）

function numberInput(value, { min, max, step, cls = "num" }) {
  return `<input type="number" class="${cls}" min="${min}" max="${max}" step="${step}" value="${value}">`;
}

function paragraphSection(el) {
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>段落</h3>`;
  const labels = el.vertical
    ? [["left", "上"], ["center", "中央"], ["right", "下"], ["justify", "均等"]]
    : [["left", "左"], ["center", "中央"], ["right", "右"], ["justify", "両端"]];
  const fa = field("配置", `<div class="seg">${labels.map(([v, t]) => `<button type="button" data-align="${v}" class="${el.align === v ? "on" : ""}">${t}</button>`).join("")}</div>`);
  sec.appendChild(fa);
  fa.querySelectorAll("[data-align]").forEach((b) => b.addEventListener("click", () => {
    el.align = b.dataset.align;
    fa.querySelectorAll("[data-align]").forEach((x) => x.classList.toggle("on", x === b));
    changed(el);
  }));

  const fl = field("文字間隔", `<div class="row">${numberInput(el.letterSpacing ?? 0, { min: -0.5, max: 3, step: 0.05 })}<span class="unit">em（1 文字分 = 1）</span></div>`);
  sec.appendChild(fl);
  fl.querySelector("input").addEventListener("input", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.letterSpacing = v; changed(el); } });

  const fh = field(el.vertical ? "列の間隔" : "行間隔", `<div class="row">${numberInput(el.lineSpacing ?? 1, { min: 0.3, max: 5, step: 0.1 })}<span class="unit">倍</span></div>`);
  sec.appendChild(fh);
  fh.querySelector("input").addEventListener("input", (e) => { const v = Number(e.target.value); if (v > 0) { el.lineSpacing = v; changed(el); } });

  if (!el.vertical) {
    // 自動の折り返し: 決めた幅（キャンバスの px）で行を折り返す。左右のハンドルは「文字の大きさはそのまま、幅を変える」になる
    const on = el.wrapWidth != null;
    const fw = field("折り返し", `<label class="row check-row"><input type="checkbox" data-wrap ${on ? "checked" : ""}> 自動で折り返す</label>
      <div class="row" ${on ? "" : "hidden"} data-wrap-row>幅 ${numberInput(Math.round(el.wrapWidth ?? 0), { min: 20, max: 4000, step: 10 })}<span class="unit">px</span></div>
      <div class="field-note">${on ? "左右のハンドルで、文字の大きさを変えずに幅を変えられます。角のハンドルは文字ごと拡大・縮小します。" : "オンにすると、決めた幅で行を自動で折り返します（日本語は文字の間、英語は単語の間）。"}</div>`, { top: true });
    sec.appendChild(fw);
    fw.querySelector("[data-wrap]").addEventListener("change", (e) => {
      if (e.target.checked) {
        // 今の文字の幅を初めの幅にするが、スライドより広くはしない（左右に 60px ずつの余白を残す）
        const cw = store.meta?.canvas?.w ?? 1920;
        const w = Math.round(objectWidth(el.id)) || 600;
        el.wrapWidth = Math.max(20, Math.min(w, cw - 120));
      } else el.wrapWidth = null;
      changed(el);
      renderProps();
    });
    fw.querySelector("[data-wrap-row] input").addEventListener("change", (e) => {
      const v = Number(e.target.value);
      if (v >= 20) { el.wrapWidth = v; changed(el); }
    });
  }

  const fv = document.createElement("label");
  fv.className = "row check-row";
  fv.innerHTML = `<input type="checkbox" ${el.vertical ? "checked" : ""}> 縦書き（右の列から左へ）`;
  fv.querySelector("input").addEventListener("change", (e) => { el.vertical = e.target.checked; changed(el); renderProps(); });
  sec.appendChild(fv);

  const fo = field("不透明度", `<div class="row"><input type="range" min="0" max="100" step="5" value="${Math.round((el.opacity ?? 1) * 100)}"><output>${Math.round((el.opacity ?? 1) * 100)}%</output></div><div class="field-note">文字ごとに不透明度を付けていない部分に使います。</div>`);
  sec.appendChild(fo);
  const or = fo.querySelector("input"), oo = fo.querySelector("output");
  or.addEventListener("input", () => { oo.textContent = `${or.value}%`; el.opacity = Number(or.value) / 100; richEditor?.setDefaults(el.color, el.opacity); changed(el); });
  return sec;
}

// ---------------------------------------------------------------- 効果（縁取り・中抜き・背景ボックス・円弧）

function effectsSection(el) {
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>文字の効果</h3>`;
  el.outline ??= { mode: "none", width: 0.06, color: null };
  el.box ??= { on: false, color: "#FFFFFF", opacity: 1, padding: 0.3, radius: 0.2, follow: true };
  el.box.follow ??= true;
  const o = el.outline, b = el.box;

  const fo = field("縁取り", `
    <div class="row"><select data-k="mode">
      <option value="none" ${o.mode === "none" ? "selected" : ""}>なし</option>
      <option value="stroke" ${o.mode === "stroke" ? "selected" : ""}>縁取り</option>
      <option value="hollow" ${o.mode === "hollow" ? "selected" : ""}>中抜き（線だけ）</option></select>
      <span class="unit">太さ</span>${numberInput(o.width ?? 0.06, { min: 0.01, max: 0.5, step: 0.01 })}<span class="unit">em</span></div>
    <div class="row"><label class="row"><input type="checkbox" data-k="same" ${o.color ? "" : "checked"}> 文字と同じ色</label>
      <input type="color" data-k="color" value="${(o.color || "#000000").toLowerCase()}" ${o.color ? "" : "disabled"}></div>`, { top: true });
  sec.appendChild(fo);
  const [mode, width, same, color] = ["select", "input[type=number]", "[data-k=same]", "[data-k=color]"].map((q) => fo.querySelector(q));
  mode.addEventListener("change", () => { o.mode = mode.value; changed(el); });
  width.addEventListener("input", () => { const v = Number(width.value); if (v > 0) { o.width = v; changed(el); } });
  same.addEventListener("change", () => { color.disabled = same.checked; o.color = same.checked ? null : color.value.toUpperCase(); changed(el); });
  color.addEventListener("input", () => { o.color = color.value.toUpperCase(); changed(el); });

  const fb = field("背景ボックス", `
    <label class="row"><input type="checkbox" data-k="on" ${b.on ? "checked" : ""}> 文字の後ろに箱を置く</label>
    <div class="row"><input type="color" data-k="color" value="${b.color.toLowerCase()}"><span class="unit">不透明度</span><input type="range" data-k="opacity" min="0" max="100" step="5" value="${Math.round(b.opacity * 100)}"></div>
    <div class="row"><span class="unit">余白</span>${numberInput(b.padding, { min: 0, max: 3, step: 0.05 }).replace("<input", '<input data-k="padding"')}<span class="unit">角丸</span>${numberInput(b.radius, { min: 0, max: 3, step: 0.05 }).replace("<input", '<input data-k="radius"')}<span class="unit">em</span></div>
    <label class="row"><input type="checkbox" data-k="follow" ${b.follow ? "checked" : ""}> 円弧に沿って箱も曲げる</label>
    <div class="field-note">箱があるときは、コードで .text（文字）と .box（箱）を参照できます。</div>`, { top: true });
  sec.appendChild(fb);
  const q = (k) => fb.querySelector(`[data-k=${k}]`);
  q("on").addEventListener("change", (e) => { b.on = e.target.checked; changed(el); });
  q("follow").addEventListener("change", (e) => { b.follow = e.target.checked; changed(el); });
  q("color").addEventListener("input", (e) => { b.color = e.target.value.toUpperCase(); changed(el); });
  q("opacity").addEventListener("input", (e) => { b.opacity = Number(e.target.value) / 100; changed(el); });
  q("padding").addEventListener("input", (e) => { const v = Number(e.target.value); if (v >= 0) { b.padding = v; changed(el); } });
  q("radius").addEventListener("input", (e) => { const v = Number(e.target.value); if (v >= 0) { b.radius = v; changed(el); } });

  const fc = field("円弧", `<div class="row"><input type="range" min="-180" max="180" step="5" value="${el.arc ?? 0}"><output>${el.arc ?? 0}°</output></div><div class="field-note">${el.vertical ? "縦書きは列の向きに沿って、正の角度で右に、負の角度で左に膨らみます" : "正の角度で上に、負の角度で下に膨らみます"}（0 で曲げない）。背景ボックスを曲げるかどうかは「背景ボックス」で選べます。</div>`);
  sec.appendChild(fc);
  const ar = fc.querySelector("input"), ao = fc.querySelector("output");
  ar.addEventListener("input", () => { ao.textContent = `${ar.value}°`; el.arc = Number(ar.value); changed(el); });
  return sec;
}

// ---------------------------------------------------------------- 位置

/** 整列（n: 動かす単位の数。1 ならスライドに、2 以上なら選んだ物どうしでそろえる）。 */
function alignField(n) {
  const f = field(n >= 2 ? "整列" : "スライドに揃える", `${alignButtonsHtml(n)}<div class="field-note">${n >= 2
    ? "選んだ物全体の枠に合わせて、端・中央をそろえます。3 つ以上なら、間隔もそろえられます（グループは 1 つとして動かします）。"
    : "スライドの端・中央に合わせます。"}</div>`, { top: true });
  bindAlignButtons(f);
  return f;
}

// 番号・ラベル: 参照（{ref:ラベル}）の名前、数式の番号・図のキャプションを付ける
function refSection(el) {
  const sec = document.createElement("section");
  const plan = refPlan();
  const slide = currentSlide();
  if (el.type === "text" && el.numberOf) {
    const t = findElement(el.numberOf);
    sec.innerHTML = `<h3>番号・ラベル</h3><p class="hint">このテキストは ${t ? `<a href="#" data-k="go">${escapeHtml(t.var)}</a>` : "（消した要素）"} の${el.numberKind === "fig" ? "図の番号（キャプション）" : "式の番号"}です。
      文の中の <code>{番号}</code> が「${escapeHtml(plan.numbers[el.id]?.text ?? "??")}」になります（番号はスライドの順と、上からの位置で決まります）。</p>`;
    sec.querySelector("[data-k=go]")?.addEventListener("click", async (e) => { e.preventDefault(); (await sel()).select(t.id); });
    return sec;
  }
  const info = el.refLabel ? plan.labels[el.refLabel] : null;
  const own = info && info.elementId === el.id ? info : null;
  const comp = (slide.elements ?? []).find((e) => e.type === "text" && e.numberOf === el.id);
  const canEq = el.type === "math";
  const canFig = el.type === "image" || (el.type === "shape" && !["theorem", "title"].includes(el.shape));
  sec.innerHTML = `<h3>番号・ラベル</h3>
    ${field("ラベル", `<input data-k="lab" value="${escapeHtml(el.refLabel ?? "")}" placeholder="例: ${canEq ? "eq:main" : canFig ? "fig:graph" : "thm:main"}" spellcheck="false">
      <div class="field-note">${el.refLabel ? (own ? `ほかの所に <code>{ref:${escapeHtml(el.refLabel)}}</code> と書くと「${escapeHtml(own.text)}」になります（押すとこのスライドへ飛びます）。` : `<b class="warn">同じラベルが、ほかの要素にも付いています。</b>`)
        : "名前を付けると、テキスト・数式・LaTeX の文章で <code>{ref:名前}</code> と書いて、この要素の番号を参照できます（空白と { } は使えません）。"}</div>`).outerHTML}
    ${canEq || canFig ? `<div class="row">${comp ? `<button type="button" class="small" data-k="comp-go">${canEq ? "式の番号" : "キャプション"}（${escapeHtml(comp.var)}）を選ぶ</button><button type="button" class="small" data-k="comp-del">外す</button>`
      : `<button type="button" class="small" data-k="comp-add">${canEq ? "式の番号 (1.1) を付ける" : "図の番号（キャプション）を付ける"}</button>`}</div>
      <p class="hint" style="margin-top:2px">${canEq ? "式の右に「(章.番号)」のテキストを置き、式と一緒のグループにします。" : "下に「図 章.番号　説明」のテキストを置き、一緒のグループにします（説明の文は自由に書き換えられます）。"}
        番号のテキストはふつうのテキストなので、位置・大きさ・色を変えられます。</p>` : ""}`;
  const inp = sec.querySelector("[data-k=lab]");
  inp.addEventListener("change", () => {
    const v = inp.value.replace(/[{}\s]/g, "").slice(0, 60);
    if (v) el.refLabel = v; else delete el.refLabel;
    markDirty("prop");
    renderProps();
  });
  sec.querySelector("[data-k=comp-go]")?.addEventListener("click", async () => (await sel()).select(comp.id));
  sec.querySelector("[data-k=comp-del]")?.addEventListener("click", async () => {
    if (!confirm(`「${comp.var}」（番号のテキスト）を削除しますか？`)) return;
    const S = await sel();
    S.selectMany([comp.id]);
    S.deleteSelection();
    S.select(el.id);
  });
  sec.querySelector("[data-k=comp-add]")?.addEventListener("click", async () => {
    if (!el.refLabel) {
      const base = canEq ? "eq" : "fig";
      const used = new Set(store.project.slides.flatMap((s) => s.elements.map((e) => e.refLabel)).filter(Boolean));
      let n = 1;
      while (used.has(`${base}:${el.var}${n > 1 ? n : ""}`)) n++;
      el.refLabel = `${base}:${el.var}${n > 1 ? n : ""}`;
    }
    const s = store.project.settings;
    const w = objectWidth(el.id) || 0, h = objectHeight(el.id) || 0;
    const t = makeElement("text", canEq ? Math.min(store.meta.canvas.w - 120, el.x + w / 2 + 160) : el.x, canEq ? el.y : el.y + h / 2 + 34);
    Object.assign(t, {
      runs: [{ t: canEq ? "{番号}" : "{番号}　ここに説明を書きます" }], numberOf: el.id, numberKind: canEq ? "eq" : "fig",
      fontSize: canEq ? Math.round((Number(el.fontSize) || s.defaultFontSize) * 0.85) : 28, align: canEq ? "left" : "center",
      visibleAtStart: el.visibleAtStart !== false, var: uniqueVar(canEq ? "eqno" : "caption"),
    });
    t.text = t.runs[0].t;
    slide.elements.push(t);
    markDirty("add");
    await refreshElement(t);
    const S = await sel();
    if (!el.groupId) {
      S.selectMany([el.id, t.id]);
      S.groupSelection();
    } else {
      t.groupId = el.groupId;
      S.afterOrderChange();
      S.select(t.id);
    }
    toast(canEq ? "式の番号を付けました（式と一緒のグループです）。" : "図の番号を付けました（図と一緒のグループです）。説明の文を書き換えてください。", "", 5000);
  });
  return sec;
}

// 押すと飛ぶ（リンク）: 発表ウィンドウ・HTML・PDF で、この要素を押すと決めたスライドへ飛ぶ
function linkSection(el) {
  const sec = document.createElement("section");
  const plan = pagePlan();
  const slides = store.project.slides;
  const to = el.link?.to ?? "";
  const missing = to && to !== "back" && !slides.some((s) => s.id === to);
  const opts = slides.map((s, i) => {
    const title = slideTitleText(s).slice(0, 24);
    const lab = `${s.appendix ? "付録 " : "ページ "}${plan[i].number}${title ? `：${title}` : ""}${s.section ? `（章: ${s.section}）` : ""}${s.skip ? "（描画しない）" : ""}`;
    return `<option value="${escapeHtml(s.id)}" ${s.id === to ? "selected" : ""}>${escapeHtml(lab)}</option>`;
  }).join("");
  sec.innerHTML = `<h3>押すと飛ぶ（リンク）</h3>
    <div class="row"><select data-k="link" style="flex:1">
      <option value="" ${!to ? "selected" : ""}>なし</option>
      <option value="back" ${to === "back" ? "selected" : ""}>← 飛ぶ前の所へ戻る</option>
      ${missing ? `<option value="${escapeHtml(to)}" selected>（消したスライド）</option>` : ""}
      <optgroup label="スライドへ飛ぶ">${opts}</optgroup></select></div>
    <p class="hint" style="margin-top:2px">発表ウィンドウでこの要素を押すと（マウスを乗せると指の形）、そのスライドの初めへ飛びます。「戻る」は、リンクで飛ぶ前の所へ戻ります。
      HTML・PDF に出力したファイルでも押せます（PDF の「戻る」は、飛んでくる元が 1 か所ならそのページへ、いくつもあれば「前に見たページへ戻る」になり、後者はブラウザの PDF 表示などでは働かないことがあります）。押せる範囲は、スライドの初めの位置と大きさです。
      ${missing ? `<b style="color:#c62828">飛ぶ先のスライドが見つかりません。選び直してください。</b>` : ""}</p>`;
  sec.querySelector("[data-k=link]").addEventListener("change", (e) => {
    el.link = e.target.value ? { to: e.target.value } : null;
    markDirty("prop");
  });
  return sec;
}

function bindSegLocal(f, k, get, set) {
  const seg = f.querySelector(`[data-k=${k}]`);
  const show = () => seg.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === get()));
  show();
  seg.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== get()) { set(b.dataset.v); show(); } });
}

function positionSection(el) {
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>位置と表示</h3>`;
  const isLine = el.type === "shape" && el.shape === "line";
  const fixedBalloon = el.type === "shape" && el.shape === "balloon" && (el.contentIds ?? []).length > 0;
  if (fixedBalloon) {
    const n = document.createElement("p");
    n.className = "hint";
    n.textContent = "吹き出しの位置と大きさは、中身から決まります（グループを動かすと、まとめて動きます）。";
    sec.appendChild(n);
  }
  // テキスト・数式・LaTeX の文章は、位置の基準（中心・左端・右端）を選べる。端にすると、文字の長さが変わっても端が動かない
  const anchorable = el.type === "text" || el.type === "math" || (el.type === "shape" && el.shape === "tex");
  const anc = anchorable && ["left", "right"].includes(el.anchor) && !Number(el.rotation) ? el.anchor : "center";
  const ex = anc !== "center" && Number.isFinite(Number(el.edgeX)) ? Number(el.edgeX) : null;
  const [mx, my] = toManim(ex ?? el.x, el.y);
  const ancHtml = anchorable ? `<div class="row"><span class="unit">基準</span><div class="seg" data-k="anc"><button type="button" data-v="center">中心</button><button type="button" data-v="left">左端</button><button type="button" data-v="right">右端</button></div></div>` : "";
  const f = field("座標", `${ancHtml}<div class="row"><span class="unit">x${anc === "left" ? "（左端）" : anc === "right" ? "（右端）" : ""}</span><input type="number" class="num" step="0.1" data-k="mx" value="${mx.toFixed(2)}"><span class="unit">y</span><input type="number" class="num" step="0.1" data-k="my" value="${my.toFixed(2)}"></div><div class="field-note">Manim の座標（中心が原点、横 ±7.11・縦 ±4、上が正）${anchorable ? "。基準を左端・右端にすると、文字の長さが変わっても（{章} など）、その端の位置が保たれます" : ""}</div>`);
  sec.appendChild(f);
  const [ix, iy] = f.querySelectorAll("input[type=number]");
  const halfW = () => (objectWidth(el.id) || 0) / 2;
  const apply = () => {
    const x = Number(ix.value), y = Number(iy.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const [px, py] = fromManim(x, y).map((v) => Math.round(v * 10) / 10);
    el.y = py;
    if (anc === "center") el.x = px;
    else { el.edgeX = px; el.x = Math.round((anc === "left" ? px + halfW() : px - halfW()) * 10) / 10; }
    moveObject(el);
    markDirty("move");
    emit("slide-changed");
  };
  if (anchorable) bindSegLocal(f, "anc", () => anc, (v) => {
    if (v !== "center" && Number(el.rotation)) { toast("回している文字は、中心を基準にします。", "warn"); return; }
    el.anchor = v === "center" ? undefined : v;
    if (v === "center") delete el.edgeX;
    else el.edgeX = Math.round((v === "left" ? el.x - halfW() : el.x + halfW()) * 10) / 10;
    markDirty("prop");
    emit("selection", store.selectedId);
  });
  ix.addEventListener("change", apply);
  iy.addEventListener("change", apply);
  const fr = field("回転", `<div class="row"><input type="number" class="num" step="any" data-k="rot" value="${Number(el.rotation) || 0}"><span class="unit">°</span><button type="button" class="small" data-a="rot0">0° に戻す</button></div><div class="field-note">反時計回りが正（Manim と同じ）。キャンバスでは上の丸いハンドルで回せます（Shift で ${15}° 刻み）。</div>`);
  sec.appendChild(fr);
  // 線は両端で向きが決まり、吹き出しは回さないので、回転の欄を出さない。中身のある吹き出しは位置も中身で決まる
  if (isLine || el.type === "media" || (el.type === "shape" && ["balloon", "axes", "graph", "brace", "field", "axdot", "angle", "graphpart", "curve2d", "implicit", "barchart", "statchart", "boolean", "samplespace", "netgraph", "annot", "vector", "linegraph", "points", "trace", "zoom", "tangent"].includes(el.shape))) fr.hidden = true;
  // 合成した図形・注釈・座標軸のベクトルの位置は、元の図形・付ける要素・座標軸で決まる
  if (el.type === "shape" && (["boolean", "annot", "linegraph", "points", "trace", "tangent"].includes(el.shape) || (el.shape === "vector" && el.axesId))) f.hidden = true;
  // 表・行列のセルの要素の位置は表が決める。要素を入れた表は回さない（セルの要素の向きがずれるため）
  const box = cellContainerOf(el.id);
  if (box) {
    f.hidden = true;
    const fb = field("位置", `<div class="field-note">表「<button type="button" class="link" data-a="box">${escapeHtml(box.var)}</button>」のセルに入っています（位置は表が決めます）。</div>`);
    fb.querySelector("[data-a=box]").addEventListener("click", async () => (await sel()).select(box.id));
    sec.appendChild(fb);
  }
  if (el.type === "shape" && ["table", "matrix"].includes(el.shape) && (el.items ?? []).some((r) => r.some(Boolean))) {
    if (Number(el.rotation)) { el.rotation = 0; markDirty("prop"); }
    fr.hidden = true;
  }
  const is3d = el.type === "shape" && ["solid", "axes3d", "surface", "curve3d", "point3d"].includes(el.shape);
  if (is3d) { fr.hidden = true; f.hidden = true; } // 3D の要素の位置・向きは、図形のパネルの x・y・z で決める
  if (store.project.settings.use3d && !is3d) {
    // 3D のプロジェクトの 2D の要素: カメラを動かしても画面の同じ所に出すか（add_fixed_in_frame_mobjects）
    const ff = field("3D", `<label class="row"><input type="checkbox" data-k="fixed" ${el.fixedInFrame !== false ? "checked" : ""}> 画面に固定（カメラを動かしても正面のまま）</label>
      <div class="field-note">オフにすると、空間の z = 0 の平面に置きます（カメラを傾けると一緒に傾きます。キャンバスは正面から見た形のまま表示します）。</div>`);
    ff.querySelector("[data-k=fixed]").addEventListener("change", (e) => { el.fixedInFrame = e.target.checked; markDirty("prop"); });
    sec.appendChild(ff);
  }
  if (fixedBalloon) f.hidden = true;
  if (isLine) f.querySelector(".field-note").textContent = "線の中点（Manim の座標）。変えると線全体が動きます。";
  const ir = fr.querySelector("input");
  const setRot = (v) => {
    if (!Number.isFinite(v)) return;
    let d = ((v % 360) + 540) % 360 - 180;
    if (d === -180) d = 180;
    el.rotation = Math.round(d * 100) / 100;
    ir.value = el.rotation;
    moveObject(el);
    markDirty("move");
    emit("slide-changed");
  };
  ir.addEventListener("change", () => setRot(Number(ir.value)));
  fr.querySelector("[data-a=rot0]").addEventListener("click", () => setRot(0));
  const off = on("element-moved", (m) => {
    if (!document.body.contains(ix)) return off();
    if (m.id !== el.id) return;
    // 基準が左端・右端なら、欄はラベルどおりその端の x（中心の x を入れると、次に y を入れたとき端として使われてずれる）
    const edge = anc !== "center" && Number.isFinite(Number(el.edgeX)) ? Number(el.edgeX) : null;
    const [a, b] = toManim(edge ?? el.x, el.y);
    if (document.activeElement !== ix) ix.value = a.toFixed(2);
    if (document.activeElement !== iy) iy.value = b.toFixed(2);
    if (document.activeElement !== ir) ir.value = Number(el.rotation) || 0;
  });

  const vis = document.createElement("label");
  vis.className = "row";
  vis.style.margin = "4px 0 8px";
  vis.innerHTML = `<input type="checkbox" ${el.visibleAtStart !== false ? "checked" : ""}> スライド開始時に表示（self.add）`;
  vis.querySelector("input").addEventListener("change", (e) => {
    el.visibleAtStart = e.target.checked;
    markDirty("prop");
    refreshElement(el);
    // 表・行列なら、セルの要素の薄い表示も合わせる
    for (const iid of (el.items ?? []).flat()) { const it = iid && findElement(iid); if (it) refreshElement(it); }
  });
  if (!el.locked && !el.groupId) sec.appendChild(alignField(1));
  // 表・行列のセルの要素は、ふつうは表の一部（表と一緒に出る・消える）。自分の「出す」があるときだけ、表とは別に出す
  const cellBox = cellContainerOf(el.id);
  if (cellBox && !hasOwnIntro(el.id)) {
    vis.innerHTML = `<span class="hint">表「${escapeHtml(cellBox.var)}」のセルの要素は、表と一緒に出る・消えます。この要素に「＋出す」で動きを足すと、表とは別に、その動きで出ます。</span>`;
  }
  sec.appendChild(vis);
  // 左の一覧で複数のスライドを選んでいるとき: 同じ要素に、位置・大きさなどをそろえる
  const bulk = !el.groupId || store.enteredGroup ? bulkApplyField(el) : null;
  if (bulk) sec.appendChild(bulk);

  const fz = field("重なり順", `<div class="seg">
    <button type="button" data-z="back" title="最背面へ（Ctrl+Shift+[）">最背面</button>
    <button type="button" data-z="backward" title="背面へ（Ctrl+[）">背面</button>
    <button type="button" data-z="forward" title="前面へ（Ctrl+]）">前面</button>
    <button type="button" data-z="front" title="最前面へ（Ctrl+Shift+]）">最前面</button></div>`);
  sec.appendChild(fz);
  fz.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", async () => {
    const { moveLayer } = await import("./layers.js");
    moveLayer(el.id, b.dataset.z);
  }));
  if (el.groupId) {
    const note = document.createElement("div");
    note.className = "field-note";
    note.textContent = "グループの中の要素は、グループの中だけで重なり順が変わります。";
    fz.querySelector("div").appendChild(note);
  }

  const del = document.createElement("button");
  del.className = "danger small";
  del.textContent = "この要素を削除";
  del.addEventListener("click", () => deleteElement(el.id));
  sec.appendChild(del);
  return sec;
}

export function deleteElement(id) {
  const slide = currentSlide();
  const el = findElement(id);
  if (!el) return;
  const ids = withDependents([id]); // 座標軸を消すときは、そのグラフも
  const nSteps = slide.steps.filter((s) => ids.includes(s.elementId)).length;
  if (nSteps && !confirm(`「${el.var}」を削除しますか？（ステップ ${nSteps} 個も削除されます）`)) return;
  slide.elements = slide.elements.filter((e) => !ids.includes(e.id));
  slide.steps = slide.steps.filter((s) => !ids.includes(s.elementId));
  // 消した要素への参照を外す（2 つのグラフの間の面積は x 軸との間に戻し、表のセルは空にする）
  detachRefs(slide, ids);
  // 要素が無くなったグループは、グループのステップも消える
  const before = new Set((slide.groups ?? []).map((g) => g.id));
  compactGroups(slide);
  const gone = [...before].filter((gid) => !findGroup(gid));
  slide.steps = slide.steps.filter((s) => !gone.includes(s.elementId));
  store.selectedId = null;
  store.selectedIds = [];
  markDirty("delete");
  showSlide();
  emit("selection", null);
  renderStepChips();
}

// ---------------------------------------------------------------- ステップ（F5）

/** 要素が使っているスライドの値の名前（無ければ null）。 */
function valueUsedBy(el, slide) {
  const names = (slide.values ?? []).map((v) => v.name).filter(Boolean);
  if (el.shape === "number") return names.includes(el.valueName) ? el.valueName : null;
  const text = [...["expr", "fx", "fy", "xExpr", "yExpr", "zExpr"].map((k) => el[k] ?? ""),
    ...[...(el.p1 ?? []), ...(el.p2 ?? []), ...["x0", "x1", "dx", "atX", "length"].map((k) => (el.shape === "graphpart" ? el[k] : null))].filter((v) => typeof v === "string")].join(" ");
  return names.find((n) => new RegExp(`(?<![A-Za-z0-9_])\\\\?${n}(?![A-Za-z0-9_])`).test(text)
    || (n.length === 1 && el.lang === "latex" && new RegExp(`(?<!\\\\[A-Za-z]*)${n}`).test(text))) ?? null;
}

function defaultCode(el, slide) {
  if (el.type === "media") return el.mode === "bake" ? `gui_media(self, ${el.var}, "play", wait=True)  # 焼き込む動画は、描いた時間の分しか進まない（wait=2 なら 2 秒だけ待つ）` : `gui_media(self, ${el.var}, "play")`;
  const has = slide.steps.some((s) => s.elementId === el.id);
  // Indicate は色を塗り替えるので、画像（全体が単色になる）や画像を含むグループには使わない
  const hasImage = el.type === "image" || (el.type === "group" && groupMembers(el.id).some((e) => e.type === "image"));
  if (el.type === "shape") {
    // スライドの値を使う要素（数値・式に値を書いたグラフなど）は、表示されていれば値を動かすのを既定にする
    const vname = valueUsedBy(el, slide);
    if (vname && el.visibleAtStart !== false) {
      const v = (slide.values ?? []).find((q) => q.name === vname);
      return `self.play(${vname}.animate.set_value(${(Number(v?.value) || 0) + 1}), run_time=2)`;
    }
    // 表・流線は、それぞれの出し方（線を引いてから文字を書く・流れに沿って線を描く）がある
    const custom = el.shape === "table" || (el.shape === "field" && el.fieldKind === "stream");
    if (["matrix", "code", "tex", "title", "bullets"].includes(el.shape)) return !has && el.visibleAtStart === false ? `self.play(Write(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "barchart" && el.visibleAtStart !== false) return `self.play(${el.var}.animate.change_bar_values([${(el.bars ?? []).map((b) => Math.round((Number(b.value) || 0) * 1.5 * 100) / 100).join(", ")}]))`;
    if (el.shape === "axes" && el.linear) return `gui_apply_matrix(self, ${el.var}, [[1, 1], [0, 1]], run_time=2)`;
    if (el.shape === "tangent") return !has && el.visibleAtStart === false ? `self.play(Create(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "zoom") return !has && el.visibleAtStart === false ? "self.activate_zooming(animate=True)" : "self.play(self.zoomed_camera.frame.animate.shift(RIGHT), run_time=2)";
    if (el.shape === "trace") {
      const t = slide.elements.find((e) => e.id === el.targetId);
      return t ? `self.play(${t.var}.animate.shift(RIGHT * 2 + UP), run_time=2)` : "self.wait()";
    }
    if (el.shape === "annot" && el.annotKind === "animated") return `self.wait(2)  # ${el.var} は表示中ずっと色が流れます`;
    if (el.shape === "boolean") return !has && el.visibleAtStart === false ? `self.play(FadeIn(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "annot") return !has && el.visibleAtStart === false ? `self.play(${el.annotKind === "bg" ? "FadeIn" : el.annotKind === "arcbrace" ? "GrowFromCenter" : "Create"}(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "vector") return !has && el.visibleAtStart === false ? `self.play(GrowArrow(${el.var}.vector))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "graphpart" && el.partKind === "area") return !has && el.visibleAtStart === false ? `self.play(FadeIn(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "svg") return !has && el.visibleAtStart === false ? `self.play(DrawBorderThenFill(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (["solid", "point3d"].includes(el.shape)) return !has && el.visibleAtStart === false ? `self.play(FadeIn(${el.var}))` : `self.play(Indicate(${el.var}))`;
    if (el.shape === "number") return !has && el.visibleAtStart === false ? `self.play(Write(${el.var}))` : `self.play(Indicate(${el.var}))`;
    const show = custom ? `${el.var}.create()` : `${el.shape === "brace" ? "GrowFromCenter" : "Create"}(${el.var})`;
    return !has && el.visibleAtStart === false ? `self.play(${show})` : `self.play(Indicate(${el.var}))`;
  }
  if (hasImage) {
    const hidden = el.type === "group" ? groupMembers(el.id).every((e) => e.visibleAtStart === false) : el.visibleAtStart === false;
    return !has && hidden ? `self.play(FadeIn(${el.var}))` : `self.play(Circumscribe(${el.var}))`;
  }
  if (el.type === "group") {
    const hiddenAtStart = groupMembers(el.id).every((e) => e.visibleAtStart === false);
    return !has && hiddenAtStart ? `self.play(FadeIn(${el.var}))` : `self.play(Indicate(${el.var}))`;
  }
  if (!has && el.visibleAtStart === false) return el.type === "math" ? `self.play(Write(${el.var}))` : `self.play(FadeIn(${el.var}))`;
  return `self.play(Indicate(${el.var}))`;
}

function stepsSection(el) {
  const slide = currentSlide();
  const sec = document.createElement("section");
  sec.innerHTML = `<h3>アニメーション（ステップ）</h3>
    <p class="hint" style="margin-top:0">1ステップ＝クリック1回分。クリックせずに続けて起きる動きは、1つのステップに続けて書きます。</p>
    ${el.type === "group" ? `<p class="hint"><code>${escapeHtml(el.var)}</code> は中の要素をまとめた VGroup です。<code>${escapeHtml(el.var)}[0]</code> が最背面の要素で、中の要素はそれぞれの変数名でも参照できます。</p>` : ""}
    ${el.type === "shape" && el.shape === "balloon" ? `<p class="hint"><code>${escapeHtml(el.var)}</code> は吹き出しの枠です。中身はそれぞれの変数名で、枠と中身をまとめてはグループの変数名で動かせます（例: <code>self.play(Create(${escapeHtml(el.var)}), Write(text1))</code>）。</p>` : ""}
    ${el.type === "shape" && el.shape === "matrix" ? `<p class="hint">成分は <code>${escapeHtml(el.var)}.get_entries()[0]</code>（左上から順）、行は <code>${escapeHtml(el.var)}.get_rows()[0]</code>、列は <code>${escapeHtml(el.var)}.get_columns()[0]</code>、かっこは <code>${escapeHtml(el.var)}.get_brackets()</code> で参照できます。</p>` : ""}
    ${el.type === "shape" && el.shape === "bullets" ? `<p class="hint">項目は <code>${escapeHtml(el.var)}[0]</code>（1 つ目）のように参照できます。<code>self.play(${escapeHtml(el.var)}.animate.fade_all_but(1))</code> で 2 つ目以外を薄くできます。1 項目ずつ出すときは <code>self.play(Write(${escapeHtml(el.var)}[0]))</code> を 1 ステップずつ書きます（「初めから表示」はオフに）。</p>` : ""}
    ${el.type === "shape" && el.shape === "code" ? `<p class="hint">コードの行は <code>${escapeHtml(el.var)}.code_lines[0]</code>（1 行目）、行番号は <code>${escapeHtml(el.var)}.line_numbers</code>、背景は <code>${escapeHtml(el.var)}.background</code> で参照できます（例: <code>self.play(Indicate(${escapeHtml(el.var)}.code_lines[1]))</code>）。</p>` : ""}
    ${el.type === "shape" && el.shape === "barchart" ? `<p class="hint">棒は <code>${escapeHtml(el.var)}.bars[0]</code>、値の変更は <code>self.play(${escapeHtml(el.var)}.animate.change_bar_values([…]))</code>（棒の数だけ並べます）。棒の上の値は、値を変えても変わりません。</p>` : ""}
    ${el.type === "shape" && el.shape === "netgraph" ? `<p class="hint">頂点は <code>${escapeHtml(el.var)}.vertices["${escapeHtml(el.vertices?.[0]?.name ?? "A")}"]</code>、辺は <code>${escapeHtml(el.var)}.edges[("${escapeHtml(el.edges?.[0]?.[0] ?? "A")}", "${escapeHtml(el.edges?.[0]?.[1] ?? "B")}")]</code> で参照できます（例: <code>self.play(${escapeHtml(el.var)}.vertices["${escapeHtml(el.vertices?.[0]?.name ?? "A")}"].animate.set_color(RED))</code>）。配置を変えるアニメーションは <code>self.play(${escapeHtml(el.var)}.animate.change_layout("circular"))</code>（spring・random は <code>layout_config={"seed": 1}</code> を付けると毎回同じ配置）。</p>` : ""}
    ${el.type === "shape" && el.shape === "samplespace" ? `<p class="hint">標本空間の枠は <code>${escapeHtml(el.var)}.space</code>、1 段目の区画は <code>${escapeHtml(el.var)}.parts[0]</code>、2 段目は <code>${escapeHtml(el.var)}.parts[0].subparts[0]</code>、中かっこ・ラベルは <code>${escapeHtml(el.var)}.braces</code>・<code>${escapeHtml(el.var)}.labels</code>、区画の中のラベルは <code>${escapeHtml(el.var)}.cell_labels</code> で参照できます（例: <code>self.play(Indicate(${escapeHtml(el.var)}.parts[0].subparts[0]))</code>）。</p>` : ""}
    ${el.type === "shape" && el.shape === "boolean" ? `<p class="hint">元の図形をアニメーションで動かしても、合成した図形はついてきません（作ったときの形のままです）。元の図形を出したいときは、元の図形のステップで <code>FadeIn</code> などを書きます。</p>` : ""}
    ${el.type === "shape" && (el.shape === "line" || el.shape === "dot") && el.label ? `<p class="hint">ラベルは <code>${escapeHtml(el.var)}.label</code> で参照できます（例: <code>self.play(Indicate(${escapeHtml(el.var)}.label))</code>）。</p>` : ""}
    ${el.type === "shape" && el.shape === "table" ? `<p class="hint">セルは <code>${escapeHtml(el.var)}.get_entries((行, 列))</code>（1 始まり）、背景の色は <code>${escapeHtml(el.var)}.add_highlighted_cell((2, 3), color=YELLOW)</code>、行は <code>${escapeHtml(el.var)}.get_rows()[0]</code> で参照できます。</p>` : ""}
    ${el.type === "shape" && el.shape === "field" && el.fieldKind === "stream" ? `<p class="hint">流れ続けるアニメーション: <code>${escapeHtml(el.var)}.start_animation(warm_up=False, flow_speed=1.5)</code> のあとに <code>self.wait(3)</code>（待っている間や、あとのアニメーションの間、流れ続けます）。<code>self.play(${escapeHtml(el.var)}.end_animation())</code> で流れを止めると、Manim の仕様で流線は消えます。</p>` : ""}
    ${el.type === "image" ? `<p class="hint">画像は <code>Write</code> や <code>Create</code> では出せません。<code>FadeIn</code>・<code>FadeOut</code>・<code>GrowFromCenter</code>・<code>${escapeHtml(el.var)}.animate.shift(…)</code> などを使います（<code>Indicate</code> は画像全体が単色になります）。</p>` : ""}
    ${el.type === "text" ? `<p class="hint">テキストは行（縦書きは列）ごとに分かれています: <code>${escapeHtml(el.var)}[0]</code> で1行目、<code>${escapeHtml(el.var)}[0][2]</code> で1行目の3文字目。${el.box?.on ? `背景ボックスがあるときは <code>${escapeHtml(el.var)}.text</code> と <code>${escapeHtml(el.var)}.box</code>。` : ""}</p>` : ""}`;
  // GUI で作る動き（ステップの一覧と、画面の下の編集欄に出る）
  const isMedia = el.type === "media", isZoom = el.type === "shape" && el.shape === "zoom";
  const animable = !(isMedia || isZoom);
  const quick = isMedia ? [["media", "＋再生・操作"]] : isZoom ? [["zoom", "＋ズームの動き"]]
    : [["in", "＋出す"], ["out", "＋消す"], ["emph", "＋強調"], ["move", "＋動かす"], ...(el.type === "shape" && el.shape === "axes" && el.linear ? [["linear", "＋行列で変換"]] : []),
      ...(el.type === "shape" && SPECIAL_LABEL[el.shape] ? [["special", SPECIAL_LABEL[el.shape]]] : []),
      ["always", "＋ずっと動かす"]];
  {
    const gui = slide.steps.filter((s) => s.mode === "gui" && (s.rows ?? []).some((r) => r.kind === "anim" && r.target === el.id));
    const box = document.createElement("div");
    box.className = "gui-steps";
    const fst = slide.steps.find((x) => x.id === store.focusStepId && x.mode === "gui");
    const fk = fst ? slide.steps.indexOf(fst) + 1 : 0;
    const btns = (into) => quick.map(([g, t]) => `<button type="button" class="small" data-g="${g}" ${into ? `data-into="${into}"` : ""}>${t}</button>`).join("");
    box.innerHTML = `<div class="row"><span class="unit">新しいクリックで</span>${btns(null)}</div>
      ${fst ? `<div class="row"><span class="unit">ステップ ${fk} に足す</span>${btns(fst.id)}</div>` : ""}
      <div class="hint">「ステップ ${fk || "n"} に足す」は、選んでいるステップ（画面の下）と同じクリックで動かします。始まり（前と同時・前の後に・前の始まりから○秒後）は画面の下で選びます。</div>
      ${gui.length ? `<ul class="gui-step-list">${gui.map((st) => `<li><button type="button" class="link" data-st="${st.id}">ステップ ${slide.steps.indexOf(st) + 1}</button> ${escapeHtml(stepSummary(st) ?? "")}</li>`).join("")}</ul>` : ""}`;
    box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => addAnimStep(el.id, b.dataset.g, { into: b.dataset.into || null })));
    box.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => {
      store.focusStepId = b.dataset.st;
      emit("focus-step", b.dataset.st);
      renderStepChips();
      document.getElementById("anim-editor")?.scrollIntoView({ block: "nearest" });
    }));
    sec.appendChild(box);
  }
  const mine = slide.steps.filter((s) => s.mode !== "gui" && s.elementId === el.id);
  if (mine.length || !animable) sec.insertAdjacentHTML("beforeend", `<p class="hint">コードのステップ（Manim のコードを直接書く）:</p>`);
  mine.forEach((st, i) => sec.appendChild(stepCard(el, st, i + 1, slide.steps.indexOf(st) + 1)));
  const add = document.createElement("button");
  add.textContent = "＋ステップを追加";
  add.title = "コードのステップを足す（Manim のコードを直接書く）";
  add.addEventListener("click", () => {
    const st = { id: uid("t"), elementId: el.id, mode: "code", code: defaultCode(el, slide) };
    slide.steps.push(st);
    store.focusStepId = st.id;
    markDirty("steps");
    renderStepChips();
    renderProps();
    focusStep(st.id, true);
  });
  sec.appendChild(add);
  return sec;
}

function stepCard(el, st, n, k) {
  const card = document.createElement("div");
  card.className = "step-card";
  card.dataset.step = st.id;
  card.innerHTML = `<header><span class="t">ステップ ${n}</span><span class="sub">スライド内 ${k} 番目のクリック</span><span class="grow"></span>
    <button type="button" class="small danger" title="このステップを削除">削除</button></header>`;
  const ed = createCodeEditor({
    value: st.code || "", rows: 2, placeholder: `self.play(Write(${el.var}))`,
    onInput: (v) => {
      st.code = v;
      markDirty("code");
      card.classList.remove("err");
      emit("step-code-input", { id: st.id, value: v, src: "props" });
    },
  });
  editors.set(st.id, ed);
  card.appendChild(ed.el);
  card.querySelector("header button").addEventListener("click", () => {
    // 元に戻せるので確かめずに消し、「元に戻す」のボタン付きで知らせる
    const slide = currentSlide();
    slide.steps = slide.steps.filter((s) => s.id !== st.id);
    markDirty("steps");
    renderStepChips();
    renderProps();
    toast(`ステップ ${n} を削除しました。`, "", 6000, { label: "元に戻す", run: async () => (await import("./history.js")).undo() });
  });
  card.addEventListener("focusin", () => {
    if (store.focusStepId === st.id) return;
    store.focusStepId = st.id;
    document.querySelectorAll(".step-card.focus").forEach((c) => c.classList.remove("focus"));
    card.classList.add("focus");
    renderStepChips();
  });
  return card;
}

export function focusStep(stepId, edit = false) {
  const card = panel().querySelector(`.step-card[data-step="${stepId}"]`);
  if (!card) return;
  document.querySelectorAll(".step-card.focus").forEach((c) => c.classList.remove("focus"));
  card.classList.add("focus");
  const err = store.lastError?.location;
  const ed = editors.get(stepId);
  if (err?.kind === "step" && err.stepId === stepId && ed) {
    card.classList.add("err");
    ed.setErrorLine(err.codeLine);
    ed.revealLine(err.codeLine);
  } else {
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (edit && ed) ed.textarea.focus();
  }
}

function highlightErrorStep() {
  const err = store.lastError?.location;
  if (err?.kind === "step" && editors.has(err.stepId)) {
    const card = panel().querySelector(`.step-card[data-step="${err.stepId}"]`);
    card?.classList.add("err");
    editors.get(err.stepId).setErrorLine(err.codeLine);
  }
}

export function setupProps() {
  on("selection", renderProps);
  on("path-edit", () => renderProps());
  on("focus-step", (id) => {
    // GUI のステップを選んだら、要素のパネルの「ステップ k に足す」を出すために描き直す
    if (currentSlide()?.steps.find((x) => x.id === id)?.mode === "gui") { if (findElement(store.selectedId) || findGroup(store.selectedId)) renderProps(); }
    else focusStep(id);
  });
  on("step-code-input", ({ id, value, src }) => { const ed = editors.get(id); if (src !== "props" && ed && ed.value !== value) ed.value = value; });
  on("project-loaded", renderProps);
  // ハンドルで大きさを変えたら、文字サイズ・幅の欄を新しい値にする
  on("element-resized", (els) => { if (els.some((e) => store.selectedIds.includes(e.id))) renderProps(); });
  on("steps-changed", () => { if (findElement(store.selectedId) || findGroup(store.selectedId)) renderProps(); });
}
