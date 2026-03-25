import type { TimelapseFrame, TrainingJob } from "@/lib/types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseIterations(job: TrainingJob | null): number | null {
  if (!job?.paramsJson) return null;
  try {
    const parsed = JSON.parse(job.paramsJson) as { iterations?: unknown };
    const value = Number(parsed?.iterations ?? 0);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
  } catch {
    return null;
  }
}

export function computeProgress(job: TrainingJob | null, latestIteration: number | null) {
  const targetIterations = parseIterations(job);
  const latest = latestIteration && Number.isFinite(latestIteration) ? Math.max(0, Math.floor(latestIteration)) : 0;
  if (!targetIterations) {
    return {
      targetIterations: null,
      latestIteration: latest,
      ratio: null as number | null
    };
  }

  return {
    targetIterations,
    latestIteration: latest,
    ratio: clamp01(latest / targetIterations)
  };
}

export function sortFramesAscending(frames: TimelapseFrame[]): TimelapseFrame[] {
  return [...frames].sort((a, b) => a.iteration - b.iteration);
}
