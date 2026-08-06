import { describe, expect, test } from "vitest";
import {
  applyVisibleStrategyDefaults,
  CREATE_JOB_ITERATIONS_MAX,
  CREATE_JOB_ITERATIONS_MIN,
  CREATE_JOB_MAX_CAP_MAX,
  CREATE_JOB_MAX_CAP_MIN,
  getStrategyDefaults,
  shouldShowMaskSettings,
} from "@/features/create/create-job-defaults";

describe("create job strategy defaults", () => {
  test("exposes direct-input bounds for core training controls", () => {
    expect(CREATE_JOB_ITERATIONS_MIN).toBe(1);
    expect(CREATE_JOB_ITERATIONS_MAX).toBe(1_000_000);
    expect(CREATE_JOB_MAX_CAP_MIN).toBe(100_000);
    expect(CREATE_JOB_MAX_CAP_MAX).toBe(1_000_000_000);
  });

  test("matches LichtFeld v0.5.3 presets per strategy", () => {
    expect(getStrategyDefaults("mrnf")).toMatchObject({
      strategy: "mrnf",
      maxCap: 5000000,
      minOpacity: 1 / 255,
      initRho: 0.0005,
      ppisp: false,
      saveEvalImages: true,
    });

    expect(getStrategyDefaults("mcmc")).toMatchObject({
      strategy: "mcmc",
      maxCap: 1000000,
      minOpacity: 0.005,
      initRho: 0.0005,
      ppisp: false,
      saveEvalImages: true,
    });

    expect(getStrategyDefaults("igs+")).toMatchObject({
      strategy: "igs+",
      maxCap: 4000000,
      minOpacity: 0.005,
      initRho: 0.0005,
      ppisp: false,
    });

    expect(getStrategyDefaults("mcmc")).not.toHaveProperty("tileMode");
    expect(getStrategyDefaults("mcmc")).not.toHaveProperty("saveDepth");
  });

  test("shows mask settings when dataset has masks or alpha images", () => {
    expect(shouldShowMaskSettings(true)).toBe(true);
    expect(shouldShowMaskSettings(false, true)).toBe(true);
    expect(shouldShowMaskSettings(false)).toBe(false);
  });

  test("switches visible strategy defaults automatically", () => {
    const current = {
      ...getStrategyDefaults("mcmc"),
      maxCap: 1234567,
      minOpacity: 0.123,
      images: "custom-images",
    };

    expect(applyVisibleStrategyDefaults(current, "mrnf")).toMatchObject({
      strategy: "mrnf",
      maxCap: 5000000,
      minOpacity: 1 / 255,
      images: "custom-images",
    });
  });
});
