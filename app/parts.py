"""部品（要素のテンプレート）。ユーザー用設定フォルダの parts/<id>.json に保存して、どのプロジェクトでも使う。

  {"id", "name", "updatedAt": 保存した時刻（秒）, "elements": [要素（位置は部品の中心からのずれ、px）], "thumb": "data:image/png…"}

置いた部品は、プロジェクトの "parts" に写しを持つ（project.json だけで描けて、zip でも持ち運べる）。
テンプレートを直す（同じ id で上書きする）と、開いているプロジェクトの写しも新しくし、置いた所がすべて変わる。
ほかのプロジェクトは、開いたときに、写しより新しいテンプレートがあれば新しくする。
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from .project import ProjectError, part_child_ok
from .userconfig import config_dir

_ID = re.compile(r"^[A-Za-z0-9_-]{1,60}$")


def _root() -> Path:
    d = config_dir() / "parts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(pid: str) -> Path:
    if not _ID.match(str(pid or "")):
        raise ProjectError("部品の id が正しくありません。")
    return _root() / f"{pid}.json"


def _read(p: Path) -> dict[str, Any] | None:
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and d.get("id") else None
    except (OSError, ValueError):
        return None


def list_all() -> list[dict[str, Any]]:
    """部品の一覧（新しい順）。中身も返す（置くとき・プロジェクトの写しを新しくするときに使う）。"""
    out = [d for d in (_read(p) for p in _root().glob("*.json")) if d]
    out.sort(key=lambda d: -float(d.get("updatedAt") or 0))
    return out


def get(pid: str) -> dict[str, Any]:
    d = _read(_path(pid))
    if not d:
        raise ProjectError("部品が見つかりません。")
    return d


def save(name: Any, elements: list[dict[str, Any]], thumb: str = "", pid: str | None = None) -> dict[str, Any]:
    """部品を保存する。pid を渡すと、その部品を上書きする（置いた所もすべて変わる）。"""
    n = str(name or "").strip()
    if not n or len(n) > 40:
        raise ProjectError("部品の名前を 1〜40 文字で入れてください。")
    kids = [e for e in elements if isinstance(e, dict)]
    bad = [str(e.get("var") or "?") for e in kids if not part_child_ok(e)]
    if bad:
        raise ProjectError(f"部品に入れられない要素があります: {'、'.join(bad[:5])}（入れられるのは、テキスト・数式と、"
                           "ほかの要素に付かない図形です。画像・動画・座標軸に付くグラフなどは入れられません）。")
    if not kids:
        raise ProjectError("部品にする要素がありません。")
    pid = pid or uuid.uuid4().hex[:12]
    old = _read(_path(pid))
    d = {"id": pid, "name": n, "updatedAt": time.time(), "elements": kids,
         "thumb": thumb if isinstance(thumb, str) and thumb.startswith("data:image/") else (old or {}).get("thumb", "")}
    _path(pid).write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return d


def rename(pid: str, name: Any) -> dict[str, Any]:
    d = get(pid)
    n = str(name or "").strip()
    if not n or len(n) > 40:
        raise ProjectError("部品の名前を 1〜40 文字で入れてください。")
    d["name"] = n
    _path(pid).write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return d


def delete(pid: str) -> None:
    p = _path(pid)
    if p.exists():
        p.unlink()


def refresh_project(data: dict[str, Any]) -> list[str]:
    """プロジェクトの写しのうち、テンプレートの方が新しいものを新しくする。返す: 新しくした部品の名前。"""
    names = []
    by_id = {d["id"]: d for d in list_all()}
    for i, p in enumerate(data.get("parts") or []):
        t = by_id.get(p.get("id"))
        if t and float(t.get("updatedAt") or 0) > float(p.get("updatedAt") or 0) + 1e-6:
            data["parts"][i] = {"id": t["id"], "name": t["name"], "updatedAt": t["updatedAt"], "elements": t["elements"]}
            names.append(t["name"])
    return names
