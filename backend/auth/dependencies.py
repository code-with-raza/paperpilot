
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyCookie

from auth.auth import get_supabase_client


ACCESS_TOKEN_COOKIE = "paperpilot_access_token"

cookie_scheme = APIKeyCookie(
    name=ACCESS_TOKEN_COOKIE,
    auto_error=False,
)


def get_current_user(
    token: str | None = Depends(cookie_scheme),
):
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        client = get_supabase_client()

        response = client.auth.get_user(token)
        user = response.user

        if not user:
            raise ValueError("User not found.")

        return {
            "id": str(user.id),
            "email": user.email,
            "created_at": str(user.created_at),
            "access_token": token,
        }

    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
        ) from error
