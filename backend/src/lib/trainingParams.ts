import type { TrainingParamsForm } from "../types/models.js";

/** Mirror LichtFeld's positive step-scaler rounding for the displayed target. */
export function computeEffectiveIterations(params: TrainingParamsForm): number | undefined {
  const iterations = params.iterations;
  if (!Number.isSafeInteger(iterations) || iterations === undefined || iterations <= 0) {
    return undefined;
  }

  const requestedScaler = params.stepsScaler ?? 1;
  const scaler = Number.isFinite(requestedScaler) && requestedScaler > 0 ? requestedScaler : 1;
  const scaledIterations = Math.max(1, Math.round(iterations * scaler));
  const sparsifyIterations =
    params.enableSparsity && Number.isSafeInteger(params.sparsifySteps) && (params.sparsifySteps ?? 0) > 0
      ? params.sparsifySteps ?? 0
      : 0;
  return scaledIterations + sparsifyIterations;
}
