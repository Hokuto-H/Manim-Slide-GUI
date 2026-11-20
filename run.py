"""Manim Slide GUI を起動する。

    python run.py                 # 既定のポート（8765）で起動し、ブラウザを開く
    python run.py --port 9000     # ポートを指定
    python run.py --no-browser    # ブラウザを自動で開かない
    python run.py --open PATH     # プロジェクトのフォルダを開いた状態で起動

サーバーは 127.0.0.1 のみで待ち受け、外部からは接続できない。
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"


def _free_port(preferred: int) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 20)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if sys.platform != "win32":
                # 直前に終了したサーバーの接続（TIME_WAIT）が残っていても、同じポートで起動し直せるようにする
                # （uvicorn も同じ設定で待ち受ける。Windows ではこの設定の意味が違うので使わない）
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((HOST, port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def main() -> None:
    ap = argparse.ArgumentParser(description="Manim Slide GUI")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--open", metavar="PATH", help="起動時に開くプロジェクトのフォルダ")
    args = ap.parse_args()

    if sys.platform == "win32":
        # Windows のコンソールでも日本語のログが文字化けしないようにする
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8")
            except (AttributeError, ValueError):
                pass

    import uvicorn

    from app import main as appmain
    from app.project import Project, ProjectError

    if args.open:
        try:
            appmain.state["project"] = Project.open(Path(args.open))
        except ProjectError as e:
            print(f"プロジェクトを開けませんでした: {e}", file=sys.stderr)

    port = _free_port(args.port)
    appmain.state["port"] = port
    url = f"http://{HOST}:{port}/"
    appmain.warm_up()
    print(f"Manim Slide GUI: {url}  （終了するには Ctrl+C）", flush=True)
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(appmain.app, host=HOST, port=port, log_level="warning")


if __name__ == "__main__":
    main()
