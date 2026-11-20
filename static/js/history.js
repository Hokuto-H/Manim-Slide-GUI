// 元に戻す・やり直す（Ctrl+Z / Ctrl+Y）。プロジェクト全体（project.json の中身）の写しを、変更のたびに履歴へ積む。
// 続けて起きる変更（文字の入力・ドラッグなど）は、少し間が空いたところで 1 つにまとめる。

import { emit, on, store, toast } from "./store.js";

const LIMIT = 100;
const WAIT = 400; // ms: この間に続いた変更は 1 つにまとめる
let stack = []; // [{json, slideIndex, selectedIds, focusStepId, label}]
let pos = -1; // いまの状態の位置
let timer = null;
let restoring = false;
let pendingLabel = "";
let restoreFn = null; // 状態を画面に戻す関数（main.js が渡す）

const LABELS = {
  add: "要素の追加", prop: "プロパティの変更", code: "コードの編集", steps: "ステップの変更", slide: "スライドの変更", text: "テキストの編集",
  move: "移動", timeline: "タイムライン", "restore-slide": "スライドを戻す", delete: "削除", paste: "貼り付け", group: "グループ", order: "重なり順", edit: "編集",
  path: "線の編集", layer: "レイヤー", var: "変数名の変更", settings: "プロジェクト設定", align: "整列", template: "テンプレート",
  replace: "置換",
};
let noReset = false; // 画面を描き直すだけ（置換など）: project-loaded で履歴を消さない

/** 画面をすべて描き直す処理の間、履歴を消さない（その変更は、ふつうの変更として履歴に積む）。 */
export async function keepHistory(fn) {
  noReset = true;
  try { return await fn(); } finally { noReset = false; }
}

/** 「元に戻す・やり直す」の履歴の中で使っている、画像・動画・音声のファイルのパス。 */
export function historyPaths() {
  const out = new Set();
  for (const s of stack) {
    for (const m of s.json.matchAll(/"((?:images|clips)\/(?:[^"\\]|\\.)+)"/g)) out.add(JSON.parse(`"${m[1]}"`));
  }
  return [...out];
}

function snap(label = "") {
  return {
    json: JSON.stringify(store.project), slideIndex: store.slideIndex, selectedIds: [...store.selectedIds],
    focusStepId: store.focusStepId, label,
  };
}

/** いまの状態を履歴に積む（直前と同じなら積まない）。 */
function commit() {
  clearTimeout(timer);
  timer = null;
  if (!store.project) return;
  const s = snap(pendingLabel);
  pendingLabel = "";
  if (pos >= 0 && stack[pos].json === s.json) {
    stack[pos] = { ...stack[pos], slideIndex: s.slideIndex, selectedIds: s.selectedIds, focusStepId: s.focusStepId };
    return;
  }
  stack = stack.slice(0, pos + 1);
  stack.push(s);
  if (stack.length > LIMIT) stack.shift();
  pos = stack.length - 1;
  emit("history-changed");
}

export function resetHistory() {
  clearTimeout(timer);
  timer = null;
  stack = store.project ? [snap()] : [];
  pos = stack.length - 1;
  emit("history-changed");
}

export const canUndo = () => pos > 0 || (timer !== null && pos >= 0);
export const canRedo = () => pos < stack.length - 1 && timer === null;

async function go(to) {
  if (to < 0 || to >= stack.length || !restoreFn) return;
  const from = pos;
  pos = to;
  const s = stack[to];
  restoring = true;
  try {
    // 戻した先の状態の、選択・ステップの位置は、戻す前に操作していた所（from 側の記録）を使う方が分かりやすい
    const view = to < from ? stack[from] : s;
    await restoreFn(JSON.parse(s.json), { slideIndex: view.slideIndex, selectedIds: view.selectedIds, focusStepId: view.focusStepId });
  } finally {
    restoring = false;
  }
  const what = (to < from ? stack[from].label : s.label) || "";
  toast(`${to < from ? "元に戻しました" : "やり直しました"}${what ? `（${what}）` : ""}`, "", 1500);
  emit("history-changed");
}

export async function undo() {
  if (timer !== null) commit(); // まとめ待ちの変更を、先に履歴へ
  if (pos > 0) await go(pos - 1);
}

export async function redo() {
  if (timer !== null) return;
  if (pos < stack.length - 1) await go(pos + 1);
}

export function setupHistory(restore) {
  restoreFn = restore;
  on("dirty", (reason) => {
    if (restoring || reason === "loaded" || reason === "saved" || !store.project) return;
    if (!pendingLabel) pendingLabel = LABELS[reason] ?? "";
    clearTimeout(timer);
    timer = setTimeout(commit, WAIT);
    emit("history-changed");
  });
  on("project-loaded", () => { if (!restoring && !noReset) resetHistory(); });
}
