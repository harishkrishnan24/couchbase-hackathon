"""
Couchbase persistence layer for EdgeGuard.

Initialises keyspace handles for edge and central scopes.
All writes are fire-and-forget via asyncio.to_thread so they never
block the async simulation loops.
"""

from __future__ import annotations

import asyncio
from typing import Any

from clients.couchbase.couchbase import CouchbaseClient, get_client, Keyspace

# ---------------------------------------------------------------------------
# Lazy keyspace handles — populated on init_db()
# ---------------------------------------------------------------------------

_client: CouchbaseClient | None = None

edge_readings:   Keyspace | None = None
edge_anomalies:  Keyspace | None = None
edge_compacted:  Keyspace | None = None

central_readings:     Keyspace | None = None
central_anomalies:    Keyspace | None = None
central_compacted:    Keyspace | None = None
central_training:     Keyspace | None = None
central_model_state:  Keyspace | None = None

_initialized = False


def init_db() -> None:
    """Connect to Couchbase and open all keyspace handles."""
    global _client, _initialized
    global edge_readings, edge_anomalies, edge_compacted
    global central_readings, central_anomalies, central_compacted
    global central_training, central_model_state

    if _initialized:
        return

    _client = get_client("couchbase-server")

    # Edge scope — simulates Couchbase Lite on the edge device
    edge_readings  = _client.get_keyspace("readings",  scope_name="edge")
    edge_anomalies = _client.get_keyspace("anomalies", scope_name="edge")
    edge_compacted = _client.get_keyspace("compacted", scope_name="edge")

    # Central scope — managed by Couchbase Server, synced via Sync Gateway
    central_readings    = _client.get_keyspace("readings",      scope_name="central")
    central_anomalies   = _client.get_keyspace("anomalies",     scope_name="central")
    central_compacted   = _client.get_keyspace("compacted",     scope_name="central")
    central_training    = _client.get_keyspace("training_data", scope_name="central")
    central_model_state = _client.get_keyspace("model_state",   scope_name="central")

    _initialized = True


# ---------------------------------------------------------------------------
# Async fire-and-forget helpers
# ---------------------------------------------------------------------------

async def _run_in_thread(fn, *args, **kwargs) -> Any:
    """Run a blocking Couchbase call in a thread pool without blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


async def insert_async(ks: Keyspace | None, doc: dict, key: str | None = None) -> None:
    if ks is None:
        return
    try:
        await _run_in_thread(ks.insert, doc, key)
    except Exception as e:
        _log_warn(f"CB insert failed ({ks.collection_name}): {e}")


async def remove_async(ks: Keyspace | None, key: str) -> None:
    if ks is None:
        return
    try:
        await _run_in_thread(ks.remove, key)
    except Exception as e:
        _log_warn(f"CB remove failed ({ks.collection_name}): {e}")


async def upsert_async(ks: Keyspace | None, key: str, doc: dict) -> None:
    """Insert or replace a document by known key."""
    if ks is None:
        return
    try:
        collection = await _run_in_thread(ks.get_collection)
        await _run_in_thread(collection.upsert, key, doc)
    except Exception as e:
        _log_warn(f"CB upsert failed ({ks.collection_name}): {e}")


async def list_async(ks: Keyspace | None, limit: int = 100) -> list[dict]:
    if ks is None:
        return []
    try:
        rows = await _run_in_thread(ks.list, limit)
        return rows
    except Exception as e:
        _log_warn(f"CB list failed ({ks.collection_name}): {e}")
        return []


async def count_async(ks: Keyspace | None) -> int:
    if ks is None:
        return 0
    try:
        rows = await _run_in_thread(
            ks.query,
            f"SELECT COUNT(*) AS c FROM ${{keyspace}}",
        )
        return rows[0].get("c", 0) if rows else 0
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Training data helpers
# ---------------------------------------------------------------------------

async def seed_training_data_if_empty(samples: list[dict]) -> bool:
    """
    Write training samples to central.training_data if the collection is empty.
    Returns True if seeding was performed.
    """
    if central_training is None:
        return False
    try:
        n = await count_async(central_training)
        if n > 0:
            return False
        for i, sample in enumerate(samples):
            doc = {"features": sample, "source": "generated", "seq": i}
            await insert_async(central_training, doc, key=f"train_{i}")
        return True
    except Exception as e:
        _log_warn(f"Seed training data failed: {e}")
        return False


async def save_model_state(state_dict: dict) -> None:
    """Persist Isolation Forest metadata to central.model_state."""
    await upsert_async(central_model_state, "current_model", state_dict)


async def load_model_state() -> dict | None:
    """Load Isolation Forest metadata from central.model_state."""
    if central_model_state is None:
        return None
    try:
        collection = await _run_in_thread(central_model_state.get_collection)
        result = await _run_in_thread(collection.get, "current_model")
        return result.content_as[dict]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _log_warn(msg: str) -> None:
    import logging
    logging.getLogger(__name__).warning(msg)
