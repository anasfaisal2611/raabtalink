# RaabtaLink — Teammate Handoff Document

## What This Project Is

RaabtaLink is an **offline-first Progressive Web App (PWA)** for emergency SOS scenarios in disaster-struck areas with no internet. Victims record voice SOS + GPS from their phones; the system transcribes, triages, clusters duplicates, and prioritises rescue dispatch — all using local AI models (Ollama + Whisper). Healthcare responders log in to a dashboard to view and manage cases.

---

## Part 1: What's Already Built (Backend — DONE)

All backend work is complete. The server runs on FastAPI + PostgreSQL, everything is 100% local/offline.

### Architecture

```
raabta/
  app/
    main.py                  → FastAPI app, CORS, static file mount for /app
    db.py                    → PostgreSQL engine + session management
    models.py                → SOSReport, AgentLog, Responder models + enums
    routers/
      sos.py                 → POST /sos, POST /voice, WS /ws/listen,
                               GET /reports, GET /agent-logs, PATCH /cases/{id}
      auth.py                → POST /auth/register, POST /auth/login, GET /auth/me
    services/
      auth_service.py        → bcrypt hashing, JWT create/verify, role guards
      triage_service.py      → Ollama LLM triage (severity + category)
      clustering_service.py  → Haversine distance, duplicate detection, cluster agent
      whisper_service.py     → faster-whisper (small model), file + PCM byte transcription
      geolocation_service.py → Offline GPS fallback (hardcoded Karachi coords)
      agents/
        base.py              → Base Agent class (_reason, _log_decision, AgentResult)
        agentic_service.py   → Clustering_Agent (scores clusters, decides dispatch)
        command_agent.py     → CommandAgent (ranks all clusters, allocates responders)
```

### API Endpoints (all tested and working)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/sos` | None (public) | Submit text SOS report |
| POST | `/sos/voice` | None (public) | Submit voice SOS (file upload) |
| WebSocket | `/sos/ws/listen` | None (public) | Live real-time voice transcription |
| GET | `/sos/reports` | JWT required | List all SOS reports (filter by status/severity) |
| GET | `/sos/agent-logs` | JWT required | List agent decision logs |
| PATCH | `/sos/cases/{sos_id}` | JWT required | Update dispatch status of a report |
| POST | `/auth/register` | None | Register healthcare responder |
| POST | `/auth/login` | None | Login, returns JWT access token |
| GET | `/auth/me` | JWT required | Get current responder profile |
| GET | `/health` | None | Health check |

### Features Implemented

- **Ollama error handling** — all LLM calls gracefully degrade when Ollama is down
- **Client timestamps** — offline-queued reports carry the time the victim created them
- **Idempotent sos_id** — retrying the same submission doesn't create duplicates
- **Duplicate detection** — finds nearby reports with similar text, marks as duplicate
- **Agentic pipeline** — Clustering Agent scores clusters → Command Agent ranks & allocates responders
- **JWT auth** — healthcare responders register/login, victims are anonymous
- **bcrypt passwords** — direct bcrypt (not passlib, avoids version conflict)
- **Live WebSocket transcription** — 8-second sliding window, final flush on stop
- **Whisper small model** — beam_size=5, vad_filter=True for accurate transcription
- **CORS middleware** — allows frontend on any port to call backend
- **Static file serving** — frontend served at `/app` from same origin (no CORS issues)

### Current Frontend (minimal, needs rebuilding)

```
frontend/
  index.html    → Basic PWA shell with GPS panel, people counter, live transcribe, auth forms
  app.js        → GPS capture, WebSocket audio streaming, auth login/register
  style.css     → Dark theme, responsive mobile-first design
  manifest.json → PWA manifest (name, icons, standalone display)
  sw.js         → Basic service worker (caches static assets, skips WebSocket)
  icons/        → icon.svg, icon-192.png, icon-512.png
```

The current frontend is a **working prototype** — GPS detection, live transcription, and auth login/register all work. But it lacks: offline queueing, IndexedDB, responder dashboard, map view, and proper PWA installability.

---

## Part 2: What Needs to Be Built (Frontend — YOUR TASKS)

### Task 1: Service Worker + manifest.json (Installability + Offline Shell Caching)

**Current state:** `sw.js` exists with basic cache-first strategy. `manifest.json` has name/icons but may not pass PWA installability audit.

**What to do:**
- Audit `manifest.json` against PWA installability requirements (display: standalone, valid icons at 192+512, theme_color, background_color, start_url)
- Ensure icons are actually valid PNGs at the correct sizes (current ones may be placeholders)
- Upgrade `sw.js` to properly cache the app shell (HTML, CSS, JS, fonts) with versioned cache names
- Handle cache invalidation on version bump
- Add offline fallback page (shown when network AND cache both fail)
- Test: Chrome DevTools → Application → PWA installability check → all green

### Task 2: IndexedDB Local Queue for Offline SOS Submissions + Retry/Sync Logic

**Current state:** No IndexedDB usage. When offline, SOS submissions are lost.

**What to do:**
- Create an IndexedDB wrapper (recommend `idb` library or raw IndexedDB API)
- When user submits SOS (text or voice) and device is offline:
  - Store the full payload (emergency_text, GPS coords, people_count, audio blob, client_timestamp, generated sos_id) in an `outbox` object store
  - Show "Saved locally — will send when connected" UI state
- When connection returns (use `navigator.onLine` + `online` event listener):
  - Drain the outbox: POST each queued item to `/sos` or `/sos/voice`
  - On success: remove from IndexedDB, show "Synced" confirmation
  - On failure: keep in queue, retry with exponential backoff
- Show a pending/sync indicator with count of queued items
- Handle duplicate detection: the backend already has idempotent sos_id, so retrying the same sos_id is safe

### Task 3: Victim-Facing SOS UI

**Current state:** Basic UI exists with GPS panel, people counter, live transcribe button. Missing: voice recording for POST /sos/voice, clear submission flow, offline status feedback.

**What to do:**
- Build a clear step-by-step SOS flow:
  1. GPS auto-detected (or manual picker fallback — already built)
  2. People count stepper (already built)
  3. Emergency type selector (medical, fire, trapped, flood, other)
  4. Voice record button (hold-to-record using MediaRecorder API → .webm blob)
  5. OR text input for emergency description
  6. Submit button → sends to POST /sos (text) or POST /sos/voice (audio file)
  7. Confirmation screen: "Report submitted" or "Saved — will send when connected"
- Voice recording:
  - Use `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`
  - Store as `.webm` blob, upload via FormData to `/sos/voice`
  - Show recording timer, waveform visualiser (optional)
- All form data should go to IndexedDB first (Task 2), then sync when online

### Task 4: Responder Dashboard UI

**Current state:** Auth login/register works. After login, nothing is shown except profile info. No dashboard.

**What to do:**
- After successful login, redirect to a dashboard view:
  - **Reports table/list:** GET `/sos/reports` — show all SOS reports with:
    - Severity (colour-coded badge), category, emergency text, GPS coords, people count
    - Dispatch status (with dropdown to update via PATCH `/sos/cases/{id}`)
    - Priority rank, command rank, duplicate flag
    - Timestamp (use `client_timestamp` if available)
  - **Agent logs panel:** GET `/sos/agent-logs` — show clustering and command agent decisions
  - **Filters:** by status, severity, date range
  - **Pagination:** use `skip` and `limit` query params
- JWT token must be sent as `Authorization: Bearer <token>` header on all protected requests
- Store JWT in `localStorage` (already done in current `app.js`)
- Auto-refresh: poll every 10–30 seconds for new reports, or use a "Refresh" button

### Task 5: Leaflet Map View

**Current state:** No map exists. GPS coordinates are stored in reports but never visualised.

**What to do:**
- Use **Leaflet.js** (lightweight, offline-friendly, free — no API key needed)
- Add a map tab/section to the responder dashboard
- Plot each SOS report as a marker at `(latitude, longitude)`
- Colour-code markers by severity (critical=red, high=orange, medium=yellow, low=green)
- Cluster nearby markers using **Leaflet.markercluster** plugin (or manual grouping)
- Click marker → popup with report details (emergency text, people count, status)
- Use free offline tile layer or cache tiles for offline use:
  - Online: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
  - Offline: pre-cache tiles for the expected area, or use a blank base layer
- Map should be centred on the default GPS location (Karachi: 24.8607, 67.0011)

### Task 6: Connection-Status Indicator

**Current state:** A basic "Online/Offline" pill exists in the HTML (`#connectionStatus`), toggled by the `online`/`offline` events.

**What to do:**
- Make it more informative and context-aware:
  - **"Connected to base station"** — online, backend reachable (ping `/health` periodically)
  - **"Queued, out of range"** — offline, items in IndexedDB outbox (show count)
  - **"Syncing..."** — draining the outbox after reconnection
  - **"Last synced: X minutes ago"** — connected but no pending items
- Visual states: green (connected), amber (queued), pulsing blue (syncing)
- Be honest about limitations — if GPS failed, show "Location approximate"
- Show queue count badge: "3 reports waiting to sync"

---

## Part 3: Setup Instructions for Teammate's Device

### Prerequisites

1. **Python 3.11+** — download from https://python.org
2. **PostgreSQL 15+** — download from https://postgresql.org/download/windows/
   - During install, remember the password you set for `postgres` user
   - Note the port (default: 5432)
3. **Node.js 18+** — download from https://nodejs.org (needed for `npx serve` during dev)
4. **Git** — download from https://git-scm.com
5. **Ollama** — download from https://ollama.com
   - After installing, pull the model: `ollama pull qwen2.5:1.5b`

### Step-by-Step Setup

```powershell
# 1. Clone the repository
git clone <repo-url> raabta
cd raabta

# 2. Create Python virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1
# If you get an execution policy error:
# Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Create the database
# Open pgAdmin or psql and create a database called "raabtalink":
# CREATE DATABASE raabtalink;

# 5. Configure .env
# Edit .env and set your PostgreSQL credentials:
# DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/raabtalink"
# SECRET_KEY="any-random-secret-string"
# ALGORITHM="HS256"
# ACCESS_TOKEN_EXPIRE_MINUTES=1440

# 6. Create database tables
cd raabta
..\venv\Scripts\python.exe _fix_db_schema.py

# 7. Start Ollama (in a separate terminal, leave running)
ollama serve
# In another terminal:
ollama pull qwen2.5:1.5b

# 8. Start the backend
cd c:\path\to\raabta\raabta
..\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# 9. Open browser
# Frontend: http://localhost:8000/app
# API docs: http://localhost:8000/docs
```

### Verify It Works

1. Open `http://localhost:8000/docs` — you should see the Swagger UI with all endpoints
2. Open `http://localhost:8000/app` — you should see the PWA frontend
3. Try registering a healthcare responder account
4. Try submitting an SOS report via Swagger (POST /sos)

### Important Notes

- The `.env` file has the database password — **do NOT commit `.env` to git** (it's already in `.gitignore`)
- Ollama must be running for triage and clustering to work; if it's not running, endpoints still work but return "unknown" severity
- The faster-whisper model downloads automatically on first use (~500MB)
- All AI models run 100% locally — no internet needed after initial setup

---

## Part 4: Prompt for Your Teammate's AI Agent

Copy and paste this entire prompt to your teammate's AI coding assistant (Claude, Copilot, Cursor, etc.):

---

> **PROMPT START**
>
> I'm working on the frontend of RaabtaLink, an offline-first emergency SOS Progressive Web App. The backend is fully built and running on FastAPI at `http://localhost:8000`. I need you to build the remaining frontend features.
>
> **Project context:**
> - The frontend is served as a PWA from `http://localhost:8000/app` (same origin as the backend, no CORS issues)
> - The frontend files are in `frontend/` directory: `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, and icons
> - The backend API docs are at `http://localhost:8000/docs` — read the OpenAPI spec there for exact request/response schemas
> - Everything must work OFFLINE after the initial page load (this is for disaster zones with no internet)
> - The app has a dark theme (CSS variables defined in style.css: --bg, --ink, --muted, --gold, --rose, --mint, etc.)
>
> **Current frontend state:**
> - Basic PWA shell with GPS detection (auto + manual picker fallback), people counter, live WebSocket transcription, and healthcare responder login/register
> - Auth login/register works and stores JWT in localStorage
> - GPS capture works with localStorage caching fallback chain
> - Live transcription works via WebSocket with 8-second sliding window audio
>
> **What I need you to build (in this priority order):**
>
> 1. **IndexedDB offline queue** — When the device is offline, store SOS submissions (text, voice audio blob, GPS, people count, timestamp, sos_id) in IndexedDB. When back online, automatically drain the queue by POSTing to `/sos` or `/sos/voice`. The backend supports idempotent sos_id so retries are safe. Use raw IndexedDB API or the `idb` library.
>
> 2. **Victim SOS submission flow** — Build a clear, step-by-step emergency reporting UI:
>    - Step 1: GPS (auto-detected, already built)
>    - Step 2: Emergency type picker (medical, fire, trapped, flood, other)
>    - Step 3: People count (stepper, already built)
>    - Step 4: Voice recording (hold-to-record using MediaRecorder → .webm blob, upload via FormData to POST /sos/voice) OR text input (POST /sos)
>    - Step 5: Submit → store in IndexedDB queue → show "Saved, will send when connected" if offline, or "Report submitted" if online
>    - Use the existing CSS variables for styling consistency
>
> 3. **Service Worker upgrade** — The current `sw.js` is basic. Upgrade it to:
>    - Cache the full app shell reliably
>    - Show an offline fallback page when both network and cache fail
>    - Version the cache (bust old caches on update)
>    - Ensure the app passes Chrome's PWA installability audit (check manifest.json too — verify icons are valid)
>
> 4. **Connection status indicator** — Replace the basic online/offline pill with a richer indicator:
>    - "Connected to base station" (green) — online, backend reachable (ping `/health`)
>    - "Queued, out of range" (amber) — offline, show count of queued items
>    - "Syncing..." (pulsing blue) — draining outbox
>    - "Last synced: X min ago" — idle connected state
>
> 5. **Responder dashboard** — After login, show a dashboard (hidden from victims):
>    - Reports list from GET `/sos/reports` (JWT required, send as `Authorization: Bearer <token>`)
>    - Agent logs from GET `/sos/agent-logs`
>    - Filters by status and severity
>    - Ability to update dispatch status via PATCH `/sos/cases/{sos_id}`
>    - Auto-refresh every 15 seconds
>
> 6. **Leaflet map** — Add a map view using Leaflet.js:
>    - Plot each SOS report as a marker at its GPS coordinates
>    - Colour-code by severity (critical=red, high=orange, medium=yellow, low=green)
>    - Click marker for popup with report details
>    - Use Leaflet.markercluster for nearby reports
>    - Centre on default location (24.8607, 67.0011)
>    - Use OpenStreetMap tiles (cache tiles for offline use if possible)
>
> **Technical constraints:**
> - No frameworks (React, Vue, etc.) — vanilla JS, HTML, CSS only (keep it lightweight for offline)
> - No CDN dependencies except Leaflet (bundle its JS/CSS locally if needed for offline)
> - Must work on mobile browsers (Chrome Android primarily)
> - Must pass Lighthouse PWA audit (performance, accessibility, best practices, PWA)
> - Match the existing dark theme aesthetic
> - The `API_BASE` variable in app.js is already set to same-origin — use it for all fetch calls
> - JWT token is stored in `localStorage` under key `raabta_token`
>
> **API endpoints you'll be consuming:**
> - `POST /sos` — body: `{ sender_id, emergency_text, latitude, longitude, people_count, client_timestamp, sos_id }`
> - `POST /sos/voice` — FormData with: audio_file (File), sender_id, latitude, longitude, people_count, client_timestamp
> - `GET /sos/reports?skip=0&limit=50&status=pending&severity=critical` — returns array of SOSReport objects
> - `GET /sos/agent-logs?skip=0&limit=50` — returns array of AgentLog objects
> - `PATCH /sos/cases/{sos_id}` — body: `{ dispatch_status: "dispatched" }`
> - `GET /health` — returns `{ "status": "ok" }`
>
> Read the existing code in `frontend/` before making changes. Build on top of what's there — don't rewrite from scratch unless necessary.
>
> **PROMPT END**

---

## File Reference Quick-Lookup

| File | Lines | Purpose |
|------|-------|---------|
| `raabta/app/main.py` | 35 | FastAPI entry point, CORS, static mount |
| `raabta/app/models.py` | 80 | All DB models (SOSReport, AgentLog, Responder) |
| `raabta/app/db.py` | 15 | Engine + session factory |
| `raabta/app/routers/sos.py` | 206 | All SOS endpoints |
| `raabta/app/routers/auth.py` | 149 | Auth endpoints |
| `raabta/app/services/auth_service.py` | 91 | JWT + bcrypt utilities |
| `raabta/app/services/triage_service.py` | 36 | Ollama triage |
| `raabta/app/services/clustering_service.py` | 118 | Clustering + duplicate detection |
| `raabta/app/services/whisper_service.py` | 64 | Speech-to-text |
| `raabta/app/services/geolocation_service.py` | 22 | GPS fallback |
| `raabta/app/services/agents/base.py` | 50 | Base Agent class |
| `raabta/app/services/agents/agentic_service.py` | 78 | Clustering Agent |
| `raabta/app/services/agents/command_agent.py` | 181 | Command Agent |
| `frontend/index.html` | 105 | PWA HTML shell |
| `frontend/app.js` | 460 | All frontend logic |
| `frontend/style.css` | 239 | Dark theme styles |
| `frontend/manifest.json` | 15 | PWA manifest |
| `frontend/sw.js` | 46 | Service worker |
| `requirements.txt` | 15 | Python dependencies |
| `.env` | 4 | Environment config |
| `raabta/_fix_db_schema.py` | 31 | DB reset script |
