"""スライドマスター: 書き出しの前に、マスターの中身をスライドに入れる（描画・発表・すべての出力に同じように出る）。

- マスターの要素は、スライドの要素より後ろ（いちばん奥）に置く。動きは付けない（最初から出しておく）
- マスターの「題名」の図形は、描かずに、そのマスターのスライドの題名の型（位置・大きさ・色・寄せ方・下線）にする
- 文字の中の {プロジェクト名}・{日付}・{章}・{ページ}・{総ページ} は、スライドごとの値に置き換える
- 背景色（あれば）・ページ番号・章の表示の有無
"""

from __future__ import annotations

import copy
import re
from datetime import date
from typing import Any

TOKENS = ("{プロジェクト名}", "{日付}", "{章}", "{ページ}", "{総ページ}")
TITLE_KEYS = ("x", "y", "fontSize", "color", "align", "underline", "matchWidth", "edge")


def is_title(e: dict[str, Any]) -> bool:
    return e.get("type") == "shape" and e.get("shape") == "title"


def title_template(m: dict[str, Any] | None) -> dict[str, Any] | None:
    t = next((e for e in (m or {}).get("elements", []) if is_title(e)), None)
    return {k: t[k] for k in TITLE_KEYS if k in t} if t else None


def token_values(project: dict[str, Any], page: dict[str, Any] | None, section: dict[str, Any] | None) -> dict[str, str]:
    d = date.today()
    num = (page or {}).get("number", "")
    return {
        "{プロジェクト名}": str(project["settings"].get("name") or ""),
        "{日付}": f"{d.year}年{d.month}月{d.day}日",
        "{章}": str((section or {}).get("name") or ""),
        "{ページ}": str(num),
        "{総ページ}": str((page or {}).get("total", "")),
    }


def fill_tokens(e: dict[str, Any], values: dict[str, str]) -> None:
    pat = re.compile("|".join(re.escape(k) for k in values))

    def sub(t: Any) -> Any:
        return pat.sub(lambda m: values[m.group(0)], t) if isinstance(t, str) else t

    if e.get("type") == "text":
        for r in e.get("runs") or []:
            r["t"] = sub(r.get("t", ""))
        e["text"] = "".join(r.get("t", "") for r in e.get("runs") or [])
    elif e.get("type") == "math" or (e.get("type") == "shape" and e.get("shape") in ("tex", "title")):
        e["latex"] = sub(e.get("latex", ""))
    elif e.get("type") == "shape" and e.get("shape") == "bullets":
        e["items"] = [sub(x) for x in e.get("items") or []]


def master_problems(project: dict[str, Any]) -> list[dict[str, Any]]:
    """マスターの要素の変数名など（マスターを 1 枚のスライドとして調べる）。"""
    from .codegen import validate  # noqa: PLC0415
    out = []
    masters = project.get("masters") or []
    if not masters:
        return out
    pseudo = {**project, "slides": [{**m, "steps": [], "values": []} for m in masters]}
    slide_vars = {e.get("var") for sl in project["slides"] for e in sl["elements"]} | {g.get("var") for sl in project["slides"] for g in sl.get("groups", [])}
    for p in validate(pseudo):
        m = masters[p.get("slideIndex") or 0] if p.get("slideIndex") is not None else None
        msg = re.sub(r"スライド(\d+)", lambda mm: f"マスター「{masters[int(mm.group(1)) - 1]['name']}」", p["message"])
        out.append({"slideIndex": None, "elementId": None, "var": p.get("var", ""), "message": msg if m else p["message"]})
    for m in masters:
        for e in m["elements"]:
            if e.get("var") in slide_vars:
                out.append({"slideIndex": None, "elementId": None, "var": e.get("var"),
                            "message": f"マスター「{m['name']}」の要素の変数名「{e.get('var')}」が、スライドの要素と重なっています。マスターの編集で変えてください。"})
    return out


def apply(project: dict[str, Any], pages: list[dict[str, Any]], sections: list[dict[str, Any]]) -> dict[str, Any]:
    """マスターを入れたプロジェクト（写し）。pages・sections は project["slides"] と同じ並び。"""
    masters = {m["id"]: m for m in project.get("masters") or []}
    if not any(sl.get("master") in masters for sl in project["slides"]):
        return project
    out = {**project, "slides": []}
    for si, sl in enumerate(project["slides"]):
        m = masters.get(sl.get("master"))
        if not m:
            out["slides"].append(sl)
            continue
        sl = copy.deepcopy(sl)
        tpl = title_template(m)
        if tpl:
            for e in sl["elements"]:
                if is_title(e):
                    edge = tpl.get("edge")
                    e.update({k: copy.deepcopy(v) for k, v in tpl.items() if k != "edge"})
                    if edge is not None and tpl.get("align") in ("left", "right"):
                        e["_edge"] = edge  # 左・右寄せ: マスターの題名の左端（右端）に、文字の端をそろえる
        values = token_values(project, pages[si] if si < len(pages) else None, sections[si] if si < len(sections) else None)
        idmap = {}
        add = []
        for k, e in enumerate(m["elements"]):
            if is_title(e):
                continue
            c = copy.deepcopy(e)
            idmap[e["id"]] = f"_gm{si}_{e['id']}"
            c["id"] = idmap[e["id"]]
            c["var"] = f"_gm{si}_{k}"
            c["visibleAtStart"] = True
            c["locked"] = True
            c["fromMaster"] = m["id"]
            fill_tokens(c, values)
            add.append(c)
        gmap = {}
        groups = []
        for k, g in enumerate(m.get("groups") or []):
            gmap[g["id"]] = f"_gm{si}_{g['id']}"
            groups.append({**copy.deepcopy(g), "id": gmap[g["id"]], "var": f"_gm{si}_g{k}"})
        for c in add:  # 要素どうしの参照（グループ・吹き出しの中身・座標軸など）も付け替える
            if c.get("groupId"):
                c["groupId"] = gmap.get(c["groupId"])
            for key in ("axesId", "targetId"):
                if c.get(key) in idmap:
                    c[key] = idmap[c[key]]
            if isinstance(c.get("contentIds"), list):
                c["contentIds"] = [idmap.get(x, x) for x in c["contentIds"]]
            mk = c.get("mask")
            if isinstance(mk, dict) and mk.get("id") in idmap:
                c["mask"] = {**mk, "id": idmap[mk["id"]]}
        groups = [g for g in groups if any(c.get("groupId") == g["id"] for c in add)]
        sl["elements"] = add + sl["elements"]
        sl["groups"] = groups + list(sl.get("groups") or [])
        if m.get("background"):
            sl["background"] = m["background"]
        if m.get("sections") == "off":
            sl["sectionShow"] = "off"
        out["slides"].append(sl)
    return out
