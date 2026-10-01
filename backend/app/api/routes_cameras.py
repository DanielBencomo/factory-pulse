from __future__ import annotations

import socket
import uuid
from datetime import datetime
from typing import Any, Literal, Optional
from urllib.parse import unquote, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cameras.manager import camera_manager, provider_base
from app.cameras.security import encrypt_secret
from app.config import settings
from app.database import get_db
from app.devices.registry import device_status
from app.models.db_models import DBAuditLog, DBCameraConfig, DBDevice

router = APIRouter()

DETECTION_PROFILES: dict[str, dict[str, Any]] = {
    "fast": {
        "label": "Rápido",
        "description": "Menor consumo; útil para varias cámaras o CPU.",
        "model": "yolo11n.pt", "confidence": 0.28, "iou": 0.55, "image_size": 640,
        "width": 1280, "height": 720,
    },
    "balanced": {
        "label": "Equilibrado",
        "description": "Más sensibilidad para personas pequeñas sin ir al máximo.",
        "model": "yolo11s.pt", "confidence": 0.25, "iou": 0.55, "image_size": 960,
        "width": 1920, "height": 1080,
    },
    "precision": {
        "label": "Alta precisión",
        "description": "Prioriza detección; se recomienda GPU dedicada.",
        "model": "yolo11m.pt", "confidence": 0.20, "iou": 0.60, "image_size": 1280,
        "width": 2560, "height": 1440,
    },
}


class CameraIn(BaseModel):
    camera_id: str = Field(..., min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(..., min_length=1, max_length=128)
    source_type: Literal["rtsp", "http", "webcam", "provider"] = "rtsp"
    source_url: Optional[str] = None
    username: Optional[str] = Field(None, max_length=128)
    password: Optional[str] = Field(None, max_length=512)
    webcam_index: int = Field(0, ge=0, le=32)
    rtsp_transport: Literal["tcp", "udp"] = "tcp"
    provider_url: Optional[str] = None
    calibration_path: Optional[str] = Field(None, max_length=512)
    profile: Literal["fast", "balanced", "precision"] = "balanced"
    model: Optional[str] = Field(None, max_length=64)
    confidence: Optional[float] = Field(None, ge=0.05, le=0.95)
    iou: Optional[float] = Field(None, ge=0.1, le=0.95)
    image_size: Optional[int] = Field(None, ge=320, le=1920)
    processing_width: Optional[int] = Field(None, ge=320, le=7680)
    processing_height: Optional[int] = Field(None, ge=240, le=4320)
    auto_start: bool = True
    show_annotations: bool = True
    enabled: bool = True
    display_order: int = Field(0, ge=0, le=999)


class CameraPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    source_type: Optional[Literal["rtsp", "http", "webcam", "provider"]] = None
    source_url: Optional[str] = None
    username: Optional[str] = Field(None, max_length=128)
    password: Optional[str] = Field(None, max_length=512)
    webcam_index: Optional[int] = Field(None, ge=0, le=32)
    rtsp_transport: Optional[Literal["tcp", "udp"]] = None
    provider_url: Optional[str] = None
    calibration_path: Optional[str] = Field(None, max_length=512)
    profile: Optional[Literal["fast", "balanced", "precision"]] = None
    model: Optional[str] = Field(None, max_length=64)
    confidence: Optional[float] = Field(None, ge=0.05, le=0.95)
    iou: Optional[float] = Field(None, ge=0.1, le=0.95)
    image_size: Optional[int] = Field(None, ge=320, le=1920)
    processing_width: Optional[int] = Field(None, ge=320, le=7680)
    processing_height: Optional[int] = Field(None, ge=240, le=4320)
    auto_start: Optional[bool] = None
    show_annotations: Optional[bool] = None
    enabled: Optional[bool] = None
    display_order: Optional[int] = Field(None, ge=0, le=999)


def _clean_source_url(value: str | None, source_type: str) -> tuple[str | None, str | None, str | None]:
    if source_type == "webcam":
        return None, None, None
    if not value:
        raise HTTPException(status_code=422, detail="Escribe la URL de la cámara")
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"URL inválida: {exc}") from exc
    allowed = {"rtsp", "rtsps"} if source_type == "rtsp" else {"http", "https"}
    if parts.scheme.lower() not in allowed or not parts.hostname:
        raise HTTPException(status_code=422, detail=f"URL inválida para una fuente {source_type.upper()}")
    host = parts.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if port:
        host = f"{host}:{port}"
    cleaned = urlunsplit((parts.scheme.lower(), host, parts.path or "/", parts.query, parts.fragment))
    return cleaned, unquote(parts.username) if parts.username else None, unquote(parts.password) if parts.password else None


def _clean_provider_url(value: str | None) -> str:
    if not value:
        raise HTTPException(status_code=422, detail="Escribe la URL HTTP del proveedor de visión")
    try:
        parts = urlsplit(value.strip())
        _ = parts.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"URL inválida: {exc}") from exc
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise HTTPException(status_code=422, detail="La URL del proveedor debe comenzar con http:// o https://")
    if parts.username or parts.password:
        raise HTTPException(status_code=422, detail="No incluyas credenciales en la URL del proveedor")
    return value.strip().rstrip("/")


async def _camera(session: AsyncSession, camera_id: str) -> DBCameraConfig:
    camera = (
        await session.execute(select(DBCameraConfig).where(DBCameraConfig.device_id == camera_id))
    ).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=404, detail="Cámara no configurada")
    return camera


async def _available_port(session: AsyncSession) -> int:
    used = set((await session.execute(select(DBCameraConfig.provider_port))).scalars().all())
    for port in range(settings.VISION_PORT_START, settings.VISION_PORT_END + 1):
        if port in used:
            continue
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            sock.close()
    raise HTTPException(status_code=503, detail="No hay puertos libres para otro proveedor de cámara")


def _out(device: DBDevice, camera: DBCameraConfig | None) -> dict[str, Any]:
    camera_id = device.device_id
    base = provider_base(camera) if camera else None
    runtime = camera_manager.status(camera_id)
    return {
        "camera_id": camera_id,
        "device_id": camera_id,
        "name": device.name,
        "configured": camera is not None,
        "source_type": camera.source_type if camera else None,
        "source_url": camera.source_url if camera else None,
        "username": camera.username if camera else None,
        "has_password": bool(camera and camera.password_encrypted),
        "webcam_index": camera.webcam_index if camera else 0,
        "rtsp_transport": camera.rtsp_transport if camera else "tcp",
        "provider_mode": camera.provider_mode if camera else None,
        "provider_url": camera.provider_url if camera and camera.provider_mode == "external" else None,
        "provider_port": camera.provider_port if camera else None,
        "calibration_path": camera.calibration_path if camera else None,
        "profile": camera.profile if camera else "balanced",
        "model": camera.model if camera else None,
        "confidence": camera.confidence if camera else None,
        "iou": camera.iou if camera else None,
        "image_size": camera.image_size if camera else None,
        "processing_width": camera.processing_width if camera else None,
        "processing_height": camera.processing_height if camera else None,
        "auto_start": bool(camera.auto_start) if camera else False,
        "show_annotations": bool(camera.show_annotations) if camera else True,
        "enabled": bool(camera.enabled) if camera else False,
        "display_order": camera.display_order if camera else 999,
        "device_status": device_status(device, datetime.utcnow()),
        "last_heartbeat": device.last_heartbeat,
        "runtime": runtime,
        "provider_base": base if camera and camera.provider_mode == "external" else None,
        "health_url": f"/api/cameras/{camera_id}/health",
        "annotated_stream_url": f"/api/cameras/{camera_id}/stream/annotated",
        "raw_stream_url": f"/api/cameras/{camera_id}/stream/raw",
        "floor_stream_url": f"/api/cameras/{camera_id}/stream/floor",
        "snapshot_url": f"/api/cameras/{camera_id}/snapshot",
        "map_url": f"/api/cameras/{camera_id}/map-points",
    }


@router.get("/cameras/profiles")
async def camera_profiles():
    return [{"value": key, **value} for key, value in DETECTION_PROFILES.items()]


@router.get("/cameras")
async def list_cameras(session: AsyncSession = Depends(get_db)):
    devices = (
        await session.execute(
            select(DBDevice).where(
                DBDevice.type == "camera_vision", DBDevice.simulated.is_(False)
            )
        )
    ).scalars().all()
    configs = (await session.execute(select(DBCameraConfig))).scalars().all()
    by_device = {item.device_id: item for item in configs}
    output = [_out(device, by_device.get(device.device_id)) for device in devices]
    return sorted(output, key=lambda item: (item["display_order"], item["name"].lower()))


@router.post("/cameras", status_code=status.HTTP_201_CREATED)
async def register_camera(payload: CameraIn, session: AsyncSession = Depends(get_db)):
    existing_config = (
        await session.execute(select(DBCameraConfig).where(DBCameraConfig.device_id == payload.camera_id))
    ).scalar_one_or_none()
    if existing_config:
        raise HTTPException(status_code=409, detail="La cámara ya está configurada")

    device = (
        await session.execute(select(DBDevice).where(DBDevice.device_id == payload.camera_id))
    ).scalar_one_or_none()
    if device and device.type != "camera_vision" and (device.is_active or device.simulated):
        raise HTTPException(status_code=409, detail="Ese ID pertenece a otro tipo de dispositivo")
    if not device:
        device = DBDevice(
            id=f"dev-{uuid.uuid4().hex[:8]}", device_id=payload.camera_id, name=payload.name,
            type="camera_vision", ingest_mode="http", is_active=True, simulated=False,
            last_heartbeat=None, status="waiting", created_at=datetime.utcnow(),
        )
        session.add(device)
    else:
        device.name = payload.name
        device.type = "camera_vision"
        device.is_active = True
        device.simulated = False

    profile = DETECTION_PROFILES[payload.profile]
    if payload.source_type == "provider":
        source_url, url_user, url_password = None, None, None
        provider_mode, provider_url, provider_port = "external", _clean_provider_url(payload.provider_url), None
    else:
        source_url, url_user, url_password = _clean_source_url(payload.source_url, payload.source_type)
        provider_mode, provider_url, provider_port = "managed", None, await _available_port(session)
    camera = DBCameraConfig(
        id=f"camcfg-{uuid.uuid4().hex[:8]}", device_id=payload.camera_id,
        source_type=payload.source_type, source_url=source_url,
        username=(payload.username or url_user) if payload.source_type not in {"provider", "webcam"} else None,
        password_encrypted=encrypt_secret(
            payload.password if payload.password is not None else url_password
        ) if payload.source_type not in {"provider", "webcam"} else None,
        webcam_index=payload.webcam_index, rtsp_transport=payload.rtsp_transport,
        provider_mode=provider_mode, provider_url=provider_url, provider_port=provider_port,
        calibration_path=payload.calibration_path.strip() if payload.calibration_path else None,
        profile=payload.profile, model=payload.model or profile["model"],
        confidence=payload.confidence if payload.confidence is not None else profile["confidence"],
        iou=payload.iou if payload.iou is not None else profile["iou"],
        image_size=payload.image_size or profile["image_size"],
        processing_width=payload.processing_width or profile["width"],
        processing_height=payload.processing_height or profile["height"],
        auto_start=payload.auto_start, show_annotations=payload.show_annotations,
        enabled=payload.enabled, display_order=payload.display_order,
    )
    session.add(camera)
    session.add(DBAuditLog(action="REGISTER_CAMERA", actor="Supervisor", entity_type="CAMERA", entity_id=payload.camera_id, details={"source_type": payload.source_type, "profile": payload.profile}))
    await session.commit()
    if camera.auto_start and camera.enabled:
        try:
            camera_manager.start(camera)
        except RuntimeError as exc:
            camera_manager.record_error(camera.device_id, exc)
    return _out(device, camera)


@router.put("/cameras/{camera_id}")
async def update_camera(camera_id: str, payload: CameraPatch, session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    device = (await session.execute(select(DBDevice).where(DBDevice.device_id == camera_id))).scalar_one()
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        device.name = data.pop("name")
    if "password" in data:
        camera.password_encrypted = encrypt_secret(data.pop("password"))
    new_source_type = data.get("source_type", camera.source_type)
    if "source_url" in data or "source_type" in data:
        if new_source_type in {"provider", "webcam"}:
            camera.source_url = None
            camera.username = None
            camera.password_encrypted = None
            data.pop("username", None)
        else:
            source_url, url_user, url_password = _clean_source_url(data.pop("source_url", camera.source_url), new_source_type)
            camera.source_url = source_url
            if url_user and "username" not in data:
                camera.username = url_user
            if url_password and "password" not in payload.model_fields_set:
                camera.password_encrypted = encrypt_secret(url_password)
    if "provider_url" in data or "source_type" in data:
        if new_source_type == "provider":
            camera.provider_url = _clean_provider_url(data.pop("provider_url", camera.provider_url))
            camera.provider_mode = "external"
            camera.provider_port = None
        else:
            data.pop("provider_url", None)
            camera.provider_url = None
            camera.provider_mode = "managed"
            if not camera.provider_port:
                camera.provider_port = await _available_port(session)
    profile = DETECTION_PROFILES[data.get("profile", camera.profile)]
    for field, key in (("model", "model"), ("confidence", "confidence"), ("iou", "iou"), ("image_size", "image_size"), ("processing_width", "width"), ("processing_height", "height")):
        if ("profile" in data and field not in data) or (field in data and data[field] is None):
            data[field] = profile[key]
    if "calibration_path" in data and data["calibration_path"]:
        data["calibration_path"] = data["calibration_path"].strip() or None
    for key, value in data.items():
        setattr(camera, key, value)
    camera.updated_at = datetime.utcnow()
    await session.commit()
    camera_manager.stop(camera_id)
    if camera.auto_start and camera.enabled:
        try:
            camera_manager.start(camera)
        except RuntimeError as exc:
            camera_manager.record_error(camera.device_id, exc)
    return _out(device, camera)


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(camera_id: str, session: AsyncSession = Depends(get_db)):
    camera = (
        await session.execute(select(DBCameraConfig).where(DBCameraConfig.device_id == camera_id))
    ).scalar_one_or_none()
    device = (await session.execute(select(DBDevice).where(DBDevice.device_id == camera_id))).scalar_one_or_none()
    if not camera and not device:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    camera_manager.stop(camera_id)
    if camera:
        await session.delete(camera)
    if device and not device.simulated:
        await session.delete(device)
    await session.commit()


@router.post("/cameras/{camera_id}/start")
async def start_camera(camera_id: str, session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    try:
        runtime = camera_manager.start(camera)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"camera_id": camera_id, "runtime": runtime}


@router.post("/cameras/{camera_id}/stop")
async def stop_camera(camera_id: str, session: AsyncSession = Depends(get_db)):
    await _camera(session, camera_id)
    return {"camera_id": camera_id, "runtime": camera_manager.stop(camera_id)}


@router.post("/cameras/{camera_id}/probe")
async def probe_camera(camera_id: str, session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    try:
        return await camera_manager.probe(camera)
    except (RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _provider(camera: DBCameraConfig) -> str:
    base = provider_base(camera)
    if not base:
        raise HTTPException(status_code=503, detail="La cámara no tiene proveedor disponible")
    return base


@router.get("/cameras/{camera_id}/health")
async def camera_health(camera_id: str, session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    base = await _provider(camera)
    try:
        async with httpx.AsyncClient(timeout=2.5, trust_env=False) as client:
            response = await client.get(f"{base}/vision/health")
            response.raise_for_status()
            body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=f"Proveedor sin conexión: {exc}") from exc
    body["camera_id"] = camera_id
    body["runtime"] = camera_manager.status(camera_id)
    return body


@router.get("/cameras/{camera_id}/stream/{view}")
async def camera_stream(camera_id: str, view: Literal["annotated", "raw", "floor"], session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    base = await _provider(camera)
    upstream_path = {"annotated": "annotated.mjpg", "raw": "raw.mjpg", "floor": "floor.mjpg"}[view]
    client = httpx.AsyncClient(timeout=None, trust_env=False)
    try:
        request = client.build_request("GET", f"{base}/vision/{upstream_path}")
        upstream = await client.send(request, stream=True)
        upstream.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=503, detail=f"Flujo de cámara no disponible: {exc}") from exc

    async def chunks():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(chunks(), media_type=upstream.headers.get("content-type", "multipart/x-mixed-replace; boundary=frame"), headers={"Cache-Control": "no-store"})


@router.get("/cameras/{camera_id}/snapshot")
async def camera_snapshot(camera_id: str, raw: bool = False, session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    base = await _provider(camera)
    path = "raw.jpg" if raw else "snapshot.jpg"
    try:
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            upstream = await client.get(f"{base}/vision/{path}")
            upstream.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Snapshot no disponible: {exc}") from exc
    return Response(content=upstream.content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/cameras/{camera_id}/map-points")
async def camera_map_points(camera_id: str, payload: dict[str, Any], session: AsyncSession = Depends(get_db)):
    camera = await _camera(session, camera_id)
    base = await _provider(camera)
    try:
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            upstream = await client.post(f"{base}/vision/map-points", json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Proveedor no disponible: {exc}") from exc
    try:
        body = upstream.json()
    except ValueError:
        body = {"detail": "Respuesta inválida del proveedor"}
    if upstream.status_code >= 400:
        raise HTTPException(status_code=upstream.status_code, detail=body.get("detail", "No se pudieron proyectar los puntos"))
    return body
