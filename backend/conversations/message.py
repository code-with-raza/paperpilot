
from datetime import datetime, timezone
import uuid

from database.supabase_client import get_user_supabase_client


def save_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    access_token: str,
    sources: list | None = None,
):
    client = get_user_supabase_client(access_token)

    message_id = str(uuid.uuid4())

    response = (
        client.table("messages")
        .insert({
            "id": message_id,
            "conversation_id": conversation_id,
            "user_id": user_id,
            "role": role,
            "content": content,
            "sources_json": sources,
        })
        .select("id")
        .execute()
    )

    if not response.data:
        return None

    client.table("conversations").update({
        "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq(
        "id", conversation_id
    ).eq(
        "user_id", user_id
    ).execute()

    return response.data[0]["id"]


def get_conversation_messages(
    conversation_id: str,
    user_id: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("messages")
        .select(
            "id, conversation_id, role, content, sources_json, created_at"
        )
        .eq("conversation_id", conversation_id)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )

    messages = []

    for row in response.data:
        message = dict(row)
        message["sources"] = message.pop("sources_json")
        messages.append(message)

    return messages
