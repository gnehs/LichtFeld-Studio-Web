import { describe, expect, it } from "vitest";
import { computeEffectiveIterations } from "../src/lib/trainingParams.js";

describe("computeEffectiveIterations", () => {
  it("matches LichtFeld positive step-scaler rounding", () => {
    expect(computeEffectiveIterations({ iterations: 30_000, stepsScaler: 1.5 })).toBe(45_000);
    expect(computeEffectiveIterations({ iterations: 3, stepsScaler: 1.5 })).toBe(5);
  });

  it("includes the unscaled sparsification tail", () => {
    expect(computeEffectiveIterations({
      iterations: 30_000,
      stepsScaler: 2,
      enableSparsity: true,
      sparsifySteps: 15_000
    })).toBe(75_000);
  });
});
