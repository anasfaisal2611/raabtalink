from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pathlib import Path
from app.db import init_db
from app.routers import sos, auth
from app.models import Responder  # ensure table is created on startup

app=FastAPI(title="Raabta Link Backend")

# CORS — browsers reject allow_origins=["*"] when credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://raabtalink.vercel.app",
        "https://raabtalink-muhammad-anas-faisal-s-projects.vercel.app",
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sos.router)
app.include_router(auth.router)

@app.on_event("startup")
def on_startup():
    init_db()
    try:
        from app.services.seed_service import seed_demo_responders
        seed_demo_responders()
    except Exception as e:
        print(f"[seed] Failed to seed demo responders: {e}")

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