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
TURBINE_COUNT = 3
EMIT_INTERVAL_MS = 1400
DRAIN_INTERVAL_MS = 1200
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


def _compact_window(points: list[DataPoint]) -> CompactedBlock:
    values = [p.value for p in points]
    seqs   = [p.seq  for p in points]
    return CompactedBlock(
        avgValue=sum(values) / len(values),
        minValue=min(values),
        maxValue=max(values),
        stdDev=_std_dev(values),
        count=len(points),
        range=f"{min(seqs)}-{max(seqs)}",
        tier=1,
    )


def _merge_tier1_blocks(blocks: list[CompactedBlock]) -> CompactedBlock:
    total_count  = sum(b.count for b in blocks)
    weighted_avg = sum(b.avg_value * b.count for b in blocks) / total_count
    all_seqs: list[int] = []
    for b in blocks:
        parts = b.range.split("-")
        all_seqs.extend(int(s) for s in parts)
    return CompactedBlock(
        avgValue=weighted_avg,
        minValue=min(b.min_value for b in blocks),
        maxValue=max(b.max_value for b in blocks),
        stdDev=max(b.std_dev for b in blocks),
        count=total_count,
        range=f"{min(all_seqs)}-{max(all_seqs)}",
        tier=2,
    )


def _compute_pressure(edge_length: int) -> float:
    half = COMPACTION_THRESHOLD * 0.5
    if edge_length <= half:
        return 0.0
    return min(1.0, (edge_length - half) / (EDGE_CAPACITY - half))


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
        self.compaction_count:      int  = 0
        self.compaction_logs:       list[dict[str, Any]] = []
        self.total_packets_emitted: int  = 0
        self.total_anomalies:       int  = 0
        self.last_sync_timestamp:   int | None = None
        self.edge_pressure:         float = 0.0
        self.forced_anomaly_turbine: int | None = None
        self.anomaly_burst_left:    int  = 0

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

    def _generate_point(self) -> DataPoint:
        seq = self._next_seq()
        force_anomaly = (
            self.forced_anomaly_turbine is not None
            and self.anomaly_burst_left > 0
        )
        source_turbine = (
            self.forced_anomaly_turbine
            if self.forced_anomaly_turbine is not None
            else (seq % TURBINE_COUNT) + 1
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

    def _compact(self) -> None:
        if self.is_online or len(self.edge_storage) <= COMPACTION_THRESHOLD:
            return

        anomalies:          list[dict[str, Any]] = []
        existing_compacted: list[CompactedBlock] = []
        normals:            list[DataPoint]      = []

        for item in self.edge_storage:
            if item.get("type") == "compacted":
                existing_compacted.append(CompactedBlock.model_validate(item))
            elif "anomalyScore" in item:
                dp = DataPoint.model_validate(item)
                if dp.type == "anomaly":
                    anomalies.append(item)
                else:
                    normals.append(dp)
            else:
                anomalies.append(item)

        if len(normals) < TIER1_WINDOW_SIZE:
            tier1 = [b for b in existing_compacted if b.tier == 1]
            tier2 = [b for b in existing_compacted if b.tier == 2]
            if len(tier1) >= TIER2_MERGE_COUNT:
                to_merge  = tier1[:TIER2_MERGE_COUNT]
                remaining = tier1[TIER2_MERGE_COUNT:]
                merged = _merge_tier1_blocks(to_merge)
                new_edge = (
                    anomalies
                    + [b.model_dump(by_alias=True) for b in tier2]
                    + [b.model_dump(by_alias=True) for b in remaining]
                    + [dp.model_dump(by_alias=True) for dp in normals]
                    + [merged.model_dump(by_alias=True)]
                )
                log_entry = CompactionLogEntry(
                    message=(
                        f"T2 MERGE {len(to_merge)} blocks → 1 | "
                        f"SEQ {merged.range} | {merged.count} pts | "
                        f"AVG {merged.avg_value:.1f}"
                    ),
                    timestamp=_now_ms(),
                    severity="compaction",
                )
                self.edge_storage = new_edge
                self.compaction_count += 1
                self.compaction_logs.append(log_entry.model_dump(by_alias=True))
                self.edge_pressure = _compute_pressure(len(new_edge))
                self._publish_compaction(log_entry)
                # Persist compacted block to Couchbase
                asyncio.create_task(self._persist_compacted(merged.model_dump(by_alias=True)))
            return

        new_blocks:    list[CompactedBlock] = []
        log_parts:     list[str] = []
        i = 0
        while i + TIER1_WINDOW_SIZE <= len(normals):
            window = normals[i : i + TIER1_WINDOW_SIZE]
            block  = _compact_window(window)
            new_blocks.append(block)
            log_parts.append(f"[{block.range}]")
            i += TIER1_WINDOW_SIZE
        leftover_normals = normals[i:]

        if not new_blocks:
            return

        new_edge = (
            anomalies
            + [b.model_dump(by_alias=True) for b in existing_compacted]
            + [dp.model_dump(by_alias=True) for dp in leftover_normals]
            + [b.model_dump(by_alias=True) for b in new_blocks]
        )
        compacted_pts = len(normals) - len(leftover_normals)
        log_entry = CompactionLogEntry(
            message=(
                f"T1 COMPACT {' '.join(log_parts)} | "
                f"{compacted_pts} pts → {len(new_blocks)} blocks"
            ),
            timestamp=_now_ms(),
            severity="compaction",
        )
        self.edge_storage = new_edge
        self.compaction_count += 1
        self.compaction_logs.append(log_entry.model_dump(by_alias=True))
        self.edge_pressure = _compute_pressure(len(new_edge))
        self._publish_compaction(log_entry)
        for block in new_blocks:
            asyncio.create_task(self._persist_compacted(block.model_dump(by_alias=True)))

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
        """Write reading to Edge Server; Edge Server replicates to Sync Gateway → Couchbase Server."""
        await db.edge_put_async(point_dict, key)

    async def _persist_edge_anomaly(self, point_dict: dict, key: str) -> None:
        """Write anomaly to Edge Server; Edge Server replicates to Sync Gateway → Couchbase Server."""
        await db.edge_put_async(point_dict, f"anomaly_{key}")

    async def _persist_compacted(self, block_dict: dict) -> None:
        """Write compacted block to Edge Server; Edge Server replicates to Sync Gateway → Couchbase Server."""
        await db.edge_put_async(block_dict, f"compact_{_now_ms()}")

    # ------------------------------------------------------------------
    # Emit loop
    # ------------------------------------------------------------------

    async def _emit_loop(self) -> None:
        interval = EMIT_INTERVAL_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            if not self.is_running:
                continue

            point = self._generate_point()
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

            self.edge_storage.append(point_dict)
            self.edge_pressure = _compute_pressure(len(self.edge_storage))

            self._publish("edge_update", {
                "item":          point_dict,
                "storageLength": len(self.edge_storage),
                "pressure":      self.edge_pressure,
            })
            self._publish_metrics()

            # Persist to Edge Server via REST API (non-blocking)
            asyncio.create_task(self._persist_edge_reading(point_dict, point.id))
            if point.type == "anomaly":
                asyncio.create_task(self._persist_edge_anomaly(point_dict, point.id))

            # Try compaction when offline
            if not self.is_online:
                self._compact()

    # ------------------------------------------------------------------
    # Drain loop — edge → Sync Gateway → central
    # ------------------------------------------------------------------

    async def _drain_loop(self) -> None:
        interval = DRAIN_INTERVAL_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            if not self.is_running or not self.is_online:
                continue
            if not self.edge_storage:
                continue

            item = self.edge_storage.pop(0)
            self.edge_pressure = _compute_pressure(len(self.edge_storage))
            self.central_storage.append(item)
            self.last_sync_timestamp = _now_ms()

            self._publish("central_update", {
                "item":              item,
                "lastSyncTimestamp": self.last_sync_timestamp,
            })
            self._publish_metrics()
            # Edge Server continuously replicates to Sync Gateway → Couchbase Server;
            # no explicit push needed here.

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
        self._publish("system_status", self.get_status_dict())

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


def _now_ms() -> int:
    return int(time.time() * 1000)


# Module-level singleton
engine = SimulationEngine()
