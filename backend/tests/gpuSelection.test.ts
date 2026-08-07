import { describe, expect, it } from "vitest";
import { normalizeTrainingGpu } from "../src/lib/gpuSelection.js";

describe("normalizeTrainingGpu", () => {
  it("accepts documented Modal GPU types and supplies the default", () => {
    expect(normalizeTrainingGpu(undefined, "modal")).toBe("A10");
    expect(normalizeTrainingGpu("H100", "modal")).toBe("H100");
  });

  it("rejects arbitrary Modal resource strings", () => {
    expect(() => normalizeTrainingGpu("H100:99", "modal")).toThrow("Unsupported Modal GPU");
  });
});
