"""リハーサルの記録（発表ウィンドウの present_deck.py が <プロジェクト>/rehearsals/ に残す）の一覧・読み込み・削除。

記録の形: {"created", "scene", "total"（秒）, "segments": [{"t", "dur", "seg", "key", "slide", "page"}], "pages": [{"slide", "page", "time", "title", ...}]}
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

DIR = "rehearsals"
_NAME = re.compile(r"^[\w.\-]+\.json$")


def _dir(folder: Path) -> Path:
    return folder / DIR


def items(folder: Path) -> list[dict[str, Any]]:
    out = []
    d = _dir(folder)
    if d.is_dir():
        for f in sorted(d.glob("*.json"), reverse=True):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append({"id": f.name, "created": data.get("created", ""), "total": float(data.get("total") or 0),
                        "pages": data.get("pages") or [], "segments": data.get("segments") or [], "scene": data.get("scene", "")})
    out.sort(key=lambda x: x["created"], reverse=True)
    return out


def delete(folder: Path, name: str) -> None:
    if not _NAME.match(name or ""):
        raise ValueError("記録の名前が正しくありません。")
    (_dir(folder) / name).unlink(missing_ok=True)


def video_waits(folder: Path, cls: str, rec: dict[str, Any]) -> dict[str, float]:
    """リハーサルで区切りに居た時間から、その区切りの動画の長さを引いたもの（＝クリックを待った時間）を、区切りの元ごとに。
    動画（mp4）の書き出しの待ち時間に使う。今の描画結果と区切りの数が合わなければ空。"""
    from .video_export import _duration
    try:
        cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
        keys = json.loads((folder / "slides" / "gui_pages" / f"{cls}.segs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    segs = cfg.get("slides") or []
    if len(keys) != len(segs):
        return {}
    spent: dict[str, float] = {}
    for sg in rec.get("segments") or []:
        j, key = sg.get("seg"), sg.get("key")
        if not isinstance(j, int) or not (0 <= j < len(segs)) or not key or keys[j] != key:
            continue
        spent[key] = spent.get(key, 0.0) + float(sg.get("dur") or 0)
    out: dict[str, float] = {}
    for j, key in enumerate(keys):
        if key in spent and key not in out:
            try:
                dur = _duration(folder / str(segs[j].get("file") or ""))
            except Exception:  # noqa: BLE001
                continue
            out[key] = round(max(0.0, spent[key] - dur), 1)
    return out
