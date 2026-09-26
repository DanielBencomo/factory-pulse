# 🏭 Factory Pulse — Plataforma Local de IoT y Análisis de Flujo Industrial

> **Hackathon IoT & Software Industrial — Maquiladora 2026**  
> Plataforma modular y ejecutable localmente para análisis de trayectorias spaghetti, mapa de calor, balanceo de estaciones, paros autorizados auditables y telemetría de nodos ESP32.

---

## 🚀 Arquitectura del Sistema

```
               [ ESP32 / RFID / CSI ]      [ Webcam / MP4 / RTSP ]
                         │                 [ YOLO + ByteTrack ]
                         └──────────────┬──────────────┘
                                  (HTTP POST)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (FastAPI + Python)                         │
│  • Ingestión y deduplicación por event_id                                    │
│  • Motor de Reglas y Alertas (recorridos, cuellos de botella, paros)        │
│  • Algoritmo de Unión de Intervalos (paros solapados sin doble descuento)   │
│  • Clasificación de universo temporal: Productivo / Espera / Ausencia       │
│  • Simulador determinista de 8 escenas industriales                         │
│  • Base de datos SQLite local (Persistencia completa, sin nube obligatoria)  │
│  • Canal WebSocket /ws en tiempo real                                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ WebSocket & REST API
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + TypeScript + Vite)                    │
│  • Plano 2D interactivo con trayectorias Spaghetti y Heatmap                │
│  • Modos visuales inequívocos: DEMO, REPRODUCCIÓN y EN VIVO                 │
│  • Tablero configurable con widgets en tiempo real (Apache ECharts)         │
│  • Módulo de Paros para Administrador con recálculo dinámico                │
│  • Catálogo exhaustivo de 8 familias de módulos desacoplados                │
│  • Privacidad por diseño: Sanitarios agregados sin expedientes personales   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Estructura del Repositorio

```
Daniel/
├── backend/                  # API FastAPI, modelos, cálculos matemáticos y simulador
│   ├── app/
│   │   ├── api/              # Rutas REST (events, metrics, stops, zones, dashboards, etc.)
│   │   ├── calculations/     # Algoritmos: unión de intervalos, distancia, zonas, OEE
│   │   ├── models/           # Esquemas Pydantic y modelos DB SQLite
│   │   ├── mqtt/             # Adaptador MQTT configurable con auto-reconexión
│   │   ├── rules/            # Motor de reglas de alerta industrial
│   │   ├── simulator/        # Motor determinista de 8 escenas
│   │   ├── ws/               # Gestor de conexiones WebSocket
│   │   ├── config.py         # Configuración del sistema
│   │   ├── database.py       # Base de datos e inicialización idempotente
│   │   └── main.py           # Entrada de la aplicación FastAPI
│   ├── tests/                # Suite de pruebas automatizadas con pytest
│   ├── requirements.txt      # Dependencias de Python
│   └── pytest.ini            # Configuración de pruebas
├── frontend/                 # Interfaz React, TypeScript, Vite, Tailwind y ECharts
│   ├── src/
│   │   ├── components/       # Header, Plano 2D, DashboardGrid, Modales
│   │   ├── services/         # Clientes de API REST y WebSocket
│   │   ├── types/            # Contratos de datos tipados en TypeScript
│   │   ├── App.tsx           # Componente principal y orquestador
│   │   ├── index.css         # Estilos industriales y React Grid Layout
│   │   └── main.tsx          # Punto de entrada de React
│   └── package.json          # Dependencias y scripts de frontend
├── hardware/                 # Firmware ESP32, Vision Provider y scripts de prueba
│   ├── esp32_firmware.ino    # Firmware Arduino C++ para ESP32 con cableado real
│   ├── local_vision_provider.py # Servicio de visión local (cámara cenital)
│   ├── test_publisher.py     # Script emisor de telemetría HTTP / MQTT
│   └── curl_examples.sh      # Ejemplos ejecutables con cURL
├── docs/                     # Documentación técnica y auditoría
│   ├── ESTADO_ETAPA_1.md     # Reporte de auditoría y correcciones
│   ├── MATRIZ_ACEPTACION.md  # Matriz de requisitos vs pruebas y resultados
│   ├── GUIA_DEMO.md          # Guion y relato de 3 a 5 min para el jurado
│   ├── HARDWARE.md           # Matriz de sensores, pines y limitaciones
│   └── DECISIONES.md         # Registro de decisiones de arquitectura (ADRs)
├── .env.example              # Variables de entorno de ejemplo
└── README.md                 # Esta guía
```

---

## 🛠️ Requisitos de Ejecución

- **Python:** 3.10 o superior (Probado en Python 3.12).
- **Node.js:** v18 o superior (Probado en Node.js v22 y npm 10.9).
- **Puerto 8000:** Para la API Backend y WebSocket.
- **Puerto 8001:** Para el video anotado del proveedor de visión.
- **Puerto 3000 o 5173:** Para el Frontend Vite.

---

## ⚡ Guía de Arranque Rápido (En un portátil)

### 1. Iniciar el Backend (FastAPI + SQLite + Simulador)
En una terminal:
```powershell
cd backend
python -m uvicorn app.main:app --reload --port 8000
```
- La base de datos SQLite `factory_pulse.db` se creará e inicializará automáticamente.
- El simulador arrancará en segundo plano emitiendo telemetría en tiempo real.
- Documentación Swagger disponible en: `http://localhost:8000/docs`

### 2. Iniciar visión (opcional, webcam o RTSP)
En una segunda terminal, desde la raíz:
```powershell
pip install -r hardware\vision_requirements.txt
python hardware\local_vision_provider.py --source webcam --api http://127.0.0.1:8000 --activate-live-mode
```
Para usar el teléfono, sustituya `webcam` por su URL RTSP. La guía completa de
calibración, privacidad y diagnóstico está en [`docs/VISION_YOLO_RTSP.md`](docs/VISION_YOLO_RTSP.md).

### 3. Iniciar el Frontend (React + Vite)
En una tercera terminal:
```powershell
cd frontend
npm run dev
```
- Abra su navegador en: `http://localhost:3000` (o `http://localhost:5173`).

---

## 🧪 Ejecución de Pruebas Automatizadas

```powershell
# Ejecutar suite de pruebas unitarias y de integración del Backend:
cd backend
pytest -v
```
Las pruebas usan su propia base (`test_factory_pulse.db`) y no tocan el layout ni los datos reales. Cubren cálculo de paros solapados, deduplicación de eventos, reglas de alerta, privacidad en sanitarios, layout editable, interior por área, registro y conexión de dispositivos, y la reconstrucción de estados de la analítica.

```powershell
# Validar compilación de tipos y build de producción del Frontend:
cd frontend
npm run build
```

---

## 🔌 Cómo Conectar un ESP32 o Enviar Telemetría

### Flujo recomendado (la app espera la conexión)
1. Arranca el backend escuchando en la red: `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`.
   Con `START_MODE=live` arranca sin simulador, solo con datos reales.
2. En la app, **Dispositivos → Registrar dispositivo**. Queda en *esperando conexión* y muestra la
   dirección del servidor y el bloque de configuración para el firmware.
3. Copia ese bloque en `hardware/esp32_firmware.ino`, activa los módulos que tenga el nodo
   (`ENABLE_RFID`, `ENABLE_BUTTONS`, `ENABLE_PIR`, `ENABLE_CYCLE`) y carga el firmware.
4. Al primer latido (`POST /api/devices/<ID>/heartbeat`, cada 10 s) pasa a *conectado*. Sin latido en
   30 s (`DEVICE_TIMEOUT_SECONDS`) pasa a *sin señal*. Un ID no registrado aparece como *detectado sin registrar*.
5. En **Planta → (estación) → Editar interior**, coloca el sensor y vincúlalo al dispositivo.

Para probar sin hardware, la app muestra un `curl` por dispositivo que simula su latido.

### Firmware y servicios incluidos
| Archivo | Qué hace |
|---|---|
| `hardware/esp32_firmware.ino` | RC522 (checkpoint RFID → `zone_enter` con `tag_id`), pulsadores de paro / material / **pieza terminada**, PIR y pulso de ciclo |
| `hardware/esp32_csi_node.ino` | Nodo Wi‑Fi CSI experimental: calibra con la zona vacía y reporta `presence` con `state` = actividad / quietud / sin_presencia y confianza |
| `hardware/local_vision_provider.py` | Webcam/MP4/RTSP con YOLO + ByteTrack, IDs temporales, zonas, homografía y streams anotados separados (`--calibrate`) |
| `hardware/vision_requirements.txt` | Dependencias aisladas del proveedor de visión |

Con dispositivos reales, el **procesador en vivo** del backend difunde las posiciones, deriva el
estado de cada estación, evalúa las reglas y detecta **discrepancias entre sensores** (RFID sin
confirmación de cámara, CSI con actividad que la cámara no ve). El pulsador de paro abre un paro
*pendiente de causa* que el supervisor justifica desde **Paros y alertas**.

**Plan B:** *Herramientas → Grabaciones* guarda los últimos N minutos y los reproduce después en un
modo aparte (`replay`) que no se mezcla con los datos reales. Guion completo en `docs/GUIA_DEMO.md`.

### Vía HTTP POST (Mínimo recomendado):
Envíe un evento JSON al endpoint `POST http://<IP_LAPTOP>:8000/api/events`:
```json
{
  "event_id": "esp32-btn-001",
  "device_id": "esp32-line1-st1",
  "source_id": "esp32_gpio",
  "occurred_at": "2026-09-26T08:30:00Z",
  "type": "button_press",
  "payload": {
    "station_id": "st-1",
    "button_name": "andon_yellow",
    "action": "request_material"
  },
  "quality": 1.0,
  "mode": "live"
}
```

### Vía Script de Prueba de Hardware:
```powershell
cd hardware
python test_publisher.py --transport http --api-url http://localhost:8000/api/events
```
El evento se reflejará de inmediato en el mapa 2D y en las gráficas mediante WebSocket.

---

## 👥 Equipo y Hackathon
- **Software Full Stack & Arquitectura:** Factory Pulse Core
- **Hardware & Firmware IoT:** Nodos ESP32 con sensores optoacoplados y ambientales
- **Licencia:** MIT — Hackathon Industrial 2026
