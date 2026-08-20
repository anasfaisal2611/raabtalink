import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel,Field

class SOSReport(SQLModel,table=True):
    sos_id:str=Field(default_factory=lambda:str(uuid.uuid4()),primary_key=True)
    sender_id:str
    timestamp:datetime=Field(default_factory=datetime.utcnow())
    emergency_text:str