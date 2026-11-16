
from database.supabase_client import get_user_supabase_client


def add_paper(
    paper_id: str,
    user_id: str,
    filename: str,
    storage_path: str,
    status: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("papers")
        .insert({
            "paper_id": paper_id,
            "user_id": user_id,
            "filename": filename,
            "storage_path": storage_path,
            "status": status,
        })
        .execute()
    )

    return response.data[0] if response.data else None


def list_papers(user_id: str, access_token: str):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("papers")
        .select("paper_id, filename, status, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    return response.data


def update_paper_status(
    paper_id: str,
    user_id: str,
    status: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("papers")
        .update({"status": status})
        .eq("paper_id", paper_id)
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)


def get_paper_for_user(
    paper_id: str,
    user_id: str,
    access_token: str,
):
    client = get_user_supabase_client(access_token)

    response = (
        client.table("papers")
        .select("paper_id, filename, storage_path, status")
        .eq("paper_id", paper_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )

    return response.data
