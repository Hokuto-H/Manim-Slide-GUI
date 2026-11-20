"""Manim / Manim Slides を外部コマンド（サブプロセス）で実行する。

描画は別スレッドで子プロセスを待つので、サーバー（と GUI の編集操作）は止まらない。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .constants import RENDER_QUALITIES
from .errors import locate, strip_ansi
from . import userconfig
from .procutil import child_env, no_window_flags

RUNNER = Path(__file__).with_name("render_runner.py")
PRESENT_RUNNER = Path(__file__).with_name("present_runner.py")
_MAX_LOG = 400_000
PROGRESS_PREFIX = "@@GUI_PROGRESS "  # render_runner.py が出す進み具合の行


class RenderJob:
    def __init__(self, folder: Path, cls: str, quality: str, present_after: bool):
        self.id = uuid.uuid4().hex[:12]
        self.folder = folder
        self.cls = cls
        self.quality = quality
        self.present_after = present_after
        self.status = "running"  # running | ok | error | cancelled
        self.log = ""
        self.error: dict[str, Any] | None = None
        self.started = time.time()
        self.finished: float | None = None
        self.present: dict[str, Any] | None = None
        self.progress: dict[str, Any] | None = None
        self.slide_index: int | None = None  # 1 枚だけの試し描画（Ctrl+Enter）のときは、そのスライドの番号（0 始まり）
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                "id": self.id, "status": self.status, "log": self.log[-60_000:],
                "error": self.error, "elapsed": round((self.finished or time.time()) - self.started, 1),
                "present": self.present, "className": self.cls, "progress": self.progress,
                "kind": "slide" if self.slide_index is not None else "deck", "slideIndex": self.slide_index,
            }

    def _append(self, text: str) -> None:
        with self._lock:
            self.log += strip_ansi(text)
            if len(self.log) > _MAX_LOG:
                self.log = self.log[-_MAX_LOG:]

    def run(self) -> None:
        result_path = self.folder / "media" / f".gui_render_result_{self.id}.json"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, str(RUNNER), f"{self.cls}.py", self.cls,
               RENDER_QUALITIES.get(self.quality, "-qh"), str(result_path)]
        try:
            self._proc = subprocess.Popen(
                cmd, cwd=self.folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                env=child_env(), creationflags=no_window_flags(),
            )
            assert self._proc.stdout is not None
            threading.Thread(target=self._watchdog, args=(self._proc, result_path), daemon=True).start()
            for raw in iter(self._proc.stdout.readline, b""):
                text = raw.decode("utf-8", errors="replace")
                if text.startswith(PROGRESS_PREFIX):
                    try:
                        prog = json.loads(text[len(PROGRESS_PREFIX):])
                    except ValueError:
                        continue
                    with self._lock:
                        self.progress = prog
                    continue
                self._append(text)
            code = self._proc.wait()
        except OSError as e:
            self._finish("error", {"message": f"描画を開始できませんでした: {e}", "summary": str(e), "location": None, "traceback": ""})
            return
        if self.status == "cancelled":
            self._finish("cancelled", None)
            return
        result: dict[str, Any] = {}
        if result_path.exists():
            try:
                result = json.loads(result_path.read_text(encoding="utf-8"))
            finally:
                result_path.unlink(missing_ok=True)
        if code == 0 and result.get("ok"):
            self._append("\n描画が完了しました。\n")
            self._finish("ok", None)
            if self.present_after:
                self.present = launch_present(self.folder, self.cls, replace=True)
        else:
            if not result:
                result = {"message": f"描画プロセスが終了コード {code} で終了しました。", "frames": [], "traceback": self.log[-4000:]}
            elif str(result.get("message", "")).startswith("RuntimeError: manim が終了コード"):
                # manim が例外を自分で表示して終了した場合は、ログから元の例外を探す
                found = re.findall(r"^(\w+(?:Error|Exception|Warning)): (.+)$", self.log, re.M)
                found = [f for f in found if not f[1].startswith("manim が終了コード")]
                if found:
                    result["message"] = f"{found[-1][0]}: {found[-1][1]}"
                result["traceback"] = self.log[-6000:]
            self._finish("error", locate(result, self.folder, self.cls))

    @staticmethod
    def _watchdog(proc: subprocess.Popen, result_path: Path) -> None:
        """結果を書いたのに終わらない描画のプロセスを止める（念のため。通常は render_runner がすぐに終了する）。"""
        seen = None
        while proc.poll() is None:
            time.sleep(1)
            if result_path.exists():
                seen = seen or time.time()
                if time.time() - seen > 15:
                    proc.kill()
                    return

    def _finish(self, status: str, error: dict[str, Any] | None) -> None:
        with self._lock:
            self.status = status
            self.error = error
            self.finished = time.time()

    def cancel(self) -> None:
        with self._lock:
            if self.status != "running":
                return
            self.status = "cancelled"
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()


class RenderManager:
    def __init__(self) -> None:
        self.jobs: dict[str, RenderJob] = {}
        self.current: RenderJob | None = None

    def start(self, folder: Path, cls: str, quality: str, present_after: bool, slide_index: int | None = None) -> RenderJob:
        if self.current and self.current.status == "running":
            raise RuntimeError("描画を実行中です。終わるまでお待ちください。")
        if slide_index is None:
            # 開いている発表ウィンドウは、古い描画結果の動画を開いたままにしている（Windows では、開いている動画を
            # 書き換えられないため、描画のあとで音声を入れ直せない）。描画のあとで開き直すので、先に閉じる
            with _present_lock:
                _stop_present()
        job = RenderJob(folder, cls, quality, present_after)
        job.slide_index = slide_index
        self.jobs = {job.id: job}  # 直近のジョブだけ保持
        self.current = job
        threading.Thread(target=job.run, daemon=True).start()
        return job

    def get(self, job_id: str) -> RenderJob | None:
        return self.jobs.get(job_id)


# 発表ウィンドウは同時に1組だけにする（二重に開かないよう、起動中のプロセスを覚えておく）
_present_lock = threading.Lock()
_present_proc: subprocess.Popen | None = None


def present_running() -> bool:
    return _present_running()


def _present_running() -> bool:
    return _present_proc is not None and _present_proc.poll() is None


def _stop_present() -> None:
    global _present_proc
    if _present_running():
        _present_proc.terminate()
        try:
            _present_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _present_proc.kill()
    _present_proc = None


_audio_pool = ThreadPoolExecutor(max_workers=1)
NO_AUDIO_WARN = ("音声の出力先（スピーカー・イヤホン）が見つかりません。発表はできますが、「発表で再生」の動画・音声やスライドの音は出ません。"
                 "Windows の「サウンドの設定」で出力デバイスが有効か確かめてください（「環境チェック」の「音声の出力先」でも確かめられます）。")


def _start_audio_check() -> Future:
    """音声の出力先を別のプロセスで調べ始める（Qt の音声の準備は、出力先の無い環境で異常終了することがあるため、発表ウィンドウとは別に）。"""
    from .envcheck import check_audio  # noqa: PLC0415
    return _audio_pool.submit(check_audio)


def _audio_warning(fut: Future, wait: float = 15.0) -> dict[str, Any]:
    """音声の出力先が 0 個なら警告を返す（調べられなかったときは何も言わない）。"""
    try:
        item = fut.result(timeout=wait)
    except Exception:  # noqa: BLE001
        return {}
    return {"warn": NO_AUDIO_WARN} if item.get("ok") is False else {}


def launch_present(folder: Path, cls: str, replace: bool = False) -> dict[str, Any]:
    """`manim-slides present` を別ウィンドウで起動する（終了は待たない）。

    既に発表ウィンドウが開いている場合、replace=False（「発表のみ」）なら新しく開かずに知らせ、
    replace=True（描画の直後）なら、古い内容のウィンドウを閉じてから開き直す。
    """
    global _present_proc
    with _present_lock:  # ボタンを続けて押されても、起動処理を重ねない
        if not (folder / "slides" / f"{cls}.json").exists():
            return {"ok": False, "message": "描画結果（slides フォルダ）が見つかりません。先に描画してください。"}
        if _present_running():
            if not replace:
                return {"ok": True, "already": True,
                        "message": "発表ウィンドウは既に開いています。開き直す場合は、今のウィンドウを閉じて（Q キー）から押してください。"}
            _stop_present()
        # クリックでも進められるようにした起動スクリプト経由で、manim-slides present を実行する
        # 開き方（最大化・フルスクリーン・通常）は、操作アプリの設定（ユーザー設定）に従う
        cfg = userconfig.load()
        mode = cfg.get("presentWindow", "maximized")
        cmd = [sys.executable, str(PRESENT_RUNNER), "--gui-window", str(mode), "--gui-scene", cls]
        try:  # 発表の録画（Ctrl+R）に使うマイク・カメラの設定
            from .recording import write_present_cfg  # noqa: PLC0415
            cmd += ["--gui-record", str(write_present_cfg(folder))]
        except OSError:
            pass
        cmd += ["present", "--folder", "slides"]
        # 発表者用の情報ウィンドウ: auto は manim-slides の既定（画面が2つ以上のときだけ出す）
        info = cfg.get("presentInfo", "auto")
        if info == "show":
            cmd.append("--show-info-window")
        elif info == "hide":
            cmd.append("--hide-info-window")
        cmd.append(cls)
        audio = _start_audio_check()
        log_path = folder / "media" / "present.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            log_f = open(log_path, "wb")  # noqa: SIM115 — 子プロセスに渡すため開いたままにする
            proc = subprocess.Popen(cmd, cwd=folder, stdout=log_f, stderr=subprocess.STDOUT, env=child_env())
        except OSError as e:
            return {"ok": False, "message": f"発表ウィンドウを起動できませんでした: {e}"}
        _present_proc = proc
        # すぐに異常終了していないかだけ確認する
        try:
            code = proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            return {"ok": True, "message": "発表ウィンドウを開きました。", **_audio_warning(audio)}
        log_f.close()
        _present_proc = None
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-3000:]
        if code == 0:
            return {"ok": True, "message": "発表ウィンドウは閉じられました。"}
        return {"ok": False, "message": f"manim-slides present が終了コード {code} で終了しました。", "log": strip_ansi(tail)}
