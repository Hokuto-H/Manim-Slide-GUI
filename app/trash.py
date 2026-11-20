"""フォルダを OS のごみ箱へ移す（新しいライブラリは使わない）。

Windows : シェルの SHFileOperationW（FOF_ALLOWUNDO）。ごみ箱が無い場所（ネットワーク・USB などの取り外せるドライブ）は、
          完全に消えてしまうため、移さずに断る（念のため FOF_WANTNUKEWARNING も付け、完全に消える場合は Windows が確かめる）。
macOS   : ~/.Trash へ移す。
Linux   : freedesktop.org のごみ箱（~/.local/share/Trash）へ移す。
"""

from __future__ import annotations

import os
import shutil
import sys
import time
import urllib.parse
from pathlib import Path


class TrashError(Exception):
    pass


def _windows(path: Path) -> None:
    import ctypes  # noqa: PLC0415
    from ctypes import wintypes  # noqa: PLC0415

    p = str(path)
    if p.startswith("\\\\"):
        raise TrashError("ネットワーク上のフォルダはごみ箱へ移せません（エクスプローラーで削除してください）。")
    drive = os.path.splitdrive(p)[0]
    if drive:
        kind = ctypes.windll.kernel32.GetDriveTypeW(drive + "\\")
        if kind in (2, 4):  # DRIVE_REMOVABLE・DRIVE_REMOTE
            raise TrashError("このドライブ（ネットワーク・USB メモリなど）にはごみ箱が無いため、移せません。"
                             "エクスプローラーで削除してください。")

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR),
                    ("pTo", wintypes.LPCWSTR), ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL),
                    ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]

    op = SHFILEOPSTRUCTW()
    op.wFunc = 3  # FO_DELETE
    op.pFrom = p + "\0"  # 終わりは \0 が 2 つ（ctypes が 1 つ足す）
    op.fFlags = 0x40 | 0x10 | 0x04 | 0x400 | 0x4000  # ALLOWUNDO・NOCONFIRMATION・SILENT・NOERRORUI・WANTNUKEWARNING
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if op.fAnyOperationsAborted:
        raise TrashError("ごみ箱へ移すのを取りやめました。")
    if rc != 0:
        raise TrashError(f"ごみ箱へ移せませんでした（コード 0x{rc:X}。ほかのアプリでファイルを開いていないか確かめてください）。")


def _free_name(d: Path, name: str) -> str:
    cand, k = name, 2
    while (d / cand).exists():
        cand = f"{name}.{k}"
        k += 1
    return cand


def _mac(path: Path) -> None:
    d = Path.home() / ".Trash"
    d.mkdir(exist_ok=True)
    shutil.move(str(path), str(d / _free_name(d, path.name)))


def _xdg(path: Path) -> None:
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "Trash"
    files, info = base / "files", base / "info"
    files.mkdir(parents=True, exist_ok=True)
    info.mkdir(parents=True, exist_ok=True)
    name = _free_name(files, path.name)
    while (info / f"{name}.trashinfo").exists():
        name = _free_name(files, name + "_")
    (info / f"{name}.trashinfo").write_text(
        f"[Trash Info]\nPath={urllib.parse.quote(str(path))}\nDeletionDate={time.strftime('%Y-%m-%dT%H:%M:%S')}\n", encoding="utf-8")
    try:
        shutil.move(str(path), str(files / name))
    except OSError:
        (info / f"{name}.trashinfo").unlink(missing_ok=True)
        raise


def send_to_trash(path: Path) -> None:
    path = Path(os.path.abspath(path))
    if not path.exists():
        raise TrashError(f"見つかりません: {path}")
    try:
        if sys.platform == "win32":
            _windows(path)
        elif sys.platform == "darwin":
            _mac(path)
        else:
            _xdg(path)
    except TrashError:
        raise
    except OSError as e:
        raise TrashError(f"ごみ箱へ移せませんでした: {e}") from e
    if path.exists():
        raise TrashError("ごみ箱へ移せませんでした（一部のファイルが残っています。ほかのアプリで開いていないか確かめてください）。")
