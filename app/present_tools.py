"""発表の道具: レーザーポインター・ペン・黒画面／白画面・拡大鏡・ページ番号で飛ぶ・タイマー。

発表ウィンドウ（manim-slides の Player）の映像の上に、透明な重ね板（Overlay）を置いて描く。キーは、アプリ全体の
イベントフィルターで、manim-slides の操作より先に受け取る（manim-slides のキー Q・Space・←→・V・R・F・H とは重ならない）。

キー:
  L  レーザーポインター（マウスに付いて動く赤い点。もう一度で消す）
  P  ペン（ドラッグで書く。もう一度で終わる。書いた線は残る）／ C ペンの色を変える ／ E そのページの線を全部消す
     [ ] 太さ ／ M 蛍光ペン（太い半透明の線）／ Shift を押しながらドラッグで直線、Ctrl を押しながらドラッグで四角
     （書いた線はページごとに覚え、ページを移ると消え、そのページに戻るとまた出る）
  B  黒画面 ／ W 白画面（もう一度で戻る）
  Z  拡大鏡（マウスの周りを拡大。+ − で倍率）
  数字 → Enter  そのページへ飛ぶ（「3」はページ 3 の初め、「3-2」「3.2」はページ 3 の 2 回目のクリック、「A2」は付録の 2 ページ目）。
               Backspace で 1 文字消す
  Esc  道具をやめる（入力中の番号も消す）
  ?   キーの一覧を出す・消す
  （Ctrl+R・Ctrl+Shift+R は録画。present_record.py）
タイマー（経過時間・残り時間・時刻）は、発表者用の情報ウィンドウの操作欄に出す。
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

PEN_COLORS = ["#E53935", "#1E88E5", "#43A047", "#FDD835", "#000000", "#FFFFFF"]
HELP = ("L: レーザーポインター ／ P: ペン（C: 色、[ ]: 太さ、M: 蛍光ペン、Shift: 直線、Ctrl: 四角、E: このページの線を消す） ／ B: 黒画面 ／ W: 白画面 ／ Z: 拡大鏡（+ − で倍率） ／ "
        "数字と Enter: そのページへ（3-2 で 3 ページの 2 回目のクリック、A2 で付録の 2 ページ目） ／ Esc: 道具をやめる ／ Ctrl+R: 録画（始める・一時停止） ／ Ctrl+Shift+R: 録画を終える ／ ?: この一覧")


def page_index(folder: Path, scenes: list[str], counts: list[int]) -> list[tuple[int, int, int, int]]:
    """各区切りの (シーン, 区切りの番号, ページ, クリック)。記録が無ければ、区切りの通し番号をページにする。"""
    out = []
    for k, n in enumerate(counts):
        data = None
        if k < len(scenes):
            try:
                d = json.loads((folder / "gui_pages" / f"{scenes[k]}.json").read_text(encoding="utf-8"))
                if isinstance(d, list) and len(d) == n:
                    data = d
            except (OSError, ValueError):
                data = None
        for si in range(n):
            p, c = (data[si] if data else (si + 1, 0))
            out.append((k, si, p if isinstance(p, str) else int(p), int(c)))  # 付録は「A1」…
    return out


def find_target(index: list[tuple[int, int, int, int]], text: str) -> tuple[int, int] | None:
    """入力した番号（「3」「3-2」「3.2」）の区切り。見つからなければ None。"""
    m = re.fullmatch(r"\s*([AaＡａ]?)(\d+)\s*(?:[-.．ー－]\s*(\d+))?\s*", text)
    if not m:
        return None
    page = f"A{int(m.group(2))}" if m.group(1) else int(m.group(2))  # 「A2」は付録の 2 ページ目
    click = int(m.group(3) or 0)
    best = None
    for pi, si, p, c in index:
        if p == page and c == click:
            return (pi, si)
        if p == page and best is None:
            best = (pi, si)
    return best if click == 0 else next(((pi, si) for pi, si, p, c in index if p == page and c >= click), best)



def paint_tools(p, img, blank, strokes, mouse, laser, lens, zoom) -> None:
    """黒白画面・ペンの線・拡大鏡・レーザーを、img に描く（p は img の QPainter）。発表と、録画の組み立てで使う。
    strokes: [(色, [(x, y), …], 書き方)]（映像に対する割合）。書き方は {"w": 太さの倍率, "a": 不透明度, "k": free・line・rect}（省略可）。
    mouse: (x, y)（割合）。"""
    from qtpy.QtCore import QPointF, QRectF, Qt
    from qtpy.QtGui import QBrush, QColor, QPainter, QPainterPath, QPen, QRadialGradient

    W, H = img.width(), img.height()
    p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    if blank:
        p.fillRect(0, 0, W, H, QColor("#000000" if blank == "black" else "#FFFFFF"))
    lw = max(3.0, H / 170)
    for st in strokes:
        color, pts = st[0], st[1]
        style = st[2] if len(st) > 2 and isinstance(st[2], dict) else {}
        if not pts:
            continue
        w = lw * float(style.get("w", 1.0))
        col = QColor(color)
        col.setAlphaF(float(style.get("a", 1.0)))
        kind = style.get("k", "free")
        pen = QPen(col, w, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        if kind in ("line", "rect") and len(pts) >= 2:
            a, b = QPointF(pts[0][0] * W, pts[0][1] * H), QPointF(pts[-1][0] * W, pts[-1][1] * H)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(pen)
            if kind == "line":
                p.drawLine(a, b)
            else:
                p.drawRect(QRectF(a, b).normalized())
            continue
        if len(pts) == 1:
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(col)
            p.drawEllipse(QPointF(pts[0][0] * W, pts[0][1] * H), w / 2, w / 2)
            continue
        path = QPainterPath(QPointF(pts[0][0] * W, pts[0][1] * H))
        for x, y in pts[1:]:
            path.lineTo(QPointF(x * W, y * H))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(pen)
        p.drawPath(path)
    c = QPointF(mouse[0] * W, mouse[1] * H)
    if lens and not blank:
        src = img.copy()  # 書いた線も一緒に拡大する
        r = H * 0.16
        half = r / zoom
        clip = QPainterPath()
        clip.addEllipse(c, r, r)
        p.save()
        p.setClipPath(clip)
        p.drawImage(QRectF(c.x() - r, c.y() - r, 2 * r, 2 * r), src, QRectF(c.x() - half, c.y() - half, 2 * half, 2 * half))
        p.restore()
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(255, 255, 255, 230), max(3.0, H / 250)))
        p.drawEllipse(c, r, r)
        p.setPen(QPen(QColor(40, 40, 40, 200), max(1.5, H / 600)))
        p.drawEllipse(c, r + H / 400, r + H / 400)
    if laser:
        rad = H / 90
        g = QRadialGradient(c, rad * 2.6)
        g.setColorAt(0.0, QColor(255, 60, 60, 255))
        g.setColorAt(0.35, QColor(255, 30, 30, 220))
        g.setColorAt(1.0, QColor(255, 0, 0, 0))
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QBrush(g))
        p.drawEllipse(c, rad * 2.6, rad * 2.6)
        p.setBrush(QColor(255, 235, 235))
        p.drawEllipse(c, rad * 0.35, rad * 0.35)


def install_tools(app, player_cls, folder: Path, scenes: list[str]) -> None:
    from qtpy.QtCore import QEvent, QObject, QPointF, QRectF, Qt, QTimer
    from qtpy.QtGui import QColor, QCursor, QFont, QImage, QPainter
    from qtpy.QtWidgets import QHBoxLayout, QLabel, QPushButton, QSpinBox, QWidget  # noqa: F401

    MARK = -4242  # 道具を描き込んだコマの印（自分で入れたコマを、元の映像のコマと間違えないため）

    class Overlay(QObject):
        """レーザー・ペン・黒白画面・拡大鏡・番号の入力・キーの一覧を、映像のコマに描き込んで映す。
        （映像の部品の上に透明な部品を重ねても、映像が手前に出てしまうため、コマそのものに描く）"""

        def __init__(self, player) -> None:
            super().__init__(player)
            self.player = player
            self.laser = False
            self.pen = False
            self.lens = False
            self.zoom = 2.0
            self.blank: str | None = None  # "black" / "white"
            self.strokes: list[tuple] = []  # (色, 点, 書き方) 点は映像に対する割合（0〜1）で持つ
            self.page_strokes: dict = {}  # ページ → そのページで書いた線（ページに戻るとまた出す）
            self.drawing: list[QPointF] | None = None
            self.shape_kind: str | None = None  # Shift の直線・Ctrl の四角を書いている間
            self.color = 0
            self.width = 1.0  # 太さの倍率（[ ] で変える）
            self.marker = False  # 蛍光ペン
            self.typed = ""
            self.show_help = False
            self.toast = ""
            self.toast_until = 0.0
            self.mouse = QPointF(-1, -1)  # 映像に対する割合
            self.page_key = None
            self.was_active = False
            self.timer = QTimer(self)
            self.timer.timeout.connect(self.tick)
            self.timer.start(33)

        def active(self) -> bool:
            return bool(self.laser or self.lens or self.blank or self.strokes or self.typed or self.show_help
                        or (self.toast and time.time() < self.toast_until))

        def video_rect(self) -> QRectF:
            """発表ウィンドウの映像の部品の中で、映像（縦横比を保って真ん中に）が映る所（部品の座標）。"""
            vw_ = self.player.video_widget
            cfg = self.player.current_presentation_config
            rw, rh = cfg.resolution if cfg else (1920, 1080)
            W, H = vw_.width(), vw_.height()
            k = min(W / rw, H / rh)
            return QRectF((W - rw * k) / 2, (H - rh * k) / 2, rw * k, rh * k)

        def to_video(self, global_pos) -> QPointF:
            p = self.player.video_widget.mapFromGlobal(global_pos)
            r = self.video_rect()
            return QPointF((p.x() - r.x()) / max(1.0, r.width()), (p.y() - r.y()) / max(1.0, r.height()))

        def tick(self) -> None:
            key = (self.player.current_presentation_index, page_of(self.player))
            if key != self.page_key:  # ページが変わったら、そのページの線に替える（前のページの線は覚えておく）
                if self.page_key is not None:
                    self.page_strokes[self.page_key] = self.strokes
                self.page_key = key
                self.strokes = list(self.page_strokes.get(key, []))
                self.drawing = None
            if self.laser or self.lens:
                self.mouse = self.to_video(QCursor.pos())
            on = self.active()
            if on or self.was_active:
                self.push()
            self.was_active = on

        def set_mouse_mode(self) -> None:
            pl = self.player
            if self.pen:
                pl.setCursor(Qt.CursorShape.CrossCursor)
            elif self.laser or self.lens:
                pl.setCursor(Qt.CursorShape.BlankCursor)
            else:
                pl.unsetCursor()
            # 黒・白画面の間は、重ねて再生する動画（発表で再生）も隠す
            ctl = getattr(pl, "_gui_media", None)
            for it in getattr(ctl, "items", {}).values() if ctl is not None else []:
                box = getattr(it, "box", None)
                if box is not None:
                    if self.blank:
                        box.hide()
                    elif it.visible:
                        box.show()
            self.push()

        def say(self, text: str, sec: float = 1.6) -> None:
            self.toast, self.toast_until = text, time.time() + sec
            self.push()

        # ---- ペン（アプリ全体のイベントフィルターから呼ぶ）
        def style(self, kind: str = "free") -> dict:
            if self.marker:
                return {"w": round(self.width * 4.0, 2), "a": 0.35, "k": kind}
            return {"w": round(self.width, 2), "a": 1.0, "k": kind}

        def pen_press(self, gpos, button, mods=None) -> None:
            if button == Qt.MouseButton.LeftButton:
                kind = "free"
                if mods is not None and mods & Qt.KeyboardModifier.ShiftModifier:
                    kind = "line"
                elif mods is not None and mods & Qt.KeyboardModifier.ControlModifier:
                    kind = "rect"
                pt = self.to_video(gpos)
                self.drawing = [pt] if kind == "free" else [pt, pt]
                self.shape_kind = None if kind == "free" else kind
                self.strokes.append((PEN_COLORS[self.color], self.drawing, self.style(kind)))
            elif button == Qt.MouseButton.RightButton and self.strokes:
                self.strokes.pop()  # 右クリックで、最後の線を消す
            self.push()

        def pen_move(self, gpos) -> None:
            if self.drawing is None:
                return
            if self.shape_kind:
                # 直線・四角: 終わりの点だけを動かす（録画の差分が分かるように、点の並びを作り直す）
                self.drawing = [self.drawing[0], self.to_video(gpos)]
                c, _pts, st = self.strokes[-1]
                self.strokes[-1] = (c, self.drawing, st)
            else:
                self.drawing.append(self.to_video(gpos))
            self.push()

        def pen_release(self) -> None:
            self.drawing = None
            self.shape_kind = None

        # ---- コマに描く
        def base_image(self) -> QImage | None:
            fr = getattr(self.player, "frame", None)
            if fr is None or not fr.isValid():
                return None
            img = fr.toImage()
            if img.isNull():
                return None
            return img.convertToFormat(QImage.Format.Format_ARGB32)

        def push(self) -> None:
            from qtpy.QtMultimedia import QVideoFrame
            pl = self.player
            base = getattr(pl, "frame", None)
            if base is None or not base.isValid():
                return
            if not self.active():
                pl.video_sink.setVideoFrame(base)  # 元の映像に戻す
                pl.info.video_sink.setVideoFrame(base)
                return
            img = self.base_image()
            if img is None:
                return
            self.paint(img)
            vf = QVideoFrame(img)
            vf.setStartTime(MARK)
            pl.video_sink.setVideoFrame(vf)
            pl.info.video_sink.setVideoFrame(vf)  # 発表者用の画面にも、書き込みなどを映す

        def paint(self, img: QImage) -> None:
            H = img.height()
            p = QPainter(img)
            paint_tools(p, img, self.blank, [(st[0], [(q.x(), q.y()) for q in st[1]], st[2] if len(st) > 2 else {}) for st in self.strokes],
                        (self.mouse.x(), self.mouse.y()), self.laser, self.lens, self.zoom)
            font = QFont()
            font.setPixelSize(max(14, int(H / 34)))
            p.setFont(font)
            if self.typed:
                self.label(p, f"ページへ移動: {self.typed}_  （Enter で移動、Esc でやめる）", QPointF(H / 40, H - H / 40), "bl")
            elif self.toast and time.time() < self.toast_until:
                self.label(p, self.toast, QPointF(H / 40, H - H / 40), "bl")
            if self.show_help:
                small = QFont()
                small.setPixelSize(max(12, int(H / 48)))
                p.setFont(small)
                self.label(p, "\n".join(HELP.split(" ／ ")), QPointF(H / 40, H / 40), "tl")
            p.end()

        def label(self, p, text, at, corner) -> None:
            fm = p.fontMetrics()
            lines = text.split("\n")
            pad = fm.height() * 0.4
            w = max(fm.horizontalAdvance(s) for s in lines) + 2 * pad
            h = fm.height() * len(lines) + 2 * pad
            x = at.x()
            y = at.y() - h if corner == "bl" else at.y()
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(20, 20, 20, 210))
            p.drawRoundedRect(QRectF(x, y, w, h), pad, pad)
            p.setPen(QColor("#FFFFFF"))
            for i, s in enumerate(lines):
                p.drawText(QPointF(x + pad, y + pad + fm.ascent() + i * fm.height()), s)

    def page_of(player) -> int:
        idx = player._gui_page_index
        for pi, si, pg, _c in idx:
            if pi == player.current_presentation_index and si == player.current_slide_index:
                return pg
        return player.current_slide_index

    def find_player():
        for w in app.topLevelWidgets():
            if isinstance(w, player_cls) and w.isVisible() and hasattr(w, "_gui_tools"):
                return w
        return None

    def jump(player, text: str) -> None:
        t = find_target(player._gui_page_index, text)
        ov = player._gui_tools
        if t is None:
            ov.say(f"ページ「{text}」は見つかりません")
            return
        pi, si = t
        player.playing_reversed_slide = False
        if player.current_presentation_index != pi:
            player.current_presentation_index = pi
        player.current_slide_index = si
        player.load_current_slide()

    class Keys(QObject):
        def eventFilter(self, obj, event):  # noqa: N802 — Qt の名前
            et = event.type()
            if et in (QEvent.Type.MouseButtonPress, QEvent.Type.MouseMove, QEvent.Type.MouseButtonRelease):
                return self.mouse(obj, event, et)
            if et != QEvent.Type.KeyPress:
                return False
            win = obj.window() if isinstance(obj, QWidget) else None
            if win is None or not (isinstance(win, player_cls) or type(win).__name__ == "Info"):
                return False
            player = win if isinstance(win, player_cls) else find_player()
            if player is None or not hasattr(player, "_gui_tools"):
                return False
            if event.isAutoRepeat() and event.key() not in (Qt.Key.Key_Backspace,):
                return event.key() in KEYS_OURS
            ov = player._gui_tools
            k, text = event.key(), event.text()
            if text and (text.isdigit() or (ov.typed and text in "-.．ー－") or (not ov.typed and text in "aA")):
                ov.typed += text.upper()  # 「A2」Enter で付録の 2 ページ目
                ov.push()
                return True
            if ov.typed and k in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
                s, ov.typed = ov.typed, ""
                jump(player, s)
                ov.push()
                return True
            if ov.typed and k == Qt.Key.Key_Backspace:
                ov.typed = ov.typed[:-1]
                ov.push()
                return True
            if k == Qt.Key.Key_Escape:
                if ov.typed or ov.laser or ov.pen or ov.lens or ov.blank or ov.show_help:
                    ov.typed, ov.laser, ov.pen, ov.lens, ov.blank, ov.show_help = "", False, False, False, None, False
                    ov.set_mouse_mode()
                    return True
                return False
            if k == Qt.Key.Key_L:
                ov.laser = not ov.laser
                if ov.laser:
                    ov.lens = False
                ov.set_mouse_mode()
                ov.say("レーザーポインター: オン" if ov.laser else "レーザーポインター: オフ")
                return True
            if k == Qt.Key.Key_P:
                ov.pen = not ov.pen
                ov.set_mouse_mode()
                ov.say("ペン: オン（ドラッグで書く。Shift で直線・Ctrl で四角。右クリックで 1 本消す。C 色・[ ] 太さ・M 蛍光ペン・E 消す）" if ov.pen else "ペン: オフ（書いた線は残ります。E で消す）", 3.0)
                return True
            if k == Qt.Key.Key_C:
                ov.color = (ov.color + 1) % len(PEN_COLORS)
                ov.say(f"ペンの色: {PEN_COLORS[ov.color]}")
                return True
            if k == Qt.Key.Key_E:
                ov.strokes = []
                ov.say("このページの線を消しました")
                return True
            if k in (Qt.Key.Key_BracketLeft, Qt.Key.Key_BracketRight):
                ov.width = min(4.0, ov.width * 1.4) if k == Qt.Key.Key_BracketRight else max(0.4, ov.width / 1.4)
                ov.say(f"ペンの太さ: {ov.width:.1f} 倍")
                return True
            if k == Qt.Key.Key_M:
                ov.marker = not ov.marker
                ov.say("蛍光ペン: オン（太い半透明の線）" if ov.marker else "蛍光ペン: オフ")
                return True
            if k in (Qt.Key.Key_B, Qt.Key.Key_W):
                want = "black" if k == Qt.Key.Key_B else "white"
                ov.blank = None if ov.blank == want else want
                ov.set_mouse_mode()
                return True
            if k == Qt.Key.Key_Z:
                ov.lens = not ov.lens
                if ov.lens:
                    ov.laser = False
                ov.set_mouse_mode()
                ov.say(f"拡大鏡: {'オン（+ − で倍率）' if ov.lens else 'オフ'}")
                return True
            if k in (Qt.Key.Key_Plus, Qt.Key.Key_Equal, Qt.Key.Key_Minus) and ov.lens:
                ov.zoom = min(6.0, ov.zoom * 1.25) if k != Qt.Key.Key_Minus else max(1.25, ov.zoom / 1.25)
                ov.say(f"拡大鏡: {ov.zoom:.1f} 倍")
                return True
            if k == Qt.Key.Key_Question or text == "?":
                ov.show_help = not ov.show_help
                ov.push()
                return True
            return False

        def mouse(self, obj, event, et):
            # ペンの間は、発表ウィンドウの映像の上のマウスで書く（クリックで進めない）
            if not isinstance(obj, QWidget) or not isinstance(obj.window(), player_cls):
                return False
            player = obj.window()
            ov = getattr(player, "_gui_tools", None)
            if ov is None or not ov.pen:
                return False
            gpos = event.globalPosition().toPoint()
            if et == QEvent.Type.MouseButtonPress:
                ov.pen_press(gpos, event.button(), event.modifiers())
            elif et == QEvent.Type.MouseMove:
                ov.pen_move(gpos)
            else:
                ov.pen_release()
            return True

    KEYS_OURS = set()
    flt = Keys(app)
    app.installEventFilter(flt)

    original_frame_changed = player_cls.frame_changed

    def frame_changed(self, frame):
        if frame.isValid() and frame.startTime() == MARK:
            return  # 道具を描き込んだ、自分で入れたコマ
        original_frame_changed(self, frame)
        ov = getattr(self, "_gui_tools", None)
        if getattr(self, "_gui_priv_sink", None) is None:
            if ov is not None and ov.active():
                ov.push()
            return
        # 映像のコマは手元の受け口に届くので、映すコマ（そのまま、または道具を描き込んだもの）を、ここで画面に渡す
        if ov is not None and ov.active():
            ov.push()
        elif self.frame.isValid():
            self.video_sink.setVideoFrame(self.frame)

    player_cls.frame_changed = frame_changed

    original_show = player_cls.show

    def show(self, *args, **kwargs):
        original_show(self, *args, **kwargs)
        if not hasattr(self, "_gui_tools"):
            try:
                counts = [len(pc.slides) for pc in self.presentation_configs]
                self._gui_page_index = page_index(folder, scenes, counts)
                self._gui_tools = Overlay(self)
                # 再生する映像のコマを、画面の部品ではなく手元の受け口で受け取る（画面には、道具を描き込んだコマだけを
                # 渡せるように。そうしないと、再生中は元のコマと描き込んだコマが交互に映る）
                from qtpy.QtMultimedia import QVideoSink  # noqa: PLC0415
                priv = QVideoSink(self)
                try:
                    self.video_sink.videoFrameChanged.disconnect(self.frame_changed)
                except (RuntimeError, TypeError):
                    pass
                priv.videoFrameChanged.connect(self.frame_changed)
                self.media_player.setVideoOutput(priv)
                self._gui_priv_sink = priv
                self._gui_timer = add_timer(self)
            except Exception as e:  # noqa: BLE001 — 道具が使えなくても、発表は続ける
                print(f"[manim-slide-gui] 発表の道具を用意できませんでした: {e}", file=sys.stderr)

    player_cls.show = show
    player_cls._gui_keys_filter = flt  # 先に消えないように持っておく

    def add_timer(player) -> Any:
        """情報ウィンドウの操作欄に、タイマー（経過・残り・時刻）を足す。最初に次へ進んだときに動き出す。"""
        panel = getattr(player, "_gui_panel", (None,))[0]
        if panel is None:
            return None
        row = QWidget()
        row.setProperty("guiPanel", True)
        h = QHBoxLayout(row)
        h.setContentsMargins(0, 0, 0, 0)
        big = QLabel()
        big.setStyleSheet("font-size: 22px; font-weight: bold; font-family: monospace;")
        clock = QLabel()
        clock.setStyleSheet("font-size: 14px; color: #555;")
        goal = QSpinBox()
        goal.setRange(0, 600)
        goal.setSuffix(" 分")
        goal.setSpecialValueText("目安なし")
        goal.setValue(0)
        goal.setFocusPolicy(Qt.FocusPolicy.ClickFocus)
        goal.setToolTip("発表の目安の時間。決めると残り時間を出し、残り 2 分で橙、過ぎると赤にします")
        btn_pause = QPushButton("一時停止")
        btn_reset = QPushButton("リセット")
        for b in (btn_pause, btn_reset):
            b.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        h.addWidget(QLabel("タイマー"))
        h.addWidget(big)
        h.addWidget(clock)
        h.addStretch(1)
        h.addWidget(QLabel("目安"))
        h.addWidget(goal)
        h.addWidget(btn_pause)
        h.addWidget(btn_reset)
        panel.layout().insertWidget(0, row)
        keys = QLabel("発表の道具: " + HELP)
        keys.setWordWrap(True)
        keys.setStyleSheet("color: #444;")
        panel.layout().insertWidget(1, keys)
        st = {"t0": None, "acc": 0.0, "paused": False, "first": (player.current_presentation_index, player.current_slide_index)}

        def elapsed() -> float:
            return st["acc"] + (time.time() - st["t0"] if st["t0"] is not None and not st["paused"] else 0.0)

        def fmt(sec: float) -> str:
            sec = int(max(0, sec))
            return f"{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60:02d}:{sec % 60:02d}"

        def update() -> None:
            # 最初のページから動いたら、計り始める
            if st["t0"] is None and not st["paused"] and (player.current_presentation_index, player.current_slide_index) != st["first"]:
                st["t0"] = time.time()
            e = elapsed()
            g = goal.value() * 60
            if g:
                rest = g - e
                big.setText(f"{fmt(e)}  残り {'-' if rest < 0 else ''}{fmt(abs(rest))}")
                big.setStyleSheet("font-size: 22px; font-weight: bold; font-family: monospace; color: "
                                  + ("#C62828" if rest < 0 else "#E65100" if rest < 120 else "#1B5E20") + ";")
            else:
                big.setText(fmt(e))
                big.setStyleSheet("font-size: 22px; font-weight: bold; font-family: monospace;")
            clock.setText(time.strftime("（時刻 %H:%M）"))
            btn_pause.setText("再開" if st["paused"] else "一時停止")

        def pause() -> None:
            if st["paused"]:
                st["paused"] = False
                if st["t0"] is not None or st["acc"] > 0:
                    st["t0"] = time.time()
            else:
                st["acc"] = elapsed()
                st["t0"] = time.time() if st["t0"] is not None else None
                st["paused"] = True
            update()

        def reset() -> None:
            st.update(t0=None, acc=0.0, paused=False, first=(player.current_presentation_index, player.current_slide_index))
            update()

        btn_pause.clicked.connect(pause)
        btn_reset.clicked.connect(reset)
        t = QTimer(row)
        t.timeout.connect(update)
        t.start(250)
        update()
        return (row, t, goal, big)
