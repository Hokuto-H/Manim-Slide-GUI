// 複数選択・グループ化と、選択中の物への操作（削除・移動・重なり順）。
// 選択の単位: グループに入っていない要素は1つずつ、グループは中の要素すべてをまとめて扱う
// （ダブルクリックでグループの中に入っているときは、中の要素を1つずつ扱う）。

import { moveElements, selectIds, selectObject, showSlide } from "./canvas.js";
import { renderStepChips } from "./slides.js";
import {
  compactGroups, currentSlide, emit, findElement, findGroup, groupMembers, markDirty, slideGroups, store, toast, uid,
  uniqueVar, withDependents, detachRefs, stepsTouching, dropStepsOf,
} from "./store.js";

/** 要素またはグループ 1 つを選ぶ（パネル・レイヤー一覧・ステップの順序も更新する）。 */
export function select(id, { stepId = null } = {}) {
  store.selectedId = id ?? null;
  const keep = !stepId && currentSlide()?.steps.find((s) => s.id === store.focusStepId)?.mode === "gui";
  if (!keep) store.focusStepId = stepId;
  selectObject(id);
  emit("selection", store.selectedId);
  renderStepChips();
}

/** 要素の id の一覧を選ぶ（グループの要素がすべて入っていればグループとして扱う）。 */
export function selectMany(ids) {
  selectIds(ids);
  renderStepChips();
}

export function selectAll() {
  const ids = currentSlide().elements.filter((e) => !e.hidden && !e.locked).map((e) => e.id);
  selectMany(ids);
}

export function clearSelection() {
  store.enteredGroup = null;
  select(null);
}

/** 選択中の物を、重なり順の「単位」（1 要素、またはグループ全体）に分けて返す。 */
function selectedUnits() {
  const slide = currentSlide();
  const ids = new Set(store.selectedIds);
  const seen = new Set();
  const units = [];
  for (const e of slide.elements) {
    if (!ids.has(e.id)) continue;
    const gid = e.groupId && e.groupId !== store.enteredGroup ? e.groupId : null;
    const key = gid ?? e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push(gid ? { gid, ids: groupMembers(gid).map((m) => m.id) } : { id: e.id, ids: [e.id] });
  }
  return units;
}

// ---------------------------------------------------------------- 重なり順

/** blocks（背面→前面の配列）のうち isSel のものを op の方向へ動かす。 */
function reorder(blocks, isSel, op) {
  const sel = blocks.filter(isSel), rest = blocks.filter((b) => !isSel(b));
  if (!sel.length) return blocks;
  if (op === "front") return [...rest, ...sel];
  if (op === "back") return [...sel, ...rest];
  const out = [...blocks];
  if (op === "forward") {
    for (let i = out.length - 2; i >= 0; i--) {
      if (isSel(out[i]) && !isSel(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (isSel(out[i]) && !isSel(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}

/** 重なり順の単位（グループは 1 つにまとめる）に分ける。 */
function blocksOf(elements) {
  const blocks = [];
  for (const e of elements) {
    const last = blocks[blocks.length - 1];
    if (e.groupId && last?.gid === e.groupId) last.els.push(e);
    else blocks.push({ gid: e.groupId ?? null, els: [e] });
  }
  return blocks;
}

/** 選択中の物の重なり順を変える。op: "front" | "forward" | "backward" | "back" */
export function moveSelectionLayer(op) {
  const slide = currentSlide();
  const ids = new Set(store.selectedIds);
  if (!slide || !ids.size) return;
  const before = slide.elements.map((e) => e.id).join();
  const g = store.enteredGroup;
  if (g && store.selectedIds.every((id) => findElement(id)?.groupId === g)) {
    // グループの中に入っているときは、グループの中だけで並べ替える
    const members = reorder(groupMembers(g), (e) => ids.has(e.id), op);
    const first = slide.elements.findIndex((e) => e.groupId === g);
    slide.elements.splice(first, members.length, ...members);
  } else {
    const blocks = reorder(blocksOf(slide.elements), (b) => b.els.some((e) => ids.has(e.id)), op);
    slide.elements = blocks.flatMap((b) => b.els);
  }
  if (slide.elements.map((e) => e.id).join() !== before) afterOrderChange();
}

export function afterOrderChange() {
  compactGroups(currentSlide());
  markDirty("layer");
  showSlide();
  emit("layers-changed");
  emit("slide-changed");
}

// ---------------------------------------------------------------- 削除・移動

function stepsOf(ids) {
  return stepsTouching(currentSlide(), ids);
}

/** 選択中の物（グループを選んでいればグループごと）を削除する。 */
export function deleteSelection() {
  const slide = currentSlide();
  if (!store.selectedIds.length) return;
  const ids = withDependents(store.selectedIds); // 座標軸を消すときは、そのグラフも
  // 要素がすべて消えるグループは、グループのステップも消える
  const goneGroups = slideGroups().filter((g) => groupMembers(g.id).every((m) => ids.includes(m.id))).map((g) => g.id);
  const steps = stepsOf([...ids, ...goneGroups]);
  const what = ids.length === 1 ? `「${findElement(ids[0]).var}」` : `選択中の ${ids.length} 個の要素`;
  if (steps.length && !confirm(`${what}を削除しますか？（ステップ ${steps.length} 個も削除されます）`)) return;
  slide.elements = slide.elements.filter((e) => !ids.includes(e.id));
  dropStepsOf(slide, [...ids, ...goneGroups]);
  // 消した要素への参照を外す（2 つのグラフの間の面積は x 軸との間に戻し、表のセルは空にする）
  detachRefs(slide, ids);
  compactGroups(slide);
  store.selectedId = null;
  store.selectedIds = [];
  store.enteredGroup = null;
  markDirty("delete");
  showSlide();
  emit("selection", null);
  renderStepChips();
}

/** 選択中の物を dx, dy（キャンバスの px）動かす。 */
export function nudgeSelection(dx, dy) {
  if (!store.selectedIds.length) return;
  moveElements(store.selectedIds, dx, dy);
}

// ---------------------------------------------------------------- グループ化

/** 選択中の要素をグループにする（グループを含んでいれば、その中の要素ごと 1 つのグループにまとめ直す）。 */
export function groupSelection() {
  const slide = currentSlide();
  const ids = [...store.selectedIds];
  if (ids.length < 2) { toast("グループにするには、要素を 2 つ以上選んでください。", "warn"); return; }
  const g = store.enteredGroup;
  if (g && ids.every((id) => findElement(id)?.groupId === g)) {
    toast("グループの中にグループは作れません（入れ子のグループには対応していません）。", "warn");
    return;
  }
  const oldGroups = [...new Set(ids.map((id) => findElement(id)?.groupId).filter(Boolean))];
  // 一部の要素だけが選ばれているグループからは、その要素を抜き出す
  const removed = oldGroups.filter((gid) => groupMembers(gid).every((m) => ids.includes(m.id)));
  const lost = stepsOf(removed);
  if (lost.length && !confirm(`選択の中のグループ（${removed.map((gid) => findGroup(gid).var).join(", ")}）は新しいグループにまとめ直すため、そのグループのステップ ${lost.length} 個は削除されます。続けますか？`)) return;
  dropStepsOf(slide, removed);
  const group = { id: uid("g"), var: uniqueVar("group") };
  slideGroups(slide).push(group);
  for (const id of ids) findElement(id).groupId = group.id;
  store.enteredGroup = null;
  afterOrderChange(); // 要素を連続させ、要素の無くなったグループを消す
  select(group.id);
  return group;
}

/** グループを解除する（中の要素は残し、すべて選んだ状態にする）。 */
export function ungroup(gid = store.selectedId) {
  const slide = currentSlide();
  const group = findGroup(gid);
  if (!group) {
    const el = findElement(gid);
    if (el?.groupId) return ungroup(el.groupId);
    return;
  }
  const steps = stepsOf([gid]);
  if (steps.length && !confirm(`グループ「${group.var}」を解除しますか？（グループのステップ ${steps.length} 個は削除されます。中の要素のステップは残ります）`)) return;
  dropStepsOf(slide, [gid]);
  const ids = groupMembers(gid).map((e) => e.id);
  for (const id of ids) delete findElement(id).groupId;
  store.enteredGroup = null;
  afterOrderChange();
  selectMany(ids);
}
