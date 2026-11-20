"""テンプレート（ユーザー用設定フォルダに保存して、プロジェクトをまたいで使い回す）。

- 設定のテンプレート: templates/settings/<名前>.json
  {"name", "settings": {背景色・既定のフォント・文字サイズ・文字色・換算係数・3D・ページ番号}, "preamble": 文字列 | null}
- スライドの型: templates/slides/<名前>/slide.json（スライドの中身と、サムネイル）と、使っているファイル（画像・SVG・動画・音声）を
  プロジェクトと同じ相対パスで templates/slides/<名前>/files/ に写したもの。使うときに、プロジェクトのフォルダへ写す。
"""

from __future__ import annotations

import filecmp
import json
import re
import shutil
from pathlib import Path
from typing import Any

from .project import ProjectError
from .userconfig import config_dir

SETTING_KEYS = ("background", "defaultFont", "defaultFontSize", "defaultColor", "fontSizeScale", "use3d", "pageNumbers", "texFont", "view3d")
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _root(kind: str) -> Path:
    d = config_dir() / "templates" / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def _name(name: Any) -> str:
    n = str(name or "").strip()
    if not n or len(n) > 60 or _BAD.search(n) or n in (".", ".."):
        raise ProjectError("テンプレートの名前に使えない文字があります（空・60 文字より長い・\\ / : * ? \" < > | は使えません）。")
    return n


# ---------------------------------------------------------------- 設定

def list_all() -> dict[str, Any]:
    settings = []
    for f in sorted(_root("settings").glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            settings.append({"name": d.get("name") or f.stem, "settings": d.get("settings") or {}, "hasPreamble": d.get("preamble") is not None})
        except (OSError, ValueError):
            continue
    slides = []
    for d in sorted(p for p in _root("slides").iterdir() if p.is_dir()):
        try:
            j = json.loads((d / "slide.json").read_text(encoding="utf-8"))
            slides.append({"name": j.get("name") or d.name, "thumb": j.get("thumb") or "", "count": len(j.get("slide", {}).get("elements", []))})
        except (OSError, ValueError):
            continue
    return {"settings": settings, "slides": slides}


def save_settings(name: Any, settings: dict[str, Any], preamble: str | None) -> dict[str, Any]:
    n = _name(name)
    data = {"name": n, "settings": {k: settings[k] for k in SETTING_KEYS if k in settings},
            "preamble": preamble if isinstance(preamble, str) else None}
    (_root("settings") / f"{n}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


def get_settings(name: Any) -> dict[str, Any]:
    f = _root("settings") / f"{_name(name)}.json"
    if not f.is_file():
        raise ProjectError("テンプレートが見つかりません。")
    return json.loads(f.read_text(encoding="utf-8"))


def delete(kind: str, name: Any) -> None:
    n = _name(name)
    if kind == "settings":
        (_root("settings") / f"{n}.json").unlink(missing_ok=True)
    else:
        shutil.rmtree(_root("slides") / n, ignore_errors=True)


# ---------------------------------------------------------------- スライドの型

FILE_TYPES = ("image", "media")


def _files_of(slide: dict[str, Any]) -> list[str]:
    """スライドの要素が使っている、プロジェクトのフォルダの中のファイル（相対パス）。"""
    out = []
    for e in slide.get("elements", []):
        if e.get("type") in FILE_TYPES or (e.get("type") == "shape" and e.get("shape") == "svg"):
            p = str(e.get("path") or "").replace("\\", "/")
            if p and not p.startswith("/") and ".." not in p.split("/"):
                out.append(p)
    return sorted(set(out))


def save_slide(name: Any, slide: dict[str, Any], folder: Path, thumb: str = "") -> dict[str, Any]:
    n = _name(name)
    d = _root("slides") / n
    if d.exists():
        shutil.rmtree(d)
    (d / "files").mkdir(parents=True)
    copied = []
    for rel in _files_of(slide):
        src = folder / rel
        if src.is_file():
            dst = d / "files" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied.append(rel)
    (d / "slide.json").write_text(json.dumps({"name": n, "slide": slide, "thumb": thumb if thumb.startswith("data:image/") else ""},
                                             ensure_ascii=False), encoding="utf-8")
    return {"name": n, "files": copied}


def use_slide(name: Any, folder: Path) -> dict[str, Any]:
    """スライドの型の中身を返し、使っているファイルをプロジェクトのフォルダへ写す。同じ名前で中身の違うファイルがあれば、
    名前を変えて写し、要素の path も付け替える。"""
    d = _root("slides") / _name(name)
    j = json.loads((d / "slide.json").read_text(encoding="utf-8"))
    slide = j["slide"]
    renames: dict[str, str] = {}
    for rel in _files_of(slide):
        src = d / "files" / rel
        if not src.is_file():
            continue
        dst = folder / rel
        new = rel
        if dst.exists() and not filecmp.cmp(src, dst, shallow=False):
            # 同じ名前で中身が違う: 前に写した同じ中身のファイル（x_2.png など）があればそれを使い、無ければ空いている名前で写す
            stem, suf, k = dst.stem, dst.suffix, 2
            while (dst.parent / f"{stem}_{k}{suf}").exists() and not filecmp.cmp(src, dst.parent / f"{stem}_{k}{suf}", shallow=False):
                k += 1
            dst = dst.parent / f"{stem}_{k}{suf}"
            new = str(Path(rel).parent / dst.name).replace("\\", "/")
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        if new != rel:
            renames[rel] = new
    for e in slide.get("elements", []):
        p = str(e.get("path") or "").replace("\\", "/")
        if p in renames:
            e["path"] = renames[p]
    return {"slide": slide, "renames": renames}
