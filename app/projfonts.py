"""プロジェクトに入れたフォント（プロジェクトのフォルダの fonts/）。

フォントのファイルをコピーしておき、プレビュー（常駐する Manim）と描画（書き出した .py）の両方で
manimpango.register_font で登録する。PC にインストールしなくても使え、持ち運び用の zip にも入る。
ファミリー名は、登録の前後の Pango のフォント一覧の差から求める（Pango に渡す名前と必ず一致する）。
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

FONT_DIR = "fonts"
EXTS = (".ttf", ".otf", ".ttc", ".otc")
CACHE = ".families.json"  # ファイル名 → ファミリー名（大きさと更新時刻が同じ間だけ使う）


class FontError(Exception):
    pass


def font_dir(folder: Path) -> Path:
    return Path(folder) / FONT_DIR


def files(folder: Path) -> list[Path]:
    d = font_dir(folder)
    if not d.is_dir():
        return []
    return sorted((p for p in d.iterdir() if p.is_file() and p.suffix.lower() in EXTS), key=lambda p: p.name.lower())


def _stamp(p: Path) -> str:
    st = p.stat()
    return f"{st.st_size}:{int(st.st_mtime)}"


def _read_cache(folder: Path) -> dict[str, Any]:
    try:
        return json.loads((font_dir(folder) / CACHE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_cache(folder: Path, data: dict[str, Any]) -> None:
    try:
        (font_dir(folder) / CACHE).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def listing(folder: Path, register) -> list[dict[str, Any]]:
    """fonts/ のファイルと、そのファミリー名。register(paths) → {path: [family, ...]} は、プレビューの Manim に登録する関数。"""
    fs = files(folder)
    found: dict[str, list[str]] = {}
    if fs:
        try:
            found = register([str(p) for p in fs]) or {}
        except Exception:  # noqa: BLE001 — プレビューが動かなくても、一覧は出す
            found = {}
    cache = _read_cache(folder)
    out, new_cache = [], {}
    for p in fs:
        fam = found.get(str(p))
        c = cache.get(p.name)
        if fam is None and c and c.get("stamp") == _stamp(p):
            fam = c.get("families")
        if fam:
            new_cache[p.name] = {"stamp": _stamp(p), "families": fam}
        out.append({"file": p.name, "families": fam or [], "bytes": p.stat().st_size})
    if fs:
        _write_cache(folder, new_cache)
    return out


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "font"
    return name


def add(folder: Path, sources: list[str]) -> list[str]:
    """フォントのファイルを fonts/ にコピーする。戻り値はコピーしたファイル名。"""
    d = font_dir(folder)
    d.mkdir(exist_ok=True)
    done = []
    for s in sources:
        src = Path(s)
        if not src.is_file():
            raise FontError(f"ファイルがありません: {src}")
        if src.suffix.lower() not in EXTS:
            raise FontError(f"フォントのファイル（{'・'.join(EXTS)}）ではありません: {src.name}")
        dest = d / _safe_name(src.name)
        try:
            if src.resolve() != dest.resolve():
                shutil.copy2(src, dest)
        except OSError as e:
            raise FontError(f"コピーできませんでした: {e}") from e
        done.append(dest.name)
    return done


def remove(folder: Path, name: str) -> None:
    p = font_dir(folder) / Path(name).name
    if p.suffix.lower() not in EXTS or not p.is_file():
        raise FontError(f"フォントのファイルがありません: {name}")
    try:
        p.unlink()
    except OSError as e:
        raise FontError(f"削除できませんでした（描画中などで使われている可能性があります）: {e}") from e


def file_path(folder: Path, name: str) -> Path | None:
    p = font_dir(folder) / Path(name).name
    return p if p.suffix.lower() in EXTS and p.is_file() else None


# 書き出す .py の頭に入れる文（.py と同じフォルダの fonts/ を登録する）
REGISTER_CODE = [
    "# プロジェクトに入れたフォント（fonts/）を、インストールせずに使えるように登録する",
    "import manimpango as _gui_mp",
    "from pathlib import Path as _GuiPath",
    "for _gui_f in sorted((_GuiPath(__file__).resolve().parent / 'fonts').glob('*')):",
    f"    if _gui_f.suffix.lower() in {EXTS!r}:",
    "        _gui_mp.register_font(str(_gui_f))",
]
