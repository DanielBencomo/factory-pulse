import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import init_db
from app.ws.manager import ws_manager
from app.mqtt.adapter import mqtt_adapter
from app.simulator.engine import simulator

from app.api.routes_health import router as health_router
from app.api.routes_events import router as events_router
from app.api.routes_metrics import router as metrics_router
from app.api.routes_floorplans import router as floorplans_router
from app.api.routes_zones import router as zones_router
from app.api.routes_stations import router as stations_router
from app.api.routes_stops import router as stops_router
from app.api.routes_devices import router as devices_router
from app.api.routes_dashboards import router as dashboards_router
from app.api.routes_alerts import router as alerts_router
from app.api.routes_simulator import router as simulator_router
from app.api.routes_modules import router as modules_router
from app.api.routes_export import router as export_router
from app.api.routes_layout import router as layout_router
from app.api.routes_tracks import router as tracks_router
from app.api.routes_analytics import router as analytics_router
from app.api.routes_signals import router as signals_router
from app.api.routes_recordings import router as recordings_router
from app.api.routes_rfid import router as rfid_router
from app.live.processor import live_processor
from app.live.replay import replayer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("factory_pulse")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Factory Pulse Database & Seeds...")
    await init_db()
    
    # Start MQTT Adapter (if enabled)
    mqtt_adapter.start()
    
    # Demo: el simulador alimenta el tablero. Live: se espera a los dispositivos reales.
    if settings.START_MODE == "live":
        simulator.mode = "live"
        logger.info("Modo EN VIVO: simulador apagado, esperando dispositivos")
    else:
        simulator.start(speed=settings.SIMULATOR_SPEED)
    # Procesa datos reales (en vivo / reproducción): posiciones, estados, reglas.
    live_processor.start()
    logger.info("Factory Pulse is ready and listening!")
    
    yield
    
    logger.info("Shutting down Factory Pulse...")
    simulator.pause()
    replayer.stop()
    live_processor.stop()
    mqtt_adapter.stop()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Plataforma Local de IoT y Análisis de Flujo Industrial para Maquiladora",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(health_router, prefix=settings.API_V1_STR, tags=["Health"])
app.include_router(events_router, prefix=settings.API_V1_STR, tags=["Events"])
app.include_router(metrics_router, prefix=settings.API_V1_STR, tags=["Metrics"])
app.include_router(floorplans_router, prefix=settings.API_V1_STR, tags=["FloorPlans"])
app.include_router(zones_router, prefix=settings.API_V1_STR, tags=["Zones"])
app.include_router(stations_router, prefix=settings.API_V1_STR, tags=["Stations"])
app.include_router(stops_router, prefix=settings.API_V1_STR, tags=["Stops"])
app.include_router(devices_router, prefix=settings.API_V1_STR, tags=["Devices"])
app.include_router(dashboards_router, prefix=settings.API_V1_STR, tags=["Dashboards"])
app.include_router(alerts_router, prefix=settings.API_V1_STR, tags=["Alerts"])
app.include_router(simulator_router, prefix=settings.API_V1_STR, tags=["Simulator"])
app.include_router(modules_router, prefix=settings.API_V1_STR, tags=["Modules"])
app.include_router(export_router, prefix=settings.API_V1_STR, tags=["Export"])
app.include_router(layout_router, prefix=settings.API_V1_STR, tags=["Layout"])
app.include_router(tracks_router, prefix=settings.API_V1_STR, tags=["Tracks"])
app.include_router(analytics_router, prefix=settings.API_V1_STR, tags=["Analytics"])
app.include_router(signals_router, prefix=settings.API_V1_STR, tags=["Signals"])
app.include_router(recordings_router, prefix=settings.API_V1_STR, tags=["Recordings"])
app.include_router(rfid_router, prefix=settings.API_V1_STR, tags=["RFID"])

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keepalive and client command receiver
            data = await websocket.receive_text()
            logger.debug(f"Received WS text from client: {data}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WS Exception: {e}")
        ws_manager.disconnect(websocket)

# Global Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled server error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Ocurrió un error interno en el servidor."}
    )
