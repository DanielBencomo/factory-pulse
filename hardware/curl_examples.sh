# ==============================================================================
# FACTORY PULSE — COMANDOS CURL DE PRUEBA DE INGESTIÓN
# ==============================================================================

# 1. Health Check
curl -X GET http://localhost:8000/api/health

# 2. Ingestar Presencia en Estación 1 (ESP32)
curl -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "curl-pres-001",
    "device_id": "esp32-line1-st1",
    "source_id": "curl_cli",
    "occurred_at": "2026-09-26T08:30:00Z",
    "type": "presence",
    "payload": {
      "station_id": "st-1",
      "present": true,
      "confidence": 0.99
    },
    "quality": 1.0,
    "mode": "live"
  }'

# 3. Ingestar Posición en Plano 2D
curl -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "curl-pos-001",
    "device_id": "cam-overhead-line1",
    "source_id": "vision_service",
    "occurred_at": "2026-09-26T08:30:02Z",
    "type": "position",
    "payload": {
      "x": 0.35,
      "y": 0.42,
      "track_id": "TRK-OP2",
      "confidence": 0.96,
      "source": "opencv"
    },
    "quality": 1.0,
    "mode": "live"
  }'

# 4. Ingestar Pulsación de Botón Andon
curl -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "curl-btn-001",
    "device_id": "esp32-line1-st2",
    "source_id": "esp32_gpio",
    "occurred_at": "2026-09-26T08:30:05Z",
    "type": "button_press",
    "payload": {
      "station_id": "st-2",
      "button_name": "andon_yellow",
      "action": "request_material"
    },
    "quality": 1.0,
    "mode": "live"
  }'

# 5. Declarar Paro Autorizado por Administrador
curl -X POST http://localhost:8000/api/stops \
  -H "Content-Type: application/json" \
  -d '{
    "scope_type": "line",
    "scope_id": "line-1",
    "reason": "Mantenimiento preventivo programado",
    "reason_code": "MAN-01",
    "author": "Supervisor Turno",
    "started_at": "2026-09-26T08:00:00Z",
    "is_authorized": true
  }'

# 6. Consultar Métricas y Resumen de KPIs
curl -X GET "http://localhost:8000/api/metrics?window_minutes=60"
