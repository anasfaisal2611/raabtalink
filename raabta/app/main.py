from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pathlib import Path
from app.db import init_db
from app.routers import sos, auth
from app.models import Responder  # ensure table is created on startup

app=FastAPI(title="Raabta Link Backend")

# CORS — kept for dev tools / external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sos.router)
app.include_router(auth.router)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/health")
def health():
    return {"status":"ok"}

@app.get("/app")
def app_root_redirect():
    return RedirectResponse(url="/app/", status_code=307)

# Serve the PWA frontend from /app route
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")