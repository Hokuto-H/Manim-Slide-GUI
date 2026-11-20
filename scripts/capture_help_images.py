"""ヘルプ・説明書の画面の画像（docs/help/img/*.png）を撮る（開発用）。

使い方（アプリを起動しておき、Playwright の Chromium を入れておく）:
    python run.py --port 8950 --no-browser
    python scripts/capture_help_images.py --url http://127.0.0.1:8950/ --work 作業用のフォルダ

作業用のフォルダに見本のプロジェクトを作り、題名・数式・「出す」ステップを置いて撮る。既存のプロジェクトは使わない。
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "help" / "img"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8950/")
    ap.add_argument("--work", required=True, help="見本のプロジェクトを作るフォルダ")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    name = f"見本{int(time.time()) % 100000}"
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1600, "height": 960}, device_scale_factor=1)
        pg.goto(a.url)
        pg.wait_for_timeout(2500)
        pg.evaluate("""async ([parent, name]) => { const api = (await import('/static/js/api.js')).api;
          const payload = await api.post('/api/project/new', {parent, settings: {name}, preamble: ''});
          (await import('/static/js/store.js')).emit('load-project', payload); }""", [str(work), name])
        pg.wait_for_timeout(2500)
        # 題名
        pg.click('button[data-action="add-text"]')
        pg.wait_for_timeout(1500)
        pg.click("#props .rt-area")
        pg.keyboard.press("Control+A")
        pg.keyboard.type("三平方の定理")
        pg.wait_for_timeout(800)
        pg.evaluate("""async () => { const S = await import('/static/js/store.js'); const C = await import('/static/js/canvas.js');
          const el = S.currentSlide().elements[0]; el.y = 200; S.markDirty('move'); await C.refreshElement(el); }""")
        # 数式と「出す」
        pg.click('button[data-action="add-math"]')
        pg.wait_for_timeout(1500)
        pg.fill("#props textarea.latex", "a^2 + b^2 = c^2")
        pg.dispatch_event("#props textarea.latex", "input")
        pg.wait_for_timeout(1500)
        pg.click('#props .gui-steps button[data-g="in"]:not([data-into])')
        pg.wait_for_timeout(5000)  # お知らせが消えるまで
        pg.screenshot(path=str(OUT / "screen.png"))
        # 動きの欄
        box = pg.locator("#step-order").bounding_box()
        pg.screenshot(path=str(OUT / "anim.png"), clip=box)
        # 図形メニュー
        pg.click("#btn-add-shape")
        pg.wait_for_timeout(800)
        menu = pg.locator(".shape-menu").bounding_box()
        pg.screenshot(path=str(OUT / "shapemenu.png"), clip=menu)
        pg.keyboard.press("Escape")
        pg.mouse.click(5, 880)
        pg.wait_for_timeout(300)
        # 試し描画の小窓
        pg.click('button[data-action="preview-slide"]')
        for _ in range(120):
            pg.wait_for_timeout(1000)
            if pg.evaluate("async () => ((await import('/static/js/slideplayer.js')).playerState()?.count ?? 0) > 0"):
                break
        pg.click('.slide-player [data-a="next"]')
        pg.wait_for_timeout(3000)
        win = pg.locator(".slide-player").bounding_box()
        pg.screenshot(path=str(OUT / "player.png"), clip=win)
        b.close()
    print("撮りました:", ", ".join(sorted(f.name for f in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
