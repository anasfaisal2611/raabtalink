from math import sin,cos,atan2,sqrt, radians
from sqlmodel import Session,select
from app.models import SOSReport
import ollama
import json

CLUSTERING_MODEL="qwen2.5:1.5b"
CLUSTERING_PROMPT=(
    "You are a disaster-response coordinator. You will be shown one new emergency report "
    "and a list of nearby existing reports. Decide if the new report describes the SAME "
    "incident as any nearby report, or a DIFFERENT one. "
    "Respond with ONLY valid JSON in exactly this format: "
    '{"is_duplicate": true|false, "matching_sos_id": "id or null", "reasoning": "one short sentence"}'
)


def get_all_reports(session:Session):
    return session.exec(select(SOSReport)).all()



def haversine_km(lat1:float,lat2:float,long1:float,long2:float)->float:
    '''Distance in Km between 2 GPS points'''
    R=6371 #Earths radius in km
    dlat=radians(lat2-lat1)
    dlon=radians(long2-long1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def find_nearby_reports(target_lat:float,target_long:float,all_reports:list,exclude_id:str=None,radius:float=0.5):
    '''Return nearby reports within the radius of the target report'''
    nearby=[]
    for r in all_reports:
        if r.sos_id==exclude_id:
            continue
        if r.latitude==None or r.longitude==None:
            continue
        distance=haversine_km(target_lat,r.latitude,target_long,r.longitude)
        if distance<=radius:
            nearby.append(r)
    return nearby

def find_duplicate_reports(nearby_reports:list,new_report):
    if not nearby_reports:
        return {"is_duplicate": False, "matching_sos_id": None, "reasoning": "No nearby reports to compare."}

    nearby_summaries = "\n".join(
        f"- ID {r.sos_id}: \"{r.emergency_text}\"" for r in nearby_reports
    )



    user_message = (
        f"NEW REPORT: \"{new_report.emergency_text}\"\n\n"
        f"NEARBY EXISTING REPORTS:\n{nearby_summaries}"
    )

    response=ollama.chat(
        model=CLUSTERING_MODEL,
        messages=[{"role":"system","content":CLUSTERING_PROMPT},{"role":"user","content":user_message}]

    )

    raw_data=response["message"]["content"]
    try:
        parsed=json.loads(raw_data)
    except json.JSONDecodeError as e:
        parsed={"is_duplicate": False, "matching_sos_id": None, "reasoning": f"Could not parse: {raw_data[:100]}"}

    return parsed


    


