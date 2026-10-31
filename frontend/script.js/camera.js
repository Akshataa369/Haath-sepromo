// Webcam + MediaPipe hand tracking, skeleton drawing, and simple sounds.

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["primary", "accent", "ok", "danger"]) colors[k] = cs.getPropertyValue("--" + k).trim();
}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
export function themeColor(name) { return colors[name]; }

// ---------- sound ----------
let ac = null;
let soundOn = true;
export function initSound() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
export function setSound(on) { soundOn = on; }
function tone(freq, dur = 0.12, type = "sine", vol = 0.15) {
  if (!ac || !soundOn) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
}
export const sounds = {
  ding() { tone(660); setTimeout(() => tone(990), 90); },
  buzz() { tone(150, 0.25, "square", 0.06); },
  tick() { tone(440, 0.06, "sine", 0.08); },
  go() { tone(880, 0.15); },
};

// ---------- tracker ----------
export class Tracker {
  /**
   * els: { stage, video, overlay, gate, status, startBtn, handsChip }
   * onFrame(result, now) runs for every new video frame.
   * onTick(now) runs every animation frame (for games).
   */
  constructor(els, { onFrame, onTick } = {}) {
    Object.assign(this, els);
    this.onFrame = onFrame; this.onTick = onTick;
    this.ctx = this.overlay.getContext("2d");
    this.landmarker = null; this.lastTime = -1;
    this.startBtn.addEventListener("click", () => this.start());
  }

  get running() { return !!this.landmarker; }
  get aspect() { return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3; }

  // Draw a target sign as a dashed "guide" outline on the camera, lined up with the learner's hand.
  // skel: template hands in square 0..1 picture coordinates. res: the current detection.
  drawGuide(skel, res, matched) {
    if (!skel || !skel.length) return;
    const c = this.ctx, W = this.overlay.width, H = this.overlay.height, A = W / H;
    const tHands = [...skel].sort((a, b) => a[0][0] - b[0][0]);
    const size = h => Math.max(...h.map(p => Math.hypot(p[0] - h[0][0], p[1] - h[0][1]))) || 0.2;
    const live = [...(res.landmarks || [])].sort((a, b) => a[0].x - b[0].x);
    let ox, oy, k;   // anchor in camera pixels, and template-unit -> pixel scale
    if (live.length) {
      const L = live[0], lw = L[0];
      const ls = Math.max(...L.map(p => Math.hypot((p.x - lw.x) * A, p.y - lw.y))) || 0.2;
      k = (ls / size(tHands[0])) * H;
      ox = lw.x * W; oy = lw.y * H;
    } else {
      k = H * 0.75; ox = W / 2 + (tHands[0][0][0] - 0.5) * k; oy = H * 0.5 + (tHands[0][0][1] - 0.5) * k;
    }
    const t0 = tHands[0][0];
    c.save();
    c.setLineDash([7, 7]); c.lineCap = "round";
    c.lineWidth = 3;
    c.strokeStyle = matched ? "rgba(76,208,141,0.95)" : "rgba(255,255,255,0.7)";
    c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 4;
    for (const h of tHands) {
      c.beginPath();
      for (const [a, b] of CONN) {
        c.moveTo(ox + (h[a][0] - t0[0]) * k, oy + (h[a][1] - t0[1]) * k);
        c.lineTo(ox + (h[b][0] - t0[0]) * k, oy + (h[b][1] - t0[1]) * k);
      }
      c.stroke();
    }
    c.restore();
  }

  async start() {
    if (!window.isSecureContext) { this.status.textContent = "The camera needs https or localhost."; return; }
    this.startBtn.disabled = true;
    initSound();
    try {
      this.status.textContent = "Loading hand tracker…";
      let lib;
      try {
        lib = await import(MP + "/vision_bundle.mjs");
      } catch (e) { throw Object.assign(new Error("load"), { name: "LoadError" }); }
      const { HandLandmarker, FilesetResolver } = lib;
      const files = await FilesetResolver.forVisionTasks(MP + "/wasm");
      const opts = delegate => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      let lm;
      try { lm = await HandLandmarker.createFromOptions(files, opts("GPU")); }
      catch (e) { lm = await HandLandmarker.createFromOptions(files, opts("CPU")); }
      this.status.textContent = "Waiting for camera permission…";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.stage.style.aspectRatio = `${this.video.videoWidth} / ${this.video.videoHeight}`;
      this.overlay.width = this.video.videoWidth;
      this.overlay.height = this.video.videoHeight;
      this.landmarker = lm;
      this.gate.hidden = true;
      requestAnimationFrame(t => this.loop(t));
    } catch (err) {
      this.startBtn.disabled = false;
      const n = err && err.name;
      this.status.textContent =
        n === "NotAllowedError" ? "Camera access was blocked. Allow it from the address bar, then press Start camera again." :
        n === "NotFoundError" ? "No camera found. Plug one in and try again." :
        n === "NotReadableError" ? "Another app is using the camera. Close it and try again." :
        "Couldn't start the hand tracker. Check your internet connection and try again.";
      console.error(err);
    }
  }

  loop(now) {
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastTime) {
      this.lastTime = this.video.currentTime;
      const res = this.landmarker.detectForVideo(this.video, now);
      this.draw(res);
      const nh = (res.landmarks || []).length;
      const label = nh === 0 ? "No hands" : nh === 1 ? "1 hand" : "2 hands";
      if (this.handsChip.textContent !== label) this.handsChip.textContent = label;
      this.handsChip.classList.toggle("on", nh > 0);
      if (this.onFrame) this.onFrame(res, now);
    }
    if (this.onTick) this.onTick(now);
    requestAnimationFrame(t => this.loop(t));
  }

  draw(res) {
    const c = this.ctx, W = this.overlay.width, H = this.overlay.height;
    c.clearRect(0, 0, W, H);
    (res.landmarks || []).forEach((lm, i) => {
      const col = i ? colors.accent : colors.primary;
      c.strokeStyle = col; c.lineWidth = 4; c.lineCap = "round";
      c.beginPath();
      for (const [a, b] of CONN) { c.moveTo(lm[a].x * W, lm[a].y * H); c.lineTo(lm[b].x * W, lm[b].y * H); }
      c.stroke();
      for (const p of lm) {
        c.beginPath(); c.arc(p.x * W, p.y * H, 4.5, 0, Math.PI * 2);
        c.fillStyle = "#ffffff"; c.fill(); c.lineWidth = 2; c.strokeStyle = col; c.stroke();
      }
    });
  }

  // Record `ms` milliseconds of the camera as a small video. Resolves to a Blob.
  recordClip(ms) {
    const stream = this.video.srcObject;
    if (!stream || !window.MediaRecorder) return Promise.reject(new Error("This browser can't record video. Try Chrome."));
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
    return new Promise((resolve, reject) => {
      const chunks = [];
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 700_000 }); }
      catch (e) { reject(e); return; }
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(new Blob(chunks, { type: (mimeType || "video/webm").split(";")[0] }));
      rec.onerror = e => reject(e.error || new Error("Recording failed."));
      rec.start();
      setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, ms);
    });
  }

  // Mirrored still from the camera, as a small JPEG data URL.
  snapshot(w = 240, h = 180) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const x = cv.getContext("2d"); x.translate(w, 0); x.scale(-1, 1);
    x.drawImage(this.video, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.72);
  }
}

// Shared markup helpers for the progress ring.
export const RING = 414.69;
export function setRing(el, p) { el.style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, p)))); }
export function bump(el) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
