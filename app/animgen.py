"""アニメーションの GUI: 動きの種類の一覧（カタログ）と、ステップの動きの行から Manim のコードを作る。

ステップ（クリック 1 回）= 動きの行の並び。行は次のどれか。
- 動き: {"id", "kind": "anim", "anim": カタログの id, "target": 要素・グループの id, "start": "with" | "after" | "lag",
         "lag": 秒, "runTime": 秒 | None（既定）, "rate": 緩急の名前 | None（既定）, "params": {…}}
- 待つ: {"id", "kind": "wait", "start": …, "lag": …, "runTime": 秒}
- 自由なコード: {"id", "kind": "code", "code": "…"}（前の動きが終わってから実行し、次の動きは新しく始まる）

同じかたまり（自由なコードで区切られた範囲）の動きは、1 つの self.play にまとめる。始まる時刻がそろっていて長さも
同じなら、そのまま並べ、そうでなければ gui_at（決めた時刻から、決めた長さだけ動くように、緩急と長さを付け替える）で包む。
"""

from __future__ import annotations

import math

from typing import Any

# 緩急（rate_func）。None は動きの既定
RATE_FUNCS = [
    ("smooth", "なめらか（既定の多く）"), ("linear", "一定の速さ"), ("rush_into", "だんだん速く"), ("rush_from", "だんだん遅く"),
    ("slow_into", "ゆっくり止まる"), ("double_smooth", "2 段階でなめらか"), ("there_and_back", "行って戻る"),
    ("ease_in_sine", "ease-in（sine）"), ("ease_out_sine", "ease-out（sine）"), ("ease_in_out_sine", "ease-in-out（sine）"),
    ("ease_in_cubic", "ease-in（cubic）"), ("ease_out_cubic", "ease-out（cubic）"), ("ease_in_out_cubic", "ease-in-out（cubic）"),
    ("ease_in_back", "少し戻ってから（back）"), ("ease_out_back", "行き過ぎて戻る（back）"), ("ease_out_bounce", "はねる（bounce）"),
    ("ease_out_elastic", "ばねのように（elastic）"), ("wiggle", "ゆらす（wiggle）"), ("lingering", "早めに終えて止まる（lingering）"),
]
RATE_NAMES = {r for r, _ in RATE_FUNCS}
# 緩急の説明（編集欄に出す）。t は時間の割合、値は動きの進み具合（0 で始め、1 で終わりの状態）
RATE_DESC = {
    "smooth": "ゆっくり始まり、ゆっくり終わる。",
    "linear": "始めから終わりまで同じ速さ。",
    "rush_into": "ゆっくり始まり、だんだん速くなって終わる。",
    "rush_from": "速く始まり、だんだん遅くなって終わる。",
    "slow_into": "速く始まり、終わりに近づくほどゆっくりになる。",
    "double_smooth": "前半と後半で、それぞれゆっくり始まりゆっくり終わる（途中で一度ゆるむ）。",
    "there_and_back": "終わりの状態まで進み、始めの状態へ戻る（強調向き。出す・消すには使えません）。",
    "ease_in_sine": "ゆっくり始まる（弱め）。", "ease_out_sine": "ゆっくり終わる（弱め）。", "ease_in_out_sine": "ゆっくり始まりゆっくり終わる（弱め）。",
    "ease_in_cubic": "ゆっくり始まる（強め）。", "ease_out_cubic": "ゆっくり終わる（強め）。", "ease_in_out_cubic": "ゆっくり始まりゆっくり終わる（強め）。",
    "ease_in_back": "始めに少し逆へ戻ってから進む（進み具合が一度 −0.1 まで下がる）。移動・大きさの変わる動きで目に見えます。",
    "ease_out_back": "終わりを少し行き過ぎてから戻る（進み具合が 1.1 まで上がる）。移動・大きさの変わる動きで目に見えます。",
    "ease_out_bounce": "終わりの状態に、ボールが床ではねるように何度か当たって止まる（行き過ぎはしない）。",
    "ease_out_elastic": "終わりの状態の前後で、ばねのように揺れてから止まる（最大 1.37 まで行き過ぎる）。",
    "wiggle": "始めの状態を中心に、前後に揺れて戻る（強調向き。出す・消すには使えません）。",
    "lingering": "時間の 8 割で動きを終え、残りの 2 割は止まったまま。",
}

# 終わりに始めの状態へ戻る緩急（出す・消す動きに使うと、出したものが消えたまま・消したものが残る）
RETURNING_RATES = {"there_and_back", "wiggle"}

DIRS = [("none", "なし"), ("UP", "上"), ("DOWN", "下"), ("LEFT", "左"), ("RIGHT", "右"), ("UL", "左上"), ("UR", "右上"), ("DL", "左下"), ("DR", "右下")]
DIR_NAMES = {d for d, _ in DIRS}

# 引数の形: number（数）・color（色）・dir（向き）・bool（はい/いいえ）・select（選ぶ）
CATALOG: list[dict[str, Any]] = [
    # ---- 出す
    {"id": "FadeIn", "group": "in", "label": "フェードイン", "rt": 1.0,
     "desc": "だんだん濃くして出す（FadeIn）。向きを決めると、その向きから滑り込み、大きさの倍率を決めると、その大きさから元の大きさになる。",
     "params": [{"key": "dir", "label": "滑り込む向き", "type": "dir", "default": "none"},
                {"key": "dist", "label": "距離", "type": "number", "default": 0.5, "step": 0.1},
                {"key": "scale", "label": "大きさの倍率（はじめ）", "type": "number", "default": 1.0, "step": 0.1}]},
    {"id": "Create", "group": "in", "label": "線を描く", "rt": 1.0, "desc": "輪郭を描くように出す（Create）。図形・グラフ向き。"},
    {"id": "Write", "group": "in", "label": "書く", "rt": 1.0,
     "desc": "手で書くように出す（Write）。テキスト・数式向き。長い文は時間を長めにする（Manim の既定では、文字が多いと 2 秒）。"},
    {"id": "DrawBorderThenFill", "group": "in", "label": "輪郭のあと塗る", "rt": 2.0, "desc": "輪郭を描いてから塗る（DrawBorderThenFill）。"},
    {"id": "Grow", "group": "in", "label": "大きくなって出る", "rt": 1.0,
     "desc": "点から大きくなって出る（GrowFromCenter・GrowFromEdge）。「辺から」は、その向きの辺から伸びる。",
     "params": [{"key": "from", "label": "どこから", "type": "select", "default": "center", "options": [["center", "中心から"], ["edge", "辺から"]]},
                {"key": "edge", "label": "辺の向き", "type": "dir", "default": "LEFT"}]},
    {"id": "GrowArrow", "group": "in", "label": "矢印を伸ばす", "rt": 1.0, "desc": "線・矢印を始点から伸ばして出す（GrowArrow と同じ動き。コードでは GrowFromPoint(…, gui_start(…))）。線・矢印・ベクトル向き。"},
    {"id": "SpinInFromNothing", "group": "in", "label": "回りながら出る", "rt": 1.0, "desc": "回りながら大きくなって出る（SpinInFromNothing）。",
     "params": [{"key": "angle", "label": "回る角度（度）", "type": "number", "default": 90, "step": 15}]},
    {"id": "SpiralIn", "group": "in", "label": "渦を巻いて集まる", "rt": 2.0, "desc": "部品が渦を巻いて集まって出る（SpiralIn）。部品の多い図形・数式向き。",
     "params": [{"key": "scale_factor", "label": "広がり", "type": "number", "default": 8, "step": 1}]},
    {"id": "ShowIncreasingSubsets", "group": "in", "label": "部品を順に出す", "rt": 1.0,
     "desc": "部品（文字・行など）を 1 つずつ増やして出す（ShowIncreasingSubsets）。"},
    # ---- 消す
    {"id": "FadeOut", "group": "out", "label": "フェードアウト", "rt": 1.0,
     "desc": "だんだん薄くして消す（FadeOut）。向きを決めると、その向きへ滑りながら消える。",
     "params": [{"key": "dir", "label": "滑る向き", "type": "dir", "default": "none"},
                {"key": "dist", "label": "距離", "type": "number", "default": 0.5, "step": 0.1},
                {"key": "scale", "label": "大きさの倍率（おわり）", "type": "number", "default": 1.0, "step": 0.1}]},
    {"id": "Uncreate", "group": "out", "label": "線を消していく", "rt": 1.0, "desc": "描いた逆の順に消す（Uncreate）。"},
    {"id": "Unwrite", "group": "out", "label": "書いた逆に消す", "rt": 1.0, "desc": "書いた逆の順に消す（Unwrite）。"},
    {"id": "ShrinkToCenter", "group": "out", "label": "縮んで消える", "rt": 1.0, "desc": "中心へ縮んで消える（ShrinkToCenter）。"},
    {"id": "SpinOut", "group": "out", "label": "回りながら消える", "rt": 1.0, "desc": "回りながら小さくなって消える（SpinInFromNothing の逆）。",
     "params": [{"key": "angle", "label": "回る角度（度）", "type": "number", "default": 90, "step": 15}]},
    # ---- 強調
    {"id": "Indicate", "group": "emph", "label": "目立たせる", "rt": 1.0, "desc": "一瞬大きくして色を付ける（Indicate）。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#FFFF00"},
                {"key": "scale_factor", "label": "大きさの倍率", "type": "number", "default": 1.2, "step": 0.05}]},
    {"id": "Circumscribe", "group": "emph", "label": "囲む線が走る", "rt": 1.0, "desc": "まわりを囲む線が走る（Circumscribe）。",
     "params": [{"key": "shape", "label": "形", "type": "select", "default": "rect", "options": [["rect", "四角"], ["circle", "円"]]},
                {"key": "color", "label": "色", "type": "color", "default": "#FFFF00"},
                {"key": "buff", "label": "すき間", "type": "number", "default": 0.1, "step": 0.05},
                {"key": "fade_out", "label": "最後にフェードで消す", "type": "bool", "default": False}]},
    {"id": "Flash", "group": "emph", "label": "光る線が飛び散る", "rt": 1.0, "desc": "まわりに光の線が飛び散る（Flash）。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#FFFF00"},
                {"key": "num_lines", "label": "線の数", "type": "number", "default": 12, "step": 1},
                {"key": "line_length", "label": "線の長さ", "type": "number", "default": 0.2, "step": 0.05}]},
    {"id": "Wiggle", "group": "emph", "label": "ゆらす", "rt": 2.0, "desc": "左右にゆらす（Wiggle）。",
     "params": [{"key": "scale_value", "label": "大きさの倍率", "type": "number", "default": 1.1, "step": 0.05},
                {"key": "angle", "label": "ゆれる角度（度）", "type": "number", "default": 3.6, "step": 0.5},
                {"key": "n_wiggles", "label": "回数", "type": "number", "default": 6, "step": 1}]},
    {"id": "FocusOn", "group": "emph", "label": "スポットライト", "rt": 2.0, "desc": "画面全体からその要素へ、光の輪が縮まる（FocusOn）。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#888888"},
                {"key": "opacity", "label": "濃さ", "type": "number", "default": 0.2, "step": 0.05}]},
    {"id": "ApplyWave", "group": "emph", "label": "波打たせる", "rt": 2.0, "desc": "波が通り抜けるように変形させる（ApplyWave）。",
     "params": [{"key": "dir", "label": "向き", "type": "dir", "default": "UP"},
                {"key": "amplitude", "label": "振れ幅", "type": "number", "default": 0.2, "step": 0.05}]},
    {"id": "ShowPassingFlash", "group": "emph", "label": "光が線をなぞる", "rt": 1.0, "desc": "光が輪郭をなぞって走る（ShowPassingFlash）。図形・グラフ向き。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#FFFF00"},
                {"key": "time_width", "label": "光の長さ", "type": "number", "default": 0.3, "step": 0.05}]},
    {"id": "Blink", "group": "emph", "label": "点滅（まばたき）", "rt": 1.5, "desc": "消えて・現れるを、くり返す（Blink）。回数を決められる。最後は見えたまま。",
     "params": [{"key": "blinks", "label": "回数", "type": "number", "default": 1, "step": 1}]},
    {"id": "Broadcast", "group": "emph", "label": "波紋が広がる", "rt": 3.0, "desc": "要素と同じ形の波紋が、中心から広がる（Broadcast）。円などの図形向き。",
     "params": [{"key": "n_mobs", "label": "波紋の数", "type": "number", "default": 5, "step": 1}]},
]
CATALOG += [
    # ---- 動かす（対象: 要素・グループ）
    {"id": "Move", "group": "move", "label": "移動", "rt": 1.0,
     "desc": "決めた位置へ、または今の位置からずらして動かす（.animate.move_to・.animate.shift）。キャンバスの影をドラッグしても決められる。",
     "params": [{"key": "mode", "label": "どこへ", "type": "select", "default": "by", "options": [["by", "今の位置からずらす"], ["to", "決めた位置へ（中心）"]]},
                {"key": "x", "label": "x", "type": "number", "default": 2.0, "step": 0.1, "ghost": True},
                {"key": "y", "label": "y", "type": "number", "default": 0.0, "step": 0.1, "ghost": True}]},
    {"id": "Scale", "group": "move", "label": "拡大・縮小", "rt": 1.0, "desc": "中心を保って大きさを変える（.animate.scale）。2 で 2 倍、0.5 で半分。",
     "params": [{"key": "factor", "label": "倍率", "type": "number", "default": 1.5, "step": 0.1}]},
    {"id": "Rotate", "group": "move", "label": "回転", "rt": 1.0,
     "desc": "回す（Rotate）。正の角度で反時計回り。360 の倍数で何回も回せる（一定の速さで回すときは、緩急を「一定の速さ」に）。",
     "params": [{"key": "angle", "label": "角度（度）", "type": "number", "default": 90, "step": 15},
                {"key": "about", "label": "中心", "type": "select", "default": "center", "options": [["center", "要素の中心"], ["point", "決めた点"]]},
                {"key": "ax", "label": "点の x", "type": "number", "default": 0.0, "step": 0.1, "show": {"about": ["point"]}},
                {"key": "ay", "label": "点の y", "type": "number", "default": 0.0, "step": 0.1, "show": {"about": ["point"]}}]},
    {"id": "Color", "group": "move", "label": "色を変える", "rt": 1.0, "desc": "色を変える（.animate.set_color）。線と塗りの両方。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#FC6255"}]},
    {"id": "Opacity", "group": "move", "label": "濃さを変える", "rt": 1.0,
     "desc": "濃さ（不透明度）を変える。元の濃さに対する割合で、0 で見えなくなる（場面には残る）、1 で元の濃さ（gui_opacity。塗りの無い図形は塗らない）。",
     "params": [{"key": "opacity", "label": "濃さ（0〜1）", "type": "number", "default": 0.3, "step": 0.1}]},
    {"id": "MoveAlongPath", "group": "move", "label": "線に沿って動く", "rt": 2.0,
     "desc": "スライドの線・曲線・図形の輪郭に沿って動かす（MoveAlongPath）。「始点へ移ってから」は要素の中心が線の上を通り、"
             "「今の位置から」は今の位置を始点として、線と同じ形に動く。",
     "params": [{"key": "path", "label": "沿う線", "type": "elem", "default": ""},
                {"key": "how", "label": "動き方", "type": "select", "default": "shape", "options": [["shape", "今の位置から線の形に"], ["on", "線の上を（始点へ移ってから）"]]}]},
    # ---- 値（対象: スライドの値）
    {"id": "SetValue", "group": "value", "label": "値を変える", "rt": 1.0,
     "desc": "スライドの値（ValueTracker）を、決めた値までなめらかに変える（.animate.set_value）。値を使うグラフ・点・数などが一緒に変わる。数のほか、式（例: PI / 2）も書ける。",
     "params": [{"key": "value", "label": "変えたあとの値", "type": "expr", "default": "1"}]},
    # ---- カメラ（対象なし: self.camera.frame）
    {"id": "CamMove", "group": "camera", "label": "カメラを動かす", "rt": 1.0,
     "desc": "画面に映す所を動かす（self.camera.frame.animate.move_to）。要素を選ぶと、その要素の中心へ。",
     "params": [{"key": "mode", "label": "どこへ", "type": "select", "default": "point", "options": [["point", "決めた点（中心）"], ["elem", "要素の中心"]]},
                {"key": "x", "label": "x", "type": "number", "default": 0.0, "step": 0.1, "show": {"mode": ["point"]}},
                {"key": "y", "label": "y", "type": "number", "default": 0.0, "step": 0.1, "show": {"mode": ["point"]}},
                {"key": "elem", "label": "要素", "type": "elem", "default": "", "show": {"mode": ["elem"]}}]},
    {"id": "CamZoom", "group": "camera", "label": "カメラを寄せる・引く", "rt": 1.0,
     "desc": "拡大して映す（self.camera.frame.animate.scale）。2 で 2 倍に拡大（寄る）、0.5 で引く。",
     "params": [{"key": "zoom", "label": "拡大率", "type": "number", "default": 2.0, "step": 0.1}]},
    {"id": "CamRestore", "group": "camera", "label": "カメラを元に戻す", "rt": 1.0,
     "desc": "スライドの初めの映し方（全体）に戻す（Restore(self.camera.frame)）。"},
    # ---- 動画・音声（対象: 動画・音声の要素。前の動きが終わってから実行する）
    {"id": "Media", "group": "media", "label": "再生・操作", "rt": 0.0, "stmt": True,
     "desc": "動画・音声を操作する（gui_media）。前の動きが終わったところで実行する。「そのあと」で、再生の終わりまで、または決めた秒数だけ待ってから次の行へ進む"
             "（待つ間も再生は続く。焼き込む動画・音声は、描いた時間の分しか進まないので、待つか、あとに動きを置く）。",
     "params": [{"key": "action", "label": "操作", "type": "select", "default": "play",
                 "options": [["play", "再生"], ["pause", "一時停止"], ["stop", "停止（最初に戻す）"], ["seek", "位置へ移る（秒）"],
                             ["volume", "音量（0〜1）"], ["show", "表示（動画）"], ["hide", "非表示（動画）"]]},
                {"key": "value", "label": "値（秒・音量）", "type": "number", "default": 0.0, "step": 0.1, "show": {"action": ["seek", "volume"]}},
                {"key": "waitMode", "label": "そのあと", "type": "select", "default": "none",
                 "options": [["none", "すぐ次の行へ"], ["end", "終わるまで待つ"], ["sec", "決めた秒数だけ待つ"]], "show": {"action": ["play", "seek", "volume", "show", "hide"]}},
                {"key": "waitSec", "label": "秒", "type": "number", "default": 2.0, "step": 0.5, "show": {"waitMode": ["sec"]}}]},
    # ---- ズーム（対象: ズームの要素）
    {"id": "ZoomOn", "group": "zoom", "label": "ズームを出す", "rt": 0.0, "stmt": True,
     "desc": "拡大する枠と映す所を出す（self.activate_zooming(animate=True)）。ズームの要素の「最初から出す」を外しておく。"},
    {"id": "ZoomMove", "group": "zoom", "label": "拡大する所を動かす", "rt": 1.0,
     "desc": "拡大する所（枠）を動かす（self.zoomed_camera.frame.animate.move_to）。",
     "params": [{"key": "x", "label": "x", "type": "number", "default": 0.0, "step": 0.1},
                {"key": "y", "label": "y", "type": "number", "default": 0.0, "step": 0.1}]},
    {"id": "ZoomScale", "group": "zoom", "label": "拡大率を変える", "rt": 1.0,
     "desc": "拡大する所（枠）の大きさを変える（self.zoomed_camera.frame.animate.scale）。0.5 で枠が半分になり、2 倍に拡大して映る。",
     "params": [{"key": "factor", "label": "枠の倍率", "type": "number", "default": 0.5, "step": 0.1}]},
    {"id": "ZoomOff", "group": "zoom", "label": "ズームを消す", "rt": 0.0, "stmt": True, "desc": "拡大する枠と映す所を消す（gui_zoom_off）。"},
    # ---- 線形変換（対象: 線形変換の平面）
    {"id": "ApplyMatrix", "group": "linear", "label": "行列で変換", "rt": 2.0, "stmt": True,
     "desc": "平面と、一緒に動く要素を、行列 [[a, b], [c, d]] で変換する（gui_apply_matrix）。数のほか、式（例: np.cos(1)）も書ける。",
     "params": [{"key": "a", "label": "a", "type": "expr", "default": "1"}, {"key": "b", "label": "b", "type": "expr", "default": "1"},
                {"key": "c", "label": "c", "type": "expr", "default": "0"}, {"key": "d", "label": "d", "type": "expr", "default": "1"}]},
]
CATALOG += [
    # ---- 出す・消す: 文字を打つ（テキスト・数式・コード）
    {"id": "TypeIn", "group": "in", "label": "1 文字ずつ打つ", "rt": 2.0,
     "desc": "1 文字ずつ順に出す（AddTextLetterByLetter・TypeWithCursor と同じ動き。gui_type）。カーソルを付けると、打っている所に縦線が出る。"
             "テキスト・数式・コード向き。時間は全体の長さ。",
     "params": [{"key": "cursor", "label": "カーソル", "type": "bool", "default": False},
                {"key": "cursor_color", "label": "カーソルの色", "type": "color", "default": "#555555", "show": {"cursor": [True]}}]},
    {"id": "TypeOut", "group": "out", "label": "1 文字ずつ消す", "rt": 1.5,
     "desc": "後ろから 1 文字ずつ消す（RemoveTextLetterByLetter・UntypeWithCursor と同じ動き。gui_type）。",
     "params": [{"key": "cursor", "label": "カーソル", "type": "bool", "default": False},
                {"key": "cursor_color", "label": "カーソルの色", "type": "color", "default": "#555555", "show": {"cursor": [True]}}]},
    {"id": "PhaseFlow", "group": "move", "label": "流れに沿って動かす", "rt": 3.0,
     "desc": "ベクトル場の流れ（矢印の向きと大きさ）に乗せて動かす（PhaseFlow）。ベクトル場の要素を選ぶか、速度の式（画面の座標 x・y の、"
             "1 秒あたりの動き。例: 回る流れは -y と x）を書く。「流れる時間」が長いほど遠くまで流れる（動きの時間とは別。"
             "動きの時間の間に、その時間だけ流れる）。「点ごとに流す」は形が流れで変わり、「形を保つ」は中心の流れに合わせて動かす。",
     "params": [{"key": "source", "label": "流れ", "type": "select", "default": "field",
                 "options": [["field", "ベクトル場の要素"], ["expr", "速度の式"]]},
                {"key": "field", "label": "ベクトル場", "type": "elem", "default": "", "elemOnly": ["field"], "show": {"source": ["field"]}},
                {"key": "fx", "label": "x の速さ", "type": "expr", "default": "-y", "show": {"source": ["expr"]}},
                {"key": "fy", "label": "y の速さ", "type": "expr", "default": "x", "show": {"source": ["expr"]}},
                {"key": "vt", "label": "流れる時間", "type": "number", "default": 1, "step": 0.25},
                {"key": "shape", "label": "形", "type": "select", "default": "keep",
                 "options": [["keep", "形を保つ（中心が流れる）"], ["points", "点ごとに流す（形が変わる）"]]}]},
    {"id": "SaveState", "group": "move", "label": "今の状態を覚える", "rt": 0.0, "stmt": True, "noPart": True,
     "desc": "対象の今の位置・大きさ・形・色を覚える（save_state）。あとの「覚えた状態に戻す」で、ここに戻る。"
             "覚えていなければ、スライドの初めの状態に戻る。"},
    {"id": "Restore", "group": "move", "label": "覚えた状態に戻す", "rt": 1.0, "noPart": True,
     "desc": "対象を、「今の状態を覚える」で覚えた状態（覚えていなければスライドの初めの状態）へ、なめらかに戻す（Restore）。"
             "動かす・大きさ・回す・色・形を変えるなどを、まとめて元に戻せる。"},
    # ---- 変形（対象を、別の要素に変える）
    {"id": "ReplacementTransform", "group": "transform", "label": "形を変える（置き換える）", "rt": 1.0,
     "desc": "対象が、変えた先の要素の形・色・位置になめらかに変わり、変えた先の要素に置き換わる（ReplacementTransform）。"
             "変えた先の要素は「スライド開始時に表示」をオフにしておく（自動でオフにします）。数式の一部分どうしでも使える。",
     "params": [{"key": "to", "label": "変えた先", "type": "elem", "default": ""},
                {"key": "arc", "label": "弧を描いて（度）", "type": "number", "default": 0, "step": 15}]},
    {"id": "TransformMatchingShapes", "group": "transform", "label": "同じ形を合わせて変える", "rt": 1.5,
     "desc": "数式・テキストの同じ形の文字どうしを合わせて動かし、合わない部分はフェードで入れ替える（TransformMatchingShapes）。"
             "式の変形（移項など）を見せるのに向く。",
     "params": [{"key": "to", "label": "変えた先", "type": "elem", "default": ""},
                {"key": "arc", "label": "弧を描いて（度）", "type": "number", "default": 0, "step": 15}]},
    {"id": "MatchTransform", "group": "transform", "label": "対応を決めて変える", "rt": 1.5, "noPart": True,
     "desc": "数式・テキストの、どの部分がどの部分に変わるかを自分で決めて変える（TransformMatchingTex の、対応を手で決める版）。"
             "「対応を足す」で、対象の部品 → 変えた先の部品の順にキャンバスで選ぶ。決めなかった部分は、"
             "「残り」で同じ形の文字どうしを合わせる（TransformMatchingShapes と同じ）か、フェードで入れ替える。移項・約分・展開を見せるのに向く。",
     "params": [{"key": "to", "label": "変えた先", "type": "elem", "default": ""},
                {"key": "rest", "label": "残り", "type": "select", "default": "match",
                 "options": [["match", "同じ形どうしを合わせる"], ["fade", "フェードで入れ替える"]]},
                {"key": "arc", "label": "弧を描いて（度）", "type": "number", "default": 0, "step": 15},
                {"key": "pairs", "label": "対応", "type": "pairs", "default": []}]},
    {"id": "FadeTransform", "group": "transform", "label": "フェードしながら変える", "rt": 1.0,
     "desc": "対象が薄れながら変えた先の形へ伸び縮みし、変えた先の要素が濃くなって現れる（FadeTransform）。形の違う物どうし向き。",
     "params": [{"key": "to", "label": "変えた先", "type": "elem", "default": ""}]},
    {"id": "TransformFromCopy", "group": "transform", "label": "写しを変えて出す", "rt": 1.0,
     "desc": "対象はそのまま残し、対象の写しが、変えた先の要素に変わって現れる（TransformFromCopy）。",
     "params": [{"key": "to", "label": "変えた先", "type": "elem", "default": ""},
                {"key": "arc", "label": "弧を描いて（度）", "type": "number", "default": 0, "step": 15}]},
    # ---- 関数で変形（対象の点を、式で動かす）
    {"id": "PointwiseFn", "group": "func", "label": "式で点を動かす", "rt": 2.0,
     "desc": "対象のすべての点 (x, y) を、式で決めた点へ動かす（ApplyPointwiseFunction）。x・y と、np.sin などが使える。"
             "例: x 方向に 2 倍 → x の式に 2*x。",
     "params": [{"key": "fx", "label": "x の式", "type": "expr", "default": "x + 0.3*np.sin(2*y)"},
                {"key": "fy", "label": "y の式", "type": "expr", "default": "y"}]},
    {"id": "Homotopy", "group": "func", "label": "時間で変わる式で動かす", "rt": 3.0,
     "desc": "点 (x, y) を、時間 t（0 から 1）と一緒に変わる式で動かす（Homotopy）。t = 1 の形で終わる。"
             "例: 波 → y の式に y + 0.3*np.sin(3*x + 6*t)*t。",
     "params": [{"key": "fx", "label": "x の式", "type": "expr", "default": "x"},
                {"key": "fy", "label": "y の式", "type": "expr", "default": "y + 0.3*np.sin(3*x + 6*t)*t"}]},
    {"id": "ComplexFn", "group": "func", "label": "複素関数で写す", "rt": 3.0,
     "desc": "点を複素数 z = x + iy と見て、式で写す（ApplyComplexFunction）。z と np.exp などが使える。例: z**2、np.exp(z)。"
             "座標平面などは、線を細かくしておくときれいに曲がる。",
     "params": [{"key": "fz", "label": "z の式", "type": "expr", "default": "z**2 / 2"}]},
]
CATALOG += [
    # ---- 段階M: 出す・強調・変形・関数で変形の追加分
    {"id": "LaggedIn", "group": "in", "label": "部品を少しずつずらして出す", "rt": 2.0,
     "desc": "部品を、少しずつ時間をずらして順に出す（LaggedStart）。統計のグラフは座標軸を先に出してから点・棒などを順に、"
             "ほかの要素は、いちばん外側の部品（文字・項目・行など）を順に出す。",
     "params": [{"key": "how", "label": "出し方", "type": "select", "default": "fade",
                 "options": [["fade", "フェードイン"], ["up", "下から伸ばす（棒グラフ向き）"], ["grow", "中心から大きく"], ["create", "線を描く"], ["write", "書く"]]},
                {"key": "lag", "label": "ずらす割合（0〜1）", "type": "number", "default": 0.15, "step": 0.05},
                {"key": "dir", "label": "フェードの向き", "type": "dir", "default": "none", "show": {"how": ["fade"]}}]},
    {"id": "WordByWord", "group": "in", "label": "1 語ずつ出す", "rt": 2.0,
     "desc": "空白・改行で区切った語ごとに出す（AddTextWordByWord と同じ動き。gui_type(words=True)）。日本語のように空白の無い文は、行ごとになる。",
     "params": [{"key": "cursor", "label": "カーソル", "type": "bool", "default": False},
                {"key": "cursor_color", "label": "カーソルの色", "type": "color", "default": "#555555", "show": {"cursor": [True]}}]},
    {"id": "CreateThenFade", "group": "emph", "label": "線を描いてから消える", "rt": 1.5,
     "desc": "要素の写しを線で描き、すぐフェードで消す（古い Manim の ShowCreationThenFadeOut と同じ動き。gui_create_then_fade）。元の要素はそのまま。なぞって見せる強調向き。",
     "params": [{"key": "color", "label": "色", "type": "color", "default": "#FFFF00"}]},
    {"id": "Swap", "group": "transform", "label": "位置を入れ替える", "rt": 1.0,
     "desc": "2 つの要素の位置を、弧を描いて入れ替える（Swap）。式の項の入れ替えなどに。",
     "params": [{"key": "with", "label": "入れ替える相手", "type": "elem", "default": ""},
                {"key": "arc", "label": "弧（度）", "type": "number", "default": 90, "step": 15}]},
    {"id": "ApplyMatrixEl", "group": "func", "label": "行列で変換", "rt": 2.0,
     "desc": "要素の点 (x, y) を、行列 [[a, b], [c, d]] で変換する（ApplyMatrix）。せん断・回転・拡大など。数のほか式（例: np.cos(1)）も書ける。",
     "params": [{"key": "a", "label": "a", "type": "expr", "default": "1"}, {"key": "b", "label": "b", "type": "expr", "default": "0.5"},
                {"key": "c", "label": "c", "type": "expr", "default": "0"}, {"key": "d", "label": "d", "type": "expr", "default": "1"},
                {"key": "about", "label": "基準の点", "type": "select", "default": "center", "options": [["center", "要素の中心"], ["origin", "原点 (0, 0)"]]}]},
    # ---- 要素ごとの動き（その種類の要素にだけ使える）
    {"id": "BarValues", "group": "special", "label": "棒の値を変える", "rt": 1.0, "only": ["barchart"],
     "desc": "棒グラフ（BarChart）の棒の高さを、新しい値へなめらかに変える（change_bar_values）。棒の数だけ、カンマで区切って書く。"
             "「棒の上に値を書く」の数字は変わりません。",
     "params": [{"key": "values", "label": "新しい値", "type": "expr", "default": "4, 2, 5, 3"}]},
    {"id": "Relayout", "group": "special", "label": "グラフの並びを変える", "rt": 1.5, "only": ["netgraph"],
     "desc": "グラフ（頂点と辺）の頂点の並べ方を変えて、なめらかに動かす（change_layout）。",
     "params": [{"key": "layout", "label": "並べ方", "type": "select", "default": "circular",
                 "options": [["circular", "円の上"], ["kamada_kawai", "ばねで釣り合う（Kamada-Kawai）"], ["spring", "ばね（spring）"],
                             ["shell", "同心円（shell）"], ["spectral", "スペクトル（spectral）"], ["planar", "平面グラフ（planar）"], ["random", "でたらめ"]]},
                {"key": "scale", "label": "広さ", "type": "number", "default": 2.0, "step": 0.5}]},
    {"id": "CodeHighlight", "group": "special", "label": "行に色の帯を付ける", "rt": 0.5, "only": ["code"],
     "desc": "コードの行に色の帯を付ける（gui_code_highlight）。行番号は「2」「2-4」「1, 3」のように書く。次の帯を付けると、帯がその行へ動く。"
             "空にすると帯を消す。",
     "params": [{"key": "lines", "label": "行", "type": "expr", "default": "1"},
                {"key": "color", "label": "色", "type": "color", "default": "#FFFF00"},
                {"key": "opacity", "label": "濃さ（0〜1）", "type": "number", "default": 0.25, "step": 0.05}]},
    {"id": "CountTo", "group": "special", "label": "数を数えながら変える", "rt": 1.5, "only": ["number"],
     "desc": "数値（DecimalNumber）を、決めた値まで数えながら変える（ChangeDecimalToValue）。スライドの値を表す数値は、その値を変える（同じ値を使うグラフなども一緒に動く）。",
     "params": [{"key": "value", "label": "変えたあとの値", "type": "expr", "default": "100"}]},
    # ---- ずっと動かす（updater。前の動きが終わってから付け外しする）
    {"id": "AlwaysRotate", "group": "always", "label": "ずっと回す", "rt": 0.0, "stmt": True,
     "desc": "要素を、決めた速さでずっと回す（add_updater）。クリックを待つ間も回り続ける（1 周の区切りをくり返して見せる）。"
             "「ずっと動かすのをやめる」で止める。",
     "params": [{"key": "speed", "label": "速さ（度/秒）", "type": "number", "default": 90, "step": 15},
                {"key": "about", "label": "中心", "type": "select", "default": "center", "options": [["center", "要素の中心"], ["point", "決めた点"]]},
                {"key": "ax", "label": "点の x", "type": "number", "default": 0.0, "step": 0.1, "show": {"about": ["point"]}},
                {"key": "ay", "label": "点の y", "type": "number", "default": 0.0, "step": 0.1, "show": {"about": ["point"]}}]},
    {"id": "AlwaysMove", "group": "always", "label": "進め続ける", "rt": 0.0, "stmt": True,
     "desc": "要素を、決めた速さ（単位/秒）で進め続ける（add_updater）。「画面の外へ出たら反対側から戻る」なら、クリックを待つ間も"
             "進み続ける（画面の外へ出きったら、同じ線を逆にたどった反対側から入ってくる。斜めも可。一回りでちょうど元に戻るので切れ目なく"
             "くり返せる）。「止める」なら、ほかの動き・「待つ」の間だけ進み、クリックを待つ間はその位置で止まる。",
     "params": [{"key": "vx", "label": "x の速さ", "type": "number", "default": 0.5, "step": 0.1},
                {"key": "vy", "label": "y の速さ", "type": "number", "default": 0.0, "step": 0.1},
                {"key": "idle", "label": "クリックを待つ間", "type": "select", "default": "wrap",
                 "options": [["wrap", "進み続ける（画面の外へ出たら反対側から戻る）"], ["stop", "止める"]]}]},
    {"id": "AlwaysFollow", "group": "always", "label": "ほかの要素について行く", "rt": 0.0, "stmt": True,
     "desc": "要素が、選んだ要素の動きについて行く（add_updater。今の位置の差を保つ）。ラベルを点に付けて動かすときなどに。"
             "クリックを待つ間は、ついて行く先が動いていれば（ずっと回す・進み続ける）一緒に動く。",
     "params": [{"key": "target", "label": "ついて行く先", "type": "elem", "default": ""},
                {"key": "keep", "label": "今の位置の差を保つ", "type": "bool", "default": True}]},
    {"id": "AlwaysStop", "group": "always", "label": "ずっと動かすのをやめる", "rt": 0.0, "stmt": True,
     "desc": "「ずっと回す」「ずっと進める」「ついて行く」で付けた動きを外す（その時の位置・向きのまま止まる）。"},
    {"id": "IncValue", "group": "value", "label": "値を増やす・減らす", "rt": 1.0,
     "desc": "スライドの値（ValueTracker）を、今の値から決めた分だけなめらかに増やす（.animate.increment_value）。負の数で減らす。",
     "params": [{"key": "value", "label": "増やす分", "type": "expr", "default": "1"}]},
    # ---- 3D のカメラ（3D のプロジェクトだけ）
    {"id": "Cam3dMove", "group": "camera3d", "label": "カメラの向きを変える", "rt": 2.0, "stmt": True,
     "desc": "3D のカメラの向き・寄り方・中心を、なめらかに変える（self.move_camera）。φ は真上からの傾き、θ は横の回り（-90 で正面）、"
             "中心は見る所の x・y。空欄の値は今のまま。",
     "params": [{"key": "phi", "label": "φ（度）", "type": "expr", "default": "60"},
                {"key": "theta", "label": "θ（度）", "type": "expr", "default": "-45"},
                {"key": "zoom", "label": "寄り方（1 が元）", "type": "expr", "default": ""},
                {"key": "cx", "label": "中心 x", "type": "expr", "default": ""},
                {"key": "cy", "label": "中心 y", "type": "expr", "default": ""}]},
    {"id": "Cam3dSpin", "group": "camera3d", "label": "カメラをずっと回す", "rt": 0.0, "stmt": True,
     "desc": "3D のカメラを、ずっと回し続ける（self.begin_ambient_camera_rotation）。描いている間だけ回る。「回すのをやめる」で止める。",
     "params": [{"key": "rate", "label": "速さ（度/秒）", "type": "number", "default": 20, "step": 5},
                {"key": "about", "label": "回す向き", "type": "select", "default": "theta", "options": [["theta", "横に回る（θ）"], ["phi", "縦に回る（φ）"]]}]},
    {"id": "Cam3dStop", "group": "camera3d", "label": "カメラを回すのをやめる", "rt": 0.0, "stmt": True,
     "desc": "「カメラをずっと回す」を止める（self.stop_ambient_camera_rotation）。",
     "params": [{"key": "about", "label": "回す向き", "type": "select", "default": "theta", "options": [["theta", "横に回る（θ）"], ["phi", "縦に回る（φ）"]]}]},
]
CATALOG_BY_ID = {c["id"]: c for c in CATALOG}
# 要素の種類（図形の種類・text・math など）で使える動きを限るもの
for _c in CATALOG:
    _c.setdefault("only", None)
    _c.setdefault("noPart", False)
GROUPS = [("in", "出す"), ("out", "消す"), ("emph", "強調"), ("move", "動かす"), ("transform", "変形"), ("func", "関数で変形"),
          ("special", "要素ごとの動き"), ("always", "ずっと動かす"), ("value", "値"), ("camera", "カメラ"), ("camera3d", "3D のカメラ"),
          ("media", "動画・音声"), ("zoom", "ズーム"), ("linear", "線形変換"), ("wait", "待つ"), ("code", "自由なコード")]
# 対象の種類: element（要素・グループ）・value（スライドの値。"v:名前"）・camera（無し）・media・zoom・linear（その種類の要素）
TARGET_KIND = {"in": "element", "out": "element", "emph": "element", "move": "element", "transform": "element", "func": "element",
               "special": "element", "always": "element", "value": "value", "camera": "camera", "camera3d": "camera3d",
               "media": "media", "zoom": "zoom", "linear": "linear"}
for _c in CATALOG:
    _c["target"] = TARGET_KIND[_c["group"]]
    _c.setdefault("stmt", False)
INTRO = {c["id"] for c in CATALOG if c["group"] == "in"}
# 画像（ImageMobject）や画像を含むグループには使えない動き（Manim が VMobject だけに対応）
VEC_ONLY = {"Create", "Write", "DrawBorderThenFill", "SpiralIn", "Uncreate", "Unwrite", "ShowPassingFlash", "Color",
            "TypeIn", "TypeOut", "TransformMatchingShapes", "MatchTransform", "PointwiseFn", "Homotopy", "ComplexFn", "WordByWord", "CreateThenFade"}
for _c in CATALOG:
    _c["vecOnly"] = _c["id"] in VEC_ONLY


def catalog() -> dict[str, Any]:
    return {"anims": CATALOG, "groups": GROUPS, "rates": RATE_FUNCS, "returningRates": sorted(RETURNING_RATES), "rateDesc": RATE_DESC, "dirs": DIRS}


# ---------------------------------------------------------------- 正規化

def _num(v: Any, d: float, lo: float | None = None, hi: float | None = None) -> float:
    try:
        x = float(v)
        if x != x:
            raise ValueError
    except (TypeError, ValueError):
        x = d
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def normalize_row(r: dict[str, Any]) -> dict[str, Any] | None:
    kind = r.get("kind") if r.get("kind") in ("anim", "wait", "code") else "anim"
    out: dict[str, Any] = {"id": str(r.get("id") or ""), "kind": kind}
    if kind == "code":
        out["code"] = str(r.get("code") or "")
        return out
    out["start"] = r.get("start") if r.get("start") in ("with", "after", "lag") else "after"
    out["lag"] = _num(r.get("lag"), 0.5, 0.0, 600.0)
    rt = r.get("runTime")
    out["runTime"] = None if rt in (None, "") else _num(rt, 1.0, 0.01, 600.0)
    if kind == "wait":
        out["runTime"] = _num(rt, 1.0, 0.01, 600.0)
        return out
    out["anim"] = r.get("anim") if r.get("anim") in CATALOG_BY_ID else "FadeIn"
    out["target"] = "camera" if CATALOG_BY_ID.get(r.get("anim"), {}).get("group") == "camera" else str(r.get("target") or "")
    out["rate"] = r.get("rate") if r.get("rate") in RATE_NAMES else None
    sp = normalize_speed(r.get("speed"))
    if sp and not CATALOG_BY_ID[out["anim"]].get("stmt"):
        out["speed"] = sp  # 速さの変化（ChangeSpeed）
    part = r.get("part") if isinstance(r.get("part"), dict) else None
    if part and isinstance(part.get("paths"), list):
        paths = [[int(i) for i in q] for q in part["paths"] if isinstance(q, list) and q and all(isinstance(i, int) and 0 <= i < 100000 for i in q)]
        if paths:
            out["part"] = {"paths": paths}
    spec = CATALOG_BY_ID[out["anim"]]
    if spec.get("noPart"):
        out.pop("part", None)  # 要素全体だけに使える動き
    src = r.get("params") if isinstance(r.get("params"), dict) else {}
    if out["anim"] == "Media" and "waitMode" not in src and "wait" in src:  # 前の版の「終わるまで待つ」（はい・いいえ）
        src = {**src, "waitMode": "end" if src.get("wait") else "none"}
    params: dict[str, Any] = {}
    for p in spec.get("params", []):
        v = src.get(p["key"], p["default"])
        if p["type"] == "number":
            v = _num(v, p["default"])
        elif p["type"] == "bool":
            v = bool(v)
        elif p["type"] == "dir":
            v = v if v in DIR_NAMES else p["default"]
        elif p["type"] == "select":
            v = v if v in [o[0] for o in p["options"]] else p["default"]
        elif p["type"] == "color":
            v = str(v or p["default"])
        elif p["type"] in ("elem", "expr"):
            v = str(v if v is not None else p["default"]).strip()
        elif p["type"] == "pairs":
            v = normalize_pairs(v)
        params[p["key"]] = v
    out["params"] = params
    return out


def _paths(v: Any) -> list[list[int]]:
    return [[int(i) for i in q] for q in (v if isinstance(v, list) else [])
            if isinstance(q, list) and q and all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < 100000 for i in q)]


def normalize_speed(v: Any) -> list[list[float]] | None:
    """速さの変化: [[進み 0〜1, 速さの倍率 0.05〜20], …]（進みの順。2 つ以上）。無し・使えないものは None。"""
    pts = []
    for q in v if isinstance(v, list) else []:
        try:
            p, s = float(q[0]), float(q[1])
        except (TypeError, ValueError, IndexError):
            continue
        if math.isfinite(p) and math.isfinite(s):
            pts.append([round(min(1.0, max(0.0, p)), 4), round(min(20.0, max(0.05, s)), 4)])
    pts.sort(key=lambda x: x[0])
    return pts[:50] if len(pts) >= 2 else None


def speed_factor(speed: list[list[float]] | None) -> float:
    """速さの変化で、動きの長さが何倍になるか（gui_speed_total と同じ計算）。"""
    if not speed:
        return 1.0
    pts = [(p, s) for p, s in speed]
    if pts[0][0] > 0:
        pts.insert(0, (0.0, pts[0][1]))
    if pts[-1][0] < 1:
        pts.append((1.0, pts[-1][1]))
    return sum(2 * (p1 - p0) / (v0 + v1) for (p0, v0), (p1, v1) in zip(pts, pts[1:]) if p1 > p0) or 1.0


def normalize_pairs(v: Any) -> list[dict[str, list[list[int]]]]:
    """対応を決めて変える: [{"from": 対象の部品の番号の並び, "to": 変えた先の部品の番号の並び}, ...]"""
    out = []
    for pr in v if isinstance(v, list) else []:
        if isinstance(pr, dict):
            a, b = _paths(pr.get("from")), _paths(pr.get("to"))
            if a and b:
                out.append({"from": a, "to": b})
    return out[:200]


def norm_wait(v: Any) -> float | None:
    """待ち時間（秒）: 空・不正なら None（全体の設定を使う）。0〜600 秒。"""
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else round(min(600.0, max(0.0, f)), 2)


def normalize_step(st: dict[str, Any]) -> dict[str, Any]:
    """ステップ: mode = "code"（コード欄）か "gui"（動きの行）。"""
    st["mode"] = "gui" if st.get("mode") == "gui" else "code"
    # 発表のときの動き（manim-slides の next_slide の引数）: くり返す・終わったら自動で次へ・発表者ノート
    st["loop"] = bool(st.get("loop", False))
    st["autoNext"] = bool(st.get("autoNext", False))
    st["notes"] = str(st.get("notes") or "")
    st["videoWait"] = norm_wait(st.get("videoWait"))  # 1 本の動画に書き出すとき、このステップのあとに待つ秒数（None なら全体の設定）
    if st["mode"] == "gui":
        st["rows"] = [x for x in (normalize_row(r) for r in (st.get("rows") or []) if isinstance(r, dict)) if x]
        st.setdefault("code", "")
    return st


# ---------------------------------------------------------------- コードを作る

def _f(v: float) -> str:
    v = round(float(v), 4)
    return str(int(v)) if v == int(v) else str(v)


def _dir(d: str, dist: float) -> str:
    return f"{d} * {_f(dist)}" if _f(dist) != "1" else d


def _opts(p: dict[str, Any], spec: list[tuple]) -> list[str]:
    """Manim の既定と違う引数だけ（key, 既定, 引数名[, 後ろに付ける文字]）。"""
    out = []
    for key, d, name, *suf in spec:
        v = p.get(key, d)
        if isinstance(d, str):
            if str(v).upper() != d.upper():
                out.append(f'{name}="{v}"')
        elif _f(v) != _f(d):
            out.append(f"{name}={int(v) if isinstance(d, int) else _f(v)}{suf[0] if suf else ''}")
    return out


def _xy(x: Any, y: Any) -> str:
    return f"[{_f(x)}, {_f(y)}, 0]"


def anim_expr(row: dict[str, Any], t: str, ref=None, overlay: bool = False, whole_var: str | None = None) -> str:
    """動きの行の、Manim のアニメーションの式（run_time・rate_func を含む）。t は対象の変数名、ref(id) は引数の要素の変数名。
    overlay=True は gui_stack の中（同じ要素のほかの動きと重ねる）: 動かす動きを、今の形に重ねて掛ける gui_… にする。"""
    a, p = row["anim"], row.get("params") or {}
    spec = CATALOG_BY_ID[a]
    ref = ref or (lambda _i: None)
    args: list[str] = []
    if a == "Move":
        if overlay:
            head = f"gui_move({t}, {'to' if p.get('mode') == 'to' else 'by'}={_xy(p.get('x', 0), p.get('y', 0))}"
        else:
            head = f"{t}.animate.{'move_to' if p.get('mode') == 'to' else 'shift'}({_xy(p.get('x', 0), p.get('y', 0))})"
    elif a == "Scale":
        head = f"gui_scale({t}, {_f(p.get('factor', 1.5))}" if overlay else f"{t}.animate.scale({_f(p.get('factor', 1.5))})"
    elif a == "Rotate":
        about = f", about_point={_xy(p.get('ax', 0), p.get('ay', 0))}" if p.get("about") == "point" else ""
        head = (f"gui_rotate({t}, {_f(p.get('angle', 90))} * DEGREES{about}" if overlay
                else f"Rotate({t}, angle={_f(p.get('angle', 90))} * DEGREES{about}")
    elif a == "Color":
        head = f'gui_color({t}, "{p.get("color", "#FC6255")}"' if overlay else f'{t}.animate.set_color("{p.get("color", "#FC6255")}")'
    elif a == "Opacity":
        head = f"gui_opacity({t}, {_f(p.get('opacity', 0.3))}"
    elif a == "MoveAlongPath":
        path = ref(p.get("path")) or "None"
        if p.get("how") == "on" and not overlay:
            head = f"MoveAlongPath({t}, gui_path({path})"
        else:
            head = f"gui_along({t}, {path}" + (", relative=False" if p.get("how") == "on" else "")
    elif a == "SetValue":
        head = f"{t}.animate.set_value({p.get('value') or '0'})"
    elif a == "IncValue":
        head = f"{t}.animate.increment_value({p.get('value') or '0'})"
    elif a == "LaggedIn":
        head = f'gui_lagged({t}, "{p.get("how", "fade")}"'
        if _f(p.get("lag", 0.15)) != "0.15":
            args.append(f"lag={_f(p['lag'])}")
        if p.get("how", "fade") == "fade" and p.get("dir", "none") != "none":
            args.append(f"shift={_dir(p['dir'], 0.3)}")
    elif a == "WordByWord":
        head = f"gui_type({t}"
        args.append("words=True")
        if p.get("cursor"):
            args.append(f'cursor="{p.get("cursor_color", "#555555")}"')
            if row.get("part", {}).get("paths") and t != whole_var:
                args.append(f"ref={whole_var}")
    elif a == "CreateThenFade":
        head = f'gui_create_then_fade({t}, "{p.get("color", "#FFFF00")}"'
    elif a == "Swap":
        other = ref(p.get("with")) or "None"
        head = f"Swap({t}, {other}"
        if _f(p.get("arc", 90)) != "90":
            args.append(f"path_arc={_f(p['arc'])} * DEGREES")
    elif a == "ApplyMatrixEl":
        m = f"[[{p.get('a') or '1'}, {p.get('b') or '0'}], [{p.get('c') or '0'}, {p.get('d') or '1'}]]"
        head = f"ApplyMatrix({m}, {t}"
        args.append(f"about_point={t}.get_center()" if p.get("about", "center") == "center" else "about_point=ORIGIN")
    elif a == "BarValues":
        head = f"{t}.animate.change_bar_values([{p.get('values') or '0'}])"
    elif a == "Relayout":
        head = f'{t}.animate.change_layout("{p.get("layout", "circular")}", layout_scale={_f(p.get("scale", 2.0))})'
    elif a == "CodeHighlight":
        head = f'gui_code_highlight({t}, {repr(str(p.get("lines") or ""))}, color="{p.get("color", "#FFFF00")}"'
        if _f(p.get("opacity", 0.25)) != "0.25":
            args.append(f"opacity={_f(p['opacity'])}")
    elif a == "CountTo":
        head = f"gui_count({t}, {p.get('value') or '0'}"
    elif a in ("CamMove", "ZoomMove"):
        dest = ref(p.get("elem")) if a == "CamMove" and p.get("mode") == "elem" else None
        if dest:
            head = f"gui_move({t}, to={dest}" if overlay else f"{t}.animate.move_to({dest})"
        else:
            head = f"gui_move({t}, to={_xy(p.get('x', 0), p.get('y', 0))}" if overlay else f"{t}.animate.move_to({_xy(p.get('x', 0), p.get('y', 0))})"
    elif a == "CamZoom":
        f = 1.0 / max(1e-3, float(p.get("zoom", 2.0)))
        head = f"gui_scale({t}, {_f(f)}" if overlay else f"{t}.animate.scale({_f(f)})"
    elif a == "ZoomScale":
        head = f"gui_scale({t}, {_f(p.get('factor', 0.5))}" if overlay else f"{t}.animate.scale({_f(p.get('factor', 0.5))})"
    elif a == "CamRestore":
        head = f"Restore({t}"
    elif a in ("TypeIn", "TypeOut"):
        head = f"gui_type({t}"
        if a == "TypeOut":
            args.append("reverse=True")
        if p.get("cursor"):
            args.append(f'cursor="{p.get("cursor_color", "#555555")}"')
            if row.get("part", {}).get("paths") and t != whole_var:
                args.append(f"ref={whole_var}")  # 一部分を打つときは、カーソルの高さを要素全体の行に合わせる
    elif a == "MatchTransform":
        dest = ref(p.get("to")) or "None"
        pairs = [(pr["from"], pr["to"]) for pr in p.get("pairs") or []]
        head = f"gui_match_transform({t}, {dest}, {repr(pairs)}"
        if p.get("rest", "match") != "match":
            args.append(f'rest="{p["rest"]}"')
        if _f(p.get("arc", 0)) != "0":
            args.append(f"path_arc={_f(p['arc'])} * DEGREES")
    elif a == "Restore":
        head = f"Restore({t}"
    elif a == "PhaseFlow":
        if p.get("source", "field") == "expr":
            src = f"fn=lambda x, y: ({p.get('fx') or '0'}, {p.get('fy') or '0'})"
        else:
            src = f"field={ref(p.get('field')) or 'None'}"
        head = f"gui_phase_flow({t}, {src}, virtual_time={_f(p.get('vt', 1))}"
        if p.get("shape", "keep") == "keep":
            head += ", keep_shape=True"
    elif a in ("ReplacementTransform", "TransformMatchingShapes", "FadeTransform", "TransformFromCopy"):
        dest = ref(p.get("to")) or "None"
        head = f"{a}({t}, {dest}"
        if a != "FadeTransform" and _f(p.get("arc", 0)) != "0":
            args.append(f"path_arc={_f(p['arc'])} * DEGREES")
    elif a == "PointwiseFn":
        head = f"ApplyPointwiseFunction(lambda p: gui_fn_xy(p, lambda x, y: ({p.get('fx') or 'x'}, {p.get('fy') or 'y'})), {t}"
    elif a == "Homotopy":
        head = f"Homotopy(lambda x, y, z, t: ({p.get('fx') or 'x'}, {p.get('fy') or 'y'}, z), {t}"
    elif a == "ComplexFn":
        head = f"ApplyComplexFunction(lambda z: {p.get('fz') or 'z'}, {t}"
    elif a in ("FadeIn", "FadeOut"):
        if p.get("dir", "none") != "none":
            args.append(f"shift={_dir(p['dir'], p.get('dist', 0.5))}")
        if abs(float(p.get("scale", 1.0)) - 1.0) > 1e-9:
            args.append(f"scale={_f(p['scale'])}")
        head = f"{a}({t}"
    elif a == "Grow":
        head = f"GrowFromEdge({t}, {p.get('edge', 'LEFT')}" if p.get("from") == "edge" else f"GrowFromCenter({t}"
    elif a == "GrowArrow":
        # GrowArrow(矢印) と同じ（矢印の始点から伸ばす）。ラベル付きの線・ベクトルなどのグループにも使えるようにする
        head = f"GrowFromPoint({t}, gui_start({t})"
    elif a == "SpinInFromNothing":
        head = f"SpinInFromNothing({t}"
        if _f(p.get("angle", 90)) != "90":
            args.append(f"angle={_f(p['angle'])} * DEGREES")
    elif a == "SpinOut":
        # 回りながら小さくなって消える（SpinInFromNothing を逆に再生して、最後に場面から外す）
        head = f"SpinInFromNothing({t}"
        if _f(p.get("angle", 90)) != "90":
            args.append(f"angle={_f(p['angle'])} * DEGREES")
        args += ["reverse_rate_function=True", "remover=True"]
    elif a == "SpiralIn":
        head = f"SpiralIn({t}"
        if _f(p.get("scale_factor", 8)) != "8":
            args.append(f"scale_factor={_f(p['scale_factor'])}")
    elif a == "Indicate":
        head = f"Indicate({t}"
        args += _opts(p, [("color", "#FFFF00", "color"), ("scale_factor", 1.2, "scale_factor")])
    elif a == "Circumscribe":
        head = f"Circumscribe({t}"
        if p.get("shape") == "circle":
            args.append("shape=Circle")
        args += _opts(p, [("color", "#FFFF00", "color"), ("buff", 0.1, "buff")])
        if p.get("fade_out"):
            args.append("fade_out=True")
    elif a == "Flash":
        head = f"Flash({t}"
        args += _opts(p, [("color", "#FFFF00", "color"), ("num_lines", 12, "num_lines"), ("line_length", 0.2, "line_length")])
        args.append(f"flash_radius=max({t}.width, {t}.height) / 2 + 0.1")
    elif a == "Wiggle":
        head = f"Wiggle({t}"
        args += _opts(p, [("scale_value", 1.1, "scale_value"), ("angle", 3.6, "rotation_angle", " * DEGREES"), ("n_wiggles", 6, "n_wiggles")])
    elif a == "FocusOn":
        head = f"FocusOn({t}"
        args += _opts(p, [("color", "#888888", "color"), ("opacity", 0.2, "opacity")])
    elif a == "ApplyWave":
        head = f"ApplyWave({t}"
        if p.get("dir", "UP") not in ("UP", "none"):
            args.append(f"direction={p['dir']}")
        args += _opts(p, [("amplitude", 0.2, "amplitude")])
    elif a == "ShowPassingFlash":
        head = f'ShowPassingFlash({t}.copy().set_color("{p.get("color", "#FFFF00")}")'
        args.append(f"time_width={_f(p.get('time_width', 0.3))}")
    elif a == "ShowIncreasingSubsets":
        # Manim の ShowIncreasingSubsets は塗りの無い図形を塗りつぶすので、同じ動きの gui_subsets を使う
        head = f"gui_subsets({t}"
    elif a == "ShrinkToCenter":
        head = f"ShrinkToCenter({t}"
        args.append("remover=True")  # Manim の既定では、縮んで大きさ 0 のまま場面に残る
    elif a == "Blink":
        # Manim の Blink は塗りの無い図形を塗りつぶし、終わると対象を場面から外すので、同じ動きの gui_blink を使う
        head = f"gui_blink({t}"
        if int(p.get("blinks", 1)) != 1:
            args.append(f"blinks={int(p['blinks'])}")
    elif a == "Broadcast":
        head = f"Broadcast({t}.copy(), focal_point={t}.get_center()"
        if int(p.get("n_mobs", 5)) != 5:
            args.append(f"n_mobs={int(p['n_mobs'])}")
    else:
        head = f"{a}({t}"
    rt = row.get("runTime")
    args.append(f"run_time={_f(rt if rt is not None else spec['rt'])}")
    if row.get("rate"):
        # ease_… は from manim import * では読み込まれない（rate_functions.ease_in_sine のように書く）
        r = row["rate"]
        rf = "rate_functions." + r if r.startswith("ease_") else r
        if a == "Indicate":
            # Indicate は「行って戻る」（there_and_back）で、色・大きさを戻している。緩急は、その進み方に掛ける
            rf = f"lambda t: there_and_back({rf}(t))"
        args.append(f"rate_func={rf}")
    if ".animate." in head and not head.startswith("gui_"):
        # .animate は、引数を x.animate(run_time=…, rate_func=…).メソッド(…) の形で渡す
        obj, meth = head.split(".animate.", 1)
        return f"{obj}.animate({', '.join(args)}).{meth}"
    expr = head + (", " + ", ".join(args) if args else "") + ")"
    if a in ("TransformMatchingShapes", "FadeTransform", "MatchTransform"):
        expr = f"gui_restore({expr}, {t})"  # 置き換えたあとで、元の要素の形を戻す（部品をまとめて動かすので、元の要素を渡す）
    elif a in ("Uncreate", "Unwrite", "ShrinkToCenter", "SpinOut", "ReplacementTransform"):
        expr = f"gui_restore({expr})"  # 消したあと（置き換えたあと）で形を元に戻す（あとで出し直せるように）
    return expr


def stmt_line(row: dict[str, Any], t: str, ref=None) -> str:
    """前の動きが終わってから実行する行（動画・音声の操作・ズームの出し入れ・行列で変換）のコード。"""
    a, p = row["anim"], row.get("params") or {}
    ref = ref or (lambda _i: None)
    if a == "Media":
        act = p.get("action", "play")
        args = [f'"{act}"']
        if act in ("seek", "volume"):
            args.append(_f(p.get("value", 0)))
        wm = p.get("waitMode", "none")
        if act in ("play", "seek", "volume", "show", "hide") and wm == "end":
            args.append("wait=True")
        elif act in ("play", "seek", "volume", "show", "hide") and wm == "sec":
            args.append(f"wait={_f(max(0.01, float(p.get('waitSec', 2))))}")
        return f"gui_media(self, {t}, {', '.join(args)})"
    if a == "ZoomOn":
        return "self.activate_zooming(animate=True)"
    if a == "AlwaysRotate":
        about = f", about=({_f(p.get('ax', 0))}, {_f(p.get('ay', 0))})" if p.get("about") == "point" else ""
        return f'gui_always({t}, "rotate", speed={_f(p.get("speed", 90))}{about})'
    if a == "AlwaysMove":
        wrap = ", wrap=self" if p.get("idle", "wrap") == "wrap" else ""
        return f'gui_always({t}, "move", velocity=({_f(p.get("vx", 0.5))}, {_f(p.get("vy", 0))}){wrap})'
    if a == "AlwaysFollow":
        return f'gui_always({t}, "follow", target={ref(p.get("target")) or "None"}' + ("" if p.get("keep", True) else ", keep_offset=False") + ")"
    if a == "AlwaysStop":
        return f"gui_always_stop({t})"
    if a == "SaveState":
        return f"{t}.save_state()"
    if a == "Cam3dMove":
        kw = []
        for k, name in (("phi", "phi"), ("theta", "theta")):
            v = str(p.get(k) or "").strip()
            if v:
                kw.append(f"{name}=({v}) * DEGREES")
        if str(p.get("zoom") or "").strip():
            kw.append(f"zoom={str(p['zoom']).strip()}")
        cx, cy = str(p.get("cx") or "").strip(), str(p.get("cy") or "").strip()
        if cx or cy:  # 中心（片方だけなら、もう片方は今のまま）
            kw.append(f"frame_center=[{f'({cx})' if cx else 'self.camera._frame_center.get_center()[0]'}, "
                      f"{f'({cy})' if cy else 'self.camera._frame_center.get_center()[1]'}, 0]")
        rt = row.get("runTime")
        kw.append(f"run_time={_f(rt if rt is not None else 2.0)}")
        if row.get("rate"):
            r = row["rate"]
            kw.append(f"rate_func={'rate_functions.' + r if r.startswith('ease_') else r}")
        return f"self.move_camera({', '.join(kw)})"
    if a == "Cam3dSpin":
        return f'self.begin_ambient_camera_rotation(rate={_f(p.get("rate", 20))} * DEGREES, about="{p.get("about", "theta")}")'
    if a == "Cam3dStop":
        return f'self.stop_ambient_camera_rotation(about="{p.get("about", "theta")}")'

    if a == "ZoomOff":
        return "gui_zoom_off(self, hide=True)"
    if a == "ApplyMatrix":
        m = f"[[{p.get('a') or '1'}, {p.get('b') or '0'}], [{p.get('c') or '0'}, {p.get('d') or '1'}]]"
        rt = row.get("runTime")
        extra = ""
        if row.get("rate"):
            r = row["rate"]
            extra = f", rate_func={'rate_functions.' + r if r.startswith('ease_') else r}"
        return f"gui_apply_matrix(self, {t}, {m}, run_time={_f(rt if rt is not None else 2.0)}{extra})"
    return "pass"


def part_expr(v: str, paths: list[list[int]]) -> str:
    """要素 v の一部分（部品の番号の並び paths）のコード。続いた番号は切り出し（v[0][2:5]）にし、ばらばらなら VGroup にまとめる。"""
    ps = sorted({tuple(int(i) for i in q) for q in paths if q})
    if not ps:
        return v
    runs: list[list[tuple[int, ...]]] = []
    for q in ps:
        if runs and len(q) == len(runs[-1][-1]) and q[:-1] == runs[-1][-1][:-1] and q[-1] == runs[-1][-1][-1] + 1:
            runs[-1].append(q)
        else:
            runs.append([q])
    parts = []
    for r in runs:
        head = v + "".join(f"[{i}]" for i in r[0][:-1])
        parts.append(f"{head}[{r[0][-1]}]" if len(r) == 1 else f"{head}[{r[0][-1]}:{r[-1][-1] + 1}]")
    return parts[0] if len(parts) == 1 else f"VGroup({', '.join(parts)})"


def target_var(row: dict[str, Any], var_of, whole: bool = False) -> str | None:
    """行の対象の、コードでの名前（カメラ・ズームの枠・スライドの値も）。"""
    spec = CATALOG_BY_ID.get(row.get("anim"), {})
    if spec.get("group") == "camera":
        return "self.camera.frame"
    if spec.get("group") == "camera3d":
        return "self"
    if row.get("anim") in ("ZoomMove", "ZoomScale"):
        return "self.zoomed_camera.frame" if var_of(row.get("target")) else None
    tg = row.get("target") or ""
    if spec.get("group") == "value":
        return tg[2:] if tg.startswith("v:") and tg[2:].isidentifier() else None
    v = var_of(tg)
    part = row.get("part") or {}
    if v and part.get("paths") and not whole:
        return part_expr(v, part["paths"])
    return v


def row_duration(row: dict[str, Any]) -> float:
    if row["kind"] == "wait":
        return float(row["runTime"])
    rt = row.get("runTime")
    return float(rt if rt is not None else CATALOG_BY_ID[row["anim"]]["rt"]) * speed_factor(row.get("speed"))


def block_times(block: list[dict[str, Any]]) -> list[tuple[dict[str, Any], float, float]]:
    """自由なコードで区切られた行の並びの、各行の (行, 始まる秒, 長さ)。PowerPoint と同じ: 前と同時・前の後に・前の始まりから○秒後。"""
    times: list[tuple[dict[str, Any], float, float]] = []
    prev_start, prev_end = 0.0, 0.0
    for k, r in enumerate(block):
        d = row_duration(r)
        st = r.get("start", "after")
        if k == 0:
            s = r["lag"] if st == "lag" else 0.0
        elif st == "with":
            s = prev_start
        elif st == "lag":
            s = prev_start + r["lag"]
        else:
            s = prev_end
        times.append((r, s, d))
        prev_start, prev_end = s, max(prev_end, s + d) if st == "with" else s + d
    return times


# 動きの種類: 別の物を描く強調（対象には触れない）・対象に重ねる動き（強調・動かす）・それ以外（出す・消す・値・
# カメラを戻す。対象の形を決める「土台」）
SEPARATE_FX = {"Circumscribe", "Flash", "FocusOn", "ShowPassingFlash", "Broadcast", "CreateThenFade"}
OVERLAY_FX = {"Indicate", "Wiggle", "ApplyWave", "Blink", "Move", "Scale", "Rotate", "Color", "Opacity", "MoveAlongPath",
              "CamMove", "CamZoom", "ZoomMove", "ZoomScale"}


def is_base(anim: str) -> bool:
    return anim not in SEPARATE_FX and anim not in OVERLAY_FX


def overlapping_same_target(step: dict[str, Any], related) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """同じ時刻に、同じ要素（related(a, b) が真になる対象）を出す・消す行の組（Manim では一緒に動かせない）。
    強調は、出す・消す動きや、ほかの強調と重ねられる（gui_stack）。"""
    pairs = []
    block: list[dict[str, Any]] = []
    for r in [*(step.get("rows") or []), {"kind": "code"}]:
        if r["kind"] != "code" and not (r["kind"] == "anim" and CATALOG_BY_ID[r["anim"]].get("stmt")):
            block.append(r)
            continue
        an = [(x, st, d) for x, st, d in block_times(block) if x["kind"] == "anim" and is_base(x["anim"])]
        for i in range(len(an)):
            for j in range(i + 1, len(an)):
                (a, sa, da), (b, sb, db) = an[i], an[j]
                if sa < sb + db - 1e-6 and sb < sa + da - 1e-6 and related(a.get("target"), b.get("target")):
                    pairs.append((a, b))
        block = []
    return pairs


def step_lines(step: dict[str, Any], var_of, parent_of=None, ref=None) -> list[tuple[str, str | None]]:
    """GUI のステップの、コードの行と、その行を作った動きの行の id（自由なコードは、その行）。var_of(id) は変数名（無ければ None）。"""
    out: list[tuple[str, str | None]] = []
    block: list[dict[str, Any]] = []
    parent = parent_of or (lambda _i: None)

    def related(a: str | None, b: str | None) -> bool:
        return a == b or (parent(a) is not None and parent(a) == b) or (parent(b) is not None and parent(b) == a)

    def flush() -> None:
        if not block:
            return
        times = block_times(block)
        anims = [(r, st, d) for r, st, d in times if r["kind"] == "anim" and target_var(r, var_of)]
        total = max((st + d for _r, st, d in times), default=0.0)
        if not anims:
            out.append((f"self.wait({_f(total)})", block[0]["id"]))
            block.clear()
            return

        def wait_id(t0: float, t1: float, nxt: str) -> str:
            """t0〜t1 の待ち時間の行の id（その間にある「待つ」の行、無ければ次の動きの行）。"""
            ws = [r for r, st, d in times if r["kind"] == "wait" and st < t1 - 1e-6 and st + d > t0 + 1e-6]
            return ws[-1]["id"] if ws else nxt

        # 時間の重ならない所で self.play を分ける（同じ self.play に同じ要素の動きが 2 つあると、Manim では後の動きが
        # 前の動きを上書きしてしまうため。前の後に続く動きは、別の self.play になる）
        segs: list[list[tuple[dict[str, Any], float, float]]] = []
        end = -1.0
        for item in sorted(anims, key=lambda x: x[1]):
            if segs and item[1] < end - 1e-6:
                segs[-1].append(item)
                end = max(end, item[1] + item[2])
            else:
                segs.append([item])
                end = item[1] + item[2]
        t = 0.0
        for seg in segs:
            s0 = seg[0][1]
            s1 = max(st + d for _r, st, d in seg)
            if s0 - t > 1e-6:
                out.append((f"self.wait({_f(s0 - t)})", wait_id(t, s0, seg[0][0]["id"])))
            simple = all(abs(st - s0) < 1e-9 for _r, st, _d in seg) and len({round(d, 6) for _r, _s, d in seg}) == 1
            items = sorted(seg, key=lambda x: block.index(x[0]))
            when = {r["id"]: (st, d) for r, st, d in items}
            # 同じ要素（グループとその中の要素）を動かす行は、gui_stack でまとめる（Manim では同じ要素の動きを一緒に再生できない）
            groups: list[list[dict[str, Any]]] = []
            for r, _st, _d in items:
                if r["anim"] in SEPARATE_FX:
                    groups.append([r])
                    continue
                hit = next((g for g in groups if g[0]["anim"] not in SEPARATE_FX and any(related(r["target"], x["target"]) for x in g)), None)
                if hit is None:
                    groups.append([r])
                else:
                    hit.append(r)

            def one(r: dict[str, Any], overlay: bool) -> str:
                e = anim_expr(r, target_var(r, var_of), ref, overlay, target_var(r, var_of, whole=True))
                if r.get("speed"):
                    e = f"gui_speed({e}, {r['speed']!r})"
                st, _d = when[r["id"]]
                return e if simple else f"gui_at({e}, {_f(st - s0)}, {_f(s1 - s0)})"

            entries: list[list[tuple[str, str]]] = []
            for g in groups:
                if len(g) == 1:
                    entries.append([(one(g[0], False), g[0]["id"])])
                else:
                    tids = [x["target"] for x in g]
                    root = next((x for x in g if any(parent(u) == x["target"] for u in tids)), g[0])
                    lines = [(f"gui_stack({target_var(root, var_of, whole=True)},", g[0]["id"])]
                    lines += [(f"    {one(x, True)},", x["id"]) for x in g]
                    lines.append((")", g[-1]["id"]))
                    entries.append(lines)
            if len(entries) == 1 and len(entries[0]) == 1:
                out.append((f"self.play({entries[0][0][0]})", entries[0][0][1]))
            else:
                out.append(("self.play(", entries[0][0][1]))
                for ent in entries:
                    for k, (e, rid) in enumerate(ent):
                        out.append((f"    {e}{',' if k == len(ent) - 1 else ''}", rid))
                out.append((")", entries[-1][-1][1]))
            t = s1
        if total - t > 1e-6:
            out.append((f"self.wait({_f(total - t)})", wait_id(t, total, block[-1]["id"])))
        block.clear()

    for r in step.get("rows") or []:
        if r["kind"] == "code":
            flush()
            for line in (r.get("code") or "").replace("\r\n", "\n").split("\n"):
                out.append((line, r["id"]))
            continue
        if r["kind"] == "anim" and CATALOG_BY_ID[r["anim"]].get("stmt"):
            # 前の動きが終わってから実行する行（自由なコードと同じく、かたまりを区切る）
            flush()
            tv = target_var(r, var_of)
            if tv or r["anim"] in ("ZoomOn", "ZoomOff"):
                out.append((stmt_line(r, tv or "", ref), r["id"]))
            continue
        block.append(r)
    flush()
    return out


def step_code(step: dict[str, Any], var_of, parent_of=None, ref=None) -> str:
    return "\n".join(line for line, _ in step_lines(step, var_of, parent_of, ref))
