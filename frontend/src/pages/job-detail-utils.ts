import type { TimelapseFrame, TrainingJob } from "@/lib/types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface LichtFeldProgressLog {
  latestIteration: number | null;
  targetIterations: number | null;
}

const ANSI_ESCAPE_RE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const PROGRESS_LINE_RE = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*\|\s*Loss\s*:/i;

function parseProgressNumber(value: string): number | null {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Extract the furthest LichtFeld training progress from one or more log lines.
 * The trainer redraws progress in-place and may include ANSI terminal escapes,
 * so callers should pass every received line and use the returned maxima.
 */
export function parseLichtFeldProgressLog(
  lines: readonly string[] | string,
): LichtFeldProgressLog {
  const source = typeof lines === "string" ? [lines] : lines;
  let latestIteration: number | null = null;
  let targetIterations: number | null = null;

  for (const line of source) {
    const cleanLine = String(line).replace(ANSI_ESCAPE_RE, "");
    const match = cleanLine.match(PROGRESS_LINE_RE);
    if (!match) continue;

    const iteration = parseProgressNumber(match[1]);
    const total = parseProgressNumber(match[2]);
    if (iteration !== null && (latestIteration === null || iteration > latestIteration)) {
      latestIteration = iteration;
    }
    if (total !== null && total > 0 && (targetIterations === null || total > targetIterations)) {
      targetIterations = total;
    }
  }

  return { latestIteration, targetIterations };
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

export function computeProgress(
  job: TrainingJob | null,
  latestIteration: number | null,
  fallbackTargetIterations: number | null = null,
) {
  const targetIterations = parseIterations(job) ?? (
    fallbackTargetIterations !== null &&
    Number.isFinite(fallbackTargetIterations) &&
    fallbackTargetIterations > 0
      ? Math.floor(fallbackTargetIterations)
      : null
  );
  const latest =
    latestIteration !== null && Number.isFinite(latestIteration)
      ? Math.max(0, Math.floor(latestIteration))
      : 0;
  if (!targetIterations) {
    return {
      targetIterations: null,
      latestIteration: latest,
      ratio: job?.status === "completed" ? 1 : (null as number | null)
    };
  }

  return {
    targetIterations,
    latestIteration: latest,
    ratio: job?.status === "completed" ? 1 : clamp01(latest / targetIterations)
  };
}

export function sortFramesAscending(frames: TimelapseFrame[]): TimelapseFrame[] {
  return [...frames].sort((a, b) => a.iteration - b.iteration);
}
