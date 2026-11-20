// 動画・音声の要素のパネル（PowerPoint の「再生」タブに当たる設定）。

import { clipUrl, loadPoster, pickMediaFiles, replaceMedia } from "./media.js";
import { escapeHtml, store, toast } from "./store.js";

const fmt = (s) => { const v = Math.max(0, Number(s) || 0); return `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, "0")}`; };
const num = (k, v, { step = 0.1, min = "", max = "", ph = "" } = {}) => `<input type="number" class="num" data-k="${k}" value="${v ?? ""}" step="${step}" min="${min}" max="${max}" placeholder="${ph}">`;

function seg(k, items, cur) {
  return `<div class="seg" data-k="${k}">${items.map(([v, t]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</div>`;
}
function bindSeg(f, k, set) {
  f.querySelector(`[data-k=${k}]`).addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    f.querySelectorAll(`[data-k=${k}] [data-v]`).forEach((x) => x.classList.toggle("on", x === b));
    set(b.dataset.v);
  });
}

export function mediaPanel(sec, el, { field, changed, rerender }) {
  const video = el.kind === "video";
  const P = store.meta.canvas.h / 8;
  // ファイル（試聴・試写つき）
  const ff = field("ファイル", `<div class="field-note"><span data-k="name">${escapeHtml(el.name || "")}</span><br><code>${escapeHtml(el.path)}</code>（${fmt(el.duration)}${video ? `・${el.natW}×${el.natH}` : ""}${video && !el.hasAudio ? "・音声なし" : ""}）</div>
    <div data-k="player"></div>
    <div class="row"><button type="button" data-a="replace">差し替え…</button></div>`, { top: true });
  sec.appendChild(ff);
  const holder = ff.querySelector("[data-k=player]");
  clipUrl(el.path).then((url) => {
    const m = document.createElement(video ? "video" : "audio");
    m.controls = true; m.preload = "metadata"; m.src = url;
    m.style.width = "100%";
    if (video) m.style.maxHeight = "160px";
    m.addEventListener("error", () => { holder.innerHTML = `<div class="field-note">このブラウザでは試聴できない形式です（発表ウィンドウでは再生できる場合があります）。</div>`; });
    holder.appendChild(m);
  }).catch(() => { holder.innerHTML = `<div class="field-note ng">ファイルが見つかりません。プロジェクトの clips フォルダに戻すか、「差し替え…」で選び直してください。</div>`; });
  ff.querySelector("[data-a=replace]").addEventListener("click", async () => {
    const [file] = await pickMediaFiles({ multiple: false });
    if (!file) return;
    try { await replaceMedia(el, file); rerender(); } catch (e) { toast(e.message, "ng", 7000); }
  });

  if (el.animImage) {
    sec.appendChild(field("動く画像", `<div class="field-note">「${escapeHtml(el.animImage.name || "")}」（${el.animImage.frames ?? "?"} コマ）から作った、音の無い動画です。透明な部分は ${escapeHtml(el.animImage.background || "")} で塗っています（背景の色を変えたときは、画像を置き直してください）。
      「発表で再生」（既定）なら、発表ウィンドウと書き出した HTML で、クリックを待っている間も動き続けます。PowerPoint ではクリックで再生、PDF では止まった 1 コマになります。</div>`));
  }

  if (video) {
    const fz = field("大きさ", `<div class="row"><span class="unit">幅</span>${num("w", (el.width / P).toFixed(2), { step: 0.1, min: 0.1 })}<span class="unit">高さ ${(el.height / P).toFixed(2)}</span></div>
      <div class="row"><button type="button" class="small" data-fit="orig">元の大きさ</button><button type="button" class="small" data-fit="fw">画面の幅</button><button type="button" class="small" data-fit="fh">画面の高さ</button></div>
      <div class="field-note">Manim の単位。縦横比は元の動画のまま。キャンバスでは角のハンドルで変えます。</div>`);
    sec.appendChild(fz);
    const setW = (w) => { if (w > 0) { el.width = Math.round(w * 10) / 10; el.height = Math.round(el.width * el.natH / el.natW * 10) / 10; changed(el); rerender(); } };
    fz.querySelector("[data-k=w]").addEventListener("change", (e) => setW(Number(e.target.value) * P));
    fz.querySelectorAll("[data-fit]").forEach((b) => b.addEventListener("click", () => {
      const { w, h } = store.meta.canvas;
      setW({ orig: el.natW, fw: w, fh: h * el.natW / el.natH }[b.dataset.fit]);
    }));
  }

  // 再生方法・開始
  const fm = field("再生", `${seg("mode", [["live", "発表で再生"], ["bake", "動画に焼き込む"]], el.mode)}
    <div class="field-note" data-k="mnote"></div>
    ${seg("start", [["auto", "自動（スライドの初め）"], ["step", "ステップで"]], el.start)}
    <div class="field-note">ステップで再生・操作するときは、コードに <code>gui_media(self, ${escapeHtml(el.var)}, "play")</code> と書きます（ほかに "pause"・"stop"・"seek", 秒・"volume", 0〜1${video ? "・\"show\"・\"hide\"" : ""}）。
    <code>wait=True</code> を付けると終わるまで、<code>wait=2</code> なら 2 秒だけ待ってから、次の行・次のクリックへ進みます（待つ間も再生は続きます）。</div>`, { top: true });
  sec.appendChild(fm);
  const mnote = fm.querySelector("[data-k=mnote]");
  const showMode = () => {
    mnote.innerHTML = el.mode === "bake"
      ? `Manim の映像の中に${video ? "コマを描き" : "音声を入れ"}ます。${video ? `重なり順はほかの要素と同じで、上に数式などを重ねられ、<code>${escapeHtml(el.var)}.animate.shift(…)</code> や <code>FadeIn</code> で動かせます（動かしている間・フェードの間は、Manim が更新を止めるので、コマも止まります）。描画は遅くなります。` : ""}
        焼き込むと、描いた時間の分しか${video ? "動画" : "音声"}が進みません。「自動」は終わるまで（くり返しなら 1 回分）待ってから次のクリックを受け付け、ステップでは <code>wait=True</code>（終わるまで）か <code>wait=秒</code> を付けるか、再生のあとにアニメーションや <code>self.wait(秒)</code> を置きます。クリックを待っている間は止まるので、音量の変更や非表示のあとも続けて再生したいときは、その操作にも wait を付けます。
        <b>クリックした瞬間の再生位置に合わせた操作（クリックで音量を下げる・隠すなど）はできません</b>（描画のときには、発表でいつクリックするか分からないため）。それが必要なときは「発表で再生」にします。
        音声は、描画のあとで各スライドの動画に入れ直します（クリックの区切りで止まります）。どの環境でも同じように再生されます。`
      : `発表ウィンドウ（と Ctrl+Enter の試し描画）が、Manim の映像の上に重ねて再生します。${video ? "Manim の要素より手前に出ます。マウスを乗せると操作バーが出ます。" : ""}描画の時間は増えません。`;
    mnote.className = "field-note";
  };
  showMode();
  bindSeg(fm, "mode", (v) => { el.mode = v; if (v === "bake") el.across = false; showMode(); changed(el); rerender(); });
  bindSeg(fm, "start", (v) => { el.start = v; changed(el); });

  // トリミング・音量・フェード
  const ft = field("区間と音量", `<div class="row"><span class="unit">再生する区間</span>${num("ts", el.trimStart, { step: 0.1, min: 0 })}<span class="unit">〜</span>${num("te", el.trimEnd ?? "", { step: 0.1, min: 0, ph: "最後" })}<span class="unit">秒</span></div>
    <div class="row"><span class="unit">音量</span><input type="range" data-k="vol" min="0" max="100" step="5" value="${Math.round(el.volume * 100)}"><output>${Math.round(el.volume * 100)}%</output></div>
    <div class="row"><span class="unit">フェードイン</span>${num("fi", el.fadeIn, { step: 0.5, min: 0 })}<span class="unit">アウト</span>${num("fo", el.fadeOut, { step: 0.5, min: 0 })}<span class="unit">秒</span></div>
    <div class="field-note">区間の終わりを空欄にすると最後まで（全体 ${fmt(el.duration)}）。フェードは音量だけに効きます。</div>`);
  sec.appendChild(ft);
  ft.querySelector("[data-k=ts]").addEventListener("change", (e) => { el.trimStart = Math.max(0, Number(e.target.value) || 0); changed(el); });
  ft.querySelector("[data-k=te]").addEventListener("change", (e) => { const v = e.target.value.trim(); el.trimEnd = v === "" ? null : Math.max(0, Number(v) || 0); changed(el); });
  const vol = ft.querySelector("[data-k=vol]");
  vol.addEventListener("input", () => { el.volume = Number(vol.value) / 100; vol.nextElementSibling.textContent = `${vol.value}%`; changed(el); });
  ft.querySelector("[data-k=fi]").addEventListener("change", (e) => { el.fadeIn = Math.max(0, Number(e.target.value) || 0); changed(el); });
  ft.querySelector("[data-k=fo]").addEventListener("change", (e) => { el.fadeOut = Math.max(0, Number(e.target.value) || 0); changed(el); });

  // 終わったとき・くり返し・表示
  const fe = field("再生のしかた", `<label class="row"><input type="checkbox" data-k="loop" ${el.loop ? "checked" : ""}> 停止するまでくり返す</label>
    <div class="field-note">${el.mode === "bake" ? "動画に焼き込むときは、再生を始めた区切り（クリックの区切り）を、次へ進むまでくり返す動画にします（区切りの中で再生の前にあるアニメーションも一緒にくり返します）。" : "発表で再生するときは、停止・一時停止・別のスライドへ移るまで、区間の初めに戻ってくり返します。"}</div>
    ${video ? `<div class="row"><span class="unit">終わったら</span>${seg("after", [["hold", "最後のコマのまま"], ["rewind", "最初に戻す"], ["hide", "隠す"]], el.after)}</div>
    <label class="row"><input type="checkbox" data-k="idle" ${el.hideIdle ? "checked" : ""}> 再生していないときは隠す</label>
    <label class="row"><input type="checkbox" data-k="ctl" ${el.controls ? "checked" : ""}> マウスを乗せると操作バー（再生・一時停止・シーク）</label>
    <div class="row"><span class="unit">ポスター（再生前のコマ）</span>${num("pt", el.posterTime, { step: 0.1, min: 0 })}<span class="unit">秒</span></div>
    <div class="field-note">「最初から出す」を外すと、ステップの <code>gui_media(self, ${escapeHtml(el.var)}, "show")</code> か "play" で出します。</div>`
    : `<label class="row"><input type="checkbox" data-k="across" ${el.across ? "checked" : ""} ${el.mode === "bake" ? "disabled" : ""}> スライドをまたいで再生（発表で再生のときだけ）</label>
    <div class="row"><span class="unit">このスライドまで</span>${num("until", el.acrossUntil ?? "", { step: 1, min: 1, ph: "最後" })}<span class="unit">枚目</span></div>
    <div class="field-note">またがないときは、次のスライドに移ると止まります（BGM はまたいで再生にします）。音声はキャンバスではアイコンで示し、発表では何も表示しません。</div>`}`);
  sec.appendChild(fe);
  fe.querySelector("[data-k=loop]").addEventListener("change", (e) => { el.loop = e.target.checked; changed(el); });
  if (video) {
    bindSeg(fe, "after", (v) => { el.after = v; changed(el); });
    fe.querySelector("[data-k=idle]").addEventListener("change", (e) => { el.hideIdle = e.target.checked; changed(el); });
    fe.querySelector("[data-k=ctl]").addEventListener("change", (e) => { el.controls = e.target.checked; changed(el); });
    fe.querySelector("[data-k=pt]").addEventListener("change", (e) => {
      el.posterTime = Math.min(Math.max(0, Number(e.target.value) || 0), Math.max(0, (el.duration || 0) - 0.05));
      loadPoster(el.path, el.posterTime).catch(() => {});
      changed(el);
    });
  } else {
    fe.querySelector("[data-k=across]").addEventListener("change", (e) => { el.across = e.target.checked; changed(el); });
    fe.querySelector("[data-k=until]").addEventListener("change", (e) => { const v = e.target.value.trim(); el.acrossUntil = v === "" ? null : Math.max(1, Math.round(Number(v) || 1)); changed(el); });
  }
}
