from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.db_models import DBCameraConfig
from app.cameras.security import decrypt_secret

logger = logging.getLogger("factory_pulse.cameras")


def provider_base(camera: DBCameraConfig) -> str | None:
    if camera.provider_mode == "external":
        return camera.provider_url.rstrip("/") if camera.provider_url else None
    if camera.provider_port:
        return f"http://127.0.0.1:{camera.provider_port}"
    return None


def camera_source(camera: DBCameraConfig) -> str:
    if camera.source_type == "webcam":
        return str(camera.webcam_index or 0)
    if not camera.source_url:
        raise RuntimeError("La cámara no tiene una fuente de video configurada")
    password = decrypt_secret(camera.password_encrypted)
    if not camera.username and not password:
        return camera.source_url
    parts = urlsplit(camera.source_url)
    host = parts.hostname or ""
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if parts.port:
        host = f"{host}:{parts.port}"
    userinfo = quote(camera.username or "", safe="")
    if password:
        userinfo += f":{quote(password, safe='')}"
    return urlunsplit((parts.scheme, f"{userinfo}@{host}", parts.path, parts.query, parts.fragment))


class CameraRuntimeManager:
    def __init__(self) -> None:
        self._processes: dict[str, subprocess.Popen[Any]] = {}
        self._errors: dict[str, str] = {}
        self._logs: dict[str, Path] = {}

    @property
    def repo_root(self) -> Path:
        return Path(__file__).resolve().parents[3]

    def _python(self) -> str:
        configured = settings.VISION_PYTHON.strip()
        if configured:
            return configured
        candidates = (
            self.repo_root / ".venv-vision" / "Scripts" / "python.exe",
            self.repo_root / ".venv-vision" / "bin" / "python",
        )
        return str(next((path for path in candidates if path.exists()), Path(sys.executable)))

    @staticmethod
    def _safe_id(camera_id: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "-", camera_id).strip("-") or "camera"

    def _last_log_line(self, camera_id: str) -> str | None:
        path = self._logs.get(camera_id)
        if not path or not path.exists():
            return None
        try:
            with path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                handle.seek(max(0, handle.tell() - 8_192))
                lines = handle.read().decode(errors="replace").splitlines()
        except OSError:
            return None
        for line in reversed(lines):
            cleaned = line.strip()
            if cleaned:
                return cleaned[-600:]
        return None

    def status(self, camera_id: str) -> dict[str, Any]:
        process = self._processes.get(camera_id)
        if process is None:
            return {"process": "stopped", "pid": None, "error": self._errors.get(camera_id)}
        code = process.poll()
        if code is None:
            return {"process": "running", "pid": process.pid, "error": self._errors.get(camera_id)}
        self._processes.pop(camera_id, None)
        detail = self._last_log_line(camera_id)
        message = self._errors.get(camera_id) or f"El proveedor terminó con código {code}"
        if detail and detail not in message:
            message = f"{message}: {detail}"
        self._errors[camera_id] = message
        return {"process": "error", "pid": None, "exit_code": code, "error": message}

    def record_error(self, camera_id: str, error: Exception | str) -> None:
        """Conserva el motivo cuando un arranque automático no puede completarse."""
        self._errors[camera_id] = str(error)

    def start(self, camera: DBCameraConfig) -> dict[str, Any]:
        if camera.provider_mode == "external":
            return {"process": "external", "pid": None, "error": None}
        if not camera.enabled:
            raise RuntimeError("La cámara está desactivada")
        if not camera.provider_port:
            raise RuntimeError("La cámara no tiene puerto de proveedor asignado")
        running = self._processes.get(camera.device_id)
        if running and running.poll() is None:
            return self.status(camera.device_id)
        self.stop(camera.device_id)

        script = self.repo_root / "hardware" / "local_vision_provider.py"
        if not script.exists():
            raise RuntimeError(f"No se encontró el proveedor de visión: {script}")
        command = [
            self._python(), str(script),
            "--api", settings.VISION_BACKEND_URL,
            "--device-id", camera.device_id,
            "--profile", camera.profile,
            "--model", camera.model,
            "--confidence", str(camera.confidence),
            "--iou", str(camera.iou),
            "--image-size", str(camera.image_size),
            "--width", str(camera.processing_width),
            "--height", str(camera.processing_height),
            "--rtsp-transport", camera.rtsp_transport,
            "--stream-host", "127.0.0.1",
            "--stream-port", str(camera.provider_port),
            "--no-display",
        ]
        if camera.calibration_path:
            command.extend(("--calib", camera.calibration_path))
        env = os.environ.copy()
        env["FP_CAMERA_SOURCE"] = camera_source(camera)
        runtime = self.repo_root / "runtime"
        runtime.mkdir(exist_ok=True)
        log_path = runtime / f"camera-{self._safe_id(camera.device_id)}.log"
        self._logs[camera.device_id] = log_path
        log_handle = log_path.open("ab")
        kwargs: dict[str, Any] = {
            "cwd": str(self.repo_root),
            "env": env,
            "stdin": subprocess.DEVNULL,
            "stdout": log_handle,
            "stderr": subprocess.STDOUT,
        }
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            process = subprocess.Popen(command, **kwargs)
        except OSError as exc:
            self._errors[camera.device_id] = str(exc)
            raise RuntimeError(f"No se pudo iniciar Python de visión: {exc}") from exc
        finally:
            log_handle.close()
        self._processes[camera.device_id] = process
        self._errors.pop(camera.device_id, None)
        logger.info("Proveedor %s iniciado en puerto %s", camera.device_id, camera.provider_port)
        return self.status(camera.device_id)

    def stop(self, camera_id: str) -> dict[str, Any]:
        process = self._processes.pop(camera_id, None)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        self._errors.pop(camera_id, None)
        return {"process": "stopped", "pid": None, "error": None}

    def stop_all(self) -> None:
        for camera_id in list(self._processes):
            self.stop(camera_id)

    async def start_configured(self) -> None:
        async with AsyncSessionLocal() as session:
            cameras = (
                await session.execute(
                    select(DBCameraConfig).where(
                        DBCameraConfig.enabled.is_(True),
                        DBCameraConfig.auto_start.is_(True),
                        DBCameraConfig.provider_mode == "managed",
                    )
                )
            ).scalars().all()
        for camera in cameras:
            try:
                self.start(camera)
            except RuntimeError as exc:
                self.record_error(camera.device_id, exc)
                logger.warning("No se pudo iniciar %s: %s", camera.device_id, exc)

    async def probe(self, camera: DBCameraConfig) -> dict[str, Any]:
        if camera.provider_mode == "external":
            base = provider_base(camera)
            if not base:
                raise RuntimeError("Falta la URL del proveedor externo")
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                response = await client.get(f"{base}/vision/health")
                response.raise_for_status()
                return {"ok": True, "kind": "provider", "details": response.json()}

        env = os.environ.copy()
        env["FP_CAMERA_SOURCE"] = camera_source(camera)
        script = self.repo_root / "hardware" / "local_vision_provider.py"
        command = [
            self._python(), str(script), "--probe-source",
            "--width", str(camera.processing_width),
            "--height", str(camera.processing_height),
            "--rtsp-transport", camera.rtsp_transport,
        ]
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(self.repo_root),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=15)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise RuntimeError("La cámara no respondió dentro de 15 segundos")
        output = stdout.decode(errors="replace")
        start = output.rfind("\n{")
        payload_text = output[start + 1:] if start >= 0 else output[output.find("{"):]
        try:
            details = json.loads(payload_text)
        except (json.JSONDecodeError, ValueError):
            detail = stderr.decode(errors="replace").strip() or output.strip() or "Sin respuesta"
            raise RuntimeError(detail[-600:])
        if process.returncode != 0 or not details.get("first_frame_ok"):
            raise RuntimeError("Se abrió la dirección, pero no llegó el primer cuadro")
        return {"ok": True, "kind": "source", "details": details}


camera_manager = CameraRuntimeManager()
