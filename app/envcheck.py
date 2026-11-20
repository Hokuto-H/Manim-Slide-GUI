"""環境チェック（F16）。すべてローカルで確認し、インターネットには接続しない。"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from . import fonts
from .procutil import child_env
from .constants import EXPECTED_VERSIONS, JP_FIXED_PREAMBLE, MANIM_DEFAULT_PREAMBLE

_NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0

HINT_TEXLIVE = ("TeX Live を導入してください（https://www.tug.org/texlive/ のインストーラー。"
                "導入後はターミナルとアプリを開き直して PATH を反映させます）。")


def _run(cmd: list[str], timeout: float = 30, cwd: str | None = None) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, cwd=cwd, creationflags=_NOWIN, env=child_env())
        return p.returncode, (p.stdout + p.stderr).decode("utf-8", errors="replace")
    except FileNotFoundError:
        return 127, "コマンドが見つかりません"
    except subprocess.TimeoutExpired:
        return 124, f"{timeout:.0f} 秒以内に終わりませんでした"
    except OSError as e:
        return 1, str(e)


def _item(key: str, label: str, required: bool, ok: bool | None, detail: str = "", hint: str = "", version: str = "") -> dict[str, Any]:
    return {"key": key, "label": label, "required": required, "ok": ok, "detail": detail, "hint": hint, "version": version}


def _compile(body_preamble: list[str], body: str) -> tuple[bool, str]:
    doc = "\n".join([r"\documentclass[preview]{standalone}", *body_preamble,
                     r"\begin{document}", body, r"\end{document}"]) + "\n"
    with tempfile.TemporaryDirectory(prefix="msg-env-") as td:
        Path(td, "t.tex").write_text(doc, encoding="utf-8")
        code, out = _run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", "-no-pdf", "t.tex"], timeout=180, cwd=td)
        ok = code == 0 and Path(td, "t.xdv").exists()
        log = Path(td, "t.log").read_text(encoding="utf-8", errors="replace") if Path(td, "t.log").exists() else out
    err = ""
    if not ok:
        lines = [l for l in log.splitlines() if l.startswith("!")]
        err = lines[0] if lines else log[-400:]
        miss = missing_files(log)
        if miss:
            err += f"（見つからないファイル: {'、'.join(miss)}）"
    return ok, err


def missing_files(log: str) -> list[str]:
    """LaTeX のログの「File `xxx.sty' not found」から、見つからないファイルの名前を取り出す。"""
    import re as _re
    out: list[str] = []
    for m in _re.finditer(r"File [`'\"]?([^`'\"\s]+\.(?:sty|cls|def|fd|tex|cfg))['\"]? not found", log):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


def missing_hint(err: str, fallback: str) -> str:
    """見つからないファイルがあれば、そのファイルを入れるコマンドを出す（tlmgr search で、どのパッケージに入っているかも探せる）。"""
    import re as _re
    m = _re.search(r"見つからないファイル: ([^）]+)", err or "")
    if not m:
        return fallback
    files = [f.strip() for f in m.group(1).split("、") if f.strip()]
    pkgs = []
    for f in files:
        pkg = f.rsplit(".", 1)[0]
        pkg = {"ctexhook": "ctex", "xeCJK": "xecjk", "xeCJKfntef": "xecjk", "ipaex-type1": "ipaex-type1", "zxjatype": "zxjatype",
               "zxjafont": "zxjafont", "standalone": "standalone", "preview": "preview", "doublestroke": "doublestroke",
               "dsfont": "doublestroke", "physics": "physics", "chemfig": "chemfig"}.get(pkg, pkg)
        if pkg not in pkgs:
            pkgs.append(pkg)
    return (f"{'・'.join(files)} が見つかりません。TeX Live Manager で、このファイルを含むパッケージを導入してください"
            f"（コマンドなら: tlmgr install {' '.join(pkgs)}。パッケージ名が違うときは tlmgr search --global --file {files[0]} で探せます）。"
            "MiKTeX なら、MiKTeX Console の「Packages」で同じ名前を探して導入してください。")


def check_xelatex() -> list[dict[str, Any]]:
    """XeLaTeX（実際のコンパイル）と、日本語パッケージ（zxjatype・zxjafont/ipaex）を確認する。"""
    path = shutil.which("xelatex")
    if not path:
        return [
            _item("xelatex", "XeLaTeX", True, False, "xelatex コマンドが見つかりません。", HINT_TEXLIVE),
            _item("japanese", "日本語パッケージ（zxjatype・zxjafont/ipaex）", True, False, "XeLaTeX が無いため確認できません。", HINT_TEXLIVE),
        ]
    code, out = _run(["xelatex", "--version"])
    version = out.splitlines()[0].strip() if out else ""
    ok, err = _compile(MANIM_DEFAULT_PREAMBLE, r"$x^2+\sqrt{y}$")
    items = [_item("xelatex", "XeLaTeX", True, ok, path if ok else f"テストのコンパイルに失敗しました: {err}",
                   "" if ok else missing_hint(err, "TeX Live が正しく導入されているか確認してください。"), version)]
    if not ok:
        items.append(_item("japanese", "日本語パッケージ（zxjatype・zxjafont/ipaex）", True, False, "XeLaTeX が動かないため確認できません。", HINT_TEXLIVE))
        return items
    ok2, err2 = _compile(MANIM_DEFAULT_PREAMBLE + JP_FIXED_PREAMBLE, r"$x \in \mathbb{R}\ \text{日本語の数式}$")
    hint = missing_hint(err2, "TeX Live Manager で collection-langjapanese を導入してください"
                        "（コマンドなら: tlmgr install collection-langjapanese）。") if not ok2 else ""
    items.append(_item("japanese", "日本語パッケージ（zxjatype・zxjafont/ipaex）", True, ok2,
                       "日本語入りの数式をコンパイルできました。" if ok2 else f"コンパイルに失敗しました: {err2}", hint))
    return items


def check_dvisvgm() -> dict[str, Any]:
    path = shutil.which("dvisvgm")
    if not path:
        return _item("dvisvgm", "dvisvgm（数式の SVG 変換）", True, False, "dvisvgm コマンドが見つかりません。",
                     "TeX Live に含まれています。TeX Live の bin フォルダが PATH に入っているか確認してください。")
    code, out = _run(["dvisvgm", "--version"])
    return _item("dvisvgm", "dvisvgm（数式の SVG 変換）", True, code == 0, path, "", out.strip().splitlines()[0] if out.strip() else "")


def _py_version(module: str) -> tuple[bool, str, str]:
    code = (f"import importlib.metadata as m; "
            f"print(m.version('{module.replace('_', '-')}'))")
    rc, out = _run([sys.executable, "-c", code], timeout=60)
    v = out.strip().splitlines()[-1] if out.strip() else ""
    return rc == 0, v, out


def _vtuple(v: str) -> tuple[int, ...]:
    import re
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


def check_python_pkg(module: str, label: str, cmd: list[str]) -> dict[str, Any]:
    ok, version, out = _py_version(module)
    expected = EXPECTED_VERSIONS.get(module)
    if not ok:
        return _item(module, label, True, False, "導入されていません。",
                     "インストーラーをもう一度実行して、部品を入れ直してください（開発用の起動では、conda 環境を有効にしてから起動します）。")
    rc, cout = _run(cmd, timeout=90)
    if rc != 0:
        import re
        miss = re.search(r"No module named '([^']+)'", cout)
        hint = (f"部品「{miss.group(1)}」が足りません。インストーラーをもう一度実行すると入ります"
                f"（すぐ直すには: \"{sys.executable}\" -m pip install {miss.group(1).split('.')[0]}）。" if miss else
                "インストーラーをもう一度実行して、部品を入れ直してください（開発用の起動では、conda 環境を有効にしてから起動します）。")
        return _item(module, label, True, False, f"コマンドを実行できませんでした: {cout.strip()[-300:]}", hint, version)
    detail = "コマンドを実行できました。"
    if module == "manim" and _vtuple(version) >= (0, 22):
        return _item(module, label, True, False,
                     f"manim {version} は manim-slides 5.7.0 と組み合わせて使えません（描画の開始時に write_to_movie のエラーになります）。",
                     "conda install -c conda-forge manim=0.20.1 で 0.20.1 に戻し、アプリを起動し直してください。", version)
    if expected and version != expected:
        detail += f" 想定の版（{expected}）と異なります。動作が変わる可能性があります。"
    return _item(module, label, True, True, detail, "", version)


def check_qt() -> dict[str, Any]:
    # manim-slides present は QtMultimedia（動画の再生）を使う。conda-forge では qt6-multimedia が別パッケージ
    code = ("import qtpy; from qtpy.QtMultimedia import QMediaPlayer, QAudioOutput; "
            "print(qtpy.API_NAME, qtpy.QT_VERSION, '+ QtMultimedia')")
    rc, out = _run([sys.executable, "-c", code], timeout=60)
    ok = rc == 0
    last = out.strip().splitlines()[-1] if out.strip() else ""
    if ok:
        return _item("qt", "Qt（発表ウィンドウ: PySide6・QtMultimedia）", False, True, last)
    if "QtMultimedia" in out:
        hint = "conda install -c conda-forge qt6-multimedia で、PySide6 と同じ版の qt6-multimedia を導入してください。"
    else:
        hint = "conda-forge の pyside6 を導入してください（発表ウィンドウに必要です）。"
    return _item("qt", "Qt（発表ウィンドウ: PySide6・QtMultimedia）", False, False, f"読み込めません: {last[-200:]}", hint)


AUDIO_HINT = ("音声の出力先（スピーカー・イヤホン・音声のサービス）が見つからないと、発表ウィンドウ（Qt の動画の再生）が"
              "起動の途中で止まることがあります。Windows では［設定］→［システム］→［サウンド］で出力デバイスを確かめてください。"
              "Linux では PulseAudio か PipeWire が動いているか確かめてください（出力先が無い環境では、ダミーの出力を用意すると開けます）。")


def check_audio() -> dict[str, Any]:
    """発表ウィンドウと同じように、Qt で音声の出力先を調べ、動画の再生の準備をしてみる（異常終了しないか）。"""
    code = ("import os\nos.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')\n"
            "from qtpy.QtWidgets import QApplication\nfrom qtpy.QtMultimedia import QMediaDevices, QMediaPlayer, QAudioOutput\n"
            "app = QApplication([])\nouts = QMediaDevices.audioOutputs()\n"
            "p = QMediaPlayer(); a = QAudioOutput(); p.setAudioOutput(a)\n"
            "print('AUDIO_OUTPUTS', len(outs), '|', ', '.join(o.description() for o in outs[:3]))")
    rc, out = _run([sys.executable, "-c", code], timeout=60)
    label = "音声の出力先（発表ウィンドウ）"
    line = next((x for x in out.splitlines() if x.startswith("AUDIO_OUTPUTS")), "")
    if rc == 0 and line:
        n = int(line.split()[1])
        names = line.split("|", 1)[1].strip() if "|" in line else ""
        if n > 0:
            return _item("audio", label, False, True, f"{n} 個見つかりました（{names}）。")
        return _item("audio", label, False, False, "音声の出力先が見つかりません（発表ウィンドウは開けることもありますが、動画・音声の音は出ません）。", AUDIO_HINT)
    if "QtMultimedia" in out and "No module" in out:
        return _item("audio", label, False, None, "QtMultimedia が無いため調べられませんでした（上の Qt の項目を先に直してください）。")
    return _item("audio", label, False, False, f"音声の再生の準備で異常終了しました（終了コード {rc}）。発表ウィンドウも同じ理由で開けない可能性があります。", AUDIO_HINT)


def check_pillow() -> dict[str, Any]:
    """Pillow 13 で Image.fromarray の mode 引数（データ型の変換）が使えなくなり、manim 0.20.1 は画像を描けない。"""
    code = ("import warnings, numpy as np, PIL; from PIL import Image\n"
            "warnings.simplefilter('ignore')\n"
            "print(PIL.__version__)\n"
            "Image.fromarray(np.zeros((2, 2)), mode='RGBA')\n"
            "print('ok')")
    rc, out = _run([sys.executable, "-c", code], timeout=60)
    lines = out.strip().splitlines()
    version = lines[0].strip() if lines else ""
    label = "画像の描画（Pillow）"
    if rc == 0 and lines and lines[-1].strip() == "ok":
        return _item("pillow", label, False, True, f"Pillow {version}", "", version)
    return _item("pillow", label, False, False,
                 f"Pillow {version} では、manim 0.20.1 が画像（ImageMobject）を描けません"
                 "（描画で ValueError: Invalid mode for data type になります）。画像の無いスライドは描画できます。",
                 'conda install -c conda-forge "pillow<13" で Pillow 12 に戻し、アプリを起動し直してください。', version)


def check_ffmpeg() -> dict[str, Any]:
    rc, out = _run([sys.executable, "-c", "import av; print(av.__version__)"], timeout=60)
    ok = rc == 0
    detail = f"PyAV {out.strip().splitlines()[-1]}" if ok and out.strip() else "PyAV を読み込めません。"
    if shutil.which("ffmpeg"):
        detail += "（ffmpeg コマンドもあります）"
    return _item("av", "動画の書き出し（PyAV / FFmpeg）", True, ok, detail,
                 "" if ok else "conda-forge の av を導入してください。")


def check_fonts() -> list[dict[str, Any]]:
    res = fonts.presets(refresh=True)
    items = []
    for p in res["presets"]:
        if p["installed"] is None:
            items.append(_item(f"font:{p['id']}", f"フォント: {p['label']}", False, None, "フォントの一覧を取得できませんでした。"))
        else:
            items.append(_item(f"font:{p['id']}", f"フォント: {p['label']}", False, p["installed"],
                               f"Pango 名: {p['family']}" if p["installed"] else "導入されていません（選ぶと警告が出ます）。",
                               "" if p["installed"] else "フォントのファイルを右クリックして「すべてのユーザーに対してインストール」を選んでください。"))
    return items


_last: dict[str, Any] | None = None
_running = threading.Lock()


def run_all() -> dict[str, Any]:
    global _last
    with _running:
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=6) as ex:
            f_tex = ex.submit(check_xelatex)
            f_dvi = ex.submit(check_dvisvgm)
            f_manim = ex.submit(check_python_pkg, "manim", "Manim Community", [sys.executable, "-m", "manim", "--version"])
            f_slides = ex.submit(check_python_pkg, "manim_slides", "Manim Slides", [sys.executable, "-m", "manim_slides", "--version"])
            f_av = ex.submit(check_ffmpeg)
            f_pil = ex.submit(check_pillow)
            f_qt = ex.submit(check_qt)
            f_audio = ex.submit(check_audio)
            f_fonts = ex.submit(check_fonts)
            items = [*f_tex.result(), f_dvi.result(), f_manim.result(), f_slides.result(), f_av.result(), f_pil.result(), f_qt.result(), f_audio.result(), *f_fonts.result()]
        missing = [i["label"] for i in items if i["required"] and not i["ok"]]
        _last = {
            "items": items,
            "renderReady": not missing,
            "presentReady": not missing and next(i for i in items if i["key"] == "qt")["ok"],
            "missing": missing,
            "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "seconds": round(time.time() - t0, 1),
            "python": sys.version.split()[0],
        }
        return _last


def last() -> dict[str, Any] | None:
    return _last
