import json
import os
import tempfile
from pathlib import Path

import networkx as nx


GRAPH_DIR = Path(os.environ.get("PAPERPILOT_DATA_DIR", Path(__file__).resolve().parent.parent)) / "graph_data"


def _get_user_graph_dir(user_id):
    """Return the graph directory belonging to a user."""

    user_dir = GRAPH_DIR / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    return user_dir


def _atomic_replace(temp_path, file_path):
    """Replace a file safely after writing is complete."""

    os.replace(temp_path, file_path)


def save_graph(graph, user_id, paper_id):
    """Save a paper's graph inside the owner's directory."""

    user_dir = _get_user_graph_dir(user_id)
    file_path = user_dir / f"{paper_id}.graphml"

    temp_file = tempfile.NamedTemporaryFile(
        suffix=".graphml",
        dir=user_dir,
        delete=False,
    )
    temp_path = Path(temp_file.name)
    temp_file.close()

    try:
        nx.write_graphml(graph, temp_path)
        _atomic_replace(temp_path, file_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    return str(file_path)


def load_graph(user_id, paper_id):
    """Load a graph belonging to a specific user and paper."""

    file_path = GRAPH_DIR / str(user_id) / f"{paper_id}.graphml"

    if not file_path.exists():
        return nx.DiGraph()

    return nx.read_graphml(file_path)


def load_processed_chunks(user_id, paper_id):
    """Load the IDs of chunks already processed for a paper."""

    file_path = GRAPH_DIR / str(user_id) / f"{paper_id}_progress.json"

    if not file_path.exists():
        return set()

    with file_path.open("r", encoding="utf-8") as file:
        return set(json.load(file))


def save_processed_chunks(user_id, paper_id, processed_chunks):
    """Save graph-processing progress for a specific user and paper."""

    user_dir = _get_user_graph_dir(user_id)
    file_path = user_dir / f"{paper_id}_progress.json"

    temp_file = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".json",
        dir=user_dir,
        delete=False,
    )
    temp_path = Path(temp_file.name)

    try:
        with temp_file:
            json.dump(sorted(processed_chunks), temp_file, indent=4)

        _atomic_replace(temp_path, file_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
