"""共通プリアンブル（preamble.tex）のテストコンパイルと、MathJax 用マクロへの変換。"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .constants import JP_FIXED_PREAMBLE, JP_TAIL_PREAMBLE, MANIM_DEFAULT_PREAMBLE
from .texlog import parse_tex_log

TEST_BODY = r"$x^2 + \text{日本語}$"


def build_test_document(user_preamble: str, body: str = TEST_BODY) -> tuple[str, int]:
    """テスト用の .tex を作る。戻り値は (文書, 利用者プリアンブルの1行目が文書の何行目か)。

    書き出す .py と同じ順序（manim の既定 → 日本語の固定部分 → preamble.tex）にそろえる。
    """
    head = [r"\documentclass[preview]{standalone}", *MANIM_DEFAULT_PREAMBLE, *JP_FIXED_PREAMBLE]
    first_line = len(head) + 1
    lines = head + user_preamble.split("\n") + [*JP_TAIL_PREAMBLE, r"\begin{document}", body, r"\end{document}"]
    return "\n".join(lines) + "\n", first_line


def compile_test(user_preamble: str, body: str = TEST_BODY, timeout: float = 120) -> dict[str, Any]:
    """XeLaTeX で実際にコンパイルし、エラーがあれば preamble.tex の何行目かを返す。"""
    xelatex = shutil.which("xelatex")
    if not xelatex:
        return {"ok": False, "skipped": True,
                "errors": [{"line": None, "message": "xelatex が見つからないため、テストコンパイルを行えませんでした。"}]}
    doc, first = build_test_document(user_preamble, body)
    n_user = len(user_preamble.split("\n"))
    with tempfile.TemporaryDirectory(prefix="msg-preamble-") as td:
        tex = Path(td) / "test.tex"
        tex.write_text(doc, encoding="utf-8")
        try:
            proc = subprocess.run(
                [xelatex, "-interaction=nonstopmode", "-halt-on-error", "-no-pdf", "test.tex"],
                cwd=td, capture_output=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "errors": [{"line": None, "message": f"XeLaTeX が {timeout:.0f} 秒以内に終わりませんでした。"}]}
        log_path = Path(td) / "test.log"
        log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
        ok = proc.returncode == 0 and (Path(td) / "test.xdv").exists()
    errors = []
    for err in parse_tex_log(log):
        line = err.get("line")
        user_line = None
        if line is not None and first <= line < first + n_user:
            user_line = line - first + 1
        where = "preamble" if user_line else ("fixed" if line is not None and line < first else "body")
        errors.append({"line": user_line, "where": where, "message": err["message"], "context": err.get("context", "")})
    if not ok and not errors:
        errors.append({"line": None, "where": "unknown", "message": "XeLaTeX がエラーで終了しました。", "context": log[-1500:]})
    # TeX が行番号を示さない（または当てにならない）エラーは、プリアンブルの文面から推定する
    for e in errors:
        if e["line"]:
            continue
        guess = guess_line(user_preamble, e["message"])
        if guess:
            e["line"], e["where"], e["guessed"] = guess, "preamble", True
    if errors and all(e["where"] == "body" for e in errors):
        for e in errors:
            e["message"] += "（定義そのものではなく、テスト用の数式で問題が起きました。パッケージ不足の可能性があります）"
    return {"ok": ok, "errors": errors}


_MISSING_FILE_RE = re.compile(r"File `([^']+?)(?:\.(sty|cls|tex|def))?' not found")


def guess_line(user_preamble: str, message: str) -> int | None:
    """TeX のエラーメッセージから、原因と思われる preamble.tex の行（1始まり）を推定する。"""
    lines = user_preamble.split("\n")
    m = _MISSING_FILE_RE.search(message)
    if m:
        name = m.group(1)
        for i, l in enumerate(lines, start=1):
            code = _strip_comment(l)
            if re.search(r"\\(usepackage|RequirePackage|input|include)\b", code) and name in code:
                return i
        return None
    if any(k in message for k in ("File ended while scanning", "Runaway argument", "Missing } inserted", "Extra }")):
        return unbalanced_brace_line(user_preamble)
    return None


def unbalanced_brace_line(text: str) -> int | None:
    """波括弧の対応が取れていない最初の位置の行番号（1始まり）。"""
    stack: list[int] = []
    for ln, raw in enumerate(text.split("\n"), start=1):
        line = _strip_comment(raw)
        i = 0
        while i < len(line):
            c = line[i]
            if c == "\\":
                i += 2
                continue
            if c == "{":
                stack.append(ln)
            elif c == "}":
                if not stack:
                    return ln
                stack.pop()
            i += 1
    return stack[0] if stack else None


# ---------------------------------------------------------------- マクロの抽出

_DEF_RE = re.compile(r"\\(newcommand|renewcommand|providecommand)\*?")
_OTHER_DEF_RE = re.compile(r"\\(def|gdef|edef|let|DeclareMathOperator|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand)\b")


def _strip_comment(line: str) -> str:
    out = []
    i = 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            out.append(line[i:i + 2])
            i += 2
            continue
        if c == "%":
            break
        out.append(c)
        i += 1
    return "".join(out)


def _read_group(s: str, i: int, open_c: str = "{", close_c: str = "}") -> tuple[str, int] | None:
    """s[i] が open_c のとき、対応する閉じ括弧までの中身と、その次の位置を返す。"""
    while i < len(s) and s[i].isspace():
        i += 1
    if i >= len(s) or s[i] != open_c:
        return None
    depth = 0
    j = i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return None


def extract_macros(preamble: str) -> dict[str, Any]:
    r"""\newcommand / \renewcommand / \providecommand を読み取り、MathJax の macros 形式にする。

    戻り値: {"macros": {name: body | [body, n] | [body, n, default]},
             "unsupported": [{"line": n, "text": "..."}],  # 仮表示では展開できない定義
             "defs": [{"name":..., "line":..., "nargs":...}]}
    """
    macros: dict[str, Any] = {}
    unsupported: list[dict[str, Any]] = []
    defs: list[dict[str, Any]] = []
    lines = preamble.split("\n")
    # 複数行にまたがる定義に対応するため、全体を連結して位置→行番号を対応させる
    clean_lines = [_strip_comment(l) for l in lines]
    text = "\n".join(clean_lines)
    starts = []
    pos = 0
    for l in clean_lines:
        starts.append(pos)
        pos += len(l) + 1

    def line_of(p: int) -> int:
        lo, hi = 0, len(starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if starts[mid] <= p:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1

    for m in _DEF_RE.finditer(text):
        i = m.end()
        ln = line_of(m.start())
        g = _read_group(text, i)
        if g:
            name, i = g
            name = name.strip()
        else:
            nm = re.match(r"\s*(\\[A-Za-z@]+|\\.)", text[i:])
            if not nm:
                unsupported.append({"line": ln, "text": lines[ln - 1].strip(), "reason": "定義の形式を読み取れません"})
                continue
            name = nm.group(1)
            i += nm.end()
        if not re.fullmatch(r"\\[A-Za-z]+", name):
            unsupported.append({"line": ln, "text": lines[ln - 1].strip(), "reason": "マクロ名を読み取れません"})
            continue
        nargs = 0
        default = None
        g = _read_group(text, i, "[", "]")
        if g:
            try:
                nargs = int(g[0].strip())
            except ValueError:
                unsupported.append({"line": ln, "text": lines[ln - 1].strip(), "reason": "引数の数を読み取れません"})
                continue
            i = g[1]
            g2 = _read_group(text, i, "[", "]")
            if g2:
                default, i = g2
        body = _read_group(text, i)
        if not body:
            unsupported.append({"line": ln, "text": lines[ln - 1].strip(), "reason": "定義の本体を読み取れません"})
            continue
        key = name[1:]
        if m.group(1) == "providecommand" and key in macros:
            continue
        if default is not None:
            macros[key] = [body[0], nargs, default]
        elif nargs:
            macros[key] = [body[0], nargs]
        else:
            macros[key] = body[0]
        defs.append({"name": key, "line": ln, "nargs": nargs, "hasDefault": default is not None})

    for m in _OTHER_DEF_RE.finditer(text):
        ln = line_of(m.start())
        unsupported.append({"line": ln, "text": lines[ln - 1].strip(),
                            "reason": f"\\{m.group(1)} は仮表示では展開できません（描画には反映されます）"})
    unsupported.sort(key=lambda u: u["line"])
    return {"macros": macros, "unsupported": unsupported, "defs": defs}
