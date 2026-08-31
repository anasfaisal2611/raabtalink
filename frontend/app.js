/* ===== RaabtaLink PWA ===== */

const API_BASE = `${location.protocol}//${location.host}`.replace(/\/app.*$/, "");
const TOKEN_KEY = "raabta_token";
const GPS_CACHE_KEY = "raabta_last_gps";
const SENDER_KEY = "raabta_sender_id";
const LAST_SYNC_KEY = "raabta_last_sync";
const MAX_PEOPLE = 99;

const NEARBY_LOCATION_LIMIT = 10;

const state = {
  peopleCount: 1,
  emergencyType: "medical",
  gps: { latitude: null, longitude: null, source: null, landmark: null },
  audioBlob: null,
  audioUrl: null,
  mediaRecorder: null,
  mediaStream: null,
  chunks: [],
  recording: false,
  wantRecording: false,
  recordStartedAt: 0,
  timerId: null,
  playbackAudio: null,
  backendReachable: false,
  syncing: false,
  lastSyncAt: null,
  ws: null,
  liveAudioCtx: null,
  liveProcessorNode: null,
  liveStream: null,
  livePcmBuffer: [],
  isLive: false,
  map: null,
  markerCluster: null,
  victimMap: null,
  victimMarker: null,
  reports: [],
  incidents: [],
  agentLogs: [],
  refreshTimer: null,
};

const els = {};

function $(id) { return document.getElementById(id); }

function cacheEls() {
  [
    "connectionStatus", "queueBadge", "gpsStatus", "gpsCoords", "gpsSource",
    "retryGps", "pickLocation", "locationPicker", "locationGrid",
    "peopleCount", "peopleMinus", "peoplePlus", "emergencyText",
    "recordBtn", "recordHint", "recordTimer", "playbackRow", "playBtn",
    "audioMeta", "clearAudioBtn", "submitSosBtn", "liveBtn", "liveTranscript",
    "liveTranscriptText", "liveServerMsgs", "appStatus",
    "view-sos", "view-responder", "dashboard", "authSection",
    "responderProfile", "authForms", "reportsList", "reportsEmpty",
    "agentLogsList", "logsEmpty", "mapContainer",
  ].forEach((id) => { els[id.replace(/-/g, "_")] = $(id); });

  els.connectionStatus = $("connectionStatus");
  els.queueBadge = $("queueBadge");
  els.gpsStatus = $("gpsStatus");
  els.gpsCoords = $("gpsCoords");
  els.gpsSource = $("gpsSource");
  els.retryGps = $("retryGps");
  els.pickLocation = $("pickLocation");
  els.locationPicker = $("locationPicker");
  els.locationGrid = $("locationGrid");
  els.peopleCount = $("peopleCount");
  els.peopleMinus = $("peopleMinus");
  els.peoplePlus = $("peoplePlus");
  els.emergencyText = $("emergencyText");
  els.recordBtn = $("recordBtn");
  els.recordHint = $("recordHint");
  els.recordTimer = $("recordTimer");
  els.playbackRow = $("playbackRow");
  els.playBtn = $("playBtn");
  els.audioMeta = $("audioMeta");
  els.clearAudioBtn = $("clearAudioBtn");
  els.submitSosBtn = $("submitSosBtn");
  els.liveBtn = $("liveBtn");
  els.liveTranscript = $("liveTranscript");
  els.liveTranscriptText = $("liveTranscriptText");
  els.liveServerMsgs = $("liveServerMsgs");
  els.appStatus = $("appStatus");
  els.viewSos = $("view-sos");
  els.viewResponder = $("view-responder");
  els.dashboard = $("dashboard");
  els.authSection = $("authSection");
  els.responderProfile = $("responderProfile");
  els.authForms = $("authForms");
  els.reportsList = $("reportsList");
  els.reportsEmpty = $("reportsEmpty");
  els.agentLogsList = $("agentLogsList");
  els.logsEmpty = $("logsEmpty");
  els.mapContainer = $("mapContainer");
}

function setStatus(msg, kind = "") {
  els.appStatus.textContent = msg;
  kind ? (els.appStatus.dataset.state = kind) : delete els.appStatus.dataset.state;
}

function getSenderId() {
  let id = localStorage.getItem(SENDER_KEY);
  if (!id) {
    id = "victim-" + crypto.randomUUID().slice(0, 8);
    localStorage.setItem(SENDER_KEY, id);
  }
  return id;
}

function newSosId() {
  return crypto.randomUUID();
}

function formatCoords(lat, lon) {
  return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ---- Connection status ---- */

async function pingBackend() {
  if (!navigator.onLine) {
    state.backendReachable = false;
    return false;
  }
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    state.backendReachable = res.ok;
    return res.ok;
  } catch {
    state.backendReachable = false;
    return false;
  }
}

async function updateConnectionUI() {
  const queueCount = await OutboxDB.count();
  const pill = els.connectionStatus;
  const badge = els.queueBadge;
  const textEl = pill.querySelector(".net-text") || pill;
  let label = "Checking…";

  if (state.syncing) {
    label = "Syncing…";
    pill.dataset.state = "syncing";
  } else if (!navigator.onLine || !state.backendReachable) {
    label = queueCount > 0 ? `Queued (${queueCount})` : "Out of range";
    pill.dataset.state = queueCount > 0 ? "queued" : "offline";
  } else if (queueCount > 0) {
    label = `Connected · ${queueCount} queued`;
    pill.dataset.state = "queued";
  } else if (state.lastSyncAt) {
    const mins = Math.floor((Date.now() - state.lastSyncAt) / 60000);
    label = mins < 1 ? "Base station online" : `Synced ${mins}m ago`;
    pill.dataset.state = "online";
  } else {
    label = "Base station online";
    pill.dataset.state = "online";
  }

  textEl.textContent = label;

  if (queueCount > 0) {
    badge.hidden = false;
    badge.textContent = String(queueCount);
  } else {
    badge.hidden = true;
    badge.textContent = "";
  }
}

function startConnectionMonitor() {
  const tick = async () => {
    await pingBackend();
    await updateConnectionUI();
    if (navigator.onLine && state.backendReachable) await drainOutbox();
  };
  tick();
  window.addEventListener("online", tick);
  window.addEventListener("offline", () => { state.backendReachable = false; updateConnectionUI(); });
  setInterval(tick, 15000);
}

/* ---- Outbox sync ---- */

async function submitOutboxItem(item) {
  if (item.type === "voice" && item.audioBlob) {
    const fd = new FormData();
    fd.append("audio", item.audioBlob, "sos.webm");
    fd.append("sender_id", item.sender_id);
    fd.append("latitude", String(item.latitude ?? ""));
    fd.append("longitude", String(item.longitude ?? ""));
    fd.append("people_count", String(item.people_count));
    if (item.client_timestamp) fd.append("client_timestamp", item.client_timestamp);
    const res = await fetch(`${API_BASE}/sos/voice`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  const body = {
    sos_id: item.sos_id,
    sender_id: item.sender_id,
    emergency_text: item.emergency_text,
    latitude: item.latitude,
    longitude: item.longitude,
    people_count: item.people_count,
    category: item.category || "other",
    client_timestamp: item.client_timestamp,
  };
  const res = await fetch(`${API_BASE}/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function drainOutbox() {
  if (state.syncing || !navigator.onLine || !state.backendReachable) return;
  const items = await OutboxDB.getAll();
  if (!items.length) return;

  state.syncing = true;
  await updateConnectionUI();

  for (const item of items) {
    try {
      await submitOutboxItem(item);
      await OutboxDB.remove(item.sos_id);
    } catch {
      item.retryCount = (item.retryCount || 0) + 1;
      item.lastAttempt = Date.now();
      await OutboxDB.update(item);
      break;
    }
  }

  state.syncing = false;
  state.lastSyncAt = Date.now();
  localStorage.setItem(LAST_SYNC_KEY, String(state.lastSyncAt));
  await updateConnectionUI();
}

async function queueAndSubmit(payload) {
  await OutboxDB.add(payload);
  await updateConnectionUI();

  if (navigator.onLine && state.backendReachable) {
    await drainOutbox();
    const remaining = await OutboxDB.count();
    if (remaining === 0) {
      setStatus("Report submitted to base station", "saved");
      return "submitted";
    }
  }
  setStatus("Saved locally — will send when connected", "saved");
  return "queued";
}

/* ---- GPS ---- */

function setGps(lat, lon, source, landmark = null) {
  state.gps.latitude = lat;
  state.gps.longitude = lon;
  state.gps.source = source;
  state.gps.landmark = landmark;
  els.gpsStatus.textContent = source === "gps" ? "GPS locked ✓" : landmark ? "Landmark set ✓" : `Location set (${source})`;
  els.gpsStatus.dataset.state = source === "gps" ? "ok" : "cached";
  els.gpsCoords.hidden = false;
  els.gpsCoords.textContent = formatCoords(lat, lon);
  els.gpsSource.hidden = false;
  if (landmark) {
    const text = typeof landmark === "object" ? landmark.en : landmark;
    els.gpsSource.textContent = text;
  } else {
    els.gpsSource.textContent = source === "gps"
      ? "Live GPS from your device"
      : source === "manual"
      ? "Manually selected on map"
      : "From last saved location";
  }
  const landmarkEl = $("landmarkLabel");
  if (landmarkEl) {
    landmarkEl.hidden = !landmark;
    if (!landmark) {
      landmarkEl.textContent = "";
    } else if (typeof landmark === "object") {
      landmarkEl.innerHTML = `<span class="chip-en">📍 ${escapeHtml(landmark.en)}</span><span class="chip-ur" dir="rtl">${escapeHtml(landmark.ur)}</span>`;
    } else {
      landmarkEl.textContent = `📍 ${landmark}`;
    }
  }
  els.retryGps.hidden = true;
  updateVictimMap(lat, lon);
  if (els.locationPicker && !els.locationPicker.hidden) buildLocationPicker();
}

function clearGps(error) {
  state.gps.latitude = null;
  state.gps.longitude = null;
  state.gps.landmark = null;
  els.gpsStatus.textContent = error || "Location unavailable";
  els.gpsStatus.dataset.state = "error";
  els.gpsCoords.hidden = true;
  els.gpsSource.hidden = true;
  els.retryGps.hidden = false;
  const wrap = $("victimMapWrap");
  if (wrap) wrap.hidden = true;
  const landmarkEl = $("landmarkLabel");
  if (landmarkEl) landmarkEl.hidden = true;
}

function cacheGps(lat, lon) {
  try { localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ lat, lon })); } catch (_) {}
}

function loadCachedGps() {
  try {
    const raw = localStorage.getItem(GPS_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function captureGps(fresh = false) {
  if (!navigator.geolocation) {
    const c = loadCachedGps();
    if (c) { setGps(c.lat, c.lon, "cached"); return; }
    clearGps("GPS not supported — pick manually");
    return;
  }
  els.gpsStatus.textContent = "Getting location…";
  els.gpsStatus.dataset.state = "pending";
  navigator.geolocation.getCurrentPosition(
    (pos) => { setGps(pos.coords.latitude, pos.coords.longitude, "gps"); cacheGps(pos.coords.latitude, pos.coords.longitude); },
    () => {
      const c = loadCachedGps();
      if (c) setGps(c.lat, c.lon, "cached");
      else clearGps("Location denied — pick manually");
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 30000 }
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getLocationReference() {
  if (state.gps.latitude != null && state.gps.longitude != null) {
    return { lat: state.gps.latitude, lon: state.gps.longitude };
  }
  const cached = loadCachedGps();
  if (cached) return { lat: cached.lat, lon: cached.lon };
  return null;
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function setLandmark(labels) {
  state.gps.landmark = labels;
  const landmarkEl = $("landmarkLabel");
  if (landmarkEl) {
    landmarkEl.hidden = !labels;
    if (!labels) {
      landmarkEl.textContent = "";
    } else {
      landmarkEl.innerHTML = `<span class="chip-en">📍 ${escapeHtml(labels.en)}</span><span class="chip-ur" dir="rtl">${escapeHtml(labels.ur)}</span>`;
    }
  }
  if (labels) {
    els.gpsSource.textContent = labels.en;
    els.gpsStatus.textContent = "Landmark tagged ✓";
    els.gpsStatus.dataset.state = "ok";
  }
}

function makeChipLabel(nameEn, nameUr, category) {
  const en = nameEn.trim();
  const ur = (nameUr || nameEn).trim();
  const urIsLatin = /^[\x00-\x7F0-9\s.,'/-]+$/.test(ur);

  if (urIsLatin) {
    const templates = {
      mall: { en: `Near ${en}`, ur: `${en} کے سامنے` },
      hospital: { en: `Near ${en}`, ur: `${en} کے پاس` },
      worship: { en: `Near ${en}`, ur: `${en} کے قریب` },
      school: { en: `Near ${en}`, ur: `${en} کے پاس` },
      park: { en: `Near ${en}`, ur: `${en} کے قریب` },
      market: { en: `Near ${en}`, ur: `${en} کے قریب` },
      area: { en: `In ${en}`, ur: `${en} میں` },
      place: { en: `Near ${en}`, ur: `${en} کے قریب` },
    };
    const t = templates[category] || templates.place;
    return { en: t.en, ur: t.ur, nameEn: en, nameUr: ur };
  }

  const templates = {
    mall: { en: `Near ${en}`, ur: `${ur} کے سامنے` },
    hospital: { en: `Near ${en}`, ur: `${ur} کے پاس` },
    worship: { en: `Near ${en}`, ur: `${ur} کے قریب` },
    school: { en: `Near ${en}`, ur: `${ur} کے پاس` },
    park: { en: `Near ${en}`, ur: `${ur} کے قریب` },
    market: { en: `Near ${en}`, ur: `${ur} کے قریب` },
    area: { en: `In ${en}`, ur: `${ur} میں` },
    place: { en: `Near ${en}`, ur: `${ur} کے قریب` },
  };
  const t = templates[category] || templates.place;
  return { en: t.en, ur: t.ur, nameEn: en, nameUr: ur };
}

function categoryLabel(category) {
  const labels = {
    mall: { en: "Mall", ur: "مال" },
    hospital: { en: "Hospital", ur: "ہسپتال" },
    worship: { en: "Mosque", ur: "مسجد" },
    school: { en: "School", ur: "سکول" },
    park: { en: "Park", ur: "پارک" },
    market: { en: "Market", ur: "مارکیٹ" },
    area: { en: "Area", ur: "علاقہ" },
    place: { en: "Landmark", ur: "مقام" },
  };
  return labels[category] || labels.place;
}

async function fetchNearbyFromServer(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius_m: "1500",
  });
  const res = await fetch(`${API_BASE}/sos/nearby-places?${params}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const places = (data.places || []).map((p) => {
    const chip = makeChipLabel(p.name_en, p.name_ur, p.category);
    const cat = categoryLabel(p.category);
    return {
      name: p.name_en,
      nameUr: p.name_ur,
      lat: p.lat,
      lon: p.lon,
      distanceKm: p.distance_km,
      category: p.category,
      labelEn: chip.en,
      labelUr: chip.ur,
      catEn: cat.en,
      catUr: cat.ur,
      isLandmark: true,
      source: "osm",
    };
  });
  return { area: data.area || {}, places };
}

function osmCategory(tags) {
  if (tags.shop === "mall" || tags.shop === "supermarket") return "mall";
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "hospital";
  if (tags.amenity === "place_of_worship") return "worship";
  if (tags.amenity === "school" || tags.amenity === "college" || tags.amenity === "university") return "school";
  if (tags.leisure === "park" || tags.leisure === "stadium") return "park";
  if (tags.amenity === "marketplace" || tags.amenity === "pharmacy") return "market";
  if (tags.place) return "area";
  return "place";
}

function mapOsmElement(el, refLat, refLon) {
  const tags = el.tags || {};
  const nameEn = (tags["name:en"] || tags.name || "").trim();
  if (nameEn.length < 3) return null;
  const nameUr = (tags["name:ur"] || nameEn).trim();
  const elLat = el.lat ?? el.center?.lat;
  const elLon = el.lon ?? el.center?.lon;
  if (elLat == null || elLon == null) return null;
  const category = osmCategory(tags);
  const chip = makeChipLabel(nameEn, nameUr, category);
  const cat = categoryLabel(category);
  return {
    name: nameEn,
    nameUr,
    lat: elLat,
    lon: elLon,
    distanceKm: haversineKm(refLat, refLon, elLat, elLon),
    category,
    labelEn: chip.en,
    labelUr: chip.ur,
    catEn: cat.en,
    catUr: cat.ur,
    isLandmark: true,
    source: "osm",
  };
}

const GENERIC_PLACE_NAMES = new Set([
  "hospital", "mosque", "school", "shop", "restaurant", "market", "store", "pharmacy", "park",
]);

function mapPhotonFeature(feature, refLat, refLon, maxKm) {
  const props = feature.properties || {};
  const nameEn = (props.name || "").trim();
  if (nameEn.length < 3 || GENERIC_PLACE_NAMES.has(nameEn.toLowerCase())) return null;
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const elLon = coords[0];
  const elLat = coords[1];
  const distanceKm = haversineKm(refLat, refLon, elLat, elLon);
  if (distanceKm > maxKm) return null;
  if (props.countrycode && props.countrycode.toUpperCase() !== "PK") return null;
  if (["highway", "landuse", "boundary"].includes(props.osm_key)) return null;
  const tags = {};
  if (props.osm_key && props.osm_value) tags[props.osm_key] = props.osm_value;
  const category = osmCategory(tags);
  const chip = makeChipLabel(nameEn, nameEn, category);
  const cat = categoryLabel(category);
  return {
    name: nameEn,
    nameUr: nameEn,
    lat: elLat,
    lon: elLon,
    distanceKm,
    category,
    labelEn: chip.en,
    labelUr: chip.ur,
    catEn: cat.en,
    catUr: cat.ur,
    isLandmark: true,
    source: "photon",
  };
}

async function fetchPhotonDirect(lat, lon, radiusM = 1500, searchTerms = []) {
  const maxKm = radiusM / 1000;
  const queries = searchTerms.length ? searchTerms : ["Karachi"];
  const seen = new Set();
  const places = [];
  for (const query of queries) {
    try {
      const params = new URLSearchParams({ q: query, lat: String(lat), lon: String(lon), limit: "20" });
      const res = await fetch(`https://photon.komoot.io/api/?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const feature of data.features || []) {
        const loc = mapPhotonFeature(feature, lat, lon, maxKm);
        if (!loc) continue;
        const key = loc.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        places.push(loc);
      }
    } catch (_) {}
  }
  return places.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, NEARBY_LOCATION_LIMIT);
}

async function fetchOsmDirect(lat, lon, radiusM = 1500) {
  const query = `
    [out:json][timeout:15];
    (
      nwr["name"]["shop"~"mall|supermarket|department_store"](around:${radiusM},${lat},${lon});
      nwr["name"]["amenity"~"hospital|clinic|pharmacy|school|college|university|place_of_worship|marketplace|bus_station"](around:${radiusM},${lat},${lon});
      nwr["name"]["leisure"~"park|stadium|playground"](around:${radiusM},${lat},${lon});
      node["name"]["place"~"suburb|neighbourhood|quarter|locality"](around:${radiusM},${lat},${lon});
    );
    out center 30;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const seen = new Set();
      const places = (data.elements || [])
        .map((el) => mapOsmElement(el, lat, lon))
        .filter(Boolean)
        .filter((loc) => {
          const key = loc.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, NEARBY_LOCATION_LIMIT);
      if (places.length) return places;
    } catch (_) {}
  }
  return [];
}

async function fetchNearbyPlaces(lat, lon) {
  let result = null;
  try {
    result = await fetchNearbyFromServer(lat, lon);
    if (result.places?.length) return result;
  } catch (_) {}

  const searchTerms = [result?.area?.en, result?.area?.ur]
    .filter(Boolean)
    .flatMap((s) => s.split(",").map((p) => p.trim()))
    .filter((s) => s.length > 2);

  let places = await fetchOsmDirect(lat, lon);
  if (places.length < 3) {
    const photon = await fetchPhotonDirect(lat, lon, 1500, searchTerms);
    const seen = new Set(places.map((p) => p.name.toLowerCase()));
    photon.forEach((p) => {
      if (!seen.has(p.name.toLowerCase())) places.push(p);
    });
    places.sort((a, b) => a.distanceKm - b.distanceKm);
  }
  if (places.length < 3) {
    const wider = await fetchPhotonDirect(lat, lon, 3000, searchTerms);
    const seen = new Set(places.map((p) => p.name.toLowerCase()));
    wider.forEach((p) => {
      if (!seen.has(p.name.toLowerCase())) places.push(p);
    });
    places.sort((a, b) => a.distanceKm - b.distanceKm);
  }
  return { area: result?.area || {}, places: places.slice(0, NEARBY_LOCATION_LIMIT) };
}

function renderLocationChips(locations) {
  els.locationGrid.innerHTML = "";
  if (!locations.length) {
    els.locationGrid.innerHTML = '<p class="picker-empty">No nearby places found — check GPS or try again<br/><span dir="rtl">قریبی جگہ نہیں ملی — GPS چیک کریں</span></p>';
    return;
  }
  locations.forEach((loc) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `location-chip${loc.isLandmark ? " is-landmark" : ""}`;
    const dist = formatDistance(loc.distanceKm);
    const labelEn = loc.labelEn || `Near ${loc.name}`;
    const labelUr = loc.labelUr || `${loc.nameUr || loc.name} کے قریب`;
    const catEn = loc.catEn || "Place";
    const catUr = loc.catUr || "مقام";
    btn.innerHTML = `
      <span class="chip-en">${escapeHtml(labelEn)}</span>
      <span class="chip-ur" dir="rtl">${escapeHtml(labelUr)}</span>
      <span class="chip-meta">${escapeHtml(catEn)} · ${escapeHtml(catUr)} · ${dist}</span>
    `;
    btn.addEventListener("click", () => {
      setLandmark({ en: labelEn, ur: labelUr });
      els.locationPicker.hidden = true;
      setStatus(`Tagged: ${labelEn}`);
    });
    els.locationGrid.appendChild(btn);
  });
}

let pickerRequestId = 0;

async function buildLocationPicker() {
  const requestId = ++pickerRequestId;
  const ref = getLocationReference();
  const labelEn = $("pickerLabelEn");
  const labelUr = $("pickerLabelUr");
  const detectedEl = $("pickerDetectedArea");

  if (!ref) {
    if (labelEn) labelEn.textContent = "Allow GPS to see nearby landmarks";
    if (labelUr) labelUr.textContent = "قریبی مقامات کے لیے GPS آن کریں";
    if (detectedEl) detectedEl.hidden = true;
    renderLocationChips([]);
    return;
  }

  if (labelEn) labelEn.textContent = "Near you — famous places";
  if (labelUr) labelUr.textContent = "آپ کے قریب — مشہور جگہیں";
  if (detectedEl) {
    detectedEl.hidden = false;
    detectedEl.innerHTML = `<span class="chip-en">📍 Detecting your area…</span><span class="chip-ur" dir="rtl">📍 آپ کا علاقہ تلاش ہو رہا ہے…</span>`;
  }

  els.locationGrid.innerHTML = '<p class="picker-loading">Finding nearby places from map…<br/><span dir="rtl">نقشے سے قریبی جگہیں تلاش ہو رہی ہیں…</span></p>';

  let locations = [];
  let detectedArea = null;

  if (navigator.onLine) {
    try {
      const result = await fetchNearbyPlaces(ref.lat, ref.lon);
      detectedArea = result.area;
      locations = result.places;
      if (requestId !== pickerRequestId) return;
    } catch (_) {}
  }

  if (requestId !== pickerRequestId) return;

  if (!locations.length) {
    els.locationGrid.innerHTML = `
      <p class="picker-empty">
        Could not load nearby places — tap to retry
        <br/><span dir="rtl">قریبی جگہیں لوڈ نہیں ہوئیں — دوبارہ کوشش کریں</span>
        <br/><button type="button" class="btn btn-ghost btn-sm picker-retry" id="pickerRetryBtn">↻ Retry</button>
      </p>`;
    $("pickerRetryBtn")?.addEventListener("click", () => buildLocationPicker());
    if (detectedEl) {
      detectedEl.innerHTML = `<span class="chip-en">📍 GPS: ${formatCoords(ref.lat, ref.lon)}</span>`;
    }
    return;
  }

  if (detectedEl) {
    if (detectedArea?.en || detectedArea?.ur) {
      detectedEl.innerHTML = `
        <span class="chip-en">📍 Detected: ${escapeHtml(detectedArea.en || detectedArea.ur)}</span>
        <span class="chip-ur" dir="rtl">📍 پتہ لگا: ${escapeHtml(detectedArea.ur || detectedArea.en)}</span>
      `;
    } else {
      detectedEl.innerHTML = `<span class="chip-en">📍 GPS: ${formatCoords(ref.lat, ref.lon)}</span>`;
    }
  }

  renderLocationChips(locations);
}

function buildLocationContext() {
  if (!state.gps.landmark) return "";
  const lm = state.gps.landmark;
  if (typeof lm === "object") {
    return `[Location: ${lm.en} | ${lm.ur}] `;
  }
  return `[Location: ${lm}] `;
}

/* ---- Voice recording ---- */

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function setAudioBlob(blob) {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioBlob = blob;
  if (!blob) {
    els.playbackRow.hidden = true;
    els.recordBtn.classList.remove("has-audio");
    return;
  }
  state.audioUrl = URL.createObjectURL(blob);
  els.playbackRow.hidden = false;
  els.recordBtn.classList.add("has-audio");
  const sec = Math.max(1, Math.round((Date.now() - state.recordStartedAt) / 1000));
  els.audioMeta.textContent = `Voice · ${sec}s`;
}

async function startRecording() {
  if (state.recording) return;
  state.wantRecording = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!state.wantRecording) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    state.mediaStream = stream;
    state.mediaRecorder = rec;
    state.chunks = [];
    state.recording = true;
    state.recordStartedAt = Date.now();
    rec.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(state.chunks, { type: rec.mimeType || "audio/webm" });
      if (blob.size) { setAudioBlob(blob); els.recordHint.textContent = "Voice attached"; }
      else { setAudioBlob(null); els.recordHint.textContent = "Hold to record"; }
    };
    rec.start();
    els.recordBtn.classList.add("is-recording");
    els.recordHint.hidden = true;
    els.recordTimer.hidden = false;
    state.timerId = setInterval(() => {
      els.recordTimer.textContent = formatClock(Date.now() - state.recordStartedAt);
    }, 200);
  } catch {
    setStatus("Microphone permission needed", "error");
  }
}

function stopRecording() {
  state.wantRecording = false;
  if (!state.recording) return;
  state.recording = false;
  clearInterval(state.timerId);
  els.recordBtn.classList.remove("is-recording");
  els.recordHint.hidden = false;
  els.recordTimer.hidden = true;
  if (state.mediaRecorder?.state !== "inactive") state.mediaRecorder.stop();
}

function bindRecordButton() {
  let hold = false;
  const end = () => { if (!hold) return; hold = false; stopRecording(); };
  els.recordBtn.addEventListener("pointerdown", (e) => {
    hold = true;
    els.recordBtn.setPointerCapture(e.pointerId);
    startRecording();
  });
  els.recordBtn.addEventListener("pointerup", end);
  els.recordBtn.addEventListener("pointercancel", end);
}

function togglePlayback() {
  if (!state.audioUrl) return;
  if (!state.playbackAudio) {
    state.playbackAudio = new Audio(state.audioUrl);
    state.playbackAudio.onended = () => { els.playBtn.textContent = "Play voice"; };
  }
  if (!state.playbackAudio.paused) {
    state.playbackAudio.pause();
    els.playBtn.textContent = "Play voice";
  } else {
    state.playbackAudio.play();
    els.playBtn.textContent = "Stop";
  }
}

/* ---- SOS Submit ---- */

async function submitSos() {
  if (state.gps.latitude == null) {
    setStatus("Need location first", "error");
    return;
  }
  const text = els.emergencyText.value.trim();
  if (!text && !state.audioBlob) {
    setStatus("Add text or record voice", "error");
    return;
  }

  els.submitSosBtn.disabled = true;
  const sosId = newSosId();
  const contextPrefix = buildLocationContext();
  const payload = {
    sos_id: sosId,
    type: state.audioBlob ? "voice" : "text",
    sender_id: getSenderId(),
    emergency_text: `${contextPrefix}${text || "Voice SOS — pending transcription"}`.trim(),
    audioBlob: state.audioBlob,
    latitude: state.gps.latitude,
    longitude: state.gps.longitude,
    people_count: state.peopleCount,
    category: state.emergencyType,
    client_timestamp: new Date().toISOString(),
    retryCount: 0,
    created_at: Date.now(),
  };

  try {
    await queueAndSubmit(payload);
    els.emergencyText.value = "";
    setAudioBlob(null);
    els.recordHint.textContent = "Hold to record";
  } catch {
    setStatus("Could not save SOS", "error");
  } finally {
    els.submitSosBtn.disabled = false;
  }
}

/* ---- Live transcribe (existing) ---- */

async function startLiveTranscribe() {
  if (state.isLive) return;
  if (state.gps.latitude == null) { setStatus("Need location first", "error"); return; }
  if (!state.backendReachable) { setStatus("Live transcribe needs connection", "error"); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const targetRate = 16000;
    const inputRate = audioCtx.sampleRate;
    let pcmBuffer = [];
    state.livePcmBuffer = pcmBuffer;
    let samplesSinceSend = 0;

    processor.onaudioprocess = (event) => {
      if (!state.isLive || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const ratio = inputRate / targetRate;
      const outLen = Math.round(input.length / ratio);
      const ds = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const idx = i * ratio;
        const lo = Math.floor(idx);
        ds[i] = input[lo];
      }
      for (let i = 0; i < ds.length; i++) pcmBuffer.push(ds[i]);
      samplesSinceSend += outLen;
      if (samplesSinceSend >= targetRate * 4 && pcmBuffer.length >= targetRate * 2) {
        samplesSinceSend = 0;
        const start = Math.max(0, pcmBuffer.length - targetRate * 8);
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
      sender_id: getSenderId(),
      latitude: String(state.gps.latitude),
      longitude: String(state.gps.longitude),
      people_count: String(state.peopleCount),
    });
    const wsScheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsScheme}//${location.host}/sos/ws/listen?${params}`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.transcript) els.liveTranscriptText.textContent = msg.transcript;
      if (msg.status === "report_saved") {
        const div = document.createElement("div");
        div.className = "server-msg";
        div.textContent = `Saved ${msg.sos_id.slice(0, 8)}… · ${msg.severity}`;
        els.liveServerMsgs.appendChild(div);
      }
    };
    ws.onclose = () => { if (state.isLive) stopLiveTranscribe(); };

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
  } catch {
    setStatus("Microphone permission needed", "error");
  }
}

function stopLiveTranscribe() {
  state.isLive = false;
  if (state.liveProcessorNode) state.liveProcessorNode.disconnect();
  if (state.liveAudioCtx) state.liveAudioCtx.close().catch(() => {});
  if (state.liveStream) state.liveStream.getTracks().forEach((t) => t.stop());
  const ws = state.ws;
  state.ws = null;
  setTimeout(() => { if (ws?.readyState === WebSocket.OPEN) ws.close(); }, 2000);
  els.liveBtn.textContent = "Start Live Transcribe";
  els.liveBtn.classList.remove("is-active");
}

/* ---- Auth ---- */

function showAuthMsg(msg, ok) {
  const el = $("authMsg");
  el.textContent = msg;
  el.className = ok ? "auth-msg auth-ok" : "auth-msg auth-err";
}

async function doRegister(e) {
  e.preventDefault();
  const body = {
    username: $("regUser").value.trim(),
    email: $("regEmail").value.trim(),
    password: $("regPass").value,
    full_name: $("regName").value.trim(),
    organization: $("regOrg").value.trim(),
    license_id: $("regLicense").value.trim() || null,
  };
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { showAuthMsg(data.detail || "Registration failed", false); return; }
  showAuthMsg(`Registered as ${data.username}. Log in now.`, true);
  $("tabLogin").click();
}

async function doLogin(e) {
  e.preventDefault();
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent($("loginUser").value.trim())}&password=${encodeURIComponent($("loginPass").value)}`,
  });
  const data = await res.json();
  if (!res.ok) { showAuthMsg(data.detail || "Login failed", false); return; }
  localStorage.setItem(TOKEN_KEY, data.access_token);
  showAuthMsg("", true);
  await loadProfile();
  startDashboardRefresh();
}

function doLogout() {
  localStorage.removeItem(TOKEN_KEY);
  stopDashboardRefresh();
  $("responderProfile").hidden = true;
  $("authForms").hidden = false;
  els.dashboard.hidden = true;
}

async function loadProfile() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  if (!res.ok) { localStorage.removeItem(TOKEN_KEY); return; }
  const data = await res.json();
  $("responderName").textContent = data.full_name;
  $("responderOrg").textContent = data.organization;
  $("responderRole").textContent = `Role: ${data.role}`;
  $("responderProfile").hidden = false;
  $("authForms").hidden = true;
  els.dashboard.hidden = false;
  await loadReports();
}

/* ---- Incidents (cluster + duplicate merge) ---- */

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
const INCIDENT_CLUSTER_KM = 0.5;

function worstSeverity(reports) {
  return reports.reduce(
    (best, r) => (SEV_RANK[(r.severity || "unknown").toLowerCase()] > SEV_RANK[best] ? (r.severity || "unknown").toLowerCase() : best),
    "unknown"
  );
}

function dominantCategory(reports) {
  const counts = {};
  reports.forEach((r) => {
    const cat = r.category || "other";
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
}

function buildIncidents(reports) {
  const duplicatesByRoot = {};
  reports
    .filter((r) => r.is_duplicate && r.duplicate_of)
    .forEach((r) => {
      if (!duplicatesByRoot[r.duplicate_of]) duplicatesByRoot[r.duplicate_of] = [];
      duplicatesByRoot[r.duplicate_of].push(r);
    });

  const active = reports.filter((r) => !r.is_duplicate);
  const processed = new Set();
  const incidents = [];
  let incidentNum = 0;

  for (const report of active) {
    if (processed.has(report.sos_id)) continue;

    const clusterMembers = [report];
    processed.add(report.sos_id);

    if (report.latitude != null && report.longitude != null) {
      for (const other of active) {
        if (processed.has(other.sos_id) || other.latitude == null) continue;
        if (haversineKm(report.latitude, report.longitude, other.latitude, other.longitude) <= INCIDENT_CLUSTER_KM) {
          clusterMembers.push(other);
          processed.add(other.sos_id);
        }
      }
    }

    const allReports = [];
    clusterMembers.forEach((m) => {
      allReports.push(m);
      (duplicatesByRoot[m.sos_id] || []).forEach((d) => allReports.push(d));
    });

    const withGps = allReports.filter((r) => r.latitude != null && r.longitude != null);
    const lat = withGps.length
      ? withGps.reduce((s, r) => s + r.latitude, 0) / withGps.length
      : report.latitude;
    const lon = withGps.length
      ? withGps.reduce((s, r) => s + r.longitude, 0) / withGps.length
      : report.longitude;

    const duplicateCount = allReports.filter((r) => r.is_duplicate).length;
    const lead = clusterMembers[0];

    incidents.push({
      id: ++incidentNum,
      leadId: lead.sos_id,
      members: allReports,
      clusterMembers,
      reportCount: allReports.length,
      duplicateCount,
      totalPeople: allReports.reduce((s, r) => s + (r.people_count || 1), 0),
      worstSeverity: worstSeverity(allReports),
      dominantCategory: dominantCategory(allReports),
      lat,
      lon,
      dispatch_status: lead.dispatch_status,
      responders_allocated: allReports.find((r) => r.responders_allocated)?.responders_allocated,
      command_rank: allReports.find((r) => r.command_rank != null)?.command_rank,
      ai_reasoning: lead.ai_reasoning,
      isMerged: duplicateCount > 0 || allReports.length > 1,
      mergeNote:
        duplicateCount > 0
          ? `AI merged ${duplicateCount} duplicate report${duplicateCount > 1 ? "s" : ""} from the same incident`
          : allReports.length > 1
          ? `${allReports.length} reports clustered within 500 m`
          : null,
    });
  }

  return incidents.sort((a, b) => SEV_RANK[b.worstSeverity] - SEV_RANK[a.worstSeverity]);
}

function enrichIncidentsWithAgentLogs(incidents, logs) {
  const clusterLogs = logs
    .filter((l) => l.agent_name === "cluster")
    .map((l) => {
      let decision = {};
      try { decision = JSON.parse(l.decision || "{}"); } catch (_) {}
      return { ...l, decision };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const used = new Set();
  incidents.forEach((inc) => {
    const match = clusterLogs.find(
      (l) => !used.has(l.log_id) && l.cluster_size === inc.reportCount
    ) || clusterLogs.find(
      (l) => !used.has(l.log_id) && l.cluster_size === inc.clusterMembers.length
    );
    if (!match) return;
    used.add(match.log_id);
    inc.clusterReasoning = match.decision.reasoning || match.recommended_action;
    inc.recommendedAction = match.decision.recommended_action || match.recommended_action;
    inc.severityScore = match.decision.severity_score;
    inc.resourcesNeeded = match.decision.estimated_resources_needed;
  });
}

function formatActionLabel(action) {
  const labels = {
    dispatch_now: "Dispatch immediately",
    monitor: "Monitor situation",
    needs_more_info: "Needs more information",
  };
  return labels[action] || action || "Pending triage";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---- Dashboard ---- */

function severityClass(sev) {
  return `sev-${(sev || "unknown").toLowerCase()}`;
}

async function loadReports() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const status = $("filterStatus").value;
  const severity = $("filterSeverity").value;
  const params = new URLSearchParams({ skip: "0", limit: "50" });
  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);

  try {
    const [reportsRes, logsRes] = await Promise.all([
      fetch(`${API_BASE}/sos/reports?${params}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/sos/agent-logs?limit=50`, { headers: authHeaders() }),
    ]);
    if (!reportsRes.ok) return;
    state.reports = await reportsRes.json();
    state.agentLogs = logsRes.ok ? await logsRes.json() : [];
    state.incidents = buildIncidents(state.reports);
    enrichIncidentsWithAgentLogs(state.incidents, state.agentLogs);
    renderReports();
    renderMapMarkers();
  } catch (_) {}
}

function renderIncidentReportsList(incident) {
  return incident.members
    .map((r) => {
      const dupTag = r.is_duplicate ? '<span class="dup-tag">duplicate</span>' : "";
      return `
        <li class="incident-report-item">
          <div class="incident-report-top">
            <span class="report-id">${r.sos_id.slice(0, 8)}…</span>
            <span class="severity-badge ${severityClass(r.severity)}">${r.severity || "unknown"}</span>
            ${dupTag}
          </div>
          <p class="incident-report-text">${escapeHtml((r.emergency_text || "—").slice(0, 120))}</p>
          <p class="incident-report-meta">${r.category} · ${r.people_count} people · ${formatTime(r.client_timestamp || r.timestamp)}</p>
        </li>
      `;
    })
    .join("");
}

function renderReports() {
  els.reportsList.innerHTML = "";
  els.reportsEmpty.hidden = state.incidents.length > 0;

  state.incidents.forEach((inc) => {
    const card = document.createElement("article");
    card.className = `incident-card${inc.isMerged ? " is-merged" : ""}`;
    const reasoning = inc.clusterReasoning || inc.ai_reasoning || "Awaiting AI triage…";
    const action = inc.recommendedAction ? formatActionLabel(inc.recommendedAction) : null;

    card.innerHTML = `
      <div class="incident-header">
        <div class="incident-badges">
          ${inc.isMerged ? `<span class="merge-badge">🔗 Merged Incident #${inc.id}</span>` : `<span class="incident-badge">Incident #${inc.id}</span>`}
          <span class="severity-badge ${severityClass(inc.worstSeverity)}">${inc.worstSeverity}</span>
          ${inc.command_rank != null ? `<span class="rank-badge">Rank #${inc.command_rank}</span>` : ""}
        </div>
        <span class="incident-count">${inc.reportCount} report${inc.reportCount > 1 ? "s" : ""}</span>
      </div>
      <h3 class="incident-title">
        <span class="incident-stat">${inc.totalPeople} people</span>
        <span class="incident-dot">·</span>
        <span class="incident-stat">${inc.reportCount} reports</span>
        <span class="incident-dot">·</span>
        <span class="incident-stat">${inc.dominantCategory}</span>
      </h3>
      ${inc.mergeNote ? `<p class="incident-merge-note">${escapeHtml(inc.mergeNote)}</p>` : ""}
      <div class="incident-ai-box">
        <div class="ai-box-head">🤖 AI reasoning</div>
        <p class="ai-box-text">${escapeHtml(reasoning)}</p>
        ${action ? `<div class="ai-box-action">→ ${escapeHtml(action)}</div>` : ""}
        ${inc.resourcesNeeded ? `<div class="ai-box-resources">Resources: ${escapeHtml(inc.resourcesNeeded)}</div>` : ""}
        ${inc.severityScore != null ? `<div class="ai-box-score">Cluster urgency score: <strong>${inc.severityScore}/100</strong></div>` : ""}
      </div>
      ${inc.responders_allocated ? `<p class="incident-allocated">🚑 ${escapeHtml(inc.responders_allocated)}</p>` : ""}
      <details class="incident-details" ${inc.isMerged ? "open" : ""}>
        <summary>View ${inc.reportCount} report${inc.reportCount > 1 ? "s" : ""}</summary>
        <ul class="incident-reports-list">${renderIncidentReportsList(inc)}</ul>
      </details>
      <div class="report-actions">
        <select class="status-select" data-id="${inc.leadId}">
          ${["pending", "dispatched", "escalated", "monitoring", "needs_info"].map((s) =>
            `<option value="${s}" ${inc.dispatch_status === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </div>
    `;

    card.querySelector(".status-select").addEventListener("change", async (e) => {
      await Promise.all(
        inc.members.map((r) =>
          fetch(`${API_BASE}/sos/cases/${r.sos_id}`, {
            method: "PATCH",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ dispatch_status: e.target.value }),
          })
        )
      );
      setStatus("Incident status updated", "saved");
      loadReports();
    });

    els.reportsList.appendChild(card);
  });
}

async function loadAgentLogs() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const res = await fetch(`${API_BASE}/sos/agent-logs?limit=50`, { headers: authHeaders() });
  if (!res.ok) return;
  state.agentLogs = await res.json();
  els.agentLogsList.innerHTML = "";
  els.logsEmpty.hidden = state.agentLogs.length > 0;
  state.agentLogs.forEach((log) => {
    let decision = {};
    try { decision = JSON.parse(log.decision || "{}"); } catch (_) {}
    const el = document.createElement("article");
    el.className = "log-card";
    el.innerHTML = `
      <div class="log-top"><strong>${escapeHtml(log.agent_name)}</strong> · ${formatTime(log.timestamp)}</div>
      <p class="log-meta">Cluster size: ${log.cluster_size} reports</p>
      ${decision.reasoning ? `<p class="log-reasoning">"${escapeHtml(decision.reasoning)}"</p>` : ""}
      <p class="log-action">${escapeHtml(log.recommended_action || decision.recommended_action || "—")}</p>
      ${decision.severity_score != null ? `<p class="log-score">Urgency: ${decision.severity_score}/100</p>` : ""}
    `;
    els.agentLogsList.appendChild(el);
  });
}

/* ---- Map ---- */

const SEV_COLORS = { critical: "#ff3b30", high: "#ff9f0a", medium: "#ffd60a", low: "#30d158", unknown: "#8b9cb8" };
const MAP_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function addMapTiles(map) {
  L.tileLayer(MAP_TILES, {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

function makeRescueIcon(severity) {
  const sev = (severity || "unknown").toLowerCase();
  return L.divIcon({
    className: "",
    html: `<div class="rescue-pin ${sev}"></div>`,
    iconSize: [36, 48],
    iconAnchor: [18, 48],
    popupAnchor: [0, -48],
  });
}

function makeUserIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="user-pin"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function updateVictimMap(lat, lon) {
  const wrap = $("victimMapWrap");
  const container = $("victimMap");
  if (!wrap || !container) return;

  wrap.hidden = false;

  if (!state.victimMap) {
    state.victimMap = L.map(container, {
      center: [lat, lon],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    });
    addMapTiles(state.victimMap);
  }

  state.victimMap.setView([lat, lon], 16);

  if (state.victimMarker) {
    state.victimMap.removeLayer(state.victimMarker);
  }
  state.victimMarker = L.marker([lat, lon], { icon: makeUserIcon() }).addTo(state.victimMap);

  setTimeout(() => state.victimMap?.invalidateSize(), 150);
}

function initMap() {
  if (state.map) {
    state.map.invalidateSize();
    return;
  }
  state.map = L.map(els.mapContainer, {
    center: [24.8607, 67.0011],
    zoom: 13,
    zoomControl: true,
  });
  addMapTiles(state.map);
  state.markerCluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
  });
  state.map.addLayer(state.markerCluster);
}

function makeClusterBubbleIcon(incident) {
  const sev = (incident.worstSeverity || "unknown").toLowerCase();
  return L.divIcon({
    className: "",
    html: `
      <div class="cluster-bubble ${sev}">
        <div class="cluster-bubble-ring"></div>
        <div class="cluster-bubble-inner">
          <div class="cluster-bubble-count">${incident.reportCount}</div>
          <div class="cluster-bubble-people">${incident.totalPeople} ppl</div>
        </div>
      </div>
    `,
    iconSize: [72, 72],
    iconAnchor: [36, 36],
    popupAnchor: [0, -36],
  });
}

function buildClusterPopupHtml(inc) {
  const reasoning = inc.clusterReasoning || inc.ai_reasoning || "Awaiting AI triage…";
  const action = inc.recommendedAction ? formatActionLabel(inc.recommendedAction) : "Pending";
  const reportsList = inc.members
    .slice(0, 4)
    .map((r) => `<li>${escapeHtml((r.emergency_text || "—").slice(0, 60))}${r.is_duplicate ? " <em>(dup)</em>" : ""}</li>`)
    .join("");
  const more = inc.members.length > 4 ? `<li>+${inc.members.length - 4} more…</li>` : "";

  return `
    <div class="cluster-popup">
      <div class="cluster-popup-head">
        ${inc.isMerged ? "🔗" : "📍"} Incident #${inc.id}
        <span class="cluster-popup-sub">— ${inc.reportCount} reports${inc.duplicateCount ? ` (${inc.duplicateCount} merged)` : ""}</span>
      </div>
      <div class="cluster-popup-stats">
        <span class="popup-stat">${inc.totalPeople} people</span>
        <span class="popup-stat">${inc.dominantCategory}</span>
        <span class="popup-stat sev-${inc.worstSeverity}">${(inc.worstSeverity || "unknown").toUpperCase()}</span>
      </div>
      ${inc.mergeNote ? `<p class="cluster-popup-merge">${escapeHtml(inc.mergeNote)}</p>` : ""}
      <div class="cluster-popup-ai">
        <div class="popup-ai-label">🤖 AI reasoning</div>
        <p>${escapeHtml(reasoning)}</p>
      </div>
      <div class="cluster-popup-action">
        <strong>Recommended:</strong> ${escapeHtml(action)}
        ${inc.resourcesNeeded ? `<br/><span class="popup-resources">${escapeHtml(inc.resourcesNeeded)}</span>` : ""}
      </div>
      <ul class="cluster-popup-reports">${reportsList}${more}</ul>
    </div>
  `;
}

function buildPopupHtml(r) {
  const sev = (r.severity || "unknown").toUpperCase();
  return `
    <div class="map-popup-title">${sev} · ${r.category || "SOS"}</div>
    <div>${(r.emergency_text || "No description").slice(0, 140)}</div>
    <div class="map-popup-meta">
      👥 ${r.people_count} people · ${r.dispatch_status}<br/>
      📍 ${r.latitude != null ? formatCoords(r.latitude, r.longitude) : "No GPS"}
    </div>
  `;
}

function renderMapMarkers() {
  if (!state.map) initMap();
  state.markerCluster.clearLayers();
  const bounds = [];

  if (!state.incidents.length && state.reports.length) {
    state.incidents = buildIncidents(state.reports);
    enrichIncidentsWithAgentLogs(state.incidents, state.agentLogs);
  }

  state.incidents.forEach((inc) => {
    if (inc.lat == null || inc.lon == null) return;
    const latlng = [inc.lat, inc.lon];
    bounds.push(latlng);

    if (inc.isMerged) {
      const marker = L.marker(latlng, { icon: makeClusterBubbleIcon(inc) });
      marker.bindPopup(buildClusterPopupHtml(inc), { maxWidth: 300, className: "cluster-popup-wrap" });
      state.markerCluster.addLayer(marker);
      return;
    }

    const r = inc.members[0];
    const marker = L.marker(latlng, { icon: makeRescueIcon(r.severity) });
    marker.bindPopup(buildPopupHtml(r), { maxWidth: 260 });
    state.markerCluster.addLayer(marker);
  });

  if (bounds.length === 1) {
    state.map.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  setTimeout(() => state.map?.invalidateSize(), 120);
}

function fitAllMarkers() {
  if (!state.map || !state.incidents.length) return;
  const bounds = state.incidents
    .filter((inc) => inc.lat != null && inc.lon != null)
    .map((inc) => [inc.lat, inc.lon]);
  if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

function startDashboardRefresh() {
  stopDashboardRefresh();
  state.refreshTimer = setInterval(() => {
    if (!els.dashboard.hidden) loadReports();
  }, 15000);
}

function stopDashboardRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
}

/* ---- UI wiring ---- */

function setupTypePicker() {
  document.querySelectorAll(".type-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".type-chip").forEach((c) => c.classList.remove("is-selected"));
      chip.classList.add("is-selected");
      state.emergencyType = chip.dataset.type;
    });
  });
}

function setupMainTabs() {
  document.querySelectorAll(".main-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".main-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      const view = tab.dataset.view;
      els.viewSos.hidden = view !== "sos";
      els.viewResponder.hidden = view !== "responder";
      if (view === "responder" && !els.dashboard.hidden) loadReports();
    });
  });
}

function setupDashTabs() {
  document.querySelectorAll(".dash-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".dash-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      const dash = tab.dataset.dash;
      $("dash-reports").hidden = dash !== "reports";
      $("dash-map").hidden = dash !== "map";
      $("dash-logs").hidden = dash !== "logs";
      if (dash === "map") { initMap(); renderMapMarkers(); setTimeout(() => state.map?.invalidateSize(), 100); }
      if (dash === "logs") loadAgentLogs();
    });
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function setupAuthTabs() {
  const loginForm = $("loginForm");
  const registerForm = $("registerForm");
  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");

  function showLogin() {
    tabLogin.classList.add("is-active");
    tabRegister.classList.remove("is-active");
    loginForm.hidden = false;
    registerForm.hidden = true;
  }

  function showRegister() {
    tabRegister.classList.add("is-active");
    tabLogin.classList.remove("is-active");
    registerForm.hidden = false;
    loginForm.hidden = true;
  }

  tabLogin.addEventListener("click", showLogin);
  tabRegister.addEventListener("click", showRegister);
  showLogin();
}

function init() {
  cacheEls();
  state.lastSyncAt = Number(localStorage.getItem(LAST_SYNC_KEY)) || null;

  setupMainTabs();
  setupDashTabs();
  setupTypePicker();
  buildLocationPicker();
  bindRecordButton();

  els.retryGps.addEventListener("click", captureGps);
  els.pickLocation.addEventListener("click", () => {
    els.locationPicker.hidden = !els.locationPicker.hidden;
    if (!els.locationPicker.hidden) {
      captureGps(true);
      if (state.gps.latitude != null) buildLocationPicker();
    }
  });
  els.peopleMinus.addEventListener("click", () => { state.peopleCount = Math.max(1, state.peopleCount - 1); els.peopleCount.textContent = String(state.peopleCount); });
  els.peoplePlus.addEventListener("click", () => { state.peopleCount = Math.min(MAX_PEOPLE, state.peopleCount + 1); els.peopleCount.textContent = String(state.peopleCount); });
  els.playBtn.addEventListener("click", togglePlayback);
  els.clearAudioBtn.addEventListener("click", () => { setAudioBlob(null); els.recordHint.textContent = "Hold to record"; });
  els.submitSosBtn.addEventListener("click", submitSos);
  els.liveBtn.addEventListener("click", () => state.isLive ? stopLiveTranscribe() : startLiveTranscribe());

  setupAuthTabs();
  $("loginForm").addEventListener("submit", doLogin);
  $("registerForm").addEventListener("submit", doRegister);
  $("logoutBtn").addEventListener("click", doLogout);
  $("refreshReports").addEventListener("click", loadReports);
  $("refreshLogs").addEventListener("click", loadAgentLogs);
  $("filterStatus").addEventListener("change", loadReports);
  $("filterSeverity").addEventListener("change", loadReports);
  $("fitMapBtn")?.addEventListener("click", fitAllMarkers);

  captureGps();
  registerServiceWorker();
  startConnectionMonitor();
  loadProfile();
}

init();
