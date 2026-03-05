import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";

const TOUR_STEPS = [
  {
    title: "WIND TURBINES",
    subtitle: "Data Sources",
    description: "Three turbines generating real-time telemetry data. Click any turbine to inject anomaly bursts.",
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="14" r="4" fill="var(--eg-flow)" opacity="0.8" />
        <line x1="20" y1="14" x2="20" y2="0" stroke="var(--eg-flow)" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="14" x2="8" y2="24" stroke="var(--eg-flow)" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="14" x2="32" y2="24" stroke="var(--eg-flow)" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="14" x2="20" y2="32" stroke="var(--eg-flow)" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="12" y="32" width="16" height="4" rx="1" fill="var(--eg-flow)" opacity="0.4" />
      </svg>
    ),
  },
  {
    title: "EDGE AI",
    subtitle: "Isolation Forest",
    description: "Anomaly detection layer scores every data point in real-time using Isolation Forest algorithm.",
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="var(--eg-surface)" stroke="var(--eg-flow)" strokeWidth="1.5" />
        <line x1="12" y1="16" x2="28" y2="16" stroke="var(--eg-flow)" strokeWidth="0.8" opacity="0.5" />
        <line x1="12" y1="20" x2="28" y2="20" stroke="var(--eg-flow)" strokeWidth="0.8" opacity="0.5" />
        <line x1="12" y1="24" x2="28" y2="24" stroke="var(--eg-flow)" strokeWidth="0.8" opacity="0.5" />
        <circle cx="20" cy="20" r="4" fill="var(--eg-flow)" opacity="0.3" />
      </svg>
    ),
  },
  {
    title: "EDGE COUCHBASE",
    subtitle: "Local Buffer Storage",
    description: "Tiered compaction engine stores data locally. When offline, data compacts automatically to save space.",
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="6" y="6" width="28" height="28" rx="4" fill="var(--eg-surface)" stroke="var(--eg-flow)" strokeWidth="1.5" />
        <ellipse cx="20" cy="12" rx="10" ry="3" fill="none" stroke="var(--eg-flow)" strokeWidth="0.8" />
        <rect x="10" y="12" width="20" height="14" fill="none" stroke="var(--eg-flow)" strokeWidth="0.8" />
        <ellipse cx="20" cy="26" rx="10" ry="3" fill="none" stroke="var(--eg-flow)" strokeWidth="0.8" />
      </svg>
    ),
  },
  {
    title: "SYNC VALVE & CENTRAL",
    subtitle: "Cloud Synchronization",
    description: "Click the valve to toggle connectivity. When open, edge data syncs to central Couchbase in the cloud.",
    icon: (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="2" y="14" width="10" height="12" rx="2" fill="var(--eg-surface)" stroke="var(--eg-flow)" strokeWidth="1" />
        <ellipse cx="20" cy="20" rx="8" ry="10" fill="var(--eg-surface)" stroke="var(--eg-flow)" strokeWidth="1.5" />
        <rect x="28" y="14" width="10" height="12" rx="2" fill="var(--eg-surface)" stroke="var(--eg-flow)" strokeWidth="1" />
        <path d="M 16 20 L 18 18 L 18 22 Z" fill="var(--eg-flow)" opacity="0.5" />
        <path d="M 22 20 L 24 18 L 24 22 Z" fill="var(--eg-flow)" opacity="0.5" />
      </svg>
    ),
  },
];

const AUTO_ADVANCE_MS = 3500;

export function IntroTour() {
  const completeIntro = usePipelineStore((s) => s.completeIntro);
  const [step, setStep] = useState(0);

  const advance = useCallback(() => {
    setStep((prev) => {
      if (prev >= TOUR_STEPS.length - 1) {
        completeIntro();
        return prev;
      }
      return prev + 1;
    });
  }, [completeIntro]);

  const skip = useCallback(() => {
    completeIntro();
  }, [completeIntro]);

  useEffect(() => {
    const timer = setTimeout(advance, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [step, advance]);

  const current = TOUR_STEPS[step];

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Tour card */}
      <div className="relative z-10 flex flex-col items-center gap-6 max-w-md px-8">
        {/* Step indicator dots */}
        <div className="flex items-center gap-2">
          {TOUR_STEPS.map((_, i) => (
            <motion.div
              key={i}
              className="rounded-full"
              animate={{
                width: i === step ? 20 : 6,
                height: 6,
                backgroundColor: i === step ? "var(--eg-flow)" : "var(--eg-muted)",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="flex flex-col items-center gap-4 text-center"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {/* Icon with glow ring */}
            <div className="w-20 h-20 rounded-full border border-[var(--eg-flow)]/30 flex items-center justify-center relative">
              <motion.div
                className="absolute inset-0 rounded-full border border-[var(--eg-flow)]/15"
                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0, 0.2] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
              {current.icon}
            </div>

            <div>
              <h2 className="font-display text-xl font-bold tracking-[0.2em] text-[var(--eg-flow)] mb-1"
                  style={{ textShadow: "0 0 20px var(--eg-flow-dim)" }}>
                {current.title}
              </h2>
              <p className="font-display text-[10px] tracking-[0.25em] text-[var(--eg-alert)] uppercase font-bold">
                {current.subtitle}
              </p>
            </div>

            <p className="text-sm text-[var(--eg-text)] leading-relaxed max-w-xs">
              {current.description}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Controls */}
        <div className="flex items-center gap-4 mt-2">
          <button
            onClick={skip}
            className="px-4 py-2 text-[10px] font-display tracking-[0.15em] text-[var(--eg-text-dim)] hover:text-[var(--eg-text-bright)] transition-colors"
          >
            SKIP TOUR
          </button>
          <motion.button
            onClick={advance}
            className="px-6 py-2 rounded-md border border-[var(--eg-flow)]/40 bg-[var(--eg-flow)]/10 text-[var(--eg-flow)] font-display text-[10px] tracking-[0.18em] font-bold hover:bg-[var(--eg-flow)]/20 transition-colors"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {step >= TOUR_STEPS.length - 1 ? "GET STARTED" : "NEXT"}
          </motion.button>
        </div>

        {/* Progress bar */}
        <div className="w-48 h-0.5 bg-[var(--eg-border)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[var(--eg-flow)] rounded-full"
            key={step}
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: AUTO_ADVANCE_MS / 1000, ease: "linear" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
