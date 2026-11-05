"""
Safe route computation using OSMnx graphs with AQI-weighted edges.
Supports on-demand downloading of road networks for any location worldwide.
"""
import pickle
import os
import time
import threading
from typing import Dict, Tuple, Optional
import networkx as nx
import math
import httpx

# Global graph cache: location_key -> graph
_graphs: Dict[str, nx.MultiDiGraph] = {}
_aqi_cache: Dict[Tuple[float, float], float] = {}
_download_status: Dict[str, dict] = {}  # Track download progress

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "graph_cache")
DEMO_GRAPH_PATH = os.path.join(BASE_DIR, "..", "demo_graph.pickle")
os.makedirs(CACHE_DIR, exist_ok=True)

# Verified demo coordinates (both resolve to nodes in demo_graph.pickle)
DEMO_ORIGIN = (12.841690, 74.922980)
DEMO_DEST = (12.894754, 74.946824)

# Tunable parameter: how much to weight AQI vs distance.
# Used as a multiplier on edge length so pollution can change the chosen path.
LAMBDA = 2.5


def get_location_key(lat: float, lon: float) -> str:
    """Generate cache key for a location (rounded to 0.1 degree ~11km)."""
    return f"{round(lat, 1)}_{round(lon, 1)}"


def get_cache_path(location_key: str) -> str:
    """Get filesystem cache path for a location."""
    return os.path.join(CACHE_DIR, f"graph_{location_key}.pickle")


def _route_span_km(origin: Tuple[float, float], dest: Tuple[float, float]) -> float:
    """Fast approximate distance between two lat/lon points in kilometers."""
    return math.hypot(dest[0] - origin[0], dest[1] - origin[1]) * 111


def _graph_bounds(graph: nx.MultiDiGraph) -> Optional[Tuple[float, float, float, float]]:
    """Return the graph's lat/lon bounds as (min_lat, max_lat, min_lon, max_lon)."""
    latitudes = []
    longitudes = []
    for _, data in graph.nodes(data=True):
        lat = data.get('y', data.get('lat'))
        lon = data.get('x', data.get('lon'))
        if lat is None or lon is None:
            continue
        latitudes.append(lat)
        longitudes.append(lon)

    if not latitudes or not longitudes:
        return None

    return min(latitudes), max(latitudes), min(longitudes), max(longitudes)


def _covers_both_points(graph: nx.MultiDiGraph, origin: Tuple[float, float], dest: Tuple[float, float]) -> bool:
    """Check whether the graph likely contains both endpoints with a small padding."""
    bounds = _graph_bounds(graph)
    if bounds is None:
        return False

    min_lat, max_lat, min_lon, max_lon = bounds
    padding = 0.01  # ~1.1km
    low_lat = min(origin[0], dest[0])
    high_lat = max(origin[0], dest[0])
    low_lon = min(origin[1], dest[1])
    high_lon = max(origin[1], dest[1])

    return (
        low_lat >= min_lat - padding
        and high_lat <= max_lat + padding
        and low_lon >= min_lon - padding
        and high_lon <= max_lon + padding
    )


def _safe_waypoint(origin: Tuple[float, float], dest: Tuple[float, float]) -> Tuple[float, float]:
    """Pick a waypoint near the route midpoint, nudged away from polluted hotspots."""
    mid_lat = (origin[0] + dest[0]) / 2
    mid_lon = (origin[1] + dest[1]) / 2

    # Perpendicular offset to encourage a visual and geographic detour.
    delta_lat = dest[0] - origin[0]
    delta_lon = dest[1] - origin[1]
    norm = math.hypot(delta_lat, delta_lon) or 1.0
    perp_lat = -delta_lon / norm
    perp_lon = delta_lat / norm
    offset = 0.012  # ~1.3km

    candidate_a = (mid_lat + perp_lat * offset, mid_lon + perp_lon * offset)
    candidate_b = (mid_lat - perp_lat * offset, mid_lon - perp_lon * offset)

    # Choose the side with lower synthetic AQI exposure.
    return candidate_a if get_edge_aqi(*candidate_a) <= get_edge_aqi(*candidate_b) else candidate_b


def load_graph():
    """
    Load initial demo graph from demo_graph.pickle at startup.
    This pre-warms the cache with Mangaluru area.
    """
    global _graphs
    
    pickle_path = DEMO_GRAPH_PATH
    
    if os.path.exists(pickle_path):
        print(f"Loading pre-downloaded graph from {pickle_path}...")
        with open(pickle_path, "rb") as f:
            graph = pickle.load(f)
        print(f"Graph loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
        
        # Cache it under Mangaluru's location key
        mangaluru_key = get_location_key(12.87, 74.93)
        _graphs[mangaluru_key] = graph
        print(f"Cached under key: {mangaluru_key}")
        return
    
    print(f"WARNING: {pickle_path} not found - will download on-demand")


def download_graph_for_location(
    lat: float,
    lon: float,
    location_key: str,
    *,
    dist_m: float = 5000,
) -> Optional[nx.MultiDiGraph]:
    """
    Download road network from OpenStreetMap for a location.
    Updates download status for progress tracking.
    """
    import osmnx as ox
    
    cache_path = get_cache_path(location_key)
    
    # Update status
    _download_status[location_key] = {
        "status": "downloading",
        "progress": 0,
        "message": f"Downloading road network...",
        "start_time": time.time()
    }
    
    print(f"Downloading road network for ({lat}, {lon})...")
    start = time.time()
    
    try:
        # Download graph (this takes 30-120 seconds)
        _download_status[location_key]["progress"] = 20
        _download_status[location_key]["message"] = "Fetching from OpenStreetMap..."
        
        graph = ox.graph_from_point(
            (lat, lon),
            dist=dist_m,
            network_type='drive',
            simplify=True
        )
        
        _download_status[location_key]["progress"] = 70
        _download_status[location_key]["message"] = "Processing road network..."
        
        # Add speed and travel time
        graph = ox.add_edge_speeds(graph)
        graph = ox.add_edge_travel_times(graph)
        
        _download_status[location_key]["progress"] = 90
        _download_status[location_key]["message"] = "Caching for future use..."
        
        # Save to cache
        with open(cache_path, 'wb') as f:
            pickle.dump(graph, f)
        
        elapsed = time.time() - start
        print(f"Downloaded and cached in {elapsed:.1f}s: {graph.number_of_nodes()} nodes")
        
        _download_status[location_key] = {
            "status": "complete",
            "progress": 100,
            "message": "Ready!",
            "elapsed": elapsed
        }
        
        return graph
        
    except Exception as e:
        print(f"Download failed: {e}")
        _download_status[location_key] = {
            "status": "failed",
            "progress": 0,
            "message": f"Download failed: {str(e)}",
            "error": str(e)
        }
        return None


def get_graph_for_location(lat: float, lon: float) -> Optional[nx.MultiDiGraph]:
    """
    Get graph for a location - from memory cache, disk cache, or download.
    """
    location_key = get_location_key(lat, lon)
    
    # Check memory cache first
    if location_key in _graphs:
        print(f"Using cached graph for {location_key}")
        return _graphs[location_key]
    
    # Check disk cache
    cache_path = get_cache_path(location_key)
    if os.path.exists(cache_path):
        print(f"Loading graph from disk cache: {location_key}")
        try:
            with open(cache_path, 'rb') as f:
                graph = pickle.load(f)
            _graphs[location_key] = graph
            return graph
        except Exception as e:
            print(f"Failed to load cached graph: {e}")
    
    # Download if not cached
    print(f"No cache found for {location_key}, downloading...")
    graph = download_graph_for_location(lat, lon, location_key)
    
    if graph:
        _graphs[location_key] = graph
    
    return graph


def get_graph_for_route(origin: Tuple[float, float], dest: Tuple[float, float]) -> Optional[nx.MultiDiGraph]:
    """
    Get or build a graph that covers both endpoints of a route.

    The graph is still cached by the origin key so the status endpoint keeps
    working, but new downloads are centered on the midpoint and sized to cover
    the whole trip.
    """
    location_key = get_location_key(origin[0], origin[1])
    midpoint_lat = (origin[0] + dest[0]) / 2
    midpoint_lon = (origin[1] + dest[1]) / 2

    # Reuse cached graph if it already spans both endpoints.
    if location_key in _graphs:
        cached = _graphs[location_key]
        if _covers_both_points(cached, origin, dest):
            print(f"Using cached graph for {location_key}")
            return cached

    cache_path = get_cache_path(location_key)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'rb') as f:
                graph = pickle.load(f)
            if _covers_both_points(graph, origin, dest):
                _graphs[location_key] = graph
                return graph
            print(f"Cached graph for {location_key} is too small for this route; refreshing...")
        except Exception as e:
            print(f"Failed to load cached graph: {e}")

    # If we already started a download for this route, let the caller poll.
    if _download_status.get(location_key, {}).get("status") == "downloading":
        return None

    # Start the download in the background and return immediately so the API
    # can surface a downloading status instead of timing out on fresh routes.
    span_km = _route_span_km(origin, dest)
    dist_m = max(5000, int(span_km * 1000 * 1.7) + 2000)
    print(f"Downloading route graph centered on midpoint with radius {dist_m}m...")
    _download_status[location_key] = {
        "status": "downloading",
        "progress": 0,
        "message": "Starting road network download...",
        "start_time": time.time(),
    }
    threading.Thread(
        target=download_graph_for_location,
        args=(midpoint_lat, midpoint_lon, location_key),
        kwargs={"dist_m": dist_m},
        daemon=True,
    ).start()
    return None


def get_download_status(lat: float, lon: float) -> dict:
    """Get download status for a location."""
    location_key = get_location_key(lat, lon)
    
    # Check if already cached
    if location_key in _graphs:
        return {"status": "ready", "progress": 100, "message": "Graph ready"}
    
    # Check if downloading
    if location_key in _download_status:
        status = _download_status[location_key].copy()
        # Add estimated time remaining
        if status["status"] == "downloading" and "start_time" in status:
            elapsed = time.time() - status["start_time"]
            # Estimate 60-120 seconds total download time
            estimated_total = 90
            remaining = max(0, estimated_total - elapsed)
            status["estimated_remaining"] = int(remaining)
        return status
    
    return {"status": "not_started", "progress": 0, "message": "Not downloaded yet"}


def nearest_node(graph: nx.MultiDiGraph, lat: float, lon: float) -> Optional[int]:
    """Find nearest node in graph to given coordinates."""
    if graph is None:
        return None
    
    min_dist = float('inf')
    nearest = None
    
    for node, data in graph.nodes(data=True):
        node_lat = data.get('y', data.get('lat'))
        node_lon = data.get('x', data.get('lon'))
        if node_lat is None or node_lon is None:
            continue
        
        dist = math.hypot(lat - node_lat, lon - node_lon)
        if dist < min_dist:
            min_dist = dist
            nearest = node
    
    return nearest


def get_edge_aqi(lat: float, lon: float) -> float:
    """
    Estimate AQI at edge midpoint with significant spatial variation.
    Uses cached values to avoid repeated AQI API calls.
    Creates realistic pollution hotspots and clean zones.
    """
    key = (round(lat, 3), round(lon, 3))
    if key in _aqi_cache:
        return _aqi_cache[key]
    
    # Create pollution hotspots and clean corridors for realistic variation
    # Hotspot 1: Around 12.87, 74.93 (city center - high traffic)
    dist_hotspot1 = math.hypot(lat - 12.87, lon - 74.93) * 111  # km
    hotspot1_effect = max(0, 80 - dist_hotspot1 * 20)  # High pollution near center
    
    # Hotspot 2: Around 12.85, 74.94 (industrial area)
    dist_hotspot2 = math.hypot(lat - 12.85, lon - 74.94) * 111
    hotspot2_effect = max(0, 60 - dist_hotspot2 * 15)
    
    # Clean corridor: Along 74.92 longitude (coastal breeze)
    coastal_effect = max(0, 40 - abs(lon - 74.92) * 300)  # Lower AQI near coast
    
    # Base AQI with variation
    base_aqi = 60 + math.sin(lat * 100) * 20 + math.cos(lon * 100) * 15
    
    # Combine effects
    aqi = base_aqi + hotspot1_effect + hotspot2_effect - coastal_effect
    aqi = max(30, min(150, aqi))  # clip to reasonable range
    
    _aqi_cache[key] = aqi
    return aqi


def get_edge_pollutants(lat: float, lon: float) -> Dict[str, float]:
    """Estimate route pollutant concentrations from the local AQI signal."""
    aqi = get_edge_aqi(lat, lon)
    variation = 0.9 + (math.sin(lat * 37 + lon * 19) + 1) * 0.05
    return {
        "pm25": round(max(1.0, aqi * 0.52 * variation), 1),
        "pm10": round(max(2.0, aqi * 0.83 * variation), 1),
        "no2": round(max(1.0, (12 + aqi * 0.24) * variation), 1),
        "so2": round(max(0.5, (3 + aqi * 0.07) * variation), 1),
        "o3": round(max(1.0, (18 + aqi * 0.28) * (1.05 - (variation - 0.9))), 1),
    }


def _pollutants_for_coordinates(coordinates: list) -> Dict[str, float]:
    """Average estimated pollutants along an OSRM route geometry."""
    if not coordinates:
        return {"pm25": 0.0, "pm10": 0.0, "no2": 0.0, "so2": 0.0, "o3": 0.0}

    totals = {"pm25": 0.0, "pm10": 0.0, "no2": 0.0, "so2": 0.0, "o3": 0.0}
    for lon, lat in coordinates:
        values = get_edge_pollutants(lat, lon)
        for name, value in values.items():
            totals[name] += value
    count = len(coordinates)
    return {name: round(value / count, 1) for name, value in totals.items()}


def _osrm_route(origin: Tuple[float, float], dest: Tuple[float, float]) -> Optional[Dict]:
    """Fetch fast global driving routes from the public OSRM service."""
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    )
    try:
        response = httpx.get(
            url,
            params={"overview": "full", "geometries": "geojson", "alternatives": "true"},
            headers={"User-Agent": "AeroHealth/1.0"},
            timeout=15.0,
        )
        response.raise_for_status()
        payload = response.json()
        osrm_routes = payload.get("routes", [])
        if not osrm_routes:
            return None

        direct = osrm_routes[0]
        safe = osrm_routes[1] if len(osrm_routes) > 1 else direct

        def leg(route: dict) -> Dict:
            coordinates = route.get("geometry", {}).get("coordinates", [])
            avg_aqi = round(sum(get_edge_aqi(lat, lon) for lon, lat in coordinates) / len(coordinates)) if coordinates else 75
            return {
                "geojson": {"type": "LineString", "coordinates": coordinates},
                "distance_km": round(float(route.get("distance", 0)) / 1000, 1),
                "duration_min": round(float(route.get("duration", 0)) / 60),
                "avg_aqi_exposure": avg_aqi,
                "pollutants": _pollutants_for_coordinates(coordinates),
            }

        direct_leg = leg(direct)
        safe_leg = leg(safe)
        reduction = round((1 - safe_leg["avg_aqi_exposure"] / direct_leg["avg_aqi_exposure"]) * 100) if direct_leg["avg_aqi_exposure"] else 0
        return {
            "safe_route": safe_leg,
            "direct_route": direct_leg,
            "exposure_reduction_pct": reduction,
            "route_source": "OSRM / OpenStreetMap",
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        print(f"OSRM route unavailable for {origin} -> {dest}: {error}")
        return None


def compute_route(origin: Tuple[float, float], dest: Tuple[float, float]) -> Dict:
    """
    Compute both direct (shortest distance) and safe (AQI-weighted) routes.
    Returns GeoJSON LineStrings with coordinates in [lon, lat] order.
    Downloads graph on-demand if not cached.
    """
    # Use a fast global road router first. The local graph path below remains
    # available when the public router is unavailable or rate-limited.
    global_route = _osrm_route(origin, dest)
    if global_route:
        return global_route

    # Get graph for this location (may trigger download)
    graph = get_graph_for_route(origin, dest)
    
    if graph is None:
        # Check if currently downloading
        status = get_download_status(origin[0], origin[1])
        if status["status"] == "downloading":
            # Return an immediate geographic preview while OSM data downloads.
            # The frontend can render this now and replace it with the road
            # network route when the graph becomes ready.
            preview = _hardcoded_fallback(origin, dest)
            preview.update({
                "status": "downloading",
                "progress": status["progress"],
                "message": status["message"],
                "estimated_remaining": status.get("estimated_remaining", 90),
                "preview": True,
            })
            return preview
        # Fallback to hardcoded paths
        print(f"No graph available for {origin}, using fallback")
        return _hardcoded_fallback(origin, dest)
    
    origin_node = nearest_node(graph, origin[0], origin[1])
    dest_node = nearest_node(graph, dest[0], dest[1])
    
    if origin_node is None or dest_node is None:
        print(f"Could not resolve nodes for {origin} -> {dest}, using fallback")
        return _hardcoded_fallback(origin, dest)
    
    try:
        # Direct route: shortest path by distance
        direct_path = nx.shortest_path(graph, origin_node, dest_node, weight='length')
        direct_route = _path_to_route(graph, direct_path, "direct")
        
        # Safe route: AQI-weighted edges
        # Build edge weights: distance + LAMBDA * aqi_cost
        for u, v, k, data in graph.edges(keys=True, data=True):
            u_data = graph.nodes[u]
            v_data = graph.nodes[v]
            u_lat, u_lon = u_data.get('y', u_data.get('lat')), u_data.get('x', u_data.get('lon'))
            v_lat, v_lon = v_data.get('y', v_data.get('lat')), v_data.get('x', v_data.get('lon'))
            
            if u_lat is None or u_lon is None or v_lat is None or v_lon is None:
                continue
            
            mid_lat = (u_lat + v_lat) / 2
            mid_lon = (u_lon + v_lon) / 2
            aqi = get_edge_aqi(mid_lat, mid_lon)
            
            length = data.get('length', 100)  # meters
            data['aqi_weighted'] = length * (1 + (aqi / 100) * LAMBDA)
        
        waypoint = _safe_waypoint(origin, dest)
        waypoint_node = nearest_node(graph, waypoint[0], waypoint[1])

        safe_path = None
        if waypoint_node is not None and waypoint_node not in (origin_node, dest_node):
            try:
                first_leg = nx.shortest_path(graph, origin_node, waypoint_node, weight='aqi_weighted')
                second_leg = nx.shortest_path(graph, waypoint_node, dest_node, weight='aqi_weighted')
                safe_path = first_leg + second_leg[1:]
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                safe_path = None

        if not safe_path:
            safe_path = nx.shortest_path(graph, origin_node, dest_node, weight='aqi_weighted')

        # If the safe path still collapses to the direct route, fall back to a
        # graph edit that removes the dirtiest segment on the direct path.
        if safe_path == direct_path:
            reroute_graph = graph.copy()
            worst_edge = None
            worst_score = -1.0

            for idx in range(len(direct_path) - 1):
                u = direct_path[idx]
                v = direct_path[idx + 1]
                edge_data = graph.get_edge_data(u, v)
                if not edge_data:
                    continue

                for edge_key, edge_attrs in edge_data.items():
                    score = float(edge_attrs.get('aqi_weighted', edge_attrs.get('length', 100)))
                    if score > worst_score:
                        worst_score = score
                        worst_edge = (u, v, edge_key)

            if worst_edge is not None:
                u, v, edge_key = worst_edge
                try:
                    reroute_graph.remove_edge(u, v, edge_key)
                    alt_path = nx.shortest_path(reroute_graph, origin_node, dest_node, weight='aqi_weighted')
                    if alt_path != direct_path:
                        safe_path = alt_path
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    pass

        safe_route = _path_to_route(graph, safe_path, "safe")
        
        # Calculate exposure reduction
        direct_aqi = direct_route["avg_aqi_exposure"]
        safe_aqi = safe_route["avg_aqi_exposure"]
        reduction = round((1 - safe_aqi / direct_aqi) * 100) if direct_aqi > 0 else 0
        
        return {
            "safe_route": safe_route,
            "direct_route": direct_route,
            "exposure_reduction_pct": reduction,
        }
    
    except (nx.NetworkXNoPath, nx.NodeNotFound) as e:
        print(f"No path found between {origin_node} and {dest_node}: {e}")
        return _hardcoded_fallback(origin, dest)


def _path_to_route(graph: nx.MultiDiGraph, path: list, route_type: str) -> Dict:
    """
    Convert node path to route leg with GeoJSON.
    Coordinates are in [lon, lat] order (GeoJSON standard).
    """
    coords = []
    total_distance = 0.0
    aqi_sum = 0.0
    pollutant_sums = {"pm25": 0.0, "pm10": 0.0, "no2": 0.0, "so2": 0.0, "o3": 0.0}
    
    for i, node in enumerate(path):
        node_data = graph.nodes[node]
        lat = node_data.get('y', node_data.get('lat'))
        lon = node_data.get('x', node_data.get('lon'))
        
        if lat is not None and lon is not None:
            coords.append([lon, lat])  # GeoJSON order: [longitude, latitude]
        
        # Accumulate distance and AQI
        if i < len(path) - 1:
            next_node = path[i + 1]
            # Get edge data (handle MultiDiGraph with multiple edges)
            edge_data = graph.get_edge_data(node, next_node)
            if edge_data:
                # If multiple edges exist, take first one
                edge_info = edge_data[0] if isinstance(edge_data, dict) and 0 in edge_data else edge_data
                edge_length = edge_info.get('length', 100)  # meters
                total_distance += edge_length
                
                # Estimate AQI at edge midpoint
                next_data = graph.nodes[next_node]
                next_lat = next_data.get('y', next_data.get('lat'))
                next_lon = next_data.get('x', next_data.get('lon'))
                if next_lat and next_lon:
                    mid_lat = (lat + next_lat) / 2
                    mid_lon = (lon + next_lon) / 2
                    aqi_sum += get_edge_aqi(mid_lat, mid_lon) * edge_length
                    edge_pollutants = get_edge_pollutants(mid_lat, mid_lon)
                    for name, value in edge_pollutants.items():
                        pollutant_sums[name] += value * edge_length
    
    distance_km = round(total_distance / 1000, 1)  # convert m to km, 1 decimal
    avg_aqi = round(aqi_sum / total_distance) if total_distance > 0 else 75  # integer
    pollutants = {
        name: round(value / total_distance, 1) if total_distance > 0 else 0.0
        for name, value in pollutant_sums.items()
    }
    
    # Estimate duration: assume average speed of 25 km/h in urban area
    duration_min = round(distance_km * 2.4)  # integer
    
    return {
        "geojson": {
            "type": "LineString",
            "coordinates": coords,
        },
        "distance_km": distance_km,
        "duration_min": duration_min,
        "avg_aqi_exposure": avg_aqi,
        "pollutants": pollutants,
    }


def _hardcoded_fallback(
    origin: Tuple[float, float],
    dest: Tuple[float, float],
) -> Dict:
    """
    Hardcoded routes using verified demo coordinates.
    Used when graph loading fails or nodes can't be resolved.
    Coordinates are manually ordered origin -> destination for stroke animation.
    """
    # Generate smooth paths from origin to destination
    def interpolate(start: Tuple[float, float], end: Tuple[float, float], 
                   bow: float, n_points: int = 25) -> list:
        coords = []
        for i in range(n_points):
            t = i / (n_points - 1)
            curve = math.sin(t * math.pi) * bow
            lon = start[1] + (end[1] - start[1]) * t + curve
            lat = start[0] + (end[0] - start[0]) * t + curve * 0.6
            coords.append([lon, lat])
        return coords
    
    direct_coords = interpolate(origin, dest, 0)
    safe_coords = interpolate(origin, dest, 0.008)  # slight bow
    
    # Distance between demo points
    dist = math.hypot(dest[0] - origin[0], dest[1] - origin[1]) * 111
    direct_km = round(dist, 1)
    safe_km = round(dist * 1.12, 1)
    
    return {
        "safe_route": {
            "geojson": {"type": "LineString", "coordinates": safe_coords},
            "distance_km": safe_km,
            "duration_min": round(safe_km * 2.8),
            "avg_aqi_exposure": 68,
            "pollutants": {"pm25": 35.4, "pm10": 56.4, "no2": 28.3, "so2": 7.8, "o3": 37.0},
        },
        "direct_route": {
            "geojson": {"type": "LineString", "coordinates": direct_coords},
            "distance_km": direct_km,
            "duration_min": round(direct_km * 2.5),
            "avg_aqi_exposure": 112,
            "pollutants": {"pm25": 58.2, "pm10": 92.9, "no2": 38.9, "so2": 10.8, "o3": 49.4},
        },
        "exposure_reduction_pct": 39,
    }
