from fastapi import APIRouter
from pydantic import BaseModel

from simulation import engine

connection_router = APIRouter(prefix="/api", tags=["connection"])


class ConnectionBody(BaseModel):
    online: bool


@connection_router.post("/connection")
async def toggle_connection(body: ConnectionBody):
    engine.set_online(body.online)
    return {"ok": True}
