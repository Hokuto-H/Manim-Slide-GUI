"""OS のフォルダ・ファイル選択ダイアログ（ブラウザからはローカルのパスを選べないため、サーバー側で開く）。

tkinter はスレッドをまたいで使えないため、毎回子プロセスで開く。
"""

from __future__ import annotations

import os
import subprocess
import sys

from .procutil import child_env

_SCRIPT = r"""
import sys, tkinter as tk
from tkinter import filedialog
mode, initial, title, name = sys.argv[1], sys.argv[2] or None, sys.argv[3], sys.argv[4]
root = tk.Tk()
root.withdraw()
try:
    root.attributes("-topmost", True)
except Exception:
    pass
root.update()
types = [("zip ファイル", "*.zip"), ("すべてのファイル", "*.*")]
if mode == "folder":
    path = filedialog.askdirectory(initialdir=initial, title=title, mustexist=True)
elif mode == "open-zip":
    path = filedialog.askopenfilename(initialdir=initial, title=title, filetypes=types)
elif mode == "open-fonts":
    ft = [("フォント", "*.ttf *.otf *.ttc *.otc *.TTF *.OTF *.TTC *.OTC"), ("すべてのファイル", "*.*")]
    path = "\n".join(filedialog.askopenfilenames(initialdir=initial, title=title, filetypes=ft) or [])
else:
    path = filedialog.asksaveasfilename(initialdir=initial, title=title, initialfile=name,
                                        defaultextension=".zip", filetypes=types)
root.destroy()
# 文字コードに左右されないよう、UTF-8 のバイト列として書き出す
sys.stdout.buffer.write((path or "").encode("utf-8"))
sys.stdout.flush()
"""


def _run(mode: str, initial: str, title: str, name: str = "") -> str | None:
    try:
        p = subprocess.run([sys.executable, "-c", _SCRIPT, mode, initial or "", title, name],
                           capture_output=True, timeout=600, env=child_env())
    except (OSError, subprocess.TimeoutExpired):
        return None
    if p.returncode != 0:
        return None
    path = p.stdout.decode("utf-8", errors="replace").strip()
    # tkinter は区切りに "/" を返すので、Windows の表記（"\\"）にそろえる（複数のときは 1 行に 1 つ）
    return "\n".join(os.path.normpath(x) for x in path.split("\n") if x) if path else ""


def choose_folder(initial: str = "", title: str = "フォルダを選択") -> str | None:
    """選ばれたフォルダの絶対パス。キャンセル時は ""、ダイアログを開けない場合は None。"""
    return _run("folder", initial, title)


def choose_zip_open(initial: str = "", title: str = "zip ファイルを選択") -> str | None:
    return _run("open-zip", initial, title)


def choose_zip_save(initial: str = "", name: str = "", title: str = "保存する場所を選択") -> str | None:
    return _run("save-zip", initial, title, name)


def choose_font_files(initial: str = "", title: str = "フォントのファイルを選択（複数可）") -> list[str] | None:
    """選ばれたフォントのファイル。キャンセル時は []、ダイアログを開けない場合は None。"""
    r = _run("open-fonts", initial, title)
    return None if r is None else [x for x in r.split("\n") if x]
