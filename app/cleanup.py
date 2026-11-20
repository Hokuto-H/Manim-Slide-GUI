"""使っていない画像・動画・音声のファイルの整理。

プロジェクトの images/・clips/ の中のファイルを、次のように分ける。
- used: 今のスライドで使っている（要素のパス、またはステップのコードなどにファイルの名前が書いてある）
- kept: 今のスライドでは使っていないが、バックアップ（backups/）や「元に戻す」の履歴では使っている
        （整理すると、そのバックアップに戻したときや元に戻したときに、ファイルが足りなくなる）
- unused: どこでも使っていない
整理は、プロジェクトの unused/ フォルダへ移す（images/・clips/ の区別は残す）。unused/ から元に戻す・完全に削除するもできる。
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .backup import backup_dir
from .images import IMAGES_DIR
from .media import CLIPS_DIR

UNUSED_DIR = "unused"
DIRS = (IMAGES_DIR, CLIPS_DIR)


def _files(base: Path) -> list[Path]:
    out = []
    for d in DIRS:
        root = base / d
        if root.is_dir():
            # 「.」で始まるフォルダ（.posters など、アプリが作る仮のファイル）は数えない
            out += [p for p in root.rglob("*") if p.is_file() and not p.name.endswith(".part")
                    and not any(x.startswith(".") for x in p.relative_to(root).parts)]
    return sorted(out)


def _kind(p: Path) -> str:
    ext = p.suffix.lower()
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tif", ".tiff"):
        return "image"
    if ext in (".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"):
        return "audio"
    return "video"


def _mentions(text: str, rel: str) -> bool:
    """JSON の文字列の中に、そのファイルのパス（または名前）が書いてあるか。"""
    name = rel.rsplit("/", 1)[-1]
    return rel in text or json.dumps(name)[1:-1] in text


def scan(folder: Path, project: dict[str, Any], history_paths: list[str] | None = None) -> dict[str, Any]:
    proj_text = json.dumps(project, ensure_ascii=False)
    backups = []
    bd = backup_dir(folder)
    if bd.is_dir():
        for f in sorted(bd.glob("*.json")):
            try:
                backups.append((f.name, f.read_text(encoding="utf-8")))
            except OSError:
                continue
    hist = set(history_paths or [])
    items = []
    for p in _files(folder):
        rel = p.relative_to(folder).as_posix()
        status, where = "unused", []
        if _mentions(proj_text, rel):
            status = "used"
        else:
            nb = sum(1 for _n, t in backups if _mentions(t, rel))
            if nb:
                where.append(f"バックアップ {nb} 個")
            if rel in hist:
                where.append("元に戻すの履歴")
            if where:
                status = "kept"
        items.append({"path": rel, "name": p.name, "kind": _kind(p), "size": p.stat().st_size, "status": status, "where": where})
    trash = []
    ud = folder / UNUSED_DIR
    if ud.is_dir():
        for p in sorted(ud.rglob("*")):
            if p.is_file():
                rel = p.relative_to(ud).as_posix()
                trash.append({"path": rel, "name": p.name, "kind": _kind(p), "size": p.stat().st_size,
                              "needed": _mentions(proj_text, rel), "conflict": (folder / rel).exists()})
    return {"items": items, "trash": trash, "trashSize": sum(t["size"] for t in trash), "unusedDir": str(ud)}


def _safe(folder: Path, rel: str, base: Path) -> Path:
    p = (base / rel).resolve()
    root = base.resolve()
    if root not in p.parents or not rel or rel.split("/", 1)[0] not in DIRS:
        raise ValueError(f"ファイルの場所が正しくありません: {rel}")
    return p


def _free(dest: Path) -> Path:
    """同じ名前があれば、名前の後ろに番号を付ける。"""
    if not dest.exists():
        return dest
    k = 2
    while True:
        cand = dest.with_name(f"{dest.stem}_{k}{dest.suffix}")
        if not cand.exists():
            return cand
        k += 1


def move_to_unused(folder: Path, paths: list[str]) -> int:
    n = 0
    for rel in paths:
        src = _safe(folder, rel, folder)
        if not src.is_file():
            continue
        dest = _free(folder / UNUSED_DIR / rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        n += 1
    return n


def restore(folder: Path, paths: list[str]) -> dict[str, Any]:
    """unused/ から元の場所へ戻す。元の場所に同じ名前があるものは、戻さない。"""
    done, skipped = 0, []
    for rel in paths:
        src = _safe(folder, rel, folder / UNUSED_DIR)
        if not src.is_file():
            continue
        dest = folder / rel
        if dest.exists():
            skipped.append(rel)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        done += 1
    return {"restored": done, "skipped": skipped}


def purge(folder: Path, paths: list[str] | None) -> int:
    """unused/ の中を、完全に削除する（paths が None なら全部）。"""
    ud = folder / UNUSED_DIR
    if not ud.is_dir():
        return 0
    n = 0
    targets = [p for p in ud.rglob("*") if p.is_file()] if paths is None else [_safe(folder, r, ud) for r in paths]
    for p in targets:
        if p.is_file():
            p.unlink()
            n += 1
    for d in sorted((x for x in ud.rglob("*") if x.is_dir()), key=lambda x: -len(x.parts)):
        try:
            d.rmdir()
        except OSError:
            pass
    return n
