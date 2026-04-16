import os from "node:os";
import { spawn } from "node:child_process";

export interface GpuDeviceMetric {
  index: number;
  name: string;
  utilizationGpu: number | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  memoryUsedPercent: number | null;
  temperatureC: number | null;
}

export interface SystemMetrics {
  memory: {
    totalGb: number;
    usedGb: number;
    usedPercent: number;
  };
  gpu: {
    available: boolean;
    devices: GpuDeviceMetric[];
  };
  ts: string;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNvidiaSmiCsv(raw: string): GpuDeviceMetric[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim());
      if (parts.length < 6) return null;
      const index = Number(parts[0]);
      if (!Number.isFinite(index)) return null;

      const memoryUsedMiB = toNumberOrNull(parts[3]);
      const memoryTotalMiB = toNumberOrNull(parts[4]);
      const memoryUsedPercent =
        memoryUsedMiB !== null && memoryTotalMiB !== null && memoryTotalMiB > 0
          ? Number(((memoryUsedMiB / memoryTotalMiB) * 100).toFixed(1))
          : null;

      return {
        index,
        name: parts[1],
        utilizationGpu: toNumberOrNull(parts[2]),
        memoryUsedMiB,
        memoryTotalMiB,
        memoryUsedPercent,
        temperatureC: toNumberOrNull(parts[5])
      } satisfies GpuDeviceMetric;
    })
    .filter((item): item is GpuDeviceMetric => item !== null);
}

/** Run nvidia-smi asynchronously, resolving to its stdout or null on failure. */
async function runNvidiaSmi(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "nvidia-smi",
      ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
      { timeout: 2500 }
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("close", (code) => { resolve(code === 0 ? stdout : null); });
    child.on("error", () => { resolve(null); });
  });
}

function buildMetrics(gpuDevices: GpuDeviceMetric[]): SystemMetrics {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    memory: {
      totalGb: Number((total / 1024 / 1024 / 1024).toFixed(2)),
      usedGb: Number((used / 1024 / 1024 / 1024).toFixed(2)),
      usedPercent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
    },
    gpu: {
      available: gpuDevices.length > 0,
      devices: gpuDevices,
    },
    ts: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Background cache – refreshed every 5 s so route handlers never block.
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 5_000;
let cachedMetrics: SystemMetrics = buildMetrics([]);
let refreshTimer: NodeJS.Timeout | null = null;

async function refreshCache() {
  try {
    const stdout = await runNvidiaSmi();
    const devices = stdout ? parseNvidiaSmiCsv(stdout) : [];
    cachedMetrics = buildMetrics(devices);
  } catch {
    // Keep stale cache on error; memory metrics are updated each refresh via buildMetrics.
    cachedMetrics = buildMetrics(cachedMetrics.gpu.devices);
  }
}

/** Start the background nvidia-smi polling. Safe to call multiple times. */
export function startMetricsPoller() {
  if (refreshTimer) return;
  void refreshCache();
  refreshTimer = setInterval(() => { void refreshCache(); }, REFRESH_INTERVAL_MS);
  // Allow process to exit even if interval is still running.
  refreshTimer.unref();
}

/** Returns the most recently cached metrics snapshot (never blocks). */
export function readSystemMetrics(): SystemMetrics {
  // Always refresh the memory portion inline (cheap os calls, no subprocess).
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    ...cachedMetrics,
    memory: {
      totalGb: Number((total / 1024 / 1024 / 1024).toFixed(2)),
      usedGb: Number((used / 1024 / 1024 / 1024).toFixed(2)),
      usedPercent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
    },
    ts: new Date().toISOString(),
  };
}
