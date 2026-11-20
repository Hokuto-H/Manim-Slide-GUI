"""子プロセスの共通設定。

Windows では、パイプにつないだ Python の標準出力が既定で cp932（Shift_JIS）になるため、
受け取る側（UTF-8 で読む）と食い違って日本語が文字化けする。子プロセスはすべて、
この環境変数で UTF-8 に統一して起動する。
"""

from __future__ import annotations

import os
import subprocess
import sys


def child_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update({
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",           # Windows の既定コードページ（cp932）による文字化け・エラーを防ぐ
        "PYTHONDONTWRITEBYTECODE": "1",
        "COLUMNS": "160",
        "NO_COLOR": "1",
        "TERM": "dumb",
    })
    return env


def no_window_flags() -> int:
    """Windows で、子プロセスのコンソール画面を出さないためのフラグ。"""
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
