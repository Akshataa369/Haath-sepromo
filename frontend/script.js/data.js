// Talking to the backend, plus small per-browser preferences.

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = "GET", body, pin } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (pin) headers["X-Setup-Pin"] = pin;
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const d = data && data.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) && d[0] && d[0].msg ? d[0].msg.replace(/^Value error, /, "") : `Server error (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

// Upload a recorded video clip as the raw request body.
export async function uploadClip(signId, blob, pin) {
  let res;
  try {
    res = await fetch(`/api/signs/${signId}/clip`, {
      method: "PUT", body: blob,
      headers: { "Content-Type": (blob.type || "video/webm").split(";")[0], "X-Setup-Pin": pin },
    });
  } catch (e) {
    throw new ApiError("Couldn't reach the server. The clip wasn't saved, try again.", 0);
  }
  if (!res.ok) {
    let msg = `Server error (${res.status}).`;
    try { const d = (await res.json()).detail; if (typeof d === "string") msg = d; } catch (e) {}
    throw new ApiError(msg, res.status);
  }
}

// ---------- preferences (one object in localStorage) ----------
const PREFS_KEY = "haath-se:prefs";
function readAll() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
}
export function getPref(key, fallback) {
  const v = readAll()[key];
  return v === undefined ? fallback : v;
}
export function setPref(key, value) {
  const all = readAll(); all[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(all)); } catch (e) {}
}

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
