"""インストーラー（NSIS）が、conda 環境を作ったあとに、その環境の python.exe で動かす仕上げの処理。

    python post_install.py activation --install DIR --micromamba EXE
    python post_install.py pip --install DIR
    python post_install.py fonts --install DIR
    python post_install.py detect-tex --install DIR        # 見つかれば 0、無ければ 2
    python post_install.py install-tex --install DIR
    python post_install.py tex-extras --install DIR

出力は 1 行ずつ、インストーラーの「詳細」の欄に出る。失敗したときは、0 でない終了コードを返す。
ネットからの取得先（どれも確かめたもの）:
- Noto Sans JP / Noto Serif JP: https://raw.githubusercontent.com/notofonts/noto-cjk/main/ の SubsetOTF/JP
- TeX Live のネットインストーラー: https://mirror.ctan.org/systems/texlive/tlnet/install-tl.zip（近くのミラーへ自動で転送される）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
FONT_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/"
FONTS = [  # (ファイル, 取得先, 登録する名前)
    ("NotoSansJP-Regular.otf", "Sans/SubsetOTF/JP/NotoSansJP-Regular.otf", "Noto Sans JP Regular (OpenType)"),
    ("NotoSansJP-Bold.otf", "Sans/SubsetOTF/JP/NotoSansJP-Bold.otf", "Noto Sans JP Bold (OpenType)"),
    ("NotoSerifJP-Regular.otf", "Serif/SubsetOTF/JP/NotoSerifJP-Regular.otf", "Noto Serif JP Regular (OpenType)"),
    ("NotoSerifJP-Bold.otf", "Serif/SubsetOTF/JP/NotoSerifJP-Bold.otf", "Noto Serif JP Bold (OpenType)"),
]
INSTALL_TL_URL = "https://mirror.ctan.org/systems/texlive/tlnet/install-tl.zip"
# TeX Live の中身（スキームではなく、要るものだけ。説明書は入れない）
TEX_COLLECTIONS = ["collection-basic", "collection-latex", "collection-latexrecommended", "collection-fontsrecommended",
                   "collection-xetex", "collection-langcjk", "collection-langjapanese", "collection-langenglish",
                   "collection-pictures", "collection-wintools"]
# Manim と、このアプリが使う物（コレクションに無くても入るように、あとで tlmgr で足す）
TEX_EXTRAS = ["standalone", "preview", "dvisvgm", "babel-english", "amsfonts", "xcolor", "zxjatype", "zxjafont", "ipaex",
              "xecjk", "doublestroke", "relsize", "physics", "rsfs", "setspace", "wasysym", "mathtools", "jknapltx",
              "fundus-calligra", "chemfig"]


def say(*a: object) -> None:
    print(*a, flush=True)


def download(url: str, dst: Path, label: str) -> None:
    """取得（3 回までやり直す）。進み具合を 10% ごとに書く。"""
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ManimSlideGUI-installer"})
            with urllib.request.urlopen(req, timeout=60) as r, open(dst.with_suffix(dst.suffix + ".part"), "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                got, step = 0, 10
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    if total and got * 100 // total >= step:
                        say(f"  {label}: {got * 100 // total}%（{got / 1e6:.0f} / {total / 1e6:.0f} MB）")
                        step += 10
            dst.with_suffix(dst.suffix + ".part").replace(dst)
            return
        except OSError as e:
            say(f"  {label} の取得に失敗しました（{attempt} 回目）: {e}")
            time.sleep(3 * attempt)
    raise SystemExit(f"{label} を取得できませんでした。インターネットへの接続を確かめて、もう一度インストーラーを実行してください。")


# ---------------------------------------------------------------- conda の activate と同じ環境変数

def cmd_activation(a: argparse.Namespace) -> int:
    inst = Path(a.install)
    env = inst / "env"
    dump = "import os, json; print('@@ENV@@' + json.dumps(dict(os.environ)))"
    p = subprocess.run([a.micromamba, "run", "-r", str(inst / "mamba"), "-p", str(env), "python", "-c", dump],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    m = re.search(r"@@ENV@@(\{.*\})", p.stdout)
    if p.returncode or not m:
        say("環境変数を調べられませんでした:", p.stderr[-2000:])
        return 1
    act = json.loads(m.group(1))
    base = os.environ
    key = (lambda k: k.upper()) if sys.platform == "win32" else (lambda k: k)
    base_u = {key(k): v for k, v in base.items()}
    cur_path = [x.lower() for x in base.get("PATH", "").split(os.pathsep)]
    path_k = next((k for k in act if key(k) == "PATH"), "PATH")
    prepend = []
    for x in act.get(path_k, "").split(os.pathsep):
        if x and x.lower() not in cur_path and x not in prepend:
            prepend.append(x)
    skip = {"PATH", "PROMPT", "CONDA_PROMPT_MODIFIER", "PS1", "_", "SHLVL", "PWD", "OLDPWD"}
    sets = {k: v for k, v in act.items() if key(k) not in skip and base_u.get(key(k)) != v}
    (inst / "activation.json").write_text(json.dumps({"path_prepend": prepend, "set": sets}, ensure_ascii=False, indent=1), encoding="utf-8")
    say(f"環境変数を記録しました（PATH に {len(prepend)} 個、ほか {len(sets)} 個）")
    return 0


# ---------------------------------------------------------------- pip で入れる物（conda-forge に無い物）

def cmd_pip(a: argparse.Namespace) -> int:
    yml = (Path(a.install) / "app" / "environment.yml").read_text(encoding="utf-8")
    specs, in_pip = [], False
    for line in yml.splitlines():
        s = line.split("#", 1)[0].rstrip()
        if re.match(r"^\s*-\s*pip:\s*$", s):
            in_pip = True
            continue
        if in_pip:
            m = re.match(r"^\s{4,}-\s*(\S+)\s*$", s)
            if m:
                specs.append(m.group(1))
            elif s.strip() and not s.startswith("      "):
                in_pip = False
    if not specs:
        return 0
    say("pip で入れます:", " ".join(specs))
    # 依存は conda で入れてあるが、足りない物があれば pip が補う（--no-deps にすると、足りないまま入ってしまう）
    p = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", *specs], creationflags=NOWIN)
    if p.returncode:
        return p.returncode
    chk = subprocess.run([sys.executable, "-m", "pip", "check", "--disable-pip-version-check"], capture_output=True, text=True,
                         encoding="utf-8", errors="replace", creationflags=NOWIN)
    say("部品の依存の確認:", (chk.stdout or chk.stderr).strip()[-1500:])
    return 0  # 確認の結果は詳細の欄に出すだけ（このアプリと関係の無い部品の指摘で、入れるのを止めないように）


# ---------------------------------------------------------------- フォント（このユーザーだけ。管理者の権限は要らない）

def _installed_fonts() -> set[str]:
    names: set[str] = set()
    if sys.platform != "win32":
        return names
    import winreg
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts") as k:
                i = 0
                while True:
                    try:
                        n, _, _ = winreg.EnumValue(k, i)
                    except OSError:
                        break
                    names.add(n.lower())
                    i += 1
        except OSError:
            pass
    return names


def cmd_fonts(a: argparse.Namespace) -> int:
    if sys.platform != "win32":
        say("（Windows でだけ入れます）")
        return 0
    import ctypes
    import winreg
    have = _installed_fonts()
    fdir = Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts"
    fdir.mkdir(parents=True, exist_ok=True)
    added = 0
    for fname, src, reg in FONTS:
        family = reg.rsplit(" (", 1)[0].lower()
        if any(n.startswith(family) for n in have):
            say(f"{reg.split(' (')[0]}: 入っています")
            continue
        dst = fdir / fname
        if not dst.exists():
            download(FONT_BASE + src, dst, fname)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts") as k:
            winreg.SetValueEx(k, reg, 0, winreg.REG_SZ, str(dst))
        ctypes.windll.gdi32.AddFontResourceW(str(dst))
        say(f"{reg.split(' (')[0]}: 入れました")
        added += 1
    if added:
        HWND_BROADCAST, WM_FONTCHANGE = 0xFFFF, 0x001D
        ctypes.windll.user32.SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, 0x0002, 3000, None)
    # conda の fontconfig（Pango が使う）にも、このユーザーのフォントの場所を教える
    conf_d = Path(a.install) / "env" / "Library" / "etc" / "fonts" / "conf.d"
    if conf_d.is_dir():
        (conf_d / "99-manim-slide-gui-userfonts.conf").write_text(
            '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
            f"  <dir>{fdir.as_posix()}</dir>\n</fontconfig>\n", encoding="utf-8")
    return 0


# ---------------------------------------------------------------- TeX Live

def _paths_file(a: argparse.Namespace) -> Path:
    return Path(a.install) / "paths.json"


def _write_texbin(a: argparse.Namespace, texbin: str) -> None:
    f = _paths_file(a)
    data = {}
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    data["texbin"] = texbin
    f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _tex_candidates() -> list[Path]:
    out = []
    local = os.environ.get("LOCALAPPDATA", "")
    for root in (Path(local) / "Programs" / "texlive", Path("C:/texlive")):
        out += sorted(root.glob("*/bin/windows"), reverse=True) + sorted(root.glob("bin/windows")) + sorted(root.glob("*/bin/win32"), reverse=True)
    return out


def cmd_detect_tex(a: argparse.Namespace) -> int:
    exe = "xelatex.exe" if sys.platform == "win32" else "xelatex"
    found = shutil.which("xelatex")
    if not found:
        for b in _tex_candidates():
            if (b / exe).exists():
                found = str(b / exe)
                break
    if found:
        _write_texbin(a, str(Path(found).parent))
        say("TeX（xelatex）が見つかりました:", found)
        return 0
    say("TeX（xelatex）は見つかりませんでした")
    return 2


def tex_dir() -> Path:
    """TeX Live を入れる場所。日本語・空白の入った場所は TeX でうまく動かないことがあるので、そのときは C:\\texlive。"""
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Programs" / "texlive"
    s = str(local)
    if s.isascii() and " " not in s:
        return local
    alt = Path("C:/texlive")
    try:
        alt.mkdir(parents=True, exist_ok=True)
        return alt
    except OSError:
        return local


def cmd_install_tex(a: argparse.Namespace) -> int:
    if sys.platform != "win32":
        say("（Windows でだけ入れます）")
        return 0
    target = tex_dir()
    t = target.as_posix()
    say(f"TeX Live を {target} に入れます（日本語と数式に要る分。1 GB ほどの取得で、30 分〜1 時間ほどかかります）")
    with tempfile.TemporaryDirectory(prefix="msg-tl-") as tmp:
        tmpd = Path(tmp)
        z = tmpd / "install-tl.zip"
        download(INSTALL_TL_URL, z, "install-tl.zip")
        with zipfile.ZipFile(z) as zf:
            zf.extractall(tmpd)
        bats = sorted(tmpd.glob("install-tl-*/install-tl-windows.bat"))
        if not bats:
            say("install-tl-windows.bat が見つかりません")
            return 1
        prof = tmpd / "manim-slide-gui.profile"
        lines = ["selected_scheme scheme-custom", f"TEXDIR {t}", f"TEXMFLOCAL {t}/texmf-local", f"TEXMFSYSVAR {t}/texmf-var",
                 f"TEXMFSYSCONFIG {t}/texmf-config", f"TEXMFVAR {t}/texmf-var", f"TEXMFCONFIG {t}/texmf-config",
                 f"TEXMFHOME {t}/texmf-home", "binary_windows 1", *[f"{c} 1" for c in TEX_COLLECTIONS],
                 "instopt_adjustpath 1", "instopt_adjustrepo 1", "instopt_letter 0", "instopt_portable 0",
                 "instopt_write18_restricted 1", "tlpdbopt_autobackup 1", "tlpdbopt_backupdir tlpkg/backups",
                 "tlpdbopt_create_formats 1", "tlpdbopt_desktop_integration 0", "tlpdbopt_file_assocs 0",
                 "tlpdbopt_generate_updmap 0", "tlpdbopt_install_docfiles 0", "tlpdbopt_install_srcfiles 0",
                 "tlpdbopt_post_code 1", "tlpdbopt_w32_multi_user 0"]
        prof.write_text("\n".join(lines) + "\n", encoding="ascii")
        say("TeX Live のインストーラーを動かします（パッケージを 1 つずつ取得します）…")
        p = subprocess.run(["cmd", "/c", str(bats[0]), "-no-gui", "-non-admin", "-profile", str(prof)], cwd=str(bats[0].parent),
                           creationflags=NOWIN)
        if p.returncode:
            say(f"TeX Live のインストーラーが失敗しました（{p.returncode}）。")
            return p.returncode
    texbin = target / "bin" / "windows"
    if not (texbin / "xelatex.exe").exists():
        say("xelatex が見つかりません:", texbin)
        return 1
    _write_texbin(a, str(texbin))
    return cmd_tex_extras(a)


def cmd_tex_extras(a: argparse.Namespace) -> int:
    """Manim とこのアプリが使うパッケージを足す（入っていれば何もしない）。"""
    texbin = None
    try:
        texbin = json.loads(_paths_file(a).read_text(encoding="utf-8")).get("texbin")
    except (OSError, json.JSONDecodeError):
        pass
    tlmgr = Path(texbin) / ("tlmgr.bat" if sys.platform == "win32" else "tlmgr") if texbin else None
    if not tlmgr or not tlmgr.exists():
        say("tlmgr が無いので、パッケージの追加は飛ばします（TeX Live でない TeX のときは、足りない物は自動で入ることがあります）")
        return 0
    say("TeX のパッケージを確かめます:", " ".join(TEX_EXTRAS))
    p = subprocess.run(["cmd", "/c", str(tlmgr), "install", *TEX_EXTRAS] if sys.platform == "win32" else [str(tlmgr), "install", *TEX_EXTRAS],
                       creationflags=NOWIN)
    if p.returncode:
        say("一部のパッケージを入れられませんでした（あとで描画のエラーに入れ方が出ます）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["activation", "pip", "fonts", "detect-tex", "install-tex", "tex-extras"])
    ap.add_argument("--install", required=True)
    ap.add_argument("--micromamba", default="")
    a = ap.parse_args()
    if sys.platform == "win32":
        # インストーラーの「詳細」の欄（nsExec）は、出力を ANSI のコードページ（日本語の Windows では CP932）として読む
        for s in (sys.stdout, sys.stderr):
            try:
                s.reconfigure(encoding="mbcs", errors="replace")
            except (AttributeError, ValueError, LookupError):
                pass
    return {"activation": cmd_activation, "pip": cmd_pip, "fonts": cmd_fonts, "detect-tex": cmd_detect_tex,
            "install-tex": cmd_install_tex, "tex-extras": cmd_tex_extras}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
