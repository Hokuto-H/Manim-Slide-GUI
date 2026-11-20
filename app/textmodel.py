"""テキスト要素のデータ形式と、gui_text に渡す引数への変換（書き出しとプレビューで共通）。

project.json のテキスト要素:
    runs:          [{"t": 文字列, "c": 色, "o": 透明度, "b", "i", "u", "s": 真偽, "bg": マーカーの色}, ...]
    text:          runs をつないだ文字列（検索・表示用。runs が無い古い形式では、これが内容）
    align:         "left" | "center" | "right" | "justify"
    letterSpacing: 文字間隔（em）  lineSpacing: 行間隔（倍率）  vertical: 縦書き
    opacity:       不透明度（0〜1。個別に指定していない文字に使う）
    outline:       {"mode": "none" | "stroke" | "hollow", "width": em, "color": 色 または None}
    box:           {"on": 真偽, "color", "opacity", "padding": em, "radius": em}
    arc:           円弧の角度（度）
"""

from __future__ import annotations

import re
from typing import Any

_HEX = re.compile(r"#[0-9A-Fa-f]{6}")
RUN_KEYS = ("t", "c", "o", "b", "i", "u", "s", "bg")
ALIGNS = ("left", "center", "right", "justify")


def _color(v: Any) -> str | None:
    return v.upper() if isinstance(v, str) and _HEX.fullmatch(v) else None


def normalize_runs(el: dict[str, Any]) -> list[dict[str, Any]]:
    """runs を整える（無ければ text から作る）。隣り合う同じ書式はまとめる。"""
    raw = el.get("runs")
    if not isinstance(raw, list) or not raw:
        raw = [{"t": str(el.get("text", ""))}]
    runs: list[dict[str, Any]] = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        t = str(r.get("t", ""))
        if not t:
            continue
        run: dict[str, Any] = {"t": t}
        if _color(r.get("c")):
            run["c"] = _color(r["c"])
        if r.get("o") is not None:
            try:
                o = float(r["o"])
                if o < 0.999:
                    run["o"] = round(max(0.0, o), 3)
            except (TypeError, ValueError):
                pass
        for k in ("b", "i", "u", "s"):
            if r.get(k):
                run[k] = True
        if _color(r.get("bg")):
            run["bg"] = _color(r["bg"])
        if runs and {k: v for k, v in runs[-1].items() if k != "t"} == {k: v for k, v in run.items() if k != "t"}:
            runs[-1]["t"] += t
        else:
            runs.append(run)
    return runs or [{"t": ""}]


def plain_text(runs: list[dict[str, Any]]) -> str:
    return "".join(r.get("t", "") for r in runs)


def normalize_text_element(el: dict[str, Any], defaults: dict[str, Any]) -> None:
    """読み込んだテキスト要素に、新しい項目の既定値を補う（その場で書き換える）。"""
    el["runs"] = normalize_runs(el)
    el["text"] = plain_text(el["runs"])
    el.setdefault("font", defaults["defaultFont"])
    if el.get("align") not in ALIGNS:
        el["align"] = "left"
    for key, default in (("letterSpacing", 0.0), ("lineSpacing", 1.0), ("opacity", 1.0), ("arc", 0.0)):
        try:
            el[key] = float(el.get(key, default))
        except (TypeError, ValueError):
            el[key] = default
    el["vertical"] = bool(el.get("vertical", False))
    try:  # 自動で折り返す幅（キャンバスの px）。None は折り返さない
        w = el.get("wrapWidth")
        el["wrapWidth"] = max(20.0, float(w)) if w not in (None, "", False) else None
    except (TypeError, ValueError):
        el["wrapWidth"] = None
    o = el.get("outline") if isinstance(el.get("outline"), dict) else {}
    el["outline"] = {"mode": o.get("mode") if o.get("mode") in ("none", "stroke", "hollow") else "none",
                     "width": float(o.get("width", 0.06) or 0.06), "color": _color(o.get("color"))}
    b = el.get("box") if isinstance(el.get("box"), dict) else {}
    el["box"] = {"on": bool(b.get("on", False)), "color": _color(b.get("color")) or "#FFFFFF",
                 "opacity": float(b.get("opacity", 1.0)), "padding": float(b.get("padding", 0.3)),
                 "radius": float(b.get("radius", 0.2)), "follow": bool(b.get("follow", True))}


def gui_text_kwargs(el: dict[str, Any], settings: dict[str, Any], font_size: float) -> dict[str, Any]:
    """gui_text に渡す引数（既定値と同じものは省く）。runs は別に渡す。"""
    kw: dict[str, Any] = {
        "font": el.get("font") or settings["defaultFont"],
        "font_size": int(font_size) if float(font_size).is_integer() else font_size,
        "color": (_color(el.get("color")) or _color(settings.get("defaultColor")) or "#000000"),
    }
    if float(el.get("opacity", 1.0)) < 0.999:
        kw["opacity"] = round(float(el["opacity"]), 3)
    if el.get("align", "left") != "left":
        kw["align"] = el["align"]
    if abs(float(el.get("letterSpacing", 0))) > 1e-6:
        kw["letter_spacing"] = round(float(el["letterSpacing"]), 3)
    if abs(float(el.get("lineSpacing", 1)) - 1) > 1e-6:
        kw["line_spacing"] = round(float(el["lineSpacing"]), 3)
    if el.get("vertical"):
        kw["vertical"] = True
    elif el.get("wrapWidth"):
        kw["wrap"] = round(float(el["wrapWidth"]) / 135, 4)  # キャンバスの px → Manim の単位（1 単位 = 135px）
    o = el.get("outline") or {}
    if o.get("mode") in ("stroke", "hollow"):
        kw["outline"] = {"mode": o["mode"], "width": round(float(o.get("width", 0.06)), 3), "color": o.get("color")}
    b = el.get("box") or {}
    if b.get("on"):
        kw["box"] = {"on": True, "color": b.get("color", "#FFFFFF"), "opacity": round(float(b.get("opacity", 1)), 3),
                     "padding": round(float(b.get("padding", 0.3)), 3), "radius": round(float(b.get("radius", 0.2)), 3)}
        if not b.get("follow", True):
            kw["box"]["follow"] = False
    if abs(float(el.get("arc", 0))) >= 0.5:
        kw["arc"] = round(float(el["arc"]), 1)
    return kw
