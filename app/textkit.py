# ==== Manim Slide GUI: テキストの補助関数（GUI が自動で書き出す。編集しないでください）====
# 書式付きのテキスト（文字ごとの色・太字・斜体・下線・取り消し線・透明度・マーカー）、
# 配置（左・中央・右・両端揃え）、文字間隔・行間隔、縦書き、縁取り・中抜き・背景ボックス・円弧を、
# Manim の MarkupText（Pango）を使って組み立てる。GUI のプレビューも、この関数で作った形をそのまま表示する。
#
# 使い方: gui_text(runs, font=..., font_size=48, color="#222222", ...)
#   runs は [{"t": "文字列", "c": "#RRGGBB", "o": 0.5, "b": True, "i": True, "u": True, "s": True, "bg": "#RRGGBB"}, ...]
#   戻り値は VGroup。横書きは行ごと、縦書きは列ごとの VGroup（[行][文字]）。背景ボックスがあるときは
#   VGroup(箱, 文字) になり、文字の部分は .text、箱は .box で参照できる。

import math as _gui_math
from html import escape as _gui_escape

import numpy as _gui_np
from manim import (DOWN, LEFT, ORIGIN, RIGHT, UP, Line, ManimColor, MarkupText, Rectangle,
                   RoundedRectangle, VGroup, VMobject)

_GUI_STRUT = "#FE01FD"          # 行の範囲を測るための見えない支柱（全角ブロック █）の目印の色
_GUI_EM_PER_FONT_SIZE = 1 / 72  # Manim の単位で、font_size 1 あたりの 1em（全角 1 文字の送り幅）
_GUI_LINE_PITCH = 0.975         # 横書きの行の間隔（em）。Manim の Text の既定と同じ
_GUI_COLUMN_PITCH = 1.5         # 縦書きの列の間隔（em）
_GUI_LS_UNITS = 20480           # Pango の letter_spacing で、Manim の 1 単位に当たる値
_gui_cache = {}

# 縦書きで、縦書き用の字形に置き換える文字（Unicode の縦書き用形）
_GUI_VERT = {
    "、": "︑", "。": "︒", "，": "︐", "．": "︒", "：": "︓", "；": "︔", "！": "︕", "？": "︖",
    "「": "﹁", "」": "﹂", "『": "﹃", "』": "﹄", "（": "︵", "）": "︶", "(": "︵", ")": "︶",
    "｛": "︷", "｝": "︸", "【": "︻", "】": "︼", "〔": "︹", "〕": "︺", "〈": "︿", "〉": "﹀",
    "《": "︽", "》": "︾", "［": "﹇", "］": "﹈", "…": "︙", "‥": "︰",
}
# 縦書きで 90° 回す文字（長音記号・ダッシュ・波線など）
_GUI_ROTATE = set("ー－—―‐-~～〜=＝→←⇒")
_GUI_SMALL = set("ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ")


def _gui_hex(c):
    return ManimColor(c).to_hex().upper()


def _gui_span(text, run, color):
    """1 つの書式の区間を Pango のマークアップにする。"""
    attrs = [f'foreground="{color}"']
    if run.get("b"):
        attrs.append('font_weight="bold"')
    if run.get("i"):
        attrs.append('font_style="italic"')
    if run.get("u"):
        attrs.append('underline="single"')
    if run.get("s"):
        attrs.append('strikethrough="true"')
    if run.get("bg"):
        attrs.append(f'background="{run["bg"]}"')
    return f'<span {" ".join(attrs)}>{_gui_escape(text, quote=False)}</span>'


class _GuiColors:
    """透明度は Pango では描けないため、半透明の区間に一時的な目印の色を付け、組み立て後に置き換える。"""

    def __init__(self, base_color, base_opacity):
        self.base = _gui_hex(base_color)
        self.base_opacity = base_opacity
        self.marks = {}  # 目印の色 → (本当の色, 透明度)
        self._n = 0

    def color_for(self, run):
        color = _gui_hex(run["c"]) if run.get("c") else self.base
        opacity = run["o"] if run.get("o") is not None else self.base_opacity
        if opacity >= 0.999:
            return color
        for mark, (c, o) in self.marks.items():
            if c == color and abs(o - opacity) < 1e-6:
                return mark
        self._n += 1
        mark = "#FD%02X%02X" % (self._n // 256, self._n % 256)
        self.marks[mark] = (color, opacity)
        return mark

    def apply(self, mob):
        if not self.marks:
            return
        for m in mob.family_members_with_points():
            key = _gui_hex(m.get_fill_color())
            if key in self.marks:
                c, o = self.marks[key]
                m.set_fill(c, opacity=o)
                if m.get_stroke_width() > 0:
                    m.set_stroke(c, opacity=o)


def _gui_split_lines(runs):
    lines = [[]]
    for run in runs:
        parts = str(run.get("t", "")).replace("\r\n", "\n").split("\n")
        for k, part in enumerate(parts):
            if k > 0:
                lines.append([])
            if part:
                lines[-1].append((part, run))
    return lines


_GUI_NO_START = set("、。，．,.:;!?！？）)]］｝}」』】〕〉》〟’”・：；ー…‥々ゝゞヽヾ") | _GUI_SMALL  # 行の頭に来ない文字
_GUI_NO_END = set("（([［｛{「『【〔〈《〝‘“")  # 行の終わりに来ない文字


def _gui_is_word(ch):
    """英数字など、単語の途中では折り返さない文字。"""
    return ch.isascii() and not ch.isspace()


def _gui_can_break(a, b):
    """文字 a と b の間で折り返してよいか。"""
    if a.isspace() or b.isspace():
        return True
    if _gui_is_word(a) and _gui_is_word(b):
        return False
    return b not in _GUI_NO_START and a not in _GUI_NO_END


def _gui_char_extents(chars, font, font_size, ls):
    """各文字の左右の端（Manim の単位）。空白は None。
    長い行は Pango が勝手に折り返すので、数十文字ずつに分けて組み、文字の形の位置と送り幅（支柱の間）から測る。"""
    strut = f'<span foreground="{_GUI_STRUT}">█</span>'
    em = font_size * _GUI_EM_PER_FONT_SIZE

    def markup(part):
        body = "".join(_gui_span(ch, {"b": r.get("b"), "i": r.get("i")}, "#000000") for ch, r in part)
        if ls:
            body = f'<span letter_spacing="{ls}">{body}</span>'
        return strut + body + strut

    def measure(part):  # (各文字の左右の端（区間の頭から）, 区間の送り幅)
        mob = _gui_markup_text(markup(part), font, font_size)
        st = _gui_take_struts(mob)
        if len(st) < 2:
            return None
        x0, adv = st[0].get_right()[0], st[1].get_left()[0] - st[0].get_right()[0]
        glyphs = list(mob.submobjects)
        solid = [i for i, (ch, _) in enumerate(part) if not ch.isspace()]
        if len(glyphs) != len(solid):
            return None
        lefts = [g.get_left()[0] - x0 for g in glyphs]
        if any(b < a - 0.5 * em for a, b in zip(lefts, lefts[1:])):
            return None  # 並びが崩れている（折り返された）
        ext = [None] * len(part)
        for i, g in zip(solid, glyphs):
            ext[i] = (g.get_left()[0] - x0, g.get_right()[0] - x0)
        return ext, adv

    out = []
    x = 0.0
    step = max(1, int(14 / max(em, 1e-6)))
    for k in range(0, len(chars), step):
        part = chars[k:k + step]
        m = measure(part)
        if m is None:  # 合字などで文字と形の数が合わないときは、1 文字ずつ測って並べる
            ext, adv = [], 0.0
            for ch in part:
                key = ("w", ch[0], bool(ch[1].get("b")), bool(ch[1].get("i")), font, font_size, ls)
                if key not in _gui_cache:
                    one = measure([ch])
                    _gui_cache[key] = one[1] if one else em
                w = _gui_cache[key]
                ext.append(None if ch[0].isspace() else (adv, adv + w))
                adv += w
            m = (ext, adv)
        ext, adv = m
        out.extend(None if e is None else (x + e[0], x + e[1]) for e in ext)
        x += adv
    return out


def _gui_wrap(lines, wrap, font, font_size, ls):
    """行を、幅 wrap に収まるように折り返す。戻り値は (行, 段落の最後の行か) の並び。"""
    out = []
    for segs in lines:
        chars = [(ch, run) for t, run in segs for ch in t]
        if not chars:
            out.append((segs, True))
            continue
        ext = _gui_char_extents(chars, font, font_size, ls)

        def width(s, e, ext=ext):  # s..e-1 の文字の幅
            solid = [ext[k] for k in range(s, e) if ext[k] is not None]
            return solid[-1][1] - solid[0][0] if solid else 0.0

        n, s, ranges = len(chars), 0, []
        while s < n:
            e = s + 1
            while e < n and width(s, e + 1) <= wrap + 1e-6:
                e += 1
            if e >= n:
                ranges.append((s, n))
                break
            b = e  # e の前で切る。切ってよい所まで戻る（なければ、はみ出す単語の途中で切る）
            while b > s + 1 and not _gui_can_break(chars[b - 1][0], chars[b][0]):
                b -= 1
            if b <= s + 1 and not _gui_can_break(chars[s][0], chars[min(s + 1, n - 1)][0]):
                b = e
            end = b
            while end > s + 1 and chars[end - 1][0] == " ":
                end -= 1  # 行の終わりの空白は落とす
            ranges.append((s, end))
            s = b
            while s < n and chars[s][0] == " ":
                s += 1  # 次の行の頭の空白も落とす
        for k, (a, b) in enumerate(ranges):
            line = []
            for ch, run in chars[a:b]:
                if line and line[-1][1] is run:
                    line[-1] = (line[-1][0] + ch, run)
                else:
                    line.append((ch, run))
            out.append((line, k == len(ranges) - 1))
    return out


def _gui_markup_text(markup, font, font_size):
    key = (markup, font, font_size)
    if key not in _gui_cache:
        _gui_cache[key] = MarkupText(markup, font=font, font_size=font_size)
    return _gui_cache[key].copy()


def _gui_take_struts(mob):
    """支柱（目印の色の部分）を取り除き、その位置を返す。"""
    struts = [m for m in mob.submobjects if _gui_hex(m.get_fill_color()) == _GUI_STRUT]
    for s in struts:
        mob.remove(s)
    struts.sort(key=lambda s: s.get_center()[0])
    return struts


def _gui_is_decoration(m, em):
    """下線・取り消し線・マーカー（文字ではなく、文字に沿って伸びる図形）かどうか。"""
    return m.height < 0.2 * em or m.width > 1.3 * em


def _gui_stretch_line(line, extra, em):
    """両端揃え: 行の中の文字の間に、extra だけ均等に隙間を足す。"""
    glyphs = [m for m in line.submobjects if not _gui_is_decoration(m, em)]
    if len(glyphs) < 2 or extra <= 1e-6:
        return
    glyphs.sort(key=lambda m: m.get_center()[0])
    xs = [g.get_center()[0] for g in glyphs]
    step = extra / (len(glyphs) - 1)
    new = [x + k * step for k, x in enumerate(xs)]

    def f(x):  # 元の x を、広げたあとの x に写す（区間ごとに線形）
        if x <= xs[0]:
            return x + (new[0] - xs[0])
        for k in range(1, len(xs)):
            if x <= xs[k]:
                t = (x - xs[k - 1]) / max(xs[k] - xs[k - 1], 1e-9)
                return new[k - 1] + t * (new[k] - new[k - 1])
        return x + (new[-1] - xs[-1])

    for m in line.submobjects:
        if _gui_is_decoration(m, em):
            left, right = m.get_left()[0], m.get_right()[0]
            nl, nr = f(left), f(right)
            if right - left > 1e-6:
                m.stretch((nr - nl) / (right - left), 0, about_point=m.get_left())
            m.shift(RIGHT * (nl - m.get_left()[0]))
        else:
            cx = m.get_center()[0]
            m.shift(RIGHT * (f(cx) - cx))


def _gui_horizontal(lines, font, font_size, colors, align, letter_spacing, line_spacing, wrap=None):
    em = font_size * _GUI_EM_PER_FONT_SIZE
    pitch = _GUI_LINE_PITCH * em * line_spacing
    strut = f'<span foreground="{_GUI_STRUT}">█</span>'
    ls = ""
    if letter_spacing:
        ls = str(int(round(letter_spacing * em * _GUI_LS_UNITS)))
    if wrap:
        wrapped = _gui_wrap(lines, float(wrap), font, font_size, ls)
        lines = [segs for segs, _ in wrapped]
        ends = [last for _, last in wrapped]
    else:
        ends = [False] * len(lines)
        if ends:
            ends[-1] = True
    built = []
    for segs in lines:
        body = "".join(_gui_span(t, run, colors.color_for(run)) for t, run in segs)
        if ls and body:
            body = f'<span letter_spacing="{ls}">{body}</span>'
        mob = _gui_markup_text(strut + body + strut, font, font_size)
        s1, s2 = _gui_take_struts(mob)[:2]
        left, right, top = s1.get_right()[0], s2.get_left()[0], s1.get_top()[1]
        built.append((mob, left, right, top))
    width = max((r - l for _, l, r, _ in built), default=0)
    if wrap:
        # 折り返すときは、決めた幅を基準に揃える（行末の「。」などは、字面が幅に収まっていれば少しはみ出してよい＝ぶら下げ）
        width = float(wrap)
    out = VGroup()
    for i, (mob, left, right, top) in enumerate(built):
        w = right - left
        if align == "center":
            dx = (width - w) / 2
        elif align == "right":
            dx = width - w
        else:
            dx = 0
        mob.shift(RIGHT * (dx - left) + UP * (-i * pitch - top))
        if align == "justify" and not ends[i]:
            _gui_stretch_line(mob, width - w, em)
        out.add(mob)
    if wrap and len(out):
        # 折り返す幅いっぱいの見えない線を、行の並びの最後に足す。文字が幅より短くても、要素の範囲（中心・幅）が
        # 決めた幅になる（キャンバスの枠・位置・背景ボックスが、PowerPoint のテキストボックスと同じ幅になる）。
        # [行][文字] の並びは変えない（足すのは最後の行のさらに後ろ）
        y = out[0].get_center()[1]
        strut_line = VMobject(stroke_width=0, stroke_opacity=0, fill_opacity=0)
        strut_line.set_points_as_corners([[0, y, 0], [width, y, 0]])
        strut_line._gui_wrap_strut = True
        out.add(strut_line)
    # マーカー（背景色）の帯は行の高さいっぱいあるので、上の行の文字に重ならないよう、文字を帯より手前に描く。
    # 行の並び（[行][文字]）は変えずに、描く順番だけを z_index で変える。
    has_band = any(m.height > 1.2 * em for mob in out for m in mob.submobjects)
    if has_band:
        for mob in out:
            for m in mob.submobjects:
                if m.height <= 1.2 * em:
                    m._gui_front = True  # 同じ要素の中で、帯より手前に描く（gui_layer が要素の重なり順に足す）
                    m.set_z_index(0.5)
    return out


def _gui_vertical(lines, font, font_size, colors, align, letter_spacing, line_spacing):
    em = font_size * _GUI_EM_PER_FONT_SIZE
    col_pitch = _GUI_COLUMN_PITCH * em * line_spacing
    gap = letter_spacing * em
    strut = f'<span foreground="{_GUI_STRUT}">█</span>'
    columns = []
    for segs in lines:
        cells = []  # (mobject, 縦の送り, 回したか)
        for text, run in segs:
            color = colors.color_for(run)
            plain = {k: v for k, v in run.items() if k not in ("u", "s", "bg")}  # 縦書きの線・マーカーは自前で描く
            for ch in text:
                if ch in (" ", "　"):
                    cells.append((VGroup(), 0.5 * em if ch == " " else em, run))
                    continue
                glyph_ch = _GUI_VERT.get(ch, ch)
                mob = _gui_markup_text(strut + _gui_span(glyph_ch, plain, color) + strut, font, font_size)
                s1, s2 = _gui_take_struts(mob)[:2]
                cell = Rectangle(width=s2.get_left()[0] - s1.get_right()[0], height=em, stroke_width=0, fill_opacity=0)
                cell.move_to([(s1.get_right()[0] + s2.get_left()[0]) / 2, s1.get_center()[1], 0])
                adv = cell.width
                half = adv < 0.75 * em
                if ch in _GUI_ROTATE or half:
                    # 長音記号などや半角の英数字は、時計回りに 90° 倒す
                    VGroup(mob, cell).rotate(-_gui_math.pi / 2, about_point=cell.get_center())
                if ch in _GUI_SMALL:
                    mob.shift((RIGHT + UP) * 0.08 * em)
                mob.shift(-cell.get_center())  # 文字の枠の中心を原点に
                cells.append((mob, adv if half else em, run))
        columns.append(cells)
    lengths = [sum(a for _, a, _ in c) + gap * max(len(c) - 1, 0) for c in columns]
    longest = max(lengths, default=0)
    out = VGroup()
    for i, cells in enumerate(columns):
        x = -i * col_pitch
        extra = longest - lengths[i]
        if align == "center":
            y = -extra / 2
        elif align == "right":  # 縦書きでは「下揃え」
            y = -extra
        else:
            y = 0.0
        step = extra / (len(cells) - 1) if align == "justify" and i < len(columns) - 1 and len(cells) > 1 else 0
        col = VGroup()
        for mob, adv, run in cells:
            cy = y - adv / 2
            mob.shift([x, cy, 0])
            col.add(mob)
            color, opacity = (colors.marks.get(colors.color_for(run)) or (colors.color_for(run), 1.0))
            if run.get("bg"):
                col.add_to_back(Rectangle(width=em * 1.02, height=adv + gap, stroke_width=0, fill_color=run["bg"],
                                          fill_opacity=1).move_to([x, cy, 0]))
            if run.get("u"):  # 縦書きの下線は、右側の傍線にする
                col.add(Line([x + 0.55 * em, cy + adv / 2, 0], [x + 0.55 * em, cy - adv / 2 - gap, 0],
                             stroke_width=0.06 * em * 100 / 2, color=color).set_opacity(opacity))
            if run.get("s"):
                col.add(Line([x, cy + adv / 2, 0], [x, cy - adv / 2 - gap, 0],
                             stroke_width=0.06 * em * 100 / 2, color=color).set_opacity(opacity))
            y -= adv + gap + step
        out.add(col)
    return out


def _gui_arc(mobs, degrees, vertical, length, center):
    """文字列を円弧に沿って曲げる。

    横書き: 正の角度で上に凸、負の角度で下に凸。縦書き: 列の向き（上から下）に沿って曲げ、正の角度で右に凸。
    length は文字列の長さ（曲がり具合の基準）、center は曲げの中心。背景ボックスも同じ円弧で一緒に曲げる。
    """
    if abs(degrees) < 0.5 or length < 1e-6:
        return
    radius = length / _gui_math.radians(degrees)
    cx, cy = center[0], center[1]
    for mob, n in mobs:
        for m in mob.family_members_with_points():
            m.insert_n_curves(n)  # 直線の部分も滑らかに曲がるよう、点を増やす

    def warp_h(p):
        theta = (p[0] - cx) / radius
        r = radius + (p[1] - cy)
        return _gui_np.array([cx + r * _gui_math.sin(theta), cy + r * _gui_math.cos(theta) - radius, p[2]])

    def warp_v(p):
        theta = (cy - p[1]) / radius
        r = radius + (p[0] - cx)
        return _gui_np.array([cx + r * _gui_math.cos(theta) - radius, cy - r * _gui_math.sin(theta), p[2]])

    for mob, _ in mobs:
        mob.apply_function(warp_v if vertical else warp_h)


def gui_text(runs, font="", font_size=48, color="#000000", opacity=1.0, align="left", letter_spacing=0.0,
             line_spacing=1.0, vertical=False, outline=None, box=None, arc=0.0, wrap=None):
    """書式付きのテキストを組み立てる（GUI のテキスト要素）。"""
    if isinstance(runs, str):
        runs = [{"t": runs}]
    colors = _GuiColors(color, opacity)
    lines = _gui_split_lines(runs)
    if vertical:
        text = _gui_vertical(lines, font, font_size, colors, align, letter_spacing, line_spacing)
    else:
        text = _gui_horizontal(lines, font, font_size, colors, align, letter_spacing, line_spacing, wrap)
    colors.apply(text)
    if outline and outline.get("mode") in ("stroke", "hollow"):
        em = font_size * _GUI_EM_PER_FONT_SIZE
        width = float(outline.get("width", 0.06)) * em * 100  # em の割合 → Manim の線の太さ
        for m in text.family_members_with_points():
            if getattr(m, "_gui_wrap_strut", False):
                continue
            fill_c, fill_o = m.get_fill_color(), m.get_fill_opacity()
            stroke_c = outline.get("color") or fill_c
            m.set_stroke(stroke_c, width=width, opacity=fill_o if outline.get("color") is None else 1, background=False)
            if outline["mode"] == "hollow":
                m.set_fill(fill_c, opacity=0)
    text.move_to(ORIGIN)
    # 曲げる前の文字の長さと中心（縦書きは列の向きの長さ）を、曲がり具合の基準にする
    length = text.height if vertical else text.width
    center = text.get_center()
    rect = None
    follow = bool(box.get("follow", True)) if box else True

    def make_box():
        em = font_size * _GUI_EM_PER_FONT_SIZE
        pad = float(box.get("padding", 0.3)) * em
        r = RoundedRectangle(width=text.width + 2 * pad, height=text.height + 2 * pad,
                             corner_radius=min(float(box.get("radius", 0.2)) * em, (min(text.width, text.height) + 2 * pad) / 2),
                             stroke_width=0, fill_color=box.get("color", "#FFFFFF"),
                             fill_opacity=float(box.get("opacity", 1.0)))
        return r.move_to(text.get_center())

    if box and box.get("on") and (follow or not arc):
        rect = make_box()  # 曲げる前の文字を囲む箱（円弧に沿わせる場合は、このあと文字と一緒に曲げる）
    if arc:
        # 背景ボックスを円弧に沿わせる場合は、文字と同じ円弧で一緒に曲げる（辺が滑らかに曲がるよう点を多めに増やす）
        _gui_arc([(text, 6)] + ([(rect, 48)] if rect is not None else []), float(arc), vertical, length, center)
        if box and box.get("on") and not follow:
            rect = make_box()  # 沿わせない場合は、曲げたあとの文字全体を、まっすぐな箱で囲む
    if rect is not None:
        group = VGroup(rect, text)
        group.text, group.box = text, rect
        group.move_to(ORIGIN)
        return group
    text.move_to(ORIGIN)
    return text
# ==== ここまでテキストの補助関数 ====
