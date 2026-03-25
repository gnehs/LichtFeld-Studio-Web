import { describe, expect, it } from "vitest";
import { parseNvidiaSmiCsv } from "../src/lib/systemMetrics.js";

describe("systemMetrics parser", () => {
  it("parses gpu metrics and computes vram usage percent", () => {
    const devices = parseNvidiaSmiCsv("0, NVIDIA RTX 4090, 74, 12000, 24564, 68\n1, NVIDIA RTX 4090, 11, 4096, 24564, 52\n");

    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      index: 0,
      name: "NVIDIA RTX 4090",
      utilizationGpu: 74,
      memoryUsedMiB: 12000,
      memoryTotalMiB: 24564,
      memoryUsedPercent: 48.9,
      temperatureC: 68
    });
    expect(devices[1]?.memoryUsedPercent).toBe(16.7);
  });

  it("ignores malformed lines", () => {
    const devices = parseNvidiaSmiCsv("not-valid\n2, NVIDIA A100, 80, 10000, 80000, 65\n");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.index).toBe(2);
  });
});
