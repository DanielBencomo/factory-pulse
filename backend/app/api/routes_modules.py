from typing import List, Dict, Any
from fastapi import APIRouter
from app.models.schemas import CatalogModule, ModuleAvailability

router = APIRouter()

MODULES_CATALOG: List[CatalogModule] = [
    # 1. Producción y Estaciones
    CatalogModule(
        id="mod-prod-cycles",
        category="1. Producción y Estaciones",
        name="Conteo de Piezas y Tiempos de Ciclo",
        description="Monitoreo de cadencia de piezas producidas por estación con comparación contra tiempo de ciclo ideal (takt time).",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["Evento de ciclo (cycle)", "ID de estación", "Timestamp UTC"],
        signal_type="Digital / Pulso de máquina",
        relative_cost="Bajo",
        expected_resolution="Por pieza unitaria (ms)",
        deployment_requirements="ESP32 con entrada optoacoplada a PLC o sensor fotoeléctrico.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-prod-oee",
        category="1. Producción y Estaciones",
        name="Disponibilidad y OEE Parcial/Completo",
        description="Cálculo matemático estricto de Disponibilidad Operativa; calcula OEE completo solo cuando Rendimiento y Calidad están presentes.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["Tiempo planificado ajustado", "Tiempo operativo", "Piezas buenas/totales"],
        signal_type="Telemetría agregada",
        relative_cost="Bajo",
        expected_resolution="Por turno / línea",
        deployment_requirements="Backend Factory Pulse + base de datos SQLite.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-prod-andon",
        category="1. Producción y Estaciones",
        name="Tablero Andon y Estado de Estaciones",
        description="Visualización del estado en tiempo real (Activo, Espera, Desatendido, Paro) con escalamiento visual de anomalías.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["machine_state", "presence", "button_press"],
        signal_type="Estado de máquina y presencia",
        relative_cost="Bajo",
        expected_resolution="Tiempo real (< 1s)",
        deployment_requirements="Pantalla de planta o interfaz web en estación.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),

    # 2. Flujo Humano y Espacios
    CatalogModule(
        id="mod-flow-spaghetti",
        category="2. Flujo Humano y Espacios",
        name="Trayectorias 2D tipo Spaghetti con Sentido",
        description="Trazado continuo del recorrido de operadores y carros con flechas de dirección, filtrado por track anónimo e intervalo de tiempo.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["position (x, y)", "track_id efímero", "confianza > 0.6"],
        signal_type="Coordenadas normalizadas [0..1]",
        relative_cost="Medio",
        expected_resolution="0.2 - 0.5 metros (con cámara cenital)",
        deployment_requirements="Cámara web o celular fijo con servicio local de visión OpenCV.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-flow-heatmap",
        category="2. Flujo Humano y Espacios",
        name="Mapa de Calor de Ocupación (Heatmap)",
        description="Densidad acumulada de presencia para detectar zonas congestionadas, pasillos sobreutilizados y estaciones desiertas.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["position (x, y)", "marca de tiempo"],
        signal_type="Densidad espacial 2D",
        relative_cost="Bajo",
        expected_resolution="Rejilla de 1x1 metro",
        deployment_requirements="Backend Factory Pulse + ECharts.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-flow-zones-privacy",
        category="2. Flujo Humano y Espacios",
        name="Zonas y Privacidad Agregada (Sanitarios / Descanso)",
        description="Control de permanencia agregada y conteo de ocupación sin expedientes personales ni rastreo dentro de sanitarios.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["Polígono de zona", "position o presencia en acceso"],
        signal_type="Conteo agregado",
        relative_cost="Bajo",
        expected_resolution="Conteo de personas por zona",
        deployment_requirements="Delimitación de polígono en editor de plano.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),

    # 3. Materiales y Proceso
    CatalogModule(
        id="mod-mat-rfid",
        category="3. Materiales y Proceso",
        name="Puntos de Paso RFID / NFC para Materiales",
        description="Lectura en checkpoints para registrar salida de almacén, llegada a estación y trabajo en proceso (WIP).",
        availability=ModuleAvailability.NEEDS_DEVICE,
        data_requirements=["ID de tag RFID", "ID de lector", "Timestamp"],
        signal_type="Lectura puntual por proximidad",
        relative_cost="Medio",
        expected_resolution="Punto de paso fijo",
        deployment_requirements="Lector RFID RC522 o UHF conectado a ESP32.",
        is_active_in_demo=False,
        toggle_enabled=False
    ),
    CatalogModule(
        id="mod-mat-ble-uwb",
        category="3. Materiales y Proceso",
        name="Localización UWB con Anclas para Carros",
        description="Posicionamiento centimétrico de carros de material pesado utilizando anclas UWB (Ultra Wide Band).",
        availability=ModuleAvailability.EXPERIMENTAL,
        data_requirements=["Coordenadas trianguladas UWB", "Tag ID"],
        signal_type="Trilateración ToF RF",
        relative_cost="Alto",
        expected_resolution="10 - 20 cm",
        deployment_requirements="Mínimo 4 anclas DWM1000/ESP32 en techo de nave.",
        is_active_in_demo=False,
        toggle_enabled=False
    ),

    # 4. Paros y Operación
    CatalogModule(
        id="mod-stops-manager",
        category="4. Paros y Operación",
        name="Gestión y Auditoría de Paros Autorizados",
        description="Registro y justificación de paros por administrador con cálculo de unión de intervalos sin doble descuento ni borrado de eventos.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["started_at", "ended_at", "motivo", "autor", "alcance"],
        signal_type="Registro administrativo transaccional",
        relative_cost="Bajo",
        expected_resolution="Precisión al segundo",
        deployment_requirements="Módulo web de paros integrado en SQLite.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-stops-microstops",
        category="4. Paros y Operación",
        name="Detección Automática de Microparos",
        description="Propone microparos no justificados (10 a 60 segundos) detectados por falta de ciclo para revisión del supervisor.",
        availability=ModuleAvailability.SIMULATED,
        data_requirements=["machine_state", "cycle", "presencia"],
        signal_type="Inferencia de reglas de cadencia",
        relative_cost="Bajo",
        expected_resolution="Intervalos de 10s - 60s",
        deployment_requirements="Motor de reglas Factory Pulse.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),

    # 5. Ambiente y Seguridad
    CatalogModule(
        id="mod-env-sensors",
        category="5. Ambiente y Seguridad",
        name="Monitoreo Ambiental (Temp, Humedad, CO2, Ruido)",
        description="Correlación de condiciones de confort y norma ESD con desempeño de la línea sin afirmar causalidad forzada.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["temperature_c", "humidity_pct", "co2_ppm"],
        signal_type="Analógica / I2C / DHT",
        relative_cost="Bajo",
        expected_resolution="Muestreo cada 5-30s",
        deployment_requirements="ESP32 con sensor DHT22 / BME280 / MQ-135.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-sec-sos-button",
        category="5. Ambiente y Seguridad",
        name="Botón Fijo de Emergencia / SOS",
        description="Llamada de paro inmediato por seguridad en estación. Los wearables quedan descartados por riesgo industrial de atrapamiento.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["button_press con action='sos'"],
        signal_type="Pulsador físico de golpe",
        relative_cost="Bajo",
        expected_resolution="Inmediata (< 100ms)",
        deployment_requirements="Pulsador tipo hongo conectado a GPIO de ESP32 con resistencia pull-up.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),

    # 6. Salud de Activos y Sensores
    CatalogModule(
        id="mod-dev-health",
        category="6. Salud de Activos y Sensores",
        name="Vigilancia de Salud, Latencia y Pérdida de Sensores",
        description="Detección automática de nodos ESP32 o cámaras desconectadas por falta de latido (heartbeat); alerta datos obsoletos.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["heartbeat", "latency_ms", "rssi"],
        signal_type="Keepalive periódico",
        relative_cost="Bajo",
        expected_resolution="Timeout de 30 segundos",
        deployment_requirements="Firmware ESP32 con función de heartbeat continuo.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-dev-current-vib",
        category="6. Salud de Activos y Sensores",
        name="Monitoreo de Corriente y Vibración de Motores",
        description="Medición de carga motriz con transformador de corriente SCT-013 y acelerómetro MPU6050 para mantenimiento preventivo.",
        availability=ModuleAvailability.NEEDS_DEVICE,
        data_requirements=["current_amps", "vibration_rms"],
        signal_type="ADC de alta frecuencia",
        relative_cost="Medio",
        expected_resolution="100 Hz muestreo",
        deployment_requirements="ESP32 con ADC dedicado y sensor SCT-013.",
        is_active_in_demo=False,
        toggle_enabled=False
    ),

    # 7. Analítica e IA Explicable
    CatalogModule(
        id="mod-ai-anomaly-rules",
        category="7. Analítica e IA Explicable",
        name="Motor de Detección de Anomalías Transparente",
        description="Detección de flujos atípicos, recorridos excesivos y cuellos de botella con evidencia transparente (sin cajas negras engañosas).",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["Reglas de negocio editables", "Telemetría normalizada"],
        signal_type="Reglas deterministas + Isolation Forest",
        relative_cost="Bajo",
        expected_resolution="Tiempo real",
        deployment_requirements="Motor de reglas Factory Pulse.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-ai-llm-advisor",
        category="7. Analítica e IA Explicable",
        name="Asistente de Causa Raíz y Recomendaciones (LLM)",
        description="Generación de explicaciones industriales asistidas para sugerir balanceo de línea y acciones correctivas ante paros repetitivos.",
        availability=ModuleAvailability.EXPERIMENTAL,
        data_requirements=["Historial de paros", "Eventos de alerta", "Conexión LLM / API local"],
        signal_type="Texto explicativo",
        relative_cost="Medio (consumo API)",
        expected_resolution="Bajo demanda",
        deployment_requirements="Punto de extensión a API LLM (Claude/GPT/Ollama local).",
        is_active_in_demo=True,
        toggle_enabled=True
    ),

    # 8. Integraciones y Conectores Físicos
    CatalogModule(
        id="mod-int-esp32-http-mqtt",
        category="8. Integraciones y Conectores Físicos",
        name="Conector Universal ESP32 (HTTP / MQTT)",
        description="Recepción de telemetría por POST JSON HTTP directo o mediante broker MQTT configurable con tópicos estructurados.",
        availability=ModuleAvailability.ACTIVE,
        data_requirements=["Wi-Fi 2.4GHz", "JSON validado por esquema"],
        signal_type="TCP/IP sobre Wi-Fi",
        relative_cost="Bajo ($4 - $6 USD por ESP32)",
        expected_resolution="Latencia < 50ms en red local",
        deployment_requirements="Cualquier placa ESP32 con conexión a la red de planta.",
        is_active_in_demo=True,
        toggle_enabled=True
    ),
    CatalogModule(
        id="mod-int-wifi-csi",
        category="8. Integraciones y Conectores Físicos",
        name="Detección de Movimiento por Wi-Fi CSI (Experimental)",
        description="Uso experimental del Channel State Information (CSI) de Wi-Fi como sensor de presencia/movimiento, NUNCA vendido como radar centimétrico XY.",
        availability=ModuleAvailability.EXPERIMENTAL,
        data_requirements=["ESP32 con CSI habilitado", "Procesamiento de amplitud/fase"],
        signal_type="RF CSI subportadoras",
        relative_cost="Bajo",
        expected_resolution="Detección binaria de movimiento (no XY)",
        deployment_requirements="Firmware ESP-IDF con captura CSI.",
        is_active_in_demo=False,
        toggle_enabled=False
    )
]

@router.get("/modules", response_model=List[CatalogModule])
async def list_catalog_modules():
    return MODULES_CATALOG
