from fastapi import APIRouter

from simulation import engine

storage_router = APIRouter(prefix="/api/storage", tags=["storage"])


@storage_router.get("/edge")
async def get_edge_storage():
    return engine.edge_storage


@storage_router.get("/central")
async def get_central_storage():
    return engine.central_storage
