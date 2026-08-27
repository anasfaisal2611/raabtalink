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
    emergency_text:str

    latitude:Optional[float]=None
    longitude:Optional[float]=None
    people_count:int=Field(default=1)
    category:EmergencyCategory=Field(default=EmergencyCategory.other)

    severity:Severity=Field(default=Severity.unknown)
    ai_reasoning:Optional[str]=None
    priority_rank:Priority= Field(default=Priority.low)
    dispatch_status:Dispatch=Field(default="pending")

    ttl:int=Field(default=5)


class AgentLog(SQLModel,table=True):
    log_id:str=Field(default_factory=lambda:str(uuid.uuid4()),primary_key=True)
    agent_name:str
    timestamp:datetime=Field(default_factory=datetime.utcnow)
    cluster_size:int=Field(default=0)
    decision:str  # JSON string of the agent's decision
    recommended_action:Optional[str]=None




