---
title: このアプリについて・ライセンス
group: そのほか
order: 80
keywords: ライセンス 著作権 バージョン 版 非公式 Manim Manim Slides 引用 オープンソース MIT LGPL OFL
summary: アプリの版、非公式のツールであること、使っている部品とそのライセンス。
---
## このアプリについて {#about}

- 名前: Manim Slide GUI
- 版: {{version}}

このアプリは、数学のアニメーションを作る Python のライブラリ **Manim**（Community 版）と、Manim のアニメーションをスライドとして発表する **Manim Slides** を使って作った、**非公式のツール**です。
Manim Community・Manim Slides の開発者とは関係がありません。このアプリについての問い合わせは、Manim・Manim Slides の開発元ではなく、このアプリの作者（配布しているレポジトリ）へお願いします。

> **注意** Manim には、Grant Sanderson さん（3Blue1Brown）が作った元の版（ManimGL）と、そこから分かれてコミュニティが開発している **Community 版**があります。このアプリが使うのは Community 版です。

## このアプリのライセンス {#license}

このアプリは **MIT License** で公開しています。個人で自由に使い・直し・配ってかまいません（商用も含みます）。
直したものを配るときは、ライセンスの著作権表示（アプリのフォルダの `LICENSE`）を残してください。元のレポジトリへのリンクも書いていただけると嬉しいです（お願いで、義務ではありません）。

> **注意** MIT License のとおり、このアプリは「現状のまま」提供され、使ったことで生じた損害について、作者は責任を負いません。

## Manim と Manim Slides を引用する {#cite}

Manim の開発者は、Manim を使って作った作品の中で、Manim を引用（紹介）することをお願いしています。義務ではありませんが、発表や資料の最後などに、次のように書いておくと丁寧です。

- [Manim Community](https://www.manim.community/)
- [Manim Slides](https://github.com/jeertmans/manim-slides)

## 使っている部品とライセンス {#licenses}

このアプリは、次のオープンソースの部品を使っています。どれも、利用・発表・配布に使うことを認めているライセンスです。

### アプリに同梱しているもの {#bundled}

アプリのファイルの中に、変更せずに入れています。ライセンスの全文は、アプリのフォルダの `static/vendor` の中の `LICENSE` にあります。

| 部品 | 使い道 | ライセンス |
| --- | --- | --- |
| Fabric.js 7.4.0 | 編集画面のキャンバス | MIT |
| MathJax 4.1.3 | キャンバスの数式の仮の表示 | Apache License 2.0 |
| MathJax New Computer Modern フォント 4.1.3 | 仮の表示の数式の字形 | Apache License 2.0 |

### 入れるときに取得するもの {#downloaded}

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

> **ヒント** フォントの「SIL Open Font License」は、フォントを文書・スライド・動画に使うことも、作った PDF などに埋め込んで配ることも認めています。

### HTML に出力するときに取得するもの {#revealjs}

ファイルに出力で **HTML** を初めて選んだときだけ、Manim Slides が、ブラウザで発表するための部品 **reveal.js**（MIT ライセンス）を取得します（取得の前に確かめる画面が出ます）。出力した HTML には、この部品が入ります。

## 作ったスライドの扱い {#yours}

このアプリで作ったスライド・動画・出力したファイルは、作った方のものです。上の部品のライセンスは、それらの使い道（授業・発表・公開・販売など）を制限しません。
ただし、スライドに入れた画像・動画・音声・フォントは、それぞれの権利者の条件に従ってください（[プロジェクトのフォント](help:text#fonts)も参照）。
