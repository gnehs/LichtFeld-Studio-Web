import { describe, expect, test } from "vitest";
import {
  getModalGpuUpgradeOptions,
  getRecommendedModalGpu,
} from "@/lib/modal-gpus";

describe("Modal GPU upgrades", () => {
  test("recommends a higher capability tier than the failed GPU", () => {
    expect(getRecommendedModalGpu("A10")).toBe("A100");
    expect(getModalGpuUpgradeOptions("A10")).not.toContain("T4");
    expect(getModalGpuUpgradeOptions("A10")).not.toContain("L4");
    expect(getModalGpuUpgradeOptions("A10")).toContain("L40S");
  });

  test("does not offer B300 variants to the CUDA 12.8 retry image", () => {
    expect(getModalGpuUpgradeOptions("H200")).toEqual(["B200"]);
    expect(getModalGpuUpgradeOptions("B200")).toEqual([]);
  });
});
