from fastapi import APIRouter,Depends

from sqlmodel import Session
from app.db import engine,get_session
from app.models import SOSReport  
from app.services.triage_service import triage_report  

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

