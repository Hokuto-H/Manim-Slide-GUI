"""発表の録画（発表ウィンドウの側）: 映したものを軽く記録し、マイク・カメラを録る。動画にするのは record_compose.py。

発表中は、画面そのものを撮らずに、次のことだけを記録する（発表が重くならないように）。
- どの動画（slides/files の区切りの動画）の、どの時刻のコマを映したか
- 発表の道具（ペンの線・レーザーポインター・拡大鏡・黒白画面）
- 重ねて再生する動画・音声（発表で再生）の、見え方・再生位置・音量
- マイクの音・カメラの映像（Qt の QMediaRecorder で、一時停止ごとに別のファイルに録る）
終わったら、使った動画を記録のフォルダにリンク（できなければコピー）しておく（描画し直しても、組み立て直せるように）。

操作:
  Ctrl+R        録画を始める ／ 一時停止 ／ 再開
  Ctrl+Shift+R  録画を終える（発表ウィンドウを閉じたときも終える）
情報ウィンドウの操作欄にも、同じボタンと録画時間を出す。

記録のフォルダ: <プロジェクト>/recordings/.raw/<録画の名前>/
  events.jsonl  1 行に 1 つの出来事（"t" は録画の時刻（秒）。一時停止の間は進まない）
  seg_<n>.mp4   マイク・カメラ（"seg" の出来事に、止めた時刻と長さ）
  src/          使った動画のリンク
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

MARK = -4242  # present_tools が、道具を描き込んだコマに付ける印


def _r(v: float, n: int = 4) -> float:
    return round(float(v), n)


def install_record(app, player_cls, folder: Path, scenes: list[str], cfg_path: str | None) -> None:
    """録画の仕組みを Player に入れる。cfg_path: 操作アプリが書いた録画の設定（JSON）。"""
    from qtpy.QtCore import QEvent, QObject, Qt

    try:
        cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8")) if cfg_path else {}
    except (OSError, ValueError):
        cfg = {}
    root = folder.resolve().parent  # プロジェクトのフォルダ
    cls = scenes[0] if scenes else "Deck"

    original_show = player_cls.show

    def show(self, *args, **kwargs):
        original_show(self, *args, **kwargs)
        if not hasattr(self, "_gui_rec"):
            try:
                self._gui_rec = Recorder(self, cfg, root, cls)
            except Exception as e:  # noqa: BLE001 — 録画が使えなくても、発表は続ける
                print(f"[manim-slide-gui] 録画を用意できませんでした: {e}", file=sys.stderr)
                self._gui_rec = None

    player_cls.show = show

    original_frame_changed = player_cls.frame_changed

    def frame_changed(self, frame):
        original_frame_changed(self, frame)
        rec = getattr(self, "_gui_rec", None)
        if rec is not None and rec.state == "rec" and frame.isValid() and frame.startTime() != MARK:
            rec.on_frame(frame)

    player_cls.frame_changed = frame_changed

    original_close = player_cls.close

    def close(self):
        rec = getattr(self, "_gui_rec", None)
        if rec is not None:
            rec.finish()
        original_close(self)

    player_cls.close = close

    def find_player():
        for w in app.topLevelWidgets():
            if isinstance(w, player_cls) and getattr(w, "_gui_rec", None) is not None:
                return w
        return None

    class Keys(QObject):
        def eventFilter(self, obj, event):  # noqa: N802 — Qt の名前
            if event.type() != QEvent.Type.KeyPress or event.key() != Qt.Key.Key_R:
                return False
            mods = event.modifiers()
            if not (mods & Qt.KeyboardModifier.ControlModifier):
                return False
            if event.isAutoRepeat():
                return True
            pl = find_player()
            if pl is None:
                return True
            if mods & Qt.KeyboardModifier.ShiftModifier:
                pl._gui_rec.finish()
            else:
                pl._gui_rec.toggle()
            return True

    flt = Keys(app)
    app.installEventFilter(flt)  # 最後に入れたフィルターが先に受け取る（manim-slides の R「もう一度再生」より先に）
    player_cls._gui_rec_filter = flt

    def on_quit():
        pl = find_player()
        if pl is not None:
            pl._gui_rec.finish()

    app.aboutToQuit.connect(on_quit)


class Capture:
    """マイク・カメラ。録画の一時停止ごとに、別のファイル（seg_<n>.mp4）に録る。"""

    def __init__(self, cfg: dict[str, Any], say) -> None:
        from qtpy.QtMultimedia import QAudioInput, QCamera, QMediaCaptureSession, QMediaDevices

        self.say = say
        self.session = QMediaCaptureSession()
        self.ain = self.cam = None
        self.mic_name = self.cam_name = ""
        self.recorder = None
        self.error = ""
        if cfg.get("mic"):
            devs = list(QMediaDevices.audioInputs())
            dev = _pick(devs, cfg.get("micId"), cfg.get("micName")) or QMediaDevices.defaultAudioInput()
            if dev is not None and not dev.isNull():
                self.ain = QAudioInput(dev)
                self.session.setAudioInput(self.ain)
                self.mic_name = dev.description()
        if cfg.get("camera"):
            devs = list(QMediaDevices.videoInputs())
            dev = _pick(devs, cfg.get("camId"), cfg.get("camName")) or QMediaDevices.defaultVideoInput()
            if dev is not None and not dev.isNull():
                self.cam = QCamera(dev)
                self.cam.errorOccurred.connect(lambda _e, s: self._fail(f"カメラを使えませんでした: {s}"))
                self.session.setCamera(self.cam)
                self.cam_name = dev.description()

    @property
    def kind(self) -> str:
        return ("a" if self.ain else "") + ("v" if self.cam else "")

    def _fail(self, text: str) -> None:
        self.error = text
        print(f"[manim-slide-gui] {text}", file=sys.stderr)
        self.say(text)

    def set_preview(self, widget) -> None:
        if self.cam is not None and widget is not None:
            self.session.setVideoOutput(widget)

    def start(self, path: Path) -> bool:
        if not self.kind:
            return False
        from qtpy.QtCore import QUrl
        from qtpy.QtMultimedia import QMediaFormat, QMediaRecorder

        if self.cam is not None and not self.cam.isActive():
            self.cam.start()
        rec = QMediaRecorder()
        fmt = QMediaFormat(QMediaFormat.FileFormat.MPEG4)
        if self.ain is not None:
            fmt.setAudioCodec(QMediaFormat.AudioCodec.AAC)
        if self.cam is not None:
            fmt.setVideoCodec(QMediaFormat.VideoCodec.H264)
        rec.setMediaFormat(fmt)
        rec.setQuality(QMediaRecorder.Quality.HighQuality)
        rec.setOutputLocation(QUrl.fromLocalFile(str(path)))
        rec.errorOccurred.connect(lambda _e, s: self._fail(f"マイク・カメラを録れませんでした: {s}"))
        self.session.setRecorder(rec)
        rec.record()
        self.recorder = rec
        self.path = path
        return True

    def stop(self) -> tuple[Path, float] | None:
        """今のファイルを閉じ終わるまで待つ（最長 8 秒）。(ファイル, 長さ（秒）)。"""
        rec = self.recorder
        if rec is None:
            return None
        from qtpy.QtCore import QEventLoop, QTimer
        from qtpy.QtMultimedia import QMediaRecorder

        self.recorder = None
        if rec.recorderState() != QMediaRecorder.RecorderState.StoppedState:
            loop = QEventLoop()
            rec.recorderStateChanged.connect(lambda st: loop.quit() if st == QMediaRecorder.RecorderState.StoppedState else None)
            QTimer.singleShot(8000, loop.quit)
            rec.stop()
            if rec.recorderState() != QMediaRecorder.RecorderState.StoppedState:
                loop.exec()
        dur = rec.duration() / 1000
        loc = rec.actualLocation().toLocalFile() or str(self.path)
        self.session.setRecorder(None)
        rec.deleteLater()
        p = Path(loc)
        return (p, dur) if p.is_file() and dur > 0 else None

    def close(self) -> None:
        if self.cam is not None:
            self.cam.stop()


def _pick(devs, dev_id, name):
    """id（16 進）で、無ければ名前で、機器を選ぶ。"""
    for d in devs:
        if dev_id and bytes(d.id()).hex() == dev_id:
            return d
    for d in devs:
        if name and d.description() == name:
            return d
    return None


class Recorder:
    def __init__(self, player, cfg: dict[str, Any], root: Path, cls: str) -> None:
        from qtpy.QtCore import QObject, QTimer

        self.player, self.cfg, self.root, self.cls = player, cfg, root, cls
        self.state = "idle"  # idle / rec / pause
        self.acc = 0.0
        self.t_resume = 0.0
        self.dir: Path | None = None
        self.f = None
        self.capture: Capture | None = None
        self.seg_n = 0
        self.saved = ""
        self._reset_diff()
        self.holder = QObject(player)
        self.timer = QTimer(self.holder)
        self.timer.timeout.connect(self.tick)
        self.timer.start(33)
        self.ui = None
        try:
            self.build_ui()
        except Exception as e:  # noqa: BLE001
            print(f"[manim-slide-gui] 録画の操作欄を作れませんでした: {e}", file=sys.stderr)

    def _reset_diff(self) -> None:
        self.last_v = None
        self.last_tool = None
        self.last_media = None
        self.last_pen: list[tuple[int, int]] = []
        self.files: set[str] = set()

    # ---- 時刻・書き出し

    def clock(self) -> float:
        return self.acc + (time.monotonic() - self.t_resume if self.state == "rec" else 0.0)

    def write(self, ev: dict[str, Any], t: float | None = None) -> None:
        if self.f is None:
            return
        ev = {"t": _r(self.clock() if t is None else t, 3), **ev}
        self.f.write(json.dumps(ev, ensure_ascii=False, separators=(",", ":")) + "\n")

    def say(self, text: str) -> None:
        ov = getattr(self.player, "_gui_tools", None)
        if ov is not None:
            ov.say(text, 2.2)
        self.update_ui()

    # ---- 操作

    def toggle(self) -> None:
        if self.state == "idle":
            self.start()
        elif self.state == "rec":
            self.pause()
        else:
            self.resume()

    def start(self) -> None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = self.root / "recordings" / ".raw"
        name = f"{self.cls}_{stamp}"
        d = base / name
        k = 2
        while d.exists():
            d = base / f"{name}_{k}"
            k += 1
        d.mkdir(parents=True)
        self.dir = d
        self.f = open(d / "events.jsonl", "w", encoding="utf-8")  # noqa: SIM115 — 録画の間、開いたままにする
        self._reset_diff()
        self.acc, self.seg_n, self.saved = 0.0, 0, ""
        if self.capture is None:
            self.capture = Capture(self.cfg, self.say)
            self.capture.set_preview(getattr(self, "preview", None))
        cfg = self.player.current_presentation_config
        res = list(cfg.resolution) if cfg else [1920, 1080]
        media = {}
        ctl = getattr(self.player, "_gui_media", None)
        for (pi, mid), it in (getattr(ctl, "items", {}) or {}).items():
            sp = it.spec
            media[f"{pi}:{mid}"] = {"path": sp.get("path"), "kind": sp.get("kind"), "rect": sp.get("rect"),
                                    "posterTime": float(sp.get("posterTime") or sp.get("trimStart") or 0.0)}
            if sp.get("path"):
                self.files.add(str(sp["path"]).replace("\\", "/"))
        self.write({"k": "meta", "version": 1, "cls": self.cls, "res": res, "created": datetime.now().isoformat(timespec="seconds"),
                    "media": media, "mic": self.capture.mic_name, "camera": self.capture.cam_name}, t=0.0)
        self.state = "rec"
        self.t_resume = time.monotonic()
        self.snapshot()
        self.start_seg()
        self.say("● 録画を始めました（Ctrl+R で一時停止、Ctrl+Shift+R で終える）")

    def pause(self) -> None:
        if self.state != "rec":
            return
        t = self.clock()
        self.acc = t
        self.state = "pause"
        self.write({"k": "pause"}, t=t)
        self.stop_seg(t)
        self.f.flush()
        self.say("Ⅱ 録画を一時停止しました（Ctrl+R で再開）")

    def resume(self) -> None:
        if self.state != "pause":
            return
        self.state = "rec"
        self.t_resume = time.monotonic()
        self.write({"k": "resume"})
        self.last_v = self.last_tool = self.last_media = None
        self.snapshot()
        self.start_seg()
        self.say("● 録画を再開しました")

    def finish(self) -> None:
        if self.state == "idle":
            return
        if self.state == "rec":
            t = self.clock()
            self.acc = t
            self.state = "pause"
            self.stop_seg(t)
        self.write({"k": "end"}, t=self.acc)
        self.f.close()
        self.f = None
        self.link_sources()
        (self.dir / "done").write_text("1", encoding="utf-8")
        self.state = "idle"
        self.saved = self.dir.name
        self.say("■ 録画を終えました（操作アプリで動画にします）")

    def start_seg(self) -> None:
        cap = self.capture
        if cap is None or not cap.kind:
            return
        self.seg_t0 = self.clock()
        try:
            cap.start(self.dir / f"seg_{self.seg_n}.mp4")
        except Exception as e:  # noqa: BLE001
            cap._fail(f"マイク・カメラを録れませんでした: {e}")

    def stop_seg(self, t: float) -> None:
        cap = self.capture
        if cap is None:
            return
        got = cap.stop()
        if got is None:
            return
        path, dur = got
        self.write({"k": "seg", "file": path.name, "kind": cap.kind, "start": _r(self.seg_t0, 3), "stop": _r(t, 3), "dur": _r(dur, 3)}, t=t)
        self.seg_n += 1

    def link_sources(self) -> None:
        """使った動画を、記録のフォルダの src/ にリンクする（同じ場所に作れなければコピー）。"""
        for rel in sorted(self.files):
            src = (self.root / rel)
            dest = self.dir / "src" / rel
            if not src.is_file() or dest.exists():
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(src, dest)
            except OSError:
                try:
                    shutil.copy2(src, dest)
                except OSError as e:
                    print(f"[manim-slide-gui] {rel} を記録に入れられませんでした: {e}", file=sys.stderr)

    # ---- 記録

    def rel(self, p: Path) -> str:
        p = Path(p)
        if not p.is_absolute():
            p = Path.cwd() / p  # manim-slides のパスは、発表を起動したフォルダ（プロジェクト）から
        try:
            return p.resolve().relative_to(self.root).as_posix()
        except ValueError:
            return p.resolve().as_posix()

    def on_frame(self, frame) -> None:
        st = frame.startTime()
        pos = st / 1e6 if st >= 0 else self.player.media_player.position() / 1000
        try:
            f = self.rel(self.player.current_file)
        except Exception:  # noqa: BLE001
            return
        key = (f, round(pos, 3))
        if key == self.last_v:
            return
        self.last_v = key
        self.files.add(f)
        self.write({"k": "v", "f": f, "p": _r(pos, 4)})

    def snapshot(self) -> None:
        """今の映像のコマ・道具・重ねる動画を、すべて書く（始め・再開のとき）。"""
        try:
            f = self.rel(self.player.current_file)
            pos = self.player.media_player.position() / 1000
            fr = getattr(self.player, "frame", None)
            if fr is not None and fr.isValid() and fr.startTime() >= 0:
                pos = fr.startTime() / 1e6
            self.last_v = (f, round(pos, 3))
            self.files.add(f)
            self.write({"k": "v", "f": f, "p": _r(pos, 4)})
        except Exception:  # noqa: BLE001
            pass
        self.last_pen = []
        self.tick(force=True)

    def tick(self, force: bool = False) -> None:
        self.update_ui()
        if self.state != "rec":
            return
        ov = getattr(self.player, "_gui_tools", None)
        if ov is not None:
            m = ov.mouse
            tool = {"blank": ov.blank,
                    "laser": [_r(m.x()), _r(m.y())] if ov.laser else None,
                    "lens": [_r(m.x()), _r(m.y()), _r(ov.zoom, 2)] if ov.lens else None}
            if force or tool != self.last_tool:
                self.last_tool = tool
                self.write({"k": "tool", **tool})
            self.pen_diff(ov.strokes)
        ctl = getattr(self.player, "_gui_media", None)
        if ctl is not None:
            items = {}
            for (pi, mid), it in ctl.items.items():
                vis = it.box is not None and it.box.isVisible()
                st = it.state()
                if not vis and not st["playing"]:
                    continue
                poster = bool(vis and it.box.layout().currentWidget() is it.poster)
                items[f"{pi}:{mid}"] = {"vis": vis, "play": st["playing"], "pos": _r(st["pos"], 3),
                                        "vol": _r(it.audio.volume(), 3), "poster": poster}
            if force or items != self.last_media:
                self.last_media = items
                self.write({"k": "m", "items": items})

    def pen_diff(self, strokes) -> None:
        """ペンの線の変わった所だけを書く: cut（そこから後ろの線を消す）・ext（線に点を足す）・new（新しい線。[色, 点, 書き方]）。"""
        cur = [(id(st[1]), len(st[1])) for st in strokes]
        prev = self.last_pen
        if cur == prev:
            return
        i = 0
        while i < min(len(cur), len(prev)) and cur[i][0] == prev[i][0]:
            i += 1
        ext = {}
        for j in range(i):
            if cur[j][1] > prev[j][1]:
                pts = strokes[j][1]
                ext[str(j)] = [[_r(q.x()), _r(q.y())] for q in pts[prev[j][1]:]]
        new = [[st[0], [[_r(q.x()), _r(q.y())] for q in st[1]]] + ([st[2]] if len(st) > 2 else []) for st in strokes[i:]]
        self.write({"k": "pen", "cut": i, "ext": ext, "new": new})
        self.last_pen = cur

    # ---- 情報ウィンドウの操作欄

    def build_ui(self) -> None:
        from qtpy.QtCore import Qt
        from qtpy.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget

        info = self.player.info
        row = QWidget()
        row.setProperty("guiPanel", True)
        h = QHBoxLayout(row)
        h.setContentsMargins(0, 4, 0, 0)
        self.btn = QPushButton()
        self.btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.btn.clicked.connect(self.toggle)
        self.end_btn = QPushButton("■ 録画を終える（Ctrl+Shift+R）")
        self.end_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.end_btn.clicked.connect(self.finish)
        self.label = QLabel()
        self.label.setTextFormat(Qt.TextFormat.PlainText)
        h.addWidget(self.btn)
        h.addWidget(self.end_btn)
        h.addWidget(self.label, 1)
        self.preview = None
        if self.cfg.get("camera"):
            from qtpy.QtMultimediaWidgets import QVideoWidget
            self.preview = QVideoWidget(row)
            self.preview.setFixedSize(160, 90)
            h.addWidget(self.preview)
        panel = getattr(self.player, "_gui_panel", None)
        if panel is not None and panel[0].layout() is not None:
            panel[0].layout().insertWidget(1, row)
        else:
            info.layout().addWidget(row)
        self.ui = row
        self.update_ui()

    def update_ui(self) -> None:
        if self.ui is None:
            return
        t = self.clock()
        tt = f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{int(t % 60):02d}" if t >= 3600 else f"{int(t // 60)}:{int(t % 60):02d}"
        devs = []
        cap = self.capture
        if self.cfg.get("mic"):
            devs.append(f"マイク: {cap.mic_name if cap and cap.mic_name else '（始めると選びます）' if cap is None else '使えません'}")
        if self.cfg.get("camera"):
            devs.append(f"カメラ: {cap.cam_name if cap and cap.cam_name else '（始めると選びます）' if cap is None else '使えません'}")
        if not devs:
            devs.append("マイク・カメラ: 使わない（操作アプリの「● 録画」で変えられます）")
        if self.state == "rec":
            self.btn.setText("Ⅱ 一時停止（Ctrl+R）")
            text = f"● 録画中 {tt}"
        elif self.state == "pause":
            self.btn.setText("● 再開（Ctrl+R）")
            text = f"Ⅱ 一時停止中 {tt}"
        else:
            self.btn.setText("● 録画を始める（Ctrl+R）")
            text = f"録画を保存しました（{self.saved}）。操作アプリで動画にしています。" if self.saved else "録画していません。"
        if cap is not None and cap.error:
            text += f" ／ {cap.error}"
        text += " ／ " + " ／ ".join(devs)
        if self.label.text() != text:
            self.label.setText(text)
            self.label.setStyleSheet("color: #d32f2f; font-weight: bold;" if self.state == "rec" else "")
        self.end_btn.setEnabled(self.state != "idle")
