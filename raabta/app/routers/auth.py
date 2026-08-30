"""Authentication endpoints for healthcare responders.

Victims never register or log in — they submit SOS reports anonymously.
These endpoints are exclusively for healthcare responders and admins.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlmodel import Session, select
from typing import Optional

from app.db import get_session
from app.models import Responder
from app.services.auth_service import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_responder,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# --- Request / Response schemas ---

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    organization: str
    license_id: Optional[str] = None


class RegisterResponse(BaseModel):
    responder_id: str
    username: str
    email: str
    full_name: str
    role: str
    organization: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    responder_id: str
    username: str
    email: str
    full_name: str
    role: str
    organization: str
    license_id: Optional[str]
    is_active: bool


# --- Endpoints ---

@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, session: Session = Depends(get_session)):
    """Register a new healthcare responder."""
    import traceback
    try:
        # Check for duplicate username or email
        existing = session.exec(
            select(Responder).where(
                (Responder.username == body.username) | (Responder.email == body.email)
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username or email already registered",
            )

        responder = Responder(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            full_name=body.full_name,
            organization=body.organization,
            license_id=body.license_id,
        )
        session.add(responder)
        session.commit()
        session.refresh(responder)

        return RegisterResponse(
            responder_id=responder.responder_id,
            username=responder.username,
            email=responder.email,
            full_name=responder.full_name,
            role=responder.role,
            organization=responder.organization,
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login", response_model=TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    """Authenticate a healthcare responder and return a JWT."""
    responder = session.exec(
        select(Responder).where(Responder.username == form_data.username)
    ).first()

    if not responder or not verify_password(form_data.password, responder.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not responder.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    token = create_access_token(
        data={"sub": responder.responder_id, "role": responder.role}
    )
    return TokenResponse(access_token=token)


@router.get("/me", response_model=MeResponse)
def get_me(current: Responder = Depends(get_current_responder)):
    """Return the current authenticated responder's profile."""
    return MeResponse(
        responder_id=current.responder_id,
        username=current.username,
        email=current.email,
        full_name=current.full_name,
        role=current.role,
        organization=current.organization,
        license_id=current.license_id,
        is_active=current.is_active,
    )
