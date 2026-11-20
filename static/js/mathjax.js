// MathJax 4 による数式の仮表示（SVG → 画像）。実際の見た目は Manim（XeLaTeX）の描画で確認する。

let readyPromise = null;
let macroGeneration = 0;

export function mathReady() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const mj = window.MathJax;
        if (mj && mj.startup && mj.startup.promise) {
          mj.startup.promise.then(() => resolve(mj), reject);
        } else if (Date.now() - t0 > 20000) {
          reject(new Error("MathJax を読み込めませんでした。"));
        } else {
          setTimeout(tick, 50);
        }
      };
      tick();
    });
  }
  return readyPromise;
}

// MathJax は数式の処理を1つずつ行う必要があるため、直列に実行する
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// 仮表示だけのための代用（MathJax に無い、よく使う文字用コマンド）。書き出しには影響しない。
const PREVIEW_COMPAT = {
  // 余白 .07em で、1桁の数字の丸がほぼ真円になる（.12em だと横長）
  textcircled: ["\\enclose{circle}{\\kern.07em #1\\kern.07em}", 1],
  raisebox: ["\\raise{#1}{#2}", 2],
};

/** 共通プリアンブルのマクロを MathJax に設定し、使えないマクロの一覧を返す。 */
export async function setMacros(macroInfo) {
  const mj = await mathReady();
  return serial(async () => {
    mj.config.tex.macros = { ...PREVIEW_COMPAT, ...(macroInfo?.macros || {}) };
    // 設定を読み直して、入力処理（TeX）を作り直す
    mj.startup.getComponents();
    macroGeneration++;
    const warnings = [];
    for (const d of macroInfo?.defs || []) {
      const args = Array.from({ length: d.nargs - (d.hasDefault ? 1 : 0) }, () => "{a}").join("");
      const probe = `\\${d.name}${args}`;
      const res = await probeTex(mj, probe);
      if (res) warnings.push({ name: d.name, line: d.line, message: res });
    }
    return warnings;
  });
}

async function probeTex(mj, tex) {
  try {
    const mml = await mj.tex2mmlPromise(tex, { display: true });
    if (/<merror/.test(mml)) {
      const m = /data-mjx-error="([^"]*)"/.exec(mml);
      return m ? decode(m[1]) : "数式の処理でエラーになりました";
    }
    const undef = /mathcolor="red"[^>]*>\\?([^<]*)</.exec(mml);
    if (undef) return `未定義のコマンド ${undef[1]}`;
    return "";
  } catch (e) {
    return String(e?.message || e);
  }
}

function decode(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

const cache = new Map();

/** xcolor の \color[HTML]{RRGGBB} を、MathJax が読める \color[RGB]{r,g,b} にする（MathJax には HTML の色の形が無い）。 */
function htmlColors(latex) {
  return String(latex ?? "").replace(/\\(color|textcolor|colorbox)\s*\[HTML\]\s*\{\s*([0-9A-Fa-f]{6})\s*\}/g, (_, cmd, h) =>
    `\\${cmd}[RGB]{${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}}`);
}

/**
 * LaTeX を SVG の画像（data URL）にする。
 * emPx: 1em のピクセル数（論理座標 1920×1080 で）。color: "#RRGGBB"。
 * 戻り値: { url, width, height, error }
 */
export async function renderMath(latex, emPx, color) {
  latex = htmlColors(latex);
  const key = `${macroGeneration}|${emPx}|${color}|${latex}`;
  if (cache.has(key)) return cache.get(key);
  const mj = await mathReady();
  const result = await serial(async () => {
    let error = "";
    let node;
    try {
      node = await mj.tex2svgPromise(latex || "\\;", { display: true, em: emPx, ex: emPx / 2, containerWidth: emPx * 200 });
    } catch (e) {
      return errorImage(String(e?.message || e), emPx);
    }
    const svg = node.querySelector("svg");
    if (!svg) return errorImage("数式を表示できません", emPx);
    const merr = svg.querySelector("[data-mjx-error]");
    if (merr) error = merr.getAttribute("data-mjx-error");
    const undef = svg.querySelector('[data-mml-node="mtext"][fill="red"], [data-mml-node="mtext"] [fill="red"]');
    if (!error && undef) error = undef.textContent ? `未定義のコマンド: ${undef.textContent}` : "未定義のコマンドがあります";
    const vb = (svg.getAttribute("viewBox") || "0 0 1000 1000").split(/\s+/).map(Number);
    const w = Math.max(1, (vb[2] / 1000) * emPx);
    const h = Math.max(1, (vb[3] / 1000) * emPx);
    svg.setAttribute("width", `${w}`);
    svg.setAttribute("height", `${h}`);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("style", `color:${color}`);
    svg.removeAttribute("role");
    svg.removeAttribute("focusable");
    const str = new XMLSerializer().serializeToString(svg);
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}`, width: w, height: h, error };
  });
  if (cache.size > 400) cache.clear();
  cache.set(key, result);
  return result;
}

function errorImage(message, emPx) {
  const fs = Math.max(14, emPx * 0.4);
  const text = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).slice(0, 80);
  const w = Math.max(160, text.length * fs * 0.62 + 20);
  const h = fs * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fdecee" stroke="#c62f3a"/><text x="10" y="${h * 0.65}" font-size="${fs}" fill="#c62f3a" font-family="sans-serif">${text}</text></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: w, height: h, error: message };
}
