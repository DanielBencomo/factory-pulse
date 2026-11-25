"""Server-side policy for geometry and privacy of incoming vision samples."""
import json
from hashlib import sha256

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.calculations.trajectory import in_closed_polygon
from app.calculations.evidence import count_value, floor_position
from app.cameras.calibration import MAIN_FLOOR_ID, active_calibration, inside, main_floor
from app.models.db_models import DBCameraConfig, DBPolygonZone


async def vision_zones(session: AsyncSession) -> list[DBPolygonZone]:
    rows = await session.scalars(select(DBPolygonZone).where(DBPolygonZone.floor_plan_id == MAIN_FLOOR_ID))
    return list(rows)


def zone_revision(zones) -> str:
    geometry = sorted(
        (z.zone_id, z.polygon, bool(z.is_aggregated_only or z.type == "bathroom"))
        for z in zones if z.floor_plan_id == MAIN_FLOOR_ID
    )
    return sha256(json.dumps(geometry, separators=(",", ":")).encode()).hexdigest()


def is_vision(event_type: str, payload: dict) -> bool:
    return event_type == "position" or (
        event_type == "zone_occupancy" and (
            "counts" in payload or "coordinate_space" in payload
            or payload.get("source") == "vision_yolo_bytetrack"
        )
    )


def vision_payload(event_type: str, payload: dict) -> dict:
    if not is_vision(event_type, payload):
        return payload
    shared = {"source", "coordinate_space", "zone_revision", "calibration_revision", "zone_id"}
    fields = (
        {"x", "y", "track_id", "segment_id", "confidence", "speed_m_s"} if event_type == "position"
        else {"count", "counts", "aggregated"}
    )
    return {key: value for key, value in payload.items() if key in shared | fields}


class VisionIngestPolicy:
    def __init__(self, zones, calibrations):
        self.revision = zone_revision(zones)
        self.private = [z.polygon for z in zones if z.is_aggregated_only or z.type == "bathroom"]
        self.calibrations = calibrations
        self.coverage = {
            device: {
                z.zone_id for z in zones if len(z.polygon) >= 3
                and all(inside(p, data["floor_hull"]) for p in z.polygon)
            }
            for device, data in calibrations.items()
        }
        self.revisions = {device: data["revision"] for device, data in calibrations.items()}

    @classmethod
    async def load(cls, session: AsyncSession):
        # SQLite's deferred reads don't lock the layout. Serialize validation and
        # insertion with layout edits; the caller commits the entire batch once.
        if session.get_bind().dialect.name == "sqlite":
            await session.execute(text("BEGIN IMMEDIATE"))
        zones = await vision_zones(session)
        floor = await main_floor(session)
        cameras = await session.scalars(select(DBCameraConfig).where(DBCameraConfig.enabled.is_(True)))
        return cls(zones, {
            camera.device_id: data for camera in cameras if (data := active_calibration(camera, floor))
        })

    def allows(self, event_type: str, device: str | None, payload: dict) -> bool:
        if not is_vision(event_type, payload):
            return True
        if event_type == "zone_occupancy" and payload.get("coordinate_space") == "image":
            return (
                payload.get("zone_id") == "__plant__" and count_value(payload.get("count")) is not None
                and payload.get("counts", {}) == {}
            )
        if not device or payload.get("zone_revision") != self.revision:
            return False
        data = self.calibrations.get(device)
        if not data or payload.get("calibration_revision") != data["revision"]:
            return False
        if event_type == "position":
            point = floor_position(payload, device, self.revisions, self.revision)
            if not point:
                return False
            _, x, y = point
            return inside((x, y), data["floor_hull"]) and not any(in_closed_polygon((x, y), p) for p in self.private)
        counts = payload.get("counts")
        return (
            payload.get("coordinate_space") == "floor" and payload.get("zone_id") == "__plant__"
            and count_value(payload.get("count")) is not None and isinstance(counts, dict)
            and all(zone in self.coverage[device] and count_value(n) is not None for zone, n in counts.items())
        )
