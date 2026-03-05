import { motion, AnimatePresence } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";

export function ConnectionToggle({ delay }: { delay: number }) {
  const isOnline = usePipelineStore((s) => s.isOnline);
  const setOnline = (online: boolean) => {
    edgeguardApi.setConnection(online).catch(() => {});
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay }}
      className="eg-panel p-3"
    >
      <div className="text-center mb-3">
        <span className="font-display text-[10px] tracking-[0.15em] text-[var(--eg-text-dim)] font-bold">
          NETWORK CONTROL
        </span>
      </div>

      <button
        onClick={() => setOnline(!isOnline)}
        className={`relative w-full py-3 rounded-lg font-display text-[11px] tracking-[0.2em] font-bold transition-all duration-300 overflow-hidden ${
          isOnline
            ? "bg-[var(--eg-ok)]/10 border-2 border-[var(--eg-ok)]/40 text-[var(--eg-ok)] hover:bg-[var(--eg-ok)]/20"
            : "bg-[var(--eg-anomaly)]/10 border-2 border-[var(--eg-anomaly)]/40 text-[var(--eg-anomaly)] hover:bg-[var(--eg-anomaly)]/20"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={isOnline ? "kill" : "restore"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="block"
          >
            {isOnline ? "KILL CONNECTION" : "RESTORE LINK"}
          </motion.span>
        </AnimatePresence>
      </button>

      {/* Signal indicator */}
      <div className="flex items-center justify-center gap-1 mt-2.5">
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className="w-1 rounded-full transition-all duration-300"
            style={{
              height: `${bar * 4 + 4}px`,
              backgroundColor: isOnline
                ? bar <= 4 ? "var(--eg-ok)" : "var(--eg-muted)"
                : bar <= 0 ? "var(--eg-anomaly)" : "var(--eg-muted)",
              opacity: isOnline ? 1 : 0.3,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
