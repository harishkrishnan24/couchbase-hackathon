/** Multi-feature sensor reading from a wind turbine. */
export interface SensorData {
  vibration: number;     // m/s^2, normal: 0.5–2.0
  temperature: number;   // Celsius, normal: 40–65
  rpm: number;           // rotor RPM, normal: 10–20
  powerOutput: number;   // kW, normal: 500–2000
  windSpeed: number;     // m/s, normal: 5–15
  bladePitch: number;    // degrees, normal: 2–15
}

/** Normal ranges per sensor feature for color-coding. */
export const SENSOR_RANGES: Record<keyof SensorData, { min: number; max: number; unit: string; label: string }> = {
  vibration:   { min: 0.5,  max: 2.0,   unit: "m/s²", label: "VIB"   },
  temperature: { min: 40,   max: 65,    unit: "°C",   label: "TEMP"  },
  rpm:         { min: 10,   max: 20,    unit: "RPM",  label: "RPM"   },
  powerOutput: { min: 500,  max: 2000,  unit: "kW",   label: "POWER" },
  windSpeed:   { min: 5,    max: 15,    unit: "m/s",  label: "WIND"  },
  bladePitch:  { min: 2,    max: 15,    unit: "°",    label: "PITCH" },
};

/** Data point from the simulation (normal or anomaly). */
export interface DataPoint {
  id: string;
  seq: number;
  /** Turbine index (1..3) that emitted this point. */
  sourceTurbine: number;
  sensors: SensorData;
  /** Primary display value — mirrors powerOutput. */
  value: number;
  anomalyScore: number;
  type: "normal" | "anomaly";
  timestamp: number;
}

/** Single block after compaction (replaces multiple normal points). DataPoint-like: id, seq, sourceTurbine, sensors, value, timestamp. */
export interface CompactedBlock {
  type: "compacted";
  id?: string;
  seq?: number;
  sourceTurbine?: number;
  sensors?: SensorData;
  value?: number;
  timestamp?: number;
  range: string;
  /** 1 = windowed (5-pt), 2 = merged (multi-window) */
  tier: 1 | 2;
  count: number;
  avgValue?: number;
  minValue: number;
  maxValue: number;
  stdDev: number;
  avgAnomalyScore: number;
}

/** Item in edge or central storage. */
export type EdgeGuardItem = DataPoint | CompactedBlock;

/** Packet in transit along the pipeline. */
export type PipelineSegment = "to-buffer" | "to-central";

export interface Packet {
  id: string;
  progress: number;
  segment: PipelineSegment;
  /** For to-buffer: the DataPoint being sent. For to-central: the item draining. */
  payload: DataPoint | EdgeGuardItem;
}

export function isDataPoint(item: EdgeGuardItem): item is DataPoint {
  return "seq" in item && "anomalyScore" in item;
}

export function isCompactedBlock(item: EdgeGuardItem): item is CompactedBlock {
  return item.type === "compacted";
}

/** Returns 0–1 fraction for a sensor value within its normal range (clamped). */
export function sensorFraction(key: keyof SensorData, value: number): number {
  const r = SENSOR_RANGES[key];
  return Math.max(0, Math.min(1, (value - r.min) / (r.max - r.min)));
}

/** Color token based on how far outside normal range a sensor value is. */
export function sensorColor(key: keyof SensorData, value: number): string {
  const r = SENSOR_RANGES[key];
  const span = r.max - r.min;
  const lo = r.min - span * 0.3;
  const hi = r.max + span * 0.3;
  if (value < lo || value > hi) return "var(--eg-anomaly)";
  if (value < r.min || value > r.max) return "var(--eg-alert)";
  return "var(--eg-ok)";
}
