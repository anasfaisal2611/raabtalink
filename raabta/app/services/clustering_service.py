from math import sin,cos,atan2,sqrt, radians
from sqlmodel import Session,select
from app.db import engine
from app.models import SOSReport
import ollama
import json
import re
from app.services.agents.agentic_service import Clustering_Agent


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```(?:json)?\s*\n?(.*?)\n?\s*```$", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text


def _has_non_ascii(text: str) -> bool:
    try:
        text.encode('ascii')
        return False
    except UnicodeEncodeError:
        return True


CLUSTERING_MODEL="qwen2.5:1.5b"
CLUSTERING_PROMPT=(
    "IMPORTANT: ALL output must be in English. Do not use any non-English characters.\n\n"
    "You are a disaster-response coordinator. "
    "You will be shown one new emergency report "
    "and a list of nearby existing reports. Decide if the new report describes the SAME "
    "incident as any nearby report, or a DIFFERENT one. "
    "Respond with ONLY valid JSON in exactly this format:\n"
    '{"is_duplicate": true|false, "matching_sos_id": "id or null", "reasoning": "one short English sentence"}\n\n'
    "The reasoning field MUST be in English."
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

    try:
        response=ollama.chat(
            model=CLUSTERING_MODEL,
            messages=[{"role":"system","content":CLUSTERING_PROMPT},{"role":"user","content":user_message}]
        )

        raw_data=response["message"]["content"]
        clean_data = _strip_code_fences(raw_data)
        
        # Retry if Chinese detected
        if _has_non_ascii(clean_data):
            response = ollama.chat(
                model=CLUSTERING_MODEL,
                messages=[
                    {"role": "system", "content": CLUSTERING_PROMPT + "\n\nCRITICAL: Your previous response was not in English. You MUST respond in English only."},
                    {"role": "user", "content": user_message}
                ]
            )
            raw_data = response["message"]["content"]
            clean_data = _strip_code_fences(raw_data)
        
        try:
            parsed=json.loads(clean_data)
            if "reasoning" in parsed and _has_non_ascii(parsed["reasoning"]):
                parsed["reasoning"] = "Duplicate check completed (translation unavailable)"
        except json.JSONDecodeError:
            parsed={"is_duplicate": False, "matching_sos_id": None, "reasoning": f"Could not parse: {raw_data[:100]}"}
    except Exception as e:
        parsed={"is_duplicate": False, "matching_sos_id": None, "reasoning": f"Ollama unavailable: {e}"}

    return parsed

def run_cluster_agent_for_report(sos_id:str):
    try:
        with Session(engine) as session:
            report=session.get(SOSReport,sos_id)
            if report is None or report.latitude is None:
                return 
            all_reports=get_all_reports(session)
            nearby_reports=find_nearby_reports(report.latitude,report.longitude,all_reports,exclude_id=sos_id)

            # --- Duplicate detection ---
            dup_result = find_duplicate_reports(nearby_reports, report)
            if dup_result.get("is_duplicate") and dup_result.get("matching_sos_id"):
                match_id = dup_result["matching_sos_id"]
                original = session.get(SOSReport, match_id)
                if original:
                    report.is_duplicate = True
                    report.duplicate_of = match_id
                    report.dispatch_status = original.dispatch_status
                    session.add(report)
                    session.commit()
                    print(f"[cluster-agent] Report {sos_id} is duplicate of {match_id}")
                    return

            # --- Not a duplicate: run cluster agent ---
            cluster_reports=nearby_reports+[report]
            llm=CLUSTERING_MODEL
            agent=Clustering_Agent(llm,session)
            agent.run(cluster_reports)

            # --- Run command agent to rank all clusters ---
            try:
                from app.services.agents.command_agent import run_command_agent
                run_command_agent(session)
            except Exception as cmd_err:
                print(f"[command-agent] Error: {cmd_err}")
    except Exception as e:
        print(f"[cluster-agent] Error for report {sos_id}: {e}")




    


