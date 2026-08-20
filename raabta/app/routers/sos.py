from fastapi import APIRouter,Depends

from sqlmodel import Session
from app.db import engine,get_session
from app.models import SOSReport    

router=APIRouter(prefix="/sos",tags=["sos"])