import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cameras.calibration import MAIN_FLOOR_ID, active_revisions, frame_revision, revision_key
from app.database import get_db
from app.models.db_models import DBFloorPlan
from app.models.schemas import FloorPlanCreate, FloorPlanResponse, ScaleCalibration

router = APIRouter()


async def _out(floor: DBFloorPlan, session: AsyncSession) -> FloorPlanResponse:
    revisions = await active_revisions(session, floor)
    frame = frame_revision(floor)
    return FloorPlanResponse(
        id=floor.id, name=floor.name, description=floor.description,
        width_meters=floor.width_meters, height_meters=floor.height_meters,
        image_url=floor.image_url, svg_data=floor.svg_data,
        created_at=floor.created_at, updated_at=floor.updated_at,
        calibration=ScaleCalibration(is_calibrated=bool(revisions), frame_revision=frame, revision_key=revision_key(floor, revisions)),
    )


@router.get("/floorplans", response_model=list[FloorPlanResponse])
async def list_floorplans(session: AsyncSession = Depends(get_db)):
    rows = await session.scalars(select(DBFloorPlan).order_by(DBFloorPlan.id != MAIN_FLOOR_ID, DBFloorPlan.id))
    return [await _out(floor, session) for floor in rows]


@router.get("/floorplans/{plan_id}", response_model=FloorPlanResponse)
async def get_floorplan(plan_id: str, session: AsyncSession = Depends(get_db)):
    floor = await session.get(DBFloorPlan, plan_id)
    if not floor:
        raise HTTPException(404, "Plano no encontrado")
    return await _out(floor, session)


@router.post("/floorplans", response_model=FloorPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_floorplan(plan_in: FloorPlanCreate, session: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    floor = DBFloorPlan(
        id=f"fp-{uuid.uuid4().hex[:8]}", **plan_in.model_dump(exclude={"calibration"}),
        calibration={}, created_at=now, updated_at=now,
    )
    session.add(floor)
    await session.flush()
    return await _out(floor, session)


@router.put("/floorplans/{plan_id}/calibration", status_code=410)
async def retired_floor_scale(plan_id: str):
    raise HTTPException(410, "Define las dimensiones en Layout y calibra cada cámara desde el videowall")
