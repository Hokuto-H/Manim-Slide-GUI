"""TeX のログファイルから、エラーの内容と行番号を取り出す。"""

from __future__ import annotations

import re
from typing import Any

_LINE_RE = re.compile(r"^l\.(\d+)\s?(.*)$")


def parse_tex_log(log: str, limit: int = 5) -> list[dict[str, Any]]:
    """`! メッセージ` で始まるエラーと、続く `l.<行> <文脈>` を組にして返す。"""
    lines = log.splitlines()
    errors: list[dict[str, Any]] = []
    i = 0
    while i < len(lines) and len(errors) < limit:
        line = lines[i]
        if line.startswith("! "):
            msg = [line[2:].strip()]
            line_no = None
            context = ""
            j = i + 1
            while j < len(lines) and j < i + 25:
                m = _LINE_RE.match(lines[j])
                if m:
                    line_no = int(m.group(1))
                    context = (m.group(2) + " " + (lines[j + 1].strip() if j + 1 < len(lines) else "")).strip()
                    break
                if lines[j].startswith("! ") or lines[j].startswith("Here is how much"):
                    break
                # メッセージの続き（"Type  H <return>" などの定型文は除く）
                t = lines[j].strip()
                if t and not t.startswith(("Type ", "See the ", "or enter new name", "Enter file name")) and len(msg) < 3 and not t.startswith("..."):
                    if not t.startswith("<") and not t.startswith("\\"):
                        msg.append(t)
                j += 1
            # 未定義のコマンドは、エラー直後の行の末尾にそのコマンド名がある
            if msg[0].startswith("Undefined control sequence"):
                for k in range(i + 1, min(j, i + 6)):
                    cs = re.findall(r"\\[A-Za-z@]+|\\.", lines[k])
                    if cs and lines[k].rstrip() and not lines[k].startswith("l."):
                        msg[0] = f"Undefined control sequence（未定義のコマンド: {cs[-1]}）"
                        break
            # 直前のエラーに続く "Emergency stop." は、行番号も当てにならないので記録しない
            if not (msg[0].startswith("Emergency stop") and errors):
                errors.append({"message": " ".join(msg), "line": line_no, "context": context})
            i = j + 1
            continue
        i += 1
    if not errors:
        m = re.search(r"^.*Fatal error.*$", log, re.M)
        if m:
            errors.append({"message": m.group(0).strip(), "line": None, "context": ""})
    return errors
