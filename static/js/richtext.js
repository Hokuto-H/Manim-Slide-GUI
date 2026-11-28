// 書式付きテキストの編集欄。文字ごとの色・透明度・太字・斜体・下線・取り消し線・マーカーを付けられる。
// 内容は runs（[{t, c, o, b, i, u, s, bg}]）で持ち、ブラウザが作る HTML には頼らない（読み直して runs にする）。

import { escapeHtml, normalizeHex } from "./store.js";

const ATTRS = ["c", "o", "b", "i", "u", "s", "bg"];

function sameStyle(a, b) {
  return ATTRS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.t += r.t;
    else out.push({ ...r });
  }
  return out.length ? out : [{ t: "" }];
}

export const plainOf = (runs) => runs.map((r) => r.t).join("");


function runStyle(r, defaultColor, defaultOpacity) {
  const css = [];
  // 編集欄の文字は、要素の文字色（白など）に関係なく、いつも読みやすい色で出す。
  // 一部に付けた色は、文字の下の太い線で示す（不透明度は、薄すぎて見えなくならないよう下限を付けて反映）
  const o = r.o ?? defaultOpacity ?? 1;
  css.push(`color:rgba(29,33,40,${Math.max(0.35, o)})`);
  if (r.c && r.c.toLowerCase() !== String(defaultColor || "").toLowerCase()) css.push(`box-shadow:inset 0 -4px 0 ${r.c}`);
  if (r.b) css.push("font-weight:700");
  if (r.i) css.push("font-style:italic");
  const deco = [r.u ? "underline" : "", r.s ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) css.push(`text-decoration:${deco}`);
  if (r.bg) css.push(`background-color:${r.bg}`);
  return css.join(";");
}

/** runs の [start, end) に fn を当てる（区間の境目で runs を分ける）。 */
function mapRange(runs, start, end, fn) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const a = pos, b = pos + r.t.length;
    pos = b;
    if (b <= start || a >= end) { out.push({ ...r }); continue; }
    const s = Math.max(start, a) - a, e = Math.min(end, b) - a;
    if (s > 0) out.push({ ...r, t: r.t.slice(0, s) });
    out.push(fn({ ...r, t: r.t.slice(s, e) }));
    if (e < r.t.length) out.push({ ...r, t: r.t.slice(e) });
  }
  return mergeRuns(out);
}

function runsInRange(runs, start, end) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const a = pos, b = pos + r.t.length;
    pos = b;
    if (b > start && a < end && r.t.slice(Math.max(start, a) - a, Math.min(end, b) - a).trim()) out.push(r);
  }
  return out;
}

export function createRichEditor({ runs, defaultColor = "#222222", defaultOpacity = 1, onChange }) {
  let model = mergeRuns(runs.map((r) => ({ ...r })));
  const wrap = document.createElement("div");
  wrap.className = "rt";
  wrap.innerHTML = `
    <div class="rt-toolbar">
      <button type="button" data-cmd="b" title="太字（Ctrl+B）"><b>B</b></button>
      <button type="button" data-cmd="i" title="斜体（Ctrl+I）"><i>I</i></button>
      <button type="button" data-cmd="u" title="下線（Ctrl+U）"><u>U</u></button>
      <button type="button" data-cmd="s" title="取り消し線"><s>S</s></button>
      <span class="rt-sep"></span>
      <label class="rt-color" title="文字の色"><span>色</span><input type="color" data-cmd="c"></label>
      <button type="button" data-cmd="c-reset" class="small" title="文字の色を、要素の文字色に戻す">既定</button>
      <span class="rt-sep"></span>
      <label class="rt-color" title="マーカー（文字の背景色）"><span>マーカー</span><input type="color" data-cmd="bg" value="#FFEB3B"></label>
      <button type="button" data-cmd="bg-reset" class="small" title="マーカーを消す">なし</button>
      <span class="rt-sep"></span>
      <label class="rt-opacity" title="文字の不透明度"><span>不透明度</span><input type="range" min="0" max="100" step="5" data-cmd="o"><output>100%</output></label>
      <button type="button" data-cmd="clear" class="small" title="選んだ部分の書式をすべて消す">書式を消す</button>
    </div>
    <div class="rt-area" contenteditable="true" spellcheck="false"></div>
    <div class="field-note">文字を選んでからボタンを押すと、その部分だけに書式が付きます（選んでいないときは全体）。</div>`;
  const area = wrap.querySelector(".rt-area");
  const bar = wrap.querySelector(".rt-toolbar");
  const opRange = bar.querySelector('[data-cmd="o"]');
  const opOut = bar.querySelector(".rt-opacity output");
  const colorIn = bar.querySelector('[data-cmd="c"]');
  let lastRange = [0, 0];

  // ---- runs → HTML ----
  function render() {
    area.innerHTML = model.map((r) => {
      const data = ATTRS.filter((k) => r[k] != null && r[k] !== false).map((k) => `data-${k}="${escapeHtml(String(r[k]))}"`).join(" ");
      return `<span data-r ${data} style="${runStyle(r, defaultColor, defaultOpacity)}">${escapeHtml(r.t)}</span>`;
    }).join("");
    fixTrailing();
  }

  // 最後が改行のとき、空の行が見えるように <br> を置く（読み取りでは無視する）
  function fixTrailing() {
    const text = plainOf(model);
    const last = area.lastChild;
    if (text.endsWith("\n") || !text) {
      if (!(last && last.nodeName === "BR")) area.appendChild(document.createElement("br"));
    } else if (last && last.nodeName === "BR") {
      last.remove();
    }
  }

  // ---- HTML → runs ----
  function read() {
    const out = [];
    const walk = (node, style) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === Node.TEXT_NODE) {
          out.push({ ...style, t: ch.nodeValue });
        } else if (ch.nodeName === "BR") {
          if (ch !== area.lastChild) out.push({ ...style, t: "\n" });
        } else if (ch.nodeType === Node.ELEMENT_NODE) {
          let st = style;
          if (ch.hasAttribute("data-r")) {
            st = {};
            for (const k of ATTRS) {
              const v = ch.getAttribute(`data-${k}`);
              if (v == null) continue;
              st[k] = k === "o" ? Number(v) : ["b", "i", "u", "s"].includes(k) ? true : v;
            }
          }
          if ((ch.nodeName === "DIV" || ch.nodeName === "P") && out.length) out.push({ ...st, t: "\n" });
          walk(ch, st);
        }
      }
    };
    walk(area, {});
    return mergeRuns(out.map((r) => ({ ...r, t: r.t.replace(/\r/g, "") })));
  }

  // ---- 選択範囲（文字の位置）----
  function offsetOf(container, offset) {
    const r = document.createRange();
    r.setStart(area, 0);
    try { r.setEnd(container, offset); } catch { return 0; }
    // <br> は toString に出ないので、途中の <br>（最後以外）を改行として数える
    let n = r.toString().length;
    const frag = r.cloneContents();
    n += [...frag.querySelectorAll("br")].length;
    return n;
  }

  function getOffsets() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !area.contains(sel.anchorNode)) return null;
    const rg = sel.getRangeAt(0);
    const a = offsetOf(rg.startContainer, rg.startOffset);
    const b = offsetOf(rg.endContainer, rg.endOffset);
    return [Math.min(a, b), Math.max(a, b)];
  }

  function setOffsets(start, end) {
    const pos = (target) => {
      let n = 0;
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (n + node.nodeValue.length >= target) return [node, target - n];
        n += node.nodeValue.length;
      }
      return [area, area.childNodes.length];
    };
    const [sn, so] = pos(start);
    const [en, eo] = pos(end);
    const rg = document.createRange();
    rg.setStart(sn, so);
    rg.setEnd(en, eo);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rg);
  }

  function emit() {
    onChange?.(model.map((r) => ({ ...r })));
  }

  // ---- 書式の適用 ----
  function apply(cmd, value) {
    const len = plainOf(model).length;
    let [s, e] = getOffsets() ?? lastRange;
    if (s === e) { s = 0; e = len; } // 選んでいないときは全体
    if (["b", "i", "u", "s"].includes(cmd)) {
      const on = runsInRange(model, s, e).every((r) => r[cmd]);
      model = mapRange(model, s, e, (r) => { if (on) delete r[cmd]; else r[cmd] = true; return r; });
    } else if (cmd === "c") {
      model = mapRange(model, s, e, (r) => ({ ...r, c: value }));
    } else if (cmd === "c-reset") {
      model = mapRange(model, s, e, (r) => { delete r.c; return r; });
    } else if (cmd === "bg") {
      model = mapRange(model, s, e, (r) => ({ ...r, bg: value }));
    } else if (cmd === "bg-reset") {
      model = mapRange(model, s, e, (r) => { delete r.bg; return r; });
    } else if (cmd === "o") {
      model = mapRange(model, s, e, (r) => { if (value >= 0.999) delete r.o; else r.o = value; return r; });
    } else if (cmd === "clear") {
      model = mapRange(model, s, e, (r) => ({ t: r.t }));
    }
    render();
    area.focus({ preventScroll: true });
    setOffsets(s, e);
    lastRange = [s, e];
    emit();
    syncToolbar();
  }

  // 選んでいる位置の書式を、ボタンの状態に反映する
  function syncToolbar() {
    const off = getOffsets() ?? lastRange;
    const [s, e] = off;
    const rs = s === e ? runsInRange(model, Math.max(0, s - 1), s || 1) : runsInRange(model, s, e);
    for (const k of ["b", "i", "u", "s"]) {
      bar.querySelector(`[data-cmd="${k}"]`).classList.toggle("on", rs.length > 0 && rs.every((r) => r[k]));
    }
    const first = rs[0] ?? model[0] ?? {};
    colorIn.value = (first.c || defaultColor).toLowerCase();
    const o = Math.round(((first.o ?? 1)) * 100);
    opRange.value = o;
    opOut.textContent = `${o}%`;
  }

  // ---- 入力 ----
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      apply(e.key.toLowerCase());
    }
  });
  area.addEventListener("beforeinput", (e) => {
    // ブラウザ自身の書式（<b> などを作る操作）は使わない
    if (e.inputType.startsWith("format")) e.preventDefault();
  });
  area.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    document.execCommand("insertText", false, text);
  });
  area.addEventListener("drop", (e) => e.preventDefault());
  area.addEventListener("input", () => {
    model = read();
    fixTrailing();
    emit();
  });
  const remember = () => {
    const off = getOffsets();
    if (off) { lastRange = off; syncToolbar(); }
  };
  document.addEventListener("selectionchange", remember);

  bar.addEventListener("mousedown", (e) => {
    // ボタンを押しても編集欄の選択が消えないようにする（色の入力欄は操作できるようにする）
    if (e.target.closest("button")) e.preventDefault();
  });
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cmd]");
    if (b) apply(b.dataset.cmd);
  });
  colorIn.addEventListener("change", () => apply("c", normalizeHex(colorIn.value)));
  bar.querySelector('[data-cmd="bg"]').addEventListener("change", (e) => apply("bg", normalizeHex(e.target.value)));
  opRange.addEventListener("input", () => { opOut.textContent = `${opRange.value}%`; });
  opRange.addEventListener("change", () => apply("o", Number(opRange.value) / 100));

  render();
  syncToolbar();

  return {
    el: wrap,
    area,
    get runs() { return model.map((r) => ({ ...r })); },
    /** 最後に選んでいた所（カーソル）に文字を入れる（参照の挿入など）。 */
    insertText(text) {
      area.focus();
      setOffsets(...lastRange);
      document.execCommand("insertText", false, text);
    },
    setDefaults(color, opacity) { defaultColor = color; defaultOpacity = opacity; const off = getOffsets(); render(); if (off) setOffsets(...off); },
    destroy() { document.removeEventListener("selectionchange", remember); },
  };
}
