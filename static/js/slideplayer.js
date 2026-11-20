// 1 枚だけの試し描画（Ctrl+Enter）の小窓。クリックの区切りごとの動画を、発表と同じく「次へ」「前へ」で進めて再生する。

import { api, appHeaders } from "./api.js";
import { applyCue, enterSlide, finish, initialState, stateAt } from "./mediaplan.js";
import { clipUrl, loadPoster } from "./media.js";
import { currentSlide, emit, escapeHtml, on, store, toast } from "./store.js";

let win = null;
const FPS = 15; // 試し描画は低画質（-ql: 15 コマ / 秒）
const RATES = [0.25, 0.5, 1, 1.5, 2];
let fromPlayer = false; // 小窓からステップを開いたとき（その知らせで小窓を動かさない）
let state = null; // { slideIndex, urls: [], clicks: [], i, playAll, plan, layers: {id: {spec, el}}, timers: [], pending: [] }

// ---- 動画・音声（発表で再生）: 発表ウィンドウと同じく、Manim の映像の上に重ねて再生する

function mediaState(L) {
  return { visible: !L.el.hidden, playing: !L.el.paused && !L.el.ended, pos: Math.max(Number(L.spec.trimStart || 0), L.el.currentTime), volume: L.vol, active: true };
}

function applyMedia(L, st) {
  st = st || initialState(L.spec);
  L.vol = Number(st.volume ?? 1);
  const s = Number(L.spec.trimStart || 0), e = Number(L.spec.trimEnd || L.spec.duration || 0);
  const pos = Math.min(Math.max(s, Number(st.pos) || 0), e || Infinity);
  if (L.el.readyState < 1) {
    // 読み込みの前に頼んだ位置は、読み込めたときに合わせる（区間の指定が効くように）
    L.el.addEventListener("loadedmetadata", () => { L.el.currentTime = pos; }, { once: true });
  } else if (Math.abs(L.el.currentTime - pos) > 0.05) { try { L.el.currentTime = pos; } catch { /* まだ読み込み中 */ } }
  L.el.playbackRate = state?.rate || 1;
  if (st.playing && !state?.paused) L.el.play().catch(() => {}); else L.el.pause();
  if (L.spec.kind === "video") L.el.hidden = !st.visible;
  updateVolume(L);
}

function updateVolume(L) {
  const p = L.el.currentTime, s = Number(L.spec.trimStart || 0), e = Number(L.spec.trimEnd || L.spec.duration || 0);
  let f = 1;
  if (L.spec.fadeIn > 0) f = Math.min(f, Math.max(0, (p - s) / L.spec.fadeIn));
  if (L.spec.fadeOut > 0 && e) f = Math.min(f, Math.max(0, (e - p) / L.spec.fadeOut));
  L.el.volume = Math.min(1, Math.max(0, L.vol * f));
}

function clearMediaTimers() {
  for (const t of state?.timers ?? []) clearTimeout(t);
  if (state) { state.timers = []; state.pending = []; }
}

function runCue(c, late = 0) {
  state.pending = state.pending.filter((x) => x !== c);
  const L = state.layers[c[2]];
  if (!L) return;
  const st = mediaState(L);
  applyCue(L.spec, st, c[3], c[4]);
  if (late > 0 && st.playing) st.pos = Number(st.pos) + late; // 途中から見るときは、その分だけ進めておく
  applyMedia(L, st);
}

/** 区切り k の、時刻 t（秒）より後の操作を予定に入れる（t より前のものは、すぐ行う）。 */
function scheduleCues(k, t = 0) {
  const cues = (state.plan?.cues ?? []).filter((c) => c[0] === k);
  state.pending = [...cues];
  for (const c of cues) {
    if (c[1] <= t + 0.001) runCue(c, t - c[1]);
    else if (!state.paused) state.timers.push(setTimeout(() => runCue(c), (c[1] - t) * 1000 / (state.rate || 1)));
  }
}

/** 区切り k の時刻 t に合わせて、動画・音声の状態を作り直す（シーク・一時停止からの再開・速さの変更）。 */
function mediaSync(k, t) {
  if (!state?.plan) return;
  clearMediaTimers();
  const states = stateAt(state.plan, k);
  for (const [id, L] of Object.entries(state.layers)) applyMedia(L, states[id]);
  scheduleCues(k, t);
}

/** 区切り k に入ったときの動画・音声。forward は「次へ」（再生を続けて、前の区切りの残りの操作をすぐ行う）。 */
function mediaEnter(k, forward) {
  if (!state?.plan) return;
  const pending = forward ? [...state.pending] : [];
  clearMediaTimers();
  if (forward) {
    for (const c of pending) runCue(c);
    const segs = state.plan.segments ?? [];
    if ((segs[k] ?? 0) !== (segs[k - 1] ?? 0)) {
      for (const L of Object.values(state.layers)) { const st = mediaState(L); enterSlide(L.spec, st, segs[k] ?? 0); applyMedia(L, st); }
    }
  } else {
    const states = stateAt(state.plan, k);
    for (const [id, L] of Object.entries(state.layers)) applyMedia(L, states[id]);
  }
  scheduleCues(k);
}

function mediaTick() {
  if (!state?.layers) return;
  for (const L of Object.values(state.layers)) {
    const e = Number(L.spec.trimEnd || L.spec.duration || 0);
    if (!L.el.paused && e && !L.el.loop && L.el.currentTime >= e - 0.03) {
      if (L.spec.loop) L.el.currentTime = Number(L.spec.trimStart || 0);
      else { const st = mediaState(L); finish(L.spec, st); applyMedia(L, st); }
    } else if (L.el.ended && !L.done) {
      L.done = true;
      if (L.spec.loop) { L.el.currentTime = Number(L.spec.trimStart || 0); L.el.play().catch(() => {}); L.done = false; }
      else { const st = mediaState(L); finish(L.spec, st); applyMedia(L, st); }
    }
    if (!L.el.ended) L.done = false;
    if (!L.el.paused) updateVolume(L);
  }
}

async function buildMedia(plan) {
  const box = win.querySelector(".sp-video");
  box.querySelectorAll(".sp-media").forEach((x) => x.remove());
  const layers = {};
  for (const [id, spec] of Object.entries(plan?.media ?? {})) {
    let url;
    try { url = await clipUrl(spec.path); } catch { toast(`「${spec.name || spec.path}」を読み込めませんでした。`, "warn"); continue; }
    const el = document.createElement(spec.kind === "video" ? "video" : "audio");
    el.className = "sp-media";
    el.src = url;
    // 動画の全体をくり返すときは、ブラウザにくり返させる（境目が途切れないように）
    el.loop = !!spec.loop && Number(spec.trimStart || 0) <= 0.01 && (!spec.trimEnd || Number(spec.trimEnd) >= Number(spec.duration || 0) - 0.05);
    el.preload = "auto";
    if (spec.kind === "video") {
      const [x, y, w, h] = spec.rect;
      Object.assign(el.style, { left: `${x / 19.2}%`, top: `${y / 10.8}%`, width: `${w / 19.2}%`, height: `${h / 10.8}%` });
      el.playsInline = true;
      el.controls = spec.controls !== false;
      el.hidden = true;
      el.style.objectFit = "fill"; // 枠は動画の縦横比で作ってあるので、余白を作らずに枠いっぱいに
      loadPoster(spec.path, spec.posterTime || 0).then((img) => { el.poster = img.src; }).catch(() => {});
      el.addEventListener("click", (e) => e.stopPropagation()); // 操作バーのクリックで次へ進まない
    }
    box.appendChild(el);
    layers[id] = { spec, el, vol: Number(spec.volume ?? 1) };
  }
  return layers;
}

function segLabel(k) {
  const c = state.clicks[k];
  return c === 0 ? "スライドの初め" : `クリック ${c}`;
}

function show(k, { atEnd = false, seekTo = null, keepPaused = false } = {}) {
  const v = win.querySelector("video.sp-main");
  const forward = !atEnd && seekTo == null && state.i >= 0 && k === state.i + 1;
  state.i = k;
  if (!keepPaused) state.paused = false;
  if (atEnd) state.paused = true;
  if (seekTo != null) mediaSync(k, seekTo); else mediaEnter(k, forward);
  if (atEnd) pauseLayers();
  v.src = state.urls[k];
  v.playbackRate = state.rate;
  v.onloadedmetadata = () => {
    v.playbackRate = state.rate;
    if (atEnd) { v.currentTime = Math.max(0, v.duration - 0.01); v.pause(); }
    else {
      if (seekTo != null) v.currentTime = Math.min(seekTo, Math.max(0, v.duration - 0.01));
      if (state.paused) v.pause(); else v.play().catch(() => {});
    }
    drawBar();
  };
  win.querySelector("[data-k=pos]").textContent = `${segLabel(k)}（${k + 1} / ${state.urls.length}）${state.loops[k] ? " ⟳くり返し" : ""}${state.autos[k] ? " ⏭自動で次へ" : ""}`;
  const nb = win.querySelector("[data-k=notes]");
  nb.hidden = !state.notes[k];
  nb.textContent = state.notes[k] ? `ノート: ${state.notes[k]}` : "";
  win.querySelector("[data-a=prev]").disabled = k === 0;
  win.querySelector("[data-a=next]").disabled = k >= state.urls.length - 1;
  win.querySelectorAll("[data-seg]").forEach((b) => b.classList.toggle("on", Number(b.dataset.seg) === k));
  drawBar();
  linkToEditor(k);
  // 押したボタンが使えなくなる（最初・最後の区切り）と、キー操作が窓から外れるので、窓に戻す
  const a = document.activeElement;
  if (a === document.body || (win.contains(a) && a.disabled)) win.focus();
}

function next() { if (state && state.i < state.urls.length - 1) { state.playAll = false; show(state.i + 1); } }
function prev() { if (state && state.i > 0) { state.playAll = false; show(state.i - 1, { atEnd: true }); } }

// ---- 再生の操作: 一時停止・シーク・速さ・コマ送り

function pauseLayers() {
  clearMediaTimers();
  for (const L of Object.values(state?.layers ?? {})) L.el.pause();
}

function setPaused(p) {
  if (!state) return;
  const v = win.querySelector("video.sp-main");
  if (!p && v.ended) { show(state.i); return; } // 終わった区切りは、初めから
  state.paused = p;
  if (p) { v.pause(); pauseLayers(); } else { mediaSync(state.i, v.currentTime); v.play().catch(() => {}); }
  drawBar();
}

function setRate(r) {
  if (!state) return;
  state.rate = r;
  try { localStorage.setItem("spRate", String(r)); } catch { /* なくてよい */ }
  const v = win.querySelector("video.sp-main");
  v.playbackRate = r;
  if (!state.paused) mediaSync(state.i, v.currentTime); // 予定の時刻を速さに合わせて作り直す
  for (const L of Object.values(state.layers)) L.el.playbackRate = r;
  win.querySelector("[data-k=rate]").value = String(r);
}

function frameStep(dir) {
  if (!state) return;
  const v = win.querySelector("video.sp-main");
  if (!state.paused) setPaused(true);
  const d = v.duration || 0;
  let t = v.currentTime + dir / FPS;
  if (t < 0 && state.i > 0 && dir < 0) { show(state.i - 1, { atEnd: true }); return; }
  if (t > d - 0.005 && state.i < state.urls.length - 1 && dir > 0 && v.currentTime >= d - 0.02) { show(state.i + 1, { seekTo: 0, keepPaused: true }); return; }
  t = Math.max(0, Math.min(d - 0.01, t));
  v.currentTime = t;
  mediaSync(state.i, t);
  pauseLayers();
  drawBar();
}

/** 通しで再生しているときは、スライド全体のバー（区切りの目盛り付き）。そうでなければ、今の区切りの中のバー。 */
function barRange() {
  const v = win.querySelector("video.sp-main");
  const durs = state.durs;
  if (state.playAll && durs.every((x) => x > 0)) {
    const off = durs.slice(0, state.i).reduce((a, b) => a + b, 0);
    return { whole: true, off, total: durs.reduce((a, b) => a + b, 0), t: off + (v.currentTime || 0) };
  }
  return { whole: false, off: 0, total: v.duration || durs[state.i] || 0, t: v.currentTime || 0 };
}

const fmtT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

function drawBar() {
  if (!state || !win) return;
  const b = barRange();
  const seek = win.querySelector("[data-k=seek]");
  seek.max = String(Math.max(0.01, b.total));
  if (!state.dragging) seek.value = String(Math.min(b.t, b.total));
  win.querySelector("[data-k=time]").textContent = `${fmtT(b.t)} / ${fmtT(b.total)}${b.whole ? "（スライド全体）" : ""}`;
  win.querySelector("[data-a=play]").textContent = state.paused || win.querySelector("video.sp-main").ended ? "▶" : "⏸";
  const ticks = win.querySelector("[data-k=ticks]");
  if (b.whole) {
    let acc = 0;
    ticks.innerHTML = state.durs.slice(0, -1).map((d) => { acc += d; return `<i style="left:${(acc / b.total) * 100}%"></i>`; }).join("");
  } else ticks.innerHTML = "";
}

function onSeek(value) {
  if (!state) return;
  const b = barRange();
  const t = Number(value);
  const v = win.querySelector("video.sp-main");
  if (b.whole) {
    let k = 0, off = 0;
    while (k < state.durs.length - 1 && t >= off + state.durs[k]) { off += state.durs[k]; k += 1; }
    if (k !== state.i) { show(k, { seekTo: t - off, keepPaused: true }); return; }
    v.currentTime = t - off;
    mediaSync(k, t - off);
  } else {
    v.currentTime = Math.min(t, Math.max(0, (v.duration || 0) - 0.01));
    mediaSync(state.i, v.currentTime);
  }
  if (state.paused) pauseLayers();
  drawBar();
}

// ---- 下の動きの欄との連動

function stepOfSeg(k) {
  const c = state?.clicks[k];
  const slide = currentSlide();
  if (!c || !slide || store.slideIndex !== state.slideIndex) return null;
  return slide.steps[c - 1] ?? null;
}

function linkToEditor(k) {
  if (!state?.link) return;
  const st = stepOfSeg(k);
  if (!st || store.focusStepId === st.id) return;
  fromPlayer = true;
  try {
    store.focusStepId = st.id;
    emit("focus-step", st.id);
    emit("step-chips");
  } finally { fromPlayer = false; }
}

on("focus-step", (id) => {
  if (fromPlayer || !state?.link || !win || store.slideIndex !== state.slideIndex) return;
  const slide = currentSlide();
  const c = (slide?.steps.findIndex((s) => s.id === id) ?? -1) + 1;
  const k = state.clicks.indexOf(c);
  if (c > 0 && k >= 0 && k !== state.i) { state.playAll = false; show(k); }
});

function build(onRerender) {
  win = document.createElement("div");
  win.className = "slide-player";
  win.tabIndex = -1;
  win.innerHTML = `<div class="sp-head"><span data-k="title">試し描画</span><span class="grow"></span>
      <button type="button" class="small" data-a="rerender" title="今のスライドをもう一度描画する">描画し直す</button>
      <button type="button" class="icon" data-a="close" title="閉じる（Esc）">×</button></div>
    <div class="sp-video"><video class="sp-main" playsinline></video></div>
    <div class="sp-bar"><button type="button" data-a="prev" title="前の区切り（←）">◀ 前へ</button>
      <button type="button" data-a="replay" title="この区切りをもう一度再生（R）">⟲</button>
      <button type="button" class="primary" data-a="next" title="次の区切り（→ または Space）">次へ ▶</button>
      <button type="button" data-a="all" title="スライドの初めから最後まで続けて再生する">通しで再生</button>
      <span class="sp-pos" data-k="pos"></span></div>
    <div class="sp-ctl"><button type="button" class="icon" data-a="play" title="再生・一時停止（K）">⏸</button>
      <button type="button" class="icon small" data-a="fback" title="1 コマ戻る（,）">⏮</button>
      <button type="button" class="icon small" data-a="ffwd" title="1 コマ進む（.）">⏭</button>
      <span class="sp-seekbox"><input type="range" data-k="seek" min="0" max="1" step="0.001" value="0"><span class="sp-ticks" data-k="ticks"></span></span>
      <span class="sp-time" data-k="time">0:00.0</span>
      <select data-k="rate" title="再生の速さ">${RATES.map((r) => `<option value="${r}">${r} 倍</option>`).join("")}</select>
      <label class="sp-link" title="表示中の区切りのステップを、下の動きの欄で開く（動きの欄でステップを選ぶと、その区切りへ飛ぶ）"><input type="checkbox" data-k="link"> 動きの欄と連動</label></div>
    <div class="sp-segs" data-k="segs"></div>
    <div class="sp-notes" data-k="notes" hidden></div>
    <div class="hint sp-note">低画質の試し描画です（発表・本番の描画は「▶ 描画・発表」）。窓は上の帯をドラッグして動かし、右下の角で大きさを変えられます。</div>`;
  document.body.appendChild(win);
  const v = win.querySelector("video.sp-main");
  v.addEventListener("ended", () => {
    // くり返しの区切り（焼き込んだ動画の「くり返し」など）は、次へ進むまでくり返す（発表と同じ）
    if (state && state.loops?.[state.i] && !state.playAll) { v.currentTime = 0; v.play().catch(() => {}); return; }
    // 「終わったら自動で次へ」の区切りは、続けて次の区切りを再生する（発表と同じ）
    if ((state?.playAll || state?.autos?.[state.i]) && state.i < state.urls.length - 1) show(state.i + 1); else if (state) state.playAll = false; });
  win.querySelector("[data-a=close]").addEventListener("click", closePlayer);
  win.querySelector("[data-a=next]").addEventListener("click", next);
  win.querySelector("[data-a=prev]").addEventListener("click", prev);
  win.querySelector("[data-a=replay]").addEventListener("click", () => { if (state) { state.playAll = false; show(state.i); } });
  win.querySelector("[data-a=all]").addEventListener("click", () => { if (state) { state.playAll = true; show(0); } });
  win.querySelector("[data-a=rerender]").addEventListener("click", () => onRerender?.());
  v.addEventListener("click", next);
  v.addEventListener("timeupdate", drawBar);
  v.addEventListener("pause", drawBar);
  v.addEventListener("play", drawBar);
  win.querySelector("[data-a=play]").addEventListener("click", () => setPaused(!(state?.paused || v.ended)));
  win.querySelector("[data-a=fback]").addEventListener("click", () => frameStep(-1));
  win.querySelector("[data-a=ffwd]").addEventListener("click", () => frameStep(1));
  const seek = win.querySelector("[data-k=seek]");
  seek.addEventListener("pointerdown", () => { if (state) state.dragging = true; });
  seek.addEventListener("pointerup", () => { if (state) state.dragging = false; });
  seek.addEventListener("input", () => onSeek(seek.value));
  win.querySelector("[data-k=rate]").addEventListener("change", (e) => setRate(Number(e.target.value)));
  win.querySelector("[data-k=link]").addEventListener("change", (e) => {
    if (!state) return;
    state.link = e.target.checked;
    try { localStorage.setItem("spLink", state.link ? "1" : "0"); } catch { /* なくてよい */ }
    if (state.link) linkToEditor(state.i);
  });
  win.addEventListener("keydown", (e) => {
    if (e.target.closest?.("select, input[type=range]") && /^Arrow/.test(e.key)) { e.stopPropagation(); return; }
    if (e.key === "k" || e.key === "K") { e.preventDefault(); setPaused(!(state?.paused || v.ended)); }
    else if (e.key === ",") { e.preventDefault(); frameStep(-1); }
    else if (e.key === ".") { e.preventDefault(); frameStep(1); }
    else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); if (state) show(state.i); }
    else if (e.key === "Escape") { e.preventDefault(); closePlayer(); }
    e.stopPropagation(); // キャンバスの操作（要素の移動・削除など）にしない
  });
  // 上の帯をドラッグして動かす
  const head = win.querySelector(".sp-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = win.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      win.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx))}px`;
      win.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => { head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });
  // 初めの位置: キャンバスの右上あたり
  const stage = document.getElementById("stage")?.getBoundingClientRect();
  const w = Math.min(560, window.innerWidth - 40);
  win.style.width = `${w}px`;
  win.style.left = `${Math.max(8, (stage ? stage.right : window.innerWidth) - w - 16)}px`;
  win.style.top = `${Math.max(8, (stage ? stage.top : 60) + 12)}px`;
}

function release() {
  for (const u of state?.urls ?? []) URL.revokeObjectURL(u);
  clearMediaTimers();
  for (const L of Object.values(state?.layers ?? {})) { L.el.pause(); L.el.remove(); }
  clearInterval(state?.tick);
  state = null;
}

export function closePlayer() {
  release();
  win?.remove();
  win = null;
}

/** 試し描画の結果を読み込んで、小窓で再生する（初めの区切りから）。 */
export async function openPlayer(slideIndex, onRerender, { startClick = 0 } = {}) {
  let r;
  try {
    r = await api.get("/api/preview/slide/segments");
  } catch (e) {
    toast(e.message, "ng");
    return;
  }
  // 動画はトークン付きで取り寄せて、ブラウザの中の URL にする
  const blobs = await Promise.all(r.segments.map(async (s) => {
    const res = await fetch(`/api/project/media?path=${encodeURIComponent(s.file)}&t=${r.updated}`, { headers: appHeaders() });
    if (!res.ok) throw new Error(`動画を読み込めませんでした: ${s.file}`);
    return URL.createObjectURL(await res.blob());
  })).catch((e) => { toast(e.message, "ng"); return null; });
  if (!blobs) return;
  release();
  if (!win) build(onRerender);
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const rate = Number(pref("spRate", "1"));
  state = { slideIndex, urls: blobs, clicks: r.segments.map((s) => s.click), loops: r.segments.map((s) => !!s.loop), autos: r.segments.map((s) => !!s.autoNext), notes: r.segments.map((s) => s.notes || ""), i: -1, playAll: false, plan: r.media, layers: {}, timers: [], pending: [],
    paused: false, rate: RATES.includes(rate) ? rate : 1, link: pref("spLink", "1") === "1", durs: blobs.map(() => 0) };
  win.querySelector("[data-k=rate]").value = String(state.rate);
  win.querySelector("[data-k=link]").checked = state.link;
  const st0 = state;
  blobs.forEach((u, k) => { // 区切りの長さ（スライド全体のバーに使う）
    const m = document.createElement("video");
    m.preload = "metadata";
    m.onloadedmetadata = () => { if (state === st0) { st0.durs[k] = m.duration || 0; drawBar(); } m.removeAttribute("src"); };
    m.src = u;
  });
  state.layers = await buildMedia(r.media);
  state.tick = setInterval(mediaTick, 50);
  win.querySelector("[data-k=title]").textContent = `試し描画: スライド ${slideIndex + 1}`;
  win.querySelector("[data-k=segs]").innerHTML = r.segments.map((s, k) => `<button type="button" class="small" data-seg="${k}" title="${escapeHtml(segLabel(k))}">${s.click === 0 ? "初め" : s.click}</button>`).join("");
  win.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => { state.playAll = false; show(Number(b.dataset.seg)); }));
  // startClick: そのクリック（ステップ）の区切りから見せる（「このステップを試す」）。前の区切りの最後のコマから始めるので、
  // そのステップの動きの前の状態も分かる
  const k0 = startClick ? r.segments.findIndex((s) => s.click === startClick) : 0;
  show(Math.max(0, k0));
  win.focus();
}

/** 自動テスト用: 重ねた動画・音声の様子。 */
export function playerMedia() {
  return Object.fromEntries(Object.entries(state?.layers ?? {}).map(([id, L]) => [id, { kind: L.spec.kind, hidden: L.el.hidden, paused: L.el.paused, time: L.el.currentTime }]));
}

export function playerState() {
  if (!state) return null;
  const v = win.querySelector("video.sp-main");
  return { slideIndex: state.slideIndex, index: state.i, count: state.urls.length, paused: state.paused || v.paused, time: v.currentTime, rate: v.playbackRate, durs: [...state.durs], link: state.link };
}
