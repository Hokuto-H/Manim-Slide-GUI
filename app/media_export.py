"""「発表で再生」の動画・音声を、ファイルに出力した発表（HTML・PDF・PowerPoint）にも入れる。

発表ウィンドウでは、Manim の映像の上に動画・音声を重ねて再生している（present_media.py）。manim-slides convert は
Manim の映像（区切りごとの動画）しか知らないので、出力したあとに、ここで形式ごとに足す。

- HTML: 動画・音声の要素と、発表ウィンドウと同じ動き（区切りの始まりの状態・区切りの中の操作の時刻・くり返し・
  終わったときの扱い・フェード）をする小さなスクリプトを、reveal.js の HTML に入れる。ファイルは <名前>_assets/media に写す
  （1 つのファイルにまとめるときは、HTML の中に入れる）。
- PDF: 区切りの最後の時点で見えている動画の、その時点のコマを、区切りの最後の画面に重ねる。
- PowerPoint: 区切りの間に見える動画（と、鳴る音声）を、その位置に置く（クリックで再生。表紙はそのときのコマ）。
"""

from __future__ import annotations

import base64
import copy
import html
import json
import mimetypes
import shutil
from pathlib import Path
from typing import Any

from .present_media import CANVAS_H, CANVAS_W, advance, apply_cue, on_slide, state_at


def load_plan(folder: Path, cls: str) -> dict[str, Any] | None:
    """描画のときに書いた、動画・音声（発表で再生）の記録。無ければ None。"""
    f = folder / "slides" / "gui_pages" / f"{cls}.media.json"
    try:
        plan = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return plan if (plan.get("media") or {}) else None


def _cues(plan: dict[str, Any], j: int) -> list[list[Any]]:
    return [c for c in plan.get("cues") or [] if c[0] == j]


def segment_states(plan: dict[str, Any], n: int) -> list[dict[str, Any]]:
    """区切りごとに、始まりの状態・終わりの状態・区切りの間に見える（鳴る）ものの id。"""
    media = plan.get("media") or {}
    durs = plan.get("durations") or []
    out = []
    for j in range(n):
        start = state_at(plan, j)
        st = copy.deepcopy(start)
        seen = {mid for mid, s in st.items() if s["visible"] or s["playing"]}
        t = 0.0
        for c in _cues(plan, j):
            for mid, spec in media.items():
                advance(spec, st[mid], c[1] - t)
            t = c[1]
            if c[2] in media:
                apply_cue(media[c[2]], st[c[2]], c[3], c[4])
                if st[c[2]]["visible"] or st[c[2]]["playing"]:
                    seen.add(c[2])
        dur = durs[j] if j < len(durs) else t
        for mid, spec in media.items():
            advance(spec, st[mid], max(0.0, dur - t))
        out.append({"start": start, "end": st, "seen": seen})
    return out


def video_frame(path: Path, t: float):
    """動画の t 秒のコマ（PIL の画像）。読めなければ None。"""
    try:
        import av  # noqa: PLC0415
        with av.open(str(path)) as c:
            stream = c.streams.video[0]
            if t > 0 and stream.time_base:
                c.seek(int(max(0.0, t - 0.5) / stream.time_base), stream=stream, backward=True)
            last = None
            for frame in c.decode(stream):
                last = frame
                if frame.time is not None and frame.time >= t - 1e-3:
                    break
            return last.to_image() if last is not None else None
    except Exception:  # noqa: BLE001 — コマが読めなくても、出力は続ける
        return None


def _poster_time(spec: dict[str, Any], st: dict[str, Any]) -> float:
    start = float(spec.get("trimStart") or 0.0)
    return float(spec.get("posterTime") or start) if st["pos"] <= start + 1e-3 and not st["playing"] else st["pos"]


# ---------------------------------------------------------------- PDF

def page_last_segments(folder: Path, cls: str, n: int) -> list[int]:
    """スライド（ページ）ごとの、最後の区切りの番号。ページの記録（gui_pages/<クラス>.json）が無ければ、すべての区切り。"""
    try:
        pages = json.loads((folder / "slides" / "gui_pages" / f"{cls}.json").read_text(encoding="utf-8"))
        if not isinstance(pages, list) or len(pages) != n:
            raise ValueError
    except (OSError, ValueError):
        return list(range(n))
    return [j for j in range(n) if j == n - 1 or pages[j + 1][0] != pages[j][0]]


def segment_images(root: Path, plan: dict[str, Any] | None, files: list[Path], indices: list[int] | None = None) -> list[Any]:
    """区切りの最後の画面（indices があれば、その区切りだけ）の絵（PIL）。見えている動画（発表で再生）のコマを重ねる。"""
    from manim_slides.convert import FrameIndex, read_image_from_video_file  # noqa: PLC0415
    media = (plan or {}).get("media") or {}
    states = segment_states(plan, len(files)) if media else []
    images = []
    for j, f in enumerate(files):
        if indices is not None and j not in indices:
            continue
        img = read_image_from_video_file(f, FrameIndex.last).convert("RGB")
        sx, sy = img.width / CANVAS_W, img.height / CANVAS_H
        for mid, spec in media.items():
            st = states[j]["end"][mid]
            if spec.get("kind") != "video" or not st["visible"] or not spec.get("rect"):
                continue
            fr = video_frame(root / spec["path"], _poster_time(spec, st))
            if fr is None:
                continue
            x, y, w, h = spec["rect"]
            box = (round(w * sx), round(h * sy))
            fr = fr.convert("RGB")
            fr.thumbnail(box)  # 縦横比を保って枠の中に（発表と同じ）
            img.paste(fr, (round(x * sx + (box[0] - fr.width) / 2), round(y * sy + (box[1] - fr.height) / 2)))
        images.append(img)
    return images


def make_pdf(root: Path, plan: dict[str, Any] | None, files: list[Path], dest: Path,
             indices: list[int] | None = None, resolution: float = 100.0) -> None:
    """manim-slides の PDF と同じく、区切りの最後の画面を 1 ページずつ（indices があれば、その区切りだけ）。
    見えている動画（発表で再生）のコマを重ねる。"""
    images = segment_images(root, plan, files, indices)
    dest.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(dest, "PDF", resolution=resolution, save_all=True, append_images=images[1:])


# ---------------------------------------------------------------- PowerPoint

_SPEAKER_SVG_SIZE = 96


def _speaker_icon(path: Path) -> None:
    """音声の目印の小さな画像（スピーカー）。"""
    from PIL import Image, ImageDraw  # noqa: PLC0415
    n = _SPEAKER_SVG_SIZE
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2, 2, n - 3, n - 3), radius=14, fill=(40, 60, 90, 230))
    d.polygon([(20, 38), (34, 38), (52, 22), (52, 74), (34, 58), (20, 58)], fill="white")
    d.arc((44, 30, 70, 66), -50, 50, fill="white", width=5)
    d.arc((44, 18, 84, 78), -50, 50, fill="white", width=5)
    im.save(path)


def add_to_pptx(root: Path, plan: dict[str, Any], dest: Path, work: Path) -> None:
    """出力した PowerPoint の各スライド（区切り）に、そこで見える動画・鳴る音声を置く（クリックで再生）。"""
    import pptx  # noqa: PLC0415
    from lxml import etree  # noqa: PLC0415
    prs = pptx.Presentation(str(dest))
    media = plan.get("media") or {}
    states = segment_states(plan, len(prs.slides))
    sx, sy = prs.slide_width / CANVAS_W, prs.slide_height / CANVAS_H
    icon = work / "_gui_speaker.png"
    k = 0
    for j, slide in enumerate(prs.slides):
        n_audio = 0
        for mid, spec in media.items():
            if mid not in states[j]["seen"]:
                continue
            src = root / spec["path"]
            if not src.is_file():
                continue
            st = states[j]["start"][mid]
            mime = mimetypes.guess_type(src.name)[0] or ("video/mp4" if spec.get("kind") == "video" else "audio/mpeg")
            if spec.get("kind") == "video" and spec.get("rect"):
                fr = video_frame(src, _poster_time(spec, st))
                poster = None
                if fr is not None:
                    poster = work / f"_gui_poster_{k}.png"
                    fr.convert("RGB").save(poster)
                    k += 1
                x, y, w, h = spec["rect"]
                shape = slide.shapes.add_movie(str(src), round(x * sx), round(y * sy), round(w * sx), round(h * sy),
                                               poster_frame_image=str(poster) if poster else None, mime_type=mime)
            else:
                if not icon.exists():
                    _speaker_icon(icon)
                size = round(prs.slide_height * 0.07)
                shape = slide.shapes.add_movie(str(src), round(prs.slide_width * 0.01) + n_audio * (size + 8), round(prs.slide_height * 0.01),
                                               size, size, poster_frame_image=str(icon), mime_type=mime)
                n_audio += 1
            shape.name = f"{spec.get('name') or mid}"
            # 切り出し（始め・終わり）: PowerPoint 2010 以降の p14:trim
            start, end = float(spec.get("trimStart") or 0.0), float(spec.get("trimEnd") or 0.0)
            if start > 0 or end:
                p14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
                for m in shape._element.iter(f"{{{p14}}}media"):
                    trim = etree.SubElement(m, f"{{{p14}}}trim")
                    if start > 0:
                        trim.set("st", str(round(start * 1000)))
                    if end:
                        dur = float(spec.get("duration") or 0.0)
                        trim.set("end", str(round(max(0.0, dur - end) * 1000)))
    prs.save(str(dest))


# ---------------------------------------------------------------- HTML

_RUNTIME = r"""
(function () {
  const D = GUI_MEDIA;
  const layer = document.getElementById("gui-media"), box = layer.firstElementChild;
  const items = {};
  // 発表者用の画面（S キー）の中の小さな画面では、音を出さない・動かさない
  const receiver = /receiver/.test(location.search) || window.parent !== window;
  for (const [id, spec] of Object.entries(D.media)) {
    const el = document.getElementById("gm-" + id);
    // 動画の全体をくり返すときは、ブラウザにくり返させる（境目が途切れないように）
    const whole = !!spec.loop && Number(spec.trimStart || 0) <= 0.01 && (!spec.trimEnd || Number(spec.trimEnd) >= Number(spec.duration || 0) - 0.05);
    el.loop = whole;
    if (spec.kind === "video") el.style.objectFit = "fill";
    items[id] = { spec, el, vol: spec.volume ?? 1, finished: false, whole };
    el.addEventListener("ended", () => onEnd(items[id]));
  }
  const start = (s) => Number(s.trimStart || 0);
  const end = (s) => Number(s.trimEnd || s.duration || 0);
  function onSlide(s, slide) {
    const own = Number(s.slide || 0);
    if (slide === own) return true;
    if (s.kind === "audio" && s.across && slide > own) return s.acrossUntil == null || slide <= Number(s.acrossUntil);
    return false;
  }
  function show(it, v) { it.el.style.visibility = v ? "visible" : "hidden"; }
  function play(it) { if (receiver) return; it.finished = false; const p = it.el.play(); if (p) p.catch(() => {}); }
  function apply(it, st) {
    show(it, it.spec.kind === "video" && st.visible);
    it.vol = st.volume;
    try { it.el.currentTime = st.pos; } catch (e) {}
    if (st.playing) play(it); else it.el.pause();
  }
  function onEnd(it) {
    const s = it.spec;
    if (s.loop && end(s) > start(s)) { it.el.currentTime = start(s); play(it); return; }
    it.el.pause();
    it.finished = true;
    const after = s.after || "hold";
    if (after === "rewind") it.el.currentTime = start(s);
    if (after === "hide" || s.hideIdle) show(it, false);
  }
  function cue(id, action, value) {
    const it = items[id];
    if (!it) return;
    const s = it.spec;
    if (action === "play") {
      if (end(s) && it.el.currentTime >= end(s) - 1e-3) it.el.currentTime = start(s);
      show(it, s.kind === "video"); play(it);
    } else if (action === "pause") { it.el.pause(); if (s.hideIdle) show(it, false); }
    else if (action === "stop") { it.el.pause(); it.el.currentTime = start(s); if (s.hideIdle) show(it, false); }
    else if (action === "seek") it.el.currentTime = Math.max(start(s), Number(value || 0));
    else if (action === "volume") it.vol = Math.min(1, Math.max(0, Number(value || 0)));
    else if (action === "show") show(it, s.kind === "video");
    else if (action === "hide") show(it, false);
  }
  // 終わり（切り出しの終わり）・フェード・音量
  setInterval(() => {
    for (const it of Object.values(items)) {
      const s = it.spec, t = it.el.currentTime, e = end(s);
      if (!it.el.paused && e && t >= e && !it.whole) onEnd(it);
      let f = 1;
      if (s.fadeIn > 0) f = Math.min(f, Math.max(0, (t - start(s)) / s.fadeIn));
      if (s.fadeOut > 0 && e) f = Math.min(f, Math.max(0, (e - t) / s.fadeOut));
      it.el.volume = receiver ? 0 : Math.min(1, Math.max(0, it.vol * f));
    }
  }, 50);
  let cur = -1, timers = [];
  function go(j) {
    timers.forEach(clearTimeout); timers = [];
    const forward = j === cur + 1;
    const slide = D.segments[j] ?? 0, old = cur >= 0 ? (D.segments[cur] ?? 0) : null;
    for (const [id, it] of Object.entries(items)) {
      // 次の区切りへ進んだときは、同じスライドの間は再生をそのまま続ける（発表ウィンドウと同じ）
      if (forward && old !== null && onSlide(it.spec, old) && onSlide(it.spec, slide)) continue;
      apply(it, D.states[j][id]);
    }
    cur = j;
    for (const [t, id, action, value] of D.cues[j] || []) timers.push(setTimeout(() => cue(id, action, value), t * 1000));
  }
  function place() {
    const W = innerWidth, H = innerHeight, a = D.aspect;
    const bw = Math.min(W, H * a), bh = bw / a;
    Object.assign(box.style, { left: (W - bw) / 2 + "px", top: (H - bh) / 2 + "px", width: bw + "px", height: bh + "px" });
    layer.style.display = Reveal.isOverview && Reveal.isOverview() ? "none" : "";
  }
  addEventListener("resize", place);
  function idx() { return Reveal.getIndices().h; }
  const start0 = () => { place(); go(idx()); };
  Reveal.on("slidechanged", () => go(idx()));
  Reveal.on("overviewshown", place); Reveal.on("overviewhidden", place);
  if (Reveal.isReady()) start0(); else Reveal.on("ready", start0);
})();
"""


def add_to_html(root: Path, plan: dict[str, Any], dest: Path, n: int, one_file: bool, resolution: tuple[int, int] | None) -> None:
    """出力した HTML に、動画・音声の要素と、それを動かすスクリプトを入れる。"""
    media = plan.get("media") or {}
    states = segment_states(plan, n)
    assets = dest.parent / f"{dest.stem}_assets" / "media"
    srcs = {}
    for mid, spec in media.items():
        src = root / spec["path"]
        if not src.is_file():
            continue
        if one_file:
            mime = mimetypes.guess_type(src.name)[0] or "application/octet-stream"
            srcs[mid] = f"data:{mime};base64," + base64.b64encode(src.read_bytes()).decode("ascii")
        else:
            assets.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, assets / src.name)
            srcs[mid] = f"{dest.stem}_assets/media/{src.name}"
    els = []
    for mid, spec in media.items():
        if mid not in srcs:
            continue
        sid = html.escape(mid, quote=True)
        ctl = " controls" if spec.get("controls") else ""
        if spec.get("kind") == "video" and spec.get("rect"):
            x, y, w, h = spec["rect"]
            style = (f"position:absolute;left:{x / CANVAS_W * 100:.4f}%;top:{y / CANVAS_H * 100:.4f}%;"
                     f"width:{w / CANVAS_W * 100:.4f}%;height:{h / CANVAS_H * 100:.4f}%;object-fit:contain;"
                     "pointer-events:auto;visibility:hidden")
            poster = ""  # 再生する前の表紙（発表ウィンドウと同じく、表紙の時刻のコマ）
            fr = video_frame(root / spec["path"], float(spec.get("posterTime") or spec.get("trimStart") or 0.0))
            if fr is not None:
                import io  # noqa: PLC0415
                buf = io.BytesIO()
                fr.convert("RGB").save(buf, "JPEG", quality=85)
                if one_file:
                    poster = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
                else:
                    (assets / f"{Path(spec['path']).stem}.poster.jpg").write_bytes(buf.getvalue())
                    poster = f"{dest.stem}_assets/media/{Path(spec['path']).stem}.poster.jpg"
            pa = f' poster="{html.escape(poster, quote=True)}"' if poster else ""
            els.append(f'<video id="gm-{sid}" src="{html.escape(srcs[mid], quote=True)}"{pa} preload="auto" playsinline{ctl} style="{style}"></video>')
        else:
            els.append(f'<audio id="gm-{sid}" src="{html.escape(srcs[mid], quote=True)}" preload="auto"></audio>')
    if not els:
        return
    w, h = resolution or (1920, 1080)
    data = {
        "media": {mid: {k: v for k, v in spec.items() if k != "path"} for mid, spec in media.items() if mid in srcs},
        "segments": (plan.get("segments") or [])[:n],
        "states": [{mid: s for mid, s in states[j]["start"].items() if mid in srcs} for j in range(n)],
        "cues": [[[c[1], c[2], c[3], c[4]] for c in _cues(plan, j)] for j in range(n)],
        "aspect": w / h,
    }
    block = ('\n<!-- 動画・音声（Manim Slide GUI の「発表で再生」） -->\n'
             '<div id="gui-media" style="position:fixed;inset:0;pointer-events:none;z-index:20">'
             f'<div style="position:absolute">{"".join(els)}</div></div>\n'
             f'<script>const GUI_MEDIA = {json.dumps(data, ensure_ascii=False)};{_RUNTIME}</script>\n')
    text = dest.read_text(encoding="utf-8")
    i = text.rfind("</body>")
    text = text[:i] + block + text[i:] if i >= 0 else text + block
    dest.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------- リンク（押すと飛ぶ要素）

def load_links(folder: Path, cls: str, n: int) -> tuple[list[list[tuple[list[float], str]]], dict[str, int]] | None:
    """区切りごとのリンク [(位置（割合: 左・上・幅・高さ）, 飛ぶ先)] と、スライドの id → 最初の区切りの番号。記録が無い・合わなければ None。"""
    d = folder / "slides" / "gui_pages"
    try:
        keys = json.loads((d / f"{cls}.segs.json").read_text(encoding="utf-8"))
        deck = json.loads((d / f"{cls}.deck.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(keys, list) or len(keys) != n:
        return None
    slides = deck.get("slides") or []
    pos = {str(s.get("id")): i for i, s in enumerate(slides)}
    first: dict[str, int] = {}
    for j, k in enumerate(keys):
        first.setdefault(str(k).split(":", 1)[0], j)
        first.setdefault(str(k), j)  # 「スライドの id:ステップの id」でも飛べる（参照の飛ぶ先: 要素が出るクリック）
    by_slide: dict[int, list[tuple[list[float], str]]] = {}
    for si, rect, to in deck["links"]:
        by_slide.setdefault(int(si), []).append((rect, str(to)))
    segs = [by_slide.get(pos.get(str(k).split(":", 1)[0], -1), []) for k in keys]
    return segs, first


def appendix_start(folder: Path, cls: str, n: int) -> int | None:
    """付録の最初の区切りの番号（付録が無い・記録が無ければ None）。"""
    d = folder / "slides" / "gui_pages"
    try:
        keys = json.loads((d / f"{cls}.segs.json").read_text(encoding="utf-8"))
        deck = json.loads((d / f"{cls}.deck.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(keys, list) or len(keys) != n:
        return None
    apx = {str(s.get("id")) for s in deck.get("slides") or [] if s.get("appendix")}
    return next((j for j, k in enumerate(keys) if str(k).split(":", 1)[0] in apx), None)


_LINK_RUNTIME = r"""
(function () {
  const L = GUI_LINKS, layer = document.getElementById("gui-links"), box = layer.firstElementChild;
  let back = [], jumping = false, prev = null;
  function draw(j) {
    box.innerHTML = "";
    for (const [r, to] of L.segs[j] || []) {
      const a = document.createElement("a");
      a.href = "#";
      a.title = to === "back" ? "戻る" : "このスライドへ";
      Object.assign(a.style, { position: "absolute", left: r[0] * 100 + "%", top: r[1] * 100 + "%", width: r[2] * 100 + "%", height: r[3] * 100 + "%",
        pointerEvents: "auto", cursor: "pointer", display: "block" });
      a.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (to === "back") { const b = back.pop(); if (b !== undefined) { jumping = true; Reveal.slide(b); } return; }
        const t = L.first[to] ?? L.first[String(to).split(":")[0]];
        if (t !== undefined) { back.push(Reveal.getIndices().h); jumping = true; Reveal.slide(t); }
      });
      box.appendChild(a);
    }
  }
  function place() {
    const W = innerWidth, H = innerHeight, a = L.aspect;
    const bw = Math.min(W, H * a), bh = bw / a;
    Object.assign(box.style, { left: (W - bw) / 2 + "px", top: (H - bh) / 2 + "px", width: bw + "px", height: bh + "px" });
    layer.style.display = Reveal.isOverview && Reveal.isOverview() ? "none" : "";
  }
  addEventListener("resize", place);
  const idx = () => Reveal.getIndices().h;
  const start0 = () => { place(); prev = idx(); draw(prev); };
  // 付録: 本編の最後から「次へ」で付録の初めに来たら、本編の最後へ戻す（リンク・一覧（Esc）・ページの指定では入れる）
  let overview = false;
  Reveal.on("overviewshown", () => { overview = true; });
  Reveal.on("overviewhidden", () => { overview = false; });
  Reveal.on("slidechanged", () => {
    const j = idx();
    if (L.appendix != null && !jumping && !overview && prev === L.appendix - 1 && j === L.appendix) {
      Reveal.slide(prev);
      note("本編の最後です（付録は、リンクか一覧（Esc）で開けます）");
      return;
    }
    jumping = false;
    prev = j;
    draw(j);
  });
  function note(text) {
    let n = document.getElementById("gui-note");
    if (!n) {
      n = document.createElement("div");
      n.id = "gui-note";
      Object.assign(n.style, { position: "fixed", left: "50%", bottom: "6%", transform: "translateX(-50%)", background: "rgba(0,0,0,.72)",
        color: "#fff", padding: "8px 16px", borderRadius: "8px", font: "16px sans-serif", zIndex: 40, pointerEvents: "none", transition: "opacity .3s" });
      document.body.appendChild(n);
    }
    n.textContent = text; n.style.opacity = 1;
    clearTimeout(n._t); n._t = setTimeout(() => { n.style.opacity = 0; }, 2200);
  }
  Reveal.on("overviewshown", place); Reveal.on("overviewhidden", place);
  if (Reveal.isReady()) start0(); else Reveal.on("ready", start0);
})();
"""


def add_links_to_html(folder: Path, cls: str, dest: Path, n: int, resolution: tuple[int, int] | None) -> int:
    """出力した HTML に、押すと飛ぶ透明な枠を入れる。入れたリンクの数。"""
    got = load_links(folder, cls, n)
    if got is None:
        return 0
    segs, first = got
    apx = appendix_start(folder, cls, n)
    if not any(segs) and apx is None:
        return 0
    w, h = resolution or (1920, 1080)
    data = {"segs": segs, "first": first, "aspect": w / h, "appendix": apx}
    block = ('\n<!-- リンク（Manim Slide GUI の「押すと飛ぶ」） -->\n'
             '<div id="gui-links" style="position:fixed;inset:0;pointer-events:none;z-index:30"><div style="position:absolute"></div></div>\n'
             f'<script>const GUI_LINKS = {json.dumps(data, ensure_ascii=False)};{_LINK_RUNTIME}</script>\n')
    text = dest.read_text(encoding="utf-8")
    i = text.rfind("</body>")
    text = text[:i] + block + text[i:] if i >= 0 else text + block
    dest.write_text(text, encoding="utf-8")
    return sum(len(x) for x in segs)


def add_links_to_pdf(folder: Path, cls: str, dest: Path, n: int, indices: list[int] | None = None) -> int:
    """出力した PDF のページに、リンク（押すとそのページへ）を入れる。indices: PDF の各ページの区切りの番号（無ければ全区切り）。
    「戻る」は、飛んでくる元が 1 つならそのページへのリンク、いくつもあれば「前に見たページへ戻る」の命令にする。入れたリンクの数。"""
    got = load_links(folder, cls, n)
    if got is None or not any(got[0]):
        return 0
    segs, first = got
    try:
        from pypdf import PdfReader, PdfWriter  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("pypdf が入っていないため、PDF にリンクを入れませんでした（conda install -c conda-forge pypdf で入れられます）") from e
    from pypdf.annotations import Link  # noqa: PLC0415
    from pypdf.generic import ArrayObject, DictionaryObject, Fit, FloatObject, NameObject, NumberObject  # noqa: PLC0415
    pages_seg = list(range(n)) if indices is None else list(indices)
    reader = PdfReader(str(dest))
    if len(reader.pages) != len(pages_seg):
        return 0
    writer = PdfWriter(clone_from=reader)
    keys = json.loads((folder / "slides" / "gui_pages" / f"{cls}.segs.json").read_text(encoding="utf-8"))
    sid_of = [str(k).split(":", 1)[0] for k in keys]
    count = 0
    for p, j in enumerate(pages_seg):
        page = writer.pages[p]
        W, H = float(page.mediabox.width), float(page.mediabox.height)
        for r, to in segs[j]:
            x0, y0 = r[0] * W, H - (r[1] + r[3]) * H
            x1, y1 = (r[0] + r[2]) * W, H - r[1] * H
            if to == "back":
                # このスライドへ飛ぶリンクのあるスライドが 1 つだけなら、そのページへ（どのソフトでも働く）。
                # いくつもあるときは「前に見たページへ戻る」（Acrobat などで働く。PDF の標準の命令ではない）
                here = sid_of[j]
                srcs = []
                for q, jj in enumerate(pages_seg):
                    if any(t == here for _r, t in segs[jj]) and sid_of[jj] not in [sid_of[pages_seg[x]] for x in srcs]:
                        srcs.append(q)
                if len(srcs) == 1:
                    target = srcs[0]
                else:
                    annot = DictionaryObject({
                        NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Link"),
                        NameObject("/Rect"): ArrayObject([FloatObject(x0), FloatObject(y0), FloatObject(x1), FloatObject(y1)]),
                        NameObject("/Border"): ArrayObject([NumberObject(0), NumberObject(0), NumberObject(0)]),
                        NameObject("/A"): DictionaryObject({NameObject("/S"): NameObject("/Named"), NameObject("/N"): NameObject("/GoBack")}),
                    })
                    writer.add_annotation(page_number=p, annotation=annot)
                    count += 1
                    continue
            elif to in first or to.split(":", 1)[0] in first:
                t = first.get(to, first.get(to.split(":", 1)[0]))
                # 飛ぶ先の区切りが PDF に無いとき（スライドごとの PDF）は、その区切り以降の最初のページ
                target = next((q for q, jj in enumerate(pages_seg) if jj >= t), None)
            else:
                continue
            if target is None:
                continue
            obj = writer.add_annotation(page_number=p, annotation=Link(rect=(x0, y0, x1, y1), target_page_index=target, fit=Fit.fit()))
            # 同じ PDF の中のページへは、ページの番号ではなく、ページそのもの（の参照）を指す（PDF の決まり）
            obj[NameObject("/Dest")] = ArrayObject([writer.pages[target].indirect_reference, NameObject("/Fit")])
            count += 1
    if count:
        writer.write(str(dest))
    return count
