import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import type { EdgeGuardItem } from "~/types/edgeguard";
import { isDataPoint, isCompactedBlock, SENSOR_RANGES, sensorColor } from "~/types/edgeguard";

const MAX_ROWS = 10;

// ---------------------------------------------------------------------------
// Sensor detail panel (expanded row)
// ---------------------------------------------------------------------------

function SensorDetailPanel({ sensors }: { sensors: NonNullable<import("~/types/edgeguard").DataPoint["sensors"]> }) {
  const keys = ["temperature", "vibration", "rpm", "powerOutput", "windSpeed", "bladePitch"] as const;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: "easeInOut" }}
      className="overflow-hidden"
    >
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 px-2 py-2 border-t border-[var(--eg-border)]/40 bg-[var(--eg-surface)]/50">
        {keys.map((key) => {
          const meta  = SENSOR_RANGES[key];
          const value = sensors[key];
          const color = sensorColor(key, value);
          const span     = meta.max - meta.min;
          const fraction = Math.max(0, Math.min(1, (value - meta.min) / span));

          return (
            <div key={key} className="flex flex-col gap-[2px]">
              <div className="flex items-center justify-between">
                <span className="font-display text-[7px] tracking-[0.1em] text-[var(--eg-text-dim)]">
                  {meta.label}
                </span>
                <span className="font-mono text-[8px] font-semibold" style={{ color }}>
                  {value % 1 === 0 ? value : value.toFixed(1)}
                  <span className="text-[6px] text-[var(--eg-text-dim)] ml-[1px]">{meta.unit}</span>
                </span>
              </div>
              <div className="h-[2px] rounded-full bg-[var(--eg-border)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${fraction * 100}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function itemKey(item: EdgeGuardItem, index: number): string {
  if (isDataPoint(item))       return item.id;
  if (isCompactedBlock(item))  return `compact_${item.range}_${item.tier}`;
  return `item_${index}`;
}

// ---------------------------------------------------------------------------
// Table shell
// ---------------------------------------------------------------------------

function TableShell({
  title,
  count,
  children,
  scrollRef,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="eg-panel p-3 flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 14 14">
            <ellipse cx="7" cy="3" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
            <rect x="1" y="3" width="12" height="8" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
            <ellipse cx="7" cy="11" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1" />
          </svg>
          <span className="font-display text-[10px] tracking-[0.15em] text-[var(--eg-text-bright)] font-bold">
            {title}
          </span>
        </div>
        <span className="font-mono text-[9px] text-[var(--eg-text-dim)]">{count} items</span>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[50px_40px_60px_60px_60px] gap-1 px-2 py-1 text-[8px] font-display tracking-[0.1em] text-[var(--eg-text-dim)] border-b border-[var(--eg-border)] shrink-0">
        <span>SEQ</span>
        <span>SRC</span>
        <span>VALUE</span>
        <span>SCORE</span>
        <span>TYPE</span>
      </div>

      {/* Rows */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto eg-scrollbar">
        <AnimatePresence mode="popLayout" initial={false}>
          {children}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data row (with optional sensor expansion)
// ---------------------------------------------------------------------------

function DataRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: EdgeGuardItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (isDataPoint(item)) {
    const isAnomaly = item.type === "anomaly";
    const hasSensors = item.sensors != null;

    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.15 }}
        className={`border-b border-[var(--eg-border)]/30 ${isAnomaly ? "bg-[var(--eg-anomaly)]/5" : ""}`}
      >
        {/* Compact row */}
        <div
          className={`grid grid-cols-[50px_40px_60px_60px_60px] gap-1 px-2 py-1 text-[11px] font-mono ${hasSensors ? "cursor-pointer hover:bg-[var(--eg-border)]/10" : ""}`}
          onClick={hasSensors ? onToggle : undefined}
        >
          <span className="text-[var(--eg-text-dim)]">#{item.seq}</span>
          <span className="text-[var(--eg-text-dim)]">T{item.sourceTurbine}</span>
          <span className="text-[var(--eg-text-bright)]">{item.value.toFixed(0)}</span>
          <span
            style={{ color: isAnomaly ? "var(--eg-anomaly)" : "var(--eg-ok)" }}
            className="font-bold"
          >
            {item.anomalyScore.toFixed(3)}
          </span>
          <div className="flex items-center gap-1">
            <span className={`font-bold ${isAnomaly ? "text-[var(--eg-anomaly)]" : "text-[var(--eg-ok)]"}`}>
              {isAnomaly ? "ANOMALY" : "NORMAL"}
            </span>
            {hasSensors && (
              <span className="text-[8px] text-[var(--eg-text-dim)] ml-auto">
                {isExpanded ? "▲" : "▼"}
              </span>
            )}
          </div>
        </div>

        {/* Expanded sensor detail */}
        <AnimatePresence>
          {isExpanded && hasSensors && (
            <SensorDetailPanel sensors={item.sensors} />
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  if (isCompactedBlock(item)) {
    const tierColor = item.tier === 2 ? "#e040fb" : "#b388ff";
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.15 }}
        className="grid grid-cols-[50px_40px_60px_60px_60px] gap-1 px-2 py-1 text-[11px] font-mono border-b border-[var(--eg-border)]/30"
        style={{ backgroundColor: `${tierColor}08` }}
      >
        <span style={{ color: tierColor }} className="font-bold">[{item.range}]</span>
        <span style={{ color: tierColor }}>T{item.tier}</span>
        <span className="text-[var(--eg-text-bright)]">{item.avgValue.toFixed(0)}</span>
        <span className="text-[var(--eg-text-dim)]">{item.count}pts</span>
        <span style={{ color: tierColor }} className="font-bold">COMPACT</span>
      </motion.div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// DataTables
// ---------------------------------------------------------------------------

export function DataTables() {
  const edgeStorage    = usePipelineStore((s) => s.edgeStorage);
  const centralStorage = usePipelineStore((s) => s.centralStorage);

  const edgeScrollRef    = useRef<HTMLDivElement>(null);
  const centralScrollRef = useRef<HTMLDivElement>(null);

  // Track which row is expanded (by key string) per table
  const [edgeExpanded,    setEdgeExpanded]    = useState<string | null>(null);
  const [centralExpanded, setCentralExpanded] = useState<string | null>(null);

  const edgeVisible    = edgeStorage.slice(-MAX_ROWS);
  const centralVisible = centralStorage.slice(-MAX_ROWS);

  useEffect(() => {
    if (edgeScrollRef.current) {
      edgeScrollRef.current.scrollTop = edgeScrollRef.current.scrollHeight;
    }
    // Reset expansion when new data arrives
    setEdgeExpanded(null);
  }, [edgeStorage.length]);

  useEffect(() => {
    if (centralScrollRef.current) {
      centralScrollRef.current.scrollTop = centralScrollRef.current.scrollHeight;
    }
    setCentralExpanded(null);
  }, [centralStorage.length]);

  return (
    <motion.div
      className="grid grid-cols-2 gap-3 h-full min-h-0"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
    >
      <TableShell title="EDGE COUCHBASE" count={edgeStorage.length} scrollRef={edgeScrollRef}>
        {edgeVisible.map((item, i) => {
          const key = itemKey(item, edgeStorage.length - MAX_ROWS + i);
          return (
            <DataRow
              key={key}
              item={item}
              isExpanded={edgeExpanded === key}
              onToggle={() => setEdgeExpanded(edgeExpanded === key ? null : key)}
            />
          );
        })}
        {edgeStorage.length === 0 && (
          <div className="text-[10px] text-[var(--eg-muted)] text-center py-4 font-mono">NO DATA</div>
        )}
      </TableShell>

      <TableShell title="CENTRAL COUCHBASE" count={centralStorage.length} scrollRef={centralScrollRef}>
        {centralVisible.map((item, i) => {
          const key = itemKey(item, centralStorage.length - MAX_ROWS + i);
          return (
            <DataRow
              key={key}
              item={item}
              isExpanded={centralExpanded === key}
              onToggle={() => setCentralExpanded(centralExpanded === key ? null : key)}
            />
          );
        })}
        {centralStorage.length === 0 && (
          <div className="text-[10px] text-[var(--eg-muted)] text-center py-4 font-mono">NO DATA</div>
        )}
      </TableShell>
    </motion.div>
  );
}
