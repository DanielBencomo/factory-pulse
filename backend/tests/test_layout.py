import copy
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import init_db


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_layout_roundtrip_adds_line_and_station_then_restores():
    async with client() as ac:
        original = (await ac.get("/api/layout")).json()
        assert original["lines"], "debe existir al menos la línea sembrada"
        assert all("equipment_type" in s for s in original["stations"])

        draft = copy.deepcopy(original)
        draft["lines"].append({"id": "line-test", "name": "Línea prueba", "order": 9, "polygon": None})
        draft["stations"].append({
            "id": "st-test", "station_id": "st-test", "line_id": "line-test", "name": "Mesa manual",
            "order_in_line": 1, "ideal_cycle_seconds": 30, "position_x": 0.5, "position_y": 0.9,
            "target_pieces_per_hour": 100, "equipment_type": "manual",
        })
        draft["zones"].append({
            "id": "zone-test", "zone_id": "zone-test", "floor_plan_id": original["floor_plan"]["id"],
            "name": "Mesa manual", "type": "work", "polygon": [[0.45, 0.85], [0.55, 0.85], [0.55, 0.95], [0.45, 0.95]],
            "color": "#000000", "station_ids": ["st-test"], "max_stay_seconds": 600,
            "is_aggregated_only": False, "line_id": "line-test",
        })
        draft["floor_plan"]["width_meters"] = 60

        saved = await ac.put("/api/layout", json=draft)
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["floor_plan"]["width_meters"] == 60
        # al redimensionar se marca desde cuándo vale el nuevo marco de coordenadas
        from app.database import AsyncSessionLocal
        from app.models.db_models import DBFloorPlan
        from sqlalchemy import select
        async with AsyncSessionLocal() as s:
            fp = (await s.execute(select(DBFloorPlan).where(DBFloorPlan.id == original["floor_plan"]["id"]))).scalar_one()
            assert "frame_since" in fp.calibration
            assert fp.calibration["meters_per_norm_unit"] == 60
        assert any(l["id"] == "line-test" for l in body["lines"])
        st = next(s for s in body["stations"] if s["station_id"] == "st-test")
        assert st["equipment_type"] == "manual" and st["line_id"] == "line-test"

        # restaurar el layout original (borra lo agregado)
        restored = await ac.put("/api/layout", json=original)
        assert restored.status_code == 200
        body = restored.json()
        assert not any(l["id"] == "line-test" for l in body["lines"])
        assert not any(s["station_id"] == "st-test" for s in body["stations"])
        assert body["floor_plan"]["width_meters"] == original["floor_plan"]["width_meters"]


@pytest.mark.asyncio
async def test_layout_rejects_station_on_missing_line_without_changes():
    async with client() as ac:
        original = (await ac.get("/api/layout")).json()
        bad = copy.deepcopy(original)
        bad["stations"][0]["line_id"] = "no-existe"
        res = await ac.put("/api/layout", json=bad)
        assert res.status_code == 422
        assert (await ac.get("/api/layout")).json() == original


@pytest.mark.asyncio
async def test_bathroom_zone_is_always_aggregated():
    async with client() as ac:
        original = (await ac.get("/api/layout")).json()
        draft = copy.deepcopy(original)
        bath = next(z for z in draft["zones"] if z["type"] == "bathroom")
        bath["is_aggregated_only"] = False
        body = (await ac.put("/api/layout", json=draft)).json()
        assert next(z for z in body["zones"] if z["zone_id"] == bath["zone_id"])["is_aggregated_only"] is True
        await ac.put("/api/layout", json=original)


@pytest.mark.asyncio
async def test_track_history_shape():
    async with client() as ac:
        res = await ac.get("/api/tracks/history?minutes=5")
    assert res.status_code == 200
    for pts in res.json().values():
        assert all(len(p) == 3 for p in pts)
        assert [p[2] for p in pts] == sorted(p[2] for p in pts)
