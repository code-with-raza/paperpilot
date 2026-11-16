
import os

from dotenv import load_dotenv
from supabase import create_client, Client


load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase credentials are missing.")

    return create_client(SUPABASE_URL, SUPABASE_KEY)




def get_user_supabase_client(access_token: str) -> Client:
    if not access_token:
        raise ValueError("User access token is required.")

    client = get_supabase_client()
    client.postgrest.auth(access_token)
    client.storage._client.headers["Authorization"] = f"Bearer {access_token}"

    return client


def get_admin_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "Supabase service role credentials are missing."
        )

    return create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
    )
