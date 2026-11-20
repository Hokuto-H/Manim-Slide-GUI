"""配布版の起動用プログラム（Windows のスタートメニューのショートカットから pythonw で動く。コンソールの窓は出さない）。

1. conda 環境の「activate」と同じ環境変数を入れる（インストーラーが activation.json に記録したもの）。TeX Live の場所も PATH に足す。
2. もう動いているアプリがあれば、その画面を開くだけで終わる（同時に 1 つだけ）。
3. 127.0.0.1 の空いているポートでサーバーを起動し、Edge（無ければ Chrome）の「アプリの窓」（--app）で画面を開く。
   どちらも無ければ、ふだんのブラウザで開く。
4. 画面の窓をすべて閉じたら（/alive のつながりが無くなって少したったら）、描画などを止めてアプリを終える。

ログは %LOCALAPPDATA%\\ManimSlideGUI\\logs\\app.log に書く（起動に失敗したときは、メッセージの窓で知らせる）。
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

APP_NAME = "Manim Slide GUI"
ROOT = Path(__file__).resolve().parent.parent           # アプリのファイルの場所（run.py がある所）
INSTALL = ROOT.parent if (ROOT.parent / "env").is_dir() else ROOT  # インストール先（env・activation.json がある所）
HOST = "127.0.0.1"
GRACE_SECONDS = 8       # 窓が無くなってから終えるまで（ページの読み直しでは切れないように）
FIRST_WAIT_SECONDS = 90  # 窓が一度もつながらないとき、あきらめるまで


def local_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    d = Path(base) / "ManimSlideGUI"
    d.mkdir(parents=True, exist_ok=True)
    return d


def message_box(text: str, title: str = APP_NAME) -> None:
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, text, title, 0x10)
            return
        except Exception:  # noqa: BLE001
            pass
    print(text, file=sys.stderr)


def setup_log(name: str = "app.log") -> Path:
    """pythonw では標準出力が無いので、ファイルへ書く（前回の分は .1 に残す）。"""
    d = local_dir() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    if f.exists() and f.stat().st_size > 0 and name == "app.log":
        try:
            f.replace(d / "app.1.log")
        except OSError:
            pass
    stream = open(f, "w", encoding="utf-8", buffering=1)  # noqa: SIM115
    sys.stdout = sys.stderr = stream
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {APP_NAME} を起動します（{ROOT}）", flush=True)
    return f


def apply_activation() -> None:
    """conda の activate と同じ環境変数（PATH の先頭に足すもの・決める値）と、TeX Live の場所。"""
    act = INSTALL / "activation.json"
    if act.is_file():
        try:
            data = json.loads(act.read_text(encoding="utf-8"))
            for k, v in data.get("set", {}).items():
                os.environ[k] = v
            pre = [p for p in data.get("path_prepend", []) if p]
            if pre:
                os.environ["PATH"] = os.pathsep.join([*pre, os.environ.get("PATH", "")])
        except (OSError, json.JSONDecodeError) as e:
            print("activation.json を読めませんでした:", e)
    paths = INSTALL / "paths.json"
    texbin = None
    if paths.is_file():
        try:
            texbin = json.loads(paths.read_text(encoding="utf-8")).get("texbin")
        except (OSError, json.JSONDecodeError):
            texbin = None
    cands = [texbin] if texbin else []
    if sys.platform == "win32":
        # インストーラーが入れた場所・よくある場所（PATH に無いときだけ足す）
        local = os.environ.get("LOCALAPPDATA", "")
        for root in (Path(local) / "Programs" / "texlive", Path("C:/texlive")):
            for b in sorted(root.glob("*/bin/windows")) + sorted(root.glob("bin/windows")) + sorted(root.glob("*/bin/win32")):
                cands.append(str(b))
    import shutil
    if not shutil.which("xelatex"):
        for c in cands:
            if c and (Path(c) / ("xelatex.exe" if sys.platform == "win32" else "xelatex")).exists():
                os.environ["PATH"] = os.pathsep.join([c, os.environ.get("PATH", "")])
                print("TeX Live:", c)
                break


def quiet_children() -> None:
    """コンソールの無いアプリから、コンソールのプログラム（xelatex・ffmpeg・python）を起動しても、黒い窓が出ないように。"""
    if sys.platform != "win32":
        return
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and (exe.parent / "python.exe").exists():
        # 子プロセス（描画など）は python.exe で動かす（標準出力をふつうに使えるように）
        sys.executable = str(exe.parent / "python.exe")
        sys._base_executable = sys.executable
    flag = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    orig = subprocess.Popen.__init__

    def init(self, *a, **kw):
        if not kw.get("creationflags"):
            kw["creationflags"] = flag
        return orig(self, *a, **kw)
    subprocess.Popen.__init__ = init  # type: ignore[method-assign]


def instance_file() -> Path:
    return local_dir() / "instance.json"


def running_instance() -> str | None:
    """もう動いているアプリの URL（/ping に答えれば）。"""
    f = instance_file()
    try:
        url = json.loads(f.read_text(encoding="utf-8"))["url"]
        with urllib.request.urlopen(url + "ping", timeout=2) as r:  # noqa: S310（127.0.0.1 だけ）
            if json.loads(r.read().decode()).get("app") == "manim-slide-gui":
                return url
    except Exception:  # noqa: BLE001
        return None
    return None


def free_port(preferred: int = 8765) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 30)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def find_browser() -> list[str] | None:
    """Edge か Chrome（「アプリの窓」で開ける物）。"""
    if sys.platform != "win32":
        import shutil
        for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
            p = shutil.which(name)
            if p:
                return [p]
        return None
    cands = []
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if base:
            cands += [Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                      Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"]
    try:
        import winreg
        for exe in ("msedge.exe", "chrome.exe"):
            for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                try:
                    with winreg.OpenKey(hive, rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}") as k:
                        cands.append(Path(winreg.QueryValue(k, None)))
                except OSError:
                    pass
    except ImportError:
        pass
    for c in cands:
        if c.is_file():
            return [str(c)]
    return None


def open_window(url: str) -> subprocess.Popen | None:
    """アプリの窓を開く。専用のプロファイルを使うので、ふだんのブラウザの窓・拡張機能とは分かれる。"""
    browser = find_browser()
    if not browser:
        import webbrowser
        print("Edge・Chrome が見つからないので、ふだんのブラウザで開きます")
        webbrowser.open(url)
        return None
    profile = local_dir() / "window"
    args = [*browser, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
            "--disable-background-mode", "--window-size=1600,1000", "--disable-features=Translate"]
    print("窓を開きます:", browser[0])
    return subprocess.Popen(args, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0)


def serve() -> None:
    import uvicorn

    from app import main as appmain

    port = free_port()
    url = f"http://{HOST}:{port}/"
    appmain.state["port"] = port
    config = uvicorn.Config(appmain.app, host=HOST, port=port, log_level="warning", log_config=None)
    server = uvicorn.Server(config)
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("サーバーを起動できませんでした。")
    instance_file().write_text(json.dumps({"url": url, "pid": os.getpid()}), encoding="utf-8")
    appmain.warm_up()
    print("サーバー:", url, flush=True)
    proc = open_window(url)
    # 窓が一度つながってから、つながりが無くなって GRACE_SECONDS たったら終える
    t0 = time.time()
    while True:
        time.sleep(1)
        a = appmain.alive
        if a["ever"]:
            if a["clients"] <= 0 and time.time() - a["last_change"] > GRACE_SECONDS:
                print("窓が閉じられたので終了します", flush=True)
                break
        elif time.time() - t0 > FIRST_WAIT_SECONDS and (proc is None or proc.poll() is not None):
            print("窓がつながらないので終了します", flush=True)
            break
    appmain.shutdown_work()
    server.should_exit = True
    th.join(timeout=10)
    try:
        if json.loads(instance_file().read_text(encoding="utf-8")).get("pid") == os.getpid():
            instance_file().unlink()
    except (OSError, json.JSONDecodeError):
        pass


def main() -> None:
    url = running_instance()
    log = setup_log("open.log" if url else "app.log")  # 2 つ目の起動は、動いているアプリのログを消さない
    try:
        sys.path.insert(0, str(ROOT))
        os.chdir(ROOT)
        apply_activation()
        quiet_children()
        if url:
            print("もう動いているアプリの窓を開きます:", url)
            open_window(url)
            return
        serve()
    except Exception:  # noqa: BLE001
        tb = traceback.format_exc()
        print(tb, flush=True)
        message_box(f"{APP_NAME} を起動できませんでした。\n\n{tb.strip().splitlines()[-1]}\n\nくわしくはログをご覧ください:\n{log}")
        sys.exit(1)


if __name__ == "__main__":
    main()
