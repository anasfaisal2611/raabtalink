/* ===== RaabtaLink PWA — app.js ===== */

// API is always on the same origin — works whether served standalone or via FastAPI
const API_BASE = `${location.protocol}//${location.host}`.replace(/\/app.*$/, "");

// Known offline locations (bundled — no internet needed)
const KNOWN_LOCATIONS = [
  { name: "Clifton, Karachi",       lat: 24.8108, lon: 67.0226 },
  { name: "DHA Phase 5, Karachi",   lat: 24.8050, lon: 67.0600 },
  { name: "Gulshan, Karachi",       lat: 24.9200, lon: 67.0900 },
  { name: "Saddar, Karachi",        lat: 24.8607, lon: 67.0011 },
  { name: "North Nazimabad",        lat: 24.9600, lon: 67.0400 },
  { name: "Malir, Karachi",         lat: 24.9000, lon: 67.1600 },
  { name: "Korangi, Karachi",       lat: 24.8400, lon: 67.1200 },
  { name: "LIQUATABAD, Karachi",    lat: 24.8800, lon: 67.0100 },
];

const MAX_PEOPLE = 99;
const GPS_CACHE_KEY = "raabta_last_gps";

const state = {
  peopleCount: 1,
  gps: { latitude: null, longitude: null, source: null },
  // live transcribe
  ws: null,
  liveAudioCtx: null,
  liveProcessorNode: null,
  liveStream: null,
  livePcmBuffer: [],
  isLive: false,
};

const els = {
  connectionStatus: document.getElementById("connectionStatus"),
  gpsStatus: document.getElementById("gpsStatus"),
  gpsCoords: document.getElementById("gpsCoords"),
  gpsSource: document.getElementById("gpsSource"),
  retryGps: document.getElementById("retryGps"),
  pickLocation: document.getElementById("pickLocation"),
  locationPicker: document.getElementById("locationPicker"),
  locationGrid: document.getElementById("locationGrid"),
  peopleCount: document.getElementById("peopleCount"),
  peopleMinus: document.getElementById("peopleMinus"),
  peoplePlus: document.getElementById("peoplePlus"),
  liveBtn: document.getElementById("liveBtn"),
  liveTranscript: document.getElementById("liveTranscript"),
  liveTranscriptText: document.getElementById("liveTranscriptText"),
  liveServerMsgs: document.getElementById("liveServerMsgs"),
  appStatus: document.getElementById("appStatus"),
};

/* ---- Helpers ---- */

function setStatus(msg, kind = "") {
  els.appStatus.textContent = msg;
  kind ? (els.appStatus.dataset.state = kind) : delete els.appStatus.dataset.state;
}

function formatCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function updateConnectionStatus() {
  const on = navigator.onLine;
  els.connectionStatus.textContent = on ? "Online" : "Offline";
  els.connectionStatus.dataset.state = on ? "online" : "offline";
}

/* ---- GPS ---- */

function setGps(lat, lon, source) {
  state.gps.latitude = lat;
  state.gps.longitude = lon;
  state.gps.source = source;

  els.gpsStatus.textContent = `Location ready (${source})`;
  els.gpsStatus.dataset.state = source === "gps" ? "ok" : "cached";
  els.gpsCoords.hidden = false;
  els.gpsCoords.textContent = formatCoords(lat, lon);
  els.gpsSource.hidden = false;
  els.gpsSource.textContent = source === "gps"
    ? "From device GPS"
    : source === "manual"
    ? "Manually selected"
    : "From last saved location";
  els.retryGps.hidden = true;
}

function clearGps(error) {
  state.gps.latitude = null;
  state.gps.longitude = null;
  state.gps.source = null;
  els.gpsStatus.textContent = error || "Location unavailable";
  els.gpsStatus.dataset.state = "error";
  els.gpsCoords.hidden = true;
  els.gpsSource.hidden = true;
  els.retryGps.hidden = false;
}

function cacheGps(lat, lon) {
  try {
    localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ lat, lon, ts: Date.now() }));
  } catch (_) {}
}

function loadCachedGps() {
  try {
    const raw = localStorage.getItem(GPS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.lat != null && data.lon != null) return data;
  } catch (_) {}
  return null;
}

function captureGps() {
  if (!navigator.geolocation) {
    // No GPS support — try cache
    const cached = loadCachedGps();
    if (cached) { setGps(cached.lat, cached.lon, "cached"); return; }
    clearGps("GPS not supported — pick a location manually");
    return;
  }

  els.gpsStatus.textContent = "Getting location…";
  els.gpsStatus.dataset.state = "pending";
  els.retryGps.hidden = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setGps(pos.coords.latitude, pos.coords.longitude, "gps");
      cacheGps(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      // GPS failed — try cached
      const cached = loadCachedGps();
      if (cached) {
        setGps(cached.lat, cached.lon, "cached");
      } else {
        clearGps(err.code === err.PERMISSION_DENIED
          ? "Location denied — pick manually or allow GPS"
          : "Location unavailable — pick manually");
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

/* ---- Location Picker ---- */

function buildLocationPicker() {
  els.locationGrid.innerHTML = "";
  KNOWN_LOCATIONS.forEach((loc) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "location-chip";
    btn.textContent = loc.name;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".location-chip").forEach((c) => c.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      setGps(loc.lat, loc.lon, "manual");
      els.locationPicker.hidden = true;
      setStatus(`Location set: ${loc.name}`);
    });
    els.locationGrid.appendChild(btn);
  });
}

/* ---- People Stepper ---- */

function setPeople(val) {
  state.peopleCount = Math.min(MAX_PEOPLE, Math.max(1, val));
  els.peopleCount.textContent = String(state.peopleCount);
}

/* ---- Live Transcribe (WebSocket) ---- */

async function startLiveTranscribe() {
  if (state.isLive) return;
  if (state.gps.latitude == null) {
    setStatus("Need location first — allow GPS or pick manually", "error");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const inputRate = audioCtx.sampleRate;
    const targetRate = 16000;

    let pcmBuffer = [];
    state.livePcmBuffer = pcmBuffer;  // expose for flush on stop
    const WINDOW_SECONDS = 8;   // send last 8s of audio each time
    const SEND_EVERY_SECONDS = 4;  // send every 4 seconds
    const MAX_BUFFER = targetRate * 20;  // cap buffer at 20s
    const WINDOW_SAMPLES = targetRate * WINDOW_SECONDS;
    const SEND_SAMPLES = targetRate * SEND_EVERY_SECONDS;
    let samplesSinceSend = 0;

    processor.onaudioprocess = (event) => {
      if (!state.isLive || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);

      // Downsample to 16kHz
      const ratio = inputRate / targetRate;
      const outLen = Math.round(input.length / ratio);
      const ds = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const idx = i * ratio;
        const lo = Math.floor(idx);
        const hi = Math.min(lo + 1, input.length - 1);
        ds[i] = input[lo] * (1 - (idx - lo)) + input[hi] * (idx - lo);
      }

      for (let i = 0; i < ds.length; i++) pcmBuffer.push(ds[i]);
      samplesSinceSend += outLen;

      // Trim buffer if it exceeds max
      if (pcmBuffer.length > MAX_BUFFER) {
        pcmBuffer.splice(0, pcmBuffer.length - MAX_BUFFER);
      }

      // Send sliding window every SEND_EVERY_SECONDS
      if (samplesSinceSend >= SEND_SAMPLES && pcmBuffer.length >= targetRate * 2) {
        samplesSinceSend = 0;
        const start = Math.max(0, pcmBuffer.length - WINDOW_SAMPLES);
        const window = pcmBuffer.slice(start);
        const pcm16 = new Int16Array(window.length);
        for (let i = 0; i < window.length; i++) {
          const s = Math.max(-1, Math.min(1, window[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        state.ws.send(pcm16.buffer);
      }
    };

    const params = new URLSearchParams({
      sender_id: "pwa-" + Date.now(),
      latitude: String(state.gps.latitude),
      longitude: String(state.gps.longitude),
      people_count: String(state.peopleCount),
    });
    const wsScheme = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsScheme}//${location.host}/sos/ws/listen?${params}`;

    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.transcript) {
          // Replace text with latest full transcription (sliding window)
          els.liveTranscriptText.textContent = msg.transcript;
        }
        if (msg.status === "report_saved") {
          const div = document.createElement("div");
          div.className = "server-msg";
          div.textContent = `Saved: ${msg.sos_id.slice(0, 8)}… | ${msg.severity} | ${msg.dispatch_status}`;
          els.liveServerMsgs.appendChild(div);
        }
      } catch (_) {}
    };

    ws.onclose = () => { if (state.isLive) stopLiveTranscribe(); };
    ws.onerror = () => { setStatus("WebSocket connection failed", "error"); stopLiveTranscribe(); };

    state.ws = ws;
    state.liveAudioCtx = audioCtx;
    state.liveProcessorNode = processor;
    state.liveStream = stream;
    state.isLive = true;

    source.connect(processor);
    processor.connect(audioCtx.destination);

    els.liveBtn.textContent = "Stop Transcribing";
    els.liveBtn.classList.add("is-active");
    els.liveTranscript.hidden = false;
    els.liveTranscriptText.textContent = "";
    els.liveServerMsgs.innerHTML = "";
    setStatus("Live transcription active…");
  } catch (e) {
    setStatus("Microphone permission needed", "error");
  }
}

function stopLiveTranscribe() {
  // Stop capturing audio immediately
  state.isLive = false;
  if (state.liveProcessorNode) {
    state.liveProcessorNode.disconnect();
    state.liveProcessorNode.onaudioprocess = null;
    state.liveProcessorNode = null;
  }
  if (state.liveAudioCtx) { state.liveAudioCtx.close().catch(() => {}); state.liveAudioCtx = null; }
  if (state.liveStream) { state.liveStream.getTracks().forEach((t) => t.stop()); state.liveStream = null; }

  // Flush remaining audio in buffer before closing
  if (state.livePcmBuffer.length >= 16000 && state.ws && state.ws.readyState === WebSocket.OPEN) {
    const start = Math.max(0, state.livePcmBuffer.length - 16000 * 8);
    const window = state.livePcmBuffer.slice(start);
    const pcm16 = new Int16Array(window.length);
    for (let i = 0; i < window.length; i++) {
      const s = Math.max(-1, Math.min(1, window[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    state.ws.send(pcm16.buffer);
    setStatus("Processing final audio…");
  }
  state.livePcmBuffer = [];

  // Keep WS open briefly to receive final transcription
  const ws = state.ws;
  state.ws = null;
  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }, 3000);

  els.liveBtn.textContent = "Start Live Transcribe";
  els.liveBtn.classList.remove("is-active");
  setStatus("Transcription stopped");
}

/* ---- Responder Auth ---- */

const TOKEN_KEY = "raabta_token";

function showAuthMsg(msg, ok) {
  const el = document.getElementById("authMsg");
  el.textContent = msg;
  el.className = ok ? "auth-msg auth-ok" : "auth-msg auth-err";
}

async function doRegister(e) {
  e.preventDefault();
  const body = {
    username: document.getElementById("regUser").value.trim(),
    email: document.getElementById("regEmail").value.trim(),
    password: document.getElementById("regPass").value,
    full_name: document.getElementById("regName").value.trim(),
    organization: document.getElementById("regOrg").value.trim(),
    license_id: document.getElementById("regLicense").value.trim() || null,
  };
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { showAuthMsg(`Server error: ${text.slice(0, 120)}`, false); return; }
    if (!res.ok) { showAuthMsg(data.detail || "Registration failed", false); return; }
    showAuthMsg(`Registered as ${data.username}. You can now log in.`, true);
    document.getElementById("tabLogin").click();
  } catch (err) {
    showAuthMsg(`Error: ${err.message}`, false);
  }
}

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });
    const data = await res.json();
    if (!res.ok) { showAuthMsg(data.detail || "Login failed", false); return; }
    localStorage.setItem(TOKEN_KEY, data.access_token);
    showAuthMsg("", true);
    await loadProfile();
  } catch (err) {
    showAuthMsg(`Error: ${err.message}`, false);
  }
}

function doLogout() {
  localStorage.removeItem(TOKEN_KEY);
  document.getElementById("responderProfile").hidden = true;
  document.getElementById("authForms").hidden = false;
}

async function loadProfile() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { localStorage.removeItem(TOKEN_KEY); return; }
    const data = await res.json();
    document.getElementById("responderName").textContent = data.full_name;
    document.getElementById("responderOrg").textContent = data.organization;
    document.getElementById("responderRole").textContent = `Role: ${data.role}`;
    document.getElementById("responderProfile").hidden = false;
    document.getElementById("authForms").hidden = true;
  } catch (_) {}
}

/* ---- Service Worker ---- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    setStatus("Offline cache unavailable");
  });
}

/* ---- Init ---- */

function init() {
  updateConnectionStatus();
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  buildLocationPicker();

  els.retryGps.addEventListener("click", captureGps);
  els.pickLocation.addEventListener("click", () => {
    els.locationPicker.hidden = !els.locationPicker.hidden;
  });
  els.peopleMinus.addEventListener("click", () => setPeople(state.peopleCount - 1));
  els.peoplePlus.addEventListener("click", () => setPeople(state.peopleCount + 1));
  els.liveBtn.addEventListener("click", () => {
    if (state.isLive) stopLiveTranscribe();
    else startLiveTranscribe();
  });

  captureGps();
  registerServiceWorker();

  // Auth wiring
  document.getElementById("tabLogin").addEventListener("click", () => {
    document.getElementById("tabLogin").classList.add("is-active");
    document.getElementById("tabRegister").classList.remove("is-active");
    document.getElementById("loginForm").hidden = false;
    document.getElementById("registerForm").hidden = true;
    document.getElementById("authMsg").textContent = "";
  });
  document.getElementById("tabRegister").addEventListener("click", () => {
    document.getElementById("tabRegister").classList.add("is-active");
    document.getElementById("tabLogin").classList.remove("is-active");
    document.getElementById("registerForm").hidden = false;
    document.getElementById("loginForm").hidden = true;
    document.getElementById("authMsg").textContent = "";
  });
  document.getElementById("loginForm").addEventListener("submit", doLogin);
  document.getElementById("registerForm").addEventListener("submit", doRegister);
  document.getElementById("logoutBtn").addEventListener("click", doLogout);
  loadProfile();
}

init();
