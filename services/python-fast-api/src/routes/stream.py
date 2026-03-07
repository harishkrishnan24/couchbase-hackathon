import asyncio
import json

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

import db
from simulation import engine, EDGE_CAPACITY, CENTRAL_STORAGE_LIMIT

stream_router = APIRouter(prefix="/api", tags=["stream"])


async def _snapshot_data(request: Request) -> dict:
    """Current pipeline state for new SSE clients; edge/central from DB so persisted data is visible after restart.
    Edge = Edge Server (local DB) only. Central = Couchbase Server central scope only. Keys must match frontend applySnapshot.
    """
    db_ready = getattr(request.app.state, "db_ready", False)

    # Edge list: from Edge Server (persisted) when available; cap at EDGE_CAPACITY so UI matches buffer size
    try:
        edge_list = await db.edge_list_docs_async(limit=150)
        edge_list = edge_list[-EDGE_CAPACITY:]  # most recent only
    except Exception:
        edge_list = list(engine.edge_storage)

    # Central list: from Couchbase Server when db_ready; otherwise in-memory engine fallback (never edge data; never use edge_list here)
    try:
        if db_ready:
            central_list = await db.central_list_storage_async(limit=CENTRAL_STORAGE_LIMIT)
        else:
            central_list = list(engine.central_storage)
    except Exception:
        central_list = list(engine.central_storage)

    # Return independent copies so edge and central are never the same reference or content mix-up
    edge_payload = list(edge_list)
    central_payload = list(central_list)
    return {
        "edgeStorage": edge_payload,
        "centralStorage": central_payload,
        "metrics": engine.get_metrics_dict(),
        "systemStatus": engine.get_status_dict(),
        "compactionLogs": engine.compaction_logs,
        "compactionCount": engine.compaction_count,
    }


@stream_router.get("/stream/events")
async def event_stream(request: Request):
    queue = engine.subscribe()

    async def generate():
        try:
            # Send initial snapshot (DB-backed) so client sees persisted edge/central after refresh or restart
            snapshot = await _snapshot_data(request)
            yield f"event: snapshot\ndata: {json.dumps(snapshot)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            engine.unsubscribe(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
