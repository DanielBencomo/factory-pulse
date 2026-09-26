"""
Layout editable de planta: dimensiones de la nave, líneas, zonas y estaciones.

GET /layout devuelve todo junto; PUT /layout lo reemplaza en una sola transacción
(alta, cambio y baja por id). Los campos de operación de una estación
(estado, piezas del turno, último ciclo) no se tocan al editar.
"""
from datetime import datetime
from typing import Dict, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.db_models import DBFloorPlan, DBLine, DBPolygonZone, DBStation, DBAuditLog, DBEvent
from app.models.schemas import LayoutPayload
from app.ws.manager import ws_manager

router = APIRouter()

EQUIPMENT_TYPES = {"smt", "reflow", "aoi", "pack", "manual", "generic"}


def _line_dict(l: DBLine) -> Dict:
    return {"id": l.id, "floor_plan_id": l.floor_plan_id, "name": l.name, "order": l.order, "polygon": l.polygon}


def _zone_dict(z: DBPolygonZone) -> Dict:
    return {
        "id": z.id,
        "zone_id": z.zone_id,
        "floor_plan_id": z.floor_plan_id,
        "name": z.name,
        "type": z.type,
        "polygon": z.polygon,
        "color": z.color,
        "station_ids": z.station_ids or [],
        "max_capacity": z.max_capacity,
        "max_stay_seconds": z.max_stay_seconds,
        "is_aggregated_only": z.is_aggregated_only,
        "line_id": z.line_id,
        "interior": z.interior,
    }


def _station_dict(s: DBStation) -> Dict:
    return {
        "id": s.id,
        "station_id": s.station_id,
        "line_id": s.line_id,
        "name": s.name,
        "order_in_line": s.order_in_line,
        "ideal_cycle_seconds": s.ideal_cycle_seconds,
        "position_x": s.position_x,
        "position_y": s.position_y,
        "target_pieces_per_hour": s.target_pieces_per_hour,
        "equipment_type": s.equipment_type or "generic",
    }


@router.get("/lines")
async def list_lines(session: AsyncSession = Depends(get_db)):
    res = await session.execute(select(DBLine).order_by(DBLine.order))
    return [_line_dict(l) for l in res.scalars().all()]


@router.get("/layout")
async def get_layout(session: AsyncSession = Depends(get_db)):
    fp = (await session.execute(select(DBFloorPlan))).scalars().first()
    if not fp:
        raise HTTPException(status_code=404, detail="No hay plano configurado")
    lines = (await session.execute(select(DBLine).order_by(DBLine.order))).scalars().all()
    zones = (await session.execute(select(DBPolygonZone))).scalars().all()
    stations = (await session.execute(select(DBStation).order_by(DBStation.line_id, DBStation.order_in_line))).scalars().all()
    return {
        "floor_plan": {"id": fp.id, "name": fp.name, "width_meters": fp.width_meters, "height_meters": fp.height_meters},
        "lines": [_line_dict(l) for l in lines],
        "zones": [_zone_dict(z) for z in zones],
        "stations": [_station_dict(s) for s in stations],
    }


def _validate(payload: LayoutPayload) -> None:
    errors: List[str] = []

    def in_unit(poly, what):
        if len(poly) < 3:
            errors.append(f"{what}: el polígono necesita al menos 3 vértices")
        for p in poly:
            if len(p) != 2 or not (-1e-6 <= p[0] <= 1 + 1e-6 and -1e-6 <= p[1] <= 1 + 1e-6):
                errors.append(f"{what}: hay vértices fuera de la nave")
                break

    line_ids = [l.id for l in payload.lines]
    if len(set(line_ids)) != len(line_ids):
        errors.append("Hay líneas con id repetido")
    for l in payload.lines:
        if not l.name.strip():
            errors.append(f"La línea {l.id} no tiene nombre")
        if l.polygon is not None:
            in_unit(l.polygon, f"Área de {l.name}")

    st_ids = [s.station_id for s in payload.stations]
    if len(set(st_ids)) != len(st_ids):
        errors.append("Hay estaciones con id repetido")
    for s in payload.stations:
        if s.line_id not in line_ids:
            errors.append(f"{s.name}: la línea {s.line_id} no existe")
        if s.equipment_type not in EQUIPMENT_TYPES:
            errors.append(f"{s.name}: tipo de equipo desconocido '{s.equipment_type}'")
        if not s.name.strip():
            errors.append(f"La estación {s.station_id} no tiene nombre")

    zone_ids = [z.zone_id for z in payload.zones]
    if len(set(zone_ids)) != len(zone_ids):
        errors.append("Hay zonas con id repetido")
    for z in payload.zones:
        in_unit(z.polygon, z.name)
        if z.line_id is not None and z.line_id not in line_ids:
            errors.append(f"{z.name}: la línea {z.line_id} no existe")
        for sid in z.station_ids:
            if sid not in st_ids:
                errors.append(f"{z.name}: la estación {sid} no existe")

    if errors:
        raise HTTPException(status_code=422, detail=errors)


@router.put("/layout")
async def save_layout(payload: LayoutPayload, session: AsyncSession = Depends(get_db)):
    _validate(payload)

    # Nave
    fp = (await session.execute(select(DBFloorPlan).where(DBFloorPlan.id == payload.floor_plan.id))).scalar_one_or_none()
    if not fp:
        raise HTTPException(status_code=404, detail="Plano no encontrado")
    resized = (fp.width_meters, fp.height_meters) != (payload.floor_plan.width_meters, payload.floor_plan.height_meters)
    fp.name = payload.floor_plan.name
    fp.width_meters = payload.floor_plan.width_meters
    fp.height_meters = payload.floor_plan.height_meters
    if resized:
        # Las coordenadas son relativas a la nave: la escala horizontal sigue al ancho.
        calib = dict(fp.calibration or {})
        calib["meters_per_norm_unit"] = payload.floor_plan.width_meters
        calib["real_distance_meters"] = round(payload.floor_plan.width_meters * 0.9, 2)
        # Las posiciones anteriores están en el marco viejo; no se reescriben (son
        # telemetría cruda), solo se marca desde cuándo aplica el marco nuevo.
        latest = (await session.execute(select(func.max(DBEvent.occurred_at)).where(DBEvent.type == "position"))).scalar()
        calib["frame_since"] = latest.isoformat() if latest else None
        fp.calibration = calib
    fp.updated_at = datetime.utcnow()

    # Líneas
    existing_lines = {l.id: l for l in (await session.execute(select(DBLine))).scalars().all()}
    for l in payload.lines:
        row = existing_lines.pop(l.id, None)
        if row is None:
            session.add(DBLine(id=l.id, floor_plan_id=fp.id, name=l.name, order=l.order, polygon=l.polygon))
        else:
            row.name, row.order, row.polygon = l.name, l.order, l.polygon
    for row in existing_lines.values():
        await session.delete(row)

    # Estaciones
    existing_st = {s.station_id: s for s in (await session.execute(select(DBStation))).scalars().all()}
    for s in payload.stations:
        row = existing_st.pop(s.station_id, None)
        fields = s.model_dump(exclude={"id", "station_id"})
        if row is None:
            session.add(DBStation(id=s.id, station_id=s.station_id, current_status="idle", parts_produced_shift=0, **fields))
        else:
            for k, v in fields.items():
                setattr(row, k, v)
    for row in existing_st.values():
        await session.delete(row)

    # Zonas
    existing_z = {z.zone_id: z for z in (await session.execute(select(DBPolygonZone))).scalars().all()}
    for z in payload.zones:
        row = existing_z.pop(z.zone_id, None)
        fields = z.model_dump(exclude={"id", "zone_id"})
        fields["type"] = z.type.value
        fields["floor_plan_id"] = fp.id
        if z.type.value == "bathroom":
            fields["is_aggregated_only"] = True  # privacidad no negociable en sanitarios
        if row is None:
            session.add(DBPolygonZone(id=z.id, zone_id=z.zone_id, created_at=datetime.utcnow(), **fields))
        else:
            for k, v in fields.items():
                setattr(row, k, v)
    for row in existing_z.values():
        await session.delete(row)

    session.add(DBAuditLog(
        action="UPDATE_LAYOUT",
        actor=payload.author,
        entity_type="FLOOR_PLAN",
        entity_id=fp.id,
        details={
            "lines": len(payload.lines),
            "zones": len(payload.zones),
            "stations": len(payload.stations),
            "width_meters": payload.floor_plan.width_meters,
            "height_meters": payload.floor_plan.height_meters,
        },
    ))
    await session.commit()

    await ws_manager.broadcast({"type": "LAYOUT_UPDATED"})
    return await get_layout(session)
