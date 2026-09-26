import uuid
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.db_models import DBDashboard, DBAuditLog
from app.models.schemas import DashboardConfigCreate, DashboardConfigResponse, WidgetConfig

router = APIRouter()

@router.get("/dashboards", response_model=List[DashboardConfigResponse])
async def list_dashboards(session: AsyncSession = Depends(get_db)):
    stmt = select(DBDashboard)
    res = await session.execute(stmt)
    dashboards = res.scalars().all()
    return [
        DashboardConfigResponse(
            id=d.id,
            dashboard_id=d.dashboard_id,
            name=d.name,
            description=d.description,
            is_default=d.is_default,
            layouts=d.layouts or {},
            widgets=[WidgetConfig(**w) for w in (d.widgets or [])],
            created_at=d.created_at,
            updated_at=d.updated_at
        )
        for d in dashboards
    ]

@router.get("/dashboards/{dashboard_id}", response_model=DashboardConfigResponse)
async def get_dashboard(dashboard_id: str, session: AsyncSession = Depends(get_db)):
    stmt = select(DBDashboard).where(DBDashboard.dashboard_id == dashboard_id)
    res = await session.execute(stmt)
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard no encontrado")
    return DashboardConfigResponse(
        id=d.id,
        dashboard_id=d.dashboard_id,
        name=d.name,
        description=d.description,
        is_default=d.is_default,
        layouts=d.layouts or {},
        widgets=[WidgetConfig(**w) for w in (d.widgets or [])],
        created_at=d.created_at,
        updated_at=d.updated_at
    )

@router.post("/dashboards", response_model=DashboardConfigResponse, status_code=status.HTTP_201_CREATED)
async def create_dashboard(dash_in: DashboardConfigCreate, session: AsyncSession = Depends(get_db)):
    db_dash = DBDashboard(
        id=f"dash-{uuid.uuid4().hex[:8]}",
        dashboard_id=dash_in.dashboard_id,
        name=dash_in.name,
        description=dash_in.description,
        is_default=dash_in.is_default,
        layouts=dash_in.layouts,
        widgets=[w.model_dump() for w in dash_in.widgets],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    session.add(db_dash)
    await session.commit()
    await session.refresh(db_dash)
    return DashboardConfigResponse(
        id=db_dash.id,
        dashboard_id=db_dash.dashboard_id,
        name=db_dash.name,
        description=db_dash.description,
        is_default=db_dash.is_default,
        layouts=db_dash.layouts or {},
        widgets=[WidgetConfig(**w) for w in (db_dash.widgets or [])],
        created_at=db_dash.created_at,
        updated_at=db_dash.updated_at
    )

@router.put("/dashboards/{dashboard_id}", response_model=DashboardConfigResponse)
async def update_dashboard(dashboard_id: str, dash_in: DashboardConfigCreate, session: AsyncSession = Depends(get_db)):
    stmt = select(DBDashboard).where(DBDashboard.dashboard_id == dashboard_id)
    res = await session.execute(stmt)
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard no encontrado")

    d.name = dash_in.name
    d.description = dash_in.description
    d.layouts = dash_in.layouts
    d.widgets = [w.model_dump() for w in dash_in.widgets]
    d.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(d)

    return DashboardConfigResponse(
        id=d.id,
        dashboard_id=d.dashboard_id,
        name=d.name,
        description=d.description,
        is_default=d.is_default,
        layouts=d.layouts or {},
        widgets=[WidgetConfig(**w) for w in (d.widgets or [])],
        created_at=d.created_at,
        updated_at=d.updated_at
    )
