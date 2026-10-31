import { getPref, setPref } from "./data.js";
import { UNITS, LAWS, LAW_SOURCES } from "./lessons.js";

const $ = s => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- start form ----------
const nick = $("#nick");
nick.value = getPref("nickname", "");
const learnedCount = Object.keys(getPref("learned", {})).length;
if (learnedCount) {
  $("#continueText").textContent = `Welcome back${nick.value ? ", " + nick.value : ""}. You've learned ${learnedCount} sign${learnedCount === 1 ? "" : "s"} so far.`;
}
$("#start").addEventListener("submit", e => {
  e.preventDefault();
  setPref("nickname", nick.value.trim().slice(0, 20));
  location.href = "/learn";
});
document.querySelectorAll('a[href="#start"]').forEach(a => a.addEventListener("click", () => setTimeout(() => nick.focus({ preventScroll: true }), 400)));

// ---------- content from the curriculum ----------
const [numbers, letters, expressions] = UNITS;
function fillChips(box, signs) {
  for (const s of signs) { const c = document.createElement("span"); c.textContent = s.label; box.append(c); }
}
fillChips($("#chipsNumbers"), numbers.signs);
fillChips($("#chipsLetters"), letters.signs);
const track = $("#marquee");
for (let i = 0; i < 2; i++) for (const s of expressions.signs) { const c = document.createElement("span"); c.textContent = s.label; track.append(c); }
$("#exprList").textContent = "Expressions: " + expressions.signs.map(s => s.label).join(", ");

// Light up chips one after another, like signs being learned.
function chipWave(box) {
  const chips = [...box.children]; let i = 0;
  setInterval(() => {
    chips.forEach(c => c.classList.remove("lit"));
    chips[i % chips.length].classList.add("lit");
    i++;
  }, 650);
}
if (!reduce) { chipWave($("#chipsNumbers")); chipWave($("#chipsLetters")); }

const rail = $("#rightsRail");
for (const law of LAWS) {
  const card = document.createElement("article"); card.className = "law2";
  const ref = document.createElement("p"); ref.className = "law-ref"; ref.textContent = law.ref;
  const h = document.createElement("h3"); h.textContent = law.title;
  const p = document.createElement("p"); p.textContent = law.body;
  const a = document.createElement("a"); a.className = "note"; a.href = LAW_SOURCES[law.source]; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Read the full text";
  card.append(ref, h, p, a); rail.append(card);
}

// ---------- nav: shadow on scroll + active section ----------
const nav = $(".nav");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });
const links = [...document.querySelectorAll(".nav-links a")];
const secObs = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) {
    links.forEach(l => l.classList.toggle("active", l.getAttribute("href") === "#" + e.target.id));
  }
}, { rootMargin: "-45% 0px -50% 0px" });
["why", "how", "learn", "rights", "inside"].forEach(id => secObs.observe(document.getElementById(id)));

// ---------- scroll reveal (only what starts below the fold) ----------
if (!reduce && "IntersectionObserver" in window) {
  const items = [...document.querySelectorAll(".reveal")].filter(el => el.getBoundingClientRect().top > innerHeight);
  const groups = new Map();
  items.forEach(el => {
    const key = el.parentElement; const n = groups.get(key) || 0; groups.set(key, n + 1);
    el.style.setProperty("--d", (n * 0.08).toFixed(2) + "s");
    el.classList.add("pending");
  });
  const obs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("shown"); e.target.classList.remove("pending"); obs.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  items.forEach(el => obs.observe(el));
}

// ---------- count-up stats ----------
const fmtIN = n => Math.round(n).toLocaleString("en-IN");
const statObs = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    statObs.unobserve(e.target);
    if (reduce) continue;
    const el = e.target, end = Number(el.dataset.count), suffix = el.dataset.suffix || "";
    const fmt = el.dataset.format === "in" ? fmtIN : n => String(Math.round(n));
    const t0 = performance.now(), dur = 1400;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(end * eased) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}, { threshold: 0.6 });
document.querySelectorAll("[data-count]").forEach(el => statObs.observe(el));

// ---------- pipeline: highlight each step in turn ----------
const steps = [...document.querySelectorAll(".pipe-step")];
let ps = 0;
if (!reduce) setInterval(() => { steps.forEach((s, i) => s.classList.toggle("on", i === ps % steps.length)); ps++; }, 900);

// ---------- hero: animated hand tracking + Sign Rush preview ----------
const cv = $("#heroCanvas"), ctx = cv.getContext("2d"), stage = $("#heroStage"), fill = $("#heroFill");
let W = 0, H = 0;
function size() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  W = stage.clientWidth; H = stage.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
size(); addEventListener("resize", size);

// A generic hand drawn the way the tracker sees it: wrist + 5 fingers of 4 points.
// Poses are plain open/closed finger patterns, not specific ISL signs.
const FINGERS = [
  { base: [-0.30, -0.20], ang: -2.35, len: [0.20, 0.17, 0.14], curlTo: 0.9 },   // thumb
  { base: [-0.17, -0.55], ang: -1.72, len: [0.24, 0.16, 0.13] },
  { base: [0.00, -0.58], ang: -1.57, len: [0.26, 0.18, 0.14] },
  { base: [0.16, -0.54], ang: -1.43, len: [0.24, 0.16, 0.13] },
  { base: [0.29, -0.45], ang: -1.27, len: [0.19, 0.13, 0.11] },
];
const POSES = [[0, 0, 0, 0, 0], [1, 0, 1, 1, 1], [1, 0, 0, 1, 1], [0.2, 1, 1, 1, 1], [1, 0, 0, 0, 0], [0, 1, 1, 1, 0]];
const WORDS = expressions.signs.map(s => s.label).concat(numbers.signs.map(s => s.label));

function handPoints(curls, cx, cy, s, tilt) {
  const rot = ([x, y]) => [cx + (x * Math.cos(tilt) - y * Math.sin(tilt)) * s, cy + (x * Math.sin(tilt) + y * Math.cos(tilt)) * s];
  const pts = [rot([0, 0])];
  FINGERS.forEach((f, i) => {
    const c = curls[i];
    const [bx, by] = f.base;
    pts.push(rot([bx, by]));
    // Extended: joints along the finger's direction.
    const ext = []; let x = bx, y = by;
    for (let j = 0; j < 3; j++) { x += Math.cos(f.ang) * f.len[j]; y += Math.sin(f.ang) * f.len[j]; ext.push([x, y]); }
    // Folded, seen from the front: joints tuck down over the knuckle (thumb crosses the palm).
    const fold = i === 0
      ? [[bx + 0.06, by - 0.12], [bx + 0.18, by - 0.18], [bx + 0.27, by - 0.17]]
      : [[bx, by - 0.12], [bx + 0.01, by - 0.06], [bx + 0.01, by + 0.02]];
    for (let j = 0; j < 3; j++) pts.push(rot([ext[j][0] + (fold[j][0] - ext[j][0]) * c, ext[j][1] + (fold[j][1] - ext[j][1]) * c]));
  });
  return pts;  // 21 points, MediaPipe order
}
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const bubbles = [], bursts = [];
let nextBubble = 0, visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);

function frame(t) {
  if (visible || reduce) draw(t);
  if (!reduce) requestAnimationFrame(frame);
}
function draw(t) {
  ctx.clearRect(0, 0, W, H);
  const sec = t / 1000;

  // faint grid
  ctx.strokeStyle = "rgba(255,255,255,0.045)"; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // bubbles rising in the background (Sign Rush preview)
  if (!reduce && sec > nextBubble) {
    const r = Math.max(26, W * 0.055);
    bubbles.push({ word: WORDS[Math.floor(Math.random() * WORDS.length)], x: r + Math.random() * (W - 2 * r), y: H + r, r, sp: 26 + Math.random() * 18, ph: Math.random() * 6, popAt: H * (0.15 + Math.random() * 0.45) });
    nextBubble = sec + 1.4;
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y -= b.sp / 60; b.ph += 0.03;
    if (b.y < b.popAt) { bursts.push({ x: b.x, y: b.y, r: b.r, t: sec }); bubbles.splice(i, 1); continue; }
    const x = b.x + Math.sin(b.ph) * 6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(59,191,181,0.55)"; ctx.stroke();
    ctx.fillStyle = "rgba(242,247,246,0.85)";
    const fs = b.word.length > 3 ? b.r * 0.38 : b.r * 0.8;
    ctx.font = `800 ${fs}px "Baloo 2", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.word, x, b.y + 1, b.r * 1.8);
    ctx.globalAlpha = 1;
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const p = bursts[i], k = (sec - p.t) / 0.5;
    if (k >= 1) { bursts.splice(i, 1); continue; }
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2);
    ctx.globalAlpha = 1 - k; ctx.lineWidth = 5 * (1 - k) + 1; ctx.strokeStyle = "#FFC23A"; ctx.stroke(); ctx.globalAlpha = 1;
  }

  // the hand, moving between poses
  const cycle = 2.6, idx = Math.floor(sec / cycle), k = ease(Math.min(1, (sec % cycle) / 0.9));
  const a = POSES[idx % POSES.length], b = POSES[(idx + 1) % POSES.length];
  const curls = reduce ? POSES[0] : a.map((v, i) => v + (b[i] - v) * k);
  const s = Math.min(W, H) * 0.62;
  const pts = handPoints(curls, W * 0.5 + Math.sin(sec * 0.6) * W * 0.03, H * 0.8, s, Math.sin(sec * 0.5) * 0.12);

  // match meter follows the pose change: dips while moving, high when settled
  fill.style.width = Math.round(reduce ? 82 : 25 + 70 * k) + "%";

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(59,191,181,0.8)"; ctx.shadowBlur = 16;
  ctx.strokeStyle = "#3BBFB5"; ctx.lineWidth = Math.max(3, s * 0.018);
  ctx.beginPath();
  for (const [p, q] of CONN) { ctx.moveTo(pts[p][0], pts[p][1]); ctx.lineTo(pts[q][0], pts[q][1]); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  pts.forEach((p, i) => {
    const tip = [4, 8, 12, 16, 20].includes(i);
    ctx.beginPath(); ctx.arc(p[0], p[1], tip ? s * 0.016 : s * 0.012, 0, Math.PI * 2);
    ctx.fillStyle = tip ? "#FFC23A" : "#ffffff"; ctx.fill();
  });
}
requestAnimationFrame(frame);
