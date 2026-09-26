import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBFloorPlan, DBAuditLog
from app.models.schemas import FloorPlanCreate, FloorPlanResponse, ScaleCalibration

router = APIRouter()

@router.get("/floorplans", response_model=List[FloorPlanResponse])
async def list_floorplans(session: AsyncSession = Depends(get_db)):
    stmt = select(DBFloorPlan)
    res = await session.execute(stmt)
    fps = res.scalars().all()
    return [
        FloorPlanResponse(
            id=f.id,
            name=f.name,
            description=f.description,
            width_meters=f.width_meters,
            height_meters=f.height_meters,
            image_url=f.image_url,
            svg_data=f.svg_data,
            calibration=ScaleCalibration(**f.calibration),
            created_at=f.created_at,
            updated_at=f.updated_at
        )
        for f in fps
    ]

@router.get("/floorplans/{plan_id}", response_model=FloorPlanResponse)
async def get_floorplan(plan_id: str, session: AsyncSession = Depends(get_db)):
    stmt = select(DBFloorPlan).where(DBFloorPlan.id == plan_id)
    res = await session.execute(stmt)
    fp = res.scalar_one_or_none()
    if not fp:
        raise HTTPException(status_code=404, detail="Floor plan not found")
    return FloorPlanResponse(
        id=fp.id,
        name=fp.name,
        description=fp.description,
        width_meters=fp.width_meters,
        height_meters=fp.height_meters,
        image_url=fp.image_url,
        svg_data=fp.svg_data,
        calibration=ScaleCalibration(**fp.calibration),
        created_at=fp.created_at,
        updated_at=fp.updated_at
    )

@router.post("/floorplans", response_model=FloorPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_floorplan(plan_in: FloorPlanCreate, session: AsyncSession = Depends(get_db)):
    plan_id = f"fp-{uuid.uuid4().hex[:8]}"
    db_fp = DBFloorPlan(
        id=plan_id,
        name=plan_in.name,
        description=plan_in.description,
        width_meters=plan_in.width_meters,
        height_meters=plan_in.height_meters,
        image_url=plan_in.image_url,
        svg_data=plan_in.svg_data,
        calibration=plan_in.calibration.model_dump(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    session.add(db_fp)
    await session.commit()
    await session.refresh(db_fp)
    return FloorPlanResponse(
        id=db_fp.id,
        name=db_fp.name,
        description=db_fp.description,
        width_meters=db_fp.width_meters,
        height_meters=db_fp.height_meters,
        image_url=db_fp.image_url,
        svg_data=db_fp.svg_data,
        calibration=ScaleCalibration(**db_fp.calibration),
        created_at=db_fp.created_at,
        updated_at=db_fp.updated_at
    )

@router.put("/floorplans/{plan_id}/calibration", response_model=FloorPlanResponse)
async def update_calibration(plan_id: str, calib_in: ScaleCalibration, session: AsyncSession = Depends(get_db)):
    stmt = select(DBFloorPlan).where(DBFloorPlan.id == plan_id)
    res = await session.execute(stmt)
    fp = res.scalar_one_or_none()
    if not fp:
        raise HTTPException(status_code=404, detail="Floor plan not found")

    # conservar el inicio del marco de coordenadas vigente (ver routes_layout)
    fp.calibration = {**calib_in.model_dump(), "frame_since": (fp.calibration or {}).get("frame_since")}
    fp.updated_at = datetime.utcnow()

    # Log audit
    audit = DBAuditLog(
        action="UPDATE_CALIBRATION",
        actor="Admin",
        entity_type="FLOORPLAN",
        entity_id=plan_id,
        details={"calibration": calib_in.model_dump()}
    )
    session.add(audit)
    await session.commit()
    await session.refresh(fp)

    return FloorPlanResponse(
        id=fp.id,
        name=fp.name,
        description=fp.description,
        width_meters=fp.width_meters,
        height_meters=fp.height_meters,
        image_url=fp.image_url,
        svg_data=fp.svg_data,
        calibration=ScaleCalibration(**fp.calibration),
        created_at=fp.created_at,
        updated_at=fp.updated_at
    )
