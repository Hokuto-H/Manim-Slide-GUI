"""図形要素（type: "shape"）のデータ形式と、gui_shape / gui_balloon の引数への変換。

GUI（キャンバスの px、y は下向き）と Manim（単位、y は上向き）の換算は 1080p で 1 単位 = 135px。
プレビュー（/api/preview/shape）と書き出しは、どちらもここで引数を作るので、同じ形になる。
"""

from __future__ import annotations

import re
from typing import Any

from .constants import CANVAS_H, MANIM_FRAME_H

PX = CANVAS_H / MANIM_FRAME_H  # 135: Manim の 1 単位のキャンバスでの px

SHAPES = ("line", "rect", "ellipse", "polygon", "star", "arc", "dot", "balloon", "path", "axes", "graph", "brace", "table",
          "field", "number", "axdot", "solid", "axes3d", "surface", "curve3d", "point3d", "svg", "matrix", "angle",
          "graphpart", "curve2d", "implicit", "annulus", "elbow", "code", "barchart", "tex", "title", "bullets", "boolean",
          "samplespace", "netgraph", "annot", "vector", "linegraph", "trace", "zoom", "fcurve", "tangent", "statchart", "part", "theorem", "points")
# 3D の要素（3D を使うプロジェクトだけ）。位置は pos3（Manim の x, y, z）で持ち、キャンバスの x・y は、スライドのカメラから見た位置
SHAPES_3D = ("solid", "axes3d", "surface", "curve3d", "point3d")
# ほかの要素に付いて位置が決まる図形（自分では動かさない）
DEPENDENT = ("graph",)
# サイズが幅・高さの図形（外接矩形）と、半径の図形
BOX_SHAPES = ("rect", "ellipse", "polygon", "star")
TIP_SHAPES = ("triangle", "triangle_outline", "stealth", "circle", "circle_outline", "square", "square_outline")
ANNOT_KINDS = ("box", "bg", "underline", "cross", "arcbrace", "animated")
POINT_SOURCES = ("code", "ode", "integral", "montecarlo", "trials")
# 立体の種類（基本の立体と多面体）
POLYHEDRA = ("tetrahedron", "octahedron", "dodecahedron", "icosahedron", "polyhedron", "hull")
SOLID_KINDS = ("sphere", "cube", "prism", "cone", "cylinder", "torus", *POLYHEDRA)
DEFAULT_PYRAMID = (((1, 1, -0.75), (-1, 1, -0.75), (-1, -1, -0.75), (1, -1, -0.75), (0, 0, 1.25)),
                   ((0, 1, 2, 3), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)))
DEFAULT_HULL_POINTS = ((1.2, 0, -0.6), (-0.6, 1.04, -0.6), (-0.6, -1.04, -0.6), (0, 0, 1.4), (0.8, 0.8, 0.5), (-0.9, 0.2, 0.7), (0.1, -1, 0.6))
# 図形の合成（boolean）に使える図形（閉じた形を作る gui_shape の図形と、合成した図形）
BOOLEAN_OPERANDS = ("rect", "ellipse", "polygon", "star", "arc", "dot", "path", "annulus", "boolean")
BOOLEAN_OPS = ("union", "intersection", "difference", "exclusion")
CODE_STYLES = ("vim", "monokai", "dracula", "one-dark", "github-dark", "solarized-dark", "native", "default", "friendly",
               "solarized-light", "vs", "xcode", "emacs", "tango", "gruvbox-light", "bw")
CODE_LANGUAGES = ("python", "c", "cpp", "java", "javascript", "typescript", "rust", "go", "julia", "matlab", "r", "bash",
                  "html", "css", "sql", "latex", "text")


def _f(v: Any, default: float, lo: float | None = None, hi: float | None = None) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        x = default
    if x != x:  # NaN
        x = default
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def _color(v: Any, default: str | None) -> str | None:
    if v is None:
        return default
    s = str(v).strip()
    return s.upper() if re.fullmatch(r"#[0-9A-Fa-f]{6}", s) else default


def normalize_shape_element(e: dict[str, Any], settings: dict[str, Any]) -> None:
    kind = e.get("shape") if e.get("shape") in SHAPES else "rect"
    e["shape"] = kind
    st = e.get("stroke") if isinstance(e.get("stroke"), dict) else {}
    fi = e.get("fill") if isinstance(e.get("fill"), dict) else {}
    default_fill_opacity = 1.0 if kind in ("dot", "balloon") else 0.0
    e["stroke"] = {
        "color": _color(st.get("color"), settings.get("defaultColor", "#222222")),
        "width": _f(st.get("width"), 3.0 if kind == "balloon" else 4.0, 0, 200),
        "opacity": _f(st.get("opacity"), 1.0, 0, 1),
    }
    e["fill"] = {
        "color": _color(fi.get("color"), settings.get("background", "#FFFFFF") if kind == "balloon" else None),
        "opacity": _f(fi.get("opacity"), default_fill_opacity, 0, 1),
    }
    e["dashed"] = bool(e.get("dashed", False))
    e["dashLength"] = _f(e.get("dashLength"), 0.15, 0.01, 5)
    # 線に沿った色の変化（CurvesAsSubmobjects。2 色以上）。線・曲線・円弧・グラフ・媒介変数曲線・導関数のグラフ
    gr = e.get("gradient")
    gr = [c for c in (_color(x, None) for x in gr) if c] if isinstance(gr, list) else []
    e["gradient"] = gr if len(gr) >= 2 else None
    if kind == "line":
        e["dx"] = _f(e.get("dx"), 150.0)
        e["dy"] = _f(e.get("dy"), 0.0)
        e["startTip"] = bool(e.get("startTip", False))
        e["endTip"] = bool(e.get("endTip", False))
        e["tipSize"] = _f(e.get("tipSize"), 0.25, 0.02, 5)
        e["arcAngle"] = _f(e.get("arcAngle"), 0.0, -359, 359)  # 0 でなければ両端を結ぶ弧（度。正で始点→終点の向きの右に膨らむ。ArcBetweenPoints と同じ）
        e["tipShape"] = e.get("tipShape") if e.get("tipShape") in TIP_SHAPES else "triangle"
        e["tipScale"] = bool(e.get("tipScale", False))  # 短い線では矢じりも小さく（Arrow と同じ）
        _normalize_label(e, settings)
        e["labelPos"] = _f(e.get("labelPos"), 0.5, 0, 1)
        e["labelBg"] = _color(e.get("labelBg"), None)  # ラベルの背景の色（None で背景なし）
        e["labelFrame"] = bool(e.get("labelFrame", False))
        e["rotation"] = 0.0  # 線は両端の位置で向きを持つ
    elif kind in BOX_SHAPES:
        e["width"] = _f(e.get("width"), 300.0, 1)
        e["height"] = _f(e.get("height"), 200.0, 1)
        e["keepAspect"] = bool(e.get("keepAspect", kind in ("polygon", "star")))
        e["cornerRadius"] = _f(e.get("cornerRadius"), 0.0, 0, 50)
        e["sides"] = int(_f(e.get("sides"), 5 if kind == "star" else 6, 3, 64))
        e["innerRatio"] = _f(e.get("innerRatio"), 0.45, 0.05, 0.95)
        e["edgeArc"] = _f(e.get("edgeArc"), 0.0, -180, 180)  # 正多角形の辺を弧にする角度（度）
        _normalize_label(e, settings)  # 形の内側のいちばん広い所に置くラベル（LabeledPolygram の置き方）
        e["labelBg"] = _color(e.get("labelBg"), None)
        e["labelFrame"] = bool(e.get("labelFrame", False))
        e["polygram"] = bool(e.get("polygram", False))  # 星を、頂点を結ぶ線（交差する）で描く
        e["density"] = int(_f(e.get("density"), 2, 1, max(1, (e["sides"] - 1) // 2)))
    elif kind == "annulus":
        e["radius"] = _f(e.get("radius"), 150.0, 1)  # 外側の半径（キャンバスの px）
        e["innerRadius"] = _f(e.get("innerRadius"), e["radius"] * 0.5, 0, e["radius"] * 0.99)
        e["startAngle"] = _f(e.get("startAngle"), 0.0)
        e["angle"] = _f(e.get("angle"), 90.0, -360, 360)
        e["sector"] = bool(e.get("sector", False))
    elif kind == "elbow":
        e["radius"] = _f(e.get("radius"), 0.5 * PX, 1)  # 一辺の長さ（キャンバスの px）
    elif kind == "code":
        e["code"] = str(e.get("code") if e.get("code") is not None else 'def f(x):\n    return x ** 2\n\nprint(f(3))')
        e["language"] = str(e.get("language") or "python").strip().lower()[:40] or "python"
        e["style"] = e.get("style") if e.get("style") in CODE_STYLES else "one-dark"
        e["fontSize"] = _f(e.get("fontSize"), 24, 2, 400)
        e["font"] = str(e.get("font") or "")
        e["lineNumbers"] = bool(e.get("lineNumbers", True))
        e["lineFrom"] = int(_f(e.get("lineFrom"), 1, -100000, 100000))
        e["background"] = "window" if e.get("background") == "window" else "rectangle"
        e["bgColor"] = _color(e.get("bgColor"), None)
        e["textColor"] = _color(e.get("textColor"), None)
        e["tabWidth"] = int(_f(e.get("tabWidth"), 4, 1, 16))
    elif kind == "statchart":
        from .statmodel import normalize_statchart  # noqa: PLC0415
        normalize_statchart(e, settings)
    elif kind == "barchart":
        bars = []
        for b in (e.get("bars") if isinstance(e.get("bars"), list) else [])[:60]:
            b = b if isinstance(b, dict) else {}
            bars.append({"name": str(b.get("name") or ""), "value": _f(b.get("value"), 0.0), "color": _color(b.get("color"), "#58C4DD")})
        if not bars:
            bars = [{"name": n, "value": v, "color": c} for n, v, c in
                    (("A", 3, "#58C4DD"), ("B", 5, "#83C167"), ("C", 2, "#FFC300"), ("D", 4, "#FC6255"))]
        e["bars"] = bars
        vals = [b["value"] for b in bars]
        e["autoRange"] = bool(e.get("autoRange", True))
        if e["autoRange"]:  # 値から、きりのよい範囲と目盛り（1・2・5 × 10^k、5 目盛りほど）を決める
            e["yMin"], e["yMax"], e["yStep"] = nice_range(min(0.0, min(vals)), max(0.0, max(vals)))
        e["yMin"] = _f(e.get("yMin"), 0.0)
        e["yMax"] = _f(e.get("yMax"), 5.0)
        if e["yMax"] <= e["yMin"]:
            e["yMax"] = e["yMin"] + 1
        e["yStep"] = _f(e.get("yStep"), 1.0)
        e["yStep"] = max(abs(e["yStep"]), (e["yMax"] - e["yMin"]) / 100) or 1
        e["width"] = _f(e.get("width"), 6 * PX, 10)
        e["height"] = _f(e.get("height"), 4 * PX, 10)
        e["barWidth"] = _f(e.get("barWidth"), 0.6, 0.05, 1)
        e["axisColor"] = _color(e.get("axisColor"), settings.get("defaultColor", "#222222"))
        e["numSize"] = _f(e.get("numSize"), 24, 4, 200)
        e["labelSize"] = _f(e.get("labelSize"), 30, 4, 200)
        e["showValues"] = bool(e.get("showValues", False))
        e["decimals"] = int(_f(e.get("decimals"), 0, 0, 6))
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.7, 0, 1)
        e["stroke"]["width"] = _f(st.get("width"), 3.0, 0, 50)
        e["rotation"] = 0.0
    elif kind in ("tex", "title", "bullets"):
        if kind == "bullets":
            items = e.get("items") if isinstance(e.get("items"), list) else None
            e["items"] = [str(x) for x in (items or ["1 つ目の項目", "2 つ目の項目", "3 つ目の項目"])][:40] or [""]
            e["buff"] = _f(e.get("buff"), 0.5, 0, 10)
            e["dotScale"] = _f(e.get("dotScale"), 2.0, 0.1, 10)
        else:
            e["latex"] = str(e.get("latex") if e.get("latex") is not None else ("題名" if kind == "title" else "LaTeX の文章（$x^2$ のように数式も書けます）"))
        if kind == "title":
            e["underline"] = bool(e.get("underline", True))
            e["matchWidth"] = bool(e.get("matchWidth", False))
            e["align"] = e.get("align") if e.get("align") in ("left", "center", "right") else "center"
            # マスターの題名の型の、左・右寄せの端（キャンバスの px）。キャンバスが文字の幅から求める
            try:
                e["edge"] = None if e.get("edge") is None else float(e["edge"])
            except (TypeError, ValueError):
                e["edge"] = None
        e["fontSize"] = _f(e.get("fontSize"), 48 if kind != "bullets" else 36, 2, 400)
        e["color"] = _color(e.get("color"), settings.get("defaultColor", "#222222"))
    elif kind == "theorem":
        from .refs import KINDS  # noqa: PLC0415
        e["kind"] = e.get("kind") if e.get("kind") in KINDS else "theorem"
        e["title"] = str(e.get("title") or "")
        e["body"] = str(e.get("body") if e.get("body") is not None else
                        "ここに内容を書きます。数式は $f(x)=x^2$ のように $ で囲みます。\n1 行が 1 段落です。「仮定:」「結論:」で始めた行は色で強調します。")
        e["width"] = _f(e.get("width"), 900.0, 100, 4000)
        e["numbered"] = bool(e.get("numbered", e["kind"] not in ("proof",)))
        e["proofOf"] = str(e.get("proofOf") or "").strip()
        e["qed"] = bool(e.get("qed", e["kind"] == "proof"))
        e["boxed"] = None if e.get("boxed") is None else bool(e["boxed"])  # None: 種類の既定（証明は枠なし）
        e["fontSize"] = _f(e.get("fontSize"), 32, 2, 400)
        e["color"] = _color(e.get("color"), settings.get("defaultColor", "#222222"))
        e["rotation"] = 0.0
    elif kind == "samplespace":
        e["width"] = _f(e.get("width"), 4 * PX, 10)
        e["height"] = _f(e.get("height"), 3 * PX, 10)
        e["split"] = "rows" if e.get("split") == "rows" else "columns"

        def cells(lst, defaults):
            out = []
            for k, q in enumerate((lst if isinstance(lst, list) else [])[:12]):
                q = q if isinstance(q, dict) else {}
                out.append({"p": _f(q.get("p"), 0.5, 0, 1e9), "color": _color(q.get("color"), defaults[k % len(defaults)]),
                            "label": str(q.get("label") or "")})
            return out
        pal = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC"]
        parts = cells(e.get("parts"), pal)
        raw = e.get("parts") if isinstance(e.get("parts"), list) else []
        for k, q in enumerate(parts):
            src = raw[k] if k < len(raw) and isinstance(raw[k], dict) else {}
            q["sub"] = cells(src.get("sub"), ["#83C167", "#FFC300", "#9A72AC"])
        if not parts:
            parts = [{"p": 0.4, "color": "#58C4DD", "label": "P(A)",
                      "sub": [{"p": 0.7, "color": "#236B8E", "label": "P(B|A)"}, {"p": 0.3, "color": "#9CDCEB", "label": ""}]},
                     {"p": 0.6, "color": "#FC6255", "label": "P(\\bar{A})",
                      "sub": [{"p": 0.2, "color": "#CF5044", "label": "P(B|\\bar{A})"}, {"p": 0.8, "color": "#FF8080", "label": ""}]}]
        e["parts"] = parts
        e["title"] = str(e.get("title") or "")
        e["labelSize"] = _f(e.get("labelSize"), 30, 4, 200)
        e["labelColor"] = _color(e.get("labelColor"), settings.get("defaultColor", "#222222"))
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.8, 0, 1)
        e["stroke"]["width"] = _f(st.get("width"), 2.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "annot":
        e["annotKind"] = e.get("annotKind") if e.get("annotKind") in ANNOT_KINDS else "box"
        e["targetId"] = str(e.get("targetId") or "")
        ak = e["annotKind"]
        e["buff"] = _f(e.get("buff"), 0.0 if ak == "bg" else 0.1, 0, 10)
        e["cornerRadius"] = _f(e.get("cornerRadius"), 0.0, 0, 10)
        e["scaleFactor"] = _f(e.get("scaleFactor"), 1.0, 0.05, 10)
        e["outside"] = bool(e.get("outside", True))
        cs = [c for c in (_color(x, None) for x in (e.get("colors") or [])) if c] if isinstance(e.get("colors"), list) else []
        e["colors"] = cs if len(cs) >= 2 else ["#29ABCA", "#9CDCEB", "#236B8E", "#736357"]  # 色が流れる枠の色
        e["cycleRate"] = _f(e.get("cycleRate"), 0.5, 0.01, 10)
        _normalize_label(e, settings)
        e["width"] = _f(e.get("width"), 300.0, 1)  # 付ける要素の外接矩形（キャンバスの px。要素が無いときに使う）
        e["height"] = _f(e.get("height"), 100.0, 1)
        default = {"box": "#FFC300", "cross": "#FC6255", "bg": None}.get(ak, settings.get("defaultColor", "#222222"))
        if st.get("color") is None and default:
            e["stroke"]["color"] = default
        e["stroke"]["width"] = _f(st.get("width"), 6.0 if ak == "cross" else 4.0, 0, 50)
        if ak == "bg":
            e["fill"]["color"] = _color(fi.get("color"), settings.get("background", "#FFFFFF"))
            e["fill"]["opacity"] = _f(fi.get("opacity"), 0.75, 0, 1)
        e["rotation"] = 0.0
    elif kind == "vector":
        e["axesId"] = str(e.get("axesId") or "")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        for k, d in (("xExpr", "2"), ("yExpr", "1"), ("x0Expr", "0"), ("y0Expr", "0")):
            e[k] = str(e.get(k) if e.get(k) is not None and str(e.get(k)).strip() != "" else d)
        e["coords"] = bool(e.get("coords", False))
        e["coordSize"] = _f(e.get("coordSize"), 30, 4, 200)
        e["tipSize"] = _f(e.get("tipSize"), 0.25, 0.02, 5)
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
        e["stroke"]["width"] = _f(st.get("width"), 6.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "netgraph":
        normalize_netgraph(e, st, fi, settings)
    elif kind == "points":
        # 計算した点列（座標軸の上）。source ごとの値は params に持つ
        e["axesId"] = str(e.get("axesId") or "")
        e["source"] = e.get("source") if e.get("source") in POINT_SOURCES else "code"
        e["code"] = str(e.get("code") if e.get("code") is not None else "pts = [(x, x ** 2 / 4) for x in np.linspace(0, 4, 9)]")
        pr = e.get("params") if isinstance(e.get("params"), dict) else {}
        e["params"] = {
            "f": str(pr.get("f") if pr.get("f") is not None else ("-y + \\sin x" if e["source"] == "ode" else "x^2")),
            "lang": "python" if pr.get("lang") == "python" else "latex",
            "x0": _f(pr.get("x0"), 0.0), "y0": _f(pr.get("y0"), 1.0), "x1": _f(pr.get("x1"), 6.0), "h": _f(pr.get("h"), 0.5, 1e-4, 100),
            "method": pr.get("method") if pr.get("method") in ("euler", "heun", "rk4", "exact") else "euler",
            "a": _f(pr.get("a"), 0.0), "b": _f(pr.get("b"), 2.0), "n": int(_f(pr.get("n"), 8 if e["source"] == "integral" else 500, 1, 20000)),
            "rule": pr.get("rule") if pr.get("rule") in ("left", "right", "mid", "trapezoid") else "left",
            "seed": int(_f(pr.get("seed"), 1, 0, 2 ** 31)), "kind": "coin" if pr.get("kind") == "coin" else "dice",
        }
        e["style"] = e.get("style") if e.get("style") in ("line", "scatter", "bars") else "line"
        e["color2"] = _color(e.get("color2"), "#D9534F")
        e["dotRadius"] = _f(e.get("dotRadius"), 0.05, 0.005, 2)
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.35, 0, 1)
        if st.get("color") is None:
            e["stroke"]["color"] = "#2E6FD8"
        e["rotation"] = 0.0
    elif kind == "linegraph":
        e["axesId"] = str(e.get("axesId") or "")
        pts = []
        for q in (e.get("points") if isinstance(e.get("points"), list) else [])[:500]:
            if isinstance(q, (list, tuple)) and len(q) >= 2:
                pts.append([round(_f(q[0], 0.0), 6), round(_f(q[1], 0.0), 6)])
        e["points"] = pts or [[0, 1], [1, 3], [2, 2], [3, 4]]
        e["dots"] = bool(e.get("dots", True))
        e["dotRadius"] = _f(e.get("dotRadius"), 0.08, 0.005, 2)
        e["dotColor"] = _color(e.get("dotColor"), None)
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
        e["rotation"] = 0.0
    elif kind == "trace":
        e["targetId"] = str(e.get("targetId") or "")
        e["dissipating"] = _f(e.get("dissipating"), 0.0, 0, 100)  # 秒（0 で消えない）
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
        e["stroke"]["width"] = _f(st.get("width"), 3.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "zoom":
        # 映す所（x・y・width・height。キャンバスの px）と、拡大する所の中心（frameX・frameY）と、拡大する所の大きさの比
        e["width"] = _f(e.get("width"), 3 * PX, 20, 4000)
        e["height"] = _f(e.get("height"), 3 * PX, 20, 4000)
        e["frameX"] = _f(e.get("frameX"), CANVAS_H * 16 / 18, -10000, 10000)
        e["frameY"] = _f(e.get("frameY"), CANVAS_H / 2, -10000, 10000)
        e["factor"] = _f(e.get("factor"), 0.3, 0.01, 10)
        if st.get("color") is None:
            e["stroke"]["color"] = "#FFC300"
        e["displayColor"] = _color(e.get("displayColor"), None)
        e["stroke"]["width"] = _f(st.get("width"), 3.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "boolean":
        e["op"] = e.get("op") if e.get("op") in BOOLEAN_OPS else "union"
        e["operandIds"] = [str(x) for x in (e.get("operandIds") or []) if x][:12]
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.5, 0, 1)
        e["rotation"] = 0.0
    elif kind in ("arc", "dot"):
        e["radius"] = _f(e.get("radius"), 12.0 if kind == "dot" else 150.0, 1)
        if kind == "dot":
            e["ring"] = bool(e.get("ring", False))  # 輪の付いた点（AnnotationDot）
            _normalize_label(e, settings)
            # 点の外側の名前（数式）。位置: auto（円の外・線から離れる向き）・8 方向・free（pnameShift: 点の中心からのずれ、Manim の単位、上が正）
            e["pname"] = str(e.get("pname") or "")
            e["pnamePos"] = e.get("pnamePos") if e.get("pnamePos") in PNAME_POS else "auto"
            sh = e.get("pnameShift")
            e["pnameShift"] = [_f(sh[0], 0.3), _f(sh[1], 0.3)] if isinstance(sh, (list, tuple)) and len(sh) >= 2 else None
            e["pnameSize"] = _f(e.get("pnameSize"), 36, 2, 400)
            e["pnameColor"] = _color(e.get("pnameColor"), None)
        e["startAngle"] = _f(e.get("startAngle"), 0.0)
        e["angle"] = _f(e.get("angle"), 90.0, -360, 360)
        e["sector"] = bool(e.get("sector", False))
    elif kind == "path":
        # 手書き・ベジェ曲線。paths: 線（ひと筆）ごとの点 [x, y, 入る取っ手 dx, dy, 出る取っ手 dx, dy]（キャンバスの px、
        # 要素の位置からの相対。回す前の向き）。raw: 手書きの元の点（なめらかさを変えて描き直すため）
        out = []
        for sp in (e.get("paths") or []):
            nodes = []
            for n in sp if isinstance(sp, list) else []:
                if isinstance(n, (list, tuple)) and len(n) >= 2:
                    v = [_f(x, 0.0) for x in list(n)[:6]] + [0.0] * (6 - min(len(n), 6))
                    nodes.append([round(x, 2) for x in v])
            if len(nodes) >= 2:
                out.append(nodes)
        e["paths"] = out
        e["closed"] = bool(e.get("closed", False))
        e["source"] = "freehand" if e.get("source") == "freehand" else "bezier"
        _normalize_label(e, settings)  # 閉じた曲線のラベル
        e["labelBg"] = _color(e.get("labelBg"), None)
        e["labelFrame"] = bool(e.get("labelFrame", False))
        e["smooth"] = _f(e.get("smooth"), 4.0, 0.5, 40)
    elif kind == "axes":
        e["axesKind"] = e.get("axesKind") if e.get("axesKind") in ("numberline", "axes", "plane", "polar", "complex") else "axes"
        e["azimuthStep"] = _f(e.get("azimuthStep"), 30, 1, 180)  # 極座標: 角度の目盛りの間隔（度）
        e["azimuthUnits"] = "pi" if e.get("azimuthUnits") == "pi" else "degrees"
        # 線形変換の平面（座標平面だけ）: 変換の前の薄い方眼・基底ベクトル・一緒に変換する要素（座標平面に付いた要素のほかに）
        e["linear"] = bool(e.get("linear", False)) and e["axesKind"] == "plane"
        # 対数目盛り（座標軸だけ。範囲・間隔は 10 の指数）
        e["xLog"] = bool(e.get("xLog", False)) and e["axesKind"] == "axes"
        e["yLog"] = bool(e.get("yLog", False)) and e["axesKind"] == "axes"
        e["ghost"] = bool(e.get("ghost", True))
        e["basis"] = bool(e.get("basis", True))
        e["linearClip"] = bool(e.get("linearClip", False))  # 変換したあと、平面の四角形の外は描かない
        e["followIds"] = [str(x) for x in (e.get("followIds") or []) if x][:200]
        for k, d in (("xMin", -1), ("xMax", 5), ("xStep", 1), ("yMin", -1), ("yMax", 3), ("yStep", 1)):
            e[k] = _f(e.get(k), d)
        if e["xMax"] <= e["xMin"]:
            e["xMax"] = e["xMin"] + 1
        if e["yMax"] <= e["yMin"]:
            e["yMax"] = e["yMin"] + 1
        e["xStep"] = max(abs(e["xStep"]), (e["xMax"] - e["xMin"]) / 200) or 1
        e["yStep"] = max(abs(e["yStep"]), (e["yMax"] - e["yMin"]) / 200) or 1
        e["width"] = _f(e.get("width"), 6 * PX, 10)  # 軸の長さ（キャンバスの px）
        e["height"] = _f(e.get("height"), 4 * PX, 10)
        e["tips"] = bool(e.get("tips", True))
        e["numbers"] = bool(e.get("numbers", True))
        e["numSize"] = _f(e.get("numSize"), 24, 4, 200)
        e["xLabel"] = str(e.get("xLabel") if e.get("xLabel") is not None else "x")
        e["yLabel"] = str(e.get("yLabel") if e.get("yLabel") is not None else "y")
        for k in ("xLabelShift", "yLabelShift"):  # 軸ラベルの、既定の位置からのずれ（Manim の単位、上が正）
            v = e.get(k)
            e[k] = [round(_f(v[0], 0.0), 3), round(_f(v[1], 0.0), 3)] if isinstance(v, (list, tuple)) and len(v) >= 2 else [0.0, 0.0]
        e["gridColor"] = _color(e.get("gridColor"), "#58C4DD")
        e["gridOpacity"] = _f(e.get("gridOpacity"), 0.6, 0, 1)
        e["stroke"]["width"] = _f(st.get("width"), 2.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "graph":
        e["axesId"] = str(e.get("axesId") or "")
        e["expr"] = str(e.get("expr") if e.get("expr") is not None else "x^2")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        for k in ("xFrom", "xTo"):
            v = e.get(k)
            e[k] = None if v in (None, "") else _f(v, 0.0)
        e["complexCurve"] = bool(e.get("complexCurve", False))  # 複素平面で z = f(t)（複素数の曲線）として描く
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
        e["rotation"] = 0.0
    elif kind == "brace":
        e["mode"] = "points" if e.get("mode") == "points" else "target"
        e["targetId"] = str(e.get("targetId") or "")
        e["direction"] = e.get("direction") if e.get("direction") in ("down", "up", "left", "right") else "down"
        e["dx"] = _f(e.get("dx"), 150.0)
        e["dy"] = _f(e.get("dy"), 0.0)
        e["flip"] = bool(e.get("flip", False))
        e["buff"] = _f(e.get("buff"), 0.2, 0, 10)
        e["sharpness"] = _f(e.get("sharpness"), 2.0, 0.2, 10)
        e["label"] = str(e.get("label") or "")
        e["labelKind"] = "text" if e.get("labelKind") == "text" else "math"
        e["labelSize"] = _f(e.get("labelSize"), 36, 2, 400)
        e["labelColor"] = _color(e.get("labelColor"), None)
        e["labelFont"] = str(e.get("labelFont") or settings.get("defaultFont") or "")
        e["width"] = _f(e.get("width"), 300.0, 1)  # 付ける要素の外接矩形（キャンバスの px。要素が無いときに使う）
        e["height"] = _f(e.get("height"), 100.0, 1)
        e["rotation"] = 0.0
    elif kind == "table":
        rows = e.get("cells") if isinstance(e.get("cells"), list) else None
        rows = [[str(c if c is not None else "") for c in (r if isinstance(r, list) else [r])][:40] for r in (rows or [])][:60]
        if not rows or not any(rows):
            rows = [["x", "0", "1", "2"], ["y", "0", "1", "4"]]
        n = max(len(r) for r in rows) or 1
        e["cells"] = [r + [""] * (n - len(r)) for r in rows]
        e["items"] = normalize_items(e.get("items"), e["cells"])
        e["cellMode"] = "math" if e.get("cellMode") == "math" else "text"
        e["headerRow"] = bool(e.get("headerRow", False))
        e["headerCol"] = bool(e.get("headerCol", False))
        e["fontSize"] = _f(e.get("fontSize"), 36, 2, 400)
        e["font"] = str(e.get("font") or settings.get("defaultFont") or "")
        e["color"] = _color(e.get("color"), settings.get("defaultColor", "#222222"))
        e["hBuff"] = _f(e.get("hBuff"), 0.6, 0, 20)
        e["vBuff"] = _f(e.get("vBuff"), 0.35, 0, 20)
        e["outerLines"] = bool(e.get("outerLines", True))
        e["stroke"]["width"] = _f(st.get("width"), 2.0, 0, 50)
    elif kind == "field":
        e["fieldKind"] = "stream" if e.get("fieldKind") == "stream" else "arrows"
        e["axesId"] = str(e.get("axesId") or "")
        e["fx"] = str(e.get("fx") if e.get("fx") is not None else "-y")
        e["fy"] = str(e.get("fy") if e.get("fy") is not None else "x")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        for k, d in (("xMin", -3), ("xMax", 3), ("yMin", -2), ("yMax", 2)):
            e[k] = _f(e.get(k), d)
        if e["xMax"] <= e["xMin"]:
            e["xMax"] = e["xMin"] + 1
        if e["yMax"] <= e["yMin"]:
            e["yMax"] = e["yMin"] + 1
        e["width"] = _f(e.get("width"), 6 * PX, 10)  # 範囲の大きさ（キャンバスの px。座標軸に重ねるときは座標軸と同じ）
        e["height"] = _f(e.get("height"), 4 * PX, 10)
        span = max(e["xMax"] - e["xMin"], e["yMax"] - e["yMin"])
        e["step"] = _f(e.get("step"), 0.5, span / 60, span)  # 矢印・流線の始点の間隔（座標の値）
        e["lengthMode"] = e.get("lengthMode") if e.get("lengthMode") in ("limit", "same", "linear") else "limit"
        e["lengthScale"] = _f(e.get("lengthScale"), 1.0, 0.01, 100)
        e["colorMode"] = "magnitude" if e.get("colorMode") == "magnitude" else "single"
        e["colorMax"] = _f(e.get("colorMax"), 2.0, 1e-6, 1e9)
        e["virtualTime"] = _f(e.get("virtualTime"), 3.0, 0.1, 50)
        e["stroke"]["width"] = _f(st.get("width"), 1.5 if e["fieldKind"] == "stream" else 2.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "number":
        e["valueName"] = str(e.get("valueName") or "")  # スライドの値の名前（空なら number の固定の数）
        e["number"] = _f(e.get("number"), 0.0)
        e["decimals"] = int(_f(e.get("decimals"), 2, 0, 10))
        e["fontSize"] = _f(e.get("fontSize"), 48, 2, 400)
        e["color"] = _color(e.get("color"), settings.get("defaultColor", "#222222"))
        e["unit"] = str(e.get("unit") or "")
        e["nameLabel"] = str(e.get("nameLabel") or "")  # 「x = 1.23」の x（Manim の Variable と同じ形）
        e["includeSign"] = bool(e.get("includeSign", False))
    elif kind == "axdot":
        e["axesId"] = str(e.get("axesId") or "")
        e["xExpr"] = str(e.get("xExpr") if e.get("xExpr") is not None else "1")
        e["yExpr"] = str(e.get("yExpr") if e.get("yExpr") is not None else "1")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        e["radius"] = _f(e.get("radius"), 0.08 * PX, 1, 500)
        e["lines"] = bool(e.get("lines", False))
        if fi.get("color") is None:
            e["fill"]["color"] = "#FC6255"
        e["rotation"] = 0.0
    elif kind == "matrix":
        rows = e.get("cells") if isinstance(e.get("cells"), list) else None
        rows = [[str(c if c is not None else "") for c in (r if isinstance(r, list) else [r])][:30] for r in (rows or [])][:30]
        if not rows or not any(rows):
            rows = [["1", "0"], ["0", "1"]]
        n = max(len(r) for r in rows) or 1
        e["cells"] = [r + [""] * (n - len(r)) for r in rows]
        e["items"] = normalize_items(e.get("items"), e["cells"])
        e["bracket"] = e.get("bracket") if e.get("bracket") in ("[]", "()", "||", "{}", "none") else "[]"
        e["hBuff"] = _f(e.get("hBuff"), 0.5, 0, 20)
        e["vBuff"] = _f(e.get("vBuff"), 0.3, 0, 20)
        e["fontSize"] = _f(e.get("fontSize"), 36, 2, 400)
        e["color"] = _color(e.get("color"), settings.get("defaultColor", "#222222"))
    elif kind == "angle":
        e["line1Id"] = str(e.get("line1Id") or "")
        e["line2Id"] = str(e.get("line2Id") or "")
        e["angleKind"] = e.get("angleKind") if e.get("angleKind") in ("angle", "right", "tangent") else "angle"
        e["radius"] = _f(e.get("radius"), 0.5, 0.01, 50)  # Manim の単位（角は弧の半径、直角は四角の一辺）
        q = e.get("quadrant") if isinstance(e.get("quadrant"), (list, tuple)) else (1, 1)
        e["quadrant"] = [1 if _f(q[0], 1) >= 0 else -1, 1 if _f(q[1] if len(q) > 1 else 1, 1) >= 0 else -1]
        e["other"] = bool(e.get("other", False))
        # 内側（False）・外側（True）の指定。None は古いプロジェクト（other を Manim の other_angle としてそのまま使う）
        e["reflex"] = e["reflex"] if isinstance(e.get("reflex"), bool) else None
        e["dot"] = bool(e.get("dot", False))
        e["label"] = str(e.get("label") or "")
        e["labelSize"] = _f(e.get("labelSize"), 36, 2, 400)
        e["labelColor"] = _color(e.get("labelColor"), None)
        e["stroke"]["width"] = _f(st.get("width"), 3.0, 0, 50)
        e["rotation"] = 0.0
    elif kind == "graphpart":
        e["graphId"] = str(e.get("graphId") or "")
        e["partKind"] = e.get("partKind") if e.get("partKind") in GRAPHPART_KINDS else "area"
        e["c"] = _numexpr(e.get("c"), 0.0)  # 原始関数の定数（F(0) = c）
        e["graph2Id"] = str(e.get("graph2Id") or "")  # 2 つのグラフの間の面積のときの、もう 1 つのグラフ
        e["label"] = str(e.get("label") if e.get("label") is not None else ("f(x)" if e["partKind"] == "glabel" else ""))
        e["labelSize"] = _f(e.get("labelSize"), 36, 2, 400)
        e["direction"] = e.get("direction") if e.get("direction") in ("UR", "UL", "DR", "DL", "UP", "DOWN", "LEFT", "RIGHT") else "UR"
        e["triangleSize"] = _f(e.get("triangleSize"), 0.25, 0.02, 3)
        # 区間・幅・x・長さは、数か式（スライドの値を使うと、値に合わせて変わる）
        e["x0"] = _numexpr(e.get("x0"), 0.0)
        e["x1"] = _numexpr(e.get("x1"), 2.0)
        if not isinstance(e["x0"], str) and not isinstance(e["x1"], str) and e["x1"] <= e["x0"]:
            e["x1"] = e["x0"] + 1
        e["dx"] = _numexpr(e.get("dx"), 0.5)
        e["atX"] = _numexpr(e.get("atX"), 1.0)  # 接線・割線の x（要素の位置の x とは別）
        e["length"] = _numexpr(e.get("length"), 3.0)
        e["sample"] = e.get("sample") if e.get("sample") in ("left", "right", "center") else "left"
        e["color2"] = _color(e.get("color2"), "#83C167")
        e["legs"] = bool(e.get("legs", True))
        e["dot"] = bool(e.get("dot", True))
        e["fill"]["color"] = _color(fi.get("color"), "#58C4DD")
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.4 if e["partKind"] == "area" else 0.6, 0, 1)
        e["rotation"] = 0.0
    elif kind in ("curve2d", "implicit"):
        e["axesId"] = str(e.get("axesId") or "")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        if kind == "curve2d":
            e["xExpr"] = str(e.get("xExpr") if e.get("xExpr") is not None else "\\cos t")
            e["yExpr"] = str(e.get("yExpr") if e.get("yExpr") is not None else "\\sin 2t")
            e["tMin"] = _f(e.get("tMin"), 0.0)
            e["tMax"] = _f(e.get("tMax"), 6.283)
            if e["tMax"] <= e["tMin"]:
                e["tMax"] = e["tMin"] + 1
        else:
            e["expr"] = str(e.get("expr") if e.get("expr") is not None else "x^2 + y^2 = 4")
        if st.get("color") is None:
            e["stroke"]["color"] = "#9A72AC"
        e["rotation"] = 0.0
    elif kind == "part":
        # 部品（要素のテンプレート）: 中身はプロジェクトの parts の写し。大きさは倍率、位置は中心
        e["partId"] = str(e.get("partId") or "")[:60]
        e["scale"] = _f(e.get("scale"), 1.0, 0.01, 100)
        e["partName"] = str(e.get("partName") or "")[:40]
    elif kind == "fcurve":
        e["curveKind"] = e.get("curveKind") if e.get("curveKind") in ("function", "parametric", "implicit") else "function"
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        dflt = {"function": "\\sin x", "implicit": "x^2 + y^2 = 4"}.get(e["curveKind"], "")
        e["expr"] = str(e.get("expr") if e.get("expr") is not None else dflt)
        e["xExpr"] = str(e.get("xExpr") if e.get("xExpr") is not None else "\\cos t")
        e["yExpr"] = str(e.get("yExpr") if e.get("yExpr") is not None else "\\sin 2t")
        for k, d in (("xMin", -4.0), ("xMax", 4.0), ("yMin", -3.0), ("yMax", 3.0), ("tMin", 0.0), ("tMax", 6.283)):
            e[k] = _f(e.get(k), d)
        for a, b in (("xMin", "xMax"), ("yMin", "yMax"), ("tMin", "tMax")):
            if e[b] <= e[a]:
                e[b] = e[a] + 1
        e["scale"] = _f(e.get("scale"), 1.0, 0.01, 100)  # 曲線の 1 の長さ（Manim の単位）
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
    elif kind == "tangent":
        e["targetId"] = str(e.get("targetId") or "")
        e["alpha"] = _numexpr(e.get("alpha"), 0.5)  # 曲線の長さの割合（0〜1。数か式）
        e["length"] = _f(e.get("length"), 2.0, 0.01, 100)
        e["dot"] = bool(e.get("dot", True))
        if st.get("color") is None:
            e["stroke"]["color"] = "#FFC300"
        e["rotation"] = 0.0
    elif kind == "svg":
        e["path"] = str(e.get("path") or "").replace("\\", "/")
        e["natW"] = _f(e.get("natW"), 100.0, 1e-6)
        e["natH"] = _f(e.get("natH"), 100.0, 1e-6)
        e["width"] = _f(e.get("width"), 300.0, 1)
        e["height"] = _f(e.get("height"), e["width"] * e["natH"] / e["natW"], 1)
        e["keepAspect"] = bool(e.get("keepAspect", True))
        e["colorMode"] = "single" if e.get("colorMode") == "single" else "original"
        e["strokeOverride"] = bool(e.get("strokeOverride", False))
        e["opacity"] = _f(e.get("opacity"), 1.0, 0, 1)
    elif kind in SHAPES_3D:
        normalize_3d(e, kind, st, fi)
    elif kind == "balloon":
        e["balloonShape"] = "ellipse" if e.get("balloonShape") == "ellipse" else "rect"
        e["contentIds"] = [str(x) for x in (e.get("contentIds") or []) if x]
        e["padX"] = _f(e.get("padX"), 0.3, 0, 10)
        e["padY"] = _f(e.get("padY"), 0.2, 0, 10)
        e["cornerRadius"] = _f(e.get("cornerRadius"), 0.25, 0, 10)
        e["tailWidth"] = _f(e.get("tailWidth"), 0.4, 0.02, 10)
        t = e.get("tail")
        e["tail"] = {"dx": _f(t.get("dx"), -120), "dy": _f(t.get("dy"), 140)} if isinstance(t, dict) else None
        e["width"] = _f(e.get("width"), 300.0, 1)  # 箱の大きさ（中身から決まる。中身が無いときに使う）
        e["height"] = _f(e.get("height"), 150.0, 1)
        # 吹き出しの向き（グループごと回したときに、中身と一緒に回る）。尾の位置は吹き出しの向きで持つ


def nice_range(lo: float, hi: float, ticks: int = 5) -> tuple[float, float, float]:
    """lo〜hi を含む、きりのよい (最小, 最大, 目盛り)。"""
    import math
    if hi <= lo:
        hi = lo + 1
    raw = (hi - lo) / ticks
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 5, 10) if m * mag >= raw - 1e-12)
    a, b = math.floor(lo / step + 1e-9) * step, math.ceil(hi / step - 1e-9) * step
    r = lambda v: float(f"{v:.10g}")  # noqa: E731
    return r(a), r(b if b > a else a + step), r(step)


def _normalize_label(e: dict[str, Any], settings: dict[str, Any]) -> None:
    """線・点のラベル（数式）。"""
    e["label"] = str(e.get("label") or "")
    e["labelSize"] = _f(e.get("labelSize"), 36 if e.get("shape") == "line" else 30, 2, 400)
    e["labelColor"] = _color(e.get("labelColor"), None)


# 点の名前の向き（右から反時計回り）
PNAME_DIRS = {"r": (1, 0), "ur": (1, 1), "u": (0, 1), "ul": (-1, 1), "l": (-1, 0), "dl": (-1, -1), "d": (0, -1), "dr": (1, -1)}
PNAME_POS = ("auto", "free", *PNAME_DIRS)


def pname_auto_dir(e: dict[str, Any], others: list[dict[str, Any]]) -> tuple[float, float]:
    """点の名前を置く向き（自動）。円（の周）の上の点なら円の外向き、線の端にある点なら線から離れる向き、ほかは右上。
    others は同じスライドの要素（キャンバスの px。円は ellipse・arc、線は line）。戻り値は Manim の向き（上が正）。"""
    import math
    px, py = float(e.get("x", 0)), float(e.get("y", 0))
    best = None
    for o in others:
        if o.get("type") != "shape" or o.get("id") == e.get("id"):
            continue
        sh = o.get("shape")
        if sh in ("ellipse", "arc"):
            if sh == "ellipse":
                w, h = float(o.get("width") or 0), float(o.get("height") or 0)
                if not w or abs(w - h) > 0.02 * max(w, h):
                    continue
                r = w / 2
            else:
                r = float(o.get("radius") or 0)
            cx, cy = float(o.get("x", 0)), float(o.get("y", 0))
            d = math.hypot(px - cx, py - cy)
            if r > 0 and d > 1e-6 and abs(d - r) <= max(6.0, 0.04 * r):
                if best is None or abs(d - r) < best[0]:
                    best = (abs(d - r), ((px - cx) / d, -(py - cy) / d))
    if best:
        return best[1]
    sx = sy = 0.0
    n = 0
    for o in others:
        if o.get("type") != "shape" or o.get("shape") != "line" or o.get("arcAngle"):
            continue
        x, y, dx, dy = float(o.get("x", 0)), float(o.get("y", 0)), float(o.get("dx", 0)), float(o.get("dy", 0))
        for (ax, ay), (bx, by) in (((x - dx, y - dy), (x + dx, y + dy)), ((x + dx, y + dy), (x - dx, y - dy))):
            if math.hypot(ax - px, ay - py) <= 6.0:
                ln = math.hypot(bx - ax, by - ay)
                if ln > 1e-6:
                    sx += (bx - ax) / ln
                    sy += (by - ay) / ln
                    n += 1
    if n and math.hypot(sx, sy) > 0.2:
        return (-sx, sy)  # 線の向きの和の逆（キャンバスの y は下が正なので、Manim では符号を変える）
    if n:  # 1 本の線の途中・まっすぐ通る線: 線に垂直で、上寄りの向き
        return (0.0, 1.0)
    return (1.0, 1.0)


def _u(px: float) -> float:
    return round(px / PX, 4)


def style_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    st, fi = e["stroke"], e["fill"]
    kw: dict[str, Any] = {"stroke_color": st["color"], "stroke_width": st["width"]}
    if st["opacity"] < 1:
        kw["stroke_opacity"] = st["opacity"]
    if fi["color"] and fi["color"] != st["color"]:
        kw["fill_color"] = fi["color"]
    kw["fill_opacity"] = fi["opacity"]
    return kw


def _label_kwargs(e: dict[str, Any], font_scale: float) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e.get("label"):
        kw.update(label=math_label(e["label"]), label_size=round(e["labelSize"] * font_scale, 2))
        if e.get("labelColor"):
            kw["label_color"] = e["labelColor"]
    return kw


def _closed_label_kwargs(e: dict[str, Any], font_scale: float) -> dict[str, Any]:
    kw = _label_kwargs(e, font_scale)
    if kw:
        if e.get("labelBg"):
            kw["label_bg"] = e["labelBg"]
        if e.get("labelFrame"):
            kw["label_frame"] = True
    return kw


def shape_kwargs(e: dict[str, Any], font_scale: float = 1.0) -> tuple[str, dict[str, Any]]:
    """(kind, gui_shape の引数)。吹き出しは gui_balloon_shape 用（中身の大きさは呼び出し側で）。
    ラベル（線・点）があるときは label を含む（呼び出し側で tex_template を渡す）。"""
    kind = e["shape"]
    kw: dict[str, Any] = {}
    if kind == "line":
        kw.update(start=(_u(-e["dx"]), _u(e["dy"])), end=(_u(e["dx"]), _u(-e["dy"])))
        if e["startTip"]:
            kw["start_tip"] = True
        if e["endTip"]:
            kw["end_tip"] = True
        if e["startTip"] or e["endTip"]:
            kw.update(tip_length=e["tipSize"], tip_width=e["tipSize"])
        if e.get("arcAngle"):
            kw["arc_angle"] = e["arcAngle"]
        if (e["startTip"] or e["endTip"]) and e.get("tipShape", "triangle") != "triangle":
            kw["tip_shape"] = e["tipShape"]
        if (e["startTip"] or e["endTip"]) and e.get("tipScale"):
            kw["tip_ratio"] = 0.35
        lk = _label_kwargs(e, font_scale)
        if lk:
            kw.update(lk)
            if e["labelPos"] != 0.5:
                kw["label_pos"] = e["labelPos"]
            if e["labelBg"]:
                kw["label_bg"] = e["labelBg"]
            if e["labelFrame"]:
                kw["label_frame"] = True
    elif kind in BOX_SHAPES:
        kw.update(width=_u(e["width"]), height=_u(e["height"]))
        if kind == "rect" and e["cornerRadius"] > 0:
            kw["corner_radius"] = e["cornerRadius"]
        if kind in ("polygon", "star"):
            kw["sides"] = e["sides"]
        if kind == "star":
            if e.get("polygram"):
                kw.update(polygram=True, density=e["density"])
            else:
                kw["inner_ratio"] = e["innerRatio"]
        if kind == "polygon" and e.get("edgeArc"):
            kw["edge_arc"] = e["edgeArc"]
        kw.update(_closed_label_kwargs(e, font_scale))
    elif kind == "arc":
        kw.update(radius=_u(e["radius"]), start_angle=e["startAngle"], angle=e["angle"])
        if e["sector"]:
            kw["sector"] = True
    elif kind == "dot":
        kw["radius"] = _u(e["radius"])
        if e.get("ring"):
            kw["ring"] = True
        kw.update(_label_kwargs(e, font_scale))
        if e.get("pname"):
            kw.update(name=math_label(e["pname"]), name_size=round(e["pnameSize"] * font_scale, 2))
            if e["pnamePos"] == "free" and e.get("pnameShift"):
                kw["name_shift"] = tuple(e["pnameShift"])
            else:
                d = PNAME_DIRS.get(e["pnamePos"]) or e.get("_pnameDir") or (1.0, 1.0)
                kw["name_dir"] = (round(float(d[0]), 4), round(float(d[1]), 4))
            kw["name_color"] = e.get("pnameColor") or e.get("_pnameDefaultColor") or "#222222"
    elif kind == "annulus":
        kw.update(radius=_u(e["radius"]), inner_radius=_u(e["innerRadius"]))
        if e["sector"]:
            kw.update(sector=True, start_angle=e["startAngle"], angle=e["angle"])
    elif kind == "elbow":
        kw["radius"] = _u(e["radius"])
    elif kind == "path":
        kw["paths"] = [[(_u(n[0]), _u(-n[1]), _u(n[2]), _u(-n[3]), _u(n[4]), _u(-n[5])) for n in sp] for sp in e["paths"]]
        if e["closed"]:
            kw["closed"] = True
            kw.update(_closed_label_kwargs(e, font_scale))
    if kind != "balloon":
        style = style_kwargs(e)
        if kind == "dot":
            style = {"stroke_color": e["stroke"]["color"], "fill_color": e["fill"]["color"] or e["stroke"]["color"],
                     "fill_opacity": e["fill"]["opacity"] or 1.0}
            if e.get("ring"):  # 輪の太さ・不透明度
                style.update(stroke_width=e["stroke"]["width"])
                if e["stroke"]["opacity"] < 1:
                    style["stroke_opacity"] = e["stroke"]["opacity"]
        kw.update(style)
        if e["dashed"] and kind != "dot":
            kw["dashed"] = True
            kw["dash_length"] = e["dashLength"]
        if e.get("gradient") and kind in ("line", "path", "arc"):
            kw["gradient"] = e["gradient"]
    return kind, kw


def balloon_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_balloon / gui_balloon_shape に共通の引数（大きさ・中身以外）。"""
    kw: dict[str, Any] = {"shape": e["balloonShape"], "corner_radius": e["cornerRadius"], "tail_width": e["tailWidth"]}
    kw["tail"] = (_u(e["tail"]["dx"]), _u(-e["tail"]["dy"])) if e["tail"] else None
    st, fi = e["stroke"], e["fill"]
    kw.update(stroke_color=st["color"], stroke_width=st["width"], stroke_opacity=st["opacity"],
              fill_color=fi["color"] or "#FFFFFF", fill_opacity=fi["opacity"])
    return kw


AXIS_DIRS = {"down": (0.0, -1.0), "up": (0.0, 1.0), "left": (-1.0, 0.0), "right": (1.0, 0.0)}


def math_label(s: str) -> str:
    """軸ラベル（数式）。日本語などがあって \\text が無ければ、\\text{…} で包む（数式の中では日本語が出ないため）。"""
    if s and any(ord(c) > 127 for c in s) and "\\text" not in s and "\\mathrm" not in s:
        return "\\text{" + s + "}"
    return s


def axes_kwargs(e: dict[str, Any], with_extras: bool = True) -> dict[str, Any]:
    """gui_axes の引数（kind から）。with_extras=False は、グラフのプレビュー用（数字・ラベル無し。位置は同じ）。"""
    # 整数は整数のまま渡す（Manim は目盛りの間隔が小数だと、数字を 1.0 のように小数で表示する）
    n = lambda v: int(v) if float(v).is_integer() else v  # noqa: E731
    kw: dict[str, Any] = {
        "x_range": (n(e["xMin"]), n(e["xMax"]), n(e["xStep"])), "y_range": (n(e["yMin"]), n(e["yMax"]), n(e["yStep"])),
        "x_length": _u(e["width"]), "y_length": _u(e["height"]),
    }
    if not e["tips"]:
        kw["tips"] = False
    if e.get("xLog"):
        kw["x_log"] = True
    if e.get("yLog"):
        kw["y_log"] = True
    if e["axesKind"] == "polar":
        kw.pop("y_range", None)
        kw.pop("y_length", None)
        if e["azimuthStep"] != 30:
            kw["azimuth_step"] = _num(e["azimuthStep"])
        if e["azimuthUnits"] == "pi":
            kw["azimuth_units"] = "PI radians"
    if with_extras:
        if e["numbers"]:
            kw.update(numbers=True, num_size=e["numSize"])
        if e["axesKind"] not in ("numberline", "polar") and (e["xLabel"] or e["yLabel"]):
            kw.update(x_label=math_label(e["xLabel"]), y_label=math_label(e["yLabel"]))
            if any(e["xLabelShift"]):
                kw["x_label_shift"] = tuple(e["xLabelShift"])
            if any(e["yLabelShift"]):
                kw["y_label_shift"] = tuple(e["yLabelShift"])
        kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
        if e["axesKind"] in ("plane", "polar", "complex"):
            kw.update(grid_color=e["gridColor"], grid_opacity=e["gridOpacity"])
    return kw


def graph_kwargs(e: dict[str, Any], python_expr: str) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e["xFrom"] is not None or e["xTo"] is not None:
        kw["x_range"] = (e["xFrom"], e["xTo"])
    st = e["stroke"]
    kw.update(color=st["color"], stroke_width=st["width"])
    if st["opacity"] < 1:
        kw["stroke_opacity"] = st["opacity"]
    if e["dashed"]:
        kw.update(dashed=True, dash_length=e["dashLength"])
    if e.get("gradient"):
        kw["gradient"] = e["gradient"]
    return kw


def brace_direction(e: dict[str, Any]) -> tuple[float, float]:
    """かっこの向き（Manim の座標）。2 点の間なら、始点→終点を時計回りに 90° 回した向き（反転できる）。"""
    if e["mode"] == "target":
        return AXIS_DIRS[e["direction"]]
    import math
    vx, vy = _u(e["dx"]), _u(-e["dy"])  # 始点→終点の半分（Manim の向き）
    L = math.hypot(vx, vy) or 1.0
    d = (vy / L, -vx / L)
    return (-d[0], -d[1]) if e["flip"] else d


def brace_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    d = brace_direction(e)
    kw: dict[str, Any] = {"direction": (round(d[0], 4), round(d[1], 4))}
    if e["buff"] != 0.2:
        kw["buff"] = e["buff"]
    if e["sharpness"] != 2.0:
        kw["sharpness"] = e["sharpness"]
    kw["color"] = e["fill"]["color"] or e["stroke"]["color"]
    if e["label"]:
        kw.update(label=e["label"], label_kind=e["labelKind"], label_size=e["labelSize"])
        if e["labelColor"]:
            kw["label_color"] = e["labelColor"]
        if e["labelKind"] == "text":
            kw["label_font"] = e["labelFont"]
    return kw


def _num(v: float) -> float | int:
    return int(v) if float(v).is_integer() else v


def normalize_items(items: Any, cells: list[list[str]]) -> list[list[str | None]]:
    """表・行列のセルに入れる要素の id（セルと同じ形。None は文字・数式のセル）。"""
    rows = items if isinstance(items, list) else []
    out = []
    for i, r in enumerate(cells):
        src = rows[i] if i < len(rows) and isinstance(rows[i], list) else []
        out.append([(str(src[j]) if j < len(src) and src[j] else None) for j in range(len(r))])
    return out


def table_item_ids(e: dict[str, Any]) -> list[str]:
    return [x for r in (e.get("items") or []) for x in r if x]


# セルに入れられない要素（ほかの要素から作る物・3D・画像・グループ）
CELL_EXCLUDED_SHAPES = ("graph", "graphpart", "axdot", "curve2d", "implicit", "angle", "brace", "balloon", "annot", "boolean", "vector",
                        "linegraph", "trace", "field", "surface", "curve3d", "point3d", "solid", "axes3d", "zoom")


def cell_item_ok(e: dict[str, Any]) -> bool:
    if e.get("type") in ("text", "math"):
        return True
    if e.get("type") != "shape" or e.get("shape") in CELL_EXCLUDED_SHAPES:
        return False
    if e.get("shape") in ("table", "matrix") and table_item_ids(e):
        return False  # 要素を入れた表は、ほかの表に入れない
    return True


def table_kwargs(e: dict[str, Any], font_size: float) -> dict[str, Any]:
    """gui_table の引数（cells は最初の引数）。font_size は文字の大きさの倍率を掛けた値。"""
    kw: dict[str, Any] = {}
    if e["cellMode"] == "math":
        kw["mode"] = "math"
    if e["headerRow"]:
        kw["header_row"] = True
    if e["headerCol"]:
        kw["header_col"] = True
    if e["cellMode"] == "text":
        kw["font"] = e["font"]
    kw.update(font_size=font_size, color=e["color"], h_buff=e["hBuff"], v_buff=e["vBuff"])
    if not e["outerLines"]:
        kw["outer_lines"] = False
    kw.update(line_color=e["stroke"]["color"], line_width=e["stroke"]["width"])
    return kw


def table_uses_math(e: dict[str, Any]) -> bool:
    return e["cellMode"] == "math" or any(len(c) >= 2 and c.startswith("$") and c.endswith("$") for r in e["cells"] for c in r)


def field_kwargs(e: dict[str, Any], attached: bool) -> dict[str, Any]:
    """gui_field の引数（kind・fx・fy・axes・center 以外）。attached は座標軸に重ねるとき（範囲は座標軸から）。"""
    kw: dict[str, Any] = {}
    if not attached:
        kw.update(x_range=(_num(e["xMin"]), _num(e["xMax"])), y_range=(_num(e["yMin"]), _num(e["yMax"])),
                  width=_u(e["width"]), height=_u(e["height"]))
    kw["step"] = _num(e["step"])
    if e["fieldKind"] == "arrows":
        if e["lengthMode"] != "limit":
            kw["length"] = e["lengthMode"]
        if e["lengthScale"] != 1:
            kw["scale"] = e["lengthScale"]
    elif e["virtualTime"] != 3:
        kw["virtual_time"] = e["virtualTime"]
    st = e["stroke"]
    kw["color"] = st["color"]
    if e["colorMode"] == "magnitude":
        kw["color_max"] = _num(e["colorMax"])
    kw["stroke_width"] = st["width"]
    if st["opacity"] < 1:
        kw["opacity"] = st["opacity"]
    return kw


def number_kwargs(e: dict[str, Any], font_size: float) -> dict[str, Any]:
    """gui_number の引数（最初の引数の値・ValueTracker 以外）。"""
    kw: dict[str, Any] = {"decimals": e["decimals"], "font_size": font_size, "color": e["color"]}
    if e["unit"]:
        kw["unit"] = math_label(e["unit"])
    if e["includeSign"]:
        kw["include_sign"] = True
    if e.get("nameLabel"):
        kw["label"] = math_label(e["nameLabel"])
    return kw


def axdot_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {"radius": _u(e["radius"]), "color": e["fill"]["color"] or e["stroke"]["color"]}
    if e["lines"]:
        kw.update(lines=True, line_color=e["stroke"]["color"])
    return kw


# ---------------------------------------------------------------- 3D

def _vec3(v: Any, default: tuple[float, float, float]) -> list[float]:
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return [round(_f(v[i], default[i]), 4) for i in range(3)]
    return list(default)


def _opt(v: Any) -> float | None:
    return None if v in (None, "") else _f(v, 0.0)


def normalize_3d(e: dict[str, Any], kind: str, st: dict[str, Any], fi: dict[str, Any]) -> None:
    e["rotation"] = 0.0
    e["quality"] = e.get("quality") if e.get("quality") in ("low", "mid", "high") else "mid"
    if kind in ("solid", "axes3d"):
        e["pos3"] = _vec3(e.get("pos3"), (0.0, 0.0, 0.0))
    if kind == "solid":
        e["solidKind"] = e.get("solidKind") if e.get("solidKind") in SOLID_KINDS else "sphere"
        poly = e["solidKind"] in POLYHEDRA
        # 自由な多面体（頂点と面）・凸包（点）。頂点は [x, y, z]、面は頂点の番号（0 から）の並び
        verts = []
        for v in (e.get("vertices") if isinstance(e.get("vertices"), list) else [])[:200]:
            if isinstance(v, (list, tuple)) and len(v) >= 3:
                verts.append([round(_f(c, 0.0), 4) for c in v[:3]])
        if not verts:
            verts = [list(v) for v in (DEFAULT_HULL_POINTS if e["solidKind"] == "hull" else DEFAULT_PYRAMID[0])]
        e["vertices"] = verts
        faces = []
        for f in (e.get("faces") if isinstance(e.get("faces"), list) else [])[:400]:
            if isinstance(f, (list, tuple)):
                idx = [int(_f(i, -1)) for i in f]
                if len(idx) >= 3 and all(0 <= i < len(verts) for i in idx):
                    faces.append(idx)
        if not faces and e["solidKind"] == "polyhedron" and verts == [list(v) for v in DEFAULT_PYRAMID[0]]:
            faces = [list(f) for f in DEFAULT_PYRAMID[1]]
        e["faces"] = faces
        e["showVertices"] = bool(e.get("showVertices", False))
        e["vertexRadius"] = _f(e.get("vertexRadius"), 0.06, 0.005, 2)
        e["rot3"] = _vec3(e.get("rot3"), (0.0, 0.0, 0.0))
        e["scale"] = _f(e.get("scale"), 1.0, 0.01, 100)
        e["radius"] = _f(e.get("radius"), 1.0, 0.01, 100)
        e["side"] = _f(e.get("side"), 2.0, 0.01, 100)
        e["dims"] = [max(0.01, x) for x in _vec3(e.get("dims"), (2.0, 1.0, 1.0))]
        e["height"] = _f(e.get("height"), 2.0, 0.01, 100)
        e["minorRadius"] = _f(e.get("minorRadius"), 0.3, 0.01, 100)
        e["fill"]["color"] = _color(fi.get("color"), "#58C4DD")
        e["fill"]["opacity"] = _f(fi.get("opacity"), 1.0 if e["solidKind"] in ("sphere", "torus", "cone", "cylinder") else 0.6 if poly else 0.85, 0, 1)
        e["color2"] = _color(e.get("color2"), None)
        e["stroke"]["width"] = _f(st.get("width"), 1.5 if poly else 0.0, 0, 20)
    elif kind == "axes3d":
        for k, d in (("xMin", -4), ("xMax", 4), ("xStep", 1), ("yMin", -4), ("yMax", 4), ("yStep", 1), ("zMin", -3), ("zMax", 3), ("zStep", 1)):
            e[k] = _f(e.get(k), d)
        for a in "xyz":
            if e[a + "Max"] <= e[a + "Min"]:
                e[a + "Max"] = e[a + "Min"] + 1
            e[a + "Step"] = max(abs(e[a + "Step"]), (e[a + "Max"] - e[a + "Min"]) / 200) or 1
        e["xLen"] = _f(e.get("xLen"), 8.0, 0.1, 100)
        e["yLen"] = _f(e.get("yLen"), 8.0, 0.1, 100)
        e["zLen"] = _f(e.get("zLen"), 6.0, 0.1, 100)
        e["tips"] = bool(e.get("tips", True))
        e["labels"] = bool(e.get("labels", True))
        for a in "xyz":
            e[a + "Label"] = str(e.get(a + "Label") if e.get(a + "Label") is not None else a)
        e["stroke"]["width"] = _f(st.get("width"), 2.0, 0, 50)
    elif kind == "surface":
        e["axesId"] = str(e.get("axesId") or "")
        e["surfKind"] = "param" if e.get("surfKind") == "param" else "graph"  # graph: z = f(x, y)、param: (x(u,v), y(u,v), z(u,v))
        e["expr"] = str(e.get("expr") if e.get("expr") is not None else "\\sin x \\cos y")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        for k, d in (("xExpr", "2\\cos u \\sin v"), ("yExpr", "2\\sin u \\sin v"), ("zExpr", "2\\cos v")):
            e[k] = str(e.get(k) if e.get(k) is not None else d)
        for k in ("uMin", "uMax", "vMin", "vMax"):
            e[k] = _opt(e.get(k))
        if e["surfKind"] == "param":  # 媒介変数の範囲は必ず決める
            for k, d in (("uMin", 0.0), ("uMax", 6.2832), ("vMin", 0.0), ("vMax", 3.1416)):
                if e[k] is None:
                    e[k] = d
            if e["uMax"] <= e["uMin"]:
                e["uMax"] = e["uMin"] + 1
            if e["vMax"] <= e["vMin"]:
                e["vMax"] = e["vMin"] + 1
        e["colorMode"] = e.get("colorMode") if e.get("colorMode") in ("checker", "single", "height") else "checker"
        e["fill"]["color"] = _color(fi.get("color"), "#29ABCA")
        e["fill"]["opacity"] = _f(fi.get("opacity"), 0.85, 0, 1)
        e["color2"] = _color(e.get("color2"), "#236B8E")
        e["stroke"]["color"] = _color(st.get("color"), "#BBBBBB")
        e["stroke"]["width"] = _f(st.get("width"), 0.5, 0, 20)
    elif kind == "curve3d":
        e["axesId"] = str(e.get("axesId") or "")
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        for k, d in (("xExpr", "\\cos t"), ("yExpr", "\\sin t"), ("zExpr", "\\frac{t}{4}")):
            e[k] = str(e.get(k) if e.get(k) is not None else d)
        e["tMin"] = _f(e.get("tMin"), 0.0)
        e["tMax"] = _f(e.get("tMax"), 6.283)
        if e["tMax"] <= e["tMin"]:
            e["tMax"] = e["tMin"] + 1
        if st.get("color") is None:
            e["stroke"]["color"] = "#FC6255"
    elif kind == "point3d":
        e["pointKind"] = e.get("pointKind") if e.get("pointKind") in ("dot", "line", "arrow") else "dot"
        e["axesId"] = str(e.get("axesId") or "")
        # 座標は数か式（スライドの値を使える）。式は文字列のまま持つ
        e["p1"] = _coords3(e.get("p1"), (0.0, 0.0, 0.0))
        e["p2"] = _coords3(e.get("p2"), (1.0, 1.0, 1.0))
        e["lang"] = "python" if e.get("lang") == "python" else "latex"
        e["size"] = _f(e.get("size"), 0.1 if e["pointKind"] == "dot" else 0.02, 0.001, 10)
        e["fill"]["color"] = _color(fi.get("color"), "#FC6255")


def _coords3(v: Any, default: tuple[float, float, float]) -> list:
    """3 つの座標。数にできるものは数、それ以外は式の文字列（空なら既定の数）。"""
    out: list = []
    for i in range(3):
        x = v[i] if isinstance(v, (list, tuple)) and len(v) > i else default[i]
        if isinstance(x, str):
            t = x.strip()
            try:
                x = float(t)
            except ValueError:
                x = t if t else default[i]
        out.append(round(_f(x, default[i]), 4) if not isinstance(x, str) else x)
    return out


def point3d_exprs(e: dict[str, Any]) -> list[str]:
    """点・線・矢印の座標のうち、式のもの。"""
    pts = [e["p1"]] + ([e["p2"]] if e["pointKind"] != "dot" else [])
    return [x for p in pts for x in p if isinstance(x, str)]


def _t3(v: list[float]) -> tuple:
    return tuple(_num(x) for x in v)


def solid_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    k = e["solidKind"]
    kw: dict[str, Any] = {"pos": _t3(e["pos3"])}
    if any(e["rot3"]):
        kw["rotation"] = _t3(e["rot3"])
    if e["scale"] != 1:
        kw["scale"] = e["scale"]
    if k in ("sphere", "cone", "cylinder", "torus"):
        kw["radius"] = e["radius"]
    if k == "cube":
        kw["side"] = e["side"]
    if k == "prism":
        kw["dims"] = _t3(e["dims"])
    if k in ("cone", "cylinder"):
        kw["height"] = e["height"]
    if k == "torus":
        kw["minor_radius"] = e["minorRadius"]
    if k in ("sphere", "cone", "cylinder", "torus") and e["quality"] != "mid":
        kw["quality"] = e["quality"]
    if k in ("tetrahedron", "octahedron", "dodecahedron", "icosahedron"):
        kw["side"] = e["side"]
    if k in ("polyhedron", "hull"):
        kw["vertices"] = [tuple(_num(c) for c in v) for v in e["vertices"]]
        if k == "polyhedron":
            kw["faces"] = [tuple(f) for f in e["faces"]]
    if k in POLYHEDRA and e["showVertices"]:
        kw.update(show_vertices=True, vertex_radius=e["vertexRadius"])
    kw.update(color=e["fill"]["color"])
    if e["color2"]:
        kw["color2"] = e["color2"]
    kw["opacity"] = e["fill"]["opacity"]
    if e["stroke"]["width"] > 0:
        kw.update(stroke_color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    elif k in POLYHEDRA:
        kw["stroke_width"] = 0
    return kw


def axes3d_kwargs(e: dict[str, Any], with_extras: bool = True) -> dict[str, Any]:
    kw: dict[str, Any] = {"pos": _t3(e["pos3"])}
    for a in "xyz":
        kw[a + "_range"] = (_num(e[a + "Min"]), _num(e[a + "Max"]), _num(e[a + "Step"]))
    kw.update(x_length=e["xLen"], y_length=e["yLen"], z_length=e["zLen"])
    if not e["tips"]:
        kw["tips"] = False
    if with_extras and e["labels"]:
        kw.update(x_label=math_label(e["xLabel"]), y_label=math_label(e["yLabel"]), z_label=math_label(e["zLabel"]))
    else:
        kw["labels"] = False
    kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    return kw


def surface_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e.get("surfKind") == "param":
        kw.update(u_range=(e["uMin"], e["uMax"]), v_range=(e["vMin"], e["vMax"]))
    else:
        if e["uMin"] is not None or e["uMax"] is not None:
            kw["u_range"] = (e["uMin"], e["uMax"])
        if e["vMin"] is not None or e["vMax"] is not None:
            kw["v_range"] = (e["vMin"], e["vMax"])
    if e["quality"] != "mid":
        kw["quality"] = e["quality"]
    if e["colorMode"] == "height":
        kw["colorscale"] = ["#236B8E", "#83C167", "#FFC300", "#FC6255"]
    else:
        kw["color"] = e["fill"]["color"]
        kw["color2"] = e["color2"] if e["colorMode"] == "checker" else None
    kw.update(opacity=e["fill"]["opacity"], stroke_color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    return kw


def curve3d_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    return {"t_range": (_num(e["tMin"]), _num(e["tMax"])), "color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"]}


def point3d_kwargs(e: dict[str, Any], conv=None) -> dict[str, Any]:
    """conv: 式の座標を Python の式にする関数（無ければ式のまま）。"""
    def c3(p):
        return tuple(conv(x) if (conv and isinstance(x, str)) else (x if isinstance(x, str) else _num(x)) for x in p)
    kw: dict[str, Any] = {"start": c3(e["p1"])}
    if e["pointKind"] != "dot":
        kw["end"] = c3(e["p2"])
    kw["color"] = e["fill"]["color"]
    kw["radius" if e["pointKind"] == "dot" else "thickness"] = e["size"]
    if e["quality"] != "mid":
        kw["quality"] = e["quality"]
    return kw


def svg_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_svg の引数（path 以外）。縦横比を変えたときだけ height を渡す。"""
    kw: dict[str, Any] = {"width": _u(e["width"])}
    if not e["keepAspect"] and abs(e["height"] - e["width"] * e["natH"] / e["natW"]) > 0.5:
        kw["height"] = _u(e["height"])
    if e["colorMode"] == "single":
        kw["color"] = e["fill"]["color"] or e["stroke"]["color"]
    if e["strokeOverride"]:
        kw.update(stroke_color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    if e["opacity"] < 1:
        kw["opacity"] = e["opacity"]
    return kw


def matrix_kwargs(e: dict[str, Any], font_size: float) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e["bracket"] != "[]":
        kw["bracket"] = e["bracket"]
    kw.update(h_buff=e["hBuff"], v_buff=e["vBuff"], font_size=font_size, color=e["color"])
    return kw


def angle_kwargs(e: dict[str, Any], font_scale: float = 1.0) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e["angleKind"] == "right":
        kw["kind"] = "right"
    kw["radius"] = e["radius"]
    if e["quadrant"] != [1, 1]:
        kw["quadrant"] = tuple(e["quadrant"])
    if e.get("reflex") is not None:  # 内側・外側の指定（線の向きから other を決める）
        kw["reflex"] = e["reflex"]
    elif e["other"]:  # 古いプロジェクト（Manim の other_angle をそのまま使う）
        kw["other"] = True
    if e["dot"]:
        kw["dot"] = True
    kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    if e["label"]:
        kw.update(label=math_label(e["label"]), label_size=round(e["labelSize"] * font_scale, 2))
        if e["labelColor"]:
            kw["label_color"] = e["labelColor"]
    return kw


GRAPHPART_NUMS = ("x0", "x1", "dx", "atX", "length", "c")
GRAPHPART_KINDS = ("area", "riemann", "tangent", "secant", "derivative", "antiderivative", "glabel", "tlabel")


def _numexpr(v: Any, default: float) -> float | str:
    """数にできるものは数、それ以外は式の文字列（空なら既定の数）。"""
    if isinstance(v, str):
        t = v.strip()
        try:
            return round(float(t), 6)
        except ValueError:
            return t if t else default
    return round(_f(v, default), 6)


def graphpart_kwargs(e: dict[str, Any], conv=None) -> dict[str, Any]:
    """conv: 式の値を Python の式にする関数（無ければ式のまま）。"""
    e = {**e, **{k: (conv(e[k]) if conv and isinstance(e[k], str) else e[k] if isinstance(e[k], str) else _num(e[k]))
                 for k in GRAPHPART_NUMS}}
    k = e["partKind"]
    kw: dict[str, Any] = {}
    if k in ("area", "riemann"):
        kw["x_range"] = (e["x0"], e["x1"])
    if k == "riemann":
        kw.update(dx=e["dx"], sample=e["sample"], color=e["fill"]["color"], color2=e["color2"], opacity=e["fill"]["opacity"],
                  stroke_color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    elif k == "area":
        kw.update(color=e["fill"]["color"], opacity=e["fill"]["opacity"])
    elif k == "tangent":
        kw.update(x=e["atX"], length=e["length"], color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
        if not e["dot"]:
            kw["dot"] = False
    elif k in ("derivative", "antiderivative"):
        if k == "antiderivative" and e["c"] != 0:
            kw["c"] = e["c"]
        kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
        if e["dashed"]:
            kw.update(dashed=True, dash_length=e["dashLength"])
        if e.get("gradient"):
            kw["gradient"] = e["gradient"]
    elif k == "glabel":
        kw.update(x=e["atX"], label=math_label(e["label"]))
        if e["direction"] != "UR":
            kw["direction"] = e["direction"]
        kw.update(color=e["stroke"]["color"], label_size=e["labelSize"])
        if e["dot"]:
            kw["dot"] = True
    elif k == "tlabel":
        kw["x"] = e["atX"]
        if e["label"]:
            kw.update(label=math_label(e["label"]), label_size=e["labelSize"])
        kw.update(triangle_size=e["triangleSize"], color=e["stroke"]["color"])
    else:
        kw.update(x=e["atX"], dx=e["dx"], color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
        if not e["legs"]:
            kw["legs"] = False
    return kw


def curve2d_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if e["shape"] == "curve2d":
        kw["t_range"] = (_num(e["tMin"]), _num(e["tMax"]))
    kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    if e["shape"] == "curve2d" and e["dashed"]:
        kw.update(dashed=True, dash_length=e["dashLength"])
    if e["shape"] == "curve2d" and e.get("gradient"):
        kw["gradient"] = e["gradient"]
    return kw


def implicit_python(expr: str, lang: str, names: tuple[str, ...], to_python) -> str:
    """陰関数の式。「左辺 = 右辺」は「(左辺) - (右辺)」にする（= が無ければ 式 = 0）。"""
    if expr.count("=") == 1:
        lhs, rhs = expr.split("=")
        return f"({to_python(lhs, lang, names)}) - ({to_python(rhs, lang, names)})"
    return to_python(expr, lang, names)


def polar_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """極座標のグラフ r = f(θ)。xFrom・xTo は θ の範囲（ラジアン。空欄なら 0〜2π）。"""
    import math
    kw: dict[str, Any] = {}
    if e["xFrom"] is not None or e["xTo"] is not None:
        kw["theta_range"] = (e["xFrom"] if e["xFrom"] is not None else 0.0, e["xTo"] if e["xTo"] is not None else round(2 * math.pi, 4))
    st = e["stroke"]
    kw.update(color=st["color"], stroke_width=st["width"])
    return kw


def complex_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """複素数の曲線 z = f(t)。xFrom・xTo は t の範囲（空欄なら 0〜2π）。"""
    import math
    kw: dict[str, Any] = {}
    if e["xFrom"] is not None or e["xTo"] is not None:
        kw["t_range"] = (e["xFrom"] if e["xFrom"] is not None else 0.0, e["xTo"] if e["xTo"] is not None else round(2 * math.pi, 4))
    kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    return kw


def code_kwargs(e: dict[str, Any], font_size: float) -> dict[str, Any]:
    kw: dict[str, Any] = {"language": e["language"], "style": e["style"], "font_size": font_size}
    if e["font"]:
        kw["font"] = e["font"]
    if not e["lineNumbers"]:
        kw["line_numbers"] = False
    elif e["lineFrom"] != 1:
        kw["line_from"] = e["lineFrom"]
    if e["background"] != "rectangle":
        kw["background"] = e["background"]
    if e["bgColor"]:
        kw["bg_color"] = e["bgColor"]
    if e["textColor"]:
        kw["text_color"] = e["textColor"]
    if e["tabWidth"] != 4:
        kw["tab_width"] = e["tabWidth"]
    return kw


def barchart_kwargs(e: dict[str, Any], font_scale: float = 1.0) -> dict[str, Any]:
    """gui_barchart の引数（値は別に渡す）。"""
    kw: dict[str, Any] = {}
    names = [b["name"] for b in e["bars"]]
    if any(n.strip() for n in names):
        kw["names"] = names
    kw["y_range"] = (_num(e["yMin"]), _num(e["yMax"]), _num(e["yStep"]))
    kw.update(width=_u(e["width"]), height=_u(e["height"]), colors=[b["color"] for b in e["bars"]])
    if e["barWidth"] != 0.6:
        kw["bar_width"] = e["barWidth"]
    kw.update(fill_opacity=e["fill"]["opacity"], stroke_width=e["stroke"]["width"], axis_color=e["axisColor"],
              num_size=round(e["numSize"] * font_scale, 2), label_size=round(e["labelSize"] * font_scale, 2))
    if e["showValues"]:
        kw.update(show_values=True, decimals=e["decimals"])
    return kw


def barchart_uses_tex(e: dict[str, Any]) -> bool:
    return any(b["name"].strip() for b in e["bars"])


ROLE_RE = re.compile(r"^\s*(仮定|前提|条件|結論)\s*[:：]\s*")


def theorem_args(e: dict[str, Any], settings: dict[str, Any], font_size: float) -> tuple[str, list[str], dict[str, Any]]:
    """定理のブロックの (見出し, 段落, gui_theorem の引数)。番号（_number）・証明の対象（_proofOf）は refs.apply が入れる。"""
    from .refs import ROLE_COLORS, normalize_settings  # noqa: PLC0415
    st = normalize_settings(settings.get("theorems"))[e["kind"]]
    text_hex = e["color"].lstrip("#").upper()
    if e["kind"] == "proof":
        fmt = str(settings.get("proofTitle") or "{対象} の{証明}")
        title = fmt.replace("{対象}", e["_proofOf"]).replace("{証明}", st["label"]) if e.get("_proofOf") else st["label"]
        head = f"\\textbf{{{title}}}"
    else:
        num = e.get("_number") if e.get("numbered") else None
        head = f"\\textbf{{{st['label']}{(' ' + num) if num else ''}}}"
    if e.get("title", "").strip():
        head += f"{{\\color[HTML]{{{text_hex}}}（{e['title'].strip()}）}}"
    paras, roles = [], []
    for line in e.get("body", "").replace("\r\n", "\n").split("\n"):
        if not line.strip():
            continue
        m = ROLE_RE.match(line)
        if m:
            roles.append((ROLE_COLORS["conclude" if m.group(1) == "結論" else "assume"], m.group(1)))
            line = line[m.end():]
        else:
            roles.append(None)
        paras.append(line.strip() or " ")
    boxed = e["boxed"] if e.get("boxed") is not None else e["kind"] != "proof"
    kw: dict[str, Any] = {"width": round(e["width"] / PX, 4), "font_size": font_size, "color": e["color"], "accent": st["color"]}
    if not boxed:
        kw["boxed"] = False
    if any(roles):
        kw["roles"] = [list(r) if r else None for r in roles]
    if e.get("qed"):
        kw["qed"] = True
    return head, paras, kw


_TEX_NO_BREAK_AFTER = re.compile(r"(\\(?:begin|end)\{[^}]*\}(\[[^\]]*\]|\{[^}]*\})*|\\\\|\\par|\\newline|%.*)\s*$")
_TEX_NO_BREAK_BEFORE = re.compile(r"^\s*(\\item\b|\\end\{|\\begin\{|\\\\|\\par\b|\\hline|\\(?:mid|bottom|top)rule)")


def tex_body(s: str) -> str:
    """Tex・Title の文字。改行は LaTeX の改行（\\\\）にする。
    ただし、環境の始まり・終わり（\\begin{…}・\\end{…}）の後ろと、\\item・\\end{…}・\\begin{…} の前、
    もう改行で終わっている行（\\\\・\\par）の後ろには入れない（\\begin{enumerate} \\\\ \\item は LaTeX のエラーになる）。"""
    lines = [ln.rstrip() for ln in s.replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) <= 1:
        return lines[0] if lines else " "
    out = []
    for i, ln in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        # 空の行は今までどおり 1 行あける（前後に改行を入れる）
        brk = nxt is not None and not _TEX_NO_BREAK_AFTER.search(ln) and not _TEX_NO_BREAK_BEFORE.match(nxt)
        # 空の行: 何も無い行は「\\\\ \\\\」になって LaTeX のエラーになるので、見えない空白（~）を置いて 1 行あける
        out.append((ln if ln.strip() else "~") + (" \\\\" if brk else ""))
    return "\n".join(out)


def boolean_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw = style_kwargs(e)
    if e["dashed"]:
        kw.update(dashed=True, dash_length=e["dashLength"])
    return kw


def samplespace_kwargs(e: dict[str, Any], font_scale: float = 1.0) -> dict[str, Any]:
    kw: dict[str, Any] = {"width": _u(e["width"]), "height": _u(e["height"])}
    if e["split"] != "columns":
        kw["split"] = e["split"]
    kw["parts"] = [(_num(q["p"]), q["color"], math_label(q["label"]),
                    [(_num(r["p"]), r["color"], math_label(r["label"])) for r in q["sub"]]) for q in e["parts"]]
    if e["title"].strip():
        kw["title"] = e["title"]
    kw.update(label_size=round(e["labelSize"] * font_scale, 2), label_color=e["labelColor"], stroke_color=e["stroke"]["color"],
              stroke_width=e["stroke"]["width"], opacity=e["fill"]["opacity"])
    return kw


NET_LAYOUTS = ("kamada_kawai", "spring", "circular", "shell", "planar", "spectral", "spiral", "tree", "partite", "random", "manual")


def normalize_netgraph(e: dict[str, Any], st: dict[str, Any], fi: dict[str, Any], settings: dict[str, Any]) -> None:
    """グラフ理論のグラフ（頂点と辺）。頂点の名前は空でなく、重ならないもの。辺は頂点の名前の組（自分への辺は除く）。"""
    e["directed"] = bool(e.get("directed", False))
    verts, seen = [], set()
    for v in (e.get("vertices") if isinstance(e.get("vertices"), list) else [])[:100]:
        v = v if isinstance(v, dict) else {"name": v}
        name = str(v.get("name") if v.get("name") is not None else "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        verts.append({"name": name, "group": int(_f(v.get("group"), 0, 0, 99)), "color": _color(v.get("color"), None)})
    if not verts:
        verts = [{"name": n, "group": g, "color": None} for n, g in (("A", 0), ("B", 0), ("C", 1), ("D", 1), ("E", 1))]
    e["vertices"] = verts
    names = {v["name"] for v in verts}
    edges = []
    for ed in (e.get("edges") if isinstance(e.get("edges"), list) else [])[:400]:
        if isinstance(ed, (list, tuple)) and len(ed) >= 2:
            a, b = str(ed[0]).strip(), str(ed[1]).strip()
            if a in names and b in names and a != b:
                edges.append([a, b])
    if not edges and e.get("edges") is None:
        edges = [[a, b] for a, b in (("A", "B"), ("B", "C"), ("C", "A"), ("C", "D"), ("D", "E"))]
    e["edges"] = edges
    e["layout"] = e.get("layout") if e.get("layout") in NET_LAYOUTS else "kamada_kawai"
    e["layoutScale"] = _f(e.get("layoutScale"), 2.0, 0.1, 20)
    e["seed"] = int(_f(e.get("seed"), 1, 0, 99999))
    e["root"] = str(e.get("root") or "") if str(e.get("root") or "") in names else verts[0]["name"]
    pos = e.get("positions") if isinstance(e.get("positions"), dict) else {}
    e["positions"] = {str(k): [round(_f(p[0], 0.0), 3), round(_f(p[1], 0.0), 3)]
                      for k, p in pos.items() if str(k) in names and isinstance(p, (list, tuple)) and len(p) >= 2}
    e["showLabels"] = bool(e.get("showLabels", True))
    e["labelSize"] = _f(e.get("labelSize"), 30, 4, 200)
    e["labelColor"] = _color(e.get("labelColor"), "#000000")
    e["vertexRadius"] = _f(e.get("vertexRadius"), 0.15, 0.01, 5)
    e["tipSize"] = _f(e.get("tipSize"), 0.2, 0.02, 3)
    e["fill"]["color"] = _color(fi.get("color"), "#58C4DD")
    e["stroke"]["width"] = _f(st.get("width"), 3.0, 0, 50)
    e["rotation"] = 0.0


def netgraph_kwargs(e: dict[str, Any], font_scale: float = 1.0) -> tuple[list[str], list[tuple[str, str]], dict[str, Any]]:
    """(頂点の名前, 辺, gui_netgraph のほかの引数)。"""
    names = [v["name"] for v in e["vertices"]]
    edges = [(a, b) for a, b in e["edges"]]
    kw: dict[str, Any] = {}
    if e["directed"]:
        kw["directed"] = True
    kw["layout"] = e["layout"]
    if e["layout"] == "manual":
        kw["positions"] = {n: tuple(e["positions"].get(n, (0, 0))) for n in names}
    else:
        kw["layout_scale"] = e["layoutScale"]
    if e["layout"] in ("spring", "random"):
        kw["seed"] = e["seed"]
    if e["layout"] == "tree":
        kw["root"] = e["root"]
    if e["layout"] in ("partite", "shell"):
        kw["groups"] = [v["group"] for v in e["vertices"]]
    if e["showLabels"]:
        kw.update(labels=[math_label(n) for n in names], label_size=round(e["labelSize"] * font_scale, 2), label_color=e["labelColor"])
    kw.update(vertex_radius=e["vertexRadius"], vertex_color=e["fill"]["color"])
    if any(v["color"] for v in e["vertices"]):
        kw["vertex_colors"] = [v["color"] for v in e["vertices"]]
    kw.update(edge_color=e["stroke"]["color"], edge_width=e["stroke"]["width"])
    if e["directed"]:
        kw["tip_size"] = e["tipSize"]
    return names, edges, kw


def annot_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_annot の引数（kind と target 以外）。"""
    ak = e["annotKind"]
    if ak == "bg":
        return {"fill_color": e["fill"]["color"], "fill_opacity": e["fill"]["opacity"], "buff": e["buff"]}
    if ak == "animated":
        kw0: dict[str, Any] = {"colors": list(e["colors"]), "stroke_width": e["stroke"]["width"]}
        if e["cycleRate"] != 0.5:
            kw0["cycle_rate"] = e["cycleRate"]
        return kw0
    kw: dict[str, Any] = {"color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"]}
    if ak == "cross":
        if e["scaleFactor"] != 1:
            kw["scale_factor"] = e["scaleFactor"]
        return kw
    kw["buff"] = e["buff"]
    if ak == "box":
        if e["cornerRadius"]:
            kw["corner_radius"] = e["cornerRadius"]
        if e["fill"]["opacity"] > 0:
            kw.update(fill_color=e["fill"]["color"] or e["stroke"]["color"], fill_opacity=e["fill"]["opacity"])
    return kw


def arcbrace_kwargs(e: dict[str, Any], arc: dict[str, Any], font_scale: float = 1.0) -> dict[str, Any]:
    """gui_arcbrace の半径・角度などの引数（中心は呼び出し側で）。arc は付ける円弧の要素。"""
    kw: dict[str, Any] = {"radius": _u(arc["radius"]), "start_angle": round(arc["startAngle"] + float(arc.get("rotation") or 0), 3),
                          "angle": arc["angle"]}
    if not e["outside"]:
        kw["outside"] = False
    kw["color"] = e["stroke"]["color"]
    kw.update(_label_kwargs(e, font_scale))
    return kw


def vector_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {"color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"], "tip_length": e["tipSize"]}
    if e["coords"]:
        kw.update(coords=True, coord_size=e["coordSize"])
    return kw


def linegraph_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {"color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"]}
    if not e["dots"]:
        kw["dots"] = False
    else:
        kw["dot_radius"] = e["dotRadius"]
        if e["dotColor"]:
            kw["dot_color"] = e["dotColor"]
    return kw


def points_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_points の引数（座標軸は別）。式（f）は Python の式に直す（ode は x, y、積分は x）。"""
    from .latexexpr import to_python  # noqa: PLC0415
    src = e["source"]
    pr = e["params"]
    keep = {"ode": ("x0", "y0", "x1", "h", "method"), "integral": ("a", "b", "n", "rule"), "montecarlo": ("n", "seed"),
            "trials": ("n", "seed", "kind"), "code": ("seed",)}[src]
    params: dict[str, Any] = {k: pr[k] for k in keep}
    if src in ("ode", "integral"):
        params["f"] = to_python(pr["f"], pr["lang"], ("x", "y") if src == "ode" else ("x",))
    kw: dict[str, Any] = {"source": src, "params": params}
    if src == "code":
        kw["code"] = e["code"]
    kw.update(style=e["style"], color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    if src == "montecarlo":
        kw["color2"] = e["color2"]
    if e["style"] == "scatter" or src == "montecarlo":
        kw["dot_radius"] = e["dotRadius"]
    if e["style"] == "bars" or src == "integral":
        kw["fill_opacity"] = e["fill"]["opacity"]
    return kw


def fcurve_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_fcurve の引数（kind と式は別）。"""
    kw: dict[str, Any] = {}
    if e["curveKind"] == "parametric":
        kw["t_range"] = (e["tMin"], e["tMax"])
    else:
        kw.update(x_range=(e["xMin"], e["xMax"]), y_range=(e["yMin"], e["yMax"]))
    if e["scale"] != 1.0:
        kw["scale"] = e["scale"]
    kw.update(color=e["stroke"]["color"], stroke_width=e["stroke"]["width"])
    if e["dashed"]:
        kw.update(dashed=True, dash_length=e["dashLength"])
    if e.get("gradient"):
        kw["gradient"] = e["gradient"]
    return kw


TANGENT_TARGETS = ("line", "rect", "ellipse", "polygon", "star", "arc", "path", "annulus", "elbow", "graph", "curve2d", "implicit",
                   "fcurve", "linegraph", "boolean")


def tangent_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_tangent の引数（付ける曲線と alpha は別）。"""
    kw: dict[str, Any] = {"length": e["length"], "color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"]}
    if not e["dot"]:
        kw["dot"] = False
    return kw


def zoom_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    """gui_zoom の引数（scene は最初の引数）。"""
    to = lambda x, y: (round((x - CANVAS_H * 16 / 18) / PX, 3), round((CANVAS_H / 2 - y) / PX, 3))  # noqa: E731 — キャンバスの px → Manim
    kw: dict[str, Any] = {"frame": to(e["frameX"], e["frameY"]), "center": to(e["x"], e["y"]),
                          "width": round(e["width"] / PX, 3), "height": round(e["height"] / PX, 3), "factor": e["factor"],
                          "color": e["stroke"]["color"]}
    if e["displayColor"]:
        kw["display_color"] = e["displayColor"]
    if e["stroke"]["width"] != 3.0:
        kw["stroke_width"] = e["stroke"]["width"]
    if not e.get("visibleAtStart", True):
        kw["active"] = False
    return kw


def trace_kwargs(e: dict[str, Any]) -> dict[str, Any]:
    kw: dict[str, Any] = {"color": e["stroke"]["color"], "stroke_width": e["stroke"]["width"]}
    if e["dissipating"] > 0:
        kw["dissipating"] = e["dissipating"]
    return kw
