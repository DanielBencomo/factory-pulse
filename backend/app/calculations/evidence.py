"""Interpretación conservadora de la telemetría; un campo ausente no es cero."""
from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any

OCCUPANCY_MAX_AGE_S = 12.0


def latest_zone_counts(
    snapshots: Iterable[tuple[str, float, Mapping[str, int]]],
) -> dict[tuple[str, str], tuple[float, int]]:
    """Keep the latest measurement of each source/zone; preserve explicit zeros."""
    latest: dict[tuple[str, str], tuple[float, int]] = {}
    for source, at, counts in snapshots:
        for zone, count in counts.items():
            key = (source, zone)
            if key not in latest or at >= latest[key][0]:
                latest[key] = (at, count)
    return latest


def sum_zone_counts(latest: Mapping[tuple[str, str], tuple[float, int]]) -> Counter[str]:
    totals: Counter[str] = Counter()
    for (_, zone), (_, count) in latest.items():
        totals[zone] += count
    return totals


def matches_calibration(payload: dict, device_id: str | None, revisions: dict[str, str]) -> bool:
    revision = revisions.get(device_id or "")
    return revision is not None and payload.get("calibration_revision") == revision


def floor_position(payload: dict, device_id: str | None, revisions: dict[str, str], zone_revision: str) -> tuple[str, float, float] | None:
    track = payload.get("track_id")
    segment = payload.get("segment_id")
    x, y = payload.get("x"), payload.get("y")
    if (
        payload.get("coordinate_space") == "floor" and matches_calibration(payload, device_id, revisions)
        and payload.get("zone_revision") == zone_revision
        and isinstance(segment, str) and 0 < len(segment) <= 64
        and isinstance(track, str) and track
        and type(x) in (int, float) and 0 <= x <= 1
        and type(y) in (int, float) and 0 <= y <= 1
    ):
        return track, x, y
    return None


def count_value(value: Any) -> int | None:
    return value if type(value) is int and 0 <= value else None


def zone_counts(payload: dict, device_id: str | None, revisions: dict[str, str], zone_revision: str) -> dict[str, int]:
    counts = payload.get("counts")
    vision = isinstance(counts, dict) or payload.get("coordinate_space") in ("image", "floor") or payload.get("source") == "vision_yolo_bytetrack"
    if vision and (
        payload.get("coordinate_space") != "floor" or not matches_calibration(payload, device_id, revisions)
        or payload.get("zone_revision") != zone_revision
    ):
        return {}
    if not isinstance(counts, dict):
        zone = payload.get("zone_id")
        counts = {zone: payload.get("count")} if isinstance(zone, str) else {}
    return {
        zone: value for zone, value in counts.items()
        if isinstance(zone, str) and zone and zone != "__plant__" and count_value(value) is not None
    }


def presence_value(payload: dict) -> bool | None:
    if type(payload.get("present")) is bool:
        return payload["present"]
    state = payload.get("state")
    if state in ("actividad", "quietud"):
        return True
    if state == "sin_presencia":
        return False
    return None
