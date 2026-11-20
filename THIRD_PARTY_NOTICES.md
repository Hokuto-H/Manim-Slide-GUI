# 使っている部品とライセンス

Manim Slide GUI は、Manim Community・Manim Slides を使って作った非公式のツールです（それぞれの開発者とは関係がありません）。
アプリ内のヘルプの「このアプリについて・ライセンス」と同じ内容です。

## アプリに同梱しているもの

アプリのファイルの中に、変更せずに入れています。ライセンスの全文は、アプリのフォルダの `static/vendor` の中の `LICENSE` にあります。

| 部品 | 使い道 | ライセンス |
| --- | --- | --- |
| Fabric.js 7.4.0 | 編集画面のキャンバス | MIT |
| MathJax 4.1.3 | キャンバスの数式の仮の表示 | Apache License 2.0 |
| MathJax New Computer Modern フォント 4.1.3 | 仮の表示の数式の字形 | Apache License 2.0 |

## 入れるときに取得するもの

インストーラーが、入れるときに、それぞれの配布元から取得します（このアプリには含めていません）。

| 部品 | 使い道 | ライセンス |
| --- | --- | --- |
| Manim（Community 版）0.20.1 | アニメーションの描画 | MIT |
| Manim Slides 5.7.0 | 発表ウィンドウ・HTML などへの出力 | MIT |
| ManimPango | 文字の描画 | MIT |
| Python 3.13 | アプリが動く土台 | PSF License |
| Qt for Python（PySide6）・Qt 6 | 発表ウィンドウ・動画の再生 | LGPL v3 |
| Cairo・Pango（pycairo） | 図形・文字の描画 | LGPL v2.1 / MPL 1.1 |
| FFmpeg（PyAV 経由） | 動画の読み書き | LGPL / GPL（配布元のビルドによる） |
| PyAV | 動画の読み書き | BSD 3-Clause |
| NumPy・SciPy・NetworkX | 計算・グラフの配置 | BSD 3-Clause など |
| Pillow | 画像の読み込み | MIT-CMU |
| FastAPI・Starlette・Uvicorn・Pydantic | 編集画面とアプリの間のやり取り | MIT / BSD 3-Clause |
| python-pptx | PowerPoint への出力 | MIT |
| pypdf | PDF のリンク | BSD 3-Clause |
| ReportLab | 配布資料（PDF） | BSD |
| micromamba | 部品を入れる道具 | BSD 3-Clause |
| Noto Sans JP・Noto Serif JP | 既定のフォント | SIL Open Font License 1.1 |
| TeX Live（XeLaTeX・dvisvgm・IPAex フォントなど） | 数式の組版 | 各パッケージのフリーなライセンス |

フォントの「SIL Open Font License」は、フォントを文書・スライド・動画に使うことも、作った PDF などに埋め込んで配ることも認めています。

## HTML に出力するときに取得するもの

ファイルに出力で **HTML** を初めて選んだときだけ、Manim Slides が、ブラウザで発表するための部品 **reveal.js**（MIT ライセンス）を取得します（取得の前に確かめる画面が出ます）。出力した HTML には、この部品が入ります。
