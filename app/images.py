"""画像の取り込み（プロジェクトの images/ へのコピー）と、プレビュー用の配信の補助。

取り込むときに、Manim（Pillow の ImageMobject）とブラウザで同じ見た目になるように整える。
- JPEG の回転情報（EXIF の Orientation）: ブラウザは反映するが Pillow は反映しないので、画素を回して保存する。
- アニメーション GIF / WebP: Manim は最初のコマだけを使うので、最初のコマの PNG にする（動かすときは、画面で聞いてから
  media.import_anim_image で動画にし、動画の要素として置く）。
- CMYK・16 ビットなど、ブラウザと Pillow で色の解釈が分かれやすいものは、RGB(A) の PNG / JPEG にする。
"""

from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from typing import Any

from .project import ProjectError

IMAGES_DIR = "images"
MAX_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 12000 * 12000
KEEP_FORMATS = {"PNG": ".png", "JPEG": ".jpg", "GIF": ".gif", "WEBP": ".webp", "BMP": ".bmp"}
_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_stem(name: str) -> str:
    stem = Path(name or "image").stem
    stem = _BAD_CHARS.sub("_", stem).strip(" .") or "image"
    return stem[:40]


def import_image(folder: Path, data: bytes, filename: str) -> dict[str, Any]:
    """画像のバイト列を検査して images/ に保存し、{path, width, height, name, note} を返す。"""
    from PIL import Image, ImageOps

    if not data:
        raise ProjectError("画像のデータが空です。")
    if len(data) > MAX_BYTES:
        raise ProjectError(f"画像が大きすぎます（{len(data) // (1024 * 1024)} MB）。64 MB 以下にしてください。")
    lower = (filename or "").lower()
    if lower.endswith((".svg", ".svgz")) or data[:2] == b"\x1f\x8b" or b"<svg" in data[:4096]:
        return import_svg(folder, data, filename)
    if lower.endswith(".pdf"):
        raise ProjectError("PDF は取り込めません。PNG などの画像に書き出してから取り込んでください。")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Image.DecompressionBombError as e:
        raise ProjectError("画像の画素数が多すぎます（1 億 4400 万画素まで）。縮小してから取り込んでください。") from e
    except Exception as e:  # noqa: BLE001 - Pillow は形式ごとに様々な例外を出す
        raise ProjectError(f"画像として読み込めませんでした（{Path(filename).suffix or '形式不明'}）。PNG・JPEG・GIF・WebP・BMP などを使ってください。") from e

    fmt = im.format or ""
    notes: list[str] = []
    out_bytes, ext = data, KEEP_FORMATS.get(fmt)

    orientation = 1
    try:
        orientation = im.getexif().get(0x0112, 1) or 1
    except Exception:  # noqa: BLE001
        pass
    animated = getattr(im, "n_frames", 1) > 1
    odd_mode = im.mode not in ("1", "L", "LA", "P", "RGB", "RGBA")

    if ext is None or animated or orientation != 1 or odd_mode:
        if animated:
            im.seek(0)
            notes.append("アニメーション画像のため、最初のコマだけを使います（Manim の ImageMobject は動きません）。")
        if orientation != 1:
            im = ImageOps.exif_transpose(im)
            notes.append("写真の向き（回転情報）を画素に反映しました。")
        has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
        if fmt == "JPEG" and not animated:
            im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=95)
            out_bytes, ext = buf.getvalue(), ".jpg"
        else:
            if im.mode == "CMYK" or not has_alpha:
                im = im.convert("RGB")
            else:
                im = im.convert("RGBA")
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            out_bytes, ext = buf.getvalue(), ".png"
            if fmt not in KEEP_FORMATS:
                notes.append(f"{fmt or 'この形式'} は PNG に変換して保存しました。")

    digest = hashlib.sha1(out_bytes).hexdigest()[:10]
    images = folder / IMAGES_DIR
    images.mkdir(exist_ok=True)
    existing = sorted(images.glob(f"*-{digest}{ext}"))
    if existing:
        target = existing[0]  # 同じ内容の画像は、取り込み済みのファイルを使う
    else:
        target = images / f"{_safe_stem(filename)}-{digest}{ext}"
        target.write_bytes(out_bytes)
    w, h = im.size
    if max(w, h) > 4096:
        notes.append(f"画像が大きい（{w}×{h}）ため、描画が遅くなることがあります。")
    return {"path": f"{IMAGES_DIR}/{target.name}", "width": w, "height": h, "name": filename or target.name,
            "note": " ".join(notes)}


def import_svg(folder: Path, data: bytes, filename: str) -> dict[str, Any]:
    """SVG を images/ に保存し、{kind: "svg", path, width, height, name, note} を返す（width・height は縦横比を表す数）。
    SVG は Manim の SVGMobject で図形として読み込む（拡大してもぼやけない）。"""
    import gzip
    import xml.etree.ElementTree as ET

    if data[:2] == b"\x1f\x8b":  # .svgz
        try:
            data = gzip.decompress(data)
        except OSError as e:
            raise ProjectError("SVGZ を展開できませんでした。") from e
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ProjectError(f"SVG として読み込めませんでした（{e}）。") from e
    if not root.tag.endswith("svg"):
        raise ProjectError("SVG のファイルではありません。")

    def length(v: str | None) -> float | None:
        m = re.match(r"\s*([0-9.]+)", v or "")
        return float(m.group(1)) if m and v and "%" not in v else None

    w, h = length(root.get("width")), length(root.get("height"))
    vb = (root.get("viewBox") or "").replace(",", " ").split()
    if len(vb) == 4:
        try:
            w, h = float(vb[2]) or w, float(vb[3]) or h
        except ValueError:
            pass
    w, h = w or 100.0, h or 100.0
    text = data.decode("utf-8", errors="ignore")
    notes = []
    if "<text" in text:
        notes.append("SVG の中の文字（text）は Manim では表示されません。文字はアウトライン（パス）にしてから保存してください。")
    if "Gradient" in text:
        notes.append("グラデーションは Manim では単色になります。")
    if "<image" in text:
        notes.append("SVG の中に埋め込まれた画像は表示されません。")
    digest = hashlib.sha1(data).hexdigest()[:10]
    images = folder / IMAGES_DIR
    images.mkdir(exist_ok=True)
    existing = sorted(images.glob(f"*-{digest}.svg"))
    target = existing[0] if existing else images / f"{_safe_stem(filename)}-{digest}.svg"
    if not existing:
        target.write_bytes(data)
    return {"kind": "svg", "path": f"{IMAGES_DIR}/{target.name}", "width": w, "height": h, "name": filename or target.name,
            "note": " ".join(notes)}


def resolve(folder: Path, rel: str) -> Path:
    """プロジェクトのフォルダの中の画像のパス（フォルダの外を指すものは拒否する）。"""
    rel = (rel or "").replace("\\", "/")
    p = (folder / rel).resolve()
    root = folder.resolve()
    if root not in p.parents:
        raise ProjectError("プロジェクトのフォルダの外のファイルは開けません。")
    return p


def missing_images(project: dict[str, Any], folder: Path) -> list[dict[str, Any]]:
    """書き出し前の検査: 見つからない画像の一覧（problems の形）。"""
    problems = []
    for si, slide in enumerate(project["slides"]):
        for el in slide["elements"]:
            if el.get("type") != "image" and not (el.get("type") == "shape" and el.get("shape") == "svg"):
                continue
            rel = el.get("path") or ""
            try:
                ok = bool(rel) and resolve(folder, rel).is_file()
            except ProjectError:
                ok = False
            if not ok:
                problems.append({"slideIndex": si, "elementId": el.get("id"), "var": el.get("var"),
                                 "message": f"スライド{si + 1}: {'SVG' if el.get('type') == 'shape' else '画像'}「{el.get('var')}」のファイルが見つかりません: {rel or '（未指定）'}"})
    return problems
