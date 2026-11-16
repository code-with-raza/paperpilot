
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from auth.auth import (
    register_user,
    authenticate_user,
    get_supabase_client,
    format_user,
    EmailAlreadyRegistered,
    EmailConfirmationRequired,
)
from auth.dependencies import get_current_user
from auth.schemas import RegisterRequest, LoginRequest, UserResponse


router = APIRouter(prefix="/auth", tags=["Authentication"])

ACCESS_COOKIE = "paperpilot_access_token"
REFRESH_COOKIE = "paperpilot_refresh_token"

COOKIE_SECURE = os.getenv(
    "PAPERPILOT_COOKIE_SECURE", "true"
).lower() == "true"

COOKIE_SETTINGS = {
    "httponly": True,
    "secure": COOKIE_SECURE,
    "samesite": "lax",
    "path": "/",
}


def set_auth_cookies(response: Response, user: dict):
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=user["access_token"],
        max_age=60 * 60,
        **COOKIE_SETTINGS,
    )

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=user["refresh_token"],
        max_age=60 * 60 * 24 * 30,
        **COOKIE_SETTINGS,
    )


def clear_auth_cookies(response: Response):
    response.delete_cookie(
        key=ACCESS_COOKIE,
        **COOKIE_SETTINGS,
    )

    response.delete_cookie(
        key=REFRESH_COOKIE,
        **COOKIE_SETTINGS,
    )


def public_user(user: dict):
    return {
        "id": user["id"],
        "email": user["email"],
        "created_at": user["created_at"],
    }


@router.post("/register", response_model=UserResponse, status_code=201)
def register(request: RegisterRequest, response: Response):
    try:
        user = register_user(str(request.email), request.password)

    except EmailAlreadyRegistered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    except EmailConfirmationRequired:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

    set_auth_cookies(response, user)
    return public_user(user)


@router.post("/login", response_model=UserResponse)
def login(request: LoginRequest, response: Response):
    user = authenticate_user(str(request.email), request.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    set_auth_cookies(response, user)
    return public_user(user)


@router.post("/refresh")
def refresh_session(request: Request, response: Response):
    refresh_token = request.cookies.get(REFRESH_COOKIE)

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is missing.",
        )

    try:
        client = get_supabase_client()

        auth_response = client.auth.refresh_session(refresh_token)

        user = format_user(
            auth_response.user,
            auth_response.session,
        )

        set_auth_cookies(response, user)

        return public_user(user)

    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
        ) from error


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookies(response)

    return {"message": "Logged out successfully."}

