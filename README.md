# RaabtaLink

**Offline-first AI disaster-response platform for Pakistan**

Built for the "AI for Pakistan's Future" hackathon.

---

## The Problem

During floods, building collapses, and other disasters in Pakistan, cellular and
internet infrastructure often fail exactly when people need help the most.
Existing emergency apps either require constant connectivity, ask victims to
fill out complex forms mid-panic, or simply relay raw distress signals to
responders with no way to tell which reports describe the *same* incident or
which are genuinely life-threatening.

## What RaabtaLink Does

RaabtaLink lets a victim send a help request — by voice or text, in Urdu or
English — with no login, no signup, and no internet required, using local
Wi-Fi to reach a nearby base node. A locally-run AI model then automatically:

1. **Transcribes** voice reports offline (no cloud, no data leaves the device)
2. **Triages** each report for severity and category
3. **Clusters** new reports against nearby existing ones, recognizing when
   multiple people are reporting the *same* incident (e.g. a collapsed
   building) instead of treating them as separate emergencies

Responders log into a dashboard and see triaged, deduplicated, prioritized
incidents — not raw noise.

## Who It's For

- **Victims** — anyone in a disaster who needs to signal for help fast,
  without technical friction.
- **Responders** — rescue coordinators who need triaged, de-duplicated
  reports to dispatch help efficiently.

## What Makes This Different

Offline mesh/SOS apps already exist (Life Signal, RescueLink, Pakistan's own
Madadgar). None of them add an AI decision-support layer that autonomously
deduplicates and prioritizes incoming reports. RaabtaLink's honest
positioning: the relay problem is largely solved elsewhere — what's new here
is turning a flood of raw signals into triaged, actionable, deduplicated
incidents, built specifically for Pakistan's connectivity and language
realities.

---

## Architecture

```
Victim (PWA, no login)
   │
   ├─ Voice or text + GPS
   │
   ▼
Local Wi-Fi / Base Node
   │
   ▼
FastAPI Backend
   │
   ├─ faster-whisper  → offline voice transcription
   ├─ Ollama (local LLM) → severity triage
   ├─ Clustering service → duplicate-incident detection via GPS + AI reasoning
   │
   ▼
PostgreSQL (local)
   │
   ▼
Responder Dashboard (JWT-authenticated)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | FastAPI |
| Database | PostgreSQL (via SQLModel) |
| Voice transcription | faster-whisper (offline, CPU) |
| AI triage & clustering | Ollama, running `qwen2.5:1.5b` locally |
| Auth (responders only) | JWT (python-jose) + bcrypt password hashing |
| Frontend | Progressive Web App (installable, offline-capable) |

All AI processing runs **fully offline** on local hardware — no API keys,
no cloud dependency, no internet required at inference time.

---

## Authentication Model

RaabtaLink deliberately uses **two different trust models** for its two
roles:

| | Victim app | Responder app |
|---|---|---|
| Login required | No | Yes |
| Identity | Device-generated UUID | Pre-provisioned account |
| Token | None (optional HMAC signature) | JWT, 24h expiry |
| Why | Speed matters more than access control in an emergency | Restricts who can dispatch/close cases |

Victims are never asked to authenticate — friction in a life-threatening
moment is a bug, not a security lapse we tolerate. Responders, who can act on
victim data and dispatch resources, go through real login with pre-seeded,
non-self-serve accounts.

---

## Core Features

### 1. SOS Ingest (Text & Voice)
- `POST /sos` — text-based emergency report, no auth required
- `POST /sos/voice` — audio upload, transcribed offline via faster-whisper,
  then run through the same pipeline as text reports
- GPS is optional — a report with no location fix is flagged
  `needs_followup` rather than rejected, since GPS commonly fails indoors
  or under rubble

### 2. AI Triage
Every report is automatically scored for:
- **Severity**: critical / high / medium / low
- **Category**: medical / trapped / flood / fire / other
- **Reasoning**: a short human-readable explanation, so responders aren't
  just trusting a black-box score

### 3. AI Clustering (Core Differentiator)
When a new report arrives, RaabtaLink:
- Calculates real GPS distance (Haversine formula) to find nearby reports
- Sends the new report's text alongside nearby reports' text to a local LLM
- The model decides whether this is a **duplicate of an existing incident**
  or a **genuinely new one**, with reasoning
- Duplicate reports are merged into a single incident view, so 5 people
  reporting one collapsed building become 1 prioritized case, not 5

### 4. Responder Dashboard API
- JWT-protected endpoints for listing, filtering, and updating case status
- Pre-seeded responder accounts (no public self-signup, by design)

---

## Getting Started

```bash
# 1. Clone and set up environment
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 2. Set up PostgreSQL
# Create a database (e.g. via psql or pgAdmin) and update the
# connection string in app/db.py

# 3. Pull the local AI model
ollama pull qwen2.5:1.5b

# 4. Seed a test responder account
python seed_responder.py

# 5. Run the server
uvicorn app.main:app --reload
```

Visit `http://localhost:8000/docs` for interactive API documentation.

---

## Project Structure

```
raabtalink-backend/
  app/
    main.py                    # FastAPI app entrypoint
    db.py                      # Database engine & session management
    models.py                  # SOSReport, Responder, enums
    auth.py                    # JWT + password hashing (responders)
    routers/
      sos.py                   # SOS ingest, list, update endpoints
      auth_router.py           # Responder login
    services/
      whisper_service.py       # Offline voice transcription
      triage_service.py        # AI severity/category triage
      clustering_service.py    # GPS distance + AI duplicate detection
  seed_responder.py             # Creates a test responder login
  requirements.txt
```

---

## Roadmap (Post-Hackathon)

This PWA is intentionally the first phase of a larger vision:

- **Phase 2** — Native Android/Kotlin app for deeper networking access
- **Phase 3** — True phone-to-phone mesh networking (Wi-Fi Direct, BLE),
  removing the dependency on a single base node
- **Phase 4** — On-device AI (triage running directly on the victim's phone)
- **Phase 5** — Disaster-wide intelligence: hotspot detection, resource
  demand prediction, and rescue prioritization across an entire event, not
  just per-report

---

## Team

Backend, AI triage/clustering pipeline, and database architecture built by
the RaabtaLink team for the "AI for Pakistan's Future" hackathon.
