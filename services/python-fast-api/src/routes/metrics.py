from fastapi import APIRouter

from simulation import engine

metrics_router = APIRouter(prefix="/api", tags=["metrics"])


@metrics_router.get("/metrics")
async def get_metrics():
    return engine.get_metrics_dict()
