"""画像の書き出し: ページ（またはステップ）ごとの PNG と、スライドごとの動く GIF。描画した結果から作る。

PNG: 区切りの最後の画面（「発表で再生」の動画は、その時点のコマを重ねる）。名前は p01.png・p03-2.png（3 ページの 2 回目のクリック）・pA1.png（付録）。
GIF: そのページの区切りの動画を、初めから順につないだもの（くり返しの区切りは 1 回だけ）。最後の画面で 1.5 秒止まり、くり返し再生する。
     「発表で再生」の動画は入らない。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from . import media_export


def _pages(folder: Path, cls: str, n: int) -> list[tuple[Any, int]]:
    try:
        pages = json.loads((folder / "slides" / "gui_pages" / f"{cls}.json").read_text(encoding="utf-8"))
        if isinstance(pages, list) and len(pages) == n:
            return [(p[0], int(p[1])) for p in pages]
    except (OSError, ValueError):
        pass
    return [(j + 1, 0) for j in range(n)]


def _name(page: Any, click: int) -> str:
    p = f"{page:02d}" if isinstance(page, int) else str(page)
    return f"p{p}" + (f"-{click}" if click else "")


def parse_pages(text: str) -> set[str] | None:
    """「1-3, 5, A1」→ {"1","2","3","5","A1"}。空なら None（すべて）。"""
    text = (text or "").strip()
    if not text:
        return None
    out: set[str] = set()
    for part in re.split(r"[,、，\s]+", text):
        part = part.strip().upper()
        if not part:
            continue
        m = re.fullmatch(r"(A?)(\d+)\s*[-~〜]\s*(A?)(\d+)", part)
        if m and m.group(1) == m.group(3):
            for k in range(int(m.group(2)), int(m.group(4)) + 1):
                out.add(f"{m.group(1)}{k}")
        elif re.fullmatch(r"A?\d+", part):
            out.add(part)
        else:
            raise ValueError(f"ページの指定「{part}」が読めません（例: 1-3, 5, A1）")
    return out


def _clean(outdir: Path, pattern: str) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    for f in outdir.glob(pattern):
        f.unlink()


def export_png(folder: Path, cls: str, outdir: Path, unit: str = "slide", pages_text: str = "", progress=None) -> int:
    cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
    files = [folder / s["file"] for s in cfg.get("slides") or []]
    n = len(files)
    pages = _pages(folder, cls, n)
    want = parse_pages(pages_text)
    idx = []
    for j in range(n):
        last = j == n - 1 or pages[j + 1][0] != pages[j][0]
        if unit == "slide" and not last:
            continue
        if want is not None and str(pages[j][0]).upper() not in want:
            continue
        idx.append(j)
    if not idx:
        raise ValueError("書き出すページがありません（ページの指定を確かめてください）。")
    plan = media_export.load_plan(folder, cls)
    _clean(outdir, "p*.png")
    for k, j in enumerate(idx):
        img = media_export.segment_images(folder, plan, files, [j])[0]
        page, click = pages[j]
        img.save(outdir / f"{_name(page, click if unit == 'step' else 0)}.png")
        if progress:
            progress((k + 1) / len(idx))
    return len(idx)


def export_gif(folder: Path, cls: str, outdir: Path, width: int = 720, fps: int = 15, pages_text: str = "", progress=None) -> int:
    import av
    from PIL import Image

    cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
    segs = cfg.get("slides") or []
    files = [folder / s["file"] for s in segs]
    n = len(files)
    pages = _pages(folder, cls, n)
    want = parse_pages(pages_text)
    groups: list[tuple[Any, list[int]]] = []
    for j in range(n):
        if groups and groups[-1][0] == pages[j][0]:
            groups[-1][1].append(j)
        else:
            groups.append((pages[j][0], [j]))
    groups = [g for g in groups if want is None or str(g[0]).upper() in want]
    if not groups:
        raise ValueError("書き出すページがありません（ページの指定を確かめてください）。")
    _clean(outdir, "p*.gif")
    step = 1.0 / fps
    for k, (page, js) in enumerate(groups):
        frames: list[Image.Image] = []
        for j in js:
            with av.open(str(files[j])) as c:
                st = c.streams.video[0]
                h = None
                next_t = 0.0
                last = None
                for fr in c.decode(st):
                    t = fr.time or 0.0
                    if h is None:
                        h = max(2, round(fr.height * width / fr.width / 2) * 2)
                    last = fr
                    if t + 1e-6 >= next_t:
                        frames.append(fr.to_image().convert("RGB").resize((width, h), Image.LANCZOS))
                        next_t += step
                if last is not None and not frames:
                    frames.append(last.to_image().convert("RGB").resize((width, h), Image.LANCZOS))
        if not frames:
            continue
        durations = [round(step * 1000)] * len(frames)
        durations[-1] = 1500  # 最後の画面で止まる
        pal = [f.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
        pal[0].save(outdir / f"{_name(page, 0)}.gif", save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True, disposal=1)
        if progress:
            progress((k + 1) / len(groups))
    return len(groups)
