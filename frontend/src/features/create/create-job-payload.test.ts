import { describe, expect, test } from "vitest";
import type { TrainingParamsForm } from "@/lib/types";
import { getStrategyDefaults } from "./create-job-defaults";

interface CreateWizardValues {
  iterations: number;
  strategy: "mcmc" | "adc" | "igs+";
  shDegree?: number;
  shDegreeInterval?: number;
  maxCap: number;
  minOpacity?: number;
  stepsScaler?: number;
  tileMode?: 1 | 2 | 4;
  random?: boolean;
  initNumPts?: number;
  initExtent?: number;
  images?: string;
  testEvery?: number;
  resizeFactor: "auto" | 1 | 2 | 4 | 8;
  maxWidth?: number;
  noCpuCache?: boolean;
  noFsCache?: boolean;
  eval: boolean;
  saveEvalImages: boolean;
  saveDepth?: boolean;
  gut: boolean;
  undistort: boolean;
  maskMode?: "none" | "segment" | "ignore" | "alpha_consistent";
  invertMasks?: boolean;
  noAlphaAsMask?: boolean;
  enableSparsity?: boolean;
  sparsifySteps?: number;
  initRho?: number;
  pruneRatio?: number;
  enableMip?: boolean;
  bilateralGrid?: boolean;
  ppisp?: boolean;
  ppispController?: boolean;
  ppispFreeze?: boolean;
  ppispSidecar?: string;
  bgModulation?: boolean;
  advancedJson: string;
}

function buildPayloadParams(form: CreateWizardValues): TrainingParamsForm {
  let advanced: Partial<TrainingParamsForm> = {};
  if (form.advancedJson.trim()) {
    const parsed = JSON.parse(form.advancedJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("進階參數必須是 JSON 物件");
    }
    advanced = parsed as Partial<TrainingParamsForm>;
  }

  const payloadParams: TrainingParamsForm = {
    ...advanced,
    iterations: form.iterations,
    strategy: form.strategy,
    shDegree: form.shDegree,
    shDegreeInterval: form.shDegreeInterval,
    maxCap: form.maxCap,
    minOpacity: form.minOpacity,
    stepsScaler: form.stepsScaler,
    tileMode: form.tileMode,
    random: form.random,
    initNumPts: form.initNumPts,
    initExtent: form.initExtent,
    images: form.images?.trim() || undefined,
    testEvery: form.testEvery,
    resizeFactor: form.resizeFactor,
    maxWidth: form.maxWidth,
    noCpuCache: form.noCpuCache,
    noFsCache: form.noFsCache,
    eval: form.eval,
    saveEvalImages: form.saveEvalImages,
    saveDepth: form.saveDepth,
    gut: form.gut,
    undistort: form.undistort,
    maskMode: form.maskMode,
    invertMasks: form.invertMasks,
    noAlphaAsMask: form.noAlphaAsMask,
    enableSparsity: form.enableSparsity,
    sparsifySteps: form.sparsifySteps,
    initRho: form.initRho,
    pruneRatio: form.pruneRatio,
    enableMip: form.enableMip,
    bilateralGrid: form.bilateralGrid,
    ppisp: form.ppisp,
    ppispController: form.ppispController,
    ppispFreeze: form.ppispFreeze,
    ppispSidecar: form.ppispSidecar,
    bgModulation: form.bgModulation,
  };

  delete payloadParams.dataPath;
  return payloadParams;
}

describe("create job payload mapping", () => {
  test("merges advanced training params with visible form values", () => {
    const payload = buildPayloadParams({
      iterations: 30000,
      strategy: "mcmc",
      shDegree: 3,
      shDegreeInterval: 1000,
      maxCap: 500000,
      minOpacity: 0,
      stepsScaler: 1,
      tileMode: 4,
      random: false,
      initNumPts: 0,
      initExtent: 0,
      images: "",
      testEvery: 0,
      resizeFactor: "auto",
      maxWidth: 0,
      noCpuCache: false,
      noFsCache: false,
      eval: false,
      saveEvalImages: false,
      saveDepth: false,
      gut: false,
      undistort: false,
      maskMode: "none",
      invertMasks: false,
      noAlphaAsMask: false,
      enableSparsity: false,
      sparsifySteps: 0,
      initRho: 0,
      pruneRatio: 0,
      enableMip: false,
      bilateralGrid: false,
      ppisp: false,
      ppispController: false,
      ppispFreeze: false,
      ppispSidecar: "",
      bgModulation: false,
      advancedJson: JSON.stringify({
        dataPath: "/should/be/removed",
        shDegree: 4,
        shDegreeInterval: 800,
        minOpacity: 0.015,
        stepsScaler: 1.5,
        tileMode: 4,
        random: true,
        initNumPts: 250000,
        initExtent: 12,
        images: "*.png",
        testEvery: 250,
        maxWidth: 1920,
        noCpuCache: true,
        noFsCache: true,
        maskMode: "alpha_consistent",
        invertMasks: true,
        noAlphaAsMask: true,
        enableSparsity: true,
        sparsifySteps: 1200,
        initRho: 0.8,
        pruneRatio: 0.2,
        enableMip: true,
        bilateralGrid: true,
        ppisp: true,
        ppispController: true,
        ppispFreeze: true,
        ppispSidecar: "/data/ppisp/sidecar.json",
        bgModulation: true,
        saveDepth: true,
        noSplash: true,
        noInterop: true,
        debugPython: true,
        debugPythonPort: 9010,
        verbose: true,
        quiet: false,
        logFile: "/data/logs/train.log",
        logFilter: "train.*",
        pythonScripts: ["/data/scripts/pre.py", "/data/scripts/post.py"],
      }),
    });

    expect(payload).toMatchObject({
      iterations: 30000,
      strategy: "mcmc",
      maxCap: 500000,
      resizeFactor: "auto",
      eval: false,
      saveEvalImages: false,
      gut: false,
      undistort: false,
    });

    expect(payload).not.toHaveProperty("dataPath");
  });

  test("matches upstream gui defaults for visible training controls", () => {
    const payload = buildPayloadParams({
      ...getStrategyDefaults("mcmc"),
      advancedJson: "",
    });

    expect(payload).toMatchObject({
      iterations: 30000,
      strategy: "mcmc",
      shDegree: 3,
      shDegreeInterval: 1000,
      maxCap: 1000000,
      minOpacity: 0.005,
      stepsScaler: 1,
      tileMode: 1,
      random: false,
      initNumPts: 100000,
      initExtent: 3,
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
      enableSparsity: false,
      sparsifySteps: 15000,
      initRho: 0.001,
      pruneRatio: 0.6,
      enableMip: false,
      bilateralGrid: false,
      ppisp: true,
      ppispController: false,
      ppispFreeze: false,
      bgModulation: false,
    });

    expect(payload.testEvery).toBe(8);
    expect(payload.images).toBe("images");
  });
});
