"""出力設定の保存（「ファイルに出力…」の形式とその設定に名前を付けたもの）。ユーザー用設定フォルダの export_presets.json。
どのプロジェクトでも使う。1 つ: {"id", "name", "body": /api/convert に渡す中身（allowDownload を除く）}"""

from __future__ import annotations

import json
import secrets
from typing import Any

from .userconfig import config_dir

FORMATS = ("html", "pdf", "pptx", "mp4", "handout", "png", "gif")
KEYS = ("format", "oneFile", "pdfPages", "wait", "srt", "srtMode", "layout", "paper", "orient", "unit", "pages", "width", "fps")


def _file():
    return config_dir() / "export_presets.json"


def _norm(p: Any) -> dict[str, Any] | None:
    if not isinstance(p, dict) or not isinstance(p.get("body"), dict):
        return None
    body = {k: p["body"][k] for k in KEYS if k in p["body"]}
    name = str(p.get("name") or "").strip()[:60]
    if body.get("format") not in FORMATS or not name:
        return None
    return {"id": str(p.get("id") or secrets.token_hex(4)), "name": name, "body": body}


def load() -> list[dict[str, Any]]:
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [x for x in (_norm(p) for p in data) if x] if isinstance(data, list) else []


def _save(items: list[dict[str, Any]]) -> None:
    f = _file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)


def add(p: dict[str, Any]) -> list[dict[str, Any]]:
    item = _norm({**p, "id": None})
    if not item:
        raise ValueError("名前と出力の形式が要ります。")
    items = [x for x in load() if x["name"] != item["name"]]  # 同じ名前は置き換える
    items.append(item)
    _save(items[-100:])
    return load()


def delete(pid: str) -> list[dict[str, Any]]:
    _save([x for x in load() if x["id"] != pid])
    return load()
