import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePipelineStore, EDGE_CAPACITY, COMPACTION_THRESHOLD } from "~/stores/pipelineStore";
import { isDataPoint, isCompactedBlock } from "~/types/edgeguard";

export function StoragePanel({ delay }: { delay: number }) {
  const edgeStorage = usePipelineStore((s) => s.edgeStorage);
  const centralStorage = usePipelineStore((s) => s.centralStorage);
  const compactionCount = usePipelineStore((s) => s.compactionCount);
  const isOnline = usePipelineStore((s) => s.isOnline);
  const lastSyncTimestamp = usePipelineStore((s) => s.lastSyncTimestamp);
  const edgePressure = usePipelineStore((s) => s.edgePressure);
  const lastDrainedItemId = usePipelineStore((s) => s.lastDrainedItemId);

  const edgeRatio = Math.min(1, edgeStorage.length / EDGE_CAPACITY);
  const inCompactionZone = edgeStorage.length >= COMPACTION_THRESHOLD;

  const normalCount = edgeStorage.filter((i) => isDataPoint(i) && i.type === "normal").length;
  const anomalyCount = edgeStorage.filter((i) => isDataPoint(i) && i.type === "anomaly").length;
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

  const [compactFlash, setCompactFlash] = useState(false);
  useEffect(() => {
    if (compactionCount === 0) return;
    setCompactFlash(true);
    const t = setTimeout(() => setCompactFlash(false), 600);
    return () => clearTimeout(t);
  }, [compactionCount]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay }}
      className="flex flex-col gap-3"
    >
      {/* Edge Couchbase Summary */}
      <div className={`eg-panel p-3 ${inCompactionZone ? "glow-red-box border-[var(--eg-anomaly)]/30" : ""} relative overflow-hidden`}>
        {compactFlash && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(179,136,255,0.08) 2px, rgba(179,136,255,0.08) 4px)",
            }}
            initial={{ opacity: 0.8, y: -40 }}
            animate={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.5 }}
          />
        )}

        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <ellipse cx="7" cy="3" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
            <rect x="1" y="3" width="12" height="8" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
            <ellipse cx="7" cy="11" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
          </svg>
          <span className="font-display text-[10px] tracking-[0.15em] text-[var(--eg-text-bright)] font-bold">
            EDGE COUCHBASE
          </span>
        </div>

        {/* Capacity bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-[9px] mb-1">
            <span className="text-[var(--eg-text-dim)]">CAPACITY</span>
            <span className="font-mono text-[var(--eg-text-bright)]">
              {edgeStorage.length}/{EDGE_CAPACITY}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--eg-border)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${edgeRatio * 100}%`, backgroundColor: edgeBarColor }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-1.5 text-[9px] mb-2">
          <div className="bg-[var(--eg-surface)] rounded px-2 py-1.5 text-center">
            <div className="font-mono text-[var(--eg-ok)] font-bold">{normalCount}</div>
            <div className="text-[var(--eg-text-dim)]">Normal</div>
          </div>
          <div className="bg-[var(--eg-surface)] rounded px-2 py-1.5 text-center">
            <div className="font-mono text-[var(--eg-anomaly)] font-bold">{anomalyCount}</div>
            <div className="text-[var(--eg-text-dim)]">Anomaly</div>
          </div>
          <div className="bg-[var(--eg-surface)] rounded px-2 py-1.5 text-center">
            <div className="font-mono text-[#b388ff] font-bold">{compactedCount}</div>
            <div className="text-[var(--eg-text-dim)]">Compact</div>
          </div>
        </div>

        {/* Compaction count */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--eg-border)] text-[9px] mb-2">
          <span className="text-[var(--eg-text-dim)]">COMPACTIONS</span>
          <span className="font-mono text-[var(--eg-alert)] font-bold">{compactionCount}</span>
        </div>

        {/* Pressure indicator */}
        {edgePressure > 0.3 && (
          <div className="flex items-center gap-1.5 text-[9px]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--eg-anomaly)] animate-pulse" />
            <span className="text-[var(--eg-anomaly)]">
              PRESSURE {Math.round(edgePressure * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Central Couchbase Summary */}
      <div className="eg-panel p-3 relative overflow-hidden">
        {syncPulse && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-10 border-2 border-[var(--eg-flow)]/30 rounded-[inherit]"
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}

        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <ellipse cx="7" cy="3" rx="6" ry="2" fill="none" stroke={isOnline ? "var(--eg-flow)" : "var(--eg-muted)"} strokeWidth="1" />
            <rect x="1" y="3" width="12" height="8" fill="none" stroke={isOnline ? "var(--eg-flow)" : "var(--eg-muted)"} strokeWidth="1" />
            <ellipse cx="7" cy="11" rx="6" ry="2" fill="none" stroke={isOnline ? "var(--eg-flow)" : "var(--eg-muted)"} strokeWidth="1" />
          </svg>
          <span className="font-display text-[10px] tracking-[0.15em] text-[var(--eg-text-bright)] font-bold">
            CENTRAL COUCHBASE
          </span>
        </div>

        <div className="flex items-center justify-between text-[9px] mb-2">
          <span className="text-[var(--eg-text-dim)]">SYNCED ITEMS</span>
          <span className="font-mono text-[var(--eg-text-bright)] text-sm font-bold">
            {centralStorage.length}
          </span>
        </div>

        <div className="flex items-center justify-between text-[9px] mb-2">
          <span className="text-[var(--eg-text-dim)]">STATUS</span>
          <div className="flex items-center gap-1.5">
            <div className={`eg-led ${isOnline ? "eg-led-online" : "eg-led-offline"}`} />
            <span className={`font-mono font-bold ${isOnline ? "text-[var(--eg-ok)]" : "text-[var(--eg-anomaly)]"}`}>
              {isOnline ? "SYNCING" : "OFFLINE"}
            </span>
          </div>
        </div>

        {lastSyncAgo !== null && (
          <div className="flex items-center justify-between text-[9px]">
            <span className="text-[var(--eg-text-dim)]">LAST SYNC</span>
            <span className="font-mono text-[var(--eg-text-dim)]">{lastSyncAgo}s ago</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
