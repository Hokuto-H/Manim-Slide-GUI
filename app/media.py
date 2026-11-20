"""動画・音声の取り込み（プロジェクトの clips/ へのコピー）と、長さ・大きさ・音声の有無・ポスター（ある時刻のコマ）。

Manim は描画の結果をプロジェクトの media/ に書くので、取り込んだ動画・音声は clips/ に置く（混ざらないように）。
"""

from __future__ import annotations

import hashlib
import io
import re
import shutil
from pathlib import Path
from typing import Any

from .project import ProjectError

CLIPS_DIR = "clips"
MAX_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi")
AUDIO_EXT = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac")
_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_stem(name: str) -> str:
    stem = Path(name or "clip").stem
    stem = _BAD_CHARS.sub("_", stem).strip(" .") or "clip"
    return stem[:40]


def probe(path: Path) -> dict[str, Any]:
    """{kind: "video" | "audio", duration（秒）, width, height, fps, hasAudio}。読めなければ ProjectError。"""
    import av

    try:
        with av.open(str(path)) as c:
            vs = next((s for s in c.streams.video if not _is_cover(s)), None)
            aus = c.streams.audio[0] if c.streams.audio else None
            if vs is None and aus is None:
                raise ProjectError("動画・音声として読み込めませんでした（映像も音声も入っていません）。")
            dur = None
            if c.duration:
                dur = c.duration / 1_000_000
            for s in (vs, aus):
                if dur is None and s is not None and s.duration and s.time_base:
                    dur = float(s.duration * s.time_base)
            if dur is None:  # 長さが書かれていないファイルは、最後まで読んで数える
                dur = 0.0
                for pkt in c.demux(vs or aus):
                    if pkt.pts is not None and pkt.time_base:
                        dur = max(dur, float((pkt.pts + (pkt.duration or 0)) * pkt.time_base))
            info: dict[str, Any] = {"kind": "video" if vs is not None else "audio", "duration": round(float(dur), 3),
                                    "hasAudio": aus is not None}
            if vs is not None:
                w, h = vs.codec_context.width, vs.codec_context.height
                rot = _rotation(vs)
                if rot in (90, 270):
                    w, h = h, w
                info.update(width=int(w), height=int(h), fps=round(float(vs.average_rate or 30), 3), rotation=rot)
            return info
    except ProjectError:
        raise
    except Exception as e:  # noqa: BLE001 - PyAV は形式ごとに様々な例外を出す
        raise ProjectError(f"動画・音声として読み込めませんでした（{path.suffix or '形式不明'}）: {e}") from e


def _is_cover(stream) -> bool:
    """音声ファイルに付いたジャケット画像（動画の流れとして見える）。"""
    try:
        return bool(stream.disposition & 0x400) or (stream.frames == 1 and stream.codec_context.name in ("mjpeg", "png"))
    except Exception:  # noqa: BLE001
        return False


def _rotation(stream) -> int:
    try:
        r = int(stream.metadata.get("rotate", 0) or 0)
    except (TypeError, ValueError):
        r = 0
    return r % 360


def import_media(folder: Path, src: Path, filename: str) -> dict[str, Any]:
    """一時ファイル src を検査して clips/ に置き、{path, name, kind, duration, width, height, fps, hasAudio} を返す。"""
    if not src.is_file() or src.stat().st_size == 0:
        raise ProjectError("ファイルが空です。")
    if src.stat().st_size > MAX_BYTES:
        raise ProjectError("ファイルが大きすぎます（4 GB まで）。")
    ext = Path(filename or "").suffix.lower()
    if ext not in VIDEO_EXT + AUDIO_EXT:
        raise ProjectError(f"この形式（{ext or '拡張子なし'}）は取り込めません。動画は mp4・mov・webm など、音声は mp3・wav・m4a・ogg・flac などを使ってください。")
    info = probe(src)
    h = hashlib.sha256()
    with src.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    d = folder / CLIPS_DIR
    d.mkdir(parents=True, exist_ok=True)
    target = d / f"{_safe_stem(filename)}-{h.hexdigest()[:10]}{ext}"
    if not target.exists():
        shutil.move(str(src), target)
    return {"path": f"{CLIPS_DIR}/{target.name}", "name": filename or target.name, **info}


def resolve(folder: Path, rel: str) -> Path:
    rel = (rel or "").replace("\\", "/")
    p = (folder / rel).resolve()
    root = folder.resolve()
    if root not in p.parents:
        raise ProjectError("プロジェクトのフォルダの外のファイルは開けません。")
    return p


def poster(folder: Path, rel: str, t: float, width: int = 0) -> bytes:
    """動画の t 秒のコマ（PNG）。width を渡すと、その幅に縮める。clips/.posters に残して次から使う。"""
    import av
    from PIL import Image

    src = resolve(folder, rel)
    if not src.is_file():
        raise ProjectError(f"動画が見つかりません: {rel}")
    t = max(0.0, float(t))
    cache = folder / CLIPS_DIR / ".posters" / f"{src.stem}_{t:.3f}_{int(width)}.png"
    if cache.is_file():
        return cache.read_bytes()
    img = None
    with av.open(str(src)) as c:
        vs = next((s for s in c.streams.video if not _is_cover(s)), None)
        if vs is None:
            raise ProjectError("映像の入っていないファイルです。")
        rot = _rotation(vs)
        try:
            c.seek(int(t / float(vs.time_base)), stream=vs, backward=True, any_frame=False)
        except Exception:  # noqa: BLE001 - シークできない形式は最初から読む
            c.seek(0)
        last = None
        for fr in c.decode(vs):
            last = fr
            if fr.time is not None and fr.time + 1e-6 >= t:
                break
        if last is not None:
            img = last.to_image()
    if img is None:
        raise ProjectError("この時刻のコマを取り出せませんでした。")
    if rot:
        img = img.rotate(-rot, expand=True)
    if width and img.width > width:
        img = img.resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG")
    data = buf.getvalue()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


def missing_media(project: dict[str, Any], folder: Path) -> list[dict[str, Any]]:
    """書き出し前の検査: 見つからない動画・音声の一覧（problems の形）。"""
    problems = []
    for si, slide in enumerate(project["slides"]):
        for el in slide["elements"]:
            if el.get("type") != "media":
                continue
            rel = el.get("path") or ""
            try:
                ok = bool(rel) and resolve(folder, rel).is_file()
            except ProjectError:
                ok = False
            if not ok:
                what = "動画" if el.get("kind") == "video" else "音声"
                problems.append({"slideIndex": si, "elementId": el.get("id"), "var": el.get("var"),
                                 "message": f"スライド{si + 1}: {what}「{el.get('var')}」のファイルが見つかりません: {rel or '（未指定）'}"})
    return problems


# ---------------------------------------------------------------- 動く画像（アニメーション GIF・WebP・APNG）

ANIM_IMAGE_EXT = (".gif", ".webp", ".png", ".apng")
MAX_ANIM_FRAMES = 3000


def _hex_rgb(c: str | None) -> tuple[int, int, int]:
    s = str(c or "#FFFFFF").lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except ValueError:
        return 255, 255, 255


def anim_image_frames(src: Path) -> tuple[list[Any], list[float]]:
    """動く画像のコマ（RGBA の Pillow 画像）と、各コマの表示時間（秒）。1 コマだけなら ProjectError。"""
    from PIL import Image, ImageSequence  # noqa: PLC0415

    try:
        im = Image.open(src)
    except Exception as e:  # noqa: BLE001
        raise ProjectError("画像として読み込めませんでした。") from e
    with im:
        if int(getattr(im, "n_frames", 1)) < 2:
            raise ProjectError("動かない画像です（コマが 1 つだけ）。画像として追加してください。")
        frames, durs = [], []
        for fr in ImageSequence.Iterator(im):
            d = fr.info.get("duration", im.info.get("duration", 100)) or 0
            # ブラウザと同じく、0.02 秒未満の指定は 0.1 秒として扱う
            durs.append(0.1 if d < 20 else d / 1000)
            frames.append(fr.convert("RGBA"))
            if len(frames) >= MAX_ANIM_FRAMES:
                break
    return frames, durs


def import_anim_image(folder: Path, src: Path, filename: str, background: str | None = None) -> dict[str, Any]:
    """動く画像を、音の無い mp4（H.264）にして clips/ に置く。透明な部分は background の色で塗る（mp4 は透明を持てないため）。
    1 回分の長さの動画にする（くり返しは要素の「くり返す」で）。返す: import_media と同じ形＋ fromImage・frames・background。"""
    import av  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    ext = Path(filename or "").suffix.lower()
    if ext not in ANIM_IMAGE_EXT:
        raise ProjectError(f"この形式（{ext or '拡張子なし'}）は動く画像として取り込めません（GIF・WebP・PNG（APNG））。")
    frames, durs = anim_image_frames(src)
    w, h = frames[0].size
    W, H = w + (w % 2), h + (h % 2)  # H.264 の yuv420p は縦横が偶数
    fps = 30 if min(durs) >= 1 / 30 else 60
    bg = _hex_rgb(background)
    h_ = hashlib.sha256()
    with src.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h_.update(chunk)
    h_.update(f"|{bg}".encode())
    d = folder / CLIPS_DIR
    d.mkdir(parents=True, exist_ok=True)
    target = d / f"{_safe_stem(filename)}-{h_.hexdigest()[:10]}.mp4"
    if not target.exists():
        tmp = target.with_suffix(".part.mp4")
        try:
            with av.open(str(tmp), "w") as out:
                st = out.add_stream("libx264", rate=fps)
                st.width, st.height, st.pix_fmt = W, H, "yuv420p"
                st.options = {"crf": "18", "preset": "veryfast", "tune": "animation"}
                t_end, n_out = 0.0, 0
                for fr, du in zip(frames, durs, strict=True):
                    t_end += du
                    canvas = Image.new("RGB", (W, H), bg)
                    canvas.paste(fr, (0, 0), fr)
                    vf = av.VideoFrame.from_image(canvas)
                    while n_out < max(1, round(t_end * fps)) or n_out == 0:  # コマの時間の分だけ同じコマを並べる
                        for pkt in st.encode(vf):
                            out.mux(pkt)
                        n_out += 1
                for pkt in st.encode():
                    out.mux(pkt)
            tmp.replace(target)
        except ProjectError:
            raise
        except Exception as e:  # noqa: BLE001
            tmp.unlink(missing_ok=True)
            raise ProjectError(f"動く画像を動画にできませんでした: {e}") from e
    info = probe(target)
    return {"path": f"{CLIPS_DIR}/{target.name}", "name": filename or target.name, **info,
            "fromImage": filename, "frames": len(frames), "background": "#%02X%02X%02X" % bg}
