export type CreateJobStrategy = "mrnf" | "mcmc" | "igs+";

export type CreateJobMaskMode = "none" | "segment" | "ignore" | "alpha_consistent";

export const CREATE_JOB_ITERATIONS_MIN = 1;
export const CREATE_JOB_ITERATIONS_MAX = 1_000_000;
export const CREATE_JOB_MAX_CAP_MIN = 100_000;
export const CREATE_JOB_MAX_CAP_MAX = 1_000_000_000;

/**
 * Return the number of optimisation steps that the trainer will actually run.
 *
 * `stepsScaler` is applied before rounding, while the optional sparsity phase
 * contributes its own steps after the scaled training iterations.
 */
export function getEffectiveTrainingSteps({
  iterations,
  stepsScaler,
  enableSparsity,
  sparsifySteps,
}: {
  iterations: number;
  stepsScaler: number;
  enableSparsity: boolean;
  sparsifySteps: number;
}): number {
  const effectiveScaler = Number.isFinite(stepsScaler) && stepsScaler > 0
    ? stepsScaler
    : 1;
  return (
    Math.max(1, Math.round(iterations * effectiveScaler)) +
    (enableSparsity ? sparsifySteps : 0)
  );
}

export interface CreateJobStrategyDefaults {
  iterations: number;
  strategy: CreateJobStrategy;
  shDegree: number;
  shDegreeInterval: number;
  maxCap: number;
  minOpacity: number;
  stepsScaler: number;
  random: boolean;
  initNumPts: number;
  initExtent: number;
  images: string;
  testEvery: number;
  resizeFactor: "auto" | 1 | 2 | 4 | 8;
  maxWidth: number;
  noCpuCache: boolean;
  noFsCache: boolean;
  eval: boolean;
  saveEvalImages: boolean;
  gut: boolean;
  undistort: boolean;
  maskMode: CreateJobMaskMode;
  invertMasks: boolean;
  noAlphaAsMask: boolean;
  enableSparsity: boolean;
  sparsifySteps: number;
  initRho: number;
  pruneRatio: number;
  enableMip: boolean;
  bilateralGrid: boolean;
  ppisp: boolean;
  ppispController: boolean;
  ppispFreeze: boolean;
  ppispSidecar: string;
  bgModulation: boolean;
}

export const UPSTREAM_MASK_FOLDERS = ["masks", "mask", "segmentation", "dynamic_masks"] as const;

const COMMON_DEFAULTS: Omit<CreateJobStrategyDefaults, "strategy" | "maxCap" | "minOpacity"> = {
  iterations: 30000,
  shDegree: 3,
  shDegreeInterval: 1000,
  stepsScaler: 1,
  random: false,
  initNumPts: 100000,
  initExtent: 3,
  images: "images",
  testEvery: 8,
  resizeFactor: "auto",
  maxWidth: 3840,
  noCpuCache: false,
  noFsCache: false,
  eval: false,
  saveEvalImages: true,
  gut: false,
  undistort: false,
  maskMode: "none",
  invertMasks: false,
  noAlphaAsMask: false,
  enableSparsity: false,
  sparsifySteps: 15000,
  initRho: 0.0005,
  pruneRatio: 0.6,
  enableMip: false,
  bilateralGrid: false,
  ppisp: false,
  ppispController: false,
  ppispFreeze: false,
  ppispSidecar: "",
  bgModulation: false,
};

const STRATEGY_DEFAULTS: Record<
  CreateJobStrategy,
  Pick<CreateJobStrategyDefaults, "maxCap" | "minOpacity">
> = {
  mrnf: {
    maxCap: 5000000,
    minOpacity: 1 / 255,
  },
  mcmc: {
    maxCap: 1000000,
    minOpacity: 0.005,
  },
  "igs+": {
    maxCap: 4000000,
    minOpacity: 0.005,
  },
};

export function getStrategyDefaults(strategy: CreateJobStrategy): CreateJobStrategyDefaults {
  return {
    ...COMMON_DEFAULTS,
    strategy,
    ...STRATEGY_DEFAULTS[strategy],
  };
}

export function applyVisibleStrategyDefaults<
  T extends { strategy: CreateJobStrategy; maxCap: number; minOpacity: number },
>(current: T, strategy: CreateJobStrategy): T {
  const next = getStrategyDefaults(strategy);
  return {
    ...current,
    strategy,
    maxCap: next.maxCap,
    minOpacity: next.minOpacity,
  };
}

export function shouldShowMaskSettings(hasMasks: boolean, hasAlphaImages = false): boolean {
  return hasMasks || hasAlphaImages;
}
