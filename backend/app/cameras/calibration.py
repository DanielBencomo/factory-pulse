"""Calibración de imagen normalizada a un plano con dimensiones en metros."""
from hashlib import sha256
from math import hypot
from typing import Annotated, Literal

import numpy as np
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import DBCameraConfig, DBFloorPlan

MAIN_FLOOR_ID = "fp-main"
Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Meters = Annotated[float, Field(ge=0, le=2000, allow_inf_nan=False)]
Point = tuple[Unit, Unit]


class Correspondence(BaseModel):
    image: Point
    floor_m: tuple[Meters, Meters]


class CalibrationInput(BaseModel):
    frame_revision: str = Field(max_length=64)
    snapshot_session: str = Field(min_length=1, max_length=64)
    snapshot_at: str = Field(min_length=1, max_length=64)
    image_width: int = Field(gt=0, le=7680)
    image_height: int = Field(gt=0, le=4320)
    anchors: list[Correspondence] = Field(min_length=4, max_length=4)
    checks: list[Correspondence] = Field(min_length=1, max_length=8)
    tolerance_m: float = Field(default=0.25, ge=0.01, le=1, allow_inf_nan=False)


class ProjectionInput(BaseModel):
    revision: str = Field(min_length=1, max_length=64)
    direction: Literal["camera_to_floor", "floor_to_camera"]
    points: list[Point] = Field(min_length=1, max_length=500)


class CalibrationRef(BaseModel):
    camera_id: str = Field(min_length=1, max_length=64)
    revision: str = Field(min_length=1, max_length=64)


def frame_revision(floor: DBFloorPlan) -> str:
    return (floor.calibration or {}).get("frame_revision", "initial")


async def main_floor(session: AsyncSession) -> DBFloorPlan | None:
    return await session.get(DBFloorPlan, MAIN_FLOOR_ID)


def active_calibration(camera: DBCameraConfig, floor: DBFloorPlan | None) -> dict | None:
    data = camera.calibration_data
    if (
        data and floor and camera.enabled and camera.provider_mode == "managed"
        and data["frame_revision"] == frame_revision(floor)
        and data["width_m"] == floor.width_meters and data["height_m"] == floor.height_meters
    ):
        return data
    return None


async def active_revisions(session: AsyncSession, floor: DBFloorPlan | None = None) -> dict[str, str]:
    if floor is None:
        floor = await main_floor(session)
    if floor is None or floor.id != MAIN_FLOOR_ID:
        return {}
    cameras = await session.scalars(select(DBCameraConfig).where(DBCameraConfig.enabled.is_(True)))
    return {camera.device_id: data["revision"] for camera in cameras if (data := active_calibration(camera, floor))}


async def require_projection(session: AsyncSession, ref: CalibrationRef, floor_id: str, polygon) -> None:
    camera = await session.scalar(select(DBCameraConfig).where(DBCameraConfig.device_id == ref.camera_id))
    data = active_calibration(camera, await main_floor(session)) if camera and floor_id == MAIN_FLOOR_ID else None
    if not data or data["revision"] != ref.revision:
        raise HTTPException(409, "Cambió la calibración. Vuelve a abrir el editor")
    if any(not inside(point, data["floor_hull"]) for point in polygon):
        raise HTTPException(422, "El área dibujada queda fuera de la calibración")


def revision_key(floor: DBFloorPlan, revisions: dict[str, str]) -> str:
    parts = [frame_revision(floor), *sorted(revisions.values())]
    return sha256("|".join(parts).encode()).hexdigest()


def source_geometry(camera: DBCameraConfig) -> tuple:
    return (camera.source_type, camera.source_url, camera.webcam_index, camera.provider_mode, camera.provider_url)


def project(matrix, point) -> tuple[float, float]:
    x, y, w = np.asarray(matrix) @ (*point, 1)
    if not np.isfinite([x, y, w]).all() or abs(w) < 1e-10:
        raise ValueError("El punto está fuera de la región donde la proyección es estable")
    return float(x / w), float(y / w)


def inside(point, polygon) -> bool:
    x, y = point
    edges = [
        (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
        for a, b in zip(polygon, polygon[1:] + polygon[:1])
    ]
    return min(edges) >= -1e-8 or max(edges) <= 1e-8


def _convex(points: list[tuple[float, float]]) -> None:
    turns = []
    for i in range(4):
        a, b, c = (points[(i + j) % 4] for j in range(3))
        turns.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not (min(turns) > 1e-5 or max(turns) < -1e-5):
        raise ValueError("Marca cuatro esquinas distintas siguiendo el perímetro, sin cruzar lados")


def fit_calibration(payload: CalibrationInput, width_m: float, height_m: float) -> dict:
    image = [pair.image for pair in payload.anchors]
    floor = [(pair.floor_m[0] / width_m, pair.floor_m[1] / height_m) for pair in payload.anchors]
    _convex(image)
    _convex(floor)
    if not all(0 <= x <= 1 and 0 <= y <= 1 for x, y in floor):
        raise ValueError("Las anclas físicas deben quedar dentro del plano")
    rows = []
    for (x, y), (u, v) in zip(image, floor):
        rows.extend(([-x, -y, -1, 0, 0, 0, u*x, u*y, u],
                     [0, 0, 0, -x, -y, -1, v*x, v*y, v]))
    _, singular, vh = np.linalg.svd(rows, full_matrices=True)
    if singular[-1] < 1e-5 * singular[0]:
        raise ValueError("Las referencias no permiten calcular una transformación estable")
    matrix = vh[-1].reshape(3, 3)
    inverse = np.linalg.inv(matrix)
    denominators = [float(matrix[2] @ (*point, 1)) for point in image]
    if min(denominators) <= 1e-8 and max(denominators) >= -1e-8:
        raise ValueError("La perspectiva cambia de signo dentro del área de calibración")
    errors = []
    used = list(image)
    used_floor = list(floor)
    for pair in payload.checks:
        target = (pair.floor_m[0] / width_m, pair.floor_m[1] / height_m)
        if not inside(pair.image, image) or not inside(target, floor):
            raise ValueError("Los controles deben estar dentro del área medida")
        if any(hypot(pair.image[0] - x, pair.image[1] - y) < 0.005 for x, y in used) or any(
            hypot((target[0] - x) * width_m, (target[1] - y) * height_m) < 0.05 for x, y in used_floor
        ):
            raise ValueError("Cada control debe ser distinto de las anclas y de los otros controles")
        used.append(pair.image)
        used_floor.append(target)
        x, y = project(matrix, pair.image)
        errors.append(hypot(x * width_m - pair.floor_m[0], y * height_m - pair.floor_m[1]))
    return {
        "matrix": matrix.tolist(), "inverse": inverse.tolist(),
        "image_hull": image, "floor_hull": floor,
        "check_errors_m": errors, "max_error_m": max(errors),
    }
