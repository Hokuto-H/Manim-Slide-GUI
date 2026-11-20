// 数式の複数行（\\ で改行）の揃え方。書き出し（app/mathalign.py）と同じ規則で、プレビュー用の環境で包む。

function scan(latex) {
  const out = [];
  let amp = false;
  let brace = 0, env = 0, i = 0;
  const n = latex.length;
  const envRe = /\\(begin|end)\s*\{[^}]*\}/y;
  while (i < n) {
    const c = latex[i];
    if (c === "%") {
      const j = latex.indexOf("\n", i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === "\\") {
      envRe.lastIndex = i;
      const m = envRe.exec(latex);
      if (m) {
        env += m[1] === "begin" ? 1 : -1;
        i = envRe.lastIndex;
        continue;
      }
      if (latex.startsWith("\\\\", i)) {
        let end = i + 2;
        if (brace === 0 && env === 0) {
          const m2 = /^\s*\[[^\]]*\]/.exec(latex.slice(end));
          if (m2) end += m2[0].length;
          out.push([i, end]);
        }
        i = end;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "&" && brace === 0 && env === 0) amp = true;
    else if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    i++;
  }
  return { breaks: out, amp };
}

/** いちばん外側に & があるか（& の位置で揃える数式）。 */
export const hasAmp = (latex) => scan(latex || "").amp;
/** いちばん外側に改行があるか（複数行の数式）。 */
export const hasLineBreak = (latex) => scan(latex || "").breaks.length > 0;

/** プレビューの MathJax に渡す文字列（Manim と同じ環境で包む）。 */
export function previewLatex(latex, align = "center") {
  latex = latex || "";
  const { breaks, amp } = scan(latex);
  if (amp) return `\\begin{align*}${latex}\\end{align*}`;
  if (!breaks.length) return latex;
  if (align === "right") return `\\begin{align*}${latex}\\end{align*}`;
  if (align === "left") {
    let s = "&", last = 0;
    for (const [, b] of breaks) { s += latex.slice(last, b) + "&"; last = b; }
    return `\\begin{align*}${s}${latex.slice(last)}\\end{align*}`;
  }
  return `\\begin{gather*}${latex}\\end{gather*}`;
}
