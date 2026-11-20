"""アプリのユーザー用設定フォルダ（ローカル）の読み書き。

Windows では %APPDATA%\\ManimSlideGUI、それ以外では ~/.config/manim-slide-gui を使う。
- config.json: 前回の保存先など
- template_preamble.tex: 自分の定番プリアンブル（新規作成時にプロジェクトへコピーする）
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def config_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
        d = base / "ManimSlideGUI"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
        d = base / "manim-slide-gui"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _config_file() -> Path:
    return config_dir() / "config.json"


def _template_file() -> Path:
    return config_dir() / "template_preamble.tex"


def load() -> dict[str, Any]:
    data: dict[str, Any] = {}
    f = _config_file()
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    tf = _template_file()
    data["templatePreamble"] = tf.read_text(encoding="utf-8") if tf.exists() else None
    data.setdefault("lastDir", str(Path.home()))
    data.setdefault("recentProjects", [])
    if data.get("presentWindow") not in ("maximized", "fullscreen", "normal"):
        data["presentWindow"] = "maximized"  # 発表ウィンドウの開き方
    if data.get("presentInfo") not in ("auto", "show", "hide"):
        data["presentInfo"] = "auto"  # 発表者用の情報ウィンドウ（auto: 画面が2つ以上のときだけ）
    return data


def save(updates: dict[str, Any]) -> dict[str, Any]:
    current = load()
    template = updates.pop("templatePreamble", "__keep__")
    current.pop("templatePreamble", None)
    current.update(updates)
    _config_file().write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    if template != "__keep__":
        tf = _template_file()
        if template is None:
            tf.unlink(missing_ok=True)
        else:
            tf.write_text(template, encoding="utf-8", newline="\n")
    return load()


def remember_project(path: Path) -> None:
    cfg = load()
    recent = [p for p in cfg.get("recentProjects", []) if p != str(path)]
    recent.insert(0, str(path))
    save({"recentProjects": recent[:10], "lastDir": str(path.parent)})


def _same(a: str, b: str) -> bool:
    import os  # noqa: PLC0415
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def forget_project(path: Path | str) -> dict[str, Any]:
    """「最近のプロジェクト」から外す（フォルダはそのまま）。"""
    cfg = load()
    recent = [p for p in cfg.get("recentProjects", []) if not _same(p, str(path))]
    return save({"recentProjects": recent})


def documents_dir() -> Path:
    """ユーザーの「ドキュメント」フォルダ（Windows は OneDrive へ移した場合も、本当の場所を聞く）。"""
    if sys.platform == "win32":
        try:
            import ctypes  # noqa: PLC0415
            from ctypes import wintypes  # noqa: PLC0415

            class GUID(ctypes.Structure):
                _fields_ = [("d1", wintypes.DWORD), ("d2", wintypes.WORD), ("d3", wintypes.WORD), ("d4", ctypes.c_ubyte * 8)]
            # FOLDERID_Documents {FDD39AD0-238F-46AF-ADB4-6C85480369C7}
            fid = GUID(0xFDD39AD0, 0x238F, 0x46AF, (ctypes.c_ubyte * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))
            out = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(out)) == 0:
                path = Path(out.value)
                ctypes.windll.ole32.CoTaskMemFree(out)
                if path.is_dir():
                    return path
        except Exception:  # noqa: BLE001
            pass
    d = Path.home() / "Documents"
    return d if d.is_dir() else Path.home()
