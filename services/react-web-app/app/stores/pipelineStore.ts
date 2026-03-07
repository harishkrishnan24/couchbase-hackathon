import { create } from "zustand";
import type {
  EdgeGuardItem,
  DataPoint,
  CompactedBlock,
  Packet,
} from "~/types/edgeguard";
import type {
  Metrics,
  EdgeUpdatePayload,
  CentralUpdatePayload,
  CompactionPayload,
  SnapshotPayload,
  SystemStatus,
  CompactionLogEntry as ApiCompactionLogEntry,
} from "~/lib/api";

export type CompactionLogEntry = ApiCompactionLogEntry;

const PROGRESS_SPEED_TO_BUFFER = 0.36;
const PROGRESS_SPEED_TO_CENTRAL = 0.32;

export const EDGE_CAPACITY = 25;
export const COMPACTION_THRESHOLD = 20;

export interface PipelineState {
  packetsInTransit: Packet[];
  edgeStorage: EdgeGuardItem[];
  centralStorage: EdgeGuardItem[];
  isOnline: boolean;
  isRunning: boolean;
  isInitialized: boolean;
  introComplete: boolean;
  compactionLogs: CompactionLogEntry[];
  compactionCount: number;
  forcedAnomalyTurbine: number | null;
  enabledTurbines: number[];

  perTurbineHistory: Record<number, DataPoint[]>;
  totalPacketsEmitted: number;
  totalAnomalies: number;
  lastSyncTimestamp: number | null;
  edgePressure: number;
  lastDrainedItemId: string | null;
  compactionFlashId: string | null;

  // UI-only actions (kept local)
  initialize: () => void;
  completeIntro: () => void;
  advanceTransit: (delta: number) => void;

  // Actions driven by SSE events from backend
  applyTelemetry: (point: DataPoint) => void;
  applyEdgeUpdate: (data: EdgeUpdatePayload) => void;
  applyCentralUpdate: (data: CentralUpdatePayload) => void;
  applyCompaction: (data: CompactionPayload) => void;
  applyMetrics: (data: Metrics) => void;
  applySystemStatus: (data: SystemStatus) => void;
  applySnapshot: (data: SnapshotPayload) => void;
  setCentralStorage: (items: EdgeGuardItem[]) => void;
  setEdgeStorage: (items: EdgeGuardItem[]) => void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  packetsInTransit: [],
  edgeStorage: [],
  centralStorage: [],
  isOnline: true,
  isRunning: false,
  isInitialized: false,
  introComplete: false,
  compactionLogs: [],
  compactionCount: 0,
  forcedAnomalyTurbine: null,
  enabledTurbines: [],  // default: all turbines off

  perTurbineHistory: { 1: [], 2: [], 3: [] },
  totalPacketsEmitted: 0,
  totalAnomalies: 0,
  lastSyncTimestamp: null,
  edgePressure: 0,
  lastDrainedItemId: null,
  compactionFlashId: null,

  // ---- UI-only actions ----

  initialize: () => set({ isInitialized: true }),
  completeIntro: () => set({ introComplete: true }),

  advanceTransit: (delta) => {
    const { packetsInTransit } = get();
    const toAddEdge: EdgeGuardItem[] = [];
    const toAddCentral: EdgeGuardItem[] = [];
    const completedIds = new Set<string>();

    for (const p of packetsInTransit) {
      const speed =
        p.segment === "to-buffer"
          ? PROGRESS_SPEED_TO_BUFFER
          : PROGRESS_SPEED_TO_CENTRAL;
      const nextProgress = Math.min(1, p.progress + delta * speed);
      if (nextProgress >= 1) {
        completedIds.add(p.id);
      }
    }

    set((s) => ({
      packetsInTransit: s.packetsInTransit
        .map((p) => {
          const speed =
            p.segment === "to-buffer"
              ? PROGRESS_SPEED_TO_BUFFER
              : PROGRESS_SPEED_TO_CENTRAL;
          return { ...p, progress: Math.min(1, p.progress + delta * speed) };
        })
        .filter((p) => p.progress < 1),
    }));
  },

  // ---- SSE event handlers ----

  applyTelemetry: (point) =>
    set((s) => {
      const history = { ...s.perTurbineHistory };
      const turbineHist = [...(history[point.sourceTurbine] || []), point];
      if (turbineHist.length > 30) turbineHist.shift();
      history[point.sourceTurbine] = turbineHist;

      return {
        packetsInTransit: [
          ...s.packetsInTransit,
          { id: point.id, progress: 0, segment: "to-buffer" as const, payload: point },
        ],
        perTurbineHistory: history,
      };
    }),

  // Updates edge only; never touches central.
  applyEdgeUpdate: (data) =>
    set((s) => {
      const id = "id" in data.item ? (data.item as DataPoint).id : undefined;
      const prev = s.edgeStorage;
      const idx = id != null ? prev.findIndex((x) => "id" in x && (x as DataPoint).id === id) : -1;
      const next =
        idx >= 0
          ? prev.map((x, i) => (i === idx ? data.item : x))
          : [...prev.slice(-(EDGE_CAPACITY - 1)), data.item];
      return { edgeStorage: next, edgePressure: data.pressure };
    }),

  // Adds to central and removes one from edge; never assign edge to central or vice versa.
  applyCentralUpdate: (data) =>
    set((s) => {
      const id =
        "id" in data.item
          ? (data.item as DataPoint).id
          : `drain_${Date.now()}`;
      const prev = s.centralStorage;
      const stableId = "id" in data.item ? (data.item as DataPoint).id : null;
      const idx =
        stableId != null
          ? prev.findIndex((x) => "id" in x && (x as DataPoint).id === stableId)
          : -1;
      const nextCentral =
        idx >= 0
          ? prev.map((x, i) => (i === idx ? data.item : x))
          : [...prev, data.item];
      return {
        centralStorage: nextCentral,
        lastSyncTimestamp: data.lastSyncTimestamp,
        lastDrainedItemId: id,
        edgeStorage: s.edgeStorage.slice(1),
        edgePressure: Math.max(0, s.edgePressure - 0.04),
        packetsInTransit: [
          ...s.packetsInTransit,
          { id, progress: 0, segment: "to-central" as const, payload: data.item },
        ],
      };
    }),

  applyCompaction: (data) =>
    set({
      edgeStorage: data.edgeStorage,
      compactionLogs: [...get().compactionLogs, data.log],
      compactionCount: data.compactionCount,
      compactionFlashId: `compact_${Date.now()}`,
    }),

  applyMetrics: (data) =>
    set({
      totalPacketsEmitted: data.totalPacketsEmitted,
      totalAnomalies: data.totalAnomalies,
      edgePressure: data.edgePressure,
      compactionCount: data.compactionCount,
      lastSyncTimestamp: data.lastSyncTimestamp,
    }),

  applySystemStatus: (data) =>
    set({
      isRunning: data.isRunning,
      isOnline: data.isOnline,
      isInitialized: data.isInitialized,
      enabledTurbines: data.enabledTurbines ?? [],
    }),

  // Snapshot: set edge and central only from backend edgeStorage/centralStorage; do not derive one from the other.
  applySnapshot: (data) =>
    set({
      edgeStorage: data.edgeStorage ?? [],
      centralStorage: data.centralStorage ?? [],
      compactionLogs: data.compactionLogs ?? [],
      compactionCount: data.compactionCount ?? 0,
      totalPacketsEmitted: data.metrics?.totalPacketsEmitted ?? 0,
      totalAnomalies: data.metrics?.totalAnomalies ?? 0,
      edgePressure: data.metrics?.edgePressure ?? 0,
      lastSyncTimestamp: data.metrics?.lastSyncTimestamp ?? null,
      isRunning: data.systemStatus?.isRunning ?? false,
      isOnline: data.systemStatus?.isOnline ?? true,
      isInitialized: data.systemStatus?.isInitialized ?? false,
      enabledTurbines: data.systemStatus?.enabledTurbines ?? [],
    }),

  setCentralStorage: (items) => set({ centralStorage: items }),
  setEdgeStorage: (items) => set({ edgeStorage: items }),
}));
