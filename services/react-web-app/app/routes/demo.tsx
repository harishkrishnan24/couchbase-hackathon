import type { Route } from "./+types/demo";
import { usePipelineLoop } from "~/hooks/usePipelineLoop";
import { useEventStream } from "~/hooks/useEventStream";
import { PipelineView } from "~/components/pipeline/PipelineView";
import { HeaderBar } from "~/components/dashboard/HeaderBar";
import { TurbineCard } from "~/components/dashboard/TurbineCard";
import { StoragePanel } from "~/components/dashboard/StoragePanel";
import { DataTables } from "~/components/dashboard/DataTables";
import { IntroTour } from "~/components/dashboard/IntroTour";
import { usePipelineStore } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import { motion, AnimatePresence } from "framer-motion";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "EdgeGuard — Vattenfall Wind Operations" },
    { name: "description", content: "EdgeGuard: Edge-Cloud Pipeline Intelligence" },
  ];
}

function BootOverlay() {
  const localInitialize = usePipelineStore((s) => s.initialize);

  const handleInitialize = async () => {
    try {
      await edgeguardApi.initialize();
    } catch {
      // Fallback to local if backend unreachable
    }
    localInitialize();
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ backgroundColor: "#f0f4f8" }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,135,205,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,135,205,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center gap-10"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Vattenfall logo */}
        <div className="flex items-center gap-3">
          <img
            src="/vattenfall-logo-grey.svg"
            alt="Vattenfall"
            className="h-12 w-auto"
          />
          <div className="w-px h-8 bg-slate-200 shrink-0" />
          <span
            className="text-3xl font-semibold"
            style={{ color: "#0087cd", fontFamily: "Outfit, sans-serif" }}
          >
            EdgeGuard
          </span>
        </div>

        {/* Tagline */}
        <p className="text-sm font-medium tracking-wide" style={{ color: "#64748b" }}>
          Wind Turbine Edge Intelligence Platform
        </p>

        {/* Status checklist */}
        <motion.div
          className="flex items-center gap-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {["Turbines", "Edge AI", "Couchbase", "Sync Gateway"].map((sys, i) => (
            <motion.div
              key={sys}
              className="flex items-center gap-2 text-sm"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
            >
              <motion.div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: "#f59e0b" }}
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.2 + i * 0.2, repeat: Infinity }}
              />
              <span style={{ color: "#64748b", fontFamily: "Outfit, sans-serif" }}>{sys}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Initialize button */}
        <motion.button
          onClick={handleInitialize}
          className="px-10 py-3 rounded-lg text-sm font-semibold text-white transition-all"
          style={{
            backgroundColor: "#0087cd",
            fontFamily: "Outfit, sans-serif",
            letterSpacing: "0.04em",
          }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, type: "spring", stiffness: 200, damping: 20 }}
          whileHover={{ backgroundColor: "#005f8e", scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          Initialize System
        </motion.button>

        <p className="text-xs" style={{ color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace" }}>
          v2.1.0 — Tiered Compaction Engine
        </p>
      </motion.div>
    </motion.div>
  );
}

export default function Demo() {
  const isRunning = usePipelineStore((s) => s.isRunning);
  const isInitialized = usePipelineStore((s) => s.isInitialized);
  const introComplete = usePipelineStore((s) => s.introComplete);

  usePipelineLoop(isRunning);
  useEventStream(isInitialized);

  const showBoot = !isInitialized;
  const showTour = isInitialized && !introComplete;

  return (
    <div className="vattenfall-demo min-h-screen demo-bg text-[var(--eg-text)]">
      <AnimatePresence>
        {showBoot && <BootOverlay />}
      </AnimatePresence>

      <AnimatePresence>
        {showTour && <IntroTour />}
      </AnimatePresence>

      {/* Main layout: vertical stacking */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <HeaderBar />

        <div className="flex-1 p-4 space-y-4 pb-8">
          {/* Turbine cards row */}
          <div className="grid grid-cols-3 gap-4">
            <TurbineCard turbineId={1} delay={0.05} />
            <TurbineCard turbineId={2} delay={0.1} />
            <TurbineCard turbineId={3} delay={0.15} />
          </div>

          {/* Data pipeline — full width */}
          <PipelineView />

          {/* Storage panels — 2-column */}
          <StoragePanel delay={0.1} />

          {/* Data tables — 2-column */}
          <DataTables />
        </div>
      </div>
    </div>
  );
}

