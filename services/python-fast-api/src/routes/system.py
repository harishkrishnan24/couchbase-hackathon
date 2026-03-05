from fastapi import APIRouter

from simulation import engine

system_router = APIRouter(prefix="/api/system", tags=["system"])


@system_router.get("/config")
async def get_config():
    return engine.get_config_dict()


@system_router.get("/status")
async def get_status():
    return engine.get_status_dict()


@system_router.post("/initialize")
async def initialize():
    engine.initialize()
    return {"ok": True}


@system_router.post("/start")
async def start_simulation():
    await engine.start()
    return {"ok": True}


@system_router.post("/stop")
async def stop_simulation():
    await engine.stop()
    return {"ok": True}
