"""Seed durable demo responders for free-tier deploys.

Render free SQLite is wiped on restart/redeploy, so accounts disappear.
These demo users are re-created (and password reset) on every startup.
"""

from sqlmodel import Session, select

from app.db import engine
from app.models import Responder
from app.services.auth_service import hash_password

# Always available after server boot — use these for demos / sir review
DEMO_RESPONDERS = (
    {
        "username": "admin",
        "email": "admin@raabtalink.local",
        "password": "admin123",
        "full_name": "Demo Admin",
        "organization": "RaabtaLink Demo",
        "role": "admin",
        "license_id": "DEMO-ADMIN",
    },
    {
        "username": "responder",
        "email": "responder@raabtalink.local",
        "password": "responder123",
        "full_name": "Demo Responder",
        "organization": "RaabtaLink Demo",
        "role": "responder",
        "license_id": "DEMO-RESP",
    },
)


def seed_demo_responders() -> None:
    with Session(engine) as session:
        for demo in DEMO_RESPONDERS:
            row = session.exec(
                select(Responder).where(Responder.username == demo["username"])
            ).first()
            hashed = hash_password(demo["password"])
            if row is None:
                session.add(
                    Responder(
                        username=demo["username"],
                        email=demo["email"],
                        hashed_password=hashed,
                        full_name=demo["full_name"],
                        organization=demo["organization"],
                        role=demo["role"],
                        license_id=demo["license_id"],
                        is_active=True,
                    )
                )
            else:
                # Keep demo passwords known even after DB partial restore
                row.hashed_password = hashed
                row.is_active = True
                row.role = demo["role"]
                session.add(row)
        session.commit()
