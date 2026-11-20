// 数の欄の矢印（▲▼）の刻みを、きりのよい数にそろえる。
// HTML の数の欄は、最小値（min）を刻みの起点にするため、min="0.01" step="0.25" だと 0.01 → 0.26 → 0.51 と進む。
// 最小値が刻みの倍数でない欄は、起点を 0 にし（min="0"）、元の最小値より小さくなったら元の最小値に戻す。

const fixInput = (el) => {
  if (!(el instanceof HTMLInputElement) || el.type !== "number" || el.dataset.min0 !== undefined) return;
  const min = parseFloat(el.min), step = parseFloat(el.step);
  if (!(min > 0) || !(step > 0)) return;
  const k = min / step;
  if (Math.abs(k - Math.round(k)) < 1e-9) return; // 最小値が刻みの倍数なら、そのままでよい
  el.dataset.min0 = String(min);
  el.min = "0";
};

const scan = (root) => {
  if (root instanceof HTMLInputElement) fixInput(root);
  root.querySelectorAll?.('input[type="number"][min]').forEach(fixInput);
};

export function setupNumberSteps() {
  scan(document.body);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  // 元の最小値より小さくなったら戻す（ほかの処理より先に、取り込む段階で直す）
  const clamp = (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.min0 === undefined || el.value === "") return;
    const min0 = Number(el.dataset.min0);
    if (Number(el.value) < min0) el.value = String(min0);
  };
  document.addEventListener("input", clamp, true);
  document.addEventListener("change", clamp, true);
}
