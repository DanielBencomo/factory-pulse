import json

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.calculations.spatial import build_spatial_insights, compute_spatial_summary
from app.database import init_db
from app.main import app


ZONES = [
    {
        "zone_id": "assembly",
        "name": "Ensamble",
        "type": "work",
        "polygon": [[0.0, 0.0], [0.4, 0.0], [0.4, 1.0], [0.0, 1.0]],
        "max_capacity": 1,
        "is_aggregated_only": False,
    },
    {
        "zone_id": "materials",
        "name": "Materiales",
        "type": "storage",
        "polygon": [[0.4, 0.0], [0.8, 0.0], [0.8, 1.0], [0.4, 1.0]],
        "max_capacity": 3,
        "is_aggregated_only": False,
    },
    {
        "zone_id": "private",
        "name": "Zona sensible",
        "type": "bathroom",
        "polygon": [[0.8, 0.0], [1.0, 0.0], [1.0, 1.0], [0.8, 1.0]],
        "max_capacity": 2,
        "is_aggregated_only": True,
    },
]


def test_spatial_summary_routes_motion_congestion_and_privacy():
    # T-01 alterna Ensamble ↔ Materiales; T-02 provoca sobrecapacidad en
    # Ensamble y T-PRIVATE solo debe contribuir a agregados anónimos.
    positions = {
        "T-01": [
            (0, 0.15, 0.5, 0.0),
            (10, 0.55, 0.5, 0.8),
            (20, 0.15, 0.5, 0.8),
            (30, 0.55, 0.5, 0.8),
            (40, 0.15, 0.5, 0.8),
            (50, 0.55, 0.5, 0.8),
        ],
        "T-02": [(t, 0.2, 0.55, 0.0) for t in range(0, 60, 5)],
        "T-PRIVATE": [(t, 0.9, 0.5, 0.0) for t in range(0, 60, 5)],
    }
    result = compute_spatial_summary(
        t0=0,
        t1=60,
        step_s=5,
        zones=ZONES,
        positions=positions,
        occupancy={},
        width_m=10,
        height_m=5,
    )

    summary = result["summary"]
    by_zone = {zone["zone_id"]: zone for zone in result["zones"]}
    assert summary["coverage_pct"] == 100
    assert summary["total_transitions"] >= 4
    assert summary["backtrack_ratio_pct"] > 0
    assert by_zone["assembly"]["congested_seconds"] > 0
    assert by_zone["assembly"]["stationary_pct"] > 0
    assert by_zone["materials"]["visits"] >= 2
    assert by_zone["private"]["visits"] is None
    assert by_zone["private"]["unknown_motion_pct"] == 100

    serialized = json.dumps(result)
    assert "T-01" not in serialized
    assert "T-02" not in serialized
    assert "T-PRIVATE" not in serialized
    assert "track_id" not in serialized


def test_spatial_insights_are_explainable_and_do_not_label_productivity():
    result = compute_spatial_summary(
        t0=0,
        t1=60,
        step_s=5,
        zones=ZONES,
        positions={
            "T": [(t, 0.55, 0.5, 0.0) for t in range(0, 60, 5)],
        },
        occupancy={},
        width_m=10,
        height_m=5,
    )
    insights = build_spatial_insights(result)
    assert insights
    assert all({"observation", "evidence", "suggestion", "layer"} <= item.keys() for item in insights)
    language = json.dumps(insights, ensure_ascii=False).lower()
    assert "improductivo" not in language
    assert "quietud" in language


def test_private_zone_breaks_routes_and_stale_count_is_unknown():
    result = compute_spatial_summary(
        t0=0,
        t1=60,
        step_s=5,
        zones=ZONES,
        positions={
            # No debe convertirse en una ruta pública assembly → materials.
            "T": [(0, 0.15, 0.5, 0.5), (10, 0.9, 0.5, 0.5), (20, 0.55, 0.5, 0.5)],
        },
        occupancy={},
        width_m=10,
        height_m=5,
    )
    assert result["transitions"] == []
    # La última posición venció mucho antes del final de la ventana. Cero
    # significaría ausencia observada; None expresa correctamente "sin dato".
    assert result["summary"]["fresh"] is False
    assert result["summary"]["current_people"] is None
    assert all(zone["current_count"] is None for zone in result["zones"])


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()


@pytest.mark.asyncio
async def test_spatial_endpoint_shape_and_no_identifiers():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/spatial/summary",
            params={"scope": "line", "scope_id": "line-1", "minutes": 15, "mode": "demo"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert {"summary", "zones", "transitions", "insights", "methodology"} <= body.keys()
    assert "coverage_pct" in body["summary"]
    assert "track_id" not in json.dumps(body)
    assert "Sin reconocimiento facial" in body["methodology"]["privacy"]
