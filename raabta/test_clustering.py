from app.services.clustering_service import find_nearby_reports
class FakeReport():
    def __init__(self,sos_id,latitude,longitude):
        self.sos_id=sos_id
        self.latitude=latitude
        self.longitude=longitude

report_a = FakeReport("A", 24.8607, 67.0011)   # Karachi
report_b = FakeReport("B", 24.8610, 67.0015)   # ~50m from A
report_c = FakeReport("C", 24.8650, 67.0090)   # ~1km from A
report_d = FakeReport("D", 31.5204, 74.3587)

all_reports=[report_a,report_b,report_c,report_d]

nearby_reports=find_nearby_reports(target_lat=report_a.latitude,target_long=report_a.longitude,all_reports=all_reports,exclude_id="A", radius=1.0)

for r in nearby_reports:
    print("Nearby: ",r.sos_id)


