from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.db_models import DBAlert, DBAlertRule, DBAuditLog
from app.models.schemas import AlertResponse, AlertRuleConfig, AlertSeverity, AlertStatus, StopScope
from app.ws.manager import ws_manager

router = APIRouter()

@router.get("/alerts", response_model=List[AlertResponse])
async def list_alerts(
    status: Optional[str] = None, # 'new' | 'acknowledged' | 'resolved'
    severity: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_db)
):
    stmt = select(DBAlert).order_by(desc(DBAlert.triggered_at))
    if status:
        stmt = stmt.where(DBAlert.status == status)
    if severity:
        stmt = stmt.where(DBAlert.severity == severity)
    
    stmt = stmt.limit(limit)
    res = await session.execute(stmt)
    alerts = res.scalars().all()

    return [
        AlertResponse(
            id=a.id,
            rule_id=a.rule_id,
            title=a.title,
            description=a.description,
            severity=AlertSeverity(a.severity),
            status=AlertStatus(a.status),
            scope_type=StopScope(a.scope_type) if a.scope_type else None,
            scope_id=a.scope_id,
            triggered_at=a.triggered_at,
            acknowledged_at=a.acknowledged_at,
            acknowledged_by=a.acknowledged_by,
            resolved_at=a.resolved_at,
            resolved_by=a.resolved_by,
            evidence=a.evidence or {}
        )
        for a in alerts
    ]

@router.put("/alerts/{alert_id}/acknowledge", response_model=AlertResponse)
async def acknowledge_alert(
    alert_id: str,
    actor: str = Query("Supervisor Turno"),
    session: AsyncSession = Depends(get_db)
):
    stmt = select(DBAlert).where(DBAlert.id == alert_id)
    res = await session.execute(stmt)
    alert = res.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")

    alert.status = "acknowledged"
    alert.acknowledged_at = datetime.utcnow()
    alert.acknowledged_by = actor

    audit = DBAuditLog(
        action="ACK_ALERT",
        actor=actor,
        entity_type="ALERT",
        entity_id=alert_id,
        details={"status": "acknowledged"}
    )
    session.add(audit)
    await session.commit()
    await session.refresh(alert)

    await ws_manager.broadcast({
        "type": "ALERT_UPDATED",
        "alert_id": alert.id,
        "status": alert.status
    })

    return AlertResponse(
        id=alert.id,
        rule_id=alert.rule_id,
        title=alert.title,
        description=alert.description,
        severity=AlertSeverity(alert.severity),
        status=AlertStatus(alert.status),
        scope_type=StopScope(alert.scope_type) if alert.scope_type else None,
        scope_id=alert.scope_id,
        triggered_at=alert.triggered_at,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by=alert.acknowledged_by,
        resolved_at=alert.resolved_at,
        resolved_by=alert.resolved_by,
        evidence=alert.evidence or {}
    )

@router.put("/alerts/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert(
    alert_id: str,
    actor: str = Query("Supervisor Turno"),
    session: AsyncSession = Depends(get_db)
):
    stmt = select(DBAlert).where(DBAlert.id == alert_id)
    res = await session.execute(stmt)
    alert = res.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")

    alert.status = "resolved"
    alert.resolved_at = datetime.utcnow()
    alert.resolved_by = actor

    audit = DBAuditLog(
        action="RESOLVE_ALERT",
        actor=actor,
        entity_type="ALERT",
        entity_id=alert_id,
        details={"status": "resolved"}
    )
    session.add(audit)
    await session.commit()
    await session.refresh(alert)

    await ws_manager.broadcast({
        "type": "ALERT_UPDATED",
        "alert_id": alert.id,
        "status": alert.status
    })

    return AlertResponse(
        id=alert.id,
        rule_id=alert.rule_id,
        title=alert.title,
        description=alert.description,
        severity=AlertSeverity(alert.severity),
        status=AlertStatus(alert.status),
        scope_type=StopScope(alert.scope_type) if alert.scope_type else None,
        scope_id=alert.scope_id,
        triggered_at=alert.triggered_at,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by=alert.acknowledged_by,
        resolved_at=alert.resolved_at,
        resolved_by=alert.resolved_by,
        evidence=alert.evidence or {}
    )

@router.get("/alerts/rules", response_model=List[AlertRuleConfig])
async def list_alert_rules(session: AsyncSession = Depends(get_db)):
    stmt = select(DBAlertRule)
    res = await session.execute(stmt)
    rules = res.scalars().all()
    return [
        AlertRuleConfig(
            rule_id=r.rule_id,
            name=r.name,
            rule_type=r.rule_type,
            threshold=r.threshold,
            window_seconds=r.window_seconds,
            severity=AlertSeverity(r.severity),
            enabled=r.enabled,
            cooldown_seconds=r.cooldown_seconds,
            scope_type=StopScope(r.scope_type) if r.scope_type else None,
            scope_id=r.scope_id,
            description=r.description or ""
        )
        for r in rules
    ]

@router.put("/alerts/rules/{rule_id}", response_model=AlertRuleConfig)
async def update_alert_rule(rule_id: str, rule_in: AlertRuleConfig, session: AsyncSession = Depends(get_db)):
    stmt = select(DBAlertRule).where(DBAlertRule.rule_id == rule_id)
    res = await session.execute(stmt)
    r = res.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Regla de alerta no encontrada")

    r.threshold = rule_in.threshold
    r.window_seconds = rule_in.window_seconds
    r.severity = rule_in.severity.value
    r.enabled = rule_in.enabled
    r.cooldown_seconds = rule_in.cooldown_seconds
    r.description = rule_in.description

    await session.commit()
    await session.refresh(r)

    return AlertRuleConfig(
        rule_id=r.rule_id,
        name=r.name,
        rule_type=r.rule_type,
        threshold=r.threshold,
        window_seconds=r.window_seconds,
        severity=AlertSeverity(r.severity),
        enabled=r.enabled,
        cooldown_seconds=r.cooldown_seconds,
        scope_type=StopScope(r.scope_type) if r.scope_type else None,
        scope_id=r.scope_id,
        description=r.description or ""
    )
