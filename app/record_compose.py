"""発表の録画を、1 本の動画（mp4）に組み立てる。present_record.py が残した記録から作る。

使い方: python record_compose.py <記録のフォルダ> <出力の mp4> [設定の JSON]
進み具合・結果は <記録のフォルダ>/compose.json に書く（操作アプリが読む）。

組み立て方（出力の 1 コマずつ）:
1. その時刻に映していた区切りの動画のコマ（"v" の出来事）
2. 重ねて再生していた動画（"m"。見えていれば、その再生位置のコマ。まだ再生前ならポスター）
3. 発表の道具（"tool"・"pen"。発表ウィンドウと同じ描き方: present_tools.paint_tools）
4. カメラの小窓（"seg" のファイル。設定の隅・大きさ）
音: スライドの動画の音（映していた位置どおりに）・重ねて再生した動画・音声の音・マイクの音を足し合わせる。
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

RATE = 48000
CANVAS_W, CANVAS_H = 1920, 1080
DEFAULTS = {"fps": 30, "camera": True, "camCorner": "br", "camSize": 0.25, "camRound": True,
            "micVol": 1.0, "slideVol": 1.0, "slideSound": True}


# ---------------------------------------------------------------- 記録を読む

def load_events(raw: Path) -> dict[str, Any]:
    ev: list[dict[str, Any]] = []
    with open(raw / "events.jsonl", encoding="utf-8") as f:
        for line in f:
            try:
                ev.append(json.loads(line))
            except ValueError:
                break  # 途中で終わった行（発表ウィンドウが落ちたとき）から後は使わない
    meta = next((e for e in ev if e.get("k") == "meta"), None)
    if meta is None:
        raise ValueError("録画の記録が空です。")
    end = next((e["t"] for e in ev if e.get("k") == "end"), None)
    if end is None:
        end = max((float(e.get("t", 0)) for e in ev), default=0.0)
    by = {k: [e for e in ev if e.get("k") == k] for k in ("v", "tool", "pen", "m", "seg")}
    return {"meta": meta, "end": float(end), **by}


def resolve(raw: Path, rel: str) -> Path:
    """記録に入れた動画（src/）。無ければプロジェクトの中のもの。"""
    p = raw / "src" / rel
    if p.is_file():
        return p
    q = Path(rel)
    return q if q.is_absolute() else raw.parents[2] / rel


# ---------------------------------------------------------------- 動画のコマ

class Video:
    """動画を、前へ順に読みながら、t 秒のコマ（QImage）を返す。戻るときや大きく飛ぶときだけシークする。"""

    def __init__(self, path: Path, size: tuple[int, int] | None = None) -> None:
        import av
        self.c = av.open(str(path))
        self.s = self.c.streams.video[0]
        self.s.thread_type = "AUTO"
        self.size = size
        self.it = None
        self.cur = None
        self.nxt = None
        self.img = None
        self.img_of = None
        self.eof = False

    def _seek(self, t: float) -> None:
        tb = self.s.time_base
        if t > 0.5 and tb:
            self.c.seek(int((t - 0.5) / tb), stream=self.s, backward=True)
        else:
            self.c.seek(0, stream=self.s, backward=True)
        self.it = self.c.decode(self.s)
        self.cur = self.nxt = None
        self.eof = False

    def _next(self):
        try:
            return next(self.it)
        except (StopIteration, Exception):  # noqa: BLE001 — 読めない所は、前のコマのまま
            self.eof = True
            return None

    def frame_time(self, t: float) -> float | None:
        if self.it is None or (self.cur is not None and (t < self.cur.time - 1e-4 or t > self.cur.time + 2.0)):
            self._seek(t)
        while not self.eof:
            if self.nxt is None:
                self.nxt = self._next()
                if self.nxt is None:
                    break
                if self.nxt.time is None:
                    self.nxt = None
                    continue
            if self.cur is None or self.nxt.time <= t + 1e-4:
                self.cur, self.nxt = self.nxt, None
                if self.cur.time > t + 1e-4:
                    break  # 最初のコマより前
                continue
            break
        return None if self.cur is None else self.cur.time

    def get(self, t: float):
        from qtpy.QtGui import QImage
        ft = self.frame_time(t)
        if ft is None:
            return None
        if self.img_of != ft:
            fr = self.cur
            w, h = self.size or (fr.width, fr.height)
            import numpy as np
            arr = np.ascontiguousarray(fr.to_ndarray(format="bgra", width=w, height=h))
            self.img = QImage(arr.tobytes(), w, h, w * 4, QImage.Format.Format_ARGB32).copy()
            self.img_of = ft
        return self.img

    @property
    def native(self) -> tuple[int, int]:
        cc = self.s.codec_context
        return cc.width, cc.height

    def close(self) -> None:
        try:
            self.c.close()
        except Exception:  # noqa: BLE001
            pass


def fit(src: tuple[int, int], box: tuple[float, float]) -> tuple[int, int]:
    k = min(box[0] / max(1, src[0]), box[1] / max(1, src[1]))
    return max(2, round(src[0] * k)), max(2, round(src[1] * k))


# ---------------------------------------------------------------- 音

def has_audio(path: Path, cache: dict[str, bool]) -> bool:
    key = str(path)
    if key not in cache:
        try:
            import av
            with av.open(key) as c:
                cache[key] = bool(c.streams.audio)
        except Exception:  # noqa: BLE001
            cache[key] = False
    return cache[key]


class Clip:
    """出力の t0 秒から、ファイルの src0 秒からの音を dur 秒。gain は [(出力の時刻, 音量)]（間は直線でつなぐ）。"""

    def __init__(self, t0: float, path: Path, src0: float, dur: float, gain: list[tuple[float, float]]) -> None:
        self.t0, self.path, self.src0, self.dur, self.gain = t0, path, max(0.0, src0), dur, gain
        self.s0 = round(t0 * RATE)
        self.s1 = self.s0 + round(dur * RATE)
        self.gen = None
        self.buf = None
        self.done = False

    def _frames(self):
        import av
        import numpy as np
        c = av.open(str(self.path))
        try:
            st = c.streams.audio[0]
            if self.src0 > 0.3:
                c.seek(int((self.src0 - 0.3) * av.time_base), backward=True)
            res = av.AudioResampler(format="fltp", layout="stereo", rate=RATE)
            skip_to = self.src0
            started = False
            for fr in c.decode(st):
                t = fr.time
                for out in res.resample(fr):
                    a = out.to_ndarray().astype(np.float32)
                    if a.ndim == 1:
                        a = np.vstack([a, a])
                    if not started:
                        if t is None:
                            started = True
                        else:
                            cut = round((skip_to - t) * RATE)
                            if cut >= a.shape[1]:
                                t += a.shape[1] / RATE
                                continue
                            if cut > 0:
                                a = a[:, cut:]
                            started = True
                    yield a
                    if t is not None:
                        t += out.samples / RATE
        finally:
            c.close()

    def read(self, n: int):
        """次の n 個の標本（2 × n）。ファイルが尽きたら 0。"""
        import numpy as np
        out = np.zeros((2, n), np.float32)
        if self.done:
            return out
        if self.gen is None:
            try:
                self.gen = self._frames()
            except Exception:  # noqa: BLE001
                self.done = True
                return out
        k = 0
        while k < n:
            if self.buf is None or self.buf.shape[1] == 0:
                try:
                    self.buf = next(self.gen)
                except (StopIteration, Exception):  # noqa: BLE001
                    self.done = True
                    break
            m = min(n - k, self.buf.shape[1])
            out[:, k:k + m] = self.buf[:, :m]
            self.buf = self.buf[:, m:]
            k += m
        return out

    def gains(self, a: int, b: int):
        """標本 a〜b（出力の位置）の音量。"""
        import numpy as np
        g = self.gain
        if len(g) == 1:
            return np.full(b - a, g[0][1], np.float32)
        ts = (np.arange(a, b, dtype=np.float64)) / RATE
        return np.interp(ts, [p[0] for p in g], [p[1] for p in g]).astype(np.float32)


def slide_clips(rec: dict[str, Any], raw: Path, vol: float, cache: dict[str, bool]) -> list[Clip]:
    """映していた区切りの動画の位置どおりに、その動画の音を並べる（続けて再生していた所ごとに 1 つ）。"""
    vs = rec["v"]
    out: list[Clip] = []
    i = 0
    while i < len(vs):
        j = i
        while (j + 1 < len(vs) and vs[j + 1]["f"] == vs[i]["f"]
               and abs((vs[j + 1]["p"] - vs[i]["p"]) - (vs[j + 1]["t"] - vs[i]["t"])) < 0.15 and vs[j + 1]["p"] >= vs[j]["p"]):
            j += 1
        nxt = vs[j + 1]["t"] if j + 1 < len(vs) else rec["end"]
        t0 = vs[i]["t"]
        t1 = min(nxt, vs[j]["t"] + 0.05)
        if t1 - t0 > 0.04:
            path = resolve(raw, vs[i]["f"])
            if has_audio(path, cache):
                out.append(Clip(t0, path, vs[i]["p"], t1 - t0, [(t0, vol)]))
        i = j + 1
    return out


def media_clips(rec: dict[str, Any], raw: Path, vol: float, cache: dict[str, bool]) -> list[Clip]:
    """重ねて再生した動画・音声の音（再生していた所ごと。音量の変化（フェード）も）。"""
    media = rec["meta"].get("media") or {}
    out: list[Clip] = []
    ms = rec["m"]
    for key, spec in media.items():
        if not spec.get("path"):
            continue
        path = resolve(raw, spec["path"])
        if not has_audio(path, cache):
            continue
        run: list[tuple[float, float, float]] = []  # (t, pos, vol)

        def flush(end_t: float) -> None:
            if not run:
                return
            t0, p0 = run[0][0], run[0][1]
            t1 = min(end_t, run[-1][0] + 0.06)
            if t1 - t0 > 0.04:
                out.append(Clip(t0, path, p0, t1 - t0, [(t, v * vol) for t, _p, v in run]))
            run.clear()

        for e in ms:
            it = (e.get("items") or {}).get(key)
            t = e["t"]
            if it is None or not it.get("play"):
                flush(t)
                continue
            if run and abs((it["pos"] - run[0][1]) - (t - run[0][0])) > 0.25:
                flush(t)
            run.append((t, it["pos"], it.get("vol", 1.0)))
        flush(rec["end"])
    return out


def mic_clips(rec: dict[str, Any], raw: Path, vol: float) -> list[Clip]:
    out = []
    for s in rec["seg"]:
        if "a" not in s.get("kind", ""):
            continue
        p = raw / s["file"]
        if not p.is_file():
            continue
        dur = float(s["dur"])
        t0 = max(float(s["start"]), float(s["stop"]) - dur)  # 録り始めの遅れは、終わりに合わせて詰める
        out.append(Clip(t0, p, max(0.0, dur - (float(s["stop"]) - t0)), float(s["stop"]) - t0, [(t0, vol)]))
    return out


# ---------------------------------------------------------------- 組み立て

class Progress:
    def __init__(self, raw: Path) -> None:
        self.path = raw / "compose.json"
        self.last = 0.0

    def write(self, data: dict[str, Any], force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last < 0.5:
            return
        self.last = now
        tmp = self.path.with_suffix(".tmp")
        text = json.dumps({"pid": os.getpid(), **data}, ensure_ascii=False)
        # Windows では、操作アプリ（やウイルス対策ソフト）が compose.json を読んでいる一瞬は置き換えられない（WinError 5）。
        # 少し待ってやり直す。途中の進み具合なら、書けなくても次の回に任せて組み立てを続ける（最後の結果は長めにやり直す）
        tries = 40 if force else 5
        for k in range(tries):
            try:
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, self.path)
                return
            except OSError:
                if k == tries - 1:
                    if force:
                        raise
                    return
                time.sleep(0.05 if k < 5 else 0.25)


def open_output(out: Path, W: int, H: int, fps: int):
    import av
    c = av.open(str(out), "w")
    vs = None
    for codec, opts in (("libx264", {"preset": "veryfast", "crf": "20"}), ("h264", {}), ("mpeg4", {"qscale": "3"})):
        try:
            vs = c.add_stream(codec, rate=fps, options=opts)
            break
        except Exception:  # noqa: BLE001
            continue
    vs.width, vs.height, vs.pix_fmt = W, H, "yuv420p"
    aus = c.add_stream("aac", rate=RATE, layout="stereo")
    return c, vs, aus


def compose(raw: Path, out: Path, settings: dict[str, Any]) -> dict[str, Any]:
    import av
    import numpy as np
    from qtpy.QtCore import QRectF, Qt
    from qtpy.QtGui import QColor, QGuiApplication, QImage, QPainter, QPainterPath, QPen

    from present_tools import paint_tools

    app = QGuiApplication.instance() or QGuiApplication(["record_compose"])  # noqa: F841
    cfg = {**DEFAULTS, **(settings or {})}
    rec = load_events(raw)
    meta = rec["meta"]
    W, H = (int(x) for x in meta.get("res") or (1920, 1080))
    W, H = W - W % 2, H - H % 2
    fps = int(cfg["fps"])
    total = rec["end"]
    nframes = max(1, math.ceil(total * fps))
    prog = Progress(raw)
    prog.write({"status": "running", "progress": 0.0, "message": "動画にしています…"}, force=True)

    # 音
    cache: dict[str, bool] = {}
    clips: list[Clip] = []
    if cfg["slideSound"]:
        clips += slide_clips(rec, raw, float(cfg["slideVol"]), cache)
        clips += media_clips(rec, raw, float(cfg["slideVol"]), cache)
    clips += mic_clips(rec, raw, float(cfg["micVol"]))
    clips.sort(key=lambda c: c.s0)
    total_s = round(total * RATE)

    # 映像
    videos: dict[str, Video] = {}

    def slide_video(rel: str) -> Video:
        if rel not in videos:
            if len(videos) > 6:  # 開いたままの動画を増やしすぎない
                k0 = next(iter(videos))
                videos.pop(k0).close()
            videos[rel] = Video(resolve(raw, rel), (W, H))
        return videos[rel]

    media = meta.get("media") or {}
    sx, sy = W / CANVAS_W, H / CANVAS_H
    mvids: dict[str, Video] = {}
    posters: dict[str, Any] = {}

    def media_frame(key: str, t: float, poster: bool):
        spec = media[key]
        x, y, w, h = spec["rect"]
        box = (w * sx, h * sy)
        if key not in mvids:
            v = Video(resolve(raw, spec["path"]))
            v.size = fit(v.native, box)
            mvids[key] = v
        v = mvids[key]
        if poster:
            if key not in posters:
                pv = Video(resolve(raw, spec["path"]), v.size)
                img = pv.get(float(spec.get("posterTime") or 0.0))
                posters[key] = img.copy() if img is not None else None
                pv.close()
            img = posters[key]
        else:
            img = v.get(t)
        if img is None:
            return None, None, None
        r = QRectF(x * sx + (box[0] - v.size[0]) / 2, y * sy + (box[1] - v.size[1]) / 2, v.size[0], v.size[1])
        return img, QRectF(x * sx, y * sy, box[0], box[1]), r

    cams = []
    if cfg["camera"]:
        for s in rec["seg"]:
            if "v" in s.get("kind", "") and (raw / s["file"]).is_file():
                dur = float(s["dur"])
                t0 = max(float(s["start"]), float(s["stop"]) - dur)
                cams.append({"t0": t0, "t1": float(s["stop"]), "off": max(0.0, dur - (float(s["stop"]) - t0)), "path": raw / s["file"], "v": None})
    cam_w = round(W * float(cfg["camSize"]))
    margin = round(H * 0.025)

    def cam_frame(t: float):
        for cm in cams:
            if cm["t0"] <= t < cm["t1"]:
                if cm["v"] is None:
                    cm["v"] = Video(cm["path"])
                    nw, nh = cm["v"].native
                    cm["v"].size = (cam_w - cam_w % 2, max(2, round(cam_w * nh / max(1, nw))))
                img = cm["v"].get(t - cm["t0"] + cm["off"])
                return img, (str(cm["path"]), cm["v"].img_of)
            if cm["v"] is not None and t >= cm["t1"]:
                cm["v"].close()
                cm["v"] = None
        return None, None

    tmp = out.with_name(out.stem + ".part.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    c, vstream, astream = open_output(tmp, W, H, fps)
    a_done = 0
    a_rest = np.zeros((2, 0), np.float32)
    a_pts = 0
    active: list[Clip] = []
    ci = 0

    def mix_to(s_end: int, final: bool = False) -> None:
        nonlocal a_done, a_rest, a_pts, ci
        while a_done < s_end:
            n = min(RATE // 2, s_end - a_done)
            a, b = a_done, a_done + n
            buf = np.zeros((2, n), np.float32)
            while ci < len(clips) and clips[ci].s0 < b:
                active.append(clips[ci])
                ci += 1
            for cl in list(active):
                lo, hi = max(a, cl.s0), min(b, cl.s1)
                if hi > lo:
                    buf[:, lo - a:hi - a] += cl.read(hi - lo) * cl.gains(lo, hi)
                if cl.s1 <= b:
                    active.remove(cl)
            a_rest = np.concatenate([a_rest, buf], axis=1)
            a_done = b
            fs = astream.codec_context.frame_size or 1024
            while a_rest.shape[1] >= fs:
                chunk = np.clip(a_rest[:, :fs], -1.0, 1.0)
                a_rest = a_rest[:, fs:]
                fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(chunk), format="fltp", layout="stereo")
                fr.sample_rate = RATE
                fr.pts = a_pts
                a_pts += fs
                for pk in astream.encode(fr):
                    c.mux(pk)
        if final and a_rest.shape[1]:
            fs = astream.codec_context.frame_size or 1024
            chunk = np.zeros((2, fs), np.float32)
            chunk[:, :a_rest.shape[1]] = np.clip(a_rest, -1, 1)
            fr = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
            fr.sample_rate = RATE
            fr.pts = a_pts
            for pk in astream.encode(fr):
                c.mux(pk)

    vi = ti = pi = mi = 0
    vs, tools, pens, ms = rec["v"], rec["tool"], rec["pen"], rec["m"]
    cur_v = None
    tool = {"blank": None, "laser": None, "lens": None}
    strokes: list[list[Any]] = []
    pen_ver = 0
    items: dict[str, Any] = {}
    items_t = 0.0
    prev_key = None
    prev_arr = None
    corner = str(cfg["camCorner"])
    for n in range(nframes):
        t = n / fps
        while vi < len(vs) and vs[vi]["t"] <= t + 1e-6:
            cur_v = vs[vi]
            vi += 1
        while ti < len(tools) and tools[ti]["t"] <= t + 1e-6:
            tool = tools[ti]
            ti += 1
        while pi < len(pens) and pens[pi]["t"] <= t + 1e-6:
            e = pens[pi]
            del strokes[int(e["cut"]):]
            for j, pts in (e.get("ext") or {}).items():
                if int(j) < len(strokes):
                    strokes[int(j)][1].extend(pts)
            strokes.extend([[st[0], list(st[1])] + ([st[2]] if len(st) > 2 else []) for st in e.get("new") or []])
            pen_ver += 1
            pi += 1
        while mi < len(ms) and ms[mi]["t"] <= t + 1e-6:
            items, items_t = ms[mi].get("items") or {}, ms[mi]["t"]
            mi += 1

        # 前のコマと同じなら、作り直さない
        base_t = None
        base_img = None
        if cur_v is not None:
            v = slide_video(cur_v["f"])
            base_t = v.frame_time(cur_v["p"])
        mkeys = []
        for key, it in items.items():
            if key in media and it.get("vis") and media[key].get("kind") == "video" and media[key].get("rect") and not tool.get("blank"):
                mt = it["pos"] + (t - items_t if it.get("play") else 0.0)
                mkeys.append((key, round(mt, 3), bool(it.get("poster"))))
        cam_img, cam_key = cam_frame(t) if cams else (None, None)
        key = (cur_v["f"] if cur_v else None, base_t, json.dumps(tool, sort_keys=True), pen_ver, tuple(mkeys), cam_key)
        if key != prev_key or prev_arr is None:
            if cur_v is not None:
                base_img = slide_video(cur_v["f"]).get(cur_v["p"])
            if base_img is not None and base_img.width() == W and base_img.height() == H:
                img = base_img.copy()  # 区切りの動画のコマから描き始める
            else:
                img = QImage(W, H, QImage.Format.Format_ARGB32)
                img.fill(QColor("#000000"))
                if base_img is not None:
                    q = QPainter(img)
                    q.drawImage(QRectF(0, 0, W, H), base_img)
                    q.end()
            p = QPainter(img)
            try:
                p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
                for mk, mt, poster in mkeys:
                    try:
                        got = media_frame(mk, mt, poster)
                    except Exception:  # noqa: BLE001 — 読めない動画は飛ばす
                        continue
                    if got[0] is None:
                        continue
                    mimg, box, r = got
                    p.fillRect(box, QColor("#000000"))
                    p.drawImage(r, mimg)
                lens, laser = tool.get("lens"), tool.get("laser")
                mouse = (lens or laser or [0.0, 0.0])[:2]
                paint_tools(p, img, tool.get("blank"), strokes, mouse, bool(laser), bool(lens), float(lens[2]) if lens else 2.0)
                if cam_img is not None:
                    cw, ch = cam_img.width(), cam_img.height()
                    x = margin if corner in ("bl", "tl") else W - margin - cw
                    y = margin if corner in ("tl", "tr") else H - margin - ch
                    rect = QRectF(x, y, cw, ch)
                    rad = min(cw, ch) * 0.08 if cfg["camRound"] else 0.0
                    path = QPainterPath()
                    path.addRoundedRect(rect, rad, rad)
                    p.save()
                    p.setClipPath(path)
                    p.drawImage(rect, cam_img)
                    p.restore()
                    p.setBrush(Qt.BrushStyle.NoBrush)
                    p.setPen(QPen(QColor(255, 255, 255, 200), max(2.0, H / 400)))
                    p.drawPath(path)
            finally:
                p.end()
            ptr = img.constBits()
            arr = np.frombuffer(ptr, np.uint8, count=img.sizeInBytes()).reshape(H, img.bytesPerLine())[:, :W * 4].reshape(H, W, 4)
            prev_arr = av.VideoFrame.from_ndarray(arr, format="bgra").reformat(format="yuv420p")  # 同じコマが続くときは使い回す
            prev_key = key
        fr = prev_arr
        fr.pts = n
        for pk in vstream.encode(fr):
            c.mux(pk)
        mix_to(min(total_s, round((n + 1) / fps * RATE)))
        prog.write({"status": "running", "progress": round((n + 1) / nframes, 4), "message": f"動画にしています…（{int(t // 60)}:{int(t % 60):02d} / {int(total // 60)}:{int(total % 60):02d}）"})
    mix_to(total_s, final=True)
    for pk in vstream.encode():
        c.mux(pk)
    for pk in astream.encode():
        c.mux(pk)
    c.close()
    for v in list(videos.values()) + list(mvids.values()):
        v.close()
    for cm in cams:
        if cm["v"] is not None:
            cm["v"].close()
    os.replace(tmp, out)
    return {"duration": total, "frames": nframes}


def main() -> int:
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    settings = {}
    if len(sys.argv) > 3:
        try:
            settings = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            settings = {}
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    prog = Progress(raw)
    try:
        info = compose(raw, out, settings)
    except Exception as e:  # noqa: BLE001
        prog.write({"status": "error", "message": f"動画にできませんでした: {e}", "log": traceback.format_exc()[-4000:]}, force=True)
        return 1
    prog.write({"status": "done", "progress": 1.0, "message": "動画にしました。", "out": out.name, "settings": settings, **info}, force=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
