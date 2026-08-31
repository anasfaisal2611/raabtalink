from fastapi import APIRouter,Depends,UploadFile,File,Form, BackgroundTasks, WebSocket, WebSocketDisconnect, Query, HTTPException, status

from sqlmodel import Session,select
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from app.db import engine,get_session
from app.models import SOSReport, Priority, AgentLog, Responder, EmergencyCategory, Severity
from app.services.triage_service import triage_report  
from app.services.whisper_service import transcribe_audio, transcribe_audio_bytes
from app.services.clustering_service import run_cluster_agent_for_report
from app.services.geolocation_service import resolve_gps
from app.services.nearby_places_service import get_nearby_places
from app.services.auth_service import require_role
import shutil
import asyncio


def _derive_priority(severity: str, people_count: int = 1) -> str:
    """Map triage severity (+ people_count boost) onto a Priority value."""
    sev = (severity or "").lower()
    if sev == "critical" or people_count >= 10:
        return "high"
    if sev == "high":
        return "high"
    if sev == "medium":
        return "medium"
    return "low"


router=APIRouter(prefix="/sos",tags=["sos"])

def _normalize_category(value: str) -> str:
    allowed = {"medical", "trapped", "flood", "fire", "other"}
    v = (value or "other").lower()
    return v if v in allowed else "other"


def _normalize_severity(value: str) -> str:
    allowed = {"critical", "high", "medium", "low", "unknown"}
    v = (value or "unknown").lower()
    return v if v in allowed else "unknown"


def _coerce_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+00:00", ""))
    return value

# --- PATCH schema ---
class CaseUpdate(BaseModel):
    dispatch_status: Optional[str] = None
    priority_rank: Optional[str] = None
    notes: Optional[str] = None

@router.get("/nearby-places")
def nearby_places(
    lat: float = Query(...),
    lon: float = Query(...),
    radius_m: int = Query(1500, ge=200, le=5000),
):
    """Proxy OSM Overpass + Nominatim so the PWA gets accurate nearby landmarks."""
    try:
        return get_nearby_places(lat, lon, radius_m=radius_m)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch nearby places: {exc}") from exc

@router.get("/reports")
def list_reports(
    skip: int = 0, limit: int = 50,
    status: str = None, severity: str = None,
    session: Session = Depends(get_session),
    _current: Responder = Depends(require_role("responder", "admin")),
):
    query = select(SOSReport).offset(skip).limit(limit)
    if status:
        query = query.where(SOSReport.dispatch_status == status)
    if severity:
        query = query.where(SOSReport.severity == severity)
    return session.exec(query).all()

@router.get("/agent-logs")
def list_agent_logs(
    skip: int = 0, limit: int = 50,
    session: Session = Depends(get_session),
    _current: Responder = Depends(require_role("responder", "admin")),
):
    return session.exec(select(AgentLog).offset(skip).limit(limit)).all()

@router.patch("/cases/{sos_id}")
def update_case(
    sos_id: str,
    body: CaseUpdate,
    session: Session = Depends(get_session),
    current: Responder = Depends(require_role("responder", "admin")),
):
    report = session.get(SOSReport, sos_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if body.dispatch_status is not None:
        report.dispatch_status = body.dispatch_status
    if body.priority_rank is not None:
        report.priority_rank = body.priority_rank
    session.add(report)
    session.commit()
    session.refresh(report)
    return report

@router.post("",response_model=SOSReport)
def create_sos_report(report:SOSReport,background_tasks:BackgroundTasks,session:Session=Depends(get_session)):
    # Idempotent: if sos_id already exists, return existing report
    existing = session.get(SOSReport, report.sos_id)
    if existing:
        return existing

    report.latitude, report.longitude = resolve_gps(report.latitude, report.longitude)

    if report.client_timestamp:
        report.client_timestamp = _coerce_datetime(report.client_timestamp)
        report.timestamp = report.client_timestamp

    triage_result=triage_report(report.emergency_text)
    report.severity=Severity(_normalize_severity(triage_result["severity"]))
    report.ai_reasoning=triage_result["reasoning"]
    report.category = EmergencyCategory(_normalize_category(triage_result.get("category") or str(report.category)))
    report.priority_rank = _derive_priority(report.severity, report.people_count)
    
    session.add(report)
    session.commit()
    session.refresh(report)
    background_tasks.add_task(run_cluster_agent_for_report, report.sos_id)
    return report
@router.post("/voice")
def create_sos_from_voice(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    sender_id: str = Form(...),
    latitude: float = Form(None),
    longitude: float = Form(None),
    people_count: int = Form(1),
    client_timestamp: datetime = Form(None),
    session: Session = Depends(get_session),
):

    temp_path=f"temp_{audio.filename}"
    with open(temp_path,"wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)
    transcribed_text=transcribe_audio(temp_path)
    latitude, longitude = resolve_gps(latitude, longitude)
    client_ts = _coerce_datetime(client_timestamp)
    report=SOSReport(
        sender_id=sender_id,
        emergency_text=transcribed_text,
        latitude=latitude,
        longitude=longitude,
        people_count=people_count,
        client_timestamp=client_ts,
        timestamp=client_ts or datetime.utcnow(),
    )
    triage_result=triage_report(report.emergency_text)
    report.severity=Severity(_normalize_severity(triage_result["severity"]))
    report.ai_reasoning=triage_result["reasoning"]
    report.category = EmergencyCategory(_normalize_category(triage_result.get("category") or str(report.category)))
    report.priority_rank = _derive_priority(report.severity, report.people_count)
    
    session.add(report)
    session.commit()
    session.refresh(report)
    background_tasks.add_task(run_cluster_agent_for_report, report.sos_id)
    return report
    

@router.websocket("/ws/listen")
async def websocket_endpoint(
    websocket: WebSocket,
    sender_id: str = Query(...),
    latitude: float = Query(None),
    longitude: float = Query(None),
    people_count: int = Query(1),
    client_timestamp: datetime = Query(None),
    session: Session = Depends(get_session),
):
    await websocket.accept()
    print("Client connected for live transcription.")

    try:
        while True:
            # Receive raw audio data from the client
            # Expecting 16kHz, Mono, 16-bit PCM format
            data = await websocket.receive_bytes()

            if not data:
                continue

            # Run the transcription in an executor to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            text = await loop.run_in_executor(None, transcribe_audio_bytes, data)

            # Send the transcribed text back to the client
            if not text or text == "No Speech detected":
                continue

            text = text.strip()
            await websocket.send_json({"transcript": text})

            # Persist the SOS report and kick off the cluster agent
            report = SOSReport(
                sender_id=sender_id,
                emergency_text=text,
                latitude=latitude,
                longitude=longitude,
                people_count=people_count,
                client_timestamp=client_timestamp,
                timestamp=client_timestamp or datetime.utcnow(),
            )
            triage_result = triage_report(report.emergency_text)
            report.severity = Severity(_normalize_severity(triage_result["severity"]))
            report.ai_reasoning = triage_result["reasoning"]
            report.category = EmergencyCategory(_normalize_category(triage_result.get("category")))
            report.priority_rank = _derive_priority(report.severity, report.people_count)

            session.add(report)
            session.commit()
            session.refresh(report)

            await loop.run_in_executor(None, run_cluster_agent_for_report, report.sos_id)

            await websocket.send_json({
                "status": "report_saved",
                "sos_id": report.sos_id,
                "severity": report.severity,
                "dispatch_status": report.dispatch_status,
            })

    except WebSocketDisconnect:
        print("Client disconnected.")
    except Exception as e:
        print(f"Error: {e}")
        await websocket.close()
