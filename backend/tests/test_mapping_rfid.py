import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.config import settings
from app.database import AsyncSessionLocal
from app.main import app
from app.models.db_models import DBDevice, DBEvent
from app.simulator.engine import simulator


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_rfid_adapter_normalizes_and_deduplicates_reader():
    suffix = uuid.uuid4().hex[:8]
    event_id = f"rfid-test-{suffix}"
    reader = f"reader-{suffix}"
    body = {
        "event_id": event_id,
        "reader_id": reader,
        "tag_id": " e2:00:ab:01 ",
        "event": "read",
        "zone_id": "zone-storage",
        "antenna_id": "A1",
        "rssi": -47.2,
    }
    async with client() as ac:
        first = await ac.post("/api/rfid/events", json=body)
        second = await ac.post("/api/rfid/events", json=body)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["type"] == "zone_enter"
    assert first.json()["payload"]["tag_id"] == "E2:00:AB:01"
    async with AsyncSessionLocal() as session:
        events = (
            await session.execute(select(DBEvent).where(DBEvent.event_id == event_id))
        ).scalars().all()
        device = (
            await session.execute(select(DBDevice).where(DBDevice.device_id == reader))
        ).scalar_one()
    assert len(events) == 1
    assert device.type == "rfid_reader"


@pytest.mark.asyncio
async def test_rfid_token_and_registered_reader_target(monkeypatch):
    monkeypatch.setattr(settings, "RFID_INGEST_TOKEN", "test-secret")
    suffix = uuid.uuid4().hex[:8]
    reader = f"reader-secure-{suffix}"
    async with client() as ac:
        registered = await ac.post("/api/devices", json={
            "device_id": reader,
            "name": "Portal UHF",
            "type": "rfid_reader",
            "station_id": "st-1",
            "zone_id": "zone-ws1",
        })
        assert registered.status_code == 201, registered.text
        denied = await ac.post("/api/rfid/events", json={"reader_id": reader, "tag_id": "ABC"})
        accepted = await ac.post(
            "/api/rfid/events",
            headers={"X-Factory-Pulse-Key": "test-secret"},
            json={"reader_id": reader, "tag_id": "ABC", "event": "enter"},
        )
    assert denied.status_code == 401
    assert accepted.status_code == 201
    assert accepted.json()["payload"]["station_id"] == "st-1"
    assert accepted.json()["payload"]["zone_id"] == "zone-ws1"


@pytest.mark.asyncio
async def test_camera_mapping_zone_privacy_and_line_polygon_roundtrip():
    suffix = uuid.uuid4().hex[:8]
    async with client() as ac:
        line = next(item for item in (await ac.get("/api/lines")).json() if item["id"] == "line-1")
        original = line["polygon"]
        polygon = [[0.02, 0.02], [0.16, 0.02], [0.16, 0.16], [0.02, 0.16]]
        updated = await ac.put("/api/lines/line-1/polygon", json={"polygon": polygon})
        assert updated.status_code == 200, updated.text
        assert updated.json()["polygon"] == polygon

        created = await ac.post("/api/zones", json={
            "zone_id": f"bathroom-map-{suffix}",
            "floor_plan_id": "fp-main",
            "name": "Acceso sanitario de prueba",
            "type": "bathroom",
            "polygon": [[0.80, 0.02], [0.95, 0.02], [0.95, 0.15], [0.80, 0.15]],
            "color": "#ec4899",
            "station_ids": [],
            "is_aggregated_only": False,
        })
        assert created.status_code == 201, created.text
        assert created.json()["is_aggregated_only"] is True
        if original is not None:
            restored = await ac.put("/api/lines/line-1/polygon", json={"polygon": original})
            assert restored.status_code == 200


@pytest.mark.asyncio
async def test_bundled_occupancy_combines_public_and_private_without_ids():
    old_mode = simulator.mode
    simulator.mode = "live"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(DBEvent).where(DBEvent.type.in_(["position", "zone_occupancy"]), DBEvent.mode == "live"))
            await session.commit()
        async with client() as ac:
            await ac.post("/api/events", json={
                "event_id": f"position-{uuid.uuid4().hex}",
                "device_id": "camera-bundle-test",
                "type": "position",
                "mode": "live",
                "payload": {"track_id": "TEMP-1", "x": 0.17, "y": 0.38},
            })
            await ac.post("/api/events", json={
                "event_id": f"occupancy-{uuid.uuid4().hex}",
                "device_id": "camera-bundle-test",
                "type": "zone_occupancy",
                "mode": "live",
                "payload": {
                    "zone_id": "__plant__",
                    "count": 2,
                    "counts": {"zone-ws1": 1, "zone-bathroom": 1},
                    "aggregated": True,
                },
            })
            response = await ac.get("/api/zones/occupancy/live")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total_people"] == 2
        assert body["tracked_people"] == 1
        assert next(z for z in body["zones"] if z["zone_id"] == "zone-bathroom")["count"] == 1
        assert "track_id" not in json.dumps(body)
    finally:
        simulator.mode = old_mode
