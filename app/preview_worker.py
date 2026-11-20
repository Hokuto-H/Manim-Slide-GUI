"""テキストのプレビュー用に常駐する子プロセス（サーバーから起動される）。

Manim を一度だけ読み込んでおき、要求のたびに gui_text（書き出す .py と同じ関数）でテキストを組み立て、
Manim の実際の形（ベジェ曲線）を、1080p のピクセル単位の SVG にして返す。プレビューが実描画と一致する。

通信: 標準入力に 1 行 1 件の JSON、標準出力に 1 行 1 件の JSON。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PX_PER_UNIT = 1080 / 8  # Manim の 1 単位 = 1080p で 135px
LINE_WIDTH_PX = 0.01 * PX_PER_UNIT  # Manim の stroke_width 1 あたりのピクセル（Cairo の描画と同じ）


_PROTO = None  # 応答だけを書く出力（元の標準出力）


def _protect_stdout() -> None:
    """元の標準出力を応答専用にし、ほかの出力（Manim・LaTeX・ライブラリの警告など）はすべて標準エラーへ流す。
    応答の行の間に別の文字が混ざると、サーバーが応答を読み違える（前の要求の結果を返してしまう）ため。"""
    global _PROTO
    _PROTO = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", newline="\n")
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())  # C のライブラリや子プロセスが fd 1 に書いても、標準エラーへ
    sys.stdout = sys.stderr
    if os.name == "nt":  # Windows の子プロセス（LaTeX など）は fd ではなく標準ハンドルを受け継ぐので、それも付け替える
        try:
            import ctypes
            import msvcrt
            ctypes.windll.kernel32.SetStdHandle(-11, msvcrt.get_osfhandle(sys.stderr.fileno()))  # STD_OUTPUT_HANDLE
        except Exception:  # noqa: BLE001
            pass


def _send(obj) -> None:
    _PROTO.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _PROTO.flush()


def _fmt(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".") or "0"


def to_svg(mob, points: dict | None = None) -> dict:
    """mob の形を SVG にする。points（Manim の座標）は、SVG の中の位置（px）にして返す（基準点・線の両端など）。"""
    from manim import VMobject
    from manim.utils.family import extract_mobject_family_members

    members = extract_mobject_family_members([mob], use_z_index=True, only_those_with_points=True)
    if not members:
        return {"svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', "width": 1, "height": 1,
                "margin": 0, "points": {k: [0.5, 0.5] for k in (points or {})}}
    cx, cy = mob.get_center()[0], mob.get_center()[1]
    w_px = max(mob.width * PX_PER_UNIT, 1.0)
    h_px = max(mob.height * PX_PER_UNIT, 1.0)
    max_stroke = max((m.get_stroke_width() for m in members if isinstance(m, VMobject)), default=0)
    margin = max_stroke * LINE_WIDTH_PX / 2 + 2
    W, H = w_px + 2 * margin, h_px + 2 * margin
    parts = []
    for m in members:
        if not isinstance(m, VMobject):
            continue
        d = []
        for sp in m.get_subpaths():
            if len(sp) < 4:
                continue
            pts = [((p[0] - cx) * PX_PER_UNIT + W / 2, (cy - p[1]) * PX_PER_UNIT + H / 2) for p in sp]
            d.append(f"M{_fmt(pts[0][0])} {_fmt(pts[0][1])}")
            for k in range(0, len(pts) - 3, 4):
                h0, h1, a1 = pts[k + 1], pts[k + 2], pts[k + 3]
                if all(abs(q[0] - pts[k][0]) < 1.5 and abs(q[1] - pts[k][1]) < 1.5 for q in (h0, h1, a1)):
                    # 取っ手も含めてごく小さい曲線だけ（端どうしが近くても、取っ手が長ければ大きな曲線になるので、そのまま描く）
                    # ごく短い曲線（陰関数などに多い）は直線にする（制御点が向きを折り返していると、ブラウザの線に切れ目ができる）
                    if abs(a1[0] - pts[k][0]) >= 0.01 or abs(a1[1] - pts[k][1]) >= 0.01:
                        d.append(f"L{_fmt(a1[0])} {_fmt(a1[1])}")
                    continue
                d.append(f"C{_fmt(h0[0])} {_fmt(h0[1])} {_fmt(h1[0])} {_fmt(h1[1])} {_fmt(a1[0])} {_fmt(a1[1])}")
            if abs(sp[0][0] - sp[-1][0]) < 1e-6 and abs(sp[0][1] - sp[-1][1]) < 1e-6:
                d.append("Z")
        if not d:
            continue
        fo = float(m.get_fill_opacity())
        so = float(m.get_stroke_opacity())
        sw = float(m.get_stroke_width()) * LINE_WIDTH_PX
        attrs = [f'd="{" ".join(d)}"']
        attrs.append(f'fill="{m.get_fill_color().to_hex()}" fill-opacity="{fo:.3f}"' if fo > 0 else 'fill="none"')
        if sw > 0 and so > 0:
            attrs.append(f'stroke="{m.get_stroke_color().to_hex()}" stroke-opacity="{so:.3f}" stroke-width="{sw:.2f}" '
                         'stroke-linejoin="round" stroke-linecap="round"')
        parts.append(f"<path {' '.join(attrs)}/>")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.1f}" height="{H:.1f}" viewBox="0 0 {W:.1f} {H:.1f}">'
           + "".join(parts) + "</svg>")
    pts = {k: [round((p[0] - cx) * PX_PER_UNIT + W / 2, 2), round((cy - p[1]) * PX_PER_UNIT + H / 2, 2)]
           for k, p in (points or {}).items()}
    return {"svg": svg, "width": W, "height": H, "margin": round(margin, 2), "points": pts}


_CAM3D = None


def _setup_cam3d(c):
    """常駐の 3D のカメラを、スライドのカメラ（向き・拡大率・中心）に合わせる。描画と同じ、中心の不具合を直したカメラ。"""
    global _CAM3D
    from manim import DEGREES
    import shapekit as sk
    if _CAM3D is None:
        _CAM3D = sk._gui_three_d_camera_class()(background_opacity=0)
    cam = _CAM3D
    cam.set_phi(c["phi"] * DEGREES)
    cam.set_theta(c["theta"] * DEGREES)
    cam.set_gamma(0)
    cam.set_zoom(c["zoom"])
    cam._frame_center.move_to([c["x"], c["y"], 0])
    cam.rotation_matrix = cam.generate_rotation_matrix()
    return cam


def _make_3d(req, tex_template):
    """3D の要素 1 つの形（Manim の物）と、基準点（空間の座標）。"""
    import numpy as np
    import shapekit as sk
    kw = dict(req.get("kwargs") or {})
    axes = sk.gui_axes3d(**req["axes"]) if req.get("axes") else None
    shape = req["shape"]
    if shape == "solid":
        mob = sk.gui_solid(req["solid"], **kw)
        anchor = kw.get("pos", (0, 0, 0))
    elif shape == "axes3d":
        if kw.get("x_label") is not None:
            kw["tex_template"] = tex_template(req.get("preamble", ""))
        mob = sk.gui_axes3d(**kw)
        anchor = kw.get("pos", (0, 0, 0))
    elif shape == "surface" and req.get("param"):
        mob = sk.gui_psurface(axes, *req["exprs"], **kw)
        anchor = req["axes"].get("pos", (0, 0, 0))
    elif shape == "surface":
        mob = sk.gui_surface(axes, req["expr"], **kw)
        anchor = req["axes"].get("pos", (0, 0, 0))
    elif shape == "curve3d":
        mob = sk.gui_curve3d(axes, *req["exprs"], **kw)
        anchor = req["axes"].get("pos", (0, 0, 0))
    else:
        mob = sk.gui_point3d(req["point"], axes=axes, **kw)
        if axes is not None:
            anchor = req["axes"].get("pos", (0, 0, 0))
        else:
            # 式の座標もあるので、作った形から位置を読む
            if req["point"] == "dot":
                a = b = np.array(mob.get_center())
            else:
                a, b = np.array(mob.get_start()), np.array(mob.get_end())
            anchor = tuple((a + b) / 2)
    return mob, anchor


def render_3d_scene(req, tex_template) -> dict:
    """スライドの 3D の要素を、まとめて 1 枚に描く（描画と同じく、すべての物の面を、近さの順に重ねる）。
    返す: 写っている所だけを切り出した PNG と、その左上の位置（キャンバスの px）。"""
    import base64
    import io
    items = req["items"]
    cam = _setup_cam3d(items[0]["camera"])
    mobs = []
    for it in items:
        try:
            mobs.append(_make_3d(it, tex_template)[0])
        except Exception:  # noqa: BLE001 — 作れない物は飛ばす（その物の絵の所で知らせる）
            continue
    cam.reset()
    cam.capture_mobjects(mobs)
    img = cam.get_image()
    box = img.getbbox()
    if box is None:
        return {"png": None}
    crop = img.crop(box)
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    return {"png": base64.b64encode(buf.getvalue()).decode("ascii"), "x": box[0], "y": box[1], "width": crop.width, "height": crop.height}


def render_3d(req, tex_template) -> dict:
    """3D の要素を、スライドのカメラ（向き・拡大率・中心）から見た 1080p の画像にして、写っている所だけを切り出す。
    anchor は要素の基準点が画面に写る位置（px）、basis は画面の右・上の向き（ドラッグで動かした量を空間の向きに直すため）。"""
    global _CAM3D
    import base64
    import io

    import numpy as np
    from manim import DEGREES
    import shapekit as sk

    cam = _setup_cam3d(req["camera"])
    c = req["camera"]
    mob, anchor = _make_3d(req, tex_template)
    cam.reset()
    cam.capture_mobjects([mob])
    img = cam.get_image()
    p = cam.project_point(np.array(anchor, dtype=float))
    ax, ay = 960 + p[0] * PX_PER_UNIT, 540 - p[1] * PX_PER_UNIT
    box = img.getbbox()
    if box is None:  # 画面の外
        box = (int(ax), int(ay), int(ax) + 1, int(ay) + 1)
    pad = 2
    x0, y0 = max(0, box[0] - pad), max(0, box[1] - pad)
    x1, y1 = min(img.width, box[2] + pad), min(img.height, box[3] + pad)
    crop = img.crop((x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)))
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    rot = cam.get_rotation_matrix()
    return {"png": base64.b64encode(buf.getvalue()).decode("ascii"), "width": crop.width, "height": crop.height,
            "margin": 0, "points": {"origin": [round(ax - x0, 2), round(ay - y0, 2)]}, "anchor": [round(ax, 2), round(ay, 2)],
            "basis": {"r": [float(v) for v in rot[0]], "u": [float(v) for v in rot[1]], "s": PX_PER_UNIT * c["zoom"]},
            # カメラからの近さ（中心をカメラの向きに測った値。大きいほど手前）。キャンバスで 3D の物を奥行きの順に重ねるため
            "depth": float(np.dot(rot[2], np.array(mob.get_center(), dtype=float)))}


def main() -> None:
    _protect_stdout()
    tmp = tempfile.mkdtemp(prefix="msg-preview-")
    from manim import config

    config.media_dir = tmp
    config.verbosity = "ERROR"
    from textkit import gui_text  # noqa: E402 — Manim の設定のあとで読み込む
    import shapekit  # noqa: E402
    from shapekit import (gui_axdot, gui_axes, gui_balloon_shape, gui_brace, gui_field, gui_graph, gui_number,  # noqa: E402
                          gui_shape, gui_table)
    shapekit.gui_text = gui_text  # 表のテキストのセル（書き出す .py では、同じファイルの gui_text を使う）
    from constants import JP_FIXED_PREAMBLE, JP_TAIL_PREAMBLE  # noqa: E402

    templates: dict = {}
    registered: dict = {}  # 登録したフォントのファイル → ファミリー名

    def tex_template(preamble: str):
        """書き出しと同じ TexTemplate（XeLaTeX、日本語、共通プリアンブル）。プリアンブルごとに作っておく。"""
        if preamble not in templates:
            from manim import TexTemplate
            t = TexTemplate(tex_compiler="xelatex", output_format=".xdv")
            t.add_to_preamble("\n".join([*JP_FIXED_PREAMBLE, preamble or "", *JP_TAIL_PREAMBLE]))
            from tikzfix import apply as _tikz_apply, uses_tikz  # noqa: E402
            if uses_tikz(preamble):  # TikZ（chemfig など）の線を、描画と同じように見えるようにする
                _tikz_apply()
            templates.clear()
            templates[preamble] = t
        return templates[preamble]

    _send({"ready": True})
    req = {}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            kind = req.get("kind", "text")
            if kind == "fonts":
                # プロジェクトのフォント（fonts/）を登録し、ファイルごとに増えたファミリー名を返す
                import manimpango
                fams: dict = {}
                for path in req.get("paths") or []:
                    if path not in registered:
                        before = set(manimpango.list_fonts())
                        ok = False
                        try:
                            ok = bool(manimpango.register_font(path))
                        except Exception:  # noqa: BLE001
                            ok = False
                        registered[path] = sorted(set(manimpango.list_fonts()) - before) if ok else []
                        import textkit  # フォントが増えたので、前に測った文字の形・幅は使わない
                        textkit._gui_cache.clear()
                    fams[path] = registered[path]
                _send({"id": req.get("id"), "ok": True, "families": fams})
                continue
            if kind == "shape":
                kw = dict(req["kwargs"])
                if kw.get("label") or kw.get("name"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                mob = gui_shape(req["shape"], **kw)
                pts = {"origin": (0, 0)}
                if req["shape"] == "line":
                    pts.update(p1=kw["start"], p2=kw["end"])
                if getattr(mob, "name_label", None) is not None:  # 点の名前の中心（キャンバスでドラッグする丸の位置）
                    c = mob.name_label.get_center()
                    pts["nm"] = (c[0], c[1])
                out = to_svg(mob, pts)
            elif kind == "axes":
                kw = dict(req["kwargs"])
                if kw.get("x_label") or kw.get("y_label"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                ax = gui_axes(**kw)
                if req.get("basis"):  # 線形変換の平面の基底ベクトル（変換の前の方眼は、平面と重なるので描かない）
                    ax = shapekit.gui_linear(ax, background=False, basis=True)
                pts = {"origin": (0, 0)}
                if getattr(ax, "labels", None) is not None:  # 軸ラベルの中心（キャンバスでドラッグする丸の位置）
                    for name, lab, text in (("xl", ax.labels[0], kw.get("x_label")), ("yl", ax.labels[1], kw.get("y_label"))):
                        if text:
                            c = lab.get_center()
                            pts[name] = (c[0], c[1])
                out = to_svg(ax, pts)
            elif kind == "graph":
                axes = gui_axes(**req["axes"])
                out = to_svg(gui_graph(axes, req["expr"], **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "table":
                kw = dict(req["kwargs"])
                if req.get("math"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(gui_table(req["cells"], **kw), {"origin": (0, 0)})
            elif kind == "field":
                axes = gui_axes(**req["axes"]) if req.get("axes") else None
                mob = gui_field(req["field"], req["fx"], req["fy"], axes=axes, params=req.get("params"), **req["kwargs"])
                if not mob.submobjects:
                    raise ValueError("描くものがありません（ベクトルがすべて 0、または範囲の外です）")
                out = to_svg(mob, {"origin": (0, 0)})
            elif kind == "matrix":
                out = to_svg(shapekit.gui_matrix(req["cells"], tex_template=tex_template(req.get("preamble", "")), **req["kwargs"]),
                             {"origin": (0, 0)})
            elif kind == "angle":
                import numpy as _np
                from manim import Line
                from manim.utils.space_ops import line_intersection
                (a0, a1), (b0, b1) = [[[p[0], p[1], 0.0] for p in ln] for ln in req["lines"]]
                l1, l2 = Line(a0, a1), Line(b0, b1)
                inter = line_intersection([l1.get_start(), l1.get_end()], [l2.get_start(), l2.get_end()])
                kw = dict(req["kwargs"])
                if kw.get("label"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(shapekit.gui_angle(l1, l2, **kw), {"origin": (float(inter[0]), float(inter[1]))})
                # 角の基準点（2 本の線の交わる所）の、キャンバスの位置
                out["anchor"] = [round(960 + float(inter[0]) * PX_PER_UNIT, 2), round(540 - float(inter[1]) * PX_PER_UNIT, 2)]
                _ = _np
            elif kind in ("graphpart", "curve2d", "implicit", "polar", "complex"):
                axes = gui_axes(**req["axes"])
                fn = {"curve2d": shapekit.gui_curve2d, "implicit": shapekit.gui_implicit, "polar": shapekit.gui_polar,
                      "complex": shapekit.gui_complex_curve}.get(kind) or \
                    {"area": shapekit.gui_area, "riemann": shapekit.gui_riemann, "tangent": shapekit.gui_tangent, "secant": shapekit.gui_secant,
                     "derivative": shapekit.gui_derived, "antiderivative": shapekit.gui_derived,
                     "glabel": shapekit.gui_graph_label, "tlabel": shapekit.gui_t_label}[req["part"]]
                kw = dict(req["kwargs"])
                extra = []
                if kind == "graphpart" and req["part"] in ("derivative", "antiderivative"):
                    extra = [req["part"]]
                if kind == "graphpart" and req["part"] in ("glabel", "tlabel") and kw.get("label"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                mob = fn(axes, *req["exprs"], *extra, **kw)
                if not mob.family_members_with_points():
                    raise ValueError("描くものがありません（範囲や式を確かめてください）")
                out = to_svg(mob, {"origin": (0, 0)})
            elif kind == "points":
                axes = gui_axes(**req["axes"])
                mob = shapekit.gui_points(axes, **req["kwargs"])
                out = to_svg(mob, {"origin": (0, 0)})
                out["info"] = getattr(mob, "gui_info", "")
            elif kind == "linegraph":
                axes = gui_axes(**req["axes"])
                out = to_svg(shapekit.gui_line_graph(axes, req["xs"], req["ys"], **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "annot":
                from manim import Rectangle
                w, h = req["box"]
                target = Rectangle(width=max(w, 1e-4), height=max(h, 1e-4)).set_stroke(width=0)  # 付ける要素の外接矩形（中心が原点）
                out = to_svg(shapekit.gui_annot(req["annot"], target, **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "arcbrace":
                kw = dict(req["kwargs"])
                if kw.get("label"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(shapekit.gui_arcbrace((0.0, 0.0), **kw), {"origin": (0, 0)})  # 基準点は円弧の中心
            elif kind == "vector":
                axes = gui_axes(**req["axes"]) if req.get("axes") else None
                out = to_svg(shapekit.gui_vector(axes, *req["exprs"][:2], x0=req["exprs"][2], y0=req["exprs"][3], **req["kwargs"]),
                             {"origin": (0, 0)})
            elif kind == "netgraph":
                kw = dict(req["kwargs"])
                if kw.get("labels"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                g = shapekit.gui_netgraph(req["names"], [tuple(x) for x in req["edges"]], **kw)
                pts = {"origin": (0, 0)}
                layout = {}
                for i, n in enumerate(req["names"]):  # 頂点の位置（キャンバスでドラッグする丸と、「手で動かす」にしたときの初めの位置）
                    c = g.vertices[n].get_center()
                    pts[f"n{i}"] = (c[0], c[1])
                    layout[n] = [round(float(c[0]), 3), round(float(c[1]), 3)]
                out = to_svg(g, pts)
                out["layout"] = layout
            elif kind == "samplespace":
                out = to_svg(shapekit.gui_sample_space(tex_template=tex_template(req.get("preamble", "")), **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "code":
                out = to_svg(shapekit.gui_code(req["code"], **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "statchart":
                kw = dict(req["kwargs"])
                kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(shapekit.gui_statchart(req["chartKind"], **kw), {"origin": (0, 0)})
            elif kind == "barchart":
                kw = dict(req["kwargs"])
                if req.get("tex"):
                    kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(shapekit.gui_barchart(req["values"], **kw), {"origin": (0, 0)})
            elif kind == "tex":
                kw = dict(req["kwargs"])
                tpl = tex_template(req.get("preamble", ""))
                if req["what"] == "bullets":
                    mob = shapekit.gui_bullets(req["body"], tex_template=tpl, **kw)
                elif req["what"] == "theorem":
                    mob = shapekit.gui_theorem(req["head"], req["body"], tex_template=tpl, **kw)
                elif req["what"] == "title":
                    mob = shapekit.gui_title(req["body"], tex_template=tpl, **kw).move_to([0, 0, 0])
                else:
                    from manim import Tex
                    mob = Tex(req["body"], tex_template=tpl, **kw).move_to([0, 0, 0])
                out = to_svg(mob, {"origin": (0, 0)})
            elif kind == "boolean":
                # 書き出しと同じ式（元の図形 → gui_boolean）を、Manim と補助関数の名前で実行する
                ns: dict = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["tpl"] = tex_template(req.get("preamble", ""))
                exec(req["code"], ns)  # noqa: S102
                mob = ns["_gui_result"]
                if not mob.family_members_with_points():
                    raise ValueError("合成した結果が空です（図形が重なっていない可能性があります）")
                out = to_svg(mob, {"origin": (0, 0)})
                out["anchor"] = [960.0, 540.0]  # 合成した図形は、元の図形の位置そのまま（基準点はスライドの中心）
            elif kind == "part":
                # 部品（要素のテンプレート）: 書き出しと同じ式で中身を作る。基準点は部品の中心
                ns: dict = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["gui_text"] = gui_text
                ns["tpl"] = tex_template(req.get("preamble", ""))
                exec(req["code"], ns)  # noqa: S102
                mob = ns["_gui_result"]
                if not mob.family_members_with_points():
                    raise ValueError("部品の中身が空です")
                # 基準点は部品の原点（保存したときの中心）。書き出しも、原点のまわりで拡大・回転してから基準点を置く
                out = to_svg(mob, {"origin": (0, 0)})
            elif kind == "parts":
                # 要素の部品（1 段目・2 段目）の外接矩形（Manim の座標）。ステップで要素の一部分を選ぶため。書き出しと同じ式で作る
                ns: dict = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["gui_text"] = gui_text
                ns["tpl"] = tex_template(req.get("preamble", ""))
                exec(req["code"], ns)  # noqa: S102
                mob = ns["_gui_result"]

                def box(m):
                    if not m.family_members_with_points():
                        return None
                    lo, hi = m.get_corner([-1, -1, 0]), m.get_corner([1, 1, 0])
                    return [round(float(lo[0]), 4), round(float(lo[1]), 4), round(float(hi[0]), 4), round(float(hi[1]), 4)]

                items = []
                for i, a in enumerate(mob.submobjects[:400]):
                    b = box(a)
                    if b is None or getattr(a, "_gui_wrap_strut", False):  # 折り返し幅の見えない線は選ばせない
                        continue
                    items.append({"path": [i], "box": b, "n": len(a.submobjects)})
                    for j, c in enumerate(a.submobjects[:400]):
                        bb = box(c)
                        if bb is not None and not getattr(c, "_gui_wrap_strut", False):
                            items.append({"path": [i, j], "box": bb, "n": len(c.submobjects)})
                out = {"items": items, "box": box(mob)}
            elif kind == "outline":
                # 要素の輪郭（Manim の座標の折れ線）。画像を図形の形に切り抜くときの、キャンバスの表示用。書き出しと同じ式で作る
                ns: dict = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["gui_text"] = gui_text
                ns["tpl"] = tex_template(req.get("preamble", ""))
                exec(req["code"], ns)  # noqa: S102
                out = {"polys": shapekit.gui_outline(ns["_gui_result"])}
            elif kind == "pathpts":
                # 線に沿って動くときの線の点（Manim の座標）。書き出しと同じ式（付いている座標軸なども）で作る
                ns: dict = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["gui_text"] = gui_text
                ns["tpl"] = tex_template(req.get("preamble", ""))
                ns["gui_redraw"] = lambda f: f()
                exec(req["code"], ns)  # noqa: S102
                line = shapekit.gui_path(ns["_gui_result"])
                n = int(req.get("n", 64))
                pts = [line.point_from_proportion(i / (n - 1)) for i in range(n)]
                out = {"pts": [[round(float(q[0]), 4), round(float(q[1]), 4)] for q in pts]}
            elif kind == "fcurve":
                ex = req["exprs"]
                kw = dict(req["kwargs"])
                if req["curve"] == "parametric":
                    kw.update(x=ex[0], y=ex[1])
                else:
                    kw["expr"] = ex[0]
                mob = shapekit.gui_fcurve(req["curve"], **kw)
                if not mob.family_members_with_points():
                    raise ValueError("描く線がありません（範囲の中で式の値が求まらない可能性があります）")
                out = to_svg(mob, {"origin": (0, 0)})
            elif kind == "cells":
                # 要素を入れた表・行列。セルの要素は描かず（透明にして）、表に入れたあとの位置だけを返す
                ns = {}
                exec("from manim import *", ns)  # noqa: S102 — サーバーが作った式だけを実行する
                ns.update({k: v for k, v in vars(shapekit).items() if k.startswith("gui_") or k.startswith("_gui")})
                ns["tpl"] = tex_template(req.get("preamble", ""))
                exec(req["code"], ns)  # noqa: S102
                mob, before = ns["_gui_result"], ns["_gui_before"]
                pts = {"origin": (0.0, 0.0)}
                for name, it in ns["_gui_items"].items():
                    d = it.get_center() - before[name]  # 要素の基準点（作ったときは原点）が、表に入れて動いた量
                    pts[name] = (float(d[0]), float(d[1]))
                    it.set_opacity(0)
                out = to_svg(mob, pts)
            elif kind == "svg":
                out = to_svg(shapekit.gui_svg(req["path"], **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "3d":
                out = render_3d(req, tex_template)
            elif kind == "3dscene":
                out = render_3d_scene(req, tex_template)
            elif kind == "axdot":
                axes = gui_axes(**req["axes"])
                out = to_svg(gui_axdot(axes, req["x"], req["y"], **req["kwargs"]), {"origin": (0, 0)})
            elif kind == "number":
                kw = dict(req["kwargs"])
                kw["tex_template"] = tex_template(req.get("preamble", ""))
                out = to_svg(gui_number(req["value"], **kw), {"origin": (0, 0)})
            elif kind == "brace":
                kw = req["kwargs"]
                if req.get("box"):  # 付ける要素の外接矩形（中心が原点）
                    from manim import Rectangle
                    w, h = req["box"]
                    target = Rectangle(width=max(w, 1e-4), height=max(h, 1e-4)).set_stroke(width=0)
                    g = gui_brace(target=target, **kw)
                else:
                    g = gui_brace(start=req["start"], end=req["end"], **kw)
                tip = g.brace.get_tip()
                pts = {"origin": (0, 0), "tip": (tip[0], tip[1])}
                if not req.get("box"):
                    pts.update(p1=req["start"], p2=req["end"])
                out = to_svg(g.brace, pts)
                import numpy as _np
                d = _np.round(g.brace.get_direction())  # ラベルを置く向き（put_at_tip と同じ）
                out["tipDir"] = [float(d[0]), float(d[1])]
            elif kind == "balloon":
                kw = req["kwargs"]
                mob = gui_balloon_shape(**kw)
                pts = {"origin": (0, 0)}
                if kw.get("tail"):
                    pts["tail"] = kw["tail"]
                out = to_svg(mob, pts)
            else:
                mob = gui_text(req["runs"], **req["kwargs"])
                out = to_svg(mob)
            _send({"id": req.get("id"), "ok": True, **out})
        except Exception as e:  # noqa: BLE001 — エラーは呼び出し元に返す
            _send({"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})


if __name__ == "__main__":
    main()
