"""/api/auth/* and /api/account/* — sign up, log in, log out, account management."""

from __future__ import annotations

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .repo import EmailTaken, Repo, UserRec, get_repo
from .security import (
    clear_session_cookie, client_ip, current_user, current_user_optional, enforce_rate, hash_password,
    needs_rehash, password_problem, read_token, reset_rate, revoke_all_sessions, set_session_cookie,
    verify_password, SESSION_COOKIE,
)
from .settings import settings

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
        raise HTTPException(422, {"field": "email", "message": "Enter a valid email address."})


def user_out(u: UserRec) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "tour_done": u.tour_done}


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, repo: Repo = Depends(get_repo)) -> dict:
    enforce_rate(f"signup:{client_ip(request)}", limit=8, window_s=3600)
    email = _normalise_email(body.email)
    problem = password_problem(body.password, email)
    if problem:
        raise HTTPException(422, {"field": "password", "message": problem})
    try:
        user = repo.create_user(email, hash_password(body.password), (body.full_name or "").strip() or None)
    except EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"field": "email", "message": "An account with this email already exists. Log in instead."})
    set_session_cookie(response, user)
    return {"user": user_out(user), "brand": None}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, repo: Repo = Depends(get_repo)) -> dict:
    email = body.email.strip().lower()
    enforce_rate(f"login-ip:{client_ip(request)}", limit=30, window_s=900)
    enforce_rate(f"login:{email}", limit=8, window_s=900)
    user = repo.get_user_by_email(email)
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            {"field": "password", "message": "That email and password don't match."})
    reset_rate(f"login:{email}")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        repo.update_user(user.id, password_hash=user.password_hash)
    set_session_cookie(response, user)
    from .brand import brand_out  # local import avoids a cycle
    return {"user": user_out(user), "brand": brand_out(user.brand) if user.brand else None}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, repo: Repo = Depends(get_repo)) -> Response:
    """Signs out every device: signed tokens can't be recalled one by one, so we bump the
    account's session version, which invalidates all of them (one write)."""
    data = read_token(request.cookies.get(SESSION_COOKIE, ""))
    if data:
        user = repo.get_user(str(data.get("u", "")))
        if user and user.session_version == data.get("v"):
            revoke_all_sessions(repo, user)
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.get("/auth/me")
def me(user: UserRec | None = Depends(current_user_optional)) -> dict:
    if user is None:
        return {"user": None, "brand": None}
    from .brand import brand_out
    return {"user": user_out(user), "brand": brand_out(user.brand) if user.brand else None}


@router.post("/account/tour-done")
def tour_done(user: UserRec = Depends(current_user), repo: Repo = Depends(get_repo)) -> dict:
    if not user.tour_done:
        repo.update_user(user.id, tour_done=True)
    return {"ok": True}


@router.post("/account/password")
def change_password(body: PasswordChangeIn, response: Response,
                    user: UserRec = Depends(current_user), repo: Repo = Depends(get_repo)) -> dict:
    enforce_rate(f"pw:{user.id}", limit=6, window_s=900)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            {"field": "current_password", "message": "Your current password is wrong."})
    problem = password_problem(body.new_password, user.email)
    if problem:
        raise HTTPException(422, {"field": "new_password", "message": problem})
    user.password_hash = hash_password(body.new_password)
    user.session_version += 1  # signs out every other device
    repo.update_user(user.id, password_hash=user.password_hash, session_version=user.session_version)
    set_session_cookie(response, user)  # keep this device signed in
    return {"ok": True}


@router.delete("/account", status_code=204)
def delete_account(body: DeleteAccountIn, response: Response,
                   user: UserRec = Depends(current_user), repo: Repo = Depends(get_repo)) -> Response:
    enforce_rate(f"del:{user.id}", limit=5, window_s=900)
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, {"field": "password", "message": "That password is wrong."})
    repo.delete_user(user.id)  # account, brand, stores and shortlist
    clear_session_cookie(response)
    response.status_code = 204
    return response
