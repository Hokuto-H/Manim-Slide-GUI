"""プロジェクト（1プロジェクト＝1フォルダ）の作成・読み込み・保存。"""

from __future__ import annotations

import copy
import json
import keyword
import re
import unicodedata
from pathlib import Path
from typing import Any

from .constants import DEFAULT_SETTINGS, FORMAT_VERSION, PAGE_POSITIONS, PREAMBLE_FILE, PROJECT_FILE
from .shapemodel import normalize_shape_element
from .texcolor import normalize_color_map
from .textmodel import normalize_text_element

_WIN_INVALID = set('<>:"/\\|?*')
_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}


class ProjectError(Exception):
    """利用者に見せる日本語のメッセージを持つ例外。"""


def validate_project_name(name: str) -> str:
    """フォルダ名として Windows で使えるかを検査し、整えた名前を返す。"""
    name = (name or "").strip()
    if not name:
        raise ProjectError("プロジェクト名を入力してください。")
    bad = sorted({c for c in name if c in _WIN_INVALID or ord(c) < 32})
    if bad:
        shown = " ".join(repr(c)[1:-1] if ord(c) >= 32 else f"\\x{ord(c):02x}" for c in bad)
        raise ProjectError(f"プロジェクト名に使えない文字が含まれています: {shown}")
    if name.endswith((".", " ")):
        raise ProjectError("プロジェクト名の末尾に「.」や空白は使えません。")
    if name.split(".")[0].upper() in _WIN_RESERVED:
        raise ProjectError(f"「{name}」は Windows の予約名のため使えません。")
    if len(name) > 100:
        raise ProjectError("プロジェクト名は100文字以内にしてください。")
    return name


def make_class_name(name: str) -> str:
    """プロジェクト名から、Python のクラス名として安全な識別子を作る。

    英数字の部分だけを CamelCase にして末尾に "Deck" を付ける（例: "my talk" → "MyTalkDeck"）。
    英数字が無い名前（日本語のみなど）は "Deck" とする。
    """
    ascii_name = unicodedata.normalize("NFKC", name)
    words = re.findall(r"[A-Za-z0-9]+", ascii_name)
    base = "".join(w[:1].upper() + w[1:] for w in words)
    if not base:
        return "Deck"
    if base[0].isdigit():
        base = "D" + base
    if not base.endswith("Deck"):
        base += "Deck"
    if keyword.iskeyword(base) or not base.isidentifier():
        return "Deck"
    return base


def new_project_data(settings: dict[str, Any]) -> dict[str, Any]:
    s = copy.deepcopy(DEFAULT_SETTINGS)
    s.update({k: v for k, v in settings.items() if k in DEFAULT_SETTINGS})
    s["className"] = make_class_name(s["name"])
    return {
        "formatVersion": FORMAT_VERSION,
        "settings": s,
        "slides": [{"id": "s1", "elements": [], "steps": []}],
    }


def normalize_image_element(e: dict[str, Any]) -> None:
    """画像要素: path（プロジェクトからの相対パス）、natW/natH（元の画素数）、width（キャンバスの px）など。"""
    e["path"] = str(e.get("path") or "").replace("\\", "/")
    for k in ("natW", "natH"):
        try:
            e[k] = max(1, int(e.get(k) or 1))
        except (TypeError, ValueError):
            e[k] = 1
    try:
        e["width"] = max(1.0, float(e.get("width") or e["natW"]))
    except (TypeError, ValueError):
        e["width"] = float(e["natW"])
    try:
        e["opacity"] = min(1.0, max(0.0, float(e.get("opacity", 1))))
    except (TypeError, ValueError):
        e["opacity"] = 1.0
    e["smooth"] = bool(e.get("smooth", True))
    try:  # 高さ（キャンバスの px）。横だけ・縦だけ伸ばしたとき、元の縦横比と異なる
        e["height"] = max(1.0, float(e.get("height") or e["width"] * e["natH"] / e["natW"]))
    except (TypeError, ValueError):
        e["height"] = e["width"] * e["natH"] / e["natW"]
    e["keepAspect"] = bool(e.get("keepAspect", True))
    # トリミング: 元の画像の左・上・右・下の位置（0〜1 の割合）。width・height は、残した部分の大きさ
    c = e.get("crop") if isinstance(e.get("crop"), dict) else {}

    def _fr(v, d):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return d
        return min(1.0, max(0.0, x)) if x == x else d
    l, t, r, b = _fr(c.get("l"), 0.0), _fr(c.get("t"), 0.0), _fr(c.get("r"), 1.0), _fr(c.get("b"), 1.0)
    if r - l < 0.005:
        l, r = 0.0, 1.0
    if b - t < 0.005:
        t, b = 0.0, 1.0
    e["crop"] = {"l": l, "t": t, "r": r, "b": b}
    # 図形の形で切り抜く: 同じスライドの図形などの要素の id（空なら切り抜かない）と、外側を残すか
    m = e.get("mask") if isinstance(e.get("mask"), dict) else {}
    e["mask"] = {"id": str(m.get("id") or ""), "invert": bool(m.get("invert", False))}
    e.setdefault("name", Path(e["path"]).name)


def _fl(v: Any, d: float, lo: float | None = None, hi: float | None = None) -> float:
    try:
        x = float(v)
        if x != x:  # NaN
            raise ValueError
    except (TypeError, ValueError):
        x = d
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def normalize_media_element(e: dict[str, Any]) -> None:
    """動画・音声の要素（kind: video / audio）。path はプロジェクトからの相対パス（clips/…）。
    再生方法 mode: live（発表ウィンドウが重ねて再生）/ bake（Manim の動画に焼き込む）。"""
    e["kind"] = "audio" if e.get("kind") == "audio" else "video"
    e["path"] = str(e.get("path") or "").replace("\\", "/")
    e.setdefault("name", Path(e["path"]).name)
    e["duration"] = _fl(e.get("duration"), 0.0, 0.0)
    e["hasAudio"] = bool(e.get("hasAudio", e["kind"] == "audio"))
    e["mode"] = "bake" if e.get("mode") == "bake" else "live"
    e["start"] = "step" if e.get("start") == "step" else "auto"  # auto: スライドの初めに再生 / step: ステップの gui_media で
    e["trimStart"] = _fl(e.get("trimStart"), 0.0, 0.0)
    te = e.get("trimEnd")
    e["trimEnd"] = None if te in (None, "") else _fl(te, 0.0, 0.0)  # None: 最後まで
    if e["trimEnd"] is not None and e["trimEnd"] <= e["trimStart"]:
        e["trimEnd"] = None
    e["volume"] = _fl(e.get("volume"), 1.0, 0.0, 1.0)
    e["fadeIn"] = _fl(e.get("fadeIn"), 0.0, 0.0, 60.0)
    e["fadeOut"] = _fl(e.get("fadeOut"), 0.0, 0.0, 60.0)
    e["loop"] = bool(e.get("loop", False))
    e["after"] = e.get("after") if e.get("after") in ("rewind", "hold", "hide") else "hold"  # 終わったら
    e["controls"] = bool(e.get("controls", True))  # 発表中、マウスを乗せると操作バー
    e["posterTime"] = _fl(e.get("posterTime"), 0.0, 0.0)
    if e["kind"] == "video":
        for k in ("natW", "natH"):
            try:
                e[k] = max(1, int(e.get(k) or 1))
            except (TypeError, ValueError):
                e[k] = 1
        e["width"] = _fl(e.get("width"), 640.0, 8.0)
        e["height"] = e["width"] * e["natH"] / e["natW"]  # 縦横比は元の動画のまま
        e["hideIdle"] = bool(e.get("hideIdle", False))  # 再生していないときは隠す
        e["across"] = False
    else:
        e["width"] = e["height"] = 96.0  # キャンバスのスピーカーのアイコン
        e["hideIcon"] = bool(e.get("hideIcon", True))
        e["across"] = bool(e.get("across", False))  # スライドをまたいで再生（発表で再生のときだけ）
    au = e.get("acrossUntil")
    e["acrossUntil"] = None if au in (None, "") else int(_fl(au, 1, 1))  # 何枚目のスライドまで（1 始まり。None は最後まで）
    e["rotation"] = 0.0


def compact_groups(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """重なり順の上で、同じグループの要素が連続するように並べ直す（いちばん手前の要素の位置にまとめる）。"""
    last = {}
    for i, e in enumerate(elements):
        if e.get("groupId"):
            last[e["groupId"]] = i
    out = []
    for i, e in enumerate(elements):
        gid = e.get("groupId")
        if not gid:
            out.append(e)
        elif i == last[gid]:
            out.extend(x for x in elements if x.get("groupId") == gid)
    return out


def normalize_groups(sl: dict[str, Any]) -> None:
    """グループ（slide["groups"] = [{"id", "var"}]、要素の groupId）を整える。要素の無いグループは捨てる。"""
    groups = [g for g in (sl.get("groups") or []) if isinstance(g, dict) and g.get("id")]
    gids = {g["id"] for g in groups}
    for e in sl["elements"]:
        if e.get("groupId") not in gids:
            e.pop("groupId", None)
    used = {e.get("groupId") for e in sl["elements"]}
    sl["groups"] = []
    for k, g in enumerate(groups):
        if g["id"] in used:
            g.setdefault("var", f"group{k + 1}")
            try:  # グループの向き（度、反時計回りが正）。選択枠の向きと、まとめて回すときの基準
                r = (float(g.get("rotation") or 0) + 180.0) % 360.0 - 180.0
            except (TypeError, ValueError):
                r = 0.0
            g["rotation"] = 0.0 if abs(r) < 1e-9 else round(r, 2)
            sl["groups"].append(g)
    sl["elements"] = compact_groups(sl["elements"])


def normalize_values(sl: dict[str, Any]) -> None:
    """スライドの値（ValueTracker）と、カメラの初期位置。
    values: [{"name": 変数名, "value": 初めの値}]。camera: None（既定の画面全体）か {"x", "y", "width"}（Manim の単位）。"""
    out = []
    for v in sl.get("values") or []:
        if not isinstance(v, dict):
            continue
        try:
            val = float(v.get("value") or 0)
        except (TypeError, ValueError):
            val = 0.0
        out.append({"name": str(v.get("name") or "").strip(), "value": val if val == val else 0.0})
    sl["values"] = out
    c3 = sl.get("camera3d") if isinstance(sl.get("camera3d"), dict) else {}

    def num(k, d, lo=None, hi=None):
        try:
            v = float(c3.get(k, d))
        except (TypeError, ValueError):
            v = d
        v = d if v != v else v
        return round(min(max(v, lo if lo is not None else v), hi if hi is not None else v), 3)
    # 3D のプロジェクトのカメラ（スライドの初め）。φ: 真上からの傾き、θ: 水平の向き（度）。既定は 2D と同じ真上から
    sl["camera3d"] = {"phi": num("phi", 0.0, -180, 180), "theta": num("theta", -90.0, -720, 720),
                      "zoom": num("zoom", 1.0, 0.05, 20), "x": num("x", 0.0), "y": num("y", 0.0)}
    cam = sl.get("camera")
    if isinstance(cam, dict):
        try:
            x, y, w = float(cam.get("x", 0)), float(cam.get("y", 0)), float(cam.get("width", 14.222))
            sl["camera"] = {"x": round(x, 3), "y": round(y, 3), "width": round(min(max(w, 0.1), 1000), 3)}
        except (TypeError, ValueError):
            sl["camera"] = None
    else:
        sl["camera"] = None


def _num(v: Any, d: float, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return d
    return d if x != x else min(max(x, lo), hi)


def normalize_page_settings(v: Any) -> dict[str, Any]:
    """プロジェクトのページ番号の設定。"""
    v = v if isinstance(v, dict) else {}
    color = v.get("color")
    return {
        "enabled": bool(v.get("enabled", False)),
        "position": v.get("position") if v.get("position") in PAGE_POSITIONS else "br",
        "fontSize": _num(v.get("fontSize"), 24, 4, 200),
        "color": color.upper() if isinstance(color, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", color) else None,
        "format": v.get("format") if v.get("format") in ("n", "n/N") else "n",
        "buff": _num(v.get("buff"), 0.3, 0, 3),
    }


def normalize_page_slide(sl: dict[str, Any]) -> None:
    """スライドのページ番号: mode は inherit（プロジェクトの設定に従う）・on・off、number は None（前のスライドの続き）か指定の番号。"""
    v = sl.get("pageNumber") if isinstance(sl.get("pageNumber"), dict) else {}
    n = v.get("number")
    try:
        n = None if n in (None, "") else int(float(n))
    except (TypeError, ValueError):
        n = None
    sl["pageNumber"] = {"mode": v.get("mode") if v.get("mode") in ("inherit", "on", "off") else "inherit",
                        "number": None if n is None else max(-9999, min(n, 99999))}


TRANSITIONS = ("none", "fade", "wipe", "zoom")
TRANSITION_DIRS = ("left", "right", "up", "down")


def normalize_slide_play(sl: dict[str, Any]) -> None:
    """スライドの発表の設定: 発表者ノート・初めから自動でステップ1へ・前のスライドからの切り替え効果。"""
    sl["notes"] = str(sl.get("notes") or "")
    sl["skip"] = bool(sl.get("skip", False))  # 描画しない（描画・発表・ファイルへの出力に入れない。試し描画はできる）
    sl["autoStart"] = bool(sl.get("autoStart", False))
    from .animgen import norm_wait  # noqa: PLC0415
    sl["videoWait"] = norm_wait(sl.get("videoWait"))  # 1 本の動画に書き出すとき、初めの表示のあとに待つ秒数（None なら全体の設定）
    t = sl.get("transition") if isinstance(sl.get("transition"), dict) else {}
    sl["transition"] = {
        "kind": t.get("kind") if t.get("kind") in TRANSITIONS else "none",
        "dir": t.get("dir") if t.get("dir") in TRANSITION_DIRS else "left",
        "out": bool(t.get("out", False)),  # ズーム: False なら近づく（前のスライドが大きくなって消える）、True なら遠ざかる
        "runTime": _num(t.get("runTime"), 1.0, 0.1, 10.0),
    }


SECTION_DISPLAYS = ("none", "name", "bar", "both")


def normalize_section_settings(v: Any) -> dict[str, Any]:
    """章（セクション）をスライドに描く設定。display: none・name（章の名前）・bar（進み具合のバー）・both。"""
    v = v if isinstance(v, dict) else {}
    color = v.get("color")
    return {
        "display": v.get("display") if v.get("display") in SECTION_DISPLAYS else "none",
        "position": v.get("position") if v.get("position") in PAGE_POSITIONS else "tl",  # 章の名前の位置
        "bar": v.get("bar") if v.get("bar") in ("top", "bottom") else "top",  # バーの位置
        "fontSize": _num(v.get("fontSize"), 20, 4, 200),
        "color": color.upper() if isinstance(color, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", color) else None,
        "barColor": v.get("barColor").upper() if isinstance(v.get("barColor"), str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", v.get("barColor")) else "#58C4DD",
    }


def normalize_slide_deck(sl: dict[str, Any]) -> None:
    """章・付録・目安の時間。section: 空でなければ、このスライドから新しい章（その名前）。appendix: 付録（最後にまとめて描画し、
    ふだんの「次へ」では入らない）。targetTime: 発表でこのページにかける目安（秒）。sectionShow: inherit・off（章の表示を隠す）。"""
    sec = sl.get("section")
    sl["section"] = str(sec).strip()[:60] if isinstance(sec, str) else ""
    sl["appendix"] = bool(sl.get("appendix", False))
    t = sl.get("targetTime")
    try:
        t = None if t in (None, "") or isinstance(t, bool) else round(min(36000.0, max(0.0, float(t))), 1)
    except (TypeError, ValueError):
        t = None
    sl["targetTime"] = t
    sl["sectionShow"] = sl.get("sectionShow") if sl.get("sectionShow") in ("inherit", "off") else "inherit"


def normalize_link(v: Any) -> dict[str, str] | None:
    """要素のリンク: {"to": スライドの id か "back"}。"""
    if not isinstance(v, dict):
        return None
    to = v.get("to")
    if not isinstance(to, str) or not to.strip():
        return None
    return {"to": to.strip()[:80]}


def render_order(data: dict[str, Any], include: list[int] | None = None) -> list[int]:
    """描画する順のスライドの番号: 本編（付録でないもの）を並べた順に、そのあとに付録を並べた順に。"""
    idx = render_indices(data, include)
    return [i for i in idx if not data["slides"][i].get("appendix")] + [i for i in idx if data["slides"][i].get("appendix")]


def render_indices(data: dict[str, Any], include: list[int] | None = None) -> list[int]:
    """描画するスライドの番号（0 始まり）。include（今回だけ選んだスライド）が無ければ、「描画しない」の印の無いスライド。"""
    n = len(data["slides"])
    if include is not None:
        return sorted({int(i) for i in include if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < n})
    return [i for i, sl in enumerate(data["slides"]) if not sl.get("skip")]


def page_plan(data: dict[str, Any], include: list[int] | None = None) -> list[dict[str, Any]]:
    """スライドごとのページ番号（表示するか、書く文字）。番号は、描画するスライドだけを数える（描画しないスライドは飛ばして詰める）。
    前の描画するスライドの番号 + 1（指定があればその番号から数え直す）。「n / N」の N は、最後の描画するスライドの番号。
    描画しないスライドには、もし描画したらの番号を付ける（試し描画のため。次の番号は進めない）。"""
    ps = data["settings"].get("pageNumbers") or {}
    incl = set(render_indices(data, include))
    nums, n, a = [], 0, 0
    for i, sl in enumerate(data["slides"]):
        if sl.get("appendix"):  # 付録は「A1」「A2」…（本編の番号は進めない）
            k = a + 1
            if i in incl:
                a = k
            nums.append(f"A{k}")
            continue
        pn = sl.get("pageNumber") or {}
        k = pn["number"] if pn.get("number") is not None else n + 1
        if i in incl:
            n = k
        nums.append(k)
    mains = [i for i in incl if not data["slides"][i].get("appendix")]
    total = nums[max(mains)] if mains else 0
    out = []
    mpn = {m.get("id"): m.get("pageNumbers", "inherit") for m in data.get("masters") or []}
    for sl, k in zip(data["slides"], nums):
        mode = (sl.get("pageNumber") or {}).get("mode", "inherit")
        if mode == "inherit":  # スライドが「プロジェクトの設定に従う」なら、マスターの指定（あれば）に従う
            mode = mpn.get(sl.get("master"), "inherit")
        show = ps.get("enabled", False) if mode == "inherit" else mode == "on"
        text = str(k) if isinstance(k, str) or ps.get("format") != "n/N" else f"{k} / {total}"
        out.append({"show": bool(show), "number": k, "text": text, "total": total})
    return out


def section_plan(data: dict[str, Any], include: list[int] | None = None) -> list[dict[str, Any]]:
    """スライドごとの章: {"name": 章の名前（無ければ ""）, "index": 何番目の章か（0 始まり。章の前は -1）,
    "progress": 本編の中の進み具合（0〜1。描画するスライドで数える）, "sections": [(章の名前, 始まりの割合, 終わりの割合)]}。"""
    incl = render_indices(data, include)
    mains = [i for i in incl if not data["slides"][i].get("appendix")]
    name, idx, cur = "", -1, []
    for i, sl in enumerate(data["slides"]):
        if sl.get("appendix"):
            cur.append(None)
            continue
        if sl.get("section"):
            name, idx = sl["section"], idx + 1
        cur.append((name, idx))
    n = max(1, len(mains))
    spans: list[list[Any]] = []
    for k, i in enumerate(mains):
        nm, ix = cur[i]
        if not spans or spans[-1][3] != ix:
            spans.append([nm, k / n, (k + 1) / n, ix])
        else:
            spans[-1][2] = (k + 1) / n
    out = []
    for i, sl in enumerate(data["slides"]):
        c = cur[i]
        if c is None:
            out.append({"name": "", "index": -1, "progress": None, "sections": [], "appendix": True})
            continue
        pos = sum(1 for j in mains if j <= i)
        out.append({"name": c[0], "index": c[1], "progress": pos / n, "sections": [(a, b, e) for a, b, e, _ in spans if a], "appendix": False})
    return out


def normalize_slide_content(sl: dict[str, Any], s: dict[str, Any]) -> None:
    """スライド（とマスター）の要素・グループ・値・ステップを、今の形式にそろえる（その場で書き換える）。"""
    normalize_values(sl)
    normalize_groups(sl)
    ids = {e.get("id") for e in sl["elements"]} | {g["id"] for g in sl["groups"]}
    # 存在しない要素・グループを指すステップは捨てる（GUI のステップは、要素に結び付かないので残す）
    from .animgen import normalize_step  # noqa: PLC0415
    sl["steps"] = [normalize_step(st) for st in sl["steps"] if st.get("mode") == "gui" or st.get("elementId") in ids]
    for e in sl["elements"]:
        e.setdefault("visibleAtStart", True)
        e["hidden"] = bool(e.get("hidden", False))  # 編集中だけ隠す（書き出しには影響しない）
        e["locked"] = bool(e.get("locked", False))  # 編集中に動かないよう固定する
        e.setdefault("color", s["defaultColor"])
        e["link"] = normalize_link(e.get("link"))  # 発表で押すと飛ぶ先（スライドの id・"back"（飛ぶ前に戻る））
        lab = re.sub(r"[{}\s]", "", str(e.get("refLabel") or ""))[:60]  # 参照のラベル（{ref:ラベル} で番号に置き換わる）
        if lab:
            e["refLabel"] = lab
        else:
            e.pop("refLabel", None)
        if e.get("type") == "text" and e.get("numberOf"):  # 数式の番号・図のキャプション（付けた要素の id と種類）
            e["numberKind"] = "fig" if e.get("numberKind") == "fig" else "eq"
        else:
            e.pop("numberOf", None)
            e.pop("numberKind", None)
        e["fixedInFrame"] = bool(e.get("fixedInFrame", True))  # 3D のプロジェクトで、カメラを動かしても画面の同じ所に出す
        e.setdefault("fontSize", s["defaultFontSize"])
        try:  # 回転（度、Manim と同じく反時計回りが正。-180〜180 にそろえる）
            r = float(e.get("rotation") or 0)
        except (TypeError, ValueError):
            r = 0.0
        r = (r + 180.0) % 360.0 - 180.0
        e["rotation"] = 0.0 if abs(r) < 1e-9 else round(r, 2)
        if e.get("type") == "text":
            normalize_text_element(e, s)
        elif e.get("type") == "math":
            e.setdefault("latex", "")
            if e.get("mathAlign") not in ("center", "left", "right"):
                e["mathAlign"] = "center"  # 複数行（\\）の揃え方
            e["colorMap"] = normalize_color_map(e.get("colorMap"))  # 一部に色を付ける文字列
        elif e.get("type") == "image":
            normalize_image_element(e)
        elif e.get("type") == "media":
            normalize_media_element(e)
        elif e.get("type") == "shape":
            normalize_shape_element(e, s)
    # 吹き出しの中身は、同じスライドの（吹き出しでない）要素だけ
    plain = {e["id"] for e in sl["elements"] if not (e.get("type") == "shape" and e.get("shape") == "balloon")}
    for e in sl["elements"]:
        if e.get("type") == "shape" and e.get("shape") == "balloon":
            e["contentIds"] = [c for c in e.get("contentIds", []) if c in plain]
    all_ids = {e["id"] for e in sl["elements"]}
    for e in sl["elements"]:
        # 座標軸が無くなったベクトル場は、同じ範囲・大きさのまま独立したベクトル場にする
        if e.get("type") == "shape" and e.get("shape") == "field" and e.get("axesId") and e["axesId"] not in all_ids:
            e["axesId"] = ""
        # 付けていた要素が無くなった中かっこは、最後の位置のまま「2 点の間」にする（GUI の braceToPoints と同じ）
        if e.get("type") == "shape" and e.get("shape") == "brace" and e.get("mode") == "target" and e.get("targetId") not in all_ids:
            w, h, x, y = e["width"], e["height"], float(e.get("x", 0)), float(e.get("y", 0))
            seg = {"down": ((x - w / 2, y + h / 2), (x + w / 2, y + h / 2)), "up": ((x + w / 2, y - h / 2), (x - w / 2, y - h / 2)),
                   "left": ((x - w / 2, y - h / 2), (x - w / 2, y + h / 2)), "right": ((x + w / 2, y + h / 2), (x + w / 2, y - h / 2))}[e["direction"]]
            e.update(mode="points", flip=False, x=(seg[0][0] + seg[1][0]) / 2, y=(seg[0][1] + seg[1][1]) / 2,
                     dx=(seg[1][0] - seg[0][0]) / 2, dy=(seg[1][1] - seg[0][1]) / 2)


def normalize_masters(v: Any, s: dict[str, Any]) -> list[dict[str, Any]]:
    """スライドマスター: [{"id", "name", "elements", "groups", "background": 色 | "", "pageNumbers": inherit・on・off,
    "sections": inherit・off}]。要素はスライドと同じ形（動きは付けない。「発表で再生」の動画・音声は置けない）。"""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, m in enumerate(v if isinstance(v, list) else []):
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or f"m{i + 1}")
        if mid in seen:
            continue
        seen.add(mid)
        bg = m.get("background")
        bg = bg if isinstance(bg, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", bg or "") else ""
        mm = {"id": mid, "name": str(m.get("name") or f"マスター {len(out) + 1}")[:40],
              "elements": [e for e in (m.get("elements") or []) if isinstance(e, dict) and e.get("type") != "media"],
              "groups": m.get("groups") or [], "steps": [], "values": [],
              "background": bg.upper() if bg else "",
              "pageNumbers": m.get("pageNumbers") if m.get("pageNumbers") in ("inherit", "on", "off") else "inherit",
              "sections": m.get("sections") if m.get("sections") in ("inherit", "off") else "inherit"}
        normalize_slide_content(mm, s)
        mm["steps"] = []
        for e in mm["elements"]:
            e["visibleAtStart"] = True
            e["link"] = None
        out.append(mm)
    return out[:30]


def normalize_guides(v: Any) -> dict[str, list[float]]:
    """編集の画面のガイド線（Manim の座標）。x は縦の線、y は横の線。"""
    out: dict[str, list[float]] = {"x": [], "y": []}
    if isinstance(v, dict):
        for k, lim in (("x", 8.0), ("y", 4.0)):
            for n in v.get(k) or []:
                try:
                    f = float(n)
                except (TypeError, ValueError):
                    continue
                if abs(f) <= lim + 1e-6 and round(f, 3) not in out[k]:
                    out[k].append(round(f, 3))
            out[k] = sorted(out[k])[:100]
    return out


# 部品（要素のテンプレート）に入れられないもの: 画像・動画音声（SVG で形を作れない）、ほかの要素に付く・スライドで決まるもの
PART_EXCLUDED_SHAPES = ("zoom", "trace", "part", "statchart", "points", "graph", "graphpart", "axdot", "curve2d", "implicit",
                        "linegraph", "tangent", "field", "vector", "solid", "axes3d", "surface", "curve3d", "point3d", "svg")


def part_child_ok(e: dict[str, Any]) -> bool:
    """部品の中に入れられる要素か（テキスト・数式・図形。画像・動画・座標軸に付く物などは入れない）。"""
    if e.get("type") in ("text", "math"):
        return True
    return e.get("type") == "shape" and e.get("shape") not in PART_EXCLUDED_SHAPES


def normalize_parts(v: Any, s: dict[str, Any]) -> list[dict[str, Any]]:
    """部品（要素のテンプレート）の写し: [{"id", "name", "updatedAt", "elements"}]。要素の位置は、部品の中心からのずれ（px）。
    元のテンプレートはユーザー設定の parts/ にあり、置いた部品は、このプロジェクトの写しで描く（zip でも持ち運べる）。"""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in v if isinstance(v, list) else []:
        if not isinstance(p, dict) or not str(p.get("id") or "") or str(p["id"]) in seen:
            continue
        seen.add(str(p["id"]))
        sl = {"elements": [e for e in (p.get("elements") or []) if isinstance(e, dict) and part_child_ok(e)], "groups": [], "steps": [], "values": []}
        normalize_slide_content(sl, s)
        for e in sl["elements"]:
            e["visibleAtStart"] = True
            e["link"] = None
            e.pop("groupId", None)
            e.pop("refLabel", None)
        out.append({"id": str(p["id"])[:60], "name": str(p.get("name") or "部品")[:40], "updatedAt": float(p.get("updatedAt") or 0),
                    "elements": sl["elements"]})
    return out[:200]


def normalize(data: dict[str, Any]) -> dict[str, Any]:
    """読み込んだ project.json を、欠けている項目を補って現在の形式にそろえる。"""
    if not isinstance(data, dict):
        raise ProjectError("project.json の形式が正しくありません。")
    s = copy.deepcopy(DEFAULT_SETTINGS)
    s.update(data.get("settings") or {})
    if not s.get("className") or not str(s["className"]).isidentifier():
        s["className"] = make_class_name(s.get("name", ""))
    s["use3d"] = bool(s.get("use3d", False))
    s["pageNumbers"] = normalize_page_settings(s.get("pageNumbers"))
    s["sections"] = normalize_section_settings(s.get("sections"))
    s["guides"] = normalize_guides(s.get("guides"))
    from .refs import normalize_settings as _thm_settings  # noqa: PLC0415
    s["theorems"] = _thm_settings(s.get("theorems"))  # 定理などの種類ごとの名前と色
    s["refNumbering"] = "global" if s.get("refNumbering") == "global" else "chapter"  # 番号: 章ごと・通し
    s["texFont"] = "sans" if s.get("texFont") == "sans" else "serif"  # LaTeX で組む文字の書体: 明朝・ゴシック
    s["proofTitle"] = (str(s.get("proofTitle") or "").strip() or "{対象} の{証明}")[:40]  # 証明の見出しの形
    # キャンバスでの 3D の見せ方（view3d）: scene＝描画と同じ（まとめて描く。既定）・depth＝物の中心の奥行きの順・layer＝レイヤーの順。
    # 以前の depth3d は「奥行きの順」が既定だっただけなので、はっきり選んだ「レイヤーの順」だけを引き継ぐ
    if s.get("view3d") not in ("scene", "depth", "layer"):
        s["view3d"] = "layer" if s.get("depth3d") == "layer" else "scene"
    s.pop("depth3d", None)
    s["autoTitle"] = s.get("autoTitle") is not False  # 「＋スライド」で、マスターの題名の型の題名を置いておく
    ign = s.get("lintIgnore")  # 点検で「無視する」にしたもの（"種類|スライドの id|要素の id|…"）
    s["lintIgnore"] = [str(x)[:300] for x in ign if isinstance(x, str)][:1000] if isinstance(ign, list) else []
    slides = data.get("slides") or []
    if not slides:
        slides = [{"id": "s1", "elements": [], "steps": []}]
    for i, sl in enumerate(slides):
        sl.setdefault("id", f"s{i + 1}")
        normalize_page_slide(sl)
        normalize_slide_play(sl)
        normalize_slide_deck(sl)
        sl.setdefault("elements", [])
        sl.setdefault("steps", [])
        normalize_slide_content(sl, s)
    masters = normalize_masters(data.get("masters"), s)
    mids = {m["id"] for m in masters}
    if s.get("defaultMaster") not in mids:
        s["defaultMaster"] = ""
    for sl in slides:
        sl["master"] = sl.get("master") if sl.get("master") in mids else ""
    return {"formatVersion": FORMAT_VERSION, "settings": s, "slides": slides, "masters": masters,
            "parts": normalize_parts(data.get("parts"), s)}


class Project:
    """現在開いているプロジェクト（このアプリは利用者1人・1プロジェクトずつ扱う）。"""

    def __init__(self, folder: Path):
        self.folder = folder

    @property
    def project_file(self) -> Path:
        return self.folder / PROJECT_FILE

    @property
    def preamble_file(self) -> Path:
        return self.folder / PREAMBLE_FILE

    # ---- 作成・読み込み ----
    @classmethod
    def create(cls, parent: Path, settings: dict[str, Any], preamble: str, make_parent: bool = False) -> "Project":
        name = validate_project_name(settings.get("name", ""))
        parent = Path(parent).expanduser()
        if not parent.is_dir() and make_parent and parent.is_absolute() and not parent.exists():
            # 保存先のフォルダが無いときは、確かめたうえで作る（途中のフォルダも）
            try:
                parent.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                raise ProjectError(f"保存先のフォルダを作れませんでした: {parent}（{e}）") from e
        if not parent.is_dir():
            raise ProjectError(f"保存先のフォルダが見つかりません: {parent}")
        folder = parent / name
        if folder.exists() and any(folder.iterdir()):
            raise ProjectError(f"同じ名前のフォルダが既にあり、空ではありません: {folder}")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "images").mkdir(exist_ok=True)
        data = new_project_data({**settings, "name": name})
        proj = cls(folder)
        proj.write(data)
        proj.write_preamble(preamble or "")
        return proj

    @classmethod
    def open(cls, folder: Path) -> "Project":
        folder = Path(folder).expanduser()
        if folder.is_file() and folder.name == PROJECT_FILE:
            folder = folder.parent
        if not (folder / PROJECT_FILE).exists():
            raise ProjectError(f"このフォルダに {PROJECT_FILE} がありません: {folder}")
        proj = cls(folder)
        proj.read()  # 形式を検査
        if not proj.preamble_file.exists():
            proj.write_preamble("")
        return proj

    # ---- 読み書き ----
    def read(self) -> dict[str, Any]:
        if not self.project_file.exists():
            raise ProjectError(f"{PROJECT_FILE} が見つかりません（フォルダが移動・削除された可能性があります）: {self.folder}")
        try:
            raw = json.loads(self.project_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ProjectError(f"project.json を読み込めません（{e.lineno}行目付近）: {e.msg}") from e
        return normalize(raw)

    def write(self, data: dict[str, Any]) -> dict[str, Any]:
        data = normalize(data)
        tmp = self.project_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.project_file)
        return data

    def read_preamble(self) -> str:
        if not self.preamble_file.exists():
            return ""
        return self.preamble_file.read_text(encoding="utf-8-sig")

    def tex_preamble(self) -> str:
        """プレビューで使うプリアンブル: 共通プリアンブルに、プロジェクトの設定の書体（ゴシック）を足したもの。"""
        from .constants import tex_font_lines
        extra = tex_font_lines(self.read().get("settings"))
        return self.read_preamble() + ("\n" + "\n".join(extra) if extra else "")

    def write_preamble(self, text: str) -> None:
        self.preamble_file.write_text(text.replace("\r\n", "\n"), encoding="utf-8", newline="\n")
