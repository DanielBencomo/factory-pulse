"""Interpretación conservadora de la telemetría; un campo ausente no es cero."""
from typing import Any


def floor_position(payload: dict) -> tuple[str, float, float] | None:
    track = payload.get("track_id")
    x, y = payload.get("x"), payload.get("y")
    if (
        payload.get("coordinate_space") == "floor"
        and isinstance(track, str) and track
        and type(x) in (int, float) and 0 <= x <= 1
        and type(y) in (int, float) and 0 <= y <= 1
    ):
        return track, x, y
    return None


def count_value(value: Any) -> int | None:
    return value if type(value) is int and 0 <= value else None


def zone_counts(payload: dict) -> dict[str, int]:
    counts = payload.get("counts")
    if isinstance(counts, dict):
        # Antes no se distinguía entre coordenadas de cámara y de piso.
        if payload.get("coordinate_space") != "floor":
            return {}
    else:
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
