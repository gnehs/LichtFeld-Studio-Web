export type CreateJobStrategy = "mrnf" | "mcmc" | "igs+";

export type CreateJobMaskMode = "none" | "segment" | "ignore" | "alpha_consistent";

export interface CreateJobStrategyDefaults {
  iterations: number;
  strategy: CreateJobStrategy;
  shDegree: number;
  shDegreeInterval: number;
  maxCap: number;
  minOpacity: number;
  stepsScaler: number;
  tileMode: 1 | 2 | 4;
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
  saveDepth: boolean;
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

const COMMON_DEFAULTS: Omit<CreateJobStrategyDefaults, "strategy" | "maxCap"> = {
  iterations: 30000,
  shDegree: 3,
  shDegreeInterval: 1000,
  minOpacity: 0.005,
  stepsScaler: 1,
  tileMode: 1,
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
  saveDepth: false,
  gut: false,
  undistort: false,
  maskMode: "none",
  invertMasks: false,
  noAlphaAsMask: false,
  enableSparsity: false,
  sparsifySteps: 15000,
  initRho: 0.001,
  pruneRatio: 0.6,
  enableMip: false,
  bilateralGrid: false,
  ppisp: true,
  ppispController: false,
  ppispFreeze: false,
  ppispSidecar: "",
  bgModulation: false,
};

const STRATEGY_MAX_CAP: Record<CreateJobStrategy, number> = {
  mrnf: 5000000,
  mcmc: 1000000,
  "igs+": 4000000,
};

export function getStrategyDefaults(strategy: CreateJobStrategy): CreateJobStrategyDefaults {
  return {
    ...COMMON_DEFAULTS,
    strategy,
    maxCap: STRATEGY_MAX_CAP[strategy],
  };
}

export function applyVisibleStrategyDefaults<T extends { strategy: CreateJobStrategy; maxCap: number }>(
  current: T,
  strategy: CreateJobStrategy,
): T {
  const next = getStrategyDefaults(strategy);
  return {
    ...current,
    strategy,
    maxCap: next.maxCap,
  };
}

export function shouldShowMaskSettings(hasMasks: boolean, hasAlphaImages = false): boolean {
  return hasMasks || hasAlphaImages;
}
