"""
Señales reales por área y registro de tarjetas RFID.

GET /zones/{zone_id}/signals   últimas lecturas RFID, estado CSI/PIR, pulsador y ciclos
GET/POST/DELETE /badges        tarjeta → persona (la identidad solo se usa en checkpoints)
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import DBBadge, DBEvent, DBPolygonZone
from app.simulator.engine import simulator

router = APIRouter()


def _matches(p: dict, station_id: Optional[str], zone_id: str) -> bool:
    return (station_id is not None and p.get("station_id") == station_id) or p.get("zone_id") == zone_id


@router.get("/zones/{zone_id}/signals")
async def zone_signals(zone_id: str, session: AsyncSession = Depends(get_db)):
    zone = (await session.execute(select(DBPolygonZone).where(DBPolygonZone.zone_id == zone_id))).scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zona no encontrada")
    station_id = zone.station_ids[0] if zone.station_ids else None
    mode = simulator.mode
    now = datetime.utcnow()

    rows = (
        await session.execute(
            select(DBEvent.occurred_at, DBEvent.type, DBEvent.payload, DBEvent.device_id)
            .where(
                DBEvent.mode == mode,
                DBEvent.occurred_at >= now - timedelta(hours=1),
                DBEvent.type.in_(["zone_enter", "zone_exit", "presence", "button_press", "cycle", "machine_state"]),
            )
            .order_by(DBEvent.occurred_at.desc())
            .limit(3000)
        )
    ).all()
    rows = [r for r in rows if _matches(r[2] or {}, station_id, zone_id)]

    badges = {b.tag_id: b for b in (await session.execute(select(DBBadge))).scalars().all()}
    rfid = []
    csi = pir = button = machine = None
    cycles_hour = 0
    last_cycle = None
    for at, etype, p, dev in rows:
        if etype in ("zone_enter", "zone_exit") and p.get("tag_id") and len(rfid) < 6:
            b = badges.get(p["tag_id"])
            rfid.append({
                "tag_id": p["tag_id"], "kind": "entrada" if etype == "zone_enter" else "salida", "at": at.isoformat(),
                "person": b.person if b else None, "role": b.role if b else None, "device_id": dev,
            })
        elif etype == "presence":
            if p.get("source") == "csi" and csi is None:
                csi = {"state": p.get("state"), "confidence": p.get("confidence"), "motion": p.get("motion"), "at": at.isoformat(), "device_id": dev}
            elif p.get("source") != "csi" and pir is None:
                pir = {"present": bool(p.get("present")), "confidence": p.get("confidence"), "at": at.isoformat(), "device_id": dev}
        elif etype == "button_press" and button is None:
            button = {"action": p.get("action"), "at": at.isoformat(), "device_id": dev}
        elif etype == "cycle":
            cycles_hour += int(p.get("total_parts") or 1)
            if last_cycle is None:
                last_cycle = {"at": at.isoformat(), "cycle_time_seconds": p.get("cycle_time_seconds")}
        elif etype == "machine_state" and machine is None:
            machine = {"state": p.get("state"), "at": at.isoformat()}

    return {
        "zone_id": zone_id, "station_id": station_id, "mode": mode, "now": now.isoformat(),
        "rfid": rfid, "csi": csi, "pir": pir, "button": button,
        "process": {"cycles_last_hour": cycles_hour, "last_cycle": last_cycle, "machine": machine},
    }


class BadgeIn(BaseModel):
    tag_id: str = Field(..., min_length=2, max_length=64)
    person: str = Field(..., min_length=1, max_length=128)
    role: Optional[str] = Field(None, max_length=64)


@router.get("/badges")
async def list_badges(session: AsyncSession = Depends(get_db)):
    badges = (await session.execute(select(DBBadge).order_by(DBBadge.person))).scalars().all()
    known = {b.tag_id for b in badges}
    # Tarjetas leídas por algún lector que aún no tienen dueño
    rows = (
        await session.execute(
            select(DBEvent.occurred_at, DBEvent.payload)
            .where(DBEvent.type == "zone_enter", DBEvent.occurred_at >= datetime.utcnow() - timedelta(days=2))
            .order_by(DBEvent.occurred_at.desc())
            .limit(2000)
        )
    ).all()
    unknown = {}
    for at, p in rows:
        tag = (p or {}).get("tag_id")
        if tag and tag not in known:
            u = unknown.setdefault(tag, {"tag_id": tag, "last_seen": at.isoformat(), "station_id": p.get("station_id"), "reads": 0})
            u["reads"] += 1
    return {
        "badges": [{"tag_id": b.tag_id, "person": b.person, "role": b.role, "active": b.active} for b in badges],
        "unknown": list(unknown.values()),
    }


@router.post("/badges", status_code=201)
async def save_badge(badge: BadgeIn, session: AsyncSession = Depends(get_db)):
    tag = badge.tag_id.strip().upper()
    row = (await session.execute(select(DBBadge).where(DBBadge.tag_id == tag))).scalar_one_or_none()
    if row:
        row.person, row.role, row.active = badge.person, badge.role, True
    else:
        session.add(DBBadge(tag_id=tag, person=badge.person, role=badge.role))
    await session.commit()
    return {"tag_id": tag, "person": badge.person, "role": badge.role}


@router.delete("/badges/{tag_id}", status_code=204)
async def delete_badge(tag_id: str, session: AsyncSession = Depends(get_db)):
    row = (await session.execute(select(DBBadge).where(DBBadge.tag_id == tag_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Tarjeta no registrada")
    await session.delete(row)
    await session.commit()
