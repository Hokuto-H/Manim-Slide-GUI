"""説明書（docs/manual/manual.html と manual.pdf）を、ヘルプの原稿（docs/help/*.md）から作る（開発用）。

アプリ内のヘルプと同じ原稿・同じ変換（app/helpdoc.py）を使うので、内容は常に同じになる。
    python scripts/build_manual.py            # HTML と PDF（PDF には Playwright の Chromium が要る）
    python scripts/build_manual.py --no-pdf   # HTML だけ

HTML は画像を中に入れた 1 つのファイルで、ネットにつながずに開ける。PDF は A4 縦・ページ番号付き。
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import __version__, helpdoc

OUT = ROOT / "docs" / "manual"

CSS = """
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", "Meiryo", sans-serif; color: #1d2128; line-height: 1.75;
  font-size: 10.5pt; margin: 0 auto; max-width: 860px; padding: 0 24px 60px; }
h1, h2, h3 { line-height: 1.4; }
.cover { min-height: 92vh; display: flex; flex-direction: column; justify-content: center; text-align: center; page-break-after: always; }
.cover h1 { font-size: 30pt; margin: 0 0 8px; } .cover .sub { font-size: 13pt; color: #555; } .cover .ver { margin-top: 40px; color: #777; }
nav.toc { page-break-after: always; } nav.toc h2 { font-size: 16pt; border-bottom: 2px solid #3554d1; }
nav.toc .grp { font-weight: 700; margin: 12px 0 2px; color: #3554d1; }
nav.toc ol { margin: 0; padding-left: 1.6em; } nav.toc li { margin: 2px 0; }
nav.toc ul { margin: 0 0 4px; padding-left: 1.2em; font-size: 9.5pt; color: #555; list-style: none; }
nav.toc a { color: inherit; text-decoration: none; }
section.page { page-break-before: always; }
section.page > h1 { font-size: 18pt; border-bottom: 3px solid #3554d1; padding-bottom: 4px; margin-top: 0; }
section.page .grp { color: #3554d1; font-size: 9.5pt; margin-bottom: 2px; }
h2 { font-size: 13.5pt; margin: 22px 0 6px; border-left: 5px solid #3554d1; padding-left: 8px; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 4px; page-break-after: avoid; }
p, ul, ol { margin: 6px 0; } ul, ol { padding-left: 1.5em; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #c8ccd5; padding: 4px 7px; text-align: left; vertical-align: top; } th { background: #eef1f8; }
code { font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace; font-size: 9pt; background: #f3f4f6; border: 1px solid #dfe2e8; border-radius: 3px; padding: 0 3px; }
pre { background: #f3f4f6; border: 1px solid #dfe2e8; border-radius: 5px; padding: 8px 10px; white-space: pre-wrap; page-break-inside: avoid; }
pre code { border: 0; background: none; padding: 0; }
kbd { font-family: inherit; font-size: 8.5pt; border: 1px solid #b9bec9; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; background: #fff; }
figure { margin: 10px 0; text-align: center; page-break-inside: avoid; } figure img { max-width: 100%; max-height: 120mm; border: 1px solid #dfe2e8; }
figcaption { font-size: 9pt; color: #666; }
.help-box { border-left: 4px solid #3554d1; background: #eef1fb; padding: 4px 12px; margin: 8px 0; page-break-inside: avoid; }
.help-box.warn { border-color: #b26a00; background: #fff6e5; } .help-box.tip { border-color: #1f8a4c; background: #edf7f1; }
a { color: #3554d1; }
@media screen { body { padding-top: 20px; } section.page { border-top: 1px solid #dfe2e8; margin-top: 40px; padding-top: 20px; } }
@media print { a { text-decoration: none; } }
"""


def _img_data(src: str) -> str:
    """/help-img/x.png → data: の URI（1 つのファイルで開けるように）。"""
    f = helpdoc.HELP_IMG / src.removeprefix("/help-img/")
    if not f.is_file():
        return src
    mime = "image/png" if f.suffix.lower() == ".png" else "image/jpeg" if f.suffix.lower() in (".jpg", ".jpeg") else "image/svg+xml"
    return f"data:{mime};base64,{base64.b64encode(f.read_bytes()).decode()}"


def _fix(html_body: str) -> str:
    html_body = re.sub(r'<a href="#" class="help-link" data-page="([^"]*)" data-anchor="([^"]*)">',
                       lambda m: f'<a href="#{m.group(1)}{"--" + m.group(2) if m.group(2) else ""}">', html_body)
    return re.sub(r'src="(/help-img/[^"]+)"', lambda m: f'src="{_img_data(m.group(1))}"', html_body)


def build_html() -> str:
    pages = helpdoc.pages()
    today = dt.date.today().isoformat()
    toc, body, last_group = [], [], None
    for p in pages:
        if p["group"] != last_group:
            if last_group is not None:
                toc.append("</ol>")
            toc.append(f'<div class="grp">{html.escape(p["group"])}</div><ol>')
            last_group = p["group"]
        subs = "".join(f'<li><a href="#{p["id"]}--{t["id"]}">{html.escape(t["title"])}</a></li>' for t in p["toc"] if t["level"] == 2)
        toc.append(f'<li><a href="#{p["id"]}">{html.escape(p["title"])}</a><ul>{subs}</ul></li>')
        body.append(f'<section class="page" id="{p["id"]}"><div class="grp">{html.escape(p["group"])}</div>'
                    f'<h1>{html.escape(p["title"])}</h1>{_fix(p["html"])}</section>')
    toc.append("</ol>")
    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manim Slide GUI 説明書</title><style>{CSS}</style></head>
<body>
<div class="cover"><h1>Manim Slide GUI</h1><div class="sub">説明書 — 数式とアニメーションのスライドを作る</div>
<div class="ver">版 {html.escape(__version__)}・{today}</div></div>
<nav class="toc"><h2>目次</h2>{''.join(toc)}</nav>
{''.join(body)}
</body></html>"""


def _font_without_radicals(work: Path) -> Path | None:
    """本文のフォント（IPAex ゴシック・Noto Sans JP など、ある物）の、部首の文字の対応を外した写しを作る。"""
    import subprocess
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None
    src = None
    for fam in ("IPAexGothic", "Noto Sans JP", "Noto Sans CJK JP"):
        try:
            out = subprocess.run(["fc-match", "-f", "%{family}|%{file}", f"{fam}:lang=ja"], capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            out = ""
        families, _, file = out.partition("|")
        if file and Path(file).suffix.lower() in (".ttf", ".otf") and fam in families.split(","):
            src = Path(file)
            break
    if src is None:
        return None
    f = TTFont(src)
    for t in f["cmap"].tables:
        if hasattr(t, "cmap"):
            t.cmap = {k: v for k, v in t.cmap.items() if not (0x2E80 <= k <= 0x2FDF)}
    dst = work / f"manual-font{src.suffix}"
    f.save(dst)
    return dst


def build_pdf(html_file: Path, pdf_file: Path) -> None:
    import tempfile

    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        work = Path(tmp)
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(html_file.as_uri())
        # Chromium で PDF にすると、部首（U+2F00〜）と漢字が同じ字形を指すフォントでは、文字の対応に部首が入り
        # （「用」が「⽤」になる）、PDF の中を検索・コピーしにくい。部首の対応を外したフォントの写しを使う
        font = _font_without_radicals(work)
        if font:
            pg.add_style_tag(content=f'@font-face {{ font-family: "ManualJP"; src: url("{font.as_uri()}"); }}'
                                     'body { font-family: "ManualJP", "Noto Sans JP", sans-serif; }'
                                     'code, kbd { font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", "ManualJP", monospace; }')
        pg.wait_for_timeout(500)
        pg.pdf(path=str(pdf_file), format="A4", print_background=True, prefer_css_page_size=True,
               display_header_footer=True, header_template="<span></span>",
               footer_template='<div style="width:100%;text-align:center;font-size:8pt;color:#888;">'
                               '<span class="pageNumber"></span> / <span class="totalPages"></span></div>')
        b.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-pdf", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    hf = OUT / "manual.html"
    hf.write_text(build_html(), encoding="utf-8")
    print("HTML:", hf)
    if not a.no_pdf:
        pf = OUT / "manual.pdf"
        build_pdf(hf, pf)
        print("PDF:", pf)


if __name__ == "__main__":
    main()
