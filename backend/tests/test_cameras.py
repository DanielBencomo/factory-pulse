import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.cameras.security import decrypt_secret
from app.cameras.manager import CameraRuntimeManager
from app.cameras.security import encrypt_secret
from app.config import settings
from app.database import AsyncSessionLocal
from app.main import app
from app.models.db_models import DBCameraConfig, DBDevice


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_camera_registry_strips_credentials_and_applies_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CAMERA_KEY_FILE", str(tmp_path / "camera.key"))
    camera_id = f"camera-test-{uuid.uuid4().hex[:8]}"
    payload = {
        "camera_id": camera_id,
        "name": "Cámara norte",
        "source_type": "rtsp",
        "source_url": "rtsp://operator:secret@192.168.10.25:8554/live",
        "profile": "balanced",
        "auto_start": False,
        "show_annotations": True,
        "calibration_path": "calib-norte.json",
    }

    async with client() as ac:
        created = await ac.post("/api/cameras", json=payload)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["source_url"] == "rtsp://192.168.10.25:8554/live"
        assert body["username"] == "operator"
        assert body["has_password"] is True
        assert body["provider_port"] >= settings.VISION_PORT_START
        assert body["annotated_stream_url"].startswith(f"/api/cameras/{camera_id}/")
        assert body["calibration_path"] == "calib-norte.json"

        updated = await ac.put(
            f"/api/cameras/{camera_id}",
            json={"profile": "precision", "show_annotations": False},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["model"] == "yolo11m.pt"
        assert updated.json()["image_size"] == 1280
        assert updated.json()["show_annotations"] is False

        listed = await ac.get("/api/cameras")
        assert listed.status_code == 200
        assert any(item["camera_id"] == camera_id for item in listed.json())

    async with AsyncSessionLocal() as session:
        config = (
            await session.execute(select(DBCameraConfig).where(DBCameraConfig.device_id == camera_id))
        ).scalar_one()
        assert config.password_encrypted != "secret"
        assert "secret" not in config.password_encrypted
        assert decrypt_secret(config.password_encrypted) == "secret"

    async with client() as ac:
        deleted = await ac.delete(f"/api/cameras/{camera_id}")
        assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_camera_registration_claims_discovered_device_and_rejects_bad_port(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CAMERA_KEY_FILE", str(tmp_path / "camera.key"))
    camera_id = f"camera-discovered-{uuid.uuid4().hex[:8]}"

    async with client() as ac:
        heartbeat = await ac.post(
            f"/api/devices/{camera_id}/heartbeat",
            json={"firmware": "vision-yolo-0.6.0"},
        )
        assert heartbeat.status_code == 200
        discovered = await ac.get("/api/cameras")
        discovered_camera = next(item for item in discovered.json() if item["camera_id"] == camera_id)
        assert discovered_camera["configured"] is False
        registered = await ac.post("/api/cameras", json={
            "camera_id": camera_id,
            "name": "Proveedor existente",
            "source_type": "provider",
            "provider_url": "http://127.0.0.1:8107",
            "auto_start": False,
        })
        assert registered.status_code == 201, registered.text

        invalid = await ac.post("/api/cameras", json={
            "camera_id": f"camera-invalid-{uuid.uuid4().hex[:8]}",
            "name": "Puerto inválido",
            "source_type": "rtsp",
            "source_url": "rtsp://127.0.0.1:99999/live",
            "auto_start": False,
        })
        assert invalid.status_code == 422

    async with AsyncSessionLocal() as session:
        device = (
            await session.execute(select(DBDevice).where(DBDevice.device_id == camera_id))
        ).scalar_one()
        assert device.type == "camera_vision"
        assert device.is_active is True

    async with client() as ac:
        deleted = await ac.delete(f"/api/cameras/{camera_id}")
        assert deleted.status_code == 204


def test_managed_provider_uses_private_environment_for_camera_secret(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CAMERA_KEY_FILE", str(tmp_path / "camera.key"))
    monkeypatch.setattr(settings, "VISION_PYTHON", "C:/FactoryPulse/.venv-vision/Scripts/python.exe")
    captured = {}

    class Process:
        pid = 4321

        def poll(self):
            return None

        def terminate(self):
            return None

        def wait(self, timeout=None):
            return 0

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return Process()

    monkeypatch.setattr("app.cameras.manager.subprocess.Popen", fake_popen)
    camera = DBCameraConfig(
        id="cfg-test",
        device_id="camera:managed-test",
        source_type="rtsp",
        source_url="rtsp://192.168.1.50:8554/live",
        username="operator@example.com",
        password_encrypted=encrypt_secret("p@ss word"),
        rtsp_transport="tcp",
        provider_mode="managed",
        provider_port=8111,
        profile="balanced",
        model="yolo11s.pt",
        confidence=0.25,
        iou=0.55,
        image_size=960,
        processing_width=1920,
        processing_height=1080,
        enabled=True,
    )

    manager = CameraRuntimeManager()
    status = manager.start(camera)
    assert status["process"] == "running"
    assert captured["command"][0].endswith("python.exe")
    assert "--stream-port" in captured["command"]
    assert "8111" in captured["command"]
    assert all("p@ss word" not in str(item) for item in captured["command"])
    assert captured["kwargs"]["env"]["FP_CAMERA_SOURCE"] == (
        "rtsp://operator%40example.com:p%40ss%20word@192.168.1.50:8554/live"
    )
    assert (manager.repo_root / "runtime" / "camera-camera-managed-test.log").exists()
    manager.stop(camera.device_id)
