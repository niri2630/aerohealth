"""
Run this once, locally, well before judging — not during the 2-hour build.
Requires: pip install osmnx --break-system-packages  (or in a venv)
"""
import osmnx as ox
import pickle
import networkx as nx

# graph_from_place() needs OSM to have a POLYGON boundary for the query — most
# POIs (a specific college campus) don't have one, only cities/districts do,
# which is why the place-name query failed with 0 results. graph_from_address()
# is more forgiving: it geocodes to a single POINT, then builds a box of
# radius `dist` meters around it — much likelier to resolve for a named
# institution rather than an administrative area.
ADDRESS = "Sahyadri College of Engineering and Management, Adyar, Mangaluru, Karnataka, India"
DIST_METERS = 3000  # radius around the geocoded point — adjust to cover your demo route

try:
    G = ox.graph_from_address(ADDRESS, dist=DIST_METERS, network_type="drive")
except Exception as e:
    print(f"graph_from_address failed for '{ADDRESS}': {e}")
    print("Falling back to a broader, more reliably geocodable query...")
    # Simpler queries geocode more reliably — a locality name almost always
    # has a Nominatim point match even when a specific POI doesn't.
    FALLBACK_ADDRESS = "Adyar, Mangaluru, Karnataka, India"
    G = ox.graph_from_address(FALLBACK_ADDRESS, dist=DIST_METERS, network_type="drive")

# Precompute speeds/travel times now so the backend never has to at request time
G = ox.add_edge_speeds(G)
G = ox.add_edge_travel_times(G)

with open("demo_graph.pickle", "wb") as f:
    pickle.dump(G, f)

print(f"Saved graph: {len(G.nodes)} nodes, {len(G.edges)} edges")

# --- Sanity check: use two REAL nodes from the downloaded graph itself ---
# Rather than guessing lat/lon coordinates (which risks picking a point outside
# this graph's coverage area entirely), pull the two most geographically
# distant nodes actually present in the graph. This also sidesteps
# ox.nearest_nodes(), which needs scikit-learn installed for an unprojected
# graph and was the cause of the ImportError.
import math

nodes = list(G.nodes(data=True))
# crude but sufficient: node with min latitude vs node with max latitude
south_node = min(nodes, key=lambda n: n[1]["y"])
north_node = max(nodes, key=lambda n: n[1]["y"])

orig_node, orig_data = south_node
dest_node, dest_data = north_node

path = nx.shortest_path(G, orig_node, dest_node, weight="length")
print(f"Path found: {len(path)} nodes — origin/destination resolve correctly.")
print(f"Origin  (use this in your demo/backend): lat={orig_data['y']:.6f}, lon={orig_data['x']:.6f}")
print(f"Destination (use this in your demo/backend): lat={dest_data['y']:.6f}, lon={dest_data['x']:.6f}")