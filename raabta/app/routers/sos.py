from fastapi import APIRouter,Depends

from sqlmodel import Session
from app.db import engine,get_session
from app.models import SOSReport    

router=APIRouter(prefix="/sos",tags=["sos"])
@router.post("",response_model=SOSReport)
def create_sos_report(report:SOSReport,session:Session=Depends(get_session)):
    session.add(report)
    session.commit()
    session.refresh(report)
    return report

