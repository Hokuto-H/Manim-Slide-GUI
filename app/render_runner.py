"""描画用の子プロセスで実行するスクリプト（サーバーからは直接 import しない）。

`manim-slides render` は内部で `python -m manim render ...` を呼ぶだけなので、
同じことをこのプロセス内で行い、例外が起きたらトレースバックを JSON に保存する。
（文字の装飾された表示を解析せずに、エラーの行番号を確実に取り出すため）

使い方: python render_runner.py <Deck.py> <ClassName> <品質フラグ> <結果JSONのパス>
"""

from __future__ import annotations

import json
import os
import re
import sys
import traceback
from pathlib import Path


def _frames(tb) -> list[dict]:
    out = []
    for fs in traceback.extract_tb(tb):
        out.append({"file": fs.filename, "line": fs.lineno, "name": fs.name, "code": fs.line or ""})
    return out


def _chain(exc: BaseException) -> list[BaseException]:
    seen = []
    e: BaseException | None = exc
    while e is not None and e not in seen:
        seen.append(e)
        e = e.__cause__ or e.__context__
    return seen


# ---------------------------------------------------------------- 進み具合

PROGRESS_PREFIX = "@@GUI_PROGRESS "


def _segments(py_file: str, cls: str) -> list[dict]:
    """クリックの区切り（next_slide）ごとの説明。書き出した .py と対応表（.map.json）から作る。"""
    lines = Path(py_file).read_text(encoding="utf-8").split("\n")
    try:
        mapping = json.loads(Path(py_file).with_suffix(".map.json").read_text(encoding="utf-8"))["lines"]
    except (OSError, ValueError, KeyError):
        mapping = {}
    # 最初のスライドの番号（1 枚だけの試し描画では、そのスライドの番号）
    first = min((int(v["slideIndex"]) for v in mapping.values() if isinstance(v, dict) and v.get("slideIndex") is not None), default=0) + 1
    segs = [{"slide": first, "label": f"スライド {first} の開始"}]
    pat = re.compile(r"^\s+self\.next_slide\(")
    in_construct = False
    for no, line in enumerate(lines, start=1):
        if line.strip().startswith("def construct("):
            in_construct = True
            continue
        if not in_construct or not pat.match(line):
            continue
        here = mapping.get(str(no)) or {}
        nxt = mapping.get(str(no + 1)) or {}
        si = int(here.get("slideIndex", nxt.get("slideIndex", segs[-1]["slide"] - 1))) + 1
        if nxt.get("kind") == "step":
            label = f"スライド {si} のステップ {nxt.get('slideStepNo', '?')}（{nxt.get('var', '')}）"
        else:
            label = f"スライド {si} の開始"
        segs.append({"slide": si, "label": label})
    return segs


class _Progress:
    """描画の進み具合を、サーバーが読む行（@@GUI_PROGRESS {...}）として出力する。"""

    def __init__(self, segments: list[dict]):
        self.segments = segments or [{"slide": 1, "label": ""}]
        self.seg = 0
        self.within = 0.0  # 区切りの中の進み（0〜1、戻らない）
        self.anim = 0.0  # 今の動きの進み（0〜1）
        self.anims = 0
        self.stage = "render"
        self._last = 0.0

    def emit(self, force: bool = False) -> None:
        import time  # noqa: PLC0415

        now = time.time()
        if not force and now - self._last < 0.25:
            return
        self._last = now
        total = len(self.segments)
        seg = min(self.seg, total - 1)
        overall = 1.0 if self.stage != "render" else min(0.999, (seg + self.within) / total)
        data = {"stage": self.stage, "segment": seg + 1, "segments": total, "label": self.segments[seg]["label"],
                "animation": round(self.anim, 3), "animations": self.anims, "overall": round(overall, 4)}
        sys.stdout.write(PROGRESS_PREFIX + json.dumps(data, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    def install(self) -> None:
        from manim import Scene  # noqa: PLC0415
        from manim.scene.scene_file_writer import SceneFileWriter  # noqa: PLC0415
        from manim_slides.slide import Slide  # noqa: PLC0415

        prog = self
        orig_play_internal = Scene.play_internal
        orig_update = Scene.update_to_time
        orig_next = Slide.next_slide
        orig_finish = SceneFileWriter.finish
        orig_save = Slide._save_slides

        def play_internal(scene, *a, **k):
            prog.anim = 0.0
            prog.anims += 1
            prog.emit()
            try:
                return orig_play_internal(scene, *a, **k)
            finally:
                prog.anim = 1.0
                prog.emit()

        def update_to_time(scene, t):
            dur = getattr(scene, "duration", 0) or 0
            if dur > 0:
                prog.anim = max(0.0, min(1.0, t / dur))
                # 区切りの中にいくつ動きがあるかは事前に分からないので、戻らないように少しずつ進める
                prog.within = max(prog.within, min(0.95, prog.anim * 0.9))
                prog.emit()
            return orig_update(scene, t)

        def next_slide(slide, *a, **k):
            result = orig_next(slide, *a, **k)
            prog.seg += 1
            prog.within = 0.0
            prog.anim = 0.0
            prog.emit(force=True)
            return result

        def finish(writer, *a, **k):
            prog.stage = "combine"
            prog.emit(force=True)
            return orig_finish(writer, *a, **k)

        def save_slides(slide, *a, **k):
            prog.stage = "slides"
            prog.emit(force=True)
            return orig_save(slide, *a, **k)

        Scene.play_internal = play_internal
        Scene.update_to_time = update_to_time
        Slide.next_slide = next_slide
        SceneFileWriter.finish = finish
        Slide._save_slides = save_slides


def main() -> int:
    py_file, cls, quality, result_path = sys.argv[1:5]
    result: dict = {"ok": False}
    try:
        from manim.__main__ import main as manim_main  # noqa: PLC0415

        try:
            prog = _Progress(_segments(py_file, cls))
            prog.install()
            prog.emit(force=True)
        except Exception as e:  # noqa: BLE001 — 進み具合が出せなくても描画は続ける
            print(f"（進み具合の表示を準備できませんでした: {e}）", flush=True)

        args = ["render", *quality.split(), "--media_dir", "media", "--progress_bar", "none", py_file, cls]
        print(f"$ manim {' '.join(args)}", flush=True)
        try:
            manim_main.main(args=args, prog_name="manim", standalone_mode=False)
        except SystemExit as e:  # click が終了コード付きで抜ける場合
            if e.code not in (0, None):
                raise RuntimeError(f"manim が終了コード {e.code} で終了しました。") from None
        # 動画・音声（焼き込む）: 全体の動画の音声を、スライドごとの動画に入れる
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from slideaudio import mux_slide_audio  # noqa: PLC0415
            n = mux_slide_audio(Path.cwd(), py_file, cls)
            if n:
                print(f"（音声を {n} 個のスライドの動画に入れました）", flush=True)
        except Exception as e:  # noqa: BLE001 — 音声を入れられなくても、映像は使える
            print(f"（スライドの動画に音声を入れられませんでした: {e}）", flush=True)
        result = {"ok": True}
    except BaseException as exc:  # noqa: BLE001 — すべての例外を記録して返す
        traceback.print_exc()
        chain = list(reversed(_chain(exc)))  # 元の例外から順に
        frames = []
        for e in chain:
            frames.extend(_frames(e.__traceback__))
        # 利用者に見せる例外は、SystemExit やこのスクリプトの包み直しではなく、元の例外
        primary = next((e for e in chain if not isinstance(e, SystemExit)
                        and not str(e).startswith("manim が終了コード")), exc)
        exc = primary
        msg = f"{type(exc).__name__}: {exc}"
        tex_log = None
        m = re.search(r"log file:\s*(.+?\.log)", str(exc))
        if m:
            tex_log = m.group(1).strip()
        result = {"ok": False, "type": type(exc).__name__, "message": msg, "frames": frames,
                  "texLog": tex_log, "traceback": traceback.format_exc()}
    Path(result_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    # manim-slides は長いスライドの逆再生の動画を、プロセスを分けて作る（multiprocessing.Pool）。Linux・macOS の既定の
    # fork では、それまでに動画を扱った（PyAV・FFmpeg の）スレッドの錠が、子プロセスで掛かったままになり、まれに止まって
    # しまう。Windows と同じ spawn（新しいプロセスで始める）にする
    import multiprocessing
    multiprocessing.set_start_method("spawn", force=True)
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    # アニメーションの途中でエラーが起きると、Manim の動画を書き出すスレッド（SceneFileWriter.listen_and_write）が
    # 次のコマを待ち続け、通常の終了ではそのスレッドの終わりを待って止まってしまう（manim 0.20.1）。
    # 結果はすでに保存したので、残ったスレッドを待たずに終了する。
    os._exit(code)
