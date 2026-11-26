"""Factory Pulse: visión anónima con YOLO, ByteTrack, RTSP y plano 2D.

El proceso es deliberadamente independiente del backend: abre una cámara, ejecuta
tracking, publica posiciones normalizadas en la API existente y expone dos flujos
MJPEG para el dashboard. No realiza reconocimiento facial ni guarda video.

Ejemplos::

    python local_vision_provider.py --source webcam
    python local_vision_provider.py --source 1
    python local_vision_provider.py --source rtsp://192.168.1.50:8554/live

Calibración de cuatro puntos::

    python local_vision_provider.py --source webcam --calibrate calib.json \
        --plant-width 8 --plant-height 5
    python local_vision_provider.py --source webcam --calib calib.json

Las credenciales incluidas en una URL RTSP se ocultan en los logs y nunca se
envían al backend o al navegador.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import queue
import sys
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from importlib.metadata import version as package_version
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar
from urllib.parse import quote, urlsplit, urlunsplit

if __package__:
    from .track_continuity import DEFAULT_RECOVERY_S, RECOVERY_RADIUS_M, Observation, TrackingContinuity, edge_distance
else:
    from track_continuity import DEFAULT_RECOVERY_S, RECOVERY_RADIUS_M, Observation, TrackingContinuity, edge_distance

try:
    import requests
except ImportError:  # permite consultar --help sin instalar visión
    requests = None  # type: ignore[assignment]


VERSION = "vision-yolo-0.7.0"

DETECTION_PROFILES: dict[str, dict[str, Any]] = {
    "fast": {"model": "yolo11n.pt", "confidence": 0.28, "iou": 0.55, "image_size": 640},
    "balanced": {"model": "yolo11s.pt", "confidence": 0.25, "iou": 0.55, "image_size": 960},
    "precision": {"model": "yolo11m.pt", "confidence": 0.20, "iou": 0.60, "image_size": 1280},
}


def log(message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] [visión] {message}", flush=True)


def parse_source(value: str) -> int | str:
    value = value.strip()
    if value.lower() in {"webcam", "camera", "camara", "cámara"}:
        return 0
    if value.isdecimal():
        return int(value)
    if is_network_source(value):
        return value
    raise ValueError("La fuente debe ser una webcam, un índice o una URL HTTP/RTSP en vivo")


def is_network_source(source: int | str) -> bool:
    return isinstance(source, str) and source.lower().startswith(
        ("rtsp://", "rtsps://", "http://", "https://")
    )


def is_rtsp_source(source: int | str) -> bool:
    return isinstance(source, str) and source.lower().startswith(("rtsp://", "rtsps://"))


def redact_source(source: int | str) -> str:
    """Oculta usuario y contraseña de una URL antes de imprimirla."""
    if not isinstance(source, str) or "://" not in source:
        return str(source)
    try:
        parts = urlsplit(source)
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        if parts.username or parts.password:
            host = f"***:***@{host}"
        return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))
    except ValueError:
        return "<URL de video>"


def hex_to_bgr(value: str) -> tuple[int, int, int]:
    value = (value or "#3b82f6").lstrip("#")
    if len(value) != 6:
        return (246, 130, 59)
    try:
        red, green, blue = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    except ValueError:
        return (246, 130, 59)
    return blue, green, red


def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    if len(polygon) < 3:
        return False
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (
            abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) <= 1e-9
            and min(xi, xj) - 1e-9 <= x <= max(xi, xj) + 1e-9
            and min(yi, yj) - 1e-9 <= y <= max(yi, yj) + 1e-9
        ):
            return True
        crosses = (yi > y) != (yj > y)
        if crosses:
            boundary_x = (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
            if x < boundary_x:
                inside = not inside
        j = i
    return inside


@dataclass(slots=True)
class Zone:
    zone_id: str
    name: str
    polygon: list[list[float]]
    color: str = "#3b82f6"
    zone_type: str = "productive"
    is_aggregated_only: bool = False
    line_id: str | None = None


@dataclass(slots=True)
class PersonDetection:
    track_id: str
    track_number: int
    box: tuple[int, int, int, int]
    confidence: float
    foot_x: float
    foot_y: float
    raw_id: int | None = None
    floor_x: float | None = None
    floor_y: float | None = None
    zone: Zone | None = None
    speed_m_s: float | None = None
    segment_id: str | None = None
    matching_zones: tuple[str, ...] = ()


@dataclass(slots=True)
class TrailPoint:
    x: float
    y: float
    timestamp: float
    zone_id: str | None
    segment_id: str


class VideoSource:
    """OpenCV VideoCapture con opciones de baja latencia y reconexión RTSP."""

    def __init__(
        self,
        source: int | str,
        width: int = 1280,
        height: int = 720,
        rtsp_transport: str = "tcp",
        reconnect_attempts: int = 0,
    ) -> None:
        import cv2

        self.cv2 = cv2
        self.source = source
        self.width = width
        self.height = height
        self.rtsp_transport = rtsp_transport
        self.reconnect_attempts = reconnect_attempts
        self.cap: Any = None
        self._frame_condition = threading.Condition()
        self._latest_frame: Any = None
        self._latest_frame_at = ""
        self.delivered_frame_at = ""
        self.delivered_connection = 0
        self._connection = 0
        self._latest_connection = 0
        self._frame_sequence = 0
        self._delivered_sequence = 0
        self._reader_stop = threading.Event()
        self._reader_thread: threading.Thread | None = None
        self._open_with_retries()
        self._reader_thread = threading.Thread(target=self._capture_latest, name="vision-latest-frame", daemon=True)
        self._reader_thread.start()

    def _open_with_retries(self) -> None:
        attempts = 0
        while True:
            try:
                self.open()
                return
            except RuntimeError as exc:
                attempts += 1
                if self.reconnect_attempts > 0 and attempts >= self.reconnect_attempts:
                    raise
                delay = min(0.5 * attempts, 3.0)
                log(f"{exc}; reconexión inicial en {delay:.1f} s")
                time.sleep(delay)

    def _fit_frame(self, frame: Any) -> Any:
        """Limit decoded frames to the configured processing dimensions."""
        height, width = frame.shape[:2]
        scale = min(1.0, self.width / width, self.height / height)
        if scale < 1.0:
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            return self.cv2.resize(frame, target, interpolation=self.cv2.INTER_AREA)
        return frame

    def open(self) -> None:
        cv2 = self.cv2
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        if is_rtsp_source(self.source):
            # OpenCV pasa estas opciones a FFmpeg. TCP suele ser más estable en Wi-Fi;
            # UDP se puede seleccionar para reducir latencia en una red confiable.
            options = f"rtsp_transport;{self.rtsp_transport}|stimeout;3000000|max_delay;100000"
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = options

        cap = cv2.VideoCapture()
        backend = cv2.CAP_FFMPEG if is_network_source(self.source) else cv2.CAP_ANY
        params = []
        if is_network_source(self.source) and hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            params.extend((cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5_000))
        if is_network_source(self.source) and hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            params.extend((cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3_000))
        try:
            opened = cap.open(self.source, backend, params) if params else cap.open(self.source, backend)
        except TypeError:
            opened = cap.open(self.source, backend)
        if not opened:
            cap.release()
            raise RuntimeError(f"No se pudo abrir la fuente: {redact_source(self.source)}")
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if isinstance(self.source, int):
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.cap = cap
        self._connection += 1
        log(f"fuente abierta: {redact_source(self.source)}")

    def read(self, timeout: float | None = None) -> Any | None:
        # Return only the newest decoded frame; inference never waits behind a FIFO backlog.
        with self._frame_condition:
            self._frame_condition.wait_for(
                lambda: self._reader_stop.is_set() or self._frame_sequence > self._delivered_sequence,
                timeout=timeout,
            )
            if self._latest_frame is None or self._frame_sequence <= self._delivered_sequence:
                return None
            self._delivered_sequence = self._frame_sequence
            self.delivered_frame_at = self._latest_frame_at
            self.delivered_connection = self._latest_connection
            return self._latest_frame

    def _capture_latest(self) -> None:
        attempts = 0
        while not self._reader_stop.is_set():
            cap = self.cap
            ok, frame = cap.read() if cap is not None else (False, None)
            if ok and frame is not None:
                attempts = 0
                decoded_at = datetime.now(timezone.utc).isoformat()
                latest = self._fit_frame(frame)
                with self._frame_condition:
                    self._latest_frame = latest
                    self._latest_frame_at = decoded_at
                    self._latest_connection = self._connection
                    self._frame_sequence += 1
                    self._frame_condition.notify_all()
                continue
            attempts += 1
            if self.reconnect_attempts and attempts >= self.reconnect_attempts:
                self._reader_stop.set()
                with self._frame_condition:
                    self._frame_condition.notify_all()
                break
            delay = min(0.5 * attempts, 3.0)
            log(f"source interrupted; reconnect attempt {attempts} in {delay:.1f}s")
            self._reader_stop.wait(delay)
            if self._reader_stop.is_set():
                break
            try:
                self.open()
            except RuntimeError as exc:
                log(str(exc))

    def metadata(self) -> dict[str, Any]:
        if self.cap is None:
            return {"opened": False}
        return {
            "opened": bool(self.cap.isOpened()),
            "source": redact_source(self.source),
            "width": int(self.cap.get(self.cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(self.cap.get(self.cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": round(float(self.cap.get(self.cv2.CAP_PROP_FPS) or 0), 2),
            "backend": self.cap.getBackendName() if self.cap.isOpened() else None,
        }

    def close(self) -> None:
        if hasattr(self, "_reader_stop"):
            self._reader_stop.set()
        if hasattr(self, "_frame_condition"):
            with self._frame_condition:
                self._frame_condition.notify_all()
        reader = self._reader_thread
        if reader is not None and reader is not threading.current_thread():
            reader.join(timeout=6)
        if self.cap is not None and (reader is None or not reader.is_alive()):
            self.cap.release()
            self.cap = None


class FloorCalibration:
    """Homografía cámara → plano normalizado 0..1."""

    def __init__(self, path: str | None = None) -> None:
        import numpy as np

        self.np = np
        self.path = path
        self.homography: Any | None = None
        self.inverse: Any | None = None
        self.width_m = 8.0
        self.height_m = 5.0
        self.image_points: list[list[float]] = []
        self.registration: dict[str, Any] | None = None
        self.revision: str | None = None
        self.frame_size = (0, 0)
        if path:
            self.load(path)

    @property
    def calibrated(self) -> bool:
        return self.homography is not None

    def load(self, path: str) -> None:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        matrix = self.np.asarray(data["homography"], dtype="float64")
        if matrix.shape != (3, 3):
            raise ValueError("La homografía debe ser una matriz 3x3")
        self.homography = matrix
        self.inverse = self.np.linalg.inv(matrix)
        self.width_m = float(data.get("plant_width_m", data.get("width_m", 8.0)))
        self.height_m = float(data.get("plant_height_m", data.get("height_m", 5.0)))
        self.image_points = data.get("image_points", [])
        log(f"calibración cargada: {path} ({self.width_m:g} × {self.height_m:g} m)")

    def use_registration(self, data: dict[str, Any] | None, frame_w: int, frame_h: int) -> bool:
        """Returns whether the applied revision changed. A different aspect ratio fails closed."""
        previous = self.revision
        self.frame_size = (frame_w, frame_h)
        if data is not None:
            ratio = (frame_w * data["image_height"]) / (frame_h * data["image_width"])
            if not 0.99 <= ratio <= 1.01:
                data = None
        self.revision = data["revision"] if data else None
        if previous != self.revision:
            self.registration = data
            self.homography = self.np.asarray(data["matrix"], dtype="float64") if data else None
            self.inverse = self.np.asarray(data["inverse"], dtype="float64") if data else None
            if data:
                self.width_m, self.height_m = data["width_m"], data["height_m"]
        return previous != self.revision

    def _inside_image(self, x: float, y: float) -> bool:
        if not self.registration:
            return True
        return self._inside_hull(x, y, self.registration["image_hull"])

    @staticmethod
    def _inside_hull(x: float, y: float, hull) -> bool:
        sides = [
            (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
            for a, b in zip(hull, hull[1:] + hull[:1])
        ]
        return min(sides) >= -1e-8 or max(sides) <= 1e-8

    def covers(self, zone: Zone) -> bool:
        return self.registration is not None and all(
            self._inside_hull(x, y, self.registration["floor_hull"]) for x, y in zone.polygon
        )

    @staticmethod
    def _transform(matrix: Any, x: float, y: float) -> tuple[float, float] | None:
        projected = matrix @ [x, y, 1.0]
        if not all(math.isfinite(value) for value in projected) or abs(projected[2]) < 1e-9:
            return None
        return float(projected[0] / projected[2]), float(projected[1] / projected[2])

    def camera_to_floor(self, x: float, y: float, frame_w: int, frame_h: int) -> tuple[float, float]:
        if self.homography is None:
            return x / max(frame_w, 1), y / max(frame_h, 1)
        if self.registration:
            x, y = x / frame_w, y / frame_h
            if not self._inside_image(x, y):
                return -1.0, -1.0
        point = self._transform(self.homography, x, y)
        if point is None:
            return -1.0, -1.0
        if self.registration:
            return tuple(max(0.0, min(1.0, value)) for value in point)
        return point

    def floor_to_camera(self, x: float, y: float) -> tuple[int, int] | None:
        if self.inverse is None:
            return None
        point = self._transform(self.inverse, x, y)
        if point is None:
            return None
        if self.registration:
            if not self._inside_image(*point):
                return None
            return round(point[0] * self.frame_size[0]), round(point[1] * self.frame_size[1])
        return round(point[0]), round(point[1])

    def map_normalized_points(
        self,
        points: list[list[float]],
        direction: str,
        frame_w: int,
        frame_h: int,
    ) -> list[list[float]]:
        """Proyecta puntos normalizados para el editor web sobre la cámara."""
        if not self.calibrated:
            raise ValueError("La cámara necesita una homografía antes de mapear áreas")
        if frame_w <= 0 or frame_h <= 0:
            raise ValueError("Todavía no hay dimensiones de video disponibles")
        output: list[list[float]] = []
        for point in points:
            if len(point) != 2 or not all(isinstance(v, (int, float)) for v in point):
                raise ValueError("Cada punto debe ser [x, y]")
            x, y = float(point[0]), float(point[1])
            if not (0 <= x <= 1 and 0 <= y <= 1):
                raise ValueError("Los puntos deben estar dentro de 0..1")
            if direction == "camera_to_floor":
                mapped = self.camera_to_floor(x * frame_w, y * frame_h, frame_w, frame_h)
                output.append([round(mapped[0], 6), round(mapped[1], 6)])
            elif direction == "floor_to_camera":
                mapped = self.floor_to_camera(x, y)
                if mapped is None:
                    raise ValueError("No fue posible invertir la homografía")
                output.append([round(mapped[0] / frame_w, 6), round(mapped[1] / frame_h, 6)])
            else:
                raise ValueError("direction debe ser camera_to_floor o floor_to_camera")
        return output


class CalibrationClient:
    def __init__(self, api_base: str, camera_id: str) -> None:
        self.url = f"{api_base.rstrip('/')}/api/cameras/{quote(camera_id, safe='')}/calibration"
        self._next_refresh = 0.0
        self._session = requests.Session()
        self.current: dict[str, Any] | None = None
        self.trajectory = {"max_gap_s": 2.0, "max_speed_m_s": 4.5}

    def refresh_if_due(self) -> dict[str, Any] | None:
        now = time.monotonic()
        if now >= self._next_refresh:
            self._next_refresh = now + 3
            try:
                response = self._session.get(self.url, timeout=1)
                response.raise_for_status()
                body = response.json()
                self.current = body["calibration"]
                if self.current:
                    self.trajectory = {key: float(body["trajectory"][key]) for key in self.trajectory}
            except (requests.RequestException, ValueError, TypeError, KeyError):
                self.current = None
        return self.current

    def close(self) -> None:
        self._session.close()


class ZoneClient:
    def __init__(self, api_base: str, refresh_seconds: float = 5.0) -> None:
        if requests is None:
            raise RuntimeError(
                "Falta requests. Instala: pip install -r hardware/vision_requirements.txt"
            )
        self.url = f"{api_base.rstrip('/')}/api/zones/vision"
        self.refresh_seconds = refresh_seconds
        self.zones: list[Zone] = []
        self.revision: str | None = None
        self._next_refresh = 0.0
        self._last_error = ""
        self._session = requests.Session()

    def refresh_if_due(self, force: bool = False) -> list[Zone]:
        now = time.monotonic()
        if not force and now < self._next_refresh:
            return self.zones
        self._next_refresh = now + self.refresh_seconds
        try:
            response = self._session.get(self.url, timeout=1.5)
            response.raise_for_status()
            body = response.json()
            revision = body["revision"]
            if not isinstance(revision, str) or len(revision) != 64:
                raise ValueError("Revisión de zonas inválida")
            zones = []
            for item in body["zones"]:
                polygon = item["polygon"]
                if len(polygon) < 3:
                    raise ValueError("Polígono de zona inválido")
                zones.append(
                    Zone(
                        zone_id=str(item.get("zone_id", item.get("id", "zona"))),
                        name=str(item.get("name", "Zona")),
                        polygon=[[float(p[0]), float(p[1])] for p in polygon],
                        color=str(item.get("color", "#3b82f6")),
                        zone_type=str(item.get("type", "productive")),
                        is_aggregated_only=bool(item["is_aggregated_only"]) or item["type"] == "bathroom",
                        line_id=item.get("line_id"),
                    )
                )
            self.zones = zones
            self.revision = revision
            if self._last_error:
                log(f"zonas recuperadas: {len(zones)}")
            self._last_error = ""
        except (requests.RequestException, ValueError, TypeError, KeyError, IndexError, AttributeError) as exc:
            self.zones = []
            self.revision = None
            message = str(exc)
            if message != self._last_error:
                log(f"no se pudieron actualizar las zonas: {message}")
            self._last_error = message
        return self.zones

    def close(self) -> None:
        self._session.close()


class YoloByteTracker:
    def __init__(
        self,
        model_path: str,
        tracker_config: str,
        confidence: float,
        iou: float,
        image_size: int,
        device: str | None,
        track_prefix: str,
    ) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "Falta Ultralytics. Instala: pip install -r hardware/vision_requirements.txt"
            ) from exc
        log(f"cargando modelo {model_path}…")
        self.model = YOLO(model_path)
        self.tracker_config = tracker_config
        self.confidence = confidence
        self.iou = iou
        self.image_size = image_size
        self.device = device
        self.track_prefix = track_prefix

    def detect(self, frame: Any) -> list[PersonDetection]:
        kwargs: dict[str, Any] = {
            "source": frame,
            "persist": True,
            "tracker": self.tracker_config,
            "classes": [0],
            "conf": self.confidence,
            "iou": self.iou,
            "imgsz": self.image_size,
            "verbose": False,
        }
        if self.device:
            kwargs["device"] = self.device
        result = self.model.track(**kwargs)[0]
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []
        coordinates = boxes.xyxy.cpu().tolist()
        confidences = boxes.conf.cpu().tolist()
        track_ids = boxes.id.int().cpu().tolist() if boxes.id is not None else [None] * len(coordinates)
        detections: list[PersonDetection] = []
        for index, (xyxy, score, number) in enumerate(zip(coordinates, confidences, track_ids)):
            x1, y1, x2, y2 = (round(v) for v in xyxy)
            foot_x = (x1 + x2) / 2.0
            foot_y = float(y2)
            detections.append(
                PersonDetection(
                    track_id=f"{self.track_prefix}-pending-{index}",
                    track_number=0,
                    box=(x1, y1, x2, y2),
                    confidence=float(score),
                    foot_x=foot_x,
                    foot_y=foot_y,
                    raw_id=int(number) if number is not None else None,
                )
            )
        return detections


class EventPublisher:
    """Publica fuera del hilo de video; una red lenta no congela el tracking."""

    def __init__(self, api_base: str, device_id: str) -> None:
        if requests is None:
            raise RuntimeError(
                "Falta requests. Instala: pip install -r hardware/vision_requirements.txt"
            )
        self.api_base = api_base.rstrip("/")
        self.device_id = device_id
        self.events_url = f"{self.api_base}/api/events/batch"
        self.heartbeat_url = f"{self.api_base}/api/devices/{device_id}/heartbeat"
        self._queue: queue.Queue[tuple[list[dict[str, Any]], list[dict[str, Any]], str] | None] = queue.Queue(maxsize=2)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="vision-publisher", daemon=True)
        self.last_ok_at: float | None = None
        self.last_error = ""

    def start(self) -> None:
        self._thread.start()

    def submit(
        self,
        positions: list[dict[str, Any]],
        occupancies: list[dict[str, Any]],
        observed_at: str,
    ) -> None:
        measurements = (positions, occupancies, observed_at)
        if not measurements[0] and not measurements[1]:
            return
        try:
            self._queue.put_nowait(measurements)
        except queue.Full:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._queue.put_nowait(measurements)
            except queue.Full:
                pass

    def _post_heartbeat(self, session: requests.Session) -> None:
        response = session.post(
            self.heartbeat_url,
            json={"firmware": VERSION},
            timeout=2,
        )
        response.raise_for_status()

    def _post_measurements(
        self,
        session: requests.Session,
        positions: list[dict[str, Any]],
        occupancies: list[dict[str, Any]],
        occurred_at: str,
    ) -> None:
        batch = []
        for position in positions:
            payload = {
                "track_id": position["track_id"],
                "x": float(position["x"]),
                "y": float(position["y"]),
                "confidence": round(float(position["confidence"]), 4),
                "source": "vision_yolo_bytetrack",
                "coordinate_space": "floor",
                "calibration_revision": position["calibration_revision"],
                "zone_revision": position["zone_revision"],
                "segment_id": position["segment_id"],
            }
            if position.get("speed_m_s") is not None:
                payload["speed_m_s"] = round(float(position["speed_m_s"]), 3)
            if position.get("zone_id"):
                payload["zone_id"] = position["zone_id"]
            batch.append(
                {
                    "event_id": f"vis-{uuid.uuid4().hex}",
                    "device_id": self.device_id,
                    "source_id": "vision_yolo_bytetrack",
                    "occurred_at": occurred_at,
                    "type": "position",
                    "payload": payload,
                    "quality": payload["confidence"],
                    "mode": "live",
                }
            )
        for occupancy in occupancies:
            payload: dict[str, Any] = {
                "zone_id": str(occupancy.get("zone_id", "__plant__")),
                "count": max(0, int(occupancy.get("count", 0))),
                "aggregated": True,
                "source": "vision_yolo_bytetrack",
                "coordinate_space": occupancy["coordinate_space"],
            }
            if isinstance(occupancy.get("counts"), dict):
                payload["counts"] = {
                    str(zone_id): max(0, int(count))
                    for zone_id, count in occupancy["counts"].items()
                }
            if occupancy.get("calibration_revision"):
                payload["calibration_revision"] = occupancy["calibration_revision"]
                payload["zone_revision"] = occupancy["zone_revision"]
            batch.append(
                {
                    "event_id": f"occ-{uuid.uuid4().hex}",
                    "device_id": self.device_id,
                    "source_id": "vision_yolo_bytetrack",
                    "occurred_at": occurred_at,
                    "type": "zone_occupancy",
                    "payload": payload,
                    "quality": 1.0,
                    "mode": "live",
                }
            )
        if not batch:
            return
        response = session.post(self.events_url, json=batch, timeout=3)
        response.raise_for_status()
        accepted = len(response.json())
        if accepted != len(batch):
            log(f"backend descartó {len(batch) - accepted} mediciones por geometría o privacidad")

    def _run(self) -> None:
        with requests.Session() as session:
            self._publish_loop(session)

    def _publish_loop(self, session: requests.Session) -> None:
        next_heartbeat = 0.0
        while not self._stop.is_set():
            now = time.monotonic()
            try:
                if now >= next_heartbeat:
                    self._post_heartbeat(session)
                    self.last_ok_at = time.time()
                    next_heartbeat = now + 10.0
                    if self.last_error:
                        log("conexión con el backend recuperada")
                    self.last_error = ""
                try:
                    measurements = self._queue.get(timeout=0.25)
                except queue.Empty:
                    continue
                if measurements is None:
                    break
                self._post_measurements(session, *measurements)
                self.last_ok_at = time.time()
                if self.last_error:
                    log("conexión con el backend recuperada")
                self.last_error = ""
            except requests.RequestException as exc:
                message = str(exc)
                if message != self.last_error:
                    log(f"falló la publicación: {message}")
                self.last_error = message
                self._stop.wait(1.0)

    def close(self) -> None:
        self._stop.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self._thread.join(timeout=2)


class VisionRenderer:
    TRAIL_COLORS: ClassVar[list[tuple[int, int, int]]] = [
        (35, 99, 235),
        (222, 113, 45),
        (168, 85, 247),
        (14, 165, 233),
        (236, 72, 153),
        (34, 197, 94),
    ]

    def __init__(
        self,
        calibration: FloorCalibration,
        continuity: TrackingContinuity,
        track_prefix: str,
        sample_interval: float,
        min_step: float,
        camera_trails: bool = False,
    ) -> None:
        import cv2
        import numpy as np

        self.cv2 = cv2
        self.np = np
        self.calibration = calibration
        self.continuity = continuity
        self.track_prefix = track_prefix
        self.sample_interval = sample_interval
        self.min_step = min_step
        self.camera_trails = camera_trails
        self.trails: dict[str, deque[TrailPoint]] = defaultdict(lambda: deque(maxlen=12_000))
        self._last_position: dict[str, TrailPoint] = {}
        self._last_speed_position: dict[str, TrailPoint] = {}
        self.selected_track: str | None = None
        self.selected_zone: str | None = None
        self.floor_width = 960
        self.floor_height = 600

    def locate(
        self, detections: list[PersonDetection], frame_shape: tuple[int, ...],
        zones: list[Zone], now: float, max_gap_s: float, max_speed_m_s: float,
    ) -> None:
        height, width = frame_shape[:2]
        width_m, height_m = self.calibration.width_m, self.calibration.height_m
        private_polys = [
            [(x * width_m, y * height_m) for x, y in zone.polygon] for zone in zones if zone.is_aggregated_only
        ]
        registration = self.calibration.registration
        coverage = [(x * width_m, y * height_m) for x, y in registration["floor_hull"]] if registration else []
        samples = []
        active_positions = {}
        for detection in detections:
            x, y = self.calibration.camera_to_floor(
                detection.foot_x, detection.foot_y, width, height
            )
            if not (0 <= x <= 1 and 0 <= y <= 1):
                samples.append(Observation(detection.raw_id, None))
                continue
            detection.floor_x, detection.floor_y = x, y
            matches = [zone for zone in zones if point_in_polygon(x, y, zone.polygon)]
            detection.matching_zones = tuple(zone.zone_id for zone in matches)
            detection.zone = next((zone for zone in matches if zone.is_aggregated_only), matches[0] if matches else None)
            if detection.zone and detection.zone.is_aggregated_only:
                samples.append(Observation(detection.raw_id, None))
                continue
            point_m = (x * width_m, y * height_m)
            recoverable = (
                bool(coverage) and edge_distance(point_m, coverage) > RECOVERY_RADIUS_M
                and all(edge_distance(point_m, p) > RECOVERY_RADIUS_M for p in private_polys)
            )
            samples.append(Observation(detection.raw_id, point_m, recoverable))

        identities = self.continuity.update(
            samples, at=now, max_gap_s=max_gap_s, max_speed_m_s=max_speed_m_s, private_polys=private_polys,
        )
        for index, identity in identities.items():
            detection = detections[index]
            x, y = detection.floor_x, detection.floor_y
            detection.track_number = identity.number
            detection.track_id = f"{self.track_prefix}-P{identity.number}"
            previous_speed = self._last_speed_position.get(detection.track_id)
            segment_id = None
            if not identity.recovered and previous_speed and 0 < now - previous_speed.timestamp <= max_gap_s:
                dx_m = (x - previous_speed.x) * self.calibration.width_m
                dy_m = (y - previous_speed.y) * self.calibration.height_m
                speed = math.hypot(dx_m, dy_m) / (now - previous_speed.timestamp)
                if speed <= max_speed_m_s:
                    detection.speed_m_s = speed
                    segment_id = previous_speed.segment_id
            detection.segment_id = segment_id or uuid.uuid4().hex
            point = TrailPoint(
                x, y, now, detection.zone.zone_id if detection.zone else None, detection.segment_id
            )
            active_positions[detection.track_id] = point
            previous = self._last_position.get(detection.track_id)
            if (
                previous is None or previous.segment_id != point.segment_id
                or now - previous.timestamp >= max_gap_s / 2
                or (now - previous.timestamp >= self.sample_interval
                    and math.hypot(x - previous.x, y - previous.y) >= self.min_step)
            ):
                self.trails[detection.track_id].append(point)
                self._last_position[detection.track_id] = point
        self._last_speed_position = active_positions

        active = {item.track_id for item in detections}
        oldest = now - 3_600
        for track_id in list(self.trails):
            while self.trails[track_id] and self.trails[track_id][0].timestamp < oldest:
                self.trails[track_id].popleft()
            if not self.trails[track_id] and track_id not in active:
                del self.trails[track_id]
                self._last_position.pop(track_id, None)

    def _color(self, track_id: str) -> tuple[int, int, int]:
        return self.TRAIL_COLORS[sum(ord(char) for char in track_id) % len(self.TRAIL_COLORS)]

    def _track_visible(self, track_id: str) -> bool:
        return self.selected_track is None or self.selected_track == track_id

    def _zone_visible(self, zone_id: str | None) -> bool:
        return self.selected_zone is None or self.selected_zone == zone_id

    def _floor_pixel(self, x: float, y: float) -> tuple[int, int]:
        margin = 38
        return (
            int(margin + x * (self.floor_width - 2 * margin)),
            int(margin + y * (self.floor_height - 2 * margin)),
        )

    def _draw_zones_on_camera(self, frame: Any, zones: list[Zone]) -> None:
        if not self.calibration.calibrated:
            return
        overlay = frame.copy()
        for zone in zones:
            points = [self.calibration.floor_to_camera(x, y) for x, y in zone.polygon]
            if any(point is None for point in points):
                continue
            contour = self.np.asarray(points, dtype="int32")
            color = hex_to_bgr(zone.color)
            self.cv2.fillPoly(overlay, [contour], color)
            self.cv2.polylines(frame, [contour], True, color, 2, self.cv2.LINE_AA)
            anchor = tuple(contour[0])
            self.cv2.putText(
                frame,
                zone.name,
                (int(anchor[0]) + 5, int(anchor[1]) - 7),
                self.cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
                self.cv2.LINE_AA,
            )
        self.cv2.addWeighted(overlay, 0.10, frame, 0.90, 0, frame)

    def _trail_runs(self, trail):
        run = []
        for point in trail:
            visible = self._zone_visible(point.zone_id)
            if run and (not visible or run[-1].segment_id != point.segment_id):
                yield run
                run = []
            if visible:
                run.append(point)
        if run:
            yield run

    def _draw_camera_trails(self, frame: Any) -> None:
        if not self.camera_trails or not self.calibration.calibrated:
            return
        for track_id, trail in self.trails.items():
            if not self._track_visible(track_id):
                continue
            for run in self._trail_runs(trail):
                points = [self.calibration.floor_to_camera(p.x, p.y) for p in run]
                if len(points) > 1 and all(p is not None for p in points):
                    self.cv2.polylines(frame, [self.np.asarray(points)], False, self._color(track_id), 2, self.cv2.LINE_AA)

    def camera_frame(
        self,
        source_frame: Any,
        detections: list[PersonDetection],
        zones: list[Zone],
        fps: float,
    ) -> Any:
        frame = source_frame.copy()
        self._draw_zones_on_camera(frame, zones)
        self._draw_camera_trails(frame)
        for detection in detections:
            if not self._track_visible(detection.track_id):
                continue
            if self.selected_zone and (
                detection.zone is None or detection.zone.zone_id != self.selected_zone
            ):
                continue
            private = detection.zone is not None and detection.zone.is_aggregated_only
            color = self._color(detection.track_id) if detection.segment_id else (120, 120, 120)
            x1, y1, x2, y2 = detection.box
            self.cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            self.cv2.circle(frame, (int(detection.foot_x), int(detection.foot_y)), 5, color, -1)
            identity = (
                "Persona · datos agregados" if private
                else f"Persona {detection.track_number}" if detection.segment_id
                else "Persona detectada · sin ID publicado"
            )
            zone_name = detection.zone.name if detection.zone else "Fuera de zona"
            label = f"{identity} | {zone_name} | {detection.confidence:.0%}"
            (text_w, text_h), _ = self.cv2.getTextSize(label, self.cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
            top = max(0, y1 - text_h - 12)
            self.cv2.rectangle(frame, (x1, top), (x1 + text_w + 10, y1), color, -1)
            self.cv2.putText(
                frame,
                label,
                (x1 + 5, y1 - 6),
                self.cv2.FONT_HERSHEY_SIMPLEX,
                0.52,
                (255, 255, 255),
                1,
                self.cv2.LINE_AA,
            )
        status = (
            f"Personas: {len(detections)} | FPS: {fps:.1f} | "
            f"{'Calibrado' if self.calibration.calibrated else 'SIN CALIBRAR'}"
        )
        self.cv2.rectangle(frame, (0, frame.shape[0] - 30), (frame.shape[1], frame.shape[0]), (20, 24, 28), -1)
        self.cv2.putText(
            frame,
            status,
            (12, frame.shape[0] - 9),
            self.cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (238, 238, 238),
            1,
            self.cv2.LINE_AA,
        )
        return frame

    def floor_frame(self, detections: list[PersonDetection], zones: list[Zone]) -> Any:
        canvas = self.np.full((self.floor_height, self.floor_width, 3), (242, 241, 237), dtype="uint8")
        self.cv2.rectangle(canvas, (0, 0), (self.floor_width, 32), (23, 33, 43), -1)
        filter_text = self.selected_track or "todas las personas"
        if self.selected_zone:
            filter_text += f" · zona {self.selected_zone}"
        self.cv2.putText(
            canvas,
            f"Plano 2D {self.calibration.width_m:g} x {self.calibration.height_m:g} m | {filter_text}",
            (12, 22),
            self.cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (245, 245, 245),
            1,
            self.cv2.LINE_AA,
        )
        for zone in zones:
            contour = self.np.asarray([self._floor_pixel(x, y) for x, y in zone.polygon], dtype="int32")
            color = hex_to_bgr(zone.color)
            overlay = canvas.copy()
            self.cv2.fillPoly(overlay, [contour], color)
            self.cv2.addWeighted(overlay, 0.10, canvas, 0.90, 0, canvas)
            thickness = 3 if zone.zone_id == self.selected_zone else 1
            self.cv2.polylines(canvas, [contour], True, color, thickness, self.cv2.LINE_AA)
            center = contour.mean(axis=0).astype(int)
            self.cv2.putText(
                canvas,
                zone.name,
                (int(center[0]) - 25, int(center[1])),
                self.cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                color,
                1,
                self.cv2.LINE_AA,
            )
        for track_id, trail in self.trails.items():
            if not self._track_visible(track_id):
                continue
            for run in self._trail_runs(trail):
                segment = [self._floor_pixel(p.x, p.y) for p in run]
                if len(segment) > 1:
                    self.cv2.polylines(
                        canvas,
                        [self.np.asarray(segment)],
                        False,
                        self._color(track_id),
                        2,
                        self.cv2.LINE_AA,
                    )
        for detection in detections:
            if detection.floor_x is None or detection.floor_y is None or not detection.segment_id:
                continue
            if not self._track_visible(detection.track_id):
                continue
            if not self._zone_visible(detection.zone.zone_id if detection.zone else None):
                continue
            pixel = self._floor_pixel(detection.floor_x, detection.floor_y)
            color = self._color(detection.track_id)
            self.cv2.circle(canvas, pixel, 7, (255, 255, 255), -1)
            self.cv2.circle(canvas, pixel, 5, color, -1)
            self.cv2.putText(
                canvas,
                f"P{detection.track_number}",
                (pixel[0] + 8, pixel[1] - 7),
                self.cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                1,
                self.cv2.LINE_AA,
            )
        self.cv2.putText(
            canvas,
            "N: siguiente persona | A: todas | Z: zona | R: reiniciar | V: trazo en cámara | Q: salir",
            (12, self.floor_height - 12),
            self.cv2.FONT_HERSHEY_SIMPLEX,
            0.46,
            (70, 76, 82),
            1,
            self.cv2.LINE_AA,
        )
        return canvas

    def reset_trails(self) -> None:
        self.trails.clear()
        self._last_position.clear()
        self._last_speed_position.clear()

    def break_continuity(self) -> None:
        self._last_speed_position.clear()
        self.continuity.reset()

    def handle_key(self, key: int, zones: list[Zone]) -> bool:
        key &= 0xFF
        if key in (ord("q"), 27):
            return True
        if key == ord("v"):
            self.camera_trails = not self.camera_trails
            log(f"trayectorias sobre cámara: {'sí' if self.camera_trails else 'no'}")
        elif key == ord("a"):
            self.selected_track = None
            log("filtro: todas las personas")
        elif key == ord("n"):
            track_ids = sorted(self.trails)
            if track_ids:
                if self.selected_track not in track_ids:
                    self.selected_track = track_ids[0]
                else:
                    self.selected_track = track_ids[(track_ids.index(self.selected_track) + 1) % len(track_ids)]
                log(f"filtro: {self.selected_track}")
        elif key == ord("z"):
            zone_ids = [None, *[zone.zone_id for zone in zones]]
            try:
                index = zone_ids.index(self.selected_zone)
            except ValueError:
                index = 0
            self.selected_zone = zone_ids[(index + 1) % len(zone_ids)]
            log(f"filtro de zona: {self.selected_zone or 'todas'}")
        elif key == ord("r"):
            self.reset_trails()
            log("trayectorias reiniciadas")
        return False


class FrameHub:
    def __init__(self, jpeg_quality: int, source: str, model: str, tracker_config: str) -> None:
        import cv2

        self.cv2 = cv2
        self.jpeg_quality = jpeg_quality
        self.source = source
        self.model = model
        self._lock = threading.Condition()
        self._camera_jpeg: bytes | None = None
        self._raw_jpeg: bytes | None = None
        self._floor_jpeg: bytes | None = None
        self._sequence = 0
        self._status: dict[str, Any] = {
            "ready": False,
            "version": VERSION,
            "source": source,
            "model": model,
            "tracker": tracker_config,
            "ultralytics_version": package_version("ultralytics"),
            "fps": 0.0,
            "tracks": 0,
            "zones": 0,
            "calibrated": False,
            "frame_width": 0,
            "frame_height": 0,
            "session_id": uuid.uuid4().hex,
        }

    def update(self, camera: Any, floor: Any, raw: Any | None = None, **status: Any) -> None:
        params = [self.cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality]
        ok_camera, encoded_camera = self.cv2.imencode(".jpg", camera, params)
        ok_floor, encoded_floor = self.cv2.imencode(".jpg", floor, params)
        ok_raw, encoded_raw = self.cv2.imencode(".jpg", raw if raw is not None else camera, params)
        if not ok_camera or not ok_floor or not ok_raw:
            return
        with self._lock:
            self._camera_jpeg = encoded_camera.tobytes()
            self._raw_jpeg = encoded_raw.tobytes()
            self._floor_jpeg = encoded_floor.tobytes()
            self._sequence += 1
            self._status.update(status)
            self._status.update({
                "ready": True,
                "frame_width": int(camera.shape[1]),
                "frame_height": int(camera.shape[0]),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            self._lock.notify_all()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._status)

    def wait_for_frame(self, view: str, previous: int, timeout: float = 2.0) -> tuple[int, bytes | None]:
        with self._lock:
            if self._sequence == previous:
                self._lock.wait(timeout)
            frame = self._floor_jpeg if view == "floor" else self._raw_jpeg if view == "raw" else self._camera_jpeg
            return self._sequence, frame

    def snapshot(self, view: str) -> tuple[bytes | None, dict[str, Any]]:
        with self._lock:
            jpeg = self._floor_jpeg if view == "floor" else self._raw_jpeg if view == "raw" else self._camera_jpeg
            return jpeg, dict(self._status)


class VisionHTTPServer:
    def __init__(self, host: str, port: int, hub: FrameHub, calibration: FloorCalibration) -> None:
        self.host = host
        self.port = port
        self.hub = hub
        self.calibration = calibration
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        hub = self.hub
        calibration = self.calibration

        class Handler(BaseHTTPRequestHandler):
            server_version = "FactoryPulseVision/0.5"

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _headers(self, status: int, content_type: str, length: int | None = None, extra: dict[str, str] | None = None) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                if length is not None:
                    self.send_header("Content-Length", str(length))
                for name, value in (extra or {}).items():
                    self.send_header(name, value)
                self.end_headers()

            def _mjpeg(self, view: str) -> None:
                self._headers(HTTPStatus.OK, "multipart/x-mixed-replace; boundary=frame")
                sequence = -1
                try:
                    while True:
                        sequence, frame = hub.wait_for_frame(view, sequence)
                        if frame is None:
                            continue
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return

            def do_GET(self) -> None:
                path = urlsplit(self.path).path
                if path == "/vision/health":
                    body = json.dumps(hub.status()).encode()
                    self._headers(HTTPStatus.OK, "application/json; charset=utf-8", len(body))
                    self.wfile.write(body)
                elif path == "/vision/annotated.mjpg":
                    self._mjpeg("annotated")
                elif path == "/vision/raw.mjpg":
                    self._mjpeg("raw")
                elif path == "/vision/floor.mjpg":
                    self._mjpeg("floor")
                elif path in {"/vision/snapshot.jpg", "/vision/raw.jpg", "/vision/floor.jpg"}:
                    view = "floor" if path.endswith("floor.jpg") else "raw" if path.endswith("raw.jpg") else "annotated"
                    body, state = hub.snapshot(view)
                    if body is None:
                        self._headers(HTTPStatus.SERVICE_UNAVAILABLE, "text/plain", 0)
                    else:
                        self._headers(HTTPStatus.OK, "image/jpeg", len(body), {
                            "X-Frame-Session": state["session_id"], "X-Frame-Time": state["updated_at"],
                            "X-Frame-Width": str(state["frame_width"]), "X-Frame-Height": str(state["frame_height"]),
                        })
                        self.wfile.write(body)
                else:
                    body = b"Factory Pulse Vision"
                    self._headers(HTTPStatus.NOT_FOUND, "text/plain", len(body))
                    self.wfile.write(body)

            def do_OPTIONS(self) -> None:
                self._headers(HTTPStatus.NO_CONTENT, "text/plain", 0)

            def do_POST(self) -> None:
                path = urlsplit(self.path).path
                if path != "/vision/map-points":
                    self._headers(HTTPStatus.NOT_FOUND, "text/plain", 0)
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length <= 0 or length > 262_144:
                        raise ValueError("Cuerpo JSON vacío o demasiado grande")
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError("Se esperaba un objeto JSON")
                    points = body.get("points")
                    if not isinstance(points, list) or not 1 <= len(points) <= 500:
                        raise ValueError("points debe contener entre 1 y 500 puntos")
                    state = hub.status()
                    mapped = calibration.map_normalized_points(
                        points,
                        str(body.get("direction", "camera_to_floor")),
                        int(state.get("frame_width", 0)),
                        int(state.get("frame_height", 0)),
                    )
                    data = json.dumps({"points": mapped, "calibrated": True}).encode()
                    self._headers(HTTPStatus.OK, "application/json; charset=utf-8", len(data))
                    self.wfile.write(data)
                except (ValueError, TypeError, json.JSONDecodeError) as exc:
                    data = json.dumps({"detail": str(exc)}).encode()
                    self._headers(HTTPStatus.UNPROCESSABLE_ENTITY, "application/json; charset=utf-8", len(data))
                    self.wfile.write(data)

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log(f"video anotado: http://{self.host}:{self.port}/vision/annotated.mjpg")

    def close(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread:
            self._thread.join(timeout=2)


def calibrate_source(
    source_value: str,
    output_path: str,
    width_m: float,
    height_m: float,
    rtsp_transport: str,
) -> None:
    import cv2
    import numpy as np

    source = VideoSource(parse_source(source_value), rtsp_transport=rtsp_transport)
    try:
        frame = source.read()
        if frame is None:
            raise RuntimeError("No se pudo leer un cuadro para calibrar")
        points: list[list[int]] = []
        labels = ["superior izquierda", "superior derecha", "inferior derecha", "inferior izquierda"]

        def on_click(event: int, x: int, y: int, *_args: Any) -> None:
            if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
                points.append([x, y])

        window = "Factory Pulse · Calibración"
        cv2.namedWindow(window, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window, on_click)
        while len(points) < 4:
            view = frame.copy()
            for index, point in enumerate(points):
                cv2.circle(view, tuple(point), 7, (20, 160, 240), -1)
                cv2.putText(
                    view,
                    str(index + 1),
                    (point[0] + 8, point[1] - 8),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (20, 160, 240),
                    2,
                )
            prompt = f"Haz clic en: {labels[len(points)]} (ESC cancela)"
            cv2.putText(view, prompt, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (20, 160, 240), 2)
            cv2.imshow(window, view)
            if cv2.waitKey(30) & 0xFF == 27:
                raise KeyboardInterrupt
        destination = np.asarray([[0, 0], [1, 0], [1, 1], [0, 1]], dtype="float32")
        homography = cv2.getPerspectiveTransform(np.asarray(points, dtype="float32"), destination)
        payload = {
            "version": 1,
            "image_points": points,
            "homography": homography.tolist(),
            "plant_width_m": width_m,
            "plant_height_m": height_m,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        log(f"calibración guardada en {output_path}")
    finally:
        source.close()
        cv2.destroyAllWindows()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Factory Pulse · YOLO + ByteTrack + webcam/MP4/RTSP",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--api", default=os.getenv("VISION_BACKEND_URL", "http://127.0.0.1:8000"), help="backend Factory Pulse")
    parser.add_argument("--device-id", default="cam-overhead-1", help="ID anónimo de la cámara")
    parser.add_argument("--source", default=os.getenv("FP_CAMERA_SOURCE", "webcam"), help="webcam | índice | HTTP | RTSP")
    parser.add_argument("--profile", choices=tuple(DETECTION_PROFILES), default="balanced", help="perfil base de detección")
    parser.add_argument("--model", default=None, help="modelo Ultralytics; vacío usa el perfil")
    parser.add_argument("--tracker", default="bytetrack.yaml", help="configuración de tracker Ultralytics")
    parser.add_argument("--confidence", type=float, default=None)
    parser.add_argument("--iou", type=float, default=None)
    parser.add_argument("--image-size", type=int, default=None)
    parser.add_argument("--device", default=None, help="cpu, 0, 1…; vacío = selección automática")
    parser.add_argument("--width", type=int, default=1280, help="ancho máximo de procesamiento; webcam solicita este ancho")
    parser.add_argument("--height", type=int, default=720, help="alto máximo de procesamiento; webcam solicita este alto")
    parser.add_argument("--plant-width", type=float, default=8.0, help="ancho real del plano en metros")
    parser.add_argument("--plant-height", type=float, default=5.0, help="alto real del plano en metros")
    parser.add_argument("--calib", default=None, help="JSON de homografía existente")
    parser.add_argument("--managed-calibration", action="store_true", help="usa la calibración administrada por el backend")
    parser.add_argument("--calibrate", metavar="ARCHIVO", help="selecciona cuatro puntos, guarda JSON y sale")
    parser.add_argument("--probe-source", action="store_true", help="prueba la fuente, muestra metadatos y sale")
    parser.add_argument("--rtsp-transport", choices=("tcp", "udp"), default="tcp")
    parser.add_argument("--reconnect-attempts", type=int, default=0, help="0 = reintentar indefinidamente")
    parser.add_argument("--publish-interval", type=float, default=0.40, help="segundos entre lotes al backend")
    parser.add_argument("--zone-refresh", type=float, default=5.0, help="segundos entre consultas de zonas")
    parser.add_argument("--sample-interval", type=float, default=0.25, help="muestreo del spaghetti")
    parser.add_argument("--recovery-seconds", type=float, default=DEFAULT_RECOVERY_S, help="ventana de recuperación anónima (0–2 s; 0 la desactiva)")
    parser.add_argument("--min-step", type=float, default=0.003, help="movimiento normalizado mínimo")
    parser.add_argument("--show-camera-trails", action="store_true", help="dibuja spaghetti también en cámara")
    parser.add_argument("--no-display", action="store_true", help="no abre ventanas OpenCV")
    parser.add_argument("--no-stream", action="store_true", help="no inicia el servidor MJPEG")
    parser.add_argument("--stream-host", default="127.0.0.1")
    parser.add_argument("--stream-port", type=int, default=8001)
    parser.add_argument("--jpeg-quality", type=int, default=82)
    return parser


def observations(
    detections: list[PersonDetection], zones: list[Zone], calibration: FloorCalibration, zone_revision: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    floor_ready = bool(calibration.revision and zone_revision)
    counts = {zone.zone_id: 0 for zone in zones if floor_ready and calibration.covers(zone)}
    positions: list[dict[str, Any]] = []
    for detection in (detections if floor_ready else []):
        x, y = detection.floor_x, detection.floor_y
        if x is None or y is None or not (0 <= x <= 1 and 0 <= y <= 1):
            continue
        for zone_id in detection.matching_zones:
            if zone_id in counts:
                counts[zone_id] += 1
        if detection.segment_id:
            positions.append({
                "track_id": detection.track_id,
                "calibration_revision": calibration.revision,
                "zone_revision": zone_revision,
                "segment_id": detection.segment_id,
                "x": x,
                "y": y,
                "confidence": detection.confidence,
                "speed_m_s": detection.speed_m_s,
                "zone_id": detection.zone.zone_id if detection.zone else None,
            })
    return positions, [{
        "zone_id": "__plant__",
        "count": len(detections),
        "counts": counts,
        "coordinate_space": "floor" if floor_ready else "image",
        "calibration_revision": calibration.revision if floor_ready else None,
        "zone_revision": zone_revision,
    }]


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    profile = DETECTION_PROFILES[args.profile]
    args.model = args.model or profile["model"]
    args.confidence = args.confidence if args.confidence is not None else profile["confidence"]
    args.iou = args.iou if args.iou is not None else profile["iou"]
    args.image_size = args.image_size or profile["image_size"]
    if not 0 < args.confidence <= 1 or not 0 < args.iou <= 1:
        raise SystemExit("--confidence y --iou deben estar entre 0 y 1")
    if args.publish_interval <= 0 or args.sample_interval <= 0:
        raise SystemExit("los intervalos deben ser mayores que cero")
    if not 1 <= args.jpeg_quality <= 100:
        raise SystemExit("--jpeg-quality debe estar entre 1 y 100")
    if not 0 <= args.recovery_seconds <= 2.0:
        raise SystemExit("--recovery-seconds debe estar entre 0 y 2")

    if args.calibrate:
        try:
            calibrate_source(
                args.source,
                args.calibrate,
                args.plant_width,
                args.plant_height,
                args.rtsp_transport,
            )
        except KeyboardInterrupt:
            log("calibración cancelada")
            return 130
        return 0

    video = VideoSource(
        parse_source(args.source),
        args.width,
        args.height,
        args.rtsp_transport,
        1 if args.probe_source else args.reconnect_attempts,
    )
    if args.probe_source:
        try:
            frame = video.read(timeout=5)
            info = video.metadata()
            info["first_frame_ok"] = frame is not None
            print(json.dumps(info, indent=2, ensure_ascii=False))
            return 0 if frame is not None else 2
        finally:
            video.close()

    calibration = FloorCalibration(None if args.managed_calibration else args.calib)
    calibration_client = CalibrationClient(args.api, args.device_id) if args.managed_calibration else None
    if not calibration.calibrated:
        calibration.width_m = args.plant_width
        calibration.height_m = args.plant_height
        log(
            "sin --calib: se publicará el total de detecciones, sin posiciones ni conteos de piso"
        )
    zone_client = ZoneClient(args.api, args.zone_refresh)
    zones = zone_client.refresh_if_due(force=True)
    prefix = uuid.uuid4().hex
    continuity = TrackingContinuity(args.recovery_seconds)
    tracker = YoloByteTracker(
        args.model,
        args.tracker,
        args.confidence,
        args.iou,
        args.image_size,
        args.device,
        prefix,
    )
    renderer = VisionRenderer(
        calibration,
        continuity,
        prefix,
        args.sample_interval,
        args.min_step,
        camera_trails=args.show_camera_trails,
    )
    publisher = EventPublisher(args.api, args.device_id)
    publisher.start()
    hub = FrameHub(args.jpeg_quality, redact_source(parse_source(args.source)), args.model, args.tracker)
    stream_server: VisionHTTPServer | None = None
    if not args.no_stream:
        stream_server = VisionHTTPServer(args.stream_host, args.stream_port, hub, calibration)
        stream_server.start()

    import cv2

    started = time.monotonic()
    previous_frame_at = started
    smoothed_fps = 0.0
    last_publish_at = 0.0
    last_geometry = None
    last_stream = None
    log("privacidad: IDs temporales; sin reconocimiento facial; el video no se almacena")
    if not args.no_display:
        log("se abren dos ventanas independientes: Cámara y Plano 2D")
    try:
        while True:
            frame_started = time.monotonic()
            frame = video.read()
            if frame is None:
                log("la fuente dejó de entregar cuadros")
                return 2
            detections = tracker.detect(frame)

            zones = zone_client.refresh_if_due()
            if calibration_client:
                calibration.use_registration(calibration_client.refresh_if_due(), frame.shape[1], frame.shape[0])
            geometry = (calibration.revision, zone_client.revision)
            if geometry != last_geometry:
                renderer.reset_trails()
                renderer.break_continuity()
                last_geometry = geometry
            stream = (video.delivered_connection, frame.shape[:2])
            if stream != last_stream:
                renderer.break_continuity()
                last_stream = stream
            geometry_ready = calibration.calibrated and zone_client.revision is not None
            geometry_zones = zones if geometry_ready else []
            policy = calibration_client.trajectory if calibration_client else {"max_gap_s": 2.0, "max_speed_m_s": 4.5}
            if geometry_ready:
                renderer.locate(detections, frame.shape, geometry_zones, datetime.fromisoformat(video.delivered_frame_at).timestamp(), **policy)
            elapsed = max(frame_started - previous_frame_at, 1e-6)
            instantaneous_fps = 1.0 / elapsed
            smoothed_fps = instantaneous_fps if smoothed_fps == 0 else (0.90 * smoothed_fps + 0.10 * instantaneous_fps)
            previous_frame_at = frame_started

            annotated = renderer.camera_frame(frame, detections, geometry_zones, smoothed_fps)
            floor = renderer.floor_frame(detections, geometry_zones)
            hub.update(
                annotated,
                floor,
                raw=frame,
                fps=round(smoothed_fps, 1),
                tracks=sum(1 for item in detections if item.segment_id),
                continuity={
                    "window_s": min(continuity.recovery_s, policy["max_gap_s"]) if geometry_ready and calibration.registration else 0,
                    "created": continuity.created,
                    "recovered": continuity.recovered,
                    "rejected": continuity.rejected,
                },
                detections=len(detections),
                zones=len(geometry_zones),
                calibrated=calibration.calibrated,
                calibration_revision=calibration.revision,
                backend_ok=publisher.last_ok_at is not None and time.time() - publisher.last_ok_at < 15,
                uptime_seconds=round(time.monotonic() - started),
            )

            now = time.monotonic()
            if now - last_publish_at >= args.publish_interval:
                positions, occupancy = observations(detections, zones, calibration, zone_client.revision)
                publisher.submit(positions, occupancy, video.delivered_frame_at)
                last_publish_at = now

            if not args.no_display:
                cv2.imshow("Factory Pulse · Cámara", annotated)
                cv2.imshow("Factory Pulse · Plano 2D", floor)
                if renderer.handle_key(cv2.waitKey(1), zones):
                    break
    except KeyboardInterrupt:
        log("detenido por el usuario")
    finally:
        video.close()
        publisher.close()
        zone_client.close()
        if calibration_client:
            calibration_client.close()
        if stream_server:
            stream_server.close()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
