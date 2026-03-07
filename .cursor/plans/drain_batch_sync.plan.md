---
name: Drain batch sync
overview: Drain loop runs every 0.6s and moves up to 5 items per run so the UI gets smaller, more frequent updates that are easier to follow.
todos:
  - id: drain-batch-5
    content: Drain loop uses DRAIN_BATCH_SIZE = 5 and DRAIN_INTERVAL_MS = 600 (implemented)
    status: completed
isProject: false
---

# Drain batch sync

## Summary

- **Drain interval:** `DRAIN_INTERVAL_MS = 600` (0.6 seconds) — shorter so updates appear more often.
- **Batch size:** `DRAIN_BATCH_SIZE = 5` in [simulation.py](services/python-fast-api/src/simulation.py) — smaller batches so the UI is easier to follow.
- **Behavior:** Each drain run moves up to **5** items from edge buffer to central. Each item still gets a `central_update` SSE event. Metrics published once after the batch.
- **Rationale:** 5 items every 0.6s is easier to perceive than 10 items every 1.2s; throughput is still sufficient (emit is ~1 reading per 1.4s).

## Implementation (done)

- `DRAIN_BATCH_SIZE = 5` and `DRAIN_INTERVAL_MS = 600` in simulation.py.
- `_drain_loop` drains up to 5 items per wake, then sleeps 0.6s. Repeats until edge empty or an upsert fails.
