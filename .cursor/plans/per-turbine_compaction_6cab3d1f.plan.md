---
name: Per-Turbine Compaction
overview: Fix compaction so each turbine's normal readings are compacted independently, preserving `sourceTurbine` identity all the way through Tier-1 and Tier-2 blocks.
todos:
  - id: model-field
    content: Add `source_turbine` field (alias `sourceTurbine`) to `CompactedBlock` in models/edgeguard.py
    status: pending
  - id: helpers
    content: Update `_compact_window` and `_merge_tier1_blocks` helpers in simulation.py to accept and propagate turbine_id
    status: pending
  - id: compact-fn
    content: Refactor `_compact()` in simulation.py to group normals and existing Tier-1 blocks by sourceTurbine before compacting
    status: pending
  - id: ts-type
    content: "Add `sourceTurbine: number` to CompactedBlock interface in types/edgeguard.ts"
    status: pending
  - id: ui-display
    content: Show turbine badge on compacted block rows in DataTables.tsx
    status: pending
isProject: false
---

# Per-Turbine Compaction Fix

## The Problem

`_compact()` in `[simulation.py](services/python-fast-api/src/simulation.py)` collects all normal `DataPoint`s into one flat `normals` list, then windows them 5-at-a-time without regard for which turbine they came from. A single `CompactedBlock` ends up containing readings from up to 3 turbines, and `sourceTurbine` is never stored on it — lost forever.

## Changes Required

### 1. `models/edgeguard.py` — Add `sourceTurbine` to `CompactedBlock`

```python
class CompactedBlock(BaseModel):
    type: Literal["compacted"] = "compacted"
    source_turbine: int = Field(alias="sourceTurbine")   # ADD THIS
    avg_value: float = Field(alias="avgValue")
    ...
```

### 2. `simulation.py` — Refactor `_compact()` and helpers

**Helpers** — pass `turbine_id` through:

- `_compact_window(points, turbine_id)` — sets `sourceTurbine` on the new `CompactedBlock`
- `_merge_tier1_blocks(blocks, turbine_id)` — sets `sourceTurbine` on the merged Tier-2 block

`**_compact()` — new logic:**

1. Classify items as before (anomalies, existing_compacted, normals)
2. Instead of one `normals` list, group into `normals_by_turbine: dict[int, list[DataPoint]]`
3. **Tier-1 path**: for each turbine independently, window its normals in groups of 5 → `CompactedBlock(sourceTurbine=turbine_id, tier=1, ...)`; collect leftover normals per turbine
4. **Tier-2 fallback** (no turbine has ≥5 normals): group existing Tier-1 blocks by `sourceTurbine`; for each turbine that has ≥4 Tier-1 blocks, merge them → `CompactedBlock(sourceTurbine=turbine_id, tier=2, ...)`
5. Log message updated to show which turbines were compacted (e.g. `T1 COMPACT T1[1001-1005] T3[1006-1010] | 10 pts → 2 blocks`)

### 3. `types/edgeguard.ts` — Add `sourceTurbine` to `CompactedBlock`

```ts
export interface CompactedBlock {
  type: "compacted";
  sourceTurbine: number;   // ADD THIS
  ...
}
```

### 4. `components/dashboard/DataTables.tsx` — Show turbine in compacted row

The existing compacted row render at line ~178 already shows tier/range. Add a "T{n}" turbine badge next to the tier indicator so the source is visible in the UI.

## Files Changed

- `[services/python-fast-api/src/models/edgeguard.py](services/python-fast-api/src/models/edgeguard.py)` — add field
- `[services/python-fast-api/src/simulation.py](services/python-fast-api/src/simulation.py)` — refactor compaction logic
- `[services/react-web-app/app/types/edgeguard.ts](services/react-web-app/app/types/edgeguard.ts)` — add field
- `[services/react-web-app/app/components/dashboard/DataTables.tsx](services/react-web-app/app/components/dashboard/DataTables.tsx)` — display turbine in compacted block row

