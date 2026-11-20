// 初回のチュートリアル: 練習用のプロジェクトで、実際に操作しながら一通りの流れを体験する。
// 次に押す所を光る枠で示し、操作が済んだら（プロジェクトの中身を見て）自動で次へ進む。途中でやめても、次は続きから。

import { api } from "./api.js";
import { openHelp } from "./help.js";
import { playerState } from "./slideplayer.js";
import { currentSlide, emit, escapeHtml, on, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_TEXT = "テキスト";
const DEFAULT_MATH = "x^2+y^2=r^2";
let run = null; // {i, folder, timer}

const slide = () => (store.project && !store.masterId ? currentSlide() : null);
const textEl = () => slide()?.elements.find((e) => e.type === "text") ?? null;
const mathEl = () => slide()?.elements.find((e) => e.type === "math") ?? null;
const sel = (q) => () => document.querySelector(q);
const canvasH = () => store.meta?.canvas?.h ?? 1080;

const STEPS = [
  {
    title: "ようこそ",
    text: `練習用のプロジェクト「<b>${"{name}"}</b>」を作って開きました（場所: ${"{folder}"}）。ここで自由に試して構いません（ほかのプロジェクトには影響しません）。<br>
      題名と数式を置き、クリックで数式が書かれていく 1 枚のスライドを作ります。10 分ほどです。<br>
      光る枠の所を操作すると、自動で次へ進みます。`,
    next: true,
  },
  {
    title: "文字を置く",
    text: "キャンバスの上の <b>＋テキスト</b> を押してください。スライドの真ん中に文字が置かれます。",
    target: sel('button[data-action="add-text"]'),
    done: () => !!textEl(),
  },
  {
    title: "題名を書く",
    text: "右のパネルの欄の「テキスト」を消して、題名（例: <b>三平方の定理</b>）を書いてください。キャンバスの文字も変わります。",
    target: () => (store.selectedId === textEl()?.id ? document.querySelector("#props .rt-area") : null),
    lost: () => (store.selectedId !== textEl()?.id ? "キャンバスの文字を押して選ぶと、右のパネルに欄が出ます。" : ""),
    done: () => { const t = (textEl()?.text ?? "").trim(); return !!t && t !== DEFAULT_TEXT; },
  },
  {
    title: "文字を動かす",
    text: "キャンバスの文字をドラッグして、スライドの<b>上の方</b>へ動かしてください。角の丸いハンドルをドラッグすると、大きさも変えられます。",
    target: sel("#stage"),
    done: () => { const t = textEl(); return !!t && t.y < canvasH() * 0.36; },
    next: "動かさずに次へ",
  },
  {
    title: "数式を置く",
    text: "<b>＋数式</b> を押してください。",
    target: sel('button[data-action="add-math"]'),
    done: () => !!mathEl(),
  },
  {
    title: "数式を書く",
    text: "右のパネルの欄を <code>a^2 + b^2 = c^2</code> に書き換えてください。<code>^2</code> は 2 乗です。数式は LaTeX という書き方で書きます。",
    target: () => (store.selectedId === mathEl()?.id ? document.querySelector("#props textarea.latex") : null),
    lost: () => (store.selectedId !== mathEl()?.id ? "キャンバスの数式を押して選ぶと、右のパネルに欄が出ます。" : ""),
    done: () => { const l = (mathEl()?.latex ?? "").replace(/\s/g, ""); return !!l && l !== DEFAULT_MATH; },
  },
  {
    title: "クリックで出す",
    text: "数式を選んだまま、右のパネルの <b>＋出す</b> を押してください（パネルの下の方にあります。見えないときは、パネルを下へスクロールしてください）。キャンバスの下に「ステップ 1」（クリック 1 回分の動き）ができ、数式は薄く表示されます（初めは見えず、クリックで出るという印です）。",
    target: () => (store.selectedId === mathEl()?.id ? document.querySelector('#props .gui-steps button[data-g="in"]:not([data-into])') : null),
    lost: () => (store.selectedId !== mathEl()?.id ? "キャンバスの数式（薄くなっていれば、その場所）を押して選んでください。" : ""),
    done: () => { const m = mathEl(); return !!m && (slide()?.steps ?? []).some((s) => (s.rows ?? []).some((r) => r.target === m.id)); },
  },
  {
    title: "動きを見る",
    text: "下の動きの欄で、出し方（「書く」など）や時間を変えられます。<br>では、実際の動きを確かめます。ツールバーの <b>▷ このスライドを試す</b> を押してください（[[Ctrl+Enter]] でも同じ）。描画に数秒〜十数秒かかります。",
    target: sel('button[data-action="preview-slide"]'),
    done: () => (playerState()?.count ?? 0) > 0,
  },
  {
    title: "クリックして進める",
    text: "小窓が開きました。今は「初めの表示」（クリックの前）です。<b>次へ ▶</b> を押すと、ステップ 1 の動き（数式が書かれる）が再生されます。",
    target: sel('.slide-player [data-a="next"]'),
    done: () => (playerState()?.index ?? 0) >= 1,
    next: "次へ",
  },
  {
    title: "できました",
    text: `これで、置く → 動きを付ける → 確かめる の一通りです。<br>
      本番では、ツールバーの <b>▶ 描画・発表</b> で全体を描画し、発表ウィンドウで発表します（クリックか [[→]] で次へ、[[Q]] で終わる）。<br>
      ほかの機能は、ツールバーの <b>？</b>（または [[F1]]）のヘルプで探せます。練習用のプロジェクトは、そのまま試しに使っても、消しても構いません。`,
    target: sel('#btn-render'),
    finish: true,
  },
];

const kbd = (s) => s.replace(/\[\[(.+?)\]\](?!\])/g, (_, k) => k.split("+").map((x) => `<kbd>${x}</kbd>`).join("+"));

async function saveProgress(patch) {
  try {
    const cfg = await api.get("/api/userconfig");
    await api.put("/api/userconfig", { tutorial: { ...(cfg.tutorial ?? {}), ...patch } });
  } catch { /* 覚えられなくても続ける */ }
}

function ensureUi() {
  if ($("tut-card")) return;
  document.body.insertAdjacentHTML("beforeend", `<div id="tut-ring" class="tut-ring" hidden></div>
    <button type="button" id="tut-scroll" class="tut-scroll" hidden><span class="tut-arrow"></span><span class="tut-scroll-text"></span></button>
    <div id="tut-card" class="tut-card" hidden role="dialog" aria-live="polite" aria-label="チュートリアル">
      <div class="tut-head"><span id="tut-count"></span><b id="tut-title"></b><button type="button" id="tut-close" title="チュートリアルをやめる（次は続きから）">×</button></div>
      <div class="tut-text" id="tut-text"></div>
      <div class="tut-lost" id="tut-lost" hidden></div>
      <div class="tut-bar" id="tut-bar"></div>
    </div>`);
  $("tut-close").onclick = () => stop(false);
  // 押すと、示す所までスクロールする
  $("tut-scroll").onclick = () => {
    const t = run && STEPS[run.i].target ? STEPS[run.i].target() : null;
    t?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
}

/** 縦にスクロールできる、いちばん近い親（パネルなど）。 */
function scrollParent(el) {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** 示す所がパネルの見えている範囲の外なら、パネルの下（上）の端に、光る矢印を出す。見えていれば null。 */
function offscreenHint(target, r) {
  const sp = r && scrollParent(target);
  if (!sp) return null;
  const v = sp.getBoundingClientRect();
  const margin = 4;
  if (r.top >= v.top - margin && r.bottom <= v.bottom + margin) return null;
  return { dir: r.top > v.bottom - margin || r.bottom > v.bottom ? "down" : "up", box: v };
}

function rectOf(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return r;
}

function overlaps(a, b) { return a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }

/** カードの置き場所: 示す所に重ならない、画面の隅のどれか。 */
function placeCard(target) {
  const card = $("tut-card");
  const w = card.offsetWidth, h = card.offsetHeight, W = innerWidth, H = innerHeight, m = 16;
  const cands = [[m + 220, H - h - 40], [W - w - m, H - h - 40], [W - w - m, 120], [m + 220, 120], [(W - w) / 2, (H - h) / 2]];
  for (const [x, y] of cands) {
    const r = { left: x, top: y, right: x + w, bottom: y + h };
    if (!overlaps(r, target)) { card.style.left = `${Math.max(m, x)}px`; card.style.top = `${Math.max(m, y)}px`; return; }
  }
}

function render() {
  const st = STEPS[run.i];
  $("tut-count").textContent = `${run.i + 1} / ${STEPS.length}`;
  $("tut-title").textContent = st.title;
  $("tut-text").innerHTML = kbd(st.text.replace("{name}", escapeHtml(run.name ?? "")).replace("{folder}", `<code>${escapeHtml(run.folder ?? "")}</code>`));
  const bar = [];
  if (run.i > 0) bar.push(`<button type="button" data-t="back">← 戻る</button>`);
  bar.push(`<span class="grow"></span>`);
  if (st.finish) {
    bar.push(`<button type="button" data-t="help">ヘルプを開く</button><button type="button" class="primary" data-t="finish">終わる</button>`);
  } else if (st.next) {
    bar.push(`<button type="button" class="${st.done ? "" : "primary"}" data-t="next">${st.next === true ? "次へ" : escapeHtml(st.next)}</button>`);
  } else {
    bar.push(`<button type="button" class="link" data-t="skip" title="この操作をしないで次へ">飛ばす</button>`);
  }
  $("tut-bar").innerHTML = bar.join("");
  $("tut-bar").querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.t;
    if (t === "back") go(run.i - 1);
    else if (t === "next" || t === "skip") go(run.i + 1);
    else if (t === "help") { stop(true); openHelp(); }
    else if (t === "finish") stop(true);
  }));
  tick();
}

function go(i) {
  run.i = Math.max(0, Math.min(STEPS.length - 1, i));
  run.entered = Date.now();
  saveProgress({ folder: run.folder, step: run.i, done: false });
  render();
}

function tick() {
  if (!run) return;
  const st = STEPS[run.i];
  // 済んだら次へ（入った直後に済んでいたら、少し見せてから）
  if (st.done && st.done() && Date.now() - run.entered > 700) { go(run.i + 1); return; }
  const target = st.target ? st.target() : null;
  let r = rectOf(target);
  const ring = $("tut-ring");
  const sc = $("tut-scroll");
  const off = offscreenHint(target, r);
  if (off) {
    // パネルの外（スクロールしないと見えない所）: 枠の代わりに、パネルの端に矢印
    const w = Math.min(off.box.width - 16, 220);
    sc.querySelector(".tut-scroll-text").textContent = off.dir === "down" ? "下へスクロール" : "上へスクロール";
    sc.classList.toggle("up", off.dir === "up");
    Object.assign(sc.style, { left: `${off.box.left + (off.box.width - w) / 2}px`, width: `${w}px`,
      top: off.dir === "down" ? `${off.box.bottom - 54}px` : `${off.box.top + 8}px` });
    sc.hidden = false;
    r = null;
  } else sc.hidden = true;
  if (r) {
    Object.assign(ring.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
    ring.hidden = false;
  } else ring.hidden = true;
  const lost = st.lost ? st.lost() : "";
  $("tut-lost").hidden = !lost;
  $("tut-lost").textContent = lost;
  placeCard(r ?? (sc.hidden ? null : sc.getBoundingClientRect()));
}

function begin(i, folder, name) {
  ensureUi();
  run = { i, folder, name, entered: Date.now(), timer: setInterval(tick, 250) };
  document.body.classList.add("tutorial-on");
  $("tut-card").hidden = false;
  render();
}

function stop(finished) {
  if (!run) return;
  clearInterval(run.timer);
  saveProgress(finished ? { done: true, step: 0 } : { folder: run.folder, step: run.i, done: false });
  run = null;
  $("tut-card").hidden = true;
  $("tut-ring").hidden = true;
  $("tut-scroll").hidden = true;
  document.body.classList.remove("tutorial-on");
}

async function saveCurrent() {
  if (store.project && store.dirty && store.saveNow) { try { await store.saveNow(true); } catch { /* 保存できなくても続ける */ } }
}

async function startFresh() {
  await saveCurrent();
  const payload = await api.post("/api/tutorial/new", {});
  emit("load-project", payload);
  await new Promise((r) => setTimeout(r, 400));
  begin(0, payload.folder, payload.project?.settings?.name ?? "");
}

async function resume(t) {
  await saveCurrent();
  const payload = await api.post("/api/project/open", { folder: t.folder });
  emit("load-project", payload);
  await new Promise((r) => setTimeout(r, 400));
  begin(Math.min(t.step ?? 0, STEPS.length - 1), payload.folder, payload.project?.settings?.name ?? "");
}

/** チュートリアルを始める（途中のものがあれば、続きからか最初からかを聞く）。 */
export async function startTutorial() {
  if (run) return;
  let t = null;
  try { t = (await api.get("/api/userconfig")).tutorial ?? null; } catch { /* 無くても続ける */ }
  let canResume = false;
  if (t?.folder && !t.done && (t.step ?? 0) > 0) {
    try { canResume = (await api.get(`/api/tutorial/exists?folder=${encodeURIComponent(t.folder)}`)).exists; } catch { /* 無ければ最初から */ }
  }
  if (!canResume) return startFresh().catch((e) => alertErr(e));
  ensureUi();
  $("tut-count").textContent = "";
  $("tut-title").textContent = "チュートリアル";
  $("tut-text").innerHTML = `前回は ${STEPS.length} 段階のうち ${t.step + 1} 段階目まで進みました。続きから始めますか？`;
  $("tut-lost").hidden = true;
  $("tut-bar").innerHTML = `<button type="button" data-t="cancel">やめる</button><span class="grow"></span>
    <button type="button" data-t="fresh">最初から</button><button type="button" class="primary" data-t="resume">続きから</button>`;
  $("tut-card").hidden = false;
  $("tut-card").style.left = `${(innerWidth - $("tut-card").offsetWidth) / 2}px`;
  $("tut-card").style.top = `${innerHeight / 3}px`;
  $("tut-bar").querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => {
    $("tut-card").hidden = true;
    if (b.dataset.t === "fresh") startFresh().catch(alertErr);
    else if (b.dataset.t === "resume") resume(t).catch(alertErr);
  }));
}

function alertErr(e) {
  toast(`チュートリアルを始められませんでした: ${e.message}`, "ng");
}

export const tutorialRunning = () => !!run;

/** 初めての起動のとき、初めの画面に案内を出す。 */
async function offerFirstRun() {
  let cfg = null;
  try { cfg = await api.get("/api/userconfig"); } catch { return; }
  if (cfg.tutorial) return; // 始めたことがある・断ったことがある
  const w = $("welcome");
  if (!w || $("tut-offer")) return;
  w.querySelector(".welcome-actions")?.insertAdjacentHTML("afterend", `<div class="tut-offer" id="tut-offer">
    <b>初めての方へ</b> — 練習用のプロジェクトで、実際に操作しながら一通りの流れを体験できます（10 分ほど）。
    <div class="tut-offer-bar"><button type="button" class="primary" id="tut-offer-go">チュートリアルを始める</button>
    <button type="button" id="tut-offer-no">今はしない</button></div>
    <div class="hint">あとからでも、ツールバーの「？」→「チュートリアルを始める」で始められます。</div></div>`);
  $("tut-offer-go").onclick = () => { $("tut-offer").remove(); startTutorial(); };
  $("tut-offer-no").onclick = () => { $("tut-offer").remove(); saveProgress({ dismissed: true }); };
}

export function setupTutorial() {
  on("action:tutorial", () => startTutorial());
  // 別のプロジェクトを開いたら、チュートリアルはやめる（続きは、次に始めたときに）
  on("load-project", (p) => { if (run && p?.folder && p.folder !== run.folder) stop(false); });
  addEventListener("resize", () => run && tick());
  offerFirstRun();
}
