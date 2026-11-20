"""発表ウィンドウ: リモコン・章・付録・リンク・ページごとの目安の時間・リハーサル。

描画のときに、書き出した .py が slides/gui_pages に残す次の記録を使う。
  <シーン>.segs.json  区切りごとの元（"スライドの id:start" / "スライドの id:ステップの id"）
  <シーン>.deck.json  描画したスライドの情報（章・付録・目安の時間・題名・ページの見出し）と、リンクの位置
記録が無い（このアプリで描画し直す前の結果）ときは、リモコンのキーだけが働く。

- リモコン（クリッカー）: PageDown・PageUp で次へ・前へ（多くのリモコンが送るキー）、「.」で黒画面（B と同じ。ページ番号を
  打っている間は、番号の区切り「3.2」として使う）
- 付録: 本編の最後の区切りで「次へ」を押しても、付録には入らない（一覧・番号・リンクで開く）
- リンク: 押すと飛ぶ要素の上でクリックすると、そのスライドへ飛ぶ（マウスを乗せると指の形）。「戻る」のリンクで、飛ぶ前の所へ戻る
- 情報ウィンドウ: 一覧の上に「章」と「探す」（ページ番号・題名・章・ノート）、ページごとの時間（目安があれば色）、リハーサル
- リハーサル: 始めると、区切りごとに、そこに居た時間を記録し、終えると <プロジェクト>/rehearsals/ に保存する（操作アプリで比べる）
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any


def load_deck(folder: Path, scene: str, n: int) -> dict[str, Any] | None:
    """シーンの章・付録・リンクの記録。区切りの数と合わなければ None。"""
    d = folder / "gui_pages"
    try:
        keys = json.loads((d / f"{scene}.segs.json").read_text(encoding="utf-8"))
        deck = json.loads((d / f"{scene}.deck.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(keys, list) or len(keys) != n or not isinstance(deck, dict):
        return None
    slides = deck.get("slides") or []
    pos = {str(s.get("id")): i for i, s in enumerate(slides)}
    seg_slide = [pos.get(str(k).split(":", 1)[0]) for k in keys]  # 区切り → 描画したスライドの番号
    links: dict[int, list[tuple[list[float], str]]] = {}
    for si, rect, to in deck.get("links") or []:
        links.setdefault(int(si), []).append((rect, str(to)))
    first_seg = {}
    for j, k in enumerate(keys):
        sid = str(k).split(":", 1)[0]
        first_seg.setdefault(sid, j)
        first_seg.setdefault(str(k), j)  # 「スライドの id:ステップの id」でも飛べる（参照の飛ぶ先: 要素が出るクリック）
    return {"slides": slides, "keys": keys, "segSlide": seg_slide, "links": links, "firstSeg": first_seg}


def fmt(sec: float) -> str:
    sec = int(max(0, round(sec)))
    return f"{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def install_deck(app, player_cls, folder: Path, scenes: list[str]) -> None:
    from qtpy.QtCore import QEvent, QObject, Qt, QTimer
    from qtpy.QtGui import QKeyEvent
    from qtpy.QtWidgets import QComboBox, QHBoxLayout, QLabel, QLineEdit, QPushButton, QWidget

    root = folder.resolve().parent

    def decks(player) -> list[dict[str, Any] | None]:
        if not hasattr(player, "_gui_decks"):
            player._gui_decks = [load_deck(folder, scenes[k] if k < len(scenes) else "", len(pc.slides))
                                 for k, pc in enumerate(player.presentation_configs)]
        return player._gui_decks

    def cur(player) -> tuple[int, int]:
        return player.current_presentation_index, player.current_slide_index

    def slide_of(player, pi: int | None = None, si: int | None = None) -> dict[str, Any] | None:
        """区切りの、描画したスライドの情報。"""
        pi = player.current_presentation_index if pi is None else pi
        si = player.current_slide_index if si is None else si
        d = decks(player)[pi] if pi < len(decks(player)) else None
        if d is None or si >= len(d["segSlide"]) or d["segSlide"][si] is None:
            return None
        return d["slides"][d["segSlide"][si]]

    def is_appendix(player, pi: int, si: int) -> bool:
        s = slide_of(player, pi, si)
        return bool(s and s.get("appendix"))

    def say(player, text: str, sec: float = 2.0) -> None:
        ov = getattr(player, "_gui_tools", None)
        if ov is not None:
            ov.say(text, sec)

    def go(player, pi: int, si: int, remember: bool = True) -> None:
        if remember:
            player._gui_back = getattr(player, "_gui_back", []) + [cur(player)]
        player.playing_reversed_slide = False
        if player.current_presentation_index != pi:
            player.current_presentation_index = pi
        player.current_slide_index = si
        player.load_current_slide()

    # ---- 付録: 本編の最後から「次へ」で付録に入らない
    original_next_slide = player_cls.load_next_slide

    def load_next_slide(self):
        pi, si = cur(self)
        n = len(self.presentation_configs[pi].slides)
        if si + 1 < n and not is_appendix(self, pi, si) and is_appendix(self, pi, si + 1):
            say(self, "本編の最後です（付録は、一覧・番号・リンクで開けます）", 2.5)
            return None
        return original_next_slide(self)

    player_cls.load_next_slide = load_next_slide

    # ---- 見張り: 区切りを読み込んだのに、その動画のコマが届かない（1 コマだけの動画などで、まれに起きる）ときは、読み込み直す
    original_frame_changed = player_cls.frame_changed

    def frame_changed(self, frame):
        if frame.isValid() and frame.startTime() >= 0:
            self._gui_shown_file = self.current_file
        original_frame_changed(self, frame)

    player_cls.frame_changed = frame_changed
    original_load_slide = player_cls.load_current_slide

    def load_current_slide(self):
        original_load_slide(self)
        want = self.current_file
        self._gui_load_seq = getattr(self, "_gui_load_seq", 0) + 1
        seq = self._gui_load_seq

        def check(retry: int = 1) -> None:
            if getattr(self, "_gui_load_seq", 0) != seq or self.current_file != want:
                return  # もう別の区切りへ進んだ
            if getattr(self, "_gui_shown_file", None) == want:
                return
            from qtpy.QtCore import QUrl
            print(f"[manim-slide-gui] 区切りの動画のコマが届かないので、読み込み直します: {want}", file=sys.stderr)
            self.media_player.setSource(QUrl())
            self.load_current_media()
            if retry:
                QTimer.singleShot(900, lambda: check(retry - 1))

        QTimer.singleShot(800, check)

    player_cls.load_current_slide = load_current_slide

    # ---- リンク
    def link_at(player, gpos) -> tuple[list[float], str] | None:
        ov = getattr(player, "_gui_tools", None)
        d = decks(player)[player.current_presentation_index] if decks(player) else None
        if ov is None or d is None:
            return None
        si = d["segSlide"][player.current_slide_index] if player.current_slide_index < len(d["segSlide"]) else None
        if si is None:
            return None
        p = ov.to_video(gpos)
        for rect, to in d["links"].get(si, []):
            x, y, w, h = rect
            pad = 0.006
            if x - pad <= p.x() <= x + w + pad and y - pad <= p.y() <= y + h + pad:
                return rect, to
        return None

    def follow(player, to: str) -> None:
        if to == "back":
            back = getattr(player, "_gui_back", [])
            if not back:
                say(player, "戻る所がありません")
                return
            pi, si = back.pop()
            go(player, pi, si, remember=False)
            return
        for key in (to, to.split(":", 1)[0]):  # 区切り（スライド:ステップ）が無ければ、そのスライドの初め
            for pi, d in enumerate(decks(player)):
                if d and key in d["firstSeg"]:
                    go(player, pi, d["firstSeg"][key])
                    return
        say(player, "リンクの飛ぶ先のスライドが、描画結果にありません")

    # ---- キーとマウス
    class Filter(QObject):
        def eventFilter(self, obj, event):  # noqa: N802 — Qt の名前
            et = event.type()
            from qtpy.QtWidgets import QWidget as _W
            win = obj.window() if isinstance(obj, _W) else None
            if win is None or not (isinstance(win, player_cls) or type(win).__name__ == "Info"):
                return False
            player = win if isinstance(win, player_cls) else next(
                (w for w in app.topLevelWidgets() if isinstance(w, player_cls) and w.isVisible()), None)
            if player is None:
                return False
            if et == QEvent.Type.KeyPress:
                if isinstance(obj, QLineEdit):
                    return False  # 「探す」の欄に打っている
                k = event.key()
                if k == Qt.Key.Key_PageDown and not event.isAutoRepeat():
                    player.next()
                    return True
                if k == Qt.Key.Key_PageUp and not event.isAutoRepeat():
                    player.previous()
                    return True
                ov = getattr(player, "_gui_tools", None)
                # 「.」はページ番号の区切り（3.2）にも使うので、番号を打っている間は黒画面にしない
                if k == Qt.Key.Key_Period and not event.modifiers() and not (ov is not None and ov.typed):
                    app.sendEvent(obj, QKeyEvent(QEvent.Type.KeyPress, Qt.Key.Key_B, Qt.KeyboardModifier.NoModifier, "b"))
                    return True
                return False
            if not isinstance(win, player_cls):
                return False
            ov = getattr(player, "_gui_tools", None)
            busy = ov is not None and (ov.pen or ov.laser or ov.lens)
            if et == QEvent.Type.MouseMove and not busy:
                hit = link_at(player, event.globalPosition().toPoint())
                if hit and not getattr(player, "_gui_hand", False):
                    player.setCursor(Qt.CursorShape.PointingHandCursor)
                    player._gui_hand = True
                elif not hit and getattr(player, "_gui_hand", False):
                    player.unsetCursor()
                    player._gui_hand = False
                return False
            if et in (QEvent.Type.MouseButtonPress, QEvent.Type.MouseButtonRelease, QEvent.Type.MouseButtonDblClick) and not busy:
                if event.button() != Qt.MouseButton.LeftButton:
                    return False
                hit = link_at(player, event.globalPosition().toPoint())
                if hit is None:
                    return False
                if et == QEvent.Type.MouseButtonRelease:
                    follow(player, hit[1])
                return True  # リンクの上のクリックでは、次へ進まない
            return False

    flt = Filter(app)
    app.installEventFilter(flt)
    player_cls._gui_deck_filter = flt

    # ---- 情報ウィンドウ: 章・探す・ページの時間・リハーサル
    original_show = player_cls.show

    def show(self, *args, **kwargs):
        original_show(self, *args, **kwargs)
        if hasattr(self, "_gui_deck_ui"):
            return
        self._gui_deck_ui = True
        try:
            build(self)
        except Exception as e:  # noqa: BLE001 — 使えなくても、発表は続ける
            print(f"[manim-slide-gui] 章・リハーサルの欄を作れませんでした: {e}", file=sys.stderr)

    player_cls.show = show

    def build(player) -> None:
        lst = getattr(player, "_gui_page_list", None)
        box = getattr(player, "_gui_page_box", None)
        if lst is None or box is None:
            return
        positions, labels = player._gui_page_positions, player._gui_page_labels
        ds = decks(player)
        # 一覧の見出しに、章の始まりと付録の印を付ける
        texts = []
        for k, (pi, si) in enumerate(positions):
            s = slide_of(player, pi, si)
            lab = labels[pi][si]
            d = ds[pi] if pi < len(ds) else None
            first = bool(d and s and d["firstSeg"].get(str(s.get("id"))) == si)
            if s and first and s.get("appendix"):
                lab = f"【付録】{lab}"
            elif s and first and s.get("sectionStart") and s.get("section"):
                lab = f"【{s['section']}】{lab}"
            lst.item(k).setText(lab)
            tip = [lab]
            if s:
                if s.get("title"):
                    tip.append(s["title"])
                if s.get("section"):
                    tip.append(f"章: {s['section']}")
            lst.item(k).setToolTip("\n".join(tip))
            texts.append(" ".join([lab, str(s.get("page", "")) if s else "", (s or {}).get("title", ""), (s or {}).get("section", ""),
                                   (s or {}).get("notes", ""), player.presentation_configs[pi].slides[si].notes or ""]).lower())
        has_deck = any(ds)
        row = QWidget()
        row.setProperty("guiPanel", True)
        h = QHBoxLayout(row)
        h.setContentsMargins(0, 0, 0, 0)
        sec_box = QComboBox()
        sec_box.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        sec_box.addItem("すべての章", None)
        names = []
        for d in ds:
            for s in (d or {}).get("slides", []):
                if s.get("section") and s["section"] not in names and not s.get("appendix"):
                    names.append(s["section"])
        for nm in names:
            sec_box.addItem(nm, nm)
        if any(s.get("appendix") for d in ds for s in (d or {}).get("slides", [])):
            sec_box.addItem("付録", "__appendix__")
        jump_btn = QPushButton("章の初めへ")
        jump_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        find = QLineEdit()
        find.setPlaceholderText("探す（ページ番号・題名・章・ノート）")
        find.setClearButtonEnabled(True)
        h.addWidget(QLabel("章"))
        h.addWidget(sec_box)
        h.addWidget(jump_btn)
        h.addWidget(find, 1)
        if not has_deck:
            sec_box.setEnabled(False)
            jump_btn.setEnabled(False)
        box.insertWidget(box.indexOf(lst), row)

        def refilter() -> None:
            want = sec_box.currentData()
            q = find.text().strip().lower()
            for k, (pi, si) in enumerate(positions):
                s = slide_of(player, pi, si)
                ok = True
                if want == "__appendix__":
                    ok = bool(s and s.get("appendix"))
                elif want is not None:
                    ok = bool(s and s.get("section") == want and not s.get("appendix"))
                if ok and q:
                    ok = all(w in texts[k] for w in q.split())
                lst.setRowHidden(k, not ok)

        sec_box.currentIndexChanged.connect(lambda _i: refilter())
        find.textChanged.connect(lambda _t: refilter())

        def section_start() -> None:
            want = sec_box.currentData()
            for k, (pi, si) in enumerate(positions):
                s = slide_of(player, pi, si)
                if s and ((want == "__appendix__" and s.get("appendix")) or (want is not None and s.get("section") == want and not s.get("appendix"))):
                    go(player, pi, si)
                    return

        jump_btn.clicked.connect(section_start)

        def find_enter() -> None:
            for k in range(lst.count()):
                if not lst.isRowHidden(k):
                    pi, si = positions[k]
                    go(player, pi, si)
                    player.setFocus()
                    return

        find.returnPressed.connect(find_enter)

        # ページの時間・リハーサル
        row2 = QWidget()
        row2.setProperty("guiPanel", True)
        h2 = QHBoxLayout(row2)
        h2.setContentsMargins(0, 0, 0, 0)
        page_lab = QLabel()
        page_lab.setStyleSheet("font-size: 15px; font-weight: bold;")
        reh_btn = QPushButton("● リハーサルを始める")
        reh_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        reh_btn.setToolTip("ページ（区切り）ごとに、かかった時間を記録します。終えると保存し、操作アプリの「リハーサル」で比べられます")
        reh_lab = QLabel()
        h2.addWidget(page_lab, 1)
        h2.addWidget(reh_lab)
        h2.addWidget(reh_btn)
        box.insertWidget(box.indexOf(row), row2)

        st: dict[str, Any] = {"page": None, "t_page": time.time(), "reh": None}

        def page_key():
            s = slide_of(player)
            return (player.current_presentation_index, str(s.get("id")) if s else player.current_slide_index)

        def update() -> None:
            key = page_key()
            if key != st["page"]:
                st["page"], st["t_page"] = key, time.time()
            s = slide_of(player)
            e = time.time() - st["t_page"]
            target = (s or {}).get("target")
            if target:
                color = "#C62828" if e > target else "#E65100" if e > target * 0.8 else "#1B5E20"
                page_lab.setText(f"このページ {fmt(e)}  ／ 目安 {fmt(target)}")
                page_lab.setStyleSheet(f"font-size: 15px; font-weight: bold; color: {color};")
            else:
                page_lab.setText(f"このページ {fmt(e)}")
                page_lab.setStyleSheet("font-size: 15px; font-weight: bold;")
            ov = getattr(player, "_gui_tools", None)
            if ov is not None and ov.blank:  # 黒画面・白画面のままだと、ページを移っても映らないので、目立つように出す
                page_lab.setText(page_lab.text() + f"　【{'黒' if ov.blank == 'black' else '白'}画面中: {'B' if ov.blank == 'black' else 'W'} で戻る】")
                page_lab.setStyleSheet("font-size: 15px; font-weight: bold; color: #ffffff; background: #455a64; padding: 0 6px;")
            r = st["reh"]
            if r is not None:
                reh_lab.setText(f"● リハーサル中 {fmt(time.time() - r['t0'])}")
                reh_lab.setStyleSheet("color: #d32f2f; font-weight: bold;")

        timer = QTimer(row2)
        timer.timeout.connect(update)
        timer.start(250)
        update()

        # 発表の全体の目安が空なら、ページの目安の合計を入れる
        try:
            from qtpy.QtWidgets import QSpinBox
            total = sum(float(s.get("target") or 0) for d in ds for s in (d or {}).get("slides", []) if not s.get("appendix"))
            if total > 0:
                for sp in player._gui_panel[0].findChildren(QSpinBox):
                    if sp.suffix().strip() == "分" and sp.value() == 0:
                        sp.setValue(max(1, round(total / 60)))
        except Exception:  # noqa: BLE001
            pass

        def mark(_=None) -> None:
            r = st["reh"]
            if r is None:
                return
            now = time.time() - r["t0"]
            if r["segs"]:
                r["segs"][-1]["dur"] = round(now - r["segs"][-1]["t"], 2)
            pi, si = cur(player)
            d = ds[pi] if pi < len(ds) else None
            s = slide_of(player, pi, si)
            r["segs"].append({"t": round(now, 2), "dur": 0.0, "scene": pi, "seg": si,
                              "key": d["keys"][si] if d else None, "slide": (s or {}).get("id"),
                              "page": labels[pi][si] if pi < len(labels) and si < len(labels[pi]) else str(si + 1)})

        def start_reh() -> None:
            st["reh"] = {"t0": time.time(), "segs": [], "created": datetime.now().isoformat(timespec="seconds")}
            mark()
            reh_btn.setText("■ リハーサルを終えて保存")
            say(player, "● リハーサルを始めました（ページごとの時間を記録します）", 2.5)

        def stop_reh(save: bool = True) -> None:
            r = st["reh"]
            if r is None:
                return
            mark()
            r["segs"].pop()  # 終えた時刻の印
            st["reh"] = None
            reh_btn.setText("● リハーサルを始める")
            total = time.time() - r["t0"]
            reh_lab.setText(f"前回のリハーサル {fmt(total)}")
            reh_lab.setStyleSheet("")
            if not save or not r["segs"]:
                return
            pages: dict[str, dict[str, Any]] = {}
            for sg in r["segs"]:
                sid = sg.get("slide") or f"seg{sg['seg']}"
                pg = pages.setdefault(sid, {"slide": sg.get("slide"), "page": sg["page"].split("-")[0].replace("ページ ", ""), "time": 0.0})
                pg["time"] = round(pg["time"] + sg["dur"], 2)
            info = {d0.get("id"): d0 for d in ds for d0 in (d or {}).get("slides", [])}
            for sid, pg in pages.items():
                s = info.get(sid) or {}
                pg.update(title=s.get("title", ""), section=s.get("section", ""), target=s.get("target"), appendix=bool(s.get("appendix")))
            out = {"version": 1, "created": r["created"], "scene": scenes[0] if scenes else "", "total": round(total, 2),
                   "segments": r["segs"], "pages": list(pages.values())}
            try:
                dd = root / "rehearsals"
                dd.mkdir(parents=True, exist_ok=True)
                name = f"{scenes[0] if scenes else 'Deck'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                (dd / name).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
                say(player, f"リハーサルを保存しました（{fmt(total)}）。操作アプリの「リハーサル」で比べられます", 3.5)
            except OSError as e:
                say(player, f"リハーサルを保存できませんでした: {e}", 4)

        reh_btn.clicked.connect(lambda: stop_reh() if st["reh"] is not None else start_reh())
        player.slide_changed.connect(mark)
        player.presentation_changed.connect(mark)
        player._gui_stop_rehearsal = stop_reh

    original_close = player_cls.close

    def close(self):
        fn = getattr(self, "_gui_stop_rehearsal", None)
        if fn is not None:
            fn(True)
        original_close(self)

    player_cls.close = close
