"""プロジェクトのバックアップ（少し前の状態の控え）。

<プロジェクト>/backups/<日時>_<理由>.json に、project.json とプリアンブルの中身をまとめて保存する。
- 保存（自動保存も）のたびに、前のバックアップから決めた時間（既定 10 分）が過ぎていて、中身が変わっていれば作る
- プロジェクトを開いたとき（前の作業の終わりの状態）・バックアップから戻す直前にも作る
- 「今の状態を控える」で作ったもの（名前付き）は、自動では消さない
- 自動で作ったものは、新しい 20 個と、それより古いものは 1 日に 1 個（その日の最後）を 30 日分残す
画像・動画のファイルは控えない（「ファイルの整理」は、バックアップだけが使っているファイルを分けて見せ、初めは選ばない）。
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from . import userconfig

BACKUP_DIR = "backups"
KEEP_RECENT = 20
KEEP_DAYS = 30
REASONS = {"auto": "自動", "open": "開いたとき", "restore": "戻す前", "manual": "手動"}
DEFAULTS: dict[str, Any] = {"autosave": True, "delay": 3, "backup": True, "every": 10}
_NAME = re.compile(r"^(\d{8}_\d{6})(?:_\d+)?_(auto|open|restore|manual)\.json$")


def load_settings() -> dict[str, Any]:
    v = userconfig.load().get("autosave")
    v = v if isinstance(v, dict) else {}
    out = dict(DEFAULTS)
    for k in ("autosave", "backup"):
        if k in v:
            out[k] = bool(v[k])
    for k, lo, hi in (("delay", 1, 120), ("every", 1, 240)):
        try:
            out[k] = int(min(hi, max(lo, int(v.get(k, out[k])))))
        except (TypeError, ValueError):
            pass
    return out


def save_settings(v: Any) -> dict[str, Any]:
    cur = load_settings()
    if isinstance(v, dict):
        cur.update({k: v[k] for k in DEFAULTS if k in v})
    userconfig.save({"autosave": cur})
    return load_settings()


def backup_dir(folder: Path) -> Path:
    return folder / BACKUP_DIR


def _digest(project: dict[str, Any], preamble: str) -> str:
    raw = json.dumps(project, ensure_ascii=False, sort_keys=True) + "\0" + preamble
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _entries(folder: Path) -> list[tuple[Path, datetime, str]]:
    d = backup_dir(folder)
    out = []
    if d.is_dir():
        for f in d.iterdir():
            m = _NAME.match(f.name)
            if m and f.is_file():
                try:
                    out.append((f, datetime.strptime(m.group(1), "%Y%m%d_%H%M%S"), m.group(2)))
                except ValueError:
                    continue
    out.sort(key=lambda x: (x[1], x[0].name), reverse=True)
    return out


def _read(f: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) and isinstance(data.get("project"), dict) else None
    except (OSError, ValueError):
        return None


def _summary(project: dict[str, Any]) -> dict[str, int]:
    slides = project.get("slides") or []
    els = sum(len(s.get("elements") or []) for s in slides if isinstance(s, dict))
    steps = sum(len(s.get("steps") or []) for s in slides if isinstance(s, dict))
    return {"slides": len(slides), "elements": els, "steps": steps}


def make(folder: Path, project: dict[str, Any], preamble: str, reason: str, label: str = "", force: bool = False) -> dict[str, Any] | None:
    """バックアップを作る。直前のバックアップと中身が同じなら作らない（force でも同じ中身なら作らない。手動は作る）。"""
    digest = _digest(project, preamble)
    ent = _entries(folder)
    if ent and reason != "manual":
        last = _read(ent[0][0])
        if last is not None and last.get("digest") == digest:
            return None
    now = datetime.now()
    d = backup_dir(folder)
    d.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime("%Y%m%d_%H%M%S")
    f = d / f"{stamp}_{reason}.json"
    k = 2
    while f.exists():
        f = d / f"{stamp}_{k}_{reason}.json"
        k += 1
    data = {"version": 1, "created": now.isoformat(timespec="seconds"), "reason": reason, "label": label[:100],
            "digest": digest, "project": project, "preamble": preamble}
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    prune(folder)
    return {"id": f.name}


def maybe(folder: Path, project: dict[str, Any], preamble: str) -> dict[str, Any] | None:
    """保存のたびに呼ぶ: 前のバックアップから決めた時間が過ぎていれば作る。"""
    s = load_settings()
    if not s["backup"]:
        return None
    ent = [e for e in _entries(folder) if e[2] != "manual"]
    if ent and datetime.now() - ent[0][1] < timedelta(minutes=s["every"]):
        return None
    return make(folder, project, preamble, "auto")


def prune(folder: Path) -> None:
    """自動で作ったものを減らす（新しい 20 個と、それより古いものは 1 日 1 個を 30 日分）。手動のものは残す。"""
    auto = [e for e in _entries(folder) if e[2] != "manual"]
    keep_days: set[str] = set()
    limit = datetime.now() - timedelta(days=KEEP_DAYS)
    for i, (f, t, _r) in enumerate(auto):
        if i < KEEP_RECENT:
            keep_days.add(t.strftime("%Y%m%d"))  # 新しい 20 個のある日は、それで足りる
            continue
        day = t.strftime("%Y%m%d")
        if t >= limit and day not in keep_days:
            keep_days.add(day)
            continue
        try:
            f.unlink()
        except OSError:
            pass


def items(folder: Path, current: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    out = []
    cur_digest = None
    for f, t, reason in _entries(folder):
        data = _read(f)
        if data is None:
            continue
        if cur_digest is None and current is not None:
            cur_digest = _digest(current["project"], current["preamble"])
        out.append({"id": f.name, "created": t.isoformat(timespec="seconds"), "reason": reason, "reasonLabel": REASONS.get(reason, reason),
                    "label": data.get("label", ""), "size": f.stat().st_size, "same": data.get("digest") == cur_digest,
                    **_summary(data["project"])})
    return out


def get(folder: Path, name: str) -> dict[str, Any]:
    if not _NAME.match(name or ""):
        raise ValueError("バックアップの名前が正しくありません。")
    data = _read(backup_dir(folder) / name)
    if data is None:
        raise ValueError("バックアップを読み込めませんでした（消されたか、壊れています）。")
    return data


def delete(folder: Path, name: str) -> None:
    if not _NAME.match(name or ""):
        raise ValueError("バックアップの名前が正しくありません。")
    (backup_dir(folder) / name).unlink(missing_ok=True)


def total_size(folder: Path) -> int:
    return sum(f.stat().st_size for f, _t, _r in _entries(folder))

