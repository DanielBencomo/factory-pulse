from enum import Enum
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field

# --- ENUMS ---

class EventMode(str, Enum):
    DEMO = "demo"
    REPLAY = "replay"
    LIVE = "live"

class EventType(str, Enum):
    POSITION = "position"
    ZONE_ENTER = "zone_enter"
    ZONE_EXIT = "zone_exit"
    PRESENCE = "presence"
    MACHINE_STATE = "machine_state"
    CYCLE = "cycle"
    BUTTON_PRESS = "button_press"
    ENVIRONMENT = "environment"
    HEARTBEAT = "heartbeat"

class QualityLevel(float, Enum):
    HIGH = 1.0
    MEDIUM = 0.7
    LOW = 0.3
    INVALID = 0.0

class StationStatus(str, Enum):
    IDLE = "idle"
    ACTIVE = "active"
    WAITING_MATERIAL = "waiting_material"
    UNATTENDED = "unattended"
    STOPPED = "stopped"
    UNKNOWN = "unknown"

class StopScope(str, Enum):
    PLANT = "plant"
    LINE = "line"
    STATION = "station"
    ZONE = "zone"

class IntervalClassification(str, Enum):
    PRODUCTIVO = "PRODUCTIVO"
    ESPERA = "ESPERA"
    AUSENTE = "AUSENTE"
    DESCONOCIDO = "DESCONOCIDO"
    PARO_AUTORIZADO = "PARO_AUTORIZADO"

class ModuleAvailability(str, Enum):
    ACTIVE = "active"
    SIMULATED = "simulated"
    NEEDS_DEVICE = "needs_device"
    EXPERIMENTAL = "experimental"

class AlertSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"

class AlertStatus(str, Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"

class ZoneType(str, Enum):
    WORK = "work"
    TRANSIT = "transit"
    STORAGE = "storage"
    REST = "rest"
    BATHROOM = "bathroom"
    RESTRICTED = "restricted"
