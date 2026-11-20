"""数式（MathTex）の複数行（\\\\ で改行）の揃え方。プレビュー（static/js/mathalign.js）と同じ規則。

- いちばん外側に & があれば、利用者が揃える位置を決めているので align* のまま（& の位置で揃う）。
- & が無く、いちばん外側に改行（\\\\）があるとき:
  center → gather*（各行を中央揃え）、right → align*（Manim の既定。右揃え）、
  left → align* で各行の先頭に & を入れる（左揃え）。
- 改行が無ければ何もしない（Manim の既定の align* と同じ）。
"""

from __future__ import annotations

import re

_ENV = re.compile(r"\\(begin|end)\s*\{[^}]*\}")


def scan(latex: str) -> tuple[list[tuple[int, int]], bool]:
    """いちばん外側（{} や \\begin…\\end の外）の改行 \\\\（直後の [長さ] を含む）の位置の一覧と、
    いちばん外側に & があるか（行列の中の & は数えない）。"""
    out = []
    amp = False
    brace = env = 0
    i, n = 0, len(latex)
    while i < n:
        c = latex[i]
        if c == "%":  # コメントは行末まで飛ばす
            j = latex.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "\\":
            m = _ENV.match(latex, i)
            if m:
                env += 1 if m.group(1) == "begin" else -1
                i = m.end()
                continue
            if latex.startswith("\\\\", i):
                end = i + 2
                if brace == 0 and env == 0:
                    m2 = re.match(r"\s*\[[^\]]*\]", latex[end:])
                    if m2:
                        end += m2.end()
                    out.append((i, end))
                i = end
                continue
            i += 2  # \{ \} \% などの1文字の命令
            continue
        if c == "&" and brace == 0 and env == 0:
            amp = True
        elif c == "{":
            brace += 1
        elif c == "}":
            brace = max(0, brace - 1)
        i += 1
    return out, amp


def math_layout(latex: str, align: str) -> tuple[str, str | None]:
    """(MathTex に渡す文字列, tex_environment)。tex_environment が None なら Manim の既定（align*）。"""
    breaks, amp = scan(latex)
    if amp or not breaks:
        return latex, None
    if align == "right":
        return latex, None
    if align == "left":
        parts, last = ["&"], 0
        for a, b in breaks:
            parts.append(latex[last:b])
            parts.append("&")
            last = b
        parts.append(latex[last:])
        return "".join(parts), None
    return latex, "gather*"
