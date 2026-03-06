"""
Couchbase persistence layer for EdgeGuard.

Edge writes go to Couchbase Edge Server via its REST API; the Edge Server
continuously replicates to Sync Gateway → Couchbase Server automatically.
Central reads still use the Couchbase SDK directly against the central scope.
All writes are fire-and-forget so they never block the async simulation loops.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from clients.couchbase.couchbase import CouchbaseClient, get_client, Keyspace

# ---------------------------------------------------------------------------
# Edge Server REST client — writes land here, Edge Server replicates onward
# ---------------------------------------------------------------------------

_ES_HOST     = os.environ.get("EDGE_SERVER_HOST", "couchbase-edge-server")
_ES_PORT     = os.environ.get("EDGE_SERVER_PORT", "59840")
_ES_DB       = os.environ.get("EDGE_SERVER_DB",   "main")
_ES_BASE_URL = f"http://{_ES_HOST}:{_ES_PORT}/{_ES_DB}"

_es_client: httpx.AsyncClient | None = None


def _get_es_client() -> httpx.AsyncClient:
    global _es_client
    if _es_client is None:
        _es_client = httpx.AsyncClient(timeout=5.0)
    return _es_client


# ---------------------------------------------------------------------------
# Central scope keyspace handles — populated on init_db()
# ---------------------------------------------------------------------------

_client: CouchbaseClient | None = None

central_readings:     Keyspace | None = None
central_anomalies:    Keyspace | None = None
central_compacted:    Keyspace | None = None
central_training:     Keyspace | None = None
central_model_state:  Keyspace | None = None

_initialized = False


def init_db() -> None:
    """Connect to Couchbase Server and open central-scope keyspace handles."""
    global _client, _initialized
    global central_readings, central_anomalies, central_compacted
    global central_training, central_model_state

    if _initialized:
        return

    _client = get_client("couchbase-server")

    # Central scope — synced from Edge Server via Sync Gateway → Couchbase Server
    central_readings    = _client.get_keyspace("readings",      scope_name="central")
    central_anomalies   = _client.get_keyspace("anomalies",     scope_name="central")
    central_compacted   = _client.get_keyspace("compacted",     scope_name="central")
    central_training    = _client.get_keyspace("training_data", scope_name="central")
    central_model_state = _client.get_keyspace("model_state",   scope_name="central")

    _initialized = True


# ---------------------------------------------------------------------------
# Edge Server helpers — write via REST API, replication to CB is automatic
# ---------------------------------------------------------------------------

async def edge_put_async(doc: dict, key: str) -> None:
    """PUT a document into the Edge Server; Edge Server replicates it to Sync Gateway."""
    try:
        client = _get_es_client()
        response = await client.put(f"{_ES_BASE_URL}/{key}", json=doc)
        if response.status_code not in (200, 201):
            _log_warn(f"Edge Server PUT failed ({key}): HTTP {response.status_code} — {response.text[:120]}")
    except Exception as e:
        _log_warn(f"Edge Server PUT failed ({key}): {e}")


# ---------------------------------------------------------------------------
# Async fire-and-forget helpers (central Couchbase SDK)
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
