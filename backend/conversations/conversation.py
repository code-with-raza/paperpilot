
import uuid

from database.supabase_client import get_user_supabase_client


def create_conversation(
    user_id: str,
    title: str,
    access_token: str,
    paper_id: str | None = None,
):
    client = get_user_supabase_client(access_token)

    conversation_id = str(uuid.uuid4())

    response = (
        client.table("conversations")
        .insert({
            "id": conversation_id,
            "user_id": user_id,
            "title": title,
            "paper_id": paper_id,
        })
        .select(
            "id, user_id, title, paper_id, created_at, updated_at"
        )
        .single()
        .execute()
    )

    return response.data


def get_user_conversations(user_id: str, access_token: str):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("conversations")
        .select(
            "id, user_id, title, paper_id, created_at, updated_at"
        )
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )

    return response.data


def get_conversation(
    conversation_id: str,
    user_id: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("conversations")
        .select(
            "id, user_id, title, paper_id, created_at, updated_at"
        )
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )

    return response.data


def delete_conversation(
    conversation_id: str,
    user_id: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("conversations")
        .delete()
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)
