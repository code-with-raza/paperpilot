
import sqlite3
from pathlib import Path

DB_PATH = Path("paperpilot.db")


def connect_db():
    return sqlite3.connect(DB_PATH)


def initialize_db():
    with connect_db() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS papers (
                paper_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


def add_paper(paper_id, user_id, filename, file_path, status):
    with connect_db() as connection:
        connection.execute(
            """
            INSERT INTO papers (
                paper_id, user_id, filename, file_path, status
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (paper_id, user_id, filename, file_path, status)
        )


def list_papers(user_id):
    with connect_db() as connection:
        connection.row_factory = sqlite3.Row

        rows = connection.execute(
            """
            SELECT paper_id, filename, status, created_at
            FROM papers
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,)
        ).fetchall()

        return [dict(row) for row in rows]


initialize_db()


def update_paper_status(paper_id, user_id, status):
    with connect_db() as connection:
        connection.execute(
            """
            UPDATE papers
            SET status = ?
            WHERE paper_id = ? AND user_id = ?
            """,
            (status, paper_id, user_id)
        )
