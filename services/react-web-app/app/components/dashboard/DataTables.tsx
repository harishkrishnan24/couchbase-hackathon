import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import type { EdgeGuardItem } from "~/types/edgeguard";
import { isDataPoint, isCompactedBlock, SENSOR_RANGES, sensorColor } from "~/types/edgeguard";

const MAX_ROWS = 10;

// ---------------------------------------------------------------------------
// Sensor values row (inline under main data)
// ---------------------------------------------------------------------------

function SensorValuesRow({ sensors }: { sensors: NonNullable<import("~/types/edgeguard").DataPoint["sensors"]> }) {
  const keys = ["temperature", "vibration", "rpm", "powerOutput", "windSpeed", "bladePitch"] as const;
  const abbreviations: Record<string, string> = {
    temperature: "TMP",
    vibration: "VIB",
    rpm: "RPM",
    powerOutput: "PWR",
    windSpeed: "WND",
    bladePitch: "PTC",
  };

  return (
    <div className="flex flex-row items-center justify-between px-2 pb-1.5 pt-0.5 gap-2 overflow-hidden">
      {keys.map((key) => {
        const value = sensors[key];
        const color = sensorColor(key, value);

        return (
          <div key={key} className="flex items-center gap-1 min-w-0">
            <span className="font-display text-[7px] tracking-wider text-[var(--eg-text-dim)] shrink-0">
              {abbreviations[key]}:
            </span>
            <span className="font-mono text-[8px] font-semibold truncate" style={{ color }}>
              {value % 1 === 0 ? value : value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function itemKey(item: EdgeGuardItem, index: number): string {
  if (isDataPoint(item))       return item.id;
  if (isCompactedBlock(item))  return (item as import("~/types/edgeguard").CompactedBlock).id ?? `compact_${item.range}_${item.tier}`;
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
      <div className="grid grid-cols-[50px_40px_80px_60px] gap-1 px-2 py-1 text-[8px] font-display tracking-[0.1em] text-[var(--eg-text-dim)] border-b border-[var(--eg-border)] shrink-0">
        <span>SEQ</span>
        <span>SRC</span>
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
  key,
}: {
  item: EdgeGuardItem;
  key?: React.Key;
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
        transition={{ duration: 0.08 }}
        className={`border-b border-[var(--eg-border)]/30 flex flex-col ${isAnomaly ? "bg-[var(--eg-anomaly)]/5" : ""}`}
      >
        {/* Main data row */}
        <div
          className="grid grid-cols-[50px_40px_80px_60px] gap-1 px-2 py-1 pt-1.5 text-[11px] font-mono items-center"
        >
          <span className="text-[var(--eg-text-dim)]">#{item.seq}</span>
          <span className="text-[var(--eg-text-dim)]">T{item.sourceTurbine}</span>
          <span
            style={{ color: isAnomaly ? "var(--eg-anomaly)" : "var(--eg-ok)" }}
            className="font-bold"
          >
            {(item.anomalyScore * 100).toFixed(1)}%
          </span>
          <div className="flex items-center gap-1">
            <span className={`font-bold ${isAnomaly ? "text-[var(--eg-anomaly)]" : "text-[var(--eg-ok)]"}`}>
              {isAnomaly ? "ANOMALY" : "NORMAL"}
            </span>
          </div>
        </div>

        {/* Persistent sensor values row */}
        {hasSensors && <SensorValuesRow sensors={item.sensors} />}
      </motion.div>
    );
  }

  if (isCompactedBlock(item)) {
    const tierColor = item.tier === 2 ? "#e040fb" : "#b388ff";
    const hasSensors = item.sensors != null;
    const scoreDisplay = item.avgAnomalyScore !== undefined 
      ? `${(item.avgAnomalyScore * 100).toFixed(1)}% (${item.count}pts)`
      : `AVG (${item.count}pts)`;

    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.08 }}
        className="border-b border-[var(--eg-border)]/30 flex flex-col"
        style={{ backgroundColor: `${tierColor}08` }}
      >
        <div
          className="grid grid-cols-[50px_40px_80px_60px] gap-1 px-2 py-1 pt-1.5 text-[11px] font-mono items-center"
        >
          <span style={{ color: tierColor }} className="font-bold">[{item.range}]</span>
          <span style={{ color: tierColor }}>T{item.sourceTurbine ?? item.tier}</span>
          <span style={{ color: tierColor }} className="font-bold text-[10px]">{scoreDisplay}</span>
          <div className="flex items-center gap-1">
            <span style={{ color: tierColor }} className="font-bold">COMPACT</span>
          </div>
        </div>
        
        {hasSensors && item.sensors && <SensorValuesRow sensors={item.sensors} />}
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

  const edgeVisible    = edgeStorage.slice(-MAX_ROWS);
  const centralVisible = centralStorage.slice(-MAX_ROWS);

  useEffect(() => {
    if (edgeScrollRef.current) {
      edgeScrollRef.current.scrollTop = edgeScrollRef.current.scrollHeight;
    }
  }, [edgeStorage.length]);

  useEffect(() => {
    if (centralScrollRef.current) {
      centralScrollRef.current.scrollTop = centralScrollRef.current.scrollHeight;
    }
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
