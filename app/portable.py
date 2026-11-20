"""プロジェクトの持ち運び: 1 つの zip に固める・zip から取り込む。

zip の中身: <プロジェクトのフォルダ名>/ の下に、選んだものだけを入れる。
  いつも入れる : project.json・preamble.tex・images/・clips/・media/record.json（録画の設定）
  選んで入れる : 描画の結果（slides/・media/・生成した .py など）・バックアップ・録画・リハーサルの記録・書き出したファイル
  入れない     : unused/（ファイルの整理で移したもの）・.posters などの「.」で始まるフォルダ（作り直せるもの）・__pycache__
加えて <フォルダ名>/.portable/env.json に、作った環境の情報（使っているフォントと LaTeX のパッケージ、
アプリ・Manim・Manim Slides・Python の版、OS）を入れる。取り込むときに今の環境と見比べる（このファイルは取り出さない）。
"""

from __future__ import annotations

import json
import platform
import re
import shutil
import subprocess
import sys
import time
import uuid
import zipfile
from importlib import metadata
from pathlib import Path
from typing import Any

from . import __version__, fonts
from .constants import FORMAT_VERSION, JP_FIXED_PREAMBLE, JP_TAIL_PREAMBLE, MANIM_DEFAULT_PREAMBLE, PREAMBLE_FILE, PROJECT_FILE

ENV_PATH = ".portable/env.json"

# 選んで入れるもの（キー → 表示名）
OPTIONAL = {
    "fonts": "プロジェクトのフォント（fonts/）— フォントのライセンスで、ほかの人に渡してよいかを確かめてから入れてください",
    "render": "描画の結果（slides/・media/・生成した .py）",
    "backups": "バックアップ（backups/）",
    "recordings": "録画（recordings/）",
    "rehearsals": "リハーサルの記録（rehearsals/）",
    "export": "書き出したファイル（export/）",
}
DEFAULT_INCLUDE = {"fonts": False, "render": False, "backups": False, "recordings": False, "rehearsals": True, "export": False}

_STORED = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".png", ".jpg", ".jpeg", ".gif", ".webp",
           ".zip", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".pdf"}


class PortableError(Exception):
    pass


# ---------------------------------------------------------------- 中身の分類

def _category(rel: Path) -> str | None:
    """プロジェクトのフォルダからの相対パス → "core"・OPTIONAL のキー・None（入れない）。"""
    parts = rel.parts
    if not parts:
        return None
    if any(p.startswith(".") or p == "__pycache__" for p in parts):
        return None
    top = parts[0]
    if len(parts) == 1:
        if top in (PROJECT_FILE, PREAMBLE_FILE):
            return "core"
        if rel.suffix == ".py" or top.endswith((".map.json", ".segs.json", ".deck.json")):
            return "render"
        return None  # そのほかの、フォルダの直下のファイルは入れない
    if top in ("images", "clips"):
        return "core"
    if top == "fonts":
        return "fonts"  # フォントは、配ってよいとは限らないので選んで入れる
    if top == "media":
        return "core" if parts[1:] == ("record.json",) else "render"
    if top == "slides":
        return "render"
    if top in ("backups", "recordings", "rehearsals", "export"):
        return top
    return None  # unused/ など


def _walk(folder: Path):
    for p in sorted(folder.rglob("*")):
        if p.is_file() and not p.is_symlink():
            rel = p.relative_to(folder)
            cat = _category(rel)
            if cat:
                yield p, rel, cat


def summary(folder: Path) -> dict[str, Any]:
    """書き出しの画面に出す、分類ごとのファイルの数と大きさ。"""
    sizes: dict[str, list[int]] = {k: [0, 0] for k in ("core", *OPTIONAL)}
    for p, _rel, cat in _walk(folder):
        sizes[cat][0] += 1
        sizes[cat][1] += p.stat().st_size
    return {
        "name": folder.name,
        "groups": [{"key": "core", "label": "プロジェクト（project.json・preamble.tex・images/・clips/）", "always": True,
                    "count": sizes["core"][0], "bytes": sizes["core"][1]}]
                  + [{"key": k, "label": v, "always": False, "count": sizes[k][0], "bytes": sizes[k][1]} for k, v in OPTIONAL.items()],
    }


# ---------------------------------------------------------------- 環境の情報

def _strip_comments(tex: str) -> str:
    return "\n".join(re.sub(r"(?<!\\)%.*", "", line) for line in tex.splitlines())


def tex_packages(preamble: str) -> list[str]:
    """\\usepackage・\\RequirePackage で読み込むパッケージ名（アプリが自動で加えるものも含む）。"""
    text = "\n".join([*MANIM_DEFAULT_PREAMBLE, *JP_FIXED_PREAMBLE, _strip_comments(preamble or ""), *JP_TAIL_PREAMBLE])
    out: list[str] = []
    for m in re.finditer(r"\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}", text):
        for name in m.group(1).split(","):
            name = name.strip()
            if name and name not in out:
                out.append(name)
    return out


def used_fonts(project: dict[str, Any]) -> list[str]:
    """プロジェクトで使っているフォント（既定のフォントと、要素ごとに選んだもの）。"""
    found: list[str] = []

    def add(v: Any) -> None:
        if isinstance(v, str) and v.strip() and v.strip() not in found:
            found.append(v.strip())

    add((project.get("settings") or {}).get("defaultFont"))

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str) and (k == "font" or k.endswith("Font")) and k != "defaultFont":
                    add(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(project.get("slides") or [])
    walk(project.get("masters") or [])
    return found


def _ver(dist: str) -> str:
    try:
        return metadata.version(dist)
    except metadata.PackageNotFoundError:
        return ""


def environment() -> dict[str, str]:
    return {
        "app": __version__,
        "manim": _ver("manim"),
        "manim_slides": _ver("manim-slides"),
        "python": platform.python_version(),
        "os": f"{platform.system()} {platform.release()}".strip(),
    }


def env_info(folder: Path, with_fonts: bool = True) -> dict[str, Any]:
    project = json.loads((folder / PROJECT_FILE).read_text(encoding="utf-8"))
    pre = folder / PREAMBLE_FILE
    preamble = pre.read_text(encoding="utf-8") if pre.exists() else ""
    return {
        "format": FORMAT_VERSION,
        "name": (project.get("settings") or {}).get("name") or folder.name,
        "folder": folder.name,
        "created": time.strftime("%Y-%m-%d %H:%M"),
        "fonts": used_fonts(project),
        "projectFonts": _project_font_families(folder) if with_fonts else [],
        "packages": tex_packages(preamble),
        "versions": environment(),
    }


def _project_font_families(folder: Path) -> list[str]:
    """プロジェクトに入れたフォント（fonts/）のファミリー名（一覧を作ったときの控えから）。"""
    from . import projfonts
    try:
        cache = json.loads((projfonts.font_dir(folder) / projfonts.CACHE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return sorted({f for v in cache.values() for f in v.get("families") or []})


def _kpsewhich(names: list[str]) -> dict[str, bool] | None:
    exe = shutil.which("kpsewhich")
    if not exe or not names:
        return None if names else {}
    try:
        p = subprocess.run([exe, *[f"{n}.sty" for n in names]], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    hits = {Path(line.strip()).stem for line in p.stdout.splitlines() if line.strip()}
    return {n: n in hits for n in names}


def compare(info: dict[str, Any]) -> dict[str, Any]:
    """取り込んだ zip の環境と、今の環境の違い。"""
    fonts_res = []
    inside = set(info.get("projectFonts") or [])  # zip の中の fonts/ に入っているフォントは、そのまま使える
    for f in info.get("fonts") or []:
        alt = fonts.resolve(f)  # 同じ書体の別名（Noto Sans CJK JP と Noto Sans JP など）があれば、それで描く
        ok = True if f in inside else (fonts.is_installed(f) or (alt != f and fonts.is_installed(alt)))
        fonts_res.append({"name": f, "ok": ok, "bundled": f in inside, **({"as": alt} if alt != f and f not in inside else {})})
    pk = _kpsewhich(list(info.get("packages") or []))
    packages = [{"name": n, "ok": None if pk is None else pk.get(n)} for n in info.get("packages") or []]
    here = environment()
    there = info.get("versions") or {}
    labels = {"app": "アプリ", "manim": "Manim", "manim_slides": "Manim Slides", "python": "Python", "os": "OS"}
    versions = [{"key": k, "label": lab, "there": there.get(k, ""), "here": here.get(k, ""),
                 "same": (there.get(k, "") == here.get(k, "")) if there.get(k) else None} for k, lab in labels.items()]
    return {
        "fonts": fonts_res,
        "packages": packages,
        "texChecked": pk is not None,
        "versions": versions,
        "problems": sum(1 for x in fonts_res + packages if x["ok"] is False)
                    + sum(1 for v in versions if v["key"] in ("manim", "manim_slides") and v["same"] is False),
    }


# ---------------------------------------------------------------- 書き出し

def export_zip(folder: Path, dest: Path, include: dict[str, bool], progress=None) -> dict[str, Any]:
    folder = Path(folder)
    dest = Path(dest)
    if dest.suffix.lower() != ".zip":
        dest = dest.with_name(dest.name + ".zip")
    try:
        dest.resolve().relative_to(folder.resolve())
        raise PortableError("zip はプロジェクトのフォルダの外に保存してください。")
    except ValueError:
        pass
    if not dest.parent.is_dir():
        raise PortableError(f"保存先のフォルダがありません: {dest.parent}")
    want = {"core"} | {k for k in OPTIONAL if include.get(k)}
    items = [(p, rel) for p, rel, cat in _walk(folder) if cat in want]
    total = sum(p.stat().st_size for p, _ in items) or 1
    top = folder.name
    tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex[:6]}.tmp")
    done = 0
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as z:
            z.writestr(f"{top}/{ENV_PATH}", json.dumps(env_info(folder, with_fonts="fonts" in want), ensure_ascii=False, indent=1))
            for p, rel in items:
                comp = zipfile.ZIP_STORED if p.suffix.lower() in _STORED else zipfile.ZIP_DEFLATED
                z.write(p, f"{top}/{rel.as_posix()}", compress_type=comp)
                done += p.stat().st_size
                if progress:
                    progress(done / total)
        tmp.replace(dest)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise PortableError(f"zip を作れませんでした: {e}") from e
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return {"path": str(dest), "files": len(items), "bytes": dest.stat().st_size}


# ---------------------------------------------------------------- 取り込み

def _open_zip(path: Path) -> zipfile.ZipFile:
    try:
        z = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as e:
        raise PortableError(f"zip ファイルとして開けません: {e}") from e
    # Windows の「圧縮（zip 形式）フォルダー」は、日本語の名前を UTF-8 の印なしで（Shift_JIS で）書くことがある
    if any(not (i.flag_bits & 0x800) and not i.filename.isascii() for i in z.infolist()):
        z.close()
        try:
            return zipfile.ZipFile(path, metadata_encoding="cp932")
        except (OSError, zipfile.BadZipFile, UnicodeDecodeError):
            return zipfile.ZipFile(path)
    return z


def _project_root(names: list[str]) -> str | None:
    """zip の中で project.json があるフォルダ（いちばん浅いもの）。"" はいちばん上。"""
    best = None
    for n in names:
        parts = n.rstrip("/").split("/")
        if parts[-1] == PROJECT_FILE and not any(p.startswith(".") or p == "__MACOSX" for p in parts[:-1]):
            root = "/".join(parts[:-1])
            if best is None or root.count("/") < best.count("/"):
                best = root
    return best


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip().rstrip(".")
    return name or "取り込んだプロジェクト"


def inspect_zip(path: Path) -> dict[str, Any]:
    with _open_zip(Path(path)) as z:
        names = z.namelist()
        root = _project_root(names)
        if root is None:
            raise PortableError("この zip には project.json がありません（Manim Slide GUI のプロジェクトではないようです）。")
        prefix = f"{root}/" if root else ""
        info = None
        if f"{prefix}{ENV_PATH}" in names:
            try:
                info = json.loads(z.read(f"{prefix}{ENV_PATH}").decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                info = None
        if info is None:  # 手で固めた zip: プロジェクトの中身から調べる
            project = json.loads(z.read(f"{prefix}{PROJECT_FILE}").decode("utf-8"))
            pre = z.read(f"{prefix}{PREAMBLE_FILE}").decode("utf-8") if f"{prefix}{PREAMBLE_FILE}" in names else ""
            info = {"name": (project.get("settings") or {}).get("name") or "", "fonts": used_fonts(project),
                    "packages": tex_packages(pre), "versions": {}}
        size = sum(i.file_size for i in z.infolist() if i.filename.startswith(prefix))
    folder = root.split("/")[-1] if root else (info.get("folder") or info.get("name") or Path(path).stem)
    return {"root": root, "folder": _safe_name(info.get("folder") or folder), "info": info, "bytes": size}


def free_folder(parent: Path, name: str) -> Path:
    cand = parent / name
    k = 2
    while cand.exists():
        cand = parent / f"{name} ({k})"
        k += 1
    return cand


def import_zip(path: Path, parent: Path, progress=None) -> dict[str, Any]:
    parent = Path(parent)
    if not parent.is_dir():
        raise PortableError(f"取り出し先のフォルダがありません: {parent}")
    meta = inspect_zip(path)
    root = meta["root"]
    prefix = f"{root}/" if root else ""
    dest = free_folder(parent, meta["folder"])
    tmp = parent / f".importing-{uuid.uuid4().hex[:8]}"
    tmp_res = tmp.resolve()
    try:
        tmp.mkdir()
        with _open_zip(Path(path)) as z:
            members = [i for i in z.infolist() if i.filename.startswith(prefix) and not i.is_dir()]
            members = [i for i in members if not i.filename[len(prefix):].startswith(".portable/")]
            total = sum(i.file_size for i in members) or 1
            done = 0
            for i in members:
                rel = i.filename[len(prefix):]
                if not rel or rel.startswith("__MACOSX/"):
                    continue
                target = (tmp / rel).resolve()
                try:
                    target.relative_to(tmp_res)  # zip の外（../ など）へは書かない
                except ValueError as e:
                    raise PortableError(f"zip の中に、フォルダの外を指す名前があります: {i.filename}") from e
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
                done += i.file_size
                if progress:
                    progress(done / total)
        tmp.rename(dest)
    except (OSError, zipfile.BadZipFile) as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise PortableError(f"取り出せませんでした: {e}") from e
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return {"folder": str(dest), "info": meta["info"], "compare": compare(meta["info"])}


if __name__ == "__main__":  # 手で試す: python -m app.portable <zip>
    print(json.dumps(inspect_zip(Path(sys.argv[1])), ensure_ascii=False, indent=1))
