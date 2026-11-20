"""発表ウィンドウで、動画・音声（発表で再生）を Manim の映像の上に重ねて再生する。

書き出したシーンが slides/gui_pages/<クラス名>.media.json に残す、次の記録に従う。
- segments: 区切り（manim-slides のスライド）ごとの、GUI のスライドの番号
- durations: 区切りごとの長さ（秒）
- media: 動画・音声の設定（位置・大きさはキャンバスの px。1920×1080 の画面の中）
- cues: [区切りの番号, 区切りの中の秒, id, 操作, 値]

次の区切りへ進んだときは、再生をそのまま続けて、その区切りの操作を時刻どおりに行う。
戻る・一覧から飛ぶなど、それ以外の移り方では、移った区切りの「始まりの時点の状態」（区切りを途中で止めずに
最初から見てきた場合の状態）にそろえる。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

CANVAS_W, CANVAS_H = 1920, 1080


def load_media_plans(folder: Path, scenes: list[str]) -> list[dict[str, Any] | None]:
    """発表の順（scenes）に、動画・音声の記録（無ければ None）。"""
    out: list[dict[str, Any] | None] = []
    for cls in scenes:
        f = folder / "gui_pages" / f"{cls}.media.json"
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None)
        except (OSError, ValueError):
            out.append(None)
    return out


# ---------------------------------------------------------------- 状態の計算（Qt を使わない。テストしやすいように）

def _end(spec: dict[str, Any]) -> float:
    return float(spec.get("trimEnd") or spec.get("duration") or 0.0)


def initial_state(spec: dict[str, Any]) -> dict[str, Any]:
    return {"visible": False, "playing": False, "pos": float(spec.get("trimStart") or 0.0),
            "volume": float(spec.get("volume", 1.0)), "active": False}


def on_slide(spec: dict[str, Any], slide: int) -> bool:
    """スライド slide で、この動画・音声が使えるか（自分のスライド、またはスライドをまたいで流す音声の範囲）。"""
    own = int(spec.get("slide", 0))
    if slide == own:
        return True
    if spec.get("kind") == "audio" and spec.get("across") and slide > own:
        until = spec.get("acrossUntil")
        return until is None or slide <= int(until)
    return False


def enter_slide(spec: dict[str, Any], st: dict[str, Any], slide: int, first: bool) -> None:
    """区切りが別のスライドに移ったときの扱い: 自分のスライドに入ったら最初の表示、範囲の外なら止めて隠す。"""
    if not on_slide(spec, slide):
        st.update(playing=False, visible=False, active=False, pos=float(spec.get("trimStart") or 0.0))
        return
    if slide == int(spec.get("slide", 0)) and first:
        st.update(active=True, playing=False, pos=float(spec.get("trimStart") or 0.0), volume=float(spec.get("volume", 1.0)),
                  visible=bool(spec.get("visible", True)) and not spec.get("hideIdle"))


def apply_cue(spec: dict[str, Any], st: dict[str, Any], action: str, value: Any) -> None:
    start, end = float(spec.get("trimStart") or 0.0), _end(spec)
    if action == "play":
        if end and st["pos"] >= end - 1e-3:
            st["pos"] = start
        st.update(playing=True, visible=True)
    elif action == "pause":
        st["playing"] = False
        if spec.get("hideIdle"):
            st["visible"] = False
    elif action == "stop":
        st.update(playing=False, pos=start)
        if spec.get("hideIdle"):
            st["visible"] = False
    elif action == "seek":
        st["pos"] = max(start, float(value or 0.0))
    elif action == "volume":
        st["volume"] = min(1.0, max(0.0, float(value or 0.0)))
    elif action == "show":
        st["visible"] = True
    elif action == "hide":
        st["visible"] = False


def advance(spec: dict[str, Any], st: dict[str, Any], dt: float) -> None:
    """再生中なら dt 秒進める（終わりで、くり返し・終わったときの扱い）。"""
    if not st["playing"] or dt <= 0:
        return
    start, end = float(spec.get("trimStart") or 0.0), _end(spec)
    st["pos"] += dt
    if end and st["pos"] >= end:
        if spec.get("loop") and end > start:
            st["pos"] = start + (st["pos"] - start) % (end - start)
        else:
            finish(spec, st)


def finish(spec: dict[str, Any], st: dict[str, Any]) -> None:
    start, end = float(spec.get("trimStart") or 0.0), _end(spec)
    st["playing"] = False
    after = spec.get("after", "hold")
    st["pos"] = start if after == "rewind" else end
    if after == "hide" or spec.get("hideIdle"):
        st["visible"] = False


def state_at(plan: dict[str, Any], seg: int) -> dict[str, dict[str, Any]]:
    """区切り seg の始まりの時点の状態（最初の区切りから、どの区切りも止めずに見てきた場合）。"""
    media = plan.get("media") or {}
    segs = plan.get("segments") or []
    durs = plan.get("durations") or []
    cues = plan.get("cues") or []
    states = {mid: initial_state(spec) for mid, spec in media.items()}
    prev_slide = None
    for j in range(0, seg + 1):
        slide = segs[j] if j < len(segs) else (segs[-1] if segs else 0)
        if slide != prev_slide:
            for mid, spec in media.items():
                enter_slide(spec, states[mid], slide, True)
            prev_slide = slide
        if j == seg:
            break
        t = 0.0
        for c in [c for c in cues if c[0] == j]:
            for mid, spec in media.items():
                advance(spec, states[mid], c[1] - t)
            t = c[1]
            if c[2] in media:
                apply_cue(media[c[2]], states[c[2]], c[3], c[4])
        dur = durs[j] if j < len(durs) else t
        for mid, spec in media.items():
            advance(spec, states[mid], max(0.0, dur - t))
    return states


# ---------------------------------------------------------------- 発表ウィンドウ（Qt）

def install_media(player_cls, folder: Path, scenes: list[str]) -> None:
    """Player の表示のときに、重ねて再生する部品を作る。記録が無ければ何もしない。"""
    plans = load_media_plans(folder, scenes)
    if not any(plans):
        return
    root = folder.resolve().parent  # プロジェクトのフォルダ（media.json のパスの基準）
    original_show = player_cls.show

    def show(self, *args, **kwargs):
        if not hasattr(self, "_gui_media"):
            try:
                self._gui_media = MediaController(self, plans, root)
            except Exception as e:  # noqa: BLE001 — 動画・音声が使えなくても、発表は続ける
                print(f"[manim-slide-gui] 動画・音声を用意できませんでした: {e}", file=sys.stderr)
                self._gui_media = None
        original_show(self, *args, **kwargs)
        if self._gui_media is not None:
            self._gui_media.resync()

    player_cls.show = show


class MediaController:
    def __init__(self, player, plans: list[dict[str, Any] | None], root: Path) -> None:
        from qtpy.QtCore import QTimer

        self.player, self.plans, self.root = player, plans, root
        self.items: dict[tuple[int, str], MediaItem] = {}
        for pi, plan in enumerate(plans):
            for mid, spec in ((plan or {}).get("media") or {}).items():
                self.items[(pi, mid)] = MediaItem(self, spec, root)
        self.pos = (player.current_presentation_index, player.current_slide_index)
        self.reversed = False
        self.seg_timers: list[Any] = []
        self.pending: list[list[Any]] = []  # まだ行っていない、今の区切りの操作
        player.slide_changed.connect(self.on_change)
        player.presentation_changed.connect(self.on_change)
        # 重ねる位置（ウィンドウの大きさ・フルスクリーンの切り替え）と、終わり・フェードの見張り
        self.tick = QTimer(player)
        self.tick.timeout.connect(self.on_tick)
        self.tick.start(50)

    # ---- 区切りの移り変わり

    def plan(self, pi: int | None = None) -> dict[str, Any] | None:
        pi = self.player.current_presentation_index if pi is None else pi
        return self.plans[pi] if 0 <= pi < len(self.plans) else None

    def slide_of(self, pi: int, si: int) -> int:
        segs = (self.plan(pi) or {}).get("segments") or []
        return segs[si] if si < len(segs) else (segs[-1] if segs else 0)

    def on_change(self) -> None:
        new = (self.player.current_presentation_index, self.player.current_slide_index)
        old = self.pos
        if new == old:
            return
        self.pos = new
        if new[0] == old[0] and new[1] == old[1] + 1 and not self.player.playing_reversed_slide:
            self.forward(old, new)
        else:
            self.resync()

    def clear_timers(self) -> None:
        for t in self.seg_timers:
            t.stop()
            t.deleteLater()
        self.seg_timers = []

    def forward(self, old, new) -> None:
        """次の区切りへ: 前の区切りでまだ行っていない操作をすぐ行い、再生は続けたまま、新しい区切りの操作を時刻どおりに。"""
        self.clear_timers()
        for c in self.pending:
            self.run_cue(new[0], c)
        self.pending = []
        pi, si = new
        if self.slide_of(pi, si) != self.slide_of(*old):
            slide = self.slide_of(pi, si)
            for (p, mid), it in self.items.items():
                if p != pi:
                    it.apply({**initial_state(it.spec)})
                    continue
                st = it.state()
                enter_slide(it.spec, st, slide, True)
                it.apply(st)
        self.schedule(pi, si)

    def resync(self) -> None:
        """今の区切りの、始まりの時点の状態にそろえる（戻る・飛ぶ・最初の表示）。"""
        self.clear_timers()
        self.pending = []
        pi, si = self.player.current_presentation_index, self.player.current_slide_index
        self.pos = (pi, si)
        plan = self.plan(pi)
        states = state_at(plan, si) if plan else {}
        for (p, mid), it in self.items.items():
            it.apply(states.get(mid) if p == pi and mid in states else initial_state(it.spec))
        self.schedule(pi, si)

    def schedule(self, pi: int, si: int) -> None:
        from qtpy.QtCore import QTimer

        plan = self.plan(pi) or {}
        cues = [c for c in (plan.get("cues") or []) if c[0] == si]
        rate = float(getattr(self.player, "playback_rate", 1.0) or 1.0)
        self.pending = list(cues)
        for c in cues:
            if c[1] <= 0.001:
                self.run_cue(pi, c)
                continue
            t = QTimer(self.player)
            t.setSingleShot(True)
            t.timeout.connect(lambda c=c, pi=pi: self.run_cue(pi, c))
            t.start(int(c[1] * 1000 / rate))
            self.seg_timers.append(t)

    def run_cue(self, pi: int, c: list[Any]) -> None:
        if c in self.pending:
            self.pending.remove(c)
        it = self.items.get((pi, c[2]))
        if it is None:
            return
        st = it.state()
        apply_cue(it.spec, st, c[3], c[4])
        it.apply(st)

    def on_tick(self) -> None:
        for it in self.items.values():
            it.tick()


class MediaItem:
    """1 つの動画・音声: QMediaPlayer と、動画なら重ねる表示（映像・ポスター・操作バー）。"""

    def __init__(self, ctl: MediaController, spec: dict[str, Any], root: Path) -> None:
        from qtpy.QtCore import QUrl
        from qtpy.QtMultimedia import QAudioOutput, QMediaPlayer

        self.ctl, self.spec = ctl, spec
        self.start, self.end = float(spec.get("trimStart") or 0.0), _end(spec)
        self.visible = False
        self.vol = float(spec.get("volume", 1.0))
        self.audio = QAudioOutput(ctl.player)
        self.mp = QMediaPlayer(ctl.player)
        self.mp.setAudioOutput(self.audio)
        path = (root / spec["path"]).resolve()
        self.mp.setSource(QUrl.fromLocalFile(str(path)))
        # 動画の全体をくり返すときは、Qt にくり返させる（終わりまで行って止まってから初めに戻すと、境目に黒いコマが入るため）
        dur = float(spec.get("duration") or 0.0)
        self.whole_loop = bool(spec.get("loop")) and self.start <= 0.01 and (not spec.get("trimEnd") or float(spec["trimEnd"]) >= dur - 0.05)
        if self.whole_loop:
            self.mp.setLoops(QMediaPlayer.Loops.Infinite)
        # 読み込みの途中に頼んだ位置（読み込みが終わるまで setPosition が効かないことがあるので、覚えておいて合わせ直す）
        self.want: int | None = int(self.start * 1000)
        self.mp.mediaStatusChanged.connect(self.on_status)
        self.mp.positionChanged.connect(self.on_position)
        self._looping = False
        self.box = None
        if spec.get("kind") == "video":
            self.build_video(path)
        self.audio.setVolume(self.vol)

    # ---- 動画の表示

    def build_video(self, path: Path) -> None:
        from qtpy.QtCore import Qt
        from qtpy.QtGui import QPixmap
        from qtpy.QtMultimediaWidgets import QVideoWidget
        from qtpy.QtWidgets import QHBoxLayout, QLabel, QSlider, QStackedLayout, QToolButton, QWidget

        player = self.ctl.player
        box = QWidget(player)
        # Manim の映像（QVideoWidget は別のウィンドウとして描かれる）より手前に出すため、こちらも別のウィンドウにして上に置く
        box.setAttribute(Qt.WidgetAttribute.WA_NativeWindow, True)
        box.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        box.setStyleSheet("background: black;")
        lay = QStackedLayout(box)
        lay.setStackingMode(QStackedLayout.StackingMode.StackOne)
        self.vw = QVideoWidget(box)
        self.vw.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        # 枠は元の動画の縦横比で作っている（大きさの丸めで 1% ほど違うことがある）ので、余白（黒い帯）を作らずに枠いっぱいに出す
        self.vw.setAspectRatioMode(Qt.AspectRatioMode.IgnoreAspectRatio)
        self.poster = QLabel(box)
        self.poster.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.poster.setScaledContents(True)
        lay.addWidget(self.vw)
        lay.addWidget(self.poster)
        self.mp.setVideoOutput(self.vw)
        self.poster_pm = QPixmap()
        pt = float(self.spec.get("posterTime") or 0.0)
        cache = path.parent / ".posters" / f"{path.stem}_{pt:.3f}_0.png"
        if not cache.is_file():
            try:
                sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
                from app import media as _m  # noqa: PLC0415 — ポスターは GUI のサーバーと同じ作り方
                _m.poster(self.ctl.root, self.spec["path"], pt)
            except Exception:  # noqa: BLE001
                pass
        if cache.is_file():
            self.poster_pm = QPixmap(str(cache))
            self.poster.setPixmap(self.poster_pm)
        # 操作バー（マウスを乗せたときだけ）。押しても発表は進まない
        bar = QWidget(player)
        bar.setAttribute(Qt.WidgetAttribute.WA_NativeWindow, True)
        bar.setProperty("guiPanel", True)
        bar.setStyleSheet("background: rgba(20,20,20,200); color: white;")
        h = QHBoxLayout(bar)
        h.setContentsMargins(6, 2, 6, 2)
        self.btn = QToolButton(bar)
        self.btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.btn.clicked.connect(self.toggle)
        item = self

        class _Seek(QSlider):
            """押した所へ、すぐ移るシークバー（Qt の既定では、溝を押すと少しずつしか動かない）。"""

            def mousePressEvent(self, e):  # noqa: N802 — Qt の名前
                from qtpy.QtWidgets import QStyle, QStyleOptionSlider
                if e.button() == Qt.MouseButton.LeftButton:
                    opt = QStyleOptionSlider()
                    self.initStyleOption(opt)
                    handle = self.style().subControlRect(QStyle.ComplexControl.CC_Slider, opt, QStyle.SubControl.SC_SliderHandle, self)
                    x = e.position().x() if hasattr(e, "position") else e.x()
                    if not handle.contains(int(x), handle.center().y()):
                        v = QStyle.sliderValueFromPosition(self.minimum(), self.maximum(), int(x - handle.width() / 2),
                                                           max(1, self.width() - handle.width()))
                        self.setValue(v)
                        item.seek_start()
                        item.seek_to(v)
                        item.seek_end()
                        e.accept()
                        return
                super().mousePressEvent(e)

        self.slider = _Seek(Qt.Orientation.Horizontal, bar)
        self.slider.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.slider.setRange(int(self.start * 1000), int((self.end or 1) * 1000))
        # つまみのドラッグ: 押している間は一時停止して位置を合わせ、離したら元が再生中なら再生し直す
        # （再生したまま位置を変え続けると、再生側が前の位置へ戻してしまう・追いつかないことがあるため）
        self.slider.sliderPressed.connect(self.seek_start)
        self.slider.sliderMoved.connect(lambda v: self.seek_to(int(v)))
        self.slider.sliderReleased.connect(lambda: (self.seek_to(self.slider.value()), self.seek_end()))
        self.time = QLabel(bar)
        h.addWidget(self.btn)
        h.addWidget(self.slider, 1)
        h.addWidget(self.time)
        bar.hide()
        box.hide()
        self.box, self.bar = box, bar

    # ---- シーク（操作バーで位置を変える。再生中でも）

    def seek_start(self) -> None:
        from qtpy.QtMultimedia import QMediaPlayer
        self._seek_resume = self.mp.playbackState() == QMediaPlayer.PlaybackState.PlayingState
        if self._seek_resume:
            self.mp.pause()

    def seek_to(self, ms: int) -> None:
        ms = max(int(self.start * 1000), int(ms))
        if self.end:
            ms = min(ms, int(self.end * 1000))
        self.want = ms  # 位置が移るまで覚えておく（tick が古い位置へ戻さないように）
        self.mp.setPosition(ms)
        if self.box is not None and self.box.layout().currentWidget() is not self.vw:
            self.box.layout().setCurrentWidget(self.vw)  # ポスターではなく、移った所の映像を出す

    def seek_end(self) -> None:
        if getattr(self, "_seek_resume", False):
            self._seek_resume = False
            self.mp.play()
        self.update_volume()

    def geometry(self):
        """動画を置く所（Player の中の px）。Manim の映像は、真ん中に縦横比を保って表示されている。"""
        from qtpy.QtCore import QRect

        cw = self.ctl.player.centralWidget()
        g = cw.geometry()
        k = min(g.width() / CANVAS_W, g.height() / CANVAS_H)
        ox = g.x() + (g.width() - CANVAS_W * k) / 2
        oy = g.y() + (g.height() - CANVAS_H * k) / 2
        x, y, w, h = self.spec["rect"]
        return QRect(round(ox + x * k), round(oy + y * k), max(1, round(w * k)), max(1, round(h * k)))

    # ---- 状態

    def pos(self) -> float:
        """いまの再生位置（秒）。合わせ直し待ちの位置があれば、そちら。区間の前にはしない。"""
        p = (self.want if self.want is not None else self.mp.position()) / 1000
        return max(self.start, p)

    def on_status(self, status) -> None:
        from qtpy.QtMultimedia import QMediaPlayer

        if self.want is not None and status in (QMediaPlayer.MediaStatus.LoadedMedia, QMediaPlayer.MediaStatus.BufferedMedia,
                                                QMediaPlayer.MediaStatus.BufferingMedia):
            self.mp.setPosition(self.want)

    def on_position(self, position: int) -> None:
        if self.want is not None and abs(position - self.want) < 80:
            self.want = None

    def state(self) -> dict[str, Any]:
        from qtpy.QtMultimedia import QMediaPlayer

        return {"visible": self.visible, "playing": self.mp.playbackState() == QMediaPlayer.PlaybackState.PlayingState,
                "pos": self.pos(), "volume": self.vol, "active": True}

    def apply(self, st: dict[str, Any] | None) -> None:
        st = st or initial_state(self.spec)
        self.vol = float(st.get("volume", self.vol))
        p = max(self.start, float(st["pos"]))
        if self.end:
            p = min(p, self.end)
        pos_ms = int(p * 1000)
        if abs(self.mp.position() - pos_ms) > 30:
            self.want = pos_ms
            self.mp.setPosition(pos_ms)
        if st["playing"]:
            self.mp.play()
        else:
            self.mp.pause()
        self.set_visible(bool(st["visible"]), bool(st["playing"]))
        self.update_volume()

    def set_visible(self, on: bool, playing: bool) -> None:
        self.visible = on
        if self.box is None:
            return
        if on:
            self.box.setGeometry(self.geometry())
            # 再生していないときは、ポスター（または止めた所の映像）を出す
            # 再生していない・まだ動いていない（区間の初めにいる）ときは、ポスター（指定の時刻のコマ）を出す
            show_poster = not playing and abs(self.pos() - self.start) < 0.05 and not self.poster_pm.isNull()
            self.box.layout().setCurrentWidget(self.poster if show_poster else self.vw)
            self.box.show()
            self.box.raise_()
        else:
            self.box.hide()
            self.bar.hide()

    def toggle(self) -> None:
        st = self.state()
        apply_cue(self.spec, st, "pause" if st["playing"] else "play", None)
        self.apply(st)

    def update_volume(self) -> None:
        """フェードイン・フェードアウト（音量）を、いまの再生位置から。"""
        p = self.pos()
        f = 1.0
        fi, fo = float(self.spec.get("fadeIn") or 0.0), float(self.spec.get("fadeOut") or 0.0)
        if fi > 0:
            f = min(f, max(0.0, (p - self.start) / fi))
        if fo > 0 and self.end:
            f = min(f, max(0.0, (self.end - p) / fo))
        self.audio.setVolume(self.vol * f)

    def tick(self) -> None:
        from qtpy.QtGui import QCursor
        from qtpy.QtMultimedia import QMediaPlayer

        playing = self.mp.playbackState() == QMediaPlayer.PlaybackState.PlayingState
        if playing:
            self._looping = True
        elif self.mp.mediaStatus() != QMediaPlayer.MediaStatus.EndOfMedia:
            self._looping = False  # 一時停止・停止したら、くり返しも止める
        raw = self.mp.position()
        # 頼んだ位置にまだ移っていない（読み込み中に頼んだ）・区間より前を再生している、ときは合わせ直す
        if self.want is not None and abs(raw - self.want) > 100 and self.mp.isSeekable():
            self.mp.setPosition(self.want)
        elif playing and self.want is None and raw < self.start * 1000 - 100:
            self.want = int(self.start * 1000)
            self.mp.setPosition(self.want)
        p = self.pos()
        if playing:
            if self.end and not self.whole_loop and p >= self.end - 0.06:  # 確かめる間隔（0.05 秒）より早めに戻す
                if self.spec.get("loop"):
                    self.mp.setPosition(int(self.start * 1000))
                else:
                    st = self.state()
                    finish(self.spec, st)
                    self.apply(st)
                    return
            self.update_volume()
            if self.box is not None and self.box.isVisible() and self.box.layout().currentWidget() is not self.vw:
                self.box.layout().setCurrentWidget(self.vw)
        elif self.mp.mediaStatus() == QMediaPlayer.MediaStatus.EndOfMedia and self.spec.get("loop") and self._looping:
            # くり返し: ファイルの最後まで行って止まった（区間の終わりがファイルの終わり）ときも、区間の初めから
            self.want = int(self.start * 1000)
            self.mp.setPosition(self.want)
            self.mp.play()
        elif self.mp.mediaStatus() == QMediaPlayer.MediaStatus.EndOfMedia and self.visible and self.spec.get("after") != "hold":
            st = self.state()
            finish(self.spec, st)
            self.apply(st)
        if self.box is None or not self.visible:
            return
        g = self.geometry()
        if self.box.geometry() != g:
            self.box.setGeometry(g)
        # 操作バー: 動画の上にマウスがあるときだけ、動画の下の端に出す
        if self.spec.get("controls", True) and g.contains(self.ctl.player.mapFromGlobal(QCursor.pos())):
            bh = 30
            self.bar.setGeometry(g.x(), g.y() + g.height() - bh, g.width(), bh)
            self.btn.setText("❚❚" if playing else "▶")
            if not self.slider.isSliderDown():
                self.slider.setValue(int(p * 1000))
            self.time.setText(f"{int(p // 60)}:{int(p % 60):02d} / {int(self.end // 60)}:{int(self.end % 60):02d}")
            if not self.bar.isVisible():
                self.bar.show()
            self.bar.raise_()
        elif self.bar.isVisible():
            self.bar.hide()
