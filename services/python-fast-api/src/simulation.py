"""
EdgeGuard simulation engine.

Generates realistic multi-feature wind-turbine sensor data, scores it with
Isolation Forest, persists to Couchbase Edge Server via REST API, and lets
Edge Server replicate continuously to Sync Gateway → Couchbase Server.
"""

from __future__ import annotations

import asyncio
import math
import os
import time
from typing import Any

import db
from anomaly_detector import (
    detector,
    generate_normal_point,
    generate_anomalous_point,
)
from models.edgeguard import (
    CompactedBlock,
    CompactionLogEntry,
    DataPoint,
    Metrics,
    SensorData,
    SystemConfig,
    SystemStatus,
)

EDGE_CAPACITY = 25
COMPACTION_THRESHOLD = 20
CENTRAL_STORAGE_LIMIT = 30  # max items returned by GET /api/storage/central and snapshot
TURBINE_COUNT = 3
EMIT_INTERVAL_MS = 1400
DRAIN_INTERVAL_MS = 600   # run more often so UI sees smaller, more frequent updates
DRAIN_BATCH_SIZE = 5     # max items per drain run — smaller batches are easier to follow
TURBINE_HISTORY_SIZE = 30
TIER1_WINDOW_SIZE = 5
TIER2_MERGE_COUNT = 4


# ---------------------------------------------------------------------------
# Compaction helpers
# ---------------------------------------------------------------------------

def _std_dev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    sq = sum((v - mean) ** 2 for v in values)
    return math.sqrt(sq / (len(values) - 1))


def _merge_mixed_run(items: list[DataPoint | CompactedBlock]) -> CompactedBlock:
    """Merges a mixed run of DataPoints and CompactedBlocks into a single continuously growing block."""
    total_count = sum(getattr(item, 'count', 1) for item in items)
    weighted_val = sum(item.value * getattr(item, 'count', 1) for item in items) / total_count
    
    weighted_anomaly = sum(
        getattr(item, 'anomaly_score', getattr(item, 'avg_anomaly_score', 0.0)) * getattr(item, 'count', 1)
        for item in items
    ) / total_count
    
    sensors_merged = SensorData(
        vibration=sum(item.sensors.vibration * getattr(item, 'count', 1) for item in items) / total_count,
        temperature=sum(item.sensors.temperature * getattr(item, 'count', 1) for item in items) / total_count,
        rpm=sum(item.sensors.rpm * getattr(item, 'count', 1) for item in items) / total_count,
        power_output=sum(item.sensors.power_output * getattr(item, 'count', 1) for item in items) / total_count,
        wind_speed=sum(item.sensors.wind_speed * getattr(item, 'count', 1) for item in items) / total_count,
        blade_pitch=sum(item.sensors.blade_pitch * getattr(item, 'count', 1) for item in items) / total_count,
    )
    ts_merged = sum(item.timestamp * getattr(item, 'count', 1) for item in items) // total_count
    
    all_seqs: list[int] = []
    all_mins: list[float] = []
    all_maxes: list[float] = []
    
    for item in items:
        if isinstance(item, CompactedBlock):
            parts = item.range.split("-")
            all_seqs.extend(int(s) for s in parts)
            all_mins.append(item.min_value)
            all_maxes.append(item.max_value)
        else:
            all_seqs.append(item.seq)
            all_mins.append(item.value)
            all_maxes.append(item.value)
            
    std_dev_approx = max((getattr(item, 'std_dev', 0.0) for item in items), default=0.0)
    if std_dev_approx == 0.0 and all(isinstance(item, DataPoint) for item in items):
        std_dev_approx = _std_dev([p.value for p in items])
        
    return CompactedBlock(
        id="",
        seq=min(all_seqs),
        sourceTurbine=items[0].source_turbine,
        sensors=sensors_merged,
        value=weighted_val,
        timestamp=ts_merged,
        range=f"{min(all_seqs)}-{max(all_seqs)}",
        tier=1,
        count=total_count,
        avgValue=weighted_val,
        minValue=min(all_mins),
        maxValue=max(all_maxes),
        stdDev=std_dev_approx,
        avgAnomalyScore=weighted_anomaly,
    )


def _compute_pressure(edge_length: int) -> float:
    half = COMPACTION_THRESHOLD * 0.5
    if edge_length <= half:
        return 0.0
    return min(1.0, (edge_length - half) / (EDGE_CAPACITY - half))


def _classify_edge_item(item: dict[str, Any]) -> str:
    """Classify an edge buffer item as 'anomaly', 'compacted', or 'normal'. Used by compaction and eviction."""
    if item.get("type") == "compacted" or "tier" in item:
        return "compacted"
    if "anomalyScore" in item:
        try:
            dp = DataPoint.model_validate(item)
            return "anomaly" if dp.type == "anomaly" else "normal"
        except Exception:
            return "normal"
    return "anomaly"  # legacy shape without anomalyScore


# ---------------------------------------------------------------------------
# SimulationEngine
# ---------------------------------------------------------------------------

class SimulationEngine:
    """Owns all pipeline state and runs background emit / drain loops."""

    def __init__(self) -> None:
        self.edge_storage:       list[dict[str, Any]] = []
        self.central_storage:    list[dict[str, Any]] = []
        self.per_turbine_history: dict[int, list[dict[str, Any]]] = {
            i: [] for i in range(1, TURBINE_COUNT + 1)
        }
        self.sequence_number:       int  = 1000
        self.is_online:             bool = True
        self.is_running:            bool = False
        self.is_initialized:        bool = False
        self.is_compacting:         bool = False
        self.is_clearing:           bool = False
        self.compaction_count:      int  = 0
        self.compaction_logs:       list[dict[str, Any]] = []
        self.total_packets_emitted: int  = 0
        self.total_anomalies:       int  = 0
        self.last_sync_timestamp:   int | None = None
        self.edge_pressure:         float = 0.0
        self.forced_anomaly_turbine: int | None = None
        self.anomaly_burst_left:    int  = 0
        self._next_turbine_index:   int  = 0  # round-robin: 0, 1, 2 → turbine 1, 2, 3
        self.enabled_turbines:     set[int] = set()  # default: all turbines off
        self._enabled_index:       int  = 0  # round-robin over enabled_turbines only

        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._emit_task:   asyncio.Task[None] | None = None
        self._drain_task:  asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Pub/sub for SSE
    # ------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def _publish(self, event_type: str, data: Any) -> None:
        payload = {"type": event_type, "data": data}
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)

    # ------------------------------------------------------------------
    # Data generation
    # ------------------------------------------------------------------

    def _next_seq(self) -> int:
        self.sequence_number += 1
        return self.sequence_number

    def _generate_point(self) -> DataPoint | None:
        enabled_list = sorted(self.enabled_turbines)
        if not enabled_list:
            return None
        source_turbine = enabled_list[self._enabled_index % len(enabled_list)]
        self._enabled_index += 1

        seq = self._next_seq()
        force_anomaly = (
            source_turbine == self.forced_anomaly_turbine
            and self.forced_anomaly_turbine is not None
            and self.anomaly_burst_left > 0
        )
        if force_anomaly:
            sensor_dict = generate_anomalous_point(source_turbine, seq)
            self.anomaly_burst_left -= 1
            if self.anomaly_burst_left <= 0:
                self.forced_anomaly_turbine = None
        else:
            sensor_dict = generate_normal_point(source_turbine, seq)

        sensors = SensorData.model_validate(sensor_dict)
        anomaly_score, label = detector.score(sensors)

        return DataPoint(
            id=f"seq_{seq}",
            seq=seq,
            sourceTurbine=source_turbine,
            sensors=sensors,
            value=sensors.power_output,
            anomalyScore=anomaly_score,
            type=label,
            timestamp=_now_ms(),
        )

    # ------------------------------------------------------------------
    # Compaction
    # ------------------------------------------------------------------

    async def _compact(self) -> None:
        """Consecutive-run compaction: replace each run of 2+ normals with one block. Anomalies and compacted break runs.
        Originals are deleted from Edge Server before the compacted block is written, so replication never sees both."""
        if self.is_online or len(self.edge_storage) <= COMPACTION_THRESHOLD:
            return

        if self.is_compacting or self.is_clearing:
            return

        self.is_compacting = True
        try:
            await self._run_compaction()
        finally:
            self.is_compacting = False

    async def _run_compaction(self) -> None:
        new_edge: list[dict[str, Any]] = []
        run: list[DataPoint | CompactedBlock] = []
        log_parts: list[str] = []
        compact_actions: list[tuple[list[DataPoint | CompactedBlock], dict]] = []
        base_ts = _now_ms()
        block_idx = 0

        def flush_run() -> None:
            nonlocal block_idx
            if not run:
                return
            
            total_count = sum(getattr(item, 'count', 1) for item in run)
            if total_count >= 2:
                block = _merge_mixed_run(run)
                d = block.model_dump(by_alias=True)
                d["id"] = f"compact_{base_ts}_{block_idx}"
                block_idx += 1
                new_edge.append(d)
                log_parts.append(f"[{block.range}]")
                compact_actions.append((list(run), d))
            elif len(run) == 1:
                new_edge.append(run[0].model_dump(by_alias=True))

        for item in self.edge_storage:
            kind = _classify_edge_item(item)
            if kind == "normal":
                try:
                    run.append(DataPoint.model_validate(item))
                except Exception:
                    flush_run()
                    run = []
                    new_edge.append(item)
            elif kind == "compacted":
                try:
                    run.append(CompactedBlock.model_validate(item))
                except Exception:
                    flush_run()
                    run = []
                    new_edge.append(item)
            else:
                flush_run()
                run = []
                new_edge.append(item)

        flush_run()

        if not log_parts:
            return

        # Delete originals from Edge first, then persist compacted block (so replication never sees both).
        for run_items, block_dict in compact_actions:
            await asyncio.gather(*[db.edge_delete_async(p.id, "central.data") for p in run_items if p.id])
            await self._persist_compacted(block_dict)

        log_entry = CompactionLogEntry(
            message=(
                f"CONSECUTIVE RUNS {' '.join(log_parts)} | "
                f"{block_idx} blocks"
            ),
            timestamp=_now_ms(),
            severity="compaction",
        )
        self.edge_storage = new_edge
        self.compaction_count += 1
        self.compaction_logs.append(log_entry.model_dump(by_alias=True))
        self.edge_pressure = _compute_pressure(len(new_edge))
        self._publish_compaction(log_entry)

    def _drop_oldest_normal_once(self) -> dict[str, Any] | None:
        """Remove the first normal item from edge_storage. Return the removed item (for Edge delete), or None if none."""
        for i, item in enumerate(self.edge_storage):
            if _classify_edge_item(item) == "normal":
                self.edge_storage.pop(i)
                self.edge_pressure = _compute_pressure(len(self.edge_storage))
                return item
        return None

    def _publish_compaction(self, log_entry: CompactionLogEntry) -> None:
        self._publish("compaction", {
            "log": log_entry.model_dump(by_alias=True),
            "edgeStorage": self.edge_storage,
            "compactionCount": self.compaction_count,
        })
        self._publish_metrics()

    # ------------------------------------------------------------------
    # Couchbase / Sync Gateway persistence helpers
    # ------------------------------------------------------------------

    async def _persist_edge_reading(self, point_dict: dict, key: str) -> None:
        """Write reading to Edge Server (central.data); doc has type field."""
        await db.edge_put_async(point_dict, key, keyspace="central.data")

    async def _persist_edge_anomaly(self, point_dict: dict, key: str) -> None:
        """Write anomaly to Edge Server (central.data); doc has type field."""
        await db.edge_put_async(point_dict, key, keyspace="central.data")

    async def _persist_compacted(self, block_dict: dict) -> None:
        """Write compacted block to Edge Server (central.data); doc has type field."""
        key = block_dict.get("id") or f"compact_{_now_ms()}"
        await db.edge_put_async(block_dict, key, keyspace="central.data")

    # ------------------------------------------------------------------
    # Emit loop
    # ------------------------------------------------------------------

    async def _emit_loop(self) -> None:
        interval = EMIT_INTERVAL_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            if not self.is_running or self.is_clearing:
                continue

            point = self._generate_point()
            if point is None:
                continue
            point_dict = point.model_dump(by_alias=True)

            # Per-turbine history (in-memory for fast SSE)
            hist = self.per_turbine_history.get(point.source_turbine, [])
            hist.append(point_dict)
            if len(hist) > TURBINE_HISTORY_SIZE:
                hist = hist[-TURBINE_HISTORY_SIZE:]
            self.per_turbine_history[point.source_turbine] = hist

            self.total_packets_emitted += 1
            if point.type == "anomaly":
                self.total_anomalies += 1

            self._publish("telemetry", point_dict)

            # Make room when at cap: compact then evict until under EDGE_CAPACITY. If online, temporarily turn sync off.
            if len(self.edge_storage) >= EDGE_CAPACITY:
                was_online = self.is_online
                if was_online:
                    self.set_online(False)
                max_compact_rounds = 20
                for _ in range(max_compact_rounds):
                    if len(self.edge_storage) < EDGE_CAPACITY:
                        break
                    prev_len = len(self.edge_storage)
                    await self._compact()
                    if len(self.edge_storage) >= prev_len:
                        break
                while len(self.edge_storage) >= EDGE_CAPACITY:
                    evicted = self._drop_oldest_normal_once()
                    if evicted is None:
                        break
                    doc_id = evicted.get("id")
                    if doc_id:
                        asyncio.create_task(db.edge_delete_async(doc_id, "central.data"))
                if was_online:
                    self.set_online(True)

            self.edge_storage.append(point_dict)
            self.edge_pressure = _compute_pressure(len(self.edge_storage))

            self._publish("edge_update", {
                "item":          point_dict,
                "storageLength": len(self.edge_storage),
                "pressure":      self.edge_pressure,
            })
            self._publish_metrics()

            if self.sequence_number % 20 == 0:
                asyncio.create_task(db.save_pipeline_state({"sequence_number": self.sequence_number}))

            # Persist to Edge Server via REST API (non-blocking)
            asyncio.create_task(self._persist_edge_reading(point_dict, point.id))
            if point.type == "anomaly":
                asyncio.create_task(self._persist_edge_anomaly(point_dict, point.id))

            # Compaction when over threshold; if online, temporarily turn sync off so we don't race with drain.
            if len(self.edge_storage) > COMPACTION_THRESHOLD:
                was_online = self.is_online
                if was_online:
                    self.set_online(False)
                max_compact_rounds = 20
                for _ in range(max_compact_rounds):
                    if len(self.edge_storage) <= COMPACTION_THRESHOLD:
                        break
                    prev_len = len(self.edge_storage)
                    await self._compact()
                    if len(self.edge_storage) >= prev_len:
                        break
                if was_online:
                    self.set_online(True)

    # ------------------------------------------------------------------
    # Drain loop — edge → Sync Gateway → central
    # ------------------------------------------------------------------

    async def _drain_loop(self) -> None:
        interval = DRAIN_INTERVAL_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            if not self.is_running or not self.is_online or self.is_compacting or self.is_clearing:
                continue
            if not self.edge_storage:
                continue

            # If we just came online and we are over threshold, force a compaction.
            if len(self.edge_storage) > COMPACTION_THRESHOLD:
                # Temporarily turn offline to allow _compact to run
                self.set_online(False)
                # Need to use the _compact directly since it requires self.is_online to be False
                try:
                    max_compact_rounds = 20
                    for _ in range(max_compact_rounds):
                        if len(self.edge_storage) <= COMPACTION_THRESHOLD:
                            break
                        prev_len = len(self.edge_storage)
                        await self._compact()
                        if len(self.edge_storage) >= prev_len:
                            break
                finally:
                    self.set_online(True)
                continue  # Let the next cycle handle the drain if ready

            drained = 0
            while drained < DRAIN_BATCH_SIZE and self.edge_storage:
                item = self.edge_storage.pop(0)
                ok = await db.upsert_drained_to_central_async(item)
                if not ok:
                    self.edge_storage.insert(0, item)
                    break
                doc_id = item.get("id")
                await db.edge_delete_async(doc_id, keyspace="central.data")

                self.edge_pressure = _compute_pressure(len(self.edge_storage))
                self.central_storage.append(item)
                self.last_sync_timestamp = _now_ms()

                self._publish("central_update", {
                    "item":              item,
                    "lastSyncTimestamp": self.last_sync_timestamp,
                })
                drained += 1

            if drained:
                self._publish_metrics()

    # ------------------------------------------------------------------
    # Metrics / status helpers
    # ------------------------------------------------------------------

    def _publish_metrics(self) -> None:
        self._publish("metrics", self.get_metrics_dict())

    def get_metrics_dict(self) -> dict[str, Any]:
        return Metrics(
            totalPacketsEmitted=self.total_packets_emitted,
            totalAnomalies=self.total_anomalies,
            edgePressure=self.edge_pressure,
            compactionCount=self.compaction_count,
            lastSyncTimestamp=self.last_sync_timestamp,
            edgeStorageLength=len(self.edge_storage),
            centralStorageLength=len(self.central_storage),
        ).model_dump(by_alias=True)

    def get_status_dict(self) -> dict[str, Any]:
        return SystemStatus(
            isRunning=self.is_running,
            isInitialized=self.is_initialized,
            isOnline=self.is_online,
            sequenceNumber=self.sequence_number,
            enabled_turbines=sorted(self.enabled_turbines),
        ).model_dump(by_alias=True)

    def get_config_dict(self) -> dict[str, Any]:
        return SystemConfig(
            edgeCapacity=EDGE_CAPACITY,
            compactionThreshold=COMPACTION_THRESHOLD,
            turbineCount=TURBINE_COUNT,
            emitIntervalMs=EMIT_INTERVAL_MS,
            drainIntervalMs=DRAIN_INTERVAL_MS,
        ).model_dump(by_alias=True)

    # ------------------------------------------------------------------
    # Public control methods
    # ------------------------------------------------------------------

    def initialize(self) -> None:
        self.is_initialized = True
        self._publish("system_status", self.get_status_dict())

    async def start(self) -> None:
        if self.is_running:
            return
        self.is_running = True
        self._emit_task  = asyncio.create_task(self._emit_loop())
        self._drain_task = asyncio.create_task(self._drain_loop())
        self._publish("system_status", self.get_status_dict())

    async def stop(self) -> None:
        if not self.is_running:
            return
        self.is_running = False
        if self._emit_task:
            self._emit_task.cancel()
            self._emit_task = None
        if self._drain_task:
            self._drain_task.cancel()
            self._drain_task = None
        await db.save_pipeline_state({"sequence_number": self.sequence_number})
        self._publish("system_status", self.get_status_dict())

    async def reload_edge_storage_from_server(self) -> None:
        """Reload edge_storage from Edge Server so drain loop can sync pending data (e.g. after reconnect or restart)."""
        try:
            docs = await db.edge_list_docs_async(limit=200)
            self.edge_storage = list(docs)
            self.edge_pressure = _compute_pressure(len(self.edge_storage))
            # Trim to cap if over EDGE_CAPACITY (we're still offline when this runs, before set_online(True))
            if len(self.edge_storage) > EDGE_CAPACITY:
                max_compact_rounds = 20
                for _ in range(max_compact_rounds):
                    if len(self.edge_storage) <= COMPACTION_THRESHOLD:
                        break
                    prev_len = len(self.edge_storage)
                    await self._compact()
                    if len(self.edge_storage) >= prev_len:
                        break
                while len(self.edge_storage) >= EDGE_CAPACITY:
                    evicted = self._drop_oldest_normal_once()
                    if evicted is None:
                        break
                    doc_id = evicted.get("id")
                    if doc_id:
                        await db.edge_delete_async(doc_id, "central.data")
            self._publish("compaction", {
                "log": CompactionLogEntry(
                    message="EDGE BUFFER RELOADED FROM SERVER",
                    timestamp=_now_ms(),
                    severity="sync",
                ).model_dump(by_alias=True),
                "edgeStorage": self.edge_storage,
                "compactionCount": self.compaction_count,
            })
            self._publish_metrics()
        except Exception:
            pass

    def set_online(self, online: bool) -> None:
        was_offline = not self.is_online
        self.is_online = online

        if was_offline and online:
            self.compaction_logs.append(
                CompactionLogEntry(
                    message="CONNECTION RESTORED — SYNCING EDGE BUFFER",
                    timestamp=_now_ms(),
                    severity="sync",
                ).model_dump(by_alias=True)
            )
        elif not online:
            self.compaction_logs.append(
                CompactionLogEntry(
                    message="CONNECTION LOST — EDGE ISOLATION MODE",
                    timestamp=_now_ms(),
                    severity="warning",
                ).model_dump(by_alias=True)
            )

        self._publish("system_status", self.get_status_dict())

    def inject_anomaly(self, turbine_id: int) -> None:
        self.forced_anomaly_turbine = turbine_id
        self.anomaly_burst_left = 8  # slightly longer burst so IF has more data

    def clear_anomaly(self, turbine_id: int) -> None:
        if self.forced_anomaly_turbine == turbine_id:
            self.forced_anomaly_turbine = None
            self.anomaly_burst_left = 0

    def set_turbine_enabled(self, turbine_id: int, enabled: bool) -> None:
        if enabled:
            self.enabled_turbines.add(turbine_id)
        else:
            self.enabled_turbines.discard(turbine_id)
            if self.forced_anomaly_turbine == turbine_id:
                self.forced_anomaly_turbine = None
                self.anomaly_burst_left = 0
        self._enabled_index = self._enabled_index % max(1, len(self.enabled_turbines))
        self._publish("system_status", self.get_status_dict())

    async def clear_edge_storage(self) -> None:
        """Delete all docs from Edge Server first (so replication does not sync them to central), then clear in-memory and notify clients."""
        self.is_clearing = True
        try:
            await db.edge_clear_all_async()
            self.edge_storage.clear()
            self.edge_pressure = _compute_pressure(0)
            log_entry = CompactionLogEntry(
                message="EDGE STORAGE CLEARED",
                timestamp=_now_ms(),
                severity="info",
            ).model_dump(by_alias=True)
            self.compaction_logs.append(log_entry)
            self._publish("compaction", {
                "log": log_entry,
                "edgeStorage": [],
                "compactionCount": self.compaction_count,
            })
            self._publish_metrics()
        finally:
            self.is_clearing = False

    async def clear_central_storage(self) -> None:
        """Delete all docs from Couchbase Server central first, then clear in-memory buffer (readings, anomalies, compacted)."""
        self.is_clearing = True
        try:
            await db.central_clear_all_async()
            self.central_storage.clear()
        finally:
            self.is_clearing = False

    async def clear_all_storage(self) -> None:
        """Stop simulation, clear both edge and central (in-memory and persisted), then reset sequence_number and stats."""
        if self.is_running:
            await self.stop()
        
        self.is_clearing = True
        try:
            await db.edge_clear_all_async()
            self.edge_storage.clear()
            self.edge_pressure = _compute_pressure(0)
            
            await db.central_clear_all_async()
            self.central_storage.clear()
            
            self.sequence_number = 1000
            await db.save_pipeline_state({"sequence_number": self.sequence_number})
            
            self.per_turbine_history = {
                i: [] for i in range(1, TURBINE_COUNT + 1)
            }
            self.compaction_count = 0
            self.compaction_logs.clear()
            self.total_packets_emitted = 0
            self.total_anomalies = 0
            self.last_sync_timestamp = None
            self.forced_anomaly_turbine = None
            self.anomaly_burst_left = 0
            
            self._publish("system_status", self.get_status_dict())
            self._publish_metrics()
        finally:
            self.is_clearing = False


def _now_ms() -> int:
    return int(time.time() * 1000)


# Module-level singleton
engine = SimulationEngine()
