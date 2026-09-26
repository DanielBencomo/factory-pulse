import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.calculations.analytics import compute_line_analytics
from app.database import init_db
from app.main import app

SQUARE = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]


def station(sid="s1", order=1, target=60):
    return {"station_id": sid, "name": sid, "order": order, "ideal_cycle": 30.0, "target_pph": target, "polygon": SQUARE}


def test_states_follow_presence_process_and_stops():
    # 0–300 s: operador dentro y ciclos → productivo
    # 300–600 s: operador dentro sin ciclos → espera
    # 600–900 s: nadie → ausencia
    # 900–1200 s: paro justificado → paro
    pos = [(t, 0.2, 0.2) for t in range(0, 600, 2)] + [(t, 0.8, 0.8) for t in range(600, 1200, 2)]
    cycles = [(t, 30.0, True) for t in range(15, 300, 30)]
    r = compute_line_analytics(
        t0=0, t1=1200, stations=[station()], positions={"T": pos}, machine={}, cycles={"s1": cycles},
        stops=[{"start": 900, "end": 1200, "authorized": True, "reason": "Junta", "station_ids": None}],
        line_area=[[0, 0], [1, 0], [1, 1], [0, 1]], m_per_x=40, m_per_y=25, step_s=10, bucket_s=300,
    )
    sec = r["stations"][0]["seconds"]
    assert sec["productivo"] == pytest.approx(300 + 60, abs=20)  # incluye la vigencia del último ciclo
    assert sec["espera"] == pytest.approx(240, abs=20)
    assert sec["ausencia"] == pytest.approx(300, abs=10)
    assert sec["paro"] == pytest.approx(300, abs=10)
    assert r["summary"]["stops_minutes"] == 5.0
    assert r["stops_pareto"][0] == {"reason": "Junta", "minutes": 5.0, "count": 1}
    assert r["output_by_bucket"]["s1"][0] == 10
    assert sum(r["output_by_bucket"]["s1"][1:]) == 0


def test_presence_without_process_sensor_is_not_called_productive():
    pos = [(t, 0.2, 0.2) for t in range(0, 600, 2)]
    r = compute_line_analytics(
        t0=0, t1=600, stations=[station()], positions={"T": pos}, machine={}, cycles={}, stops=[],
        line_area=None, m_per_x=40, m_per_y=25, step_s=10,
    )
    sec = r["stations"][0]["seconds"]
    assert sec["productivo"] == 0 and sec["espera"] == 0
    assert sec["presente"] == pytest.approx(600, abs=10)
    assert r["summary"]["has_process_data"] is False


def test_camera_gap_is_no_data_not_absence_and_rate_uses_available_time():
    # 0–600 s sin ninguna posición (cámara caída); 600–1200 s operador dentro con 20 ciclos
    pos = [(t, 0.2, 0.2) for t in range(600, 1200, 2)]
    cycles = [(t, 30.0, True) for t in range(615, 1200, 30)]
    r = compute_line_analytics(
        t0=0, t1=1200, stations=[station()], positions={"T": pos}, machine={}, cycles={"s1": cycles}, stops=[],
        line_area=None, m_per_x=40, m_per_y=25, step_s=10,
    )
    st = r["stations"][0]
    assert st["seconds"]["sin_datos"] == pytest.approx(600, abs=10)
    assert st["seconds"]["ausencia"] == 0
    # 20 piezas en ~10 min disponibles ≈ 120 pzs/h (no 60 como daría la ventana completa)
    assert st["pieces_per_hour"] == pytest.approx(120, rel=0.05)
    assert r["summary"]["pct_of_available"]["productivo"] > 95


def test_distance_counts_only_inside_line_area():
    # 0.1 normalizado en x = 4 m; la mitad del recorrido queda fuera del área
    pos = [(0, 0.1, 0.5), (2, 0.2, 0.5), (4, 0.6, 0.5), (6, 0.7, 0.5)]
    area = [[0, 0], [0.25, 0], [0.25, 1], [0, 1]]
    r = compute_line_analytics(
        t0=0, t1=60, stations=[station()], positions={"T": pos}, machine={}, cycles={}, stops=[],
        line_area=area, m_per_x=40, m_per_y=25, step_s=5, bucket_s=60,
    )
    assert r["summary"]["distance_m"] == pytest.approx(4.0, abs=0.01)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_registered_device_waits_until_first_heartbeat():
    async with client() as ac:
        await ac.delete("/api/devices/esp32-test-wait")
        res = await ac.post("/api/devices", json={"device_id": "esp32-test-wait", "name": "RFID prueba", "type": "esp32_rfid"})
        assert res.status_code == 201
        assert res.json()["status"] == "waiting"

        hb = await ac.post("/api/devices/esp32-test-wait/heartbeat", json={"firmware": "fp-1.0"})
        assert hb.status_code == 200 and hb.json()["registered"] is True

        dev = next(d for d in (await ac.get("/api/devices")).json() if d["device_id"] == "esp32-test-wait")
        assert dev["status"] == "online" and dev["firmware_version"] == "fp-1.0"
        assert (await ac.delete("/api/devices/esp32-test-wait")).status_code == 204


@pytest.mark.asyncio
async def test_unknown_device_is_discovered_unregistered():
    async with client() as ac:
        await ac.delete("/api/devices/esp32-desconocido")
        hb = await ac.post("/api/devices/esp32-desconocido/heartbeat")
        assert hb.status_code == 200 and hb.json()["registered"] is False
        dev = next(d for d in (await ac.get("/api/devices")).json() if d["device_id"] == "esp32-desconocido")
        assert dev["is_active"] is False and dev["simulated"] is False
        await ac.delete("/api/devices/esp32-desconocido")


@pytest.mark.asyncio
async def test_interior_roundtrip_and_bounds():
    async with client() as ac:
        layout = (await ac.get("/api/layout")).json()
        zone = next(z for z in layout["zones"] if z["type"] == "work")
        before = zone.get("interior")
        items = [
            {"id": "m1", "kind": "machine", "x": 0.5, "y": 0.5, "w": 3, "h": 2, "rot": 0, "variant": "manual", "label": "Mesa"},
            {"id": "r1", "kind": "rfid", "x": 1, "y": 5, "w": 0.6, "h": 0.6, "rot": 0, "device_id": "esp32-x"},
        ]
        ok = await ac.put(f"/api/zones/{zone['zone_id']}/interior", json={"items": items, "operator": {"x": 2, "y": 4}})
        assert ok.status_code == 200, ok.text
        saved = next(z for z in (await ac.get("/api/layout")).json()["zones"] if z["zone_id"] == zone["zone_id"])
        assert [i["id"] for i in saved["interior"]] == ["m1", "r1"]

        bad = await ac.put(f"/api/zones/{zone['zone_id']}/interior", json={"items": [{**items[0], "x": 500}]})
        assert bad.status_code == 422

        await ac.put(f"/api/zones/{zone['zone_id']}/interior", json={"items": before or []})


@pytest.mark.asyncio
async def test_analytics_endpoint_shape():
    async with client() as ac:
        r = (await ac.get("/api/analytics?line_id=line-1&minutes=15")).json()
    assert set(r["states"]) == {"productivo", "espera", "presente", "ausencia", "paro", "sin_datos"}
    assert len(r["timeline"]) == len(r["stations"])
    assert "pct_of_available" in r["summary"]
