"""発表ウィンドウ（manim-slides present）を、操作しやすくして起動する。

manim-slides 5.7.0 の発表ウィンドウに、次のものを足してから、通常の `manim-slides present` をそのまま実行する。
キーボード操作はこれまでどおり使える。

1. マウス操作（Qt のアプリ全体にイベントフィルターを入れる）
       左クリック: 次へ（→ キーと同じ）
       右クリック: 前へ（← キーと同じ）
2. 発表ウィンドウの開き方（引数 --gui-window。manim-slides には渡さない）
       maximized : 最大化して開く（既定）
       fullscreen: フルスクリーンで開く（manim-slides の --full-screen と同じ）
       normal    : manim-slides の既定の大きさ（動画の解像度）で開く
   どの場合も、発表中に F キーでフルスクリーンの切り替えができる。
3. 発表者用の情報ウィンドウ（manim-slides の Info）の下に、操作欄と全ページの一覧
       - フルスクリーンの切り替えボタンと、キー操作の説明（F キーなど）
       - 各スライドの最後の画面の縮小画像を並べた一覧。押すと、発表ウィンドウと情報ウィンドウの両方がそのページへ移る
   一覧の「ページ・クリック」番号は、描画のときに書き出した .py が slides/gui_pages/<シーン名>.json に保存する
   （引数 --gui-scene でシーン名を指定。無ければ通し番号で表示する）。

4. 発表の録画（present_record.py。Ctrl+R で始める・一時停止、Ctrl+Shift+R で終える。引数 --gui-record に設定の JSON）

使い方: python present_runner.py [--gui-window maximized] [--gui-scene Deck] [--gui-record rec.json] present --folder slides Deck
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

WINDOW_MODES = ("maximized", "fullscreen", "normal")
THUMB_W = 192  # 一覧の縮小画像の幅（px）


def install_click_navigation(app, player_cls) -> object:
    """クリックで発表を進めるイベントフィルターを app に入れ、そのフィルターを返す。"""
    from qtpy.QtCore import QEvent, QObject, Qt
    from qtpy.QtWidgets import QWidget

    def find_player():
        for w in app.topLevelWidgets():
            if isinstance(w, player_cls) and w.isVisible():
                return w
        return None

    class ClickNavigation(QObject):
        def eventFilter(self, obj, event):  # noqa: N802 — Qt の名前
            if event.type() != QEvent.Type.MouseButtonPress:
                return False
            # ウィジェットに届いたものだけを扱う（ウィンドウ側にも同じクリックが届くため、二重に進めない）
            if not isinstance(obj, QWidget):
                return False
            # 情報ウィンドウに足した操作欄（ボタン・一覧）のクリックは、そのまま各部品に渡す
            w = obj
            while w is not None:
                if w.property("guiPanel"):
                    return False
                w = w.parentWidget()
            win = obj.window()
            player = win if isinstance(win, player_cls) else None
            if player is None:
                # 発表者用の情報ウィンドウ（画面が2つあるとき）でのクリックも、発表を進める
                if type(win).__name__ != "Info":
                    return False
                player = find_player()
                if player is None:
                    return False
            tools = getattr(player, "_gui_tools", None)
            if tools is not None and tools.pen:
                return False  # ペンで書いている間は、クリックで進めない（書く方に渡す）
            button = event.button()
            if button == Qt.MouseButton.LeftButton:
                player.next()
                return True
            if button == Qt.MouseButton.RightButton:
                player.previous()
                return True
            return False

    flt = ClickNavigation(app)
    app.installEventFilter(flt)
    return flt


def split_gui_args(argv: list[str]) -> tuple[str, list[str], list[str]]:
    """引数から --gui-window・--gui-scene を取り出し、(開き方, シーン名, manim-slides に渡す残りの引数) を返す。"""
    mode = "maximized"
    scenes: list[str] = []
    rest: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        for name in ("--gui-window", "--gui-scene"):
            if a == name and i + 1 < len(argv):
                val, step = argv[i + 1], 2
                break
            if a.startswith(name + "="):
                val, step = a.split("=", 1)[1], 1
                break
        else:
            rest.append(a)
            i += 1
            continue
        if name == "--gui-window":
            mode = val
        else:
            scenes.append(val)
        i += step
    if mode not in WINDOW_MODES:
        mode = "maximized"
    if mode == "fullscreen" and "present" in rest and not ({"-F", "--full-screen", "--fullscreen"} & set(rest)):
        rest.insert(rest.index("present") + 1, "--full-screen")
    return mode, scenes, rest


def split_window_mode(argv: list[str]) -> tuple[str, list[str]]:
    """（互換用）--gui-window だけを取り出す。"""
    mode, _scenes, rest = split_gui_args(argv)
    return mode, rest


def install_maximize(player_cls) -> None:
    """発表ウィンドウを表示するときに最大化する（フルスクリーン指定のときはそのまま）。"""
    original_show = player_cls.show

    def show(self, *args, **kwargs):
        original_show(self, *args, **kwargs)
        if not self.isFullScreen():
            self.showMaximized()
            # 情報ウィンドウが別の画面にあれば、そちらも最大化する（同じ画面なら、発表ウィンドウを隠さないようにそのまま）
            info = getattr(self, "info", None)
            if info is not None and info.isVisible() and info.screen() != self.screen():
                info.showMaximized()

    player_cls.show = show


# ---------------------------------------------------------------- 全ページの一覧

def page_labels(folder: Path, scenes: list[str], counts: list[int]) -> list[list[str]]:
    """各シーンの各スライドの見出し（「ページ 2」「2-1」など）。番号の記録が無い・合わないときは通し番号。"""
    out: list[list[str]] = []
    for k, n in enumerate(counts):
        labels: list[str] | None = None
        if k < len(scenes):
            f = folder / "gui_pages" / f"{scenes[k]}.json"
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(data, list) and len(data) == n:
                    labels = [f"ページ {p}" if c == 0 else f"{p}-{c}" for p, c in data]
            except (OSError, ValueError, TypeError):
                labels = None
        if labels is None:
            labels = [str(i + 1) for i in range(n)]
        if len(counts) > 1:
            labels = [f"[{k + 1}] {s}" for s in labels]
        out.append(labels)
    return out


def last_frame_thumbnail(src: Path, dest: Path, width: int = THUMB_W) -> bool:
    """動画（または画像）の最後の画面を縮小して PNG に保存する。作れたら True。"""
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        if src.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".bmp"):
            img = Image.open(src).convert("RGB")
        else:
            import av

            img = None
            with av.open(str(src)) as c:
                s = c.streams.video[0]
                if s.duration and s.time_base:
                    # 最後の1秒の手前のキーフレームから読む（短い動画は先頭から）
                    target = max(0, int(s.duration - 1 / s.time_base))
                    try:
                        c.seek(target, stream=s, backward=True)
                    except av.error.FFmpegError:
                        c.seek(0)
                for frame in c.decode(s):
                    img = frame.to_image()
            if img is None:
                return False
        h = max(1, round(img.height * width / img.width))
        img = img.resize((width, h), Image.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp.png")
        img.save(tmp)
        tmp.replace(dest)
        return True
    except Exception:  # noqa: BLE001 — 縮小画像が作れなくても、発表は続ける
        return False


def install_page_panel(player_cls, folder: Path, scenes: list[str]) -> None:
    """情報ウィンドウ（Info）の下に、操作欄と全ページの一覧を足す（Player の表示のときに組み立てる）。"""
    from qtpy.QtCore import QObject, QSize, Qt, QTimer, Signal
    from qtpy.QtGui import QColor, QIcon, QPixmap
    from qtpy.QtWidgets import (QFrame, QHBoxLayout, QLabel, QListView, QListWidget, QListWidgetItem, QPushButton, QScrollArea,
                                QVBoxLayout, QWidget)

    class ThumbSignal(QObject):
        ready = Signal(int, str)  # (一覧の位置, 画像のパス)

    original_show = player_cls.show

    def build(player) -> None:
        info = player.info
        configs = player.presentation_configs
        counts = [len(pc.slides) for pc in configs]
        labels = page_labels(folder, scenes, counts)
        positions = [(pi, si) for pi, n in enumerate(counts) for si in range(n)]

        panel = QWidget()
        panel.setProperty("guiPanel", True)  # クリックで発表を進める処理から外す
        v = QVBoxLayout(panel)
        v.setContentsMargins(0, 8, 0, 0)

        bar = QHBoxLayout()
        fs_btn = QPushButton()
        fs_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # ←→ などのキー操作を、発表の操作のままにする
        fs_btn.clicked.connect(player.full_screen)
        bar.addWidget(fs_btn)
        hint = QLabel("F: フルスクリーン切り替え ／ → または左クリック: 次へ ／ ← または右クリック: 前へ ／ "
                      "Space: 一時停止 ／ R: もう一度再生 ／ Ctrl+R: 録画 ／ Q: 終了 ／ 下の一覧を押すと、そのページへ移動")
        hint.setWordWrap(True)
        bar.addWidget(hint, 1)
        v.addLayout(bar)

        lst = QListWidget()
        lst.setViewMode(QListView.ViewMode.IconMode)
        lst.setFlow(QListView.Flow.LeftToRight)
        lst.setWrapping(True)
        lst.setResizeMode(QListView.ResizeMode.Adjust)
        lst.setMovement(QListView.Movement.Static)
        lst.setIconSize(QSize(THUMB_W, round(THUMB_W * 9 / 16)))
        lst.setGridSize(QSize(THUMB_W + 16, round(THUMB_W * 9 / 16) + 34))
        lst.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        lst.setMinimumHeight(round(THUMB_W * 9 / 16) + 50)
        blank = QPixmap(THUMB_W, round(THUMB_W * 9 / 16))
        blank.fill(QColor("#888888"))
        for k, (pi, si) in enumerate(positions):
            item = QListWidgetItem(QIcon(blank), labels[pi][si])
            item.setData(Qt.ItemDataRole.UserRole, k)
            lst.addItem(item)
        v.addWidget(lst, 1)
        # 章・付録・検索（present_deck.py）が使う
        player._gui_page_list, player._gui_page_positions, player._gui_page_labels = lst, positions, labels
        player._gui_page_box = v

        # 発表者ノート: 一覧の下に、今のページのノートを出し続ける（スライドのノートは、そのスライドのどの区切りでも同じものが入る）。
        # manim-slides がもともと出すノート（「次のスライド」の下の狭い欄）は隠す
        try:
            info.slide_notes.hide()
            info.slide_notes.setMaximumHeight(0)
        except AttributeError:
            pass
        notes_head = QLabel()
        notes_head.setStyleSheet("font-weight: bold; margin-top: 6px;")
        v.addWidget(notes_head)
        notes = QLabel()
        notes.setWordWrap(True)
        notes.setTextFormat(Qt.TextFormat.MarkdownText)
        notes.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        notes.setStyleSheet("font-size: 16px; padding: 6px;")
        notes.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
        scroll = QScrollArea()
        scroll.setWidget(notes)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.StyledPanel)
        scroll.setMinimumHeight(140)
        scroll.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        v.addWidget(scroll, 1)
        info.layout().addWidget(panel, 1)

        def show_notes() -> None:
            pi, si = player.current_presentation_index, player.current_slide_index
            try:
                text = (configs[pi].slides[si].notes or "").strip()
                label = labels[pi][si]
            except IndexError:
                text, label = "", ""
            notes_head.setText(f"発表者ノート（{label}）" if label else "発表者ノート")
            notes.setText(text or "（ノートはありません）")
            notes.setEnabled(bool(text))

        player.slide_changed.connect(show_notes)
        player.presentation_changed.connect(show_notes)
        show_notes()

        def jump(item) -> None:
            pi, si = positions[item.data(Qt.ItemDataRole.UserRole)]
            player.playing_reversed_slide = False
            if player.current_presentation_index != pi:
                player.current_presentation_index = pi
            player.current_slide_index = si
            player.load_current_slide()

        lst.itemClicked.connect(jump)

        def mark_current() -> None:
            try:
                k = positions.index((player.current_presentation_index, player.current_slide_index))
            except ValueError:
                return
            lst.setCurrentRow(k)
            lst.scrollToItem(lst.item(k))

        player.slide_changed.connect(mark_current)
        player.presentation_changed.connect(mark_current)
        mark_current()

        def update_fs_text() -> None:
            fs_btn.setText("フルスクリーンを解除（F）" if player.isFullScreen() else "フルスクリーンにする（F）")

        update_fs_text()
        timer = QTimer(panel)
        timer.timeout.connect(update_fs_text)
        timer.start(300)

        # 縮小画像は裏で作り、できたものから一覧に入れる（作ったものは slides/gui_pages/thumbs に残し、次回から使う）
        sig = ThumbSignal(panel)

        def set_icon(k: int, path: str) -> None:
            pm = QPixmap(path)
            if not pm.isNull():
                lst.item(k).setIcon(QIcon(pm))

        sig.ready.connect(set_icon)
        files = [Path(configs[pi].slides[si].file) for pi, si in positions]

        def work() -> None:
            for k, src in enumerate(files):
                if not src.is_absolute():
                    src = Path.cwd() / src
                dest = folder / "gui_pages" / "thumbs" / f"{src.stem}_{THUMB_W}.png"
                if dest.exists() or last_frame_thumbnail(src, dest):
                    sig.ready.emit(k, str(dest))

        threading.Thread(target=work, daemon=True).start()
        player._gui_panel = (panel, lst, sig, timer, notes, scroll)  # 部品が先に消えないように持っておく

    def show(self, *args, **kwargs):
        if not hasattr(self, "_gui_panel"):
            try:
                build(self)
            except Exception as e:  # noqa: BLE001 — 一覧が作れなくても、発表は続ける
                print(f"[manim-slide-gui] 一覧を作れませんでした: {e}", file=sys.stderr)
        original_show(self, *args, **kwargs)

    player_cls.show = show


def pop_arg(argv: list[str], name: str) -> tuple[str | None, list[str]]:
    """argv から「name 値」（または name=値）を取り出す。"""
    out, val, i = [], None, 0
    while i < len(argv):
        a = argv[i]
        if a == name and i + 1 < len(argv):
            val, i = argv[i + 1], i + 2
            continue
        if a.startswith(name + "="):
            val = a.split("=", 1)[1]
        else:
            out.append(a)
        i += 1
    return val, out


def main() -> int:
    record_cfg, argv = pop_arg(sys.argv[1:], "--gui-record")  # 録画の設定（JSON のパス）
    mode, scenes, args = split_gui_args(argv)
    from manim_slides.__main__ import cli
    from manim_slides.present.player import Player
    from manim_slides.qt_utils import qapp

    folder = Path("slides")
    if "--folder" in args and args.index("--folder") + 1 < len(args):
        folder = Path(args[args.index("--folder") + 1])

    app = qapp()  # present() は既存の QApplication を使うので、先に作ってフィルターを入れておく
    install_click_navigation(app, Player)
    install_page_panel(Player, folder, scenes)
    from present_media import install_media  # noqa: PLC0415 — 同じフォルダのモジュール
    install_media(Player, folder, scenes)  # 動画・音声（発表で再生）を、Manim の映像に重ねて再生する
    from present_tools import install_tools  # noqa: PLC0415
    install_tools(app, Player, folder, scenes)  # レーザーポインター・ペン・黒白画面・拡大鏡・ページ番号で飛ぶ・タイマー
    from present_record import install_record  # noqa: PLC0415
    install_record(app, Player, folder, scenes, record_cfg)  # 発表の録画（Ctrl+R）
    from present_deck import install_deck  # noqa: PLC0415
    install_deck(app, Player, folder, scenes)  # リモコン・章・付録・リンク・ページの目安・リハーサル
    if mode == "maximized":
        install_maximize(Player)  # 一覧を足したあとの show をさらに包む（最大化は表示の直後）
    return cli.main(args=args, prog_name="manim-slides", standalone_mode=True)


if __name__ == "__main__":
    sys.exit(main())
