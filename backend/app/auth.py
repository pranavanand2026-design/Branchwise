"""/api/auth/* and /api/account/* — sign up, log in, log out, account management."""

from __future__ import annotations

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .security import (
    SESSION_COOKIE, clear_session_cookie, client_ip, create_session, current_user,
    current_user_optional, enforce_rate, hash_password, limiter, needs_rehash,
    password_problem, revoke_all_sessions, revoke_session, verify_password,
)
from .settings import settings
from .storage import User, get_db, utcnow

router = APIRouter(prefix="/api")


class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    full_name: str | None = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=200)


def _normalise_email(raw: str) -> str:
    try:
        # reserved test domains (.test, .localhost) are accepted only outside production
        return validate_email(raw.strip(), check_deliverability=False,
                              test_environment=not settings.is_production).normalized.lower()
    except EmailNotValidError:
        raise HTTPException(422,
                            {"field": "email", "message": "Enter a valid email address."})


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "tour_done": u.tour_done}


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    enforce_rate(f"signup:{client_ip(request)}", limit=8, window_s=3600)
    email = _normalise_email(body.email)
    problem = password_problem(body.password, email)
    if problem:
        raise HTTPException(422, {"field": "password", "message": problem})
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"field": "email", "message": "An account with this email already exists. Log in instead."})
    user = User(email=email, password_hash=hash_password(body.password),
                full_name=(body.full_name or "").strip() or None)
    db.add(user)
    db.commit()
    create_session(db, user, response, request.headers.get("user-agent"))
    return {"user": user_out(user), "brand": None}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    email = body.email.strip().lower()
    ip = client_ip(request)
    enforce_rate(f"login-ip:{ip}", limit=30, window_s=900)
    enforce_rate(f"login:{email}", limit=8, window_s=900)
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            {"field": "password", "message": "That email and password don't match."})
    limiter.reset(f"login:{email}")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()
    create_session(db, user, response, request.headers.get("user-agent"))
    from .brand import brand_out  # local import avoids a cycle
    return {"user": user_out(user), "brand": brand_out(user.brand) if user.brand else None}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    revoke_session(db, request.cookies.get(SESSION_COOKIE))
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.get("/auth/me")
def me(user: User | None = Depends(current_user_optional)) -> dict:
    if user is None:
        return {"user": None, "brand": None}
    from .brand import brand_out
    return {"user": user_out(user), "brand": brand_out(user.brand) if user.brand else None}


@router.post("/account/tour-done")
def tour_done(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.tour_done = True
    db.commit()
    return {"ok": True}


@router.post("/account/password")
def change_password(body: PasswordChangeIn, request: Request,
                    user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    enforce_rate(f"pw:{user.id}", limit=6, window_s=900)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            {"field": "current_password", "message": "Your current password is wrong."})
    problem = password_problem(body.new_password, user.email)
    if problem:
        raise HTTPException(422, {"field": "new_password", "message": problem})
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = utcnow()
    db.commit()
    # Sign out every other device
    revoke_all_sessions(db, user.id, keep_token=request.cookies.get(SESSION_COOKIE))
    return {"ok": True}


@router.delete("/account", status_code=204)
def delete_account(body: DeleteAccountIn, response: Response,
                   user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    enforce_rate(f"del:{user.id}", limit=5, window_s=900)
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            {"field": "password", "message": "That password is wrong."})
    db.delete(user)  # cascades to sessions, brand, stores, saved sites
    db.commit()
    clear_session_cookie(response)
    response.status_code = 204
    return response
