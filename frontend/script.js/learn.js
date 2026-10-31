// Learner page: rights first, then Learn / Practice / Sign Rush.
import { api, getPref, setPref, toast } from "./data.js";
import { features, Recognizer, Smoother, HoldTimer } from "./recognizer.js";
import { Tracker, sounds, setSound, setRing, bump, themeColor } from "./camera.js";
import { UNITS, ALL_SIGNS, signById, LAWS, LAW_SOURCES, FACTS, ISLRTC_URL } from "./lessons.js";
import { BUILTIN as SIGN_DATA } from "./builtin-signs.js";
import { EXPRESSIONS } from "./builtin-expressions.js";
import { GUIDE } from "./sign-guide.js";
const BUILTIN = { ...SIGN_DATA, ...EXPRESSIONS };

const $ = s => document.querySelector(s);
const nickname = getPref("nickname", "") || "Guest";
$("#who").textContent = nickname;

// ---------- state ----------
const recog = new Recognizer();
const smoother = new Smoother();
let refs = {};                                   // sign id -> reference photo
let clips = {};                                  // sign id -> demo clip URL
let lastHands = 0;
let tolerance = getPref("tol", 2);
let learned = getPref("learned", {});            // sign id -> true
let view = "learn";
const ready = id => recog.ready(id);
const readySigns = () => ALL_SIGNS.filter(s => ready(s.id));
const learnedCount = () => Object.keys(learned).length;

// ---------- server data ----------
async function loadData(quiet) {
  try {
    const [stats, samples] = await Promise.all([api("/signs"), api("/samples")]);
    refs = {}; clips = {};
    for (const id in stats) {
      if (stats[id].ref_image) refs[id] = stats[id].ref_image;
      if (stats[id].clip_url) clips[id] = stats[id].clip_url;
    }
    recog.load(samples, BUILTIN);
  } catch (e) {
    recog.load([], BUILTIN);
    if (!quiet) toast("Couldn't reach the server. Built-in signs still work.");
  }
  if (view === "learn") renderLearn();
  if (view === "practice") renderPractice();
  if (view === "rush") renderRush();
}
setInterval(() => { if (!rush.running && !prac.running) loadData(true); }, 60000);

// ---------- sound toggle ----------
let soundOn = getPref("sound", true);
function paintSound() {
  setSound(soundOn);
  $("#soundBtn").textContent = soundOn ? "Sound on" : "Sound off";
  $("#soundBtn").setAttribute("aria-pressed", String(soundOn));
}
$("#soundBtn").addEventListener("click", () => { soundOn = !soundOn; setPref("sound", soundOn); paintSound(); });
paintSound();

// ---------- camera ----------
const tracker = new Tracker({
  stage: $("#stage"), video: $("#video"), overlay: $("#overlay"), gate: $("#camGate"),
  status: $("#camStatus"), startBtn: $("#startCam"), handsChip: $("#handsChip"),
}, { onFrame, onTick });

// ---------- confetti ----------
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const cc = $("#confetti"), cctx = cc.getContext("2d");
let parts = [], confettiOn = false;
function confetti(fromEl) {
  if (reduceMotion) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  cc.width = innerWidth * dpr; cc.height = innerHeight * dpr; cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = fromEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cols = [themeColor("primary"), themeColor("accent"), themeColor("ok"), "#ffffff"];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
    parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, s: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length], life: 1 });
  }
  if (!confettiOn) { confettiOn = true; requestAnimationFrame(stepConfetti); }
}
function stepConfetti() {
  cctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of parts) {
    p.vy += 0.25; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.012;
    cctx.save(); cctx.globalAlpha = Math.max(0, p.life); cctx.translate(p.x, p.y); cctx.rotate(p.rot);
    cctx.fillStyle = p.c; cctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cctx.restore();
  }
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 20);
  if (parts.length) requestAnimationFrame(stepConfetti); else { confettiOn = false; cctx.clearRect(0, 0, innerWidth, innerHeight); }
}

let lastSeen = "", lastConf = -1, lastStage = "", lastTarget = null;
const targetSmooth = new Smoother(), targetHold = new HoldTimer();
const rushSmooth = new Smoother(), rushHold = new HoldTimer();
let showGuide = getPref("guide", true);

function currentTarget() {
  if (view === "learn") return current().id;
  if (view === "practice" && prac.running) return prac.target.id;
  return null;
}

function onFrame(res, now) {
  const a = recog.analyze(features(res, tracker.aspect), tolerance);
  const id = smoother.push(a && a.id);
  const hands = (res.landmarks || []).length;
  lastHands = hands;

  // Is the learner making the sign they're being asked for?
  const target = currentTarget();
  if (target !== lastTarget) { targetSmooth.reset(); lastTarget = target; }
  let tOk = false, tConf = 0;
  if (target && a) { const m = recog.matches(a, target); tConf = m.conf; tOk = targetSmooth.push(m.ok ? "y" : null) === "y"; }
  else if (target) targetSmooth.push(null);
  const tMs = targetHold.update(tOk ? target : null, now);

  // In Sign Rush: which bubble on screen (if any) is being signed?
  let rushId = null;
  if (view === "rush" && rush.running && a) {
    let bd = Infinity;
    for (const bid of new Set(rush.bubbles.map(b => b.id))) {
      const m = recog.matches(a, bid);
      if (m.ok && a.nearBy[bid] < bd) { bd = a.nearBy[bid]; rushId = bid; }
    }
  }
  rushId = view === "rush" ? rushSmooth.push(rushId) : null;
  const rMs = rushHold.update(rushId, now);

  const matching = target ? tOk : !!rushId;
  const stageState = matching ? "match" : hands ? "live" : "";
  if (stageState !== lastStage) {
    $("#stage").classList.toggle("live", stageState === "live");
    $("#stage").classList.toggle("match", stageState === "match");
    lastStage = stageState;
  }
  const conf = Math.round((target ? tConf : a ? a.conf : 0) * 100);
  if (conf !== lastConf) { lastConf = conf; $("#confFill").style.width = conf + "%"; $("#confVal").textContent = conf + "%"; }
  const seen = id ? signById(id).label : "–";
  if (seen !== lastSeen) { lastSeen = seen; $("#seen").textContent = seen; }

  // Dashed guide of the target sign, lined up with the learner's hand.
  if (showGuide && view === "learn" && BUILTIN[target]) tracker.drawGuide(BUILTIN[target].skeleton, res, tOk);

  if (view === "learn") learnCheck(tOk, tMs, now);
  if (view === "practice") practiceCheck(tOk, tMs, now);
  if (view === "rush") rushCheck(rushId, rMs, now);
}
let started = false;
function onTick(now) {
  if (!started) { started = true; if (view === "learn") renderLearn(); }
  if (view === "practice" && prac.running) $("#pracTime").textContent = ((now - prac.start) / 1000).toFixed(1);
  if (rush.running) rushTick(now);
}

// ---------- views ----------
function setView(v) {
  if (rush.running && v !== "rush") stopRush("");
  if (prac.running && v !== "practice") stopPractice();
  view = v;
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === v)));
  const rights = v === "rights";
  $("#rightsView").hidden = !rights;
  $("#app").hidden = rights;
  document.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== v; });
  $("#stage").classList.toggle("dim", v === "rush");
  $("#game").hidden = v !== "rush";
  if (v === "learn") renderLearn();
  if (v === "practice") renderPractice();
  if (v === "rush") { renderRush(); loadBoard(); sizeGame(); }
  if (v === "rights") renderRights();
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setView(t.dataset.view)));
document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) setView(g.dataset.goto); });

// ---------- rights + awareness ----------
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function renderLaws() {
  const list = $("#lawList"); list.replaceChildren();
  for (const [i, law] of LAWS.entries()) {
    const li = el("li", "law");
    li.style.setProperty("--i", i);
    const a = el("a", "note", "Read the full text"); a.href = LAW_SOURCES[law.source]; a.target = "_blank"; a.rel = "noopener";
    li.append(el("p", "law-ref", law.ref), el("h3", "", law.title), el("p", "", law.body), a);
    list.append(li);
  }
}
function renderRights() {
  const first = !getPref("rightsRead", false);
  $("#rightsEyebrow").textContent = first ? "Before you begin" : "Your rights";
  $("#beginRow").hidden = !first;
  $("#factsWrap").hidden = first;
  if (first) return;
  const n = Math.min(learnedCount(), FACTS.length);
  $("#factsLede").textContent = n === FACTS.length
    ? "You've unlocked every fact. Share what you learned."
    : `${n} of ${FACTS.length} unlocked. Every sign you learn unlocks one more.`;
  const list = $("#factList"); list.replaceChildren();
  FACTS.forEach((f, i) => {
    const li = el("li", "fact" + (i < n ? "" : " locked"));
    li.style.setProperty("--i", i);
    if (i < n) {
      li.append(el("p", "fact-title", f.title), el("p", "fact-body", f.body));
      if (f.source) { const a = el("a", "note", "Source: " + f.source.label); a.href = f.source.url; a.target = "_blank"; a.rel = "noopener"; li.append(a); }
    } else {
      li.append(el("p", "fact-title", "Locked"), el("p", "fact-body", `Learn ${i + 1 - learnedCount()} more sign${i + 1 - learnedCount() === 1 ? "" : "s"} to unlock.`));
    }
    list.append(li);
  });
}
$("#beginBtn").addEventListener("click", () => { setPref("rightsRead", true); setView("learn"); window.scrollTo({ top: 0 }); });

// ---------- learn ----------
let unitIdx = Math.max(0, UNITS.findIndex(u => u.id === getPref("unit", "numbers")));
let signIdx = 0;
let learnLock = 0;
const unit = () => UNITS[unitIdx];
const current = () => unit().signs[signIdx];

function renderUnitTabs() {
  const box = $("#unitTabs"); box.replaceChildren();
  UNITS.forEach((u, i) => {
    const done = u.signs.filter(s => learned[s.id]).length;
    const b = el("button", "unit");
    b.setAttribute("aria-pressed", String(i === unitIdx));
    b.append(el("strong", "", u.title), el("span", "", `${done} of ${u.signs.length} learned`));
    b.addEventListener("click", () => { unitIdx = i; signIdx = firstUnlearned(); setPref("unit", u.id); renderLearn(); });
    box.append(b);
  });
}
function firstUnlearned() { const i = unit().signs.findIndex(s => !learned[s.id]); return i < 0 ? 0 : i; }

let lastShown = null;
function renderLearn() {
  renderUnitTabs();
  const u = unit(), s = current();
  const total = ALL_SIGNS.length, done = ALL_SIGNS.filter(x => learned[x.id]).length;
  $("#overallNum").textContent = done;
  $("#overallFill").style.width = (done / total * 100).toFixed(1) + "%";
  const changed = lastShown !== s.id;
  if (lastShown && changed) {
    for (const tg of [$(".lesson-top"), $("#copyCard"), $(".how-card")]) { tg.classList.remove("swap"); void tg.offsetWidth; tg.classList.add("swap"); }
  }
  lastShown = s.id;
  $("#unitEyebrow").textContent = `Unit ${unitIdx + 1} · ${u.range}`;
  $("#unitTitle").textContent = u.title;
  $("#unitNote").textContent = u.note;
  const lab = $("#learnLabel"); lab.textContent = s.label; lab.classList.toggle("long", s.label.length > 3);
  $("#learnName").textContent = s.name;
  $("#lessonCount").textContent = `Sign ${signIdx + 1} of ${u.signs.length}` + (learned[s.id] ? " · learned ✓" : "");
  renderHow(s);
  $("#learnIslrtc").href = ISLRTC_URL;
  renderDemo(s, changed);
  const isReady = ready(s.id);
  $("#learnStatus").textContent = isReady
    ? (tracker.running ? "Camera check is on. Copy the sign and hold it for one second." : "Camera check is on for this sign. Start the camera to have it checked.")
    : "Camera check isn't set up for this sign yet. Copy it, then press I've got it.";
  $("#gotIt").hidden = isReady;
  $("#copyCard").classList.remove("done");
  setSteps(0);
  setRing($("#learnRing"), 0);
  $("#learnRingWrap").classList.remove("win");
  const strip = $("#learnStrip"); strip.replaceChildren();
  u.signs.forEach((x, i) => {
    const b = el("button", i === signIdx ? "active" : "", x.label);
    b.setAttribute("aria-label", x.name + (learned[x.id] ? ", learned" : ""));
    if (learned[x.id]) b.append(el("span", "stars", "✓"));
    b.addEventListener("click", () => { signIdx = i; $("#learnFeedback").textContent = ""; renderLearn(); });
    strip.append(b);
  });
  renderFactCard(false);
}

// The "Copy this" card: demo clip if recorded, otherwise photo, otherwise a pointer to ISLRTC.
let demoKey = "";
function renderDemo(s, changed) {
  const box = $("#learnRef");
  const key = s.id + "|" + (clips[s.id] || "") + "|" + (refs[s.id] ? "p" : "");
  if (key === demoKey && !changed) return;
  demoKey = key;
  box.replaceChildren();
  stopDemoAnim();
  const built = BUILTIN[s.id];
  box.classList.toggle("has-media", !!(clips[s.id] || built || refs[s.id]));
  $("#stepWatch").textContent = clips[s.id] ? "Watch the clip" : built && built.anim ? "Watch the animation" : built ? "Watch the hand outline" : refs[s.id] ? "Look at the photo" : "Look it up in Sign Learn";
  $("#demoMode").hidden = !(built && !built.anim && !clips[s.id]);
  if (!clips[s.id] && built && built.anim) {
    // Animated figure: the measured hand movement, played back on a simple body.
    const cv = document.createElement("canvas"); cv.className = "demo-skel";
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", `Animation of the ISL sign for ${s.name}`);
    box.append(cv);
    $("#copyTag").textContent = "Copy this";
    startFigureAnim(cv, built.anim);
  } else if (!clips[s.id] && built) {
    // Built-in picture of the sign with an animated hand outline drawn over it.
    const img = new Image(); img.className = "builtin"; img.src = `/static/img/signs/${s.id}.jpg`; img.alt = `Picture of the ISL sign for ${s.name}`;
    const cv = document.createElement("canvas"); cv.className = "demo-skel";
    box.append(img, cv);
    $("#copyTag").textContent = "Copy this";
    startDemoAnim(cv, img, built.skeleton);
  } else if (clips[s.id]) {
    const v = document.createElement("video");
    v.src = clips[s.id]; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("aria-label", `Demo of the ISL sign for ${s.name}`);
    if (refs[s.id]) v.poster = refs[s.id];
    box.append(v);
    v.play().catch(() => {});
    $("#copyTag").textContent = "Copy this";
  } else if (refs[s.id]) {
    const img = new Image(); img.src = refs[s.id]; img.alt = `Photo of the ISL sign for ${s.name}`;
    box.append(img);
    $("#copyTag").textContent = "Copy this";
  } else {
    box.append(el("span", "big-label", s.label));
    const p = el("p", "", "No demo recorded for this sign yet. Look it up in ISLRTC's Sign Learn app or ");
    const a = el("a", "", "dictionary"); a.href = ISLRTC_URL; a.target = "_blank"; a.rel = "noopener";
    p.append(a, document.createTextNode(", then copy it."));
    box.append(p);
    $("#copyTag").textContent = "Look it up";
  }
}

// ---------- animated hand outline over the built-in picture ----------
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
// Finger order for the "drawing in" animation: palm first, then thumb to little finger.
const BONE_ORDER = [[0,1],[0,5],[5,9],[9,13],[13,17],[0,17],[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],[13,14],[14,15],[15,16],[17,18],[18,19],[19,20]];
let demoRaf = 0, demoMode = getPref("demoMode", "both");   // "both" = picture + outline, "outline" = outline only
function stopDemoAnim() { cancelAnimationFrame(demoRaf); demoRaf = 0; }
function startDemoAnim(cv, img, skel) {
  const ctx = cv.getContext("2d");
  const t0 = performance.now();
  const frame = now => {
    const box = cv.parentElement;
    if (!box || !box.isConnected) return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    img.style.opacity = demoMode === "outline" ? "0.12" : "1";
    // The picture is square and centred in the card (object-fit: contain): map 0..1 onto that square.
    const side = Math.min(w, h), ox = (w - side) / 2, oy = (h - side) / 2;
    const P = p => [ox + p[0] * side, oy + p[1] * side];
    const cycle = 3.2, t = (Math.max(0, now - t0) / 1000) % cycle;
    const grow = reduceMotionDemo ? 1 : Math.min(1, t / 1.3);               // bones draw in over 1.3 s
    const fade = reduceMotionDemo ? 1 : t > 2.8 ? 1 - (t - 2.8) / 0.4 : 1;
    const pulse = 0.55 + 0.45 * Math.sin(now / 260);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    skel.forEach((hand, hi) => {
      const col = hi ? "255,194,58" : "59,191,181";
      const n = BONE_ORDER.length, shown = grow * n;
      ctx.shadowColor = `rgba(${col},0.9)`; ctx.shadowBlur = 12;
      ctx.strokeStyle = `rgba(${col},${0.95 * fade})`; ctx.lineWidth = Math.max(3, side * 0.012);
      BONE_ORDER.forEach(([a, b], i) => {
        if (i >= shown) return;
        const part = Math.min(1, shown - i);
        const [x1, y1] = P(hand[a]), [x2, y2] = P(hand[b]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + (x2 - x1) * part, y1 + (y2 - y1) * part); ctx.stroke();
      });
      ctx.shadowBlur = 0;
      if (grow >= 1) {
        [4, 8, 12, 16, 20].forEach(i => {
          const [x, y] = P(hand[i]);
          ctx.beginPath(); ctx.arc(x, y, side * 0.014 * (0.8 + 0.4 * pulse), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${fade})`; ctx.fill();
        });
      }
    });
    demoRaf = requestAnimationFrame(frame);
  };
  demoRaf = requestAnimationFrame(frame);
}
const reduceMotionDemo = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- animated figure for expressions ----------
// anim.frames[i] = [handA, handB]; each hand is 21 [x, y] points in units of the clip height.
// The figure is mirrored so it moves like your reflection in the camera.
function startFigureAnim(cv, anim) {
  const ctx = cv.getContext("2d");
  const t0 = performance.now();
  const N = anim.frames.length, SLOW = 0.6, HOLD = 0.9;          // play at 60% speed, then hold the last pose
  const playLen = N / anim.fps / SLOW, cycle = playLen + HOLD;
  const B = anim.body, W0 = anim.aspect;
  const elbow = (S, Wr, side) => {
    // Two equal arm segments: put the elbow out to the side and down, like a real arm.
    const L = 0.21, dx = Wr[0] - S[0], dy = Wr[1] - S[1], d = Math.hypot(dx, dy) || 1e-6;
    if (d >= 2 * L) return [S[0] + dx / 2, S[1] + dy / 2];
    const h = Math.sqrt(L * L - (d / 2) * (d / 2));
    let px = -dy / d, py = dx / d;                                  // perpendicular
    if (px * side < 0 || (Math.abs(px) < 0.2 && py < 0)) { px = -px; py = -py; }
    return [S[0] + dx / 2 + px * h, S[1] + dy / 2 + py * h];
  };
  const frame = now => {
    const box = cv.parentElement;
    if (!box || !box.isConnected) return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = reduceMotionDemo ? playLen : (Math.max(0, now - t0) / 1000) % cycle;   // rAF time can be slightly before t0
    const fi = Math.max(0, Math.min(N - 1, Math.floor(t * anim.fps * SLOW)));
    const fr = anim.frames[fi] || anim.frames[0];
    // Fit the figure (W0 wide, 1 tall) into the card, centred, a little zoomed on the upper body.
    const sc = h * 1.0, ox = (w - W0 * sc) / 2 - w * 0.12, oy = h * 0.0;
    const P = p => [ox + (W0 - p[0]) * sc, oy + p[1] * sc];          // mirrored
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // body
    const [hx, hy] = P(B.head), head = sc * 0.12;
    ctx.fillStyle = "rgba(242,247,246,0.08)"; ctx.strokeStyle = "rgba(201,216,213,0.75)"; ctx.lineWidth = Math.max(2, sc * 0.008);
    ctx.beginPath(); ctx.arc(hx, hy, head, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    const [nx, ny] = P(B.neck), [lx, ly] = P(B.sl), [rx, ry] = P(B.sr), [ax, ay] = P(B.hl), [bx, by] = P(B.hr);
    ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.lineTo(bx, by); ctx.lineTo(ax, ay); ctx.closePath();
    ctx.fillStyle = "rgba(242,247,246,0.06)"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx, hy + head); ctx.lineTo(nx, ny); ctx.stroke();
    // arms: shoulder -> elbow -> wrist of each hand (slot 0 is the avatar's side nearest shoulder "sl")
    [[B.sl, fr[0], -1], [B.sr, fr[1], 1]].forEach(([S, hand, side]) => {
      if (!hand) return;
      const E = elbow(S, hand[0], side);
      ctx.strokeStyle = "rgba(201,216,213,0.75)"; ctx.lineWidth = Math.max(6, sc * 0.028);
      ctx.beginPath(); const a = P(S), e = P(E), wr = P(hand[0]);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(wr[0], wr[1]); ctx.stroke();
    });
    // hands
    fr.forEach((hand, hi) => {
      if (!hand) return;
      const col = hi ? "255,194,58" : "59,191,181";
      const resting = hand[0][1] > 0.78;
      ctx.shadowColor = `rgba(${col},0.9)`; ctx.shadowBlur = resting ? 0 : 10;
      ctx.strokeStyle = `rgba(${col},${resting ? 0.45 : 1})`; ctx.lineWidth = Math.max(2, sc * 0.007);
      ctx.beginPath();
      for (const [a, b] of BONES) { const p = P(hand[a]), q = P(hand[b]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke(); ctx.shadowBlur = 0;
      if (!resting) [4, 8, 12, 16, 20].forEach(i => { const p = P(hand[i]); ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2, sc * 0.006), 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); });
    });
    // close-up of the signing hand(s), so the finger shape is easy to see
    const act = fr.map((hand, hi) => [hand, hi]).filter(([hand]) => hand && hand[0][1] <= 0.78);
    if (act.length) {
      const R = Math.min(w, h) * 0.24, cx = w - R - 14, cy = h - R - 20;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(5,11,11,0.85)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.clip();
      const pts = act.flatMap(([hand]) => hand);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 0.1;
      const z = (R * 1.45) / span;
      const Q = p => [cx - (p[0] - mx) * z, cy + (p[1] - my) * z];          // mirrored, like the figure
      for (const [hand, hi] of act) {
        const col = hi ? "255,194,58" : "59,191,181";
        ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 3; ctx.shadowColor = `rgba(${col},0.8)`; ctx.shadowBlur = 8;
        ctx.beginPath();
        for (const [a, b] of BONES) { const p = Q(hand[a]), q = Q(hand[b]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        ctx.stroke(); ctx.shadowBlur = 0;
        hand.forEach((pt, i) => { const p = Q(pt); ctx.beginPath(); ctx.arc(p[0], p[1], [4, 8, 12, 16, 20].includes(i) ? 3.5 : 2, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); });
      }
      ctx.restore();
      ctx.fillStyle = "rgba(201,216,213,0.85)"; ctx.font = "600 11px Hind, system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("HAND SHAPE", cx, cy - R - 6);
    }
    // progress bar along the bottom
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(16, h - 10, w - 32, 3);
    ctx.fillStyle = "rgba(255,194,58,0.9)"; ctx.fillRect(16, h - 10, (w - 32) * Math.min(1, t / playLen), 3);
    demoRaf = requestAnimationFrame(frame);
  };
  demoRaf = requestAnimationFrame(frame);
}
function paintDemoMode() { document.querySelectorAll("#demoMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === demoMode))); }
document.querySelectorAll("#demoMode button").forEach(b => b.addEventListener("click", () => { demoMode = b.dataset.mode; setPref("demoMode", demoMode); paintDemoMode(); }));
paintDemoMode();
$("#guideToggle").checked = showGuide;
$("#guideToggle").addEventListener("change", e => { showGuide = e.target.checked; setPref("guide", showGuide); });

// "How to sign it": chips (one/two hands, still/moves) and numbered steps.
function renderHow(s) {
  const g = GUIDE[s.id];
  const chips = $("#lessonChips"); chips.replaceChildren();
  const list = $("#howSteps"); list.replaceChildren();
  const card = list.closest(".how-card");
  if (!g) {
    card.hidden = s.id.startsWith("e-") ? false : true;
    list.append(el("li", "", "Look the sign up in ISLRTC's Sign Learn app, copy it, then press I've got it."));
    return;
  }
  card.hidden = false;
  g.chips.forEach(c => chips.append(el("span", "chip-tag " + (c === "Moves" ? "moves" : c === "Two hands" ? "two" : ""), c)));
  g.steps.forEach((t, i) => { const li = el("li", "", t); li.style.setProperty("--i", i); list.append(li); });
}

// 0 = watch, 1 = copy (hands seen), 2 = hold (matching), 3 = done
function setSteps(n) {
  ["#stepWatch", "#stepCopy", "#stepHold"].forEach((sel, i) => {
    const li = $(sel);
    li.classList.toggle("ok", i < n);
    li.classList.toggle("now", i === n);
  });
}

function renderFactCard(isNew) {
  const n = Math.min(learnedCount(), FACTS.length);
  const card = $("#factCard"), src = $("#factSource");
  if (n === 0) {
    $("#factCount").textContent = "Did you know?";
    $("#factTitle").textContent = "Learn your first sign to unlock a fact";
    $("#factBody").textContent = "Every sign you learn reveals something about Deaf people and ISL in India.";
    src.hidden = true; return;
  }
  const f = FACTS[n - 1];
  $("#factCount").textContent = `Did you know? · ${n} of ${FACTS.length}`;
  $("#factTitle").textContent = f.title;
  $("#factBody").textContent = f.body;
  if (f.source) { src.hidden = false; src.textContent = "Source: " + f.source.label; src.href = f.source.url; } else src.hidden = true;
  if (isNew) { card.classList.remove("flip"); void card.offsetWidth; card.classList.add("flip"); }
}

function markLearned(s) {
  const isNew = !learned[s.id];
  learned[s.id] = true; setPref("learned", learned);
  sounds.ding();
  confetti($("#learnRingWrap"));
  const fb = $("#learnFeedback");
  fb.textContent = ["Shabaash!", "Well signed!", "Perfect!", "Bahut badhiya!"][Math.floor(Math.random() * 4)];
  fb.classList.remove("say"); void fb.offsetWidth; fb.classList.add("say");
  if (isNew && learnedCount() <= FACTS.length) { renderFactCard(true); toast("New fact unlocked"); }
  setTimeout(() => {
    signIdx = (signIdx + 1) % unit().signs.length;
    renderLearn();
  }, 800);
  setTimeout(() => { $("#learnFeedback").textContent = ""; }, 1800);
}

function learnCheck(ok, ms, now) {
  const s = current();
  if (now < learnLock) return;
  if (!ready(s.id)) { setSteps(lastHands > 0 ? 1 : 0); return; }
  const prog = ok ? ms / 1000 : 0;
  setRing($("#learnRing"), prog);
  $("#learnRingWrap").classList.toggle("near", prog > 0 && prog < 1);
  setSteps(prog > 0 ? 2 : lastHands > 0 ? 1 : 0);
  if (prog >= 1) {
    learnLock = now + 900;
    setSteps(3); $("#copyCard").classList.add("done"); $("#copyTag").textContent = "Got it!";
    $("#learnRingWrap").classList.add("win"); bump($("#learnRingWrap"));
    markLearned(s);
  }
}
$("#gotIt").addEventListener("click", () => {
  $("#learnRingWrap").classList.add("win"); setRing($("#learnRing"), 1);
  setSteps(3); $("#copyCard").classList.add("done"); $("#copyTag").textContent = "Got it!";
  learnLock = performance.now() + 900;
  markLearned(current());
});
$("#learnNext").addEventListener("click", () => { signIdx = (signIdx + 1) % unit().signs.length; $("#learnFeedback").textContent = ""; renderLearn(); });
$("#learnPrev").addEventListener("click", () => { signIdx = (signIdx - 1 + unit().signs.length) % unit().signs.length; $("#learnFeedback").textContent = ""; renderLearn(); });

$("#tol").value = tolerance; $("#tolVal").textContent = Number(tolerance).toFixed(1);
$("#tol").addEventListener("input", e => { tolerance = Number(e.target.value); $("#tolVal").textContent = tolerance.toFixed(1); setPref("tol", tolerance); });

// ---------- practice ----------
const prac = { running: false, round: 0, total: 10, target: null, start: 0, stars: 0, lock: 0 };
function renderPractice() {
  const ok = readySigns().length >= 2;
  $("#pracEmpty").hidden = ok;
  $("#pracIdle").hidden = !ok || prac.running;
  $("#pracBody").hidden = !prac.running;
}
function startPractice() {
  if (!tracker.running) { toast("Start the camera first."); return; }
  Object.assign(prac, { running: true, round: 0, stars: 0, target: null });
  $("#pracStars").textContent = "0"; $("#pracDone").hidden = true;
  renderPractice(); nextRound();
}
function nextRound() {
  if (!prac.running) return;
  prac.round++;
  if (prac.round > prac.total) return finishPractice();
  const list = readySigns();
  let t;
  do { t = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && prac.target && t.id === prac.target.id);
  prac.target = t; prac.start = performance.now(); prac.lock = 0;
  const lab = $("#pracLabel"); lab.textContent = t.label; lab.classList.toggle("long", t.label.length > 3);
  $("#pracRound").textContent = `${prac.round}/${prac.total}`;
  $("#pracStarline").textContent = "";
  setRing($("#pracRing"), 0);
  $("#pracRingWrap").classList.remove("win");
}
function practiceCheck(ok, ms, now) {
  if (!prac.running || now < prac.lock) return;
  const prog = ok ? ms / 600 : 0;
  setRing($("#pracRing"), prog);
  if (prog >= 1) {
    const t = (now - prac.start - 600) / 1000;
    const s = t < 3 ? 3 : t < 6 ? 2 : 1;
    prac.stars += s; prac.lock = now + 1100;
    $("#pracStars").textContent = prac.stars;
    $("#pracStarline").textContent = "★".repeat(s);
    $("#pracRingWrap").classList.add("win"); bump($("#pracRingWrap"));
    sounds.ding();
    if (s === 3) confetti($("#pracRingWrap"));
    setTimeout(nextRound, 1000);
  }
}
function finishPractice() {
  prac.running = false;
  $("#pracSummary").textContent = `You earned ${prac.stars} of ${prac.total * 3} stars.`;
  $("#pracDone").hidden = false;
  renderPractice();
}
function stopPractice() { prac.running = false; renderPractice(); }
$("#pracStart").addEventListener("click", startPractice);
$("#pracAgain").addEventListener("click", startPractice);
$("#pracSkip").addEventListener("click", () => { if (prac.running) { sounds.buzz(); nextRound(); } });

// ---------- sign rush ----------
const game = $("#game"), gctx = game.getContext("2d");
const rush = { running: false, bubbles: [], bursts: [], score: 0, lives: 3, last: 0, spawnAt: 0, W: 0, H: 0 };
function renderRush() {
  const ok = readySigns().length >= 2;
  $("#rushEmpty").hidden = ok;
  $("#rushStart").hidden = rush.running;
  $("#rushStart").disabled = !ok;
  $("#rushStop").hidden = !rush.running;
  $("#rushScore").textContent = rush.score;
  $("#rushLives").textContent = "♥".repeat(Math.max(0, rush.lives)) || "–";
  $("#rushBest").textContent = getPref("best", 0);
}
function sizeGame() {
  const dpr = window.devicePixelRatio || 1, st = $("#stage");
  rush.W = st.clientWidth; rush.H = st.clientHeight;
  game.width = Math.round(rush.W * dpr); game.height = Math.round(rush.H * dpr);
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", () => { if (view === "rush") sizeGame(); });
function startRush() {
  if (!tracker.running) { toast("Start the camera first."); return; }
  sizeGame();
  const t = performance.now();
  Object.assign(rush, { running: true, bubbles: [], bursts: [], score: 0, lives: 3, last: t, spawnAt: t + 600 });
  $("#rushMsg").textContent = "Go!";
  renderRush();
}
async function stopRush(msg) {
  rush.running = false;
  gctx.clearRect(0, 0, rush.W, rush.H);
  if (rush.score > getPref("best", 0)) { setPref("best", rush.score); if (msg) msg += " New best!"; }
  $("#rushMsg").textContent = msg;
  renderRush();
  if (msg && rush.score > 0) {
    try { await api("/scores", { method: "POST", body: { nickname, score: rush.score } }); }
    catch (e) { toast("Couldn't save your score to the leaderboard."); }
    loadBoard();
  }
}
function rushTick(now) {
  const dt = Math.min(0.05, (now - rush.last) / 1000); rush.last = now;
  const speed = 42 + rush.score * 2.5;
  const interval = Math.max(1000, 2600 - rush.score * 70);
  const list = readySigns();
  if (now > rush.spawnAt && list.length) {
    const s = list[Math.floor(Math.random() * list.length)];
    const r = Math.max(30, Math.min(46, rush.W * 0.06));
    rush.bubbles.push({ id: s.id, label: s.label, r, x: r + Math.random() * Math.max(1, rush.W - 2 * r), y: rush.H + r, ph: Math.random() * 6 });
    rush.spawnAt = now + interval;
  }
  for (const b of rush.bubbles) { b.y -= speed * dt; b.ph += dt * 2; }
  const escaped = rush.bubbles.filter(b => b.y < -b.r);
  if (escaped.length) {
    rush.bubbles = rush.bubbles.filter(b => b.y >= -b.r);
    rush.lives -= escaped.length; sounds.buzz(); renderRush();
    if (rush.lives <= 0) { stopRush(`Round over. You popped ${rush.score}.`); return; }
  }
  rush.bursts = rush.bursts.filter(p => now - p.t < 450);
  drawRush(now);
}
function drawRush(now) {
  const g = gctx; g.clearRect(0, 0, rush.W, rush.H);
  for (const b of rush.bubbles) {
    const x = b.x + Math.sin(b.ph) * 6;
    g.beginPath(); g.arc(x, b.y, b.r, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.9)"; g.fill();
    g.lineWidth = 4; g.strokeStyle = themeColor("primary"); g.stroke();
    g.fillStyle = "#12212A";
    const fs = b.label.length > 3 ? b.r * 0.45 : b.r * 0.95;
    g.font = `800 ${fs}px "Baloo 2", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(b.label, x, b.y + fs * 0.06, b.r * 1.8);
  }
  for (const p of rush.bursts) {
    const k = (now - p.t) / 450;
    g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k * 0.9), 0, Math.PI * 2);
    g.globalAlpha = 1 - k; g.lineWidth = 6 * (1 - k) + 1; g.strokeStyle = themeColor("accent"); g.stroke(); g.globalAlpha = 1;
  }
}
function rushCheck(id, ms, now) {
  if (!rush.running || !id || ms < 350) return;
  const match = rush.bubbles.filter(b => b.id === id).sort((a, b) => a.y - b.y)[0];
  if (!match) return;
  rush.bubbles = rush.bubbles.filter(b => b !== match);
  rush.bursts.push({ x: match.x + Math.sin(match.ph) * 6, y: match.y, r: match.r, t: now });
  rush.score++; rushHold.reset(now); rushSmooth.reset(); sounds.ding(); renderRush(); bump($("#rushScore"));
  $("#rushMsg").textContent = "";
}
$("#rushStart").addEventListener("click", startRush);
$("#rushStop").addEventListener("click", () => stopRush(`Stopped at ${rush.score}.`));

async function loadBoard() {
  let rows = [];
  try { rows = await api("/leaderboard"); } catch (e) { $("#boardEmpty").textContent = "Couldn't load the leaderboard."; $("#boardEmpty").hidden = false; return; }
  const ol = $("#board"); ol.replaceChildren();
  rows.forEach((r, i) => {
    const li = el("li", r.nickname === nickname ? "me" : "");
    li.append(el("span", "rank", String(i + 1)), el("span", "who", r.nickname), el("span", "pts", String(r.score)));
    ol.append(li);
  });
  $("#boardEmpty").textContent = "No scores yet. Be the first.";
  $("#boardEmpty").hidden = rows.length > 0;
}

// ---------- start ----------
renderLaws();
signIdx = firstUnlearned();
if (getPref("rightsRead", false)) setView("learn"); else setView("rights");
loadData(false);
