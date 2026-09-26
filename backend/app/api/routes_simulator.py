from typing import Dict, Any, Optional
from fastapi import APIRouter, Query, Body, HTTPException
from app.simulator.engine import simulator

router = APIRouter()

@router.get("/system/mode")
async def get_system_mode():
    from app.live.replay import replayer
    return {"mode": simulator.mode, "simulator_running": simulator.is_running, "playback": replayer.status()}


@router.put("/system/mode")
async def set_system_mode(mode: str = Query(..., pattern="^(demo|live)$")):
    """
    demo: el simulador genera datos de ejemplo.
    live: se detiene el simulador y solo cuentan los datos de dispositivos reales.
    Cualquiera de los dos detiene una reproducción en curso.
    """
    from app.live.replay import replayer
    replayer.stop()
    if mode == "live":
        simulator.pause()
        simulator.mode = "live"
        # El estado que dejó el simulador no describe la planta real: se desconoce
        # hasta que lleguen eventos de los dispositivos.
        from sqlalchemy import update
        from app.database import AsyncSessionLocal
        from app.models.db_models import DBStation
        async with AsyncSessionLocal() as session:
            await session.execute(update(DBStation).values(current_status="unknown"))
            await session.commit()
    else:
        simulator.mode = "demo"
        simulator.start(speed=simulator.speed)
    from app.ws.manager import ws_manager
    await ws_manager.broadcast({"type": "MODE_CHANGED", "mode": simulator.mode})
    return {"mode": simulator.mode, "simulator_running": simulator.is_running, "playback": replayer.status()}


@router.get("/simulator/status")
async def get_simulator_status():
    return {
        "is_running": simulator.is_running,
        "current_scene": simulator.current_scene,
        "speed": simulator.speed,
        "tick_count": simulator.tick_count,
        "sim_time": simulator.sim_time.isoformat(),
        "mode": simulator.mode
    }

@router.post("/simulator/start")
async def start_simulator(speed: float = Query(1.0, ge=0.1, le=10.0)):
    if simulator.mode == "live":
        raise HTTPException(status_code=409, detail="En modo En vivo el simulador está apagado; cambia a Demo para usarlo")
    simulator.start(speed=speed)
    return {"status": "started", "speed": simulator.speed, "scene": simulator.current_scene}

@router.post("/simulator/pause")
async def pause_simulator():
    simulator.pause()
    return {"status": "paused", "scene": simulator.current_scene}

@router.post("/simulator/reset")
async def reset_simulator(hard_reset_demo_only: bool = Query(True)):
    await simulator.reset(hard_reset_demo_only=hard_reset_demo_only)
    return {"status": "reset", "scene": 1}

@router.post("/simulator/scene")
async def set_simulator_scene(scene_number: int = Query(..., ge=1, le=8)):
    simulator.set_scene(scene_number)
    return {"status": "scene_changed", "current_scene": simulator.current_scene}

@router.post("/simulator/inject")
async def inject_simulated_event(event_data: Dict[str, Any] = Body(...)):
    """
    Manually inject an event from the UI simulation controls or external test script.
    """
    await simulator.inject_event(event_data)
    return {"status": "injected", "event_type": event_data.get("type")}
