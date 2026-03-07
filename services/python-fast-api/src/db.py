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
from urllib.parse import quote

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

central_data:         Keyspace | None = None  # Single collection: type = normal | anomaly | compacted
central_model_state:  Keyspace | None = None

_initialized = False


def init_db() -> None:
    """Connect to Couchbase Server and open central-scope keyspace handles."""
    global _client, _initialized
    global central_data, central_model_state

    if _initialized:
        return

    _client = get_client("couchbase-server")

    # Central scope — single collection for all pipeline items (type field)
    central_data        = _client.get_keyspace("data", scope_name="central")
    central_model_state = _client.get_keyspace("model_state", scope_name="central")

    _initialized = True


# ---------------------------------------------------------------------------
# Edge Server helpers — write via REST API, replication to CB is automatic
# ---------------------------------------------------------------------------

async def edge_put_async(doc: dict, key: str, *, keyspace: str | None = None) -> None:
    """PUT a document into the Edge Server; Edge Server replicates it to Sync Gateway.
    If keyspace is set (e.g. 'central.readings'), the document is written to that scope.collection.
    """
    try:
        client = _get_es_client()
        key_encoded = quote(key, safe="")
        if keyspace:
            url = f"{_ES_BASE_URL}.{keyspace}/{key_encoded}"
        else:
            url = f"{_ES_BASE_URL}/{key_encoded}"
        response = await client.put(url, json=doc)
        if response.status_code not in (200, 201):
            _log_warn(
                f"Edge Server PUT failed: {response.status_code} — {response.text[:200]} | URL: {url}"
            )
    except Exception as e:
        _log_warn(f"Edge Server PUT failed ({key}): {e}")


async def _edge_get_rev(key_encoded: str, keyspace: str, client: httpx.AsyncClient) -> str | None:
    """Fetch the latest revision ID for a document on the Edge Server."""
    url = f"{_ES_BASE_URL}.{keyspace}/{key_encoded}"
    try:
        response = await client.get(url)
        if response.status_code == 200:
            doc = response.json()
            return doc.get("_rev")
    except Exception:
        pass
    return None


async def edge_delete_async(key: str, keyspace: str) -> None:
    """DELETE a document from the Edge Server by key and keyspace (e.g. central.data). Requires fetching _rev."""
    try:
        client = _get_es_client()
        key_encoded = quote(key, safe="")
        
        # 1. Get current _rev (required for Couchbase Lite REST deletion)
        rev = await _edge_get_rev(key_encoded, keyspace, client)
        if not rev:
            return  # Probably already deleted or doesn't exist
            
        # 2. Issue DELETE with ?rev= parameter
        url = f"{_ES_BASE_URL}.{keyspace}/{key_encoded}?rev={quote(rev)}"
        response = await client.delete(url)
        if response.status_code not in (200, 204):
            _log_warn(
                f"Edge Server DELETE failed: {response.status_code} — {response.text[:200]} | URL: {url}"
            )
    except Exception as e:
        _log_warn(f"Edge Server DELETE failed ({key}): {e}")


async def _edge_delete_ignore_conflict(key: str, keyspace: str) -> None:
    """DELETE one doc from Edge Server; 404/409 are ignored (e.g. already deleted or conflict)."""
    try:
        client = _get_es_client()
        key_encoded = quote(key, safe="")
        
        rev = await _edge_get_rev(key_encoded, keyspace, client)
        if not rev:
            return
            
        url = f"{_ES_BASE_URL}.{keyspace}/{key_encoded}?rev={quote(rev)}"
        response = await client.delete(url)
        if response.status_code in (200, 204, 404, 409):
            return
        _log_warn(f"Edge Server DELETE unexpected: {response.status_code} — {response.text[:200]}")
    except Exception as e:
        _log_warn(f"Edge Server DELETE failed ({key}): {e}")


async def edge_list_docs_async(limit: int = 100, keyspace: str | None = None) -> list[dict]:
    """List documents from Edge Server REST API (single collection central.data). Returns sorted list for UI."""
    client = _get_es_client()
    ks = keyspace or "central.data"
    url = f"{_ES_BASE_URL}.{ks}/_all_docs"
    all_docs: list[dict] = []
    try:
        response = await client.post(
            url,
            json={"include_docs": True, "limit": limit},
        )
        if response.status_code != 200:
            _log_warn(
                f"Edge Server _all_docs failed: {response.status_code} — {response.text[:200]} | {url}"
            )
            return all_docs
        data = response.json()
        rows = data.get("rows") or []
        for row in rows:
            doc = None
            if isinstance(row.get("doc"), dict):
                doc = row["doc"]
            elif isinstance(row.get("value"), dict) and "doc" in row["value"]:
                doc = row["value"]["doc"]
            if not doc:
                continue
            doc_id = doc.get("id") or row.get("id") or row.get("key")
            if doc_id and "id" not in doc:
                doc = {**doc, "id": doc_id}
            all_docs.append(doc)
    except Exception as e:
        _log_warn(f"Edge Server _all_docs failed ({ks}): {e}")
    def _sort_key(d: dict) -> tuple[int, int]:
        ts = d.get("timestamp") or 0
        seq = d.get("seq") or 0
        return (ts, seq)
    all_docs.sort(key=_sort_key)
    return all_docs


async def _edge_list_doc_keys_async(keyspace: str, limit: int = 500) -> list[str]:
    """List document keys (ids) from Edge Server for a keyspace. Uses row key from _all_docs so delete uses the same key."""
    client = _get_es_client()
    url = f"{_ES_BASE_URL}.{keyspace}/_all_docs"
    keys: list[str] = []
    try:
        response = await client.post(
            url,
            json={"include_docs": False, "limit": limit},
        )
        if response.status_code != 200:
            _log_warn(f"Edge Server _all_docs (keys) failed: {response.status_code} — {response.text[:200]} | {url}")
            return keys
        data = response.json()
        rows = data.get("rows") or []
        for row in rows:
            doc_key = row.get("key") or row.get("id")
            if doc_key is not None:
                keys.append(str(doc_key))
    except Exception as e:
        _log_warn(f"Edge Server _all_docs (keys) failed ({keyspace}): {e}")
    return keys


async def _edge_list_id_rev_async(keyspace: str, limit: int = 500) -> list[tuple[str, str]]:
    """List document id and _rev from Edge Server for bulk delete. Returns [(id, rev), ...]; rev may be empty."""
    client = _get_es_client()
    url = f"{_ES_BASE_URL}.{keyspace}/_all_docs"
    out: list[tuple[str, str]] = []
    try:
        response = await client.post(
            url,
            json={"include_docs": True, "limit": limit},
        )
        if response.status_code != 200:
            return out
        data = response.json()
        rows = data.get("rows") or []
        for row in rows:
            doc_id = str(row.get("key") or row.get("id") or "")
            if not doc_id:
                continue
            rev = ""
            doc = row.get("doc") or (row.get("value") or {}).get("doc")
            if isinstance(doc, dict):
                rev = doc.get("_rev") or doc.get("rev") or ""
            if isinstance(row.get("value"), dict):
                rev = rev or row["value"].get("rev") or row["value"].get("_rev") or ""
            out.append((doc_id, rev))
    except Exception as e:
        _log_warn(f"Edge Server _all_docs (id/rev) failed ({keyspace}): {e}")
    return out


async def edge_clear_all_async() -> None:
    """Delete all documents from Edge Server (central.data). Uses one _bulk_docs request when revs available, else batched deletes (404/409 ignored)."""
    ks = "central.data"
    try:
        id_revs = await _edge_list_id_rev_async(ks, limit=500)
        if not id_revs:
            return
        client = _get_es_client()
        bulk_url = f"{_ES_BASE_URL}.{ks}/_bulk_docs"
        docs_with_rev = [(i, r) for i, r in id_revs if r]
        if docs_with_rev:
            body = {
                "docs": [
                    {"_id": doc_id, "_rev": rev, "_deleted": True}
                    for doc_id, rev in docs_with_rev
                ]
            }
            try:
                resp = await client.post(bulk_url, json=body)
                if resp.status_code in (200, 201):
                    return
            except Exception:
                pass
        doc_keys = [i for i, _ in id_revs]
        batch_size = 10
        for i in range(0, len(doc_keys), batch_size):
            batch = doc_keys[i : i + batch_size]
            await asyncio.gather(*[_edge_delete_ignore_conflict(k, ks) for k in batch])
    except Exception as e:
        _log_warn(f"edge_clear_all_async ({ks}): {e}")


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


def _normalize_central_row(row: dict, collection_name: str) -> dict:
    """Flatten N1QL row if Couchbase returned collection-named wrapper (e.g. readings: {...}); else return row as-is."""
    if not isinstance(row, dict):
        return row
    inner = row.get(collection_name)
    if isinstance(inner, dict):
        doc_id = row.get("id")
        out = {**inner}
        if doc_id is not None and "id" not in out:
            out["id"] = doc_id
        return out
    return row


async def upsert_drained_to_central_async(item: dict) -> bool:
    """Upsert a drained item to Couchbase Server central.data (single collection; item has type field). Returns True on success."""
    init_db()
    if central_data is None:
        return False
    key = item.get("id")
    if not key:
        _log_warn("upsert_drained_to_central_async: item has no id")
        return False
    try:
        await upsert_async(central_data, key, item)
        return True
    except Exception as e:
        _log_warn(f"upsert_drained_to_central_async failed ({key}): {e}")
        return False


async def central_list_storage_async(limit: int = 30) -> list[dict]:
    """List documents from Couchbase Server central.data only. Returns sorted list for UI (time series order)."""
    init_db()
    if central_data is None:
        return []
    rows = await list_async(central_data, limit=limit)
    all_docs = [_normalize_central_row(row, "data") for row in rows if isinstance(row, dict)]
    def _sort_key(d: dict) -> tuple[int, int]:
        ts = d.get("timestamp") or 0
        seq = d.get("seq") or 0
        return (ts, seq)
    all_docs.sort(key=_sort_key)
    return all_docs


def _central_delete_all_sync() -> None:
    """Run N1QL DELETE FROM keyspace in one bulk operation. Blocking."""
    init_db()
    if central_data is None:
        return
    central_data.query("DELETE FROM ${keyspace}")


async def central_clear_all_async() -> None:
    """Delete all documents from Couchbase Server central.data in one N1QL bulk delete. Does not touch model_state."""
    init_db()
    if central_data is None:
        return
    try:
        await _run_in_thread(_central_delete_all_sync)
    except Exception as e:
        _log_warn(f"central_clear_all_async (data): {e}")


# ---------------------------------------------------------------------------
# Model state helpers
# ---------------------------------------------------------------------------

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


async def save_pipeline_state(state_dict: dict) -> None:
    """Persist pipeline state (e.g. sequence_number) to central.model_state."""
    await upsert_async(central_model_state, "pipeline_state", state_dict)


async def load_pipeline_state() -> dict | None:
    """Load pipeline state from central.model_state. Returns None if missing."""
    if central_model_state is None:
        return None
    try:
        collection = await _run_in_thread(central_model_state.get_collection)
        result = await _run_in_thread(collection.get, "pipeline_state")
        return result.content_as[dict]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _log_warn(msg: str) -> None:
    import logging
    logging.getLogger(__name__).warning(msg)
