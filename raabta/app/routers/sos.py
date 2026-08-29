from fastapi import APIRouter,Depends,UploadFile,File,Form, BackgroundTasks, WebSocket, WebSocketDisconnect, Query

from sqlmodel import Session
from app.db import engine,get_session
from app.models import SOSReport, Priority
from app.services.triage_service import triage_report  
from app.services.whisper_service import transcribe_audio, transcribe_audio_bytes
from app.services.clustering_service import run_cluster_agent_for_report
from app.services.geolocation_service import resolve_gps
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
@router.post("",response_model=SOSReport)
def create_sos_report(report:SOSReport,background_tasks:BackgroundTasks,session:Session=Depends(get_session)):
    report.latitude, report.longitude = resolve_gps(report.latitude, report.longitude)
    triage_result=triage_report(report.emergency_text)
    report.severity=triage_result["severity"]
    report.ai_reasoning=triage_result["reasoning"]
    report.category = triage_result["category"]
    report.priority_rank = _derive_priority(report.severity, report.people_count)
    
    session.add(report)
    session.commit()
    session.refresh(report)
    background_tasks.add_task(run_cluster_agent_for_report, report.sos_id)
    return report
@router.post("/voice")
def create_sos_from_voice(audio: UploadFile = File(...),
    sender_id: str = Form(...),
    latitude: float = Form(None),
    longitude: float = Form(None),
    people_count: int = Form(1),
    session: Session = Depends(get_session),):

    temp_path=f"temp_{audio.filename}"
    with open(temp_path,"wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)
    transcribed_text=transcribe_audio(temp_path)
    latitude, longitude = resolve_gps(latitude, longitude)
    report=SOSReport(
        sender_id=sender_id,
        emergency_text=transcribed_text,
        latitude=latitude,
        longitude=longitude,
        people_count=people_count
    )
    triage_result=triage_report(report.emergency_text)
    report.severity=triage_result["severity"]
    report.ai_reasoning=triage_result["reasoning"]
    report.category = triage_result["category"]
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
            )
            triage_result = triage_report(report.emergency_text)
            report.severity = triage_result["severity"]
            report.ai_reasoning = triage_result["reasoning"]
            report.category = triage_result["category"]
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
