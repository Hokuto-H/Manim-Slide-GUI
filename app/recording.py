"""発表の録画（操作アプリの側）: 録画の設定、録画の一覧、動画への組み立て（record_compose.py を別のプロセスで）。

録画そのものは、発表ウィンドウ（present_record.py）が <プロジェクト>/recordings/.raw/<名前>/ に残す。
録画が終わる（done ができる）と、ここで自動で組み立てて <プロジェクト>/recordings/<名前>.mp4 にする。
発表ウィンドウが途中で落ちた（done が無いまま、発表ウィンドウが閉じた）録画も、残った記録の所まで組み立てる。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from . import userconfig
from .procutil import child_env, no_window_flags

COMPOSER = Path(__file__).with_name("record_compose.py")
CORNERS = ("br", "bl", "tr", "tl")
DEFAULTS: dict[str, Any] = {
    "mic": True, "micId": "", "micName": "",
    "camera": False, "camId": "", "camName": "",
    "camCorner": "br", "camSize": 0.25, "camRound": True,
    "micVol": 1.0, "slideVol": 1.0, "slideSound": True,
}


def _num(v: Any, lo: float, hi: float, d: float) -> float:
    try:
        return min(hi, max(lo, float(v)))
    except (TypeError, ValueError):
        return d


def normalize(v: Any) -> dict[str, Any]:
    v = v if isinstance(v, dict) else {}
    out = dict(DEFAULTS)
    for k in ("mic", "camera", "camRound", "slideSound"):
        if k in v:
            out[k] = bool(v[k])
    for k in ("micId", "micName", "camId", "camName"):
        if isinstance(v.get(k), str):
            out[k] = v[k][:300]
    if v.get("camCorner") in CORNERS:
        out["camCorner"] = v["camCorner"]
    out["camSize"] = _num(v.get("camSize", out["camSize"]), 0.1, 0.5, 0.25)
    out["micVol"] = _num(v.get("micVol", 1.0), 0.0, 3.0, 1.0)
    out["slideVol"] = _num(v.get("slideVol", 1.0), 0.0, 3.0, 1.0)
    return out


def load_settings() -> dict[str, Any]:
    return normalize(userconfig.load().get("record"))


def save_settings(v: Any) -> dict[str, Any]:
    s = normalize({**load_settings(), **(v if isinstance(v, dict) else {})})
    userconfig.save({"record": s})
    return s


def write_present_cfg(folder: Path) -> Path:
    """発表ウィンドウに渡す録画の設定（マイク・カメラ）。"""
    s = load_settings()
    path = folder / "media" / "record.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({k: s[k] for k in ("mic", "micId", "micName", "camera", "camId", "camName")}, ensure_ascii=False),
                    encoding="utf-8")
    return path


_DEVICES_CODE = r"""
import json, os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from qtpy.QtGui import QGuiApplication
from qtpy.QtMultimedia import QMediaDevices
app = QGuiApplication([])
f = lambda ds: [{"id": bytes(d.id()).hex(), "name": d.description(), "default": d.isDefault()} for d in ds]
print("@@" + json.dumps({"mics": f(QMediaDevices.audioInputs()), "cams": f(QMediaDevices.videoInputs()),
                         "screens": len(app.screens())}, ensure_ascii=False))
"""


def screen_count() -> int | None:
    """つないでいるディスプレイの数（分からなければ None）。"""
    if sys.platform == "win32":
        try:
            import ctypes  # noqa: PLC0415
            n = int(ctypes.windll.user32.GetSystemMetrics(80))  # SM_CMONITORS（表示に使っているモニターの数）
            return n if n > 0 else None
        except (OSError, AttributeError):
            return None
    return None


def list_devices() -> dict[str, Any]:
    """このパソコンのマイク・カメラ（Qt で調べる。別のプロセスで）。"""
    try:
        r = subprocess.run([sys.executable, "-c", _DEVICES_CODE], capture_output=True, text=True, timeout=20,  # noqa: S603
                           env=child_env(), creationflags=no_window_flags(), encoding="utf-8", errors="replace")
        line = next((s for s in r.stdout.splitlines() if s.startswith("@@")), None)
        if line is None:
            return {"ok": False, "mics": [], "cams": [], "message": "マイク・カメラを調べられませんでした。" + (r.stderr or "")[-300:]}
        res = {"ok": True, **json.loads(line[2:])}
        # Qt を画面なし（offscreen）で動かすと画面は 1 つに見えるので、画面の数は OS に聞く
        res["screens"] = screen_count()
        return res
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        return {"ok": False, "mics": [], "cams": [], "message": f"マイク・カメラを調べられませんでした: {e}"}


# ---------------------------------------------------------------- 録画の一覧と組み立て

def rec_dir(folder: Path) -> Path:
    return folder / "recordings"


def raw_dir(folder: Path) -> Path:
    return rec_dir(folder) / ".raw"


def _read_json(p: Path) -> dict[str, Any] | None:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _head_tail(events: Path) -> tuple[dict[str, Any] | None, float, bool]:
    """記録の meta と、最後の時刻・mic/camera の有無。"""
    meta, last = None, 0.0
    try:
        with open(events, encoding="utf-8") as f:
            first = f.readline()
            meta = json.loads(first) if first else None
            size = events.stat().st_size
            f.seek(max(0, size - 4096))
            tail = f.read().splitlines()
        for line in reversed(tail):
            try:
                last = float(json.loads(line).get("t", 0))
                break
            except ValueError:
                continue
    except (OSError, ValueError):
        pass
    return meta, last, False


def _dir_size(d: Path) -> int:
    n = 0
    for p in d.rglob("*"):
        try:
            if p.is_file() and not p.is_symlink():
                n += p.stat().st_size
        except OSError:
            pass
    return n


class RecordManager:
    def __init__(self, get_folder: Callable[[], Path | None], presenting: Callable[[], bool]) -> None:
        self.get_folder, self.presenting = get_folder, presenting
        self.lock = threading.Lock()
        self.proc: subprocess.Popen | None = None
        self.cur: Path | None = None
        self.failed: set[str] = set()  # 自動では組み立て直さない（失敗した・止めた）
        threading.Thread(target=self._loop, daemon=True).start()

    # ---- 自動の組み立て

    def _loop(self) -> None:
        while True:
            time.sleep(2)
            try:
                self.auto()
            except Exception as e:  # noqa: BLE001 — 見張りは止めない
                print(f"[record] {e}", file=sys.stderr)

    def auto(self) -> None:
        folder = self.get_folder()
        if folder is None or not raw_dir(folder).is_dir():
            return
        with self.lock:
            if self.proc is not None and self.proc.poll() is None:
                return
            if self.proc is not None and self.cur is not None:
                self._check_crash(self.cur)
            self.proc = None
            self.cur = None
        for d in sorted(raw_dir(folder).iterdir()):
            if not d.is_dir() or not (d / "events.jsonl").is_file() or str(d) in self.failed:
                continue
            if not (d / "done").exists():
                # 発表ウィンドウが落ちた録画: 発表ウィンドウが閉じていて、しばらく書き足されていなければ、そこまでを使う
                if self.presenting() or time.time() - (d / "events.jsonl").stat().st_mtime < 10:
                    continue
                (d / "done").write_text("crash", encoding="utf-8")
            if (d / "compose.json").exists():
                continue
            self.compose(folder, d.name)
            return

    @staticmethod
    def _check_crash(d: Path) -> None:
        """組み立てのプロセスが、結果を書かずに終わったとき。"""
        comp = _read_json(d / "compose.json") or {}
        if comp.get("status") == "running":
            try:
                log = (d / "compose.log").read_text(encoding="utf-8", errors="replace")[-3000:]
            except OSError:
                log = ""
            (d / "compose.json").write_text(json.dumps({"status": "error", "message": "動画にする途中で止まりました。", "log": log},
                                                       ensure_ascii=False), encoding="utf-8")

    def compose(self, folder: Path, name: str) -> dict[str, Any]:
        d = raw_dir(folder) / name
        if not (d / "events.jsonl").is_file():
            return {"ok": False, "message": "録画の記録が見つかりません（消したか、記録を消して動画だけ残したものです）。"}
        if not (d / "done").exists():
            return {"ok": False, "message": "まだ録画中です。発表ウィンドウで録画を終えてから（Ctrl+Shift+R）組み立ててください。"}
        with self.lock:
            if self.proc is not None and self.proc.poll() is None:
                return {"ok": False, "message": "ほかの録画を動画にしています。終わってから、もう一度押してください。"}
            self.failed.discard(str(d))
            s = load_settings()
            (d / "settings.json").write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
            (d / "compose.json").write_text(json.dumps({"status": "running", "progress": 0.0, "message": "動画にする準備をしています…"},
                                                       ensure_ascii=False), encoding="utf-8")
            out = rec_dir(folder) / f"{name}.mp4"
            log = open(d / "compose.log", "wb")  # noqa: SIM115 — 子プロセスに渡す
            try:
                self.proc = subprocess.Popen([sys.executable, str(COMPOSER), str(d), str(out), str(d / "settings.json")],  # noqa: S603
                                             cwd=str(COMPOSER.parent), stdout=log, stderr=subprocess.STDOUT, env=child_env(),
                                             creationflags=no_window_flags())
            except OSError as e:
                (d / "compose.json").write_text(json.dumps({"status": "error", "message": f"動画にできませんでした: {e}"}, ensure_ascii=False),
                                                encoding="utf-8")
                return {"ok": False, "message": str(e)}
            finally:
                log.close()
            self.cur = d
        return {"ok": True}

    def cancel(self, folder: Path, name: str) -> dict[str, Any]:
        d = raw_dir(folder) / name
        with self.lock:
            if self.cur == d and self.proc is not None and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                self.proc = None
                self.cur = None
        self.failed.add(str(d))
        (d / "compose.json").write_text(json.dumps({"status": "cancelled", "message": "動画にするのをやめました。"}, ensure_ascii=False),
                                        encoding="utf-8")
        part = rec_dir(folder) / f"{name}.part.mp4"
        part.unlink(missing_ok=True)
        return {"ok": True}

    # ---- 一覧

    def running_name(self) -> str | None:
        with self.lock:
            if self.cur is not None and self.proc is not None and self.proc.poll() is None:
                return self.cur.name
        return None

    def items(self, folder: Path) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        running = self.running_name()
        names: set[str] = set()
        rd = raw_dir(folder)
        if rd.is_dir():
            for d in rd.iterdir():
                if not d.is_dir() or not (d / "events.jsonl").is_file():
                    continue
                names.add(d.name)
                meta, last, _ = _head_tail(d / "events.jsonl")
                comp = _read_json(d / "compose.json") or {}
                video = rec_dir(folder) / f"{d.name}.mp4"
                st = comp.get("status")
                if not (d / "done").exists():
                    status = "recording" if self.presenting() else "queued"
                elif st == "running":
                    status = "running" if running == d.name else "error"
                    if status == "error":
                        comp["message"] = "動画にする途中で止まりました。「動画にし直す」を押してください。"
                elif st in ("done", "error", "cancelled"):
                    status = st
                else:
                    status = "queued"
                if status == "done" and not video.is_file():
                    status, comp["message"] = "missing", "動画のファイルが見つかりません（移したか消したようです）。「動画にし直す」で作り直せます。"
                segs = list(d.glob("seg_*.mp4"))
                out.append({
                    "id": d.name, "created": (meta or {}).get("created", ""), "duration": float(comp.get("duration") or last),
                    "status": status, "progress": float(comp.get("progress") or 0.0), "message": comp.get("message", ""),
                    "video": video.name if video.is_file() else None, "videoSize": video.stat().st_size if video.is_file() else 0,
                    "raw": True, "rawSize": _dir_size(d), "mic": (meta or {}).get("mic", ""), "camera": (meta or {}).get("camera", ""),
                    "segments": len(segs), "crashed": (d / "done").exists() and (d / "done").read_text(encoding="utf-8", errors="replace") == "crash",
                })
        rdir = rec_dir(folder)
        if rdir.is_dir():
            for v in rdir.glob("*.mp4"):
                if v.stem in names or v.name.endswith(".part.mp4"):
                    continue
                out.append({"id": v.stem, "created": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(v.stat().st_mtime)), "duration": None,
                            "status": "done", "progress": 1.0, "message": "", "video": v.name, "videoSize": v.stat().st_size,
                            "raw": False, "rawSize": 0, "mic": "", "camera": "", "segments": 0, "crashed": False})
        out.sort(key=lambda x: x["created"], reverse=True)
        return out

    def delete(self, folder: Path, name: str, keep_video: bool) -> dict[str, Any]:
        if "/" in name or "\\" in name or name.startswith("."):
            return {"ok": False, "message": "名前が正しくありません。"}
        d = raw_dir(folder) / name
        if self.running_name() == name:
            self.cancel(folder, name)
        if d.is_dir() and not (d / "done").exists() and self.presenting():
            return {"ok": False, "message": "録画中の記録は消せません。発表ウィンドウで録画を終えてから消してください。"}
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
        if not keep_video:
            (rec_dir(folder) / f"{name}.mp4").unlink(missing_ok=True)
        self.failed.discard(str(d))
        return {"ok": True}


def open_video(path: Path) -> None:
    if sys.platform == "win32":
        os.startfile(str(path))  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])  # noqa: S603, S607
    else:
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603, S607
