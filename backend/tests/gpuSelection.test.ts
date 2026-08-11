import { describe, expect, it } from "vitest";
import { isLargerCompatibleModalGpu, normalizeTrainingGpu } from "../src/lib/gpuSelection.js";

describe("normalizeTrainingGpu", () => {
  it("accepts documented Modal GPU types and supplies the default", () => {
    expect(normalizeTrainingGpu(undefined, "modal")).toBe("A10");
    expect(normalizeTrainingGpu("H100", "modal")).toBe("H100");
  });

  it("rejects arbitrary Modal resource strings", () => {
    expect(() => normalizeTrainingGpu("H100:99", "modal")).toThrow("Unsupported Modal GPU");
  });

  it("accepts only a higher compatible tier for checkpoint retries", () => {
    expect(isLargerCompatibleModalGpu("A10", "L40S")).toBe(true);
    expect(isLargerCompatibleModalGpu("A10", "L4")).toBe(false);
    expect(isLargerCompatibleModalGpu("H200", "B200")).toBe(true);
    expect(isLargerCompatibleModalGpu("B200", "B300")).toBe(false);
  });
});
