"""数式の一部に色を付ける（Manim の tex_to_color_map と同じ考え）。

el.colorMap = [{"tex": "x", "color": "#FC6255"}, ...] の「tex」を数式の LaTeX の中から探し、見つかった所をすべて
{\\color[HTML]{FC6255} x} で囲む（xcolor の色。MathTex は color= を渡しても、LaTeX で付けた色を残す）。
仮表示（MathJax）にも同じ書き換えをする（static/js/texcolor.js は、この関数と同じ動きにする）。

探し方:
- LaTeX を、コマンド（\\alpha など）・1 文字ずつに分けて、空白を除いて比べる（「x + 1」と「x+1」は同じ）。
- 色・環境の名前・長さなど、数式の中身でない引数（\\begin{…}・\\color{…}・\\hspace{…} など）の中は探さない。
- \\left( の「(」、^ や _ のすぐ後の 2 文字以上、\\frac12 の「12」など、囲むと意味が変わる所は飛ばす。
- 長い文字列を先に探し、重なる所は先に見つけたほうを使う。
"""

from __future__ import annotations

import re
from typing import Any

# 中身を探さない引数（コマンド名 → 中かっこの引数の数）。直後の [ … ] も探さない
SKIP_ARGS = {
    "begin": 1, "end": 1, "color": 1, "textcolor": 1, "colorbox": 1, "fcolorbox": 2, "pagecolor": 1, "definecolor": 3,
    "hspace": 1, "vspace": 1, "label": 1, "ref": 1, "eqref": 1, "rule": 2, "raisebox": 1, "includegraphics": 1,
    "setlength": 2, "kern": 0, "hskip": 0, "vskip": 0, "mkern": 0, "mskip": 0, "enclose": 1, "cssId": 1, "class": 1,
    "style": 1, "href": 1, "url": 1, "phantom": 0, "operatorname": 0,
}
# 次の 1 文字（区切りの記号）を探さないコマンド
DELIM_CMDS = {"left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "biggl", "biggr",
              "Biggl", "Biggr", "bigm", "Bigm", "biggm", "Biggm"}
# \begin{…} のあとに、列の指定（{cc} など）を取る環境
ARRAY_ENVS = {"array", "tabular", "alignat", "alignat*", "subarray", "alignedat"}
_TOKEN = re.compile(r"\\[A-Za-z]+\*?|\\.|%[^\n]*|\s+|.", re.S)


def tokenize(s: str) -> list[str]:
    return _TOKEN.findall(s)


def _is_space(t: str) -> bool:
    return t.isspace()


def _group_end(toks: list[str], i: int) -> int:
    """toks[i] が "{" のとき、対になる "}" の位置（無ければ最後）。"""
    depth = 0
    for j in range(i, len(toks)):
        if toks[j] == "{":
            depth += 1
        elif toks[j] == "}":
            depth -= 1
            if depth == 0:
                return j
    return len(toks) - 1


def _locked(toks: list[str]) -> list[bool]:
    """探さない文字（引数・コメントなど）の印。"""
    lock = [False] * len(toks)
    n = len(toks)

    def skip_space(j: int) -> int:
        while j < n and _is_space(toks[j]):
            j += 1
        return j

    for i, t in enumerate(toks):
        if t.startswith("%"):
            lock[i] = True
            continue
        if t == "\\\\":  # 改行の [2pt]
            j = skip_space(i + 1)
            if j < n and toks[j] == "[":
                k = j
                while k < n and toks[k] != "]":
                    k += 1
                for m in range(j, min(k + 1, n)):
                    lock[m] = True
            continue
        if not t.startswith("\\") or len(t) < 2:
            continue
        name = t[1:]
        if name in DELIM_CMDS:
            j = skip_space(i + 1)
            if j < n:
                lock[j] = True
                if toks[j] == "\\" and j + 1 < n:
                    lock[j + 1] = True
            continue
        if name not in SKIP_ARGS:
            continue
        nargs = SKIP_ARGS[name]
        j = skip_space(i + 1)
        if j < n and toks[j] == "[":
            k = j
            while k < n and toks[k] != "]":
                k += 1
            for m in range(j, min(k + 1, n)):
                lock[m] = True
            j = skip_space(k + 1)
        if nargs == 0:
            # 長さ（\kern 2pt）や、中身ごと探さない引数（\phantom{x}・\operatorname{max}）
            if j < n and toks[j] == "{":
                e = _group_end(toks, j)
                for m in range(j, e + 1):
                    lock[m] = True
            else:
                k = j
                while k < n and not _is_space(toks[k]) and not toks[k].startswith("\\") and toks[k] not in "{}^_&":
                    lock[k] = True
                    k += 1
            continue
        env = None
        for a in range(nargs):
            j = skip_space(j)
            if j >= n:
                break
            if toks[j] == "{":
                e = _group_end(toks, j)
                if name == "begin" and a == 0:
                    env = "".join(toks[j + 1:e]).strip()
                for m in range(j, e + 1):
                    lock[m] = True
                j = e + 1
            else:
                lock[j] = True
                j += 1
        if name == "begin" and env in ARRAY_ENVS:
            j = skip_space(j)
            if j < n and toks[j] == "{":
                e = _group_end(toks, j)
                for m in range(j, e + 1):
                    lock[m] = True
    return lock


def rule_tokens(tex: str) -> list[str] | None:
    """探す文字列を、比べる単位に分ける。使えない文字列（中かっこの対が合わない・& や \\\\ を含むなど）は None。"""
    toks = [t for t in tokenize(tex or "") if not _is_space(t)]
    if not toks:
        return None
    depth = 0
    for t in toks:
        if t in ("&", "\\\\", "#") or t.startswith("%"):
            return None
        if t == "{":
            depth += 1
        elif t == "}":
            depth -= 1
            if depth < 0:
                return None
    if depth != 0 or toks[0] in ("^", "_") or toks[-1] in ("^", "_") or (toks[-1].startswith("\\") and toks[-1][1:] in DELIM_CMDS):
        return None
    return toks


def _hex(c: str) -> str | None:
    m = re.fullmatch(r"#?([0-9A-Fa-f]{6})", str(c or "").strip())
    return m.group(1).upper() if m else None


def colorize(latex: str, rules: list[dict[str, Any]] | None) -> tuple[str, list[int]]:
    """LaTeX に色を付けた結果と、規則ごとの、色を付けた数。"""
    rules = list(rules or [])
    counts = [0] * len(rules)
    if not rules or not latex:
        return latex, counts
    toks = tokenize(latex)
    lock = _locked(toks)
    idx = [i for i, t in enumerate(toks) if not _is_space(t)]  # 空白でない文字の位置
    vals = [toks[i] for i in idx]
    order = []
    for k, r in enumerate(rules):
        rt = rule_tokens(r.get("tex", ""))
        col = _hex(r.get("color", ""))
        if rt and col:
            order.append((k, rt, col))
    order.sort(key=lambda x: (-len(x[1]), x[0]))  # 長い文字列を先に
    taken = [False] * len(toks)
    spans: list[tuple[int, int, str]] = []
    for k, rt, col in order:
        m = len(rt)
        p = 0
        while p + m <= len(vals):
            if vals[p:p + m] != rt:
                p += 1
                continue
            s, e = idx[p], idx[p + m - 1]
            ok = not any(lock[s:e + 1]) and not any(taken[s:e + 1])
            if ok and m > 1 and p > 0:
                prev = vals[p - 1]
                # ^ _ のすぐ後や、空白を挟まずにコマンドのすぐ後（\frac12）の 2 文字以上は、囲むと引数が変わる
                # （x^{2} の {2} のように、1 つのまとまりなら囲める）
                whole = rt[0] == "{" and _group_end(toks, s) == e
                if not whole and (prev in ("^", "_") or (prev.startswith("\\") and prev[1:].isalpha() and idx[p - 1] == s - 1)):
                    ok = False
            if ok:
                for q in range(s, e + 1):
                    taken[q] = True
                spans.append((s, e, col))
                counts[k] += 1
                p += m
            else:
                p += 1
    if not spans:
        return latex, counts
    starts = {s: (e, col) for s, e, col in spans}
    out: list[str] = []
    i = 0
    while i < len(toks):
        if i in starts:
            e, col = starts[i]
            out.append("{\\color[HTML]{" + col + "}" + "".join(toks[i:e + 1]) + "}")
            i = e + 1
        else:
            out.append(toks[i])
            i += 1
    return "".join(out), counts


def normalize_color_map(v: Any) -> list[dict[str, str]]:
    out = []
    for r in v if isinstance(v, list) else []:
        if not isinstance(r, dict):
            continue
        tex = str(r.get("tex") or "")[:200]
        col = _hex(r.get("color", ""))
        if tex.strip():
            out.append({"tex": tex, "color": "#" + (col or "FC6255")})
    return out[:50]
