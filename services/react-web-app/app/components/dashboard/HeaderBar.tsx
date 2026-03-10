import { motion } from "framer-motion";
import { usePipelineStore, EDGE_CAPACITY } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import { Play, Square, Wifi, WifiOff, Network, Trash2 } from "lucide-react";

// ─── Vattenfall logo mark ────────────────────────────────────────────────────

function VattenfallLogo() {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/vattenfall-logo-grey.svg"
        alt="Vattenfall"
        className="h-8 w-auto shrink-0"
      />
      <div className="w-px h-6 bg-slate-200 shrink-0" />
      <span
        className="text-xl font-semibold"
        style={{ color: "#0087cd", fontFamily: "Outfit, sans-serif" }}
      >
        EdgeGuard
      </span>
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: string;
  variant?: "default" | "online" | "offline" | "warning";
}) {
  const valueColors: Record<string, string> = {
    default: "#0f172a",
    online: "#16a34a",
    offline: "#dc2626",
    warning: "#d97706",
  };

  return (
    <div
      className="flex flex-col items-end px-4 py-1.5 rounded-md border"
      style={{ borderColor: "#e2e8f0", backgroundColor: "#f8fafc", minWidth: 80 }}
    >
      <span className="text-[10px] font-medium" style={{ color: "#94a3b8", fontFamily: "Outfit, sans-serif", letterSpacing: "0.03em" }}>
        {label}
      </span>
      <span
        className="text-sm font-bold leading-tight"
        style={{ color: valueColors[variant], fontFamily: "Outfit, sans-serif" }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── ControlBar — action buttons + status tags ───────────────────────────────

function ControlBar() {
  const isOnline = usePipelineStore((s) => s.isOnline);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const isInitialized = usePipelineStore((s) => s.isInitialized);
  const introComplete = usePipelineStore((s) => s.introComplete);
  const edgeStorage = usePipelineStore((s) => s.edgeStorage);
  const setEdgeStorage = usePipelineStore((s) => s.setEdgeStorage);
  const setCentralStorage = usePipelineStore((s) => s.setCentralStorage);

  const startSimulation = () => { edgeguardApi.start().catch(() => {}); };
  const stopSimulation  = () => { edgeguardApi.stop().catch(() => {}); };
  const toggleOnline    = () => { edgeguardApi.setConnection(!isOnline).catch(() => {}); };
  const handleClear     = () => {
    setEdgeStorage([]);
    setCentralStorage([]);
    edgeguardApi.clearAllStorage().catch(() => {});
  };

  const showControls = isInitialized && introComplete;

  const btnBase = "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border";
  const btnPrimary = `${btnBase} text-white border-transparent`;
  const btnOutline = `${btnBase} bg-white border-[#e2e8f0] text-[#334155] hover:border-[#0087cd] hover:text-[#0087cd]`;

  return (
    <div
      className="flex items-center justify-between px-5 py-2 border-b"
      style={{ borderColor: "#e2e8f0", backgroundColor: "#f8fafc" }}
    >
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {showControls && (
          isRunning ? (
            <button
              onClick={stopSimulation}
              className={`${btnPrimary} bg-[#ef4444] hover:bg-[#dc2626]`}
              style={{ fontFamily: "Outfit, sans-serif" }}
            >
              <Square className="w-3.5 h-3.5" />
              Stop System
            </button>
          ) : (
            <button
              onClick={startSimulation}
              className={`${btnPrimary} bg-[#0087cd] hover:bg-[#005f8e]`}
              style={{ fontFamily: "Outfit, sans-serif" }}
            >
              <Play className="w-3.5 h-3.5" />
              Start System
            </button>
          )
        )}

        <button
          onClick={toggleOnline}
          className={btnOutline}
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          {isOnline
            ? <><WifiOff className="w-3.5 h-3.5" /> Disconnect Link</>
            : <><Wifi className="w-3.5 h-3.5" /> Restore Link</>
          }
        </button>

        <button
          className={btnOutline}
          style={{ fontFamily: "Outfit, sans-serif" }}
          disabled
        >
          <Network className="w-3.5 h-3.5" />
          Open Mesh Gateway
        </button>

        <button
          onClick={handleClear}
          className={`${btnOutline} hover:border-[#ef4444] hover:text-[#ef4444]`}
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Database
        </button>
      </div>

      {/* Status tags */}
      <div className="flex items-center gap-2">
        {[
          { label: "System", value: isRunning ? "Running" : "Idle" },
          { label: "Edge capacity", value: EDGE_CAPACITY.toString() },
          { label: "Edge buffer", value: edgeStorage.length.toString() },
        ].map(({ label, value }) => (
          <span
            key={label}
            className="px-3 py-1 rounded-full text-xs font-medium border"
            style={{
              borderColor: "#e2e8f0",
              backgroundColor: "#ffffff",
              color: "#64748b",
              fontFamily: "Outfit, sans-serif",
            }}
          >
            {label} {value}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── HeaderBar ────────────────────────────────────────────────────────────────

export function HeaderBar() {
  const isOnline     = usePipelineStore((s) => s.isOnline);
  const isRunning    = usePipelineStore((s) => s.isRunning);
  const totalAnomalies = usePipelineStore((s) => s.totalAnomalies);
  const totalPackets   = usePipelineStore((s) => s.totalPacketsEmitted);

  const systemStatus = !isRunning ? "Standby" : "Running";
  const connStatus   = isOnline ? "Online" : "Offline";
  const anomalyStr   = `${totalAnomalies}/${totalPackets}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {/* Top bar: logo + status pills */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: "#e2e8f0", backgroundColor: "#ffffff" }}
      >
        <VattenfallLogo />

        <div className="flex items-center gap-3">
          <StatusPill label="System" value={systemStatus} variant={isRunning ? "online" : "default"} />
          <StatusPill
            label="Connection"
            value={connStatus}
            variant={isOnline ? "online" : "offline"}
          />
          <StatusPill label="Anomalies" value={anomalyStr} variant={totalAnomalies > 0 ? "warning" : "default"} />
        </div>
      </header>

      {/* Control bar */}
      <ControlBar />
    </motion.div>
  );
}

