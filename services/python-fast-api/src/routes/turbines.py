from fastapi import APIRouter, HTTPException

from simulation import engine, TURBINE_COUNT

turbines_router = APIRouter(prefix="/api/turbines", tags=["turbines"])


def _validate_turbine(turbine_id: int) -> None:
    if turbine_id < 1 or turbine_id > TURBINE_COUNT:
        raise HTTPException(
            status_code=404,
            detail=f"Turbine {turbine_id} not found. Valid range: 1-{TURBINE_COUNT}",
        )


@turbines_router.post("/{turbine_id}/anomaly")
async def inject_anomaly(turbine_id: int):
    _validate_turbine(turbine_id)
    engine.inject_anomaly(turbine_id)
    return {"ok": True}


@turbines_router.delete("/{turbine_id}/anomaly")
async def clear_anomaly(turbine_id: int):
    _validate_turbine(turbine_id)
    engine.clear_anomaly(turbine_id)
    return {"ok": True}


@turbines_router.get("/{turbine_id}/history")
async def get_turbine_history(turbine_id: int):
    _validate_turbine(turbine_id)
    return engine.per_turbine_history.get(turbine_id, [])
