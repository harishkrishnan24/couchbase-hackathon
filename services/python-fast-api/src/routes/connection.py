from fastapi import APIRouter
from pydantic import BaseModel

from simulation import engine

connection_router = APIRouter(prefix="/api", tags=["connection"])


class ConnectionBody(BaseModel):
    online: bool


@connection_router.post("/connection")
async def toggle_connection(body: ConnectionBody):
    if body.online and not engine.is_online:
        await engine.reload_edge_storage_from_server()
    engine.set_online(body.online)
    return {"ok": True}
