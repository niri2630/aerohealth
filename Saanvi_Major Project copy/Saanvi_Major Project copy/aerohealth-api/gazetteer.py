"""
Offline place search over the bundled gazetteer.json (real OpenStreetMap place names for the
Mangaluru area plus the street names of the bundled road graph).

Used only when the online lookup service (Nominatim / Photon) cannot be reached, for example on a
network that blocks it. It also understands typed coordinates such as "12.8417, 74.9230", which
need no lookup at all.
"""
from __future__ import annotations

import difflib
import json
import os
import re
from typing import Dict, List, Optional

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gazetteer.json")
_places: Optional[List[dict]] = None
_COORDS = re.compile(r"^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


def _load() -> List[dict]:
    global _places
    if _places is None:
        try:
            with open(_PATH, encoding="utf-8") as f:
                _places = json.load(f).get("places", [])
        except (OSError, ValueError):
            _places = []
    return _places


def _tokens(text: str) -> List[str]:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).split()


def parse_coordinates(query: str) -> Optional[Dict]:
    """'12.8417, 74.9230' -> a result without any lookup (latitude first)."""
    m = _COORDS.match(query)
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"lat": lat, "lon": lon, "display_name": f"{lat:.5f}, {lon:.5f}", "name": "", "source": "coordinates"}


def available() -> bool:
    return bool(_load())


def search(query: str, limit: int = 5) -> List[Dict]:
    """Best matches first. Prefix matches rank above substring matches, then typo-tolerant matches."""
    direct = parse_coordinates(query)
    if direct:
        return [direct]
    q = _tokens(query)
    if not q:
        return []
    scored = []
    for p in _load():
        name_t = _tokens(p["name"])
        display = p["display"].lower()
        score = 0.0
        if name_t and all(any(nt.startswith(t) for nt in name_t) for t in q):
            score = 60 + 10 * len(q) / max(1, len(name_t))
        elif all(t in display for t in q):
            score = 35
        elif name_t:
            ratio = difflib.SequenceMatcher(None, " ".join(q), " ".join(name_t)).ratio()
            if ratio >= 0.72:  # tolerate typos such as "mangalor univercity"
                score = 40 * ratio
        if score:
            score += {"landmark": 4, "nearby": 1, "street": 0}.get(p.get("kind", ""), 0)
            scored.append((score, p))
    scored.sort(key=lambda s: -s[0])
    return [
        {
            "lat": p["lat"],
            "lon": p["lon"],
            "display_name": p["display"],
            "name": p["name"],
            "source": "offline",
        }
        for _, p in scored[:limit]
    ]
