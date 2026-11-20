"""使い方の案内（ヘルプ）の原稿（docs/help/*.md）を読み、HTML にする。

アプリ内のヘルプ（/api/help/...）と、説明書（scripts/build_manual.py が作る HTML・PDF）が、同じ原稿と同じ変換を使う。
外部のライブラリは使わず、原稿で使う範囲の Markdown だけを扱う:

- 先頭の front matter（--- と --- の間。title・order・keywords・summary）
- 見出し（# は使わず、## と ### を節にする。「## 見出し {#id}」で id を決められる）
- 段落、箇条書き（- と 1.、2 段まで）、表（| a | b |）、コード（`x` と ```）、引用（> 。「> **注意**」などの囲み）
- 太字（**x**）、キー（[[Ctrl+S]]）、リンク（[文字](help:ページ#節)・[文字](https://...)）、画像（![説明](img/x.png)）
"""

from __future__ import annotations

import html
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import __version__

HELP_DIR = Path(__file__).resolve().parent.parent / "docs" / "help"
HELP_IMG = HELP_DIR / "img"

_INLINE_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_KBD = re.compile(r"\[\[(.+?)\]\](?!\])")
_IMG = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_HEAD_ID = re.compile(r"\s*\{#([A-Za-z0-9_-]+)\}\s*$")


def _inline(text: str, img_base: str) -> str:
    """1 行の中の書式。コードの中は、ほかの書式を当てない。"""
    parts = []
    pos = 0
    for m in _INLINE_CODE.finditer(text):
        parts.append(("t", text[pos:m.start()]))
        parts.append(("c", m.group(1)))
        pos = m.end()
    parts.append(("t", text[pos:]))
    out = []
    for kind, s in parts:
        if kind == "c":
            out.append(f"<code>{html.escape(s)}</code>")
            continue
        s = html.escape(s, quote=False)
        s = _IMG.sub(lambda m: f'<img src="{img_base}{html.escape(m.group(2))}" alt="{m.group(1)}" loading="lazy">', s)

        def link(m: re.Match) -> str:
            label, href = m.group(1), m.group(2)
            if href.startswith("help:"):
                page, _, anchor = href[5:].partition("#")
                return f'<a href="#" class="help-link" data-page="{html.escape(page)}" data-anchor="{html.escape(anchor)}">{label}</a>'
            return f'<a href="{html.escape(href)}" target="_blank" rel="noopener">{label}</a>'
        s = _LINK.sub(link, s)
        s = _BOLD.sub(r"<strong>\1</strong>", s)
        s = _KBD.sub(lambda m: "+".join(f"<kbd>{k}</kbd>" for k in re.split(r"(?<=.)\+(?=.)", m.group(1))), s)
        out.append(s)
    return "".join(out)


def parse(src: str) -> tuple[dict[str, Any], str]:
    """front matter と本文に分ける。"""
    meta: dict[str, Any] = {}
    if src.startswith("---\n"):
        end = src.find("\n---\n", 4)
        if end > 0:
            for line in src[4:end].splitlines():
                k, _, v = line.partition(":")
                if k.strip():
                    meta[k.strip()] = v.strip()
            src = src[end + 5:]
    return meta, src


def to_html(body: str, img_base: str = "", page_id: str = "") -> tuple[str, list[dict[str, str]]]:
    """本文の Markdown を HTML に。返す: (HTML, 節の一覧 [{id, title, level}])。"""
    lines = body.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    toc: list[dict[str, str]] = []
    i = 0
    n_head = 0

    def flush_para(buf: list[str]) -> None:
        if buf:
            out.append(f"<p>{'<br>'.join(_inline(x, img_base) for x in buf)}</p>")
            buf.clear()

    para: list[str] = []
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush_para(para)
            i += 1
            continue
        if stripped.startswith("```"):
            flush_para(para)
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            out.append(f"<pre><code>{html.escape(chr(10).join(code))}</code></pre>")
            i += 1
            continue
        m = re.match(r"^(#{2,4})\s+(.*)$", stripped)
        if m:
            flush_para(para)
            level = len(m.group(1))
            title = m.group(2)
            hid = _HEAD_ID.search(title)
            if hid:
                title = title[:hid.start()]
                anchor = hid.group(1)
            else:
                n_head += 1
                anchor = f"s{n_head}"
            toc.append({"id": anchor, "title": re.sub(r"[*`\[\]]", "", title), "level": str(level)})
            out.append(f'<h{level} id="{page_id + "--" if page_id else ""}{anchor}" data-anchor="{anchor}">{_inline(title, img_base)}</h{level}>')
            i += 1
            continue
        if stripped.startswith(">"):
            flush_para(para)
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip()[1:].strip())
                i += 1
            inner, _ = to_html("\n".join(quote), img_base)
            kind = "note"
            if quote and quote[0].startswith("**注意"):
                kind = "warn"
            elif quote and quote[0].startswith("**ヒント"):
                kind = "tip"
            out.append(f'<div class="help-box {kind}">{inner}</div>')
            continue
        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            flush_para(para)
            head = [c.strip() for c in stripped.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            th = "".join(f"<th>{_inline(c, img_base)}</th>" for c in head)
            trs = "".join("<tr>" + "".join(f"<td>{_inline(c, img_base)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>")
            continue
        if re.match(r"^(\s*)([-*]|\d+\.)\s+", line):
            flush_para(para)
            out.append(_list(lines, i, img_base))
            while i < len(lines) and (re.match(r"^(\s*)([-*]|\d+\.)\s+", lines[i]) or (lines[i].startswith("  ") and lines[i].strip())):
                i += 1
            continue
        if stripped.startswith("!["):
            flush_para(para)
            m2 = _IMG.match(stripped)
            if m2:
                cap = m2.group(1)
                out.append(f'<figure><img src="{img_base}{html.escape(m2.group(2))}" alt="{html.escape(cap)}" loading="lazy">'
                           f'{f"<figcaption>{html.escape(cap)}</figcaption>" if cap else ""}</figure>')
                i += 1
                continue
        para.append(stripped)
        i += 1
    flush_para(para)
    return "\n".join(out), toc


def _list(lines: list[str], i: int, img_base: str) -> str:
    """箇条書き（2 段まで）。項目の続きの行（字下げした行）は、同じ項目に入れる。"""
    items: list[tuple[int, bool, list[str]]] = []
    while i < len(lines):
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", lines[i])
        if m:
            items.append((len(m.group(1)), m.group(2)[0].isdigit(), [m.group(3)]))
        elif lines[i].startswith("  ") and lines[i].strip() and items:
            items[-1][2].append(lines[i].strip())
        else:
            break
        i += 1
    base = items[0][0] if items else 0
    html_out: list[str] = []
    stack: list[str] = []
    for indent, ordered, text in items:
        depth = 0 if indent <= base else 1
        tag = "ol" if ordered else "ul"
        while len(stack) > depth + 1:
            html_out.append(f"</li></{stack.pop()}>")
        if len(stack) == depth:
            html_out.append(f"<{tag}><li>")
            stack.append(tag)
        else:
            html_out.append("</li><li>")
        html_out.append("<br>".join(_inline(t, img_base) for t in text))
    while stack:
        html_out.append(f"</li></{stack.pop()}>")
    return "".join(html_out)


@lru_cache(maxsize=1)
def _pages_cached(stamp: tuple) -> list[dict[str, Any]]:
    pages = []
    for f in sorted(HELP_DIR.glob("*.md")):
        meta, body = parse(f.read_text(encoding="utf-8"))
        body = body.replace("{{version}}", __version__)
        pid = f.stem.split("-", 1)[-1] if re.match(r"^\d+-", f.stem) else f.stem
        html_body, toc = to_html(body, "/help-img/", pid)
        text = re.sub(r"<[^>]+>", " ", html_body)
        pages.append({"id": pid, "file": f.name, "title": meta.get("title", pid), "group": meta.get("group", ""),
                      "summary": meta.get("summary", ""), "keywords": meta.get("keywords", ""),
                      "order": float(meta.get("order", 999)), "html": html_body, "toc": toc,
                      "text": html.unescape(re.sub(r"\s+", " ", text)).strip(), "body": body})
    pages.sort(key=lambda p: (p["order"], p["file"]))
    return pages


def pages() -> list[dict[str, Any]]:
    """すべてのページ（原稿が変わったら読み直す）。"""
    stamp = tuple(sorted((f.name, f.stat().st_mtime) for f in HELP_DIR.glob("*.md")))
    return _pages_cached(stamp)


def index() -> list[dict[str, Any]]:
    """目次と、検索のための本文（節ごと）。"""
    out = []
    for p in pages():
        sections = []
        # 節ごとの本文（検索で、節に飛べるように）。見出しで区切る
        heads = list(re.finditer(r'<h[234] id="[^"]*" data-anchor="([^"]+)">(.*?)</h[234]>', p["html"]))
        first = p["html"][: heads[0].start()] if heads else p["html"]
        if _plain(first):
            sections.append({"anchor": "", "title": p["title"], "text": _plain(first)})
        for k, m in enumerate(heads):
            end = heads[k + 1].start() if k + 1 < len(heads) else len(p["html"])
            sections.append({"anchor": m.group(1), "title": _plain(m.group(2)), "text": _plain(p["html"][m.end():end])})
        out.append({"id": p["id"], "title": p["title"], "group": p["group"], "summary": p["summary"],
                    "keywords": p["keywords"], "toc": p["toc"], "sections": sections})
    return out


def _plain(s: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def page(pid: str) -> dict[str, Any] | None:
    for p in pages():
        if p["id"] == pid:
            return {k: p[k] for k in ("id", "title", "group", "summary", "html", "toc")}
    return None
