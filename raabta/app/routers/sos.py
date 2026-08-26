from fastapi import APIRouter,Depends,UploadFile,File,Form

from sqlmodel import Session
from app.db import engine,get_session
from app.models import SOSReport  
from app.services.triage_service import triage_report  
from app.services.whisper_service import transcribe_audio
import shutil


router=APIRouter(prefix="/sos",tags=["sos"])
@router.post("",response_model=SOSReport)
def create_sos_report(report:SOSReport,session:Session=Depends(get_session)):
    triage_result=triage_report(report.emergency_text)
    report.severity=triage_result["severity"]
    report.ai_reasoning=triage_result["reasoning"]
    session.add(report)
    session.commit()
    session.refresh(report)
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
    report=SOSReport(
        sender_id=sender_id,
        emergency_text=transcribed_text,
        latitide=latitude,
        longitude=longitude,
        people_count=people_count
    )
    triage_result=triage_report(report.emergency_text)
    report.severity=triage_result["severity"]
    report.ai_reasoning=triage_result["reasoning"]
    session.add(report)
    session.commit()
    session.refresh(report)
    return report

    

