"""描画した結果を、クリックせずに最後まで流した 1 本の動画（mp4）にする。字幕（.srt）も作れる。

発表の録画と同じ組み立て（record_compose.py）を使う。ここでは「最初から最後まで、決めた秒数ずつ待って進めた発表」の
記録（events.jsonl）を作る:
- 区切り（manim-slides のスライド）ごとに、その動画を最後まで流す
- 「終わったら自動で次へ」の区切りは、待たずに次へ
- それ以外は、クリックの代わりに待ち時間（ステップ・スライドの初めの表示ごとの秒数。無ければ全体の秒数）だけ待つ
  - 「くり返す」の区切りは、待つ間くり返す（くり返しの切れ目で次へ。少なくとも 1 回は流す）
  - それ以外は、最後のコマのまま待つ
- 動画・音声（発表で再生）は、発表と同じ決まり（present_media の状態の計算）で、区切りの時刻どおりに再生・停止する
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from .present_media import advance, apply_cue, enter_slide, initial_state

FPS = 30


def _duration(path: Path) -> float:
    import av
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        if s.duration and s.time_base:
            return float(s.duration * s.time_base)
        if c.duration:
            return c.duration / 1e6
        return float(s.frames / (s.average_rate or 30)) if s.frames else 0.1


def wait_table(project: dict[str, Any]) -> dict[str, float]:
    """"スライドの id:start" / "スライドの id:ステップの id" → 待ち時間（決めてある所だけ）。"""
    out: dict[str, float] = {}
    for sl in project.get("slides") or []:
        if sl.get("videoWait") is not None:
            out[f"{sl.get('id')}:start"] = float(sl["videoWait"])
        for st in sl.get("steps") or []:
            if st.get("videoWait") is not None:
                out[f"{sl.get('id')}:{st.get('id')}"] = float(st["videoWait"])
    return out


def build(folder: Path, cls: str, project: dict[str, Any], raw: Path, wait: float) -> dict[str, Any]:
    """raw に events.jsonl を作る。{"duration", "segments", "subtitles": [(t0, t1, 文)], "keys": bool}。"""
    cfg = json.loads((folder / "slides" / f"{cls}.json").read_text(encoding="utf-8"))
    segs = cfg.get("slides") or []
    if not segs:
        raise ValueError("描画結果に区切りがありません。")
    gp = folder / "slides" / "gui_pages"
    try:
        keys = json.loads((gp / f"{cls}.segs.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        keys = None
    if not isinstance(keys, list) or len(keys) != len(segs):
        keys = None  # 古い描画（区切りの元の記録が無い）: すべて全体の秒数
    try:
        plan = json.loads((gp / f"{cls}.media.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        plan = None
    try:  # 付録のスライドは、1 本の動画に入れない
        deck = json.loads((gp / f"{cls}.deck.json").read_text(encoding="utf-8"))
        appendix = {str(x.get("id")) for x in deck.get("slides") or [] if x.get("appendix")}
    except (OSError, ValueError, AttributeError):
        appendix = set()
    waits = wait_table(project)
    media = (plan or {}).get("media") or {}
    segslides = (plan or {}).get("segments") or []
    cues = (plan or {}).get("cues") or []
    states = {mid: initial_state(spec) for mid, spec in media.items()}

    raw.mkdir(parents=True, exist_ok=True)
    f = open(raw / "events.jsonl", "w", encoding="utf-8")  # noqa: SIM115
    w = lambda ev: f.write(json.dumps(ev, ensure_ascii=False, separators=(",", ":")) + "\n")  # noqa: E731
    res = list(cfg.get("resolution") or [1920, 1080])
    w({"t": 0.0, "k": "meta", "version": 1, "cls": cls, "res": res, "kind": "video",
       "media": {f"0:{mid}": {"path": sp.get("path"), "kind": sp.get("kind"), "rect": sp.get("rect"),
                              "posterTime": float(sp.get("posterTime") or sp.get("trimStart") or 0.0)} for mid, sp in media.items()},
       "mic": "", "camera": ""})
    dt = 1.0 / FPS
    T = 0.0
    n = 0  # 出力のコマの番号
    prev_slide = None
    subs: list[tuple[float, float, str]] = []
    last_m = None
    last_main = max((j for j in range(len(segs)) if not (keys and str(keys[j]).split(":")[0] in appendix)), default=len(segs) - 1)
    for j, seg in enumerate(segs):
        if keys and str(keys[j]).split(":")[0] in appendix:
            continue
        rel = str(seg.get("file") or "")
        dur = max(0.04, _duration(folder / rel))
        key = keys[j] if keys else None
        wj = waits.get(key, wait) if key else wait
        if seg.get("auto_next") and j < last_main:
            hold = 0.0
        else:
            hold = wj
        if seg.get("loop"):
            total = dur * max(1, math.ceil((dur + hold) / dur - 1e-6))
        else:
            total = dur + hold
        if media:
            slide = segslides[j] if j < len(segslides) else (segslides[-1] if segslides else 0)
            if slide != prev_slide:
                for mid, spec in media.items():
                    enter_slide(spec, states[mid], slide, True)
                prev_slide = slide
        todo = sorted([c for c in cues if c[0] == j], key=lambda c: c[1])
        t0 = T
        last_p = None
        notes = str(seg.get("notes") or "").strip()
        if notes:
            subs.append((t0, t0 + total, notes))
        while n * dt < t0 + total - 1e-9:
            t = n * dt
            lt = t - t0
            p = (lt % dur) if seg.get("loop") else min(lt, max(0.0, dur - 0.001))
            if last_p is None or abs(p - last_p) > 1e-6:
                w({"t": round(t, 4), "k": "v", "f": rel, "p": round(p, 4)})
                last_p = p
            if media:
                while todo and todo[0][1] <= lt + 1e-6:
                    c = todo.pop(0)
                    if c[2] in media:
                        apply_cue(media[c[2]], states[c[2]], c[3], c[4])
                items = {}
                for mid, spec in media.items():
                    st = states[mid]
                    if not st["visible"] and not st["playing"]:
                        continue
                    start = float(spec.get("trimStart") or 0.0)
                    end = float(spec.get("trimEnd") or spec.get("duration") or 0.0)
                    fade = 1.0
                    fi, fo = float(spec.get("fadeIn") or 0.0), float(spec.get("fadeOut") or 0.0)
                    if fi > 0:
                        fade = min(fade, max(0.0, (st["pos"] - start) / fi))
                    if fo > 0 and end:
                        fade = min(fade, max(0.0, (end - st["pos"]) / fo))
                    items[f"0:{mid}"] = {"vis": bool(st["visible"]), "play": bool(st["playing"]), "pos": round(st["pos"], 3),
                                         "vol": round(st["volume"] * fade, 3),
                                         "poster": bool(st["visible"] and not st["playing"] and abs(st["pos"] - start) < 0.05)}
                if items != last_m:
                    w({"t": round(t, 4), "k": "m", "items": items})
                    last_m = items
                for mid, spec in media.items():
                    advance(spec, states[mid], dt)
            n += 1
        # 区切りの中で、まだ行っていない操作（区切りの終わりより後の時刻）は、次へ進むときに行う（発表と同じ）
        for c in todo:
            if c[2] in media:
                apply_cue(media[c[2]], states[c[2]], c[3], c[4])
        T = t0 + total
    w({"t": round(T, 4), "k": "end"})
    f.close()
    (raw / "done").write_text("1", encoding="utf-8")
    return {"duration": T, "segments": len(segs), "subtitles": subs, "keys": keys is not None}


_CLICK = re.compile(r"(?:^|\n\n)【クリック \d+】\n\n")
MAX_W = 36  # 字幕の 1 行の幅（全角の文字の数。半角は 0.5）
MAX_LINES = 2  # 1 つの字幕に出す行の数


def split_notes(notes: str) -> tuple[str, str]:
    """区切りのノート（codegen.segment_notes）を、スライドのノートとステップのノートに分ける。"""
    m = _CLICK.search(notes or "")
    if not m:
        return (notes or "").strip(), ""
    return notes[:m.start()].strip(), notes[m.end():].strip()


def subtitle_text(notes: str, mode: str) -> str:
    """字幕に出す文（Markdown のまま）。mode: "all" = スライドとステップのノート（見出しは外す）、
    "step" = ステップのノートだけ（ステップのノートが無い区切りでは、スライドのノート）。"""
    slide, step = split_notes(notes)
    if mode == "step":
        return step or slide
    return "\n".join(x for x in (slide, step) if x)


def _plain(md: str) -> str:
    """字幕に入れるため、Markdown の飾りを外す。"""
    out = []
    for line in md.replace("\r\n", "\n").split("\n"):
        line = re.sub(r"^\s{0,3}#{1,6}\s*", "", line)
        line = re.sub(r"^\s*[-*+]\s+", "・", line)
        line = re.sub(r"^\s*\d+[.)]\s+", "", line)
        line = re.sub(r"^\s*>\s?", "", line)
        line = re.sub(r"(\*\*|__|`)", "", line)
        line = re.sub(r"(?<!\w)[*_](\S.*?\S|\S)[*_](?!\w)", r"\1", line)
        line = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", line)
        line = re.sub(r"\$([^$]+)\$", r"\1", line)  # 数式の $…$ は中身だけ
        line = re.sub(r"\s+", " ", line).strip()
        if line and not re.fullmatch(r"[-*_=]{3,}", line):
            out.append(line)
    return "\n".join(out)


def _width(text: str) -> float:
    import unicodedata
    return sum(1.0 if unicodedata.east_asian_width(ch) in "WF" else 0.5 for ch in text)


def _wrap(line: str) -> list[str]:
    """長い行を MAX_W 以内に折る。文の終わり（。！？）を一番に、次に読点・閉じかっこ・空白のあたりで折る。"""
    out = []
    while _width(line) > MAX_W:
        w, cut, end, soft = 0.0, len(line), None, None
        for i, ch in enumerate(line):
            w += _width(ch)
            if w > MAX_W:
                cut = i
                break
            if w >= MAX_W * 0.3:
                if ch in "。！？!?．":
                    end = i + 1
                elif ch in "、，,）」』 ":
                    soft = i + 1
        k = end or soft or cut
        out.append(line[:k].rstrip())
        line = line[k:].lstrip()
    if line:
        out.append(line)
    return out


def _chunks(text: str, keep: int = MAX_LINES) -> list[str]:
    """字幕 1 つに MAX_LINES 行まで（keep 行以内に収まるなら分けない）。長い文は、折った行を、いくつかの字幕に分ける。"""
    lines: list[str] = []
    for ln in text.split("\n"):
        lines += _wrap(ln)
    if len(lines) <= keep:
        return ["\n".join(lines)] if lines else []
    return ["\n".join(lines[i:i + MAX_LINES]) for i in range(0, len(lines), MAX_LINES)]


def _ts(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(subs: list[tuple[float, float, str]], path: Path, mode: str = "all") -> int:
    """.srt を書く。書いた字幕の数。
    - 区切りのノートを、mode に合わせて字幕の文にし（【クリック n】の見出しは入れない）、Markdown の飾りを外す
    - 続けて同じ文の所は 1 つにまとめる（スライドのノートを、そのスライドの間ずっと出す）
    - 1 つの字幕は 2 行まで（スライドとステップのノートを続けて出すときは 4 行まで。1 行は全角 36 文字まで）。
      長いときは、映している時間を文の長さで分けて、続けて出す"""
    merged: list[list[Any]] = []
    for t0, t1, notes in subs:
        text = _plain(subtitle_text(notes, mode))
        if not text:
            continue
        if merged and merged[-1][2] == text and abs(merged[-1][1] - t0) < 0.05:
            merged[-1][1] = t1
        else:
            merged.append([t0, t1, text])
    cues: list[list[Any]] = []
    for t0, t1, text in merged:
        # スライドとステップのノートを続けて出すときは、4 行までなら 1 つの字幕のまま（ステップのノートだけが一瞬で消えないように）
        parts = _chunks(text, keep=4 if mode == "all" else MAX_LINES)
        weights = [max(10.0, _width(p)) for p in parts]  # 短い字幕にも、読めるだけの時間を
        t = t0
        for p, wt in zip(parts, weights):
            d = (t1 - t0) * wt / sum(weights)
            if cues and cues[-1][2] == p and abs(cues[-1][1] - t) < 0.05:
                cues[-1][1] = t + d  # 前と同じ字幕が続くなら、のばす
            else:
                cues.append([t, t + d, p])
            t += d
    lines = []
    for i, (t0, t1, text) in enumerate(cues, start=1):
        lines += [str(i), f"{_ts(t0)} --> {_ts(t1)}", text, ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return len(cues)
