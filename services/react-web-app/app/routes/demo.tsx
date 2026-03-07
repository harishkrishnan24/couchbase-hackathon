import type { Route } from "./+types/demo";
import { usePipelineLoop } from "~/hooks/usePipelineLoop";
import { useEventStream } from "~/hooks/useEventStream";
import { PipelineView } from "~/components/pipeline/PipelineView";
import { HeaderBar } from "~/components/dashboard/HeaderBar";
import { TurbineCard } from "~/components/dashboard/TurbineCard";
import { StoragePanel } from "~/components/dashboard/StoragePanel";
import { ConnectionToggle } from "~/components/dashboard/ConnectionToggle";
import { DataTables } from "~/components/dashboard/DataTables";
import { IntroTour } from "~/components/dashboard/IntroTour";
import { usePipelineStore } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck } from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "EdgeGuard AI — Command Center" },
    { name: "description", content: "EdgeGuard AI: Edge-Cloud Pipeline Intelligence" },
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
      style={{ backgroundColor: "#05080f" }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    >
      {/* Scanlines atmosphere */}
      <div className="absolute inset-0 eg-atmosphere pointer-events-none" />

      {/* Grid background */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: "linear-gradient(var(--eg-flow) 1px, transparent 1px), linear-gradient(90deg, var(--eg-flow) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Central content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Logo glow ring */}
        <motion.div
          className="relative"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
        >
          <div className="w-28 h-28 rounded-full border-2 border-[var(--eg-flow)]/30 flex items-center justify-center relative">
            <motion.div
              className="absolute inset-0 rounded-full border border-[var(--eg-flow)]/20"
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute inset-0 rounded-full border border-[var(--eg-flow)]/10"
              animate={{ scale: [1, 1.6, 1], opacity: [0.2, 0, 0.2] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            />
            <ShieldCheck className="w-12 h-12 text-[var(--eg-flow)]" strokeWidth={1.5} />
          </div>
        </motion.div>

        {/* Title */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          <h1
            className="font-display text-3xl font-bold tracking-[0.2em] text-[var(--eg-flow)] mb-2"
            style={{ textShadow: "0 0 30px var(--eg-flow-dim), 0 0 80px var(--eg-flow-glow)" }}
          >
            EDGEGUARD AI
          </h1>
          <motion.p
            className="font-display text-[11px] tracking-[0.35em] text-[var(--eg-text-dim)] uppercase"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
          >
            Edge-Cloud Pipeline Intelligence
          </motion.p>
        </motion.div>

        {/* Status indicators */}
        <motion.div
          className="flex items-center gap-6 text-[9px] font-display tracking-[0.2em]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.0, duration: 0.5 }}
        >
          {["TURBINES", "EDGE AI", "COUCHBASE", "SYNC VALVE"].map((sys, i) => (
            <motion.div
              key={sys}
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.0 + i * 0.15 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--eg-alert)] animate-pulse" />
              <span className="text-[var(--eg-text-dim)]">{sys}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Initialize button */}
        <motion.button
          onClick={handleInitialize}
          className="relative mt-4 px-10 py-4 rounded-lg font-display text-sm tracking-[0.25em] font-bold text-[var(--eg-flow)] border-2 border-[var(--eg-flow)]/40 bg-[var(--eg-flow)]/5 overflow-hidden group"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, type: "spring", stiffness: 200, damping: 20 }}
          whileHover={{ scale: 1.04, borderColor: "rgba(0,229,255,0.6)" }}
          whileTap={{ scale: 0.97 }}
        >
          <motion.div
            className="absolute inset-0 bg-[var(--eg-flow)]/10"
            animate={{ opacity: [0, 0.15, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="relative z-10">INITIALIZE SYSTEM</span>
        </motion.button>

        {/* Version */}
        <motion.p
          className="text-[8px] font-mono text-[var(--eg-muted)] tracking-widest mt-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8 }}
        >
          v2.1.0 — TIERED COMPACTION ENGINE
        </motion.p>
      </div>
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
    <div className="edgeguard-demo min-h-screen demo-bg eg-atmosphere text-[var(--eg-text)]" style={{ backgroundColor: "#05080f" }}>
      <AnimatePresence>
        {showBoot && <BootOverlay />}
      </AnimatePresence>

      <AnimatePresence>
        {showTour && <IntroTour />}
      </AnimatePresence>

      {/* Layout container */}
      <div className="relative z-10 flex flex-col h-screen">
        <HeaderBar />

        <div className="flex-1 grid grid-cols-[220px_1fr_240px] gap-4 p-4 min-h-0 pb-10">
          {/* Left: Turbine cards + connection toggle */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <TurbineCard turbineId={1} delay={0.1} />
            <TurbineCard turbineId={2} delay={0.2} />
            <TurbineCard turbineId={3} delay={0.3} />
            <ConnectionToggle delay={0.4} />
          </div>

          {/* Center: Pipeline on top, data tables filling below */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="shrink-0">
              <PipelineView />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <DataTables />
            </div>
          </div>

          {/* Right: Storage panels (summary only) */}
          <div className="overflow-y-auto">
            <StoragePanel delay={0.2} />
          </div>
        </div>
      </div>
    </div>
  );
}
