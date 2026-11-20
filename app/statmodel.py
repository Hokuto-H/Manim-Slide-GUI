"""統計のグラフ（段階S）の要素: データの表・設定の正規化と、gui_statchart（shapekit）の引数づくり。

データは表（見出し 1 行 + 行）で持ち、セルは文字のまま（空欄・数でない欄は「値なし」）。
グラフの種類ごとに、どの列を何に使うかを決める:
- scatter（散布図）・line（折れ線）: xCol が横軸の数、series の各列が縦軸の数（系列）。誤差の列・回帰直線は系列ごと。
- bar（集合縦棒）・stacked（積み上げ縦棒）: xCol が分類の名前、series の各列が棒の値。誤差の列は集合縦棒だけ。
- hist（ヒストグラム）: valueCol の数を区間ごとに数える。
- box（箱ひげ図）: boxCols の各列が 1 つの箱。
- pie（円グラフ）: xCol が名前、valueCol が値。
"""

from __future__ import annotations

import re
from typing import Any

PX = 135.0
KINDS = ("scatter", "line", "bar", "stacked", "hist", "box", "pie")
KIND_LABEL = {"scatter": "散布図", "line": "折れ線グラフ", "bar": "集合縦棒グラフ", "stacked": "積み上げ縦棒グラフ",
              "hist": "ヒストグラム", "box": "箱ひげ図", "pie": "円グラフ"}
PALETTE = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC", "#5CD0B3", "#F0AC5F", "#E65A4C", "#236B8E", "#C55F73"]
MAX_ROWS, MAX_COLS = 500, 16


def _f(v: Any, d: float, lo: float | None = None, hi: float | None = None) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        x = d
    if x != x or x in (float("inf"), float("-inf")):
        x = d
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def _color(v: Any, d: str) -> str:
    s = str(v or "").strip()
    return s.upper() if re.fullmatch(r"#[0-9A-Fa-f]{6}", s) else d


def cell_num(s: Any) -> float | None:
    """セルの数（空欄・数でないものは None）。全角の数字・カンマ区切りも読む。"""
    if s is None:
        return None
    t = str(s).strip().translate(str.maketrans("０１２３４５６７８９．－＋−", "0123456789.-+-")).replace(",", "").replace("，", "")
    if not t:
        return None
    try:
        x = float(t)
    except ValueError:
        return None
    return x if x == x and abs(x) != float("inf") else None


def _col(v: Any, ncols: int, d: int) -> int:
    k = int(_f(v, d))
    return k if 0 <= k < ncols else (d if 0 <= d < ncols else 0)


def normalize_statchart(e: dict[str, Any], settings: dict[str, Any]) -> None:
    e["chartKind"] = e.get("chartKind") if e.get("chartKind") in KINDS else "scatter"
    t = e.get("table") if isinstance(e.get("table"), dict) else {}
    headers = [str(h) for h in (t.get("headers") if isinstance(t.get("headers"), list) else [])][:MAX_COLS]
    rows = [[str(c) if c is not None else "" for c in (r if isinstance(r, list) else [])][:MAX_COLS]
            for r in (t.get("rows") if isinstance(t.get("rows"), list) else [])][:MAX_ROWS]
    if not headers:
        headers = ["x", "y"]
        rows = rows or [["1", "2"], ["2", "3"], ["3", "5"]]
    n = len(headers)
    rows = [r + [""] * (n - len(r)) for r in rows] or [[""] * n]
    e["table"] = {"headers": headers, "rows": rows}
    kind = e["chartKind"]
    e["xCol"] = _col(e.get("xCol"), n, 0)
    ser = []
    for i, s in enumerate(e.get("series") if isinstance(e.get("series"), list) else []):
        s = s if isinstance(s, dict) else {}
        c = int(_f(s.get("col"), -1))
        if not 0 <= c < n:
            continue
        err = int(_f(s.get("errCol"), -1))
        ser.append({"col": c, "color": _color(s.get("color"), PALETTE[i % len(PALETTE)]),
                    "errCol": err if 0 <= err < n else -1, "fit": bool(s.get("fit", False))})
    if not ser and n > 1:
        ser = [{"col": 1, "color": PALETTE[0], "errCol": -1, "fit": False}]
    e["series"] = ser[:MAX_COLS]
    e["valueCol"] = _col(e.get("valueCol"), n, 1 if n > 1 else 0)
    box = []
    for i, b in enumerate(e.get("boxCols") if isinstance(e.get("boxCols"), list) else []):
        b = b if isinstance(b, dict) else {}
        c = int(_f(b.get("col"), -1))
        if 0 <= c < n:
            box.append({"col": c, "color": _color(b.get("color"), PALETTE[i % len(PALETTE)])})
    e["boxCols"] = box or [{"col": i, "color": PALETTE[i % len(PALETTE)]} for i in range(n)]
    pc = e.get("pieColors") if isinstance(e.get("pieColors"), list) else []
    e["pieColors"] = [_color(pc[i] if i < len(pc) else None, PALETTE[i % len(PALETTE)]) for i in range(len(rows))]
    e["bins"] = int(_f(e.get("bins"), 0, 0, 200))
    e["binWidth"] = _f(e.get("binWidth"), 0, 0)
    e["binClosed"] = "right" if e.get("binClosed") == "right" else "left"  # 区間の端: left＝以上・未満（既定）、right＝超・以下
    e["density"] = bool(e.get("density", False))
    e["autoX"] = bool(e.get("autoX", True))
    e["autoY"] = bool(e.get("autoY", True))
    for k, d in (("xMin", 0.0), ("xMax", 10.0), ("xStep", 1.0), ("yMin", 0.0), ("yMax", 10.0), ("yStep", 1.0)):
        e[k] = _f(e.get(k), d)
    for a in ("x", "y"):
        if e[f"{a}Max"] <= e[f"{a}Min"]:
            e[f"{a}Max"] = e[f"{a}Min"] + 1
        e[f"{a}Step"] = max(abs(e[f"{a}Step"]), (e[f"{a}Max"] - e[f"{a}Min"]) / 100) or 1
    e["xLabel"] = str(e.get("xLabel") or "")
    e["yLabel"] = str(e.get("yLabel") or "")
    e["axisColor"] = _color(e.get("axisColor"), settings.get("defaultColor", "#222222"))
    e["numSize"] = _f(e.get("numSize"), 20, 4, 200)
    e["labelSize"] = _f(e.get("labelSize"), 26, 4, 200)
    e["dotSize"] = _f(e.get("dotSize"), 0.06, 0.005, 1)
    e["lineWidth"] = _f(e.get("lineWidth"), 3.0, 0, 50)
    e["barWidth"] = _f(e.get("barWidth"), 0.7, 0.05, 1)
    e["fillOpacity"] = _f(e.get("fillOpacity"), 0.8, 0, 1)
    e["legend"] = e.get("legend") if e.get("legend") in ("none", "inside", "right", "top", "bottom") else "inside"
    e["grid"] = bool(e.get("grid", False))
    e["showPercent"] = bool(e.get("showPercent", True))
    e["showNames"] = bool(e.get("showNames", True))
    e["donut"] = _f(e.get("donut"), 0.0, 0, 0.9)
    e["startAngle"] = _f(e.get("startAngle"), 90.0, -360, 360)
    e["fitLabel"] = bool(e.get("fitLabel", True))
    e["decimals"] = int(_f(e.get("decimals"), 1, 0, 6))
    e["whisker"] = _f(e.get("whisker"), 1.5, 0, 1e6)
    e["quartile"] = "linear" if e.get("quartile") == "linear" else "textbook"  # 四分位数の求め方（既定は教科書）
    e["horizontal"] = bool(e.get("horizontal", False))  # 縦棒: 横棒にする
    e["percent"] = bool(e.get("percent", False))  # 積み上げ: 分類ごとに 100% にそろえる（帯グラフ）
    e["segLabels"] = bool(e.get("segLabels", False))
    e["segOutside"] = bool(e.get("segOutside", True))  # 入りきらない値は外に書く  # 縦棒: 棒の中に値（割合）を書く
    e["width"] = _f(e.get("width"), (4 if kind == "pie" else 6) * PX, 10)
    e["height"] = _f(e.get("height"), 4 * PX, 10)
    e["rotation"] = 0.0


def _u(px: float) -> float:
    return round(px / PX, 4)


def _n(v: float) -> float | int:
    return int(v) if float(v).is_integer() else round(v, 6)


def statchart_args(e: dict[str, Any], font_scale: float = 1.0) -> tuple[str, dict[str, Any]]:
    """gui_statchart(kind, **kwargs) の kind と kwargs（データは表から数にして入れる）。"""
    kind = e["chartKind"]
    hd, rows = e["table"]["headers"], e["table"]["rows"]
    kw: dict[str, Any] = {}
    xc = e["xCol"]
    if kind in ("scatter", "line"):
        keep = [r for r in rows if cell_num(r[xc]) is not None]
        kw["x"] = [_n(cell_num(r[xc])) for r in keep]
        kw["series"] = [_series(s, hd, keep, err=True) for s in e["series"]]
    elif kind in ("bar", "stacked"):
        kw["categories"] = [r[xc] for r in rows]
        kw["series"] = [_series(s, hd, rows, err=kind == "bar") for s in e["series"]]
        if e["horizontal"]:
            kw["horizontal"] = True
        if e["percent"] and kind == "stacked":
            kw["percent"] = True
        if e["segLabels"]:
            kw["seg_labels"] = True
            if not e["segOutside"]:
                kw["seg_outside"] = False
    elif kind == "hist":
        kw["values"] = [_n(v) for v in (cell_num(r[e["valueCol"]]) for r in rows) if v is not None]
        if e["binClosed"] == "right":
            kw["bin_closed"] = "right"
        if e["binWidth"] > 0:
            kw["bin_width"] = _n(e["binWidth"])
        elif e["bins"] > 0:
            kw["bins"] = e["bins"]
        if e["density"]:
            kw["density"] = True
        kw["colors"] = [e["series"][0]["color"] if e["series"] else PALETTE[0]]
    elif kind == "box":
        kw["groups"] = [{"name": hd[b["col"]], "values": [_n(v) for v in (cell_num(r[b["col"]]) for r in rows) if v is not None],
                         "color": b["color"]} for b in e["boxCols"]]
        if e["whisker"] != 1.5:
            kw["whisker"] = _n(e["whisker"])
        if e["quartile"] == "linear":
            kw["quartile"] = "linear"
    elif kind == "pie":
        vc = e["valueCol"]
        kw["values"] = [_n(cell_num(r[vc]) or 0.0) for r in rows]
        kw["labels"] = [r[xc] for r in rows]
        kw["colors"] = e["pieColors"][:len(rows)]
        kw.update(show_percent=e["showPercent"], show_names=e["showNames"])
        if e["donut"] > 0:
            kw["donut"] = _n(e["donut"])
        if e["startAngle"] != 90:
            kw["start_angle"] = _n(e["startAngle"])
    kw.update(width=_u(e["width"]), height=_u(e["height"]))
    if kind != "pie":
        if not e["autoX"] and kind in ("scatter", "line", "hist"):
            kw["x_range"] = [_n(e["xMin"]), _n(e["xMax"]), _n(e["xStep"])]
        if not e["autoY"]:
            kw["y_range"] = [_n(e["yMin"]), _n(e["yMax"]), _n(e["yStep"])]
        if e["xLabel"].strip():
            kw["x_label"] = e["xLabel"]
        if e["yLabel"].strip():
            kw["y_label"] = e["yLabel"]
        if e["grid"]:
            kw["grid"] = True
    kw.update(axis_color=e["axisColor"], num_size=round(e["numSize"] * font_scale, 2), label_size=round(e["labelSize"] * font_scale, 2))
    if kind in ("scatter", "line", "box"):
        kw["dot_radius"] = _n(e["dotSize"])
    if kind in ("line", "scatter", "box"):
        kw["line_width"] = _n(e["lineWidth"])
    if kind in ("bar", "stacked", "box"):
        kw["bar_width"] = _n(e["barWidth"])
    if kind in ("bar", "stacked", "hist", "box", "pie"):
        kw["fill_opacity"] = _n(e["fillOpacity"])
    if e["legend"] != "inside":
        kw["legend"] = e["legend"]
    if kind == "scatter" or kind == "line":
        if not e["fitLabel"]:
            kw["fit_label"] = False
    if e["decimals"] != 2 and kind in ("scatter", "line", "pie", "bar", "stacked"):
        kw["decimals"] = e["decimals"]
    return kind, kw


def _series(s: dict[str, Any], hd: list[str], rows: list[list[str]], err: bool) -> dict[str, Any]:
    out: dict[str, Any] = {"name": hd[s["col"]], "y": [None if (v := cell_num(r[s["col"]])) is None else _n(v) for r in rows],
                           "color": s["color"]}
    if err and s["errCol"] >= 0:
        out["err"] = [_n(cell_num(r[s["errCol"]]) or 0.0) for r in rows]
    if s["fit"]:
        out["fit"] = True
    return out


def summary(e: dict[str, Any]) -> str:
    if e.get("chartKind") == "stacked" and e.get("percent") and e.get("horizontal"):
        return f"帯グラフ（{len(e.get('table', {}).get('rows', []))} 行）"
    return f"{KIND_LABEL.get(e.get('chartKind'), '統計のグラフ')}（{len(e.get('table', {}).get('rows', []))} 行）"
