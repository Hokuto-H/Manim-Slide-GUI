// 統計のグラフ（段階S）の右パネル: 種類・データの表（CSV の貼り付け）・列の使い方・軸・見た目。

import { escapeHtml, normalizeHex, on, store, toast } from "./store.js";
import { select } from "./selection.js";

const P = () => store.meta.canvas.h / 8;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (k, v, { step = "any", min = "", max = "" } = {}) => `<input type="number" class="num" data-k="${k}" step="${step}" min="${min}" max="${max}" value="${v}">`;
const PALETTE = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC", "#5CD0B3", "#F0AC5F", "#E65A4C", "#236B8E", "#C55F73"];
const reselect = (el) => setTimeout(() => select(el.id), 50);
export const STAT_KINDS = [["scatter", "散布図"], ["line", "折れ線"], ["bar", "集合縦棒"], ["stacked", "積み上げ縦棒"], ["hist", "ヒストグラム"], ["box", "箱ひげ図"], ["pie", "円グラフ"]];

/** セルの数（空欄・数でないものは null）。Python 側（statmodel.cell_num）と同じ読み方。 */
export function cellNum(s) {
  // 全角の数字・小数点・符号（−）を半角に。桁区切りのカンマは、半角・全角（，）とも取り除く
  const t = String(s ?? "").trim().replace(/[０-９．－＋−]/g, (c) => "0123456789.-+-"["０１２３４５６７８９．－＋−".indexOf(c)]).replace(/[,，]/g, "");
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

// 表の大きさの上限（サーバーの statmodel.py と同じ。超えた分は保存されないので、入れる時点で知らせて切る）
const MAX_ROWS = 500, MAX_COLS = 16;
function capTable(t) {
  const over = t.rows.length - MAX_ROWS, overC = t.headers.length - MAX_COLS;
  if (over > 0) t.rows.length = MAX_ROWS;
  if (overC > 0) { t.headers.length = MAX_COLS; t.rows.forEach((r) => { r.length = Math.min(r.length, MAX_COLS); }); }
  if (over > 0 || overC > 0) {
    toast(`データの表は ${MAX_ROWS} 行・${MAX_COLS} 列までです。${over > 0 ? `${MAX_ROWS + over} 行のうち、${over} 行` : ""}${over > 0 && overC > 0 ? "と、" : ""}${overC > 0 ? `${overC} 列` : ""}は入れませんでした。`, "warn", 9000);
  }
}

/** 区切りの文字を、すべての行を見て決める（1 行目だけで決めると、1 列だけの「1,234」の桁区切りで列に分かれてしまう）。
 * タブ → カンマ（桁区切りの「1,234」の形は数えない） → セミコロン → 空白 → 区切りなし（1 列）の順。 */
function detectSep(src) {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.some((l) => l.includes("\t"))) return "\t";
  const unquoted = (l) => l.replace(/"[^"]*"/g, "");
  const realCommas = (l) => (unquoted(l).replace(/(^|[^\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/g, "$1N").match(/,/g) || []).length;
  if (lines.some((l) => realCommas(l) > 0)) return ",";
  if (lines.some((l) => unquoted(l).includes(";"))) return ";";
  if (lines.some((l) => unquoted(l).includes(","))) return "none"; // カンマは桁区切りだけ: 1 列
  if (lines.every((l) => /\s/.test(l.trim())) && lines.length) return "ws";
  return "none";
}

/** CSV・タブ区切り（表計算からのコピー）を、行の配列にする。引用符（"…"）の中のカンマ・改行もそのまま。 */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!src.trim()) return [];
  const sep = detectSep(src);
  if (sep === "ws") return src.split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
  if (sep === "none") return src.split("\n").filter((l) => l.trim()).map((l) => [l.trim().replace(/^"(.*)"$/, "$1")]); // 1 列だけ
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** 表を置き換えたあと、列の使い方を種類に合わせて決め直す。 */
export function autoAssign(el, { labels = false } = {}) {
  const n = el.table.headers.length;
  const isErr = (h) => /誤差|err|±|\bsd\b|\bse\b|標準偏差|標準誤差|stdev|std/i.test(String(h ?? ""));
  const numeric = el.table.headers.map((_, c) => el.table.rows.some((r) => cellNum(r[c]) !== null) && el.table.rows.every((r) => !String(r[c] ?? "").trim() || cellNum(r[c]) !== null));
  const firstNum = numeric.indexOf(true);
  const k = el.chartKind;
  if (k === "scatter" || k === "line") {
    el.xCol = firstNum >= 0 ? firstNum : 0;
    el.series = seriesOf(numeric, el.xCol, el.table.headers, isErr);
    if (labels) { el.xLabel = el.table.headers[el.xCol] ?? ""; el.yLabel = el.series.length === 1 ? el.table.headers[el.series[0].col] ?? "" : ""; }
  } else if (k === "bar" || k === "stacked") {
    el.xCol = numeric.indexOf(false) >= 0 ? numeric.indexOf(false) : 0;
    el.series = seriesOf(numeric, el.xCol, el.table.headers, isErr);
    if (k === "stacked") el.series.forEach((s) => { s.errCol = -1; });
    if (labels) { el.xLabel = ""; el.yLabel = ""; }
  } else if (k === "hist") {
    el.valueCol = firstNum >= 0 ? firstNum : 0;
    if (labels) { el.xLabel = el.table.headers[el.valueCol] ?? ""; el.yLabel = "度数"; }
  } else if (k === "box") {
    if (labels) { el.xLabel = ""; el.yLabel = ""; }
    el.boxCols = numeric.map((v, c) => (v ? c : -1)).filter((c) => c >= 0).map((col, i) => ({ col, color: PALETTE[i % PALETTE.length] }));
  } else if (k === "pie") {
    el.xCol = numeric.indexOf(false) >= 0 ? numeric.indexOf(false) : 0;
    el.valueCol = numeric.findIndex((v, c) => v && c !== el.xCol);
    if (el.valueCol < 0) el.valueCol = Math.min(1, n - 1);
    el.pieColors = el.table.rows.map((_, i) => el.pieColors?.[i] ?? PALETTE[i % PALETTE.length]);
  }
  if (!el.series?.length && n > 1) el.series = [{ col: Math.min(1, n - 1), color: PALETTE[0], errCol: -1, fit: false }];
}

// ---------------------------------------------------------------- 行の選択と並べ替え（行番号のドラッグ）

const rowSelection = new Map(); // 要素の id → 選んでいる行の番号（パネルを作り直しても残す）
const rowAnchor = new Map();
function selOf(el) {
  let s = rowSelection.get(el.id);
  if (!s) { s = new Set(); rowSelection.set(el.id, s); }
  for (const i of [...s]) if (i >= el.table.rows.length) s.delete(i);
  return s;
}

/** rows の中の sel の行を、to（0〜行の数。その行の前）へまとめて移す。新しい並びの元の番号の配列を返す。 */
export function moveRowsOrder(n, sel, to) {
  const picked = [...sel].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const pickedSet = new Set(picked);
  const rest = [];
  for (let i = 0; i < n; i++) if (!pickedSet.has(i)) rest.push(i);
  const at = to - picked.filter((i) => i < to).length;
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}

function applyOrder(el, order) {
  const t = el.table;
  t.rows = order.map((i) => t.rows[i]);
  if (Array.isArray(el.pieColors)) el.pieColors = order.map((i) => el.pieColors[i]).map((c, k) => c ?? PALETTE[k % PALETTE.length]);
  const sel = selOf(el), moved = new Set(sel);
  sel.clear();
  order.forEach((orig, k) => { if (moved.has(orig)) sel.add(k); });
}

function bindRowDrag(fd, el, changed) {
  const wrap = fd.querySelector(".stat-table");
  const trs = () => [...fd.querySelectorAll("tbody tr[data-row]")];
  const sel = selOf(el);
  const paint = () => {
    fd.querySelectorAll("th.rh").forEach((th) => th.classList.toggle("sel", sel.has(Number(th.dataset.row))));
    fd.querySelector("[data-k=selbar]").hidden = !sel.size;
    fd.querySelector("[data-k=selinfo]").textContent = `${sel.size} 行を選んでいます。`;
  };
  const clearDrop = () => trs().forEach((tr) => tr.classList.remove("drop-before", "drop-after"));
  const dropIndex = (y) => {
    const list = trs();
    for (let k = 0; k < list.length; k++) {
      const r = list[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return list.length;
  };
  fd.querySelectorAll("th.rh").forEach((th) => th.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const i = Number(th.dataset.row);
    const multi = e.ctrlKey || e.metaKey;
    let deferSingle = false;
    if (e.shiftKey && rowAnchor.has(el.id)) {
      const a = rowAnchor.get(el.id);
      if (!multi) sel.clear();
      for (let k = Math.min(a, i); k <= Math.max(a, i); k++) sel.add(k);
    } else if (multi) {
      if (sel.has(i)) sel.delete(i); else sel.add(i);
      rowAnchor.set(el.id, i);
    } else if (sel.has(i)) {
      deferSingle = true; // 選んだ行をつかんだときは、動かさずに離したら、その 1 行だけを選ぶ
    } else {
      sel.clear(); sel.add(i); rowAnchor.set(el.id, i);
    }
    paint();
    if (!sel.has(i)) return;
    const y0 = e.clientY;
    let dragging = false, to = -1, timer = null;
    th.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - y0) < 4) return;
      dragging = true;
      wrap.classList.add("dragging");
      to = dropIndex(ev.clientY);
      clearDrop();
      const list = trs();
      if (to < list.length) list[to].classList.add("drop-before"); else list.at(-1)?.classList.add("drop-after");
      // 表の上下の端の近くでは、表を送る
      const r = wrap.getBoundingClientRect();
      clearInterval(timer);
      const dy = ev.clientY < r.top + 24 ? -12 : ev.clientY > r.bottom - 24 ? 12 : 0;
      if (dy) timer = setInterval(() => { wrap.scrollTop += dy; }, 30);
    };
    const up = () => {
      th.removeEventListener("pointermove", move);
      th.removeEventListener("pointerup", up);
      th.removeEventListener("pointercancel", up);
      clearInterval(timer);
      clearDrop();
      wrap.classList.remove("dragging");
      if (!dragging) {
        if (deferSingle) { sel.clear(); sel.add(i); rowAnchor.set(el.id, i); paint(); }
        return;
      }
      const order = moveRowsOrder(el.table.rows.length, sel, to);
      if (order.every((v, k) => v === k)) return;
      applyOrder(el, order);
      changed(el); reselect(el);
    };
    th.addEventListener("pointermove", move);
    th.addEventListener("pointerup", up);
    th.addEventListener("pointercancel", up);
  }));
  const step = (d) => {
    if (!sel.size) return;
    const idx = [...sel].sort((a, b) => a - b);
    const to = d < 0 ? Math.max(0, idx[0] - 1) : Math.min(el.table.rows.length, idx.at(-1) + 2);
    const order = moveRowsOrder(el.table.rows.length, sel, to);
    if (order.every((v, k) => v === k)) return;
    applyOrder(el, order);
    changed(el); reselect(el);
  };
  fd.querySelector("[data-a=selup]").addEventListener("click", () => step(-1));
  fd.querySelector("[data-a=seldown]").addEventListener("click", () => step(1));
  fd.querySelector("[data-a=selnone]").addEventListener("click", () => { sel.clear(); paint(); });
  fd.querySelector("[data-a=seldel]").addEventListener("click", () => {
    if (sel.size >= el.table.rows.length) { sel.clear(); paint(); return; }
    const keep = el.table.rows.map((_, k) => k).filter((k) => !sel.has(k));
    el.table.rows = keep.map((k) => el.table.rows[k]);
    if (Array.isArray(el.pieColors)) el.pieColors = keep.map((k) => el.pieColors[k]);
    sel.clear();
    changed(el); reselect(el);
  });
}

/** 横向きにしたとき、軸の名前も入れ替える（値の軸の名前を、値の軸の側に）。 */
function swapAxisLabels(el) {
  [el.xLabel, el.yLabel] = [el.yLabel ?? "", el.xLabel ?? ""];
}

/** 数の列を系列にする。見出しが「誤差」「SD」などの列は、すぐ左の系列の誤差（±）にする。 */
function seriesOf(numeric, xCol, headers, isErr) {
  const out = [];
  numeric.forEach((v, c) => {
    if (!v || c === xCol) return;
    if (isErr(headers[c]) && out.length && out.at(-1).errCol < 0) { out.at(-1).errCol = c; return; }
    out.push({ col: c, color: PALETTE[out.length % PALETTE.length], errCol: -1, fit: false });
  });
  return out;
}

export function statchartFields(sec, el, add, changed) {
  const u = P();
  const k = el.chartKind;
  const hd = el.table.headers;
  const colOpts = (v, { none = false, numOnly = false } = {}) => `${none ? `<option value="-1" ${v < 0 ? "selected" : ""}>なし</option>` : ""}${hd.map((h, c) => {
    const isNum = el.table.rows.some((r) => cellNum(r[c]) !== null);
    return `<option value="${c}" ${v === c ? "selected" : ""} ${numOnly && !isNum ? "disabled" : ""}>${escapeHtml(h || `列 ${c + 1}`)}</option>`;
  }).join("")}`;

  // ---- 種類
  const fk = add("グラフの種類", `<div class="seg wrap" data-k="kind">${STAT_KINDS.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="field-note">種類を変えても、データの表はそのまま使います（列の使い方は、種類に合わせて決め直します）。</div>`, { top: true });
  fk.querySelector("[data-k=kind]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b || b.dataset.v === el.chartKind) return;
    el.chartKind = b.dataset.v;
    autoAssign(el);
    changed(el); reselect(el);
  });

  // ---- データの表
  const fd = add("データ", `<div class="stat-table"><table class="table-grid"><thead><tr><th></th>${hd.map((h, c) => `<th><input data-h="${c}" value="${escapeHtml(h)}" spellcheck="false"><button type="button" class="small" data-delcol="${c}" title="この列を消す" ${hd.length <= 1 ? "disabled" : ""}>×</button></th>`).join("")}</tr></thead>
      <tbody>${el.table.rows.map((r, i) => `<tr data-row="${i}"><th class="rh ${selOf(el).has(i) ? "sel" : ""}" data-row="${i}" title="押して選ぶ（Shift で範囲、Ctrl で追加）。ドラッグで行を移動">${i + 1}</th>${r.map((v, c) => `<td><input data-r="${i}" data-c="${c}" value="${escapeHtml(v)}" spellcheck="false" class="${String(v).trim() && cellNum(v) === null ? "txt" : ""}"></td>`).join("")}<td><button type="button" class="small" data-delrow="${i}" title="この行を消す" ${el.table.rows.length <= 1 ? "disabled" : ""}>×</button></td></tr>`).join("")}</tbody></table></div>
    <div class="row"><button type="button" class="small" data-a="addrow">＋ 行</button><button type="button" class="small" data-a="addcol">＋ 列</button><span class="hint">${el.table.rows.length} 行 × ${hd.length} 列。1 行目は見出し（系列・箱の名前になります）</span></div>
    <div class="row" data-k="selbar" ${selOf(el).size ? "" : "hidden"}><span class="hint" data-k="selinfo">${selOf(el).size} 行を選んでいます。</span><button type="button" class="small" data-a="selup">↑</button><button type="button" class="small" data-a="seldown">↓</button><button type="button" class="small" data-a="seldel">選んだ行を消す</button><button type="button" class="small" data-a="selnone">選ぶのをやめる</button></div>
    <div class="field-note">行番号を押して行を選び（Shift で範囲、Ctrl・⌘ で追加）、行番号をつかんで上下にドラッグすると、選んだ行をその位置へ移せます。</div>
    <details class="csv"><summary>CSV・表計算からの貼り付け</summary>
      <textarea data-k="csv" rows="5" spellcheck="false" placeholder="例）&#10;x,y&#10;1,2.3&#10;2,4.1&#10;（Excel などで選んだ範囲をコピーして、そのまま貼り付けても使えます）"></textarea>
      <label class="row"><input type="checkbox" data-k="hdr" checked> 1 行目を見出しにする</label>
      <div class="row"><button type="button" class="small" data-a="csv">表を置き換える</button><button type="button" class="small" data-a="csvadd">下に足す</button><button type="button" class="small" data-a="copy">今の表を CSV でコピー</button></div>
    </details>`, { top: true });
  const t = el.table;
  fd.querySelectorAll("[data-h]").forEach((inp) => inp.addEventListener("change", () => { t.headers[Number(inp.dataset.h)] = inp.value; changed(el); reselect(el); }));
  fd.querySelectorAll("tbody input[data-r]").forEach((inp) => inp.addEventListener("change", () => {
    t.rows[Number(inp.dataset.r)][Number(inp.dataset.c)] = inp.value.trim();
    inp.classList.toggle("txt", !!inp.value.trim() && cellNum(inp.value) === null);
    changed(el);
  }));
  // 表計算のように、Enter で下のセルへ（最後の行なら行を足す）
  fd.querySelectorAll("tbody input[data-r]").forEach((inp) => inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const r = Number(inp.dataset.r), c = Number(inp.dataset.c);
    const next = fd.querySelector(`tbody input[data-r="${r + 1}"][data-c="${c}"]`);
    if (next) { next.focus(); next.select(); } else { inp.blur(); t.rows.push(hd.map(() => "")); changed(el); setTimeout(() => { select(el.id); setTimeout(() => document.querySelector(`#props .stat-table input[data-r="${r + 1}"][data-c="${c}"]`)?.focus(), 120); }, 50); }
  }));
  // セルに複数行・複数列を貼り付けたら、その位置から表に広げる
  fd.querySelectorAll("tbody input[data-r]").forEach((inp) => inp.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = parseCsv(text), r0 = Number(inp.dataset.r), c0 = Number(inp.dataset.c);
    rows.forEach((row, i) => {
      while (t.rows.length <= r0 + i) t.rows.push(hd.map(() => ""));
      row.forEach((v, j) => {
        if (c0 + j >= t.headers.length) { t.headers.push(`列 ${t.headers.length + 1}`); t.rows.forEach((rr) => rr.push("")); }
        t.rows[r0 + i][c0 + j] = v;
      });
    });
    capTable(t);
    changed(el); reselect(el);
  }));
  bindRowDrag(fd, el, changed);
  fd.querySelectorAll("[data-delrow]").forEach((b) => b.addEventListener("click", () => { t.rows.splice(Number(b.dataset.delrow), 1); el.pieColors?.splice(Number(b.dataset.delrow), 1); selOf(el).clear(); changed(el); reselect(el); }));
  fd.querySelectorAll("[data-delcol]").forEach((b) => b.addEventListener("click", () => {
    const c = Number(b.dataset.delcol);
    t.headers.splice(c, 1); t.rows.forEach((r) => r.splice(c, 1));
    const fix = (v) => (v === c ? -1 : v > c ? v - 1 : v);
    el.xCol = Math.max(0, fix(el.xCol)); el.valueCol = Math.max(0, fix(el.valueCol));
    el.series = (el.series ?? []).filter((s) => s.col !== c).map((s) => ({ ...s, col: fix(s.col), errCol: fix(s.errCol) }));
    el.boxCols = (el.boxCols ?? []).filter((s) => s.col !== c).map((s) => ({ ...s, col: fix(s.col) }));
    changed(el); reselect(el);
  }));
  fd.querySelector("[data-a=addrow]").addEventListener("click", () => { t.rows.push(hd.map(() => "")); capTable(t); changed(el); reselect(el); });
  fd.querySelector("[data-a=addcol]").addEventListener("click", () => { t.headers.push(`列 ${hd.length + 1}`); t.rows.forEach((r) => r.push("")); changed(el); reselect(el); });
  const fromCsv = (append) => {
    const rows = parseCsv(fd.querySelector("[data-k=csv]").value);
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const useHdr = fd.querySelector("[data-k=hdr]").checked;
    if (append) {
      const body = (useHdr ? rows.slice(1) : rows).map(pad);
      while (t.headers.length < width) { t.headers.push(`列 ${t.headers.length + 1}`); t.rows.forEach((r) => r.push("")); }
      t.rows.push(...body.map((r) => [...r, ...Array(t.headers.length - r.length).fill("")]));
    } else {
      t.headers = useHdr ? pad(rows[0]).map((h, i) => h || `列 ${i + 1}`) : Array.from({ length: width }, (_, i) => `列 ${i + 1}`);
      t.rows = (useHdr ? rows.slice(1) : rows).map(pad);
      if (!t.rows.length) t.rows = [t.headers.map(() => "")];
    }
    capTable(t);
    if (!append) autoAssign(el, { labels: true });
    changed(el); reselect(el);
  };
  fd.querySelector("[data-a=csv]").addEventListener("click", () => fromCsv(false));
  fd.querySelector("[data-a=csvadd]").addEventListener("click", () => fromCsv(true));
  fd.querySelector("[data-a=copy]").addEventListener("click", async () => {
    const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = [t.headers, ...t.rows].map((r) => r.map(q).join(",")).join("\n");
    try { await navigator.clipboard.writeText(csv); } catch { fd.querySelector("[data-k=csv]").value = csv; }
  });

  // ---- 列の使い方
  if (k === "scatter" || k === "line" || k === "bar" || k === "stacked") {
    const xl = k === "bar" || k === "stacked" ? "分類（横に並べる名前）の列" : "横軸（x）の列";
    const canErr = k !== "stacked", canFit = k === "scatter" || k === "line";
    const fc = add("列の使い方", `<div class="row"><span class="unit">${xl}</span><select data-k="xc">${colOpts(el.xCol, { numOnly: k === "scatter" || k === "line" })}</select></div>
      <div class="stat-series">${el.series.map((s, i) => `<div class="ser" data-i="${i}">
        <div class="row"><span class="unit">系列 ${i + 1}</span><select data-k="col">${colOpts(s.col, { numOnly: true })}</select><input type="color" data-k="color" value="${s.color.toLowerCase()}"><button type="button" class="small" data-a="del" title="この系列を外す" ${el.series.length <= 1 ? "disabled" : ""}>×</button></div>
        ${canErr || canFit ? `<div class="row">${canErr ? `<span class="unit">誤差（±）</span><select data-k="err">${colOpts(s.errCol, { none: true, numOnly: true })}</select>` : ""}${canFit ? `<label><input type="checkbox" data-k="fit" ${s.fit ? "checked" : ""}> 回帰直線</label>` : ""}</div>` : ""}
      </div>`).join("")}</div>
      <div class="row"><button type="button" class="small" data-a="addser">＋ 系列</button></div>
      ${canFit ? `<label class="row"><input type="checkbox" data-k="fl" ${el.fitLabel ? "checked" : ""}> 回帰直線の式と決定係数 R² を書く</label>` : ""}
      ${k === "bar" || k === "stacked" ? `<div class="stat-layout">
        <label class="row"><input type="checkbox" data-k="hz" ${el.horizontal ? "checked" : ""}> 横向きにする（横棒グラフ。1 つ目の分類がいちばん上）</label>
        ${k === "stacked" ? `<label class="row"><input type="checkbox" data-k="pc" ${el.percent ? "checked" : ""}> 分類ごとに 100% にそろえる（構成比。横向きにすると帯グラフ）</label>` : ""}
        <label class="row"><input type="checkbox" data-k="sl" ${el.segLabels ? "checked" : ""}> 棒の中に値を書く${k === "stacked" ? "（100% のときは割合）" : ""}</label>
        ${el.segLabels ? `<label class="row" style="margin-left:18px"><input type="checkbox" data-k="so" ${el.segOutside !== false ? "checked" : ""}> 入りきらない値は、棒の外に書く${k === "stacked" ? "（引き出し線を付けて、重ならないように並べる）" : "（棒の先に）"}</label>` : ""}
        ${k === "stacked" && !(el.percent && el.horizontal) ? `<div class="row"><button type="button" class="small" data-a="band">帯グラフにする（100%・横向き・割合を書く）</button></div>` : ""}
      </div>` : ""}
      <div class="field-note">${canFit ? "回帰直線は最小二乗法（y = ax + b）。" : ""}${canErr ? "誤差の列の値を、点（棒）の上下に ± の長さで描きます（標準偏差・標準誤差など）。" : ""}数でないセル・空欄は飛ばします。</div>`);
    fc.querySelector("[data-k=xc]").addEventListener("change", (e) => { el.xCol = Number(e.target.value); changed(el); });
    fc.querySelectorAll(".stat-series .ser").forEach((tr) => {
      const s = el.series[Number(tr.dataset.i)];
      tr.querySelector("[data-k=col]").addEventListener("change", (e) => { s.col = Number(e.target.value); changed(el); });
      tr.querySelector("[data-k=color]").addEventListener("input", (e) => { s.color = e.target.value.toUpperCase(); changed(el); });
      tr.querySelector("[data-k=err]")?.addEventListener("change", (e) => { s.errCol = Number(e.target.value); changed(el); });
      tr.querySelector("[data-k=fit]")?.addEventListener("change", (e) => { s.fit = e.target.checked; changed(el); });
      tr.querySelector("[data-a=del]").addEventListener("click", () => { el.series.splice(Number(tr.dataset.i), 1); changed(el); reselect(el); });
    });
    fc.querySelector("[data-a=addser]").addEventListener("click", () => {
      const used = new Set([el.xCol, ...el.series.map((s) => s.col)]);
      const col = hd.findIndex((_, c) => !used.has(c));
      el.series.push({ col: col >= 0 ? col : Math.min(1, hd.length - 1), color: PALETTE[el.series.length % PALETTE.length], errCol: -1, fit: false });
      changed(el); reselect(el);
    });
    fc.querySelector("[data-k=fl]")?.addEventListener("change", (e) => { el.fitLabel = e.target.checked; changed(el); });
    fc.querySelector("[data-k=hz]")?.addEventListener("change", (e) => { el.horizontal = e.target.checked; swapAxisLabels(el); changed(el); reselect(el); });
    fc.querySelector("[data-k=pc]")?.addEventListener("change", (e) => { el.percent = e.target.checked; el.decimals = e.target.checked ? 0 : el.decimals; changed(el); reselect(el); });
    fc.querySelector("[data-k=sl]")?.addEventListener("change", (e) => { el.segLabels = e.target.checked; changed(el); reselect(el); });
    fc.querySelector("[data-k=so]")?.addEventListener("change", (e) => { el.segOutside = e.target.checked; changed(el); });
    fc.querySelector("[data-a=band]")?.addEventListener("click", () => {
      if (!el.horizontal) swapAxisLabels(el);
      Object.assign(el, { percent: true, horizontal: true, segLabels: true, decimals: 0, autoY: true });
      changed(el); reselect(el);
    });
  } else if (k === "hist") {
    const mode = el.binWidth > 0 ? "width" : el.bins > 0 ? "count" : "auto";
    const fc = add("列の使い方・区間", `<div class="row"><span class="unit">値の列</span><select data-k="vc">${colOpts(el.valueCol, { numOnly: true })}</select><span class="unit">色</span><input type="color" data-k="color" value="${(el.series[0]?.color ?? PALETTE[0]).toLowerCase()}"></div>
      <div class="row"><span class="unit">区間</span><select data-k="bm"><option value="auto" ${mode === "auto" ? "selected" : ""}>自動（スタージェスの公式）</option><option value="count" ${mode === "count" ? "selected" : ""}>区間の数を決める</option><option value="width" ${mode === "width" ? "selected" : ""}>区間の幅を決める</option></select>
        ${mode === "count" ? num("bins", el.bins, { step: 1, min: 1 }) : mode === "width" ? num("bw", el.binWidth, { step: "any", min: 0 }) : ""}</div>
      <label class="row"><input type="checkbox" data-k="den" ${el.density ? "checked" : ""}> 縦軸を度数でなく密度にする（面積の合計が 1）</label>
      <div class="row"><span class="unit">区間の端</span><select data-k="bc" style="width:auto"><option value="left" ${el.binClosed !== "right" ? "selected" : ""}>以上・未満（教科書の度数分布表）</option><option value="right" ${el.binClosed === "right" ? "selected" : ""}>超・以下（Excel の FREQUENCY・分析ツール）</option></select></div>
      <div class="field-note">「以上・未満」は最後の区間だけ右端の値も、「超・以下」は最初の区間だけ左端の値も入れます。区間の端にちょうど値があると、度数が変わります。</div>`);
    fc.querySelector("[data-k=vc]").addEventListener("change", (e) => { el.valueCol = Number(e.target.value); changed(el); });
    fc.querySelector("[data-k=color]").addEventListener("input", (e) => { if (!el.series.length) el.series.push({ col: 0, color: PALETTE[0], errCol: -1, fit: false }); el.series[0].color = e.target.value.toUpperCase(); changed(el); });
    fc.querySelector("[data-k=bm]").addEventListener("change", (e) => {
      const v = e.target.value;
      el.bins = v === "count" ? (el.bins || 6) : 0;
      el.binWidth = v === "width" ? (el.binWidth || 10) : 0;
      changed(el); reselect(el);
    });
    fc.querySelector("[data-k=bins]")?.addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1) { el.bins = v; changed(el); } });
    fc.querySelector("[data-k=bw]")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.binWidth = v; changed(el); } });
    fc.querySelector("[data-k=den]").addEventListener("change", (e) => { el.density = e.target.checked; changed(el); });
    fc.querySelector("[data-k=bc]").addEventListener("change", (e) => { el.binClosed = e.target.value === "right" ? "right" : "left"; changed(el); });
  } else if (k === "box") {
    const on_ = new Map((el.boxCols ?? []).map((b) => [b.col, b]));
    const fc = add("箱にする列", `<table class="table-grid"><tbody>${hd.map((h, c) => `<tr data-c="${c}"><td><label class="row"><input type="checkbox" data-k="on" ${on_.has(c) ? "checked" : ""}> ${escapeHtml(h || `列 ${c + 1}`)}</label></td><td><input type="color" data-k="color" value="${(on_.get(c)?.color ?? PALETTE[c % PALETTE.length]).toLowerCase()}"></td></tr>`).join("")}</tbody></table>
      <div class="row"><span class="unit">四分位数の求め方</span><select data-k="qm" style="width:auto"><option value="textbook" ${el.quartile !== "linear" ? "selected" : ""}>教科書（中央値で前半・後半に分ける）</option><option value="linear" ${el.quartile === "linear" ? "selected" : ""}>線形補間（Excel の QUARTILE.INC と同じ）</option></select></div>
      <div class="row"><span class="unit">ひげの長さ（IQR の何倍まで）</span>${num("wh", el.whisker, { step: 0.5, min: 0 })}</div>
      <div class="field-note">箱は第 1 四分位数〜第 3 四分位数、中の線は中央値。教科書の求め方は、中央値でデータを前半・後半に分け（個数が奇数なら中央値は除く）、それぞれの中央値を第 1・第 3 四分位数にします。箱から「IQR × この倍率」より外の値は、外れ値として点で描きます（0 にすると、ひげは最小値・最大値まで）。</div>`);
    fc.querySelectorAll("tbody tr").forEach((tr) => {
      const c = Number(tr.dataset.c);
      tr.querySelector("[data-k=on]").addEventListener("change", (e) => {
        if (e.target.checked) el.boxCols.push({ col: c, color: tr.querySelector("[data-k=color]").value.toUpperCase() });
        else el.boxCols = el.boxCols.filter((b) => b.col !== c);
        el.boxCols.sort((a, b) => a.col - b.col);
        changed(el);
      });
      tr.querySelector("[data-k=color]").addEventListener("input", (e) => { const b = el.boxCols.find((x) => x.col === c); if (b) { b.color = e.target.value.toUpperCase(); changed(el); } });
    });
    fc.querySelector("[data-k=wh]").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.whisker = v === 0 ? 1e6 : v; changed(el); } });
    fc.querySelector("[data-k=qm]").addEventListener("change", (e) => { el.quartile = e.target.value === "linear" ? "linear" : "textbook"; changed(el); });
  } else if (k === "pie") {
    const fc = add("列の使い方", `<div class="row"><span class="unit">名前の列</span><select data-k="xc">${colOpts(el.xCol)}</select><span class="unit">値の列</span><select data-k="vc">${colOpts(el.valueCol, { numOnly: true })}</select></div>
      <div class="pie-colors">${el.table.rows.map((r, i) => `<label class="row"><input type="color" data-i="${i}" value="${(el.pieColors[i] ?? PALETTE[i % PALETTE.length]).toLowerCase()}"> ${escapeHtml(r[el.xCol] ?? "")}</label>`).join("")}</div>
      <label class="row"><input type="checkbox" data-k="pct" ${el.showPercent ? "checked" : ""}> 割合（%）を書く</label>
      <label class="row"><input type="checkbox" data-k="nm" ${el.showNames ? "checked" : ""}> 名前を書く</label>
      <div class="row"><span class="unit">真ん中の穴（ドーナツ）</span><input type="range" data-k="dn" min="0" max="80" step="5" value="${Math.round(el.donut * 100)}"></div>
      <div class="row"><span class="unit">始まりの向き</span>${num("sa", el.startAngle, { step: 15 })}<span class="unit">度（90 = 真上から、時計回りに並べる）</span></div>`);
    fc.querySelector("[data-k=xc]").addEventListener("change", (e) => { el.xCol = Number(e.target.value); changed(el); reselect(el); });
    fc.querySelector("[data-k=vc]").addEventListener("change", (e) => { el.valueCol = Number(e.target.value); changed(el); });
    fc.querySelectorAll(".pie-colors [data-i]").forEach((inp) => inp.addEventListener("input", () => { el.pieColors[Number(inp.dataset.i)] = inp.value.toUpperCase(); changed(el); }));
    fc.querySelector("[data-k=pct]").addEventListener("change", (e) => { el.showPercent = e.target.checked; changed(el); });
    fc.querySelector("[data-k=nm]").addEventListener("change", (e) => { el.showNames = e.target.checked; changed(el); });
    fc.querySelector("[data-k=dn]").addEventListener("change", (e) => { el.donut = Number(e.target.value) / 100; changed(el); });
    fc.querySelector("[data-k=sa]").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el.startAngle = v; changed(el); } });
  }

  // ---- 軸
  if (k !== "pie") {
    const xnum = k === "scatter" || k === "line" || k === "hist";
    const fa = add("軸", `${xnum ? `<label class="row"><input type="checkbox" data-k="ax" ${el.autoX ? "checked" : ""}> 横軸の範囲を自動で決める</label>
      <div class="row" ${el.autoX ? "hidden" : ""}><span class="unit">横 最小</span>${num("xMin", el.xMin)}<span class="unit">最大</span>${num("xMax", el.xMax)}<span class="unit">目盛り</span>${num("xStep", el.xStep, { min: 0 })}</div>` : ""}
      <label class="row"><input type="checkbox" data-k="ay" ${el.autoY ? "checked" : ""}> ${el.horizontal && (k === "bar" || k === "stacked") ? "値の軸（横軸）" : "縦軸"}の範囲を自動で決める${k === "stacked" && el.percent ? "（100% のときは 0〜100）" : ""}</label>
      <div class="row" ${el.autoY ? "hidden" : ""}><span class="unit">縦 最小</span>${num("yMin", el.yMin)}<span class="unit">最大</span>${num("yMax", el.yMax)}<span class="unit">目盛り</span>${num("yStep", el.yStep, { min: 0 })}</div>
      <div class="row"><span class="unit">横軸の名前</span><input data-k="xl" value="${escapeHtml(el.xLabel)}" spellcheck="false" style="flex:1"></div>
      <div class="row"><span class="unit">縦軸の名前</span><input data-k="yl" value="${escapeHtml(el.yLabel)}" spellcheck="false" style="flex:1"></div>
      <label class="row"><input type="checkbox" data-k="grid" ${el.grid ? "checked" : ""}> 横の目盛り線を引く</label>
      <div class="field-note">軸・分類の名前は LaTeX の文章（Tex）です（日本語も書け、数式は $x^2$ のように $ で囲みます）。</div>`);
    const q = (s) => fa.querySelector(`[data-k=${s}]`);
    q("ax")?.addEventListener("change", (e) => { el.autoX = e.target.checked; changed(el); reselect(el); });
    q("ay").addEventListener("change", (e) => { el.autoY = e.target.checked; changed(el); reselect(el); });
    for (const key of ["xMin", "xMax", "xStep", "yMin", "yMax", "yStep"]) {
      q(key)?.addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { el[key] = v; changed(el); } });
    }
    q("xl").addEventListener("change", (e) => { el.xLabel = e.target.value; changed(el); });
    q("yl").addEventListener("change", (e) => { el.yLabel = e.target.value; changed(el); });
    q("grid").addEventListener("change", (e) => { el.grid = e.target.checked; changed(el); });
  }

  // ---- 大きさ・見た目
  const fs = add("大きさ・見た目", `<div class="row"><span class="unit">横</span>${num("w", r2(el.width / u), { step: 0.5, min: 0.1 })}<span class="unit">縦</span>${num("h", r2(el.height / u), { step: 0.5, min: 0.1 })}</div>
    ${["scatter", "line", "box"].includes(k) ? `<div class="row"><span class="unit">点の大きさ</span>${num("ds", el.dotSize, { step: 0.01, min: 0.005 })}<span class="unit">線の太さ</span>${num("lw", el.lineWidth, { step: 0.5, min: 0 })}</div>` : ""}
    ${["bar", "stacked", "box"].includes(k) ? `<div class="row"><span class="unit">${k === "box" ? "箱" : "棒"}の幅</span><input type="range" data-k="bw" min="5" max="100" step="5" value="${Math.round(el.barWidth * 100)}"></div>` : ""}
    ${["bar", "stacked", "hist", "box", "pie"].includes(k) ? `<div class="row"><span class="unit">塗りの不透明度</span><input type="range" data-k="fo" min="0" max="100" step="5" value="${Math.round(el.fillOpacity * 100)}"></div>` : ""}
    <div class="row"><span class="unit">軸・文字の色</span><input type="color" data-k="ac" value="${el.axisColor.toLowerCase()}"><input class="hex" data-k="ac-hex" value="${el.axisColor}" maxlength="7" spellcheck="false"></div>
    <div class="row"><span class="unit">目盛りの数字</span>${num("ns", el.numSize, { step: 2, min: 4 })}<span class="unit">名前・凡例</span>${num("ls", el.labelSize, { step: 2, min: 4 })}</div>
    ${k !== "hist" && k !== "box" ? `<div class="row"><span class="unit">凡例</span><select data-k="lg"><option value="inside" ${el.legend === "inside" ? "selected" : ""}>グラフの中（空いている角）</option><option value="right" ${el.legend === "right" ? "selected" : ""}>右（グラフの外）</option><option value="top" ${el.legend === "top" ? "selected" : ""}>上（グラフの外）</option><option value="bottom" ${el.legend === "bottom" ? "selected" : ""}>下（グラフの外）</option><option value="none" ${el.legend === "none" ? "selected" : ""}>付けない</option></select></div>` : ""}
    ${["scatter", "line", "pie"].includes(k) || (["bar", "stacked"].includes(k) && el.segLabels) ? `<div class="row"><span class="unit">${k === "pie" ? "割合" : k === "bar" || k === "stacked" ? "棒の中の値" : "式"}の小数点以下</span>${num("dec", el.decimals, { step: 1, min: 0, max: 6 })}<span class="unit">桁まで</span></div>` : ""}
    <div class="field-note">部品は <code>${escapeHtml(el.var)}.axes</code>（座標軸。<code>${escapeHtml(el.var)}.axes.plot(lambda x: …)</code> で関数を重ねられます）、<code>${escapeHtml(el.var)}.parts</code>（点・棒・箱・扇形をデータの順に）、<code>${escapeHtml(el.var)}.series</code>（系列ごと）${k === "scatter" || k === "line" ? `、<code>${escapeHtml(el.var)}.fits</code>（回帰直線）` : ""}、<code>${escapeHtml(el.var)}.legend</code>（凡例）。</div>`);
  const q = (s) => fs.querySelector(`[data-k=${s}]`);
  q("w").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.width = v; changed(el); } });
  q("h").addEventListener("change", (e) => { const v = Number(e.target.value) * u; if (v > 0) { el.height = v; changed(el); } });
  q("ds")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.dotSize = v; changed(el); } });
  q("lw")?.addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0) { el.lineWidth = v; changed(el); } });
  q("bw")?.addEventListener("change", (e) => { el.barWidth = Number(e.target.value) / 100; changed(el); });
  q("fo")?.addEventListener("change", (e) => { el.fillOpacity = Number(e.target.value) / 100; changed(el); });
  q("ac").addEventListener("input", (e) => { el.axisColor = e.target.value.toUpperCase(); q("ac-hex").value = el.axisColor; changed(el); });
  q("ac-hex").addEventListener("change", (e) => { const h = normalizeHex(e.target.value); if (h) { el.axisColor = h; q("ac").value = h.toLowerCase(); changed(el); } else e.target.value = el.axisColor; });
  q("ns").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.numSize = v; changed(el); } });
  q("ls").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) { el.labelSize = v; changed(el); } });
  q("lg")?.addEventListener("change", (e) => { el.legend = e.target.value; changed(el); });
  q("dec")?.addEventListener("change", (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0) { el.decimals = v; changed(el); } });
  on("element-resized", (els) => { if (els.includes(el) && document.body.contains(fs)) { q("w").value = r2(el.width / u); q("h").value = r2(el.height / u); } });
}
