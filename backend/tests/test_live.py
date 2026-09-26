"""Flujo con dispositivos reales: nada de esto depende del simulador."""
import uuid
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select, delete

from app.calculations.analytics import compute_line_analytics
from app.database import AsyncSessionLocal, init_db
from app.live.processor import LiveProcessor
from app.main import app
from app.models.db_models import DBAlert, DBEvent, DBPolygonZone, DBStation, DBStop
from app.simulator.engine import simulator


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    simulator.pause()
    simulator.mode = "live"
    async with AsyncSessionLocal() as s:
        await s.execute(delete(DBEvent).where(DBEvent.mode.in_(["live", "replay"])))
        await s.execute(delete(DBAlert))
        await s.execute(delete(DBStop).where(DBStop.status == "open"))
        await s.commit()
    yield
    simulator.mode = "demo"


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def station_and_center(station_id="st-1"):
    async with AsyncSessionLocal() as s:
        z = next(z for z in (await s.execute(select(DBPolygonZone))).scalars().all() if station_id in (z.station_ids or []))
        xs = [p[0] for p in z.polygon]
        ys = [p[1] for p in z.polygon]
        return z.zone_id, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def ev(etype, payload, device="esp32-test", at=None):
    return {
        "event_id": f"t-{uuid.uuid4().hex[:10]}", "device_id": device, "type": etype, "payload": payload,
        "mode": "live", **({"occurred_at": at.isoformat()} if at else {}),
    }


@pytest.mark.asyncio
async def test_processor_derives_station_status_from_real_events():
    zone_id, cx, cy = await station_and_center("st-1")
    async with client() as ac:
        await ac.post("/api/events", json=ev("position", {"track_id": "CAM-1", "x": cx, "y": cy}))
        await ac.post("/api/events", json=ev("cycle", {"station_id": "st-1", "cycle_time_seconds": 30}))
    lp = LiveProcessor()
    for _ in range(5):  # la 5a vuelta hace la evaluación completa
        await lp.tick("live")
    async with AsyncSessionLocal() as s:
        st = (await s.execute(select(DBStation).where(DBStation.station_id == "st-1"))).scalar_one()
        assert st.current_status == "active"
        others = (await s.execute(select(DBStation).where(DBStation.station_id != "st-1"))).scalars().all()
        assert all(o.current_status == "unattended" for o in others)  # la cámara ve y ahí no hay nadie


@pytest.mark.asyncio
async def test_stop_button_opens_pending_stop_then_justify_and_close():
    async with client() as ac:
        await ac.post("/api/events", json=ev("button_press", {"station_id": "st-2", "action": "stop_line"}))
        stops = [s for s in (await ac.get("/api/stops")).json() if s["status"] == "open" and s["scope_id"] == "st-2"]
        assert len(stops) == 1 and stops[0]["reason_code"] == "PEND-01" and stops[0]["is_authorized"] is False

        res = await ac.put(f"/api/stops/{stops[0]['id']}", json={"reason_code": "MOD-01", "is_authorized": True, "author": "Supervisor"})
        assert res.status_code == 200 and res.json()["reason"].startswith("Cambio de modelo")

        await ac.post("/api/events", json=ev("button_press", {"station_id": "st-2", "action": "stop_line"}))
        s2 = next(s for s in (await ac.get("/api/stops")).json() if s["id"] == stops[0]["id"])
        assert s2["status"] == "closed" and s2["is_authorized"] is True


@pytest.mark.asyncio
async def test_rfid_reads_show_badge_owner_in_zone_signals():
    zone_id, _, _ = await station_and_center("st-1")
    async with client() as ac:
        await ac.post("/api/badges", json={"tag_id": "04:a1:b2:c3", "person": "Ana Ruiz", "role": "Operadora"})
        await ac.post("/api/events", json=ev("zone_enter", {"station_id": "st-1", "tag_id": "04:A1:B2:C3"}))
        await ac.post("/api/events", json=ev("zone_enter", {"station_id": "st-1", "tag_id": "04:FF:00:11"}))
        await ac.post("/api/events", json=ev("presence", {"station_id": "st-1", "source": "csi", "state": "actividad", "confidence": 0.8}))
        sig = (await ac.get(f"/api/zones/{zone_id}/signals")).json()
        assert sig["rfid"][0]["tag_id"] == "04:FF:00:11" and sig["rfid"][0]["person"] is None
        assert sig["rfid"][1]["person"] == "Ana Ruiz"
        assert sig["csi"]["state"] == "actividad"
        badges = (await ac.get("/api/badges")).json()
        assert any(u["tag_id"] == "04:FF:00:11" for u in badges["unknown"])
        await ac.delete("/api/badges/04:A1:B2:C3")


@pytest.mark.asyncio
async def test_rfid_without_camera_confirmation_raises_discrepancy_once():
    zone_id, cx, cy = await station_and_center("st-1")
    async with AsyncSessionLocal() as s:
        now = datetime.utcnow()
        # la cámara está activa (ve a alguien lejos de la estación) y el RFID de st-1 leyó hace 30 s
        for i in range(0, 60, 2):
            s.add(DBEvent(event_id=f"p-{uuid.uuid4().hex[:8]}", device_id="cam", type="position", mode="live",
                          occurred_at=now - timedelta(seconds=60 - i), received_at=now, payload={"track_id": "CAM-9", "x": 0.99, "y": 0.99}))
        s.add(DBEvent(event_id=f"r-{uuid.uuid4().hex[:8]}", device_id="rfid", type="zone_enter", mode="live",
                      occurred_at=now - timedelta(seconds=30), received_at=now, payload={"station_id": "st-1", "tag_id": "04:00:00:01"}))
        await s.commit()
    lp = LiveProcessor()
    for _ in range(10):
        await lp.tick("live")
    async with AsyncSessionLocal() as s:
        alerts = (await s.execute(select(DBAlert).where(DBAlert.rule_id == "sensor_discrepancy"))).scalars().all()
        assert len(alerts) == 1 and alerts[0].scope_id == "st-1"


@pytest.mark.asyncio
async def test_recording_save_and_replay_uses_separate_mode():
    zone_id, cx, cy = await station_and_center("st-1")
    async with client() as ac:
        for i in range(5):
            await ac.post("/api/events", json=ev("position", {"track_id": "CAM-2", "x": cx, "y": cy + i * 0.001}))
        rec = await ac.post("/api/recordings", json={"name": "Ensayo", "minutes": 5})
        assert rec.status_code == 201 and rec.json()["event_count"] >= 5
        play = await ac.post(f"/api/recordings/{rec.json()['id']}/play?speed=10&loop=false")
        assert play.status_code == 200 and simulator.mode == "replay"
        import asyncio
        await asyncio.sleep(1.0)
        async with AsyncSessionLocal() as s:
            n = len((await s.execute(select(DBEvent).where(DBEvent.mode == "replay"))).scalars().all())
        assert n >= 5
        back = await ac.put("/api/system/mode?mode=live")
        assert back.json()["mode"] == "live" and back.json()["playback"]["active"] is False
        await ac.delete(f"/api/recordings/{rec.json()['id']}")


def test_csi_presence_counts_when_camera_is_missing():
    square = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]
    st = {"station_id": "s1", "name": "s1", "order": 1, "ideal_cycle": 30.0, "target_pph": 60, "polygon": square}
    presence = {"s1": [(t, True) for t in range(0, 600, 10)]}
    r = compute_line_analytics(
        t0=0, t1=600, stations=[st], positions={}, machine={}, cycles={}, stops=[], line_area=None,
        m_per_x=40, m_per_y=25, step_s=10, presence=presence,
        zones=[{"zone_id": "z1", "name": "Z", "type": "work", "polygon": square}],
    )
    sec = r["stations"][0]["seconds"]
    assert sec["presente"] == pytest.approx(600, abs=10) and sec["sin_datos"] == 0


def test_zone_dwell_counts_person_time_and_visits():
    square = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]
    st = {"station_id": "s1", "name": "s1", "order": 1, "ideal_cycle": 30.0, "target_pph": 60, "polygon": square}
    # dos personas 5 min dentro, una sale y vuelve a entrar
    a = [(t, 0.2, 0.2) for t in range(0, 300, 2)]
    b = [(t, 0.2, 0.2) for t in range(0, 100, 2)] + [(t, 0.8, 0.8) for t in range(100, 200, 2)] + [(t, 0.2, 0.2) for t in range(200, 300, 2)]
    r = compute_line_analytics(
        t0=0, t1=300, stations=[st], positions={"A": a, "B": b}, machine={}, cycles={}, stops=[], line_area=None,
        m_per_x=40, m_per_y=25, step_s=5, zones=[{"zone_id": "z1", "name": "Z", "type": "storage", "polygon": square}],
    )
    z = r["zone_dwell"][0]
    assert z["person_s"] == pytest.approx(500, abs=15)
    assert z["occupied_s"] == pytest.approx(300, abs=10)
    assert z["visits"] == 3


@pytest.mark.asyncio
async def test_persistent_condition_does_not_duplicate_alerts():
    from app.rules.engine import rule_engine
    async with AsyncSessionLocal() as s:
        stations = [{"station_id": "st-3", "name": "AOI", "current_status": "unattended"}]
        rule_engine.last_triggered.clear()
        await rule_engine.evaluate_rules(s, [], stations, [], [], [])
        await s.commit()
        rule_engine.last_triggered.clear()  # simula que ya pasó el enfriamiento
        await rule_engine.evaluate_rules(s, [], stations, [], [], [])
        await s.commit()
        n = len((await s.execute(select(DBAlert).where(DBAlert.rule_id == "unattended_station"))).scalars().all())
    assert n == 1
