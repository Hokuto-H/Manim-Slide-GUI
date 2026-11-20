"""描画のあとで、全体の動画の音声を、manim-slides のスライド（区切り）ごとの動画に入れ直す。

Manim の add_sound の音声は、シーン全体の動画（media/videos/<ファイル名>/<画質>/<クラス名>.mp4）にだけ入り、
manim-slides が作るスライドごとの動画（slides/files/<クラス名>/*.mp4）には入らない。スライドごとの動画は
全体の動画を区切ったものと同じ並びなので、スライドの長さを順に足した時刻で、全体の音声を切り分けて入れる。
逆再生用の動画（*_reversed.mp4）には入れない。
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def _duration(path: Path) -> float:
    import av

    with av.open(str(path)) as c:
        vs = c.streams.video[0]
        if vs.duration and vs.time_base:
            return float(vs.duration * vs.time_base)
        return (c.duration or 0) / 1_000_000


def _full_movie(folder: Path, py_stem: str, cls: str) -> Path | None:
    cands = sorted((folder / "media" / "videos" / py_stem).glob(f"*/{cls}.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return cands[0] if cands else None


def _read_audio(path: Path):
    """全体の動画の音声（float32、(サンプル数, 2)、44.1 kHz）。音声が無ければ None。"""
    import av
    import numpy as np

    with av.open(str(path)) as c:
        if not c.streams.audio:
            return None
        rs = av.AudioResampler(format="fltp", layout="stereo", rate=44100)
        chunks = []
        for fr in c.decode(c.streams.audio[0]):
            for o in rs.resample(fr):
                chunks.append(o.to_ndarray().T.copy())
        for o in rs.resample(None):
            chunks.append(o.to_ndarray().T.copy())
    return np.concatenate(chunks).astype(np.float32) if chunks else None


def _has_audio(path: Path) -> bool:
    import av

    with av.open(str(path)) as c:
        return bool(c.streams.audio)


def _mux(video: Path, pcm, rate: int = 44100) -> None:
    """video の映像はそのまま、音声 pcm（(サンプル数, 2)）を AAC で入れた動画に置き換える。pcm が None なら音声を外す。"""
    import av
    import numpy as np

    tmp = video.with_name(video.stem + ".gui_audio.mp4")
    with av.open(str(video)) as src, av.open(str(tmp), mode="w") as dst:
        vin = src.streams.video[0]
        vout = dst.add_stream_from_template(vin)
        aout = dst.add_stream("aac", rate=rate, layout="stereo") if pcm is not None else None
        for pkt in src.demux(vin):
            if pkt.dts is None:
                continue
            pkt.stream = vout
            dst.mux(pkt)
        if aout is None:
            pcm = np.zeros((0, 2), dtype=np.float32)
        frame_size = 1024
        data = np.ascontiguousarray(pcm.T.astype(np.float32))
        pts = 0
        for k in range(0, data.shape[1], frame_size):
            if aout is None:
                break
            chunk = data[:, k:k + frame_size]
            fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(chunk), format="fltp", layout="stereo")
            fr.sample_rate = rate
            fr.pts = pts
            pts += chunk.shape[1]
            for p in aout.encode(fr):
                dst.mux(p)
        if aout is not None:
            for p in aout.encode(None):
                dst.mux(p)
    import time

    for k in range(20):  # ほかのプロセスが開いていると置き換えられない（Windows）ので、少し待って試し直す
        try:
            os.replace(tmp, video)
            return
        except PermissionError:
            if k == 19:
                tmp.unlink(missing_ok=True)
                raise PermissionError(f"{video.name} を書き換えられません（発表ウィンドウなど、ほかのプログラムが開いています）") from None
            time.sleep(0.25)


def mux_slide_audio(folder: Path, py_file: str, cls: str) -> int:
    """音声のあるスライドの数を返す（全体の動画に音声が無ければ 0）。"""
    import numpy as np

    cfg_path = folder / "slides" / f"{cls}.json"
    full = _full_movie(folder, Path(py_file).stem, cls)
    if not cfg_path.is_file() or full is None:
        return 0
    rate = 44100
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    pcm = _read_audio(full)
    if pcm is None or not np.any(np.abs(pcm) > 1e-5):
        # 音声が無い: 前の描画で入れた音声が、使い回された動画に残っていれば外す
        for sl in cfg.get("slides", []):
            f = Path(sl["file"])
            f = f if f.is_absolute() else folder / f
            if f.is_file() and _has_audio(f):
                _mux(f, None)
        return 0
    t, n = 0.0, 0
    for sl in cfg.get("slides", []):
        f = Path(sl["file"])
        f = f if f.is_absolute() else folder / f
        d = _duration(f)
        a, b = int(round(t * rate)), int(round((t + d) * rate))
        part = pcm[a:b]
        if len(part) < b - a:  # 全体の音声が短いときは無音で埋める
            part = np.concatenate([part, np.zeros((b - a - len(part), 2), dtype=np.float32)])
        if np.any(np.abs(part) > 1e-5):
            _mux(f, part, rate)
            n += 1
        elif _has_audio(f):
            _mux(f, None)
        t += d
    return n
