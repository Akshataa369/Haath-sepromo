// Organiser page: record hand-pose samples for the fixed ISL curriculum.
import { api, uploadClip, getPref, setPref, toast } from "./data.js";
import { features, Recognizer, Smoother, HoldTimer, FEAT_LEN, READY_SAMPLES } from "./recognizer.js";
import { Tracker, sounds } from "./camera.js";
import { UNITS, ALL_SIGNS, signById } from "./lessons.js";
import { BUILTIN as SIGN_DATA } from "./builtin-signs.js";
import { EXPRESSIONS } from "./builtin-expressions.js";
const BUILTIN = { ...SIGN_DATA, ...EXPRESSIONS };

const $ = s => document.querySelector(s);
let pin = sessionStorage.getItem("haath-se:pin") || "";
let byName = getPref("organiser", "");
let stats = {};
const recog = new Recognizer();
const smoother = new Smoother();
const hold = new HoldTimer();
let tolerance = getPref("tol", 2);
let rec = null;
const armed = {};

// ---------- PIN gate ----------
$("#byName").value = byName;
$("#pinForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#pinError").textContent = "";
  const p = $("#pin").value.trim();
  try {
    await api("/setup/check", { method: "POST", pin: p });
    pin = p; sessionStorage.setItem("haath-se:pin", p);
    byName = $("#byName").value.trim(); setPref("organiser", byName);
    unlock();
  } catch (err) { $("#pinError").textContent = err.message; }
});
async function unlock() {
  $("#pinCard").hidden = true; $("#app").hidden = false;
  await load();
}
if (pin) {
  api("/setup/check", { method: "POST", pin }).then(unlock).catch(() => { pin = ""; sessionStorage.removeItem("haath-se:pin"); });
}

// ---------- data ----------
async function load() {
  try {
    const [s, samples] = await Promise.all([api("/signs"), api("/samples")]);
    stats = s; recog.load(samples, BUILTIN);
  } catch (e) { toast(e.message); }
  render();
}

// ---------- camera ----------
const tracker = new Tracker({
  stage: $("#stage"), video: $("#video"), overlay: $("#overlay"), gate: $("#camGate"),
  status: $("#camStatus"), startBtn: $("#startCam"), handsChip: $("#handsChip"),
}, { onFrame });

function onFrame(res, now) {
  const f = features(res, tracker.aspect);
  const p = recog.analyze(f, tolerance);
  const id = smoother.push(p && p.id);
  hold.update(id, now);
  const conf = id && p && p.id === id ? Math.round(p.conf * 100) : 0;
  $("#confFill").style.width = conf + "%"; $("#confVal").textContent = conf + "%";
  $("#seen").textContent = id ? signById(id).label : "–";
  $("#nearVal").textContent = p ? p.near.toFixed(2) : "–";
  if (rec && rec.phase === "rec") capture(f, now);
}

// ---------- list ----------
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
// Numbers and letters are built in, so setup opens on the expressions your team records.
let setupUnit = getPref("setupUnit", "expressions");
function render() {
  const tabs = $("#setupUnits"); tabs.replaceChildren();
  for (const u of UNITS) {
    const done = u.signs.filter(s => BUILTIN[s.id] || (stats[s.id]?.sample_count || 0) >= READY_SAMPLES).length;
    const b = el("button", "unit");
    b.setAttribute("aria-pressed", String(u.id === setupUnit));
    b.append(el("strong", "", u.title), el("span", "", `${done} of ${u.signs.length} ready`));
    b.addEventListener("click", () => { setupUnit = u.id; setPref("setupUnit", u.id); render(); });
    tabs.append(b);
  }
  const u = UNITS.find(x => x.id === setupUnit) || UNITS[0];
  const box = $("#signGroups"); box.replaceChildren();
  const note = u.signs.every(s => BUILTIN[s.id])
    ? `${u.title} are built in and already checked by the camera. Recording here is optional and adds your team's hands as extra examples.`
    : `Record each ${u.title.toLowerCase().replace(/s$/, "")} below: a demo clip learners copy, then the hand shape the camera checks.`;
  const list = el("div", "signs");
  for (const s of u.signs) list.append(row(s));
  box.append(el("p", "note", note), list);
}
function row(s) {
  const st = stats[s.id] || { sample_count: 0, recorded_by: [], ref_image: null };
  const n = st.sample_count;
  const r = el("div", "sign-row");
  const th = el("div", "thumb");
  if (st.ref_image) { const img = new Image(); img.src = st.ref_image; img.alt = ""; th.append(img); } else th.textContent = s.label;
  const mid = el("div");
  const sub = el("div", "sign-sub");
  if (BUILTIN[s.id]) sub.append(el("span", "pill ready", "Built in"));
  sub.append(
    el("span", "pill " + (st.clip_url ? "ready" : "none"), st.clip_url ? "Demo clip" : "No clip"),
    el("span", "pill " + (n === 0 ? "none" : n < 60 ? "some" : "ready"), n === 0 ? "No hand shape" : n < 60 ? "Needs more" : "Ready"),
    el("span", "", `${n} samples`),
  );
  if (st.recorded_by.length) sub.append(el("span", "", "by " + st.recorded_by.join(", ")));
  mid.append(el("div", "sign-name", s.name), sub);
  const act = el("div", "sign-actions");
  const clipBtn = el("button", "btn small", st.clip_url ? "Redo clip" : "1. Demo clip");
  clipBtn.disabled = !!rec;
  clipBtn.addEventListener("click", () => startClip(s.id));
  const recBtn = el("button", "btn small primary", "2. Hand shape");
  recBtn.disabled = !!rec;
  recBtn.addEventListener("click", () => startRecord(s.id));
  act.append(clipBtn);
  const clr = el("button", "btn small danger" + (armed["clear:" + s.id] ? " armed" : ""), armed["clear:" + s.id] ? "Click again to clear" : "Clear");
  clr.disabled = n === 0 || !!rec;
  clr.addEventListener("click", () => clearSign(s));
  act.append(recBtn, clr);
  r.append(th, mid, act);
  return r;
}

async function clearSign(s) {
  const key = "clear:" + s.id;
  if (!armed[key]) {
    armed[key] = true; render();
    setTimeout(() => { if (armed[key]) { delete armed[key]; render(); } }, 3000);
    return;
  }
  delete armed[key];
  try { await api(`/signs/${s.id}`, { method: "DELETE", pin }); toast(`Cleared ${s.name}.`); }
  catch (e) { toast(e.message); }
  load();
}

// ---------- recording ----------
// Shows 3-2-1 over the camera, then calls go().
function countdown(r, msg, go) {
  const cd = $("#countdown"); cd.hidden = false; cd.classList.remove("rec");
  $("#cdMsg").textContent = msg;
  let n = 3; $("#cdNum").textContent = n; sounds.tick();
  r.timer = setInterval(() => {
    n--;
    if (n > 0) { $("#cdNum").textContent = n; sounds.tick(); return; }
    clearInterval(r.timer);
    cd.classList.add("rec"); sounds.go();
    go();
  }, 800);
}

// Step 1: a short demo video learners will copy (can include movement).
function startClip(id) {
  if (!tracker.running) { toast("Start the camera first."); return; }
  const s = signById(id);
  rec = { id, phase: "clip" };
  render();
  countdown(rec, `Demo clip: show ${s.name} the way ISLRTC does`, async () => {
    $("#cdNum").textContent = "Sign"; $("#cdMsg").textContent = "Recording the demo clip… do the full sign";
    let blob = null, snap = null;
    setTimeout(() => { try { snap = tracker.snapshot(); } catch (e) {} }, 1200);
    try { blob = await tracker.recordClip(3000); }
    catch (e) { toast(e.message || "Couldn't record the clip."); }
    $("#countdown").hidden = true;
    rec = null;
    if (blob && blob.size) {
      try {
        await uploadClip(id, blob, pin);
        if (snap && !(stats[id] && stats[id].ref_image)) await api(`/signs/${id}/ref`, { method: "PUT", pin, body: { ref_image: snap } });
        sounds.ding(); toast(`Saved the demo clip for ${s.name}. Now record its hand shape.`);
      } catch (e) { toast(e.message); }
    }
    load();
  });
}

// Step 2: hand-shape samples the camera uses to check learners.
function startRecord(id) {
  if (!tracker.running) { toast("Start the camera first."); return; }
  const s = signById(id);
  rec = { id, phase: "count", vectors: [], last: 0, snap: null };
  render();
  countdown(rec, `Hand shape: hold the main shape of ${s.name}`, () => {
    rec.phase = "rec"; rec.until = performance.now() + 3000;
    $("#cdNum").textContent = "Hold"; $("#cdMsg").textContent = "Recording… move your hands slightly";
  });
}
function capture(f, now) {
  if (now > rec.until || rec.vectors.length >= 45) { finishRecord(); return; }
  if (!f || now - rec.last < 60) return;
  rec.vectors.push(f.map(x => Math.round(x * 1000) / 1000));
  rec.last = now;
  $("#cdMsg").textContent = `Recording… ${rec.vectors.length} samples`;
  if (rec.vectors.length === 12) rec.snap = tracker.snapshot();
}
async function finishRecord() {
  const r = rec; rec = null;
  clearInterval(r.timer);
  $("#countdown").hidden = true;
  const s = signById(r.id);
  if (r.vectors.length < 10) {
    toast(`Only ${r.vectors.length} samples. Keep your hands in view and try again.`);
    render(); return;
  }
  try {
    await api("/samples", { method: "POST", pin, body: { sign_id: r.id, recorded_by: byName, vectors: r.vectors } });
    const hasRef = !!(stats[r.id] && stats[r.id].ref_image);
    if (r.snap && (!hasRef || $("#replacePhoto").checked)) {
      await api(`/signs/${r.id}/ref`, { method: "PUT", pin, body: { ref_image: r.snap } });
      $("#replacePhoto").checked = false;
    }
    sounds.ding();
    toast(`Saved ${r.vectors.length} samples for ${s.name}.`);
  } catch (e) {
    toast(e.status === 0 ? "Couldn't reach the server. Your recording wasn't saved, try again." : e.message);
  }
  load();
}

// ---------- settings ----------
$("#tol").value = tolerance; $("#tolVal").textContent = Number(tolerance).toFixed(1);
$("#tol").addEventListener("input", e => { tolerance = Number(e.target.value); $("#tolVal").textContent = tolerance.toFixed(1); setPref("tol", tolerance); });

// ---------- export / import ----------
$("#exportBtn").addEventListener("click", () => {
  const signs = ALL_SIGNS.map(s => ({ id: s.id, label: s.label, hint: s.name, ref: stats[s.id]?.ref_image || null }));
  const samples = {};
  for (const s of ALL_SIGNS) if (recog.bySign[s.id]) samples[s.id] = recog.bySign[s.id];
  const blob = new Blob([JSON.stringify({ app: "haath-se", version: 2, signs, samples })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "haath-se-sign-pack.json";
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Exported haath-se-sign-pack.json");
});

$("#importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); if (!Array.isArray(data.signs) || typeof data.samples !== "object") throw 0; }
  catch (err) { toast("That file isn't a Haath Se sign pack."); return; }
  let added = 0, skipped = 0;
  toast("Importing…");
  try {
    for (const src of data.signs) {
      const target = ALL_SIGNS.find(s => s.label.toLowerCase() === String(src.label).trim().toLowerCase());
      const vecs = (data.samples[src.id] || []).filter(v => Array.isArray(v) && v.length === FEAT_LEN);
      if (!target) { if (vecs.length) skipped++; continue; }
      for (let i = 0; i < vecs.length; i += 60) {
        await api("/samples", { method: "POST", pin, body: { sign_id: target.id, recorded_by: byName || "import", vectors: vecs.slice(i, i + 60) } });
        added += Math.min(60, vecs.length - i);
      }
      if (src.ref && !(stats[target.id] && stats[target.id].ref_image)) {
        try { await api(`/signs/${target.id}/ref`, { method: "PUT", pin, body: { ref_image: src.ref } }); } catch (err) {}
      }
    }
    toast(`Imported ${added} samples` + (skipped ? `. Skipped ${skipped} signs that aren't in the curriculum.` : "."));
  } catch (err) { toast(`Stopped after ${added} samples: ${err.message}`); }
  load();
});
