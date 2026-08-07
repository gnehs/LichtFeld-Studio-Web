import { readSystemMetrics } from "./systemMetrics.js";
import type { TrainingExecutor } from "../types/models.js";

export const MODAL_GPU_OPTIONS = [
  "T4",
  "L4",
  "A10",
  "L40S",
  "A100",
  "A100-40GB",
  "A100-80GB",
  "RTX-PRO-6000",
  "H100",
  "H100!",
  "H200",
  "B200",
  "B200+",
  "B300"
] as const;

export function normalizeTrainingGpu(
  value: string | undefined,
  executor: TrainingExecutor
): string | undefined {
  const candidate = value?.trim();
  if (!candidate) {
    return executor === "modal" ? "A10" : undefined;
  }

  if (executor === "modal") {
    if (!(MODAL_GPU_OPTIONS as readonly string[]).includes(candidate)) {
      throw new Error(`Unsupported Modal GPU: ${candidate}`);
    }
    return candidate;
  }

  if (!/^\d+$/.test(candidate)) {
    throw new Error("Local GPU must be a CUDA device index");
  }
  const index = Number(candidate);
  const devices = readSystemMetrics().gpu.devices;
  if (!Number.isSafeInteger(index) || !devices.some((device) => device.index === index)) {
    throw new Error(`Local GPU ${candidate} is not available`);
  }
  return String(index);
}

export function getTrainingGpuOptions(executor: TrainingExecutor) {
  if (executor === "modal") {
    return {
      trainingOptions: MODAL_GPU_OPTIONS.map((value) => ({ value, label: value })),
      defaultSelection: "A10"
    };
  }

  const devices = readSystemMetrics().gpu.devices;
  return {
    trainingOptions: devices.map((device) => ({
      value: String(device.index),
      label: `GPU ${device.index} · ${device.name}`
    })),
    defaultSelection: devices[0] ? String(devices[0].index) : null
  };
}
