import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from datetime import datetime, timedelta

from app.main import app
from app.database import init_db

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()

@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "degraded"]
    assert "timestamp_utc" in data
    assert "simulator" in data

@pytest.mark.asyncio
async def test_event_ingest_and_deduplication():
    event_payload = {
        "event_id": "test-ev-unique-12345",
        "device_id": "esp32-test-unit",
        "source_id": "pytest",
        "occurred_at": datetime.utcnow().isoformat(),
        "type": "presence",
        "payload": {"station_id": "st-1", "present": True, "confidence": 0.99},
        "quality": 1.0,
        "mode": "live"
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # First ingest -> 201 Created
        res1 = await ac.post("/api/events", json=event_payload)
        assert res1.status_code == 201
        data1 = res1.json()
        assert data1["event_id"] == "test-ev-unique-12345"

        # Duplicate ingest -> returns existing event without error
        res2 = await ac.post("/api/events", json=event_payload)
        assert res2.status_code == 200 or res2.status_code == 201
        data2 = res2.json()
        assert data2["event_id"] == "test-ev-unique-12345"

@pytest.mark.asyncio
async def test_stop_lifecycle_and_validation():
    now = datetime.utcnow()
    stop_payload = {
        "scope_type": "line",
        "scope_id": "line-1",
        "reason": "Mantenimiento preventivo",
        "reason_code": "MAN-01",
        "author": "Supervisor QA",
        "started_at": now.isoformat(),
        "is_authorized": True,
        "notes": "Paro de prueba"
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Create Stop
        create_res = await ac.post("/api/stops", json=stop_payload)
        assert create_res.status_code == 201
        stop_data = create_res.json()
        stop_id = stop_data["id"]
        assert stop_data["status"] == "open"

        # 2. Close Stop
        end_time = now + timedelta(minutes=5)
        close_res = await ac.put(f"/api/stops/{stop_id}/close?ended_at={end_time.isoformat()}")
        assert close_res.status_code == 200
        closed_data = close_res.json()
        assert closed_data["status"] == "closed"
        assert closed_data["duration_seconds"] == 300.0

@pytest.mark.asyncio
async def test_metrics_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/metrics?window_minutes=60")
        assert res.status_code == 200
        data = res.json()
        assert "time_universe" in data
        assert "stations" in data
        assert "zones" in data
        assert "distances" in data
        assert data["time_universe"]["gross_planned_seconds"] == 3600.0

@pytest.mark.asyncio
async def test_catalog_modules():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/modules")
        assert res.status_code == 200
        modules = res.json()
        assert len(modules) >= 12
        categories = {m["category"] for m in modules}
        assert len(categories) >= 8
