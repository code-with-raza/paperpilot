##Store and query graph data


import os
import networkx as nx


def save_graph(graph, paper_id):
    """Save a paper's knowledge graph."""

    os.makedirs("graph_data", exist_ok=True)

    file_path = os.path.join("graph_data", f"{paper_id}.graphml")

    nx.write_graphml(graph, file_path)

    return file_path


def load_graph(paper_id):
    """Load a paper's saved knowledge graph."""

    file_path = os.path.join("graph_data", f"{paper_id}.graphml")

    if not os.path.exists(file_path):
        return nx.DiGraph()

    return nx.read_graphml(file_path)
