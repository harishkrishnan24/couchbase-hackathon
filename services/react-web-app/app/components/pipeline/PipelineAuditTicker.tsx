import Marquee from "react-fast-marquee";
import { motion, AnimatePresence } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import type { CompactionLogEntry } from "~/stores/pipelineStore";

const SEVERITY_CONFIG: Record<CompactionLogEntry["severity"], { icon: string; color: string }> = {
  compaction: { icon: "⚡", color: "var(--eg-alert)" },
  sync: { icon: "↑", color: "var(--eg-ok)" },
  warning: { icon: "▲", color: "var(--eg-anomaly)" },
  info: { icon: "●", color: "var(--eg-flow)" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PipelineAuditTicker() {
  const compactionLogs = usePipelineStore((s) => s.compactionLogs);
  const latest = compactionLogs.length > 0 ? compactionLogs[compactionLogs.length - 1] : null;

  const items =
    compactionLogs.length > 0
      ? compactionLogs
      : [{ message: "SYSTEM NOMINAL — NO COMPACTION EVENTS", timestamp: Date.now(), severity: "info" as const }];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.5 }}
      className="fixed bottom-0 left-0 right-0 z-50"
    >
      {/* Flash banner for latest event */}
      <AnimatePresence>
        {latest && latest.severity === "compaction" && (
          <motion.div
            key={latest.timestamp}
            initial={{ opacity: 1, height: "auto" }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 2, exit: { duration: 0.3 } }}
            className="bg-[var(--eg-alert)]/10 border-t border-[var(--eg-alert)]/30 text-center py-1"
          >
            <span className="text-[10px] font-display tracking-[0.15em] text-[var(--eg-alert)]">
              ⚡ {latest.message}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrolling ticker */}
      <div className="bg-[var(--eg-surface)]/95 border-t border-[var(--eg-border)] py-2 backdrop-blur-sm">
        <Marquee
          speed={40}
          gradient={false}
          className="text-[10px] font-mono"
        >
          {items.map((entry, i) => {
            const cfg = SEVERITY_CONFIG[entry.severity];
            return (
              <span key={i} className="mx-8 whitespace-nowrap flex items-center gap-2">
                <span style={{ color: cfg.color }}>{cfg.icon}</span>
                <span className="text-[var(--eg-text-dim)]">
                  [{formatTime(entry.timestamp)}]
                </span>
                <span style={{ color: cfg.color }}>{entry.message}</span>
              </span>
            );
          })}
        </Marquee>
      </div>
    </motion.div>
  );
}
