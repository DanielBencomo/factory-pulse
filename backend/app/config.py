import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "Factory Pulse"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./factory_pulse.db")
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "*"
    ]
    
    # MQTT Configuration (Optional / Configurable)
    MQTT_ENABLED: bool = os.getenv("MQTT_ENABLED", "false").lower() == "true"
    MQTT_BROKER_HOST: str = os.getenv("MQTT_BROKER_HOST", "localhost")
    MQTT_BROKER_PORT: int = int(os.getenv("MQTT_BROKER_PORT", "1883"))
    MQTT_USERNAME: str = os.getenv("MQTT_USERNAME", "")
    MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "")
    MQTT_TOPIC_PREFIX: str = os.getenv("MQTT_TOPIC_PREFIX", "factory_pulse")
    
    # Seed & Simulation
    SEED_ON_STARTUP: bool = True
    SIMULATOR_SPEED: float = 1.0
    # "demo": arranca el simulador. "live": no simula nada y espera a los ESP32.
    START_MODE: str = os.getenv("START_MODE", "demo")
    # Segundos sin latido para considerar un dispositivo sin señal.
    DEVICE_TIMEOUT_SECONDS: int = int(os.getenv("DEVICE_TIMEOUT_SECONDS", "30"))
    # Si se define, los lectores RFID deben enviarlo en X-Factory-Pulse-Key.
    RFID_INGEST_TOKEN: str = os.getenv("RFID_INGEST_TOKEN", "")

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="allow")

settings = Settings()
