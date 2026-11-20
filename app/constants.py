"""アプリ全体で共有する定数。"""

from __future__ import annotations

# ---- キャンバス（論理座標）と Manim の座標系 ----
CANVAS_W = 1920
CANVAS_H = 1080
MANIM_FRAME_H = 8.0
MANIM_FRAME_W = MANIM_FRAME_H * CANVAS_W / CANVAS_H  # 約 14.222

# ---- 文字サイズの表示倍率（Manim の font_size 1 あたりの、1080p でのピクセル数）----
# manim 0.20.1 で実測。Text は「国」を 10 文字・20 文字並べた幅の差から 1 文字の送り幅（＝1em）を求めた:
# font_size 48 で 90px（1.875/font_size）。Noto Sans/Serif CJK JP・IPAex ゴシック/明朝で同じ値。
# 行の間隔は 0.975em（フォントによらず同じ）。複数行は左寄せ。
# MathTex は "M" の高さから em ≈ 67px（1.40/font_size）。
TEXT_PX_PER_FONT_SIZE = 1.875
TEXT_LINE_PITCH_EM = 0.975
MATH_PX_PER_FONT_SIZE = 1.40

# ---- 書き出し ----
PROJECT_FILE = "project.json"
PREAMBLE_FILE = "preamble.tex"
FORMAT_VERSION = 1

# アプリが書き出し時に自動で加える、日本語対応の固定部分
JP_FIXED_PREAMBLE = [
    r"\usepackage{zxjatype}",
    r"\usepackage[ipaex]{zxjafont}",
    # TikZ（chemfig なども）の線を dvisvgm が描けるように、PGF の出力を dvisvgm 用にする（読み込まなければ何もしない）。
    # 無いと、xdv → SVG の変換で線だけが消え、文字だけが出る
    r"\def\pgfsysdriver{pgfsys-dvisvgm.def}",
]

# LaTeX で組む文字の書体（プロジェクトの設定「LaTeX の文字の書体」）。ゴシックは、日本語を IPAex ゴシック、英数字を
# Latin Modern Sans にする（数式の文字は変えない）。利用者のプリアンブルのあとに足す
TEX_FONT_PREAMBLE = {
    "serif": [],
    "sans": [r"\setjamainfont{IPAexGothic}", r"\renewcommand{\familydefault}{\sfdefault}"],
}


def tex_font_lines(settings) -> list[str]:
    return list(TEX_FONT_PREAMBLE.get((settings or {}).get("texFont") or "serif", []))


# 利用者のプリアンブルのあとに足す（数式の一部の色 \color[HTML]{…} のため。利用者が先にオプション付きで
# 読み込んでいても、あとの \usepackage は何もしないので、オプションがぶつからない）
JP_TAIL_PREAMBLE = [
    r"\usepackage{xcolor}",
]

# manim の TexTemplate の既定プリアンブル（manim 0.20.1・0.21.0 で確認）
MANIM_DEFAULT_PREAMBLE = [
    r"\usepackage[english]{babel}",
    r"\usepackage{amsmath}",
    r"\usepackage{amssymb}",
]

# 固定する版（VERSIONS.md と一致させる）
EXPECTED_VERSIONS = {
    "manim": "0.20.1",
    "manim_slides": "5.7.0",
}

# ---- フォントのプリセット ----
# label は表示名、candidates は Pango に渡すファミリー名の候補（導入済みのものを先頭から採用）
FONT_PRESETS = [
    {"id": "noto-sans-jp", "label": "Noto Sans JP（ゴシック）",
     "candidates": ["Noto Sans JP", "Noto Sans CJK JP"], "generic": "sans-serif"},
    {"id": "noto-serif-jp", "label": "Noto Serif JP（明朝）",
     "candidates": ["Noto Serif JP", "Noto Serif CJK JP"], "generic": "serif"},
    {"id": "ipaex-gothic", "label": "IPAexゴシック",
     "candidates": ["IPAexGothic", "IPAexゴシック"], "generic": "sans-serif"},
    {"id": "ipaex-mincho", "label": "IPAex明朝",
     "candidates": ["IPAexMincho", "IPAex明朝"], "generic": "serif"},
    {"id": "biz-ud-gothic", "label": "BIZ UDゴシック",
     "candidates": ["BIZ UDGothic", "BIZ UDゴシック"], "generic": "sans-serif"},
]
DEFAULT_FONT_PRESET = "noto-sans-jp"

DEFAULT_SETTINGS = {
    "name": "",
    "className": "Deck",
    "background": "#FFFFFF",
    "defaultFont": "Noto Sans JP",
    "defaultFontSize": 48,
    "defaultColor": "#222222",
    "fontSizeScale": 1.0,  # GUI の文字サイズ → Manim の font_size の換算係数
    "use3d": False,  # 3D を使う（ThreeDSlide で書き出す。カメラは向き・拡大率で動かす）
    # ページ番号（プロジェクト全体の既定。スライドごとに、表示する・しない・番号を変えられる）
    "pageNumbers": {"enabled": False, "position": "br", "fontSize": 24, "color": None, "format": "n", "buff": 0.3},
}
PAGE_POSITIONS = ("br", "bc", "bl", "tr", "tc", "tl")  # 右下・下中央・左下・右上・上中央・左上

RENDER_QUALITIES = {
    "low": "-ql",      # 480p15
    "medium": "-qm",   # 720p30
    "high": "-qh",     # 1080p60
    "high30": "-qh --frame_rate 30",  # 1080p30（3D の回転などで時間がかかるとき。時間はほぼ半分）
}
