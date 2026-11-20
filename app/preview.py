"""テキストのプレビュー用プロセス（preview_worker.py）の管理。

Manim の読み込みに数秒かかるため、サーバーの起動時に一度だけ起動しておく。
落ちた場合や応答しない場合は、次の要求で起動し直す。
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from .procutil import child_env, no_window_flags

WORKER = Path(__file__).with_name("preview_worker.py")


class PreviewError(Exception):
    pass


class PreviewWorker:
    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._start_error = ""
        self._seq = 0
        self.font_paths: list[str] = []  # 登録するプロジェクトのフォント（起動し直したときも登録する）

    def _start(self) -> None:
        self._proc = subprocess.Popen(
            [sys.executable, str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=child_env(), creationflags=no_window_flags(),
        )
        if self._read_reply(lambda r: r.get("ready"), timeout=60) is None:
            self._kill()
            self._proc = None
            raise PreviewError("プレビュー用の Manim を起動できませんでした。")
        if self.font_paths:
            self._send_fonts()

    def _send_fonts(self) -> dict[str, list[str]]:
        assert self._proc and self._proc.stdin
        self._seq += 1
        rid = self._seq
        self._proc.stdin.write((json.dumps({"kind": "fonts", "paths": self.font_paths, "id": rid}, ensure_ascii=False) + "\n").encode("utf-8"))
        self._proc.stdin.flush()
        res = self._read_reply(lambda r, rid=rid: r.get("id") == rid, 60)
        return (res or {}).get("families") or {}

    def set_fonts(self, paths: list[str]) -> dict[str, list[str]]:
        """プロジェクトのフォントを登録する（Pango は登録を取り消せないので、前のプロジェクトの分は残る）。"""
        with self._lock:
            self.font_paths = list(dict.fromkeys([*self.font_paths, *paths]))
            if self._proc is None or self._proc.poll() is not None:
                self._start()  # 起動のときに登録する
            return {p: v for p, v in self._send_fonts().items() if p in paths}

    def _read_line(self, timeout: float) -> str:
        """時間内に1行読めなければ、プロセスを止めて空文字を返す。"""
        assert self._proc and self._proc.stdout
        timer = threading.Timer(timeout, self._kill)
        timer.start()
        try:
            return self._proc.stdout.readline().decode("utf-8", errors="replace")
        finally:
            timer.cancel()

    def _read_reply(self, match, timeout: float) -> dict[str, Any] | None:
        """match に合う応答（JSON の行）を読む。JSON でない行や、前の要求への遅れた応答は読み飛ばす。
        時間内に読めなければ None（プロセスは止める）。"""
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                self._kill()
                return None
            line = self._read_line(left)
            if not line:
                return None
            try:
                res = json.loads(line)
            except ValueError:
                continue
            if isinstance(res, dict) and match(res):
                return res

    def _kill(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.kill()

    def ensure_started(self) -> None:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()

    def render(self, runs: list[dict[str, Any]], kwargs: dict[str, Any], timeout: float = 30) -> dict[str, Any]:
        return self.request({"runs": runs, "kwargs": kwargs}, timeout)

    busy = staticmethod(lambda: False)  # 描画の最中か（main.py が差し替える）。最中は CPU が取られるので、待つ時間を延ばす

    def request(self, req: dict[str, Any], timeout: float = 30) -> dict[str, Any]:
        """常駐プロセスに 1 件の要求（テキスト・図形・吹き出し）を送り、SVG を受け取る。"""
        try:
            if self.busy():
                timeout *= 4
        except Exception:  # noqa: BLE001
            pass
        with self._lock:
            for attempt in range(2):
                if self._proc is None or self._proc.poll() is not None:
                    self._start()
                assert self._proc and self._proc.stdin
                # 要求ごとに番号を付け、同じ番号の応答だけを受け取る（別の要求の結果を取り違えない）
                self._seq += 1
                rid = self._seq
                try:
                    self._proc.stdin.write((json.dumps({**req, "id": rid}, ensure_ascii=False) + "\n").encode("utf-8"))
                    self._proc.stdin.flush()
                except OSError:
                    self._proc = None
                    continue
                res = self._read_reply(lambda r, rid=rid: r.get("id") == rid, timeout)
                if res is None:
                    self._kill()
                    self._proc = None  # 応答なし・異常終了 → 次で起動し直す
                    if attempt == 0:
                        continue
                    raise PreviewError("プレビューの作成が時間内に終わりませんでした。")
                if not res.get("ok"):
                    raise PreviewError(res.get("error", "プレビューを作れませんでした。"))
                return res
        raise PreviewError("プレビューを作れませんでした。")

    def warm_up(self) -> None:
        def run():
            try:
                t0 = time.time()
                self.ensure_started()
                # 最初の1回は Pango の初期化で遅いので、裏で1度作っておく
                self.render([{"t": "あA"}], {"font": "", "font_size": 48, "color": "#000000"})
                self._start_error = ""
                _ = t0
            except PreviewError as e:
                self._start_error = str(e)
        threading.Thread(target=run, daemon=True).start()


worker = PreviewWorker()
