
import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


class EmailAlreadyRegistered(Exception):
    pass


class EmailConfirmationRequired(Exception):
    pass


def get_supabase_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase credentials are missing.")

    # Create a separate client for each authentication operation.
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def format_user(user, session):
    if not user:
        raise ValueError("Supabase did not return a user.")

    if not session:
        raise EmailConfirmationRequired(
            "Please verify your email before logging in."
        )

    return {
        "id": str(user.id),
        "email": user.email,
        "created_at": str(user.created_at),
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
    }


def register_user(email: str, password: str) -> dict:
    client = get_supabase_client()

    try:
        response = client.auth.sign_up({
            "email": email.strip().lower(),
            "password": password,
        })

        return format_user(response.user, response.session)

    except Exception as error:
        message = str(error).lower()

        if "already registered" in message or "already exists" in message:
            raise EmailAlreadyRegistered from error

        raise


def authenticate_user(email: str, password: str) -> dict | None:
    client = get_supabase_client()

    try:
        response = client.auth.sign_in_with_password({
            "email": email.strip().lower(),
            "password": password,
        })

        return format_user(response.user, response.session)

    except Exception as error:
        message = str(error).lower()

        if any(
            phrase in message
            for phrase in (
                "invalid login credentials",
                "invalid credentials",
                "email not confirmed",
            )
        ):
            return None

        raise
