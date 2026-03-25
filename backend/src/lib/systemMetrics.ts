import os from "node:os";
import { spawnSync } from "node:child_process";

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

export function readSystemMetrics(): SystemMetrics {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);

  const memory = {
    totalGb: Number((total / 1024 / 1024 / 1024).toFixed(2)),
    usedGb: Number((used / 1024 / 1024 / 1024).toFixed(2)),
    usedPercent: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0
  };

  const gpuCommand = spawnSync(
    "nvidia-smi",
    ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
    {
      encoding: "utf-8",
      timeout: 2500
    }
  );

  const devices =
    gpuCommand.status === 0 && typeof gpuCommand.stdout === "string"
      ? parseNvidiaSmiCsv(gpuCommand.stdout)
      : [];

  return {
    memory,
    gpu: {
      available: devices.length > 0,
      devices
    },
    ts: new Date().toISOString()
  };
}
