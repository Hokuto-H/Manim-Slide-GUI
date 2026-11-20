"""同梱ライブラリ（Fabric.js・MathJax）を npm のレジストリから取り直す。

通常は不要（static/vendor に同梱済み）。版を上げるときだけ使う。インターネットに接続する。

    python scripts/fetch_vendor.py
"""

from __future__ import annotations

import io
import json
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "static" / "vendor"

PACKAGES = {
    "fabric": "7.4.0",
    "mathjax": "4.1.3",
    "@mathjax/mathjax-newcm-font": "4.1.3",
}


def fetch(name: str, version: str) -> tarfile.TarFile:
    meta_url = f"https://registry.npmjs.org/{name.replace('/', '%2F')}/{version}"
    with urllib.request.urlopen(meta_url) as r:
        tarball = json.load(r)["dist"]["tarball"]
    with urllib.request.urlopen(tarball) as r:
        data = r.read()
    return tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")


def extract(tf: tarfile.TarFile, members: list[str], dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for m in tf.getmembers():
        rel = m.name.split("/", 1)[1] if "/" in m.name else m.name
        if not any(rel == x or rel.startswith(x.rstrip("/") + "/") for x in members):
            continue
        if not m.isfile() or ".." in Path(rel).parts:
            continue
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        with tf.extractfile(m) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)


def main() -> None:
    tf = fetch("fabric", PACKAGES["fabric"])
    tmp = VENDOR / "_fabric_tmp"
    extract(tf, ["dist/index.min.js", "LICENSE"], tmp)
    (VENDOR / "fabric").mkdir(parents=True, exist_ok=True)
    shutil.copy(tmp / "dist" / "index.min.js", VENDOR / "fabric" / "fabric.min.js")
    shutil.copy(tmp / "LICENSE", VENDOR / "fabric" / "LICENSE")
    shutil.rmtree(tmp)

    tf = fetch("mathjax", PACKAGES["mathjax"])
    shutil.rmtree(VENDOR / "mathjax", ignore_errors=True)
    extract(tf, ["LICENSE", "package.json", "tex-svg.js", "core.js", "loader.js", "startup.js",
                 "input", "output", "ui", "a11y", "adaptors", "sre"], VENDOR / "mathjax")

    tf = fetch("@mathjax/mathjax-newcm-font", PACKAGES["@mathjax/mathjax-newcm-font"])
    dest = VENDOR / "mathjax-fonts" / "mathjax-newcm-font"
    shutil.rmtree(dest, ignore_errors=True)
    extract(tf, ["svg", "svg.js", "package.json"], dest)
    shutil.copy(VENDOR / "mathjax" / "LICENSE", dest / "LICENSE")
    print("取得しました:", ", ".join(f"{k} {v}" for k, v in PACKAGES.items()))


if __name__ == "__main__":
    main()
