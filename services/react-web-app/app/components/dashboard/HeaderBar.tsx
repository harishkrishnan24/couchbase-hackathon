import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { usePipelineStore, EDGE_CAPACITY } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import { Play, Square, Settings, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export function HeaderBar() {
  const isOnline = usePipelineStore((s) => s.isOnline);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const isInitialized = usePipelineStore((s) => s.isInitialized);
  const introComplete = usePipelineStore((s) => s.introComplete);
  const totalPackets = usePipelineStore((s) => s.totalPacketsEmitted);
  const totalAnomalies = usePipelineStore((s) => s.totalAnomalies);
  const edgeStorage = usePipelineStore((s) => s.edgeStorage);

  const setEdgeStorage = usePipelineStore((s) => s.setEdgeStorage);
  const setCentralStorage = usePipelineStore((s) => s.setCentralStorage);

  const startSimulation = () => { edgeguardApi.start().catch(() => {}); };
  const stopSimulation = () => { edgeguardApi.stop().catch(() => {}); };

  const handleClearAllData = () => {
    setEdgeStorage([]);
    setCentralStorage([]);
    edgeguardApi.clearAllStorage().catch(() => {});
  };

  const [clock, setClock] = useState(formatClock());

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const anomalyRate = totalPackets > 0
    ? ((totalAnomalies / totalPackets) * 100).toFixed(1)
    : "0.0";
  const utilization = ((edgeStorage.length / EDGE_CAPACITY) * 100).toFixed(0);

  const showStartStop = isInitialized && introComplete;

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="flex items-center justify-between px-5 py-3 border-b border-[var(--eg-border)] bg-[var(--eg-panel)]"
    >
      {/* Left: title */}
      <div className="flex items-center gap-4">
        <h1 className="font-display text-lg font-bold tracking-[0.12em] text-[var(--eg-flow)]"
            style={{ textShadow: "0 0 20px var(--eg-flow-dim), 0 0 60px var(--eg-flow-glow)" }}>
          EDGEGUARD AI
        </h1>
        <div className="flex items-center gap-1.5">
          <div className={`eg-led ${isRunning ? (isOnline ? "eg-led-online" : "eg-led-offline") : ""}`}
               style={!isRunning ? { backgroundColor: "var(--eg-muted)", boxShadow: "none" } : undefined} />
          <span className={`text-[10px] font-display tracking-[0.2em] font-bold ${
            !isRunning ? "text-[var(--eg-muted)]" : isOnline ? "text-[var(--eg-ok)]" : "text-[var(--eg-anomaly)]"
          }`}>
            {!isRunning ? "STANDBY" : isOnline ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Center: metrics + control */}
      <div className="hidden md:flex items-center gap-6">
        {isRunning && (
          <>
            <Metric label="PACKETS" value={totalPackets.toString()} />
            <Metric label="ANOMALY RATE" value={`${anomalyRate}%`} color={parseFloat(anomalyRate) > 10 ? "var(--eg-anomaly)" : undefined} />
            <Metric label="EDGE UTIL" value={`${utilization}%`} color={parseInt(utilization) > 80 ? "var(--eg-anomaly)" : parseInt(utilization) > 50 ? "var(--eg-alert)" : undefined} />
          </>
        )}
      </div>

      {/* Right: start/stop + settings + clock */}
      <div className="flex items-center gap-4">
        {/* START / STOP toggle */}
        {showStartStop && (
          isRunning ? (
            <motion.button
              onClick={stopSimulation}
              className="flex items-center gap-2 px-5 py-2 rounded-md border border-[var(--eg-anomaly)]/50 bg-[var(--eg-anomaly)]/10 text-[var(--eg-anomaly)] font-display text-[10px] tracking-[0.18em] font-bold hover:bg-[var(--eg-anomaly)]/20 transition-colors"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Square className="w-3 h-3" />
              STOP SYSTEM
            </motion.button>
          ) : (
            <motion.button
              onClick={startSimulation}
              className="flex items-center gap-2 px-5 py-2 rounded-md border-2 border-[var(--eg-ok)]/60 bg-[var(--eg-ok)]/10 text-[var(--eg-ok)] font-display text-[10px] tracking-[0.18em] font-bold hover:bg-[var(--eg-ok)]/20 transition-colors"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              animate={{ boxShadow: ["0 0 0px rgba(0,230,118,0)", "0 0 16px rgba(0,230,118,0.3)", "0 0 0px rgba(0,230,118,0)"] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Play className="w-3 h-3" />
              START SYSTEM
            </motion.button>
          )
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded-md text-[var(--eg-text-dim)] hover:text-[var(--eg-flow)] hover:bg-[var(--eg-surface)]/50 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem] bg-[var(--eg-panel)] border-[var(--eg-border)]">
            <DropdownMenuItem
              variant="destructive"
              onClick={handleClearAllData}
              className="font-display text-[10px] tracking-[0.1em] cursor-pointer focus:bg-[var(--eg-anomaly)]/10 focus:text-[var(--eg-anomaly)]"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Clear data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="font-mono text-[11px] text-[var(--eg-text-dim)] tracking-wider">
          {clock}
        </span>
      </div>
    </motion.header>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[8px] font-display tracking-[0.2em] text-[var(--eg-text-dim)] mb-0.5">
        {label}
      </div>
      <div
        className="font-mono text-xs font-bold"
        style={{ color: color || "var(--eg-text-bright)" }}
      >
        {value}
      </div>
    </div>
  );
}

function formatClock(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
