import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { usePipelineStore } from "~/stores/pipelineStore";
import { COMPACTION_THRESHOLD, EDGE_CAPACITY } from "~/stores/pipelineStore";
import { edgeguardApi } from "~/lib/api";
import {
  BRAIN_X,
  BUFFER_X,
  CENTRAL_X,
  packetPosition,
  PIPE_END_X,
  PIPE_PATH_LEFT,
  PIPE_PATH_RIGHT,
  PIPE_START_X,
  PIPE_Y,
  TURBINE_POSITIONS,
  VALVE_X,
} from "~/components/pipeline/pipelineGeometry";
import { isCompactedBlock, isDataPoint } from "~/types/edgeguard";

const VIEW = { width: 1100, height: 350 };

/** Progress along "to-buffer" at which the packet passes the Edge AI chip (turns red when anomaly). */
const BRAIN_PROGRESS = (BRAIN_X - PIPE_START_X) / (BUFFER_X - PIPE_START_X);

/** Degrees per second when spinning (normal). ~2.5s per full revolution. */
const BLADE_SPIN_SPEED = 360 / 2.5;
/** Duration of coast-down when turbine is switched off (seconds). */
const COAST_DURATION = 2.2;

function TurbineGlyph({
  x,
  y,
  hubY,
  active,
  label,
  isRunning,
  enabled,
  onActivate,
}: {
  x: number;
  y: number;
  hubY: number;
  active: boolean;
  label: string;
  isRunning: boolean;
  enabled: boolean;
  onActivate: () => void;
}) {
  const dormant = !isRunning || !enabled;
  const bladeColor = dormant
    ? "var(--eg-muted)"
    : active
      ? "var(--eg-anomaly)"
      : "var(--eg-flow)";
  const hubColor = dormant ? "var(--eg-muted)" : active ? "var(--eg-anomaly)" : "var(--eg-flow)";

  const [rotation, setRotation] = useState(0);
  const [coasting, setCoasting] = useState(false);
  const prevEnabledRef = useRef(enabled);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const spinning = isRunning && enabled;

  // Spin loop: only when enabled and running
  useEffect(() => {
    if (!spinning) return;
    setCoasting(false);
    lastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      setRotation((r) => (r + BLADE_SPIN_SPEED * delta) % 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [spinning]);

  // When switched off after being on: coast down to standstill
  useEffect(() => {
    if (enabled) {
      prevEnabledRef.current = true;
      return;
    }
    if (prevEnabledRef.current && isRunning) {
      prevEnabledRef.current = false;
      setCoasting(true);
      const start = rotation;
      const controls = animate(start, start + 360, {
        duration: COAST_DURATION,
        ease: "easeOut",
        onUpdate: (v) => setRotation(v),
        onComplete: () => setCoasting(false),
      });
      return () => controls.stop();
    }
    prevEnabledRef.current = false;
  }, [enabled, isRunning]);

  const showBeam = isRunning && enabled;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={active ? `${label} anomaly burst active` : `${label} send anomaly burst`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isRunning && enabled) onActivate();
        }
      }}
      style={{ cursor: isRunning && enabled ? "pointer" : "default" }}
      onClick={() => isRunning && enabled && onActivate()}
    >
      {/* Tower */}
      <line
        x1={x}
        y1={y}
        x2={x}
        y2={hubY + 10}
        stroke={dormant ? "var(--eg-muted)" : active ? "var(--eg-anomaly)" : "var(--eg-border-bright)"}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={dormant ? 0.4 : 1}
      />

      {/* Base */}
      <rect
        x={x - 14}
        y={y - 4}
        width={28}
        height={8}
        rx={2}
        fill="var(--eg-surface)"
        stroke={dormant ? "var(--eg-muted)" : active ? "var(--eg-anomaly)" : "var(--eg-border-bright)"}
        strokeWidth={1.2}
        opacity={dormant ? 0.4 : 1}
      />

      {/* Hub */}
      <circle
        cx={x}
        cy={hubY}
        r={6}
        fill={hubColor}
        opacity={dormant ? 0.3 : 0.9}
      />
      {active && isRunning && enabled && (
        <circle cx={x} cy={hubY} r={12} fill="none" stroke="var(--eg-anomaly)" strokeWidth={1} opacity={0.4}>
          <animate attributeName="r" values="8;18;8" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Blades: rotate only when spinning or coasting; when off, show at rest */}
      <g transform={`rotate(${rotation} ${x} ${hubY})`}>
        <line x1={x} y1={hubY} x2={x} y2={hubY - 26} stroke={bladeColor} strokeWidth={2.5} strokeLinecap="round" opacity={dormant && !coasting ? 0.3 : 1} />
        <line x1={x} y1={hubY} x2={x - 22} y2={hubY + 14} stroke={bladeColor} strokeWidth={2.5} strokeLinecap="round" opacity={dormant && !coasting ? 0.3 : 1} />
        <line x1={x} y1={hubY} x2={x + 22} y2={hubY + 14} stroke={bladeColor} strokeWidth={2.5} strokeLinecap="round" opacity={dormant && !coasting ? 0.3 : 1} />
      </g>

      {/* Data beam from turbine to pipe — only when turbine is on */}
      {showBeam && (
        <line
          x1={x}
          y1={y + 4}
          x2={PIPE_START_X}
          y2={PIPE_Y}
          stroke={active ? "var(--eg-anomaly)" : "var(--eg-flow)"}
          strokeWidth={0.8}
          strokeDasharray="3 6"
          opacity={0.3}
        />
      )}

      {/* Label */}
      <text
        x={x}
        y={y + 22}
        textAnchor="middle"
        fill={dormant ? "var(--eg-muted)" : active ? "var(--eg-anomaly)" : "var(--eg-text-dim)"}
        fontSize="10"
        fontWeight="700"
        fontFamily="Orbitron, sans-serif"
        opacity={dormant ? 0.4 : 1}
      >
        {label}
      </text>
    </g>
  );
}

function packetEntryPosition(sourceTurbine: number, progress: number): { x: number; y: number } {
  const pos = TURBINE_POSITIONS[Math.max(0, Math.min(2, sourceTurbine - 1))];
  const normalized = Math.min(progress / 0.22, 1);
  return {
    x: pos.x + (PIPE_START_X - pos.x) * normalized,
    y: pos.y + (PIPE_Y - pos.y) * normalized,
  };
}

function AIChipNode({ x, y, isActive, isRunning }: { x: number; y: number; isActive: boolean; isRunning: boolean }) {
  const dormant = !isRunning;
  const color = dormant ? "var(--eg-muted)" : "var(--eg-flow)";
  const activeOpacity = dormant ? 0.3 : 1;
  const s = 18;

  return (
    <g transform={`translate(${x}, ${y})`} opacity={activeOpacity}>
      {/* Smooth scale pulse when working (no red flash) */}
      {isRunning && (
        <circle cx={0} cy={0} r={28} fill="none" stroke={color} strokeWidth={0.6} opacity={0.1} className="ai-pulse" />
      )}

      <g>
        {isRunning && (
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1;1.08;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
        )}
        {/* Hexagonal chip shape — always flow color, no red */}
        <polygon
          points={`0,${-s} ${s * 0.87},${-s * 0.5} ${s * 0.87},${s * 0.5} 0,${s} ${-s * 0.87},${s * 0.5} ${-s * 0.87},${-s * 0.5}`}
          fill="var(--eg-surface)"
          stroke={color}
          strokeWidth={1.6}
        />

        {/* Inner circuit lines */}
        <line x1={-6} y1={-6} x2={6} y2={-6} stroke={color} strokeWidth={0.6} opacity={0.4} />
        <line x1={-6} y1={0} x2={6} y2={0} stroke={color} strokeWidth={0.6} opacity={0.4} />
        <line x1={-6} y1={6} x2={6} y2={6} stroke={color} strokeWidth={0.6} opacity={0.4} />
        <line x1={0} y1={-8} x2={0} y2={8} stroke={color} strokeWidth={0.6} opacity={0.3} />

        {/* Pin stubs (left/right) */}
        {[-8, -3, 3, 8].map((dy) => (
          <g key={`pins-${dy}`}>
            <line x1={-s * 0.87} y1={dy} x2={-s * 0.87 - 5} y2={dy} stroke={color} strokeWidth={0.8} opacity={0.3} />
            <line x1={s * 0.87} y1={dy} x2={s * 0.87 + 5} y2={dy} stroke={color} strokeWidth={0.8} opacity={0.3} />
          </g>
        ))}

        {/* Core glow dot */}
        <circle cx={0} cy={0} r={4} fill={color} opacity={dormant ? 0.15 : 0.2}>
          {isRunning && (
            <animate attributeName="opacity" values="0.1;0.25;0.1" dur="3.5s" repeatCount="indefinite" />
          )}
        </circle>
      </g>

      {/* Labels */}
      <text x={0} y={s + 16} textAnchor="middle" fill={dormant ? "var(--eg-muted)" : "var(--eg-text-dim)"} fontSize="8" fontWeight="600" fontFamily="Orbitron, sans-serif" letterSpacing="0.1em">
        EDGE AI
      </text>
      <text x={0} y={s + 26} textAnchor="middle" fill={color} fontSize="7" fontWeight="500" fontFamily="Orbitron, sans-serif" opacity={0.6} letterSpacing="0.05em">
        ISOLATION FOREST
      </text>
    </g>
  );
}

function BufferTank({ x, y, ratio, inCompactionZone, compactionFlash, isRunning }: {
  x: number;
  y: number;
  ratio: number;
  inCompactionZone: boolean;
  compactionFlash: boolean;
  isRunning: boolean;
}) {
  const tankH = 120;
  const tankW = 70;
  const fluidH = ratio * (tankH - 8);
  const dormant = !isRunning;
  const fluidColor = dormant
    ? "var(--eg-muted)"
    : inCompactionZone
      ? "var(--eg-anomaly)"
      : ratio > 0.6
        ? "var(--eg-alert)"
        : "var(--eg-flow)";

  return (
    <g transform={`translate(${x}, ${y})`} opacity={dormant ? 0.4 : 1}>
      {/* Tank outline */}
      <rect
        x={-tankW / 2}
        y={-tankH / 2}
        width={tankW}
        height={tankH}
        rx={6}
        fill="var(--eg-bg)"
        stroke={dormant ? "var(--eg-muted)" : inCompactionZone ? "var(--eg-anomaly)" : "var(--eg-border-bright)"}
        strokeWidth={1.5}
      />

      {/* Capacity markings */}
      {[0.25, 0.5, 0.75].map((mark) => (
        <g key={mark}>
          <line
            x1={-tankW / 2 + 2}
            y1={tankH / 2 - 4 - mark * (tankH - 8)}
            x2={-tankW / 2 + 8}
            y2={tankH / 2 - 4 - mark * (tankH - 8)}
            stroke="var(--eg-muted)"
            strokeWidth={0.5}
          />
          <text
            x={-tankW / 2 + 10}
            y={tankH / 2 - 4 - mark * (tankH - 8) + 3}
            fill="var(--eg-muted)"
            fontSize="6"
            fontFamily="JetBrains Mono, monospace"
          >
            {Math.round(mark * 100)}%
          </text>
        </g>
      ))}

      {/* Fluid fill */}
      <defs>
        <linearGradient id="buffer-fluid" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={fluidColor} stopOpacity="0.85" />
          <stop offset="100%" stopColor={fluidColor} stopOpacity="0.3" />
        </linearGradient>
        <clipPath id="tank-clip">
          <rect x={-tankW / 2 + 2} y={-tankH / 2 + 2} width={tankW - 4} height={tankH - 4} rx={5} />
        </clipPath>
      </defs>

      <g clipPath="url(#tank-clip)">
        <rect
          x={-tankW / 2 + 2}
          y={tankH / 2 - 2 - fluidH}
          width={tankW - 4}
          height={fluidH}
          fill="url(#buffer-fluid)"
        />
        {fluidH > 2 && isRunning && (
          <path
            d={`M ${-tankW / 2 + 2} ${tankH / 2 - 2 - fluidH} Q ${-tankW / 4} ${tankH / 2 - 2 - fluidH - 3} 0 ${tankH / 2 - 2 - fluidH} Q ${tankW / 4} ${tankH / 2 - 2 - fluidH + 3} ${tankW / 2 - 2} ${tankH / 2 - 2 - fluidH}`}
            fill={fluidColor}
            opacity={0.4}
          >
            <animate
              attributeName="d"
              values={`M ${-tankW / 2 + 2} ${tankH / 2 - 2 - fluidH} Q ${-tankW / 4} ${tankH / 2 - 2 - fluidH - 3} 0 ${tankH / 2 - 2 - fluidH} Q ${tankW / 4} ${tankH / 2 - 2 - fluidH + 3} ${tankW / 2 - 2} ${tankH / 2 - 2 - fluidH};M ${-tankW / 2 + 2} ${tankH / 2 - 2 - fluidH} Q ${-tankW / 4} ${tankH / 2 - 2 - fluidH + 3} 0 ${tankH / 2 - 2 - fluidH} Q ${tankW / 4} ${tankH / 2 - 2 - fluidH - 3} ${tankW / 2 - 2} ${tankH / 2 - 2 - fluidH};M ${-tankW / 2 + 2} ${tankH / 2 - 2 - fluidH} Q ${-tankW / 4} ${tankH / 2 - 2 - fluidH - 3} 0 ${tankH / 2 - 2 - fluidH} Q ${tankW / 4} ${tankH / 2 - 2 - fluidH + 3} ${tankW / 2 - 2} ${tankH / 2 - 2 - fluidH}`}
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        )}
      </g>

      {/* Compaction flash overlay */}
      {compactionFlash && (
        <rect
          x={-tankW / 2}
          y={-tankH / 2}
          width={tankW}
          height={tankH}
          rx={6}
          fill="var(--eg-flow)"
          opacity={0.25}
        >
          <animate attributeName="opacity" values="0.3;0" dur="0.5s" fill="freeze" />
        </rect>
      )}

      {/* DB icon inside tank */}
      <g transform="translate(0, -48)">
        <ellipse cx={0} cy={0} rx={10} ry={3} fill="none" stroke={dormant ? "var(--eg-muted)" : "var(--eg-flow)"} strokeWidth={0.6} opacity={0.4} />
        <rect x={-10} y={0} width={20} height={10} fill="none" stroke={dormant ? "var(--eg-muted)" : "var(--eg-flow)"} strokeWidth={0.6} opacity={0.3} />
        <ellipse cx={0} cy={10} rx={10} ry={3} fill="none" stroke={dormant ? "var(--eg-muted)" : "var(--eg-flow)"} strokeWidth={0.6} opacity={0.4} />
      </g>

      {/* Labels */}
      <text x={0} y={tankH / 2 + 16} textAnchor="middle" fill={dormant ? "var(--eg-muted)" : inCompactionZone ? "var(--eg-anomaly)" : "var(--eg-text-dim)"} fontSize="8" fontWeight="600" fontFamily="Orbitron, sans-serif" letterSpacing="0.1em">
        EDGE COUCHBASE
      </text>
      <text x={0} y={tankH / 2 + 28} textAnchor="middle" fill={dormant ? "var(--eg-muted)" : inCompactionZone ? "var(--eg-anomaly)" : "var(--eg-flow)"} fontSize="9" fontWeight="700" fontFamily="JetBrains Mono, monospace">
        {Math.round(ratio * 100)}%
      </text>
    </g>
  );
}

function ValveNode({ x, y, isOnline, isRunning, onToggle }: {
  x: number;
  y: number;
  isOnline: boolean;
  isRunning: boolean;
  onToggle: () => void;
}) {
  const dormant = !isRunning;
  const color = dormant ? "var(--eg-muted)" : isOnline ? "var(--eg-flow)" : "var(--eg-anomaly)";
  const gateRotation = isOnline ? 0 : 90;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      role="button"
      tabIndex={0}
      aria-label={isOnline ? "Close valve to simulate outage" : "Open valve to restore connection"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isRunning) onToggle();
        }
      }}
      onClick={() => isRunning && onToggle()}
      style={{ cursor: isRunning ? "pointer" : "default" }}
      opacity={dormant ? 0.4 : 1}
    >
      {/* Pipe stubs left/right */}
      <rect x={-38} y={-8} width={16} height={16} rx={2} fill="var(--eg-surface)" stroke={color} strokeWidth={1.2} />
      <rect x={22} y={-8} width={16} height={16} rx={2} fill="var(--eg-surface)" stroke={color} strokeWidth={1.2} />

      {/* Valve body - rounded housing */}
      <ellipse cx={0} cy={0} rx={22} ry={24} fill="var(--eg-surface)" stroke={color} strokeWidth={1.6} />

      {/* Gate disc - rotates between open (0°) and closed (90°) */}
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={isOnline ? "90 0 0" : "0 0 0"}
          to={`${gateRotation} 0 0`}
          dur="0.4s"
          fill="freeze"
        />
        <rect x={-2} y={-20} width={4} height={40} rx={2} fill={color} opacity={0.7} />
        {/* Gate handle knob */}
        <circle cx={0} cy={-20} r={4} fill={color} opacity={0.5} />
        <circle cx={0} cy={20} r={4} fill={color} opacity={0.5} />
      </g>

      {/* Flow arrows when open */}
      {isOnline && isRunning && (
        <g opacity={0.4}>
          <path d="M -14 0 L -8 -3 L -8 3 Z" fill={color}>
            <animate attributeName="opacity" values="0.2;0.5;0.2" dur="1.2s" repeatCount="indefinite" />
          </path>
          <path d="M 8 0 L 14 -3 L 14 3 Z" fill={color}>
            <animate attributeName="opacity" values="0.2;0.5;0.2" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
          </path>
        </g>
      )}

      {/* Blocked warning ring when closed */}
      {!isOnline && isRunning && (
        <ellipse cx={0} cy={0} rx={28} ry={30} fill="none" stroke="var(--eg-anomaly)" strokeWidth={1} opacity={0.3}>
          <animate attributeName="opacity" values="0.15;0.4;0.15" dur="1.5s" repeatCount="indefinite" />
        </ellipse>
      )}

      {/* Subtle glow when open */}
      {isOnline && isRunning && (
        <ellipse cx={0} cy={0} rx={26} ry={28} fill="none" stroke="var(--eg-flow)" strokeWidth={0.5} opacity={0.15}>
          <animate attributeName="opacity" values="0.08;0.2;0.08" dur="3s" repeatCount="indefinite" />
        </ellipse>
      )}

      {/* Label */}
      <text x={0} y={40} textAnchor="middle" fill={color} fontSize="8" fontWeight="700" fontFamily="Orbitron, sans-serif" letterSpacing="0.1em">
        {dormant ? "STANDBY" : isOnline ? "VALVE OPEN" : "VALVE SHUT"}
      </text>
    </g>
  );
}

function CentralDBNode({ x, y, count, isOnline, isRunning }: {
  x: number;
  y: number;
  count: number;
  isOnline: boolean;
  isRunning: boolean;
}) {
  const dormant = !isRunning;
  const color = dormant ? "var(--eg-muted)" : isOnline ? "var(--eg-flow)" : "var(--eg-muted)";
  const opacity = dormant ? 0.35 : isOnline ? 1 : 0.4;

  return (
    <g transform={`translate(${x}, ${y})`} opacity={opacity}>
      {/* Cloud shape */}
      <ellipse cx={0} cy={-24} rx={32} ry={10} fill="var(--eg-surface)" stroke={color} strokeWidth={1.2} />
      <rect x={-32} y={-24} width={64} height={48} fill="var(--eg-surface)" stroke={color} strokeWidth={1.2} />
      <ellipse cx={0} cy={24} rx={32} ry={10} fill="var(--eg-surface)" stroke={color} strokeWidth={1.2} />

      {/* DB lines */}
      <line x1={-20} y1={-8} x2={20} y2={-8} stroke={color} opacity={0.4} strokeWidth={0.6} />
      <line x1={-20} y1={4} x2={20} y2={4} stroke={color} opacity={0.4} strokeWidth={0.6} />
      <line x1={-20} y1={16} x2={20} y2={16} stroke={color} opacity={0.4} strokeWidth={0.6} />

      {/* Count */}
      <text x={0} y={2} textAnchor="middle" fill={color} fontSize="14" fontWeight="700" fontFamily="JetBrains Mono, monospace">
        {count}
      </text>

      {/* Active glow */}
      {isOnline && isRunning && (
        <ellipse cx={0} cy={0} rx={36} ry={28} fill="none" stroke="var(--eg-flow)" strokeWidth={0.5} opacity={0.15}>
          <animate attributeName="opacity" values="0.08;0.2;0.08" dur="3s" repeatCount="indefinite" />
        </ellipse>
      )}

      {/* Labels */}
      <text x={0} y={48} textAnchor="middle" fill={dormant ? "var(--eg-muted)" : isOnline ? "var(--eg-text-dim)" : "var(--eg-muted)"} fontSize="8" fontWeight="600" fontFamily="Orbitron, sans-serif" letterSpacing="0.1em">
        CENTRAL DB
      </text>
      {!isOnline && isRunning && (
        <text x={0} y={60} textAnchor="middle" fill="var(--eg-anomaly)" fontSize="7" fontWeight="700" fontFamily="Orbitron, sans-serif" opacity={0.8}>
          UNREACHABLE
        </text>
      )}
    </g>
  );
}

export function PipelineView() {
  const packetsInTransit = usePipelineStore((s) => s.packetsInTransit);
  const edgeStorage = usePipelineStore((s) => s.edgeStorage);
  const centralStorage = usePipelineStore((s) => s.centralStorage);
  const isOnline = usePipelineStore((s) => s.isOnline);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const forcedAnomalyTurbine = usePipelineStore((s) => s.forcedAnomalyTurbine);
  const enabledTurbines = usePipelineStore((s) => s.enabledTurbines);
  const compactionCount = usePipelineStore((s) => s.compactionCount);
  const edgePressure = usePipelineStore((s) => s.edgePressure);
  const setOnline = (online: boolean) => {
    edgeguardApi.setConnection(online).catch(() => {});
  };
  const setForcedAnomalyTurbine = (id: number | null) => {
    if (id != null) {
      edgeguardApi.injectAnomaly(id).catch(() => {});
    } else if (forcedAnomalyTurbine != null) {
      edgeguardApi.clearAnomaly(forcedAnomalyTurbine).catch(() => {});
    }
    usePipelineStore.setState({ forcedAnomalyTurbine: id });
  };

  const [compactionFlash, setCompactionFlash] = useState(false);
  useEffect(() => {
    if (compactionCount === 0) return;
    setCompactionFlash(true);
    const timer = setTimeout(() => setCompactionFlash(false), 500);
    return () => clearTimeout(timer);
  }, [compactionCount]);

  const bufferRatio = Math.min(1, edgeStorage.length / EDGE_CAPACITY);
  const inCompactionZone = bufferRatio >= COMPACTION_THRESHOLD / EDGE_CAPACITY;

  const brainActive = useMemo(() => {
    return packetsInTransit.some(
      (p) => p.segment === "to-buffer" && p.progress >= 0.22 && p.progress <= 0.55
    );
  }, [packetsInTransit]);

  return (
    <div className="w-full">
      <div className="relative rounded-xl border border-[var(--eg-border)] bg-[var(--eg-panel)] overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.6)]">
        {/* Status banner */}
        <AnimatePresence>
          {!isOnline && isRunning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-[var(--eg-anomaly)]/15 border-b border-[var(--eg-anomaly)]/30 px-4 py-1.5 text-center"
            >
              <span className="font-display text-[10px] tracking-[0.3em] text-[var(--eg-anomaly)] font-bold">
                NETWORK DISCONNECTED — EDGE ISOLATION MODE
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="w-full h-auto block"
          style={{ minHeight: "240px" }}
          aria-hidden
        >
          <defs>
            <linearGradient id="pipe-glow-left" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--eg-flow)" stopOpacity="0.2" />
              <stop offset="50%" stopColor="var(--eg-flow)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--eg-flow)" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="pipe-glow-right-on" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--eg-flow)" stopOpacity="0.5" />
              <stop offset="50%" stopColor="var(--eg-flow)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--eg-flow)" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="pipe-glow-right-off" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--eg-muted)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--eg-muted)" stopOpacity="0.05" />
            </linearGradient>

            <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* === PIPES === */}
          <path d={PIPE_PATH_LEFT} fill="none" stroke={isRunning ? "var(--eg-border)" : "var(--eg-muted)"} strokeWidth={20} strokeLinecap="round" opacity={isRunning ? 1 : 0.3} />
          {isRunning && <path d={PIPE_PATH_LEFT} fill="none" stroke="url(#pipe-glow-left)" strokeWidth={10} strokeLinecap="round" />}
          {isRunning && (
            <path
              d={PIPE_PATH_LEFT}
              fill="none"
              stroke={edgePressure > 0.5 ? "var(--eg-alert)" : "var(--eg-flow)"}
              strokeWidth={2}
              className="pipe-flow-anim"
              opacity={0.6}
            />
          )}

          <path d={PIPE_PATH_RIGHT} fill="none" stroke={isRunning ? "var(--eg-border)" : "var(--eg-muted)"} strokeWidth={20} strokeLinecap="round" opacity={isRunning ? 1 : 0.3} />
          {isRunning && (
            <path
              d={PIPE_PATH_RIGHT}
              fill="none"
              stroke={isOnline ? "url(#pipe-glow-right-on)" : "url(#pipe-glow-right-off)"}
              strokeWidth={10}
              strokeLinecap="round"
            />
          )}
          {isOnline && isRunning && (
            <path
              d={PIPE_PATH_RIGHT}
              fill="none"
              stroke="var(--eg-flow)"
              strokeWidth={2}
              className="pipe-flow-anim"
              opacity={0.4}
            />
          )}

          {/* Section labels */}
          {isRunning && (
            <>
              <text x={PIPE_START_X + 15} y={PIPE_Y - 18} fill="var(--eg-text-dim)" fontSize="7" fontFamily="Orbitron, sans-serif" letterSpacing="0.15em" opacity={0.5}>
                INGEST
              </text>
              <text x={VALVE_X + 40} y={PIPE_Y - 18} fill="var(--eg-text-dim)" fontSize="7" fontFamily="Orbitron, sans-serif" letterSpacing="0.15em" opacity={isOnline ? 0.5 : 0.2}>
                CLOUD SYNC
              </text>
            </>
          )}

          {/* === PACKETS / PARTICLES === */}
          {packetsInTransit.map((packet) => {
            const isAnomalyPayload = "anomalyScore" in packet.payload && packet.payload.type === "anomaly";
            const isCompacted = packet.payload.type === "compacted";
            const pastEdgeAI =
              packet.segment === "to-central" ||
              (packet.segment === "to-buffer" && packet.progress >= BRAIN_PROGRESS);
            const showAsAnomaly = isAnomalyPayload && pastEdgeAI;

            const position =
              packet.segment === "to-buffer" &&
              "sourceTurbine" in packet.payload &&
              packet.progress < 0.22
                ? packetEntryPosition(packet.payload.sourceTurbine, packet.progress)
                : packetPosition(packet.segment, packet.progress);

            const color = showAsAnomaly ? "var(--eg-anomaly)" : isCompacted ? "#b388ff" : "var(--eg-flow)";
            const size = showAsAnomaly ? 5 : isCompacted ? 6 : 4;

            return (
              <g key={`${packet.segment}-${packet.id}`} filter={showAsAnomaly ? "url(#glow-red)" : "url(#glow-cyan)"}>
                <circle cx={position.x - 8} cy={position.y} r={size * 0.6} fill={color} opacity={0.15} />
                <circle cx={position.x - 4} cy={position.y} r={size * 0.8} fill={color} opacity={0.25} />
                <circle cx={position.x} cy={position.y} r={size} fill={color} opacity={0.9} />
                <circle cx={position.x} cy={position.y} r={size * 0.4} fill="white" opacity={0.6} />
              </g>
            );
          })}

          {/* === TURBINES (triangular formation) === */}
          {TURBINE_POSITIONS.map((pos, index) => {
            const turbineId = index + 1;
            const active = forcedAnomalyTurbine === turbineId;
            const enabled = enabledTurbines.includes(turbineId);
            const hubY = pos.y - 34;
            return (
              <TurbineGlyph
                key={turbineId}
                x={pos.x}
                y={pos.y}
                hubY={hubY}
                active={active}
                label={`T${turbineId}`}
                isRunning={isRunning}
                enabled={enabled}
                onActivate={() => setForcedAnomalyTurbine(active ? null : turbineId)}
              />
            );
          })}

          {/* === EDGE AI CHIP === */}
          <AIChipNode x={BRAIN_X} y={PIPE_Y} isActive={brainActive} isRunning={isRunning} />

          {/* === BUFFER TANK === */}
          <BufferTank
            x={BUFFER_X}
            y={PIPE_Y}
            ratio={bufferRatio}
            inCompactionZone={inCompactionZone}
            compactionFlash={compactionFlash}
            isRunning={isRunning}
          />

          {/* === VALVE === */}
          <ValveNode
            x={VALVE_X}
            y={PIPE_Y}
            isOnline={isOnline}
            isRunning={isRunning}
            onToggle={() => setOnline(!isOnline)}
          />

          {/* === CENTRAL DB === */}
          <CentralDBNode
            x={CENTRAL_X}
            y={PIPE_Y}
            count={centralStorage.length}
            isOnline={isOnline}
            isRunning={isRunning}
          />
        </svg>

      </div>
    </div>
  );
}
