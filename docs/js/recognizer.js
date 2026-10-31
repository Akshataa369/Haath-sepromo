// Turning hand landmarks into numbers, and matching them to known signs.

export const FEAT_LEN = 129;
export const READY_SAMPLES = 10; // a team-recorded sign needs this many samples before the camera checks it

// 63 numbers per hand: every point relative to the wrist, scaled by hand size,
// so it doesn't matter how near or far the hand is from the camera.
// `aspect` (width / height) keeps proportions true on non-square video.
function handVec(lm, aspect) {
  const w = lm[0];
  let s = 0;
  for (const p of lm) s = Math.max(s, Math.hypot((p.x - w.x) * aspect, p.y - w.y));
  s = s || 1;
  const v = [];
  for (const p of lm) v.push((p.x - w.x) * aspect / s, (p.y - w.y) / s, (p.z - w.z) / s);
  return { v, s };
}

// 129 numbers: hand A (63) + hand B (63) + where B's wrist is relative to A's (3).
// One hand: hand A + 66 zeros. No hands: null.
export function features(res, aspect = 1) {
  let L = (res && res.landmarks) || [];
  if (!L.length) return null;
  // A hand resting at the bottom edge while the other one signs isn't part of the sign.
  if (L.length === 2) {
    const [lo, hi] = L[0][0].y > L[1][0].y ? [L[0], L[1]] : [L[1], L[0]];
    if (lo[0].y > 0.88 && lo[0].y - hi[0].y > 0.3) L = [hi];
  }
  const hands = [...L].sort((a, b) => a[0].x - b[0].x);
  const h0 = handVec(hands[0], aspect);
  const f = h0.v.slice();
  if (hands[1]) {
    f.push(...handVec(hands[1], aspect).v);
    f.push((hands[1][0].x - hands[0][0].x) * aspect / h0.s, (hands[1][0].y - hands[0][0].y) / h0.s, 2);
  } else {
    for (let i = 0; i < 66; i++) f.push(0);
  }
  return f;
}

// Depth (z) from a webcam is a rough estimate and differs a lot between people and cameras,
// so it counts for less than the x/y shape of the hand.
const Z_WEIGHT = 0.3;
const WEIGHTS = Array.from({ length: FEAT_LEN }, (_, i) => (i < 126 && i % 3 === 2 ? Z_WEIGHT * Z_WEIGHT : 1));
function dist(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; d += WEIGHTS[i] * x * x; }
  return Math.sqrt(d);
}

// K-nearest-neighbours over built-in examples plus anything the team recorded.
export class Recognizer {
  constructor() { this.bySign = {}; this.builtin = {}; this.points = []; }

  // samples: [{sign_id, vector}] recorded by the team; builtin: { id: { vectors: [...] } }
  load(samples, builtin = {}) {
    this.bySign = {};
    this.builtin = {};
    for (const s of samples || []) {
      if (!s || !Array.isArray(s.vector) || s.vector.length !== FEAT_LEN) continue;
      (this.bySign[s.sign_id] ||= []).push(s.vector);
    }
    this.points = [];
    for (const id in this.bySign) {
      if (this.bySign[id].length < 5) continue;
      for (const v of this.bySign[id]) this.points.push([v, id]);
    }
    for (const id in builtin) {
      this.builtin[id] = true;
      for (const v of builtin[id].vectors) if (v.length === FEAT_LEN) this.points.push([v, id]);
    }
  }

  count(id) { return (this.bySign[id] || []).length; }
  isBuiltin(id) { return !!this.builtin[id]; }
  ready(id) { return this.isBuiltin(id) || this.count(id) >= READY_SAMPLES; }

  // One pass over every example: the overall best guess plus the closest distance to each sign.
  analyze(f, tolerance) {
    if (!f || !this.points.length) return null;
    const all = this.points.map(([v, id]) => [dist(f, v), id]);
    const near = {};
    for (const [d, id] of all) if (near[id] === undefined || d < near[id]) near[id] = d;
    all.sort((a, b) => a[0] - b[0]);
    const k = Math.min(7, all.length), votes = {};
    for (let i = 0; i < k; i++) votes[all[i][1]] = (votes[all[i][1]] || 0) + 1;
    let id = null, n = 0;
    for (const key in votes) if (votes[key] > n) { n = votes[key]; id = key; }
    const best = all[0][0];
    const ok = best <= tolerance && n / k >= 0.6;
    return { id: ok ? id : null, conf: ok ? (n / k) * (1 - 0.5 * best / tolerance) : 0, near: best, nearBy: near, tolerance };
  }

  // Is the learner close enough to a specific target sign? Forgiving for look-alike pairs
  // (2 and V, H and M): the target only has to be about as close as the best match.
  matches(a, id) {
    if (!a || a.nearBy[id] === undefined) return { ok: false, conf: 0 };
    const d = a.nearBy[id];
    const ok = d <= a.tolerance && d <= a.near * 1.35 + 0.08;
    return { ok, conf: ok ? Math.max(0.05, 1 - 0.6 * d / a.tolerance) : Math.max(0, 0.6 - d / (a.tolerance * 2)) };
  }
}

// A label (or true/false) only counts when it wins 4 of the last 7 frames.
export class Smoother {
  constructor(size = 7, need = 4) { this.size = size; this.need = need; this.hist = []; }
  push(id) {
    this.hist.push(id || null);
    if (this.hist.length > this.size) this.hist.shift();
    const c = {}; let best = null, n = 0;
    for (const l of this.hist) if (l) c[l] = (c[l] || 0) + 1;
    for (const k in c) if (c[k] > n) { n = c[k]; best = k; }
    return n >= this.need ? best : null;
  }
  reset() { this.hist = []; }
}

// How long the same thing has been held, in ms.
export class HoldTimer {
  constructor() { this.id = null; this.since = 0; }
  update(id, now) { if (id !== this.id) { this.id = id; this.since = now; } return id ? now - this.since : 0; }
  reset(now) { this.since = now; }
}
