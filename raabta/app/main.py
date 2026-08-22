from fastapi import FastAPI
from app.db import init_db
from app.routers import sos

app=FastAPI(title="Raabta Link Backend")

app.include_router(sos.router)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/health")
def health():
    return {"status":"ok"}