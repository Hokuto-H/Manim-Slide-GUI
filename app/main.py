"""FastAPI のローカルサーバー。GUI の配信、保存、書き出し、描画の呼び出しを担う。

127.0.0.1 だけで待ち受ける。さらに、ほかの Web サイトからこのサーバーを操作されないよう、
起動ごとのトークン（index.html に埋め込む）と Host ヘッダーを検査する。
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import codegen, convert, envcheck, fonts, helpdoc, images, media, parts, preamble, userconfig
from .constants import (CANVAS_H, CANVAS_W, DEFAULT_SETTINGS, FONT_PRESETS, MATH_PX_PER_FONT_SIZE,
                        TEXT_LINE_PITCH_EM, TEXT_PX_PER_FONT_SIZE)
from .dialogs import choose_folder, choose_font_files, choose_zip_open, choose_zip_save
from .project import Project, ProjectError, make_class_name, validate_project_name
from .preview import PreviewError, worker as preview_worker
from .render import RenderManager, launch_present, present_running
from . import recording
from . import backup
from . import cleanup
from . import rehearsal
from . import portable
from . import trash
from . import projfonts
from . import shapemodel
from .latexexpr import ExprError, to_python, used_names
from .shapemodel import (axdot_kwargs, axes_kwargs, balloon_kwargs, brace_kwargs, field_kwargs, graph_kwargs, normalize_shape_element,
                         number_kwargs, theorem_args, points_kwargs, SHAPES_3D, solid_kwargs, axes3d_kwargs, surface_kwargs, curve3d_kwargs,
                         point3d_kwargs, svg_kwargs, matrix_kwargs, angle_kwargs, graphpart_kwargs, curve2d_kwargs,
                         implicit_python, polar_kwargs, complex_kwargs,
                         table_kwargs, table_uses_math, code_kwargs, barchart_kwargs, barchart_uses_tex, tex_body, samplespace_kwargs, netgraph_kwargs, annot_kwargs, arcbrace_kwargs, vector_kwargs, linegraph_kwargs,
                         shape_kwargs)
from .textmodel import gui_text_kwargs, normalize_runs, normalize_text_element

STATIC = Path(__file__).resolve().parent.parent / "static"
TOKEN = secrets.token_urlsafe(24)


def _build_id() -> tuple[str, list[str]]:
    """画面のファイル（JS・CSS）の版。内容が変わると変わる。古い版がブラウザに残っていたら読み直すのに使う。"""
    h = hashlib.sha1()
    files = sorted(p for p in STATIC.rglob("*") if p.is_file() and p.suffix in (".js", ".css") and "vendor" not in p.parts)
    for f in files:
        h.update(str(f.relative_to(STATIC)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:12], ["/static/" + f.relative_to(STATIC).as_posix() for f in files]


BUILD, BUILD_FILES = _build_id()

app = FastAPI(title="Manim Slide GUI", docs_url=None, redoc_url=None, openapi_url=None)
state: dict[str, Any] = {"project": None, "port": None}
renders = RenderManager()
# 描画の最中は、プレビューの待ち時間を延ばす（CPU を描画に取られて間に合わず、503 になっていた）
preview_worker.busy = lambda: bool(renders.current and renders.current.status == "running")
converts = convert.ConvertManager()


# ---------------------------------------------------------------- セキュリティ

@app.middleware("http")
async def guard(request: Request, call_next):
    host = (request.headers.get("host") or "").split(":")[0]
    if host not in ("127.0.0.1", "localhost"):
        return JSONResponse({"detail": "このサーバーはローカルからのみ利用できます。"}, status_code=403)
    if request.url.path.startswith("/api/") and request.headers.get("x-app-token") != TOKEN:
        return JSONResponse({"detail": "トークンが一致しません。ページを開き直してください。"}, status_code=403)
    mismatch = _project_mismatch(request)
    if mismatch:
        return JSONResponse({"detail": {"code": "project_mismatch", "message": mismatch}}, status_code=409)
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        # ブラウザが古い版の画面のファイルを使い続けないよう、毎回サーバーに確認させる（変わっていなければ 304 で軽い）
        response.headers["Cache-Control"] = "no-cache"
    return response


# 開いているプロジェクトに関係なく使える要求（プロジェクトを開く・作る、このパソコンの設定、プレビューなど）
_ANY_PROJECT_PATHS = ("/api/userconfig", "/api/dialog/", "/api/project/validate-name", "/api/project/new", "/api/project/open",
                      "/api/project/forget", "/api/project/delete-info", "/api/project/delete", "/api/portable/inspect",
                      "/api/portable/import", "/api/presets", "/api/export-presets", "/api/parts", "/api/templates/",
                      "/api/preview/text", "/api/preview/shape", "/api/anim/", "/api/image/outline", "/api/record/settings",
                      "/api/autosave/settings", "/api/tutorial/")


def _same_folder(a: str, b: Path) -> bool:
    try:
        return Path(a).resolve() == Path(b).resolve()
    except OSError:
        return False


def _project_mismatch(request: Request) -> str | None:
    """画面（タブ）が開いているつもりのプロジェクト（X-Project）と、サーバーが開いているプロジェクトが違えば、断る理由。
    別のタブで別のプロジェクトを開いたあと、前のタブの保存が、あとで開いたプロジェクトを上書きしないように（B1）。"""
    path = request.url.path
    if request.method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api/") or path.startswith(_ANY_PROJECT_PATHS):
        return None
    raw = request.headers.get("x-project")
    if not raw:
        return None
    from urllib.parse import unquote  # noqa: PLC0415
    want, cur = unquote(raw), state.get("project")
    if cur is None:
        return "このタブで開いていたプロジェクトは、もう開かれていません。プロジェクトを開き直してください。"
    if _same_folder(want, cur.folder):
        return None
    return (f"別のタブ（またはウィンドウ）で、別のプロジェクト「{cur.folder.name}」が開かれています。"
            f"このタブの「{Path(want).name}」を上書きから守るため、保存などを止めました。このタブを閉じるか、プロジェクトを開き直してください。")


@app.exception_handler(ProjectError)
async def project_error_handler(request: Request, exc: ProjectError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


def _err(e: Exception, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=str(e))


def _project() -> Project:
    p = state["project"]
    if p is None:
        raise HTTPException(status_code=409, detail="プロジェクトが開かれていません。")
    return p


def _project_payload(p: Project) -> dict[str, Any]:
    text = p.read_preamble()
    return {"folder": str(p.folder), "project": p.read(), "preamble": text, "macros": preamble.extract_macros(text)}


# ---------------------------------------------------------------- ページ

@app.get("/", response_class=HTMLResponse)
def index() -> str:
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    return (html.replace("__APP_TOKEN__", TOKEN).replace("__APP_BUILD__", BUILD)
            .replace("__APP_FILES__", json.dumps(BUILD_FILES)))


app.mount("/static", StaticFiles(directory=STATIC), name="static")
helpdoc.HELP_IMG.mkdir(parents=True, exist_ok=True)
app.mount("/help-img", StaticFiles(directory=helpdoc.HELP_IMG), name="help-img")


# ---------------------------------------------------------------- 使い方の案内（ヘルプ）

# ---------------------------------------------------------------- アプリの窓とのつながり（起動用のプログラムが終わる時を決める）

alive = {"clients": 0, "ever": False, "last_change": time.time()}
_alive_lock = threading.Lock()


def _alive_change(d: int) -> None:
    with _alive_lock:
        alive["clients"] += d
        alive["ever"] = alive["ever"] or alive["clients"] > 0
        alive["last_change"] = time.time()


@app.get("/alive")
async def alive_stream(request: Request, t: str = "") -> Response:
    """画面が開いている間つなぎっぱなしにする（EventSource）。タイマーと違い、窓を最小化しても止まらない。"""
    if not secrets.compare_digest(t, TOKEN):
        return JSONResponse({"detail": "トークンが一致しません。"}, status_code=403)
    import asyncio  # noqa: PLC0415

    from fastapi.responses import StreamingResponse  # noqa: PLC0415

    async def gen():
        _alive_change(+1)
        try:
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                yield ": ping\n\n"
                await asyncio.sleep(10)
        finally:
            _alive_change(-1)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.get("/ping")
def ping() -> dict[str, Any]:
    """起動用のプログラムが、もう動いているアプリを見つけるため（中身は返さない）。"""
    return {"app": "manim-slide-gui"}


def shutdown_work() -> None:
    """アプリを終える前に、描画・出力の子プロセスを止める。"""
    try:
        if renders.current and renders.current.status == "running":
            renders.current.cancel()
    except Exception:  # noqa: BLE001
        pass
    try:
        for job in list(getattr(converts, "jobs", {}).values()):
            if getattr(job, "status", "") == "running":
                job.cancel()
    except Exception:  # noqa: BLE001
        pass
    try:
        preview_worker._kill()  # noqa: SLF001
    except Exception:  # noqa: BLE001
        pass


MANUAL_DIR = helpdoc.HELP_DIR.parent / "manual"


@app.get("/manual/")
def manual_html() -> FileResponse:
    """説明書（HTML。scripts/build_manual.py が作り、配布物に入れる）。"""
    f = MANUAL_DIR / "manual.html"
    if not f.is_file():
        raise HTTPException(status_code=404, detail="説明書がまだ作られていません（scripts/build_manual.py）。")
    return FileResponse(f, media_type="text/html; charset=utf-8")


@app.get("/manual/manual.pdf")
def manual_pdf() -> FileResponse:
    f = MANUAL_DIR / "manual.pdf"
    if not f.is_file():
        raise HTTPException(status_code=404, detail="説明書（PDF）がまだ作られていません（scripts/build_manual.py）。")
    return FileResponse(f, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="manual.pdf"'})


@app.get("/api/help/index")
def help_index() -> dict[str, Any]:
    return {"pages": helpdoc.index()}


@app.get("/api/help/page/{pid}")
def help_page(pid: str) -> dict[str, Any]:
    pg = helpdoc.page(pid)
    if pg is None:
        raise HTTPException(status_code=404, detail=f"ヘルプのページが見つかりません: {pid}")
    return pg


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    payload = None
    if state["project"]:
        try:
            payload = _project_payload(state["project"])
        except ProjectError:
            state["project"] = None  # フォルダが消えた場合は、未選択の状態から始める
    return {
        "canvas": {"w": CANVAS_W, "h": CANVAS_H},
        "textPxPerFontSize": TEXT_PX_PER_FONT_SIZE,
        "textLinePitchEm": TEXT_LINE_PITCH_EM,
        "mathPxPerFontSize": MATH_PX_PER_FONT_SIZE,
        "defaults": DEFAULT_SETTINGS,
        "fontPresets": FONT_PRESETS,
        "project": payload,
    }


# ---------------------------------------------------------------- 環境・フォント・設定

@app.get("/api/env/check")
def env_check(refresh: bool = False) -> dict[str, Any]:
    if not refresh and envcheck.last():
        return envcheck.last()
    return envcheck.run_all()


@app.get("/api/fonts")
def get_fonts(refresh: bool = False) -> dict[str, Any]:
    return fonts.presets(refresh)


@app.get("/api/userconfig")
def get_userconfig() -> dict[str, Any]:
    return userconfig.load()


@app.put("/api/userconfig")
def put_userconfig(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    allowed = {k: v for k, v in body.items() if k in ("lastDir", "templatePreamble", "presentWindow", "presentInfo", "tutorial")}
    if "lintBeforePresent" in body:  # 発表の前に点検するか
        allowed["lintBeforePresent"] = bool(body["lintBeforePresent"])
    return userconfig.save(allowed)


@app.post("/api/dialog/folder")
def dialog_folder(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    path = choose_folder(body.get("initial", ""), body.get("title", "フォルダを選択"))
    if path is None:
        raise HTTPException(status_code=501, detail="フォルダ選択ダイアログを開けませんでした。パスを直接入力してください。")
    return {"path": path}


# ---------------------------------------------------------------- プロジェクト

@app.post("/api/project/validate-name")
def validate_name(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        name = validate_project_name(body.get("name", ""))
    except ProjectError as e:
        return {"ok": False, "message": str(e)}
    parent = Path(body.get("parent") or "").expanduser()
    exists = bool(body.get("parent")) and (parent / name).exists()
    return {"ok": True, "className": make_class_name(name), "exists": exists}


@app.post("/api/project/new")
def project_new(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    settings = body.get("settings") or {}
    try:
        p = Project.create(Path(body.get("parent", "")), settings, body.get("preamble", ""), make_parent=bool(body.get("makeParent")))
    except ProjectError as e:
        raise _err(e) from e
    state["project"] = p
    userconfig.remember_project(p.folder)
    return _project_payload(p)


@app.post("/api/tutorial/new")
def tutorial_new() -> dict[str, Any]:
    """チュートリアルの練習用のプロジェクトを、ドキュメントの「ManimSlideGUI」フォルダに作って開く（同じ名前があれば番号を付ける）。"""
    parent = userconfig.documents_dir() / "ManimSlideGUI"
    name = "チュートリアル"
    k = 2
    while (parent / name).exists():
        name = f"チュートリアル{k}"
        k += 1
    try:
        p = Project.create(parent, {"name": name}, "", make_parent=True)
    except ProjectError as e:
        raise _err(e) from e
    state["project"] = p
    userconfig.remember_project(p.folder)
    return _project_payload(p)


@app.get("/api/tutorial/exists")
def tutorial_exists(folder: str) -> dict[str, Any]:
    return {"exists": (Path(folder) / "project.json").is_file()}


@app.post("/api/project/open")
def project_open(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        p = Project.open(Path(body.get("folder", "")))
    except ProjectError as e:
        raise _err(e) from e
    state["project"] = p
    userconfig.remember_project(p.folder)
    if projfonts.files(p.folder):  # プロジェクトのフォントを、最初のプレビューより前に登録しておく
        try:
            projfonts.listing(p.folder, preview_worker.set_fonts)
        except Exception:  # noqa: BLE001
            pass
    payload = _project_payload(p)
    if backup.load_settings()["backup"]:  # 開いたときの状態（前の作業の終わり）を控える
        _backup_quiet(lambda: backup.make(p.folder, payload["project"], payload["preamble"], "open"))
    # 部品: テンプレートの方が新しい（ほかのプロジェクトで直した）ものは、このプロジェクトの写しも新しくする
    try:
        data = payload["project"]
        names = parts.refresh_project(data)
        if names:
            payload["project"] = p.write(data)
            payload["partsUpdated"] = names
    except (OSError, ProjectError):
        pass
    return payload




# ---------------------------------------------------------------- プロジェクトの削除・最近の一覧から外す

def _is_current(folder: Path) -> bool:
    p = state["project"]
    return bool(p) and os.path.normcase(os.path.abspath(p.folder)) == os.path.normcase(os.path.abspath(folder))


def _delete_target(body: dict[str, Any]) -> Path:
    raw = str(body.get("folder") or "").strip()
    folder = Path(raw)
    if not raw or not folder.is_absolute():
        raise HTTPException(status_code=400, detail="フォルダの指定がありません。")
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail=f"フォルダが見つかりません（すでに移動・削除されたようです）: {folder}")
    if not (folder / "project.json").is_file():
        raise HTTPException(status_code=400, detail="project.json が無いフォルダです。プロジェクトのフォルダだけを削除できます。")
    home = Path.home().resolve()
    r = folder.resolve()
    if r == Path(r.anchor) or r == home or home.is_relative_to(r):
        raise HTTPException(status_code=400, detail="このフォルダは削除できません。")
    return folder


@app.post("/api/project/forget")
def project_forget(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    cfg = userconfig.forget_project(str(body.get("folder") or ""))
    return {"recentProjects": cfg.get("recentProjects", [])}


@app.post("/api/project/delete-info")
def project_delete_info(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    folder = _delete_target(body)
    n = size = 0
    for f in folder.rglob("*"):
        if f.is_file():
            n += 1
            try:
                size += f.stat().st_size
            except OSError:
                pass
    name = folder.name
    try:
        name = (json.loads((folder / "project.json").read_text(encoding="utf-8")).get("settings") or {}).get("name") or name
    except (OSError, ValueError):
        pass
    return {"folder": str(folder), "name": name, "files": n, "bytes": size, "current": _is_current(folder)}


@app.post("/api/project/delete")
def project_delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    folder = _delete_target(body)
    current = _is_current(folder)
    if current:
        if renders.current and renders.current.status == "running":
            raise HTTPException(status_code=409, detail="描画を実行中です。終わってから削除してください。")
        if present_running():
            raise HTTPException(status_code=409, detail="発表ウィンドウを閉じてから削除してください。")
        if any(j.status == "running" for j in converts.jobs.values()):
            raise HTTPException(status_code=409, detail="ファイルへの出力を実行中です。終わってから削除してください。")
    cur = getattr(records, "cur", None)
    if records.running_name() and cur is not None and Path(str(cur)).resolve().is_relative_to(folder.resolve()):
        raise HTTPException(status_code=409, detail="録画を組み立てています。終わってから削除してください。")
    try:
        trash.send_to_trash(folder)
    except trash.TrashError as e:
        raise _err(e, 409) from e
    if current:
        state["project"] = None
    cfg = userconfig.forget_project(str(folder))
    return {"ok": True, "current": current, "recentProjects": cfg.get("recentProjects", [])}

# ---------------------------------------------------------------- 持ち運び（zip）

@app.post("/api/dialog/zip")
def dialog_zip(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    if body.get("mode") == "save":
        path = choose_zip_save(body.get("initial", ""), body.get("name", ""), body.get("title", "zip の保存先"))
    else:
        path = choose_zip_open(body.get("initial", ""), body.get("title", "取り込む zip を選択"))
    if path is None:
        raise HTTPException(status_code=501, detail="ファイル選択ダイアログを開けませんでした。パスを直接入力してください。")
    return {"path": path}


# ---------------------------------------------------------------- プロジェクトのフォント（fonts/）

def _font_listing(p: Project) -> dict[str, Any]:
    return {"fonts": projfonts.listing(p.folder, preview_worker.set_fonts), "folder": str(projfonts.font_dir(p.folder))}


@app.get("/api/project/fonts")
def project_fonts() -> dict[str, Any]:
    return _font_listing(_project())


@app.post("/api/project/fonts/add")
def project_fonts_add(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    paths = body.get("paths")
    if not paths:
        paths = choose_font_files(body.get("initial", ""))
        if paths is None:
            raise HTTPException(status_code=501, detail="ファイル選択ダイアログを開けませんでした。")
        if not paths:
            return {**_font_listing(p), "added": []}
    try:
        added = projfonts.add(p.folder, [str(x) for x in paths])
    except projfonts.FontError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {**_font_listing(p), "added": added}


@app.post("/api/project/fonts/remove")
def project_fonts_remove(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    p = _project()
    try:
        projfonts.remove(p.folder, str(body.get("file") or ""))
    except projfonts.FontError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _font_listing(p)


@app.get("/api/project/fonts/file")
def project_font_file(name: str) -> FileResponse:
    p = _project()
    f = projfonts.file_path(p.folder, name)
    if f is None:
        raise HTTPException(status_code=404, detail=f"フォントのファイルがありません: {name}")
    return FileResponse(f, headers={"Cache-Control": "no-store"})


@app.get("/api/portable/summary")
def portable_summary() -> dict[str, Any]:
    p = _project()
    res = portable.summary(p.folder)
    cfg = userconfig.load()
    res["include"] = {**portable.DEFAULT_INCLUDE, **(cfg.get("portableInclude") or {})}
    res["dest"] = str(Path(cfg.get("portableDir") or p.folder.parent) / f"{p.folder.name}.zip")
    return res


@app.post("/api/portable/export")
def portable_export(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    p = _project()
    include = {k: bool((body.get("include") or {}).get(k)) for k in portable.OPTIONAL}
    dest = Path(str(body.get("dest") or "")).expanduser()
    if not str(body.get("dest") or "").strip() or not dest.is_absolute():
        raise HTTPException(status_code=400, detail="保存先を、ドライブから始まるパスで指定してください。")
    try:
        res = portable.export_zip(p.folder, dest, include)
    except portable.PortableError as e:
        raise _err(e) from e
    userconfig.save({"portableInclude": include, "portableDir": str(Path(res["path"]).parent)})
    return res


@app.post("/api/portable/reveal")
def portable_reveal(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    path = Path(str(body.get("path") or ""))
    if not path.is_absolute() or not path.exists():
        raise HTTPException(status_code=404, detail="ファイルが見つかりません。")
    try:
        convert.open_in_file_manager(path if path.is_dir() else path.parent)
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True}


@app.post("/api/portable/inspect")
def portable_inspect(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        meta = portable.inspect_zip(Path(str(body.get("zip") or "")))
    except portable.PortableError as e:
        raise _err(e) from e
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"zip を読めません: {e}") from e
    parent = Path(str(body.get("parent") or ""))
    if str(body.get("parent") or "").strip() and parent.is_dir():
        meta["dest"] = str(portable.free_folder(parent, meta["folder"]))
    return meta


@app.post("/api/portable/import")
def portable_import(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    parent = str(body.get("parent") or "").strip()
    if not parent or not Path(parent).is_absolute():
        raise HTTPException(status_code=400, detail="取り出し先のフォルダを、ドライブから始まるパスで指定してください。")
    try:
        res = portable.import_zip(Path(str(body.get("zip") or "")), Path(parent))
    except portable.PortableError as e:
        raise _err(e) from e
    userconfig.save({"lastDir": parent})
    payload = project_open({"folder": res["folder"]})
    payload["imported"] = {"folder": res["folder"], "compare": res["compare"], "info": res["info"]}
    return payload

# ---------------------------------------------------------------- 自動保存・バックアップ

@app.get("/api/autosave/settings")
def autosave_settings() -> dict[str, Any]:
    return backup.load_settings()


@app.post("/api/autosave/settings")
def autosave_settings_save(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return backup.save_settings(body)


@app.get("/api/backups")
def backups_list() -> dict[str, Any]:
    p = _project()
    cur = {"project": p.read(), "preamble": p.read_preamble()}
    return {"items": backup.items(p.folder, cur), "settings": backup.load_settings(), "totalSize": backup.total_size(p.folder),
            "folder": str(backup.backup_dir(p.folder))}


@app.post("/api/backups/make")
def backups_make(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        made = backup.make(p.folder, p.read(), p.read_preamble(), "manual", str(body.get("label") or ""))
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True, "backup": made}


@app.post("/api/backups/get")
def backups_get(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """バックアップの中身（比べるため。今のプロジェクトは変えない）。"""
    p = _project()
    try:
        data = backup.get(p.folder, str(body.get("id") or ""))
        from .project import normalize as _norm
        return {"project": _norm(data["project"]), "preamble": str(data.get("preamble") or "")}
    except (ValueError, KeyError, TypeError) as e:
        raise _err(e) from e


@app.post("/api/backups/restore")
def backups_restore(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """バックアップの状態に戻す。戻す前の今の状態も、バックアップに残す（戻したのを取り消せるように）。"""
    p = _project()
    try:
        data = backup.get(p.folder, str(body.get("id") or ""))
        backup.make(p.folder, p.read(), p.read_preamble(), "restore")
        p.write(data["project"])
        p.write_preamble(str(data.get("preamble") or ""))
    except (ValueError, ProjectError) as e:
        raise _err(e) from e
    except OSError as e:
        raise _err(e, 500) from e
    return _project_payload(p)


@app.post("/api/backups/delete")
def backups_delete(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        backup.delete(p.folder, str(body.get("id") or ""))
    except ValueError as e:
        raise _err(e) from e
    return {"ok": True}


# ---------------------------------------------------------------- スライドの点検（サーバーで調べる所）

@app.post("/api/lint")
def lint(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """点検のうち、サーバーで調べるもの: 書き出し前の検査・見つからないファイル・描画が最新か・マイクやカメラと画面の数。
    mode: manual（「点検」ボタン）・render（描画して発表する前）・present（「発表のみ」の前）。
    画面での見え方（はみ出し・重なり・文字の大きさ・色・数式）は、ブラウザで調べる（static/js/lint.js）。"""
    from .images import missing_images
    from .media import missing_media
    p = _project()
    data = p.read()
    mode = body.get("mode") if body.get("mode") in ("manual", "render", "present") else "manual"
    items: list[dict[str, Any]] = []
    skip = {i for i, sl in enumerate(data["slides"]) if sl.get("skip")}

    def add(level: str, kind: str, prob: dict[str, Any] | None, message: str, key_extra: str = "") -> None:
        si = prob.get("slideIndex") if prob else None
        sl = data["slides"][si] if isinstance(si, int) and 0 <= si < len(data["slides"]) else None
        items.append({"level": level, "kind": kind, "slideIndex": si, "elementId": (prob or {}).get("elementId"),
                      "stepId": (prob or {}).get("stepId"), "message": message,
                      "key": f"{kind}|{(sl or {}).get('id', '')}|{(prob or {}).get('elementId') or ''}|{key_extra}"})

    for pr in missing_images(data, p.folder) + missing_media(data, p.folder):
        add("warn" if pr.get("slideIndex") in skip else "error", "file", pr, pr["message"])
    if mode in ("manual", "render"):  # 「ずっと回す」の 1 周が長いと、描画にとても時間がかかる
        for lap in codegen.spin_laps(data):
            si, sec = lap["slide"] - 1, lap["seconds"]
            if si in skip:
                continue
            where = f"スライド {lap['slide']}" + (f" / ステップ {lap['step']}" if lap["step"] else " の初め")
            if sec > 20:
                add("warn", "spin", {"slideIndex": si}, f"{where}: クリックを待つ間に見せる「ずっと回す」の 1 周が {sec:g} 秒です（回る物どうしの速さが割り切れないと長くなります）。"
                    f"この 1 周は毎回描くので、時間がかかります（高・60fps で {round(sec * 60)} コマ）。速さを 360 を割り切れる値（30・45・60・90°/秒など）にそろえると短くなります。", str(lap["step"]))
            elif mode == "manual":
                add("info", "spin", {"slideIndex": si}, f"{where}: クリックを待つ間に見せる「ずっと回す」の 1 周 {sec:g} 秒を描きます（高・60fps で {round(sec * 60)} コマ）。"
                    "3D の曲面などは 1 コマに時間がかかるので、確かめるときは「低」「中」、仕上げは「高（1080p・30fps）」も使えます。", str(lap["step"]))
    if mode != "render":  # 描画のときは、描画が同じ検査をして止める
        for pr in codegen.validate(data):
            add("warn" if pr.get("slideIndex") in skip else "error", "code", pr, pr["message"], pr.get("message", "")[:40])
    if mode in ("manual", "present"):
        cls = data["settings"].get("className") or "Deck"
        cfg_path = p.folder / "slides" / f"{cls}.json"
        if not cfg_path.exists():
            add("error" if mode == "present" else "info", "render", None, "まだ描画していません。「▶ 描画・発表」で描画してください。")
        else:
            py = p.folder / f"{cls}.py"
            try:
                try:
                    inc = json.loads((p.folder / f"{cls}.include.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    inc = None
                src, _ = codegen.generate({**data, "_projectFonts": bool(projfonts.files(p.folder))}, p.read_preamble(), include=inc if isinstance(inc, list) else None)
                stale = not py.exists() or py.read_text(encoding="utf-8") != src or py.stat().st_mtime > cfg_path.stat().st_mtime + 1
            except (codegen.ExportError, OSError):
                stale = True
            if stale:
                add("warn", "render", None, "描画したあとに内容が変わっています。発表には前に描画した内容が出ます（「▶ 描画・発表」で描画し直せます）。")
    if mode == "manual":
        rs = recording.load_settings()
        dev = recording.list_devices()
        if dev.get("ok"):
            if dev.get("screens") is not None and dev["screens"] < 2:
                add("info", "screen", None, "画面が 1 つです。発表者用の情報ウィンドウは、発表ウィンドウとは別の画面に出せません（ツールバーの「発表者用」の設定で、出し方を選べます）。")
            for k, lab, lst in (("mic", "マイク", dev.get("mics") or []), ("camera", "カメラ", dev.get("cams") or [])):
                if not rs.get(k):
                    continue
                want_id, want_name = rs.get("micId" if k == "mic" else "camId"), rs.get("micName" if k == "mic" else "camName")
                if not lst:
                    add("warn", "device", None, f"録画で{lab}を使う設定ですが、{lab}が見つかりません（「● 録画」で設定を変えられます）。", k)
                elif (want_id or want_name) and not any(d["id"] == want_id or d["name"] == want_name for d in lst):
                    add("warn", "device", None, f"録画に使う{lab}「{want_name or want_id}」が見つかりません。録画ではパソコンの既定の{lab}を使います。", k)
        else:
            add("info", "device", None, dev.get("message") or "マイク・カメラを調べられませんでした。")
    return {"items": items}


# ---------------------------------------------------------------- リハーサルの記録

@app.get("/api/rehearsals")
def rehearsals_list() -> dict[str, Any]:
    p = _project()
    return {"items": rehearsal.items(p.folder), "folder": str(p.folder / rehearsal.DIR)}


@app.post("/api/rehearsals/waits")
def rehearsals_waits(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """リハーサルの区切りごとの、クリックを待った時間（動画の書き出しの待ち時間に使う）。"""
    p = _project()
    rec = next((x for x in rehearsal.items(p.folder) if x["id"] == body.get("id")), None)
    if rec is None:
        raise HTTPException(status_code=404, detail="リハーサルの記録が見つかりません。")
    cls = p.read()["settings"].get("className") or "Deck"
    return {"waits": rehearsal.video_waits(p.folder, cls, rec)}


@app.post("/api/rehearsals/delete")
def rehearsals_delete(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        rehearsal.delete(p.folder, str(body.get("id") or ""))
    except ValueError as e:
        raise _err(e) from e
    return {"ok": True}


# ---------------------------------------------------------------- 使っていないファイルの整理

def _paths(body: dict[str, Any]) -> list[str]:
    v = body.get("paths")
    return [str(x) for x in v][:5000] if isinstance(v, list) else []


@app.post("/api/cleanup/scan")
def cleanup_scan(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    hist = body.get("historyPaths")
    return cleanup.scan(p.folder, p.read(), [str(x) for x in hist] if isinstance(hist, list) else [])


@app.post("/api/cleanup/move")
def cleanup_move(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        n = cleanup.move_to_unused(p.folder, _paths(body))
    except ValueError as e:
        raise _err(e) from e
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True, "moved": n}


@app.post("/api/cleanup/restore")
def cleanup_restore(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        return {"ok": True, **cleanup.restore(p.folder, _paths(body))}
    except ValueError as e:
        raise _err(e) from e
    except OSError as e:
        raise _err(e, 500) from e


@app.post("/api/cleanup/purge")
def cleanup_purge(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    try:
        n = cleanup.purge(p.folder, None if body.get("all") else _paths(body))
    except ValueError as e:
        raise _err(e) from e
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True, "deleted": n}


@app.post("/api/cleanup/open-folder")
def cleanup_open_folder() -> dict[str, Any]:
    p = _project()
    d = p.folder / cleanup.UNUSED_DIR
    try:
        convert.open_in_file_manager(d if d.is_dir() else p.folder)
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True}


@app.post("/api/backups/open-folder")
def backups_open_folder() -> dict[str, Any]:
    p = _project()
    d = backup.backup_dir(p.folder)
    d.mkdir(parents=True, exist_ok=True)
    try:
        convert.open_in_file_manager(d)
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True}


@app.put("/api/project")
def project_save(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    p = _project()
    try:
        data = p.write(body)
    except ProjectError as e:
        raise _err(e) from e
    made = _backup_quiet(lambda: backup.maybe(p.folder, data, p.read_preamble()))
    return {"ok": True, "project": data, "backup": made}


def _backup_quiet(fn):
    """バックアップに失敗しても、保存・読み込みは止めない。"""
    try:
        return fn()
    except (OSError, ValueError) as e:
        print(f"[backup] {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------- 画像（F10）

@app.post("/api/project/image")
async def image_import(request: Request) -> dict[str, Any]:
    """画像を images/ に取り込む。本体はファイルの中身そのまま、名前は X-File-Name（URL エンコード）。"""
    p = _project()
    name = unquote(request.headers.get("x-file-name") or "image.png")
    data = await request.body()
    try:
        return images.import_image(p.folder, data, name)
    except ProjectError as e:
        raise _err(e) from e


@app.post("/api/project/image/copy")
def image_copy(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """別のプロジェクトから貼り付けた画像要素の画像を、今のプロジェクトの images/ に取り込む。"""
    p = _project()
    src_folder = Path(str(body.get("folder", "")))
    rel = str(body.get("path", ""))
    try:
        if not (src_folder / "project.json").is_file():
            raise ProjectError("コピー元のプロジェクトが見つかりません。")
        src = images.resolve(src_folder, rel)
        if not src.is_file():
            raise ProjectError(f"コピー元の画像が見つかりません: {rel}")
        return images.import_image(p.folder, src.read_bytes(), str(body.get("name") or src.name))
    except ProjectError as e:
        raise _err(e) from e


@app.get("/api/project/image")
def image_get(path: str) -> FileResponse:
    p = _project()
    try:
        f = images.resolve(p.folder, path)
    except ProjectError as e:
        raise _err(e) from e
    if not f.is_file():
        raise HTTPException(status_code=404, detail=f"画像が見つかりません: {path}")
    return FileResponse(f, headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- アニメーションの GUI

@app.get("/api/anim/catalog")
def anim_catalog() -> dict[str, Any]:
    from . import animgen
    return animgen.catalog()


@app.post("/api/anim/code")
def anim_code(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """GUI のステップから作るコード（パネルでの表示用）。vars は {id: 変数名}。"""
    from . import animgen
    st = animgen.normalize_step({**(body.get("step") or {}), "mode": "gui"})
    names = {str(k): str(v) for k, v in (body.get("vars") or {}).items()}
    gmap = {str(k): str(v) for k, v in (body.get("groupOf") or {}).items()}
    vo = lambda i: names.get(i) if i else None  # noqa: E731
    lines = animgen.step_lines(st, vo, lambda i: gmap.get(i), vo)
    groups = {str(k): str(v) for k, v in (body.get("groupOf") or {}).items()}
    related = lambda a, b: a == b or groups.get(a) == b or groups.get(b) == a  # noqa: E731
    clash = [[a["id"], b["id"]] for a, b in animgen.overlapping_same_target(st, related)]
    return {"code": "\n".join(x for x, _ in lines), "rows": [r for _, r in lines], "clash": clash}


PART_TYPES = ("math", "text")
PART_SHAPES = ("table", "matrix", "bullets", "title", "tex", "code", "theorem")


@app.post("/api/image/outline")
def image_outline(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """切り抜きの型にする要素の輪郭（Manim の座標の折れ線）。キャンバスで、画像を切り抜いた形を見せるため。"""
    from .project import normalize as _normalize
    el = dict(body.get("el") or {})
    p = state["project"]
    settings = (p.read()["settings"] if p else None) or {}
    data = _normalize({"settings": settings, "slides": [{"id": "s", "elements": [el], "steps": []}]})
    el = data["slides"][0]["elements"][0]
    if el.get("type") in ("image", "media"):
        raise HTTPException(status_code=400, detail="画像・動画は、切り抜きの型にできません。")
    expr = codegen.element_expr(el, data["settings"], {el["id"]: el})
    try:
        return preview_worker.request({"kind": "outline", "code": f"_gui_result = {expr}", "preamble": p.tex_preamble() if p else ""}, timeout=120)
    except PreviewError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/api/anim/parts")
def anim_parts(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """要素の部品（1 段目 v[i]・2 段目 v[i][j]）の外接矩形（Manim の座標）。ステップで、要素の一部分を選ぶため。"""
    from .project import normalize as _normalize
    el = dict(body.get("el") or {})
    if not (el.get("type") in PART_TYPES or (el.get("type") == "shape" and el.get("shape") in PART_SHAPES)):
        raise HTTPException(status_code=400, detail="この要素は、一部分を選べません（テキスト・数式・表・行列・箇条書き・題名・コードで選べます）。")
    p = state["project"]
    settings = (p.read()["settings"] if p else None) or {}
    data = _normalize({"settings": settings, "slides": [{"id": "s", "elements": [el], "steps": []}]})
    el = data["slides"][0]["elements"][0]
    expr = codegen.element_expr(el, data["settings"], {el["id"]: el})
    try:
        return preview_worker.request({"kind": "parts", "code": f"_gui_result = {expr}", "preamble": p.tex_preamble() if p else ""}, timeout=120)
    except PreviewError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/api/anim/pathpts")
def anim_pathpts(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """線に沿って動く動きの、線の点（Manim の座標）。キャンバスに道筋を描くため。付いている座標軸なども一緒に作る。"""
    from .project import normalize as _normalize
    p = state["project"]
    settings = (p.read()["settings"] if p else None) or {}
    els = [dict(e) for e in body.get("elements") or []]
    values = [dict(v) for v in body.get("values") or []]
    data = _normalize({"settings": settings, "slides": [{"id": "s", "elements": els, "values": values, "steps": []}]})
    sl = data["slides"][0]
    by_id = {e["id"]: e for e in sl["elements"]}
    tid = str(body.get("id") or "")
    if tid not in by_id:
        raise HTTPException(status_code=404, detail="線の要素が見つかりません。")
    # 線と、その線が使う要素（座標軸・グラフなど）だけを、書き出しと同じ順に作る
    need, stack = set(), [tid]
    while stack:
        i = stack.pop()
        if i in need or i not in by_id:
            continue
        need.add(i)
        e = by_id[i]
        stack += [e.get(k) for k in ("axesId", "graphId", "graph2Id", "targetId", "line1Id", "line2Id") if e.get(k)]
    vnames = tuple(v["name"] for v in sl.get("values", []) if v.get("name"))
    lines = [f"{v['name']} = ValueTracker({float(v.get('value', 0))})" for v in sl.get("values", []) if v.get("name")]
    for e in sl["elements"]:
        if e["id"] in need:
            lines.append(f"{e['var']} = {codegen.element_expr(e, data['settings'], by_id, vnames)}")
    lines.append(f"_gui_result = {by_id[tid]['var']}")
    try:
        return preview_worker.request({"kind": "pathpts", "code": "\n".join(lines), "preamble": p.tex_preamble() if p else ""}, timeout=120)
    except PreviewError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


# ---------------------------------------------------------------- 動画・音声

@app.post("/api/project/clip")
async def clip_import(request: Request) -> dict[str, Any]:
    """動画・音声を clips/ に取り込む。本体はファイルの中身そのまま（少しずつ一時ファイルに書く）、名前は X-File-Name。"""
    import tempfile

    p = _project()
    name = unquote(request.headers.get("x-file-name") or "clip.mp4")
    (p.folder / media.CLIPS_DIR).mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.folder / media.CLIPS_DIR, suffix=".part")
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > media.MAX_BYTES:
                    raise ProjectError("ファイルが大きすぎます（4 GB まで）。")
                f.write(chunk)
        if request.headers.get("x-anim-image"):  # 動く画像（GIF など）を、音の無い動画にして取り込む
            return media.import_anim_image(p.folder, Path(tmp), name, request.headers.get("x-background"))
        return media.import_media(p.folder, Path(tmp), name)
    except ProjectError as e:
        raise _err(e) from e
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@app.post("/api/project/clip/copy")
def clip_copy(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """別のプロジェクトから貼り付けた動画・音声の要素のファイルを、今のプロジェクトの clips/ に取り込む。"""
    import shutil
    import tempfile

    p = _project()
    src_folder = Path(str(body.get("folder", "")))
    try:
        if not (src_folder / "project.json").is_file():
            raise ProjectError("コピー元のプロジェクトが見つかりません。")
        src = media.resolve(src_folder, str(body.get("path", "")))
        if not src.is_file():
            raise ProjectError(f"コピー元のファイルが見つかりません: {body.get('path')}")
        (p.folder / media.CLIPS_DIR).mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=p.folder / media.CLIPS_DIR, suffix=".part")
        os.close(fd)
        shutil.copyfile(src, tmp)
        try:
            return media.import_media(p.folder, Path(tmp), str(body.get("name") or src.name))
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    except ProjectError as e:
        raise _err(e) from e


@app.get("/api/project/clip")
def clip_get(path: str) -> FileResponse:
    p = _project()
    try:
        f = media.resolve(p.folder, path)
    except ProjectError as e:
        raise _err(e) from e
    if not f.is_file():
        raise HTTPException(status_code=404, detail=f"ファイルが見つかりません: {path}")
    return FileResponse(f, headers={"Cache-Control": "no-store"})


@app.get("/api/project/clip/poster")
def clip_poster(path: str, t: float = 0.0, w: int = 0) -> Response:
    """動画の t 秒のコマ（PNG）。キャンバスでの表示と、再生前に出すコマ。"""
    p = _project()
    try:
        data = media.poster(p.folder, path, t, w)
    except ProjectError as e:
        raise _err(e) from e
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- テンプレート（設定・スライドの型）

@app.get("/api/export-presets")
def export_presets_list() -> dict[str, Any]:
    from . import export_presets
    return {"items": export_presets.load()}


@app.post("/api/export-presets")
def export_presets_add(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import export_presets
    try:
        return {"items": export_presets.add(body)}
    except ValueError as e:
        raise _err(e) from e


@app.post("/api/export-presets/delete")
def export_presets_delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import export_presets
    return {"items": export_presets.delete(str(body.get("id") or ""))}


@app.get("/api/presets")
def presets_list() -> dict[str, Any]:
    from . import presets
    return {"items": presets.load()}


@app.post("/api/presets")
def presets_add(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import presets
    try:
        return {"items": presets.add(body)}
    except ValueError as e:
        raise _err(e) from e


@app.post("/api/presets/delete")
def presets_delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import presets
    return {"items": presets.delete(str(body.get("id") or ""))}


@app.post("/api/presets/rename")
def presets_rename(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import presets
    try:
        return {"items": presets.rename(str(body.get("id") or ""), str(body.get("name") or ""))}
    except ValueError as e:
        raise _err(e) from e


# ---------------------------------------------------------------- 部品（要素のテンプレート）

@app.get("/api/parts")
def parts_list() -> dict[str, Any]:
    return {"parts": parts.list_all()}


@app.post("/api/parts")
def parts_save(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """部品を保存する（id を渡すと上書き）。保存したテンプレートを返す。"""
    try:
        return parts.save(body.get("name"), body.get("elements") or [], str(body.get("thumb") or ""), body.get("id") or None)
    except ProjectError as e:
        raise _err(e) from e


@app.post("/api/parts/rename")
def parts_rename(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return parts.rename(str(body.get("id") or ""), body.get("name"))
    except ProjectError as e:
        raise _err(e) from e


@app.post("/api/parts/delete")
def parts_delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        parts.delete(str(body.get("id") or ""))
    except ProjectError as e:
        raise _err(e) from e
    return {"ok": True}


@app.get("/api/templates")
def templates_list() -> dict[str, Any]:
    from . import templates
    return templates.list_all()


@app.post("/api/templates/settings")
def templates_save_settings(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import templates
    try:
        return templates.save_settings(body.get("name"), body.get("settings") or {}, body.get("preamble"))
    except ProjectError as e:
        raise _err(e) from e


@app.post("/api/templates/settings/get")
def templates_get_settings(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import templates
    try:
        return templates.get_settings(body.get("name"))
    except ProjectError as e:
        raise _err(e, 404) from e


@app.post("/api/templates/slides")
def templates_save_slide(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import templates
    p = _project()
    try:
        return templates.save_slide(body.get("name"), body.get("slide") or {}, p.folder, str(body.get("thumb") or ""))
    except ProjectError as e:
        raise _err(e) from e


@app.post("/api/templates/slides/use")
def templates_use_slide(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import templates
    p = _project()
    try:
        return templates.use_slide(body.get("name"), p.folder)
    except (ProjectError, OSError, ValueError) as e:
        raise HTTPException(status_code=404, detail=f"スライドの型を使えませんでした: {e}") from e


@app.post("/api/templates/delete")
def templates_delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from . import templates
    try:
        templates.delete("settings" if body.get("kind") == "settings" else "slides", body.get("name"))
    except ProjectError as e:
        raise _err(e) from e
    return templates.list_all()


# ---------------------------------------------------------------- 共通プリアンブル

@app.get("/api/preamble")
def preamble_get() -> dict[str, Any]:
    p = _project()
    text = p.read_preamble()
    return {"text": text, "macros": preamble.extract_macros(text)}


@app.put("/api/preamble")
def preamble_put(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    p = _project()
    text = str(body.get("text", ""))
    p.write_preamble(text)
    _backup_quiet(lambda: backup.maybe(p.folder, p.read(), text))
    test = preamble.compile_test(text) if body.get("test", True) else None
    return {"text": text, "macros": preamble.extract_macros(text), "test": test}


@app.post("/api/preamble/test")
def preamble_test(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    text = str(body.get("text", ""))
    return {"test": preamble.compile_test(text), "macros": preamble.extract_macros(text)}


# ---------------------------------------------------------------- 書き出し・描画

def _include_of(body: dict[str, Any]) -> list[int] | None:
    """今回だけ描画するスライド（番号の並び）。無ければ None（「描画しない」の印の通り）。"""
    inc = body.get("include")
    if not isinstance(inc, list):
        return None
    return [i for i in inc if isinstance(i, int) and not isinstance(i, bool)]


def _export(p: Project, include: list[int] | None = None) -> dict[str, Any]:
    data = p.read()
    try:
        out = codegen.export(data, p.read_preamble(), p.folder, include)
    except codegen.ExportError as e:
        raise HTTPException(status_code=422, detail={"message": str(e), "problems": e.problems}) from e
    # 今回だけ選んだスライド（ファイルへの出力の前に、描画のあとで内容を変えたかを確かめるときに使う）
    sel = p.folder / f"{out['className']}.include.json"
    if include is None:
        sel.unlink(missing_ok=True)
    else:
        sel.write_text(json.dumps(include), encoding="utf-8")
    return out


@app.post("/api/export")
def export(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return _export(_project(), _include_of(body))


# ---------------------------------------------------------------- 1 枚だけの試し描画（Ctrl+Enter）

PREVIEW_CLASS = "GuiSlidePreview"
# ほかの要素に付いて形が決まる図形（色が流れる枠を付けられない）
DEPENDENT_SHAPES = ("graph", "graphpart", "axdot", "curve2d", "implicit", "angle", "brace", "balloon", "annot", "boolean", "vector",
                    "linegraph", "trace", "field", "surface", "curve3d", "point3d")  # 試し描画のクラス名（プロジェクトのフォルダに GuiSlidePreview.py を書き、slides/ に結果を出す）


@app.post("/api/preview/slide")
def preview_slide(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """編集中のスライドだけを書き出して描画する（発表用のクラスとは別の名前で、プロジェクトの描画結果は上書きしない）。"""
    p = _project()
    env = envcheck.last() or envcheck.run_all()
    if not env["renderReady"]:
        raise HTTPException(status_code=409, detail="必須の項目が不足しているため描画できません: " + "、".join(env["missing"]))
    data = p.read()
    try:
        si = int(body.get("slideIndex", 0))
    except (TypeError, ValueError):
        si = 0
    if not 0 <= si < len(data["slides"]):
        raise HTTPException(status_code=400, detail="スライドが見つかりません。")
    # 検査はプロジェクト全体で行い（変数名の重複など）、このスライドの問題だけを知らせる
    problems = [x for x in codegen.validate(data) + images.missing_images(data, p.folder) + media.missing_media(data, p.folder) if x.get("slideIndex") in (None, si)]
    if problems:
        raise HTTPException(status_code=422, detail={"message": "書き出し前の検査でエラーが見つかりました。", "problems": problems})
    from . import refs
    applied = refs.apply(data)  # 番号・参照は、プロジェクト全体で数える
    sub = {**applied, "settings": {**data["settings"], "className": PREVIEW_CLASS}, "slides": [applied["slides"][si]]}
    from .project import page_plan, section_plan
    # ページ番号・章の表示は全体の番号（描画しないスライドでも試し描画できる）
    source, mapping = codegen.generate({**sub, "_projectFonts": bool(projfonts.files(p.folder))}, p.read_preamble(), pages=[page_plan(data)[si]], all_slides=True,
                                       sections=[section_plan(data)[si]])
    for v in mapping["lines"].values():  # エラーの位置は、元のスライドの番号で知らせる
        if isinstance(v, dict) and v.get("slideIndex") is not None:
            v["slideIndex"] = si
    (p.folder / f"{PREVIEW_CLASS}.py").write_text(source, encoding="utf-8", newline="\n")
    (p.folder / f"{PREVIEW_CLASS}.map.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        job = renders.start(p.folder, PREVIEW_CLASS, body.get("quality", "low"), False, slide_index=si)
    except RuntimeError as e:
        raise _err(e, 409) from e
    return job.to_dict()


@app.get("/api/preview/slide/segments")
def preview_slide_segments() -> dict[str, Any]:
    """試し描画の結果: クリックの区切りごとの動画（slides/ からの相対パス）と、区切りの番号（0 = スライドの初め）。"""
    p = _project()
    cfg_path = p.folder / "slides" / f"{PREVIEW_CLASS}.json"
    if not cfg_path.is_file():
        raise HTTPException(status_code=404, detail="試し描画の結果がありません。")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    try:
        pages = json.loads((p.folder / "slides" / "gui_pages" / f"{PREVIEW_CLASS}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pages = []
    segs = []
    for k, sl in enumerate(cfg.get("slides", [])):
        click = pages[k][1] if k < len(pages) and isinstance(pages[k], list) and len(pages[k]) > 1 else k
        segs.append({"file": str(sl.get("file", "")).replace("\\", "/"), "click": click, "loop": bool(sl.get("loop")),
                     "autoNext": bool(sl.get("auto_next")), "notes": str(sl.get("notes") or "")})
    try:  # 動画・音声（発表で再生）の記録
        plan = json.loads((p.folder / "slides" / "gui_pages" / f"{PREVIEW_CLASS}.media.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        plan = None
    return {"segments": segs, "resolution": cfg.get("resolution"), "updated": cfg_path.stat().st_mtime, "media": plan}


@app.get("/api/project/media")
def project_media(path: str) -> FileResponse:
    """描画結果の動画（プロジェクトの slides/ の中だけ）。"""
    p = _project()
    base = (p.folder / "slides").resolve()
    f = (p.folder / path).resolve()
    if base not in f.parents or not f.is_file():
        raise HTTPException(status_code=404, detail="動画が見つかりません。")
    return FileResponse(f, headers={"Cache-Control": "no-store"})


@app.post("/api/render")
def render_start(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    env = envcheck.last() or envcheck.run_all()
    if not env["renderReady"]:
        raise HTTPException(status_code=409, detail="必須の項目が不足しているため描画できません: " + "、".join(env["missing"]))
    info = _export(p, _include_of(body))
    try:
        job = renders.start(p.folder, info["className"], body.get("quality", "high"),
                            bool(body.get("present", True)) and env.get("presentReady", False))
    except RuntimeError as e:
        raise _err(e, 409) from e
    return {**job.to_dict(), **_spin_notice(p.read(), _include_of(body), body.get("quality", "high"))}


def _spin_notice(data: dict[str, Any], include: list[int] | None, quality: str) -> dict[str, Any]:
    """描画を始めるときの知らせ: 「ずっと回す」の 1 周を描くスライドと、そのコマ数（3D の回転は時間がかかるため）。"""
    fps = {"low": 15, "medium": 30, "high": 60, "high30": 30}.get(quality, 60)
    laps = [x for x in codegen.spin_laps(data) if (include is None or x["slide"] - 1 in include)
            and not data["slides"][x["slide"] - 1].get("skip")]
    if not laps or not data["settings"].get("use3d"):
        return {}
    total = sum(x["seconds"] for x in laps)
    where = "・".join(f"スライド {x['slide']}（{x['seconds']:g} 秒）" for x in laps[:4]) + (" ほか" if len(laps) > 4 else "")
    return {"notice": f"「ずっと回す」の 1 周を描きます: {where}。合わせて {total:g} 秒・{round(total * fps)} コマです。"
                      "3D の回転は 1 コマに時間がかかるので、長くかかることがあります（2 回目からは、変えていないスライドの分は描き直しません）。"}


@app.get("/api/render/{job_id}")
def render_status(job_id: str) -> dict[str, Any]:
    job = renders.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="描画ジョブが見つかりません。")
    return job.to_dict()


@app.post("/api/render/{job_id}/cancel")
def render_cancel(job_id: str) -> dict[str, Any]:
    job = renders.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="描画ジョブが見つかりません。")
    job.cancel()
    return job.to_dict()


# ---------------------------------------------------------------- HTML・PDF・PowerPoint への書き出し

@app.get("/api/convert/info")
def convert_info() -> dict[str, Any]:
    """書き出しの画面に出す情報: 描画してあるか、描画のあとに保存したか、注意すること。"""
    p = _project()
    data = p.read()
    cls = data["settings"]["className"]
    cfg_path = p.folder / "slides" / f"{cls}.json"
    uc = userconfig.load()
    ve = uc.get("videoExport") or {}
    out: dict[str, Any] = {"rendered": cfg_path.exists(), "className": cls, "video": {"wait": ve.get("wait", 2.0), "srt": bool(ve.get("srt")),
                                                                                    "srtMode": "step" if ve.get("srtMode") == "step" else "all"},
                           "handout": uc.get("handoutExport") or {}, "images": uc.get("imageExport") or {},
                           "videoWaits": sum((sl.get("videoWait") is not None) + sum(st.get("videoWait") is not None for st in sl.get("steps") or [])
                                             for sl in data["slides"]), "exportDir": str(convert.export_dir(p.folder)),
                           "outputs": {f: str(convert.output_path(p.folder, cls, f)) for f in convert.FORMATS}}
    out["exists"] = {f: convert.output_path(p.folder, cls, f).exists() for f in convert.FORMATS}
    if cfg_path.exists():
        # 描画のあとに内容を変えたか: 今の内容から作るコードが、描画に使ったコード（<クラス名>.py）と違えば変えている
        py = p.folder / f"{cls}.py"
        try:
            try:
                inc = json.loads((p.folder / f"{cls}.include.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                inc = None
            src, _ = codegen.generate({**data, "_projectFonts": bool(projfonts.files(p.folder))}, p.read_preamble(), include=inc if isinstance(inc, list) else None)
            out["stale"] = (not py.exists() or py.read_text(encoding="utf-8") != src
                            or py.stat().st_mtime > cfg_path.stat().st_mtime + 1)
        except (codegen.ExportError, OSError):
            out["stale"] = True
        try:
            segs = json.loads(cfg_path.read_text(encoding="utf-8")).get("slides") or []
        except (OSError, ValueError):
            segs = []
        out["segments"] = len(segs)
        out["loopEdge"] = bool(segs) and (bool(segs[0].get("loop")) or bool(segs[-1].get("loop")))
        out["hasNotes"] = any(s.get("notes") for s in segs)
        try:  # 1 本の動画: 区切りの元の記録（ステップごとの待ち時間に使う。古い描画には無い）
            keys = json.loads((p.folder / "slides" / "gui_pages" / f"{cls}.segs.json").read_text(encoding="utf-8"))
            out["videoKeys"] = isinstance(keys, list) and len(keys) == len(segs)
        except (OSError, ValueError):
            out["videoKeys"] = False
        try:  # 描画したスライド（描画しないスライドは、出力にも入らない）
            done = json.loads((p.folder / f"{cls}.map.json").read_text(encoding="utf-8")).get("slides")
        except (OSError, ValueError):
            done = None
        if isinstance(done, list):
            out["renderedSlides"], out["totalSlides"] = len(done), len(data["slides"])
    out["liveMedia"] = any(e.get("type") == "media" and e.get("mode") != "bake" for sl in data["slides"] for e in sl["elements"])
    out["bakeMedia"] = any(e.get("type") == "media" and e.get("mode") == "bake" for sl in data["slides"] for e in sl["elements"])
    return out


@app.post("/api/convert")
def convert_start(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    st = p.read()["settings"]
    cls = st["className"]
    if not (p.folder / "slides" / f"{cls}.json").exists():
        raise HTTPException(status_code=409, detail="描画結果がありません。先に「▶ 描画・発表」で描画してください。")
    try:
        video = None
        if body.get("format") == "mp4":
            try:
                wait = min(600.0, max(0.0, float(body.get("wait", 2.0))))
            except (TypeError, ValueError):
                wait = 2.0
            mode = "step" if body.get("srtMode") == "step" else "all"
            video = {"wait": wait, "srt": bool(body.get("srt")), "srtMode": mode, "project": p.read()}
            userconfig.save({"videoExport": {"wait": wait, "srt": video["srt"], "srtMode": mode}})
        elif body.get("format") == "handout":
            from .handout import LAYOUTS, ORIENTS, PAPERS
            video = {"layout": body.get("layout") if body.get("layout") in LAYOUTS else "notes1",
                     "paper": body.get("paper") if body.get("paper") in PAPERS else "A4",
                     "unit": "step" if body.get("unit") == "step" else "slide",
                     "orient": body.get("orient") if body.get("orient") in ORIENTS else "auto", "project": p.read()}
            userconfig.save({"handoutExport": {k: video[k] for k in ("layout", "paper", "unit", "orient")}})
        elif body.get("format") in ("png", "gif"):
            video = {"unit": "step" if body.get("unit") == "step" else "slide", "pages": str(body.get("pages") or "")[:200],
                     "width": int(body.get("width")) if str(body.get("width")) in ("480", "720", "960", "1280") else 720,
                     "fps": int(body.get("fps")) if str(body.get("fps")) in ("10", "15", "20", "30") else 15}
            userconfig.save({"imageExport": {k: video[k] for k in ("unit", "pages", "width", "fps")}})
        job = converts.start(p.folder, cls, str(body.get("format", "html")), bool(body.get("oneFile")), bool(body.get("allowDownload")),
                             str(st.get("background") or ""), str(st.get("name") or ""),
                             bool(body.get("pdfPages")), video)
    except (ValueError, RuntimeError) as e:
        raise _err(e, 409) from e
    return job.to_dict()


@app.get("/api/convert/{job_id}")
def convert_status(job_id: str) -> dict[str, Any]:
    job = converts.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="出力のジョブが見つかりません。")
    return job.to_dict()


@app.post("/api/convert/{job_id}/cancel")
def convert_cancel(job_id: str) -> dict[str, Any]:
    job = converts.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="出力のジョブが見つかりません。")
    job.cancel()
    return job.to_dict()


@app.post("/api/convert-open")
def convert_open(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """書き出したファイル（無ければ書き出し先のフォルダ）を、ファイル管理の画面で開く。"""
    p = _project()
    cls = p.read()["settings"]["className"]
    fmt = body.get("format")
    target = convert.output_path(p.folder, cls, fmt) if fmt in convert.FORMATS else convert.export_dir(p.folder)
    if not target.exists():
        target = convert.export_dir(p.folder)
        target.mkdir(parents=True, exist_ok=True)
    try:
        convert.open_in_file_manager(target)
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True, "path": str(target)}


def _folder_or_none() -> Path | None:
    p = state.get("project")
    return p.folder if p is not None else None


records = recording.RecordManager(_folder_or_none, present_running)


@app.get("/api/record/settings")
def record_settings() -> dict[str, Any]:
    return recording.load_settings()


@app.post("/api/record/settings")
def record_settings_save(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return recording.save_settings(body)


@app.get("/api/record/devices")
def record_devices() -> dict[str, Any]:
    return recording.list_devices()


@app.get("/api/recordings")
def recordings_list() -> dict[str, Any]:
    p = _project()
    return {"items": records.items(p.folder), "presenting": present_running(), "folder": str(recording.rec_dir(p.folder))}


def _rec_name(body: dict[str, Any]) -> str:
    name = str(body.get("id") or "")
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(status_code=400, detail="録画の名前が正しくありません。")
    return name


@app.post("/api/recordings/compose")
def recordings_compose(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    return records.compose(p.folder, _rec_name(body))


@app.post("/api/recordings/cancel")
def recordings_cancel(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    return records.cancel(p.folder, _rec_name(body))


@app.post("/api/recordings/delete")
def recordings_delete(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    p = _project()
    return records.delete(p.folder, _rec_name(body), bool(body.get("keepVideo")))


@app.post("/api/recordings/open")
def recordings_open(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """録画の動画を開く（what="video"）か、録画のフォルダを開く（what="folder"）。"""
    p = _project()
    d = recording.rec_dir(p.folder)
    d.mkdir(parents=True, exist_ok=True)
    try:
        if body.get("what") == "video":
            v = d / f"{_rec_name(body)}.mp4"
            if not v.is_file():
                raise HTTPException(status_code=404, detail="動画のファイルが見つかりません。")
            recording.open_video(v)
        else:
            v = d / f"{body['id']}.mp4" if body.get("id") else d
            convert.open_in_file_manager(v if v.exists() else d)
    except OSError as e:
        raise _err(e, 500) from e
    return {"ok": True}


@app.post("/api/present")
def present() -> dict[str, Any]:
    p = _project()
    cls = p.read()["settings"]["className"]
    return launch_present(p.folder, cls)


@app.post("/api/preview/text")
def preview_text(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """テキスト要素を、書き出しと同じ gui_text で組み立て、実際の形を SVG で返す。"""
    el = fonts.resolve_in(dict(body.get("el") or {}))  # この PC で描ける名前にする（プリセットの別の候補）
    settings = fonts.resolve_in({**DEFAULT_SETTINGS, **(body.get("settings") or {})})
    normalize_text_element(el, settings)
    kwargs = gui_text_kwargs(el, settings, codegen.font_size_of(el, settings))
    try:
        return preview_worker.render(normalize_runs(el), kwargs)
    except PreviewError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/api/preview/shape")
def preview_shape(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """図形要素を、書き出しと同じ gui_shape / gui_balloon_shape で作り、実際の形を SVG で返す。
    吹き出しは、GUI が中身から求めた箱の大きさ（box: 幅・高さ、キャンバスの px）を使う。"""
    el = fonts.resolve_in(dict(body.get("el") or {}))
    settings = fonts.resolve_in({**DEFAULT_SETTINGS, **(body.get("settings") or {})})
    el["type"] = "shape"
    normalize_shape_element(el, settings)
    # スライドの値（名前: 初めの値）。グラフ・ベクトル場・座標の点・数値は、この値でプレビューする
    values = {str(k): float(v) for k, v in (body.get("values") or {}).items() if str(k).isidentifier()}
    vnames = tuple(values)
    try:
        if el["shape"] == "svg":
            p = state["project"]
            if not p:
                raise HTTPException(status_code=400, detail="プロジェクトが開かれていません。")
            try:
                path = images.resolve(p.folder, el["path"])
            except ProjectError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            if not path.is_file():
                raise HTTPException(status_code=404, detail=f"SVG のファイルが見つかりません: {el['path']}")
            return preview_worker.request({"kind": "svg", "path": str(path), "kwargs": svg_kwargs(el)}, timeout=60)
        if el["shape"] in SHAPES_3D:
            return preview_3d(el, body, settings, values)
        if el["shape"] == "part":
            # 部品: 中身（送られてきた写し）を、書き出しと同じ式で作る
            from .project import normalize_parts
            pdefs = normalize_parts([body.get("part")] if isinstance(body.get("part"), dict) else [], settings)
            if not pdefs:
                raise HTTPException(status_code=404, detail="部品の中身が見つかりません。")
            p = state["project"]
            code = f"_gui_result = {codegen.part_expr(pdefs[0], settings, vnames)}.scale({float(el['scale'])}, about_point=ORIGIN)"
            return preview_worker.request({"kind": "part", "code": code, "preamble": p.tex_preamble() if p else ""}, timeout=180)
        if el["shape"] == "axes":
            p = state["project"]
            return preview_worker.request({"kind": "axes", "kwargs": {"kind": el["axesKind"], **axes_kwargs(el)},
                                           "basis": bool(el.get("linear") and el.get("basis")),
                                           "preamble": p.tex_preamble() if p else ""}, timeout=120)
        if el["shape"] in ("table", "matrix") and shapemodel.table_item_ids(el):
            p = state["project"]
            return preview_cells(el, body, settings, p.tex_preamble() if p else "")
        if el["shape"] == "matrix":
            p = state["project"]
            return preview_worker.request({"kind": "matrix", "cells": el["cells"], "kwargs": matrix_kwargs(el, codegen.font_size_of(el, settings)),
                                           "preamble": p.tex_preamble() if p else ""}, timeout=180)
        if el["shape"] == "angle":
            lines = []
            for ln in body.get("lines") or []:
                ln = dict(ln)
                ln["type"], ln["shape"] = "shape", "line"
                normalize_shape_element(ln, settings)
                x, y, dx, dy = float(ln.get("x", 0)), float(ln.get("y", 0)), ln["dx"], ln["dy"]
                lines.append([codegen.to_manim_xy(x - dx, y - dy), codegen.to_manim_xy(x + dx, y + dy)])
            if len(lines) != 2:
                raise HTTPException(status_code=400, detail="角を付ける 2 本の線が見つかりません。")
            p = state["project"]
            return preview_worker.request({"kind": "angle", "lines": lines, "kwargs": angle_kwargs(el, float(settings.get("fontSizeScale") or 1)),
                                           "preamble": p.tex_preamble() if p else ""}, timeout=120)
        if el["shape"] == "fcurve":
            try:
                k = el["curveKind"]
                if k == "parametric":
                    cv = tuple(v for v in vnames if v != "t")
                    exprs = [to_python(el[q], el["lang"], ("t", *cv)) for q in ("xExpr", "yExpr")]
                    used = used_names(f"({exprs[0]}) + ({exprs[1]})", cv)
                elif k == "implicit":
                    iv = tuple(v for v in vnames if v not in ("x", "y"))
                    exprs = [implicit_python(el["expr"], el["lang"], ("x", "y", *iv), to_python)]
                    used = used_names(exprs[0], iv)
                else:
                    exprs = [to_python(el["expr"], el["lang"], ("x", *vnames))]
                    used = used_names(exprs[0], vnames)
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            kw = {**shapemodel.fcurve_kwargs(el), "params": {n: values[n] for n in used}}
            res = preview_worker.request({"kind": "fcurve", "curve": el["curveKind"], "exprs": exprs, "kwargs": kw}, timeout=60)
            return {**res, "python": exprs if len(exprs) > 1 else exprs[0]}
        if el["shape"] == "tangent":
            return preview_tangent(el, body, settings, values)
        if el["shape"] in ("graphpart", "curve2d", "implicit"):
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            try:
                if el["shape"] == "graphpart":
                    g = dict(body.get("graph") or {})
                    expr = to_python(str(g.get("expr") or "0"), "python" if g.get("lang") == "python" else "latex", ("x", *vnames))
                    kw = graphpart_kwargs(el, lambda x: to_python(x, "latex", vnames))
                    nk = ("x_range", "dx", "x", "length", "c")  # 式を書ける引数（色などの文字列は除く）
                    strs = [v for k, v in kw.items() if k in nk and isinstance(v, str)] + [x for k, v in kw.items() if k == "x_range" for x in v if isinstance(x, str)]
                    g2 = body.get("graph2") if el["partKind"] == "area" and el.get("graph2Id") else None
                    if g2:  # 2 つのグラフの間の面積
                        kw["expr2"] = to_python(str(g2.get("expr") or "0"), "python" if g2.get("lang") == "python" else "latex", ("x", *vnames))
                        strs.append(kw["expr2"])
                    req = {"kind": "graphpart", "part": el["partKind"], "exprs": [expr], "kwargs": kw, "preamble": preamble_text()}
                    used = used_names(" + ".join(f"({x})" for x in [expr, *strs]), vnames)
                elif el["shape"] == "curve2d":
                    cv = tuple(v for v in vnames if v != "t")
                    xs = [to_python(el[k], el["lang"], ("t", *cv)) for k in ("xExpr", "yExpr")]
                    req = {"kind": "curve2d", "exprs": xs, "kwargs": curve2d_kwargs(el)}
                    used = used_names(f"({xs[0]}) + ({xs[1]})", cv)
                else:
                    iv = tuple(v for v in vnames if v not in ("x", "y"))
                    ex = implicit_python(el["expr"], el["lang"], ("x", "y", *iv), to_python)
                    req = {"kind": "implicit", "exprs": [ex], "kwargs": curve2d_kwargs(el)}
                    used = used_names(ex, iv)
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            req["axes"] = {"kind": ax["axesKind"], **axes_kwargs(ax, with_extras=False)}
            req["kwargs"]["params"] = {n: values[n] for n in used}
            res = preview_worker.request(req, timeout=60)
            return {**res, "python": req["exprs"] if len(req["exprs"]) > 1 else req["exprs"][0]}
        if el["shape"] == "graph" and (body.get("axes") or {}).get("axesKind") == "complex" and el["complexCurve"]:
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            cv = tuple(v for v in vnames if v not in ("t", "x", "i"))
            try:
                expr = to_python(el["expr"], el["lang"], ("t", "x", "i", *cv))
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            kw = {**complex_kwargs(el), "params": {n: values[n] for n in used_names(expr, cv)}}
            return {**preview_worker.request({"kind": "complex", "axes": {"kind": "complex", **axes_kwargs(ax, with_extras=False)},
                                              "exprs": [expr], "kwargs": kw}), "python": expr}
        if el["shape"] == "graph" and (body.get("axes") or {}).get("axesKind") == "polar":
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            pv = tuple(v for v in vnames if v != "theta")
            try:
                expr = to_python(el["expr"], el["lang"], ("theta", *pv))
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            kw = {**polar_kwargs(el), "params": {n: values[n] for n in used_names(expr, pv)}}
            return {**preview_worker.request({"kind": "polar", "axes": {"kind": "polar", **axes_kwargs(ax, with_extras=False)},
                                              "exprs": [expr], "kwargs": kw}), "python": expr}
        if el["shape"] == "graph":
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            try:
                expr = to_python(el["expr"], el["lang"], ("x", *vnames))
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            params = {n: values[n] for n in used_names(expr, vnames)}
            return {**preview_worker.request({"kind": "graph", "axes": axes_kwargs(ax, with_extras=False), "expr": expr,
                                              "kwargs": {**graph_kwargs(el, expr), "params": params}}), "python": expr}
        if el["shape"] == "axdot":
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            try:
                px = to_python(el["xExpr"], el["lang"], vnames)
                py = to_python(el["yExpr"], el["lang"], vnames)
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            params = {n: values[n] for n in used_names(f"({px}) + ({py})", vnames)}
            return {**preview_worker.request({"kind": "axdot", "axes": axes_kwargs(ax, with_extras=False), "x": px, "y": py,
                                              "kwargs": {**axdot_kwargs(el), "params": params}}), "python": [px, py]}
        if el["shape"] == "number":
            p = state["project"]
            value = values.get(el["valueName"], el["number"]) if el["valueName"] else el["number"]
            if el["valueName"] and el["valueName"] not in values:
                raise HTTPException(status_code=400, detail=f"値「{el['valueName']}」が、このスライドの値にありません。")
            return preview_worker.request({"kind": "number", "value": value, "kwargs": number_kwargs(el, codegen.font_size_of(el, settings)),
                                           "preamble": p.tex_preamble() if p else ""}, timeout=120)
        if el["shape"] == "table":
            p = state["project"]
            kw = table_kwargs(el, codegen.font_size_of(el, settings))
            return preview_worker.request({"kind": "table", "cells": el["cells"], "kwargs": kw, "math": table_uses_math(el),
                                           "preamble": p.tex_preamble() if p else ""}, timeout=180)
        if el["shape"] == "field":
            try:
                fx = to_python(el["fx"], el["lang"], ("x", "y", *vnames))
                fy = to_python(el["fy"], el["lang"], ("x", "y", *vnames))
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            fparams = {n: values[n] for n in used_names(f"({fx}) + ({fy})", vnames)}
            req = {"kind": "field", "field": el["fieldKind"], "fx": fx, "fy": fy, "params": fparams}
            if body.get("axes"):
                ax = dict(body["axes"])
                ax["type"], ax["shape"] = "shape", "axes"
                normalize_shape_element(ax, settings)
                req.update(axes=axes_kwargs(ax, with_extras=False), kwargs=field_kwargs(el, True))
            else:
                req["kwargs"] = field_kwargs(el, False)
            return {**preview_worker.request(req, timeout=60), "python": [fx, fy]}
        if el["shape"] == "brace":
            kw = brace_kwargs(el)
            kw.pop("label", None)  # ラベルはキャンバス側で表示する（数式は MathJax、テキストは常駐の Manim）
            for k in ("label_kind", "label_size", "label_color", "label_font"):
                kw.pop(k, None)
            req = {"kind": "brace", "kwargs": kw}
            if el["mode"] == "target":
                box = body.get("box") or {}
                req["box"] = [max(float(box.get("w") or el["width"]), 1) / shapemodel.PX,
                              max(float(box.get("h") or el["height"]), 1) / shapemodel.PX]
            else:
                req["start"] = [-el["dx"] / shapemodel.PX, el["dy"] / shapemodel.PX]
                req["end"] = [el["dx"] / shapemodel.PX, -el["dy"] / shapemodel.PX]
            return preview_worker.request(req)
        if el["shape"] == "balloon":
            box = body.get("box") or {}
            kw = balloon_kwargs(el)
            kw["width"] = max(float(box.get("w") or el["width"]), 1) / shapemodel.PX
            kw["height"] = max(float(box.get("h") or el["height"]), 1) / shapemodel.PX
            return preview_worker.request({"kind": "balloon", "kwargs": kw})
        fscale = float(settings.get("fontSizeScale") or 1)
        p = state["project"]
        preamble = p.tex_preamble() if p else ""
        if el["shape"] == "code":
            return preview_worker.request({"kind": "code", "code": el["code"],
                                           "kwargs": code_kwargs(el, codegen.font_size_of(el, settings))}, timeout=120)
        if el["shape"] == "statchart":
            from .statmodel import statchart_args  # noqa: PLC0415
            ck, kw = statchart_args(el, fscale)
            return preview_worker.request({"kind": "statchart", "chartKind": ck, "kwargs": kw, "preamble": preamble}, timeout=180)
        if el["shape"] == "barchart":
            return preview_worker.request({"kind": "barchart", "values": [b["value"] for b in el["bars"]],
                                           "kwargs": barchart_kwargs(el, fscale), "tex": barchart_uses_tex(el),
                                           "preamble": preamble}, timeout=180)
        if el["shape"] == "theorem":
            head, paras, kw = theorem_args(el, settings, codegen.font_size_of(el, settings))
            return preview_worker.request({"kind": "tex", "what": "theorem", "head": head, "body": paras, "kwargs": kw,
                                           "preamble": preamble}, timeout=180)
        if el["shape"] in ("tex", "title", "bullets"):
            kw: dict[str, Any] = {"font_size": codegen.font_size_of(el, settings), "color": el["color"]}
            if el["shape"] == "bullets":
                body_ = [x for x in el["items"] if x.strip()]
                kw.update(buff=el["buff"], dot_scale=el["dotScale"])
            else:
                body_ = tex_body(el["latex"])
                if el["shape"] == "title":
                    kw.update(underline=el["underline"], match_width=el["matchWidth"], align=el["align"])
            return preview_worker.request({"kind": "tex", "what": el["shape"], "body": body_, "kwargs": kw, "preamble": preamble}, timeout=180)
        if el["shape"] == "boolean" or (el["shape"] == "annot" and el["annotKind"] == "animated"):
            return preview_boolean(el, body, settings, preamble)
        if el["shape"] == "points":
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            try:
                kw = points_kwargs(el)
            except ExprError as ex:
                raise HTTPException(status_code=400, detail=f"式を読めません: {ex}") from ex
            return preview_worker.request({"kind": "points", "axes": axes_kwargs(ax, with_extras=False), "kwargs": kw}, timeout=120)
        if el["shape"] == "linegraph":
            ax = dict(body.get("axes") or {})
            ax["type"], ax["shape"] = "shape", "axes"
            normalize_shape_element(ax, settings)
            return preview_worker.request({"kind": "linegraph", "axes": axes_kwargs(ax, with_extras=False),
                                           "xs": [q[0] for q in el["points"]], "ys": [q[1] for q in el["points"]],
                                           "kwargs": linegraph_kwargs(el)})
        if el["shape"] == "annot":
            if el["annotKind"] == "arcbrace":
                arc = dict(body.get("arc") or {})
                arc["type"], arc["shape"] = "shape", "arc"
                normalize_shape_element(arc, settings)
                kw = arcbrace_kwargs(el, {**arc, "rotation": float((body.get("arc") or {}).get("rotation") or 0)}, fscale)
                return preview_worker.request({"kind": "arcbrace", "kwargs": kw, "preamble": preamble}, timeout=120)
            box = body.get("box") or {}
            req = {"kind": "annot", "annot": el["annotKind"], "kwargs": annot_kwargs(el),
                   "box": [max(float(box.get("w") or el["width"]), 1) / shapemodel.PX, max(float(box.get("h") or el["height"]), 1) / shapemodel.PX]}
            return preview_worker.request(req)
        if el["shape"] == "vector":
            try:
                xs = [to_python(el[k], el["lang"], vnames) for k in ("xExpr", "yExpr", "x0Expr", "y0Expr")]
            except ExprError as e:
                raise HTTPException(status_code=400, detail=f"式: {e}") from e
            params = {n: values[n] for n in used_names(" + ".join(f"({x})" for x in xs), vnames)}
            req = {"kind": "vector", "exprs": xs, "kwargs": {**vector_kwargs(el), "params": params}}
            if body.get("axes"):
                ax = dict(body["axes"])
                ax["type"], ax["shape"] = "shape", "axes"
                normalize_shape_element(ax, settings)
                req["axes"] = axes_kwargs(ax, with_extras=False)
            return {**preview_worker.request(req), "python": xs}
        if el["shape"] == "netgraph":
            names, edges, kw = netgraph_kwargs(el, fscale)
            return preview_worker.request({"kind": "netgraph", "names": names, "edges": edges, "kwargs": kw, "preamble": preamble}, timeout=180)
        if el["shape"] == "samplespace":
            return preview_worker.request({"kind": "samplespace", "kwargs": samplespace_kwargs(el, fscale), "preamble": preamble}, timeout=180)
        if el["shape"] == "dot" and el.get("pname") and el.get("pnamePos") == "auto":
            # 点の名前の向き（自動）: 同じスライドの円・線（キャンバスから送られた nameCtx）から決める
            el["_pnameDir"] = shapemodel.pname_auto_dir(el, [x for x in (body.get("nameCtx") or []) if isinstance(x, dict)])
        kind, kw = shape_kwargs(el, fscale)
        req = {"kind": "shape", "shape": kind, "kwargs": kw}
        texy = bool(kw.get("label") or kw.get("name"))
        if texy:
            req["preamble"] = preamble
        res = preview_worker.request(req, timeout=120 if texy else 30)
        return res
    except PreviewError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


def preview_text_of_project() -> str:
    p = state["project"]
    return p.tex_preamble() if p else ""


preamble_text = preview_text_of_project


def preview_cells(el: dict[str, Any], body: dict[str, Any], settings: dict[str, Any], preamble: str) -> dict[str, Any]:
    """要素を入れた表・行列: 書き出しと同じ式（セルの要素 → gui_table / gui_matrix）で作り、表の線と文字のセルだけを描く。
    セルの要素は、表に入れたあとの位置（points の e<id>。基準点から）を返す（キャンバスでは要素そのものをそこに置く）。"""
    rel: list[dict[str, Any]] = []
    for k, r in enumerate(body.get("related") or []):
        r = dict(r)
        if r.get("type") == "text":
            normalize_text_element(r, settings)
        elif r.get("type") == "shape":
            normalize_shape_element(r, settings)
        if not shapemodel.cell_item_ok(r):
            raise HTTPException(status_code=400, detail=f"「{r.get('var', '?')}」は表・行列のセルに入れられません（入れられるのはテキスト・数式・図形）。")
        r["var"] = f"_gui_op{k}"
        r["x"], r["y"] = 960.0, 540.0  # 表の形には、セルの要素の位置は関係ない（入れたあとの位置は、ずれの量で求める）
        rel.append(r)
    by_id = {r["id"]: r for r in rel}
    missing = [i for i in shapemodel.table_item_ids(el) if i not in by_id]
    if missing:
        raise HTTPException(status_code=400, detail="セルに入れた要素が見つかりません。")
    lines = [f"{r['var']} = {codegen.element_expr(r, settings, by_id, ())}" for _k, r in codegen.dependency_order(rel)]
    lines.append("_gui_before = {" + ", ".join(f"{json.dumps('e' + r['id'])}: {r['var']}.get_center().copy()" for r in rel) + "}")
    lines.append("_gui_result = " + codegen.element_expr({**el, "type": "shape", "x": 960.0, "y": 540.0, "rotation": 0.0}, settings, by_id, ()))
    lines.append("_gui_items = {" + ", ".join(f"{json.dumps('e' + r['id'])}: {r['var']}" for r in rel) + "}")
    return preview_worker.request({"kind": "cells", "code": "\n".join(lines), "preamble": preamble}, timeout=180)


def preview_tangent(el: dict[str, Any], body: dict[str, Any], settings: dict[str, Any], values: dict[str, float]) -> dict[str, Any]:
    """任意の曲線の接線: 書き出しと同じ式（付ける曲線と、その曲線が頼る要素 → gui_tangent）で作る（位置はスライドの座標そのまま）。"""
    rel: list[dict[str, Any]] = []
    for k, r in enumerate(body.get("related") or []):
        r = dict(r)
        if r.get("type") == "text":
            normalize_text_element(r, settings)
        elif r.get("type") == "shape":
            normalize_shape_element(r, settings)
        r["var"] = f"_gui_op{k}"
        rel.append(r)
    by_id = {r["id"]: r for r in rel}
    t = by_id.get(el["targetId"])
    if t is None:
        raise HTTPException(status_code=400, detail="接線を引く曲線が見つかりません。")
    if t.get("type") != "shape" or t.get("shape") not in shapemodel.TANGENT_TARGETS:
        raise HTTPException(status_code=400, detail=f"「{t.get('var', '?')}」には接線を引けません（線・図形・パス・グラフ・曲線に引けます）。")
    names = tuple(values)
    try:
        lines = [f"{n} = ValueTracker({float(v)!r})" for n, v in values.items()]
        lines += [f"{r['var']} = {codegen.element_expr(r, settings, by_id, names)}" for _k, r in codegen.dependency_order(rel)]
        lines.append("_gui_result = " + codegen.element_expr({**el, "type": "shape"}, settings, by_id, names))
    except ExprError as e:
        raise HTTPException(status_code=400, detail=f"式: {e}") from e
    return preview_worker.request({"kind": "boolean", "code": "\n".join(lines), "preamble": preamble_text()}, timeout=120)


def preview_boolean(el: dict[str, Any], body: dict[str, Any], settings: dict[str, Any], preamble: str) -> dict[str, Any]:
    """図形の合成を、書き出しと同じ式（元の図形の式 → gui_boolean）で作って返す。
    related は元の図形（合成した図形を元にするときは、その元の図形も）。変数名はプレビュー用の名前に置き換える。"""
    rel: list[dict[str, Any]] = []
    animated = el["shape"] == "annot"  # 色が流れる枠（AnimatedBoundary）: 付ける要素の形そのものに沿うので、要素を作って付ける
    for k, r in enumerate(body.get("related") or []):
        r = dict(r)
        if animated:
            if r.get("type") not in ("text", "math", "shape") or (r.get("type") == "shape" and r.get("shape") in DEPENDENT_SHAPES):
                raise HTTPException(status_code=400, detail="色が流れる枠は、テキスト・数式・図形（座標軸などに付いていないもの）に付けられます。")
            r["var"] = f"_gui_op{k}"
            if r["type"] == "text":
                normalize_text_element(r, settings)
            elif r["type"] == "shape":
                normalize_shape_element(r, settings)
            rel.append(r)
            continue
        if r.get("type", "shape") != "shape" or r.get("shape") not in shapemodel.BOOLEAN_OPERANDS:
            raise HTTPException(status_code=400, detail=f"「{r.get('var', '?')}」は図形の合成に使えません。")
        r["type"] = "shape"
        r["var"] = f"_gui_op{k}"
        normalize_shape_element(r, settings)
        if r["dashed"]:
            raise HTTPException(status_code=400, detail="破線の図形は合成に使えません（合成した図形の方を破線にしてください）。")
        rel.append(r)
    by_id = {r["id"]: r for r in rel}
    if animated:
        if el["targetId"] not in by_id:
            raise HTTPException(status_code=400, detail="枠を付ける要素が見つかりません。")
    else:
        missing = [i for i in el["operandIds"] if i not in by_id]
        if missing or len(el["operandIds"]) < 2:
            raise HTTPException(status_code=400, detail="合成する図形が 2 つ以上必要です。")
        if el["op"] in ("difference", "exclusion") and len(el["operandIds"]) != 2:
            raise HTTPException(status_code=400, detail="切り抜き・重ならない部分は、図形 2 つで作ります。")
    lines = [f"{r['var']} = {codegen.element_expr(r, settings, by_id, ())}" for _k, r in codegen.dependency_order(rel)]
    lines.append("_gui_result = " + codegen.element_expr({**el, "type": "shape"}, settings, by_id, ()))
    return preview_worker.request({"kind": "boolean", "code": "\n".join(lines), "preamble": preamble}, timeout=120)


def preview_3d(el: dict[str, Any], body: dict[str, Any], settings: dict[str, Any], values: dict[str, float]) -> dict[str, Any]:
    """3D の要素を、スライドのカメラの向きから見た画像（PNG）で返す（常駐の Manim の ThreeDCamera で描く）。"""
    req = build_3d_req(el, body, settings, values)
    res = preview_worker.request(req, timeout=180)
    if req.get("python") is not None:
        res["python"] = req["python"]
    return res


def build_3d_req(el: dict[str, Any], body: dict[str, Any], settings: dict[str, Any], values: dict[str, float]) -> dict[str, Any]:
    """3D の要素 1 つを描く、常駐プロセスへの要求。"""
    vnames = tuple(values)
    cam = dict(body.get("camera") or {})
    req: dict[str, Any] = {"kind": "3d", "shape": el["shape"],
                           "camera": {k: float(cam.get(k, d)) for k, d in (("phi", 0), ("theta", -90), ("zoom", 1), ("x", 0), ("y", 0))}}
    if body.get("axes"):
        ax = dict(body["axes"])
        ax["type"], ax["shape"] = "shape", "axes3d"
        normalize_shape_element(ax, settings)
        req["axes"] = axes3d_kwargs(ax, with_extras=False)
    try:
        if el["shape"] == "solid":
            req.update(solid=el["solidKind"], kwargs=solid_kwargs(el))
        elif el["shape"] == "axes3d":
            kw = axes3d_kwargs(el)
            p = state["project"]
            req.update(kwargs=kw, preamble=p.tex_preamble() if p else "")
        elif el["shape"] == "surface" and el["surfKind"] == "param":
            sv = tuple(v for v in vnames if v not in ("u", "v"))
            xs = [to_python(el[k], el["lang"], ("u", "v", *sv)) for k in ("xExpr", "yExpr", "zExpr")]
            used = used_names(" + ".join(f"({x})" for x in xs), sv)
            req.update(exprs=xs, param=True, kwargs={**surface_kwargs(el), "params": {n: values[n] for n in used}})
            req["python"] = xs
        elif el["shape"] == "surface":
            sv = tuple(v for v in vnames if v not in ("x", "y"))
            expr = to_python(el["expr"], el["lang"], ("x", "y", *sv))
            req.update(expr=expr, kwargs={**surface_kwargs(el), "params": {n: values[n] for n in used_names(expr, sv)}})
            req["python"] = expr
        elif el["shape"] == "curve3d":
            cv = tuple(v for v in vnames if v != "t")  # 曲線の式の t は媒介変数
            xs = [to_python(el[k], el["lang"], ("t", *cv)) for k in ("xExpr", "yExpr", "zExpr")]
            used = used_names(" + ".join(f"({x})" for x in xs), cv)
            req.update(exprs=xs, kwargs={**curve3d_kwargs(el), "params": {n: values[n] for n in used}})
            req["python"] = xs
        else:
            kw = point3d_kwargs(el, lambda x: to_python(x, el["lang"], vnames))
            exprs = [x for x in kw["start"] + kw.get("end", ()) if isinstance(x, str)]
            kw["params"] = {n: values[n] for n in used_names(" + ".join(f"({x})" for x in exprs) or "0", vnames)}
            req.update(point=el["pointKind"], kwargs=kw)
            if not body.get("axes"):
                req.pop("axes", None)
    except ExprError as e:
        raise HTTPException(status_code=400, detail=f"式: {e}") from e
    return req


@app.post("/api/preview/scene3d")
def preview_scene3d(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """スライドの 3D の要素を、まとめて 1 枚の画像に描く（描画と同じく、すべての物の小さな面を近さの順に重ねる）。
    body: {items: [/api/preview/shape と同じ中身（3D の要素だけ）]}。返す: {png, x, y, width, height}（キャンバスの px）。"""
    reqs = []
    for item in (body.get("items") or [])[:200]:
        el = fonts.resolve_in(dict(item.get("el") or {}))
        settings = fonts.resolve_in({**DEFAULT_SETTINGS, **(item.get("settings") or {})})
        el["type"] = "shape"
        normalize_shape_element(el, settings)
        if el.get("shape") not in ("solid", "axes3d", "surface", "curve3d", "point3d"):
            continue
        values = {str(k): float(v) for k, v in (item.get("values") or {}).items() if str(k).isidentifier()}
        try:
            reqs.append(build_3d_req(el, item, settings, values))
        except HTTPException:
            continue  # 式の誤りなどの物は、まとめた絵には入れない（その物の絵の所で知らせる）
    if not reqs:
        return {"png": None}
    return preview_worker.request({"kind": "3dscene", "items": reqs}, timeout=300)


def warm_up() -> None:
    """起動時に、環境チェックとフォント一覧、テキストのプレビュー用プロセスを裏で準備しておく。"""
    threading.Thread(target=envcheck.run_all, daemon=True).start()
    preview_worker.warm_up()
