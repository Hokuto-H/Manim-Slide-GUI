"""導入済みフォントの確認。

Manim の Text は Pango で描画するため、Pango から見えるファミリー名（manimpango.list_fonts()）を
第一の情報源とする。取得できない場合は、Windows のレジストリのフォント一覧で代用する。
manimpango の読み込みは重いことがあるため、子プロセスで実行して結果をキャッシュする。
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from typing import Any

from .constants import FONT_PRESETS
from .procutil import child_env

_cache: dict[str, Any] | None = None
_lock = threading.Lock()


def _pango_fonts() -> list[str] | None:
    code = "import json, manimpango; print(json.dumps(sorted(set(manimpango.list_fonts()))))"
    try:
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=60, env=child_env(),
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0)
        if out.returncode == 0:
            return json.loads(out.stdout.decode("utf-8", errors="replace"))
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        pass
    return None


def _registry_fonts() -> list[str]:
    """Windows のレジストリから、フォントの表示名（"(TrueType)" などを除く）を集める。"""
    if sys.platform != "win32":
        return []
    import re
    import winreg  # noqa: PLC0415

    names: set[str] = set()
    key_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, key_path) as k:
                i = 0
                while True:
                    try:
                        name, _, _ = winreg.EnumValue(k, i)
                    except OSError:
                        break
                    i += 1
                    name = re.sub(r"\s*\((TrueType|OpenType|All res)\)\s*$", "", name)
                    for part in name.split("&"):
                        part = re.sub(r"\s+(Regular|Bold|Light|Medium|Thin|Black|ExtraLight|SemiBold|ExtraBold|Italic)$", "", part.strip())
                        if part:
                            names.add(part)
        except OSError:
            continue
    return sorted(names)


def installed(refresh: bool = False) -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is not None and not refresh:
            return _cache
        families = _pango_fonts()
        source = "pango"
        if families is None:
            families = _registry_fonts()
            source = "registry" if families else "none"
        _cache = {"families": families, "source": source}
        return _cache


def _has(families_lower: set[str], name: str) -> bool:
    n = name.lower()
    return n in families_lower or any(f.startswith(n + " ") for f in families_lower)


def presets(refresh: bool = False) -> dict[str, Any]:
    """プリセットごとに、導入済みかどうかと、Pango に渡す名前を返す。"""
    info = installed(refresh)
    lower = {f.lower() for f in info["families"]}
    out = []
    for p in FONT_PRESETS:
        found = next((c for c in p["candidates"] if c.lower() in lower), None)
        if found is None:
            found = next((c for c in p["candidates"] if _has(lower, c)), None)
        out.append({
            "id": p["id"], "label": p["label"], "candidates": p["candidates"], "generic": p["generic"],
            "installed": found is not None if info["source"] != "none" else None,
            "family": found or p["candidates"][0],
        })
    return {"presets": out, "source": info["source"], "count": len(info["families"]),
            "families": [f for f in info["families"] if not f.startswith("@")]}


def is_installed(family: str) -> bool | None:
    info = installed()
    if info["source"] == "none":
        return None
    return family.lower() in {f.lower() for f in info["families"]}


def resolve(family: str | None) -> str | None:
    """描画に使う名前。プリセットの候補の名前（Noto Sans CJK JP など）で、この PC に無ければ、
    同じプリセットの、この PC にある候補（Noto Sans JP など）にする。プロジェクトの値は書き換えない。"""
    if not family:
        return family
    info = installed()
    if info["source"] == "none":
        return family
    lower = {f.lower() for f in info["families"]}
    if family.lower() in lower:
        return family
    for p in FONT_PRESETS:
        if family in p["candidates"]:
            alt = next((c for c in p["candidates"] if c.lower() in lower), None) or next((c for c in p["candidates"] if _has(lower, c)), None)
            return alt or family
    return family


def resolve_in(obj):
    """要素・設定（の写し）の中の font・defaultFont を、描画に使う名前にする（入れ子の中身・部品の中も）。"""
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if k in ("font", "defaultFont", "labelFont") and isinstance(v, str):
                obj[k] = resolve(v)
            elif isinstance(v, (dict, list)):
                resolve_in(v)
    elif isinstance(obj, list):
        for v in obj:
            resolve_in(v)
    return obj


def pc_families() -> list[str]:
    """この PC のフォント（縦書き用の @ で始まる名前は除く）。"""
    return [f for f in installed()["families"] if not f.startswith("@")]
