"""描画結果（slides/）を、HTML・PDF・PowerPoint のファイルに書き出す（manim-slides convert）。

- HTML: reveal.js（発表の画面を作る JavaScript）を使う。インターネットに置いたものを読みに行かないよう、
  いつも --offline（reveal.js を書き出し先のフォルダに入れる）で書き出す。reveal.js は manim-slides が
  パソコンに覚えておく（キャッシュ）ので、ダウンロードするのは初めの 1 回だけ。
  まず「ダウンロードしない」状態で試し、キャッシュに無ければ needDownload を返して、利用者に確かめてから
  ダウンロードする（このアプリが自分でインターネットにつなぐのは、ここだけ）。
- PDF: スライド（クリックの区切り）ごとの最後の画面を 1 ページずつ。動きは入らない。
- PowerPoint: 区切りごとの動画を 1 枚ずつ（クリックで再生）。発表者ノートも入る。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .errors import strip_ansi
from .procutil import child_env, no_window_flags

FORMATS = {"html": ".html", "pdf": ".pdf", "pptx": ".pptx", "mp4": ".mp4", "handout": "_handout.pdf", "png": "_png", "gif": "_gif"}
FORMAT_LABEL = {"html": "HTML", "pdf": "PDF", "pptx": "PowerPoint", "mp4": "動画（mp4）", "handout": "配布資料（PDF）",
                "png": "画像（PNG）", "gif": "動く画像（GIF）"}
LOCAL_FORMATS = ("handout", "png", "gif")  # manim-slides を使わず、このアプリの中で作るもの
COMPOSER = Path(__file__).with_name("record_compose.py")
_MAX_LOG = 200_000
# ダウンロードさせないための、つながらないプロキシ（reveal.js がキャッシュに無ければ、すぐに失敗する）
_NO_NET_PROXY = "http://127.0.0.1:9"


def export_dir(folder: Path) -> Path:
    return folder / "export"


def output_path(folder: Path, cls: str, fmt: str) -> Path:
    return export_dir(folder) / f"{cls}{FORMATS[fmt]}"


class _Cancelled(Exception):
    pass


class ConvertJob:
    def __init__(self, folder: Path, cls: str, fmt: str, one_file: bool, allow_download: bool,
                 background: str = "", title: str = "", pdf_pages: bool = False, video: dict[str, Any] | None = None):
        self.video = video or {}  # 動画（mp4）: {"wait": 秒, "srt": 字幕も作るか, "project": プロジェクトの内容}
        self.progress: float | None = None
        self.id = uuid.uuid4().hex[:12]
        self.folder, self.cls, self.fmt = folder, cls, fmt
        self.one_file, self.allow_download = one_file, allow_download
        self.background, self.title = background, title
        self.pdf_pages = pdf_pages  # PDF: スライド（ページ）ごとに、最後のステップの画面だけを 1 ページにする
        self.status = "running"  # running / ok / error / needDownload / cancelled
        self.log = ""
        self.message = ""
        self.started = time.time()
        self.finished: float | None = None
        self.dest = output_path(folder, cls, fmt)
        # いったん作業用のフォルダに書き出し、うまくいったら export/ へ移す（失敗しても前のファイルを壊さない）
        self.work = export_dir(folder) / f".work_{self.id}"
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return {"id": self.id, "status": self.status, "format": self.fmt, "dest": str(self.dest),
                    "message": self.message, "log": self.log[-6000:], "progress": self.progress,
                    "elapsed": round((self.finished or time.time()) - self.started, 1)}

    def command(self) -> list[str]:
        cmd = [sys.executable, "-m", "manim_slides", "convert", "--folder", "slides", "--to", self.fmt]
        if self.fmt == "html":
            cmd.append("--offline")
            if re.fullmatch(r"#[0-9A-Fa-f]{6}", self.background or ""):
                cmd.append(f"-cbackground_color={self.background}")  # 動画の外側（画面の余り）も、スライドの背景色に
            if self.title.strip():
                cmd.append(f"-ctitle={self.title.strip()}")
            if self.one_file:
                cmd.append("--one-file")
        cmd += [self.cls, str((self.work / self.dest.name).relative_to(self.folder))]
        return cmd

    def run(self) -> None:
        env = child_env()
        if self.fmt == "html" and not self.allow_download:
            for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
                env[k] = _NO_NET_PROXY
            env["NO_PROXY"] = env["no_proxy"] = ""
        self.work.mkdir(parents=True, exist_ok=True)
        try:
            if self.fmt == "mp4":
                self._run_video(env)
            elif self.fmt in LOCAL_FORMATS:
                self._run_local()
            else:
                self._run(env)
        except Exception as e:  # noqa: BLE001 — 思わぬ失敗も、画面に出す
            import traceback  # noqa: PLC0415
            self.log += "\n" + traceback.format_exc()
            self._finish("error", f"出力できませんでした: {e}")
        finally:
            shutil.rmtree(self.work, ignore_errors=True)

    def _run(self, env: dict[str, str]) -> None:
        try:
            self._proc = subprocess.Popen(self.command(), cwd=self.folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                          env=env, creationflags=no_window_flags())
            assert self._proc.stdout is not None
            for raw in iter(self._proc.stdout.readline, b""):
                with self._lock:
                    self.log = (self.log + strip_ansi(raw.decode("utf-8", errors="replace")))[-_MAX_LOG:]
            code = self._proc.wait()
        except OSError as e:
            self._finish("error", f"出力を開始できませんでした: {e}")
            return
        if self.status == "cancelled":
            self._finish("cancelled", "")
            return
        made = self.work / self.dest.name
        if code == 0 and made.exists() and made.stat().st_size > 0:
            added = 0
            try:  # 「発表で再生」の動画・音声を、出力したファイルにも入れる
                added = self._add_media(made)
            except Exception as e:  # noqa: BLE001
                import traceback  # noqa: PLC0415
                self.log += "\n" + traceback.format_exc()
                self._finish("error", f"動画・音声（発表で再生）を入れられませんでした: {e}")
                return
            for f in self.work.iterdir():  # ファイルと、HTML の素材のフォルダ（<名前>_assets）
                if f.name.startswith("."):
                    continue  # 作業用（表紙のコマなど）
                to = self.dest.parent / f.name
                if to.is_dir():
                    shutil.rmtree(to)
                elif to.exists():
                    to.unlink()
                shutil.move(str(f), str(to))
            if self.fmt == "html" and self.one_file:  # 1 つのファイルにまとめたときは、前に書き出した素材のフォルダは要らない
                shutil.rmtree(self.dest.parent / f"{self.cls}_assets", ignore_errors=True)
            extra = f"（「発表で再生」の動画・音声 {added} 個も入れました）" if added else ""
            if getattr(self, "links", 0):
                extra += f"（リンク {self.links} 個を入れました）"
            extra += getattr(self, "link_note", "")
            self._finish("ok", f"{FORMAT_LABEL[self.fmt]} に出力しました{extra}: {self.dest}")
        elif self.fmt == "html" and not self.allow_download and "Missing Reveal.js asset" in self.log:
            self._finish("needDownload", "HTML の発表に使う reveal.js が、まだこのパソコンにありません。")
        elif "Missing Reveal.js asset" in self.log:
            self._finish("error", "reveal.js をダウンロードできませんでした。インターネットにつながっているか確かめて、もう一度出力してください。")
        else:
            self._finish("error", f"manim-slides convert が終了コード {code} で終了しました。")

    def _run_local(self) -> None:
        """配布資料の PDF・PNG・GIF（このプロセスの中で作る。opts は self.video）。"""
        o = self.video

        def prog(x: float) -> None:
            if self.status == "cancelled":
                raise _Cancelled
            with self._lock:
                self.progress = float(x)
                self.message = f"{FORMAT_LABEL[self.fmt]} に出力しています…（{round(x * 100)}%）"

        try:
            if self.fmt == "handout":
                from . import handout  # noqa: PLC0415
                tmp = self.work / self.dest.name
                r = handout.make_handout(self.folder, self.cls, o.get("project") or {}, tmp, str(o.get("layout") or "notes1"),
                                         str(o.get("paper") or "A4"), str(o.get("unit") or "slide"), prog,
                                         str(o.get("orient") or "auto"))
                self.dest.parent.mkdir(parents=True, exist_ok=True)
                if self.dest.exists():
                    self.dest.unlink()
                shutil.move(str(tmp), str(self.dest))
                msg = f"配布資料（{handout.LAYOUT_LABEL.get(o.get('layout'), '')}・{o.get('paper', 'A4')} {'横' if handout.landscape_of(str(o.get('layout')), str(o.get('orient') or 'auto')) else '縦'}・{r['pages']} ページ）に出力しました（文字のフォント: {r['font']}）: {self.dest}"
            else:
                from . import images_export  # noqa: PLC0415
                if self.fmt == "png":
                    k = images_export.export_png(self.folder, self.cls, self.dest, str(o.get("unit") or "slide"), str(o.get("pages") or ""), prog)
                    msg = f"画像（PNG）を {k} 枚出力しました: {self.dest}"
                else:
                    k = images_export.export_gif(self.folder, self.cls, self.dest, int(o.get("width") or 720), int(o.get("fps") or 15),
                                                 str(o.get("pages") or ""), prog)
                    msg = f"動く画像（GIF）を {k} 個出力しました: {self.dest}"
        except _Cancelled:
            self._finish("cancelled", "")
            return
        except ImportError as e:
            self._finish("error", f"出力に使う部品が入っていません（{e.name}）。conda env update -n manim-slide-gui -f environment.yml で入れてください。")
            return
        except ValueError as e:
            self._finish("error", str(e))
            return
        self.progress = 1.0
        self._finish("ok", msg)

    def _run_video(self, env: dict[str, str]) -> None:
        """1 本の動画: 「決めた秒数ずつ待って最後まで進めた発表」の記録を作り、録画と同じ組み立てで mp4 にする。"""
        from . import video_export  # noqa: PLC0415
        raw = self.work / "raw"  # record_compose は、raw の 2 つ上（プロジェクト）から動画を探す
        info = video_export.build(self.folder, self.cls, self.video.get("project") or {}, raw, float(self.video.get("wait", 2.0)))
        settings = raw / "settings.json"
        settings.write_text(json.dumps({"camera": False, "slideSound": True, "slideVol": 1.0, "micVol": 1.0}), encoding="utf-8")
        made = self.work / self.dest.name
        self.message = "動画にしています…"
        try:
            self._proc = subprocess.Popen([sys.executable, str(COMPOSER), str(raw), str(made), str(settings)], cwd=str(COMPOSER.parent),
                                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, creationflags=no_window_flags())
        except OSError as e:
            self._finish("error", f"出力を開始できませんでした: {e}")
            return
        out = self._proc.stdout

        def read_log() -> None:
            for line in iter(out.readline, b""):
                with self._lock:
                    self.log = (self.log + strip_ansi(line.decode("utf-8", errors="replace")))[-_MAX_LOG:]

        reader = threading.Thread(target=read_log, daemon=True)
        reader.start()
        total = info["duration"]
        while self._proc.poll() is None:
            time.sleep(0.4)
            try:
                c = json.loads((raw / "compose.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            with self._lock:
                self.progress = float(c.get("progress") or 0.0)
                self.message = f"動画にしています…（{round(self.progress * 100)}%・動画の長さ {int(total // 60)}:{int(total % 60):02d}）"
        reader.join(timeout=2)
        if self.status == "cancelled":
            self._finish("cancelled", "")
            return
        try:
            c = json.loads((raw / "compose.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            c = {}
        if c.get("status") != "done" or not made.is_file():
            self.log += "\n" + str(c.get("log") or "")
            self._finish("error", c.get("message") or "動画にできませんでした。")
            return
        self.dest.parent.mkdir(parents=True, exist_ok=True)
        if self.dest.exists():
            self.dest.unlink()
        shutil.move(str(made), str(self.dest))
        srt = self.dest.with_suffix(".srt")
        extra = ""
        if self.video.get("srt"):
            n = video_export.write_srt(info["subtitles"], srt, str(self.video.get("srtMode") or "all"))
            extra = f"（字幕 {n} 個: {srt.name}）" if n else "（発表者ノートが無いので、字幕は空です）"
        else:
            srt.unlink(missing_ok=True)  # 前に作った字幕は、今の動画と合わないので消す
        self.progress = 1.0
        self._finish("ok", f"動画（mp4）に出力しました{extra}: {self.dest}")

    def _add_media(self, made: Path) -> int:
        """出力したファイルに、動画・音声（発表で再生）とリンクを足す。足した動画・音声の数（無ければ 0）。"""
        n = self._add_media_only(made)
        from . import media_export  # noqa: PLC0415
        cfg = json.loads((self.folder / "slides" / f"{self.cls}.json").read_text(encoding="utf-8"))
        k = len(cfg.get("slides") or [])
        res = cfg.get("resolution")
        try:  # 押すと飛ぶ要素（リンク）
            if self.fmt == "html":
                self.links = media_export.add_links_to_html(self.folder, self.cls, made, k, tuple(res) if res else None)
            elif self.fmt == "pdf":
                idx = media_export.page_last_segments(self.folder, self.cls, k) if self.pdf_pages else None
                self.links = media_export.add_links_to_pdf(self.folder, self.cls, made, k, idx)
        except Exception as e:  # noqa: BLE001 — リンクが入らなくても、出力はする
            self.log += f"\nリンクを入れられませんでした: {e}"
            self.link_note = f"（{e}）" if isinstance(e, RuntimeError) else "（リンクを入れられませんでした）"
        return n

    def _add_media_only(self, made: Path) -> int:
        from . import media_export  # noqa: PLC0415
        plan = media_export.load_plan(self.folder, self.cls)
        cfg = json.loads((self.folder / "slides" / f"{self.cls}.json").read_text(encoding="utf-8"))
        files = [self.folder / sl["file"] for sl in cfg.get("slides") or []]
        if self.fmt == "pdf" and self.pdf_pages:
            media_export.make_pdf(self.folder, plan, files, made, media_export.page_last_segments(self.folder, self.cls, len(files)))
            return len((plan or {}).get("media") or {})
        if not plan:
            return 0
        res = cfg.get("resolution")
        tmp = self.work / ".gui_tmp"
        tmp.mkdir(exist_ok=True)
        if self.fmt == "html":
            media_export.add_to_html(self.folder, plan, made, len(files), self.one_file, tuple(res) if res else None)
        elif self.fmt == "pptx":
            media_export.add_to_pptx(self.folder, plan, made, tmp)
        else:
            media_export.make_pdf(self.folder, plan, files, made)
        return len(plan.get("media") or {})

    def _finish(self, status: str, message: str) -> None:
        with self._lock:
            self.status, self.message, self.finished = status, message, time.time()

    def cancel(self) -> None:
        with self._lock:
            if self.status != "running":
                return
            self.status = "cancelled"
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()


class ConvertManager:
    def __init__(self) -> None:
        self.jobs: dict[str, ConvertJob] = {}

    def start(self, folder: Path, cls: str, fmt: str, one_file: bool = False, allow_download: bool = False,
              background: str = "", title: str = "", pdf_pages: bool = False, video: dict[str, Any] | None = None) -> ConvertJob:
        if fmt not in FORMATS:
            raise ValueError(f"書き出せない形式です: {fmt}")
        if any(j.status == "running" for j in self.jobs.values()):
            raise RuntimeError("別の出力が実行中です。終わってから出力してください。")
        job = ConvertJob(folder, cls, fmt, one_file, allow_download, background, title, pdf_pages, video)
        self.jobs[job.id] = job
        threading.Thread(target=job.run, daemon=True).start()
        return job

    def get(self, job_id: str) -> ConvertJob | None:
        return self.jobs.get(job_id)


def open_in_file_manager(path: Path) -> None:
    """書き出したファイルのフォルダを、OS のファイル管理の画面で開く。"""
    target = path if path.is_dir() else path.parent
    if sys.platform == "win32":
        if path.is_file():
            subprocess.Popen(["explorer", "/select,", str(path)])  # noqa: S603, S607
        else:
            os.startfile(str(target))  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)] if path.is_file() else ["open", str(target)])  # noqa: S603, S607
    else:
        subprocess.Popen(["xdg-open", str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603, S607
