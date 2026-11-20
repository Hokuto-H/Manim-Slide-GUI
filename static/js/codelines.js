// コード（Code）の行を足す・消したとき、そのコードの行を指す動き（行に色の帯・一部分）の行番号を合わせる
//
// 行の対応は、変わる前と後で先頭・末尾から同じ行を数えて決める（間の行が変わった所）。
// 変わった所より後ろの行は、増えた・減った行の数だけずらす。消した行だけを指していた指定は外す。
// コードの行・ステップの中の code_lines[k] は書き換えない（点検で知らせる）。

/** 変わる前と後の行の対応。old の行 i が new の何行目か（消えた行は null）を返す関数と、増えた行の数。 */
export function lineMap(oldCode, newCode) {
  const a = String(oldCode ?? "").split("\n"), b = String(newCode ?? "").split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const oldEnd = a.length - s, newLen = b.length - s - p, delta = b.length - a.length;
  const map = (i) => {
    if (i < p) return i;
    if (i >= oldEnd) return i + delta;
    // 変わった所の中: 新しい側にも同じ位置の行があれば、その行（書き直した行）。無ければ消えた行
    return i - p < newLen ? i : null;
  };
  return { map, delta, at: p, oldLines: a.length, newLines: b.length };
}

/** "2-4, 6" → [2, 3, 4, 6] */
function parseLines(s) {
  const out = [];
  for (let part of String(s ?? "").replace(/、/g, ",").split(",")) {
    part = part.trim();
    if (!part) continue;
    const m = part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (m) { for (let k = Number(m[1]); k <= Number(m[2]) && out.length < 10000; k++) out.push(k); }
    else if (/^-?\d+$/.test(part)) out.push(Number(part));
  }
  return out;
}

/** [2, 3, 4, 6] → "2-4, 6" */
function formatLines(nums) {
  const xs = [...new Set(nums)].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    out.push(j > i ? `${xs[i]}-${xs[j]}` : `${xs[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** 一部分の番号の並びのうち、行を指す段（[1, k]: 行番号、[2, k]: 行。行番号が無ければ [1, k] が行）。 */
function isLinePath(q) { return Array.isArray(q) && q.length >= 2 && (q[0] === 1 || q[0] === 2); }

/**
 * コードの要素 el の行が old → new に変わったときの、行番号の付け直しの案。
 * 返す: { count: 直す動きの数, dropped: 消えた行だけを指していた動きの数, codeRefs: code_lines[k] の書いてあるステップ・行の数, apply() }
 */
export function planCodeLineShift(slide, el, oldCode, newCode) {
  const { map, delta } = lineMap(oldCode, newCode);
  const from = Number(el.lineFrom ?? 1) || 1;
  const fixes = [];
  let dropped = 0;
  let codeRefs = 0;
  const re = new RegExp(`(?<![A-Za-z0-9_])${String(el.var ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.code_lines\\[`);
  for (const st of slide?.steps ?? []) {
    if (st.mode === "code" && re.test(st.code || "")) codeRefs++;
    for (const r of st.rows ?? []) {
      if (r.kind === "code" && re.test(r.code || "")) codeRefs++;
      if (r.kind !== "anim" || r.target !== el.id) continue;
      if (r.anim === "CodeHighlight" && String(r.params?.lines ?? "").trim()) {
        const before = parseLines(r.params.lines);
        const after = before.map((n) => map(n - from)).filter((i) => i !== null).map((i) => i + from);
        const s = formatLines(after);
        if (s !== formatLines(before)) {
          if (!after.length) dropped++;
          fixes.push(() => { r.params = { ...r.params, lines: s }; });
        }
      }
      const paths = r.part?.paths;
      if (Array.isArray(paths) && paths.some(isLinePath)) {
        const next = [];
        for (const q of paths) {
          if (!isLinePath(q)) { next.push(q); continue; }
          const k = map(q[1]);
          if (k !== null) next.push([q[0], k, ...q.slice(2)]);
        }
        if (JSON.stringify(next) !== JSON.stringify(paths)) {
          if (!next.length) dropped++;
          fixes.push(() => { if (next.length) r.part = { ...r.part, paths: next }; else delete r.part; });
        }
      }
    }
  }
  return { count: fixes.length, dropped, codeRefs, delta, apply: () => fixes.forEach((f) => f()) };
}

/** コードを直す前に、行番号を指す動きを合わせるかを聞いて、合わせる。返す: 知らせる文（無ければ ""）。 */
export function confirmCodeLineShift(slide, el, oldCode, newCode) {
  const plan = planCodeLineShift(slide, el, oldCode, newCode);
  const notes = [];
  if (plan.count) {
    const how = plan.delta > 0 ? `コードが ${plan.delta} 行増えた` : plan.delta < 0 ? `コードが ${-plan.delta} 行減った` : "コードの行が変わった";
    const drop = plan.dropped ? `\n（そのうち ${plan.dropped} 個は、消した行だけを指していたので、指定が外れます）` : "";
    if (confirm(`${how}ので、このコードの行を指す動き（行に色の帯・一部分）が ${plan.count} 個ずれます。\n同じ行を指すように、行番号を合わせますか？${drop}`)) {
      plan.apply();
      notes.push(`行を指す動き ${plan.count} 個の行番号を合わせました。`);
    }
  }
  if (plan.codeRefs && plan.delta) notes.push(`コードの中の「${el.var}.code_lines[…]」（${plan.codeRefs} か所）は書き換えていません。行がずれていないか確かめてください。`);
  return notes.join(" ");
}
