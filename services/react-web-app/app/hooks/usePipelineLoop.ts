import { useEffect, useRef } from "react";
import { usePipelineStore } from "~/stores/pipelineStore";

/**
 * Advances packet-in-transit animations at 60fps.
 * Compaction is now handled by the backend.
 */
export function usePipelineLoop(enabled: boolean) {
  const advanceTransit = usePipelineStore((s) => s.advanceTransit);
  const getState = usePipelineStore.getState;
  const last = useRef(performance.now() / 1000);

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    const tick = (now: number) => {
      const t = now / 1000;
      const delta = Math.min(t - last.current, 0.1);
      last.current = t;
      getState().advanceTransit(delta);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, advanceTransit, getState]);
}
