import { useEffect, useRef } from "react";
import { usePipelineStore } from "~/stores/pipelineStore";
import { getBaseUrl, edgeguardApi } from "~/lib/api";
import type {
  Metrics,
  EdgeUpdatePayload,
  CentralUpdatePayload,
  CompactionPayload,
  SnapshotPayload,
  SystemStatus,
} from "~/lib/api";
import type { DataPoint } from "~/types/edgeguard";

/**
 * Opens an EventSource to the backend SSE stream and dispatches
 * incoming events to the pipeline store.
 */
const RESYNC_THROTTLE_MS = 500;

export function useEventStream(enabled: boolean) {
  const esRef = useRef<EventSource | null>(null);
  const lastResyncTs = useRef(0);

  const applyTelemetry = usePipelineStore((s) => s.applyTelemetry);
  const applyEdgeUpdate = usePipelineStore((s) => s.applyEdgeUpdate);
  const applyCentralUpdate = usePipelineStore((s) => s.applyCentralUpdate);
  const applyCompaction = usePipelineStore((s) => s.applyCompaction);
  const applyMetrics = usePipelineStore((s) => s.applyMetrics);
  const applySystemStatus = usePipelineStore((s) => s.applySystemStatus);
  const applySnapshot = usePipelineStore((s) => s.applySnapshot);
  const setCentralStorage = usePipelineStore((s) => s.setCentralStorage);
  const setEdgeStorage = usePipelineStore((s) => s.setEdgeStorage);
  const getState = usePipelineStore.getState;

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const url = `${getBaseUrl()}/api/stream/events`;
    const es = new EventSource(url);
    esRef.current = es;

    // Seed central only on connect so central table shows persisted data quickly.
    // Edge table is filled only from snapshot (and live events) so we never overwrite with stale Edge Server data after a clear.
    edgeguardApi.getCentralStorage().then((items) => {
      setCentralStorage(items ?? []);
    }).catch(() => {});

    es.addEventListener("telemetry", (e) => {
      const point: DataPoint = JSON.parse(e.data);
      applyTelemetry(point);
    });

    es.addEventListener("edge_update", (e) => {
      const payload: EdgeUpdatePayload = JSON.parse(e.data);
      applyEdgeUpdate(payload);
    });

    es.addEventListener("central_update", (e) => {
      const payload: CentralUpdatePayload = JSON.parse(e.data);
      applyCentralUpdate(payload);
    });

    es.addEventListener("compaction", (e) => {
      const payload: CompactionPayload = JSON.parse(e.data);
      applyCompaction(payload);
    });

    es.addEventListener("metrics", (e) => {
      const metrics: Metrics = JSON.parse(e.data);
      applyMetrics(metrics);

      // Drift detection: if backend lengths differ from store, resync from API (throttled).
      const now = Date.now();
      if (now - lastResyncTs.current < RESYNC_THROTTLE_MS) return;
      const { edgeStorage, centralStorage } = getState();
      const edgeDrift = metrics.edgeStorageLength !== edgeStorage.length;
      const centralDrift = metrics.centralStorageLength !== centralStorage.length;
      if (!edgeDrift && !centralDrift) return;
      lastResyncTs.current = now;
      if (edgeDrift) {
        edgeguardApi.getEdgeStorage().then((items) => {
          setEdgeStorage(items ?? []);
        }).catch(() => {});
      }
      if (centralDrift) {
        edgeguardApi.getCentralStorage().then((items) => {
          setCentralStorage(items ?? []);
        }).catch(() => {});
      }
    });

    es.addEventListener("system_status", (e) => {
      const status: SystemStatus = JSON.parse(e.data);
      applySystemStatus(status);
    });

    es.addEventListener("snapshot", (e) => {
      const snapshot: SnapshotPayload = JSON.parse(e.data);
      applySnapshot(snapshot);
      const edgeLen = snapshot.edgeStorage?.length ?? 0;
      const centralLen = snapshot.centralStorage?.length ?? 0;
      const central = snapshot.centralStorage ?? [];
      const edge = snapshot.edgeStorage ?? [];
      // Refetch central when: (1) snapshot central is empty, or (2) central looks like a copy of edge (same length + same ids) so we never show edge data in the central table.
      const sameIds =
        centralLen > 0 &&
        centralLen === edgeLen &&
        central.every((c, i) => {
          const a = (c as { id?: string }).id;
          const b = (edge[i] as { id?: string }).id;
          return a !== undefined && b !== undefined && a === b;
        });
      if (
        snapshot.systemStatus?.isOnline === true &&
        (centralLen === 0 || sameIds)
      ) {
        edgeguardApi.getCentralStorage().then((items) => {
          setCentralStorage(items ?? []);
        }).catch(() => {});
        if (sameIds) {
          edgeguardApi.getEdgeStorage().then((items) => {
            setEdgeStorage(items ?? []);
          }).catch(() => {});
        }
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; nothing special needed
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [
    enabled,
    applyTelemetry,
    applyEdgeUpdate,
    applyCentralUpdate,
    applyCompaction,
    applyMetrics,
    applySystemStatus,
    applySnapshot,
    setCentralStorage,
    setEdgeStorage,
  ]);
}
