from typing import List, Tuple, Dict, Any, Optional
from datetime import datetime

def is_point_in_polygon(point: List[float], polygon: List[List[float]]) -> bool:
    """
    Ray-casting algorithm to determine if a normalized 2D point [x, y] is inside a polygon [[x1, y1], [x2, y2], ...].
    """
    if len(polygon) < 3:
        return False

    x, y = point[0], point[1]
    inside = False
    n = len(polygon)

    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y

    return inside

def find_zone_for_point(point: List[float], zones: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Returns the first zone containing the point, or None.
    """
    for zone in zones:
        polygon = zone.get("polygon", [])
        if is_point_in_polygon(point, polygon):
            return zone
    return None

def aggregate_zone_metrics(
    position_events: List[Dict[str, Any]],
    zones: List[Dict[str, Any]],
    sample_interval_sec: float = 2.0
) -> List[Dict[str, Any]]:
    """
    Aggregates dwell time and occupancy per zone based on positioning samples.
    Enforces privacy rules:
    - If is_aggregated_only is True (e.g. bathroom / rest area), individual track_ids are suppressed.
    """
    zone_stats: Dict[str, Dict[str, Any]] = {}

    for z in zones:
        zid = z["zone_id"]
        zone_stats[zid] = {
            "zone_id": zid,
            "zone_name": z["name"],
            "zone_type": z["type"],
            "is_aggregated_only": z.get("is_aggregated_only", False),
            "total_dwell_seconds": 0.0,
            "occupancy_count": 0,
            "unique_tracks": set(),
            "entry_count": 0,
            "exit_count": 0
        }

    # Group positions by track_id sorted by time
    tracks_data: Dict[str, List[Dict[str, Any]]] = {}
    for ev in position_events:
        payload = ev.get("payload", {})
        trk = payload.get("track_id")
        if not trk:
            continue
        if trk not in tracks_data:
            tracks_data[trk] = []
        tracks_data[trk].append(ev)

    current_occupants_per_zone: Dict[str, set] = {z["zone_id"]: set() for z in zones}

    for trk, evs in tracks_data.items():
        sorted_evs = sorted(evs, key=lambda x: x.get("occurred_at", datetime.min))
        last_zone_id = None
        
        for ev in sorted_evs:
            p = [ev["payload"]["x"], ev["payload"]["y"]]
            matched_zone = find_zone_for_point(p, zones)
            
            if matched_zone:
                zid = matched_zone["zone_id"]
                zone_stats[zid]["total_dwell_seconds"] += sample_interval_sec
                zone_stats[zid]["unique_tracks"].add(trk)
                current_occupants_per_zone[zid].add(trk)
                
                if last_zone_id != zid:
                    zone_stats[zid]["entry_count"] += 1
                    if last_zone_id and last_zone_id in zone_stats:
                        zone_stats[last_zone_id]["exit_count"] += 1
                    last_zone_id = zid
            else:
                if last_zone_id and last_zone_id in zone_stats:
                    zone_stats[last_zone_id]["exit_count"] += 1
                last_zone_id = None

    result = []
    for zid, data in zone_stats.items():
        data["occupancy_count"] = len(current_occupants_per_zone[zid])
        # Privacy enforcement: if aggregated only, do not expose track list
        data["unique_tracks_count"] = len(data["unique_tracks"])
        del data["unique_tracks"]
        result.append(data)

    return result
