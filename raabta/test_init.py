from app.db import engine
from app.db import init_db
from app.models import SOSReport

init_db()
print("Database Tables  created")