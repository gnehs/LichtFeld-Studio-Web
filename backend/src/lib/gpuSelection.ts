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
  return candidate;
}
