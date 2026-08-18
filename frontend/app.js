const DB_NAME = "RaabtaLinkDB";
const DB_VERSION = 1;
const STORE_NAME = "sos";
const MAX_PEOPLE = 99;

const state = {
  peopleCount: 1,
  emergencyType: "Medical",
  gps: {
    latitude: null,
    longitude: null,
    timestamp: null,
    error: null,
  },
  audioBlob: null,
  audioUrl: null,
  mediaRecorder: null,
  mediaStream: null,
  chunks: [],
  recording: false,
  wantRecording: false,
  recordStartedAt: 0,
  timerId: null,
  playing: false,
  caseAudioUrl: null,
};

const els = {
  connectionStatus: document.getElementById("connectionStatus"),
  gpsStatus: document.getElementById("gpsStatus"),
  gpsCoords: document.getElementById("gpsCoords"),
  retryGps: document.getElementById("retryGps"),
  recordBtn: document.getElementById("recordBtn"),
  recordHint: document.getElementById("recordHint"),
  recordTimer: document.getElementById("recordTimer"),
  playbackRow: document.getElementById("playbackRow"),
  playBtn: document.getElementById("playBtn"),
  audioMeta: document.getElementById("audioMeta"),
  peopleCount: document.getElementById("peopleCount"),
  peopleMinus: document.getElementById("peopleMinus"),
  peoplePlus: document.getElementById("peoplePlus"),
  sendBtn: document.getElementById("sendBtn"),
  appStatus: document.getElementById("appStatus"),
  caseCount: document.getElementById("caseCount"),
  casesList: document.getElementById("casesList"),
  casesEmpty: document.getElementById("casesEmpty"),
  viewSos: document.getElementById("view-sos"),
  viewCases: document.getElementById("view-cases"),
};

let dbPromise = null;
let playbackAudio = null;
let caseAudio = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function getAllSos() {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
          const items = request.result || [];
          items.sort((a, b) => b.timestamp - a.timestamp);
          resolve(items);
        };
        request.onerror = () => reject(request.error);
      })
  );
}

function saveSosRecord(record) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_NAME).put(record);
      })
  );
}

function nextSosId(records) {
  const max = records.reduce((highest, item) => {
    const match = String(item.id || "").match(/SOS-(\d+)/i);
    const value = match ? Number(match[1]) : 0;
    return value > highest ? value : highest;
  }, 0);
  return `SOS-${String(max + 1).padStart(3, "0")}`;
}

function setStatus(message, kind = "") {
  els.appStatus.textContent = message;
  if (kind) {
    els.appStatus.dataset.state = kind;
  } else {
    delete els.appStatus.dataset.state;
  }
}

function formatCoords(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  els.connectionStatus.textContent = online ? "Online" : "Offline";
  els.connectionStatus.dataset.state = online ? "online" : "offline";
}

function updateGpsUi() {
  if (state.gps.latitude != null && state.gps.longitude != null) {
    els.gpsStatus.textContent = "Location available ✓";
    els.gpsStatus.dataset.state = "ok";
    els.gpsCoords.hidden = false;
    els.gpsCoords.textContent = formatCoords(state.gps.latitude, state.gps.longitude);
    els.retryGps.hidden = true;
    return;
  }

  if (state.gps.error) {
    els.gpsStatus.textContent = state.gps.error;
    els.gpsStatus.dataset.state = "error";
    els.gpsCoords.hidden = true;
    els.retryGps.hidden = false;
    return;
  }

  els.gpsStatus.textContent = "Getting location…";
  els.gpsStatus.dataset.state = "pending";
  els.gpsCoords.hidden = true;
  els.retryGps.hidden = true;
}

function captureGps() {
  if (!navigator.geolocation) {
    state.gps.error = "GPS not supported on this device";
    updateGpsUi();
    return;
  }

  state.gps.error = null;
  updateGpsUi();

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.gps.latitude = position.coords.latitude;
      state.gps.longitude = position.coords.longitude;
      state.gps.timestamp = position.timestamp || Date.now();
      state.gps.error = null;
      updateGpsUi();
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        state.gps.error = "Location blocked — tap to retry";
      } else if (error.code === error.TIMEOUT) {
        state.gps.error = "Location timed out — tap to retry";
      } else {
        state.gps.error = "Location unavailable — tap to retry";
      }
      updateGpsUi();
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 15000,
    }
  );
}

function pickMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function revokeAudioUrl() {
  if (state.audioUrl) {
    URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
  }
}

function setAudioBlob(blob) {
  revokeAudioUrl();
  state.audioBlob = blob;
  if (!blob) {
    els.playbackRow.hidden = true;
    els.recordBtn.classList.remove("has-audio");
    els.audioMeta.textContent = "";
    return;
  }

  state.audioUrl = URL.createObjectURL(blob);
  els.playbackRow.hidden = false;
  els.recordBtn.classList.add("has-audio");
  const seconds = Math.max(1, Math.round((Date.now() - state.recordStartedAt) / 1000));
  els.audioMeta.textContent = `Voice saved · ${seconds}s`;
}

function stopTracks() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

async function startRecording() {
  if (state.recording) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Microphone not supported in this browser", "error");
    return;
  }

  state.wantRecording = true;

  try {
    stopPlayback();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!state.wantRecording) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mimeType = pickMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    state.mediaStream = stream;
    state.mediaRecorder = recorder;
    state.chunks = [];
    state.recording = true;
    state.recordStartedAt = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) state.chunks.push(event.data);
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(state.chunks, { type });
      stopTracks();
      if (blob.size > 0) {
        setAudioBlob(blob);
        els.recordHint.textContent = "Voice attached";
        setStatus("Voice captured. Review it, then send SOS.");
      } else {
        setAudioBlob(null);
        els.recordHint.textContent = "Hold to record";
        setStatus("Recording was too short. Hold the button and speak.", "error");
      }
    };

    recorder.start();
    if (!state.wantRecording) {
      recorder.stop();
      return;
    }
    buzz(40);
    els.recordBtn.classList.add("is-recording");
    els.recordBtn.classList.remove("has-audio");
    els.recordHint.hidden = true;
    els.recordTimer.hidden = false;
    els.recordTimer.textContent = "00:00";
    els.playbackRow.hidden = true;
    setStatus("Recording… release to stop");

    stopTimer();
    state.timerId = setInterval(() => {
      els.recordTimer.textContent = formatClock(Date.now() - state.recordStartedAt);
    }, 200);
  } catch (error) {
    state.recording = false;
    state.wantRecording = false;
    stopTracks();
    if (state.audioBlob) {
      els.playbackRow.hidden = false;
      els.recordBtn.classList.add("has-audio");
      els.recordHint.textContent = "Voice attached";
    }
    setStatus("Microphone permission is needed to record a voice SOS", "error");
  }
}

function stopRecording() {
  state.wantRecording = false;
  if (!state.recording || !state.mediaRecorder) return;

  state.recording = false;
  stopTimer();
  els.recordBtn.classList.remove("is-recording");
  els.recordHint.hidden = false;
  els.recordTimer.hidden = true;
  buzz(25);

  if (state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
}

function stopPlayback() {
  if (playbackAudio) {
    playbackAudio.pause();
    playbackAudio.currentTime = 0;
  }
  state.playing = false;
  els.playBtn.textContent = "Play voice";
}

function togglePlayback() {
  if (!state.audioUrl) return;

  if (!playbackAudio || playbackAudio.src !== state.audioUrl) {
    playbackAudio = new Audio(state.audioUrl);
    playbackAudio.addEventListener("ended", () => {
      state.playing = false;
      els.playBtn.textContent = "Play voice";
    });
  }

  if (state.playing) {
    stopPlayback();
    return;
  }

  playbackAudio.play();
  state.playing = true;
  els.playBtn.textContent = "Stop";
}

function setPeople(value) {
  state.peopleCount = Math.min(MAX_PEOPLE, Math.max(1, value));
  els.peopleCount.textContent = String(state.peopleCount);
}

function setupTypePicker() {
  const chips = document.querySelectorAll(".type-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((item) => {
        item.classList.toggle("is-selected", item === chip);
        item.setAttribute("aria-checked", item === chip ? "true" : "false");
      });
      state.emergencyType = chip.dataset.type;
    });
  });
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      tabs.forEach((item) => item.classList.toggle("is-active", item === tab));
      const view = tab.dataset.view;
      els.viewSos.hidden = view !== "sos";
      els.viewCases.hidden = view !== "cases";
      if (view === "cases") await renderCases();
    });
  });
}

async function renderCases() {
  const records = await getAllSos();
  els.caseCount.textContent = String(records.length);
  els.casesList.innerHTML = "";
  els.casesEmpty.hidden = records.length > 0;

  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "case-card";

    const gpsText =
      record.latitude != null && record.longitude != null
        ? `GPS: ${formatCoords(record.latitude, record.longitude)}`
        : "GPS: not captured";

    card.innerHTML = `
      <div class="case-top">
        <div>
          <div class="case-id">${record.id}</div>
          <div class="case-type">${record.emergencyType}</div>
        </div>
        <div class="case-flags">
          <span class="flag pending">${record.status}</span>
          <span class="flag offline">${record.synced ? "Synced" : "Not synced"}</span>
        </div>
      </div>
      <p class="case-meta">${record.peopleCount} people · ${formatTime(record.timestamp)}</p>
      <p class="case-gps">${gpsText}</p>
      <div class="case-actions"></div>
    `;

    const actions = card.querySelector(".case-actions");
    if (record.audio) {
      const play = document.createElement("button");
      play.className = "play-mini";
      play.type = "button";
      play.textContent = "Play voice";
      play.addEventListener("click", () => playCaseAudio(record, play));
      actions.appendChild(play);
    } else {
      const missing = document.createElement("span");
      missing.className = "audio-meta";
      missing.textContent = "No voice attached";
      actions.appendChild(missing);
    }

    els.casesList.appendChild(card);
  });
}

function stopCaseAudio() {
  if (caseAudio) {
    caseAudio.pause();
    caseAudio = null;
  }
  if (state.caseAudioUrl) {
    URL.revokeObjectURL(state.caseAudioUrl);
    state.caseAudioUrl = null;
  }
  document.querySelectorAll(".play-mini").forEach((btn) => {
    btn.textContent = "Play voice";
    btn.dataset.playing = "false";
  });
}

function playCaseAudio(record, button) {
  const alreadyPlaying = button.dataset.playing === "true";
  stopCaseAudio();
  if (alreadyPlaying) return;

  const url = URL.createObjectURL(record.audio);
  state.caseAudioUrl = url;
  caseAudio = new Audio(url);
  button.dataset.playing = "true";
  button.textContent = "Stop";
  caseAudio.addEventListener("ended", stopCaseAudio);
  caseAudio.play();
}

async function sendSos() {
  if (state.recording) stopRecording();

  els.sendBtn.disabled = true;
  setStatus("Saving SOS on this device…");

  try {
    if (state.gps.latitude == null) captureGps();

    const records = await getAllSos();
    const record = {
      id: nextSosId(records),
      timestamp: Date.now(),
      latitude: state.gps.latitude,
      longitude: state.gps.longitude,
      gpsTimestamp: state.gps.timestamp,
      emergencyType: state.emergencyType,
      peopleCount: state.peopleCount,
      audio: state.audioBlob || null,
      audioType: state.audioBlob ? state.audioBlob.type : "",
      status: "Pending",
      synced: false,
    };

    await saveSosRecord(record);
    await renderCases();

    setStatus(`Saved offline · ${record.id}`, "saved");
    els.recordHint.textContent = state.audioBlob ? "Voice attached" : "Hold to record";
  } catch (error) {
    setStatus("Could not save SOS on this device", "error");
  } finally {
    els.sendBtn.disabled = false;
  }
}

function bindRecordButton() {
  const btn = els.recordBtn;
  let hold = false;

  const begin = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    hold = true;
    btn.setPointerCapture(event.pointerId);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    startRecording();
  };

  const end = () => {
    if (!hold) return;
    hold = false;
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    stopRecording();
  };

  btn.addEventListener("pointerdown", begin);
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
  btn.addEventListener("contextmenu", (event) => event.preventDefault());

  btn.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      if (state.recording) stopRecording();
      else startRecording();
    }
  });
}

function spawnEmbers() {
  const host = document.getElementById("embers");
  if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  host.innerHTML = "";
  const count = window.innerWidth < 480 ? 18 : 28;
  for (let i = 0; i < count; i += 1) {
    const ember = document.createElement("span");
    ember.className = "ember";
    ember.style.left = `${Math.random() * 100}%`;
    ember.style.animationDelay = `${Math.random() * 8}s`;
    ember.style.animationDuration = `${5 + Math.random() * 7}s`;
    ember.style.setProperty("--x", `${Math.random() * 90 - 45}px`);
    ember.style.width = ember.style.height = `${3 + Math.random() * 4}px`;
    host.appendChild(ember);
  }
}

function setupSceneTilt() {
  const app = document.querySelector(".app");
  if (!app) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(pointer: fine)").matches) return;

  window.addEventListener("pointermove", (event) => {
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    app.style.setProperty("--tilt-x", `${(-y * 9).toFixed(2)}deg`);
    app.style.setProperty("--tilt-y", `${(x * 12).toFixed(2)}deg`);
  });
}
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      setStatus("Offline cache unavailable, but local saving still works", "error");
    });
  });
}

async function init() {
  updateConnectionStatus();
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  setupTabs();
  setupTypePicker();
  bindRecordButton();
  spawnEmbers();
  setupSceneTilt();
  captureGps();
  registerServiceWorker();

  els.retryGps.addEventListener("click", captureGps);
  els.peopleMinus.addEventListener("click", () => setPeople(state.peopleCount - 1));
  els.peoplePlus.addEventListener("click", () => setPeople(state.peopleCount + 1));
  els.playBtn.addEventListener("click", togglePlayback);
  els.sendBtn.addEventListener("click", sendSos);

  try {
    await openDatabase();
    await renderCases();
  } catch (error) {
    setStatus("Local storage failed to open", "error");
  }
}

init();
