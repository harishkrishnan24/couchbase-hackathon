import { useEffect, useRef } from "react";
import { usePipelineStore } from "~/stores/pipelineStore";
import { getBaseUrl } from "~/lib/api";
import type {
  Metrics,
  EdgeUpdatePayload,
  CentralUpdatePayload,
  CompactionPayload,
  SystemStatus,
} from "~/lib/api";
import type { DataPoint } from "~/types/edgeguard";

/**
 * Opens an EventSource to the backend SSE stream and dispatches
 * incoming events to the pipeline store.
 */
export function useEventStream(enabled: boolean) {
  const esRef = useRef<EventSource | null>(null);

  const applyTelemetry = usePipelineStore((s) => s.applyTelemetry);
  const applyEdgeUpdate = usePipelineStore((s) => s.applyEdgeUpdate);
  const applyCentralUpdate = usePipelineStore((s) => s.applyCentralUpdate);
  const applyCompaction = usePipelineStore((s) => s.applyCompaction);
  const applyMetrics = usePipelineStore((s) => s.applyMetrics);
  const applySystemStatus = usePipelineStore((s) => s.applySystemStatus);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const url = `${getBaseUrl()}/api/stream/events`;
    const es = new EventSource(url);
    esRef.current = es;

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
    });

    es.addEventListener("system_status", (e) => {
      const status: SystemStatus = JSON.parse(e.data);
      applySystemStatus(status);
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
  ]);
}
