"""Drop and recreate all database tables.

Run this after adding new columns to models that SQLModel's create_all()
won't pick up (create_all only adds missing tables, not missing columns).

Usage:
    cd raabta
    ..\venv\Scripts\python.exe _fix_db_schema.py
"""

import sys
import os

# Ensure the app package is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import engine
import app.models  # noqa — triggers metadata registration for ALL models

from sqlmodel import SQLModel

def main():
    print("Dropping all tables...")
    SQLModel.metadata.drop_all(engine)
    print("Creating all tables...")
    SQLModel.metadata.create_all(engine)
    print("Done. Tables recreated with the latest schema.")

if __name__ == "__main__":
    main()
