from typing import Dict, Any, Optional
from fastapi import APIRouter, Query, Body, HTTPException
from app.simulator.engine import simulator

router = APIRouter()

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
