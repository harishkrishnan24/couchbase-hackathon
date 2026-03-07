from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field


class SensorData(BaseModel):
    """Multi-feature sensor reading from a wind turbine."""
    vibration: float       # m/s^2, normal: 0.5–2.0
    temperature: float     # Celsius, normal: 40–65
    rpm: float             # rotor RPM, normal: 10–20
    power_output: float = Field(alias="powerOutput")   # kW, normal: 500–2000
    wind_speed: float = Field(alias="windSpeed")       # m/s, normal: 5–15
    blade_pitch: float = Field(alias="bladePitch")     # degrees, normal: 2–15

    model_config = {"populate_by_name": True}


class DataPoint(BaseModel):
    id: str
    seq: int
    source_turbine: int = Field(alias="sourceTurbine")
    sensors: SensorData
    value: float           # primary display value — mirrors power_output
    anomaly_score: float = Field(alias="anomalyScore")
    type: Literal["normal", "anomaly"]
    timestamp: int         # unix ms

    model_config = {"populate_by_name": True}


class CompactedBlock(BaseModel):
    """DataPoint-like block: same core fields (id, seq, sourceTurbine, sensors, value, timestamp) plus compacted-only stats."""
    type: Literal["compacted"] = "compacted"
    id: str = ""  # set by caller (e.g. compact_{ts}_{idx})
    seq: int  # min seq in window (for ordering); UI may show [range] in seq column
    source_turbine: int = Field(alias="sourceTurbine")
    sensors: SensorData  # averaged over window/block
    value: float  # primary display value (avg power_output), same as DataPoint
    timestamp: int  # unix ms (e.g. average of window)
    range: str  # e.g. "1001-1005"
    tier: Literal[1, 2]
    count: int
    avg_value: float = Field(alias="avgValue")  # same as value, for backward compat
    min_value: float = Field(alias="minValue")
    max_value: float = Field(alias="maxValue")
    std_dev: float = Field(alias="stdDev")
    avg_anomaly_score: float = Field(default=0.0, alias="avgAnomalyScore")

    model_config = {"populate_by_name": True}


EdgeGuardItem = Union[DataPoint, CompactedBlock]


class CompactionLogEntry(BaseModel):
    message: str
    timestamp: int
    severity: Literal["compaction", "sync", "warning", "info"]


class SystemConfig(BaseModel):
    edge_capacity: int = Field(alias="edgeCapacity")
    compaction_threshold: int = Field(alias="compactionThreshold")
    turbine_count: int = Field(alias="turbineCount")
    emit_interval_ms: int = Field(alias="emitIntervalMs")
    drain_interval_ms: int = Field(alias="drainIntervalMs")

    model_config = {"populate_by_name": True}


class SystemStatus(BaseModel):
    is_running: bool = Field(alias="isRunning")
    is_initialized: bool = Field(alias="isInitialized")
    is_online: bool = Field(alias="isOnline")
    sequence_number: int = Field(alias="sequenceNumber")
    enabled_turbines: list[int] = Field(default=[], alias="enabledTurbines")

    model_config = {"populate_by_name": True}


class Metrics(BaseModel):
    total_packets_emitted: int = Field(alias="totalPacketsEmitted")
    total_anomalies: int = Field(alias="totalAnomalies")
    edge_pressure: float = Field(alias="edgePressure")
    compaction_count: int = Field(alias="compactionCount")
    last_sync_timestamp: int | None = Field(alias="lastSyncTimestamp")
    edge_storage_length: int = Field(alias="edgeStorageLength")
    central_storage_length: int = Field(alias="centralStorageLength")

    model_config = {"populate_by_name": True}


class ModelStatus(BaseModel):
    trained: bool
    training_samples: int = Field(alias="trainingSamples")
    contamination: float
    threshold: float
    features: list[str]
    version: str

    model_config = {"populate_by_name": True}
