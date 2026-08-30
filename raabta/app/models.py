import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel,Field
from enum import Enum
class EmergencyCategory(str,Enum):
    medical="medical"
    trapped="trapped"
    flood="flood"
    fire="fire"
    other="other"

class Severity(str,Enum):
    critical="critical"
    high="high"
    medium="medium"
    low="low"
    unknown="unknown"
class Priority(str,Enum):
    high="high"
    medium="medium"
    low="low"
class Dispatch(str,Enum):
    escalated="escalated"
    pending="pending"
    dispatched="dispatched"
    needs_info="needs_info"
    monitoring="monitoring"

class SOSReport(SQLModel,table=True):
    sos_id:str=Field(default_factory=lambda:str(uuid.uuid4()),primary_key=True)
    sender_id:str
    timestamp:datetime=Field(default_factory=datetime.utcnow)
    client_timestamp:Optional[datetime]=None
    emergency_text:str

    latitude:Optional[float]=None
    longitude:Optional[float]=None
    people_count:int=Field(default=1)
    category:EmergencyCategory=Field(default=EmergencyCategory.other)

    severity:Severity=Field(default=Severity.unknown)
    ai_reasoning:Optional[str]=None
    priority_rank:Priority= Field(default=Priority.low)
    dispatch_status:Dispatch=Field(default="pending")

    is_duplicate:bool=Field(default=False)
    duplicate_of:Optional[str]=None
    command_rank:Optional[int]=None
    responders_allocated:Optional[str]=None

    ttl:int=Field(default=5)


class AgentLog(SQLModel,table=True):
    log_id:str=Field(default_factory=lambda:str(uuid.uuid4()),primary_key=True)
    agent_name:str
    timestamp:datetime=Field(default_factory=datetime.utcnow)
    cluster_size:int=Field(default=0)
    decision:str  # JSON string of the agent's decision
    recommended_action:Optional[str]=None


class Responder(SQLModel,table=True):
    responder_id:str=Field(default_factory=lambda:str(uuid.uuid4()),primary_key=True)
    username:str=Field(unique=True,index=True)
    email:str=Field(unique=True,index=True)
    hashed_password:str
    full_name:str
    role:str=Field(default="responder")  # responder | admin
    organization:str  # hospital name, NGO, rescue org, etc.
    license_id:Optional[str]=None
    is_active:bool=Field(default=True)
    created_at:datetime=Field(default_factory=datetime.utcnow)




