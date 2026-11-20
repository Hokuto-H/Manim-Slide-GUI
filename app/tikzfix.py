"""TikZ（chemfig・circuitikz なども）の線を、Manim の数式・LaTeX の文章で見えるようにする。

Manim は LaTeX の SVG を、線の太さ 0（塗りだけ）で読み込む。TikZ の線は「塗りの無い線」なので、そのままでは消える。
プリアンブルで TikZ を使うときだけ、塗りの無い部品に、SVG の線の太さ（pt）を Manim の線の太さに直して付ける。
（1pt は、数式の大きさ font_size のとき font_size / 960 単位。Manim の線の太さ 1 は 0.01 単位）
PGF の出力を dvisvgm 用にする設定（\\def\\pgfsysdriver{pgfsys-dvisvgm.def}）は、固定のプリアンブルに入っている。
"""
from __future__ import annotations

import re

_USES = re.compile(r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*(tikz|chemfig|pgf|circuitikz|tkz-|chemmacros)[^}]*\}|\\usetikzlibrary|\\RequirePackage\{tikz")


def uses_tikz(preamble: str) -> bool:
    """プリアンブル（% の注釈は除く）で TikZ などを読み込んでいるか。"""
    text = "\n".join(re.sub(r"(?<!\\)%.*$", "", line) for line in (preamble or "").split("\n"))
    return bool(_USES.search(text))


# 書き出す .py に入れるコード（プレビューでも同じものを実行する）
SOURCE = '''
def _gui_enable_tikz_strokes():
    """TikZ の線（塗りの無い部品）を見えるようにする（SVG の線の太さ pt → Manim の線の太さ）。"""
    from manim import SingleStringMathTex
    if getattr(SingleStringMathTex, "_gui_tikz", False):
        return
    orig = SingleStringMathTex.__init__

    def init(self, tex_string, stroke_width=0, *args, **kwargs):
        orig(self, tex_string, None, *args, **kwargs)
        k = float(getattr(self, "font_size", 48) or 48) / 9.6
        for m in self.family_members_with_points():
            if m.get_fill_opacity() < 1e-3 and m.get_stroke_width() > 0:
                m.set_stroke(width=m.get_stroke_width() * k, opacity=1)
            else:
                m.set_stroke(width=stroke_width)
    SingleStringMathTex.__init__ = init
    SingleStringMathTex._gui_tikz = True


_gui_enable_tikz_strokes()
'''


def apply() -> None:
    """プレビュー（このプロセス）でも同じ直し方を使う。"""
    ns: dict = {}
    exec(SOURCE, ns)
