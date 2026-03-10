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
    <div className="flex flex-row items-center justify-between px-3 pb-2 pt-0.5 gap-2 overflow-hidden border-t" style={{ borderColor: "var(--eg-border)" }}>
      {keys.map((key) => {
        const value = sensors[key];
        const color = sensorColor(key, value);

        return (
          <div key={key} className="flex items-center gap-1 min-w-0">
            <span
              className="text-[9px] font-medium shrink-0"
              style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}
            >
              {abbreviations[key]}:
            </span>
            <span
              className="text-[10px] font-semibold truncate"
              style={{ color, fontFamily: "IBM Plex Mono, monospace" }}
            >
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
    <div
      className="flex-1 min-w-0 flex flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--eg-surface)",
        border: "1px solid var(--eg-border)",
        borderRadius: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0 border-b"
        style={{ borderColor: "var(--eg-border)" }}
      >
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 14 14">
            <ellipse cx="7" cy="3" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1.2" />
            <rect x="1" y="3" width="12" height="8" fill="none" stroke="var(--eg-flow)" strokeWidth="1.2" />
            <ellipse cx="7" cy="11" rx="6" ry="2" fill="none" stroke="var(--eg-flow)" strokeWidth="1.2" />
          </svg>
          <span
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: "var(--eg-text-bright)", fontFamily: "Outfit, sans-serif" }}
          >
            {title}
          </span>
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--eg-text-dim)", fontFamily: "IBM Plex Mono, monospace" }}
        >
          {count} items
        </span>
      </div>

      {/* Column headers */}
      <div
        className="grid grid-cols-[60px_44px_1fr_80px] gap-1 px-4 py-2 shrink-0 border-b"
        style={{ borderColor: "var(--eg-border)", backgroundColor: "var(--eg-bg)" }}
      >
        {["SEQ", "SRC", "VALUE / SCORE", "TYPE"].map((h) => (
          <span
            key={h}
            className="text-[10px] font-semibold uppercase"
            style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif", letterSpacing: "0.05em" }}
          >
            {h}
          </span>
        ))}
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
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="flex flex-col border-b"
        style={{
          borderColor: "var(--eg-border)",
          backgroundColor: isAnomaly ? "rgba(239,68,68,0.03)" : "transparent",
        }}
      >
        <div className="grid grid-cols-[60px_44px_1fr_80px] gap-1 px-4 py-2 items-center">
          <span
            className="text-[11px]"
            style={{ color: "var(--eg-text-dim)", fontFamily: "IBM Plex Mono, monospace" }}
          >
            #{item.seq}
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--eg-text-dim)", fontFamily: "IBM Plex Mono, monospace" }}
          >
            T{item.sourceTurbine}
          </span>
          <span
            className="text-[11px] font-semibold"
            style={{
              color: isAnomaly ? "var(--eg-anomaly)" : "var(--eg-flow)",
              fontFamily: "IBM Plex Mono, monospace",
            }}
          >
            {(item.anomalyScore * 100).toFixed(2)}%
          </span>
          <span
            className="text-[10px] font-semibold uppercase"
            style={{
              color: isAnomaly ? "var(--eg-anomaly)" : "var(--eg-ok)",
              fontFamily: "Outfit, sans-serif",
              letterSpacing: "0.04em",
            }}
          >
            {isAnomaly ? "Anomaly" : "Normal"}
          </span>
        </div>
        {hasSensors && <SensorValuesRow sensors={item.sensors} />}
      </motion.div>
    );
  }

  if (isCompactedBlock(item)) {
    const tierColor = item.tier === 2 ? "#9333ea" : "#7c3aed";
    const hasSensors = item.sensors != null;
    const scoreDisplay = item.avgAnomalyScore !== undefined
      ? `${(item.avgAnomalyScore * 100).toFixed(2)}% (${item.count}pts)`
      : `avg (${item.count}pts)`;

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        className="flex flex-col border-b"
        style={{ borderColor: "var(--eg-border)", backgroundColor: `${tierColor}08` }}
      >
        <div className="grid grid-cols-[60px_44px_1fr_80px] gap-1 px-4 py-2 items-center">
          <span className="text-[11px] font-semibold" style={{ color: tierColor, fontFamily: "IBM Plex Mono, monospace" }}>
            [{item.range}]
          </span>
          <span className="text-[11px]" style={{ color: tierColor, fontFamily: "IBM Plex Mono, monospace" }}>
            T{item.sourceTurbine ?? item.tier}
          </span>
          <span className="text-[11px] font-semibold" style={{ color: tierColor, fontFamily: "IBM Plex Mono, monospace" }}>
            {scoreDisplay}
          </span>
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: tierColor, fontFamily: "Outfit, sans-serif", letterSpacing: "0.04em" }}
          >
            Compact
          </span>
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
      className="grid grid-cols-2 gap-2 flex-1 min-h-0"
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
          <div
            className="text-xs text-center py-6"
            style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}
          >
            No data yet
          </div>
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
          <div
            className="text-xs text-center py-6"
            style={{ color: "var(--eg-text-dim)", fontFamily: "Outfit, sans-serif" }}
          >
            No data yet
          </div>
        )}
      </TableShell>
    </motion.div>
  );
}
