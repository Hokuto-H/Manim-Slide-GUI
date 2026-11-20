// 素のテキスト欄に、行番号とエラー行のハイライトだけを加えたコード欄。
// 構文ハイライトや自動補完は行わない（要件どおり）。

import { escapeHtml } from "./store.js";

export function createCodeEditor({ value = "", rows = 4, placeholder = "", onInput = null, errorLine = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "code-wrap";
  wrap.innerHTML = `<div class="code-gutter"></div><div class="code-area"><div class="code-backdrop"></div><textarea spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"></textarea></div>`;
  const gutter = wrap.querySelector(".code-gutter");
  const backdrop = wrap.querySelector(".code-backdrop");
  const ta = wrap.querySelector("textarea");
  ta.value = value;
  ta.rows = rows;
  ta.placeholder = placeholder;
  let errLine = errorLine;

  function paint() {
    const lines = ta.value.split("\n");
    gutter.innerHTML = lines.map((_, i) => (i + 1 === errLine ? `<span class="err-n">${i + 1}</span>` : `${i + 1}`)).join("\n");
    backdrop.innerHTML = lines
      .map((l, i) => (i + 1 === errLine ? `<mark>${escapeHtml(l) || " "}</mark>` : escapeHtml(l)))
      .join("\n") + "\n";
    autosize();
    sync();
  }
  function autosize() {
    const n = Math.max(rows, ta.value.split("\n").length + 1);
    ta.style.height = `${Math.min(n, 40) * 1.5 * 12.5 + 14}px`;
  }
  function sync() {
    backdrop.scrollTop = ta.scrollTop;
    backdrop.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }
  ta.addEventListener("input", () => {
    if (errLine) errLine = null; // 編集したらハイライトを消す
    paint();
    onInput?.(ta.value);
  });
  ta.addEventListener("scroll", sync);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input"));
    }
  });
  paint();

  return {
    el: wrap,
    textarea: ta,
    get value() { return ta.value; },
    set value(v) { ta.value = v; paint(); },
    setErrorLine(n) { errLine = n; paint(); },
    /** 該当行へカーソルを移し、見える位置までスクロールする。 */
    revealLine(n) {
      const lines = ta.value.split("\n");
      const start = lines.slice(0, Math.max(0, n - 1)).reduce((a, l) => a + l.length + 1, 0);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
      ta.scrollTop = Math.max(0, (n - 3) * 1.5 * 12.5);
      wrap.scrollIntoView({ block: "center", behavior: "smooth" });
      sync();
    },
  };
}
