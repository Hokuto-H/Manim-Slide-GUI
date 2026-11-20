"""動きのプリセット（自分で保存したもの）。ユーザー用設定フォルダの presets.json に置き、どのプロジェクトでも使う。

1 つのプリセット: {"id", "name", "steps": [[動きの行, …], …]}（steps の 1 つが 1 クリック）。
動きの行の target は "@"（当てる要素）。ほかの要素・カメラを動かす行は保存しない。
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from . import animgen
from .userconfig import config_dir

MAX = 200


def _file():
    return config_dir() / "presets.json"


def _norm_row(r: Any) -> dict[str, Any] | None:
    if not isinstance(r, dict) or r.get("kind") == "code":
        return None
    out = animgen.normalize_row({**r, "target": "@"})
    if not out:
        return None
    if out["kind"] == "anim":
        spec = animgen.CATALOG_BY_ID.get(out["anim"], {})
        if spec.get("target", "element") != "element":
            return None  # カメラ・値・動画などの動きは、要素に当てられない
        out["target"] = "@"
        out.pop("part", None)  # 一部分の指定は、その要素だけのもの
        for p in spec.get("params", []):  # ほかの要素を指す値は持ち越さない
            if p["type"] == "elem":
                out["params"][p["key"]] = ""
    out.pop("id", None)
    return out


def _norm(p: Any) -> dict[str, Any] | None:
    if not isinstance(p, dict):
        return None
    steps = []
    for st in p.get("steps") or []:
        rows = [x for x in (_norm_row(r) for r in (st if isinstance(st, list) else [])) if x]
        if any(r["kind"] == "anim" for r in rows):
            steps.append(rows)
    name = str(p.get("name") or "").strip()[:60]
    if not steps or not name:
        return None
    return {"id": str(p.get("id") or secrets.token_hex(4)), "name": name, "steps": steps[:20]}


def load() -> list[dict[str, Any]]:
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [x for x in (_norm(p) for p in data if isinstance(data, list)) if x] if isinstance(data, list) else []


def _save(items: list[dict[str, Any]]) -> None:
    f = _file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(f)


def add(p: dict[str, Any]) -> list[dict[str, Any]]:
    item = _norm({**p, "id": None})
    if not item:
        raise ValueError("保存できる動きがありません（この要素を動かす行が要ります。コードの行・ほかの要素やカメラの動きは保存しません）。")
    items = [x for x in load() if x["name"] != item["name"]]  # 同じ名前は置き換える
    items.append(item)
    _save(items[-MAX:])
    return load()


def delete(pid: str) -> list[dict[str, Any]]:
    _save([x for x in load() if x["id"] != pid])
    return load()


def rename(pid: str, name: str) -> list[dict[str, Any]]:
    name = name.strip()[:60]
    if not name:
        raise ValueError("名前を入れてください。")
    items = load()
    for x in items:
        if x["id"] == pid:
            x["name"] = name
    _save(items)
    return load()
