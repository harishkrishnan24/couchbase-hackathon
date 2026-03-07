from fastapi import APIRouter

import db
from simulation import engine, EDGE_CAPACITY, CENTRAL_STORAGE_LIMIT

storage_router = APIRouter(prefix="/api/storage", tags=["storage"])


# Edge only — do not return central data.
@storage_router.get("/edge")
async def get_edge_storage():
    """Return edge storage from Edge Server (persisted), capped at EDGE_CAPACITY. Fallback to in-memory if Edge Server unreachable."""
    try:
        docs = await db.edge_list_docs_async(limit=100)
        return docs[-EDGE_CAPACITY:]  # most recent only, match buffer size
    except Exception:
        return engine.edge_storage


@storage_router.post("/edge/clear")
async def clear_edge_storage():
    """Clear in-memory edge buffer and all documents on Edge Server; connected clients get updated via SSE."""
    await engine.clear_edge_storage()
    return {"ok": True}


@storage_router.post("/central/clear")
async def clear_central_storage():
    """Clear in-memory central buffer and all documents in Couchbase Server central scope (readings, anomalies, compacted)."""
    await engine.clear_central_storage()
    return {"ok": True}


@storage_router.post("/clear")
async def clear_all_storage():
    """Clear both edge and central (in-memory and persisted)."""
    await engine.clear_all_storage()
    return {"ok": True}


# Central only — do not return edge data.
@storage_router.get("/central")
async def get_central_storage():
    """Return central storage from Couchbase Server (persisted). Fallback to in-memory if DB unreachable."""
    try:
        return await db.central_list_storage_async(limit=CENTRAL_STORAGE_LIMIT)
    except Exception:
        return engine.central_storage
