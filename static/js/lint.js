// スライドの点検: はみ出し・重なり・小さすぎる文字・背景との色の差・数式の誤り・リンクの飛ぶ先（ブラウザで調べる）と、
// 書き出し前の検査・見つからないファイル・描画が最新か・マイクやカメラ・画面の数（サーバーで調べる。/api/lint）。
// ツールバーの「点検」で右の欄に一覧を出す。「描画・発表」（発表する設定のとき）と「発表のみ」の前にも自動で調べ、
// 問題・注意があれば知らせる（止めずに「このまま続ける」も選べる）。「無視する」にしたものは、プロジェクトに覚えて次からは出さない。

import { refPlan, refProblems } from "./refs.js";
import { angleGeom, angleIsReflex } from "./shapes.js";
import { escapeTexSpecials, fixTexChars, missingChars, texFieldsOf, texSpecials, unfixableChars } from "./texchars.js";
import { findYure, unify } from "./yure.js";
import { openSearch, redrawAfterBulkEdit } from "./search.js";
import { api } from "./api.js";
import { backgroundOf, masterElementsFor } from "./masters.js";
import { slideBoxes } from "./canvas.js";
import { select } from "./selection.js";
import { selectSlide } from "./slides.js";
import { escapeHtml, markDirty, on, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
let items = [];
let running = false;
let showIgnored = false;

const LEVEL = { error: "問題", warn: "注意", info: "参考" };
// 直すしかないもの・そのときだけのもの（無視すると、次に起きたときも隠れてしまう）は「無視する」を出さない
const NO_IGNORE = new Set(["render", "code", "file", "lint", "math", "link"]);
const TEXTY = new Set(["text", "math"]);
const TEXTY_SHAPES = new Set(["tex", "title", "bullets", "code", "table", "matrix", "theorem"]);
const WIDE_SHAPES = new Set(["field", "zoom", "trace"]); // 画面の外まで広がるのが普通のもの
const MIN_PX = 20; // 1080 の高さで、これより小さい文字は注意

function hexRgb(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** 色の差（WCAG のコントラスト比。1〜21）。 */
export function contrast(a, b) {
  const x = hexRgb(a), y = hexRgb(b);
  if (!x || !y) return 21;
  const l1 = luminance(x), l2 = luminance(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const isTexty = (e) => TEXTY.has(e.type) || (e.type === "shape" && TEXTY_SHAPES.has(e.shape));
const isWide = (e) => e.type === "shape" && (WIDE_SHAPES.has(e.shape) || (e.shape === "axes" && ["plane", "polar", "complex"].includes(e.axesKind)));
const nameOf = (e) => e.var || e.id;
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const FILLED = ["rect", "ellipse", "polygon", "star", "arc", "dot", "balloon", "annulus", "path", "boolean", "annot"];

/**
 * 文字 el の中心の後ろにあるもの（重なり順が下で、中心を含むもの）の色。いちばん手前のものを使う。
 * 塗った図形ならその塗りの色、画像なら null（色が分からないので調べない）、何も無ければスライド（マスター）の背景。
 */
/** 図形の見えている塗りの色。塗りの色が「線と同じ」（null）のときは、描画と同じく線の色で塗る。 */
function fillColorOf(e) {
  if (!e.fill || Number(e.fill.opacity ?? 0) < 0.5) return null;
  return e.fill.color || e.stroke?.color || e.strokeColor || null;
}

function backdropAt(sl, el, byId, slideBg) {
  if (el.box?.on && el.box.color && Number(el.box.opacity ?? 1) >= 0.5) return { color: el.box.color, by: "背景ボックス" };
  const b = byId[el.id]?.box;
  if (!b) return { color: slideBg };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const inside = (r) => r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  const idx = sl.elements.indexOf(el);
  for (let i = idx - 1; i >= 0; i--) {
    const e = sl.elements[i];
    if (e.hidden || !inside(byId[e.id]?.box)) continue;
    if (e.type === "image" || (e.type === "shape" && e.shape === "svg")) return null;
    if (e.type === "media" && e.kind === "video") return null;
    if (e.type === "shape" && FILLED.includes(e.shape) && fillColorOf(e)) return { color: fillColorOf(e), by: nameOf(e) };
    if (e.type === "shape" && e.shape === "code") return { color: e.bgColor || "#222222", by: nameOf(e) };
  }
  // マスターの要素（いちばん奥）: 回していない長方形・楕円の範囲で調べる
  for (const e of [...masterElementsFor(sl)].reverse()) {
    if (e.type !== "shape" || !["rect", "ellipse"].includes(e.shape) || Number(e.rotation) || !fillColorOf(e)) continue;
    const w = Number(e.width) || 0, h = Number(e.height) || 0;
    if (inside({ x: e.x - w / 2, y: e.y - h / 2, w, h })) return { color: fillColorOf(e), by: `マスターの ${nameOf(e)}` };
  }
  return { color: slideBg };
}

/** 画面で調べる点検（全スライド）。 */
async function lintClient() {
  const out = [];
  const W = store.meta.canvas.w, H = store.meta.canvas.h, P = H / 8;
  const s = store.project.settings;
  const bg = s.background || "#FFFFFF";
  const scale = Number(s.fontSizeScale) || 1;
  const slides = store.project.slides;
  const ids = new Set(slides.map((x) => x.id));
  for (let si = 0; si < slides.length; si++) {
    const sl = slides[si];
    const add = (level, kind, el, message, other = "") => out.push({ level: sl.skip && level === "error" ? "warn" : level, kind, slideIndex: si,
      elementId: el?.id ?? null, message, key: `${kind}|${sl.id}|${el?.id ?? ""}|${other}` });
    if (!sl.elements.length) { add("info", "empty", null, "要素がありません。"); continue; }
    let boxes;
    try { boxes = await slideBoxes(sl); } catch { boxes = []; }
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    // 画面の範囲（スライドの初めのカメラの枠）
    let view = { x: 0, y: 0, w: W, h: H };
    if (sl.camera && !s.use3d) {
      const w = sl.camera.width * P, h = w * H / W;
      view = { x: W / 2 + sl.camera.x * P - w / 2, y: H / 2 - sl.camera.y * P - h / 2, w, h };
    }
    const slideBg = backgroundOf(sl) || bg;
    for (const el of sl.elements) {
      const b = byId[el.id];
      if (b?.mathError) add("error", "math", el, `数式「${nameOf(el)}」: ${b.mathError}（仮表示の MathJax で見つかった誤り。描画の LaTeX でも誤りになることが多いです）`);
      // はみ出し
      if (b?.box && !isWide(el) && el.type !== "media") {
        const r = b.box, tol = W * 0.01;
        const outL = view.x - r.x, outR = r.x + r.w - (view.x + view.w), outT = view.y - r.y, outB = r.y + r.h - (view.y + view.h);
        const fullyOut = r.x >= view.x + view.w || r.x + r.w <= view.x || r.y >= view.y + view.h || r.y + r.h <= view.y;
        if (fullyOut) add("info", "outside", el, `「${nameOf(el)}」は、画面の外に置いてあります（動きで画面に入ってくるなら問題ありません）。`);
        else if (Math.max(outL, outR, outT, outB) > tol && r.w * r.h < view.w * view.h * 0.9) {
          const side = [outL > tol && "左", outR > tol && "右", outT > tol && "上", outB > tol && "下"].filter(Boolean).join("・");
          add("warn", "overflow", el, `「${nameOf(el)}」が画面の${side}にはみ出しています。`);
        }
      }
      // 小さすぎる文字
      if ((el.type === "text" || el.type === "math") && el.fontSize) {
        const px = el.fontSize * scale * 1080 / H;
        if (px < MIN_PX) add("warn", "small", el, `「${nameOf(el)}」の文字が小さめです（${Math.round(px)}。後ろの席から読みにくいことがあります。目安は ${MIN_PX} 以上）。`);
      }
      // 背景との色の差（文字の後ろに塗った図形があれば、その塗りの色と比べる。画像の上は調べない）
      if (el.type === "text" || el.type === "math") {
        const under = backdropAt(sl, el, byId, slideBg);
        // 見えている文字の色: 部分ごとの色（runs の c）。色の無い部分は要素の文字色
        const runs = (el.runs ?? []).filter((r) => String(r.t ?? "").trim());
        const colors = new Set((el.type === "text" && runs.length ? runs.map((r) => r.c || el.color) : [el.color]).filter(Boolean));
        for (const c of under ? colors : []) {
          const k = contrast(c, under.color);
          const where = under.by === "背景ボックス" ? `背景ボックスの色（${under.color}）` : under.by ? `後ろの「${under.by}」の塗り（${under.color}）` : `背景（${under.color}）`;
          if (k < 3) { add("warn", "contrast", el, `「${nameOf(el)}」の文字の色（${c}）が${where}と近く、見えにくいです（色の差 ${k.toFixed(1)}。目安は 3 以上、小さい文字は 4.5 以上）。`, c); break; }
        }
      }
      // リンクの飛ぶ先
      const to = el.link?.to;
      if (to && to !== "back") {
        if (!ids.has(to)) add("error", "link", el, `「${nameOf(el)}」のリンクの飛ぶ先のスライドがありません（消したスライド）。`);
        else if (slides.find((x) => x.id === to)?.skip) add("warn", "link", el, `「${nameOf(el)}」のリンクの飛ぶ先のスライドは「描画しない」になっています（発表では飛べません）。`);
      }
    }
    // LaTeX で組む欄（題名・LaTeX の文章・箇条書き・定理のブロック・数式）で、表示されずに消える文字（e₁ の ₁、∠、α など）
    for (const el of sl.elements) {
      for (const f of texFieldsOf(el)) {
        const v = f.get(), bad = missingChars(v);
        if (!bad.length) continue;
        const nofix = unfixableChars(v);
        const fixed = fixTexChars(v, f.mode);
        const canFix = fixed !== v;
        add("warn", "texchar", el, `「${nameOf(el)}」の${f.label}の「${bad.join(" ")}」は、LaTeX で組むと表示されません（何も出ずに消えます）。`
          + (canFix ? `「直す」で数式の形（例: ${fixed.length > 60 ? fixed.slice(0, 60) + "…" : fixed}）にします。` : "")
          + (nofix.length ? `「${nofix.join(" ")}」は数式にしても出ないので、(1)・I などに書き換えてください。` : ""), f.label);
        if (canFix) out[out.length - 1].fix = () => { f.set(fixTexChars(f.get(), f.mode)); };
      }
    }
    // LaTeX で組む欄の、\ の付いていない特別な文字（# % & _ ^）: 描画のときだけ LaTeX のエラーになる・後ろが消える
    for (const el of sl.elements) {
      for (const f of texFieldsOf(el)) {
        const v = f.get(), bad = texSpecials(v, f.mode);
        if (!bad.length) continue;
        const pct = bad.includes("%") ? "（% は、その後ろが行の終わりまで消えます）" : "";
        add("warn", "texspecial", el, `「${nameOf(el)}」の${f.label}の「${bad.join(" ")}」は、LaTeX では特別な文字なので、描画のときにエラーになるか、表示されません${pct}。「直す」で \\${bad[0]} のように \\ を付けます。`, f.label);
        out[out.length - 1].fix = () => { f.set(escapeTexSpecials(f.get(), f.mode)); };
      }
    }
    // 式の参照のかっこが二重: 式の {ref:…} は「(1)」とかっこ付きで入るので、「（{ref:eq}）」は「((1))」になる
    {
      const plan = refPlan();
      const PAREN = /[（(]\s*\{ref:([^{}\s]+)\}\s*[）)]/g;
      const isEq = (name) => /^\(/.test(plan.labels[name]?.text ?? "");
      for (const el of sl.elements) {
        const fields = [...texFieldsOf(el)];
        if (el.type === "text") fields.push({ label: "文字", get: () => (el.runs ?? []).map((r) => r.t ?? "").join(""), set: null });
        for (const f of fields) {
          const v = f.get() ?? "";
          const bad = [...v.matchAll(PAREN)].filter((m) => isEq(m[1]));
          if (!bad.length) continue;
          add("warn", "refparen", el, `「${nameOf(el)}」の${f.label}の「${bad[0][0]}」は「((1))」のようにかっこが二重になります（式の参照はかっこ付きで入ります）。{ref:${bad[0][1]}} だけにするか、かっこの中は {num:${bad[0][1]}}（番号だけ）にしてください。`, f.label);
          if (f.set) out[out.length - 1].fix = () => { f.set(f.get().replace(PAREN, (m0, name) => (isEq(name) ? `{ref:${name}}` : m0))); };
        }
      }
    }
    // 角の印: 古いプロジェクトの角で、外側（180° を超える角）になっているもの（新しい角は内側・外側の指定を保つ）
    for (const el of sl.elements) {
      if (el.type !== "shape" || el.shape !== "angle" || el.angleKind !== "angle" || typeof el.reflex === "boolean") continue;
      const g = angleGeom(sl.elements.find((e) => e.id === el.line1Id), sl.elements.find((e) => e.id === el.line2Id));
      if (g && angleIsReflex(el, g)) add("warn", "reflex", el, `角の印「${nameOf(el)}」が外側の角（180° を超える角）になっています。内側にするには、角を選んで「外側の角」のチェックを外してください（わざとなら「無視する」）。`);
    }
    // 定義・定理・証明のブロック: 段落を出すステップの数と段落の数が合わない（最後の段落・∎ が出ない）
    for (const el of sl.elements) {
      if (el.type !== "shape" || el.shape !== "theorem" || el.visibleAtStart !== false) continue;
      const nPara = (el.body ?? "").replace(/\r\n/g, "\n").split("\n").filter((x) => x.trim()).length;
      const shown = new Set();
      let any = false;
      for (const st of sl.steps ?? []) for (const r of st.rows ?? []) {
        if (r.kind !== "anim" || r.target !== el.id) continue;
        for (const p of r.part?.paths ?? []) if (p[0] === 2) { any = true; if (p.length > 1) shown.add(p[1]); else for (let i = 0; i < nPara; i++) shown.add(i); }
        if (!r.part?.paths?.length) { any = true; for (let i = 0; i < nPara; i++) shown.add(i); }
      }
      if (!any) continue;
      const miss = [...Array(nPara).keys()].filter((i) => !shown.has(i));
      if (miss.length) add("warn", "paras", el, `「${nameOf(el)}」の段落 ${nPara} 個のうち、${miss.map((i) => i + 1).join("・")} 番目を出すステップがありません（発表で出てきません）。ステップを消して「段落ごとに出すステップを作る」を押し直すか、ステップを足してください。`);
    }
    // コードの行の指定が、コードの行数を超えている（行に色の帯・一部分・code_lines[k]）
    for (const el of sl.elements) {
      if (el.type !== "shape" || el.shape !== "code") continue;
      const n = String(el.code ?? "").split("\n").length, from = Number(el.lineFrom ?? 1) || 1;
      const bad = new Set();
      const esc = String(el.var ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9_])${esc}\\.code_lines\\[(-?\\d+)\\]`, "g");
      for (const [k, st] of (sl.steps ?? []).entries()) {
        const codes = [st.mode === "code" ? st.code : "", ...(st.rows ?? []).filter((r) => r.kind === "code").map((r) => r.code)];
        for (const c of codes) for (const m of String(c ?? "").matchAll(re)) if (Number(m[1]) >= n || Number(m[1]) < -n) bad.add(`ステップ ${k + 1} のコードの code_lines[${m[1]}]`);
        for (const r of st.rows ?? []) {
          if (r.kind !== "anim" || r.target !== el.id) continue;
          if (r.anim === "CodeHighlight") {
            for (const part of String(r.params?.lines ?? "").replace(/、/g, ",").split(",")) {
              // 「6-7」は 6 から 7 まで（「-7」をマイナスと読まない）。数は負にもなりうる（"-2"、"-3--1"）
              const m = part.trim().match(/^(-?\d+)(?:\s*-\s*(-?\d+))?$/);
              if (!m) continue;
              const nums = [Number(m[1]), ...(m[2] != null ? [Number(m[2])] : [])];
              if (nums.some((v) => v < from || v >= from + n)) { bad.add(`ステップ ${k + 1} の「行に色の帯」の ${part.trim()} 行`); break; }
            }
          }
          if ((r.part?.paths ?? []).some((q) => q.length >= 2 && (q[0] === 1 || q[0] === 2) && q[1] >= n)) bad.add(`ステップ ${k + 1} の「一部分」の行`);
        }
      }
      if (bad.size) add("warn", "codeline", el, `コード「${nameOf(el)}」は ${n} 行ですが、${[...bad].join("・")} がその外を指しています（コードを直したあとに、行がずれていないか確かめてください）。`, [...bad].join("|"));
    }
    // 参照（{ref:ラベル}）の見つからないラベル・同じラベル
    for (const pr of refProblems().filter((x) => x.slideIndex === si)) {
      const el = sl.elements.find((e) => e.id === pr.elementId);
      if (pr.kind === "missing") add("warn", "ref", el, `「${nameOf(el)}」の参照 {ref:${pr.label}} のラベル「${pr.label}」が見つかりません（「??」と出ます）。`, pr.label);
      else add("warn", "ref", el, `ラベル「${pr.label}」が 2 か所以上に付いています（参照は、先にあるほうを指します）。`, pr.label);
    }
    // 重なり（文字どうし、文字と画像の一部）
    const cand = sl.elements.filter((e) => byId[e.id]?.box && e.visibleAtStart !== false && (isTexty(e) || e.type === "image"));
    for (let a = 0; a < cand.length; a++) {
      for (let c = a + 1; c < cand.length; c++) {
        const A = cand[a], B = cand[c];
        if (A.groupId && A.groupId === B.groupId) continue;
        if (!isTexty(A) && !isTexty(B)) continue; // 画像どうしは調べない
        const ra = byId[A.id].box, rb = byId[B.id].box;
        const i = inter(ra, rb), small = Math.min(ra.w * ra.h, rb.w * rb.h);
        if (small <= 0 || i < small * 0.1) continue;
        const img = A.type === "image" ? A : B.type === "image" ? B : null;
        if (img && i >= small * 0.98) continue; // 画像の中に収めた文字（図のラベルなど）は、わざとのことが多い
        add("warn", "overlap", A, `「${nameOf(A)}」と「${nameOf(B)}」が重なっています（わざとなら「無視する」を押してください）。`, B.id);
      }
    }
  }
  return out;
}

/** 点検する。mode: manual・render・present。 */
export async function runLint(mode = "manual") {
  // サーバーの点検（書き出し前の検査・3D の設定・式の誤り・ファイル）は保存した project.json を調べるので、未保存の変更を先に保存する
  if (store.dirty && store.saveNow) { try { await store.saveNow(true); } catch { /* 保存できなくても点検は続ける */ } }
  const [client, server] = await Promise.all([
    lintClient().catch((e) => [{ level: "info", kind: "lint", slideIndex: null, message: `画面での点検ができませんでした: ${e.message || e}`, key: "lint" }]),
    api.post("/api/lint", { mode }).then((r) => r.items).catch((e) => [{ level: "info", kind: "lint", slideIndex: null, message: `点検できませんでした: ${e.message || e}`, key: "lint" }]),
  ]);
  const order = { error: 0, warn: 1, info: 2 };
  return [...server, ...client].sort((a, b) => order[a.level] - order[b.level] || (a.slideIndex ?? -1) - (b.slideIndex ?? -1));
}

const ignored = () => new Set(store.project?.settings?.lintIgnore ?? []);

function draw() {
  const ign = ignored();
  const shown = items.filter((x) => !ign.has(x.key));
  const hid = items.filter((x) => ign.has(x.key));
  const cnt = (lv) => shown.filter((x) => x.level === lv).length;
  $("lint-count").textContent = items.length || hid.length ? `問題 ${cnt("error")}・注意 ${cnt("warn")}・参考 ${cnt("info")}${hid.length ? `（無視 ${hid.length}）` : ""}` : "";
  const row = (x, i, isIgn) => `<li data-i="${i}" class="lv-${x.level}">
    <div class="sr-where"><span class="lint-lv">${LEVEL[x.level]}</span>${x.slideIndex != null ? `<b>スライド ${x.slideIndex + 1}</b>` : "<b>全体</b>"}</div>
    <div class="sr-snip">${escapeHtml(x.message)}</div>
    ${x.fix && !isIgn ? `<button type="button" class="small" data-a="fix">直す</button>` : ""}
    ${NO_IGNORE.has(x.kind) ? "" : `<button type="button" class="small" data-a="${isIgn ? "unignore" : "ignore"}">${isIgn ? "戻す" : "無視する"}</button>`}</li>`;
  $("lint-list").innerHTML = (shown.length ? shown.map((x) => row(x, items.indexOf(x), false)).join("")
    : `<li class="sr-more">${running ? "調べています…" : "問題は見つかりませんでした。"}</li>`)
    + (hid.length ? `<li class="sr-more"><a href="#" data-a="toggle-ign">${showIgnored ? "▼" : "▶"} 無視しているもの（${hid.length}）</a></li>` : "")
    + (showIgnored ? hid.map((x) => row(x, items.indexOf(x), true)).join("") : "");
}

async function refresh() {
  if (running) return;
  running = true;
  $("lint-again").disabled = true;
  items = [];
  draw();
  try {
    items = await runLint("manual");
  } finally {
    running = false;
    $("lint-again").disabled = false;
  }
  draw();
}

export async function openLint(tab = null) {
  if (!store.project) return;
  $("lint-panel").hidden = false;
  fold(false);
  $("search-panel").hidden = true;
  if (tab) setTab(tab);
  if (lintTab === "yure") drawYure();
  else await refresh();
}

// ---------------------------------------------------------------- 表記ゆれ

let lintTab = "lint";
let yure = [];

function setTab(t) {
  lintTab = t;
  document.querySelectorAll("#lint-tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  $("lint-list").hidden = t !== "lint";
  $("yure-list").hidden = t !== "yure";
  document.querySelector("#lint-panel .sr-row:has(#lint-auto)")?.toggleAttribute("hidden", t !== "lint");
}

function drawYure() {
  yure = findYure();
  const ign = ignored();
  const shown = yure.filter((g) => !ign.has(g.key)), hid = yure.filter((g) => ign.has(g.key));
  $("lint-count").textContent = `表記ゆれ ${shown.length} 組${hid.length ? `（無視 ${hid.length}）` : ""}`;
  const row = (g, isIgn) => `<li class="yr-item" data-key="${escapeHtml(g.key)}"><div class="sr-where"><b>${escapeHtml(g.label)}</b></div>
    <div class="yr-forms">${g.forms.map((f, k) => `<span class="yr-form"><span>${escapeHtml(f.label)} <span class="hint">${f.count} 個</span></span>
      <button type="button" class="small" data-a="unify" data-k="${k}" title="すべてを「${escapeHtml(f.label)}」にそろえる">こちらにそろえる</button>
      ${/^yure:(kata|word):/.test(g.key) ? `<button type="button" class="small" data-a="find" data-k="${k}" title="「検索・置換」で、どこにあるか見る">場所を見る</button>` : ""}</span>`).join("")}</div>
    ${g.note ? `<div class="hint">${escapeHtml(g.note)}</div>` : ""}
    <button type="button" class="small" data-a="${isIgn ? "unignore" : "ignore"}">${isIgn ? "戻す" : "無視する"}</button></li>`;
  $("yure-list").innerHTML = (shown.length ? shown.map((g) => row(g, false)).join("") : `<li class="sr-more">表記ゆれは見つかりませんでした。</li>`)
    + (hid.length ? `<li class="sr-more"><a href="#" data-a="toggle-ign">${showIgnored ? "▼" : "▶"} 無視しているもの（${hid.length}）</a></li>` : "")
    + (showIgnored ? hid.map((g) => row(g, true)).join("") : "")
    + `<li class="sr-more hint">文字の部分（テキスト・LaTeX の文章・箇条書き・ラベル・ノート・マスター）だけを見ます。数式とコードは見ません。そろえたあとは「元に戻す」で 1 回で戻せます。</li>`;
}

async function yureClick(e) {
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (!a) return;
  e.preventDefault();
  if (a === "toggle-ign") { showIgnored = !showIgnored; drawYure(); return; }
  const li = e.target.closest("[data-key]");
  const g = yure.find((x) => x.key === li?.dataset.key);
  if (!g) return;
  const k = Number(e.target.closest("[data-k]")?.dataset.k);
  if (a === "ignore" || a === "unignore") { setIgnore(g.key, a === "ignore"); drawYure(); return; }
  if (a === "find") {
    $("sr-find").value = g.forms[k].label;
    openSearch(false);
    return;
  }
  if (a === "unify") {
    const n = unify(g, k);
    if (n) await redrawAfterBulkEdit();
    toast(`${n} か所の文字を「${g.forms[k].label}」にそろえました（「元に戻す」で戻せます）。`);
    drawYure();
  }
}

function setIgnore(key, on_) {
  const s = store.project.settings;
  const set = new Set(s.lintIgnore ?? []);
  if (on_) set.add(key); else set.delete(key);
  s.lintIgnore = [...set];
  markDirty("settings");
  draw();
}

/** 発表の前の点検。続けてよければ true。 */
export async function lintGate(mode) {
  let enabled = true;
  try { enabled = (await api.get("/api/userconfig"))?.lintBeforePresent !== false; } catch { /* 既定はオン */ }
  if (!enabled) return true;
  setStatusText("発表の前に点検しています…");
  let found;
  try {
    found = await runLint(mode);
  } catch {
    return true;
  } finally {
    setStatusText("");
  }
  const ign = ignored();
  const bad = found.filter((x) => !ign.has(x.key) && x.level !== "info");
  if (!bad.length) return true;
  items = found;
  const dlg = $("dlg-lintgate");
  const e = bad.filter((x) => x.level === "error").length, w = bad.length - e;
  $("lg-summary").textContent = `発表の前に点検したところ、${e ? `問題 ${e} 件` : ""}${e && w ? "・" : ""}${w ? `注意 ${w} 件` : ""}が見つかりました。`;
  $("lg-list").innerHTML = bad.slice(0, 8).map((x) => `<li class="lv-${x.level}"><span class="lint-lv">${LEVEL[x.level]}</span>${x.slideIndex != null ? `スライド ${x.slideIndex + 1}: ` : ""}${escapeHtml(x.message)}</li>`).join("")
    + (bad.length > 8 ? `<li>ほか ${bad.length - 8} 件</li>` : "");
  $("lg-off").checked = false;
  return await new Promise((resolve) => {
    const done = (go) => {
      dlg.close();
      if ($("lg-off").checked) api.put("/api/userconfig", { lintBeforePresent: false }).then(() => toast("発表の前の点検をオフにしました（「点検」の欄で戻せます）。")).catch(() => {});
      resolve(go);
    };
    $("lg-go").onclick = () => done(true);
    $("lg-list-btn").onclick = () => { done(false); $("lint-panel").hidden = false; $("search-panel").hidden = true; draw(); };
    dlg.oncancel = (ev) => { ev.preventDefault(); done(false); };
    dlg.showModal();
  });
}

function setStatusText(t) {
  const el = $("status-render");
  if (el && t) el.textContent = t;
}

function fold(on_) {
  $("lint-panel").classList.toggle("folded", on_);
  $("lint-fold").textContent = on_ ? `広げる（${$("lint-count").textContent || "点検"}）` : "畳む";
}

async function goTo(x) {
  if (x.slideIndex == null) return;
  fold(true); // 右のパネルで直せるように畳む（「広げる」で戻る）
  await selectSlide(x.slideIndex);
  if (x.elementId) select(x.elementId);
}

export function setupLint() {
  $("lint-close").addEventListener("click", () => { $("lint-panel").hidden = true; fold(false); });
  $("lint-fold").addEventListener("click", () => { const f = !$("lint-panel").classList.contains("folded"); fold(f); if (!f) refresh(); });
  $("lint-again").addEventListener("click", () => (lintTab === "yure" ? drawYure() : refresh()));
  document.querySelectorAll("#lint-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { setTab(b.dataset.tab); if (b.dataset.tab === "yure") drawYure(); else refresh(); }));
  $("yure-list").addEventListener("click", yureClick);
  $("lint-list").addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-a]");
    if (a?.dataset.a === "toggle-ign") { ev.preventDefault(); showIgnored = !showIgnored; draw(); return; }
    const li = ev.target.closest("li[data-i]");
    if (!li) return;
    const x = items[Number(li.dataset.i)];
    if (a?.dataset.a === "fix" && x.fix) { x.fix(); markDirty("lint-fix"); redrawAfterBulkEdit().then(() => { toast("直しました（「元に戻す」で戻せます）。"); refresh(); }); return; }
    if (a?.dataset.a === "ignore") setIgnore(x.key, true);
    else if (a?.dataset.a === "unignore") setIgnore(x.key, false);
    else goTo(x);
  });
  const auto = $("lint-auto");
  api.get("/api/userconfig").then((c) => { auto.checked = c?.lintBeforePresent !== false; }).catch(() => {});
  auto.addEventListener("change", () => api.put("/api/userconfig", { lintBeforePresent: auto.checked }).catch(() => {}));
  on("project-loaded", () => { items = []; if (!$("lint-panel").hidden) refresh(); });
}
