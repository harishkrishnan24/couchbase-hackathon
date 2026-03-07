# Agent guidelines for Couchbase hackathon

This project is **EdgeGuard AI** — a wind-turbine anomaly-detection system that demonstrates a full edge-to-cloud data pipeline using the Couchbase stack. It uses **Polytope** (and tooling from **bluetext**) to run all services in sandboxes.

---

## Architecture overview

```
Wind turbine simulation (python-fast-api)
    └── Isolation Forest scoring (anomaly_detector.py)
            └── HTTP PUT (fire-and-forget)
                    └── couchbase-edge-server  (port 59840, SQLite-backed local store)
                            └── WebSocket continuous replication
                                    └── sync-gateway  (port 4984/4985)
                                            └── Couchbase SDK bootstrap
                                                    └── couchbase-server  (port 8091/8093)
                                                            ↑
                                                    python-fast-api reads central.* via SDK
                                                            ↑
                                                    react-web-app  (REST + SSE /api/*)
```

**Offline mode:** when toggled off, the drain loop pauses, Edge Server keeps accepting writes, and the simulation engine compacts normal readings (Tier 1 → Tier 2) to reclaim edge buffer space while anomalies are always kept at full fidelity. On reconnect the full buffer flushes.

---

## Services

### `couchbase-server`
Couchbase Enterprise 7.6.6. The permanent cloud-side data store. Provisioned by `service-config-manager` at startup.

- **Bucket:** `main`
- **Scopes / collections:**
  - `_default`: `users`, `sessions`
  - `edge`: `readings`, `anomalies`, `compacted`
  - `central`: `readings`, `anomalies`, `compacted`, `model_state`
- **Ports:** 8091 (admin), 8093 (N1QL)
- **Data persisted** via a project-scoped Docker volume (`couchbase-server-data`) — survives restarts.
- Config schema lives in [`config/couchbase-server/couchbase.yaml`](config/couchbase-server/couchbase.yaml).

---

### `sync-gateway`
Couchbase Sync Gateway 3.1.1 Enterprise. Bridges the Edge Server to Couchbase Server via continuous bidirectional WebSocket replication.

- **Ports:** 4984 (public), 4985 (admin)
- **Config files:** `services/sync-gateway/sync-gateway-config.json`, `services/sync-gateway/database.json`
- **Entrypoint:** `services/sync-gateway/entrypoint.sh` — substitutes env vars into config, starts the process, polls until ready, then `PUT`s the `main` database definition.
- Depends on `couchbase-server` being available before starting.

---

### `couchbase-edge-server`
Couchbase Edge Server (latest). On-device edge database backed by SQLite (`main.cblite2`). Accepts HTTP REST writes from `python-fast-api` and replicates them upstream to Sync Gateway.

- **Port:** 59840
- **Config:** `services/couchbase-edge-server/config.json` — listens on `0.0.0.0:59840`, bidirectional replication to `ws://sync-gateway:4984/main`, guest access enabled.
- **Entrypoint:** `services/couchbase-edge-server/entrypoint.sh` — polls Sync Gateway until ready, then starts Edge Server.
- All writes from Python FastAPI go here first via `db.edge_put_async()` (HTTP PUT).

---

### `python-fast-api`
The core backend. FastAPI (Python 3.13) app that simulates turbine sensor data, scores anomalies with an Isolation Forest, writes to the Couchbase stack, and serves the React frontend.

- **Port:** 3030
- **Entrypoint:** `services/python-fast-api/bin/run` → `uvicorn main:app`
- **Key source files** (all in `services/python-fast-api/src/`):

  | File | Role |
  |---|---|
  | `main.py` | App factory; registers routers; `lifespan` connects Couchbase and loads the ML model |
  | `simulation.py` | `SimulationEngine` — emit loop (1400 ms, generates readings) + drain loop (1200 ms, flushes edge→central); offline compaction |
  | `anomaly_detector.py` | `AnomalyDetector` singleton wrapping `IsolationForest`; 6 features: `vibration`, `temperature`, `rpm`, `powerOutput`, `windSpeed`, `bladePitch` |
  | `db.py` | Persistence layer: edge writes via `httpx` REST, central reads via Couchbase SDK |
  | `routes/stream.py` | SSE endpoint `GET /api/stream/events` — streams `telemetry`, `edge_update`, `central_update`, `compaction`, `metrics`, `system_status` events |
  | `routes/turbines.py` | `POST /api/turbines/{id}/anomaly` — injects a forced 8-reading anomaly burst |
  | `routes/model.py` | `GET /api/model/status`, `POST /api/model/retrain` — model metadata and in-process retraining |
  | `routes/system.py` | `initialize`, `start`, `stop`, `setOnline` — simulation engine lifecycle |
  | `routes/connection.py` | Toggles online/offline mode; triggers compaction drain |
  | `models/edgeguard.py` | Pydantic models: `SensorData`, `DataPoint`, `CompactedBlock`, `Metrics`, `SystemStatus` |

- **ML model — important:**
  - The trained model lives at `services/python-fast-api/model/isolation_forest.joblib` (committed to repo).
  - The server **only loads** the model from disk at startup — it does **not** train. If the file is missing, anomaly scoring returns neutral scores.
  - To train or retrain the model locally, run:
    ```bash
    cd services/python-fast-api
    PYTHONNOUSERSITE=1 PYTHONPATH="" uv run --no-project --isolated \
      --with "scikit-learn>=1.8.0" \
      --with "numpy>=2.4.2" \
      --with "joblib>=1.5.3" \
      python train_model.py
    ```
  - The script generates 5,000 synthetic correlated turbine readings, fits the Isolation Forest, and saves `model/isolation_forest.joblib`. Takes ~0.2s. Commit the resulting file so the container picks it up without any training step.
  - `POST /api/model/retrain` triggers an equivalent in-process retrain at runtime via the API.

- **Compaction:** When triggered (buffer threshold 20), merge all continuous normal and compacted readings into a single unified `CompactedBlock` (avg/min/max/stddev). Anomalies act as boundaries and are always preserved full-fidelity. Edge buffer cap: 25 items.

- **Dependencies:** `scikit-learn`, `numpy`, `joblib`, `httpx`, `fastapi`, `uvicorn`, Couchbase Python SDK.

---

### `react-web-app`
The **EdgeGuard AI Command Center** — React 19 + React Router 7 SPA served by Bun. Visualises the live edge-to-cloud pipeline in real time.

- **Port:** 5173 (Vite dev) / configured via `HTTP_PORT`
- **Entrypoint:** `services/react-web-app/bin/run` → `bun run dev`
- **Key source files** (all in `services/react-web-app/app/`):

  | File | Role |
  |---|---|
  | `routes/demo.tsx` | Main dashboard (`/demo`): `TurbineCard ×3`, `ConnectionToggle`, `PipelineView`, `DataTables`, `StoragePanel`, `PipelineAuditTicker`, `IntroTour` |
  | `lib/api.ts` | Typed API client for all FastAPI endpoints; uses `VITE_PYTHON_FAST_API_CLIENT_URL` env var |
  | `hooks/useEventStream.ts` | Opens `EventSource` to `/api/stream/events`; maps events to Zustand store actions |
  | `stores/pipelineStore.ts` | Zustand store — single source of truth for pipeline state, telemetry, anomalies |
  | `components/pipeline/` | `PipelineView`, `PipelineAuditTicker` — animated edge→cloud pipeline visualization |
  | `components/dashboard/` | `TurbineCard`, `StoragePanel`, `ConnectionToggle`, `DataTables`, `HeaderBar` |
  | `types/edgeguard.ts` | TypeScript types mirroring backend Pydantic models |
  | `vite.config.ts` | Vite config; proxies `/api/*` → `python-fast-api:3030` |

- **Tech stack:** React 19, React Router 7, Bun, Vite 6, TypeScript, Tailwind CSS v4, Framer Motion 12, Zustand 5, shadcn/ui (Radix UI), Recharts.
- Add frontend deps with `add-dependency` (service: `react-web-app`, type: `node`).

---

### `service-config-manager`
One-shot Python initializer. Reads YAML configs and idempotently provisions Couchbase (buckets, scopes, collections). Exits after provisioning; restarts automatically until Couchbase is ready.

- **Entrypoint:** `services/service-config-manager/bin/run`
- **Config it processes:** [`config/service-config-manager/managed-services.yaml`](config/service-config-manager/managed-services.yaml) → dispatches to `couchbase_controller.py` which reads [`config/couchbase-server/couchbase.yaml`](config/couchbase-server/couchbase.yaml).
- Supports per-environment overrides in `couchbase.yaml` (`dev`, `test`, `staging`, `prod`).
- **Tech stack:** Python 3.11, Couchbase SDK, PyYAML.

---

### Shared: `clients/python`
`clients/python/clients/couchbase/couchbase.py` — shared library mounted into both `python-fast-api` and `service-config-manager`.
- `CouchbaseClient` / `Keyspace` — lazy-cached cluster connection, thin collection wrapper with `insert`, `remove`, `list`, `query`.
- `get_client(name)` — reads env vars from the service name prefix (e.g. `couchbase-server` → `COUCHBASE_SERVER_HOST/USERNAME/PASSWORD/BUCKET`).

---

## Polytope & bluetext MCP

- **Server**: `project-0-couchbase-polytope` (Polytope sandbox; bluetext repo is included via `polytope.yml`).
- **First step**: Call **`get-server-instructions`** (no args) to get current usage instructions and when to use which tools.
- **Before calling any tool**: Read the tool's schema under the MCP server's `tools/` descriptor so you pass the right arguments.

### Running the stack

- **`stack`** – Runs the full stack defined in [polytope.yml](polytope.yml): `load-config` → `couchbase-server` → `sync-gateway` → `couchbase-edge-server` → `python-fast-api` → `react-web-app` → `service-config-manager`. Use this to start or restart the whole environment.
- **`run-service`** – Run a single service by name (e.g. `react-web-app`, `python-fast-api`, `couchbase-server`, `sync-gateway`, `couchbase-edge-server`, `service-config-manager`).
- **`add-and-run-stack`** – One-shot setup: template `full-stack` scaffolds and runs couchbase-server + python-fast-api + react-web-app + service-config-manager.

### Dependencies and config

- **`add-dependency`** – Add packages to a service. Required: `packages` (string), `service` (e.g. `react-web-app`), `type` (`node` for Bun/npm, `python` for uv). Use this instead of running `bun add` / `npm install` / `uv add` directly in the repo when working against the Polytope sandbox.
- **`load-config`** – Load [config/values.yml](config/values.yml) and config/secrets.yml into the Polytope context. Use when the session should pick up existing config.

### Inspection and debugging

- **`list-services`** – List services (optional filters: `like`, `tags`, `limit`). Use to see what's running and get service IDs/ports.
- **`list-containers`** – List containers.
- **`get-container-logs`** – Fetch logs for a container.
- **`call-endpoint`** – Call an HTTP endpoint (e.g. to hit the React app or Python API once they're up).

---

## Skills (use when relevant)

- **frontend-design** (`.agents/skills/frontend-design`) – Use when building or refining **web UIs**: pages, dashboards, React components, layouts, or styling. It emphasizes distinctive aesthetics, typography, color, motion, and avoiding generic "AI" look. Prefer this for any net-new UI or major visual overhaul.
- **framer-motion-animator** (`.agents/skills/framer-motion-animator`) – Use when adding or changing **animations** with Framer Motion: transitions, gestures, AnimatePresence, layout animations, staggered sequences. Read the skill when implementing things like "animate this list," "add a pulse," or "smooth merge/exit" so patterns match the skill's recommendations.

---

## Other MCPs

- **cursor-ide-browser** – Use for in-browser checks of the React app (navigate, snapshot, click, type). Follow its lock/unlock and snapshot-before-interact rules.
- **user-context7** – Use for up-to-date docs and examples (e.g. `query-docs`, `resolve-library-id`) when you need library/framework details.

---

## Summary

1. Call **`get-server-instructions`** when starting or when unsure how to use Polytope.
2. Use **Polytope** for running the stack, services, and adding dependencies; use **bluetext** tooling as exposed through that MCP (e.g. `stack`, `add-and-run-stack`).
3. The ML model must be pre-built before first stack start (or after any retrain). From the repo root:
   ```bash
   cd services/python-fast-api && PYTHONNOUSERSITE=1 PYTHONPATH="" uv run --no-project --isolated --with "scikit-learn>=1.8.0" --with "numpy>=2.4.2" --with "joblib>=1.5.3" python train_model.py
   ```
   Commit `services/python-fast-api/model/isolation_forest.joblib` afterward.
4. Use **frontend-design** for UI/dashboard work and **framer-motion-animator** for Framer Motion animations.
5. Check tool schemas in the MCP `tools/` folder before calling any Polytope or browser tool.
