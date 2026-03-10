import { motion } from "framer-motion";
import { usePipelineStore, EDGE_CAPACITY } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import { Play, Square, Wifi, WifiOff, Trash2 } from "lucide-react";

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

  const btnBase = "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all border";
  const btnPrimary = `${btnBase} text-white border-transparent`;
  const btnOutline = `${btnBase} bg-white border-[#e2e8f0] text-[#334155] hover:border-[#0087cd] hover:text-[#0087cd]`;

  return (
    <>
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {showControls && (
          isRunning ? (
            <button
              onClick={stopSimulation}
              className={`${btnPrimary} bg-[#ef4444] hover:bg-[#dc2626]`}
              style={{ fontFamily: "Outfit, sans-serif" }}
            >
              <Square className="w-3 h-3" />
              Stop System
            </button>
          ) : (
            <button
              onClick={startSimulation}
              className={`${btnPrimary} bg-[#0087cd] hover:bg-[#005f8e]`}
              style={{ fontFamily: "Outfit, sans-serif" }}
            >
              <Play className="w-3 h-3" />
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
            ? <><WifiOff className="w-3 h-3" /> Disconnect Link</>
            : <><Wifi className="w-3 h-3" /> Restore Link</>
          }
        </button>

        <button
          onClick={handleClear}
          className={`${btnOutline} hover:border-[#ef4444] hover:text-[#ef4444]`}
          style={{ fontFamily: "Outfit, sans-serif" }}
        >
          <Trash2 className="w-3 h-3" />
          Clear Database
        </button>
      </div>

      {/* Status tags */}
      <div className="flex items-center gap-2">
        {[
          { label: "Edge capacity", value: EDGE_CAPACITY.toString() },
          { label: "Edge buffer", value: edgeStorage.length.toString() },
        ].map(({ label, value }) => (
          <span
            key={label}
            className="px-2.5 py-1 rounded-full text-xs font-medium border"
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
    </>
  );
}

// ─── HeaderBar ────────────────────────────────────────────────────────────────

export function HeaderBar() {
  const isOnline = usePipelineStore((s) => s.isOnline);
  const connStatus = isOnline ? "Online" : "Offline";

  return (
    <motion.header
      className="flex items-center justify-between px-4 py-2 border-b shrink-0"
      style={{ borderColor: "#e2e8f0", backgroundColor: "#ffffff" }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <VattenfallLogo />

      <div className="flex items-center gap-2">
        <ControlBar />
      </div>

      {/* Connection pill only */}
      <StatusPill
        label="Connection"
        value={connStatus}
        variant={isOnline ? "online" : "offline"}
      />
    </motion.header>
  );
}

