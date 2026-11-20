"""描画時のエラーを、GUI 上の位置（スライド・要素・ステップ・コード欄の行）へ変換する。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .texlog import parse_tex_log


def _load_map(folder: Path, cls: str) -> dict[str, Any]:
    p = folder / f"{cls}.map.json"
    if not p.exists():
        return {"lines": {}}
    return json.loads(p.read_text(encoding="utf-8"))


def _same_file(a: str, b: Path) -> bool:
    try:
        return Path(a).resolve() == b.resolve()
    except OSError:
        return Path(a).name == b.name


def locate(result: dict[str, Any], folder: Path, cls: str) -> dict[str, Any]:
    """render_runner の結果 JSON から、GUI に見せるエラー情報を作る。"""
    py = folder / f"{cls}.py"
    mapping = _load_map(folder, cls)
    lines_map: dict[str, Any] = mapping.get("lines", {})
    frames = result.get("frames") or []
    user_frames = [f for f in frames if _same_file(f.get("file", ""), py)]
    info: dict[str, Any] = {
        "message": result.get("message") or "描画中にエラーが起きました。",
        "traceback": result.get("traceback", ""),
        "location": None,
        "pyLine": None,
        "tex": None,
    }
    if user_frames:
        f = user_frames[-1]  # 生成した .py の中で最も深い位置
        info["pyLine"] = f["line"]
        # 補助関数（gui_text など）の中で起きたエラーは、それを呼び出した要素・ステップの行へ対応づける
        for fr in reversed(user_frames):
            origin = lines_map.get(str(fr["line"]))
            if origin:
                info["location"] = origin
                break
    # LaTeX のコンパイルエラー
    log_path = result.get("texLog")
    if log_path:
        info["tex"] = _tex_error(Path(log_path) if Path(log_path).is_absolute() else folder / log_path)
        if info["tex"] and info["tex"].get("preambleLine"):
            info["location"] = {"kind": "preamble", "preambleLine": info["tex"]["preambleLine"],
                                **({"elementId": info["location"].get("elementId"), "var": info["location"].get("var"),
                                    "slideIndex": info["location"].get("slideIndex")} if info["location"] else {})}
    info["summary"] = summarize(info)
    info["hint"] = known_hint(info["message"], info["traceback"])
    if not info["hint"] and info.get("tex") and info["tex"].get("missing"):
        # 見つからない LaTeX のパッケージ（プリアンブルで使ったもの）。場所の案内はそのまま残す
        from .envcheck import missing_hint
        info["texHint"] = missing_hint(f"（見つからないファイル: {'、'.join(info['tex']['missing'])}）", "")
    if info["hint"]:
        info["location"] = None  # 環境の問題なので、コードの位置へは案内しない
        info["summary"] = "描画の環境の問題です（スライドの内容の問題ではありません）"
    return info


def known_hint(message: str, tb: str) -> str:
    """よく知られた環境の問題なら、直し方を返す。"""
    if "Invalid mode for data type" in message:  # Pillow の Image.fromarray が出すメッセージ
        return ('Pillow 13 では、manim 0.20.1 が画像を描けません。conda 環境で conda install -c conda-forge "pillow<13" を実行して '
                "Pillow 12 に戻し、アプリを起動し直してください（スライドの内容の問題ではありません）。")
    if "write_to_movie" in message:
        return "manim 0.22 系は manim-slides 5.7.0 と組み合わせて使えません。conda install -c conda-forge manim=0.20.1 で戻してください。"
    return ""


def _tex_error(log_path: Path) -> dict[str, Any] | None:
    if not log_path.exists():
        return {"errors": [], "logFile": str(log_path)}
    log = log_path.read_text(encoding="utf-8", errors="replace")
    errors = parse_tex_log(log)
    out: dict[str, Any] = {"errors": errors, "logFile": str(log_path)}
    from .envcheck import missing_files
    miss = missing_files(log)
    if miss:
        out["missing"] = miss
    tex_path = log_path.with_suffix(".tex")
    if tex_path.exists() and errors and errors[0].get("line"):
        tex_lines = tex_path.read_text(encoding="utf-8", errors="replace").split("\n")
        n = errors[0]["line"]
        try:
            begin = next(i for i, l in enumerate(tex_lines, start=1) if l.strip().startswith(r"\begin{document}"))
        except StopIteration:
            begin = None
        if begin and n < begin:
            # プリアンブル内のエラー → preamble.tex の行を探す
            marker = next((i for i, l in enumerate(tex_lines, start=1) if l.strip() == "% ---- preamble.tex ----"), None)
            tail = next((i for i, l in enumerate(tex_lines, start=1) if l.strip() == "% ---- （GUI が足す）----"), None)
            if marker and n > marker and (tail is None or n < tail):
                out["preambleLine"] = n - marker
        out["texLine"] = n
        out["texSource"] = tex_lines[n - 1] if 0 < n <= len(tex_lines) else ""
    return out


def summarize(info: dict[str, Any]) -> str:
    loc = info.get("location")
    if not loc:
        return "エラーの位置を特定できませんでした（生成コードの部分か、Manim 内部のエラーです）。トレースバックの全文を確認してください。"
    kind = loc.get("kind")
    s = loc.get("slideIndex")
    sl = f"スライド{s + 1}" if s is not None else ""
    if kind == "step":
        if loc.get("gui"):
            return f"{sl} / ステップ{loc['slideStepNo']} / コードの {loc['codeLine']}行目"
        return f"{sl} / 要素 `{loc['var']}` / ステップ{loc['stepNo']} / {loc['codeLine']}行目"
    if kind == "element":
        what = "数式" if info.get("tex") else "要素"
        return f"{sl} / {what} `{loc['var']}` の作成時"
    if kind == "preamble":
        tail = f"（{sl} / 数式 `{loc['var']}` の描画時に検出）" if loc.get("var") else ""
        return f"共通プリアンブル {loc['preambleLine']}行目{tail}"
    if kind == "slide":
        return f"{sl} の切り替え部分（GUI が生成したコード）"
    return "位置不明"


_ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def strip_ansi(s: str) -> str:
    return _ANSI.sub("", s)
