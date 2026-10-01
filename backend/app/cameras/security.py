from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _fernet_key() -> bytes:
    configured = settings.CAMERA_SECRET_KEY.strip()
    if configured:
        raw = configured.encode("utf-8")
        try:
            Fernet(raw)
            return raw
        except (ValueError, TypeError):
            # También se acepta una frase larga; se deriva una llave Fernet.
            return base64.urlsafe_b64encode(hashlib.sha256(raw).digest())

    path = Path(settings.CAMERA_KEY_FILE).expanduser()
    if not path.is_absolute():
        # La llave debe ser estable aunque Uvicorn se inicie desde la raíz o
        # desde backend/. Cambiarla haría indescifrables las credenciales.
        path = Path(__file__).resolve().parents[3] / path
    if path.exists():
        return path.read_bytes().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = Fernet.generate_key()
    path.write_bytes(key + b"\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def encrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    return Fernet(_fernet_key()).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return Fernet(_fernet_key()).decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise RuntimeError("No fue posible descifrar la contraseña de la cámara") from exc
