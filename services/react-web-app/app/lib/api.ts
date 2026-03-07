import type {
  DataPoint,
  EdgeGuardItem,
} from "~/types/edgeguard";

// ---------- Types matching backend Pydantic models ----------

export interface SystemConfig {
  edgeCapacity: number;
  compactionThreshold: number;
  turbineCount: number;
  emitIntervalMs: number;
  drainIntervalMs: number;
}

export interface SystemStatus {
  isRunning: boolean;
  isInitialized: boolean;
  isOnline: boolean;
  sequenceNumber: number;
  enabledTurbines: number[];
}

export interface Metrics {
  totalPacketsEmitted: number;
  totalAnomalies: number;
  edgePressure: number;
  compactionCount: number;
  lastSyncTimestamp: number | null;
  edgeStorageLength: number;
  centralStorageLength: number;
}

export interface CompactionLogEntry {
  message: string;
  timestamp: number;
  severity: "compaction" | "sync" | "warning" | "info";
}

// ---------- SSE event payloads ----------

export interface EdgeUpdatePayload {
  item: EdgeGuardItem;
  storageLength: number;
  pressure: number;
}

export interface CentralUpdatePayload {
  item: EdgeGuardItem;
  lastSyncTimestamp: number;
}

export interface CompactionPayload {
  log: CompactionLogEntry;
  edgeStorage: EdgeGuardItem[];
  compactionCount: number;
}

/** Initial state sent when a client connects to the SSE stream (so edge/central data is visible after refresh). */
export interface SnapshotPayload {
  edgeStorage: EdgeGuardItem[];
  centralStorage: EdgeGuardItem[];
  metrics: Metrics;
  systemStatus: SystemStatus;
  compactionLogs: CompactionLogEntry[];
  compactionCount: number;
}

// ---------- Base URL ----------
// In the browser, use relative URLs so requests go through the Vite proxy
// (which forwards /api/* to the FastAPI service inside the sandbox).
// For SSR, the env var resolves to the internal hostname.

const ENV_KEY = "VITE_PYTHON_FAST_API_CLIENT_URL";
const env = import.meta.env as Record<string, string | undefined>;
const IS_BROWSER = typeof window !== "undefined";
const BASE_URL = IS_BROWSER ? "" : (env[ENV_KEY] ?? "");

export function getBaseUrl(): string {
  return BASE_URL;
}

// ---------- Generic fetch wrapper ----------

async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (data !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  const text = await response.text();
  throw new Error(`API ${method} ${path} failed (${response.status}): ${text}`);
}

// ---------- Typed API functions ----------

export const edgeguardApi = {
  getConfig: () => request<SystemConfig>("GET", "/api/system/config"),
  getStatus: () => request<SystemStatus>("GET", "/api/system/status"),
  initialize: () => request<{ ok: boolean }>("POST", "/api/system/initialize"),
  start: () => request<{ ok: boolean }>("POST", "/api/system/start"),
  stop: () => request<{ ok: boolean }>("POST", "/api/system/stop"),
  setConnection: (online: boolean) =>
    request<{ ok: boolean }>("POST", "/api/connection", { online }),
  setTurbineEnabled: (turbineId: number, enabled: boolean) =>
    request<{ ok: boolean }>("PATCH", `/api/turbines/${turbineId}`, { enabled }),
  injectAnomaly: (turbineId: number) =>
    request<{ ok: boolean }>("POST", `/api/turbines/${turbineId}/anomaly`),
  clearAnomaly: (turbineId: number) =>
    request<{ ok: boolean }>("DELETE", `/api/turbines/${turbineId}/anomaly`),
  getEdgeStorage: () => request<EdgeGuardItem[]>("GET", "/api/storage/edge"),
  clearEdgeStorage: () => request<{ ok: boolean }>("POST", "/api/storage/edge/clear"),
  getCentralStorage: () => request<EdgeGuardItem[]>("GET", "/api/storage/central"),
  clearAllStorage: () => request<{ ok: boolean }>("POST", "/api/storage/clear"),
  getMetrics: () => request<Metrics>("GET", "/api/metrics"),
  getTurbineHistory: (id: number) =>
    request<DataPoint[]>("GET", `/api/turbines/${id}/history`),
};
