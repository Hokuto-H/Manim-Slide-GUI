"""配布資料の PDF（reportlab）。描画した結果の画面を、ノートやメモ欄と一緒に用紙に並べる。文字は選べる・探せる。

並べ方（layout）:
  notes1        縦の用紙に、上にスライド 1 枚、下に発表者ノート
  memo2・memo3  縦の用紙に、左にスライド 2・3 枚、右に罫線のメモ欄
  notes2・notes3 縦の用紙に、左にスライド 2・3 枚、右にそのスライドのノート
  grid4・grid6・grid9 スライドだけを 2×2・2×3（横向きは 3×2）・3×3 に並べる
  用紙の向き: おまかせ（4 枚だけ横、ほかは縦）・縦・横。横向きの「＋ノート」「＋メモ欄」は、列ごとに上に画面・下にノート（1 枚は左右）
用紙（paper）: A4・A3・B5（JIS）・Letter。単位（unit）: slide（スライドごとに最後の画面）・step（ステップごとに、その時点の画面）。

日本語の文字は、TrueType の形のフォント（Windows の游ゴシック・メイリオ・BIZ UD ゴシック・MS ゴシックなど）を探して埋め込む。
reportlab は CFF の形（多くの .otf）を埋め込めないため、プロジェクトのフォントが使えなければ、使える日本語フォントを使う。
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

MM = 72 / 25.4
PAPERS = {"A4": (210, 297), "A3": (297, 420), "B5": (182, 257), "Letter": (215.9, 279.4)}
LAYOUTS = ("notes1", "memo2", "memo3", "notes2", "notes3", "grid4", "grid6", "grid9")
LAYOUT_LABEL = {"notes1": "1 枚＋ノート", "memo2": "2 枚＋メモ欄", "memo3": "3 枚＋メモ欄", "notes2": "2 枚＋ノート",
                "notes3": "3 枚＋ノート", "grid4": "4 枚", "grid6": "6 枚", "grid9": "9 枚"}

# 埋め込める日本語フォントの候補（見つかった順に試す）
_WIN_FONTS = ["YuGothM.ttc", "YuGothR.ttc", "meiryo.ttc", "BIZ-UDGothicR.ttc", "msgothic.ttc", "YuGothic.ttf"]
_UNIX_FONTS = ["/usr/share/fonts/truetype/fonts-japanese-gothic.ttf", "/usr/share/fonts/opentype/ipaexfont-gothic/ipaexg.ttf",
               "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
               "/Library/Fonts/Arial Unicode.ttf"]


def _font_files_for(family: str) -> list[Path]:
    """フォントの名前から、そのファイルを探す（Windows はレジストリ、ほかは fc-match）。"""
    out: list[Path] = []
    if not family:
        return out
    if sys.platform == "win32":
        import os
        import winreg  # noqa: PLC0415
        windir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        local = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts"
        key_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, key_path) as k:
                    i = 0
                    while True:
                        try:
                            name, val, _ = winreg.EnumValue(k, i)
                        except OSError:
                            break
                        i += 1
                        names = [re.sub(r"\s*\((TrueType|OpenType)\)\s*$", "", x).strip() for x in name.split("&")]
                        if any(n.lower() == family.lower() or n.lower().startswith(family.lower() + " ") for n in names):
                            p = Path(val)
                            for c in (p, windir / p.name, local / p.name):
                                if c.is_file():
                                    out.append(c)
                                    break
            except OSError:
                continue
        return out
    try:
        r = subprocess.run(["fc-match", "-f", "%{file}", family], capture_output=True, text=True, timeout=10)  # noqa: S603, S607
        if r.returncode == 0 and r.stdout.strip():
            out.append(Path(r.stdout.strip()))
    except (OSError, subprocess.SubprocessError):
        pass
    return out


def register_font(prefer: str = "") -> tuple[str, str]:
    """reportlab に日本語フォントを登録する。(フォントの名前, 使ったファイル)。見つからなければ ("HeiseiKakuGo-W5", "")（埋め込まない）。"""
    from reportlab.pdfbase import pdfmetrics  # noqa: PLC0415
    from reportlab.pdfbase.ttfonts import TTFont  # noqa: PLC0415
    cands: list[Path] = _font_files_for(prefer)
    if sys.platform == "win32":
        import os
        windir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        cands += [windir / n for n in _WIN_FONTS]
    else:
        cands += [Path(p) for p in _UNIX_FONTS]
    for c in cands:
        if not c.is_file():
            continue
        try:
            kw = {"subfontIndex": 0} if c.suffix.lower() == ".ttc" else {}
            pdfmetrics.registerFont(TTFont("GuiJP", str(c), **kw))
            return "GuiJP", str(c)
        except Exception:  # noqa: BLE001 — CFF の形など、埋め込めないフォントは飛ばす
            continue
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont  # noqa: PLC0415
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))  # 埋め込まない（PDF を見るソフトのフォントを使う）
    return "HeiseiKakuGo-W5", ""


def _plain(md: str) -> str:
    """ノートの Markdown を、配布資料の文にする（見出しの #・太字の ** などを外し、箇条書きは「・」に）。"""
    out = []
    for line in (md or "").replace("\r\n", "\n").split("\n"):
        line = re.sub(r"^\s{0,3}#{1,6}\s*", "", line)
        line = re.sub(r"^(\s*)[-*+]\s+", lambda m: m.group(1) + "・", line)
        line = re.sub(r"(\*\*|__|`)", "", line)
        line = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", line)
        out.append(line.rstrip())
    text = "\n".join(out).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def collect(folder: Path, cls: str, project: dict[str, Any], unit: str) -> list[dict[str, Any]]:
    """配布資料に載せる画面: [{"seg": 区切りの番号, "label": ページの見出し, "notes": 文, "title": 題名}]（描画した順）。"""
    cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
    segs = cfg.get("slides") or []
    n = len(segs)
    gp = folder / "slides" / "gui_pages"
    try:
        pages = json.loads((gp / f"{cls}.json").read_text(encoding="utf-8"))
        if not isinstance(pages, list) or len(pages) != n:
            pages = None
    except (OSError, ValueError):
        pages = None
    try:
        keys = json.loads((gp / f"{cls}.segs.json").read_text(encoding="utf-8"))
        if not isinstance(keys, list) or len(keys) != n:
            keys = None
    except (OSError, ValueError):
        keys = None
    try:
        deck = {str(s.get("id")): s for s in json.loads((gp / f"{cls}.deck.json").read_text(encoding="utf-8")).get("slides") or []}
    except (OSError, ValueError, AttributeError):
        deck = {}
    slides = {str(s.get("id")): s for s in project.get("slides") or []}
    out = []
    for j in range(n):
        page = pages[j][0] if pages else j + 1
        last_of_page = j == n - 1 or (pages[j + 1][0] != page if pages else True)
        if unit == "slide" and not last_of_page:
            continue
        sid = str(keys[j]).split(":", 1)[0] if keys else None
        sl = slides.get(sid) if sid else None
        if unit == "slide":
            if sl is not None:
                parts = [sl.get("notes") or ""]
                for k, st in enumerate(sl.get("steps") or [], start=1):
                    if (st.get("notes") or "").strip():
                        parts.append(f"（クリック {k}）{st['notes']}")
                notes = "\n".join(p for p in parts if p.strip())
            else:
                notes = str(segs[j].get("notes") or "")
            label = f"{'付録 ' if isinstance(page, str) else ''}{page}"
        else:
            click = pages[j][1] if pages else 0
            if sl is not None and keys:
                stid = str(keys[j]).split(":", 1)[1]
                st = next((x for x in sl.get("steps") or [] if str(x.get("id")) == stid), None)
                notes = "\n".join(p for p in [(sl.get("notes") or "") if click == 0 else "", (st or {}).get("notes") or ""] if p.strip())
            else:
                notes = str(segs[j].get("notes") or "")
            label = f"{'付録 ' if isinstance(page, str) else ''}{page}" + (f"-{click}" if click else "")
        title = (deck.get(sid) or {}).get("title", "") if sid else ""
        out.append({"seg": j, "label": label, "notes": _plain(notes), "title": title})
    return out


ORIENTS = ("auto", "portrait", "landscape")


def landscape_of(layout: str, orient: str) -> bool:
    """おまかせ（auto）では、4 枚だけ横向き、ほかは縦向き。"""
    if orient == "landscape":
        return True
    if orient == "portrait":
        return False
    return layout == "grid4"


def make_handout(folder: Path, cls: str, project: dict[str, Any], dest: Path, layout: str = "notes1", paper: str = "A4",
                 unit: str = "slide", progress=None, orient: str = "auto") -> dict[str, Any]:
    from reportlab.lib.colors import HexColor  # noqa: PLC0415
    from reportlab.lib.styles import ParagraphStyle  # noqa: PLC0415
    from reportlab.lib.utils import ImageReader  # noqa: PLC0415
    from reportlab.pdfgen import canvas as rl_canvas  # noqa: PLC0415
    from reportlab.platypus import Frame, Paragraph  # noqa: PLC0415

    from . import media_export  # noqa: PLC0415

    layout = layout if layout in LAYOUTS else "notes1"
    pw, ph = (v * MM for v in PAPERS.get(paper, PAPERS["A4"]))
    land = landscape_of(layout, orient)
    if land:
        pw, ph = ph, pw
    items = collect(folder, cls, project, unit)
    if not items:
        raise ValueError("配布資料に載せる画面がありません（先に描画してください）。")
    cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
    files = [folder / s["file"] for s in cfg.get("slides") or []]
    plan = media_export.load_plan(folder, cls)
    from .fonts import resolve as _resolve_font  # プリセットの別の候補の名前なら、この PC にある名前で探す
    font, font_file = register_font(_resolve_font(project.get("settings", {}).get("defaultFont") or "") or "")
    imgs: dict[int, Any] = {}
    want = [it["seg"] for it in items]
    for k, img in zip(want, media_export.segment_images(folder, plan, files, want)):
        imgs[k] = img
        if progress:
            progress(len(imgs) / max(1, len(want)) * 0.7)
    ar = (imgs[want[0]].height / imgs[want[0]].width) if want else 9 / 16

    def reader(img):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        buf.seek(0)
        return ImageReader(buf)

    readers = {k: reader(v) for k, v in imgs.items()}
    title = str(project.get("settings", {}).get("name") or cls)
    today = date.today().strftime("%Y-%m-%d")
    c = rl_canvas.Canvas(str(dest), pagesize=(pw, ph))
    c.setTitle(f"{title}（配布資料）")
    c.setAuthor("Manim Slide GUI")
    m = 12 * MM  # 余白
    head = 8 * MM
    line = HexColor("#9E9E9E")
    style = ParagraphStyle("n", fontName=font, fontSize=10, leading=15, wordWrap="CJK")

    def esc(t: str) -> str:
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")

    def header(pg: int, total: int) -> None:
        c.setFont(font, 9)
        c.setFillColor(HexColor("#555555"))
        c.drawString(m, ph - m + 2 * MM, title)
        c.drawRightString(pw - m, ph - m + 2 * MM, today)
        c.drawCentredString(pw / 2, m - 7 * MM, f"{pg} / {total}")
        c.setFillColor(HexColor("#000000"))

    def slide(it, x, y, w, h) -> None:
        """(x, y) は左下。枠の中に、縦横比を保って置く。下に小さくページの見出し。"""
        iw, ih = w, w * ar
        if ih > h - 5 * MM:
            ih = h - 5 * MM
            iw = ih / ar
        ix, iy = x + (w - iw) / 2, y + h - ih
        c.drawImage(readers[it["seg"]], ix, iy, iw, ih)
        c.setStrokeColor(line)
        c.setLineWidth(0.6)
        c.rect(ix, iy, iw, ih)
        c.setFont(font, 8)
        c.setFillColor(HexColor("#555555"))
        c.drawString(ix, iy - 3.8 * MM, f"{it['label']}　{it['title']}"[:80])
        c.setFillColor(HexColor("#000000"))

    def notes_box(text: str, x, y, w, h) -> None:
        if not text.strip():
            c.setFont(font, 9)
            c.setFillColor(HexColor("#9E9E9E"))
            c.drawString(x + 2 * MM, y + h - 6 * MM, "（ノートなし）")
            c.setFillColor(HexColor("#000000"))
            return
        size = 10.5
        while size >= 7:  # 入りきらなければ文字を小さくする
            st = ParagraphStyle("n", parent=style, fontSize=size, leading=size * 1.45)
            para = Paragraph(esc(text), st)
            _w, need = para.wrap(w - 4 * MM, h - 4 * MM)
            if need <= h - 4 * MM:
                break
            size -= 0.5
        f = Frame(x, y, w, h, leftPadding=2 * MM, rightPadding=2 * MM, topPadding=2 * MM, bottomPadding=2 * MM, showBoundary=0)
        story = [Paragraph(esc(text), ParagraphStyle("n", parent=style, fontSize=size, leading=size * 1.45))]
        f.addFromList(story, c)
        if story:  # まだ残っている（入りきらない）
            c.setFont(font, 8)
            c.drawRightString(x + w - 2 * MM, y + 1.5 * MM, "…（以下略）")

    def memo_lines(x, y, w, h) -> None:
        c.setStrokeColor(HexColor("#BDBDBD"))
        c.setLineWidth(0.4)
        yy = y + h - 7 * MM
        while yy > y + 1 * MM:
            c.line(x, yy, x + w, yy)
            yy -= 7 * MM

    top = ph - m - head
    bottom = m
    area_h = top - bottom
    per = {"notes1": 1, "memo2": 2, "memo3": 3, "notes2": 2, "notes3": 3, "grid4": 4, "grid6": 6, "grid9": 9}[layout]
    pages = [items[i:i + per] for i in range(0, len(items), per)]
    for pi, group in enumerate(pages, start=1):
        header(pi, len(pages))
        if layout == "notes1" and land:  # 横向き: 左に画面、右にノート
            it = group[0]
            sw = (pw - 2 * m) * 0.62
            slide(it, m, bottom, sw, area_h)
            bx, bw = m + sw + 6 * MM, pw - 2 * m - sw - 6 * MM
            c.setStrokeColor(line)
            c.setLineWidth(0.6)
            c.rect(bx, bottom, bw, area_h)
            notes_box(it["notes"], bx, bottom, bw, area_h)
        elif layout != "notes1" and layout.startswith(("memo", "notes")) and land:  # 横向き: 列ごとに、上に画面、下にノート・メモ
            cols = per
            cw = (pw - 2 * m) / cols
            for k, it in enumerate(group):
                x = m + k * cw + 3 * MM
                w = cw - 6 * MM
                sh = min(w * ar + 5 * MM, area_h * 0.5)
                slide(it, x, top - sh, w, sh)
                by, bh = bottom, top - sh - 6 * MM - bottom
                if layout.startswith("memo"):
                    memo_lines(x, by, w, bh)
                else:
                    c.setStrokeColor(line)
                    c.setLineWidth(0.6)
                    c.rect(x, by, w, bh)
                    notes_box(it["notes"], x, by, w, bh)
        elif layout == "notes1":
            it = group[0]
            sw = pw - 2 * m
            sh = min(sw * ar + 5 * MM, area_h * 0.55)
            slide(it, m, top - sh, sw, sh)
            nb_top = top - sh - 6 * MM
            c.setStrokeColor(line)
            c.setLineWidth(0.6)
            c.rect(m, bottom, sw, nb_top - bottom)
            notes_box(it["notes"], m, bottom, sw, nb_top - bottom)
        elif layout.startswith(("memo", "notes")) and layout != "notes1":
            rows = per
            rh = area_h / rows
            lw = (pw - 2 * m) * 0.48
            for r, it in enumerate(group):
                y = top - (r + 1) * rh
                slide(it, m, y + 3 * MM, lw, rh - 6 * MM)
                bx, bw = m + lw + 6 * MM, pw - 2 * m - lw - 6 * MM
                if layout.startswith("memo"):
                    memo_lines(bx, y + 3 * MM, bw, rh - 6 * MM)
                else:
                    c.setStrokeColor(line)
                    c.setLineWidth(0.6)
                    c.rect(bx, y + 3 * MM, bw, rh - 6 * MM)
                    notes_box(it["notes"], bx, y + 3 * MM, bw, rh - 6 * MM)
        else:
            cols, rows = {4: (2, 2), 6: (3, 2) if land else (2, 3), 9: (3, 3)}[per]
            cw, rh = (pw - 2 * m) / cols, area_h / rows
            for k, it in enumerate(group):
                cx, r = k % cols, k // cols
                slide(it, m + cx * cw + 3 * MM, top - (r + 1) * rh + 3 * MM, cw - 6 * MM, rh - 6 * MM)
        c.showPage()
        if progress:
            progress(0.7 + 0.3 * pi / len(pages))
    c.save()
    return {"pages": len(pages), "items": len(items), "font": Path(font_file).name if font_file else "（埋め込まない既定の日本語フォント）"}
