/**
 * Data emission is now driven by the backend simulation engine via SSE.
 * This hook is retained as a no-op for backward compatibility.
 * See useEventStream.ts for the SSE consumer.
 */
export function usePipelineEmission(_enabled: boolean) {
  // No-op: backend drives emit/drain via SSE events
}
