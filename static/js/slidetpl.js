// スライドの型: 今のスライドを型として保存し、保存した型から新しいスライドを足す。

import { api } from "./api.js";
import { insertSlideCopy, slideThumb } from "./slides.js";
import { currentSlide, escapeHtml, store, toast } from "./store.js";

const $ = (id) => document.getElementById(id);

async function renderList() {
  const r = await api.get("/api/templates").catch(() => ({ slides: [] }));
  const ul = $("st-list");
  ul.innerHTML = r.slides.length ? r.slides.map((t) => `<li data-name="${escapeHtml(t.name)}">
      ${t.thumb ? `<img src="${t.thumb}" alt="">` : `<div class="tpl-noimg"></div>`}
      <b>${escapeHtml(t.name)}</b><span class="hint">要素 ${t.count} 個</span>
      <div class="row"><button type="button" class="small primary" data-a="use">このスライドのあとに足す</button><button type="button" class="small danger" data-a="del">削除</button></div></li>`).join("")
    : `<li class="empty">保存した型はまだありません。「今のスライドを型として保存…」で保存します。</li>`;
  ul.querySelectorAll("li[data-name]").forEach((li) => {
    const name = li.dataset.name;
    li.querySelector("[data-a=use]").addEventListener("click", async () => {
      try {
        const res = await api.post("/api/templates/slides/use", { name });
        $("dlg-slide-tpl").close();
        // 型に入れておいた部品の中身を、このプロジェクトに写す（無いもの・古いものだけ）
        const list = (store.project.parts ??= []);
        for (const p of res.slide._parts ?? []) {
          const i = list.findIndex((x) => x.id === p.id);
          if (i < 0) list.push(p); else if (Number(p.updatedAt) > Number(list[i].updatedAt)) list[i] = p;
        }
        delete res.slide._parts;
        insertSlideCopy(res.slide);
        const n = Object.keys(res.renames ?? {}).length;
        toast(`型「${name}」からスライドを足しました。${n ? `（同じ名前の違うファイルがあったので、${n} 個のファイルの名前を変えて写しました）` : ""}`, "", 4000);
      } catch (e) { toast(e.message, "ng", 6000); }
    });
    li.querySelector("[data-a=del]").addEventListener("click", async () => {
      if (!confirm(`型「${name}」を削除しますか？`)) return;
      await api.post("/api/templates/delete", { kind: "slides", name }).catch((e) => toast(e.message, "ng"));
      renderList();
    });
  });
}

export async function openSlideTemplates() {
  if (!store.project) return;
  await renderList();
  $("dlg-slide-tpl").showModal();
}

export function setupSlideTemplates() {
  $("st-save").addEventListener("click", async () => {
    const name = prompt("型の名前（同じ名前があれば上書きします）", "");
    if (!name) return;
    const slide = JSON.parse(JSON.stringify(currentSlide()));
    if (!$("st-steps").checked) slide.steps = [];
    if (slide.pageNumber) slide.pageNumber = { ...slide.pageNumber, number: null }; // 番号の指定は、型には含めない（付ける・付けないは残す）
    delete slide.skip; // 「描画しない」の印は、型には含めない
    // 置いた部品の中身も、型に入れておく（ほかのプロジェクトで足しても描けるように）
    const pids = new Set(slide.elements.filter((e) => e.shape === "part").map((e) => e.partId));
    slide._parts = (store.project.parts ?? []).filter((p) => pids.has(p.id));
    try {
      const r = await api.post("/api/templates/slides", { name, slide, thumb: slideThumb(currentSlide().id) });
      toast(`型「${name}」を保存しました${r.files.length ? `（ファイル ${r.files.length} 個も一緒に保存）` : ""}。`);
      renderList();
    } catch (e) { toast(e.message, "ng", 6000); }
  });
}
