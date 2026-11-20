"""Windows 用のインストーラー（dist/ManimSlideGUI-Setup-<版>.exe）を作る（開発用。Linux でも作れる）。

    python installer/build_installer.py

要るもの: makensis（NSIS 3。Ubuntu なら apt install nsis）。説明書（docs/manual）は先に scripts/build_manual.py で作っておく。
アプリのファイルを build/stage に並べ（キャッシュ・描画の結果などは入れない）、conda の部品だけの environment.conda.yml を作ってから、
makensis で 1 つの exe にする。
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import __version__

STAGE = ROOT / "build" / "stage"
DIST = ROOT / "dist"
SKIP_DIRS = {"__pycache__", ".ruff_cache", ".pytest_cache", "media", ".mypy_cache"}
INCLUDE = ["app", "static", "docs/help", "docs/manual", "run.py", "launcher.pyw", "environment.yml", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md",
           "installer/post_install.py"]


def _ignore(_dir: str, names: list[str]) -> list[str]:
    return [n for n in names if n in SKIP_DIRS or n.endswith((".pyc", ".pyo"))]


def conda_only(yml: str) -> str:
    """environment.yml から pip の部分を除いたもの（pip の部品は post_install.py が入れる）。"""
    out, skip = [], False
    for line in yml.splitlines():
        if re.match(r"^\s*-\s*pip:\s*$", line):
            skip = True
            continue
        if skip:
            if re.match(r"^\s{4,}(-|#)", line) or not line.strip():
                continue
            skip = False
        out.append(line)
    return "\n".join(out).rstrip() + "\n"


def stage() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    for rel in INCLUDE:
        src = ROOT / rel
        dst = STAGE / rel
        if not src.exists():
            raise SystemExit(f"見つかりません: {rel}（docs/manual は scripts/build_manual.py で作ります）")
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, ignore=_ignore)
        else:
            shutil.copy2(src, dst)
    (STAGE / "environment.conda.yml").write_text(conda_only((ROOT / "environment.yml").read_text(encoding="utf-8")), encoding="utf-8")
    for need in ("docs/manual/manual.pdf", "docs/manual/manual.html", "static/vendor"):
        if not (STAGE / need).exists():
            raise SystemExit(f"配布に要るファイルがありません: {need}")


def main() -> None:
    makensis = shutil.which("makensis")
    if not makensis:
        raise SystemExit("makensis が見つかりません（NSIS 3 を入れてください）。")
    stage()
    DIST.mkdir(exist_ok=True)
    out = DIST / f"ManimSlideGUI-Setup-{__version__}.exe"
    cmd = [makensis, "-V2", f"-DVERSION={__version__}", f"-DSTAGE={STAGE}", f"-DOUTFILE={out}", str(ROOT / "installer" / "ManimSlideGUI.nsi")]
    subprocess.run(cmd, check=True)
    print(f"作りました: {out}（{out.stat().st_size / 1e6:.1f} MB）")


if __name__ == "__main__":
    main()
