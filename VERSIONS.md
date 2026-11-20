# 確認した版の記録

確認日: 2026-10-28

## 固定する版

| 種類 | ライブラリ | 版 | 入手元 |
| --- | --- | --- | --- |
| Python | CPython | 3.13.x（確認時 3.13.18） | conda-forge |
| 描画 | Manim Community | **0.20.1** | conda-forge |
| 発表 | Manim Slides | 5.7.0 | PyPI（conda 環境の中で pip） |
| 発表ウィンドウ | PySide6 | conda-forge の最新（確認時 6.11.2） | conda-forge |
| 発表ウィンドウ | qt6-multimedia | PySide6 と同じ版（確認時 6.11.2） | conda-forge |
| 画像 | Pillow | **13 未満**（確認時 12.3.0） | conda-forge |
| サーバー | FastAPI（fastapi-core） | 0.162.0 | conda-forge |
| サーバー | uvicorn | 0.54.0 | conda-forge |
| キャンバス | Fabric.js | 7.4.0 | npm（static/vendor に同梱） |
| 数式の仮表示 | MathJax | 4.1.3 | npm（static/vendor に同梱） |
| 数式の仮表示 | @mathjax/mathjax-newcm-font | 4.1.3 | npm（static/vendor に同梱） |

## 確認の経緯と、わかったこと

- **manim 0.22.1 は使えない**: 確認時点の最新安定版は manim 0.22.1 だが、manim 0.22 で設定項目
  `write_to_movie` が削除された。manim-slides 5.7.0（2026-09-14 公開）はこの項目を使うため、描画の開始時に
  `AttributeError: type object 'ManimConfig' has no attribute 'write_to_movie'` で失敗する。manim-slides の
  開発版（main ブランチ）でも未修正だったため、0.22 より前の版に固定する。
- **conda-forge に 0.21.0 は無い**: PyPI には 0.21.0 があるが、conda-forge は 0.20.1 の次が 0.22.0 で、
  0.21.0 は収録されていない（conda-forge の索引で確認）。pip との混在を避けるため、conda-forge にある
  **manim 0.20.1** に固定した。0.20.1 でも、日本語の数式、背景色、クリック区切り、エラー位置の表示（F17）まで
  動くことを確認した（0.21.0 でも同じ結果）。
  manim-slides が 0.22 系に対応した版を出したら、両方を上げて動作確認する。
- **Pillow 13 は使えない**: Pillow 13.0.0（2026-10-15 公開）で、`Image.fromarray` の `mode` 引数によるデータ型の変換が
  削除された（12 系では非推奨の警告だけ）。manim 0.20.1 の Cairo の描画は、画像（ImageMobject）を描くたびに
  `Image.fromarray(np.zeros(...), mode="RGBA")` を呼ぶため、`ValueError: Invalid mode for data type` で失敗する
  （利用者の Windows 環境で発生し、Pillow 13 を入れて再現した）。environment.yml で `pillow<13` に固定し、環境チェックにも加えた。
- **アニメーションの途中のエラーで描画が終わらない**: manim 0.20.1 では、`self.play(...)` の途中（コマを描いている間）で例外が
  起きると、エラーは表示されるが、動画を書き出すスレッド（`SceneFileWriter.listen_and_write`）が次のコマを待ち続け、
  Python の終了処理がそのスレッドを待って止まる。GUI では「描画中」のまま秒数だけ進んだ（Pillow 13 のエラーで利用者の環境で
  発生。アニメーションの途中で例外を出すステップで再現）。`render_runner.py` は結果を保存したあと `os._exit` で終了し、
  サーバー側も、結果を書いたのに 15 秒たっても終わらない描画のプロセスを止める。
- **qt6-multimedia が別に必要**: manim-slides present は QtMultimedia で動画を再生する。conda-forge の pyside6 は
  qt6-main だけに依存し、QtMultimedia の DLL は qt6-multimedia に分かれているため、入れないと Windows で
  `ImportError: DLL load failed while importing QtMultimedia` になる（利用者の Windows 環境で発生）。
  environment.yml に加え、環境チェックでも QtMultimedia を読み込めるかを確認する。
- **発表ウィンドウはクリックに対応していない**: manim-slides 5.7.0 の発表ウィンドウはキーボード操作だけに
  対応している。アプリから発表するときは `app/present_runner.py` を経由し、Qt のイベントフィルターで
  左クリックを「次へ」、右クリックを「前へ」に割り当ててから、通常の `manim-slides present` を実行する。
- **背景色は ManimColor で渡す**: `self.camera.background_color = "#FFFFFF"`（文字列）のままだと、
  manim-slides の保存時に `'str' object has no attribute 'to_hex'` で失敗する。書き出しでは
  `ManimColor("#FFFFFF")` を使う。
- **dvisvgm が必要**: Manim は XeLaTeX の出力（.xdv）を dvisvgm で SVG に変換する。TeX Live に含まれるが、
  環境チェックの必須項目に加えた。
- **アニメーションの無い区間**: manim-slides 5.7.0 は、アニメーションが1つも無い区間をスライドとして残さない。
  書き出す `.py` では `next_slide()` を上書きし、区間が空なら `self.wait(0.1)` を自動で入れる。
- **`manim-slides render` の中身**: `python -m manim render ...` を呼ぶだけ。アプリは同じ処理を
  `app/render_runner.py` の中で行い、例外のトレースバックを JSON に保存してエラー位置の特定（F17）に使う。
- **MathJax 4**: フォントを `static/vendor/mathjax-fonts` から読み、メニュー・読み上げなどの補助機能を
  無効にすることで、外部への通信が起きないことをブラウザで確認した。共通プリアンブルのマクロは、
  `MathJax.config.tex.macros` を書き換えて `MathJax.startup.getComponents()` で反映する。
- **文字サイズの表示倍率**（manim 0.20.1 で実測、1080p）: Text は 1 文字の送り幅（1em）が font_size 1 あたり
  1.875px、行の間隔は 0.975em、複数行は左寄せ（Noto・IPAex の各フォントで同じ値）。MathTex は 1.40px
  （`app/constants.py`）。最初は 2 文字の字面の幅から 1.81 と見積もっていたが、文字の左右の余白を含まず小さすぎた
  ため、10 文字と 20 文字の幅の差から求め直した。

## テキストの書式・配置・効果（gui_text）について

- Manim の `MarkupText`（Pango のマークアップ）で、色・太字・斜体・下線・取り消し線・マーカーは描ける。
  一方、`fgalpha`（透明度）は無視され、配置（中央・右・両端揃え）の指定は `MarkupText` に無い。
  縦書きも、Pango の `gravity` だけでは句読点の位置が横書きのままで、`font_features="vert"` も効かなかった。
- そこで `app/textkit.py` の `gui_text` で次のように組み立てる。
  - 行ごとに `MarkupText` を作り、行頭・行末に目印の色の全角ブロック（█、ちょうど 1em 四方）を置いて、
    行の範囲と高さを正確に測ってから取り除く。これで配置・行間隔をそろえる。
  - 透明度は、半透明の区間に一時的な目印の色を付け、組み立てたあとで本当の色と透明度に置き換える。
  - 文字間隔は Pango の `letter_spacing`（20480 単位 = Manim の 1 単位。文字の大きさによらない）。
  - 両端揃えは、行の文字を均等にずらし、下線などは伸ばす。マーカーの帯は z_index で文字の後ろに描く。
  - 縦書きは 1 文字ずつ並べ、句読点・括弧は Unicode の縦書き用の字形に置き換え、長音記号は 90° 回し、
    半角の英数字は横に倒す。下線は右側の傍線、取り消し線は縦線にする。
  - 縁取り・中抜きは線の太さと塗りを変える。背景ボックスは角丸の長方形。
  - 円弧は、曲げる前の文字の長さを基準に、点を増やしてから曲げる。縦書きは列の向き（上から下）に沿って曲げる。
    背景ボックスは、曲げる前の文字の周りに置いてから文字と一緒に曲げるので、円弧に沿った形になる。
- テキストのプレビューは、常駐させた Manim のプロセスが同じ `gui_text` で形を作り、ベジェ曲線をそのまま
  SVG にして返す（1 回 40〜130ms）。実描画と同じ形になることを、同じ内容の描画結果と並べて確認した。

## レイヤー（重なり順）について

- Manim は、アニメーション中の物も含めて z_index の順に描く（背面の物を FadeIn・移動させている最中も、
  手前の物の後ろに描かれることを、描画結果のフレームで確認した）。
- 書き出しでは、要素の並び順（最背面 = -要素数 〜 最前面 = -1）を z_index にする。テキストの中で文字をマーカーの
  帯より手前に描く分（+0.5）は、同じ要素の中だけに収まるので、ほかの要素との順番を崩さない。

## 複数選択とグループについて

- キャンバスの複数選択は Fabric.js の ActiveSelection を使う。選択の中の要素の位置は、選択の座標系ではなく
  キャンバス上の中心（`getCenterPoint()`）で保存する。
- グループの要素を押してそのままドラッグしたとき、Fabric は押した要素だけを動かす準備をするため、選択を
  グループ全体に置き換えた直後に、選択全体を動かす準備をやり直している。
- 書き出しでは、各要素を作って重なり順を付けたあとに `group1 = VGroup(...)` を作る。VGroup を作っても
  画面には加わらないので、中の要素の「スライド開始時に表示」はそのまま効き、`FadeIn(group1)` などで
  グループごと出せる（描画結果のフレームで確認）。

## 画像（ImageMobject）について

- ImageMobject の既定の大きさは、画像の高さ（画素）÷ 1080 × 8（Manim の単位）。つまり 1080p では 1 画素がそのまま
  1 画素で表示され、キャンバス（1920×1080）の 1px と一致する。書き出しでは `scale_to_fit_width` で幅を決める。
- `set_opacity` は元の透明度に掛け合わせる（透明な部分は透明のまま）。一方 `set_color`（`Indicate` などが使う）は
  画素の色をすべて塗り替えるため、画像には向かない。既定のステップのコードでは `Circumscribe` を使う。
- Pillow は JPEG の回転情報（EXIF の Orientation）を反映しないが、ブラウザは反映する。取り込むときに画素を回して
  保存し、プレビューと描画の向きをそろえる。アニメーション GIF / WebP は、Manim が最初のコマだけを使うので PNG にする。
- **描画の速さ**: manim 0.20.1 の Cairo の描画は、画像が動く間、1 コマごとに元の画像全体を透視変換（バイキュービック）して
  画面に重ねる。1200 万画素の写真では、1080p60 で 1 秒の動きに約 30 秒かかった。書き出す `gui_image` で、描画の解像度で
  必要な大きさ（1.5 倍の余裕）まで先に縮めるようにし、同じ内容のデッキ（写真の FadeIn・移動・縮小・FadeOut と、テキストの
  スライド）の描画が 116 秒から 37 秒（manim-slides の保存を含む）になった。シーンのキャッシュ（ハッシュ）は原因ではなかった
  （大きな配列は切り詰めてハッシュされる。キャッシュの有無で描画時間はほぼ同じ）。
- 描画の進み具合は、`render_runner.py` が Manim の `Scene.play_internal`・`update_to_time` と manim-slides の
  `next_slide`・`_save_slides` を包んで、クリックの区切りと動きの進みを出力する（全体の割合は区切りの数からの目安）。
- 重なり順（z_index）は画像にも効く。半透明の画像・画素をぼかさない設定・回転情報つきの写真・テキストとの重なりを
  1 枚に置いて 1080p で描画し、プレビューと比べた（平均の差 1.6/255、差が 40 を超える画素 0.8%）。

## ブラウザのキャッシュについて

- 静的ファイルにキャッシュの指示（Cache-Control）を付けていなかったため、ブラウザが古い版の JS を推測で使い続け、
  更新後に新しいボタン（＋画像）が反応しないことがあった（HTML は新しく、JS が古い状態）。古い版を読み込んだブラウザに
  新しい版を出す手順を再現して確認した。
- 現在は、画面と静的ファイルに `Cache-Control: no-cache` を付け（変わっていなければ 304 で軽い）、さらに画面の JS・CSS の
  内容から作った版の番号が前回と違えば、起動時にそれらを読み直してから始める。

## 大きさと回転（F13）について

- 回転は Manim と同じく反時計回りを正の角度として保存する（Fabric は時計回りが正なので、表示では符号を反転）。
- 書き出しは `.move_to(中心).rotate(角度 * DEGREES)` の順にする。`rotate` の既定の軸は外接矩形の中心なので、
  先に位置を決めると、キャンバスと同じく要素の中心（回す前の枠の中心）を軸に回る。先に回すと、回したあとの字面の
  外接矩形の中心が位置になり、文字のように形が非対称な要素では少しずれる。
- ハンドルでの拡大・縮小は、変形の行列（`qrDecompose`）から倍率を読み、テキスト・数式は文字サイズ、画像は幅に掛ける。
  形をそのまま引き伸ばすのではなく、新しい大きさで作り直す。複数選択でまとめて変形したときも、要素ごとに
  中心・角度・倍率を読み直す。
- 回転したテキスト（背景ボックス付き）・数式・画像を 1080p で描画し、プレビューと比べた（平均の差 0.73/255）。
- スライドの周りに 56px の余白を取り、スライドの外は覆い（オーバーレイ）で薄くする。ハンドルは覆いの上に描く。

## 数式の複数行の揃え

- MathTex の既定の環境は `align*` で、& の無い行は右揃えになる（MathJax の表示数式は中央揃え）。数式に「複数行の揃え」を
  持たせ、書き出しとプレビューで同じ環境を使う: 中央は `gather*`、右は `align*`、左は `align*` で各行の先頭に & を入れる。
  いちばん外側に & がある数式は `align*` のまま（行列の中の & や `\\` は数えない）。3 つの揃えを 1080p で描画して確認した。

## 選択範囲の向き・画像の縦横比・コピー

- Fabric の ActiveSelection は、角度を与えても外接矩形を回さない向きで求める。グループの向き（`groups[].rotation`）や
  複数選択の向きがあるときは、その向きで測った外接矩形を自分で求め、固定のレイアウト（`FixedLayout`）の選択を作る。
  回転の軸はこの枠の中心で、回しても動かないため、0° に戻すと元の位置に戻る。
- 画像は高さ（`height`）を別に持ち、`gui_image(..., height=…)` で `stretch_to_fit_width/height` する。縦横に伸ばした画像を描画し、
  大きさと位置が GUI と一致することを確認した（412×273 px）。
- コピーは、クリップボードに独自の形式（`application/x-manim-slide-gui+json`）で書く。

## 図形・吹き出し

- 図形のプレビューも、テキストと同じ常駐の Manim が書き出しと同じ `gui_shape` / `gui_balloon_shape` で形を作り、SVG にして返す。
  図形は「基準点」（線: 両端の中点、吹き出し: 箱の中心、ほか: 外接矩形の中心）を原点に作り、書き出しでは
  `.shift(位置)` と、位置を軸にした `.rotate(...)` で置く。矢じりの付いた斜めの線などは外接矩形の中心が基準点とずれるので、
  プレビューは基準点・両端・尾の先の SVG 上の位置も返し、キャンバスはその点を位置・回転の軸にする。
- 吹き出しの尾は、箱と三角形を `Union`（skia-pathops）で一つの輪郭にする。三角形の向き（時計回り・反時計回り）が箱と
  逆だと合成されずに二つの輪郭のまま残るため、箱と同じ反時計回りにそろえる。
- 回した中身は、キャンバスでは「回す前の外接矩形を回した四隅」で測る。描画で回した Mobject の外接矩形をそのまま使うと、
  字面に沿って小さくなり、キャンバスと箱の大きさが違っていた（利用者の環境で発生）。描画でも `gui_balloon` が中身の回転と
  回転の軸を受け取り、同じ測り方をする。吹き出し自身も向き（rotation）を持ち、その向きで中身の外接矩形を測る。
- 楕円の吹き出しは、箱（中身＋余白）の四隅を通る楕円（幅・高さの √2 倍）にする。箱に内接する楕円では、中身の角がはみ出す。
- 吹き出しの箱は、描画では中身の Mobject の外接矩形から決める。キャンバスでは、中身のプレビューの字面の四隅（SVG の
  余白を除く）から求める。15 種類の図形と吹き出しを 1 枚に置いて 1080p で描画し、プレビューと比べた（平均の差 1.1/255）。

## 手書き・ベジェ曲線

- 点は 3 次ベジェ曲線の点（位置と、入る側・出る側の取っ手）として持ち、`VMobject` に `start_new_path` と
  `add_cubic_bezier_curve_to` で組み立てる。1 つの要素に複数の線（ひと筆）を持てる。`Create` は点の並び順に描くので、
  手書きは描いた順に 1 筆ずつ描かれる（描画の途中のコマで確認）。
- 手書きの点の列は、Schneider の方法（最小二乗で 3 次ベジェを当てはめ、誤差が大きい所で分ける）で曲線にする。
  元の点も保存し、「なめらかさ」（許す誤差）を変えて描き直せる。
- 手書き 2 筆・閉じて塗ったベジェ曲線（点の移動・追加・削除・回転のあと）を 1080p で描画し、プレビューと比べた（平均の差 0.21/255）。

## 中かっこ・座標軸・関数のグラフ

- 座標軸・グラフ・中かっこのプレビューも、常駐の Manim が書き出しと同じ `gui_axes` / `gui_graph` / `gui_brace` で作る。
  軸のラベルや数字は数式（LaTeX）なので、描画と同じ日本語用の preamble で作る。軸の範囲の値は、整数なら整数のまま渡す
  （小数で渡すと Manim が目盛りの数字を `1.0` のように表示し、描画と違ってしまう）。
- グラフの LaTeX の式は、自前の変換（`app/latexexpr.py`、再帰下降の構文解析）で numpy の式にする。sympy の LaTeX の
  読み込みは追加のライブラリ（antlr4）が要るため使わない。Python の式は、`ast` で使える名前・書き方だけかを確かめてから使う。
- グラフは x の範囲を細かく分けて値を求め、y が軸の範囲の外に出る所は、範囲の端との交点で線を切る（`plot` のままだと
  軸の外まで線が伸びる）。
- 中かっこは、付ける要素の回転前の外接矩形（`Rectangle`）に `Brace` を付ける。ラベルは `put_at_tip` でかっこの先に置く。
- 座標軸・グラフ 2 本・数直線・要素に付けた中かっこ・2 点の中かっこを 1080p で描画し、プレビューと比べた（平均の差 0.88/255）。

## 表・ベクトル場

- 表は、セルの Mobject（テキストは gui_text、数式は MathTex）を GUI の関数で作ってから Table に渡す
  （`element_to_mobject` はそのまま返す関数）。テキストの表示が、テキスト要素と同じになる。
- Table の `add_highlighted_cell` は背景の長方形を z_index 0 で加えるため、GUI のレイヤー（負の z_index）より手前に出て、
  文字と罫線を隠してしまう。gui_table が返す表では、背景を表の中でいちばん奥の z_index にする。
- ベクトル場の式の関数は、式の文字列だけを持つオブジェクトにする。関数（クロージャ）が numpy のモジュールを含む辞書を参照していると、
  Manim のキャッシュのハッシュ計算が関数の中身をたどって `TypeError: <cyfunction RandomState.beta> is not a Python function`
  で描画が止まった（ArrowVectorField は関数を `func` として持つため。グラフは関数を持たないので起きなかった）。
- StreamLines は範囲の外に出た線を `padding` の分まで伸ばす。始点は奥行き（z）の向きにも乱数でずれるため、`padding=0` にすると
  すべての線がすぐに範囲の外と判定されて消えた。`padding` を始点のずれの半分（y の間隔の 1/4）にする。
- StreamLines の大きさによる塗り分けは、Cairo では背景画像で塗る仕組みで、SVG のプレビューでは再現できない。
  線ごとに、線の上の大きさの平均で 1 色を決めて塗る（描画も同じ）。
- プレビュー用の常駐プロセスは、標準出力に 1 行 1 件の JSON で応答する。Manim は LaTeX のエラー（入力途中の数式など）を、
  verbosity が ERROR でも標準出力に複数行で書くため、応答の行の間に混ざって、サーバーが別の要求の結果を受け取っていた
  （利用者の環境で、表のプレビューが別の表になる・更新されない）。常駐プロセスの元の標準出力は応答専用にし、ほかの出力は
  すべて標準エラーへ流す（fd 1 の付け替え。Windows では子プロセス用の標準ハンドルも）。サーバーは要求ごとに番号を付け、
  同じ番号の JSON の行だけを応答として受け取る。
- `end_animation()` のあと流線が消えるのは Manim 0.20.1 の動作（Manim の StreamLines だけでも同じ）。
- 表（テキスト・数式・日本語・見出し・空のセル）、座標平面に重ねた矢印（大きさで塗り分け）、独立した流線を 1080p で描画し、
  プレビューと比べた（平均の差 1.2/255）。

## スライドの値・カメラ

- manim-slides の `Slide` と `MovingCameraScene` を両方継承したクラスで、カメラの移動・拡大、スライドの切り替えでの
  `self.camera.frame.restore()`、スライドの初めのカメラの位置の設定が動くことを確認した。
- 値に連動する要素は `gui_redraw`（always_redraw と同じ）で描き直す。描き直した Mobject は z_index が 0 に戻るため、
  `gui_layer` が覚えた重なり順（`_gui_z`）を、描き直すたびに付け直す。DecimalNumber も、数字を作り直すたびに付け直す。
- DecimalNumber は単位を既定の TexTemplate（日本語不可）で作り、数字の Mobject を文字列だけをキーにした共有のキャッシュに
  入れる。数字は既定のまま（座標軸の目盛りの数字と同じ）にし、単位だけを数式と同じ TexTemplate で作る。
- ValueTracker は、いまの値が 0 のとき真偽値として偽になる（`if tracker:` が偽）。gui_number がこれで ValueTracker を
  数とみなし `float()` に渡して失敗していた（利用者の環境で、初めの値が 0 のとき）。`is not None` で判定する。
- 値・グラフ・座標の点・数値・カメラの初期位置を置いたスライドを 1080p で描画し、最初のコマを、キャンバスのカメラの
  初期位置の枠の中と比べた（平均の差 0.91/255）。値を動かすと、グラフの上の点と点線、数値がついてくることを確認した。

## 3D

- 3D のプロジェクトは manim-slides の `ThreeDSlide`（Slide と ThreeDScene）で書き出す。ThreeDCamera には `frame` が無いため、
  2D のプロジェクトの MovingCameraScene のカメラ操作とは同時に使えない（プロジェクトごとに切り替える）。
- キャンバスの 3D の要素は、常駐の Manim が ThreeDCamera（背景は透明）でスライドの初めのカメラの向きから描き、写っている所だけを
  PNG で返す。基準点の画面の位置は `project_point` で求め、画面の右・上の向き（回転行列の 1・2 行目）も返して、
  キャンバスでドラッグした量を空間の向きに直す。立体・座標軸・曲面・曲線・矢印を置いたスライドを 1080p で描画し、
  最初のコマと比べた（平均の差 2.28/255。違いは、3D の物どうしの重なり方）。
- 画面に固定する 2D の要素は、シーンに加えずにカメラにだけ登録する（`renderer.camera.add_fixed_in_frame_mobjects`）。
  ThreeDScene の `add_fixed_in_frame_mobjects` はシーンにも加えるため、「スライド開始時に表示」がオフの要素に使えない。
  登録はその時の Mobject の部品ごとなので、値に連動して描き直す要素（gui_redraw）と数値（DecimalNumber）は、作り直した部品を登録し直す。
- 曲線の式では t が媒介変数なので、同じ名前のスライドの値（t）より媒介変数を優先する。
- LaTeX の式の変換: 関数の引数を括弧なしで書いたとき（`\sin x \cos y`）、引数は次の関数の前で終わる（sin(x)·cos(y)）。
  以前は sin(x·cos y) と読んでいた。

## SVG

- SVG は画像と同じく images/ に取り込み（.svgz は展開する）、図形の要素（gui_svg、中身は SVGMobject）として描く。
  プレビューも常駐の Manim が SVGMobject で読み込んだ形を SVG にして返すので、Manim が解釈できない部分（text・image・
  グラデーション）は、キャンバスでも描画と同じく表示されない。取り込むときに、これらがあれば知らせる。
- 元の色・1 色・線をそろえる・縦横比を変える・回転した SVG を 1080p で描画し、プレビューと比べた（平均の差 0.48/255）。

## 行列・角・グラフの補助・曲線・極座標・複素平面

- Matrix の h_buff・v_buff は成分の中心どうしの間隔なので、分数などの大きい成分が上下の成分と重なった。gui_matrix では、
  いちばん大きい成分の幅・高さに指定のすき間を足して間隔を決める。
- グラフの補助（面積・リーマン和・接線・割線）は、Manim の get_area などが ParametricFunction の関数を使うのに対し、
  GUI のグラフは範囲で切った VMobject なので、グラフの式から直接作る（gui_area・gui_riemann・gui_tangent・gui_secant）。
- Matrix の成分は既定で右下の角にそろうため、分数と並んだ成分が下に寄った。成分はセルの中央にそろえる（element_alignment_corner=ORIGIN）。
- 接線・割線の x を要素の項目 x に入れていたため、キャンバスの位置（座標軸に合わせて付け直す）で上書きされていた。atX に分けた。
- 複素平面の複素数の曲線 z = f(t) は、式を numpy の複素数で計算し（i = 1j）、ComplexPlane.n2p で点にする。
- 角（Angle）は、2 本の線を延ばした直線の交点に付く。キャンバスでは交点を基準点にする。
- 行列・角・面積・リーマン和・接線・割線・媒介変数曲線・陰関数・極座標のグラフ・複素平面を 1 枚に置いて 1080p で描画し、
  プレビューと比べた（平均の差 0.61/255）。

## 発表ウィンドウの開き方

- manim-slides 5.7.0 の `present` には `--full-screen`（`-F`）はあるが、最大化の指定は無い。
  そのため、`app/present_runner.py` が独自の引数 `--gui-window maximized|fullscreen|normal` を受け取り、
  fullscreen なら `--full-screen` に置き換え、maximized なら `Player.show` の直後に `showMaximized()` を呼ぶ。
  F キー（`Player.full_screen`）での切り替えはそのまま使える。
- 作業環境（Xvfb）では、動画の再生部分（QtMultimedia）が落ちるため、本物の発表ウィンドウでは確認できなかった。
  Player と同じ形のウィンドウで、3つの開き方の状態と F キーでの切り替えを確認した。
- 動画の再生部分が落ちる原因は音声出力（QAudioOutput の作成）だった。環境変数 `QT_AUDIO_BACKEND=alsa` を付けると
  Xvfb でも本物の発表ウィンドウを開けるので、情報ウィンドウの一覧・ボタンはこの方法で、実際のマウス操作で確認した。

## 発表者用ウィンドウの一覧

- manim-slides 5.7.0 の情報ウィンドウ（`Info`、QWidget）は、`player.info` で触れる。`Player.show` を包み、
  表示の前に `info.layout()` の下へ操作欄（ボタン・一覧）を足している。
- 好きな位置への移動は、`current_presentation_index` / `current_slide_index` を設定してから `load_current_slide()` を呼ぶ
  （manim-slides の前後移動と同じ手順。情報ウィンドウの表示も、そのシグナルで更新される）。
- 縮小画像は PyAV（manim が使うもの）で各スライドの動画の最後の画面を読み、Pillow で縮小する。
- 「ページ・クリック」番号は、書き出した .py の next_slide（GUI が上書きしているもの）が記録する。ステップのコードの中で
  self.next_slide() を呼んだ場合も、同じページの次のクリックとして数える。スライドの数と合わないときは通し番号にする。

## 図形の追加分・コード・棒グラフ・LaTeX の文章（2b）

- manim 0.20.1 の Code は背景の既定が濃い灰色（#222222）で、配色（formatter_style）に関係なく同じ。明るい配色のときは背景と
  文字の色（paragraph_config の color）を変える必要がある。
- BarChart の bar_colors は棒全体のグラデーション（set_color_by_gradient）なので、棒の数と同じ数の色を渡すと棒ごとの色になる。
  縦軸の自動の目盛りは値 ÷ 軸の長さで、きりの悪い数（0.75 など）になるため、GUI で 1・2・5 × 10^k の目盛りを決めて渡す。
  棒の名前はプロジェクトの TexTemplate（日本語）で作るため、bar_names は使わずに BarChart と同じ位置に自分で置く。
  get_bar_labels の label_constructor には値の文字列が渡され、DecimalNumber に使えないため、値のラベルも自分で置く。
- BulletedList の行頭の点（MathTex の \cdot）は、color を指定しても白のままなので、作ったあとで文字と同じ色にする。
- Title の下線も白のままなので、文字と同じ色にする。
- LabeledLine・LabeledDot のラベルは、文字列を渡すと既定の TexTemplate（日本語なし）の MathTex になるため、
  プロジェクトの TexTemplate で作った MathTex を渡す（線のラベルは Label クラスで、曲げた線にも置けるよう位置を自分で決める）。
- Union などの図形の合成は skia-pathops（manim の依存に含まれる）を使う。形は各図形の自身の点だけから作る（子の図形は使わない）ため、
  破線（DashedVMobject。点は子にある）は合成に使えない。

## 多面体・媒介変数曲面・標本空間（2c）

- Polyhedron（正多面体・ConvexHull3D も）は、面（faces）と、頂点・辺のグラフ（graph）からなり、面を頂点の位置に合わせる
  updater が付いている。頂点の点を出さないときも、点を消すと面が頂点についてこなくなるため、見えない小さな Dot にする。
  辺は面（Polygon）の縁の線で描く（graph の辺は Manim の既定どおり見えない）。
- 正多面体の大きさは一辺の長さ（edge_length）。同じ一辺でも、正十二面体は正四面体の 3〜4 倍の大きさになる。
- 媒介変数曲面は Surface に座標軸の c2p を通した関数を渡す。高さで塗り分けるときは set_fill_by_value(axes, colorscale, axis=2)。
- SampleSpace の divide_vertically・divide_horizontally は、区画（SampleSpace）を作って足す。区画の線の既定は薄い灰色なので、
  作ったあとで枠と同じ色・太さにする。中かっこのラベル（get_side_braces_and_labels など）は、文字列だと既定の TexTemplate の
  MathTex になるため、中かっことラベルは自分で作って置く（日本語のため）。

## グラフ（Graph・DiGraph）

- 自動の配置は NetworkX（manim の依存に含まれる）。spring と random は乱数を使うので、layout_config の seed を渡して、
  キャンバスの表示と描画を同じ配置にする（同じ seed なら同じ配置になることを確認した）。kamada_kawai は乱数を使わない。
- tree は root_vertex が必要で、木でないと ValueError、planar は平面的でないと NetworkX の例外になるため、GUI で先に調べて日本語で知らせる。
- labels=True のラベルは既定の TexTemplate（日本語なし）の MathTex になるため、プロジェクトの TexTemplate で作った MathTex を
  LabeledDot にして vertex_mobjects で渡す（名前が収まるように半径も決める）。
- Graph は頂点のあとに辺を足すので、辺が頂点（と中の名前）の上に描かれる。頂点を足し直して、辺の上に出している。

## このスライドを試す（Ctrl+Enter。旧 F11）

- 編集中のスライドだけを含むプロジェクトを作って書き出し（クラス名 GuiSlidePreview）、ふつうの描画と同じ仕組み（render_runner）で
  低画質で描く。検査はプロジェクト全体で行い、そのスライドの問題だけを知らせる。行番号の対応表のスライド番号は元の番号に直すので、
  エラーの位置・描画中の進み具合の表示は、元のスライドの番号になる。
- 再生は manim-slides の区切りごとの動画（slides/files/GuiSlidePreview/）を、トークン付きで取り寄せてブラウザの中で再生する。
  区切りの番号（初め・クリック 1…）は、書き出した .py が記録する slides/gui_pages/GuiSlidePreview.json から。

## ページ番号

- MovingCameraScene には画面に固定する仕組みが無いため、ページ番号に updater（_GuiPin）を付け、カメラの枠の中心と幅に合わせて
  位置と大きさを毎フレーム直す。updater は関数ではなく小さなクラスにした（Manim のキャッシュのハッシュで、関数の閉包をたどらないように）。
  3D（ThreeDSlide）は add_fixed_in_frame_mobjects で画面に固定する。
- ページ番号は各スライドの初め（self.clear() のあと）に足し直す。番号の決め方は project.page_plan（GUI の store.pagePlan も同じ）。

## 注釈・矢じり・ベクトルなど

- ArcBrace は円弧の start_angle・angle・radius 属性を使うが、円弧を回しても属性は変わらないため、GUI の円弧の値（中心・半径・
  角度 + 回転）から円弧を作り直して付ける。
- LabeledPolygram の置き方（polylabel: 形の内側で、縁からいちばん遠い点）を、manim.utils.polylabel で、ほかの閉じた形にも使う。
- 矢じりの形は add_tip(tip_shape=…)。輪郭だけの矢じり（ArrowTriangleTip など）は塗らない。
- 注釈（SurroundingRectangle など）は、プレビューでは付ける要素の外接矩形（キャンバスで測った字面）と同じ大きさの四角に付けて形を作る。

## グラフの追加分・軌跡・色が流れる枠

- 導関数・原始関数のグラフは、Manim の plot_derivative_graph / plot_antiderivative_graph と同じ考え方（数値微分・数値積分）を、
  グラフの式から直接計算する（グラフの範囲が y の範囲で切れていても、範囲の外まで計算できるように）。原始関数は F(0) = 定数。
- 2 つのグラフの間の面積は get_area(graph, x_range, bounded_graph=…)。もう 1 つのグラフを消すと、x 軸との間の面積に戻す。
- 線のグラデーションは CurvesAsSubmobjects + set_color_by_gradient。直線・円弧は曲線が 1〜数本しかなく、そのままでは 1 色になるため、
  insert_n_curves で 60 本以上に分けてから塗る。破線は破線の 1 本ずつを塗り分ける。
- AnimatedBoundary は作った直後の線の太さが 0（時間がたつと現れる）なので、total_time を 1 周期の手前にして update_boundary_copies(0) を
  呼び、最初の色で一周した所から始める（キャンバスの見た目と同じ）。色が流れるのは、アニメーション・待ちの間だけ。
- TracedPath（軌跡）は、たどる要素の get_center を追う。キャンバスでは、目印（点線の丸と「軌跡」）だけを出す。
- Manim は、アニメーションの最後のコマを「終わる 1 コマ前」（t = run_time - 1/fps）の状態で描く（Scene.get_time_progression が
  np.arange(0, run_time, 1/fps)）。ふつうは見分けがつかないが、値を t = 2 まで動かす x^t のように、終わった時だけ形が変わる場合は
  止まった画面が違って見える（x < 0 が消えたまま）。書き出すシーンで get_time_progression を上書きし、終わった時（run_time）のコマを 1 枚足す。

## 要素の表・ズーム・線形変換

- 要素の表・行列は、Manim の Table / Matrix に element_to_mobject=恒等 で要素そのものを渡す（MobjectTable・MobjectMatrix と同じ）。
  プレビューでは書き出しと同じ式で表を作り、セルの要素を透明にして表の線と文字だけを描き、セルの要素の動いた量を返す
  （キャンバスでは、その位置に要素そのものを置く）。最初は出さないセルの要素は、表を作ったあとで表から外す（gui_detach。位置はそのまま）。
- ZoomedScene は 1 つのシーンにズームのカメラが 1 つ。スライドごとに、拡大する所・映す所の大きさと位置を設定し直し、スライドの初めに
  前のスライドのズームを止める（self.clear() では、MultiCamera の image_mobjects_from_cameras に残るため）。作った直後の背景色は
  スライドの背景色にそろえる。キャンバスでは、拡大する所に入る要素を、映す所の大きさで描き直す（選択の枠は写さない）。
  Fabric の after:render は選択の枠を描く上の層（contextTop）でも呼ばれるので、そこでは描かない（下の層の映す所を隠してしまうため）。
- Manim は、アニメーションの間、動いていない要素を前のコマの絵で済ませる（ズームのカメラには、動いている要素しか写らない）。
  そのため映す所が飛び出すアニメーションなどの間、止まっている要素が映す所に写らない。ズームを出している間は、
  get_moving_mobjects ですべての要素を動いている物として扱う（毎コマ描き直す）。
- 線形変換は、ApplyMatrix と同じく点を一次で動かす Transform。座標平面の x・y の目盛りの間隔が違っても、平面の座標で変換する
  （最初の平面の原点・単位ベクトルを覚えておく）。矢印は put_start_and_end_on（矢じりの形を保つ）、点・文字は中心を動かす。

## 座標軸なしの曲線・接線・対数目盛り

- 座標軸なしの曲線は、座標軸の代わりに「画面の座標 × 1 の長さ」の換算を使い、座標軸に付けるグラフ・媒介変数曲線と同じ関数で描く
  （陰関数は ImplicitFunction）。原点を要素の位置へ動かし、原点のまわりに回す。
- 接線は TangentLine と同じ（曲線の長さの割合 alpha の前後の 2 点を結ぶ向き）。図形の中の、文字・矢じりを除いたいちばん大きい線に引く。
  割合が 0・1 の端では、内側の点で向きを求める。曲線が値で描き直されるときは、接線も毎回引き直す。
- 対数目盛りは Axes の x_axis_config / y_axis_config に scaling=LogBase(custom_labels=True)。範囲は指数。グラフは軸の上の位置（指数）で
  範囲の外を切り、0 以下の値（対数が無い所）でも線を切る。対数目盛りの x 軸では、x を指数で等間隔に取る。
  10^n の数字は Manim の既定では白なので、軸の色にそろえる。
- プレビューの SVG では、ごく短い 3 次曲線（陰関数などに多い）を直線にする（制御点が向きを折り返していると、ブラウザの描く線に切れ目ができるため）。

## 動画・音声（発表で再生）

- Manim の add_sound の音声は、シーン全体の動画にだけ入り、manim-slides のスライドごとの動画には入らない（確認済み）。
  そのため既定の再生方法は「発表で再生」: 書き出したシーンが、区切り（manim-slides のスライド）ごとのスライドの番号・長さと、
  gui_media の操作を「何番目の区切りの何秒目」として slides/gui_pages/<クラス名>.media.json に残し、発表ウィンドウがそれに従う。
- 発表ウィンドウでは、manim-slides の Player（QMainWindow）の子に、動画ごとの別のウィンドウ（WA_NativeWindow）を作って上に置く
  （Manim の映像の QVideoWidget は別のウィンドウとして描かれるため、ふつうの子の部品では下に隠れる）。位置は、中央の部品の中に
  縦横比を保って表示される 1920×1080 の画面から計算し、50 ミリ秒ごとに合わせ直す。再生は QMediaPlayer + QAudioOutput。
- 戻る・飛ぶときの状態は、最初の区切りから区切りを止めずに見てきた場合の状態を、記録した長さと操作から計算する
  （app/present_media.py の state_at と、ブラウザの static/js/mediaplan.js の stateAt は同じ決まり）。
- QMediaPlayer は、読み込みが終わる前の setPosition が効かないことがある（再生する区間の初めが無視され、0 秒から流れる）。
  頼んだ位置を覚えておき、読み込めたとき・50 ミリ秒ごとの見張りで合わせ直す。区間より前を再生していたら、区間の初めに戻す。
- 動画に焼き込むときは、ImageMobject の pixel_array を、場面の時刻から求めた再生位置のコマに差し替える（PyAV で前へ読み進め、
  戻る・遠くへ飛ぶときだけシーク。コマは描画の解像度での幅まで縮める）。止まっている間は更新を止める（静止した待ちを速く描くため）。
  不透明度は stroke_opacity に合わせ、set_opacity のための orig_alpha_pixel_array もコマごとに合わせる。
- コマを差し替える更新は dt を受け取る形にする（Manim は、時間で変わる更新の無い self.wait を 1 枚の静止画で済ませるので、
  dt が無いと待っている間に動画が進まない）。止まっている間は更新を外す。焼き込む動画は描いた時間の分しか進まないので、
  「自動」で始めるときは終わるまで（くり返しなら 1 回分）待つ（gui_media の wait=True と同じ）。
- 焼き込む動画の読み手（PyAV の開いたファイル）は Mobject に持たせず、鍵で引く（FadeIn などが copy.deepcopy で写すとき、
  開いたファイルは写せずにエラーになるため）。描画の最後にファイルを閉じる（開いたままだと、manim-slides が逆再生の動画を
  作る子プロセスが止まることがある）。スライドの終わりで、そのスライドの焼き込む動画・音声を止める。
- 焼き込むときの「くり返し」は、再生を始めた区切りを manim-slides のくり返すスライド（loop）にして、1 回分を描く。
- 描画の前に、開いている発表ウィンドウを閉じる（Windows では、発表ウィンドウが開いている動画を書き換えられず、
  描画のあとで音声を入れ直せないため。描画のあとで開き直す）。
- 焼き込む音声は、再生していた区間ごとに、区間・音量・フェード・くり返しを反映した WAV（44.1 kHz・2 チャンネル）を作り、
  再生を始めた時刻に add_sound で入れる（一時停止・停止・音量の変更・最後で区間を閉じる）。
- 描画のあとで、全体の動画（media/videos/…/<クラス名>.mp4）の音声を、スライドごとの動画の長さを足した時刻で切り分け、
  映像はそのまま、AAC にして各スライドの動画に入れ直す（app/slideaudio.py）。逆再生用の動画には入れない。
  音声が無くなったスライドの動画に、前の描画の音声が残っていれば外す（manim-slides は同じ中身の動画を使い回すため）。
- 取り込んだ動画・音声は clips/ に置く（Manim は描画の結果をプロジェクトの media/ に書くため、混ざらないように）。

## アニメーションの GUI（A1: 出す・消す・強調・待つ・コード）について

- ステップは mode = "code"（コード欄。これまでのもの）か "gui"（動きの行の並び）。GUI のステップは書き出すときに
  app/animgen.py がコードにする（キャンバスのプレビューとは関係しない）。動きの一覧（CATALOG）は Python 側にあり、
  /api/anim/catalog で画面に渡す。
- 1 つのステップの中で、自由なコードの行で区切られた動きの行は 1 つの self.play にまとめる。始まりをずらした動きは
  gui_at(anim, start, total) で、rate_func を「start 秒まで 0、start〜start+run_time で元の rate_func、そのあと 1」に包み、
  run_time を total にする（Manim の AnimationGroup の lag_ratio と違い、行ごとに自由な時刻にできる）。
  全部が同時に始まり同じ長さなら、gui_at を使わずにそのまま並べる。動きの後ろの「待つ」は self.wait にする。
- 引数は Manim の既定と違うものだけ書く。GrowArrow は GrowFromPoint(対象, gui_start(対象)) にする
  （GrowArrow は VGroup〈ラベル付きの線・ベクトル〉に使えないため。動きは同じ）。
- 1 つのステップの動きは、時間の重ならない所で別々の self.play に分ける。同じ self.play の中で同じ要素（グループと
  その中の要素を含む）を動かす行は gui_stack(根の要素, …) にまとめる（Manim では、同じ要素のアニメーションを一緒に
  再生すると、毎コマあとのものが前のものを上書きするため）。gui_stack は毎コマ、始めの形に戻し、出す・消す動き（土台。
  時刻の重ならないものを順に使う）で形を決めてから、強調（Indicate・Wiggle・ApplyWave・点滅）を今の形に重ねて掛ける。
  枠で囲む・光を放つ・注目させる・光が線をなぞる・波紋は、別の物を描くだけなので、まとめない。
  同じ要素を同じ時間に出す・消す動き 2 つは重ねられないので、書き出し前の検査でエラーにし、編集欄でも警告する。
- 緩急の ease_… は from manim import * で読み込まれないので、rate_functions.ease_in_sine のように書く。
  Indicate は既定の緩急（there_and_back）で色と大きさを戻すので、選んだ緩急は lambda t: there_and_back(緩急(t)) と掛け合わせる。
- Manim の Blink と ShowIncreasingSubsets は set_opacity(1) で見せるので、塗りの無い円や手書きの線の中まで塗りつぶす
  （塗りの色で）。Blink は終わると対象を場面から外す。同じ動きを、元の塗り・線・背景の線・画像の不透明度を写して戻す
  gui_blink・gui_subsets で書き出す。
- Uncreate・Unwrite・ShrinkToCenter・逆に再生する SpinInFromNothing は、対象の点を潰したまま残す（あとで FadeIn などで
  出し直すと、見えない・崩れる）。gui_restore で、場面から外したあとで形を元に戻す。ShrinkToCenter には remover=True を付ける。
- 緩急の「行って戻る」（there_and_back）と「ゆらす」（wiggle）は終わりに始めの状態へ戻るので、出す・消す動きには選べない
  （書き出し前の検査でもエラー）。lingering は「時間の 8 割で終え、残りは止まる」もの。ease_in_back・ease_out_back・
  ease_out_elastic は進み具合が 0〜1 の外に出る（−0.1・1.1・1.37 まで）。線を描く・書くなど 0〜1 で切られる動きでは、
  外に出た間は止まって見える。
- 消す動きの「回りながら消える」は SpinInFromNothing を reverse_rate_function=True・remover=True で逆に再生する。
- エラーの位置は、GUI のステップでは「ステップ k / コードの n 行目」と、どの動きの行か（rowId、自由なコードなら行の中の行番号）を返す。

## アニメーションの GUI（A2: 動かす・値・カメラ・動画音声・ズーム・線形変換）について

- 動かす（移動・拡大・回転・色・線に沿って）とカメラ・ズームの枠の移動・拡大は、単独なら Manim の書き方
  （x.animate(run_time=…).shift(…)・Rotate・MoveAlongPath など）で書き出す。同じ要素のほかの動きと同じ self.play に
  入るときは、今の形に重ねて掛ける gui_move・gui_scale・gui_rotate・gui_color・gui_along（gui_stack の中）にする。
  濃さは、set_opacity が塗りの無い図形を塗るため、いつも gui_opacity（元の濃さに対する割合）。
- .animate の run_time・rate_func は x.animate(run_time=…, rate_func=…).メソッド(…) の形で渡す。
- 動画・音声の操作・ズームを出す（activate_zooming）・消す（gui_zoom_off(self, hide=True)）・行列で変換
  （gui_apply_matrix）は、自分で self.play する文なので、自由なコードと同じく、かたまりを区切って前の動きのあとに置く。
  ズームを消すときは、映す所を拡大する枠へ縮めて戻し（get_zoomed_display_pop_out_animation の逆）、枠をフェードで消す。
- 移動先の影は、キャンバスの今の形をずらして after:render で描き、影を押したときは要素を選ばないようにして
  （skipTargetFind）、ドラッグで行の数を変える。位置は、そのステップより前の移動・点のまわりの回転をたどった目安。
- 動画・音声の操作の wait は、True（終わるまで）か秒数。再生だけでなく、位置・音量・表示・非表示のあとにも待てる
  （焼き込むときは、待つ・アニメーションの間しか動画が進まないので、音量を変えたあとも続けて再生するには、その行で待つ）。
- 数の欄の矢印の刻み: HTML の数の欄は最小値（min）を刻みの起点にするため、min="0.01" step="0.25" だと 0.01 → 0.26 と進む。
  最小値が刻みの倍数でない欄は、起点を 0 にし、元の最小値より小さくなったら元の最小値に戻す（static/js/numstep.js。
  すべての数の欄に、あとから足された欄にも掛かる）。
- 影（移動先・回転の中心・ズームの枠）のドラッグは、Fabric より先にキャンバスの枠の要素で pointerdown を受ける
  （Fabric はマウスを乗せたときに対象を覚えておくため、skipTargetFind では、選んでいる要素のハンドルを一緒に動かしてしまった）。
- 描画の子プロセス（render_runner.py）の multiprocessing を spawn にした。manim-slides は長いスライドの逆再生の動画を
  multiprocessing.Pool で作るが、Linux の fork では、それまでに PyAV・FFmpeg が作ったスレッドの錠が子プロセスで
  掛かったままになり、まれに止まった（Windows は初めから spawn）。

## アニメーションの GUI（A3: 変形・一部分・文字を打つ・関数で変形）について

- 一部分は、行の part = {paths: [[i, j], …]}（要素の部品の番号）で持ち、続いた番号は切り出し（v[0][2:5]）、ばらばらなら
  VGroup(…) にまとめて書き出す。部品の枠は、書き出しと同じ式（codegen.element_expr）で常駐の子プロセスが要素を作り、
  1 段目・2 段目の部品の外接矩形を返す（/api/anim/parts）。キャンバスでは、その枠を押して選ぶ（数式は MathJax の仮表示なので、
  枠は目安）。
- ReplacementTransform・TransformMatchingShapes・FadeTransform は、置き換えたあとで元の要素の形を gui_restore で戻す
  （あとで出し直したり、逆に変形したりできるように）。TransformMatchingShapes・FadeTransform は部品をまとめて動かすので、
  元の要素を gui_restore の 2 つ目の引数で渡す。
- 1 文字ずつ打つ・消すは gui_type（点を持つ部品を作った順に 1 つずつ見せる。元の濃さを写して戻すので、塗りの無い物は塗らない。
  カーソルは場面に足して、終わったら外す）。Manim の AddTextLetterByLetter は Text の submobjects（行）単位になり、gui_text の
  テキストでは 1 行ずつになるため。
- gui_type のカーソルは、要素全体（一部分を打つときは ref=要素）の文字を、上下の範囲が重なるものどうしで行にまとめ、
  その行の高さと上下の位置に合わせる（一部分の文字だけで決めると、「=」や上付きの「2」の高さの小さいカーソルになった）。
  太さは 3 画素以上、いちばん手前に描く。
- 書き出す .py に図形の補助関数（shapekit）を入れるかは、要素の種類のほか、コード欄（コードのステップ・自由なコードの行）に
  gui_…( を書いているかでも決める（GUI のステップを「コードにする」と gui_type などが入り、図形の無いスライドで NameError になった）。
- 式で点を動かすは ApplyPointwiseFunction(lambda p: gui_fn_xy(p, lambda x, y: (…, …)), 対象)、時間で変わる式は Homotopy、
  複素関数は ApplyComplexFunction。

## アニメーションの GUI（A4: 試す・道筋の表示）について

- 「このステップを試す」は、Ctrl+Enter と同じスライドの試し描画をして、試し描画の小窓を、そのクリックの区切りから開く
  （区切りの番号は slides/gui_pages の記録から引く）。
- 線に沿って動く道筋は、線の要素（と、それが使う座標軸・グラフなど）を書き出しと同じ式で常駐の子プロセスに作らせ、
  point_from_proportion で 64 点を取る（/api/anim/pathpts）。要素の中身が変わるまでは取り直さない。
- 道筋は目安: そのステップより前の移動・点のまわりの回転・線に沿った移動をたどる（自由なコードの動きは数えない）。

## 発表で再生する動画のシークバー

- 再生中にシークバーで位置を変えると、再生側が前の位置へ戻す・追いつかないことがあったので、つまみを押している間は
  一時停止して位置を合わせ、離したら再生し直す。移る位置は want に覚えておき、移るまで定期の処理が古い位置へ戻さないようにする。
- 溝を押したときは、Qt の既定（少しずつ動く）ではなく、押した所へすぐ移る。

## 段階E（元に戻す・整列・写す・テンプレート）について

- 元に戻すは、markDirty（変更の通知）のたびに、少し間を置いて（400 ms）プロジェクト全体の JSON の写しを積む（最大 100）。
  戻すときは、写しを store.project にして、スライドの一覧・キャンバス・パネルを作り直す（project-loaded を出す）。共通プリアンブル
  （preamble.tex）は別のファイルなので、元に戻すの対象ではない。
- 整列は、キャンバスの物の外接矩形（回した物は回したあとの枠）で計り、moveElements で動かす。
- 写した動きの行・ステップは、ブラウザの localStorage に覚える（別のプロジェクトにも貼り付けられる）。
- テンプレートは userconfig のフォルダの templates/settings・templates/slides。スライドの型を使うときは、複製と同じ
  cloneSlide（新しい id・変数名。ほかの要素への参照とコードの中の変数名も付け替える）で足す。

## 段階P（くり返し・自動で次へ・発表者ノート・切り替え効果・ファイルに出力）について

- ステップの loop・autoNext・notes は、そのステップの前の `self.next_slide(...)` の引数にする（manim-slides 5 の next_slide の引数は、
  これから始まる区切りの設定）。スライドの autoStart・notes は、スライドの境目の `self.next_slide(gui_new_page=True, ...)` に付ける。
  最初のスライドは next_slide が無いので、`self.gui_first_slide(...)` で `self._base_slide_config`（BaseSlideConfig）を直接決める。
- 切り替え効果: スライドの境目で、`self.clear()` の前に `gui_frame_image(self)`（`renderer.get_frame()` の画素から ImageMobject）で
  前のスライドの最後の画面を写し、新しいスライドを組み立てたあと、`gui_transition` で、その画像と新しいスライドの物を
  manim-slides の Wipe・Zoom（フェードは FadeOut・FadeIn）で入れ替える。2D はカメラの枠の大きさ・位置に合わせ、3D は画面に固定する。
  「自動」で始める動画・音声は、切り替え効果のあとで始める。
- ファイルに出力: `python -m manim_slides convert --to html|pdf|pptx`。HTML はいつも `--offline`（reveal.js を書き出し先に入れる）。
  まず HTTP(S)_PROXY をつながらない番地（127.0.0.1:9）にして実行し、キャッシュに無ければ「Missing Reveal.js asset」で
  すぐ失敗するので、利用者に確かめてから、プロキシを戻して実行し直す（ダウンロードはこのときだけ）。
  出力はいったん export/.work_<id> に作り、成功したら export/ へ移す（失敗しても前の出力を壊さない）。
- 発表者ノート: manim-slides のノートは区切りごとなので、スライドのノートを、そのスライドのすべての区切りの notes に入れ、
  ステップのノートは「【クリック k】」を付けて下に足す（codegen.segment_notes）。発表ウィンドウでは、情報ウィンドウの
  slide_notes を隠し、全ページの一覧の下の欄に current の notes を出す（present_runner.install_page_panel）。
- 「発表で再生」の動画・音声の出力（media_export.py）: 区切りごとの始まり・終わりの状態は present_media.state_at・apply_cue・advance
  （発表ウィンドウと同じ計算）で求める。HTML は reveal.js の slidechanged で、次の区切りへ進んだときは同じスライドの物の再生を続け、
  それ以外は始まりの状態にそろえて、区切りの操作を setTimeout で行う。PDF は manim-slides と同じく区切りの最後のコマに、
  見えている動画のコマ（PyAV）を重ねて自分で作る。PowerPoint は add_movie と p14:trim。
- 描画のあとに変えたか（stale）は、今の内容から作るコードと、描画に使った `<クラス名>.py` を比べて判断する。

## 段階S（統計のグラフ）について

- 要素は shape="statchart"（chartKind で種類）。データは表（文字のまま）で持ち、statmodel.statchart_args で数にして
  shapekit.gui_statchart に渡す（プレビューと描画で同じ関数）。軸は Manim の Axes、散布図などは _origin_shift を範囲の最小値に
  した Axes の子クラス（軸を左下で交わらせる）。四分位数は numpy の percentile（線形補間）と同じ計算を自前で行う（numpy に頼らない）。

## 段階M（動き）について

- カタログに only（使える要素の種類）を足し、書き出し前の検査と画面の下の選択肢で、合わない要素には使えないようにする。
- 3D のカメラは対象の種類 camera3d（target_var は self）。move_camera・begin/stop_ambient_camera_rotation は文として出す。
- ずっと動かす: gui_always（add_updater。付けた更新を m._gui_always に覚え、gui_always_stop はそれだけを外す）。
- Manim 0.20 には ShowCreationThenFadeOut が無いので、gui_create_then_fade（Succession(Create, FadeOut) を写しに）を使う。
- コードの行の帯: Code の code_lines の位置に帯を作り、背景のすぐ前の部品として入れて、Transform で動かす（消すときも透明にするだけ。
  部品を場面から外すと、親の Code が分かれてしまうため）。
- 1 語ずつ: gui_type(words=True)。文字の間のすき間（行の高さの 0.3 倍）と行の変わり目で語に分ける。

## 発表の道具（レーザー・ペン・黒白画面・拡大鏡・ページ番号・タイマー）について

- 映像の部品（QVideoWidget）の上に透明な部品を重ねても、映像が手前に描かれて見えない（Qt 6 の映像の描き方）。そこで、
  道具は映像のコマそのものに描き込む（present_tools.py）。再生する映像のコマは手元の QVideoSink で受け取り（media_player の出力先を替える）、
  frame_changed で、そのまま、または道具を描き込んだコマ（QVideoFrame(QImage)）を、発表ウィンドウと情報ウィンドウの画面に渡す。
  止まっている間も、道具を使っている間は 30 回/秒くらい描き直す。キーとペンのマウスは、アプリ全体のイベントフィルターで先に受け取る。

## 段階A（数式の一部の色・対応を決めて変える・元の状態に戻す・速さの変化・流れに沿って動かす）について

- 一部の色: MathTex(color=…) は、LaTeX の中で xcolor で付けた色（\color[HTML]{…}）を残す（manim 0.20.1 で確認）。そこで、
  tex_to_color_map のように数式を分けず、色を付ける所を {\color[HTML]{RRGGBB} …} で囲む（app/texcolor.py と static/js/texcolor.js が
  同じ書き換えをする）。部品の数・番号は変わらないので、一部分の動き・対応を決めて変える の番号もそのまま使える。
  xcolor は、利用者のプリアンブルのあと（JP_TAIL_PREAMBLE）に読み込む（利用者がオプション付きで先に読み込んでいても、ぶつからない）。
  MathJax には HTML の色の形が無いので、仮表示では \color[RGB]{r,g,b} に置き換える。
- 対応を決めて変える: gui_match_transform（AnimationGroup。決めた部品ごとに ReplacementTransform、残りは形の目印
  （点の並びを中心・高さでそろえたもの）が同じ部品どうしを ReplacementTransform、合わない物はフェード）。
  終わったら、部品のまとまりと対象を場面から外し、変えた先を入れる。対象の形は gui_restore で戻す（あとで出し直せるように）。
- 元の状態に戻す: 「覚えた状態に戻す」の対象は、要素を作ったところで save_state() しておく（「今の状態を覚える」の行は、
  その場で save_state() し直す）。

- 速さの変化: gui_speed は ChangeSpeed を使わず、動きの rate_func・run_time を書き換える（同じ式で、ChangeSpeed と同じ進み方・長さ
  になることを確認）。ChangeSpeed は渡された alpha をそのまま使うので、gui_at（始まる時刻をずらす。rate_func を書き換える）と
  一緒に使えないため。行の長さ（row_duration）にも、同じ倍率（speed_factor）を掛ける。
- 流れに沿って動かす: gui_field が作るベクトル場に、画面の上の速度の関数（m._gui_flow）を付ける（値で描き直すときも付け直す）。
  「点ごとに流す」は PhaseFlow、「形を保つ」は中心を中点法で進める Animation（どちらも rate_func の差で進めるので、gui_at と使える）。

## 描画するスライドの選択について

- 書き出し（codegen.generate）は、描画するスライドだけのプロジェクトを作ってから .py にする。対応表（.map.json）と検査の問題の
  slideIndex は、元のスライドの番号に直す（エラーの位置・描画の進み具合の表示が、編集画面のスライドの番号になる）。
  .map.json の slides に、描画したスライドの元の番号を残す。今回だけ選んだときは <クラス名>.include.json に残し、ファイルへの出力の前の
  「描画のあとに内容を変えたか」の確かめに使う。
- ページ番号（project.page_plan と store.pagePlan）は、描画するスライドだけを数える。発表者用の一覧の「ページ」は、描画したスライドの
  順番（.py が数える）なので、ページ番号を指定していなければ、ページ番号と同じになる。

## 確認した環境

- 開発・自動テスト: Linux（Python 3.13.18、manim 0.20.1 と 0.21.0、manim-slides 5.7.0、TeX Live 2023 の XeLaTeX、
  Chromium によるブラウザ操作のテスト）
- 利用者の環境: Windows、conda 環境（manim=0.20.1 の environment.yml は、Windows での解決を利用者の環境で確認する）

## 発表の録画（2026-11-08）

- マイク・カメラは Qt Multimedia（PySide6 の QMediaCaptureSession・QMediaRecorder。MPEG-4 の AAC / H.264）で録る。
  一時停止ごとに別のファイルにし、録り始めの遅れは、ファイルの終わりを止めた時刻に合わせて詰める。
- 動画への組み立ては PyAV（manim が使う av。確認時 19.0.2）で読み書きし、絵は Qt の QPainter（offscreen）で描く。
  出力は H.264（libx264、veryfast・CRF 20）と AAC 48 kHz ステレオ。ffmpeg のコマンドは使わない。
- 確認時の PySide6 は 6.12.0（Linux。音の出力は ALSA）。
- 録画の進み具合（compose.json）の書き換えは、Windows で操作アプリが同じファイルを読んでいる一瞬に失敗する（WinError 5）ため、
  少し待ってやり直す。途中の進み具合は、書けなければ飛ばして組み立てを続ける。

## 自動保存とバックアップ（2026-11-08）

- 自動保存は、ブラウザ側で変更が止まってから保存する（保存の途中に変更があれば「未保存」のまま残し、次の自動保存で保存する）。
- バックアップは `backups/<日時>_<理由>.json`（project.json とプリアンブルを 1 つの JSON に）。新しいライブラリは使っていない。

## 1 本の動画として書き出す（2026-11-08）

- 録画と同じ組み立て（record_compose.py）を使う。新しいライブラリは使っていない。
- 描画のときに、区切りごとの元（スライドの id:ステップの id）を `slides/gui_pages/<クラス名>.segs.json` に残す（場所ごとの待ち時間に使う）。

## 検索・置換／ファイルの整理／速さ（2026-11-08）

- 新しいライブラリは使っていない。整理で移したファイルは、プロジェクトの `unused/` に置く。

## 発表の強化（2026-11-09）

- 描画のときに `slides/gui_pages/<クラス名>.deck.json`（描画したスライドの章・付録・目安・題名と、リンクの位置）を残す。
  ページの記録（`<クラス名>.json`）のページは、付録では「A1」のような文字列になる。
- PDF のリンクは pypdf（確認時 6.17.0）で入れる。

## 点検と配布（2026-11-09）

- 配布資料（PDF）は reportlab（確認時 5.0.1、conda-forge）で作る。日本語の文字は TrueType のフォント（.ttf・.ttc の中の TrueType）を
  埋め込む（CFF の .otf は reportlab で使えないため、見つからなければ PDF の標準の日本語フォント HeiseiKakuGo-W5 にする）。
- 画像（PNG・GIF）は、すでに使っている PyAV と Pillow で作る。
- 持ち運び（zip）は Python の標準の zipfile で作る。Windows で Shift_JIS の名前を書いた zip は cp932 で読む（Python 3.11 からの metadata_encoding）。
- 新しく足したライブラリは reportlab だけ。

## 編集の強化（2026-11-09）

- 新しいライブラリは使っていない。動きのプリセットは、ユーザーの設定フォルダの `presets.json` に保存する。
- スライドマスターは project.json の `masters`（スライドは `master` でマスターの id を持つ）。書き出しの前に、マスターの要素をスライドに入れる（app/masters.py）。
  背景色の切り替えは `self.camera.background_color`（manim 0.20.1 で、場面の途中で変えられることを確認）。

## 見通し（2026-11-10）

- 新しいライブラリは使っていない。出力設定は、ユーザーの設定フォルダの `export_presets.json` に保存する。
- タイムラインの時刻の計算は、app/animgen.py の block_times・row_duration と同じ（JS の static/js/timeline.js に同じ計算を持つ）。

## 入力と一覧の補助（2026-11-11）

- 新しいライブラリは使っていない。記号の表の見た目は同梱の MathJax で作る。
- 自動折り返しは、Manim の MarkupText（Pango）で行を数十文字ずつ組んで文字の位置を測り、こちらで行を分ける
  （Pango は長い行を自分で折り返すため、1 行を一度に組むと位置が崩れる。折り返しを Pango に任せないのは、
  禁則・行ごとの [行][文字] の並び・揃え方をこれまでのテキストと同じにするため）。

## 数学の補助（2026-11-11）

- 新しいライブラリは使っていない。プロジェクトのフォントは manimpango.register_font（Manim が使う manimpango の関数）で登録する。
- 定理のブロックは Tex の minipage で幅を決める（font_size 48 で TeX の 1pt ≈ 0.0498 単位を、manim 0.20.1 で測った）。
- 計算した点列は numpy で計算する（numpy は Manim と一緒に入る）。


## 実利用テストからの改善（2026-11-12）

- 新しいライブラリは使っていない。
- 角の印の内側・外側は、Manim の Angle が「1 本目の向きから反時計回り」に描くことから、線の向きで other_angle を決める（manim 0.20.1 の Angle で確認）。
- LaTeX で組む欄で消える文字は、XeLaTeX ＋ zxjatype・IPAex（このアプリの TexTemplate）で「Missing character」になる文字を確かめて決めた
  （Unicode の添字・上付き ⁰⁴〜⁹、ギリシャ文字、∠ △ ≦ などの数学の記号、①・Ⅰ。¹²³ は表示される）。
- 線形変換の平面の切り取りは、変換の前後の点を補間してコマごとに四角形で切る（UpdateFromAlphaFunc。manim 0.20.1 で確認）。

## 実利用テスト（2 回目）からの改善（2026-11-17）

- 新しいライブラリは使っていない。
- 固定のプリアンブルに `\def\pgfsysdriver{pgfsys-dvisvgm.def}` を足した（TikZ を読み込まなければ何もしない）。
  TikZ を使うプロジェクトでは、書き出す .py の頭で `SingleStringMathTex.__init__` を包み、塗りの無い部品（TikZ の線）に
  SVG の線の太さ（pt × font_size / 9.6）を付ける（app/tikzfix.py。manim 0.20.1 の SingleStringMathTex の引数の並びに合わせている）。
- 書体「ゴシック」は zxjatype の `\setjamainfont{IPAexGothic}` と `\renewcommand{\familydefault}{\sfdefault}`。
- 環境チェックの「音声の出力先」は、PySide6 の QMediaDevices.audioOutputs() と QMediaPlayer・QAudioOutput の準備を子プロセスで試す
  （出力先の無い Linux では、この準備で異常終了することを確認）。
- 部品はユーザー設定の `parts/<id>.json`、プロジェクトの写しは project.json の `parts`。

## Windows での確認からの修正（2026-11-18）

- 新しいライブラリは使っていない。
- 「このスライドを試す」のキーを F11 から Ctrl+Enter に変えた（Windows の Chrome・Edge は F11 を全画面に使い、ページに届かない）。
- フォントの読み替えは app/fonts.py の resolve（プリセットの候補のうち、Pango が認識するものを先頭から）。PC のフォントの一覧も Pango のファミリー名（@ で始まる縦書き用の名前は除く）。
- LaTeX の文章の改行の規則（`\begin`・`\end`・`\item` の前後に `\\` を付けない、空の行は `~`）は、manim 0.20.1 ＋ XeLaTeX で enumerate（enumitem のオプション付きも）・空の行を含む例を描画して確かめた。
- 発表のときの音声の出力先の確認は、環境チェックの check_audio（子プロセス）を発表ウィンドウの起動と同時に走らせる。
  この Linux の環境（音声のサービスが無い）では、QMediaDevices.audioOutputs() を呼ぶとプロセスが異常終了（Segmentation fault）することを確かめたため、発表ウィンドウの中では呼ばない。

## 動く画像（2026-11-18）

- 新しいライブラリは使っていない。動く画像のコマは Pillow（ImageSequence）で読み、PyAV（libx264）で mp4 にする。
- 画面でのコマ数の判定は、ブラウザの ImageDecoder（Chrome・Edge は 94 以降）。使えないブラウザでは、これまでどおり最初のコマの画像になる。
- 動画の全体をくり返すときは、発表ウィンドウでは QMediaPlayer.setLoops(Infinite)、試し描画と HTML では video.loop に任せる。
  終わりで止まってから初めに戻す方法では、Qt（6.12、FFmpeg の再生）が境目ごとに空のコマを出し、黒い画面が 1 コマ入ることを確かめた
  （6 秒・4 回のくり返しで空のコマ 4 つ。setLoops では 0）。
- 動画の枠は元の縦横比で作るので、発表ウィンドウでは QVideoWidget を IgnoreAspectRatio に、ブラウザでは object-fit: fill にした
  （大きさの丸めで枠と動画の比が 1% ほど違い、左右に黒い帯が出ていた）。

## 3D・統計・定理の確認からの修正（2026-11-19）

- 新しいライブラリは使っていない。
- manim 0.20.1 の ThreeDCamera は、回転の行列（rotation_matrix）をコマを描くときにだけ作り直す。描いた動きのあとは「最後の 1 つ前のコマ」の向き、
  キャッシュで飛ばした動きのあとは終わりの向きになり、次の動きのハッシュが変わって描き直しになる（2 回目の描画でも、最初の 1 つの動きしか
  キャッシュが効かない）ことを確かめた。書き出す ThreeDSlide の play で reset_rotation_matrix() を呼んでそろえると、2 回目以降の描画で
  カメラの動き・「カメラをずっと回す」の 1 周がキャッシュから使われる（Rotate のハッシュは別の理由で交互に変わるが、生成するコードではあまり使わない）。
- 回る曲面（24×24）の描画時間の目安（2 コア）: 動き 1 秒あたり 720p30 で 8 秒、1080p60 で 17 秒（40×40 の「細かい」で 34 秒）。
- Manim の Cone の底面（show_base）・Cylinder の端（show_ends）は Circle 1 枚で、Cairo の 3D の並べ替え（面ごとの中心の距離）で手前に描かれる。
  細かく分けた円板の Surface にして直した。Cube・Prism も大きな正方形 6 枚なので、細かく分けた Surface にした。
- Manim の Axes は exclude_origin_tick で目盛りの 0（線と数）を必ず省く。統計のグラフでは、作ったあとに 0 を入れて作り直す。
- 中ボタンのドラッグの外形は、Manim の ThreeDCamera と同じ式（Rz(γ)·Rx(−φ)·Rz(−θ−90°)、焦点距離 20）で画面で計算する（Manim の行列と一致することを確かめた）。
- manim 0.20.1 の ThreeDCamera は、frame_center を project_points と Camera.get_cairo_context（Cairo の座標の変換）の両方で引き、
  Cairo の変換は画素の配列ごとに作って使い回す。そのため、最初のコマの中心は 2 回、あとで変えた中心は 1 回だけ効く
  （スライド 1 で中心 (−2.03, −1.17) にすると、中心を 0 に戻したスライド 2・3 の立体が 0.5 でなく 0.641 の位置に出た）ことを確かめた。
  frame_center を Cairo・画像の側では原点にし、project_points だけで引くカメラ（shapekit の _gui_three_d_camera_class）にした。
  Manim のキャッシュのハッシュはカメラの属性（__dict__）から作られ、クラスは入らないので、属性 gui_camera_fix を持たせて古い部分の動画を使わない。
- キャンバスの 3D をまとめて描くときは、常駐のプレビューのプロセスで、要素ごとの Manim の物を作って ThreeDCamera.capture_mobjects にまとめて渡す
  （ThreeDCamera が、すべての物の面を z の順に並べ替えて描く。描画と同じ）。


## 使い方の案内とインストーラー（2026-11-20）

- environment.yml は、micromamba 2.10.0 の `create --dry-run --platform win-64` で、conda-forge から Windows（win-64）用に解けることを確かめた（229 個・取得 429 MB）。
  インストーラーは pip の部分を除いた environment.conda.yml で作り、manim-slides は post_install.py が `pip install --no-deps` で入れる。
- micromamba は、実行ファイルの名前が micromamba（.exe）でないと `run` が動かない（「unknown MAMBA_EXE」）。インストーラーは micromamba.exe の名前で置く。
- Chromium で PDF にすると、漢字と部首（U+2F00〜）が同じ字形を指すフォント（Noto Sans CJK・IPAex など）では、PDF の文字の対応に部首が入り
  （「用」が「⽤」）、PDF の中の検索・コピーで別の文字になる。説明書の PDF は、部首の対応を外したフォントの写し（fontTools）で作る（部首 0 個を確かめた）。
- NSIS の nsExec::ExecToLog は、子の出力を ANSI のコードページとして読むので、post_install.py は Windows では mbcs で書く。
- アプリの窓が閉じたことは、タイマーの送信ではなく EventSource のつながりで知る（窓を最小化すると、Chromium はタイマーを 1 分に 1 回まで遅らせるため）。
- 取得先は、作業環境から実際に取得できることを確かめた: micromamba-win-64（GitHub の releases/latest/download。11.7 MB の PE32+）、Noto Sans JP / Serif JP の SubsetOTF（raw.githubusercontent.com。ファミリー名 Noto Sans JP・Noto Serif JP）、
  conda-forge（conda.anaconda.org）。TeX Live の install-tl.zip（mirror.ctan.org/systems/texlive/tlnet/）は作業環境のネットワークの制限で取得できなかったため、
  TeX Live の説明書（既定の取得先が https://mirror.ctan.org/systems/texlive/tlnet）と、CTAN のミラーの一覧（2026-10-05 の install-tl.zip）で確かめた。
- （2026-11-20 追記）インストーラーで作った環境では、Manim Slides が `No module named 'jinja2'` で動かなかった。開発用の conda 環境にはたまたま jinja2 が入っていたが、
  manim-slides の依存（jinja2・requests・rich・tqdm・platformdirs・click）を conda で入れていなかったうえ、pip を `--no-deps` で動かしていたため。
  environment.yml にこれらを足し、pip は依存を補う形（`--no-deps` なし）にして、最後に `pip check` の結果を詳細の欄に出す。
  作業環境で、environment.conda.yml から新しく作った環境＋pip の手順で、アプリの環境チェックの Manim・Manim Slides・Qt・PyAV・Pillow が ✓ になることを確かめた（win-64 の解決も確認）。
