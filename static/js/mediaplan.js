// 動画・音声（発表で再生）の状態の計算。発表ウィンドウ（app/present_media.py）と同じ決まり。
// plan = { segments: [区切りごとのスライドの番号], durations: [秒], media: {id: 設定}, cues: [[区切り, 秒, id, 操作, 値]] }

const end = (spec) => Number(spec.trimEnd || spec.duration || 0);
const start = (spec) => Number(spec.trimStart || 0);

export function initialState(spec) {
  return { visible: false, playing: false, pos: start(spec), volume: Number(spec.volume ?? 1), active: false };
}

export function onSlide(spec, slide) {
  const own = Number(spec.slide || 0);
  if (slide === own) return true;
  if (spec.kind === "audio" && spec.across && slide > own) return spec.acrossUntil == null || slide <= Number(spec.acrossUntil);
  return false;
}

export function enterSlide(spec, st, slide) {
  if (!onSlide(spec, slide)) { Object.assign(st, { playing: false, visible: false, active: false, pos: start(spec) }); return; }
  if (slide === Number(spec.slide || 0)) {
    Object.assign(st, { active: true, playing: false, pos: start(spec), volume: Number(spec.volume ?? 1), visible: spec.visible !== false && !spec.hideIdle });
  }
}

export function applyCue(spec, st, action, value) {
  if (action === "play") {
    if (end(spec) && st.pos >= end(spec) - 1e-3) st.pos = start(spec);
    Object.assign(st, { playing: true, visible: true });
  } else if (action === "pause") {
    st.playing = false;
    if (spec.hideIdle) st.visible = false;
  } else if (action === "stop") {
    Object.assign(st, { playing: false, pos: start(spec) });
    if (spec.hideIdle) st.visible = false;
  } else if (action === "seek") st.pos = Math.max(start(spec), Number(value) || 0);
  else if (action === "volume") st.volume = Math.min(1, Math.max(0, Number(value) || 0));
  else if (action === "show") st.visible = true;
  else if (action === "hide") st.visible = false;
}

export function finish(spec, st) {
  st.playing = false;
  st.pos = spec.after === "rewind" ? start(spec) : end(spec);
  if (spec.after === "hide" || spec.hideIdle) st.visible = false;
}

export function advance(spec, st, dt) {
  if (!st.playing || dt <= 0) return;
  const s = start(spec), e = end(spec);
  st.pos += dt;
  if (e && st.pos >= e) {
    if (spec.loop && e > s) st.pos = s + ((st.pos - s) % (e - s));
    else finish(spec, st);
  }
}

/** 区切り seg の始まりの時点の状態。 */
export function stateAt(plan, seg) {
  const media = plan?.media ?? {}, segs = plan?.segments ?? [], durs = plan?.durations ?? [], cues = plan?.cues ?? [];
  const states = Object.fromEntries(Object.entries(media).map(([id, spec]) => [id, initialState(spec)]));
  let prev = null;
  for (let j = 0; j <= seg; j++) {
    const slide = segs[j] ?? segs.at(-1) ?? 0;
    if (slide !== prev) { for (const [id, spec] of Object.entries(media)) enterSlide(spec, states[id], slide); prev = slide; }
    if (j === seg) break;
    let t = 0;
    for (const c of cues.filter((x) => x[0] === j)) {
      for (const [id, spec] of Object.entries(media)) advance(spec, states[id], c[1] - t);
      t = c[1];
      if (media[c[2]]) applyCue(media[c[2]], states[c[2]], c[3], c[4]);
    }
    const dur = durs[j] ?? t;
    for (const [id, spec] of Object.entries(media)) advance(spec, states[id], Math.max(0, dur - t));
  }
  return states;
}
