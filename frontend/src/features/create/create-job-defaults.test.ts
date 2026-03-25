import { describe, expect, test } from "vitest";
import {
  applyVisibleStrategyDefaults,
  getStrategyDefaults,
  shouldShowMaskSettings,
} from "./create-job-defaults";

describe("create job strategy defaults", () => {
  test("returns upstream-inspired presets per strategy", () => {
    expect(getStrategyDefaults("mcmc")).toMatchObject({
      strategy: "mcmc",
      maxCap: 1000000,
      ppisp: true,
      tileMode: 1,
    });

    expect(getStrategyDefaults("adc")).toMatchObject({
      strategy: "adc",
      maxCap: 6000000,
      ppisp: true,
    });

    expect(getStrategyDefaults("igs+")).toMatchObject({
      strategy: "igs+",
      maxCap: 4000000,
      ppisp: true,
    });

    expect(getStrategyDefaults("lfs")).toMatchObject({
      strategy: "lfs",
      maxCap: 5000000,
      ppisp: true,
    });
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
      images: "custom-images",
    };

    expect(applyVisibleStrategyDefaults(current, "adc")).toMatchObject({
      strategy: "adc",
      maxCap: 6000000,
      images: "custom-images",
    });
  });
});
