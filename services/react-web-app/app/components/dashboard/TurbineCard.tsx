import { motion } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import type { SensorData } from "~/types/edgeguard";
import { SENSOR_RANGES, sensorColor } from "~/types/edgeguard";

// ─── Sensor bar ───────────────────────────────────────────────────────────────

function SensorBar({
  label,
  value,
  unit,
  min,
  max,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  color: string;
}) {
  const span     = max - min;
  const fraction = Math.max(0, Math.min(1, (value - min) / span));

  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}
        >
          {label}
        </span>
        <span
          className="text-[11px] font-semibold"
          style={{ color, fontFamily: "IBM Plex Mono, monospace" }}
        >
          {value % 1 === 0 ? value : value.toFixed(1)}
          <span className="text-[9px] ml-[2px]" style={{ color: "var(--eg-text-dim)" }}>{unit}</span>
        </span>
      </div>
      <div className="h-[4px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--eg-border)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${fraction * 100}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

// ─── Sensor grid (2 × 3) ──────────────────────────────────────────────────────

const SENSOR_KEYS = [
  "temperature",
  "vibration",
  "rpm",
  "powerOutput",
  "windSpeed",
  "bladePitch",
] as const;

function SensorGrid({ sensors }: { sensors: SensorData }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2 mb-2">
      {SENSOR_KEYS.map((key) => {
        const meta  = SENSOR_RANGES[key];
        const value = sensors[key];
        const color = sensorColor(key, value);
        return (
          <SensorBar
            key={key}
            label={meta.label}
            value={value}
            unit={meta.unit}
            min={meta.min}
            max={meta.max}
            color={color}
          />
        );
      })}
    </div>
  );
}

// ─── TurbineCard ──────────────────────────────────────────────────────────────

export function TurbineCard({
  turbineId,
  delay,
}: {
  turbineId: number;
  delay: number;
}) {
  const history              = usePipelineStore((s) => s.perTurbineHistory[turbineId] || []);
  const forcedAnomalyTurbine = usePipelineStore((s) => s.forcedAnomalyTurbine);
  const enabledTurbines      = usePipelineStore((s) => s.enabledTurbines);
  const isEnabled            = enabledTurbines.includes(turbineId);

  const setTurbineEnabled = (enabled: boolean) => {
    edgeguardApi.setTurbineEnabled(turbineId, enabled).catch(() => {});
  };

  const setForcedAnomalyTurbine = (id: number | null) => {
    if (id != null) {
      edgeguardApi.injectAnomaly(id).catch(() => {});
    } else {
      edgeguardApi.clearAnomaly(turbineId).catch(() => {});
    }
    usePipelineStore.setState({ forcedAnomalyTurbine: id });
  };

  const isActive   = forcedAnomalyTurbine === turbineId;
  const lastPoint  = history[history.length - 1];
  const lastValue  = lastPoint?.value ?? 0;
  const lastScore  = lastPoint?.anomalyScore ?? 0;
  const isAnomaly  = lastPoint?.type === "anomaly";
  const hasSensors = lastPoint?.sensors != null;

  // Sparkline
  const sparkData = history.slice(-20);
  const maxVal    = Math.max(...sparkData.map((d) => d.value), 1);
  const minVal    = Math.min(...sparkData.map((d) => d.value), 0);
  const range     = maxVal - minVal || 1;
  const sparkW    = 100;
  const sparkH    = 32;
  const sparkPoints = sparkData
    .map((d, i) => {
      const x = (i / Math.max(sparkData.length - 1, 1)) * sparkW;
      const y = sparkH - ((d.value - minVal) / range) * sparkH;
      return `${x},${y}`;
    })
    .join(" ");

  const scoreColor =
    lastScore > 0.7
      ? "var(--eg-anomaly)"
      : lastScore > 0.4
      ? "var(--eg-alert)"
      : "var(--eg-flow)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
      className={`eg-panel p-4 transition-all duration-300 ${
        !isEnabled ? "opacity-60" : ""
      } ${isActive ? "border-[var(--eg-anomaly)] bg-red-50/40" : ""}`}
    >
      {/* Header: turbine name + ID + toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`eg-led ${
              !isEnabled ? "" : isAnomaly ? "eg-led-offline" : "eg-led-online"
            }`}
            style={!isEnabled ? { backgroundColor: "var(--eg-muted)", boxShadow: "none" } : undefined}
          />
          <span
            className="text-sm font-bold tracking-wide uppercase"
            style={{ color: "var(--eg-text-bright)", fontFamily: "Outfit, sans-serif" }}
          >
            Turbine {turbineId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--eg-text-muted)", fontFamily: "IBM Plex Mono, monospace" }}
          >
            T{turbineId}
          </span>
          <button
            type="button"
            onClick={() => setTurbineEnabled(!isEnabled)}
            className="text-xs px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: isEnabled ? "var(--eg-border)" : "var(--eg-flow)",
              color: isEnabled ? "var(--eg-text-dim)" : "var(--eg-flow)",
              fontFamily: "IBM Plex Mono, monospace",
              backgroundColor: "transparent",
            }}
          >
            {isEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Sparkline */}
      <div className="mb-2 rounded overflow-hidden" style={{ backgroundColor: "#f8fafc" }}>
        <svg
          viewBox={`0 0 ${sparkW} ${sparkH}`}
          className="w-full h-8"
          preserveAspectRatio="none"
        >
          {sparkData.length > 1 && (
            <polyline
              points={sparkPoints}
              fill="none"
              stroke={isAnomaly ? "var(--eg-anomaly)" : "var(--eg-flow)"}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={isEnabled ? 1 : 0.4}
            />
          )}
          {sparkData.map((d, i) =>
            d.type === "anomaly" ? (
              <circle
                key={i}
                cx={(i / Math.max(sparkData.length - 1, 1)) * sparkW}
                cy={sparkH - ((d.value - minVal) / range) * sparkH}
                r={2}
                fill="var(--eg-anomaly)"
              />
            ) : null
          )}
        </svg>
      </div>

      {/* Power + Score row */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="text-xs font-medium uppercase" style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}>Power </span>
          <span className="text-base font-bold" style={{ color: "var(--eg-text-bright)", fontFamily: "IBM Plex Mono, monospace" }}>
            {lastValue.toFixed(0)}
          </span>
          <span className="text-xs ml-0.5" style={{ color: "var(--eg-text-dim)" }}>kW</span>
        </div>
        <div>
          <span className="text-xs font-medium uppercase" style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}>Score </span>
          <span className="text-base font-bold" style={{ color: scoreColor, fontFamily: "IBM Plex Mono, monospace" }}>
            {lastScore.toFixed(3)}
          </span>
        </div>
      </div>

      {/* Sensor grid */}
      {hasSensors && <SensorGrid sensors={lastPoint.sensors} />}

      {/* Anomaly score bar */}
      <div
        className="h-1.5 rounded-full overflow-hidden mb-3"
        style={{ backgroundColor: "var(--eg-border)" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: scoreColor }}
          animate={{ width: `${Math.min(100, lastScore * 100)}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Inject button */}
      <button
        onClick={() => isEnabled && setForcedAnomalyTurbine(isActive ? null : turbineId)}
        disabled={!isEnabled}
        className="w-full py-2 rounded text-xs font-semibold uppercase tracking-wider transition-all duration-200"
        style={{
          fontFamily: "Outfit, sans-serif",
          letterSpacing: "0.08em",
          backgroundColor: isActive ? "rgba(239,68,68,0.06)" : "transparent",
          border: isActive
            ? "1px solid var(--eg-anomaly)"
            : "1px solid var(--eg-border)",
          color: !isEnabled
            ? "var(--eg-muted)"
            : isActive
            ? "var(--eg-anomaly)"
            : "var(--eg-text-dim)",
          cursor: !isEnabled ? "not-allowed" : "pointer",
        }}
      >
        {isActive ? "Burst Active" : "Inject Anomaly"}
      </button>
    </motion.div>
  );
}
