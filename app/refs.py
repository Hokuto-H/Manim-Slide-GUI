"""定理・数式・図の番号と、ラベルへの参照（{ref:名前}・{num:名前}）。

- 番号を持つもの:
  - 定理などのブロック（図形 "theorem"。証明と、「番号を付けない」にしたものは除く）。種類が違っても同じ番号の列（定理 3.1・補題 3.2・定義 3.3）
  - 数式の番号（数式に付けた「(3.1)」のテキスト。numberOf が数式の id、numberKind が "eq"）
  - 図の番号（画像・図形に付けたキャプション「図 3.1 …」のテキスト。numberKind が "fig"）
  数式・図は、それぞれ別の番号の列。番号は章（スライドの「章」）ごとに 1 から（章が無ければ通し、付録は A.1…）。
- 数える順: 描画の順（本編、そのあとに付録）のスライドの中で、上から（同じ高さなら左から）。「描画しない」のスライドも数える。
- 要素に付けたラベル（el.refLabel）を、テキスト・数式・LaTeX の文章・定理の本文で {ref:名前}（「定理 3.1」「(3.1)」「図 3.1」）、
  {num:名前}（「3.1」）と書くと、番号に置き換わる。番号の無い要素は、そのページ（「p.5」）。見つからないときは「??」。
- 番号のテキストでは {番号} が、その数式・図の番号（「(3.1)」「図 3.1」）になる。
- 書き出しでは、参照の文字に一時的な色（目印）を付けて描き、描いた後に目印の色の形を探して元の色に戻し、
  そこを「押すと飛ぶ」の範囲にする（ラベルの要素のスライドへ飛ぶ）。
static/js/refs.js は、このファイルと同じ数え方をする（キャンバスの仮表示用）。
"""

from __future__ import annotations

import copy
import re
from typing import Any

KINDS = ("definition", "theorem", "lemma", "corollary", "proposition", "example", "remark", "proof")
DEFAULT_THEOREMS = {
    "definition": {"label": "定義", "color": "#2E8B57"},
    "theorem": {"label": "定理", "color": "#2E6FD8"},
    "lemma": {"label": "補題", "color": "#4F5FC4"},
    "corollary": {"label": "系", "color": "#7A4FC4"},
    "proposition": {"label": "命題", "color": "#1F8A9E"},
    "example": {"label": "例", "color": "#D9822B"},
    "remark": {"label": "注意", "color": "#7A7A7A"},
    "proof": {"label": "証明", "color": "#555555"},
}
ROLE_COLORS = {"assume": "#1F8A9E", "conclude": "#C2410C"}
REF_RE = re.compile(r"\{(ref|num):([^{}\s]+)\}")
SELF_TOKEN = "{番号}"
_MARK_BASE = 0x0A0B00  # 目印の色（#0A0B01 から）。ふだん使わない、ほぼ黒の色


def normalize_settings(v: Any) -> dict[str, Any]:
    """settings.theorems: 種類ごとの名前と色。settings.refNumbering: "chapter"（章ごと）・"global"（通し）。"""
    v = v if isinstance(v, dict) else {}
    out = {}
    for k, d in DEFAULT_THEOREMS.items():
        x = v.get(k) if isinstance(v.get(k), dict) else {}
        lab = str(x.get("label") or d["label"]).strip()[:20] or d["label"]
        col = str(x.get("color") or "")
        out[k] = {"label": lab, "color": col.upper() if re.fullmatch(r"#[0-9A-Fa-f]{6}", col) else d["color"]}
    return out


def _order(project: dict[str, Any]) -> list[int]:
    slides = project["slides"]
    return [i for i, s in enumerate(slides) if not s.get("appendix")] + [i for i, s in enumerate(slides) if s.get("appendix")]


def _chapters(project: dict[str, Any]) -> list[str]:
    """スライドごとの章の番号の文字（"3"・"A"・""（章の前・章が無い））。"""
    slides = project["slides"]
    has = any(s.get("section") and not s.get("appendix") for s in slides)
    out, idx = [], 0
    for s in slides:
        if s.get("appendix"):
            out.append("A")
            continue
        if s.get("section"):
            idx += 1
        out.append(str(idx) if has and idx > 0 and (project["settings"].get("refNumbering") or "chapter") == "chapter" else "")
    return out


def _pos(el: dict[str, Any]) -> tuple[float, float]:
    try:
        return float(el.get("y", 0)), float(el.get("x", 0))
    except (TypeError, ValueError):
        return 0.0, 0.0


def is_theorem(el: dict[str, Any]) -> bool:
    return el.get("type") == "shape" and el.get("shape") == "theorem"


def numbered_theorem(el: dict[str, Any]) -> bool:
    return is_theorem(el) and el.get("kind") != "proof" and el.get("numbered", True)


def plan(project: dict[str, Any], pages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """{"numbers": {要素の id: {"num", "text"}}, "labels": {ラベル: {"text", "num", "slideId", "elementId"}}}。"""
    from .project import page_plan  # noqa: PLC0415
    slides = project["slides"]
    styles = normalize_settings(project["settings"].get("theorems"))
    chap = _chapters(project)
    counters: dict[tuple[str, str], int] = {}
    numbers: dict[str, dict[str, str]] = {}
    target_num: dict[str, dict[str, str]] = {}  # 番号のテキストを付けた要素（数式・図）の id → 番号

    def nxt(series: str, ch: str) -> str:
        k = counters[(series, ch)] = counters.get((series, ch), 0) + 1
        return f"{ch}.{k}" if ch else str(k)

    for si in _order(project):
        sl = slides[si]
        by_id = {e.get("id"): e for e in sl.get("elements") or []}
        items = []
        for e in sl.get("elements") or []:
            if numbered_theorem(e):
                items.append((_pos(e), e, "thm"))
            elif e.get("type") == "text" and e.get("numberOf") in by_id and e.get("numberKind") in ("eq", "fig"):
                items.append((_pos(by_id[e["numberOf"]]), e, e["numberKind"]))
        for _p, e, series in sorted(items, key=lambda t: t[0]):
            n = nxt(series, chap[si])
            if series == "thm":
                text = f"{styles[e.get('kind', 'theorem')]['label']} {n}"
            elif series == "eq":
                text = f"({n})"
            else:
                text = f"図 {n}"
            numbers[e["id"]] = {"num": n, "text": text}
            if series != "thm":
                target_num.setdefault(e["numberOf"], {"num": n, "text": text})
    pp = pages if pages is not None else page_plan(project, list(range(len(slides))))
    labels: dict[str, dict[str, Any]] = {}
    for si in _order(project):
        sl = slides[si]
        for e in sl.get("elements") or []:
            lab = str(e.get("refLabel") or "").strip()
            if not lab or lab in labels:
                continue
            got = numbers.get(e["id"]) if numbered_theorem(e) else target_num.get(e["id"])
            if got is None:
                pg = str(pp[si]["number"]) if si < len(pp) else str(si + 1)
                got = {"num": pg, "text": f"p.{pg}"}
            labels[lab] = {**got, "slideId": sl.get("id"), "elementId": e["id"], "target": appear_key(sl, e)}
    return {"numbers": numbers, "labels": labels, "styles": styles}


def appear_key(sl: dict[str, Any], e: dict[str, Any]) -> str:
    """参照で飛ぶ先: 要素が画面に出る区切り。スライドの初めから出ていれば、スライドの id。ステップで出すなら、
    初めてその要素（または、その要素を含むグループ）を動かすステップの区切り「スライドの id:ステップの id」。"""
    sid = str(sl.get("id"))
    gid = e.get("groupId")
    groups = {g.get("id"): g for g in sl.get("groups") or []}
    hidden = not e.get("visibleAtStart", True) or (gid in groups and groups[gid].get("visibleAtStart") is False)
    if not hidden:
        return sid
    for st in sl.get("steps") or []:
        if st.get("mode") == "gui" and any(r.get("target") in (e.get("id"), gid) for r in st.get("rows") or [] if r.get("kind") == "anim"):
            return f"{sid}:{st.get('id')}"
        if st.get("mode") == "code" and e.get("var") and re.search(rf"\b{re.escape(str(e['var']))}\b", st.get("code") or ""):
            return f"{sid}:{st.get('id')}"
    return sid


def has_refs(s: str) -> bool:
    return bool(REF_RE.search(s or ""))


def sub_plain(s: str, p: dict[str, Any], latex: bool = False) -> str:
    """{ref:…}・{num:…} を番号の文字に（LaTeX のときは \\text{…} で囲む。数式の中でも日本語が書けるように）。"""
    def rep(m: re.Match) -> str:
        info = p["labels"].get(m.group(2))
        t = "??" if info is None else (info["text"] if m.group(1) == "ref" else info["num"])
        return f"\\text{{{t}}}" if latex else t
    return REF_RE.sub(rep, s or "")


class Marker:
    """書き出しで、参照の文字に付ける目印の色を配る。"""

    def __init__(self) -> None:
        self.n = 0

    def take(self) -> str:
        self.n += 1
        return f"#{_MARK_BASE + self.n:06X}"


def sub_marked(s: str, p: dict[str, Any], mk: Marker, color: str, links: list) -> str:
    """LaTeX の文字の参照を、目印の色を付けた番号に。links に (目印, 飛ぶ先のスライドの id, 元の色) を足す。"""
    def rep(m: re.Match) -> str:
        info = p["labels"].get(m.group(2))
        t = "??" if info is None else (info["text"] if m.group(1) == "ref" else info["num"])
        if info is None:
            return f"\\text{{{t}}}"
        mark = mk.take()
        links.append((mark, info.get("target") or info["slideId"], color))
        return f"{{\\color[HTML]{{{mark[1:]}}}\\text{{{t}}}}}"
    return REF_RE.sub(rep, s or "")


def _split_runs(runs: list[dict[str, Any]], p: dict[str, Any], self_text: str | None, mk: Marker | None,
                default_color: str, links: list) -> list[dict[str, Any]]:
    out = []
    for r in runs:
        t = str(r.get("t", ""))
        if self_text is not None:
            t = t.replace(SELF_TOKEN, self_text)
        pos = 0
        for m in REF_RE.finditer(t):
            if m.start() > pos:
                out.append({**r, "t": t[pos:m.start()]})
            info = p["labels"].get(m.group(2))
            txt = "??" if info is None else (info["text"] if m.group(1) == "ref" else info["num"])
            if mk is not None and info is not None:
                mark = mk.take()
                links.append((mark, info.get("target") or info["slideId"], r.get("c") or default_color))
                out.append({**r, "t": txt, "c": mark})
            else:
                out.append({**r, "t": txt})
            pos = m.end()
        if pos < len(t) or not t:
            out.append({**r, "t": t[pos:]})
    return out


def apply(project: dict[str, Any], marked: bool = True) -> dict[str, Any]:
    """番号・参照を書き込んだプロジェクト（写し）。marked=True（書き出し）は、参照に目印の色を付け、
    要素に _refLinks = [(目印, 飛ぶ先, 元の色)] を付ける。"""
    if project.get("_refsApplied"):
        return project
    p = plan(project)
    out = copy.deepcopy(project)
    out["_refsApplied"] = True
    out["_refPlan"] = p
    mk = Marker() if marked else None
    default_color = project["settings"].get("defaultColor", "#222222")
    for sl in out["slides"]:
        for e in sl.get("elements") or []:
            links: list = []
            color = e.get("color") or default_color
            self_text = p["numbers"].get(e.get("id"), {}).get("text") if e.get("numberOf") else None

            def lx(s: str) -> str:
                if not has_refs(s):
                    return s
                return sub_marked(s, p, mk, color, links) if mk else sub_plain(s, p, latex=True)

            if e.get("type") == "text":
                runs = e.get("runs") or [{"t": e.get("text", "")}]
                if self_text is not None or any(has_refs(str(r.get("t", ""))) for r in runs):
                    e["runs"] = _split_runs(runs, p, self_text, mk, color, links)
                    e["text"] = "".join(r["t"] for r in e["runs"])
            elif e.get("type") == "math":
                e["latex"] = lx(e.get("latex", ""))
            elif e.get("type") == "shape" and e.get("shape") in ("tex", "title"):
                e["latex"] = lx(e.get("latex", ""))
            elif e.get("type") == "shape" and e.get("shape") == "bullets":
                e["items"] = [lx(x) for x in e.get("items") or []]
            elif is_theorem(e):
                e["title"] = lx(e.get("title", ""))
                e["body"] = lx(e.get("body", ""))
                e["_number"] = p["numbers"].get(e["id"], {}).get("num")
                if e.get("kind") == "proof" and e.get("proofOf"):
                    info = p["labels"].get(e["proofOf"])
                    e["_proofOf"] = info["text"] if info else "??"
                    if info and mk:
                        e["_proofLink"] = info.get("target") or info["slideId"]
            if links:
                e["_refLinks"] = links
    return out


def problems(project: dict[str, Any]) -> list[dict[str, Any]]:
    """点検用: 見つからないラベル・同じラベルが 2 か所以上。"""
    p = plan(project)
    seen: dict[str, int] = {}
    out = []
    for si, sl in enumerate(project["slides"]):
        for e in sl.get("elements") or []:
            lab = str(e.get("refLabel") or "").strip()
            if lab:
                seen[lab] = seen.get(lab, 0) + 1
                if seen[lab] == 2:
                    out.append({"kind": "dup", "label": lab, "slideIndex": si, "elementId": e["id"]})
            texts = []
            if e.get("type") == "text":
                texts = [str(r.get("t", "")) for r in e.get("runs") or []]
            elif e.get("type") == "math" or e.get("shape") in ("tex", "title"):
                texts = [e.get("latex", "")]
            elif e.get("shape") == "bullets":
                texts = list(e.get("items") or [])
            elif is_theorem(e):
                texts = [e.get("title", ""), e.get("body", ""), f"{{ref:{e['proofOf']}}}" if e.get("proofOf") else ""]
            for t in texts:
                for m in REF_RE.finditer(t or ""):
                    if m.group(2) not in p["labels"]:
                        out.append({"kind": "missing", "label": m.group(2), "slideIndex": si, "elementId": e["id"]})
    return out
