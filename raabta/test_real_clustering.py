from sqlmodel import Session
from app.services.clustering_sevice import find_nearby_reports,get_all_reports

from app.db import engine

with Session(engine) as session:
    reports=get_all_reports(session)
    print(f"Total reports in DB {len(reports)}")


    if reports:
        target=reports[0]
        nearby_reports=find_nearby_reports(
            target_lat=target.latitude,target_long=target.longitude,all_reports=reports,exclude_id=target.sos_id,radius=100.0
        )

        for r in nearby_reports:
            print("Nearby: ",r.sos_id)
