import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePipelineStore, EDGE_CAPACITY, COMPACTION_THRESHOLD } from "~/stores/pipelineStore";
import { isDataPoint, isCompactedBlock } from "~/types/edgeguard";

// ─── DB icon ─────────────────────────────────────────────────────────────────

function DbIcon({ color = "var(--eg-flow)" }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <ellipse cx="7" cy="3" rx="6" ry="2" fill="none" stroke={color} strokeWidth="1.2" />
      <rect x="1" y="3" width="12" height="8" fill="none" stroke={color} strokeWidth="1.2" />
      <ellipse cx="7" cy="11" rx="6" ry="2" fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

// ─── StoragePanel ─────────────────────────────────────────────────────────────

export function StoragePanel({ delay }: { delay: number }) {
  const edgeStorage       = usePipelineStore((s) => s.edgeStorage);
  const centralStorage    = usePipelineStore((s) => s.centralStorage);
  const compactionCount   = usePipelineStore((s) => s.compactionCount);
  const isOnline          = usePipelineStore((s) => s.isOnline);
  const lastSyncTimestamp = usePipelineStore((s) => s.lastSyncTimestamp);
  const lastDrainedItemId = usePipelineStore((s) => s.lastDrainedItemId);

  const edgeRatio       = Math.min(1, edgeStorage.length / EDGE_CAPACITY);
  const inCompactionZone = edgeStorage.length >= COMPACTION_THRESHOLD;

  const normalCount   = edgeStorage.filter((i) => isDataPoint(i) && i.type === "normal").length;
  const anomalyCount  = edgeStorage.filter((i) => isDataPoint(i) && i.type === "anomaly").length;
  const compactedCount = edgeStorage.filter(isCompactedBlock).length;

  const edgeBarColor = inCompactionZone
    ? "var(--eg-anomaly)"
    : edgeRatio > 0.6
    ? "var(--eg-alert)"
    : "var(--eg-flow)";

  const lastSyncAgo = lastSyncTimestamp
    ? Math.round((Date.now() - lastSyncTimestamp) / 1000)
    : null;

  const [syncPulse, setSyncPulse] = useState(false);
  useEffect(() => {
    if (!lastDrainedItemId) return;
    setSyncPulse(true);
    const t = setTimeout(() => setSyncPulse(false), 300);
    return () => clearTimeout(t);
  }, [lastDrainedItemId]);

  const panelStyle: React.CSSProperties = {
    backgroundColor: "var(--eg-surface)",
    border: "1px solid var(--eg-border)",
    borderRadius: 8,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    padding: "12px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    color: "var(--eg-text-dim)",
    fontFamily: "Outfit, sans-serif",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--eg-text-bright)",
    fontFamily: "IBM Plex Mono, monospace",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
      className="flex flex-col gap-2 h-full min-h-0"
    >
      {/* ── Edge Capacity ── */}
      <div style={panelStyle} className="flex-1 min-h-0 overflow-auto">
        <div className="flex items-center gap-2 mb-2">
          <DbIcon color="var(--eg-flow)" />
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--eg-text-bright)", fontFamily: "Outfit, sans-serif" }}
          >
            Edge Capacity
          </span>
        </div>

        {/* Capacity label + bar */}
        <div className="mb-1 flex items-center justify-between">
          <span style={labelStyle}>Capacity</span>
          <span style={valueStyle}>
            {edgeStorage.length}/{EDGE_CAPACITY}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: "var(--eg-border)" }}>
          <motion.div
            className="h-full rounded-full"
            animate={{ width: `${edgeRatio * 100}%`, backgroundColor: edgeBarColor }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {[
            { label: "Normal", value: normalCount, color: "var(--eg-ok)" },
            { label: "Anomaly", value: anomalyCount, color: "var(--eg-anomaly)" },
            { label: "Compact", value: compactedCount, color: "#8b5cf6" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex flex-col items-center py-1.5 rounded-md"
              style={{ backgroundColor: "var(--eg-bg)" }}
            >
              <span className="text-sm font-bold" style={{ color, fontFamily: "IBM Plex Mono, monospace" }}>
                {value}
              </span>
              <span className="text-[9px] mt-0.5" style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Compaction count */}
        <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--eg-border)" }}>
          <span style={labelStyle}>Compactions</span>
          <span className="text-sm font-semibold" style={{ color: "var(--eg-alert)", fontFamily: "IBM Plex Mono, monospace" }}>
            {compactionCount}
          </span>
        </div>
      </div>

      {/* ── Central Capacity ── */}
      <div style={{ ...panelStyle, position: "relative", overflow: "hidden" }} className="flex-1 min-h-0">
        {syncPulse && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-10 border-2 rounded-[inherit]"
            style={{ borderColor: "var(--eg-flow)", opacity: 0.4 }}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          />
        )}

        <div className="flex items-center gap-2 mb-2">
          <DbIcon color={isOnline ? "var(--eg-flow)" : "var(--eg-muted)"} />
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--eg-text-bright)", fontFamily: "Outfit, sans-serif" }}
          >
            Central Capacity
          </span>
        </div>

        {/* Synced items */}
        <div className="flex items-center justify-between mb-2">
          <span style={labelStyle}>Synced items</span>
          <span className="text-xl font-bold" style={{ color: "var(--eg-text-bright)", fontFamily: "IBM Plex Mono, monospace" }}>
            {centralStorage.length}
            <span className="text-xs font-normal ml-1 text-[var(--eg-text-dim)]">/100</span>
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between mb-2">
          <span style={labelStyle}>Status</span>
          <div className="flex items-center gap-1.5">
            <div className={`eg-led ${isOnline ? "eg-led-online" : "eg-led-offline"}`} />
            <span
              className="text-xs font-semibold"
              style={{
                color: isOnline ? "var(--eg-ok)" : "var(--eg-anomaly)",
                fontFamily: "Outfit, sans-serif",
              }}
            >
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>

        {/* Last sync */}
        {lastSyncAgo !== null && (
          <div className="flex items-center justify-between">
            <span style={labelStyle}>Last sync</span>
            <span style={{ ...valueStyle, fontSize: 11 }}>{lastSyncAgo}s ago</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

