from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    PROJECT_NAME: str = "Factory Pulse"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./factory_pulse.db"
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]
    
    # MQTT Configuration (Optional / Configurable)
    MQTT_ENABLED: bool = False
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_TOPIC_PREFIX: str = "factory_pulse"
    
    # Segundos sin latido para considerar un dispositivo sin señal.
    DEVICE_TIMEOUT_SECONDS: int = 30
    # Si se define, los lectores RFID deben enviarlo en X-Factory-Pulse-Key.
    RFID_INGEST_TOKEN: str = ""

    # Cámaras. El frontend nunca depende de un puerto fijo: el backend asigna
    # uno por proveedor local y publica todos los flujos bajo /api/cameras.
    VISION_PYTHON: str = ""
    VISION_BACKEND_URL: str = "http://127.0.0.1:8000"
    VISION_PORT_START: int = 8101
    VISION_PORT_END: int = 8199
    CAMERA_SECRET_KEY: str = ""
    CAMERA_KEY_FILE: str = ".factory_pulse_camera.key"

    model_config = SettingsConfigDict(env_file=ROOT / ".env", case_sensitive=True, extra="ignore")

settings = Settings()
