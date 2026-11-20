# ---- Manim Slide GUI: 図形の補助関数（gui_shape・gui_balloon）----
# 書き出す .py にそのまま埋め込む。プレビュー（常駐する Manim）も同じ関数で形を作るので、キャンバスと描画が一致する。
# 長さは Manim の単位。図形は「基準点」を原点にして作る（線: 両端の中点、吹き出し: 箱の中心、ほか: 外接矩形の中心）。
# 呼び出し側で .shift(位置) し、必要なら位置を軸に .rotate(...) する。

import math as _gui_math

from manim import (
    AnnotationDot, AnnularSector, Annulus, Arc, ArcBetweenPoints, ArcPolygon, Circle, DashedLine, DashedVMobject, Dot,
    Elbow, Ellipse, Line, MathTex, Polygon, Rectangle, RegularPolygon, RegularPolygram, RoundedRectangle, Sector, Star,
    VMobject, ORIGIN,
)


def _gui_style(m, stroke_color, stroke_width, stroke_opacity, fill_color, fill_opacity):
    m.set_stroke(color=stroke_color, width=stroke_width, opacity=stroke_opacity)
    m.set_fill(color=fill_color or stroke_color, opacity=fill_opacity)
    return m


def _gui_dash(m, dash_length, dashed_ratio=0.5):
    """閉じた図形などを破線にする（長さから破線の数を決める）。"""
    try:
        length = sum(
            _gui_math.dist(a[:2], b[:2])
            for sp in m.get_subpaths() for a, b in zip(sp[::4], sp[3::4])
        )
    except Exception:  # noqa: BLE001
        length = 2 * (m.width + m.height)
    n = max(2, int(round(length / max(dash_length, 0.01) / 2)))
    return DashedVMobject(m, num_dashes=n, dashed_ratio=dashed_ratio)


def _gui_label_tex(label, label_size, label_color, tex_template):
    return MathTex(label, tex_template=tex_template, font_size=label_size, color=label_color)


def gui_shape(kind, width=1.0, height=1.0, radius=0.5, sides=6, inner_ratio=0.4, corner_radius=0.0,
              start=(-1.0, 0.0), end=(1.0, 0.0), start_tip=False, end_tip=False, tip_length=0.25, tip_width=0.25,
              start_angle=0.0, angle=90.0, sector=False, paths=(), closed=False,
              stroke_color="#222222", stroke_width=4.0, stroke_opacity=1.0, fill_color=None, fill_opacity=0.0,
              dashed=False, dash_length=0.15, arc_angle=0.0, inner_radius=0.5, edge_arc=0.0, polygram=False, density=2,
              ring=False, label=None, label_pos=0.5, label_size=36, label_color=None, label_bg=None, label_frame=False,
              tex_template=None, tip_shape="triangle", tip_ratio=None, gradient=None,
              name=None, name_dir=(1.0, 1.0), name_shift=None, name_size=36, name_color="#222222", name_buff=0.1):
    """GUI の図形。kind: line / rect / ellipse / polygon / star / arc / dot / path / annulus / elbow。
    path は手書き・ベジェ曲線: paths は線（ひと筆）ごとの点の一覧で、点は (x, y, 入る側の取っ手 dx, dy, 出る側の取っ手 dx, dy)。
    線: arc_angle（度）が 0 でなければ、両端を結ぶ弧（ArcBetweenPoints。矢じりを付けると CurvedArrow と同じ形）。
        label（数式）を付けると、線の途中（label_pos: 0 = 始点、1 = 終点）にラベルを置く（LabeledLine と同じ作り。.label で参照）。
    点: ring=True で輪の付いた点（AnnotationDot）。label を付けると、点の中に数式を置く（LabeledDot と同じ作り。.label で参照）。
        name を付けると、点の外側に名前（数式。A・P' など）を置く（.name_label で参照）。向きは name_dir（点から離す向き）、
        name_shift（点の中心からのずれ。Manim の単位）を渡すとその位置。名前は点の一部なので、点と一緒に出る・動く。
    正多角形: edge_arc（度）が 0 でなければ、辺を弧にする（ArcPolygon。正で外側に膨らむ）。
    星: polygram=True で、頂点を density 個おきに結ぶ星形多角形（RegularPolygram）。
    円環: annulus（Annulus。sector=True で AnnularSector）。elbow: 直角の印（Elbow）。
    矢じりの形 tip_shape: triangle（塗り）・triangle_outline・stealth・circle・circle_outline・square・square_outline。
    tip_ratio を渡すと、矢じりの長さを線の長さ × tip_ratio までにする（Arrow と同じく、短い矢印では矢じりも小さく）。
    長方形・楕円・多角形・星・閉じた曲線に label を付けると、形の内側のいちばん広い所に置く（LabeledPolygram と同じ置き方）。"""
    style = (stroke_color, stroke_width, stroke_opacity, fill_color, fill_opacity)
    if kind == "path":
        m = VMobject()
        for nodes in paths:
            if len(nodes) < 2:
                continue
            segs = list(zip(nodes, nodes[1:])) + ([(nodes[-1], nodes[0])] if closed else [])
            m.start_new_path([nodes[0][0], nodes[0][1], 0.0])
            for a, b in segs:  # a の出る側の取っ手 → b の入る側の取っ手 → b
                m.add_cubic_bezier_curve_to(
                    [a[0] + a[4], a[1] + a[5], 0.0], [b[0] + b[2], b[1] + b[3], 0.0], [b[0], b[1], 0.0])
        _gui_style(m, *style)
        out = _gui_dash(m, dash_length) if dashed else m
        if gradient and not closed:
            return _gui_gradient(out, gradient, stroke_width)
        return _gui_shape_label(m, out, label, label_size, label_color or stroke_color, label_bg, label_frame, tex_template) if closed else out
    if kind == "line":
        s, e = [start[0], start[1], 0.0], [end[0], end[1], 0.0]
        curved = abs(arc_angle) > 1e-6
        if curved:
            m = ArcBetweenPoints(s, e, angle=_gui_math.radians(arc_angle))
        else:
            m = DashedLine(s, e, dash_length=dash_length) if dashed else Line(s, e)
        _gui_style(m, *style)
        m.set_fill(opacity=0)
        # ラベルの位置は、矢じりを付ける前（線の長さが変わる前）の線の上で決める
        label_point = m.point_from_proportion(min(max(label_pos, 0.0), 1.0)) if curved else \
            [s[0] + (e[0] - s[0]) * label_pos, s[1] + (e[1] - s[1]) * label_pos, 0.0]
        tcls = _gui_tip_class(tip_shape)
        tl, tw = tip_length, tip_width
        if tip_ratio:  # 短い線では矢じりも小さく（Arrow の max_tip_length_to_length_ratio と同じ考え方）
            k = min(1.0, m.get_arc_length() * tip_ratio / max(tip_length, 1e-9)) if curved else \
                min(1.0, _gui_math.dist(s[:2], e[:2]) * tip_ratio / max(tip_length, 1e-9))
            tl, tw = tip_length * k, tip_width * k
        if end_tip:
            m.add_tip(tip_shape=tcls, tip_length=tl, tip_width=tw)
        if start_tip:
            m.add_tip(tip_shape=tcls, tip_length=tl, tip_width=tw, at_start=True)
        outline = str(tip_shape).endswith("_outline")
        for t in m.get_tips():  # 矢じりは線の色で塗る（輪郭だけの矢じりは塗らない）
            t.set_fill(color=stroke_color, opacity=0 if outline else stroke_opacity)
            t.set_stroke(color=stroke_color, width=stroke_width, opacity=stroke_opacity)
        if curved and dashed:  # 弧の破線: 弧だけを破線にして、矢じりはそのまま付け直す
            tips = m.pop_tips() if (start_tip or end_tip) else []
            m = _gui_dash(m, dash_length)
            m.add(*tips)
        if gradient and not (start_tip or end_tip):  # 矢じりの無い線だけ、線に沿って色を変える
            m = _gui_gradient(m, gradient, stroke_width)
        if label:
            lab = _gui_label_box(_gui_label_tex(label, label_size, label_color or stroke_color, tex_template), label_bg, label_frame,
                                 label_color or stroke_color)
            lab.move_to(label_point)
            m.add(lab)
            m.label = lab
        return m
    if kind == "dot":
        tex = _gui_label_tex(label, label_size, label_color or "#000000", tex_template) if label else None
        r = radius
        if tex is not None:  # 数式が収まる大きさにする（LabeledDot と同じ）
            r = max(r, 0.1 + _gui_math.hypot(tex.width, tex.height) / 2)
        fc = fill_color or stroke_color
        if ring:
            m = AnnotationDot(radius=r, stroke_width=stroke_width, stroke_color=stroke_color, fill_color=fc)
            m.set_fill(opacity=fill_opacity if fill_opacity > 0 else 1.0)
            m.set_stroke(opacity=stroke_opacity)
        else:
            m = Dot(ORIGIN, radius=r)
            m.set_fill(color=fc, opacity=fill_opacity if fill_opacity > 0 else 1.0)
            m.set_stroke(width=0)
        if tex is not None:
            tex.move_to(m.get_center())
            m.add(tex)
            m.label = tex
        if name:
            lab = _gui_label_tex(name, name_size, name_color, tex_template)
            if name_shift is not None:
                lab.move_to([name_shift[0], name_shift[1], 0.0])
            else:
                dx, dy = float(name_dir[0]), float(name_dir[1])
                n = _gui_math.hypot(dx, dy) or 1.0
                dx, dy = dx / n, dy / n
                # 点の縁から name_buff 離し、名前の箱がその向きに収まるように（next_to を斜めにも広げた置き方）
                d = r + name_buff + abs(dx) * lab.width / 2 + abs(dy) * lab.height / 2
                lab.move_to([dx * d, dy * d, 0.0])
            m.add(lab)
            m.name_label = lab
        return m
    if kind == "annulus":
        ir = min(max(inner_radius, 0.0), radius * 0.999)
        if sector:
            m = AnnularSector(inner_radius=ir, outer_radius=radius, angle=_gui_math.radians(angle),
                              start_angle=_gui_math.radians(start_angle))
        else:
            m = Annulus(inner_radius=ir, outer_radius=radius)
        _gui_style(m, *style)
        return _gui_dash(m, dash_length) if dashed else m
    if kind == "arc":
        a0, da = _gui_math.radians(start_angle), _gui_math.radians(angle)
        if sector:
            m = Sector(radius=radius, start_angle=a0, angle=da, arc_center=ORIGIN)
        else:
            m = Arc(radius=radius, start_angle=a0, angle=da, arc_center=ORIGIN)
        _gui_style(m, *style)
        if not sector:
            m.set_fill(opacity=0)
        out = _gui_dash(m, dash_length) if dashed else m
        return _gui_gradient(out, gradient, stroke_width) if gradient and not sector else out
    if kind == "rect":
        r = min(corner_radius, width / 2, height / 2)
        m = RoundedRectangle(width=width, height=height, corner_radius=r) if r > 1e-6 else Rectangle(width=width, height=height)
    elif kind == "ellipse":
        m = Circle(radius=width / 2) if abs(width - height) < 1e-9 else Ellipse(width=width, height=height)
    elif kind in ("polygon", "star"):
        n = max(3, int(sides))
        if kind == "polygon":
            m = RegularPolygon(n=n)
        elif polygram:
            m = RegularPolygram(n, density=max(1, int(density)))
        else:
            m = Star(n=n, outer_radius=1, inner_radius=inner_ratio)
        m.stretch(width / max(m.width, 1e-9), 0, about_point=ORIGIN)
        m.stretch(height / max(m.height, 1e-9), 1, about_point=ORIGIN)
        if kind == "polygon" and abs(edge_arc) > 1e-6:
            m = ArcPolygon(*m.get_vertices(), angle=_gui_math.radians(edge_arc))
    elif kind == "elbow":
        m = Elbow(width=radius)
    else:
        raise ValueError(f"未知の図形: {kind}")
    m.move_to(ORIGIN)
    _gui_style(m, *style)
    return _gui_shape_label(m, _gui_dash(m, dash_length) if dashed else m, label, label_size, label_color or stroke_color,
                            label_bg, label_frame, tex_template)


def _gui_tip_class(name):
    from manim import (ArrowCircleFilledTip, ArrowCircleTip, ArrowSquareFilledTip, ArrowSquareTip, ArrowTriangleFilledTip,
                       ArrowTriangleTip, StealthTip)
    return {"triangle_outline": ArrowTriangleTip, "stealth": StealthTip, "circle": ArrowCircleFilledTip,
            "circle_outline": ArrowCircleTip, "square": ArrowSquareFilledTip, "square_outline": ArrowSquareTip}.get(
        name, ArrowTriangleFilledTip)


def _gui_label_box(tex, bg, frame, color):
    from manim.mobject.geometry.labeled import Label
    return Label(tex, box_config={"color": bg or "#FFFFFF", "fill_opacity": 1 if bg else 0, "stroke_width": 0, "buff": 0.08},
                 frame_config={"color": color, "stroke_width": 1.5 if frame else 0, "buff": 0.08})


def _gui_shape_label(base, m, label, label_size, label_color, label_bg, label_frame, tex_template):
    """閉じた形の内側のいちばん広い所（polylabel。LabeledPolygram と同じ）にラベルを置く。base は形（破線にする前）。"""
    if not label:
        return m
    import numpy as _np
    from manim.utils.polylabel import polylabel
    rings = [[p[:2] for p in sp[::4]] + [sp[-1][:2]] for sp in base.get_subpaths() if len(sp) >= 4]
    try:
        c = polylabel([_np.array(r) for r in rings if len(r) >= 3], precision=0.01).c
        point = [float(c[0]), float(c[1]), 0.0]
    except Exception:  # noqa: BLE001 — 求められないときは中心
        point = base.get_center()
    lab = _gui_label_box(_gui_label_tex(label, label_size, label_color, tex_template), label_bg, label_frame, label_color)
    lab.move_to(point)
    m.add(lab)
    m.label = lab
    return m


def _gui_balloon_outline(w, h, shape, corner_radius, tail, tail_width):
    """箱（中心が原点、幅 w・高さ h）と、尾の先 tail（原点からの位置。None なら尾なし）の吹き出しの輪郭。
    楕円は、箱（中身＋余白）の四隅を通る大きさ（幅・高さの √2 倍）にして、中身が必ず楕円の中に収まるようにする。"""
    if shape == "ellipse":
        w, h = w * _gui_math.sqrt(2), h * _gui_math.sqrt(2)
        body = Ellipse(width=w, height=h)
    else:
        r = min(corner_radius, w / 2, h / 2)
        body = RoundedRectangle(width=w, height=h, corner_radius=r) if r > 1e-6 else Rectangle(width=w, height=h)
    if not tail:
        return body
    tx, ty = tail[0], tail[1]
    # 尾の先が箱の中なら尾を付けない
    inside = (tx / (w / 2)) ** 2 + (ty / (h / 2)) ** 2 <= 1 if shape == "ellipse" else (abs(tx) <= w / 2 and abs(ty) <= h / 2)
    if inside:
        return body
    d = _gui_math.hypot(tx, ty)
    ux, uy = tx / d, ty / d
    # 根元: 中心から尾の先へ向かう線が、箱の縁と交わる点より少し内側。その点で、尾の向きに直交する幅 tail_width
    if shape == "ellipse":
        t_edge = 1 / _gui_math.sqrt((ux / (w / 2)) ** 2 + (uy / (h / 2)) ** 2)
    else:
        t_edge = min((w / 2) / abs(ux) if abs(ux) > 1e-9 else 1e9, (h / 2) / abs(uy) if abs(uy) > 1e-9 else 1e9)
    inset = min(t_edge * 0.6, max(tail_width, 0.2))
    bx, by = ux * (t_edge - inset), uy * (t_edge - inset)
    px, py = -uy * tail_width / 2, ux * tail_width / 2
    a, b, c = [bx + px, by + py, 0], [tx, ty, 0], [bx - px, by - py, 0]
    # 箱と同じ向き（反時計回り）にそろえる。向きが逆だと、合成（Union）で一つの輪郭にならない
    if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0:
        a, c = c, a
    tri = Polygon(a, b, c)
    from manim.mobject.geometry.boolean_ops import Union
    out = Union(body, tri)
    return out


def gui_balloon_shape(width, height, shape="rect", corner_radius=0.25, tail=None, tail_width=0.4,
                      stroke_color="#222222", stroke_width=3.0, stroke_opacity=1.0, fill_color="#FFFFFF", fill_opacity=1.0):
    """箱の大きさを直接決めた吹き出し（中心が原点）。"""
    m = _gui_balloon_outline(width, height, shape, corner_radius, tail, tail_width)
    m.set_stroke(color=stroke_color, width=stroke_width, opacity=stroke_opacity)
    m.set_fill(color=fill_color, opacity=fill_opacity)
    return m


def _gui_oriented_corners(item):
    """中身の四隅。item は Mobject か (Mobject, 回転の角度（度）, 回転の軸)。回転した中身は、回す前の外接矩形を
    同じだけ回した四隅にする（キャンバスのプレビューと同じ測り方）。"""
    import numpy as _np
    if isinstance(item, (tuple, list)):
        mob, rot, anchor = item
    else:
        mob, rot, anchor = item, 0.0, None
    if not rot:
        x0, x1, y0, y1 = mob.get_left()[0], mob.get_right()[0], mob.get_bottom()[1], mob.get_top()[1]
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    a = _np.array([anchor[0], anchor[1], 0.0])
    flat = mob.copy().rotate(-rot * _gui_math.pi / 180, about_point=a)
    x0, x1, y0, y1 = flat.get_left()[0], flat.get_right()[0], flat.get_bottom()[1], flat.get_top()[1]
    c, s_ = _gui_math.cos(rot * _gui_math.pi / 180), _gui_math.sin(rot * _gui_math.pi / 180)
    return [(a[0] + (x - a[0]) * c - (y - a[1]) * s_, a[1] + (x - a[0]) * s_ + (y - a[1]) * c)
            for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]


def gui_balloon(contents, pad=(0.3, 0.2), min_size=(0.6, 0.4), center=(0.0, 0.0), rotation=0.0, shape="rect",
                corner_radius=0.25, tail=None, tail_width=0.4, **style):
    """中身を囲む吹き出し。contents は Mobject か (Mobject, 回転の角度, 回転の軸) の一覧。
    rotation（度、反時計回りが正）の向きで中身の外接矩形を測り、余白 pad（左右, 上下）を足した箱にする。
    中身が無いときは center を中心に min_size の大きさ。tail は箱の中心から尾の先まで（吹き出しの向きで。None なら尾なし）。"""
    items = [c for c in contents if c is not None]
    t = rotation * _gui_math.pi / 180
    c, s_ = _gui_math.cos(t), _gui_math.sin(t)
    if items:
        pts = [p for it in items for p in _gui_oriented_corners(it)]
        us = [x * c + y * s_ for x, y in pts]  # 吹き出しの向きの座標
        vs = [-x * s_ + y * c for x, y in pts]
        cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
        cx, cy = cu * c - cv * s_, cu * s_ + cv * c
        w, h = max(us) - min(us) + 2 * pad[0], max(vs) - min(vs) + 2 * pad[1]
    else:
        cx, cy = center
        w, h = min_size
    w, h = max(w, min_size[0]), max(h, min_size[1])
    m = gui_balloon_shape(w, h, shape, corner_radius, tail, tail_width, **style)
    if rotation:
        m.rotate(t, about_point=[0, 0, 0])
    return m.shift([cx, cy, 0])

# ---- 座標軸・グラフ・中かっこ ----

def gui_axes(kind="axes", x_range=(-1, 5, 1), y_range=(-1, 3, 1), x_length=6.0, y_length=4.0, tips=True,
             numbers=False, num_size=24, x_label="", y_label="", tex_template=None, color="#222222", stroke_width=2.0,
             grid_color="#58C4DD", grid_opacity=0.6, x_label_shift=(0.0, 0.0), y_label_shift=(0.0, 0.0), azimuth_step=30,
             azimuth_units="degrees", x_log=False, y_log=False):
    """数直線（numberline）・座標軸（axes）・座標平面（plane）・極座標（polar）・複素平面（complex）。
    原点（作ったときの中心）が基準点。極座標は x_range が半径（最大・間隔）、x_length が直径。
    x_log・y_log（座標軸だけ）で対数目盛り（LogBase。範囲は 10 の指数で、目盛りの数字は 10^n）。"""
    from manim import Axes, ComplexPlane, MathTex, NumberLine, NumberPlane, PolarPlane
    axis = {"color": color, "stroke_width": stroke_width, "include_numbers": bool(numbers), "font_size": num_size}
    if kind == "numberline":
        m = NumberLine(x_range=list(x_range), length=x_length, include_tip=tips, include_numbers=bool(numbers),
                       font_size=num_size, color=color, stroke_width=stroke_width)
    elif kind == "plane":
        m = NumberPlane(x_range=list(x_range), y_range=list(y_range), x_length=x_length, y_length=y_length,
                        axis_config={**axis, "include_tip": tips},
                        background_line_style={"stroke_color": grid_color, "stroke_width": 1, "stroke_opacity": grid_opacity})
    elif kind == "polar":
        import math as _m
        m = PolarPlane(radius_max=x_range[1], size=x_length, radius_step=x_range[2],
                       azimuth_step=(360 / azimuth_step if azimuth_units == "degrees" else 2 / azimuth_step) if azimuth_step else None,
                       azimuth_units=azimuth_units, azimuth_label_font_size=num_size,
                       radius_config={"color": color, "stroke_width": stroke_width, "font_size": num_size},
                       background_line_style={"stroke_color": grid_color, "stroke_width": 1, "stroke_opacity": grid_opacity})
        if numbers:
            m.add_coordinates()
        _ = _m
    elif kind == "complex":
        m = ComplexPlane(x_range=list(x_range), y_range=list(y_range), x_length=x_length, y_length=y_length,
                         axis_config={**axis, "include_numbers": False, "include_tip": tips},
                         background_line_style={"stroke_color": grid_color, "stroke_width": 1, "stroke_opacity": grid_opacity})
        if numbers:
            m.add_coordinates(font_size=num_size)
    else:
        from manim import LogBase
        m = Axes(x_range=list(x_range), y_range=list(y_range), x_length=x_length, y_length=y_length, tips=tips,
                 axis_config=axis,
                 x_axis_config={"scaling": LogBase(custom_labels=True)} if x_log else {},
                 y_axis_config={"scaling": LogBase(custom_labels=True)} if y_log else {})
    # 目盛りの数字は、既定では白（暗い背景向け）なので、軸の色にそろえる
    for ax in ([m] if kind == "numberline" else [m.x_axis, m.y_axis]):
        if getattr(ax, "numbers", None) is not None and len(ax.numbers):
            ax.numbers.set_color(color)
        if getattr(ax, "labels", None) is not None and len(ax.labels):  # 対数目盛りの 10^n の数字
            ax.labels.set_color(color)
    if kind in ("polar", "complex"):
        for x in getattr(m, "coordinate_labels", []) or []:
            x.set_color(color)
    if kind not in ("numberline", "polar") and (x_label or y_label):
        kw = {"tex_template": tex_template} if tex_template is not None else {}
        labels = m.get_axis_labels(x_label=MathTex(x_label or "", color=color, **kw),
                                   y_label=MathTex(y_label or "", color=color, **kw))
        # ラベルの位置は、Manim の既定の位置（軸の先）からずらせる
        labels[0].shift([x_label_shift[0], x_label_shift[1], 0.0])
        labels[1].shift([y_label_shift[0], y_label_shift[1], 0.0])
        m.add(labels)
        m.labels = labels
    return m


_GUI_FN_NS = None
_GUI_FN_CODE = {}


def _gui_fn_ns():
    global _GUI_FN_NS
    import numpy as _np
    if _GUI_FN_NS is None:
        fns = ("sin", "cos", "tan", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "exp", "log", "log10", "log2",
               "sqrt", "abs", "floor", "ceil", "sign", "pi", "e", "where", "minimum", "maximum", "heaviside", "arctan2",
               "mod", "round", "hypot")
        _GUI_FN_NS = {n: getattr(_np, n) for n in fns}
        _GUI_FN_NS.update(np=_np, ln=_np.log, asin=_np.arcsin, acos=_np.arccos, atan=_np.arctan)
    return _GUI_FN_NS


class _GuiFunc:
    """式の関数。式の文字列だけを持つ（Manim のキャッシュは、関数の中身をたどってハッシュを作るため。
    numpy などを直接持つと、たどれずに描画が止まる）。"""

    def __init__(self, expr, names):
        self.expr, self.names = expr, tuple(names)
        if expr not in _GUI_FN_CODE:
            _GUI_FN_CODE[expr] = compile(expr, "<式>", "eval")

    def __call__(self, *v):
        return eval(_GUI_FN_CODE[self.expr], {"__builtins__": {}}, {**_gui_fn_ns(), **dict(zip(self.names, v))})


def gui_func(expr, names=("x",)):
    """変数 names（x、または x と y）の式（Python・numpy の書き方。sin や sqrt は np. を付けなくてもよい）を関数にする。"""
    return _GuiFunc(expr, names)


def _gui_gradient(m, colors, stroke_width=None):
    """線に沿って色を変える（Manim の CurvesAsSubmobjects で細かく分けて、set_color_by_gradient）。"""
    from manim import CurvesAsSubmobjects
    if not colors or len(colors) < 2:
        return m
    if isinstance(m, DashedVMobject):  # 破線は、破線の 1 本ずつを塗り分ける
        m.set_color_by_gradient(*colors)
        return m
    for sm in m.family_members_with_points():  # 直線・円弧のように曲線が少ないものは、細かく分けてから塗る
        if sm.get_num_curves() < 60:
            sm.insert_n_curves(60 - sm.get_num_curves())
    g = CurvesAsSubmobjects(m)
    if stroke_width is not None:
        g.set_stroke(width=stroke_width)
    g.set_color_by_gradient(*colors)
    return g


def gui_graph(axes, expr, x_range=None, samples=400, color="#FC6255", stroke_width=4.0, stroke_opacity=1.0,
              dashed=False, dash_length=0.15, params=None, gradient=None):
    """座標軸 axes の上の、y = 式 のグラフ。y が軸の範囲の外に出る所（tan の漸近線など）では、範囲の端で線を切る。
    gradient（色のリスト）で、線に沿って色を変える（CurvesAsSubmobjects）。"""
    import numpy as _np
    params = dict(params or {})  # 式の中のスライドの値（名前: いまの値）
    f0 = gui_func(expr, ("x", *params))
    f = lambda xs: f0(xs, *params.values())  # noqa: E731
    a, b = axes.x_range[0], axes.x_range[1]
    if x_range:  # x の範囲（片方が None なら、軸の端まで）
        a = x_range[0] if x_range[0] is not None else a
        b = x_range[1] if x_range[1] is not None else b
    fx, gx = _gui_axis_scale(getattr(axes, "x_axis", None))
    if x_range:  # x の範囲は値で指定する（対数目盛りの軸では、軸の上の位置＝指数に直す）
        a = float(fx(a)) if x_range[0] is not None else a
        b = float(fx(b)) if x_range[1] is not None else b
    xs = gx(_np.linspace(a, b, int(samples)))  # 対数目盛りの x 軸では、指数で等間隔に取る
    with _np.errstate(all="ignore"):
        ys = _np.asarray(f(xs), dtype=float) * _np.ones_like(xs)
    m = _gui_plot_xy(axes, xs, ys)
    m.set_stroke(color=color, width=stroke_width, opacity=stroke_opacity)
    m.set_fill(opacity=0)
    m = _gui_dash(m, dash_length) if dashed else m
    return _gui_gradient(m, gradient, stroke_width)


def _gui_axis_scale(axis):
    """軸の目盛りの換算: (値 → 軸の上の位置（対数目盛りなら指数）, その逆)。ふつうの目盛りなら、そのまま。"""
    import numpy as _np
    sc = getattr(axis, "scaling", None)
    if sc is not None and type(sc).__name__ == "LogBase":
        b = float(sc.base)

        def to(v):
            with _np.errstate(all="ignore"):
                v = _np.asarray(v, dtype=float)
                return _np.where(v > 0, _np.log(_np.where(v > 0, v, 1.0)) / _np.log(b), _np.nan)
        return to, (lambda u: b ** _np.asarray(u, dtype=float))
    return (lambda v: _np.asarray(v, dtype=float)), (lambda u: _np.asarray(u, dtype=float))


def _gui_plot_xy(axes, xs, ys):
    """点 (xs, ys) を結ぶ線（座標軸の y の範囲の外では、範囲の端で線を切る）。対数目盛りの軸では、
    範囲は指数で比べ、0 以下の値（対数が無い）の所でも線を切る。"""
    import numpy as _np
    fx, gx = _gui_axis_scale(getattr(axes, "x_axis", None))
    fy, gy = _gui_axis_scale(getattr(axes, "y_axis", None))
    xs, ys = fx(xs), fy(ys)  # 軸の上の位置で考え、点を置くときに値へ戻す
    c2p = axes.c2p
    axes = type("_A", (), {"y_range": axes.y_range, "c2p": staticmethod(lambda a, b: c2p(float(gx(a)), float(gy(b))))})()
    y0, y1 = axes.y_range[0], axes.y_range[1]
    span = max(y1 - y0, 1e-9)
    ok = _np.isfinite(ys) & (ys >= y0) & (ys <= y1)
    m = VMobject()
    seg = []

    def edge(xa, ya, xb, yb):
        """範囲の内側 (xa, ya) と外側 (xb, yb) の間で、y が範囲の端になる点（外側が無限大などなら None）。"""
        if not _np.isfinite(yb) or abs(yb - ya) > 4 * span:
            return None
        yt = y1 if yb > y1 else y0
        t = (yt - ya) / (yb - ya) if yb != ya else 0
        return axes.c2p(xa + (xb - xa) * t, yt)

    for k in range(len(xs)):
        if ok[k]:
            if not seg and k > 0:
                p = edge(xs[k], ys[k], xs[k - 1], ys[k - 1])  # 範囲の外から入ってきた所
                if p is not None:
                    seg.append(p)
            seg.append(axes.c2p(xs[k], ys[k]))
            continue
        if seg:
            p = edge(xs[k - 1], ys[k - 1], xs[k], ys[k])  # 範囲の外へ出る所
            if p is not None:
                seg.append(p)
        if len(seg) >= 2:
            m.append_vectorized_mobject(VMobject().set_points_smoothly(seg))
        seg = []
    if len(seg) >= 2:
        m.append_vectorized_mobject(VMobject().set_points_smoothly(seg))
    return m


def gui_brace(target=None, start=None, end=None, direction=(0.0, -1.0), buff=0.2, sharpness=2.0, label=None,
              label_kind="math", label_size=36, label_color=None, label_font=None, tex_template=None,
              color="#222222", opacity=1.0):
    """中かっこ。target（要素）に付けるか、start と end（2 点）の間に付ける。label を付けると、かっこの先に置く。
    戻り値は VGroup(かっこ, ラベル)。かっこは .brace、ラベルは .label で参照できる。"""
    from manim import Brace, BraceBetweenPoints, MathTex, VGroup
    d = [direction[0], direction[1], 0.0]
    if target is not None:
        b = Brace(target, direction=d, buff=buff, sharpness=sharpness)
    else:
        b = BraceBetweenPoints([start[0], start[1], 0.0], [end[0], end[1], 0.0], direction=d, buff=buff, sharpness=sharpness)
    b.set_fill(color=color, opacity=opacity)
    b.set_stroke(width=0)
    g = VGroup(b)
    g.brace = b
    g.label = None
    if label:
        if label_kind == "text":
            gt = globals().get("gui_text")
            lab = gt([{"t": label}], font=label_font or "sans-serif", font_size=label_size, color=label_color or color) \
                if gt else __import__("manim").Text(label, font=label_font or "", font_size=label_size, color=label_color or color)
        else:
            kw = {"tex_template": tex_template} if tex_template is not None else {}
            lab = MathTex(label, font_size=label_size, color=label_color or color, **kw)
        b.put_at_tip(lab)
        g.add(lab)
        g.label = lab
    return g

# ---- 表 ----

def gui_table(cells, mode="text", header_row=False, header_col=False, font="", font_size=36, color="#222222",
              h_buff=0.6, v_buff=0.35, outer_lines=True, line_color="#222222", line_width=2.0, tex_template=None, items=None):
    """表（Manim の Table）。cells は行ごとの文字列のリスト。mode="math" ではすべてのセルを数式（MathTable と同じ）にし、
    mode="text" では $…$ で囲んだセルだけを数式にする。見出し（1 行目・1 列目）のテキストは太字にする。
    セルは table1.get_entries((行, 列))（1 始まり）で参照できる。
    items（行ごとの要素のリスト。None のセルは文字）で、セルに要素そのものを入れる（MobjectTable と同じ）。"""
    from manim import MathTex, Rectangle, Table, Text
    gt = globals().get("gui_text")
    kw = {"tex_template": tex_template} if tex_template is not None else {}
    em = font_size / 72

    def blank():
        return Rectangle(width=0.01, height=0.5 * em).set_stroke(width=0).set_fill(opacity=0)

    ratio = []

    def math_ratio():
        """テキストのセルの文字と、数式のセルの文字の大きさの比（「H」の高さで比べる。1 つの表で 1 回だけ測る）。"""
        if not ratio:
            try:
                t = gt([{"t": "H"}], font=font or "sans-serif", font_size=font_size, color=color) if gt else Text("H", font=font, font_size=font_size)
                m = MathTex(r"\mathrm{H}", font_size=font_size, **kw)
                ratio.append(max(0.5, min(3.0, t.height / m.height)) if m.height > 1e-6 else 1.0)
            except Exception:
                ratio.append(1.0)
        return ratio[0]

    def entry(s, bold):
        s = str(s)
        is_math = mode == "math"
        if len(s) >= 2 and s.startswith("$") and s.endswith("$"):
            s, is_math = s[1:-1], True
        if not s.strip():
            return blank()
        if is_math and mode != "math":
            # テキストの表の $…$: 同じ font_size の MathTex はまわりの文字より小さいので、大文字の高さをそろえる
            return MathTex(s, font_size=font_size * math_ratio(), color=color, **kw)
        if is_math:
            return MathTex(s, font_size=font_size, color=color, **kw)
        if gt:
            return gt([{"t": s, "b": bool(bold)}], font=font or "sans-serif", font_size=font_size, color=color)
        return Text(s, font=font, font_size=font_size, color=color, weight="BOLD" if bold else "NORMAL")

    rows = [list(r) for r in cells] or [[""]]
    n = max(len(r) for r in rows)
    rows = [r + [""] * (n - len(r)) for r in rows]
    mobs = [[_gui_item(items, i, j) or entry(c, (header_row and i == 0) or (header_col and j == 0)) for j, c in enumerate(r)]
            for i, r in enumerate(rows)]
    m = Table(mobs, element_to_mobject=lambda x, **_: x, h_buff=h_buff, v_buff=v_buff, include_outer_lines=outer_lines,
              line_config={"stroke_color": line_color, "stroke_width": line_width})
    m.move_to(ORIGIN)
    base = m.add_highlighted_cell

    def add_highlighted_cell(pos=(1, 1), color="#FFFF00", **kwargs):
        """セルの背景（Table と同じ）。GUI のレイヤーの値（z_index）より奥に置き、文字や線が隠れないようにする。"""
        base(pos, color=color, **kwargs)
        bg = m.get_entries(pos).background_rectangle
        bg.z_index = min(x.z_index for x in m.get_family()) - 0.01
        return m

    m.add_highlighted_cell = add_highlighted_cell
    return m

# ---- ベクトル場・流線 ----

_GUI_FIELD_COLORS = ("#236B8E", "#83C167", "#FFFF00", "#FC6255")  # Manim の既定（BLUE_E, GREEN, YELLOW, RED）


def _gui_field_frame(axes, center, x_range, y_range, width, height):
    """ベクトル場の座標（u, v）と画面の点の対応。axes があれば、その座標軸の座標を使う。"""
    import numpy as _np
    if axes is not None:
        (x0, x1), (y0, y1) = axes.x_range[:2], axes.y_range[:2]
        o = _np.array(axes.c2p(0, 0))
        ux = axes.c2p(1, 0)[0] - o[0]
        uy = axes.c2p(0, 1)[1] - o[1]
    else:
        (x0, x1), (y0, y1) = x_range[:2], y_range[:2]
        ux, uy = width / (x1 - x0), height / (y1 - y0)
        o = _np.array([center[0] - (x0 + x1) / 2 * ux, center[1] - (y0 + y1) / 2 * uy, 0.0])
    return (x0, x1, y0, y1), o, ux, uy


def _gui_mix(colors, t):
    from manim import ManimColor, interpolate_color
    t = min(max(t, 0.0), 1.0) * (len(colors) - 1)
    k = min(int(t), len(colors) - 2)
    return interpolate_color(ManimColor(colors[k]), ManimColor(colors[k + 1]), t - k)


def gui_field(kind, fx, fy, axes=None, center=(0.0, 0.0), x_range=(-3, 3), y_range=(-2, 2), width=6.0, height=4.0,
              step=0.5, length="limit", scale=1.0, color="#222222", color_max=None, colors=_GUI_FIELD_COLORS,
              stroke_width=2.0, opacity=1.0, virtual_time=3.0, params=None):
    """ベクトル場 (fx, fy)（x・y の式）。kind="arrows" は矢印（ArrowVectorField）、"stream" は流線（StreamLines）。
    axes を渡すとその座標軸の座標で、渡さなければ center を中心に width×height の範囲を x_range×y_range として描く。
    矢印の長さ length: "limit"（Manim の既定と同じく、大きいほど長いが上限あり）、"same"（そろえる）、"linear"（大きさに比例）。
    color_max を渡すと、ベクトルの大きさ 0〜color_max で colors の色に塗り分ける。"""
    import numpy as _np
    from manim import ArrowVectorField, StreamLines
    params = dict(params or {})  # 式の中のスライドの値（名前: いまの値）
    g1, g2 = gui_func(fx, ("x", "y", *params)), gui_func(fy, ("x", "y", *params))
    pv = tuple(params.values())
    f1, f2 = (lambda u, v: g1(u, v, *pv)), (lambda u, v: g2(u, v, *pv))
    (x0, x1, y0, y1), o, ux, uy = _gui_field_frame(axes, center, x_range, y_range, width, height)

    def F(p):
        u, v = (p[0] - o[0]) / ux, (p[1] - o[1]) / uy
        with _np.errstate(all="ignore"):
            a, b = float(f1(u, v)), float(f2(u, v))
        return (a, b) if _np.isfinite(a) and _np.isfinite(b) else (0.0, 0.0)

    def flow(p):  # 画面の上の速度（座標の 1 は、画面では ux・uy）
        a, b = F(p)
        return _np.array([a * ux, b * uy, 0.0])

    sx0, sx1 = o[0] + x0 * ux, o[0] + x1 * ux
    sy0, sy1 = o[1] + y0 * uy, o[1] + y1 * uy
    dx, dy = step * ux, step * uy
    # Manim は最大の値に間隔を足してから arange する。最大の値を少し減らして、端の点が浮動小数の誤差で増減しないようにする
    xr, yr = [sx0, sx1 - 0.25 * dx, dx], [sy0, sy1 - 0.25 * dy, dy]
    mag = lambda p: float(_np.hypot(*F(p)))  # noqa: E731 — 座標での大きさ
    if kind == "stream":
        # 始点は Manim が乱数（種は固定）で少しずらす。そのずれ（奥行きの向きにも付く）の分だけ、範囲の外にはみ出してよい
        noise = dy / 2
        m = StreamLines(flow, color=color, x_range=xr, y_range=yr, noise_factor=noise, padding=noise / 2 + 1e-6,
                        stroke_width=stroke_width, opacity=opacity, virtual_time=virtual_time)
        for line in list(m.stream_lines):
            if len(line.points) < 4:  # 範囲の外へすぐに出た線
                m.remove(line)
                m.stream_lines.remove(line)
        for line in m.stream_lines:
            if color_max:
                pts = line.get_anchors()
                c = _gui_mix(colors, (sum(mag(p) for p in pts) / max(len(pts), 1)) / color_max)
                line.set_stroke(color=c)
        m._gui_flow = flow  # 流れに沿って動かす（gui_phase_flow）で使う、画面の上の速度
        return m
    s_len = 0.9 * min(dx, dy)

    def shown(p):
        a, b = F(p)
        w = _np.array([a * ux, b * uy, 0.0])
        n = float(_np.linalg.norm(w))
        if n == 0:
            return w
        if length == "linear":
            return w * scale
        if length == "same":
            return w / n * s_len * scale
        return w / n * s_len * scale / (1 + _np.exp(-_np.hypot(a, b)))  # Manim の既定（0.45 × sigmoid）と同じ形

    m = ArrowVectorField(shown, color=color, x_range=xr, y_range=yr, length_func=lambda n: n,
                         vector_config={"stroke_width": stroke_width})
    m._gui_flow = flow
    for a in list(m.submobjects):
        start, end = a.get_start(), a.get_end()
        if _np.linalg.norm(end - start) < 1e-6:
            m.remove(a)  # 大きさ 0 の所は描かない
            continue
        if color_max:
            a.set_color(_gui_mix(colors, mag(start) / color_max))
        if opacity < 1:
            a.set_stroke(opacity=opacity)
            a.tip.set_fill(opacity=opacity)
            a.tip.set_stroke(opacity=opacity)
    return m

# ---- スライドの値（ValueTracker）に連動する要素 ----

def gui_redraw(func):
    """値に連動する要素（Manim の always_redraw と同じ）。描き直すたびに、GUI のレイヤー（重なり順）を付け直す。"""
    m = func()

    def update(mob):
        new = func()
        z = getattr(mob, "_gui_z", None)
        if z is not None:
            for x in new.get_family():
                x.z_index = z
        mob.become(new)
        if getattr(new, "_gui_flow", None) is not None:  # ベクトル場: 値が変わったら、流れも変える
            mob._gui_flow = new._gui_flow
        cam = getattr(mob, "_gui_fixed_cam", None)
        if cam is not None:  # 3D のスライドで「画面に固定」した要素は、描き直した部分も固定し直す
            cam.add_fixed_in_frame_mobjects(mob)

    m.add_updater(update)
    return m


def gui_number(value=0.0, decimals=2, font_size=48, color="#222222", unit=None, include_sign=False, tex_template=None,
               label=None):
    """数値の表示（Manim の DecimalNumber）。value に ValueTracker を渡すと、その値に合わせて数字が変わる
    （左端の位置を保つ）。単位は LaTeX（日本語は \\text{…}）。"""
    from manim import DecimalNumber, MathTex

    class _GuiDecimal(DecimalNumber):
        """数字は Manim の既定（座標軸の目盛りの数字と同じ）、単位だけを数式と同じ TexTemplate（日本語可）で作る。
        Manim の DecimalNumber は単位を既定の TexTemplate で作るため、日本語の単位が使えない。"""

        def _string_to_mob(self, string, mob_class=None, **kwargs):
            if tex_template is not None and unit and string == unit:
                mob = MathTex(string, tex_template=tex_template)
                mob.font_size = self._font_size
                return mob
            return super()._string_to_mob(string, mob_class, **kwargs)

    tracker = value if hasattr(value, "get_value") else None
    m = _GuiDecimal(tracker.get_value() if tracker is not None else float(value), num_decimal_places=int(decimals),
                    include_sign=include_sign, unit=unit or None, unit_buff_per_font_unit=0.003 if unit else 0,
                    font_size=font_size, color=color)
    m.move_to(ORIGIN)
    if tracker is not None:
        def update(mob):
            mob.set_value(tracker.get_value())
            z = getattr(mob, "_gui_z", None)
            if z is not None:  # 数字を作り直すと重なり順が消えるので、付け直す
                for x in mob.get_family():
                    x.z_index = z
            cam = getattr(mob, "_gui_fixed_cam", None)
            if cam is not None:  # 3D のスライドで「画面に固定」した数値は、作り直した数字も固定し直す
                cam.add_fixed_in_frame_mobjects(mob)
        m.add_updater(update)
        m.tracker = tracker
    if label:  # 「x = 1.23」のように、名前を付ける（Manim の Variable と同じ形。.label・.value・.tracker で参照）
        from manim import RIGHT, VGroup
        lab = MathTex(label, "=", font_size=font_size, color=color,
                      **({"tex_template": tex_template} if tex_template is not None else {}))
        g = VGroup(lab, m)
        m.next_to(lab, RIGHT)
        g.move_to(ORIGIN)
        g.label, g.value, g.tracker = lab, m, getattr(m, "tracker", None)
        return g
    return m


def gui_axdot(axes, x="0", y="0", params=None, radius=0.08, color="#FC6255", lines=False, line_color=None):
    """座標軸 axes の上の点 (x, y)。x・y は式（スライドの値を使える）。lines=True で、軸への点線を付ける。
    戻り値は VGroup（点は .dot、点線は .lines）。"""
    import numpy as _np
    from manim import Dot, VGroup
    params = dict(params or {})
    names = tuple(params)
    vals = tuple(params.values())
    with _np.errstate(all="ignore"):
        u = float(gui_func(x, names)(*vals))
        v = float(gui_func(y, names)(*vals))
    p = axes.c2p(u if _np.isfinite(u) else 0.0, v if _np.isfinite(v) else 0.0)
    d = Dot(p, radius=radius, color=color)
    g = VGroup()
    g.lines = None
    if lines:
        g.lines = axes.get_lines_to_point(p, color=line_color or color)
        g.add(g.lines)
    g.add(d)
    g.dot = d
    return g

# ---- 行列・角 ----

_GUI_BRACKETS = {"[]": ("[", "]"), "()": ("(", ")"), "||": ("|", "|"), "{}": ("\\{", "\\}"), "none": ("[", "]")}


def _gui_item(items, i, j):
    """表・行列のセル (i, j) に入れる要素（無ければ None）。"""
    try:
        return items[i][j] if items else None
    except IndexError:
        return None


def gui_detach(container, mob):
    """表・行列のセルに入れた要素を、セルの位置のまま、表から外す（最初は出さない要素。あとで FadeIn(mob) などで出す）。"""
    for m in container.get_family():
        if mob in m.submobjects:
            m.remove(mob)
    return mob


def gui_matrix(cells, bracket="[]", h_buff=0.5, v_buff=0.3, font_size=36, color="#222222", tex_template=None, items=None):
    """行列（Manim の Matrix）。セルは LaTeX（数式）。bracket は "[]"・"()"・"||"（行列式）・"{}"・"none"（かっこ無し）。
    h_buff・v_buff は成分どうしのすき間（いちばん大きい成分に合わせて間隔を決める）。
    行は matrix1.get_rows()、列は get_columns()、成分は get_entries() で取り出せる。
    items（行ごとの要素のリスト。None のセルは数式）で、成分に要素そのものを入れる（MobjectMatrix と同じ）。"""
    from manim import Matrix, MathTex
    kw = {"tex_template": tex_template} if tex_template is not None else {}
    rows = [list(r) for r in cells] or [["0"]]
    n = max(len(r) for r in rows)
    rows = [[str(c) if str(c).strip() else "\\phantom{0}" for c in r + [""] * (n - len(r))] for r in rows]
    left, right = _GUI_BRACKETS.get(bracket, ("[", "]"))
    mobs = [[_gui_item(items, i, j) or MathTex(c, font_size=font_size, color=color, **kw) for j, c in enumerate(r)] for i, r in enumerate(rows)]
    # Manim の h_buff・v_buff は成分の中心どうしの間隔なので、分数などの大きい成分が重ならないように、
    # いちばん大きい成分の幅・高さに、指定の間隔（成分どうしのすき間）を足した値にする
    hb = max(x.width for r in mobs for x in r) + h_buff
    vb = max(x.height for r in mobs for x in r) + v_buff
    # 成分はセルの中央にそろえる（Manim の既定は右下の角にそろえるため、分数と並んだ成分が下に寄る）
    m = Matrix(mobs, h_buff=hb, v_buff=vb, left_bracket=left, right_bracket=right, element_to_mobject=lambda x, **_: x,
               element_alignment_corner=ORIGIN, bracket_config={"color": color, **kw})
    if bracket == "none":
        m.remove(*m.get_brackets())
    return m.move_to(ORIGIN)


def gui_angle_other(line1, line2, quadrant=(1, 1), reflex=False):
    """quadrant の角で、内側（180° 未満）か外側（reflex）を描くための Angle の other_angle。
    Angle は 1 本目の向きから 2 本目の向きへ反時計回りに描くので、その角が 180° を超えるかで決める（線を動かしても内側・外側を保つ）。"""
    import math
    u1, u2 = line1.get_unit_vector() * quadrant[0], line2.get_unit_vector() * quadrant[1]
    ccw = (math.atan2(u2[1], u2[0]) - math.atan2(u1[1], u1[0])) % math.tau
    return (ccw > math.pi) != bool(reflex)


def gui_angle(line1, line2, kind="angle", radius=0.5, quadrant=(1, 1), other=False, dot=False, color="#222222",
              stroke_width=3.0, label=None, label_size=36, label_color=None, label_buff=0.25, tex_template=None, reflex=None):
    """2 本の線の間の角の印（Manim の Angle。kind="right" は直角の印）。label を付けると、角の内側に置く。
    reflex を True / False で渡すと、quadrant の角の外側（180° を超える角）か内側かを、線の向きから決める（other は使わない）。
    戻り値は VGroup（印は .angle、ラベルは .label）。"""
    from manim import Angle, MathTex, TangentialArc, VGroup
    if reflex is not None and kind != "tangent":
        other = gui_angle_other(line1, line2, quadrant, reflex)
    if kind == "tangent":  # 2 本の線に接する弧（TangentialArc。角を丸める）。quadrant はどの角か
        a = TangentialArc(line1, line2, radius=radius, corner=tuple(quadrant))
        a.set_stroke(color=color, width=stroke_width)
        g = VGroup(a)
        g.angle, g.label = a, None
        return g
    kw = dict(radius=radius, quadrant=tuple(quadrant), other_angle=other, elbow=(kind == "right"))
    a = Angle(line1, line2, dot=dot, dot_color=color, **kw)
    a.set_stroke(color=color, width=stroke_width)
    g = VGroup(a)
    g.angle, g.label = a, None
    if label:
        tk = {"tex_template": tex_template} if tex_template is not None else {}
        lab = MathTex(label, font_size=label_size, color=label_color or color, **tk)
        ref = Angle(line1, line2, **{**kw, "radius": radius + label_buff + max(lab.width, lab.height) / 2, "elbow": False})
        lab.move_to(ref.point_from_proportion(0.5))
        g.add(lab)
        g.label = lab
    return g


# ---- グラフの補助（面積・リーマン和・接線・割線）・媒介変数曲線・陰関数・極座標のグラフ ----

def _gui_f1(expr, params, var="x"):
    import numpy as _np
    params = dict(params or {})
    f0 = gui_func(expr, (var, *params))
    pv = tuple(params.values())

    def f(x):
        with _np.errstate(all="ignore"):
            y = _np.asarray(f0(x, *pv), dtype=float) * _np.ones_like(_np.asarray(x, dtype=float))
        return y
    return f


def _gui_num(v, params):
    """数、または式の文字列（スライドの値を params で渡す）を数にする。"""
    if isinstance(v, str):
        params = dict(params or {})
        return float(gui_func(v, tuple(params))(*params.values()))
    return float(v)


def _gui_clip_y(axes, y):
    import numpy as _np
    y0, y1 = axes.y_range[0], axes.y_range[1]
    return _np.clip(_np.nan_to_num(y, nan=0.0, posinf=y1, neginf=y0), y0, y1)


def gui_area(axes, expr, x_range, color="#58C4DD", opacity=0.4, params=None, expr2=None):
    """グラフ y = 式 と x 軸の間の面積（x_range の区間）。expr2 を渡すと、2 つのグラフの間の面積。"""
    import numpy as _np
    from manim import Polygon
    f = _gui_f1(expr, params)
    a, b = (_gui_num(v, params) for v in x_range)
    xs = _np.linspace(a, b, 200)
    ys = _gui_clip_y(axes, f(xs))
    if expr2:
        ys2 = _gui_clip_y(axes, _gui_f1(expr2, params)(xs))
        pts = [axes.c2p(x, y) for x, y in zip(xs, ys)] + [axes.c2p(x, y) for x, y in zip(xs[::-1], ys2[::-1])]
        return Polygon(*pts, stroke_width=0, fill_color=color, fill_opacity=opacity)
    pts = [axes.c2p(a, 0)] + [axes.c2p(x, y) for x, y in zip(xs, ys)] + [axes.c2p(b, 0)]
    return Polygon(*pts, stroke_width=0, fill_color=color, fill_opacity=opacity)


def gui_riemann(axes, expr, x_range, dx=0.5, sample="left", color="#58C4DD", color2="#83C167", opacity=0.6,
                stroke_color="#222222", stroke_width=1.0, params=None):
    """リーマン和の長方形（x_range の区間を dx ごとに。sample は "left"・"right"・"center"）。色は color から color2 へ変わる。"""
    import numpy as _np
    from manim import ManimColor, Polygon, VGroup, interpolate_color
    f = _gui_f1(expr, params)
    a, b = (_gui_num(v, params) for v in x_range)
    dx = max(abs(_gui_num(dx, params)), 1e-3)
    n = max(1, min(2000, int(round((b - a) / dx))))
    g = VGroup()
    for k in range(n):
        x0, x1 = a + k * dx, min(b, a + (k + 1) * dx)
        xs = {"left": x0, "right": x1}.get(sample, (x0 + x1) / 2)
        y = float(_gui_clip_y(axes, f(_np.array([xs])))[0])
        c = interpolate_color(ManimColor(color), ManimColor(color2), k / max(n - 1, 1))
        g.add(Polygon(axes.c2p(x0, 0), axes.c2p(x1, 0), axes.c2p(x1, y), axes.c2p(x0, y), fill_color=c,
                      fill_opacity=opacity, stroke_color=stroke_color, stroke_width=stroke_width))
    return g


def gui_tangent(axes, expr, x, length=3.0, color="#FFC300", stroke_width=4.0, dot=True, params=None):
    """グラフ y = 式 の x での接線（長さ length の線分。画面の単位）。dot=True で接点に点を付ける。"""
    import numpy as _np
    from manim import Dot, Line, VGroup
    f = _gui_f1(expr, params)
    x, length = _gui_num(x, params), _gui_num(length, params)
    h = 1e-4 * max(1.0, abs(x))
    y = float(f(_np.array([x]))[0])
    k = float((f(_np.array([x + h]))[0] - f(_np.array([x - h]))[0]) / (2 * h))
    p, q = _np.array(axes.c2p(x, y)), _np.array(axes.c2p(x + 1, y + k))
    d = (q - p) / (_np.linalg.norm(q - p) or 1)
    g = VGroup(Line(p - d * length / 2, p + d * length / 2, color=color, stroke_width=stroke_width))
    if dot:
        g.add(Dot(p, color=color))
    return g


def gui_secant(axes, expr, x, dx=1.0, extend=1.0, color="#FC6255", stroke_width=4.0, legs=True, leg_color="#83C167",
               params=None):
    """グラフ y = 式 の x と x + dx の 2 点を通る割線（両側に extend だけ延ばす）。legs=True で dx・dy の線を付ける。"""
    import numpy as _np
    from manim import DashedLine, Dot, Line, VGroup
    f = _gui_f1(expr, params)
    x, dx, extend = _gui_num(x, params), _gui_num(dx, params), _gui_num(extend, params)
    y0, y1 = (float(v) for v in f(_np.array([x, x + dx])))
    p, q = _np.array(axes.c2p(x, y0)), _np.array(axes.c2p(x + dx, y1))
    if _np.linalg.norm(q - p) < 1e-9:  # Δx = 0: 接線の向き
        h = 1e-4 * max(1.0, abs(x))
        k = float((f(_np.array([x + h]))[0] - f(_np.array([x - h]))[0]) / (2 * h))
        q2 = _np.array(axes.c2p(x + 1, y0 + k))
        d = (q2 - p) / (_np.linalg.norm(q2 - p) or 1)
    else:
        d = (q - p) / _np.linalg.norm(q - p)
    g = VGroup(Line(p - d * extend, q + d * extend, color=color, stroke_width=stroke_width), Dot(p, color=color), Dot(q, color=color))
    if legs:
        c = _np.array(axes.c2p(x + dx, y0))
        g.add(DashedLine(p, c, color=leg_color), DashedLine(c, q, color=leg_color))
    return g


def gui_curve2d(axes, x, y, t_range=(0.0, 6.283), samples=300, color="#FC6255", stroke_width=4.0, dashed=False, gradient=None,
                dash_length=0.15, params=None):
    """座標軸の上の媒介変数曲線 (x(t), y(t))。"""
    import numpy as _np
    from manim import VMobject
    fx, fy = _gui_f1(x, params, "t"), _gui_f1(y, params, "t")
    ts = _np.linspace(t_range[0], t_range[1], int(samples))
    xs, ys = _np.nan_to_num(fx(ts)), _np.nan_to_num(fy(ts))
    m = VMobject().set_points_smoothly([axes.c2p(a, b) for a, b in zip(xs, ys)])
    m.set_stroke(color=color, width=stroke_width).set_fill(opacity=0)
    return _gui_gradient(_gui_dash(m, dash_length) if dashed else m, gradient, stroke_width)


def gui_implicit(axes, expr, color="#FC6255", stroke_width=4.0, params=None):
    """座標軸の上の陰関数の曲線 式 = 0（Manim の plot_implicit_curve）。"""
    import numpy as _np
    params = dict(params or {})
    f0 = gui_func(expr, ("x", "y", *params))
    pv = tuple(params.values())

    def f(x, y):
        with _np.errstate(all="ignore"):
            v = float(f0(x, y, *pv))
        return v if _np.isfinite(v) else 1e9
    m = axes.plot_implicit_curve(f, color=color)
    return m.set_stroke(width=stroke_width)


def gui_complex_curve(axes, expr, t_range=(0.0, 6.2832), samples=400, color="#FC6255", stroke_width=4.0, params=None):
    """複素平面の上の曲線 z = f(t)（t の複素数の式。虚数単位は i。x と書いても t と同じ）。
    値が無限大などになる所では線を切る。"""
    import numpy as _np
    from manim import VMobject
    params = dict(params or {})
    f0 = gui_func(expr, ("t", "x", "i", *params))
    ts = _np.linspace(t_range[0], t_range[1], int(samples))
    with _np.errstate(all="ignore"):
        zs = _np.asarray(f0(ts, ts, 1j, *params.values()), dtype=complex) * _np.ones_like(ts)
    m = VMobject()
    seg = []
    for z in list(zs) + [complex("nan")]:
        if _np.isfinite(z):
            seg.append(axes.n2p(z))
            continue
        if len(seg) >= 2:
            m.append_vectorized_mobject(VMobject().set_points_smoothly(seg))
        seg = []
    return m.set_stroke(color=color, width=stroke_width).set_fill(opacity=0)


def gui_polar(axes, expr, theta_range=(0.0, 6.2832), samples=400, color="#FC6255", stroke_width=4.0, params=None):
    """極座標の平面の上のグラフ r = 式（θ の式。変数は theta）。"""
    import numpy as _np
    from manim import VMobject
    f = _gui_f1(expr, params, "theta")
    th = _np.linspace(theta_range[0], theta_range[1], int(samples))
    rs = _np.nan_to_num(f(th))
    m = VMobject().set_points_smoothly([axes.polar_to_point(r, t) for r, t in zip(rs, th)])
    return m.set_stroke(color=color, width=stroke_width).set_fill(opacity=0)

# ---- SVG ----

def gui_svg(path, width=2.0, height=None, color=None, stroke_color=None, stroke_width=None, opacity=1.0):
    """SVG のファイルを図形（Manim の SVGMobject）として読み込む。path はこの .py のフォルダからの相対パス。
    中心を原点に置き、幅を width にする（height も渡すと、縦横比を変えてその高さにする）。
    color を渡すと塗りを、stroke_color・stroke_width を渡すと線を、その色・太さにそろえる。"""
    import pathlib
    from manim import SVGMobject
    p = pathlib.Path(path)
    if not p.is_absolute():
        p = pathlib.Path(__file__).resolve().parent / p
    m = SVGMobject(str(p))
    m.move_to(ORIGIN)
    m.stretch_to_fit_width(width) if height else m.scale_to_fit_width(width)
    if height:
        m.stretch_to_fit_height(height)
    for x in m.family_members_with_points():
        if color and x.get_fill_opacity() > 0:
            x.set_fill(color)
        if stroke_color and x.get_stroke_width() > 0:
            x.set_stroke(color=stroke_color)
        if stroke_width is not None:
            x.set_stroke(width=stroke_width)
        if opacity < 1:
            x.set_fill(opacity=x.get_fill_opacity() * opacity)
            x.set_stroke(opacity=x.get_stroke_opacity() * opacity)
    return m.move_to(ORIGIN)

# ---- 3D（ThreeDSlide のプロジェクト） ----

_GUI_QUALITY = {"low": 0, "mid": 1, "high": 2}


def _gui_res(kind, quality):
    """立体の細かさ（Surface の resolution）。細かいほど描画に時間がかかる。"""
    q = _GUI_QUALITY.get(quality, 1)
    table = {"sphere": [(12, 24), (18, 36), (30, 60)], "torus": [(24, 12), (36, 18), (60, 30)],
             "cone": [(8, 24), (12, 36), (20, 60)], "cylinder": [(8, 24), (12, 36), (20, 60)],
             "surface": [16, 24, 40], "dot": [(6, 6), (8, 8), (12, 12)], "line": [12, 16, 24]}
    return table[kind][q]


def _gui_style3d(m, color, color2=None, opacity=1.0, stroke_color=None, stroke_width=0.0):
    from manim import Surface
    surfaces = [x for x in m.get_family() if isinstance(x, Surface)]
    if color2 and surfaces:
        for x in surfaces:  # 底面の円板（Surface）を子に持つ立体もあるので、面（u_index のある物）だけを塗る
            if getattr(x, "_gui_plain", False):  # 直方体の面は 1 色
                x.set_fill(color, opacity=opacity)
                continue
            for face in x.submobjects:
                if hasattr(face, "u_index"):
                    face.set_fill((color, color2)[(face.u_index + face.v_index) % 2], opacity=opacity)
    else:
        m.set_fill(color, opacity=opacity)
    m.set_stroke(stroke_color or color, width=stroke_width, opacity=opacity if stroke_width else 0)
    if not stroke_width:  # 直方体の細かい面のつなぎ目が、薄い線に見えないように、面と同じ色の細い線でふさぐ
        for x in surfaces:
            if getattr(x, "_gui_plain", False):
                x.set_stroke(color, width=1.0, opacity=opacity)
    return m


def _gui_three_d_camera_class():
    """3D のカメラ（Manim の ThreeDCamera）の、中心（frame_center）の不具合を直したもの。
    Manim は中心のずらしを、3D の点を写すとき（project_points）と、Cairo の座標の変換（get_cairo_context）・画像の位置の
    両方でかけている（2 回ずれる）。しかも Cairo の変換は最初のコマで作って使い回すので、あとから中心を変えても半分しか効かない
    （スライドを移っても前のスライドの中心が残る）。中心のずらしは 3D の点を写すときだけにし、ほかの所では原点にする。
    「画面に固定」の物も、中心を動かしても画面の同じ所に出る。"""
    import numpy as _np
    from manim import ThreeDCamera

    class GuiThreeDCamera(ThreeDCamera):
        def __init__(self, *args, **kwargs):
            # Manim のキャッシュのハッシュは、カメラの属性から作る（クラスの名前は入らない）。直す前のカメラで描いた
            # 部分の動画を使い回さないよう、版の印を属性に持つ
            self.gui_camera_fix = 1
            super().__init__(*args, **kwargs)

        @property
        def frame_center(self):
            return _np.zeros(3)  # Cairo の変換・画像の位置では、中心をずらさない

        @frame_center.setter
        def frame_center(self, point):
            self._frame_center.move_to(point)

        def project_points(self, points):
            return super().project_points(_np.asarray(points, dtype=float) - self._frame_center.points[0])

        def get_center_of_frame(self):
            return self._frame_center.points[0]

    return GuiThreeDCamera


def _gui_box(dims, quality):
    """直方体（中心が原点）。6 つの面を、それぞれ細かく分けた平らな Surface にする（市松模様は付けない）。"""
    import numpy as _np
    from manim import Surface, VGroup
    step = {0: 0.6, 1: 0.4, 2: 0.25}[_GUI_QUALITY.get(quality, 1)]
    a, b, c = (float(x) / 2 for x in dims)
    n = lambda length: max(2, int(round(length / step)))  # noqa: E731
    faces = []
    for axis, sgn in ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)):
        half = (a, b, c)
        i, j = [k for k in range(3) if k != axis]

        def f(u, v, axis=axis, sgn=sgn, i=i, j=j, half=half):
            pnt = _np.zeros(3)
            pnt[axis], pnt[i], pnt[j] = sgn * half[axis], u, v
            return pnt
        srf = Surface(f, u_range=[-half[i], half[i]], v_range=[-half[j], half[j]], resolution=(n(2 * half[i]), n(2 * half[j])),
                      checkerboard_colors=False, stroke_width=0)
        srf._gui_plain = True
        faces.append(srf)
    return VGroup(*faces)


def _gui_disk(radius, z, res):
    """円錐・円柱の底面の円板（z の高さ、xy 平面に平行）。中心から外へ・まわりの向きに細かく分けた面（Surface）にする。"""
    import numpy as _np
    from manim import TAU, Surface
    n_around = res[1] if isinstance(res, (tuple, list)) else int(res)
    n_out = max(3, n_around // 6)
    return Surface(lambda u, v: _np.array([u * _np.cos(v), u * _np.sin(v), z]), u_range=[0, radius], v_range=[0, TAU],
                   resolution=(n_out, n_around), checkerboard_colors=False, stroke_width=0)


def _gui_place3d(m, pos=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=1.0):
    """原点に作った物を、大きさ・向き（x 軸・y 軸・z 軸のまわりに、この順で回す。度）・位置の順に置く。"""
    import numpy as _np
    from manim import DEGREES, OUT, RIGHT, UP
    if scale != 1:
        m.scale(scale, about_point=_np.zeros(3))
    for ang, axis in zip(rotation, (RIGHT, UP, OUT)):
        if ang:
            m.rotate(ang * DEGREES, axis=axis, about_point=_np.zeros(3))
    return m.shift(_np.array([pos[0], pos[1], pos[2]], dtype=float))


def _gui_polyhedron(kind, side, vertices, faces, color, color2, opacity, stroke_color, stroke_width, show_vertices,
                    vertex_radius, vertex_color):
    """多面体（Manim の Tetrahedron・Octahedron・Dodecahedron・Icosahedron・Polyhedron・ConvexHull3D）。
    面は color（color2 があれば面ごとに交互）、辺は面の縁の線（stroke_width 0 で無し）。頂点の点は show_vertices のとき。"""
    from manim import ConvexHull3D, Dodecahedron, Dot, Dot3D, Icosahedron, Octahedron, Polyhedron, Tetrahedron
    faces_config = {"fill_color": color, "fill_opacity": opacity, "stroke_color": stroke_color or color,
                    "stroke_width": stroke_width, "stroke_opacity": 1 if stroke_width else 0}
    if show_vertices:
        graph_config = {"vertex_type": Dot3D, "vertex_config": {"radius": vertex_radius, "color": vertex_color or stroke_color or color}}
    else:  # 頂点は、面を頂点に合わせる更新に使うので消さずに、見えない小さな点にする
        graph_config = {"vertex_type": Dot, "vertex_config": {"radius": 1e-3, "fill_opacity": 0, "stroke_width": 0}}
    graph_config["edge_config"] = {"stroke_opacity": 0}
    kw = {"faces_config": faces_config, "graph_config": graph_config}
    plat = {"tetrahedron": Tetrahedron, "octahedron": Octahedron, "dodecahedron": Dodecahedron, "icosahedron": Icosahedron}
    if kind in plat:
        m = plat[kind](edge_length=side, **kw)
    elif kind == "hull":
        m = ConvexHull3D(*[[float(c) for c in v] for v in vertices], **kw)
    else:
        m = Polyhedron([[float(c) for c in v] for v in vertices], [list(map(int, f)) for f in faces], **kw)
    if color2:
        for i, f in enumerate(m.faces):
            f.set_fill(color2 if i % 2 else color, opacity=opacity)
    return m


def gui_solid(kind, pos=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=1.0, radius=1.0, side=2.0, dims=(2.0, 1.0, 1.0),
              height=2.0, minor_radius=0.3, quality="mid", color="#58C4DD", color2=None, opacity=1.0, stroke_color=None,
              stroke_width=0.0, vertices=(), faces=(), show_vertices=False, vertex_radius=0.06, vertex_color=None):
    """立体（sphere・cube・prism・cone・cylinder・torus）と多面体（tetrahedron・octahedron・dodecahedron・icosahedron・
    polyhedron（頂点と面）・hull（点の凸包））。中心（円錐・円柱は高さの中央）を pos に置く。
    polyhedron・hull は、頂点の座標をそのまま使い（中心に寄せない）、pos だけずらす。"""
    from manim import Cone, Cylinder, Sphere, Torus
    if kind in ("tetrahedron", "octahedron", "dodecahedron", "icosahedron", "polyhedron", "hull"):
        m = _gui_polyhedron(kind, side, vertices, faces, color, color2, opacity, stroke_color, stroke_width, show_vertices,
                            vertex_radius, vertex_color)
        if kind not in ("polyhedron", "hull"):
            m.move_to([0, 0, 0])
        return _gui_place3d(m, pos, rotation, scale)
    if kind == "sphere":
        m = Sphere(radius=radius, resolution=_gui_res("sphere", quality))
    elif kind in ("cube", "prism"):
        # Manim の Cube・Prism は大きな正方形 6 枚で、ほかの立体と重なると手前・奥の並べ替えを誤りやすい。細かく分けた面にする
        m = _gui_box([side] * 3 if kind == "cube" else list(dims), quality)
    elif kind == "cone":
        # Manim の底面（Circle 1 枚）は、手前・奥の並べ替えで 1 つの大きな面として扱われ、上から見ても手前に描かれる。
        # 側面と同じく細かい面の集まりの円板にして、面ごとに並べ替えられるようにする
        res = _gui_res("cone", quality)
        m = Cone(base_radius=radius, height=height, show_base=False, resolution=res)
        m.add(_gui_disk(radius, -height, res))
    elif kind == "cylinder":
        res = _gui_res("cylinder", quality)
        m = Cylinder(radius=radius, height=height, show_ends=False, resolution=res)
        m.add(_gui_disk(radius, -height / 2, res), _gui_disk(radius, height / 2, res))
    else:
        m = Torus(major_radius=radius, minor_radius=minor_radius, resolution=_gui_res("torus", quality))
    m.move_to([0, 0, 0])
    _gui_style3d(m, color, color2, opacity, stroke_color, stroke_width)
    return _gui_place3d(m, pos, rotation, scale)


def gui_axes3d(pos=(0.0, 0.0, 0.0), x_range=(-4, 4, 1), y_range=(-4, 4, 1), z_range=(-3, 3, 1), x_length=8.0, y_length=8.0,
               z_length=6.0, tips=True, labels=True, x_label="x", y_label="y", z_label="z", tex_template=None,
               color="#222222", stroke_width=2.0):
    """3D の座標軸（ThreeDAxes）。原点（作ったときの中心）を pos に置く。"""
    import numpy as _np
    from manim import MathTex, ThreeDAxes
    m = ThreeDAxes(x_range=list(x_range), y_range=list(y_range), z_range=list(z_range), x_length=x_length,
                   y_length=y_length, z_length=z_length, axis_config={"color": color, "stroke_width": stroke_width,
                                                                     "include_tip": tips})
    if labels:
        kw = {"tex_template": tex_template} if tex_template is not None else {}
        lab = m.get_axis_labels(*(MathTex(t or "", color=color, **kw) for t in (x_label, y_label, z_label)))
        m.add(lab)
        m.labels = lab
    return m.shift(_np.array(pos, dtype=float))


def gui_surface(axes, expr, u_range=None, v_range=None, quality="mid", color="#29ABCA", color2="#236B8E", colorscale=None,
                opacity=0.85, stroke_color="#BBBBBB", stroke_width=0.5, params=None):
    """3D の座標軸の上の曲面 z = f(x, y)。colorscale（色のリスト）を渡すと、高さで塗り分ける。"""
    import numpy as _np
    params = dict(params or {})
    f0 = gui_func(expr, ("x", "y", *params))
    pv = tuple(params.values())

    def f(u, v):
        with _np.errstate(all="ignore"):
            z = float(f0(u, v, *pv))
        return z if _np.isfinite(z) else 0.0

    kw = {"resolution": _gui_res("surface", quality), "fill_opacity": opacity, "stroke_color": stroke_color,
          "stroke_width": stroke_width}
    if colorscale:
        kw["colorscale"] = list(colorscale)
    else:
        kw.update(fill_color=color, checkerboard_colors=[color, color2] if color2 else False)
    return axes.plot_surface(f, u_range=list(u_range or axes.x_range[:2]), v_range=list(v_range or axes.y_range[:2]), **kw)


def gui_psurface(axes, x, y, z, u_range=(0.0, 6.2832), v_range=(0.0, 3.1416), quality="mid", color="#29ABCA", color2="#236B8E",
                 colorscale=None, opacity=0.85, stroke_color="#BBBBBB", stroke_width=0.5, params=None):
    """3D の座標軸の上の、媒介変数で表した曲面 (x(u, v), y(u, v), z(u, v))（Manim の Surface）。
    colorscale（色のリスト）を渡すと、高さ（z）で塗り分ける。"""
    import numpy as _np
    from manim import Surface
    params = dict(params or {})
    names = ("u", "v", *params)
    fs = [gui_func(e, names) for e in (x, y, z)]
    pv = tuple(params.values())

    def p(u, v):
        with _np.errstate(all="ignore"):
            q = [float(f(u, v, *pv)) for f in fs]
        return axes.c2p(*[c if _np.isfinite(c) else 0.0 for c in q])

    kw = {"resolution": _gui_res("surface", quality), "fill_opacity": opacity, "stroke_color": stroke_color,
          "stroke_width": stroke_width}
    if not colorscale:
        kw.update(fill_color=color, checkerboard_colors=[color, color2] if color2 else False)
    m = Surface(p, u_range=list(u_range), v_range=list(v_range), **kw)
    if colorscale:
        m.set_fill_by_value(axes=axes, colorscale=list(colorscale), axis=2)
        m.set_fill(opacity=opacity)
    return m


def gui_curve3d(axes, x, y, z, t_range=(0.0, 6.283), samples=200, color="#FC6255", stroke_width=4.0, params=None):
    """3D の座標軸の上の曲線 (x(t), y(t), z(t))。"""
    import numpy as _np
    from manim import ParametricFunction
    params = dict(params or {})
    names = ("t", *params)
    fs = [gui_func(e, names) for e in (x, y, z)]
    pv = tuple(params.values())

    def p(t):
        with _np.errstate(all="ignore"):
            v = [float(f(t, *pv)) for f in fs]
        return axes.c2p(*[c if _np.isfinite(c) else 0.0 for c in v])

    a, b = t_range
    return ParametricFunction(p, t_range=[a, b, (b - a) / max(int(samples), 2)], color=color, stroke_width=stroke_width)


def gui_point3d(kind, start=(0.0, 0.0, 0.0), end=(1.0, 0.0, 0.0), axes=None, color="#FC6255", radius=0.1, thickness=0.02,
                quality="mid", params=None):
    """3D の点（Dot3D）・線（Line3D）・矢印（Arrow3D）。axes を渡すと、その座標軸の座標で位置を決める。
    座標は数か、式の文字列（スライドの値を params で渡す）。"""
    import numpy as _np
    from manim import Arrow3D, Dot3D, Line3D
    params = dict(params or {})

    def val(v):
        if isinstance(v, str):
            with _np.errstate(all="ignore"):
                v = float(gui_func(v, tuple(params))(*params.values()))
        return v if _np.isfinite(v) else 0.0

    def c(q):
        q = [val(v) for v in q]
        return axes.c2p(*q) if axes is not None else _np.array(q, dtype=float)
    if kind == "dot":
        return Dot3D(c(start), radius=radius, color=color, resolution=_gui_res("dot", quality))
    if kind == "arrow":
        return Arrow3D(c(start), c(end), thickness=thickness, color=color, resolution=_gui_res("line", quality))
    return Line3D(c(start), c(end), thickness=thickness, color=color, resolution=_gui_res("line", quality))


# ---- コード・棒グラフ・LaTeX の文章・図形の合成 ----

def gui_code(code, language="python", style="vim", font_size=24, font="", line_numbers=True, line_from=1,
             background="rectangle", bg_color=None, text_color=None, tab_width=4):
    """プログラムのコード（Manim の Code。色分けは Pygments）。background は "rectangle" か "window"（ボタン付きの窓）。
    行は code1.code_lines[0]、行番号は code1.line_numbers、背景は code1.background で参照できる。"""
    from manim import Code
    pc = {"font_size": font_size}
    if font:
        pc["font"] = font
    if text_color:
        pc["color"] = text_color
    bc = {"fill_color": bg_color} if bg_color else {}
    m = Code(code_string=code if code.strip() else " ", language=language or None, formatter_style=style, tab_width=tab_width,
             add_line_numbers=line_numbers, line_numbers_from=line_from, background=background,
             background_config=bc, paragraph_config=pc)
    return m.move_to(ORIGIN)


def gui_barchart(values, names=None, y_range=None, width=6.0, height=4.0, colors=None, bar_width=0.6, fill_opacity=0.7,
                 stroke_width=3.0, axis_color="#222222", num_size=24, label_size=30, show_values=False, decimals=1,
                 tex_template=None):
    """棒グラフ（Manim の BarChart）。棒の名前は LaTeX の文章（Tex。数式は $…$）。
    棒は chart1.bars、値の変更は self.play(chart1.animate.change_bar_values([...]))。"""
    from manim import BarChart, DOWN, Tex, UP, VGroup
    vals = [float(v) for v in values] or [0.0]
    kw = {}
    if y_range:
        kw["y_range"] = list(y_range)
    m = BarChart(vals, bar_names=None, x_length=width, y_length=height, bar_colors=list(colors or ["#58C4DD"]),
                 bar_width=bar_width, bar_fill_opacity=fill_opacity, bar_stroke_width=stroke_width,
                 axis_config={"color": axis_color, "font_size": num_size}, **kw)
    m.x_axis.set_color(axis_color)
    m.y_axis.set_color(axis_color)
    if names:
        tk = {"tex_template": tex_template} if tex_template is not None else {}
        labels = VGroup()
        for i, name in enumerate(list(names)[:len(vals)]):
            if not str(name).strip():
                continue
            lab = Tex(str(name), font_size=label_size, color=axis_color, **tk)
            lab.next_to(m.x_axis.number_to_point(i + 0.5), UP if vals[i] < 0 else DOWN, buff=m.x_axis.line_to_number_buff)
            labels.add(lab)
        m.x_axis.labels = labels
        m.x_axis.add(labels)
    if show_values:  # 棒の値（棒の先に。負の値は下に）
        from manim import DecimalNumber
        m.bar_labels = VGroup()
        for bar, v in zip(m.bars, vals):
            lab = DecimalNumber(v, num_decimal_places=int(decimals), font_size=label_size, color=axis_color)
            lab.next_to(bar, DOWN if v < 0 else UP, buff=0.15)
            m.bar_labels.add(lab)
        m.add(m.bar_labels)
    return m


def gui_title(text, font_size=48, color="#222222", underline=True, match_width=False, align="center", tex_template=None):
    """スライドの題名（Manim の Title。下線付き）。文字は LaTeX の文章（Tex）。下線は title1.underline。
    align="left"・"right" で、文字を左・右に寄せる（画面の幅の下線のときは、下線の端にそろえる。複数行も左・右にそろえる）。"""
    from manim import LEFT, RIGHT, Title, VGroup
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    env = {"left": "flushleft", "right": "flushright"}.get(align, "center")
    m = Title(text, include_underline=underline, match_underline_width_to_text=match_width, font_size=font_size, color=color,
              tex_environment=env, **tk)
    if underline:
        m.underline.set_color(color)
        if align in ("left", "right") and not match_width:
            words = VGroup(*[p for p in m.submobjects if p is not m.underline])
            words.align_to(m.underline, LEFT if align == "left" else RIGHT)
    return m


def gui_bullets(items, font_size=36, color="#222222", buff=0.5, dot_scale=2.0, tex_template=None):
    """箇条書き（Manim の BulletedList）。各項目は LaTeX の文章（Tex）。項目は list1[0]、
    list1.fade_all_but(1) で 2 番目以外を薄くできる。"""
    from manim import BulletedList
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    items = [str(x) for x in items if str(x).strip()] or [" "]
    m = BulletedList(*items, buff=buff, dot_scale_factor=dot_scale, font_size=font_size, color=color, **tk)
    for part in m:  # 行頭の点は Manim が白で付けるので、文字と同じ色にする
        part[0].set_color(color)
    return m.move_to(ORIGIN)


def gui_boolean(op, mobjects, stroke_color="#222222", stroke_width=4.0, stroke_opacity=1.0, fill_color=None, fill_opacity=0.5,
                dashed=False, dash_length=0.15):
    """図形の合成（Manim の Union・Intersection・Difference・Exclusion）。mobjects の今の位置の形から、新しい図形を作る。
    difference は 1 つ目から 2 つ目を切り抜き、exclusion は 2 つの重ならない部分。元の図形を動かしても、合成した図形はついてこない。"""
    from manim import Difference, Exclusion, Intersection, Union
    mobs = list(mobjects)
    if op == "difference":
        m = Difference(mobs[0], mobs[1])
    elif op == "exclusion":
        m = Exclusion(mobs[0], mobs[1])
    elif op == "intersection":
        m = Intersection(*mobs)
    else:
        m = Union(*mobs)
    _gui_style(m, stroke_color, stroke_width, stroke_opacity, fill_color, fill_opacity)
    return _gui_dash(m, dash_length) if dashed else m

def gui_sample_space(width=4.0, height=3.0, split="columns", parts=(), title=None, label_size=30, label_color="#222222",
                     stroke_color="#222222", stroke_width=2.0, opacity=0.8, tex_template=None):
    """標本空間の図（Manim の SampleSpace）。split="columns" は横に（列に）、"rows" は縦に（行に）分ける。
    parts は (確率, 色, ラベル, 2 段目) の並び。2 段目は (確率, 色, ラベル) の並びで、もう一方の向きに分ける。
    1 段目のラベルは中かっこの外（列は上、行は左）、2 段目のラベルは区画の中に置く。確率は合計が 1 になるようにそろえる。
    戻り値は VGroup（標本空間は .space、1 段目の区画は .parts、2 段目は各区画の .subparts、中かっことラベルは .braces・.labels）。"""
    from manim import Brace, LEFT, MathTex, SampleSpace, Tex, UP, VGroup
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    space = SampleSpace(height=height, width=width, fill_opacity=0, stroke_width=stroke_width, stroke_color=stroke_color)

    def norm(ps):
        ps = [max(float(p), 0.0) for p in ps] or [1.0]
        total = sum(ps) or 1.0
        return [p / total for p in ps]

    def style(sub):
        sub.set_stroke(stroke_color, width=stroke_width)
        return sub

    def cell_label(text, cell):
        lab = MathTex(text, font_size=label_size, color=label_color, **tk)
        k = min(1.0, cell.width * 0.9 / max(lab.width, 1e-6), cell.height * 0.9 / max(lab.height, 1e-6))
        if k < 1:
            lab.scale(k)
        return lab.move_to(cell.get_center())

    parts = list(parts) or [(1.0, "#58C4DD", "", ())]
    cols = split != "rows"
    probs = norm([q[0] for q in parts])
    colors = [q[1] for q in parts]
    if cols:
        space.divide_vertically(probs, colors=colors)
        top = space.vertical_parts
    else:
        space.divide_horizontally(probs, colors=colors)
        top = space.horizontal_parts
    braces, labels, inner = VGroup(), VGroup(), VGroup()
    for part, q in zip(top, parts):
        style(part).set_fill(opacity=opacity)
        sub = list(q[3]) if len(q) > 3 and q[3] else []
        part.subparts = VGroup()
        if sub:
            sp = norm([r[0] for r in sub])
            sc = [r[1] for r in sub]
            if cols:
                part.divide_horizontally(sp, colors=sc)
                part.subparts = part.horizontal_parts
            else:
                part.divide_vertically(sp, colors=sc)
                part.subparts = part.vertical_parts
            for cell, r in zip(part.subparts, sub):
                style(cell).set_fill(opacity=opacity)
                if len(r) > 2 and str(r[2]).strip():
                    inner.add(cell_label(str(r[2]), cell))
        if str(q[2]).strip():
            d = UP if cols else LEFT
            b = Brace(part, d, buff=0.1, color=label_color)
            lab = MathTex(str(q[2]), font_size=label_size, color=label_color, **tk).next_to(b, d, buff=0.1)
            braces.add(b)
            labels.add(lab)
    g = VGroup(space, inner, braces, labels)
    g.space, g.parts, g.braces, g.labels, g.cell_labels = space, top, braces, labels, inner
    g.title = None
    if title:
        t = Tex(title, font_size=label_size * 1.2, color=label_color, **tk)
        t.next_to(VGroup(space, braces, labels), UP, buff=0.25)
        g.add(t)
        g.title = t
    return g


def gui_netgraph(vertices, edges, directed=False, layout="kamada_kawai", layout_scale=2.0, seed=1, positions=None, root=None,
                 groups=None, labels=None, label_size=30, label_color="#000000", vertex_radius=0.15, vertex_color="#58C4DD",
                 vertex_colors=None, edge_color="#222222", edge_width=3.0, tip_size=0.2, tex_template=None):
    """グラフ理論のグラフ（Manim の Graph。directed=True で DiGraph）。頂点は名前の並び、辺は名前の組の並び。
    layout は Manim（NetworkX）の自動配置の名前（spring・circular・kamada_kawai・planar・shell・spectral・spiral・tree・partite・random）か
    "manual"（positions: 名前 → (x, y)）。spring・random は seed で毎回同じ配置にする。tree は root を根にし、
    partite・shell は groups（頂点ごとの組の番号）で分ける。labels は頂点ごとの数式（頂点の中に置く）。
    頂点は graph1.vertices["A"]、辺は graph1.edges[("A", "B")] で参照できる。"""
    from manim import DiGraph, Dot, Graph, LabeledDot, MathTex
    names = [str(v) for v in vertices]
    es = [(str(a), str(b)) for a, b in edges if str(a) in names and str(b) in names and str(a) != str(b)]
    colors = list(vertex_colors or [])
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    vcfg, labs = {}, {}
    for i, v in enumerate(names):
        c = (colors[i] if i < len(colors) else None) or vertex_color
        cfg = {"radius": vertex_radius, "fill_color": c}
        if labels and i < len(labels) and str(labels[i]).strip():
            t = MathTex(str(labels[i]), font_size=label_size, color=label_color, **tk)
            cfg["radius"] = max(vertex_radius, 0.08 + (t.width ** 2 + t.height ** 2) ** 0.5 / 2)
            labs[v] = t
        vcfg[v] = cfg
    kw = {}
    lconf = {}
    if layout == "manual":
        pos = dict(positions or {})
        lay = {v: [float(pos.get(v, (0, 0))[0]), float(pos.get(v, (0, 0))[1]), 0.0] for v in names}
    else:
        lay = layout
        if layout in ("spring", "random"):
            lconf["seed"] = int(seed)
        if layout == "tree":
            kw["root_vertex"] = root if root in names else names[0]
        if layout in ("partite", "shell"):
            gs = list(groups or [])
            order = sorted({(gs[i] if i < len(gs) else 0) for i in range(len(names))})
            parts = [[v for i, v in enumerate(names) if (gs[i] if i < len(gs) else 0) == k] for k in order]
            if layout == "partite":
                kw["partitions"] = parts
            else:
                lconf["nlist"] = parts
    if layout in ("tree", "planar"):  # 使えないグラフは、分かりやすい言葉で知らせる
        import networkx as _nx
        ng = (_nx.DiGraph if directed else _nx.Graph)()
        ng.add_nodes_from(names)
        ng.add_edges_from(es)
        if layout == "tree" and not _nx.is_tree(ng):
            raise ValueError("tree の配置は、木（閉路が無く、すべての頂点がつながったグラフ）にだけ使えます。")
        if layout == "planar" and not _nx.check_planarity(ng.to_undirected())[0]:
            raise ValueError("planar の配置は、辺を交差させずに描けるグラフ（平面的グラフ）にだけ使えます。")
    ec = {"stroke_color": edge_color, "stroke_width": edge_width}
    if directed:
        ec["tip_config"] = {"tip_length": tip_size, "tip_width": tip_size}
    cls = DiGraph if directed else Graph
    # 数式のラベルがある頂点は LabeledDot、無い頂点は Dot（Manim は labels があると全部 LabeledDot にするため、自分で作る）
    vm = {v: (LabeledDot(labs[v], radius=vcfg[v]["radius"], fill_color=vcfg[v]["fill_color"]) if v in labs
              else Dot(radius=vcfg[v]["radius"], fill_color=vcfg[v]["fill_color"])) for v in names}
    g = cls(names, es, layout=lay, layout_scale=layout_scale, layout_config=lconf or None, vertex_mobjects=vm,
            edge_config=ec, **kw)
    # Manim は辺を頂点の上に重ねるので、頂点（と中の名前）を辺の上に出す
    g.remove(*g.vertices.values())
    g.add(*g.vertices.values())
    return g

class _GuiPin:
    """ページ番号などを、カメラの枠の同じ位置・同じ大きさに保つ（MovingCameraScene でカメラを動かしても、画面の隅に出す）。
    offset は、既定のカメラ（中心が原点、幅 base）での位置。"""

    def __init__(self, frame, offset, base, height):
        self.frame, self.offset, self.base, self.height = frame, offset, base, height

    def __call__(self, m):
        k = self.frame.width / self.base
        if abs(m.height - self.height * k) > 1e-6:
            m.scale(self.height * k / max(m.height, 1e-9))
        m.move_to(self.frame.get_center() + self.offset * k)


class _GuiPinW(_GuiPin):
    """_GuiPin の、幅で大きさをそろえるもの（横に長いバーは、高さが 0 に近いため）。"""

    def __call__(self, m):
        k = self.frame.width / self.base
        if self.height > 1e-6 and abs(m.width - self.height * k) > 1e-6:
            m.scale(self.height * k / max(m.width, 1e-9))
        m.move_to(self.frame.get_center() + self.offset * k)


def gui_page_number(scene, text, corner="br", buff=0.3, fixed=False, **text_kwargs):
    """ページ番号（文字は gui_text と同じ）。corner: br（右下）・bc（下中央）・bl・tr・tc・tl。画面の端から buff 単位の所に置く。
    fixed=True（3D）は画面に固定し、それ以外はカメラの枠について動く（カメラを動かしても画面の同じ所に出る）。"""
    import numpy as _np
    from manim import DL, DOWN, DR, UL, UP, UR, config
    m = gui_text([{"t": str(text)}], **text_kwargs)
    d = {"br": DR, "bc": DOWN, "bl": DL, "tr": UR, "tc": UP, "tl": UL}.get(corner, DR)
    if corner in ("bc", "tc"):
        m.to_edge(d, buff=buff)
    else:
        m.to_corner(d, buff=buff)
    if fixed:
        scene.add_fixed_in_frame_mobjects(m)
    else:
        pin = _GuiPin(scene.camera.frame, _np.array(m.get_center()), config.frame_width, m.height)
        m.add_updater(pin)
        pin(m)
        scene.add(m)
    return m

def gui_section_mark(scene, name, progress=None, spans=None, current=-1, corner="tl", bar="top", buff=0.3, fixed=False,
                     bar_color="#58C4DD", **text_kwargs):
    """章の表示: 章の名前（corner の位置）と、本編の中の進み具合のバー（画面の上端か下端。章ごとに区切る）。
    progress: 0〜1（None ならバーを出さない）。spans: 章ごとの [始まり, 終わり]（割合）。current: 今の章の番号。"""
    import numpy as _np
    from manim import DL, DOWN, DR, UL, UP, UR, Line, VGroup, config
    parts = VGroup()
    fw, fh = config.frame_width, config.frame_height
    if progress is not None:
        y = fh / 2 - 0.04 if bar == "top" else -fh / 2 + 0.04
        bars = VGroup()
        segs = spans or [[0.0, 1.0]]
        gap = 0.03 if len(segs) > 1 else 0.0
        for k, (a, b) in enumerate(segs):
            x0, x1 = -fw / 2 + a * fw + (gap / 2 if k else 0), -fw / 2 + b * fw - (gap / 2 if k < len(segs) - 1 else 0)
            if x1 <= x0:
                continue
            bars.add(Line([x0, y, 0], [x1, y, 0], color=bar_color, stroke_width=6, stroke_opacity=0.25))  # 章の全体（薄い）
            done = min(x1, -fw / 2 + float(progress) * fw)
            if done > x0:
                bars.add(Line([x0, y, 0], [done, y, 0], color=bar_color, stroke_width=6, stroke_opacity=1.0))  # 進んだ所
        parts.add(bars)
    if name:
        m = gui_text([{"t": str(name)}], **text_kwargs)
        d = {"br": DR, "bc": DOWN, "bl": DL, "tr": UR, "tc": UP, "tl": UL}.get(corner, UL)
        if corner in ("bc", "tc"):
            m.to_edge(d, buff=buff)
        else:
            m.to_corner(d, buff=buff)
        parts.add(m)
    if fixed:
        scene.add_fixed_in_frame_mobjects(parts)
    else:
        pin = _GuiPinW(scene.camera.frame, _np.array(parts.get_center()), config.frame_width, parts.width)
        parts.add_updater(pin)
        pin(parts)
        scene.add(parts)
    return parts

def gui_annot(kind, target, color="#FFC300", stroke_width=4.0, buff=0.1, corner_radius=0.0, fill_color=None,
              fill_opacity=0.0, scale_factor=1.0, colors=None, cycle_rate=0.5):
    """要素に付ける注釈。kind: box（囲み枠。SurroundingRectangle）・bg（背景の四角。BackgroundRectangle）・
    underline（下線。Underline）・cross（×印。Cross）。target の今の形（外接矩形）に合わせて作る。"""
    from manim import BackgroundRectangle, Cross, SurroundingRectangle, Underline
    if kind == "animated":  # 色が流れて回る枠（AnimatedBoundary。要素の輪郭そのものに沿う）
        from manim import AnimatedBoundary
        b = AnimatedBoundary(target, colors=list(colors or ["#29ABCA", "#9CDCEB", "#236B8E", "#736357"]),
                             max_stroke_width=stroke_width, cycle_rate=cycle_rate)
        # 作った直後は線が見えない（太さ 0）ので、最初の色で一周した所から始める（キャンバスの見た目と同じ）
        b.total_time = 0.999 / cycle_rate
        b.update_boundary_copies(0)
        return b
    if kind == "bg":
        return BackgroundRectangle(target, color=fill_color or color, fill_opacity=fill_opacity, buff=buff)
    if kind == "underline":
        return Underline(target, buff=buff, color=color, stroke_width=stroke_width)
    if kind == "cross":
        return Cross(target, stroke_color=color, stroke_width=stroke_width, scale_factor=scale_factor)
    m = SurroundingRectangle(target, color=color, buff=buff, corner_radius=corner_radius, stroke_width=stroke_width)
    m.set_fill(fill_color or color, opacity=fill_opacity)
    return m


def gui_arcbrace(center, radius, start_angle, angle, outside=True, color="#222222", label=None, label_size=36,
                 label_color=None, tex_template=None):
    """円弧に沿った中かっこ（Manim の ArcBrace）。円弧の中心・半径・角度（度）から作る（円弧を回しても合うように）。
    outside=False で内側に付ける。label（数式）は中かっこの先に置く。戻り値は VGroup（中かっこは .brace、ラベルは .label）。"""
    import numpy as _np
    from manim import LEFT, RIGHT, Arc, ArcBrace, MathTex, VGroup
    a0, da = _gui_math.radians(start_angle), _gui_math.radians(angle)
    if da < 0:
        a0, da = a0 + da, -da
    arc = Arc(radius=radius, start_angle=a0, angle=da, arc_center=_np.array([center[0], center[1], 0.0]))
    b = ArcBrace(arc, direction=RIGHT if outside else LEFT)
    b.set_color(color)
    g = VGroup(b)
    g.brace, g.label = b, None
    if label:
        lab = MathTex(label, font_size=label_size, color=label_color or color,
                      **({"tex_template": tex_template} if tex_template is not None else {}))
        mid = a0 + da / 2
        d = _np.array([_gui_math.cos(mid), _gui_math.sin(mid), 0.0]) * (1 if outside else -1)
        tip = _np.array([center[0], center[1], 0.0]) + _np.array([_gui_math.cos(mid), _gui_math.sin(mid), 0.0]) * radius
        far = max((float(_np.dot(p - tip, d)) for p in b.get_anchors()), default=0.0)
        lab.next_to(tip + d * far, d, buff=0.15)
        g.add(lab)
        g.label = lab
    return g


def gui_vector(axes, x, y, x0=0.0, y0=0.0, params=None, color="#FC6255", stroke_width=6.0, tip_length=0.25,
               coords=False, coord_color=None, coord_size=30):
    """ベクトル（Manim の Vector）。axes を渡すと座標軸の座標で (x0, y0) から (x0 + x, y0 + y) へ、無ければ Manim の単位。
    成分は数か式（スライドの値を params で渡す）。coords=True で、先に成分（縦の行列）を書く（.coords で参照）。"""
    import numpy as _np
    from manim import MathTex, Matrix, Vector, VGroup
    vx, vy, sx, sy = (_gui_num(v, params) for v in (x, y, x0, y0))
    if axes is not None:
        start, end = _np.array(axes.c2p(sx, sy)), _np.array(axes.c2p(sx + vx, sy + vy))
    else:
        start, end = _np.array([sx, sy, 0.0]), _np.array([sx + vx, sy + vy, 0.0])
    d = end - start
    if _np.linalg.norm(d) < 1e-9:
        d = _np.array([1e-6, 0.0, 0.0])
    v = Vector(d, color=color, stroke_width=stroke_width, tip_length=tip_length,
               max_tip_length_to_length_ratio=0.35).shift(start)
    g = VGroup(v)
    g.vector, g.coords = v, None
    if coords:
        fmt = lambda t: str(int(round(t))) if abs(t - round(t)) < 1e-9 else f"{t:.2f}".rstrip("0").rstrip(".")  # noqa: E731
        m = Matrix([[fmt(vx)], [fmt(vy)]], element_to_mobject=lambda s, **_: MathTex(s, font_size=coord_size,
                                                                                     color=coord_color or color),
                   bracket_config={"color": coord_color or color}, v_buff=0.55)
        m.scale(0.8)
        u = d / _np.linalg.norm(d)
        m.next_to(end, _np.array([_np.sign(u[0]) if abs(u[0]) > 0.3 else 0, _np.sign(u[1]) if abs(u[1]) > 0.3 else 0, 0.0])
                  if abs(u[0]) > 0.3 or abs(u[1]) > 0.3 else _np.array([1.0, 0, 0]), buff=0.15)
        g.add(m)
        g.coords = m
    return g

_GUI_DIRS = {"UR": (1, 1), "UL": (-1, 1), "DR": (1, -1), "DL": (-1, -1), "UP": (0, 1), "DOWN": (0, -1), "LEFT": (-1, 0), "RIGHT": (1, 0)}


def gui_derived(axes, expr, kind="derivative", c=0.0, x_range=None, samples=400, color="#83C167", stroke_width=4.0,
                dashed=False, dash_length=0.15, params=None, gradient=None):
    """グラフ y = 式 の導関数（kind="derivative"）・原始関数（"antiderivative"。F(0) = c）のグラフ（数値で求める。
    Manim の plot_derivative_graph・plot_antiderivative_graph と同じ）。"""
    import numpy as _np
    f = _gui_f1(expr, params)
    a, b = axes.x_range[0], axes.x_range[1]
    if x_range:
        a = x_range[0] if x_range[0] is not None else a
        b = x_range[1] if x_range[1] is not None else b
    xs = _np.linspace(a, b, int(samples))
    with _np.errstate(all="ignore"):
        if kind == "antiderivative":
            # 0 から x までの台形の和（細かい点で求めて、表示する点に合わせる）
            lo, hi = min(a, 0.0), max(b, 0.0)
            fine = _np.linspace(lo, hi, 4001)
            fy = _np.nan_to_num(_np.asarray(f(fine), dtype=float) * _np.ones_like(fine))
            cum = _np.concatenate([[0.0], _np.cumsum((fy[1:] + fy[:-1]) / 2 * _np.diff(fine))])
            cum -= _np.interp(0.0, fine, cum)
            ys = _np.interp(xs, fine, cum) + float(c)
        else:
            h = max((b - a) * 1e-5, 1e-7)
            ys = (_np.asarray(f(xs + h), dtype=float) - _np.asarray(f(xs - h), dtype=float)) / (2 * h) * _np.ones_like(xs)
    m = _gui_plot_xy(axes, xs, ys)
    m.set_stroke(color=color, width=stroke_width).set_fill(opacity=0)
    m = _gui_dash(m, dash_length) if dashed else m
    return _gui_gradient(m, gradient, stroke_width)


def gui_graph_label(axes, expr, x, label="f(x)", direction="UR", buff=0.25, color="#FC6255", label_size=36, dot=False,
                    params=None, tex_template=None):
    """グラフ y = 式 の x の所に置くラベル（Manim の get_graph_label と同じ置き方）。x は数か式。戻り値は VGroup（.label、.dot）。"""
    import numpy as _np
    from manim import Dot, MathTex, VGroup
    xv = _gui_num(x, params)
    yv = float(_np.nan_to_num(_gui_f1(expr, params)(_np.array([xv]))[0]))
    p = axes.c2p(xv, yv)
    d = _np.array([*_GUI_DIRS.get(direction, (1, 1)), 0.0], dtype=float)
    lab = MathTex(label, font_size=label_size, color=color, **({"tex_template": tex_template} if tex_template is not None else {}))
    lab.next_to(p, d, buff=buff)
    g = VGroup(lab)
    g.label, g.dot = lab, None
    if dot:
        g.dot = Dot(p, color=color)
        g.add(g.dot)
    return g


def gui_t_label(axes, expr, x, label=None, triangle_size=0.25, color="#222222", line_color=None, label_size=36,
                params=None, tex_template=None):
    """T 字ラベル（Manim の get_T_label と同じ形）: x 軸の上の三角、その下のラベル、グラフまでの縦線。x は数か式。"""
    import numpy as _np
    from manim import DOWN, UP, DashedLine, MathTex, RegularPolygon, VGroup
    xv = _gui_num(x, params)
    yv = float(_np.nan_to_num(_gui_f1(expr, params)(_np.array([xv]))[0]))
    tri = RegularPolygon(n=3, start_angle=_np.pi / 2, stroke_width=0).set_fill(color=color, opacity=1)
    tri.height = triangle_size
    tri.move_to(axes.c2p(xv, 0), UP)
    g = VGroup()
    g.label = None
    if label:
        lab = MathTex(label, font_size=label_size, color=color, **({"tex_template": tex_template} if tex_template is not None else {}))
        lab.next_to(tri, DOWN)
        g.add(lab)
        g.label = lab
    line = DashedLine(axes.c2p(xv, 0), axes.c2p(xv, yv), color=line_color or color)
    g.add(tri, line)
    g.triangle, g.line = tri, line
    return g


def gui_line_graph(axes, xs, ys, color="#FC6255", stroke_width=4.0, dots=True, dot_radius=0.08, dot_color=None):
    """折れ線グラフ（Manim の plot_line_graph）。点 (xs[i], ys[i]) を順に結ぶ。線は ["line_graph"]、点は ["vertex_dots"]。"""
    return axes.plot_line_graph(list(map(float, xs)), list(map(float, ys)), line_color=color, add_vertex_dots=dots,
                                vertex_dot_radius=dot_radius, vertex_dot_style={"color": dot_color or color},
                                stroke_width=stroke_width)


def gui_compute(source, params=None, code=""):
    """計算した点列。戻り値は (点の並び [(x, y) か (x, y, 種類)], 図形の並び [[(x, y), …]] または None, 説明の文字)。
    source: "code"（code の中で pts を作る）・"ode"（y' = f(x, y) を解く）・"integral"（数値積分の長方形・台形）・
    "montecarlo"（モンテカルロ法で円周率）・"trials"（さいころ・コインのくり返し）。乱数は seed で決まる（毎回同じ図になる）。"""
    import math as _m
    import random as _random
    import numpy as _np
    p = dict(params or {})
    rng = _np.random.default_rng(int(p.get("seed", 1)))
    if source == "code":
        ns = {**_gui_fn_ns(), "math": _m, "random": _random, "rng": rng, "pts": None}
        _random.seed(int(p.get("seed", 1)))
        exec(code or "pts = []", ns)  # noqa: S102 — プロジェクトに書いたコード（書き出す .py と同じ）
        pts = [tuple(float(v) for v in q[:3]) for q in (ns.get("pts") or [])]
        return pts, None, f"{len(pts)} 点"
    if source == "ode":
        f = gui_func(p.get("f") or "-y", ("x", "y"))
        x, y, x1, h = float(p.get("x0", 0)), float(p.get("y0", 1)), float(p.get("x1", 5)), abs(float(p.get("h", 0.5))) or 0.5
        method = p.get("method", "euler")
        sub = 20 if method == "exact" else 1
        hh = h / sub * (1 if x1 >= x else -1)
        pts = [(x, y)]
        n = int(min(20000, abs(x1 - x) / abs(hh) + 1e-9))
        for i in range(n):
            if method == "euler":
                y = y + hh * float(f(x, y))
            elif method == "heun":
                k1 = float(f(x, y))
                k2 = float(f(x + hh, y + hh * k1))
                y = y + hh * (k1 + k2) / 2
            else:  # rk4（exact は細かい刻みの rk4）
                k1 = float(f(x, y))
                k2 = float(f(x + hh / 2, y + hh / 2 * k1))
                k3 = float(f(x + hh / 2, y + hh / 2 * k2))
                k4 = float(f(x + hh, y + hh * k3))
                y = y + hh * (k1 + 2 * k2 + 2 * k3 + k4) / 6
            x = x + hh
            if not _m.isfinite(y):
                break
            pts.append((x, y))
        return pts, None, f"x = {x:.4g} で y ≈ {y:.6g}（{n} 歩）"
    if source == "integral":
        f = gui_func(p.get("f") or "x**2", ("x",))
        a, b, n = float(p.get("a", 0)), float(p.get("b", 2)), max(1, int(p.get("n", 8)))
        rule = p.get("rule", "left")
        dx = (b - a) / n
        shapes, total = [], 0.0
        for i in range(n):
            x0, x1 = a + i * dx, a + (i + 1) * dx
            if rule == "trapezoid":
                y0, y1 = float(f(x0)), float(f(x1))
                shapes.append([(x0, 0), (x0, y0), (x1, y1), (x1, 0)])
                total += (y0 + y1) / 2 * dx
            else:
                xm = {"left": x0, "right": x1}.get(rule, (x0 + x1) / 2)
                yv = float(f(xm))
                shapes.append([(x0, 0), (x0, yv), (x1, yv), (x1, 0)])
                total += yv * dx
        xs = _np.linspace(a, b, 2001)
        ys = _np.asarray(f(xs), dtype=float) * _np.ones_like(xs)
        fine = float(_np.sum((ys[:-1] + ys[1:]) / 2) * (b - a) / 2000)
        return [], shapes, f"近似 {total:.6g}（細かく分けた値 {fine:.6g}）"
    if source == "montecarlo":
        n = max(1, min(20000, int(p.get("n", 500))))
        xy = rng.random((n, 2))
        inside = (xy[:, 0] ** 2 + xy[:, 1] ** 2) <= 1
        pts = [(float(a), float(b), 0 if k else 1) for (a, b), k in zip(xy, inside)]
        return pts, None, f"内側 {int(inside.sum())} / {n} 点 → π ≈ {4 * inside.mean():.4f}"
    if source == "trials":
        n = max(1, min(20000, int(p.get("n", 200))))
        if p.get("kind") == "coin":
            r = rng.integers(0, 2, n)
            what = "表の割合"
        else:
            r = rng.integers(1, 7, n)
            what = "目の平均"
        run = _np.cumsum(r) / _np.arange(1, n + 1)
        pts = [(float(i + 1), float(v)) for i, v in enumerate(run)]
        return pts, None, f"{n} 回で {what} {run[-1]:.4f}（理論値 {0.5 if p.get('kind') == 'coin' else 3.5}）"
    return [], None, ""


def gui_points(axes, source="code", params=None, code="", style="line", color="#2E6FD8", color2="#D9534F",
               stroke_width=4.0, dot_radius=0.05, fill_opacity=0.35):
    """座標軸 axes の上に、計算した点列（gui_compute）を描く。style: "line"（折れ線）・"scatter"（点）・"bars"（棒）。
    数値積分は、長方形・台形を並べる。点・棒・図形は 1 つずつの部品（VGroup の中身）なので、1 つずつ出す動きにできる。"""
    from manim import Dot, Polygon, VGroup
    pts, shapes, info = gui_compute(source, params, code)
    c2p = lambda x, y: axes.c2p(x, y)  # noqa: E731
    # 座標軸の範囲の外の点は描かない（線は、範囲の外に出る所で切る）
    (xa, xb), (ya, yb) = axes.x_range[:2], axes.y_range[:2]
    tol = 1e-9
    inside = lambda q: xa - tol <= q[0] <= xb + tol and ya - tol <= q[1] <= yb + tol  # noqa: E731
    out = VGroup()
    if shapes:
        for poly in shapes:
            out.add(Polygon(*[c2p(*q) for q in poly], stroke_color=color, stroke_width=max(1.0, stroke_width / 2),
                            fill_color=color, fill_opacity=fill_opacity))
    elif style == "scatter" or (pts and len(pts[0]) > 2):
        for q in filter(inside, pts):
            col = color2 if len(q) > 2 and int(q[2]) == 1 else color
            out.add(Dot(c2p(q[0], q[1]), radius=dot_radius, color=col))
    elif style == "bars" and pts:
        xs = sorted(q[0] for q in pts)
        w = min((b - a for a, b in zip(xs, xs[1:]) if b > a), default=1.0) * 0.8
        for q in filter(inside, pts):
            out.add(Polygon(c2p(q[0] - w / 2, 0), c2p(q[0] - w / 2, q[1]), c2p(q[0] + w / 2, q[1]), c2p(q[0] + w / 2, 0),
                            stroke_color=color, stroke_width=max(1.0, stroke_width / 2), fill_color=color, fill_opacity=fill_opacity))
    elif len(pts) >= 2:
        runs, cur = [], []
        for q in pts:
            if inside(q):
                cur.append(q)
            else:
                if len(cur) >= 2:
                    runs.append(cur)
                cur = []
        if len(cur) >= 2:
            runs.append(cur)
        for r in runs:
            line = VMobject(stroke_color=color, stroke_width=stroke_width)
            line.set_points_as_corners([c2p(q[0], q[1]) for q in r])
            out.add(line)
    if (pts or shapes) and not len(out):
        info += "（座標軸の範囲に入る点がありません。座標軸の範囲を広げてください）"
    out.gui_info = info
    return out


class _GuiTracePoint:
    """TracedPath がたどる点（要素の中心。座標の点・点は、点の中心）。関数ではなく小さなクラスにする（キャッシュのハッシュのため）。"""

    def __init__(self, target):
        self.target = target

    def __call__(self):
        t = self.target
        return (t.dot if getattr(t, "dot", None) is not None else t).get_center()


def gui_trace(target, color="#FC6255", stroke_width=3.0, dissipating=None):
    """要素の通った跡を線で残す（Manim の TracedPath）。dissipating（秒）を渡すと、古い跡は消えていく。"""
    from manim import TracedPath
    return TracedPath(_GuiTracePoint(target), stroke_color=color, stroke_width=stroke_width,
                      dissipating_time=dissipating or None)

# ---- ここまで: 図形の補助関数 ----


# ---- ズーム（ZoomedScene） ----

def gui_zoom_off(scene, hide=False, run_time=1.0):
    """前のスライドのズームを止める（スライドの初めに呼ぶ。self.clear() で枠と映す所は消えるが、ズームのカメラは残るため）。
    hide=True なら、映す所を拡大する枠へ縮めて戻し（run_time 秒）、枠をフェードで消す（ステップで「ズームを消す」）。"""
    if hide:
        # 映す所を、拡大する枠へ縮めて戻し（出したときの逆）、枠をフェードで消す（Manim の例と同じ）
        from manim import FadeOut, smooth
        zd = scene.zoomed_display
        scene.play(scene.get_zoomed_display_pop_out_animation(), rate_func=lambda t: smooth(1 - t), run_time=run_time)
        scene.remove(zd)
        zd.restore()  # 次に出すときのために、映す所を元の位置に戻しておく（場面からは外してあるので見えない）
        scene.play(FadeOut(scene.zoomed_camera.frame), run_time=min(0.5, run_time))
    cam = scene.renderer.camera
    lst = getattr(cam, "image_mobjects_from_cameras", None)
    if lst is not None and scene.zoomed_display in lst:
        lst.remove(scene.zoomed_display)
    scene.zoom_activated = False


def gui_zoom(scene, frame=(0.0, 0.0), center=(4.0, 2.0), width=3.0, height=3.0, factor=0.3, color="#FFFF00",
             display_color=None, stroke_width=3.0, active=True):
    """ZoomedScene のズーム。frame は拡大する所の中心、center・width・height は拡大を映す所（Manim の単位）。
    factor は拡大する所の大きさ / 映す所の大きさ（0.3 なら約 3.3 倍に拡大）。active=False なら、ステップの
    self.activate_zooming(animate=True) で出す。戻り値は Group（.frame: 拡大する所の枠、.display: 映す所）。"""
    from manim import Group
    zc, zd = scene.zoomed_camera, scene.zoomed_display
    zc.background_color = scene.camera.background_color  # 拡大した所の背景も、スライドの背景色
    zd.stretch_to_fit_width(width).stretch_to_fit_height(height).move_to([center[0], center[1], 0])
    zc.frame.stretch_to_fit_width(width * factor).stretch_to_fit_height(height * factor).move_to([frame[0], frame[1], 0])
    zc.frame.set_stroke(color=color, width=stroke_width)
    zd.display_frame.set_stroke(color=display_color or color, width=stroke_width)
    if active:
        scene.activate_zooming(animate=False)
    g = Group(zc.frame, zd)
    g.frame, g.display = zc.frame, zd
    return g


# ---- 線形変換（LinearTransformationScene に当たるもの） ----

def gui_linear(plane, background=True, basis=True, basis_colors=("#83C167", "#FC6255"), background_opacity=0.3, clip=False):
    """座標平面を、線形変換の平面にする。background で変換の前の薄い方眼（plane.gui_background。変換しても動かない）、
    basis で基底ベクトル î・ĵ（plane.gui_basis。平面と一緒に変換される）を付ける。変換は gui_apply_matrix で。
    clip=True なら、変換したあとの方眼・軸・基底ベクトルを、平面のもとの四角形の外では描かない（はみ出して題名などに重ならない）。"""
    import numpy as _np
    from manim import Arrow, VGroup
    o = _np.array(plane.c2p(0, 0), dtype=float)
    plane.gui_frame = (o, _np.array(plane.c2p(1, 0), dtype=float) - o, _np.array(plane.c2p(0, 1), dtype=float) - o)
    # 切り取る四角形（平面のもとの範囲。軸の矢じりの分だけ少し広げる）
    plane.gui_clip = (plane.get_left()[0] - 0.05, plane.get_right()[0] + 0.05, plane.get_bottom()[1] - 0.05, plane.get_top()[1] + 0.05) if clip else None
    plane.gui_full = None  # 切り取る前の形（gui_apply_matrix が覚える）
    plane.gui_background = plane.copy().set_opacity(background_opacity) if background else None
    plane.gui_basis = None
    plane.gui_followers = []
    if basis:
        i_hat = Arrow(o, plane.c2p(1, 0), buff=0, color=basis_colors[0], stroke_width=6, max_tip_length_to_length_ratio=0.25)
        j_hat = Arrow(o, plane.c2p(0, 1), buff=0, color=basis_colors[1], stroke_width=6, max_tip_length_to_length_ratio=0.25)
        plane.gui_basis = VGroup(i_hat, j_hat)
        plane.add(plane.gui_basis)
    return plane


def gui_apply_matrix(scene, plane, matrix, run_time=2.0, followers=None, **kwargs):
    """線形変換の平面 plane（gui_linear）と、一緒に動く要素（plane.gui_followers と followers）を、行列 matrix
    （[[a, b], [c, d]]。平面の座標で）で変換するアニメーション。変換は、最初の平面の座標で考える（続けて変換すると、
    行列の積の順に重なる）。矢印は形を保ったまま両端を、点・文字・数式は中心を動かす。"""
    import numpy as _np
    from manim import Arrow, Dot, SVGMobject, Transform
    m = _np.array(matrix, dtype=float)[:2, :2]
    o, ux, uy = getattr(plane, "gui_frame", None) or (
        _np.array(plane.c2p(0, 0), dtype=float), _np.array(plane.c2p(1, 0)) - plane.c2p(0, 0), _np.array(plane.c2p(0, 1)) - plane.c2p(0, 0))
    basis = _np.array([ux[:2], uy[:2]]).T
    inv = _np.linalg.inv(basis)

    def f(p):
        c = inv @ (_np.asarray(p[:2], dtype=float) - o[:2])
        q = basis @ (m @ c) + o[:2]
        return _np.array([q[0], q[1], p[2] if len(p) > 2 else 0.0])

    def walk(sm):
        if isinstance(sm, Arrow):
            sm.put_start_and_end_on(f(sm.get_start()), f(sm.get_end()))
            return
        if isinstance(sm, (Dot, SVGMobject)):  # 点・文字・数式は、形を変えずに中心を動かす
            sm.move_to(f(sm.get_center()))
            return
        if len(sm.points):
            sm.points = _np.apply_along_axis(f, 1, sm.points)
        for sub in sm.submobjects:
            walk(sub)

    mobs = [plane, *getattr(plane, "gui_followers", []), *(followers or [])]
    anims = []
    clip = getattr(plane, "gui_clip", None)
    for mob in dict.fromkeys(mobs):  # 同じ物は 1 回
        if mob is plane and clip:
            anims.append(_gui_clipped_matrix_anim(plane, walk, clip))
            continue
        target = mob.copy()
        walk(target)
        anims.append(Transform(mob, target))
    scene.play(*anims, run_time=run_time, **kwargs)


def _gui_clip_segment(p, q, box):
    """線分 pq を四角形 box = (x0, x1, y0, y1) で切る（Liang–Barsky）。外なら None。"""
    x0, x1, y0, y1 = box
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for pk, qk in ((-dx, p[0] - x0), (dx, x1 - p[0]), (-dy, p[1] - y0), (dy, y1 - p[1])):
        if abs(pk) < 1e-12:
            if qk < 0:
                return None
            continue
        r = qk / pk
        if pk < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
        if t0 > t1:
            return None
    return (p + (q - p) * t0, p + (q - p) * t1)


def _gui_clip_family(mob, box):
    """平面（の今の形）を四角形で切る: まっすぐな線は四角形の中の部分だけにし、ほか（矢じり・目盛りの数など）は中心が外なら隠す。"""
    import numpy as _np
    x0, x1, y0, y1 = box
    for m in mob.family_members_with_points():
        pts = m.points
        a, b = pts[0], pts[-1]
        d = b - a
        n = _np.hypot(d[0], d[1])
        straight = n > 1e-9 and _np.max(_np.abs((pts[:, 0] - a[0]) * d[1] - (pts[:, 1] - a[1]) * d[0])) / n < 1e-4
        if straight:
            seg = _gui_clip_segment(a, b, box)
            if seg is None:
                m.points = _np.array([a, a, a, a])
                m.set_stroke(opacity=0)
                continue
            p, q = seg
            m.points = _np.array([p, p + (q - p) / 3, p + 2 * (q - p) / 3, q])
        else:
            c = m.get_center()
            if not (x0 <= c[0] <= x1 and y0 <= c[1] <= y1):
                m.set_stroke(opacity=0)
                m.set_fill(opacity=0)


def _gui_clipped_matrix_anim(plane, walk, box):
    """切り取る線形変換の平面の、変換のアニメーション。切り取る前の形（plane.gui_full）から変換後の形へ点を動かし、
    コマごとに四角形で切る（続けて変換しても、切り取った部分が戻る）。"""
    import numpy as _np
    from manim import UpdateFromAlphaFunc
    start = plane.gui_full if plane.gui_full is not None else plane.copy()
    target = start.copy()
    walk(target)
    fam = plane.family_members_with_points()
    fs, ft = start.family_members_with_points(), target.family_members_with_points()
    if not (len(fam) == len(fs) == len(ft)):  # 形の組み立てが違う（途中で足した物など）: 切り取らずに変える
        from manim import Transform
        tgt = plane.copy()
        walk(tgt)
        return Transform(plane, tgt)
    styles = [(m.get_stroke_opacity(), m.get_fill_opacity()) for m in fs]

    def upd(mob, alpha):
        for m, s, t, (so, fo) in zip(fam, fs, ft, styles):
            if len(s.points) == len(t.points):
                m.points = s.points + (t.points - s.points) * alpha
            m.set_stroke(opacity=so)
            m.set_fill(opacity=fo)
        _gui_clip_family(mob, box)

    plane.gui_full = target
    return UpdateFromAlphaFunc(plane, upd)


# ---- 座標軸なしの曲線（FunctionGraph・ParametricFunction・ImplicitFunction）と、任意の曲線の接線（TangentLine） ----

class _GuiPlain:
    """座標軸の代わり: 画面の座標（Manim の単位 × scale。原点は ORIGIN）。y_range は、関数のグラフを切る範囲。"""

    def __init__(self, x_range, y_range, scale=1.0):
        self.x_range, self.y_range, self.scale = list(x_range), list(y_range), float(scale)

    def c2p(self, x, y):
        import numpy as _np
        return _np.array([float(x) * self.scale, float(y) * self.scale, 0.0])


def gui_fcurve(kind="function", expr=None, x=None, y=None, x_range=(-4.0, 4.0), y_range=(-3.0, 3.0), t_range=(0.0, 6.2832),
               scale=1.0, color="#FC6255", stroke_width=4.0, dashed=False, dash_length=0.15, gradient=None, params=None):
    """座標軸を使わない曲線（画面の座標。原点が基準点で、1 の長さが Manim の scale 単位）。
    kind="function": y = expr（FunctionGraph。x_range の間、y が y_range の外の所では線を切る）、
    "parametric": (x(t), y(t))（ParametricFunction。t_range の間）、"implicit": expr = 0（ImplicitFunction。x_range・y_range の中）。"""
    import numpy as _np
    plain = _GuiPlain(x_range, y_range, scale)
    if kind == "parametric":
        return gui_curve2d(plain, x, y, t_range=t_range, color=color, stroke_width=stroke_width, dashed=dashed,
                           dash_length=dash_length, gradient=gradient, params=params)
    if kind == "implicit":
        from manim import ImplicitFunction
        params = dict(params or {})
        f0 = gui_func(expr, ("x", "y", *params))
        pv = tuple(params.values())

        def f(a, b):
            with _np.errstate(all="ignore"):
                v = float(f0(a, b, *pv))
            return v if _np.isfinite(v) else 1e9
        m = ImplicitFunction(f, x_range=list(x_range), y_range=list(y_range), color=color).scale(scale, about_point=[0, 0, 0])
        m.set_stroke(width=stroke_width)
        m = _gui_dash(m, dash_length) if dashed else m
        return _gui_gradient(m, gradient, stroke_width)
    return gui_graph(plain, expr, color=color, stroke_width=stroke_width, dashed=dashed, dash_length=dash_length,
                     gradient=gradient, params=params)


def _gui_main_curve(target):
    """要素の中の、接線を引く曲線（文字・矢じり・ラベルを除いた、いちばん大きい線）。"""
    from manim import SVGMobject, VMobject
    from manim.mobject.geometry.tips import ArrowTip
    best, size = None, -1.0

    def walk(m):
        nonlocal best, size
        if isinstance(m, (SVGMobject, ArrowTip)):
            return
        if isinstance(m, VMobject) and m.get_num_curves() > 0:
            sz = m.width + m.height
            if sz > size:
                best, size = m, sz
        for sm in m.submobjects:
            walk(sm)
    walk(target)
    return best


def gui_tangent(target, alpha=0.5, length=2.0, color="#FFC300", stroke_width=4.0, dot=True, dot_radius=0.06,
                params=None):
    """任意の曲線（図形・パス・グラフなど）の、曲線の長さの割合 alpha（0〜1）の所の接線（Manim の TangentLine）。
    alpha は数か式（スライドの値を使うと、値に合わせて接点が動く）。戻り値は VGroup（.line・.dot）。"""
    from manim import Dot, TangentLine, VGroup
    a = _gui_num(alpha, params)
    a = min(max(a, 0.0), 1.0)
    curve = _gui_main_curve(target)
    if curve is None:
        raise ValueError("接線を引ける線がありません")
    d = 1e-4
    a0, a1 = max(a - d, 0.0), min(a + d, 1.0)
    p0, p1 = curve.point_from_proportion(a0), curve.point_from_proportion(a1)
    # TangentLine と同じ（両端の近くでも引けるように、割合を 0〜1 の内側で取る）
    line = TangentLine(curve, a, length=length, d_alpha=d, color=color, stroke_width=stroke_width)
    if a <= d or a >= 1 - d:
        from manim import Line
        import numpy as _np
        v = p1 - p0
        n = _np.linalg.norm(v)
        c = curve.point_from_proportion(a)
        if n > 0:
            line = Line(c - v / n * length / 2, c + v / n * length / 2, color=color, stroke_width=stroke_width)
    g = VGroup(line)
    g.line, g.dot = line, None
    if dot:
        g.dot = Dot(curve.point_from_proportion(a), radius=dot_radius, color=color)
        g.add(g.dot)
    return g


# ---- 動画・音声（発表で再生: 発表ウィンドウが Manim の映像の上に重ねて再生する） ----

class _GuiMedia(VMobject):
    """発表で再生する動画・音声の目印（Manim の映像には何も描かない）。gui_media(self, video1, "play") などで操作する。"""

    def __init__(self, mid, spec):
        super().__init__()
        self.gui_id, self.gui_spec = mid, spec
        self.gui_playing, self.gui_pos, self.gui_since = False, float(spec.get("trimStart", 0.0)), 0.0


def gui_media_live(scene, mid, kind, path, slide=0, **spec):
    """発表で再生する動画・音声。spec（位置・大きさ・トリミング・音量など）は、書き出しのときに slides/gui_pages に保存し、
    発表ウィンドウ（と Ctrl+Enter の試し描画）がそれに従って再生する。"""
    spec = {"kind": kind, "path": path, "slide": slide, **spec}
    if not hasattr(scene, "_gui_media"):
        scene._gui_media = {}
    scene._gui_media[mid] = spec
    return _GuiMedia(mid, spec)


def gui_media(scene, m, action="play", value=None, wait=False):
    """動画・音声の操作。action: "play"（再生）・"pause"（一時停止）・"stop"（停止して最初に戻す）・"seek"（value 秒へ）・
    "volume"（value: 0〜1）・"show"・"hide"（表示・非表示。動画）。wait=True で、再生が終わるまで、wait=秒数 でその秒数だけ
    待つ（その間も再生は続く。くり返し再生のときは、終わるまでは待たない）。"""
    spec = m.gui_spec
    if getattr(m, "gui_bake", False):
        return _gui_media_baked(scene, m, action, value, wait)
    now = float(scene.renderer.time)
    end = spec.get("trimEnd") or spec.get("duration") or 0.0
    start = float(spec.get("trimStart", 0.0))
    if m.gui_playing:  # いまの再生位置（くり返しは考えない目安）
        m.gui_pos = min(end, m.gui_pos + now - m.gui_since) if end else m.gui_pos + now - m.gui_since
    if action == "play":
        if end and m.gui_pos >= end - 1e-3:
            m.gui_pos = start
        m.gui_playing, m.gui_since = True, now
    elif action == "pause":
        m.gui_playing = False
    elif action == "stop":
        m.gui_playing, m.gui_pos = False, start
    elif action == "seek":
        m.gui_pos, m.gui_since = float(value or 0.0), now
    scene._gui_cue(m.gui_id, action, value)
    if wait is not True and wait:  # 秒数だけ待つ（その間も再生は続く）
        scene.wait(float(wait))
    elif wait and m.gui_playing and not spec.get("loop") and end:
        scene.wait(max(0.1, end - m.gui_pos))
        m.gui_pos, m.gui_since = end, float(scene.renderer.time)
        m.gui_playing = False
    return m


# ---- 動画・音声（動画に焼き込む: Manim の映像の中にコマを描き、音声は add_sound で入れる） ----

_GUI_READERS = {}  # 動画の読み手（Mobject には鍵だけを持たせる。copy.deepcopy で、開いたファイルを写そうとしないように）


class _GuiVideoReader:
    """動画の t 秒のコマ（RGBA の配列）。前へ進む読み方を続け、戻るときや遠くへ飛ぶときだけシークする。"""

    def __init__(self, path, width_px):
        import av
        self.path, self.width_px = str(path), int(max(2, width_px))
        self.c = av.open(self.path)
        self.vs = self.c.streams.video[0]
        self.it = None
        self.last = None  # (時刻, 配列)
        self.nxt = None

    def _arr(self, frame):
        import numpy as _np
        img = frame.to_image()
        if img.width > self.width_px:
            from PIL import Image
            img = img.resize((self.width_px, max(1, round(img.height * self.width_px / img.width))), Image.BILINEAR)
        return _np.asarray(img.convert("RGBA"), dtype=_np.uint8).copy()

    def close(self):
        """ファイルを閉じる（描画の最後に。開いたままだと、manim-slides が逆再生の動画を作る子プロセスが止まることがある）。"""
        try:
            self.c.close()
        except Exception:  # noqa: BLE001
            pass
        self.it = None

    def _restart(self, t):
        try:
            self.c.seek(int(max(0.0, t - 0.5) / float(self.vs.time_base)), stream=self.vs, backward=True)
        except Exception:  # noqa: BLE001
            self.c.seek(0)
        self.it = self.c.decode(self.vs)
        self.last, self.nxt = None, None

    def frame_at(self, t):
        t = max(0.0, float(t))
        if self.it is None or (self.last is not None and t < self.last[0] - 1e-3) or (self.last is not None and t > self.last[0] + 3.0):
            self._restart(t)
        while True:
            if self.nxt is None:
                try:
                    f = next(self.it)
                except StopIteration:
                    break
                self.nxt = (float(f.time or 0.0), f)
            if self.nxt[0] <= t + 1e-4 or self.last is None:
                tt, f = self.nxt
                self.last = (tt, self._arr(f))
                self.nxt = None
                continue
            break
        return self.last[1]


_GUI_PCM = {}


def _gui_pcm(path):
    """音声を 44.1 kHz・2 チャンネルの数の配列（float32、-1〜1）で（ファイルごとに 1 回だけ読む）。"""
    import av
    import numpy as _np
    key = str(path)
    if key not in _GUI_PCM:
        chunks = []
        with av.open(key) as c:
            if not c.streams.audio:
                _GUI_PCM[key] = _np.zeros((0, 2), dtype=_np.float32)
                return _GUI_PCM[key]
            rs = av.AudioResampler(format="fltp", layout="stereo", rate=44100)
            for fr in c.decode(c.streams.audio[0]):
                for o in rs.resample(fr):
                    chunks.append(o.to_ndarray().T.copy())
            for o in rs.resample(None):
                chunks.append(o.to_ndarray().T.copy())
        _GUI_PCM[key] = _np.concatenate(chunks).astype(_np.float32) if chunks else _np.zeros((0, 2), dtype=_np.float32)
    return _GUI_PCM[key]


def _gui_audio_clip(scene, spec, pos0, dur, volume):
    """区間 [pos0, pos0+dur]（くり返しなら、区間の初めに戻って続ける）の音声を WAV にして、パスを返す（無音なら None）。"""
    import hashlib
    import wave
    from pathlib import Path as _P
    import numpy as _np
    rate = 44100
    pcm = _gui_pcm(spec["file"])
    if not len(pcm) or dur <= 0:
        return None
    s, e = float(spec.get("trimStart") or 0.0), float(spec.get("trimEnd") or spec.get("duration") or len(pcm) / rate)
    e = min(e, len(pcm) / rate)
    parts, p, left = [], pos0, dur
    while left > 1e-4 and p < e:
        take = min(left, e - p)
        parts.append(pcm[int(p * rate):int((p + take) * rate)])
        # フェードは区間の初め・終わりからの位置で（音量に掛ける）
        t = _np.arange(len(parts[-1])) / rate + p
        g = _np.ones(len(t), dtype=_np.float32)
        fi, fo = float(spec.get("fadeIn") or 0.0), float(spec.get("fadeOut") or 0.0)
        if fi > 0:
            g = _np.minimum(g, _np.clip((t - s) / fi, 0, 1))
        if fo > 0:
            g = _np.minimum(g, _np.clip((e - t) / fo, 0, 1))
        parts[-1] = parts[-1] * g[:, None]
        left -= take
        p += take
        if spec.get("loop") and left > 1e-4 and p >= e - 1e-4:
            p = s
    if not parts:
        return None
    a = _np.concatenate(parts) * float(volume)
    data = (_np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()
    d = _P("media") / "gui_audio"
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"{hashlib.sha1(data[:1 << 20] + str((len(data), spec['file'])).encode()).hexdigest()[:16]}.wav"
    if not out.exists():
        with wave.open(str(out), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(data)
    return str(out)


def _gui_bake_close(scene, m):
    """再生中の区間を閉じて、その間の音声を、再生を始めた時刻に入れる。"""
    if getattr(m, "_gui_span", None) is None:
        return
    t0, pos0, vol = m._gui_span
    m._gui_span = None
    now = float(scene.renderer.time)
    if m.gui_spec.get("hasAudio", True):
        f = _gui_audio_clip(scene, m.gui_spec, pos0, now - t0, vol)
        if f:
            scene.add_sound(f, time_offset=t0 - now)


def _gui_bake_pos(scene, m):
    """焼き込む動画・音声の、いまの再生位置（くり返し・終わりを考える）。終わっていたら終わりの扱いをする。"""
    spec = m.gui_spec
    s, e = float(spec.get("trimStart") or 0.0), float(spec.get("trimEnd") or spec.get("duration") or 0.0)
    if not m.gui_playing:
        return m.gui_pos
    p = m.gui_pos + float(scene.renderer.time) - m.gui_since
    if e and p >= e:
        if spec.get("loop") and e > s:
            return s + (p - s) % (e - s)
        # 終わり: 音声の区間を閉じ、終わったときの扱い
        m.gui_playing = False
        _gui_bake_close(scene, m)
        after = spec.get("after", "hold")
        m.gui_pos = s if after == "rewind" else e
        if (after == "hide" or spec.get("hideIdle")) and m in scene.mobjects:
            scene.remove(m)
        return m.gui_pos
    return p


def gui_media_bake(scene, mid, kind, path, center=(0.0, 0.0), width=4.0, **spec):
    """動画に焼き込む動画・音声。動画は ImageMobject のコマを時間に合わせて差し替える（Manim のアニメーションで動かせる。
    動かしている間・フェードの間は、Manim が更新を止めるので、コマも止まる）。音声は、再生した区間を add_sound で入れる。"""
    from pathlib import Path as _P
    import numpy as _np
    from manim import ImageMobject, config as _cfg
    base = _P(globals().get("__file__") or ".").resolve().parent  # 書き出した .py のフォルダ（プロジェクトのフォルダ）
    f = _P(path) if _P(path).is_absolute() else (base / path if (base / path).exists() else _P.cwd() / path)
    spec = {"kind": kind, "path": path, "file": str(f), **spec}
    start = float(spec.get("trimStart") or 0.0)
    if kind == "video":
        px = width * _cfg.pixel_width / _cfg.frame_width
        reader = _GuiVideoReader(spec["file"], px)
        first = reader.frame_at(float(spec.get("posterTime") or 0.0))
        m = ImageMobject(first)
        m.set_width(width).move_to([center[0], center[1], 0])
        m._gui_reader_key = f"{mid}:{id(m)}"
        _GUI_READERS[m._gui_reader_key] = reader
        m._gui_shown_t = None

        def update(mob, dt):
            # dt を受け取る（時間で変わる更新）: Manim は、時間で変わる更新の無い待ち（self.wait）を 1 枚の静止画で済ませるため、
            # dt が無いと、待っている間に動画が進まない
            t = _gui_bake_pos(scene, mob)
            if not mob.gui_playing and mob._gui_shown_t is None:
                mob.remove_updater(update)
                return  # まだ再生していない: ポスターのまま
            if mob._gui_shown_t is not None and abs(t - mob._gui_shown_t) < 1e-4:
                return
            reader = _GUI_READERS.get(mob._gui_reader_key)
            if reader is None:
                return
            arr = reader.frame_at(t)
            if arr.shape != mob.pixel_array.shape:
                return
            alpha = float(getattr(mob, "stroke_opacity", 1.0) if getattr(mob, "stroke_opacity", None) is not None else 1.0)
            arr = arr.copy()
            mob.orig_alpha_pixel_array = arr[:, :, 3].copy()
            if alpha < 0.999:
                arr[:, :, 3] = (arr[:, :, 3] * alpha).astype(_np.uint8)
            mob.pixel_array = arr
            mob._gui_shown_t = t
            if not mob.gui_playing:
                mob.remove_updater(update)  # 止まっている間は更新を外す（静止した待ちを、Manim が速く描けるように）
        m._gui_update = update
        m.add_updater(update)
    else:
        from manim import VMobject
        m = VMobject()
    m.gui_id, m.gui_spec, m.gui_bake = mid, spec, True
    m.gui_playing, m.gui_pos, m.gui_since, m._gui_span = False, start, 0.0, None
    m.gui_volume = float(spec.get("volume", 1.0))
    if not hasattr(scene, "_gui_bakes"):
        scene._gui_bakes = []
    scene._gui_bakes.append(m)
    return m


def gui_media_flush(scene):
    """最後に、再生中の焼き込む音声の区間を閉じ、動画のファイルを閉じる（書き出しの最後に呼ぶ）。"""
    for m in getattr(scene, "_gui_bakes", []):
        if m.gui_playing:
            m.gui_pos = _gui_bake_pos(scene, m)
            _gui_bake_close(scene, m)
        r = _GUI_READERS.pop(getattr(m, "_gui_reader_key", None), None)
        if r is not None:
            r.close()


def gui_media_slide_end(scene):
    """スライドの終わり（次のスライドの self.clear() の前）: そのスライドの焼き込む動画・音声を止める
    （止めないと、音声の区間が次のスライドまで続く）。"""
    for m in getattr(scene, "_gui_bakes", []):
        if m.gui_playing:
            m.gui_pos = _gui_bake_pos(scene, m)
            _gui_bake_close(scene, m)
            m.gui_playing = False


def _gui_media_baked(scene, m, action, value, wait):
    """焼き込む動画・音声の操作（gui_media から）。"""
    spec = m.gui_spec
    s, e = float(spec.get("trimStart") or 0.0), float(spec.get("trimEnd") or spec.get("duration") or 0.0)
    now = float(scene.renderer.time)
    pos = _gui_bake_pos(scene, m)
    if m.gui_playing:  # 区間を閉じて、いまの位置から
        m.gui_pos = pos
        _gui_bake_close(scene, m)
    m.gui_since = now
    video = spec.get("kind") == "video"
    if video and m._gui_update not in m.updaters:
        m.add_updater(m._gui_update)  # 再生・位置の変更: コマを差し替える更新を付け直す
    if action == "play":
        if e and m.gui_pos >= e - 1e-3:
            m.gui_pos = s
        m.gui_playing = True
        m._gui_span = (now, m.gui_pos, m.gui_volume)
        if video and m not in scene.mobjects:
            scene.add(m)
        if video:
            m._gui_shown_t = None if m._gui_shown_t is None else m._gui_shown_t
            m._gui_shown_t = -1.0  # 次のコマで、再生位置のコマにする
    elif action == "pause":
        m.gui_playing = False
        if video and spec.get("hideIdle") and m in scene.mobjects:
            scene.remove(m)
    elif action == "stop":
        m.gui_playing, m.gui_pos = False, s
        if video:
            m._gui_shown_t = -1.0
            if spec.get("hideIdle") and m in scene.mobjects:
                scene.remove(m)
    elif action == "seek":
        m.gui_pos = max(s, float(value or 0.0))
        if video:
            m._gui_shown_t = -1.0
    elif action == "volume":
        m.gui_volume = min(1.0, max(0.0, float(value or 0.0)))
    elif action == "show" and video and m not in scene.mobjects:
        scene.add(m)
    elif action == "hide" and video and m in scene.mobjects:
        scene.remove(m)
    if m.gui_playing and m._gui_span is None:
        m._gui_span = (now, m.gui_pos, m.gui_volume)
    if action == "play" and spec.get("loop") and e:
        # くり返し: この区切り（manim-slides のスライド）を、クリックするまでくり返す動画にして、1 回分を描く
        cfg = getattr(scene, "_base_slide_config", None)
        if cfg is not None:
            try:
                cfg.loop = True
            except Exception:  # noqa: BLE001
                pass
        wait = True
    if wait is not True and wait:
        # 決めた秒数だけ待つ（その間も再生は続く。焼き込む動画は、描いた時間の分しか進まない）
        scene.wait(float(wait))
        _gui_bake_pos(scene, m)
    elif wait and m.gui_playing and e:
        # 終わるまで待つ（くり返しなら、区間の終わりまでの 1 回分）。焼き込む動画は、描いた時間の分しか進まない
        scene.wait(max(0.1, e - _gui_bake_pos(scene, m)))
        _gui_bake_pos(scene, m)
    return m


# ---- アニメーションの GUI ----

def gui_start(m):
    """線・矢印の始点（グループなら、点を持つ最初の部品の始点）。GrowArrow の代わりの GrowFromPoint に使う。"""
    for x in m.family_members_with_points():
        return x.get_start()
    return m.get_center()


def _gui_vis_state(m):
    """m とその部品の、色の濃さ（塗り・線・背景の線の不透明度、画像の画素の不透明度）を写しておく。"""
    from manim import VMobject
    st = []
    for x in m.get_family():
        if isinstance(x, VMobject):
            st.append((x, {k: getattr(x, k).copy() for k in ("fill_rgbas", "stroke_rgbas", "background_stroke_rgbas") if getattr(x, k, None) is not None}))
        elif getattr(x, "pixel_array", None) is not None:
            st.append((x, {"_alpha": x.pixel_array[:, :, 3].copy()}))
    return st


def _gui_vis(state, on):
    """写しておいた濃さに戻す（on）か、すべて透明にする。Manim の set_opacity(1) と違い、塗りの無い円などを塗らない。"""
    for x, d in state:
        for k, v in d.items():
            if k == "_alpha":
                x.pixel_array[:, :, 3] = v if on else 0
            else:
                a = v.copy()
                if not on:
                    a[:, 3] = 0
                setattr(x, k, a)


def gui_blink(m, blinks=1, **kwargs):
    """まばたき（Manim の Blink と同じ並び: 見える・消える をくり返し、最後は見える）。Blink は set_opacity(1) で
    塗りの無い図形まで塗りつぶし、終わると場面から外してしまうので、元の濃さを写して戻す。"""
    from manim import Animation, linear

    class _GuiBlink(Animation):
        def begin(self):
            self._gui_state = _gui_vis_state(self.mobject)
            super().begin()

        def interpolate_mobject(self, alpha):
            n = 2 * int(blinks) + 1
            k = min(int(self.rate_func(alpha) * n), n - 1)
            _gui_vis(self._gui_state, k % 2 == 0)

        def clean_up_from_scene(self, scene):
            _gui_vis(self._gui_state, True)
            super().clean_up_from_scene(scene)

    kwargs.setdefault("rate_func", linear)
    kwargs.setdefault("run_time", 1.5)
    b = _GuiBlink(m, **kwargs)
    b._gui_fx, b._gui_blinks = "blink", blinks
    return b


def gui_subsets(m, **kwargs):
    """部品を順に出す（Manim の ShowIncreasingSubsets と同じ）。元の関数は set_opacity(1) で塗りの無い図形まで
    塗りつぶすので、部品ごとに元の濃さを写して戻す。"""
    import numpy as _np
    from manim import Animation

    class _GuiSubsets(Animation):
        def begin(self):
            self._gui_subs = list(self.mobject.submobjects) or [self.mobject]
            self._gui_states = [_gui_vis_state(x) for x in self._gui_subs]
            super().begin()

        def interpolate_mobject(self, alpha):
            k = int(_np.floor(self.rate_func(alpha) * len(self._gui_subs)))
            for i, st in enumerate(self._gui_states):
                _gui_vis(st, i < k)

        def clean_up_from_scene(self, scene):
            for st in self._gui_states:
                _gui_vis(st, True)
            super().clean_up_from_scene(scene)

    kwargs.setdefault("introducer", True)
    return _GuiSubsets(m, **kwargs)


def gui_restore(anim, m=None):
    """消す動き（Uncreate・Unwrite・ShrinkToCenter・逆に再生する SpinInFromNothing）のあとで、場面から外した対象の形を
    元に戻す（Manim はこれらで対象の点を潰したままにするので、あとで FadeIn などで出し直すと見えない・崩れるため）。"""
    m = m if m is not None else anim.mobject  # m: 元に戻す要素（部品をまとめて動かす変形では、アニメーションの mobject と違う）
    begin, clean = anim.begin, anim.clean_up_from_scene

    def _begin():
        anim._gui_saved = m.copy()
        begin()

    def _clean(scene):
        clean(scene)
        m.become(anim._gui_saved)
        scene.remove(m)

    anim.begin, anim.clean_up_from_scene = _begin, _clean
    return anim


def gui_fn_xy(p, f):
    """点 p（Manim の座標）を、式 f(x, y) → (x', y') で動かした点（ApplyPointwiseFunction の中で使う）。"""
    import numpy as _np
    x2, y2 = f(float(p[0]), float(p[1]))
    return _np.array([float(x2), float(y2), float(p[2]) if len(p) > 2 else 0.0])


def gui_type(m, reverse=False, cursor=None, ref=None, words=False, **kwargs):
    """1 文字ずつ順に出す（reverse=True なら、後ろから 1 文字ずつ消す）。AddTextLetterByLetter・TypeWithCursor と同じ動きで、
    テキスト（行ごとのまとまり）・数式・コードの、点を持つ部品を、作った順に 1 つずつ見せる（元の濃さのまま。塗りの無い物は塗らない）。
    cursor に色を渡すと、打っている所の右に縦線（カーソル）を出す。カーソルの高さと上下の位置は、その文字の行に合わせる
    （ref: 行を決める要素。一部分だけを打つときは、要素全体を渡すと、小さい文字・上付きの文字でも行の高さになる）。"""
    import numpy as _np
    from manim import Animation, Rectangle, linear

    def leaves_of(x):
        return [y for y in x.get_family() if len(getattr(y, "points", [])) and not y.submobjects]

    class _GuiType(Animation):
        def _setup_scene(self, scene):
            self._gui_scene = scene
            super()._setup_scene(scene)

        def begin(self):
            self._gui_leaves = leaves_of(self.mobject) or [self.mobject]
            self._gui_states = [_gui_vis_state(x) for x in self._gui_leaves]
            # words=True: 語（空白・改行で区切った所）ごとに出す。区切りは、文字の間のすき間（行の高さの 0.3 倍より広い所）と、行の変わり目
            n = len(self._gui_leaves)
            self._gui_bounds = list(range(1, n + 1))
            if words and n > 1:
                lv = self._gui_leaves
                hmed = sorted(x.height for x in lv)[n // 2] or 0.1
                b = []
                for i in range(n - 1):
                    a, c = lv[i], lv[i + 1]
                    new_line = c.get_top()[1] < a.get_bottom()[1] + 1e-6 or c.get_left()[0] < a.get_left()[0] - 1e-6
                    if new_line or c.get_left()[0] - a.get_right()[0] > hmed * 0.3:
                        b.append(i + 1)
                self._gui_bounds = b + [n]
            self._gui_cursor = None
            if cursor:
                from manim import config as _cfg
                # 行: 要素全体（ref）の文字を、上下の位置でまとめる。カーソルは、その文字の行の上端から下端まで
                ref_leaves = leaves_of(ref) if ref is not None else self._gui_leaves
                # 上下の範囲が重なる文字を同じ行にする（上付き・下付きの文字も、その行に入る）
                rows: list[list[float]] = []  # [中心, 下端, 上端]
                for y in sorted(ref_leaves, key=lambda q: q.get_bottom()[1]):
                    lo, hi = y.get_bottom()[1], y.get_top()[1]
                    if rows and lo < rows[-1][2] - 1e-6:
                        rows[-1][1], rows[-1][2] = min(rows[-1][1], lo), max(rows[-1][2], hi)
                    else:
                        rows.append([0.0, lo, hi])
                for r in rows:
                    r[0] = (r[1] + r[2]) / 2
                self._gui_rows = rows
                px = _cfg.frame_width / _cfg.pixel_width  # 1 画素の幅（低い画質の試し描画でも、細くなりすぎないように 3 画素以上）
                hmax = max(r[2] - r[1] for r in rows)
                self._gui_cursor = Rectangle(width=max(3 * px, hmax * 0.06), height=1.0).set_stroke(width=0).set_fill(cursor, 1)
                # いちばん手前に描く（要素の重なり順より前。背景のある要素などに隠れないように）
                fam = list(self.mobject.get_family()) + (list(ref.get_family()) if ref is not None else [])
                self._gui_cursor.set_z_index(max((getattr(x, "z_index", 0) for x in fam), default=0) + 1)
                self._gui_place(self._gui_leaves[0], False)
                sc = getattr(self, "_gui_scene", None)
                if sc is not None:
                    sc.add(self._gui_cursor)
            super().begin()

        def _gui_place(self, at, after):
            """カーソルを、文字 at の右（after）か左に、その文字の行の高さで置く。"""
            c = at.get_center()[1]
            row = next((r for r in self._gui_rows if r[1] - 1e-6 <= c <= r[2] + 1e-6), None) or min(self._gui_rows, key=lambda r: abs(r[0] - c))
            h = max(row[2] - row[1], 0.05) * 1.15
            cur = self._gui_cursor
            cur.stretch_to_fit_height(h)
            x = at.get_right()[0] + cur.width * 1.2 if after else at.get_left()[0] - cur.width * 0.6
            cur.move_to([x, (row[1] + row[2]) / 2, 0])

        def interpolate_mobject(self, alpha):
            n = len(self._gui_leaves)
            nb = len(self._gui_bounds)
            w = int(_np.ceil(self.rate_func(alpha) * nb - 1e-9))
            if reverse:
                w = nb - w
            w = max(0, min(nb, w))
            k = self._gui_bounds[w - 1] if w > 0 else 0
            for i, st in enumerate(self._gui_states):
                _gui_vis(st, i < k)
            if self._gui_cursor is not None:
                self._gui_place(self._gui_leaves[k - 1] if k > 0 else self._gui_leaves[0], k > 0)

        def clean_up_from_scene(self, scene):
            if self._gui_cursor is not None:
                scene.remove(self._gui_cursor)
            super().clean_up_from_scene(scene)
            for st in self._gui_states:  # 消したあとも、元の濃さに戻しておく（あとで出し直せるように）
                _gui_vis(st, True)

    kwargs.setdefault("rate_func", linear)
    if reverse:
        kwargs.setdefault("remover", True)
    else:
        kwargs.setdefault("introducer", True)
    t = _GuiType(m, **kwargs)
    t._gui_args = (bool(reverse), str(cursor) if cursor else "", bool(words))  # 描画の再利用（キャッシュ）で見分けるため
    return t


def gui_at(anim, start, total):
    """アニメーション anim を、start 秒から自分の長さだけ動くようにし、全体の長さを total 秒にする（同じ self.play の中で、
    動きごとに始まる時刻をずらすため）。始まる前は最初の状態（出す動きなら見えない）、終わったあとは最後の状態のまま。"""
    dur = float(anim.run_time)
    orig = anim.rate_func

    def rate(t):
        x = (t * total - start) / dur if dur > 0 else 1.0
        return orig(min(1.0, max(0.0, x)))
    anim.rate_func, anim.run_time = rate, total
    anim._gui_start, anim._gui_dur = float(start), dur
    return anim


def _gui_fx(anim, alpha):
    """強調の動き（Indicate・Wiggle・ApplyWave・gui_blink）を、対象の今の形に重ねて掛ける（gui_stack から使う）。"""
    import numpy as _np
    from manim import ApplyWave, Indicate, ManimColor, VMobject, Wiggle, there_and_back, wiggle
    a = anim.rate_func(alpha)
    m = anim.mobject
    if getattr(anim, "_gui_apply", None):
        anim._gui_apply(m, a)
    elif isinstance(anim, Indicate):
        c = m.get_center()
        m.scale(1 + (anim.scale_factor - 1) * a, about_point=c)
        rgb = _np.array(ManimColor(anim.color).to_rgb())
        for x in m.family_members_with_points():
            if isinstance(x, VMobject):
                for k in ("fill_rgbas", "stroke_rgbas"):
                    v = getattr(x, k, None)
                    if v is not None and len(v):
                        v = v.copy()
                        v[:, :3] = v[:, :3] * (1 - a) + rgb * a
                        setattr(x, k, v)
    elif isinstance(anim, Wiggle):
        c = m.get_center()
        m.scale(1 + (anim.scale_value - 1) * there_and_back(a), about_point=c)
        m.rotate(wiggle(a, anim.n_wiggles) * anim.rotation_angle, about_point=c)
    elif isinstance(anim, ApplyWave):
        m.apply_function(anim.function_at_time_t(a))
    elif getattr(anim, "_gui_fx", None) == "blink":
        n = 2 * int(anim._gui_blinks) + 1
        if min(int(a * n), n - 1) % 2 == 1:
            _gui_vis(_gui_vis_state(m), False)


_GUI_FX_TYPES = ("Indicate", "Wiggle", "ApplyWave")


def _gui_overlay(m, apply, **kwargs):
    """今の形に、進み具合 a（0〜1。緩急を掛けたもの）の変化 apply(m, a) を掛けるアニメーション。毎コマ、始めの形に戻してから
    掛ける。gui_stack の中では、ほかの動き（出す・消す・強調・動かす）で決まった形に重ねて掛ける。"""
    from manim import Animation

    class _GuiOverlay(Animation):
        def begin(self):
            self._gui_snap = self.mobject.copy()
            super().begin()

        def interpolate_mobject(self, alpha):
            self.mobject.become(self._gui_snap)
            apply(self.mobject, self.rate_func(alpha))

    anim = _GuiOverlay(m, **kwargs)
    anim._gui_apply = apply
    return anim


def _gui_point(p):
    import numpy as _np
    if hasattr(p, "get_center"):
        return _np.array(p.get_center(), dtype=float)
    v = _np.array(list(p) + [0.0] * (3 - len(p)), dtype=float)[:3]
    return v


def gui_move(m, to=None, by=None, **kwargs):
    """移動（to: 中心を移す点か要素、by: ずらす量）。.animate.move_to・.animate.shift と同じ動きで、gui_stack で重ねられる。"""
    def apply(x, a):
        d = (_gui_point(to) - x.get_center()) if to is not None else _gui_point(by)
        x.shift(a * d)
    return _gui_overlay(m, apply, **kwargs)


def gui_scale(m, factor, **kwargs):
    """中心を保った拡大・縮小（.animate.scale と同じ動き）。"""
    def apply(x, a):
        x.scale(1 + (float(factor) - 1) * a)
    return _gui_overlay(m, apply, **kwargs)


def gui_rotate(m, angle, about_point=None, **kwargs):
    """回転（Rotate と同じ動き。about_point が無ければ要素の中心のまわり）。"""
    def apply(x, a):
        x.rotate(a * float(angle), about_point=_gui_point(about_point) if about_point is not None else x.get_center())
    return _gui_overlay(m, apply, **kwargs)


def gui_color(m, color, **kwargs):
    """色を変える（.animate.set_color と同じく線と塗りの色。濃さは変えない）。"""
    import numpy as _np
    from manim import ManimColor, VMobject
    rgb = _np.array(ManimColor(color).to_rgb())

    def apply(x, a):
        for y in x.family_members_with_points():
            if isinstance(y, VMobject):
                for k in ("fill_rgbas", "stroke_rgbas"):
                    v = getattr(y, k, None)
                    if v is not None and len(v):
                        v = v.copy()
                        v[:, :3] = v[:, :3] * (1 - a) + rgb * a
                        setattr(y, k, v)
    return _gui_overlay(m, apply, **kwargs)


def gui_opacity(m, opacity, **kwargs):
    """濃さを、元の濃さ（はじめて濃さを変えたときの濃さ）に対する割合 opacity にする。set_opacity と違い、塗りの無い図形は
    塗らない。0 にしても場面には残る。"""
    from manim import VMobject
    for y in m.get_family():  # 元の濃さを覚えておく（2 回目からは、それに対する割合）
        if not hasattr(y, "_gui_a0"):
            if isinstance(y, VMobject):
                y._gui_a0 = {k: getattr(y, k)[:, 3].copy() for k in ("fill_rgbas", "stroke_rgbas", "background_stroke_rgbas")
                             if getattr(y, k, None) is not None}
            elif getattr(y, "pixel_array", None) is not None:
                y._gui_a0 = {"_alpha": y.pixel_array[:, :, 3].copy()}

    def apply(x, a):
        for y in x.get_family():
            a0 = getattr(y, "_gui_a0", None)
            if not a0:
                continue
            for k, v0 in a0.items():
                if k == "_alpha":
                    cur = y.pixel_array[:, :, 3].astype(float)
                    y.pixel_array[:, :, 3] = (cur * (1 - a) + v0 * float(opacity) * a).clip(0, 255).astype(y.pixel_array.dtype)
                    continue
                arr = getattr(y, k, None)
                if arr is None or len(arr) != len(v0):
                    continue
                arr = arr.copy()
                arr[:, 3] = arr[:, 3] * (1 - a) + v0 * float(opacity) * a
                setattr(y, k, arr)
    return _gui_overlay(m, apply, **kwargs)


def gui_path(p):
    """線に沿って動くときの線（グループなら、点を持つ最初の部品。ラベル付きの線など）。"""
    for x in p.family_members_with_points():
        return x
    return p


def gui_along(m, path, relative=True, **kwargs):
    """線 path に沿って動く。relative=True は、今の位置を始点として線と同じ形に動き、False は MoveAlongPath と同じく、
    中心が線の上を（始点から終点へ）通る。"""
    import numpy as _np
    line = gui_path(path)
    p0 = _np.array(line.point_from_proportion(0), dtype=float)

    def apply(x, a):
        q = _np.array(line.point_from_proportion(min(1.0, max(0.0, a))), dtype=float)
        x.shift((q - p0) if relative else (q - x.get_center()))
    return _gui_overlay(m, apply, **kwargs)


def gui_stack(root, *anims):
    """同じ要素（グループとその中の要素を含む）の動きを、同じ self.play の中で重ねる。Manim では、同じ要素を動かす
    アニメーションを一緒に再生すると、あとのものが毎コマ前のものを上書きしてしまう。ここでは毎コマ、
    出す・消す動き（土台）で形を決めてから、強調（Indicate・Wiggle・ApplyWave・点滅）をその形に重ねる。
    土台が無いときは、始めの形に戻してから重ねる。土台が複数あるときは、時刻の重ならないものを順に使う。
    anims は gui_at で同じ全体の長さにしたもの。root は、すべての対象を含む要素。"""
    from manim import Animation, linear

    fx = [x for x in anims if type(x).__name__ in _GUI_FX_TYPES or getattr(x, "_gui_fx", None) or getattr(x, "_gui_apply", None)]
    bases = sorted([x for x in anims if x not in fx], key=lambda x: getattr(x, "_gui_start", 0.0))
    total = max(float(x.run_time) for x in anims)

    class _GuiStack(Animation):
        def _setup_scene(self, scene):
            for b in bases:
                b._setup_scene(scene)

        def begin(self):
            snap = root.copy()
            for b in reversed(bases):  # あとの土台から始める（それぞれ、動く前の形を写すように）
                root.become(snap)
                b.begin()
            self._gui_snap = snap
            self.starting_mobject = root
            self.interpolate(0)

        def interpolate_mobject(self, alpha):
            root.become(self._gui_snap)  # 毎コマ、始めの形から作り直す（強調が積み重ならないように）
            if bases:
                t = alpha * total
                cur = bases[0]
                for b in bases:
                    if getattr(b, "_gui_start", 0.0) <= t + 1e-9:
                        cur = b
                cur.interpolate(alpha)
            for f in fx:
                _gui_fx(f, alpha)

        def get_all_mobjects(self):
            return [root]

        def clean_up_from_scene(self, scene):
            if bases:
                bases[-1].clean_up_from_scene(scene)

    st = _GuiStack(root, run_time=total, rate_func=linear, introducer=True)
    st._gui_anims = list(anims)  # 描画の再利用（キャッシュ）で、中の動きが違えば別の動きと見分けられるように
    return st


# ---------------------------------------------------------------- スライドの切り替え効果

def gui_frame_image(scene):
    """今の画面（最後に描いたフレーム）を画像にする。スライドの切り替え効果で、前のスライドとして動かす
    （カメラの位置・ズーム・焼き込む動画もそのまま写るので、前のスライドの見た目がずれない）。"""
    import numpy as np
    from manim import ImageMobject
    return ImageMobject(np.array(scene.renderer.get_frame()))


def gui_transition(scene, old, kind="fade", direction="left", run_time=1.0, out=False):
    """前のスライドの画像 old から、いま場面にある物（新しいスライドの初めの表示）へ切り替える。
    kind: fade（重ねて切り替え）・wipe（direction の向きへ押し出す。manim-slides の self.wipe と同じ）・
    zoom（manim-slides の self.zoom と同じ。out=True なら遠ざかる）。"""
    from manim import DOWN, LEFT, RIGHT, UP, AnimationGroup, FadeIn, FadeOut, config
    from manim_slides.slide.animation import Wipe, Zoom
    new = list(scene.mobjects)
    scene.remove(*new)
    fr = getattr(scene.camera, "frame", None)
    if fr is not None and not hasattr(scene, "add_fixed_in_frame_mobjects"):
        w, h, c = fr.width, fr.height, fr.get_center()
    else:  # 3D: 画面に固定して置く
        w, h, c = config.frame_width, config.frame_height, [0, 0, 0]
        scene.add_fixed_in_frame_mobjects(old)
    old.stretch_to_fit_width(w).stretch_to_fit_height(h).move_to(c)
    old.z_index = 10 ** 6  # 新しいスライドより手前（重ねて切り替えるとき、前のスライドが上で薄くなる）
    scene.add(old)
    if kind == "wipe":
        d = {"left": LEFT * w, "right": RIGHT * w, "up": UP * h, "down": DOWN * h}[direction]
        anim = Wipe([old], new, shift=d)
    elif kind == "zoom":
        anim = Zoom([old], new, out=out)
    else:
        anim = AnimationGroup(FadeOut(old), *[FadeIn(m) for m in new])
    scene.play(anim, run_time=run_time)
    scene.remove(old)


# ---------------------------------------------------------------- 統計のグラフ（段階S）

def _gui_nice(lo, hi, ticks=5):
    """lo〜hi を含む、きりのよい範囲と目盛り（1・2・5 × 10^k）。"""
    import math
    lo, hi = float(lo), float(hi)
    if hi <= lo:
        hi = lo + 1.0
    raw = (hi - lo) / max(1, ticks)
    p = 10 ** math.floor(math.log10(raw))
    step = next(m * p for m in (1, 2, 2.5, 5, 10) if m * p >= raw - 1e-12)
    a = math.floor(lo / step + 1e-9) * step
    b = math.ceil(hi / step - 1e-9) * step
    if b <= a:
        b = a + step
    out = [round(a, 10), round(b, 10), round(step, 10)]
    return [int(v) if float(v).is_integer() else v for v in out]


def gui_quartiles(values, method="textbook"):
    """四分位数。(最小, Q1, 中央値, Q3, 最大)。
    method: textbook（教科書・数学 I の求め方。中央値でデータを前半・後半に分け（個数が奇数なら中央値は除く）、それぞれの中央値）、
    linear（numpy の percentile・Excel の QUARTILE.INC と同じ、線形補間）。"""
    v = sorted(float(x) for x in values)
    if not v:
        return (0.0,) * 5
    if method != "linear":
        def med(a):
            n = len(a)
            return a[n // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2
        n = len(v)
        lower, upper = v[: n // 2], v[(n + 1) // 2:]
        return (v[0], med(lower or v), med(v), med(upper or v), v[-1])

    def q(p):
        k = (len(v) - 1) * p
        i = int(k)
        return v[i] if i + 1 >= len(v) else v[i] + (v[i + 1] - v[i]) * (k - i)
    return (v[0], q(0.25), q(0.5), q(0.75), v[-1])


def gui_linear_fit(xs, ys):
    """最小二乗法の回帰直線 y = a x + b と、決定係数 R²。(a, b, r2)。"""
    n = len(xs)
    if n < 2:
        return (0.0, ys[0] if ys else 0.0, 0.0)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    a = sxy / sxx if sxx else 0.0
    b = my - a * mx
    r2 = (sxy * sxy / (sxx * syy)) if sxx and syy else 0.0
    return (a, b, r2)


def gui_hist_bins(values, bins=None, bin_width=None, start=None, closed="left"):
    """ヒストグラムの区間の境目（bins 個、または bin_width ごと）。
    closed: left＝「以上・未満」（教科書の度数分布表。既定）、right＝「超・以下」（Excel の FREQUENCY・分析ツール）。
    幅で区切るときは、区間の端に値が来ても、どの値もどこかの区間に入るように、始まり・区間の数を決める。"""
    import math
    v = [float(x) for x in values] or [0.0]
    lo, hi = min(v), max(v)

    def by_width(w, a=None):
        if closed == "right":  # a < lo ≦ a + w となる a から
            a = (math.ceil(lo / w - 1e-9) - 1) * w if a is None else a
            k = max(1, math.ceil((hi - a) / w - 1e-9))
        else:  # a ≦ lo < a + w となる a から。右端の値が境目なら、もう 1 区間
            a = math.floor(lo / w + 1e-9) * w if a is None else a
            k = max(1, math.ceil((hi - a) / w + 1e-9))
            if a + k * w <= hi:
                k += 1
        return [round(a + i * w, 10) for i in range(k + 1)]

    if bin_width:
        return by_width(float(bin_width), None if start is None else float(start))
    if not bins:  # 区間の数はスタージェスの公式で、幅はきりのよい数に
        n = max(1, math.ceil(math.log2(len(v)) + 1))
        w = _gui_nice(0, (hi - lo) / n if hi > lo else 1, 1)[2]
        return by_width(w)
    n = int(bins)
    if hi <= lo:
        hi = lo + 1.0
    w = (hi - lo) / n
    return [lo + i * w for i in range(n + 1)]


def gui_hist_counts(values, edges, closed="left"):
    """ヒストグラムの度数。left: 以上・未満（最後の区間は右端も入れる）、right: 超・以下（最初の区間は左端も入れる）。"""
    n = len(edges) - 1
    cnt = [0] * max(n, 0)
    for v in values:
        for j in range(n):
            a, b = edges[j], edges[j + 1]
            inside = (a < v <= b or (j == 0 and v == a)) if closed == "right" else (a <= v < b or (j == n - 1 and v == b))
            if inside:
                cnt[j] += 1
                break
    return cnt


def gui_statchart(kind, *, series=None, x=None, categories=None, values=None, labels=None, colors=None, groups=None,
                  bins=None, bin_width=None, bin_start=None, bin_closed="left", density=False,
                  width=6.0, height=4.0, x_range=None, y_range=None, x_label="", y_label="",
                  axis_color="#222222", num_size=20, label_size=26, dot_radius=0.06, line_width=3.0,
                  bar_width=0.7, fill_opacity=0.8, legend="inside", grid=False,
                  show_percent=True, show_names=True, donut=0.0, start_angle=90.0, fit_label=True, decimals=2,
                  whisker=1.5, quartile="textbook", percent=False, horizontal=False, seg_labels=False, seg_outside=True, tex_template=None):
    """統計のグラフ（Manim の Axes の上に描く）。kind:
    scatter（散布図）・line（折れ線）・bar（集合縦棒）・stacked（積み上げ縦棒）・hist（ヒストグラム）・box（箱ひげ図）・pie（円グラフ）。
    series: [{"name", "y": [...], "color", "err": [...] or None, "fit": bool}]（scatter・line・bar・stacked）。
    部品は chart.axes（座標軸。chart.axes.plot(...) で関数も重ねられる）、chart.series（系列ごとの VGroup）、
    chart.fits（回帰直線）、chart.errors（誤差棒）、chart.legend（凡例）、chart.parts（棒・箱・扇形など、データの順）。
    縦棒（bar・stacked）は horizontal=True で横棒、percent=True（stacked）で分類ごとに 100% にそろえる（帯グラフ）、
    seg_labels=True で棒の中に値（100% のときは割合）を書く。"""
    import math
    from manim import (DOWN, LEFT, ORIGIN, RIGHT, UP, AnnularSector, Axes, Dot, Line, MathTex, Rectangle,
                       Square, Tex, VGroup, VMobject)
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    chart = VGroup()
    chart.axes = None
    chart.series, chart.fits, chart.errors, chart.parts = VGroup(), VGroup(), VGroup(), VGroup()
    chart.legend = VGroup()
    pal = ["#58C4DD", "#FC6255", "#83C167", "#FFC300", "#9A72AC", "#5CD0B3", "#F0AC5F", "#E65A4C", "#236B8E", "#C55F73"]
    series = [dict(s) for s in (series or [])]
    for i, s in enumerate(series):
        s.setdefault("color", pal[i % len(pal)])
        s["y"] = [None if v is None else float(v) for v in s.get("y") or []]

    def tex(t, size=label_size, color=axis_color):
        return Tex(str(t), font_size=size, color=color, **tk)

    def fmt(v):
        s = f"{v:.{int(decimals)}f}"
        return s.rstrip("0").rstrip(".") if "." in s else s

    # ---------------- 円グラフ
    if kind == "pie":
        vals = [max(0.0, float(v)) for v in (values or [])]
        total = sum(vals) or 1.0
        r = min(width, height) / 2
        ang = math.radians(start_angle)
        names = list(labels or [])
        for i, v in enumerate(vals):
            a = -2 * math.pi * v / total
            col = (colors or pal)[i % len(colors or pal)]
            sec = AnnularSector(inner_radius=r * float(donut), outer_radius=r, angle=a, start_angle=ang,
                                fill_color=col, fill_opacity=fill_opacity, stroke_color="#FFFFFF", stroke_width=2)
            mid = ang + a / 2
            parts = []
            if show_names and i < len(names) and str(names[i]).strip():
                parts.append(str(names[i]))
            if show_percent:
                parts.append(fmt(100 * v / total).replace("%", "") + r"\%")
            grp = VGroup(sec)
            if parts and v > 0:
                lab = tex(r"\\".join(parts) if len(parts) > 1 else parts[0]) if len(parts) == 1 else VGroup(*[tex(p) for p in parts]).arrange(DOWN, buff=0.08)
                rr = r * (0.5 + float(donut) / 2) if abs(a) > 0.5 else r * 1.18
                lab.move_to([rr * math.cos(mid), rr * math.sin(mid), 0])
                if abs(a) <= 0.5:  # 細い扇形は外に書く
                    lab.shift([0.5 * lab.width * math.copysign(1, math.cos(mid)) * min(1, abs(math.cos(mid)) * 3), 0, 0])
                sec.label = lab
                grp.add(lab)
            chart.parts.add(grp)
            ang += a
        chart.add(chart.parts)
        if legend != "none" and names:
            chart.legend = _gui_legend([(n, (colors or pal)[i % len(colors or pal)]) for i, n in enumerate(names[:len(vals)])], tex, label_size)
            chart.legend.next_to(chart.parts, RIGHT, buff=0.4)
            chart.add(chart.legend)
        return chart.move_to(ORIGIN) if legend == "none" or not names else chart.shift(-chart.parts.get_center())

    # ---------------- 座標軸の範囲
    cats = list(categories or [])
    horizontal = bool(horizontal) and kind in ("bar", "stacked")
    percent = bool(percent) and kind == "stacked"
    if percent:  # 分類ごとに、正の値の合計を 100 にする（負の値は使わない）
        for s in series:
            s["raw"] = list(s["y"])
        for i in range(len(cats)):
            tot = sum(max(0.0, s["y"][i] or 0) for s in series if i < len(s["y"]))
            for s in series:
                if i < len(s["y"]) and s["y"][i] is not None:
                    s["y"][i] = (max(0.0, s["y"][i]) / tot * 100) if tot > 0 else 0.0
    xs = [float(v) for v in (x or [])]
    hist_edges = None
    if kind in ("bar", "stacked", "box"):
        n = len(groups) if kind == "box" else len(cats)
        xr = [0, max(1, n), 1]
    elif kind == "hist":
        vals = [float(v) for v in (values or [])]
        hist_edges = gui_hist_bins(vals, bins, bin_width, bin_start, bin_closed)
        xr = list(x_range) if x_range else _gui_nice(hist_edges[0], hist_edges[-1], min(10, len(hist_edges) - 1))
    else:
        xr = list(x_range) if x_range else _gui_nice(min(xs or [0]), max(xs or [1]))
    if y_range:
        yr = list(y_range)
    else:
        lo, hi = 0.0, 1.0
        if kind in ("scatter", "line", "bar"):
            ys = [v + (e or 0) * sgn for s in series for v, e in zip(s["y"], (s.get("err") or [None] * len(s["y"]))) if v is not None
                  for sgn in (1, -1)]
            lo, hi = min(ys or [0]), max(ys or [1])
            if kind == "bar":
                lo, hi = min(lo, 0.0), max(hi, 0.0)
            else:
                pad = (hi - lo) * 0.05 or 0.5
                lo, hi = lo - pad, hi + pad
        elif kind == "stacked" and percent:
            lo, hi = 0.0, 100.0
        elif kind == "stacked":
            pos = [sum(max(0.0, s["y"][i] or 0) for s in series) for i in range(len(cats))]
            neg = [sum(min(0.0, s["y"][i] or 0) for s in series) for i in range(len(cats))]
            lo, hi = min(neg or [0]), max(pos or [1])
        elif kind == "hist":
            cnt = gui_hist_counts(vals, hist_edges, bin_closed)
            w0 = hist_edges[1] - hist_edges[0]
            hi = max((c / (len(vals) * w0) if density else c) for c in cnt) if cnt else 1
        elif kind == "box":
            allv = [float(v) for g in groups for v in g["values"]]
            lo, hi = min(allv or [0]), max(allv or [1])
            pad = (hi - lo) * 0.05 or 0.5
            lo, hi = lo - pad, hi + pad
        yr = [0, 100, 20] if kind == "stacked" and percent else _gui_nice(lo, hi)
    cat_axis = kind in ("bar", "stacked", "box")
    vr = yr  # 値の範囲（横棒のときは、横軸が値・縦軸が分類）
    if horizontal:
        xr, yr = yr, xr

    def places(step):  # 目盛りの数の小数点以下の桁（目盛りの幅から）
        t = f"{float(step):.10f}".rstrip("0").rstrip(".")
        return len(t.split(".")[1]) if "." in t else 0
    # 散布図などは、0 を含む範囲でも、軸を範囲の左下で交わらせる（棒グラフは 0 の所に横軸）
    AxCls = Axes if kind in ("bar", "stacked") else _gui_stat_axes_class()
    x_cat, y_cat = (cat_axis and not horizontal), horizontal
    # Manim の Axes は目盛りの数の「0」を省く（軸が 0 で交わる前提）。統計のグラフでは 0 も書く。
    # 両方の軸が 0 から始まって左下の角で交わるときだけ、横軸の 0 を省いて、角の 0 を 1 つにする
    corner0 = not x_cat and not y_cat and float(xr[0]) == 0 and float(yr[0]) == 0
    ax = AxCls(x_range=xr, y_range=yr, x_length=width, y_length=height, tips=False,
              axis_config={"color": axis_color, "font_size": num_size, "include_numbers": True},
              x_axis_config={"include_numbers": not x_cat, "include_ticks": not x_cat, "numbers_to_exclude": [0] if corner0 else [],
                             "decimal_number_config": {"num_decimal_places": places(xr[2])}},
              y_axis_config={"include_numbers": not y_cat, "include_ticks": not y_cat, "numbers_to_exclude": [],
                             "decimal_number_config": {"num_decimal_places": places(yr[2])}})
    ncat = len(cats)

    def P(c, v):  # 分類の位置 c・値 v の点（横棒は、1 つ目の分類をいちばん上に）
        return ax.c2p(v, ncat - c) if horizontal else ax.c2p(c, v)
    # Manim の Axes は、目盛りの「0」（線と数）を必ず省く（exclude_origin_tick）。範囲に 0 がある軸は、0 も入れて作り直す
    for nl, cat, skip0 in ((ax.x_axis, x_cat, corner0), (ax.y_axis, y_cat, False)):
        if cat or not (nl.x_min <= 0 <= nl.x_max) or skip0:
            continue
        nl.exclude_origin_tick = False
        if getattr(nl, "ticks", None) is not None:
            nl.remove(nl.ticks)
            nl.add_ticks()
        if getattr(nl, "numbers", None) is not None:
            nl.remove(nl.numbers)
            nl.add_numbers(font_size=num_size)
    for nl in (ax.x_axis, ax.y_axis):
        if hasattr(nl, "numbers"):
            nl.numbers.set_color(axis_color)
    chart.axes = ax
    chart.add(ax)
    if grid:
        g = VGroup()
        lo_, hi_, st_ = (xr if horizontal else yr)
        y = lo_ + st_
        while y <= hi_ + 1e-9:
            a, b = ((ax.c2p(y, yr[0]), ax.c2p(y, yr[1])) if horizontal else (ax.c2p(xr[0], y), ax.c2p(xr[1], y)))
            g.add(Line(a, b, stroke_width=1, stroke_color=axis_color, stroke_opacity=0.25))
            y += st_
        chart.grid = g
        chart.add(g)
    if cat_axis:  # 分類の名前（縦棒・箱は下、横棒は左）
        names = cats if kind != "box" else [g.get("name", "") for g in groups]
        chart.cat_labels = VGroup()
        for i, nm in enumerate(names):
            if str(nm).strip():
                if horizontal:
                    chart.cat_labels.add(tex(nm).next_to(ax.c2p(xr[0], ncat - i - 0.5), LEFT, buff=0.15))
                else:
                    chart.cat_labels.add(tex(nm).next_to(ax.c2p(i + 0.5, yr[0]), DOWN, buff=0.15))
        chart.add(chart.cat_labels)
    if y_label:  # 縦軸の名前は、目盛りの数・分類の名前の左に
        if y_cat:
            chart.y_label = tex(y_label).rotate(math.pi / 2).next_to(VGroup(ax.y_axis, chart.cat_labels), LEFT, buff=0.2)
        else:
            wnum = max((m.width for m in getattr(ax.y_axis, "numbers", [])), default=0.3)
            chart.y_label = tex(y_label).rotate(math.pi / 2).next_to(ax.y_axis, LEFT, buff=0.25 + wnum)
        chart.add(chart.y_label)
    if x_label:  # 横軸の名前は、目盛りの数・分類の名前の下に
        under = VGroup(ax.x_axis, *([chart.cat_labels] if x_cat else []))
        chart.x_label = tex(x_label).next_to(under, DOWN, buff=0.2 if x_cat else 0.2 + num_size / 48 * 0.4)
        chart.add(chart.x_label)

    def err_bar(xv, yv, e, col):
        cap = 0.08
        a, b = ax.c2p(xv, yv - e), ax.c2p(xv, yv + e)
        return VGroup(Line(a, b), Line(a + LEFT * cap, a + RIGHT * cap), Line(b + LEFT * cap, b + RIGHT * cap)).set_stroke(col, 2)

    # ---------------- 散布図・折れ線
    if kind in ("scatter", "line"):
        for s in series:
            grp = VGroup()
            pts = [(xv, yv) for xv, yv in zip(xs, s["y"]) if yv is not None]
            if kind == "line" and len(pts) >= 2:
                ln = VMobject().set_points_as_corners([ax.c2p(a, b) for a, b in pts]).set_stroke(s["color"], line_width)
                grp.add(ln)
                grp.line = ln
            dots = VGroup(*[Dot(ax.c2p(a, b), radius=dot_radius, color=s["color"]) for a, b in pts])
            grp.add(dots)
            grp.dots = dots
            chart.parts.add(*dots)
            chart.series.add(grp)
            if s.get("err"):
                eb = VGroup(*[err_bar(xv, yv, float(e), s["color"]) for xv, yv, e in zip(xs, s["y"], s["err"]) if yv is not None and e])
                chart.errors.add(eb)
            if s.get("fit") and len(pts) >= 2:
                a, b, r2 = gui_linear_fit([p[0] for p in pts], [p[1] for p in pts])
                x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
                fl = Line(ax.c2p(x0, a * x0 + b), ax.c2p(x1, a * x1 + b), stroke_color=s["color"], stroke_width=line_width)
                fl.set_stroke(opacity=0.9)
                fl.coef = (a, b, r2)
                fg = VGroup(fl)
                if fit_label:  # 式は、座標軸の左上から系列の順に並べる
                    sign = "+" if b >= 0 else "-"
                    lab = MathTex(rf"y = {fmt(a)}x {sign} {fmt(abs(b))},\ R^2 = {r2:.{max(2, int(decimals))}f}", font_size=label_size * 0.8, color=s["color"], **tk)
                    lab.next_to(ax.c2p(xr[0], yr[1]), DOWN + RIGHT, buff=0.15).shift(DOWN * len(chart.fits) * lab.height * 1.5 + RIGHT * 0.1)
                    fl.label = lab
                    fg.add(lab)
                chart.fits.add(fg)
    # ---------------- 縦棒（集合・積み上げ）
    elif kind in ("bar", "stacked"):
        k = max(1, len(series))
        for si, s in enumerate(series):
            chart.series.add(VGroup())
        base_pos = [0.0] * len(cats)
        base_neg = [0.0] * len(cats)
        outside = {}  # 分類 → 外に書く (棒, 値の文字)
        for i in range(len(cats)):
            for si, s in enumerate(series):
                v = s["y"][i] if i < len(s["y"]) else None
                if v is None:
                    continue
                if kind == "bar":
                    w = bar_width / k
                    x0 = i + 0.5 - bar_width / 2 + si * w
                    y0, y1 = 0.0, v
                else:
                    w = bar_width
                    x0 = i + 0.5 - bar_width / 2
                    if v >= 0:
                        y0, y1 = base_pos[i], base_pos[i] + v
                        base_pos[i] = y1
                    else:
                        y0, y1 = base_neg[i] + v, base_neg[i]
                        base_neg[i] = y0
                pa, pb = P(x0, min(y0, y1)), P(x0 + w, max(y0, y1))
                bw_, bh_ = abs(pb[0] - pa[0]), abs(pb[1] - pa[1])
                bar = Rectangle(width=max(1e-3, bw_), height=max(1e-3, bh_), fill_color=s["color"],
                                fill_opacity=fill_opacity, stroke_color=s["color"], stroke_width=1.5)
                bar.move_to([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, 0])
                bar.value = (s.get("raw") or s["y"])[i]
                if percent:
                    bar.percent = v
                chart.series[si].add(bar)
                chart.parts.add(bar)
                if seg_labels and abs(y1 - y0) > 0:  # 棒の中の値（入りきらないときは書かない）
                    lab = tex((fmt(v) + r"\%") if percent else fmt(bar.value), label_size * 0.8)
                    chart.parts_labels = getattr(chart, "parts_labels", VGroup())
                    if lab.width < bw_ - 0.06 and lab.height < bh_ - 0.04:
                        lab.move_to(bar)
                        bar.label = lab
                        chart.parts_labels.add(lab)
                    elif seg_outside:  # 入りきらない値は、棒の外に書く（積み上げは引き出し線を付けて、あとでまとめて並べる）
                        bar.label = lab
                        if kind == "bar":
                            tip = P(x0 + w / 2, v)
                            d = (RIGHT if v >= 0 else LEFT) if horizontal else (UP if v >= 0 else DOWN)
                            lab.next_to(tip, d, buff=0.08)
                            chart.parts_labels.add(lab)
                        else:
                            outside.setdefault(i, []).append((bar, lab))
                err = (s.get("err") or [None] * len(cats))[i] if s.get("err") else None
                if kind == "bar" and err:
                    e_, cap = float(err), 0.08
                    a, b = P(x0 + w / 2, v - e_), P(x0 + w / 2, v + e_)
                    d = UP if horizontal else RIGHT
                    chart.errors.add(VGroup(Line(a, b), Line(a - d * cap, a + d * cap), Line(b - d * cap, b + d * cap)).set_stroke(axis_color, 2))
        # 積み上げの外に書く値: 横棒は棒の上（足りなければ下）、縦棒は棒の右に、重ならないように並べて、引き出し線でつなぐ
        for i, items in outside.items():
            gap = 0.1
            if horizontal:
                row_top = P(0, vr[0])[1] if False else max(b.get_top()[1] for b in chart.parts if abs(b.get_center()[1] - items[0][0].get_center()[1]) < 1e-6)
                right_edge = -1e9
                for bar, lab in sorted(items, key=lambda t: t[0].get_center()[0]):
                    cx = max(bar.get_center()[0], right_edge + gap + lab.width / 2)
                    lab.move_to([cx, row_top + 0.12 + lab.height / 2, 0])
                    right_edge = lab.get_right()[0]
                    ln = Line(bar.get_top(), lab.get_bottom() + DOWN * 0.03, stroke_color=axis_color, stroke_width=1.5)
                    bar.leader = ln
                    chart.parts_labels.add(ln, lab)
            else:
                col_right = items[0][0].get_right()[0]
                top_edge = 1e9
                for bar, lab in sorted(items, key=lambda t: -t[0].get_center()[1]):
                    cy = min(bar.get_center()[1], top_edge - gap - lab.height / 2)
                    lab.move_to([col_right + 0.25 + lab.width / 2, cy, 0])
                    top_edge = lab.get_bottom()[1]
                    ln = Line(bar.get_right(), lab.get_left() + LEFT * 0.03, stroke_color=axis_color, stroke_width=1.5)
                    bar.leader = ln
                    chart.parts_labels.add(ln, lab)
    # ---------------- ヒストグラム
    elif kind == "hist":
        w0 = hist_edges[1] - hist_edges[0]
        col = (colors or pal)[0]
        grp = VGroup()
        hist_cnt = gui_hist_counts(vals, hist_edges, bin_closed)
        for j in range(len(hist_edges) - 1):
            c = hist_cnt[j]
            h = c / (len(vals) * w0) if density and vals else c
            p0, p1 = ax.c2p(hist_edges[j], 0), ax.c2p(hist_edges[j + 1], h)
            bar = Rectangle(width=max(1e-3, p1[0] - p0[0]), height=max(1e-3, p1[1] - p0[1]), fill_color=col,
                            fill_opacity=fill_opacity if c else 0, stroke_color=axis_color, stroke_width=1.5 if c else 0)
            bar.move_to([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0])
            bar.count = c
            grp.add(bar)
            chart.parts.add(bar)
        chart.series.add(grp)
    # ---------------- 箱ひげ図
    elif kind == "box":
        for i, g in enumerate(groups):
            vs = [float(v) for v in g["values"]]
            col = g.get("color") or pal[i % len(pal)]
            mn, q1, md, q3, mx = gui_quartiles(vs, quartile)
            iqr = q3 - q1
            lo_w = min([v for v in vs if v >= q1 - whisker * iqr] or [mn])
            hi_w = max([v for v in vs if v <= q3 + whisker * iqr] or [mx])
            cx = i + 0.5
            bw = bar_width / 2
            p0, p1 = ax.c2p(cx - bw / 2, q1), ax.c2p(cx + bw / 2, q3)
            box = Rectangle(width=p1[0] - p0[0], height=max(1e-3, p1[1] - p0[1]), fill_color=col, fill_opacity=fill_opacity * 0.6,
                            stroke_color=col, stroke_width=line_width)
            box.move_to([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0])
            med = Line(ax.c2p(cx - bw / 2, md), ax.c2p(cx + bw / 2, md), stroke_color=axis_color, stroke_width=line_width)
            cap = bw / 4
            wh = VGroup(Line(ax.c2p(cx, q3), ax.c2p(cx, hi_w)), Line(ax.c2p(cx, q1), ax.c2p(cx, lo_w)),
                        Line(ax.c2p(cx - cap, hi_w), ax.c2p(cx + cap, hi_w)), Line(ax.c2p(cx - cap, lo_w), ax.c2p(cx + cap, lo_w))).set_stroke(col, line_width)
            outl = VGroup(*[Dot(ax.c2p(cx, v), radius=dot_radius, color=col) for v in vs if v < lo_w or v > hi_w])
            item = VGroup(wh, box, med, outl)
            item.box, item.median, item.whiskers, item.outliers = box, med, wh, outl
            item.stats = {"min": mn, "q1": q1, "median": md, "q3": q3, "max": mx}
            chart.series.add(item)
            chart.parts.add(item)
    chart.add(chart.series, chart.errors, chart.fits)
    if hasattr(chart, "parts_labels"):
        chart.add(chart.parts_labels)
    names = [(s.get("name") or "", s["color"]) for s in series] if kind in ("scatter", "line", "bar", "stacked") else []
    if legend != "none" and len(names) > 1 or (legend != "none" and kind in ("bar", "stacked", "scatter", "line") and len(names) == 1 and names[0][0].strip() and legend == "right"):
        chart.legend = _gui_legend([n for n in names if n[0].strip()] or names, tex, label_size)
        around = VGroup(ax, *([chart.parts_labels] if hasattr(chart, "parts_labels") else []))
        if legend == "right":
            chart.legend.next_to(ax, RIGHT, buff=0.4)
        elif legend in ("top", "bottom") or percent or horizontal:  # 棒がグラフの中を埋めるときも、グラフの上に横に並べる
            chart.legend.arrange(RIGHT, buff=0.35).next_to(around, DOWN if legend == "bottom" else UP, buff=0.25 if legend != "bottom" else 0.45)
        elif not _gui_legend_inside(chart, ax, xr, yr):  # グラフの中: 点・棒・線に重ならない角。どこも重なるなら外の右
            chart.legend.next_to(ax, RIGHT, buff=0.4)
        chart.add(chart.legend)
    return chart.shift(-ax.get_center())


def _gui_stat_axes_class():
    """軸が範囲のいちばん小さい所（左下）で交わる Axes（Manim の Axes は、範囲に 0 があれば 0 で交わる）。"""
    from manim import Axes

    class GuiStatAxes(Axes):
        @staticmethod
        def _origin_shift(axis_range):
            return axis_range[0]
    return GuiStatAxes


def _gui_legend_inside(chart, ax, xr, yr):
    """凡例を、グラフの中の角（右上・左上・右下・左下の順）のうち、データ（点・棒・線・誤差棒・回帰直線）に重ならない所に置く。
    置けたら True。どの角も重なるなら False（呼ぶ側でグラフの外に出す）。"""
    import numpy as _np
    from manim import DOWN, LEFT, RIGHT, UP
    data = [x for g in (chart.parts, chart.series, chart.errors, chart.fits) for x in g.get_family() if len(x.points)]
    filled = [x for x in data if x.get_fill_opacity() > 0.05 and len(x.points) >= 8]

    def samples(x):
        try:
            return _np.array([x.point_from_proportion(t) for t in _np.linspace(0, 1, 24)])
        except Exception:  # noqa: BLE001
            return _np.array(x.points)

    pts = _np.vstack([samples(x) for x in data]) if data else _np.zeros((0, 3))
    corners = [(ax.c2p(xr[1], yr[1]), DOWN + LEFT), (ax.c2p(xr[0], yr[1]), DOWN + RIGHT),
               (ax.c2p(xr[1], yr[0]), UP + LEFT), (ax.c2p(xr[0], yr[0]), UP + RIGHT)]
    for corner, d in corners:
        chart.legend.next_to(corner, d, buff=0.15)
        (x0, y0, _), (x1, y1, _) = chart.legend.get_corner(DOWN + LEFT) - 0.08, chart.legend.get_corner(UP + RIGHT) + 0.08
        hit = bool(len(pts)) and bool(((pts[:, 0] > x0) & (pts[:, 0] < x1) & (pts[:, 1] > y0) & (pts[:, 1] < y1)).any())
        for f in filled:  # 塗った棒・箱: 枠の重なり（凡例が棒の中にすっぽり入る場合も）
            (a0, b0, _), (a1, b1, _) = f.get_corner(DOWN + LEFT), f.get_corner(UP + RIGHT)
            if a0 < x1 and a1 > x0 and b0 < y1 and b1 > y0:
                hit = True
                break
        if not hit:
            return True
    return False


def _gui_legend(items, tex, size):
    """凡例（色の四角と名前）。"""
    from manim import DOWN, LEFT, RIGHT, Square, VGroup
    rows = VGroup()
    for name, col in items:
        sq = Square(side_length=size / 100, fill_color=col, fill_opacity=1, stroke_width=0)
        lab = tex(name or " ", size * 0.85)
        rows.add(VGroup(sq, lab).arrange(RIGHT, buff=0.12))
    return rows.arrange(DOWN, aligned_edge=LEFT, buff=0.12)


# ---------------------------------------------------------------- 段階M: 動き

def gui_lagged(m, how="fade", lag=0.15, shift=None, **kwargs):
    """部品を少しずつずらして出す（LaggedStart）。部品は、m.parts（統計のグラフの点・棒など）があればそれ、無ければ
    いちばん外側の部品（1 つしか無ければ、その中の部品）。部品でない所（座標軸など）は、はじめにフェードで出す。
    how: fade（フェードイン）・grow（中心から大きく）・create（線を描く）・write（書く）・up（下から伸ばす。棒グラフ向き）。"""
    from manim import (DOWN, AnimationGroup, Create, FadeIn, GrowFromCenter, GrowFromEdge, LaggedStart, VGroup, Write)
    parts = list(getattr(m, "parts", None) or [])
    rest = after = None
    if parts:
        keep = set()
        for q in parts:
            keep.update(id(x) for x in q.get_family())
        # 誤差棒・回帰直線（と式）は、点・棒が出たあとに出す（先に出ると、しばらく宙に浮いて見える）
        late = set()
        for g in (getattr(m, "errors", None), getattr(m, "fits", None)):
            if g is not None:
                late.update(id(x) for x in g.get_family())
        # 部品・誤差棒などを含まない、いちばん大きなまとまりごとに集める（座標軸の線のように、自分の線と子
        # （目盛り・数）を両方持つ物も、まるごと出す。末端だけを集めると、軸の線が出ない）
        others, lates = [], []

        def collect(x):
            fam = {id(y) for y in x.get_family()}
            if id(x) in keep:
                return
            if fam <= late:
                lates.append(x)
            elif not (fam & keep) and not (fam & late):
                if len(x.get_family()) and any(len(y.points) for y in x.get_family()):
                    others.append(x)
            else:
                for c in x.submobjects:
                    collect(c)
        for c in m.submobjects:
            collect(c)
        rest = VGroup(*others) if others else None
        after = VGroup(*lates) if lates else None
    else:
        top = m
        while len(top.submobjects) == 1:
            top = top.submobjects[0]
        parts = list(top.submobjects) or [m]

    def one(q):
        if how == "grow":
            return GrowFromCenter(q)
        if how == "create":
            return Create(q)
        if how == "write":
            return Write(q)
        if how == "up":
            return GrowFromEdge(q, DOWN)
        return FadeIn(q, shift=shift) if shift is not None else FadeIn(q)
    kwargs.setdefault("introducer", True)
    if rest is None and after is None:
        return LaggedStart(*[one(q) for q in parts], lag_ratio=lag, group=m, **kwargs)
    # 座標軸などは、はじめの 3 割の時間でフェードで出し、少し重ねて部品を順に出す。誤差棒・回帰直線は最後に
    lagged = LaggedStart(*[one(q) for q in parts], lag_ratio=lag, run_time=1.0)
    end = 0.8 if after is not None else 1.0
    anims = [_gui_lag_span(lagged, 0.2 if rest is not None else 0.0, end)]
    if rest is not None:
        anims.insert(0, _gui_lag_span(FadeIn(rest, run_time=1.0), 0.0, 0.3))
    if after is not None:
        anims.append(_gui_lag_span(Create(after, run_time=1.0) if how == "create" else FadeIn(after, run_time=1.0), 0.78, 1.0))
    return AnimationGroup(*anims, group=m, **kwargs)


def _gui_lag_span(anim, a, b):
    """anim を、全体の時間の a〜b の割合の間だけ動かす（AnimationGroup の中で、ほかと同じ長さにして使う）。"""
    orig = anim.rate_func

    def rate(t):
        x = (t - a) / (b - a)
        return orig(min(1.0, max(0.0, x)))
    anim.rate_func = rate
    return anim


def gui_always(m, kind, *, speed=90.0, about=None, velocity=(1.0, 0.0), target=None, keep_offset=True, wrap=None):
    """要素に、ずっと動き続ける更新（updater）を付ける。描いている間（self.play・self.wait の間）だけ動く。
    kind: rotate（speed 度/秒で回す。about: 回す中心の点）・move（velocity 単位/秒で進む）・follow（target について行く）。
    止めるときは gui_always_stop(m)。"""
    import numpy as _np
    from manim import DEGREES
    if kind == "rotate":
        pt = None if about is None else _np.array([float(about[0]), float(about[1]), 0.0])

        def f(mob, dt):
            mob.rotate(float(speed) * DEGREES * dt, about_point=pt if pt is not None else mob.get_center())
    elif kind == "move" and wrap is not None:
        # 画面の外へ出きったら、同じ線の上を逆にたどった反対側から入ってくる（斜めでも同じ）。
        # 進む線の上の位置 u を、[入り始め, 出きる所) の範囲でくり返すので、ちょうど period 秒ごとに元の位置に戻る
        v = _np.array([float(velocity[0]), float(velocity[1]), 0.0])
        sp = float(_np.linalg.norm(v))
        fr = getattr(getattr(wrap, "camera", None), "frame", None)
        if fr is not None and not hasattr(wrap, "add_fixed_in_frame_mobjects"):
            cx, cy, fw, fh = fr.get_center()[0], fr.get_center()[1], fr.width, fr.height
        else:
            from manim import config
            cx, cy, fw, fh = 0.0, 0.0, config.frame_width, config.frame_height
        p0 = m.get_center().copy()
        hw, hh = m.width / 2, m.height / 2
        span = None
        if sp > 1e-9:
            d = v / sp
            lo, hi = -_np.inf, _np.inf
            # 要素の中心が「画面を要素の半分の大きさだけ広げた四角」の中にある間は、要素が画面に少しでも見える
            for k, (c, half) in enumerate(((cx, fw / 2 + hw), (cy, fh / 2 + hh))):
                if abs(d[k]) < 1e-12:
                    if abs(p0[k] - c) > half:
                        lo, hi = 1.0, 0.0  # この線は画面を通らない
                    continue
                a, b = (c - half - p0[k]) / d[k], (c + half - p0[k]) / d[k]
                lo, hi = max(lo, min(a, b)), min(hi, max(a, b))
            if hi > lo:
                span = (lo, hi)
        state = {"u": 0.0}

        def f(mob, dt):
            if span is None:
                mob.shift(v * dt)
                return
            u = state["u"] + sp * dt
            lo, hi = span
            length = hi - lo
            if u >= hi:
                u = lo + (u - lo) % length
            mob.shift(d * (u - state["u"]))
            state["u"] = u
        f._gui_period = ((span[1] - span[0]) / sp) if span is not None else None
        kind = "movewrap"
    elif kind == "move":
        v = _np.array([float(velocity[0]), float(velocity[1]), 0.0])

        def f(mob, dt):
            mob.shift(v * dt)
    else:
        off = (m.get_center() - target.get_center()) if keep_offset else _np.zeros(3)

        def f(mob, dt):
            mob.move_to(target.get_center() + off)
    f._gui_kind = kind
    if kind == "rotate":
        f._gui_speed = float(speed)
    m.add_updater(f)
    m._gui_always = getattr(m, "_gui_always", []) + [f]
    return m


def gui_always_stop(m):
    """gui_always で付けた更新を外す（ほかの更新は残す）。"""
    for f in getattr(m, "_gui_always", []):
        m.remove_updater(f)
    m._gui_always = []
    return m


def gui_count(m, value, **kwargs):
    """数値（DecimalNumber。名前付きの数値なら、その数）を、value まで数えながら変える（ChangeDecimalToValue）。
    スライドの値（ValueTracker）を表す数値なら、その値を value へなめらかに変える。"""
    from manim import ChangeDecimalToValue, DecimalNumber
    num = m if isinstance(m, DecimalNumber) else next((x for x in m.get_family() if isinstance(x, DecimalNumber)), m)
    tracker = getattr(num, "tracker", None) or getattr(m, "tracker", None)
    if tracker is not None:  # スライドの値を表す数値は、その値を変える（同じ値を使うほかの物も一緒に変わる）
        return tracker.animate(**kwargs).set_value(float(value)).build()
    return ChangeDecimalToValue(num, float(value), **kwargs)


def gui_code_highlight(m, lines, color="#FFFF00", opacity=0.25, **kwargs):
    """コード（Code）の行に、色の帯を付ける（lines: "2"・"2-4"・"1,3"。空なら帯を消す）。帯は背景と文字の間に入れて
    m.highlight に持ち、次の gui_code_highlight で別の行へ動く（消すときは透明にする）。"""
    from manim import Rectangle, Transform, VGroup
    rows = list(getattr(m, "code_lines", []) or [])
    want = []
    for part in str(lines or "").replace("、", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            want += list(range(int(a), int(b) + 1))
        else:
            want.append(int(part))
    first = getattr(m, "code_from", 1)
    n = len(rows)
    # 行の高さの中心: 文字の形（g・( などの下に出る所、空の行）で行の箱がずれるので、行番号があればその中心、無ければ
    # 行の上端を等間隔の直線に当てはめて求める
    nums = list(getattr(m, "line_numbers", []) or [])
    filled = [(i, r) for i, r in enumerate(rows) if r.height > 1e-6]
    if len(nums) == n and n:
        centers = [x.get_center()[1] for x in nums]
    elif len(filled) >= 2:
        xs = [i for i, _ in filled]
        ys = [r.get_top()[1] for _, r in filled]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sum((x - mx) ** 2 for x in xs) or 1)
        a0 = my - b * mx
        hmed = sorted(r.height for _, r in filled)[len(filled) // 2]
        centers = [a0 + b * i - hmed * 0.45 for i in range(n)]
    else:
        centers = [r.get_center()[1] for r in rows]
    pitch = abs(centers[0] - centers[1]) if n >= 2 else (rows[0].height * 1.3 if rows else 0.4)
    sel = [i - first for i in want if 0 <= i - first < n]
    bg = getattr(m, "background", None)
    left = bg.get_left()[0] + 0.05 if bg is not None else m.get_left()[0]
    right = bg.get_right()[0] - 0.05 if bg is not None else m.get_right()[0]
    bands = VGroup()
    for k in sel or ([0] if n else []):
        band = Rectangle(width=right - left, height=pitch * 0.98).set_stroke(width=0).set_fill(color, opacity if sel else 0)
        band.move_to([(left + right) / 2, centers[k], 0])
        bands.add(band)
    if not len(bands):
        bands.add(Rectangle(width=0.01, height=0.01).set_stroke(width=0).set_fill(color, 0).move_to(m))
    hl = getattr(m, "highlight", None)
    if hl is None:  # 初めて: 透明な帯を、背景のすぐ前に入れておく
        hl = bands.copy().set_fill(opacity=0)
        k = m.submobjects.index(bg) + 1 if bg is not None and bg in m.submobjects else 0
        m.submobjects.insert(k, hl)
        m.highlight = hl
    return Transform(hl, bands, **kwargs)


def gui_create_then_fade(m, color="#FFFF00", **kwargs):
    """要素の写しを線で描いてから、フェードで消す（Manim の古い ShowCreationThenFadeOut と同じ動き）。元の要素はそのまま。"""
    from manim import Create, FadeOut, Succession
    c = m.copy().set_color(color)
    return Succession(Create(c), FadeOut(c), **kwargs)


def gui_speed_total(speed):
    """速さの変化 [(進み 0〜1, 速さの倍率), …] の、長さの倍率と区切り（ChangeSpeed と同じ: 区切りの間は、時刻に比例して速さが変わる）。"""
    pts = sorted((min(1.0, max(0.0, float(p))), max(0.05, float(v))) for p, v in speed)
    if not pts or pts[0][0] > 0:
        pts.insert(0, (0.0, pts[0][1] if pts else 1.0))
    if pts[-1][0] < 1:
        pts.append((1.0, pts[-1][1]))
    segs, t0 = [], 0.0
    for (p0, v0), (p1, v1) in zip(pts, pts[1:]):
        if p1 - p0 <= 1e-9:
            continue
        T = 2 * (p1 - p0) / (v0 + v1)
        segs.append((p0, v0, v1, t0, T))
        t0 += T
    return t0 or 1.0, segs


def gui_speed(anim, speed):
    """動きの途中で速さを変える（Manim の ChangeSpeed と同じ速さの変え方）。speed: [(進み 0〜1, 速さの倍率), …]。
    動きの長さは、速さに合わせて変わる（遅くした分だけ長くなる）。緩急（rate_func）は、速さを変えた進みに掛ける。
    ChangeSpeed と違い、動きそのものの rate_func・run_time を変えるので、gui_at（始まる時刻をずらす）と一緒に使える。"""
    from manim import Animation
    if not isinstance(anim, Animation) and hasattr(anim, "build"):
        anim = anim.build()  # .animate
    total, segs = gui_speed_total(speed)
    orig = anim.rate_func

    def progress(t):
        tau = min(1.0, max(0.0, t)) * total
        for p0, v0, v1, s, T in segs:
            if tau <= s + T + 1e-12:
                x = tau - s
                return p0 + v0 * x + (v1 - v0) * x * x / (2 * T)
        return 1.0

    anim.rate_func = lambda t: orig(min(1.0, max(0.0, progress(t))))
    anim.run_time = float(anim.run_time) * total
    return anim


def gui_phase_flow(m, field=None, fn=None, virtual_time=1.0, keep_shape=False, **kwargs):
    """ベクトル場の流れに沿って動かす（Manim の PhaseFlow）。field はベクトル場の要素（その流れを使う）、
    または fn(x, y) → (vx, vy)（画面の座標。1 秒あたり）。virtual_time は流れる時間（長いほど遠くまで流れる）。
    keep_shape=False は点ごとに流す（形が流れで変わる。PhaseFlow）、True は中心の流れに合わせて形を保ったまま動かす。"""
    import numpy as _np
    from manim import Animation, PhaseFlow, linear
    if field is not None:
        flow = getattr(field, "_gui_flow", None)
        if flow is None:
            raise ValueError("流れに沿って動かす: 「ベクトル場」には、ベクトル場（矢印・流線）の要素を選んでください。")
    elif fn is not None:
        def flow(p):
            with _np.errstate(all="ignore"):
                v = fn(float(p[0]), float(p[1]))
                a, b = float(v[0]), float(v[1])
            return _np.array([a, b, 0.0]) if _np.isfinite(a) and _np.isfinite(b) else _np.zeros(3)
    else:
        raise ValueError("流れに沿って動かす: ベクトル場か、速度の式を決めてください。")
    kwargs.setdefault("rate_func", linear)
    if not keep_shape:
        return PhaseFlow(flow, m, virtual_time=virtual_time, **kwargs)

    class _GuiFlow(Animation):
        def begin(self):
            self._gui_last = 0.0
            super().begin()

        def interpolate_mobject(self, alpha):
            flow, virtual_time = self.gui_flow, self.gui_virtual_time
            a = self.rate_func(alpha)
            dt = virtual_time * (a - getattr(self, "_gui_last", 0.0))
            self._gui_last = a
            n = max(1, int(abs(dt) / 0.02) + 1)  # 細かく分けて進める（曲がる流れで、外へずれないように）
            h = dt / n
            for _ in range(n):  # 中点法（曲がる流れでも、外へずれにくい）
                c = self.mobject.get_center()
                self.mobject.shift(flow(c + flow(c) * h / 2) * h)

    anim = _GuiFlow(m, **kwargs)
    # 流れと流れる時間を、動きの持ち物にする（Manim の描画の再利用（キャッシュ）は、動きの持ち物で同じ動きかを見分けるので、
    # 持ち物にしないと、流れ・流れる時間を変えても、前に描いた動画がそのまま使われてしまう）
    anim.gui_flow, anim.gui_virtual_time = flow, float(virtual_time)
    return anim


def _gui_shape_key(x):
    """形の目印（位置・大きさを除いた点の並び。TransformMatchingShapes と同じ考え）。"""
    import numpy as _np
    pts = _np.asarray(x.points)
    if not len(pts):
        return None
    lo, hi = pts.min(0), pts.max(0)
    s = (hi[1] - lo[1]) if hi[1] - lo[1] > 1e-3 else max(hi[0] - lo[0], 1e-6)
    return (len(pts), _np.round((pts - (lo + hi) / 2) / s, 2).tobytes())


def gui_match_transform(src, dst, pairs=(), rest="match", path_arc=0, **kwargs):
    """数式・テキストの、決めた部分どうしを変える（TransformMatchingTex の、対応を手で決める版）。
    pairs: [(対象の部品の番号の並び, 変えた先の部品の番号の並び), …]（部品の番号は src[0][2] の [0, 2]）。
    決めなかった部分は、rest="match" なら同じ形の文字どうしを合わせ、合わない物と rest="fade" はフェードで入れ替える。
    終わると、src は場面から外れ、dst が場面に入る（src の形を戻すのは gui_restore）。"""
    from manim import AnimationGroup, FadeIn, FadeOut, ReplacementTransform, VGroup

    def at(m, path, name):
        try:
            for i in path:
                m = m[i]
        except IndexError:
            raise ValueError(f"対応を決めて変える: {name} に、部品 {list(path)} がありません（数式・テキストを変えたあとは、対応を選び直してください）。") from None
        return m

    rf = kwargs.pop("rate_func", None)
    sub = {"rate_func": rf} if rf is not None else {}
    if path_arc:
        sub["path_arc"] = path_arc
    used_a, used_b, anims = set(), set(), []
    for pa, pb in pairs:
        a = [x for q in pa for x in at(src, q, "対象").family_members_with_points() if id(x) not in used_a]
        b = [x for q in pb for x in at(dst, q, "変えた先").family_members_with_points() if id(x) not in used_b]
        if not a or not b:
            continue
        used_a |= {id(x) for x in a}
        used_b |= {id(x) for x in b}
        anims.append(ReplacementTransform(VGroup(*a), VGroup(*b), **sub))
    ra = [x for x in src.family_members_with_points() if id(x) not in used_a]
    rb = [x for x in dst.family_members_with_points() if id(x) not in used_b]
    if rest == "match":
        keys_b = [_gui_shape_key(x) for x in rb]
        left_a, taken = [], set()
        for x in ra:
            k = _gui_shape_key(x)
            j = next((j for j, kb in enumerate(keys_b) if j not in taken and kb == k), None)
            if j is None:
                left_a.append(x)
            else:
                taken.add(j)
                anims.append(ReplacementTransform(x, rb[j], **sub))
        ra, rb = left_a, [x for j, x in enumerate(rb) if j not in taken]
    fsub = {"rate_func": rf} if rf is not None else {}
    if ra:
        anims.append(FadeOut(VGroup(*ra), **fsub))
    if rb:
        anims.append(FadeIn(VGroup(*rb), **fsub))

    class _GuiMatch(AnimationGroup):
        def clean_up_from_scene(self, scene):
            super().clean_up_from_scene(scene)
            scene.remove(self.group, src)  # 動かした部品のまとまりと元の要素を外し、変えた先を入れる
            scene.add(dst)

    return _GuiMatch(*anims, **kwargs)


# ---------------------------------------------------------------- 画像の切り抜き（図形の形）

def gui_outline(m, per_curve=10):
    """要素の輪郭を、折れ線の集まり（Manim の座標の [[x, y], …] のリスト）にする。ベジェ曲線は per_curve 点ずつに分ける。
    開いた線（手書きなど）も、始めと終わりをつないだ形として扱う。"""
    import numpy as _np
    from manim.utils.bezier import bezier
    out = []
    for x in m.get_family():
        if not hasattr(x, "get_subpaths") or not len(getattr(x, "points", [])):
            continue
        n = getattr(x, "n_points_per_cubic_curve", 4)
        for sp in x.get_subpaths():
            if len(sp) < n:
                continue
            pts = []
            for k in range(0, len(sp) - n + 1, n):
                f = bezier(sp[k:k + n])
                for t in _np.linspace(0, 1, per_curve, endpoint=False):
                    pts.append(f(t)[:2])
            pts.append(sp[-1][:2])
            if len(pts) >= 3:
                out.append([[round(float(p[0]), 4), round(float(p[1]), 4)] for p in pts])
    return out


def gui_image_mask(img, shape, invert=False):
    """画像を、図形 shape の形（輪郭の内側。重なる輪郭は偶奇で穴にする）だけ見えるように切り抜く（invert なら外側だけ）。
    今の画像と図形の位置で、画像の画素の透明度に焼き込む（あとで画像を動かしても、切り抜いた形のまま動く）。"""
    import numpy as _np
    from PIL import Image, ImageDraw
    arr = _np.array(img.pixel_array)
    H, W = arr.shape[:2]
    ul, ur, dl = (_np.array(img.points[i][:2], dtype=float) for i in (0, 1, 2))
    ex, ey = ur - ul, dl - ul
    inv = _np.linalg.inv(_np.array([[ex[0], ey[0]], [ex[1], ey[1]]]))
    S = 2  # 2 倍の大きさで描いて縮める（ふちをなめらかに）
    acc = _np.zeros((H * S, W * S), dtype=bool)
    for poly in gui_outline(shape):
        q = (inv @ (_np.array(poly) - ul).T).T  # 画像の左上 (0, 0)〜右下 (1, 1)
        layer = Image.new("1", (W * S, H * S), 0)
        ImageDraw.Draw(layer).polygon([(float(a) * W * S, float(b) * H * S) for a, b in q], fill=1)
        acc ^= _np.array(layer, dtype=bool)
    mask = Image.fromarray((acc * 255).astype(_np.uint8)).resize((W, H), Image.BOX)
    k = _np.array(mask, dtype=float) / 255.0
    if invert:
        k = 1.0 - k
    if arr.shape[2] == 3:
        arr = _np.dstack([arr, _np.full((H, W), 255, dtype=_np.uint8)])
    arr[:, :, 3] = (arr[:, :, 3].astype(float) * k).round().astype(_np.uint8)
    img.pixel_array = arr
    if hasattr(img, "orig_alpha_pixel_array"):
        img.orig_alpha_pixel_array = (_np.array(img.orig_alpha_pixel_array, dtype=float) * k).round().astype(_np.uint8)
    return img


_GUI_PT48 = 0.0498132  # font_size 48 の Tex で、TeX の 1pt が Manim の何単位か（幅の指定を pt に直すため）


def gui_theorem(header, paragraphs, width=8.0, font_size=32, color="#222222", accent="#2E6FD8", boxed=True,
                roles=None, qed=False, tex_template=None):
    """定理・定義・証明などのブロック（Manim の Tex を並べる）。header・paragraphs は LaTeX の文章（数式は $…$）。
    roles は段落ごとの None か (色, 名前)（「仮定」「結論」などの強調）。qed=True で、最後に証明の終わりの印 ∎ を付ける。
    戻り値の VGroup: [0] 枠（背景と左の帯）、[1] 見出し、[2] 本文（段落ごと。各段落は VGroup(強調の背景があれば, 文章)）、
    [3] ∎（無ければ空）。1 段落ずつ出すときは thm1[2][0]、thm1[2][1] … を順に出す。"""
    from manim import DOWN, LEFT, RIGHT, UP, Tex, VGroup
    tk = {"tex_template": tex_template} if tex_template is not None else {}
    s = font_size / 32
    bar = 0.07 * s if boxed else 0.0
    pad = 0.26 * s if boxed else 0.0
    inner = max(1.0, width - 2 * pad - bar)
    pt = _GUI_PT48 * font_size / 48
    gap = (0.24 if any(roles or []) else 0.16) * s

    def box(tex):
        return Tex(r"\begin{minipage}[t]{%.2fpt}\raggedright %s\end{minipage}" % (inner / pt, tex),
                   font_size=font_size, color=color, **tk)

    head = Tex(header, font_size=font_size, color=accent, **tk) if str(header).strip() else VGroup()
    body = VGroup()
    roles = list(roles or [])
    for i, para in enumerate(paragraphs):
        role = roles[i] if i < len(roles) else None
        if role:
            rc, rname = role
            tex = box(r"{\color[HTML]{%s}\textbf{%s}}\quad %s" % (rc.lstrip("#").upper(), rname, para))
            bg = Rectangle(width=inner + 0.16 * s, height=tex.height + 0.14 * s, stroke_width=0, fill_color=rc, fill_opacity=0.12)
            bg.move_to(tex.get_center()).align_to(tex, LEFT).shift(LEFT * 0.08 * s)
            body.add(VGroup(bg, tex))
        else:
            body.add(VGroup(box(para)))
    x0 = bar + pad
    y = 0.0
    if len(head):
        head.move_to(ORIGIN).align_to([x0, 0, 0], LEFT).align_to([0, y, 0], UP)
        y = head.get_bottom()[1] - gap * 1.3
    for p in body:
        p.align_to([x0, 0, 0], LEFT).align_to([0, y, 0], UP)
        if len(p) == 2:  # 強調の背景は文章より少し左・上に広げる
            p[0].shift(LEFT * 0.08 * s + UP * 0.07 * s)
        y = p.get_bottom()[1] - gap
    end = VGroup()
    if qed:
        end = MathTex(r"\blacksquare", font_size=font_size * 0.8, color=color)
        right = x0 + inner
        if len(body):
            last = body[-1][-1]
            end.align_to([right, 0, 0], RIGHT).align_to(last, DOWN)
            if last.get_right()[0] > right - end.width - 0.15 * s:  # 最後の行が長いときは、次の行の右端に
                end.next_to(last, DOWN, buff=gap).align_to([right, 0, 0], RIGHT)
        else:
            end.align_to([right, 0, 0], RIGHT).align_to([0, y, 0], UP)
    content = VGroup(*[m for m in (head, body, end) if len(m) or m.points.size])
    frame = VGroup()
    if boxed:
        top = 0.0 + pad
        bottom = (content.get_bottom()[1] if len(content) else -0.5) - pad
        h = max(top - bottom, 0.3)
        bg = RoundedRectangle(width=width, height=h, corner_radius=0.08 * s, stroke_color=accent, stroke_width=1.5,
                              stroke_opacity=0.55, fill_color=accent, fill_opacity=0.06)
        bg.move_to([width / 2, (top + bottom) / 2, 0])
        band = Rectangle(width=bar, height=h - 0.16 * s, stroke_width=0, fill_color=accent, fill_opacity=1)
        band.align_to(bg, LEFT).shift(RIGHT * 0.04 * s).set_y(bg.get_y())
        frame.add(bg, band)
    return VGroup(frame, head, body, end).move_to(ORIGIN)
