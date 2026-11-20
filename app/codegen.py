"""GUI の内容から Manim Slides の .py と、行番号の対応表（.map.json）を生成する。"""

from __future__ import annotations

import builtins
import json
import keyword
import re
import textwrap
from pathlib import Path
from typing import Any

from . import projfonts, tikzfix
from .texcolor import colorize
from .constants import CANVAS_H, CANVAS_W, JP_FIXED_PREAMBLE, JP_TAIL_PREAMBLE, MANIM_FRAME_H, MANIM_FRAME_W, tex_font_lines
from .mathalign import math_layout
from .latexexpr import PY_NAMES, ExprError, to_python, used_names
from .statmodel import statchart_args
from .shapemodel import (SHAPES_3D, axdot_kwargs, axes3d_kwargs, axes_kwargs, balloon_kwargs, brace_kwargs, curve3d_kwargs,
                         field_kwargs, graph_kwargs, number_kwargs, point3d_exprs, point3d_kwargs, shape_kwargs, solid_kwargs, surface_kwargs,
                         svg_kwargs, table_kwargs, table_uses_math, matrix_kwargs, angle_kwargs, graphpart_kwargs,
                         curve2d_kwargs, implicit_python, polar_kwargs, complex_kwargs, code_kwargs, barchart_kwargs,
                         barchart_uses_tex, tex_body, boolean_kwargs, BOOLEAN_OPERANDS, samplespace_kwargs, netgraph_kwargs,
                         annot_kwargs, arcbrace_kwargs, vector_kwargs, linegraph_kwargs, trace_kwargs,
                         table_item_ids, cell_item_ok, zoom_kwargs, fcurve_kwargs, tangent_kwargs, TANGENT_TARGETS, theorem_args, points_kwargs, pname_auto_dir)
from . import animgen
from .textmodel import gui_text_kwargs, normalize_runs

TEXTKIT_SOURCE = Path(__file__).with_name("textkit.py")
SHAPEKIT_SOURCE = Path(__file__).with_name("shapekit.py")

INDENT = " " * 8
_RESERVED_VARS = {"self", "tpl", "config", "np", "gui_text", "gui_layer", "gui_image", "gui_shape", "gui_balloon",
                  "gui_balloon_shape", "gui_axes", "gui_graph", "gui_brace", "gui_func", "gui_table", "gui_field",
                  "gui_number", "gui_axdot", "gui_redraw", "x", "y", "gui_solid", "gui_axes3d", "gui_surface",
                  "gui_curve3d", "gui_point3d", "gui_fix", "gui_svg",
                  "gui_matrix", "gui_angle", "gui_area", "gui_riemann", "gui_tangent", "gui_secant", "gui_curve2d", "gui_implicit",
                  "gui_polar", "theta", "gui_complex_curve", "i", "gui_code", "gui_barchart", "gui_statchart", "gui_quartiles", "gui_linear_fit", "gui_hist_bins", "GuiStatAxes", "gui_lagged", "gui_always", "gui_always_stop", "gui_count", "gui_code_highlight", "gui_create_then_fade", "gui_match_transform", "gui_speed", "gui_speed_total", "gui_phase_flow", "gui_image_mask", "gui_outline", "gui_title", "gui_bullets", "gui_theorem", "gui_points", "gui_compute",
                  "gui_boolean", "gui_detach", "gui_zoom", "gui_zoom_off", "gui_frame_image", "gui_transition", "gui_media", "gui_media_live", "gui_media_bake", "gui_media_flush", "gui_media_slide_end", "gui_at", "gui_start", "gui_type", "gui_fn_xy", "gui_blink", "gui_subsets", "gui_restore", "gui_stack", "gui_move", "gui_scale", "gui_rotate", "gui_color", "gui_opacity", "gui_path", "gui_along", "gui_fcurve", "gui_tangent", "gui_linear", "gui_apply_matrix", "gui_psurface", "gui_sample_space", "gui_netgraph", "gui_annot", "gui_arcbrace", "gui_vector", "gui_page_number", "gui_section_mark", "gui_derived", "gui_graph_label",
                  "gui_t_label", "gui_line_graph", "gui_trace"}


class ExportError(Exception):
    def __init__(self, problems: list[dict[str, Any]]):
        super().__init__("書き出し前の検査でエラーが見つかりました。")
        self.problems = problems


# ---------------------------------------------------------------- 変換の補助

def to_manim_xy(x: float, y: float) -> tuple[float, float]:
    mx = (x - CANVAS_W / 2) / CANVAS_W * MANIM_FRAME_W
    my = (CANVAS_H / 2 - y) / CANVAS_H * MANIM_FRAME_H
    return round(mx, 3), round(my, 3)


def _fmt_num(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def py_str(s: str) -> str:
    """Python の文字列リテラル。LaTeX など \\ を含むものは、可能なら r"..." にする。"""
    if "\\" in s and '"' not in s and "\n" not in s and not s.endswith("\\") and "\r" not in s:
        return 'r"' + s + '"'
    return json.dumps(s, ensure_ascii=False)


def font_size_of(el: dict[str, Any], settings: dict[str, Any]) -> float:
    scale = float(settings.get("fontSizeScale") or 1.0)
    return round(float(el.get("fontSize") or settings["defaultFontSize"]) * scale, 2)


def _color(c: str | None, fallback: str) -> str:
    c = (c or fallback or "#000000").strip()
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", c):
        c = fallback
    return c.upper()


# ---------------------------------------------------------------- 検査

def _gui_row_problem(r: dict[str, Any], slide: dict[str, Any], ids_here: set, use3d: bool) -> str | None:
    """GUI の動きの行の、対象・引数の問題（無ければ None）。"""
    spec = animgen.CATALOG_BY_ID.get(r.get("anim"))
    if spec is None:
        return "動きの種類が分かりません。"
    kind, tg = spec["target"], r.get("target") or ""
    el = next((e for e in slide["elements"] if e.get("id") == tg), None)
    if kind == "element":
        if tg not in ids_here:
            return "動きの対象が見つかりません（要素を消した可能性があります）。"
        if el is not None and (el.get("type") == "media" or el.get("shape") == "zoom"):
            return "動画・音声やズームの要素は、この動きには使えません（「動画・音声」「ズーム」の動きを使ってください）。"
        only = spec.get("only")
        if only and not (el is not None and (el.get("shape") in only or el.get("type") in only)):
            names = {"barchart": "棒グラフ（BarChart）", "netgraph": "グラフ（頂点と辺）", "code": "コード", "number": "数値"}
            return f"「{spec['label']}」は、{'・'.join(names.get(o, o) for o in only)}の要素にだけ使えます。"
        if r.get("anim") == "BarValues" and el is not None:
            vals = str((r.get("params") or {}).get("values") or "")
            try:
                n = len(eval("[" + vals + "]", {"__builtins__": {}}, {}))  # noqa: S307 — 数の並びを数えるだけ
            except Exception:  # noqa: BLE001
                n = None
            if n is not None and n != len(el.get("bars") or []):
                return f"棒の値を {len(el.get('bars') or [])} 個（棒の数だけ）書いてください（今は {n} 個）。"
    elif kind == "value":
        if not tg.startswith("v:") or tg[2:] not in {v.get("name") for v in slide.get("values", [])}:
            return "値が見つかりません（スライドの値を消したか、名前を変えた可能性があります）。"
    elif kind == "camera":
        if use3d:
            return "3D のプロジェクトでは、この「カメラ」の動きは使えません（「3D のカメラ」の動きを使ってください）。"
    elif kind == "camera3d":
        if not use3d:
            return "「3D のカメラ」の動きは、3D のプロジェクトだけで使えます（2D のスライドは「カメラ」の動きを使ってください）。"
    elif kind == "media" and not (el and el.get("type") == "media"):
        return "動画・音声の要素が見つかりません。"
    elif kind == "zoom" and not (el and el.get("shape") == "zoom"):
        return "ズームの要素が見つかりません。"
    elif kind == "linear" and not (el and el.get("shape") == "axes" and el.get("linear")):
        return "線形変換の平面が見つかりません（座標平面の「線形変換の平面にする」をオンにしてください）。"
    p = r.get("params") or {}
    for q in spec.get("params", []):
        v = p.get(q["key"])
        if q["type"] == "elem":
            need = (r["anim"] in ("MoveAlongPath", "ReplacementTransform", "TransformMatchingShapes", "FadeTransform", "TransformFromCopy", "MatchTransform",
                                  "Swap", "AlwaysFollow")) \
                or (r["anim"] == "CamMove" and p.get("mode") == "elem") \
                or (r["anim"] == "PhaseFlow" and p.get("source", "field") == "field")
            if need and v not in ids_here:
                return f"「{q['label']}」の要素を選んでください。"
            if need and v == tg:
                return f"「{q['label']}」に、動かす要素そのものは選べません。"
            if need and q.get("elemOnly"):
                fe = next((e for e in slide["elements"] if e["id"] == v), None)
                if not fe or fe.get("shape", fe.get("type")) not in q["elemOnly"]:
                    return f"「{q['label']}」には、ベクトル場（矢印・流線）の要素を選んでください。"
        elif q["type"] == "expr":
            if r["anim"] == "CodeHighlight" or (r["anim"] == "Cam3dMove" and not str(v or "").strip()):
                continue  # 行の番号（「2-4」など）・空欄（今のまま）は式ではない
            try:
                compile(str(v or "") if r["anim"] != "BarValues" else "[" + str(v or "") + "]", "<式>", "eval")
            except SyntaxError:
                return f"「{q['label']}」の式 {v!r} が Python の式として読めません。"
    return None


def validate(project: dict[str, Any]) -> list[dict[str, Any]]:
    """変数名の重複・不正などを調べる。問題が無ければ空のリスト。"""
    problems: list[dict[str, Any]] = []
    seen: dict[str, tuple[int, str]] = {}
    builtin_names = set(dir(builtins))
    all_vars = {(e.get("var") or "").strip() for sl in project["slides"] for e in sl["elements"]} | \
        {(g.get("var") or "").strip() for sl in project["slides"] for g in sl.get("groups", [])}
    for si, slide in enumerate(project["slides"]):
        vnames = tuple(v["name"] for v in slide.get("values", []) if v.get("name"))
        # GUI のステップの動きの行: 対象が見つからないもの
        ids_here = {e.get("id") for e in slide["elements"]} | {g.get("id") for g in slide.get("groups", [])}
        # 部品: プロジェクトに中身（写し）があること
        known_parts = set(parts_of(project))
        for e in slide["elements"]:
            if e.get("type") == "shape" and e.get("shape") == "part" and e.get("partId") not in known_parts:
                problems.append({"slideIndex": si, "elementId": e.get("id"), "var": e.get("var"),
                                 "message": f"スライド{si + 1}: 部品「{e.get('partName') or e.get('var')}」の中身が見つかりません（部品のテンプレートを消したか、別のパソコンから持ってきたスライドです）。"})
        # 画像の切り抜きの型: 同じスライドの、形のある要素であること
        for e in slide["elements"]:
            mk = e.get("mask") or {}
            if e.get("type") == "image" and mk.get("id"):
                t = next((x for x in slide["elements"] if x.get("id") == mk["id"]), None)
                if t is None:
                    problems.append({"slideIndex": si, "elementId": e["id"], "var": e.get("var", ""),
                                     "message": f"スライド{si + 1}: 画像「{e.get('var')}」の切り抜きの型にした要素が、このスライドにありません（消したか、別のスライドへ移しました）。画像のパネルで選び直してください。"})
                elif t.get("type") in ("image", "media") or t.get("shape") == "zoom":
                    problems.append({"slideIndex": si, "elementId": e["id"], "var": e.get("var", ""),
                                     "message": f"スライド{si + 1}: 画像「{e.get('var')}」の切り抜きの型には、図形・文字・数式などの形のある要素を選んでください。"})
        for k, st in enumerate(slide.get("steps", []), start=1):
            if st.get("loop") and st.get("autoNext"):
                problems.append({"slideIndex": si, "elementId": None, "var": "",
                                 "message": f"スライド{si + 1}: ステップ {k} に「くり返す」と「終わったら自動で次へ」の両方が付いています（くり返すステップは終わらないので、どちらか一方にしてください）。"})
            if st.get("mode") != "gui":
                continue
            for n, r in enumerate(st.get("rows") or [], start=1):
                bad = _gui_row_problem(r, slide, ids_here, bool(project["settings"].get("use3d"))) if r.get("kind") == "anim" else None
                if bad:
                    problems.append({"slideIndex": si, "elementId": None, "var": "",
                                     "message": f"スライド{si + 1}: ステップ {k} の {n} 行目: {bad}"})
                elif r.get("kind") == "anim" and r.get("rate") in animgen.RETURNING_RATES and animgen.CATALOG_BY_ID.get(r.get("anim"), {}).get("group") in ("in", "out"):
                    label = animgen.CATALOG_BY_ID[r["anim"]]["label"]
                    rl = dict(animgen.RATE_FUNCS)[r["rate"]]
                    problems.append({"slideIndex": si, "elementId": r.get("target"), "var": "",
                                     "message": f"スライド{si + 1}: ステップ {k} の {n} 行目の「{label}」に、緩急「{rl}」は使えません（終わりに始めの状態へ戻るので、出したものが消えたまま・消したものが残ったままになります）。"})
                elif r.get("kind") == "anim" and r.get("anim") in animgen.VEC_ONLY:
                    tid = r.get("target")
                    has_img = any(e.get("type") in ("image", "media") and (e.get("id") == tid or e.get("groupId") == tid) for e in slide["elements"])
                    if has_img:
                        label = animgen.CATALOG_BY_ID[r["anim"]]["label"]
                        problems.append({"slideIndex": si, "elementId": tid, "var": "",
                                         "message": f"スライド{si + 1}: ステップ {k} の {n} 行目の「{label}」は、画像（や画像を含むグループ）には使えません（フェードイン・フェードアウトなどにしてください）。"})
        # 同じ時刻に同じ要素（グループとその中の要素も）を動かす行: Manim では後の動きが前の動きを上書きする
        gid_of = {e.get("id"): e.get("groupId") for e in slide["elements"]}
        name_of = {**{e.get("id"): e.get("var") for e in slide["elements"]}, **{g.get("id"): g.get("var") for g in slide.get("groups", [])}}
        related = lambda a, b: a == b or gid_of.get(a) == b or gid_of.get(b) == a  # noqa: E731
        for k, st in enumerate(slide.get("steps", []), start=1):
            if st.get("mode") != "gui":
                continue
            rows = st.get("rows") or []
            for a, b in animgen.overlapping_same_target(st, related):
                problems.append({"slideIndex": si, "elementId": b.get("target"), "var": "",
                                 "message": f"スライド{si + 1}: ステップ {k} の {rows.index(a) + 1} 行目と {rows.index(b) + 1} 行目は、"
                                            f"同じ時間に「{name_of.get(b.get('target'), '?')}」を出す・消す動きです。出す・消す動きは同じ要素に同時に 2 つ使えないので、"
                                            "あとの行の始まりを「前の後に」にしてください（強調なら、出す・消す動きと同時にできます）。"})
        seen_v: set[str] = set()
        for v in slide.get("values", []):
            name = v.get("name") or ""
            where = {"slideIndex": si, "elementId": None, "var": name}
            if not name:
                problems.append({**where, "message": f"スライド{si + 1}: 名前が空の値があります。"})
            elif not name.isidentifier() or not name.isascii() or keyword.iskeyword(name):
                problems.append({**where, "message": f"スライド{si + 1}: 値の名前「{name}」は Python の変数名として使えません（半角英数字と _）。"})
            elif name in _RESERVED_VARS or name in PY_NAMES or name in builtin_names or name.startswith("_gui"):
                problems.append({**where, "message": f"スライド{si + 1}: 値の名前「{name}」は、関数や x・y などと重なるため使えません。"})
            elif name in all_vars:
                problems.append({**where, "message": f"スライド{si + 1}: 値の名前「{name}」が、要素の変数名と重なっています。"})
            elif name in seen_v:
                problems.append({**where, "message": f"スライド{si + 1}: 値の名前「{name}」が重複しています。"})
            seen_v.add(name)
        named = list(slide["elements"]) + [{"id": g["id"], "var": g.get("var"), "type": "group"} for g in slide.get("groups", [])]
        for el in named:
            var = (el.get("var") or "").strip()
            where = {"slideIndex": si, "elementId": el.get("id"), "var": var}
            if not var:
                problems.append({**where, "message": f"スライド{si + 1}: 変数名が空の要素があります。"})
                continue
            if not var.isidentifier() or not var.isascii():
                problems.append({**where, "message": f"スライド{si + 1}: 変数名「{var}」は Python の識別子として使えません（半角英数字と _ のみ、先頭は数字以外）。"})
            elif keyword.iskeyword(var):
                problems.append({**where, "message": f"スライド{si + 1}: 変数名「{var}」は Python の予約語です。"})
            elif var in _RESERVED_VARS or var.startswith("_gui"):
                problems.append({**where, "message": f"スライド{si + 1}: 変数名「{var}」はアプリが使う名前のため使えません。"})
            elif var in builtin_names:
                problems.append({**where, "message": f"スライド{si + 1}: 変数名「{var}」は Python の組み込み名と重なります。"})
            elif var[:1].isupper() and var in _manim_names():
                problems.append({**where, "message": f"スライド{si + 1}: 変数名「{var}」は Manim のクラス名と重なります。"})
            if var in seen:
                psi, _ = seen[var]
                problems.append({**where, "message": f"変数名「{var}」が重複しています（スライド{psi + 1} とスライド{si + 1}）。変数名はプロジェクト全体で一意にしてください。"})
            else:
                seen[var] = (si, el.get("id"))
            if el.get("type") == "shape" and el.get("shape") == "graph":
                ids = {e.get("id") for e in slide["elements"]}
                if el.get("axesId") not in ids:
                    problems.append({**where, "message": f"スライド{si + 1}: グラフ「{var}」の座標軸が見つかりません。"})
                gax = next((e for e in slide["elements"] if e.get("id") == el.get("axesId")), {})
                gvars = ("theta",) if gax.get("axesKind") == "polar" else ("t", "x", "i") if (gax.get("axesKind") == "complex" and el.get("complexCurve")) else ("x",)
                try:
                    to_python(el.get("expr", ""), el.get("lang", "latex"), (*gvars, *(v for v in vnames if v not in gvars)))
                except ExprError as e:
                    problems.append({**where, "message": f"スライド{si + 1}: グラフ「{var}」の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "field":
                if el.get("axesId") and el.get("axesId") not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: ベクトル場「{var}」の座標軸が見つかりません。"})
                for k, name in (("fx", "x 成分"), ("fy", "y 成分")):
                    try:
                        to_python(el.get(k, ""), el.get("lang", "latex"), ("x", "y", *vnames))
                    except ExprError as e:
                        problems.append({**where, "message": f"スライド{si + 1}: ベクトル場「{var}」の{name}の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") in SHAPES_3D:
                if not project["settings"].get("use3d"):
                    problems.append({**where, "message": f"スライド{si + 1}: 3D の要素「{var}」があります。プロジェクト設定で「3D を使う」をオンにしてください。"})
                ids = {e.get("id") for e in slide["elements"]}
                if el["shape"] in ("surface", "curve3d") and el.get("axesId") not in ids:
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の 3D の座標軸が見つかりません。"})
                if el["shape"] == "point3d" and el.get("axesId") and el["axesId"] not in ids:
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の 3D の座標軸が見つかりません。"})
                if el["shape"] == "point3d":
                    for x in point3d_exprs(el):
                        try:
                            to_python(x, el.get("lang", "latex"), vnames)
                        except ExprError as e:
                            problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の座標の式「{x}」: {e}"})
                if el["shape"] == "solid" and el.get("solidKind") == "polyhedron" and not el.get("faces"):
                    problems.append({**where, "message": f"スライド{si + 1}: 多面体「{var}」の面がありません（面は頂点の番号を 3 つ以上並べます）。"})
                if el["shape"] == "solid" and el.get("solidKind") == "hull" and len(el.get("vertices") or []) < 4:
                    problems.append({**where, "message": f"スライド{si + 1}: 凸包「{var}」の点は 4 つ以上必要です。"})
                exprs = [(k, ("u", "v")) for k in ("xExpr", "yExpr", "zExpr")] if (el["shape"] == "surface" and el.get("surfKind") == "param") else \
                    [("expr", ("x", "y"))] if el["shape"] == "surface" else \
                    [(k, ("t",)) for k in ("xExpr", "yExpr", "zExpr")] if el["shape"] == "curve3d" else []
                for k, base in exprs:
                    try:
                        to_python(el.get(k, ""), el.get("lang", "latex"), (*base, *(v for v in vnames if v not in base)))
                    except ExprError as e:
                        problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "angle":
                byid = {e.get("id"): e for e in slide["elements"]}
                for lid in (el.get("line1Id"), el.get("line2Id")):
                    if (byid.get(lid) or {}).get("shape") != "line":
                        problems.append({**where, "message": f"スライド{si + 1}: 角「{var}」を付ける線が見つかりません。"})
                        break
                    if (byid.get(lid) or {}).get("arcAngle"):
                        problems.append({**where, "message": f"スライド{si + 1}: 角「{var}」を付ける線「{byid[lid].get('var')}」が曲がっています。角は真っすぐな線にだけ付けられます。"})
                        break
            if el.get("type") == "shape" and el.get("shape") == "annot":
                byid = {e.get("id"): e for e in slide["elements"]}
                tgt = byid.get(el.get("targetId"))
                if tgt is None:
                    problems.append({**where, "message": f"スライド{si + 1}: 注釈「{var}」を付ける要素が見つかりません。"})
                elif el.get("annotKind") == "arcbrace" and tgt.get("shape") != "arc":
                    problems.append({**where, "message": f"スライド{si + 1}: 円弧の中かっこ「{var}」は、円弧にだけ付けられます。"})
            if el.get("type") == "media" and el.get("mode") == "bake" and el.get("kind") == "audio" and el.get("across"):
                problems.append({**where, "message": f"スライド{si + 1}: 「{var}」: 動画に焼き込む音声は、スライドをまたいで再生できません（クリックの区切りで止まります）。「発表で再生」にしてください。"})
            if el.get("type") == "shape" and el.get("shape") == "tangent":
                t = next((e for e in slide["elements"] if e.get("id") == el.get("targetId")), None)
                if t is None:
                    problems.append({**where, "message": f"スライド{si + 1}: 接線「{var}」を引く曲線が見つかりません。"})
                elif t.get("type") != "shape" or t.get("shape") not in TANGENT_TARGETS:
                    problems.append({**where, "message": f"スライド{si + 1}: 「{t.get('var')}」には接線を引けません（線・図形・パス・グラフ・曲線に引けます）。"})
                if isinstance(el.get("alpha"), str):
                    try:
                        to_python(el["alpha"], "latex", vnames)
                    except ExprError as e:
                        problems.append({**where, "message": f"スライド{si + 1}: 接線「{var}」の位置「{el['alpha']}」: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "fcurve":
                try:
                    if el.get("curveKind") == "parametric":
                        for q in ("xExpr", "yExpr"):
                            to_python(el.get(q, ""), el.get("lang", "latex"), ("t", *(v for v in vnames if v != "t")))
                    elif el.get("curveKind") == "implicit":
                        implicit_python(el.get("expr", ""), el.get("lang", "latex"), ("x", "y", *(v for v in vnames if v not in ("x", "y"))), to_python)
                    else:
                        to_python(el.get("expr", ""), el.get("lang", "latex"), ("x", *vnames))
                except ExprError as e:
                    problems.append({**where, "message": f"スライド{si + 1}: 曲線「{var}」の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") in ("graphpart", "curve2d", "implicit", "field", "vector"):
                byid = {e.get("id"): e for e in slide["elements"]}
                ax = byid.get(el.get("axesId")) or byid.get((byid.get(el.get("graphId")) or {}).get("axesId"))
                if ax and (ax.get("xLog") or ax.get("yLog")) and not (el.get("shape") == "graphpart" and el.get("partKind") == "glabel"):
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」は、対数目盛りの座標軸では使えません（使えるのは、グラフ・点・折れ線グラフ・グラフのラベル）。"})
            if el.get("type") == "shape" and el.get("shape") == "zoom":
                if project["settings"].get("use3d"):
                    problems.append({**where, "message": f"スライド{si + 1}: ズーム「{var}」は、3D を使うプロジェクトでは使えません。"})
                if sum(1 for e in slide["elements"] if e.get("type") == "shape" and e.get("shape") == "zoom") > 1:
                    problems.append({**where, "message": f"スライド{si + 1}: ズームは 1 つのスライドに 1 つまでです（Manim のズームのカメラは 1 つ）。"})
            if el.get("type") == "shape" and el.get("shape") in ("table", "matrix") and table_item_ids(el):
                byid = {e.get("id"): e for e in slide["elements"]}
                seen = cell_containers(slide["elements"])
                for iid in table_item_ids(el):
                    it = byid.get(iid)
                    if it is None:
                        problems.append({**where, "message": f"スライド{si + 1}: 「{var}」のセルに入れた要素が見つかりません。"})
                    elif not cell_item_ok(it):
                        problems.append({**where, "message": f"スライド{si + 1}: 「{it.get('var')}」は表・行列のセルに入れられません（入れられるのはテキスト・数式・図形）。"})
                    elif seen.get(iid) != el.get("id") or table_item_ids(el).count(iid) > 1:
                        problems.append({**where, "message": f"スライド{si + 1}: 「{it.get('var')}」が、2 つ以上のセルに入っています。"})
            if el.get("type") == "shape" and el.get("shape") == "trace" and el.get("targetId") not in {e.get("id") for e in slide["elements"]}:
                problems.append({**where, "message": f"スライド{si + 1}: 軌跡「{var}」をたどる要素が見つかりません。"})
            if el.get("type") == "shape" and el.get("shape") == "points":
                if el.get("axesId") not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: 計算した点列「{var}」の座標軸が見つかりません。"})
                try:
                    points_kwargs(el)
                except ExprError as ex:
                    problems.append({**where, "message": f"スライド{si + 1}: 計算した点列「{var}」の式を読めません: {ex}"})
            if el.get("type") == "shape" and el.get("shape") == "linegraph" and el.get("axesId") not in {e.get("id") for e in slide["elements"]}:
                problems.append({**where, "message": f"スライド{si + 1}: 折れ線グラフ「{var}」の座標軸が見つかりません。"})
            if el.get("type") == "shape" and el.get("shape") == "vector":
                if el.get("axesId") and el["axesId"] not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: ベクトル「{var}」の座標軸が見つかりません。"})
                for k in ("xExpr", "yExpr", "x0Expr", "y0Expr"):
                    try:
                        to_python(el.get(k, "0"), el.get("lang", "latex"), vnames)
                    except ExprError as e:
                        problems.append({**where, "message": f"スライド{si + 1}: ベクトル「{var}」の式「{el.get(k)}」: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "netgraph" and el.get("layout") in ("tree", "planar"):
                import networkx as nx
                ng = nx.Graph()
                ng.add_nodes_from(v["name"] for v in el.get("vertices") or [])
                ng.add_edges_from(tuple(x) for x in el.get("edges") or [])
                if el["layout"] == "tree" and not nx.is_tree(ng):
                    problems.append({**where, "message": f"スライド{si + 1}: グラフ「{var}」は木ではないため、tree の配置にできません（閉路が無く、すべての頂点がつながったグラフにだけ使えます）。"})
                if el["layout"] == "planar" and not nx.check_planarity(ng)[0]:
                    problems.append({**where, "message": f"スライド{si + 1}: グラフ「{var}」は辺を交差させずに描けないため、planar の配置にできません。"})
            if el.get("type") == "shape" and el.get("shape") == "boolean":
                byid = {e.get("id"): e for e in slide["elements"]}
                ops = [byid.get(i) for i in (el.get("operandIds") or [])]
                need = 2
                if any(o is None for o in ops):
                    problems.append({**where, "message": f"スライド{si + 1}: 合成した図形「{var}」の元の図形が見つかりません。"})
                elif (el.get("op") in ("difference", "exclusion") and len(ops) != 2) or len(ops) < need:
                    problems.append({**where, "message": f"スライド{si + 1}: 合成した図形「{var}」の元の図形の数が合いません（切り抜き・重ならない部分は 2 つ、和・共通部分は 2 つ以上）。"})
                for o in ops:
                    if o is None:
                        continue
                    if o.get("type") != "shape" or o.get("shape") not in BOOLEAN_OPERANDS:
                        problems.append({**where, "message": f"スライド{si + 1}: 「{o.get('var')}」は図形の合成に使えません（使えるのは長方形・円・多角形・星・扇形・点・曲線・円環と、合成した図形）。"})
                    elif o.get("dashed"):
                        problems.append({**where, "message": f"スライド{si + 1}: 破線の図形「{o.get('var')}」は合成に使えません（合成した図形の方を破線にしてください）。"})
            if el.get("type") == "shape" and el.get("shape") == "graphpart":
                byid = {e.get("id"): e for e in slide["elements"]}
                if (byid.get(el.get("graphId")) or {}).get("shape") != "graph":
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」のグラフが見つかりません。"})
                for k in ("x0", "x1", "dx", "atX", "length"):
                    if isinstance(el.get(k), str):
                        try:
                            to_python(el[k], "latex", vnames)
                        except ExprError as e:
                            problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の値「{el[k]}」: {e}"})
            if el.get("type") == "shape" and el.get("shape") in ("curve2d", "implicit"):
                if el.get("axesId") not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の座標軸が見つかりません。"})
                try:
                    if el["shape"] == "curve2d":
                        for k in ("xExpr", "yExpr"):
                            to_python(el.get(k, ""), el.get("lang", "latex"), ("t", *(v for v in vnames if v != "t")))
                    else:
                        implicit_python(el.get("expr", ""), el.get("lang", "latex"), ("x", "y", *(v for v in vnames if v not in ("x", "y"))), to_python)
                except ExprError as e:
                    problems.append({**where, "message": f"スライド{si + 1}: 「{var}」の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "axdot":
                if el.get("axesId") not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: 座標の点「{var}」の座標軸が見つかりません。"})
                for k, name in (("xExpr", "x"), ("yExpr", "y")):
                    try:
                        to_python(el.get(k, ""), el.get("lang", "latex"), vnames)
                    except ExprError as e:
                        problems.append({**where, "message": f"スライド{si + 1}: 座標の点「{var}」の {name} の式: {e}"})
            if el.get("type") == "shape" and el.get("shape") == "number" and el.get("valueName") and el["valueName"] not in vnames:
                problems.append({**where, "message": f"スライド{si + 1}: 数値「{var}」の値「{el['valueName']}」が、このスライドの値にありません。"})
            if el.get("type") == "shape" and el.get("shape") == "brace" and el.get("mode") == "target":
                if el.get("targetId") not in {e.get("id") for e in slide["elements"]}:
                    problems.append({**where, "message": f"スライド{si + 1}: 中かっこ「{var}」を付ける要素が見つかりません。"})
            if el.get("type") == "math" and not (el.get("latex") or "").strip():
                problems.append({**where, "message": f"スライド{si + 1}: 数式「{var}」の LaTeX が空です。"})
    if project["settings"].get("use3d"):
        for si, slide in enumerate(project["slides"]):
            for k, st in enumerate(slide.get("steps", []), start=1):
                if "camera.frame" in (st.get("code") or ""):
                    problems.append({"slideIndex": si, "elementId": st.get("elementId"), "var": "",
                                     "message": f"スライド{si + 1} / ステップ{k}: 3D のプロジェクトでは self.camera.frame は使えません。"
                                                "self.move_camera(phi=60 * DEGREES, theta=-45 * DEGREES, zoom=1.2) のように動かします。"})
    return problems


_MANIM_NAMES: set[str] | None = None


def _manim_names() -> set[str]:
    """よく使う Manim のクラス名（manim を読み込まずに判定するための一覧）。"""
    global _MANIM_NAMES
    if _MANIM_NAMES is None:
        _MANIM_NAMES = {
            "Text", "MathTex", "Tex", "Write", "Create", "FadeIn", "FadeOut", "Transform", "ReplacementTransform",
            "Circle", "Square", "Rectangle", "Line", "Arrow", "Dot", "VGroup", "Group", "Indicate", "Scene",
            "Slide", "TexTemplate", "ImageMobject", "ValueTracker", "DecimalNumber", "MovingCameraScene", "Dot",
            "Sphere", "Cube", "Prism", "Cone", "Cylinder", "Torus", "ThreeDAxes", "Surface", "ThreeDSlide", "Dot3D", "Line3D", "Arrow3D", "ManimColor", "Axes", "NumberPlane", "Brace", "SurroundingRectangle",
            "Uncreate", "Unwrite", "GrowFromCenter", "Wiggle", "Circumscribe", "Flash", "MoveToTarget",
            "TransformMatchingTex", "TransformMatchingShapes", "AnimationGroup", "Succession", "LaggedStart",
            "Rotate", "Restore", "ApplyMethod", "Wait", "MarkupText", "Paragraph", "Code", "Table", "Matrix",
        }
    return _MANIM_NAMES


# ---------------------------------------------------------------- 生成

class _Writer:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.origins: dict[int, dict[str, Any]] = {}

    def add(self, text: str, origin: dict[str, Any] | None = None) -> None:
        for part in text.split("\n"):
            self.lines.append(part)
            if origin is not None:
                self.origins[len(self.lines)] = dict(origin)

    def add_code(self, code: str, origin: dict[str, Any]) -> None:
        """コード欄の内容を、インデントだけ construct 内に合わせて挿入する（構文は解釈しない）。"""
        code = code.replace("\r\n", "\n").replace("\t", "    ")
        code = textwrap.dedent(code).rstrip()
        raw_lines = code.split("\n") if code.strip() else []
        if not raw_lines:
            self.add(INDENT + "pass  # （コードが空のステップ）", {**origin, "codeLine": 1})
            return
        for n, line in enumerate(raw_lines, start=1):
            self.lines.append((INDENT + line) if line.strip() else "")
            self.origins[len(self.lines)] = {**origin, "codeLine": n}


def _py_val(v: Any) -> str:
    if isinstance(v, float):
        return _fmt_num(v)
    if isinstance(v, tuple):
        return "(" + ", ".join(_py_val(x) for x in v) + ")"
    if isinstance(v, list):
        return "[" + ", ".join(_py_val(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{py_str(str(k))}: {_py_val(x)}" for k, x in v.items()) + "}"
    return repr(v)


def balloon_expr(el: dict[str, Any], by_id: dict[str, Any]) -> str:
    """吹き出し: 中身の要素の実際の大きさから、箱を Manim の中で決める。"""
    items = []
    for cid in el.get("contentIds", []):
        c = by_id.get(cid)
        if not c:
            continue
        rot = float(c.get("rotation") or 0)
        if abs(rot) > 1e-9:
            # 回した中身は、回す前の外接矩形を回して測る（キャンバスと同じ）。回転の軸は要素の位置
            ax, ay = to_manim_xy(float(c.get("x", CANVAS_W / 2)), float(c.get("y", CANVAS_H / 2)))
            items.append(f"({c['var']}, {_fmt_num(rot)}, ({_fmt_num(ax)}, {_fmt_num(ay)}))")
        else:
            items.append(c["var"])
    kw = balloon_kwargs(el)
    x, y = to_manim_xy(float(el.get("x", CANVAS_W / 2)), float(el.get("y", CANVAS_H / 2)))
    args = [f"[{', '.join(items)}]"]
    args.append(f"pad=({_fmt_num(el['padX'])}, {_fmt_num(el['padY'])})")
    brot = float(el.get("rotation") or 0)
    if abs(brot) > 1e-9:
        args.append(f"rotation={_fmt_num(brot)}")
    if not items:
        args.append(f"center=({_fmt_num(x)}, {_fmt_num(y)})")
        args.append(f"min_size=({_fmt_num(float(el['width']) / CANVAS_H * MANIM_FRAME_H)}, "
                    f"{_fmt_num(float(el['height']) / CANVAS_H * MANIM_FRAME_H)})")
    args += [f"{k}={_py_val(v)}" for k, v in kw.items()]
    return f"gui_balloon({', '.join(args)})"


def media_bake_expr(el: dict[str, Any]) -> str:
    """動画に焼き込む動画・音声。"""
    x, y = to_manim_xy(float(el["x"]), float(el["y"]))
    kw: dict[str, Any] = {"duration": el.get("duration", 0.0), "trimStart": el["trimStart"], "trimEnd": el["trimEnd"], "volume": el["volume"],
                          "fadeIn": el["fadeIn"], "fadeOut": el["fadeOut"], "loop": el["loop"], "after": el["after"], "hasAudio": el.get("hasAudio", True)}
    head = ["self", repr(el["id"]), repr(el["kind"]), py_str(el["path"])]
    if el["kind"] == "video":
        head += [f"center=({_fmt_num(x)}, {_fmt_num(y)})", f"width={_fmt_num(el['width'] / CANVAS_H * MANIM_FRAME_H)}"]
        kw.update(posterTime=el["posterTime"], hideIdle=el["hideIdle"])
    return f"gui_media_bake({', '.join(head + [f'{k}={_py_val(v)}' for k, v in kw.items()])})"


def media_expr(el: dict[str, Any], si: int) -> str:
    """動画・音声（発表で再生）の目印。位置・大きさはキャンバスの px（1920×1080 の画面の中）。"""
    spec: dict[str, Any] = {
        "name": el.get("name", ""), "duration": el.get("duration", 0.0), "trimStart": el["trimStart"], "trimEnd": el["trimEnd"],
        "volume": el["volume"], "fadeIn": el["fadeIn"], "fadeOut": el["fadeOut"], "loop": el["loop"], "after": el["after"],
        "controls": el["controls"], "posterTime": el["posterTime"], "visible": bool(el.get("visibleAtStart", True)),
    }
    if el["kind"] == "video":
        spec.update(rect=[round(float(el["x"]) - el["width"] / 2, 1), round(float(el["y"]) - el["height"] / 2, 1),
                         round(el["width"], 1), round(el["height"], 1)], hideIdle=el["hideIdle"])
    else:
        spec.update(across=el["across"], acrossUntil=(el["acrossUntil"] - 1) if el["acrossUntil"] else None)
    args = ["self", repr(el["id"]), repr(el["kind"]), py_str(el["path"]), f"slide={si}"] + [f"{k}={_py_val(v)}" for k, v in spec.items()]
    return f"gui_media_live({', '.join(args)})"


def _items_arg(el: dict[str, Any], by_id: dict[str, Any] | None) -> str:
    """表・行列のセルに入れる要素（変数名。文字・数式のセルは None）。"""
    def one(i):
        e = (by_id or {}).get(i) if i else None
        return e["var"] if e else "None"
    return "[" + ", ".join("[" + ", ".join(one(i) for i in r) + "]" for r in el.get("items") or []) + "]"


ON_AXES = ("graph", "axdot", "vector", "linegraph", "curve2d", "implicit", "field", "points")


def linear_followers(plane: dict[str, Any], elements: list[dict[str, Any]]) -> list[str]:
    """線形変換の平面と一緒に変換する要素の id: 平面に付いた要素（グラフ・点・ベクトルなど。グラフの補助も）と、
    平面のパネルで選んだ要素。重なり順。"""
    pid = plane["id"]
    on = {e["id"] for e in elements if e.get("type") == "shape" and e.get("shape") in ON_AXES and e.get("axesId") == pid}
    on |= {e["id"] for e in elements if e.get("type") == "shape" and e.get("shape") == "graphpart" and e.get("graphId") in on}
    chosen = set(plane.get("followIds") or [])
    return [e["id"] for e in elements if (e["id"] in on or e["id"] in chosen) and e["id"] != pid]


def own_intro_ids(slide: dict[str, Any]) -> set[str]:
    """このスライドで、自分の「出す」の動きがある要素の id（表・行列のセルの要素は、これがあるときだけ表から外して出す）。"""
    out: set[str] = set()
    for st in slide.get("steps") or []:
        for r in st.get("rows") or []:
            if r.get("kind") == "anim" and r.get("target") and animgen.CATALOG_BY_ID.get(r.get("anim"), {}).get("group") == "in":
                out.add(r["target"])
    return out


def detached_cell_items(slide: dict[str, Any]) -> set[str]:
    """表から外して、別に出すセルの要素の id。外さないセルの要素は表の一部で、表と一緒に出る・消える。"""
    intro = own_intro_ids(slide)
    return {i for i in cell_containers(slide.get("elements") or []) if i in intro}


def cell_containers(elements: list[dict[str, Any]]) -> dict[str, str]:
    """セルに入れた要素の id → 入れている表・行列の id。"""
    out: dict[str, str] = {}
    for e in elements:
        if e.get("type") == "shape" and e.get("shape") in ("table", "matrix"):
            for i in table_item_ids(e):
                out.setdefault(i, e["id"])
    return out


def _deps(e: dict[str, Any]) -> list[str]:
    if e.get("type") != "shape":
        return []
    sh = e.get("shape")
    if sh in ("table", "matrix"):
        return table_item_ids(e)
    if sh == "balloon":
        return list(e.get("contentIds") or [])
    if sh == "angle":
        return [x for x in (e.get("line1Id"), e.get("line2Id")) if x]
    if sh == "boolean":
        return [x for x in (e.get("operandIds") or []) if x]
    if sh == "annot":
        return [e["targetId"]] if e.get("targetId") else []
    if sh == "vector":
        return [e["axesId"]] if e.get("axesId") else []
    if sh == "graphpart":
        return [x for x in (e.get("graphId"), e.get("graph2Id") if e.get("partKind") == "area" else None) if x]
    if sh in ("linegraph", "points"):
        return [e["axesId"]] if e.get("axesId") else []
    if sh in ("trace", "tangent"):
        return [e["targetId"]] if e.get("targetId") else []
    if sh in ("graph", "field", "axdot", "surface", "curve3d", "point3d", "curve2d", "implicit"):
        return [e.get("axesId")] if e.get("axesId") else []
    if sh == "brace" and e.get("mode") == "target" and e.get("targetId"):
        return [e["targetId"]]
    return []


def dependency_order(elements: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    """(重なり順の番号, 要素) を、頼っている要素が先に来る順に並べる（それ以外は重なり順のまま）。"""
    ids = {e["id"] for e in elements}
    box = cell_containers(elements)
    # セルの要素に付ける物（注釈など）は、表がセルの位置に動かしたあとで作る
    deps = {e["id"]: _deps(e) + [box[d] for d in _deps(e) if d in box and box[d] != e["id"]] for e in elements}
    done: set[str] = set()
    out: list[tuple[int, dict[str, Any]]] = []
    pending = list(enumerate(elements))
    while pending:
        rest = []
        for k, e in pending:
            if all(d in done or d not in ids for d in deps.get(e["id"], _deps(e))):
                out.append((k, e))
                done.add(e["id"])
            else:
                rest.append((k, e))
        if len(rest) == len(pending):  # 循環（ふつうは起きない）: 残りはそのままの順で
            out.extend(rest)
            break
        pending = rest
    return out


def _is_const(expr: str) -> bool:
    """スライドの値を使わない、数だけの式（書き出しでは数にする）。"""
    try:
        v = eval(expr, {"np": __import__("numpy"), "__builtins__": {}})  # noqa: S307 — to_python が作った式だけ
        return isinstance(v, (int, float)) or hasattr(v, "__float__")
    except Exception:  # noqa: BLE001
        return False


def _const_value(expr: str) -> float:
    return float(eval(expr, {"np": __import__("numpy"), "__builtins__": {}}))  # noqa: S307 — to_python が作った式だけ


def _params(names: list[str]) -> str:
    """式の中のスライドの値を、描き直すたびのいまの値で渡す引数。"""
    return "params={" + ", ".join(f'"{n}": {n}.get_value()' for n in names) + "}"


def _redraw(call: str, names: list[str]) -> str:
    """値を使う要素は、値が変わるたびに描き直す（always_redraw と同じ）。"""
    return f"gui_redraw(lambda: {call})" if names else call


def _part_kids(project: dict[str, Any], slide: dict[str, Any]) -> list[dict[str, Any]]:
    """スライドに置いた部品の、中の要素（使う補助関数を決めるため）。"""
    parts = parts_of(project)
    out: list[dict[str, Any]] = []
    for e in slide.get("elements") or []:
        if e.get("type") == "shape" and e.get("shape") == "part":
            out += (parts.get(e.get("partId")) or {}).get("elements") or []
    return out


def parts_of(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """部品の id → 部品（プロジェクトの写し）。"""
    return {p["id"]: p for p in project.get("parts") or [] if isinstance(p, dict) and p.get("id")}


def part_expr(part: dict[str, Any] | None, settings: dict[str, Any], values: tuple[str, ...] = ()) -> str:
    """部品の中身を 1 つの式にする（中の要素どうしが頼り合っても書けるように、:= で名前を付けながら作る）。
    中の要素の位置は部品の中心からのずれなので、スライドの中心（原点）のまわりに作る。"""
    if not part or not part.get("elements"):
        return "VGroup()"
    import copy as _copy
    kids = []
    for k, e in enumerate(part["elements"]):
        c = _copy.deepcopy(e)
        c["var"] = f"_gui_pc{k}"
        c["x"] = CANVAS_W / 2 + float(c.get("x") or 0)
        c["y"] = CANVAS_H / 2 + float(c.get("y") or 0)
        kids.append(c)
    by_id = {c["id"]: c for c in kids}
    made = [f"({c['var']} := {element_expr(c, settings, by_id, values)})" for _k, c in dependency_order(kids)]
    # 重なり順（背面が先）に並べる（頼り合う順に作ってから）
    return f"(lambda: ([{', '.join(made)}], VGroup({', '.join(c['var'] for c in kids)}))[1])()"


def element_expr(el: dict[str, Any], settings: dict[str, Any], by_id: dict[str, Any] | None = None,
                 values: tuple[str, ...] = ()) -> str:
    x, y = to_manim_xy(float(el.get("x", CANVAS_W / 2)), float(el.get("y", CANVAS_H / 2)))
    pos = f".move_to([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    rot = float(el.get("rotation") or 0)
    if abs(rot) > 1e-9:
        # 位置を決めてから、その点（要素の中心）を軸に回す（GUI のキャンバスと同じ回り方）
        pos += f".rotate({_fmt_num(rot)} * DEGREES)"
    elif el.get("anchor") in ("left", "right") and (el["type"] in ("text", "math") or el.get("shape") == "tex"):
        # 位置の基準が左端・右端: 文字の長さ（{章} など）が変わっても、その端をそろえる
        try:
            ex = to_manim_xy(float(el["edgeX"]), 0.0)[0]
            pos += f".align_to([{_fmt_num(ex)}, 0, 0], {'LEFT' if el['anchor'] == 'left' else 'RIGHT'})"
        except (KeyError, TypeError, ValueError):
            pass
    color = _color(el.get("color"), settings["defaultColor"])
    fs = _fmt_num(font_size_of(el, settings))
    if el["type"] == "text":
        runs = normalize_runs(el)
        kw = gui_text_kwargs(el, settings, font_size_of(el, settings))
        args = ", ".join(f"{k}={repr(v)}" for k, v in kw.items())
        return f"gui_text({repr(runs)}, {args}){pos}"
    if el["type"] == "math":
        latex, env = math_layout(colorize(el.get("latex", ""), el.get("colorMap"))[0], el.get("mathAlign", "center"))
        env_arg = f', tex_environment="{env}"' if env else ""
        return (f'MathTex({py_str(latex)}, tex_template=tpl{env_arg}, '
                f'font_size={fs}, color="{color}"){pos}')
    if el["type"] == "shape" and el.get("shape") == "axes":
        kw = axes_kwargs(el)
        args = ", ".join([repr(el["axesKind"])] + [f"{k}={_py_val(v)}" for k, v in kw.items()])
        if "x_label" in kw:
            args += ", tex_template=tpl"
        expr = f"gui_axes({args}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
        if el.get("linear"):
            lk = [] if el.get("ghost", True) else ["background=False"]
            lk += [] if el.get("basis", True) else ["basis=False"]
            lk += ["clip=True"] if el.get("linearClip") else []
            expr = f"gui_linear({', '.join([expr, *lk])})"
        return expr
    if el["type"] == "shape" and el.get("shape") == "part":
        # 部品: 中身の要素を、部品の中心を原点にして作り、倍率をかけてから置く
        # 中身は部品の基準点（保存したときの中心）を原点にして作るので、原点のまわりで拡大・回転してから、基準点を置く
        pe = part_expr((settings.get('_parts') or {}).get(el.get('partId')), settings, values)
        tr = f".scale({_fmt_num(float(el.get('scale') or 1))}, about_point=ORIGIN)"
        if abs(rot) > 1e-9:
            tr += f".rotate({_fmt_num(rot)} * DEGREES, about_point=ORIGIN)"
        return f"{pe}{tr}.shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    if el["type"] == "shape" and el.get("shape") == "graph":
        axes = (by_id or {}).get(el.get("axesId"))
        if axes and axes.get("axesKind") == "complex" and el.get("complexCurve"):
            cv = tuple(v for v in values if v not in ("t", "x", "i"))
            expr = to_python(el["expr"], el["lang"], ("t", "x", "i", *cv))
            used = used_names(expr, cv)
            args = [axes["var"], json.dumps(expr)] + [f"{k}={_py_val(v)}" for k, v in complex_kwargs(el).items()]
            if used:
                args.append(_params(used))
            note = f"  # z = {el['expr']}" if el["lang"] == "latex" else ""
            return _redraw(f"gui_complex_curve({', '.join(args)})", used) + note
        if axes and axes.get("axesKind") == "polar":
            pv = tuple(v for v in values if v != "theta")
            expr = to_python(el["expr"], el["lang"], ("theta", *pv))
            used = used_names(expr, pv)
            kw = polar_kwargs(el)
            args = [axes["var"], json.dumps(expr)] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
            if used:
                args.append(_params(used))
            note = f"  # r = {el['expr']}" if el["lang"] == "latex" else ""
            return _redraw(f"gui_polar({', '.join(args)})", used) + note
        expr = to_python(el["expr"], el["lang"], ("x", *values))
        used = used_names(expr, values)
        kw = graph_kwargs(el, expr)
        args = [axes["var"] if axes else "None", json.dumps(expr)] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
        if used:
            args.append(_params(used))
        note = f"  # y = {el['expr']}" if el["lang"] == "latex" else ""
        return _redraw(f"gui_graph({', '.join(args)})", used) + note
    if el["type"] == "shape" and el.get("shape") == "table":
        kw = table_kwargs(el, font_size_of(el, settings))
        cells = "[" + ", ".join("[" + ", ".join(py_str(c) for c in row) + "]" for row in el["cells"]) + "]"
        args = [cells] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
        if table_uses_math(el):
            args.append("tex_template=tpl")
        if table_item_ids(el):
            args.append(f"items={_items_arg(el, by_id)}")
        return f"gui_table({', '.join(args)}){pos}"
    if el["type"] == "shape" and el.get("shape") == "field":
        axes = (by_id or {}).get(el.get("axesId")) if el.get("axesId") else None
        fx = to_python(el["fx"], el["lang"], ("x", "y", *values))
        fy = to_python(el["fy"], el["lang"], ("x", "y", *values))
        used = used_names(f"({fx}) + ({fy})", values)
        head = [repr(el["fieldKind"]), json.dumps(fx), json.dumps(fy)]
        head.append(f"axes={axes['var']}" if axes else f"center=({_fmt_num(x)}, {_fmt_num(y)})")
        args = head + [f"{k}={_py_val(v)}" for k, v in field_kwargs(el, bool(axes)).items()]
        if used:
            args.append(_params(used))
        note = f"  # ({el['fx']}, {el['fy']})" if el["lang"] == "latex" else ""
        return _redraw(f"gui_field({', '.join(args)})", used) + note
    if el["type"] == "shape" and el.get("shape") == "matrix":
        cells = "[" + ", ".join("[" + ", ".join(py_str(c) for c in row) + "]" for row in el["cells"]) + "]"
        args = [cells] + [f"{k}={_py_val(v)}" for k, v in matrix_kwargs(el, font_size_of(el, settings)).items()] + ["tex_template=tpl"]
        if table_item_ids(el):
            args.append(f"items={_items_arg(el, by_id)}")
        return f"gui_matrix({', '.join(args)}){pos}"
    if el["type"] == "shape" and el.get("shape") == "angle":
        l1, l2 = (by_id or {}).get(el["line1Id"]), (by_id or {}).get(el["line2Id"])
        kw = angle_kwargs(el, float(settings.get("fontSizeScale") or 1.0))
        args = [l1["var"] if l1 else "None", l2["var"] if l2 else "None"] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
        if el["label"]:
            args.append("tex_template=tpl")
        return f"gui_angle({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") == "graphpart":
        g = (by_id or {}).get(el["graphId"]) or {}
        axes = (by_id or {}).get(g.get("axesId"))
        expr = to_python(g.get("expr", "0"), g.get("lang", "latex"), ("x", *values))
        kw = graphpart_kwargs(el, lambda x: to_python(x, "latex", values))
        nk = ("x_range", "dx", "x", "length", "c")  # 式を書ける引数（色などの文字列は除く）
        strs = [v for k, v in kw.items() if k in nk and isinstance(v, str)] + [x for k, v in kw.items() if k == "x_range" for x in v if isinstance(x, str)]
        pk = el["partKind"]
        g2 = (by_id or {}).get(el.get("graph2Id")) if pk == "area" and el.get("graph2Id") else None
        if g2:  # 2 つのグラフの間の面積
            kw["expr2"] = to_python(g2.get("expr", "0"), g2.get("lang", "latex"), ("x", *values))
            strs.append(kw["expr2"])
        used = used_names(" + ".join(f"({x})" for x in [expr, *strs]), values)
        fn = {"area": "gui_area", "riemann": "gui_riemann", "tangent": "gui_tangent", "secant": "gui_secant",
              "derivative": "gui_derived", "antiderivative": "gui_derived", "glabel": "gui_graph_label", "tlabel": "gui_t_label"}[pk]
        args = [axes["var"] if axes else "None", json.dumps(expr)]
        if pk in ("derivative", "antiderivative"):
            args.append(repr(pk))
        args += [f"{k}={json.dumps(v) if k == 'expr2' else _py_val(v)}" for k, v in kw.items()]
        if used:
            args.append(_params(used))
        if pk in ("glabel", "tlabel") and kw.get("label"):
            args.append("tex_template=tpl")
        return _redraw(f"{fn}({', '.join(args)})", used)
    if el["type"] == "shape" and el.get("shape") == "linegraph":
        axes = (by_id or {}).get(el.get("axesId"))
        xs = "[" + ", ".join(_fmt_num(p[0]) for p in el["points"]) + "]"
        ys = "[" + ", ".join(_fmt_num(p[1]) for p in el["points"]) + "]"
        args = [axes["var"] if axes else "None", xs, ys] + [f"{k}={_py_val(v)}" for k, v in linegraph_kwargs(el).items()]
        return f"gui_line_graph({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") == "points":
        axes = (by_id or {}).get(el.get("axesId"))
        args = [axes["var"] if axes else "None"] + [f"{k}={_py_val(v)}" for k, v in points_kwargs(el).items()]
        return f"gui_points({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") == "trace":
        target = (by_id or {}).get(el.get("targetId"))
        args = [target["var"] if target else "None"] + [f"{k}={_py_val(v)}" for k, v in trace_kwargs(el).items()]
        return f"gui_trace({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") == "fcurve":
        # 座標軸なしの曲線: 原点（要素の位置）からの画面の座標。回転は原点のまわり
        k = el["curveKind"]
        if k == "parametric":
            cv = tuple(v for v in values if v != "t")
            xs = [to_python(el[q], el["lang"], ("t", *cv)) for q in ("xExpr", "yExpr")]
            used = used_names(f"({xs[0]}) + ({xs[1]})", cv)
            head = [repr(k), f"x={json.dumps(xs[0])}", f"y={json.dumps(xs[1])}"]
            note = f"  # ({el['xExpr']}, {el['yExpr']})" if el["lang"] == "latex" else ""
        elif k == "implicit":
            iv = tuple(v for v in values if v not in ("x", "y"))
            ex = implicit_python(el["expr"], el["lang"], ("x", "y", *iv), to_python)
            used = used_names(ex, iv)
            head = [repr(k), json.dumps(ex)]
            note = f"  # {el['expr']}" if el["lang"] == "latex" else ""
        else:
            ex = to_python(el["expr"], el["lang"], ("x", *values))
            used = used_names(ex, values)
            head = [repr(k), json.dumps(ex)]
            note = f"  # y = {el['expr']}" if el["lang"] == "latex" else ""
        args = head + [f"{q}={_py_val(v)}" for q, v in fcurve_kwargs(el).items()]
        if used:
            args.append(_params(used))
        place = f".shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
        if abs(rot) > 1e-9:
            place += f".rotate({_fmt_num(rot)} * DEGREES, about_point=[{_fmt_num(x)}, {_fmt_num(y)}, 0])"
        return _redraw(f"gui_fcurve({', '.join(args)}){place}", used) + note
    if el["type"] == "shape" and el.get("shape") == "tangent":
        t = (by_id or {}).get(el.get("targetId"))
        a = el["alpha"]
        if isinstance(a, str):
            a = to_python(a, "latex", values)
            used = used_names(a, values)
            a_arg = a if not used else json.dumps(a)
        else:
            used, a_arg = [], _fmt_num(float(a))
        args = [t["var"] if t else "None", f"alpha={a_arg}"] + [f"{q}={_py_val(v)}" for q, v in tangent_kwargs(el).items()]
        if used:
            args.append(_params(used))
        # 付ける曲線が値で描き直されるときは、接線も毎回引き直す
        return _redraw(f"gui_tangent({', '.join(args)})", used or (["_"] if t and "gui_redraw(" in element_expr(t, settings, by_id, values) else []))
    if el["type"] == "shape" and el.get("shape") in ("curve2d", "implicit"):
        axes = (by_id or {}).get(el.get("axesId"))
        av = axes["var"] if axes else "None"
        if el["shape"] == "curve2d":
            cv = tuple(v for v in values if v != "t")
            xs = [to_python(el[k], el["lang"], ("t", *cv)) for k in ("xExpr", "yExpr")]
            used = used_names(f"({xs[0]}) + ({xs[1]})", cv)
            args = [av] + [json.dumps(x) for x in xs]
            note = f"  # ({el['xExpr']}, {el['yExpr']})" if el["lang"] == "latex" else ""
            fn = "gui_curve2d"
        else:
            iv = tuple(v for v in values if v not in ("x", "y"))
            ex = implicit_python(el["expr"], el["lang"], ("x", "y", *iv), to_python)
            used = used_names(ex, iv)
            args = [av, json.dumps(ex)]
            note = f"  # {el['expr']}" if el["lang"] == "latex" else ""
            fn = "gui_implicit"
        args += [f"{k}={_py_val(v)}" for k, v in curve2d_kwargs(el).items()]
        if used:
            args.append(_params(used))
        return _redraw(f"{fn}({', '.join(args)})", used) + note
    if el["type"] == "shape" and el.get("shape") == "svg":
        args = [py_str(el["path"])] + [f"{k}={_py_val(v)}" for k, v in svg_kwargs(el).items()]
        return f"gui_svg({', '.join(args)}){pos}"
    if el["type"] == "shape" and el.get("shape") == "solid":
        return f"gui_solid({', '.join([repr(el['solidKind'])] + [f'{k}={_py_val(v)}' for k, v in solid_kwargs(el).items()])})"
    if el["type"] == "shape" and el.get("shape") == "axes3d":
        kw = axes3d_kwargs(el)
        args = [f"{k}={_py_val(v)}" for k, v in kw.items()] + (["tex_template=tpl"] if "x_label" in kw else [])
        return f"gui_axes3d({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") in ("surface", "curve3d", "point3d"):
        axes = (by_id or {}).get(el.get("axesId")) if el.get("axesId") else None
        av = axes["var"] if axes else "None"
        if el["shape"] == "point3d":
            kw = point3d_kwargs(el, lambda x: to_python(x, el["lang"], values))
            used = used_names(" + ".join(f"({x})" for x in kw["start"] + kw.get("end", ()) if isinstance(x, str)) or "0", values)
            args = [repr(el["pointKind"])] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
            if axes:
                args.append(f"axes={av}")
            if used:
                args.append(_params(used))
            return _redraw(f"gui_point3d({', '.join(args)})", used)
        if el["shape"] == "surface" and el.get("surfKind") == "param":
            sv = tuple(v for v in values if v not in ("u", "v"))  # 曲面の式の u・v は媒介変数
            xs = [to_python(el[k], el["lang"], ("u", "v", *sv)) for k in ("xExpr", "yExpr", "zExpr")]
            used = used_names(" + ".join(f"({x})" for x in xs), sv)
            args = [av] + [json.dumps(x) for x in xs] + [f"{k}={_py_val(v)}" for k, v in surface_kwargs(el).items()]
            if used:
                args.append(_params(used))
            note = f"  # ({el['xExpr']}, {el['yExpr']}, {el['zExpr']})" if el["lang"] == "latex" else ""
            return _redraw(f"gui_psurface({', '.join(args)})", used) + note
        if el["shape"] == "surface":
            expr = to_python(el["expr"], el["lang"], ("x", "y", *values))
            used = used_names(expr, values)
            args = [av, json.dumps(expr)] + [f"{k}={_py_val(v)}" for k, v in surface_kwargs(el).items()]
            note = f"  # z = {el['expr']}" if el["lang"] == "latex" else ""
            if used:
                args.append(_params(used))
            return _redraw(f"gui_surface({', '.join(args)})", used) + note
        cv = tuple(v for v in values if v != "t")  # 曲線の式の t は媒介変数（同じ名前の値より優先）
        xs = [to_python(el[k], el["lang"], ("t", *cv)) for k in ("xExpr", "yExpr", "zExpr")]
        used = used_names(" + ".join(f"({x})" for x in xs), cv)
        args = [av] + [json.dumps(x) for x in xs] + [f"{k}={_py_val(v)}" for k, v in curve3d_kwargs(el).items()]
        if used:
            args.append(_params(used))
        note = f"  # ({el['xExpr']}, {el['yExpr']}, {el['zExpr']})" if el["lang"] == "latex" else ""
        return _redraw(f"gui_curve3d({', '.join(args)})", used) + note
    if el["type"] == "shape" and el.get("shape") == "number":
        kw = number_kwargs(el, font_size_of(el, settings))
        head = el["valueName"] if el["valueName"] in values else _fmt_num(float(el["number"]))
        args = [head] + [f"{k}={_py_val(v)}" for k, v in kw.items()] + ["tex_template=tpl"]
        return f"gui_number({', '.join(args)}){pos}"
    if el["type"] == "shape" and el.get("shape") == "axdot":
        axes = (by_id or {}).get(el.get("axesId"))
        px = to_python(el["xExpr"], el["lang"], values)
        py = to_python(el["yExpr"], el["lang"], values)
        used = used_names(f"({px}) + ({py})", values)
        args = [axes["var"] if axes else "None", json.dumps(px), json.dumps(py)] + \
            [f"{k}={_py_val(v)}" for k, v in axdot_kwargs(el).items()]
        if used:
            args.append(_params(used))
        note = f"  # ({el['xExpr']}, {el['yExpr']})" if el["lang"] == "latex" else ""
        return _redraw(f"gui_axdot({', '.join(args)})", used) + note
    if el["type"] == "shape" and el.get("shape") == "brace":
        kw = brace_kwargs(el)
        if "label_size" in kw:  # 文字の大きさの倍率（プロジェクト設定）を、テキスト・数式と同じく掛ける
            kw["label_size"] = round(kw["label_size"] * float(settings.get("fontSizeScale") or 1.0), 2)
        if el["mode"] == "target":
            target = (by_id or {}).get(el.get("targetId"))
            head = [f"target={target['var']}"]
        else:
            sx, sy = to_manim_xy(float(el["x"]) - el["dx"], float(el["y"]) - el["dy"])
            ex, ey = to_manim_xy(float(el["x"]) + el["dx"], float(el["y"]) + el["dy"])
            head = [f"start=({_fmt_num(sx)}, {_fmt_num(sy)})", f"end=({_fmt_num(ex)}, {_fmt_num(ey)})"]
        args = head + [f"{k}={_py_val(v)}" for k, v in kw.items()]
        if el["label"] and el["labelKind"] == "math":
            args.append("tex_template=tpl")
        return f"gui_brace({', '.join(args)})"
    fscale = float(settings.get("fontSizeScale") or 1.0)
    if el["type"] == "shape" and el.get("shape") == "code":
        args = [py_str(el["code"])] + [f"{k}={_py_val(v)}" for k, v in code_kwargs(el, font_size_of(el, settings)).items()]
        return f"gui_code({', '.join(args)}){pos}"
    if el["type"] == "shape" and el.get("shape") == "statchart":
        kind, kw = statchart_args(el, fscale)
        args = [py_str(kind)] + [f"{k}={_py_val(v)}" for k, v in kw.items()] + ["tex_template=tpl"]
        return f"gui_statchart({', '.join(args)}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    if el["type"] == "shape" and el.get("shape") == "barchart":
        vals = "[" + ", ".join(_fmt_num(b["value"]) for b in el["bars"]) + "]"
        args = [vals] + [f"{k}={_py_val(v)}" for k, v in barchart_kwargs(el, fscale).items()]
        if barchart_uses_tex(el):
            args.append("tex_template=tpl")
        return f"gui_barchart({', '.join(args)}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    if el["type"] == "shape" and el.get("shape") == "tex":
        return f'Tex({py_str(tex_body(el["latex"]))}, tex_template=tpl, font_size={fs}, color="{el["color"]}"){pos}'
    if el["type"] == "shape" and el.get("shape") == "title":
        args = [py_str(tex_body(el["latex"])), f"font_size={fs}", f'color="{el["color"]}"']
        if not el["underline"]:
            args.append("underline=False")
        if el["matchWidth"]:
            args.append("match_width=True")
        if el["align"] != "center":
            args.append(f'align="{el["align"]}"')
        if el.get("_edge") is not None and el["align"] in ("left", "right") and not (el["underline"] and not el["matchWidth"]):
            # マスターの題名の型で左・右に寄せた題名: 文字の幅によらず、マスターの題名と同じ所に左端（右端）をそろえる
            ex, _ = to_manim_xy(float(el["_edge"]), 0)
            pos += f'.align_to(np.array([{_fmt_num(ex)}, 0, 0]), {el["align"].upper()})'
        return f"gui_title({', '.join(args)}, tex_template=tpl){pos}"
    if el["type"] == "shape" and el.get("shape") == "theorem":
        head, paras, kw = theorem_args(el, settings, font_size_of(el, settings))
        args = [py_str(head), "[" + ", ".join(py_str(x) for x in paras) + "]"] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
        return f"gui_theorem({', '.join(args)}, tex_template=tpl){pos}"
    if el["type"] == "shape" and el.get("shape") == "bullets":
        items = "[" + ", ".join(py_str(x) for x in el["items"] if x.strip()) + "]"
        args = [items, f"font_size={fs}", f'color="{el["color"]}"']
        if el["buff"] != 0.5:
            args.append(f"buff={_fmt_num(el['buff'])}")
        if el["dotScale"] != 2:
            args.append(f"dot_scale={_fmt_num(el['dotScale'])}")
        return f"gui_bullets({', '.join(args)}, tex_template=tpl){pos}"
    if el["type"] == "shape" and el.get("shape") == "annot":
        target = (by_id or {}).get(el["targetId"])
        if el["annotKind"] == "arcbrace":
            arc = target or {"radius": 150, "startAngle": 0, "angle": 90, "x": el.get("x", CANVAS_W / 2), "y": el.get("y", CANVAS_H / 2)}
            cx, cy = to_manim_xy(float(arc.get("x", CANVAS_W / 2)), float(arc.get("y", CANVAS_H / 2)))
            kw = arcbrace_kwargs(el, arc, fscale)
            args = [f"({_fmt_num(cx)}, {_fmt_num(cy)})"] + [f"{k}={_py_val(v)}" for k, v in kw.items()]
            if el["label"]:
                args.append("tex_template=tpl")
            return f"gui_arcbrace({', '.join(args)})"
        args = [repr(el["annotKind"]), target["var"] if target else "None"] + [f"{k}={_py_val(v)}" for k, v in annot_kwargs(el).items()]
        return f"gui_annot({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") == "vector":
        axes = (by_id or {}).get(el.get("axesId")) if el.get("axesId") else None
        xs = [to_python(el[k], el["lang"], values) for k in ("xExpr", "yExpr", "x0Expr", "y0Expr")]
        used = used_names(" + ".join(f"({x})" for x in xs), values)
        # 数だけの成分は数で、スライドの値を使う成分は式の文字列で渡す
        lits = [_fmt_num(_const_value(x)) if not used_names(x, values) and _is_const(x) else json.dumps(x) for x in xs]
        args = [axes["var"] if axes else "None", lits[0], lits[1], f"x0={lits[2]}", f"y0={lits[3]}"]
        args += [f"{k}={_py_val(v)}" for k, v in vector_kwargs(el).items()]
        if used:
            args.append(_params(used))
        call = f"gui_vector({', '.join(args)})" + ("" if axes else f".shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])")
        note = f"  # ({el['xExpr']}, {el['yExpr']})" if el["lang"] == "latex" else ""
        return _redraw(call, used) + note
    if el["type"] == "shape" and el.get("shape") == "netgraph":
        names, edges, kw = netgraph_kwargs(el, fscale)
        args = [_py_val(names), "[" + ", ".join(f"({py_str(a)}, {py_str(b)})" for a, b in edges) + "]"] + \
            [f"{k}={_py_val(v)}" for k, v in kw.items()]
        if "labels" in kw:
            args.append("tex_template=tpl")
        return f"gui_netgraph({', '.join(args)}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    if el["type"] == "shape" and el.get("shape") == "samplespace":
        args = [f"{k}={_py_val(v)}" for k, v in samplespace_kwargs(el, fscale).items()] + ["tex_template=tpl"]
        return f"gui_sample_space({', '.join(args)}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
    if el["type"] == "shape" and el.get("shape") == "boolean":
        ops = [(by_id or {}).get(i) for i in el["operandIds"]]
        names = "[" + ", ".join(o["var"] for o in ops if o) + "]"
        args = [repr(el["op"]), names] + [f"{k}={_py_val(v)}" for k, v in boolean_kwargs(el).items()]
        return f"gui_boolean({', '.join(args)})"
    if el["type"] == "shape" and el.get("shape") != "balloon":
        if el.get("shape") == "dot" and el.get("pname") and el.get("pnamePos") == "auto":
            el = {**el, "_pnameDir": pname_auto_dir(el, list((by_id or {}).values()))}
        kind, kw = shape_kwargs(el, fscale)
        if "label" in kw or "name" in kw:
            kw["tex_template"] = "__tpl__"
        args = ", ".join([repr(kind)] + [("tex_template=tpl" if k == "tex_template" else f"{k}={_py_val(v)}") for k, v in kw.items()])
        expr = f"gui_shape({args}).shift([{_fmt_num(x)}, {_fmt_num(y)}, 0])"
        rot = float(el.get("rotation") or 0)
        if abs(rot) > 1e-9:  # 基準点（外接矩形の中心など）を軸に回す
            expr += f".rotate({_fmt_num(rot)} * DEGREES, about_point=[{_fmt_num(x)}, {_fmt_num(y)}, 0])"
        return expr
    if el["type"] == "image":
        rel = (el.get("path") or "").replace("\\", "/")
        wpx = float(el.get("width") or el.get("natW") or 300)
        width = wpx / CANVAS_W * MANIM_FRAME_W
        args = [py_str(rel), f"width={_fmt_num(width)}"]
        cr = el.get("crop") or {"l": 0, "t": 0, "r": 1, "b": 1}
        cw, ch = float(cr["r"]) - float(cr["l"]), float(cr["b"]) - float(cr["t"])
        nat_h = wpx * float(el.get("natH") or 1) * ch / (float(el.get("natW") or 1) * cw)
        hpx = float(el.get("height") or nat_h)
        if abs(hpx - nat_h) > 0.5:  # 縦横比を変えた画像だけ、高さも渡す
            args.append(f"height={_fmt_num(hpx / CANVAS_H * MANIM_FRAME_H)}")
        if float(el.get("opacity", 1)) < 1:
            args.append(f"opacity={_fmt_num(float(el['opacity']))}")
        if el.get("smooth", True) is False:
            args.append("smooth=False")
        if (cr["l"], cr["t"], cr["r"], cr["b"]) != (0, 0, 1, 1):
            args.append(f"crop=({_fmt_num(cr['l'])}, {_fmt_num(cr['t'])}, {_fmt_num(cr['r'])}, {_fmt_num(cr['b'])})")
        return f"gui_image({', '.join(args)}){pos}"
    raise ValueError(f"未知の要素の種類: {el.get('type')}")


def next_slide_kwargs(loop: bool = False, auto_next: bool = False, notes: str = "") -> list[str]:
    """manim-slides の next_slide の引数（その次の区切り、つまりこれから始まるステップの発表の仕方）。"""
    out = []
    if loop:
        out.append("loop=True")
    if auto_next:
        out.append("auto_next=True")
    if notes.strip():
        out.append(f"notes={py_str(notes.strip())}")
    return out


def spin_period(elem_speed: dict[str, float], cam: dict[str, float]) -> str | None:
    """クリックを待つ間も動き続けるもの（ずっと回す・反対側から戻る進め続ける・カメラをずっと回す）があれば、
    gui_spin_wait の引数（カメラの回る速さ）。無ければ None。くり返しの長さは、描くときに要素の大きさから決める。"""
    if not any(abs(v) > 1e-9 for v in list(elem_speed.values()) + list(cam.values())):
        return None
    rates = [_fmt_num(v) for v in cam.values() if abs(v) > 1e-9]
    return f"cam=[{', '.join(rates)}]" if rates else ""


def spin_update(rows: list[dict[str, Any]], var_of, elem_speed: dict[str, float], cam: dict[str, float]) -> None:
    """GUI のステップの行から、「ずっと回す」の状態を進める（付ける・やめる）。"""
    for r in rows:
        if r.get("kind") != "anim":
            continue
        a, p = r.get("anim"), r.get("params") or {}
        if a == "AlwaysRotate" and var_of(r.get("target")):
            v = var_of(r.get("target"))
            try:
                elem_speed[v] = elem_speed.get(v, 0.0) + float(p.get("speed", 90))
            except (TypeError, ValueError):
                pass
        elif a == "AlwaysMove" and var_of(r.get("target")) and p.get("idle", "wrap") == "wrap":
            v = var_of(r.get("target"))
            elem_speed[v] = elem_speed.get(v, 0.0) + 1e6  # 進め続ける（反対側から戻る）: 長さは描くときに決める
        elif a == "AlwaysStop" and var_of(r.get("target")):
            elem_speed.pop(var_of(r.get("target")), None)
        elif a == "Cam3dSpin":
            try:
                cam[p.get("about", "theta")] = float(p.get("rate", 20))
            except (TypeError, ValueError):
                pass
        elif a == "Cam3dStop":
            cam.pop(p.get("about", "theta"), None)


def spin_lap_seconds(elem_speed: dict[str, float], cam: dict[str, float]) -> float | None:
    """gui_spin_wait が描く「クリックを待つ間の 1 周」の長さ（秒）。描くときと同じ計算（それぞれの 1 周の、いちばん短い公倍数。
    60 秒まで）。「進め続ける」だけで長さが描くときに決まるもの・何も回っていないときは None。"""
    speeds = list(cam.values()) + [x for x in elem_speed.values() if abs(x) < 1e5]  # 1e6 は「進め続ける」の印
    periods = [360.0 / abs(v) for v in speeds if abs(v) > 1e-9]
    if not periods:
        return None
    t = max(periods)
    for k in range(1, 400):
        c = max(periods) * k
        if c > 60.0:
            break
        if all(abs(c / q - round(c / q)) < 1e-3 for q in periods):
            t = c
            break
    return t


def spin_laps(project: dict[str, Any]) -> list[dict[str, Any]]:
    """「ずっと回す」「カメラをずっと回す」で、クリックを待つ間に描く 1 周の一覧（描画の時間の目安と点検に使う）。
    返す: [{slide（1 から）, step（0 はスライドの初め）, seconds}]。"""
    out: list[dict[str, Any]] = []
    spin_cam: dict[str, float] = {}
    for si, slide in enumerate(project.get("slides") or []):
        by_id = {e["id"]: e for e in slide.get("elements") or []}
        spin_elem: dict[str, float] = {}
        if not slide.get("autoStart"):
            lap = spin_lap_seconds({}, spin_cam)
            if lap:
                out.append({"slide": si + 1, "step": 0, "seconds": round(lap, 2)})
        for k, step in enumerate(slide.get("steps") or [], start=1):
            if step.get("mode") != "gui":
                continue
            var_of = lambda i: (by_id.get(i) or {}).get("var") if i else None  # noqa: E731
            spin_update(step.get("rows") or [], var_of, spin_elem, spin_cam)
            if step.get("loop") or step.get("autoNext"):
                continue
            lap = spin_lap_seconds(spin_elem, spin_cam)
            if lap:
                out.append({"slide": si + 1, "step": k, "seconds": round(lap, 2)})
    return out


def segment_notes(slide_notes: str, step_notes: str = "", k: int = 0) -> str:
    """区切りの発表者ノート: スライドのノートを、そのスライドのどの区切り（初めの表示・各ステップ）でも出し続け、
    ステップのノートがあれば、その下に足す（manim-slides のノートは区切りごとなので、区切りごとに同じものを入れる）。"""
    sn, tn = (slide_notes or "").strip(), (step_notes or "").strip()
    if not tn:
        return sn
    head = f"【クリック {k}】\n\n{tn}"  # PowerPoint のノートは Markdown にならないので、記号は使わない
    return f"{sn}\n\n{head}" if sn else head


def _remap(items: Any, orig: list[int]) -> None:
    """描画するスライドだけで作ったときの slideIndex を、元のスライドの番号に直す。"""
    for v in items:
        if isinstance(v, dict) and isinstance(v.get("slideIndex"), int) and 0 <= v["slideIndex"] < len(orig):
            v["slideIndex"] = orig[v["slideIndex"]]


def generate(project: dict[str, Any], preamble: str, pages: list[dict[str, Any]] | None = None,
             include: list[int] | None = None, all_slides: bool = False,
             sections: list[dict[str, Any]] | None = None) -> tuple[str, dict[str, Any]]:
    """(.py のソース, 対応表) を返す。検査で問題があれば ExportError。
    描画するスライドだけ（include: 今回だけ選んだスライドの番号。無ければ「描画しない」の印の無いスライド）を書き出す。
    対応表・問題の slideIndex は、元のスライドの番号。all_slides=True は、印を見ずに渡したスライドをすべて書き出す（試し描画）。
    pages: スライドごとのページ番号（page_plan の形。試し描画で、全体から求めたものを渡す）。"""
    from . import masters, refs
    from .project import page_plan, render_order, section_plan
    mp = masters.master_problems(project)
    if mp:
        raise ExportError(mp)
    project = refs.apply(project)  # 番号・参照（{ref:…}）を書き込む（試し描画では、呼ぶ側がプロジェクト全体で先に済ませる）
    # 新しいスライドに自動で置いた、まだ書いていない題名（placeholder）は描かない
    if any(e.get("placeholder") for s in project["slides"] for e in s.get("elements", [])):
        project = {**project, "slides": [{**s, "elements": [e for e in s.get("elements", []) if not e.get("placeholder")]} for s in project["slides"]]}
    if all_slides:
        every = list(range(len(project["slides"])))
        pages = pages if pages is not None else page_plan(project, every)
        sections = sections if sections is not None else section_plan(project, every)
        return _generate(masters.apply(project, pages, sections), preamble, pages, sections)
    orig = render_order(project, include)  # 付録は最後にまとめる
    if not orig:
        raise ExportError([{"message": "描画するスライドがありません（すべてのスライドが「描画しない」になっています）。"}])
    plan = page_plan(project, include)
    secs = section_plan(project, include)
    project = masters.apply(project, plan, secs)
    sub = {**project, "slides": [project["slides"][i] for i in orig]}
    try:
        source, mapping = _generate(sub, preamble, [plan[i] for i in orig], [secs[i] for i in orig], orig)
    except ExportError as e:
        _remap(e.problems, orig)
        raise
    _remap(mapping["lines"].values(), orig)
    mapping["slides"] = orig  # 描画した（書き出した）スライドの、元の番号
    return source, mapping


_PLAIN_CMDS = {"angle": "∠", "triangle": "△", "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "theta": "θ", "pi": "π",
               "lambda": "λ", "mu": "μ", "sigma": "σ", "omega": "ω", "Delta": "Δ", "Omega": "Ω", "leq": "≤", "geq": "≥", "leqq": "≦",
               "geqq": "≧", "neq": "≠", "times": "×", "cdot": "·", "pm": "±", "infty": "∞", "in": "∈", "to": "→", "Rightarrow": "⇒",
               "perp": "⊥", "parallel": "∥", "circ": "°", "det": "det", "sin": "sin", "cos": "cos", "tan": "tan", "log": "log", "lim": "lim"}


def plain_title(s: str) -> str:
    """題名（LaTeX の文章）を、一覧・配布資料の見出しに出す文字に（$…$ の中の簡単な記号を文字にし、ほかの命令・かっこを外す）。"""
    import re as _re

    def math(m: "_re.Match[str]") -> str:
        t = m.group(1)
        t = _re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", t)
        t = _re.sub(r"\\mathbb\{([RNZQC])\}", lambda k: "ℝℕℤℚℂ"["RNZQC".index(k.group(1))], t)
        t = t.replace("\\,", " ").replace("\\ ", " ")
        # 記号の命令は、後ろの空白（命令の区切り）も取る（\angle APB → ∠APB）。文字の命令（sin など）は空白を残す
        t = _re.sub(r"\\([A-Za-z]+) ?", lambda k: (lambda v: v + " " if v.isalpha() else v)(_PLAIN_CMDS.get(k.group(1), "")), t)
        t = t.replace("^°", "°").replace("{", "").replace("}", "")
        return _re.sub(r"\s+", " ", t).strip()
    s = _re.sub(r"\$([^$]*)\$", math, str(s or ""))
    s = _re.sub(r"\\[A-Za-z]+\*?", "", s).replace("{", "").replace("}", "")
    return " ".join(s.split())


def _deck_info(project: dict[str, Any], pages: list[dict[str, Any]], sections: list[dict[str, Any]], orig: list[int] | None) -> list[dict[str, Any]]:
    """描画するスライドの、発表ウィンドウが使う情報（章・付録・目安の時間・題名・ページの見出し）。"""
    out = []
    for si, sl in enumerate(project["slides"]):
        title = ""
        for el in sl["elements"]:
            if el.get("type") == "shape" and el.get("shape") == "title":
                title = plain_title(str(el.get("text") or el.get("latex") or ""))
                break
        if not title:
            for el in sl["elements"]:
                if el.get("type") == "text":
                    title = "".join(r.get("t", "") for r in el.get("runs") or []) or str(el.get("text") or "")
                    break
        sec = sections[si] if si < len(sections) else {}
        out.append({"id": sl.get("id"), "index": orig[si] if orig else si, "page": pages[si]["number"] if si < len(pages) else si + 1,
                    "title": " ".join(title.split())[:80], "section": sec.get("name", ""), "sectionStart": bool(sl.get("section")),
                    "appendix": bool(sl.get("appendix")), "target": sl.get("targetTime"), "notes": (sl.get("notes") or "")[:400]})
    return out


def _generate(project: dict[str, Any], preamble: str, pages: list[dict[str, Any]], sections: list[dict[str, Any]] | None = None,
              orig: list[int] | None = None) -> tuple[str, dict[str, Any]]:
    sections = sections or [{} for _ in project["slides"]]
    problems = validate(project)
    if problems:
        raise ExportError(problems)
    # フォントは、この PC で描ける名前にする（プリセットの別の候補。プロジェクトの値は書き換えない）
    import copy as _copy
    from . import fonts as _fonts
    project = _fonts.resolve_in(_copy.deepcopy(project))
    settings = {**project["settings"], "_parts": parts_of(project)}  # 部品（要素のテンプレート）の中身も、要素の式で使う
    cls = settings.get("className") or "Deck"
    bg = _color(settings.get("background"), "#FFFFFF")
    w = _Writer()

    w.add("# このファイルは Manim Slide GUI が生成しました。")
    w.add("# GUI から書き出し直すと上書きされます。編集は GUI（project.json と preamble.tex）で行ってください。")
    w.add("from manim import *")
    use3d = bool(project["settings"].get("use3d"))
    is_zoom = lambda e: e.get("type") == "shape" and e.get("shape") == "zoom"  # noqa: E731
    is_linear = lambda e: e.get("type") == "shape" and e.get("shape") == "axes" and bool(e.get("linear"))  # noqa: E731
    uses_bake = any(el.get("type") == "media" and el.get("mode") == "bake" for s in project["slides"] for el in s["elements"])
    uses_zoom = not use3d and any(is_zoom(el) for s in project["slides"] for el in s["elements"])
    w.add("from manim_slides import Slide, ThreeDSlide" if use3d else "from manim_slides import Slide")
    if project.get("_projectFonts"):
        w.add("")
        for line in projfonts.REGISTER_CODE:
            w.add(line)
    w.add("")
    shows_pages = any(p["show"] for p in pages)  # ページ番号は gui_text（textkit）と gui_page_number（shapekit）を使う
    # 章の表示（gui_section_mark）も同じ補助関数を使う
    shows_pages = shows_pages or ((project["settings"].get("sections") or {}).get("display", "none") != "none")
    # コード欄（コードのステップ・自由なコードの行）に書いた文（GUI の動きを「コードにする」と、gui_… が入る）
    user_code = "\n".join([st.get("code") or "" for s in project["slides"] for st in s["steps"]]
                          + [r.get("code") or "" for s in project["slides"] for st in s["steps"] for r in st.get("rows") or [] if r.get("kind") == "code"])
    if shows_pages or any(el.get("type") == "text" or (el.get("shape") == "brace" and el.get("label") and el.get("labelKind") == "text")
                          or (el.get("shape") == "table" and el.get("cellMode") != "math")
                          for s in project["slides"] for el in [*s["elements"], *_part_kids(project, s)]) or "gui_text(" in user_code:
        # テキスト要素の補助関数（書式・配置・縦書き・効果）。プレビューと同じ関数を埋め込む
        w.add("")
        for line in TEXTKIT_SOURCE.read_text(encoding="utf-8").rstrip("\n").split("\n"):
            w.add(line)
        w.add("")
    if shows_pages or any(el.get("type") in ("shape", "media") for s in project["slides"] for el in s["elements"]) \
            or any(st.get("mode") == "gui" for s in project["slides"] for st in s["steps"]) \
            or any(i > 0 and (s.get("transition") or {}).get("kind", "none") != "none" for i, s in enumerate(project["slides"])) \
            or any(e.get("type") == "image" and (e.get("mask") or {}).get("id") for s in project["slides"] for e in s["elements"]) \
            or re.search(r"(?<![A-Za-z0-9_.])gui_\w+\s*\(", user_code):  # GUI の動きは gui_at などを使う。コード欄で gui_… を使うときも
        # 図形の補助関数（直線・矢印・円・多角形・吹き出しなど）。プレビューと同じ関数を埋め込む
        w.add("")
        for line in SHAPEKIT_SOURCE.read_text(encoding="utf-8").rstrip("\n").split("\n"):
            w.add(line)
        w.add("")
    w.add('tpl = TexTemplate(tex_compiler="xelatex", output_format=".xdv")')

    tail = [*tex_font_lines(project.get("settings")), *JP_TAIL_PREAMBLE]  # 書体（明朝・ゴシック）と、数式の一部の色
    pre_lines = [*JP_FIXED_PREAMBLE, "% ---- preamble.tex ----", *preamble.replace("\r\n", "\n").rstrip("\n").split("\n"),
                 "% ---- （GUI が足す）----", *tail]
    pre_text = "\n".join(pre_lines)
    if '"""' in pre_text or pre_text.endswith("\\"):
        w.add(f"tpl.add_to_preamble({json.dumps(pre_text, ensure_ascii=False)})", {"kind": "preamble"})
    else:
        w.add('tpl.add_to_preamble(r"""', {"kind": "preamble"})
        for n, l in enumerate(pre_lines):
            user_line = n - len(JP_FIXED_PREAMBLE)  # 1 始まりの preamble.tex の行
            in_user = 1 <= user_line <= len(pre_lines) - len(JP_FIXED_PREAMBLE) - 2 - len(tail)
            w.add(l, {"kind": "preamble", "preambleLine": user_line} if in_user else {"kind": "preamble"})
        w.add('""")', {"kind": "preamble"})
    if tikzfix.uses_tikz(preamble):
        # TikZ（chemfig など）の線を見えるようにする（Manim は LaTeX の線を太さ 0 で読み込むため）
        for line in tikzfix.SOURCE.rstrip("\n").split("\n"):
            w.add(line)
    w.add("")
    w.add("")
    if any(el.get("type") == "image" for s in project["slides"] for el in s["elements"]):
        w.add("import pathlib as _gui_pathlib")
        w.add("from PIL import Image as _GuiPILImage")
        w.add("")
        w.add("")
        w.add("def gui_image(path, width, height=None, opacity=1, smooth=True, crop=None):")
        w.add('    """GUI の画像要素。path はこの .py のフォルダ（プロジェクトのフォルダ）からの相対パス。')
        w.add('    height を渡すと、縦横比を変えて（縦・横に伸ばして）その高さにする。')
        w.add('    crop=(左, 上, 右, 下) は、元の画像の残す範囲（0〜1 の割合）。"""')
        w.add("    p = _gui_pathlib.Path(path)")
        w.add("    if not p.is_absolute():")
        w.add("        p = _gui_pathlib.Path(__file__).resolve().parent / p")
        w.add("    im = _GuiPILImage.open(p).convert(\"RGBA\")")
        w.add("    if crop is not None:  # トリミング")
        w.add("        l, t, r, b = crop")
        w.add("        im = im.crop((round(l * im.width), round(t * im.height), max(round(l * im.width) + 1, round(r * im.width)),")
        w.add("                      max(round(t * im.height) + 1, round(b * im.height))))")
        w.add("    # 描画の解像度で必要な大きさ（拡大のアニメーション用に 1.5 倍の余裕）まで縮めておく。")
        w.add("    # 大きな写真のままだと、Manim は1コマごとに元の大きさの画像を変形するため、描画が非常に遅くなる")
        w.add("    h = height if height else width * im.height / im.width")
        w.add("    need_w = int(width / config.frame_width * config.pixel_width * 1.5) + 1")
        w.add("    need_h = int(h / config.frame_height * config.pixel_height * 1.5) + 1")
        w.add("    if im.width > need_w or im.height > need_h:")
        w.add("        im = im.resize((min(im.width, need_w), min(im.height, need_h)),")
        w.add("                       _GuiPILImage.LANCZOS if smooth else _GuiPILImage.NEAREST)")
        w.add("    m = ImageMobject(np.array(im))")
        w.add("    if not smooth:  # 拡大・縮小で画素をぼかさない（ドット絵など）")
        w.add('        m.set_resampling_algorithm(RESAMPLING_ALGORITHMS["nearest"])')
        w.add("    m.stretch_to_fit_width(width)")
        w.add("    m.stretch_to_fit_height(h)")
        w.add("    if opacity < 1:")
        w.add("        m.set_opacity(opacity)")
        w.add("    return m")
        w.add("")
        w.add("")
    w.add("def gui_layer(mob, z):")
    w.add('    """GUI のレイヤー（重なり順）を付ける。いつ画面に出しても、この順で重なる。"""')
    w.add("    mob._gui_z = z  # 値に連動して描き直す要素は、描き直すたびにこの値を付け直す")
    w.add("    for m in mob.get_family():")
    w.add('        m.z_index = z + (0.5 if getattr(m, "_gui_front", False) else 0)  # 文字は同じ要素のマーカーより手前')
    w.add("    return mob")
    w.add("")
    w.add("")
    if use3d:
        w.add("def gui_fix(scene, mob):")
        w.add('    """3D のスライドで、カメラを動かしても画面の同じ所に出す（add_fixed_in_frame_mobjects）。シーンには加えない。"""')
        w.add("    mob._gui_fixed_cam = scene.renderer.camera  # 描き直す要素は、描き直した部分も固定し直す")
        w.add("    scene.renderer.camera.add_fixed_in_frame_mobjects(mob)")
        w.add("    return mob")
        w.add("")
        w.add("")
        w.add(f"class {cls}(ThreeDSlide):")
        w.add("    # ThreeDSlide: カメラは向きと拡大率で動かす（例: self.move_camera(phi=60 * DEGREES, theta=-45 * DEGREES, run_time=2)）")
        w.add("    def __init__(self, *args, **kwargs):")
        w.add("        # Manim の 3D のカメラは中心（frame_center）のずらしを 2 回かけ、しかも最初のコマの中心を使い回すので、")
        w.add("        # スライドごとの中心が正しく効かない。直したカメラ（shapekit の _gui_three_d_camera_class）を使う")
        w.add("        kwargs.setdefault(\"camera_class\", _gui_three_d_camera_class())")
        w.add("        super().__init__(*args, **kwargs)")
        w.add("")
        w.add("    def play(self, *args, **kwargs):")
        w.add("        # カメラの回転の行列は、コマを描くときにだけ作り直されるため、描いた後とキャッシュで飛ばした後で値が変わり、")
        w.add("        # 次の動きのハッシュが毎回変わって、描き直しになる（特に「カメラをずっと回す」が重い）。先にそろえる")
        w.add("        self.camera.reset_rotation_matrix()")
        w.add("        return super().play(*args, **kwargs)")
        w.add("")
    elif uses_zoom:
        w.add(f"class {cls}(Slide, ZoomedScene):")
        w.add("    # ZoomedScene（MovingCameraScene の子）: self.camera.frame でスライドのカメラ、self.zoomed_camera.frame でズームの枠を動かせる")
        w.add("    # （例: self.play(self.zoomed_camera.frame.animate.shift(RIGHT))、self.activate_zooming(animate=True)）")
        w.add("    def get_moving_mobjects(self, *animations):")
        w.add("        # ズームを出している間は、すべての要素を毎コマ描き直す（Manim は止まっている要素を前のコマの絵で済ませるため、")
        w.add("        # 映す所が飛び出すアニメーションなどの間、ズームのカメラに止まっている要素が写らない）")
        w.add("        moving = super().get_moving_mobjects(*animations)")
        w.add("        return list_update(self.mobjects, moving) if getattr(self, \"zoom_activated\", False) else moving")
        w.add("")
    else:
        w.add(f"class {cls}(Slide, MovingCameraScene):")
        w.add("    # MovingCameraScene: ステップのコードで self.camera.frame を動かせる（例: self.play(self.camera.frame.animate.scale(0.5))）")
    w.add("    def get_time_progression(self, run_time, *args, **kwargs):")
    w.add("        # Manim は最後のコマを「終わる 1 コマ前」の状態で描くため、終わった時の状態のコマを 1 枚足す")
    w.add("        # （値を t = 2 まで動かしたときに、t = 1.98 のグラフで止まらないように）")
    w.add("        prog = super().get_time_progression(run_time, *args, **kwargs)")
    w.add("        times = getattr(prog, \"iterable\", None)")
    w.add("        if isinstance(times, np.ndarray) and len(times) and times[-1] < run_time - 1e-9:")
    w.add("            prog.iterable = np.append(times, run_time)")
    w.add("            prog.total = len(prog.iterable)")
    w.add("        return prog")
    w.add("")
    w.add("    def next_slide(self, gui_new_page=False, gui_same_click=False, gui_key=None, gui_page=None, **kwargs):")
    w.add("        # アニメーションの無い区間も1枚のスライドとして残すため、短い待機を入れる（GUI が自動で追加）")
    w.add("        if self.renderer.num_plays == self._gui_mark:")
    w.add("            self.wait(0.1)")
    w.add("        self._gui_segdur.append(round(float(self.renderer.time) - self._gui_seg_t0, 3))  # 終わった区切りの長さ")
    w.add("        super().next_slide(**kwargs)")
    w.add("        self._gui_mark = self.renderer.num_plays")
    w.add("        # 区切りの初めの時刻（動画・音声の操作を、区切りの何秒目に行うかの基準）と、区切りのスライドの番号")
    w.add("        self._gui_seg_t0 = float(self.renderer.time)")
    w.add("        if gui_new_page:")
    w.add("            self._gui_slide += 1")
    w.add("        self._gui_segslides.append(self._gui_slide)")
    w.add("        self._gui_segkeys.append(gui_key or self._gui_segkeys[-1])  # 区切りの元（スライドの id:ステップの id。1 本の動画の待ち時間に使う）")
    w.add("        # 発表者用ウィンドウの一覧に出す「ページ・クリック」番号を記録する")
    w.add("        if gui_new_page:")
    w.add("            self._gui_page, self._gui_click = (gui_page if gui_page is not None else self._gui_page + 1), 0  # 付録は「A1」…")
    w.add("        elif not gui_same_click:  # 「ずっと回す」を、クリックを待つ間も見せる区切り（同じクリック）は数えない")
    w.add("            self._gui_click += 1")
    w.add("        self._gui_pages.append([self._gui_page, self._gui_click])")
    w.add("")
    w.add("    def gui_spin_wait(self, cam=()):")
    w.add("        # 「ずっと回す」「進め続ける（反対側から戻る）」「カメラをずっと回す」を、クリックを待つ間も見せる:")
    w.add("        # 全部がそろって元に戻る時間（1 周・画面を 1 回通り抜ける時間の、いちばん短い公倍数。60 秒まで）だけ描いて、")
    w.add("        # その区切りをくり返す（切れ目が出ない）。待つ間は止める「進め続ける」は、この間だけ止める")
    w.add("        held, periods, speeds = [], [360.0 / abs(r) for r in cam if abs(r) > 1e-9], {}")
    w.add("        for m in self.mobjects:")
    w.add("            for x in m.get_family():")
    w.add("                for f in getattr(x, '_gui_always', []):")
    w.add("                    k = getattr(f, '_gui_kind', '')")
    w.add("                    if k == 'move':")
    w.add("                        x.remove_updater(f)")
    w.add("                        held.append((x, f))")
    w.add("                    elif k == 'rotate':")
    w.add("                        speeds[id(x)] = speeds.get(id(x), 0.0) + f._gui_speed")
    w.add("                    elif k == 'movewrap' and getattr(f, '_gui_period', None):")
    w.add("                        periods.append(f._gui_period)")
    w.add("        periods += [360.0 / abs(v) for v in speeds.values() if abs(v) > 1e-9]")
    w.add("        t = max(periods) if periods else 0.1")
    w.add("        for k in range(1, 400):")
    w.add("            c = max(periods or [0.1]) * k")
    w.add("            if c > 60.0:")
    w.add("                break")
    w.add("            if all(abs(c / p - round(c / p)) < 1e-3 for p in periods):")
    w.add("                t = c")
    w.add("                break")
    w.add("        self.wait(t)")
    w.add("        for x, f in held:")
    w.add("            x.add_updater(f)")
    w.add("")
    w.add("    def gui_first_slide(self, **kwargs):")
    w.add("        # 最初のスライドの初めの区切りの発表の仕方（ほかの区切りは next_slide の引数で決める）")
    w.add("        from manim_slides.config import BaseSlideConfig")
    w.add("        self._base_slide_config = BaseSlideConfig(**kwargs)")
    w.add("")
    w.add("    def _gui_cue(self, mid, action, value=None):")
    w.add("        # 動画・音声の操作を「何番目の区切りの、何秒目に」として記録する（発表ウィンドウが、その時刻に行う）")
    w.add("        self._gui_cues.append([len(self._gui_segslides) - 1, round(float(self.renderer.time) - self._gui_seg_t0, 3), mid, action, value])")
    w.add("")
    w.add("    def _gui_save_pages(self):")
    w.add("        # manim-slides のスライドごとの「ページ・クリック」番号を slides/gui_pages に保存する（発表者用ウィンドウの一覧用）")
    w.add("        import json")
    w.add("        from pathlib import Path")
    w.add("        try:")
    w.add('            d = Path("slides") / "gui_pages"')
    w.add("            d.mkdir(parents=True, exist_ok=True)")
    w.add('            (d / f"{type(self).__name__}.json").write_text(json.dumps(self._gui_pages), encoding="utf-8")')
    w.add('            (d / f"{type(self).__name__}.segs.json").write_text(json.dumps(self._gui_segkeys), encoding="utf-8")')
    w.add("            # 章・付録・目安の時間・リンク（発表ウィンドウ・HTML・PDF が使う）")
    w.add('            (d / f"{type(self).__name__}.deck.json").write_text(json.dumps({"slides": json.loads(self._GUI_DECK), "links": self._gui_links},')
    w.add("                                                                      ensure_ascii=False), encoding=\"utf-8\")")
    w.add("            # 動画・音声（発表で再生）: 要素の設定・区切りごとのスライドの番号・操作の記録")
    w.add('            mp = d / f"{type(self).__name__}.media.json"')
    w.add("            if getattr(self, \"_gui_media\", None):")
    w.add('                durs = self._gui_segdur + [round(float(self.renderer.time) - self._gui_seg_t0, 3)]')
    w.add('                mp.write_text(json.dumps({"segments": self._gui_segslides, "durations": durs, "media": self._gui_media, "cues": self._gui_cues},')
    w.add("                                         ensure_ascii=False), encoding=\"utf-8\")")
    w.add("            elif mp.exists():")
    w.add("                mp.unlink()")
    w.add("        except OSError:")
    w.add("            pass")
    w.add("")
    w.add("    def _gui_ref_link(self, si, m, mark, to, color):")
    w.add("        # 参照の文字（目印の色で描いた形）を元の色に戻し、押すと飛ぶ範囲として記録する")
    w.add("        parts = [x for x in m.family_members_with_points() if x.get_fill_opacity() > 0 and x.get_fill_color().to_hex().lower() == mark]")
    w.add("        for x in parts:")
    w.add("            x.set_fill(color)")
    w.add("            if x.get_stroke_width() > 0:")
    w.add("                x.set_stroke(color)")
    w.add("        if parts:")
    w.add("            self._gui_link(si, VGroup(*parts), to)")
    w.add("")
    w.add("    def _gui_link(self, si, m, to):")
    w.add("        # 押すと飛ぶ要素の、スライドの初めの位置（画面に対する割合: 左・上・幅・高さ）")
    w.add("        try:")
    w.add("            fw, fh = config.frame_width, config.frame_height")
    w.add("            l, t = m.get_corner(UL)[:2]")
    w.add("            r, b = m.get_corner(DR)[:2]")
    w.add("            self._gui_links.append([si, [round((l + fw / 2) / fw, 4), round((fh / 2 - t) / fh, 4), round((r - l) / fw, 4), round((t - b) / fh, 4)], to])")
    w.add("        except Exception:  # noqa: BLE001")
    w.add("            pass")
    w.add("")
    deck = json.dumps(_deck_info(project, pages, sections, orig), ensure_ascii=False)
    w.add(f"    _GUI_DECK = {py_str(deck)}")
    w.add("")
    first_page = pages[0]["number"] if pages else 1
    w.add("    def construct(self):")
    w.add(INDENT + "self._gui_mark = 0")
    w.add(INDENT + f"self._gui_page, self._gui_click, self._gui_pages = {_py_val(first_page)}, 0, [[{_py_val(first_page)}, 0]]")
    w.add(INDENT + "self._gui_links = []")
    w.add(INDENT + "self._gui_seg_t0, self._gui_slide, self._gui_segslides, self._gui_cues, self._gui_segdur = 0.0, 0, [0], [], []")
    w.add(INDENT + "self._gui_segkeys = [None]")
    w.add(INDENT + f'self.camera.background_color = ManimColor("{bg}")')
    if not use3d:
        w.add(INDENT + "self.camera.frame.save_state()  # カメラはスライドごとに、この状態（またはスライドの初期位置）に戻す")

    cur_bg = bg
    spin_cam: dict[str, float] = {}  # 3D のカメラの「ずっと回す」（about → 度/秒）
    for si, slide in enumerate(project["slides"]):
        elements = slide["elements"]
        groups = slide.get("groups", [])
        by_id = {e["id"]: e for e in elements}
        by_id.update({g["id"]: g for g in groups})
        detached = detached_cell_items(slide)
        in_table = set(cell_containers(elements)) - detached
        w.add("")
        w.add(INDENT + f"# ===== スライド {si + 1} =====")
        trans = slide.get("transition") or {}
        use_trans = si > 0 and trans.get("kind", "none") != "none"
        spin_elem: dict[str, float] = {}  # このスライドで「ずっと回す」要素（スライドが変わると消える）
        start_tail = None if slide.get("autoStart") else spin_period({}, spin_cam)  # 3D のカメラの回転は、スライドをまたいで続く
        start_kw = next_slide_kwargs(False, bool(slide.get("autoStart")) or start_tail is not None, slide.get("notes") or "")
        if si == 0:
            w.add(INDENT + f"self._gui_segkeys[0] = {py_str(str(slide.get('id')) + ':start')}", {"kind": "slide", "slideIndex": si})
        if si == 0 and start_kw:
            w.add(INDENT + f"self.gui_first_slide({', '.join(start_kw)})  # このスライドの初めの表示の、発表の仕方", {"kind": "slide", "slideIndex": si})
        if si > 0:
            if uses_bake:
                w.add(INDENT + "gui_media_slide_end(self)  # 前のスライドの、焼き込む動画・音声を止める", {"kind": "slide", "slideIndex": si})
            gp = _py_val(pages[si]["number"]) if si < len(pages) else "None"
            w.add(INDENT + f"self.next_slide({', '.join(['gui_new_page=True', 'gui_key=' + py_str(str(slide.get('id')) + ':start'), 'gui_page=' + gp] + start_kw)})", {"kind": "slide", "slideIndex": si})
            if use_trans:
                w.add(INDENT + "_gui_prev = gui_frame_image(self)  # 切り替え効果のため、前のスライドの最後の画面を写しておく", {"kind": "slide", "slideIndex": si})
            w.add(INDENT + "self.clear()", {"kind": "slide", "slideIndex": si})
            if not use3d:
                w.add(INDENT + "self.camera.frame.restore()", {"kind": "slide", "slideIndex": si})
            if uses_zoom:
                w.add(INDENT + "gui_zoom_off(self)  # 前のスライドのズームを止める", {"kind": "slide", "slideIndex": si})
        sbg = _color(slide.get("background"), bg) if slide.get("background") else bg
        if sbg != cur_bg:  # マスターの背景色（スライドごと）
            w.add(INDENT + f'self.camera.background_color = ManimColor("{sbg}")', {"kind": "slide", "slideIndex": si})
            cur_bg = sbg
        cam = slide.get("camera")
        if use3d:
            # カメラはスライドごとに、そのスライドの初めの向きに戻す（回し続けていれば止める）
            c3 = slide.get("camera3d") or {"phi": 0, "theta": -90, "zoom": 1, "x": 0, "y": 0}
            if si > 0:
                w.add(INDENT + 'self.stop_ambient_camera_rotation(); self.stop_ambient_camera_rotation("phi")', {"kind": "slide", "slideIndex": si})
            w.add(INDENT + f"self.set_camera_orientation(phi={_fmt_num(c3['phi'])} * DEGREES, theta={_fmt_num(c3['theta'])} * DEGREES, "
                  f"zoom={_fmt_num(c3['zoom'])}, frame_center=[{_fmt_num(c3['x'])}, {_fmt_num(c3['y'])}, 0])", {"kind": "slide", "slideIndex": si})
        elif cam:
            w.add(INDENT + f"self.camera.frame.set(width={_fmt_num(cam['width'])}).move_to([{_fmt_num(cam['x'])}, {_fmt_num(cam['y'])}, 0])"
                  "  # スライドのカメラの初期位置", {"kind": "slide", "slideIndex": si})
        # スライドの値（ValueTracker）。ステップで self.play(t.animate.set_value(3)) のように動かす
        values = tuple(v["name"] for v in slide.get("values", []) if v.get("name"))
        for v in slide.get("values", []):
            if v.get("name"):
                w.add(INDENT + f"{v['name']} = ValueTracker({_fmt_num(float(v['value']))})", {"kind": "slide", "slideIndex": si})
        # 重なり順: 後ろの要素ほど小さい値（最背面 = -要素数、最前面 = -1）。コードで作った物（0）は、要素より手前に描かれる
        n = len(elements)
        is_balloon = lambda e: e.get("type") == "shape" and e.get("shape") == "balloon"  # noqa: E731
        # 吹き出し・グラフ・中かっこは、ほかの要素（中身・座標軸・付ける要素）から作るので、それらのあとで作る
        # （作る順番が変わっても、重なり順は gui_layer で決まる）
        for k, el in dependency_order(elements):
            origin = {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]}
            if el.get("type") == "media" and el.get("mode") == "bake":
                # 動画に焼き込む動画・音声（動画は ImageMobject。重なり順も、ほかの要素と同じ）
                w.add(INDENT + f"{el['var']} = {media_bake_expr(el)}", origin)
                if el.get("kind") == "video":
                    w.add(INDENT + f"gui_layer({el['var']}, {k - n})", origin)
                continue
            if is_zoom(el) or el.get("type") == "media":
                continue  # ズーム・動画・音声（発表で再生）は、要素をすべて置いたあとで
            expr = balloon_expr(el, by_id) if is_balloon(el) else element_expr(el, settings, by_id, values)
            w.add(INDENT + f"{el['var']} = {expr}", origin)
            w.add(INDENT + f"gui_layer({el['var']}, {k - n})", origin)
            if is_linear(el) and el.get("ghost", True):
                w.add(INDENT + f"gui_layer({el['var']}.gui_background, {k - n - 0.5})  # 変換の前の薄い方眼（変換しても動かない）", origin)
            if el.get("type") == "shape" and el.get("shape") in ("table", "matrix"):
                for iid in table_item_ids(el):
                    it = by_id.get(iid)
                    if it and iid in detached:  # 自分の「出す」があるセルの要素は、位置だけ決めて表から外す（あとで出す）
                        w.add(INDENT + f"gui_detach({el['var']}, {it['var']})", origin)
            if use3d and el.get("fixedInFrame", True) and not (el.get("type") == "shape" and el.get("shape") in SHAPES_3D):
                w.add(INDENT + f"gui_fix(self, {el['var']})", origin)
        # 動画・音声（発表で再生）の目印（Manim の映像には描かない。発表ウィンドウが重ねて再生する）
        for el in elements:
            if el.get("type") == "media" and el.get("mode") != "bake":
                w.add(INDENT + f"{el['var']} = {media_expr(el, si)}", {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
        # 画像の切り抜き（図形の形）: 型にする要素ができてから、今の位置で画像の透明度に焼き込む
        for el in elements:
            mk = el.get("mask") or {}
            if el.get("type") == "image" and mk.get("id") and mk["id"] in by_id and by_id[mk["id"]].get("type") not in ("image", "media"):
                inv = ", invert=True" if mk.get("invert") else ""
                w.add(INDENT + f"gui_image_mask({el['var']}, {by_id[mk['id']]['var']}{inv})  # {by_id[mk['id']]['var']} の形に切り抜く",
                      {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
        # グループ: 中の要素を重なり順にまとめる（コードで group1 として動かせる）
        for g in groups:
            members = [e["var"] for e in elements if e.get("groupId") == g["id"]]
            cls_name = "Group" if any(e.get("type") == "image" or (e.get("type") == "media" and e.get("mode") == "bake" and e.get("kind") == "video")
                                      for e in elements if e.get("groupId") == g["id"]) else "VGroup"
            w.add(INDENT + f"{g['var']} = {cls_name}({', '.join(members)})",
                  {"kind": "element", "slideIndex": si, "elementId": g["id"], "var": g["var"]})
        # 「覚えた状態に戻す」の戻り先: 初めの状態を覚えておく（「今の状態を覚える」の行があれば、そこで覚え直す）
        restore_ids = []
        for st in slide.get("steps", []):
            for r in st.get("rows") or [] if st.get("mode") == "gui" else []:
                if r.get("kind") == "anim" and r.get("anim") == "Restore" and r.get("target") in by_id and r["target"] not in restore_ids:
                    restore_ids.append(r["target"])
        for tid in restore_ids:
            w.add(INDENT + f"{by_id[tid]['var']}.save_state()  # 「覚えた状態に戻す」の戻り先（初めの状態）",
                  {"kind": "element", "slideIndex": si, "elementId": tid, "var": by_id[tid]["var"]})
        # 線形変換の平面: gui_apply_matrix で一緒に変換する要素（平面に付いた要素と、平面のパネルで選んだ要素）
        for el in elements:
            if is_linear(el):
                fol = [by_id[i]["var"] for i in linear_followers(el, elements) if i in by_id]
                w.add(INDENT + f"{el['var']}.gui_followers = [{', '.join(fol)}]", {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
        visible = []
        for e in elements:
            if e["id"] in in_table:
                continue  # 表・行列のセルの要素（外さないもの）は、表と一緒に出る
            if e.get("visibleAtStart", True) and not is_zoom(e) and (e.get("type") != "media" or (e.get("mode") == "bake" and e.get("kind") == "video" and not e.get("hideIdle"))):
                if is_linear(e) and e.get("ghost", True):
                    visible.append(f"{e['var']}.gui_background")
                visible.append(e["var"])
        if visible:
            w.add(INDENT + f"self.add({', '.join(visible)})", {"kind": "slide", "slideIndex": si})
        # 動画・音声（発表で再生）: 「自動」で始めるものは、スライドの初めに再生する（切り替え効果があれば、その後で）
        auto_media = []
        for el in elements:
            if el.get("type") == "media" and el.get("start") == "auto":
                # 焼き込むときは、描いた時間の分しか動画が進まないので、終わるまで（くり返しなら 1 回分）待つ
                wt = ", wait=True" if el.get("mode") == "bake" else ""
                auto_media.append((INDENT + f"gui_media(self, {el['var']}, \"play\"{wt})", {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]}))
        if not use_trans:
            for line, org in auto_media:
                w.add(line, org)
        for el in elements:
            if is_zoom(el) and not use3d:
                # ズーム（拡大する所の枠と、拡大を映す所）。active=False なら、ステップの self.activate_zooming(animate=True) で出す
                args = ["self"] + [f"{k}={_py_val(v)}" for k, v in zoom_kwargs(el).items()]
                w.add(INDENT + f"{el['var']} = gui_zoom({', '.join(args)})", {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
        # ページ番号（self.page_number。2D はカメラの枠について動き、3D は画面に固定）
        pg = pages[si] if si < len(pages) else None
        if pg and pg["show"]:
            ps = settings.get("pageNumbers") or {}
            args = [py_str(pg["text"]), f'corner="{ps.get("position", "br")}"']
            if ps.get("buff", 0.3) != 0.3:
                args.append(f"buff={_fmt_num(float(ps['buff']))}")
            if use3d:
                args.append("fixed=True")
            args += [f"font={py_str(settings.get('defaultFont') or '')}",
                     f"font_size={_fmt_num(round(float(ps.get('fontSize', 24)) * float(settings.get('fontSizeScale') or 1.0), 2))}",
                     f'color="{_color(ps.get("color"), settings["defaultColor"])}"']
            w.add(INDENT + f"self.page_number = gui_page_number(self, {', '.join(args)})", {"kind": "slide", "slideIndex": si})
        # 章の名前・進み具合のバー（「プロジェクト設定」の章の表示）
        sec = sections[si] if si < len(sections) else {}
        ss = settings.get("sections") or {}
        if ss.get("display", "none") != "none" and not sec.get("appendix") and slide.get("sectionShow") != "off" and sec.get("progress") is not None:
            mode = ss["display"]
            args = [py_str(sec.get("name", "") if mode in ("name", "both") else ""),
                    f"progress={_fmt_num(round(float(sec['progress']), 4))}" if mode in ("bar", "both") else "progress=None",
                    "spans=" + repr([[round(a, 4), round(b, 4)] for _n, a, b in sec.get("sections") or []]) if mode in ("bar", "both") else "spans=None",
                    f"current={int(sec.get('index', -1))}",
                    f'corner="{ss.get("position", "tl")}"', f'bar="{ss.get("bar", "top")}"',
                    f"font={py_str(settings.get('defaultFont') or '')}",
                    f"font_size={_fmt_num(round(float(ss.get('fontSize', 20)) * float(settings.get('fontSizeScale') or 1.0), 2))}",
                    f'color="{_color(ss.get("color"), settings["defaultColor"])}"', f'bar_color="{_color(ss.get("barColor"), "#58C4DD")}"']
            if use3d:
                args.append("fixed=True")
            if sec.get("name") or mode in ("bar", "both"):
                w.add(INDENT + f"self.section_mark = gui_section_mark(self, {', '.join(args)})", {"kind": "slide", "slideIndex": si})
        # 押すと飛ぶ要素（リンク）の位置を記録する
        for el in elements:
            if el.get("link") and el.get("var"):
                w.add(INDENT + f"self._gui_link({si}, {el['var']}, {py_str(el['link']['to'])})", {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
            # 参照（{ref:…}）の文字: 目印の色の形を元の色に戻し、そこを押すとラベルのスライドへ飛ぶ
            for mark, to, col in el.get("_refLinks") or [] if el.get("var") else []:
                w.add(INDENT + f"self._gui_ref_link({si}, {el['var']}, {py_str(mark.lower())}, {py_str(to)}, {py_str(col)})",
                      {"kind": "element", "slideIndex": si, "elementId": el["id"], "var": el["var"]})
        if use_trans:
            targs = [py_str(trans["kind"])]
            if trans["kind"] == "wipe":
                targs.append(f"direction={py_str(trans.get('dir', 'left'))}")
            if trans["kind"] == "zoom" and trans.get("out"):
                targs.append("out=True")
            targs.append(f"run_time={_fmt_num(float(trans.get('runTime', 1.0)))}")
            w.add(INDENT + f"gui_transition(self, _gui_prev, {', '.join(targs)})  # 前のスライドからの切り替え効果", {"kind": "slide", "slideIndex": si})
            for line, org in auto_media:
                w.add(line, org)
        if start_tail is not None:  # カメラが回り続けているので、初めの表示でクリックを待つ間も回して見せる
            w.add(INDENT + f"self.next_slide({', '.join(['gui_same_click=True', 'loop=True'] + next_slide_kwargs(False, False, slide.get('notes') or ''))})  # 回り続けるのを、クリックまでくり返して見せる", {"kind": "slide", "slideIndex": si})
            w.add(INDENT + f"self.gui_spin_wait({start_tail})", {"kind": "slide", "slideIndex": si})
        # 要素ごとのステップ番号（「要素 eq / ステップ3」の表示用）
        per_element: dict[str, int] = {}
        gid_here = {e["id"]: e.get("groupId") for e in slide["elements"] if e.get("groupId")}
        for k, step in enumerate(slide["steps"], start=1):
            if step.get("mode") == "gui":
                # GUI のステップ（動きの行）: 行ごとに、どの動きの行から作ったかを覚えておく（エラーの位置の表示用）
                var_of = lambda i: (by_id.get(i) or {}).get("var") if i else None  # noqa: E731
                tg = next((r.get("target") for r in step.get("rows") or [] if r.get("kind") == "anim" and var_of(r.get("target"))), None)
                origin = {"kind": "step", "slideIndex": si, "elementId": tg, "var": var_of(tg) or "", "stepId": step.get("id"),
                          "stepNo": k, "slideStepNo": k, "gui": True}
                w.add("")
                w.add(INDENT + f"# --- スライド {si + 1} / ステップ {k}（動き {sum(1 for r in step.get('rows') or [] if r.get('kind') != 'code')} 個）---")
                lines = animgen.step_lines(step, var_of, lambda i: gid_here.get(i), var_of)
                # 「ずっと回す」があれば、クリックを待つ間も回して見せる（1 周の区切りをくり返す）
                spin_update(step.get("rows") or [], var_of, spin_elem, spin_cam)
                tail = None if (step.get("loop") or step.get("autoNext")) else spin_period(spin_elem, spin_cam)
                plays = any(re.search(r"\bself\.(play|wait|move_camera)\(", ln) for ln, _ in lines)
                notes = segment_notes(slide.get('notes') or '', step.get('notes') or '', k)
                if tail is not None and not plays:  # 動きが無い（付け外しだけの）ステップは、そのまま 1 周をくり返す
                    kw = next_slide_kwargs(True, False, notes)
                else:
                    kw = next_slide_kwargs(step.get('loop'), step.get('autoNext') or tail is not None, notes)
                w.add(INDENT + f"self.next_slide({', '.join(['gui_key=' + py_str(str(slide.get('id')) + ':' + str(step.get('id')))] + kw)})", {"kind": "slide", "slideIndex": si})
                if not lines:
                    w.add(INDENT + "self.wait(0.1)  # （動きの無いステップ）", {**origin, "codeLine": 1})
                per_row: dict[str, int] = {}
                for n, (line, rid) in enumerate(lines, start=1):
                    per_row[rid] = per_row.get(rid, 0) + 1
                    w.lines.append((INDENT + line) if line.strip() else "")
                    w.origins[len(w.lines)] = {**origin, "codeLine": n, "rowId": rid, "rowLine": per_row[rid]}
                if tail is not None:
                    if plays:
                        w.add(INDENT + f"self.next_slide({', '.join(['gui_same_click=True'] + next_slide_kwargs(True, False, notes))})  # 回り続けるのを、クリックまでくり返して見せる", {"kind": "slide", "slideIndex": si})
                    w.add(INDENT + f"self.gui_spin_wait({tail})", {**origin, "codeLine": len(lines) + 1})
                continue
            el = by_id.get(step.get("elementId"))
            if el is None:
                continue
            per_element[el["id"]] = per_element.get(el["id"], 0) + 1
            origin = {"kind": "step", "slideIndex": si, "elementId": el["id"], "var": el["var"],
                      "stepId": step.get("id"), "stepNo": per_element[el["id"]], "slideStepNo": k}
            w.add("")
            w.add(INDENT + f"# --- スライド {si + 1} / ステップ {k}（{el['var']} の {per_element[el['id']]} 番目）---")
            w.add(INDENT + f"self.next_slide({', '.join(['gui_key=' + py_str(str(slide.get('id')) + ':' + str(step.get('id')))] + next_slide_kwargs(step.get('loop'), step.get('autoNext'), segment_notes(slide.get('notes') or '', step.get('notes') or '', k)))})", {"kind": "slide", "slideIndex": si})
            w.add_code(step.get("code") or "", origin)

    w.add("")
    w.add(INDENT + "# 最後の区間がアニメーション無しでも、スライドとして残す")
    w.add(INDENT + "if self.renderer.num_plays == self._gui_mark:")
    w.add(INDENT + "    self.wait(0.1)")
    if any(el.get("type") == "media" and el.get("mode") == "bake" for s in project["slides"] for el in s["elements"]):
        w.add(INDENT + "gui_media_flush(self)  # 再生中の、焼き込む音声を入れる")
    w.add(INDENT + "self._gui_save_pages()")
    source = "\n".join(w.lines) + "\n"
    mapping = {
        "formatVersion": 1,
        "className": cls,
        "lines": {str(k): v for k, v in sorted(w.origins.items())},
    }
    return source, mapping


def export(project: dict[str, Any], preamble: str, folder: Path, include: list[int] | None = None) -> dict[str, Any]:
    """描画するスライドを .py に書き出す（include: 今回だけ選んだスライドの番号。無ければ「描画しない」の印の無いスライド）。"""
    from .images import missing_images
    from .media import missing_media
    from .project import render_indices

    incl = set(render_indices(project, include))
    # 描画しないスライドの問題では止めない（変数名の重複など、スライドに結び付かない問題は止める）
    problems = [x for x in validate(project) + missing_images(project, folder) + missing_media(project, folder)
                if x.get("slideIndex") is None or x["slideIndex"] in incl]
    if problems:
        raise ExportError(problems)
    # プロジェクトのフォント（fonts/）があれば、.py の頭で登録する（「描画したあとに変わったか」の比べ方も同じ）
    source, mapping = generate({**project, "_projectFonts": bool(projfonts.files(folder))}, preamble, include=include)
    cls = mapping["className"]
    py = folder / f"{cls}.py"
    mp = folder / f"{cls}.map.json"
    py.write_text(source, encoding="utf-8", newline="\n")
    mp.write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"py": str(py), "map": str(mp), "className": cls, "lines": source.count("\n"), "slides": mapping["slides"],
            "include": include}
