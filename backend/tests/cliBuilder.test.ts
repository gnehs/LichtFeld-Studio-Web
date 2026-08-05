import { describe, expect, it } from "vitest";
import { buildLfsArgs } from "../src/lib/cliBuilder.js";
import type { TrainingParamsForm } from "../src/types/models.js";

describe("buildLfsArgs", () => {
  it("maps timelapse images and interval", () => {
    const args = buildLfsArgs({
      dataPath: "/data/garden",
      outputPath: "/outputs/garden",
      timelapse: {
        images: ["IMG_1.JPG", "IMG_2.JPG"],
        every: 100
      }
    });

    expect(args).toContain("--timelapse-images");
    expect(args).toContain("IMG_1.JPG");
    expect(args).toContain("IMG_2.JPG");

    const everyIndex = args.findIndex((a) => a === "--timelapse-every");
    expect(everyIndex).toBeGreaterThan(-1);
    expect(args[everyIndex + 1]).toBe("100");
  });

  it("omits timelapse flags when empty", () => {
    const args = buildLfsArgs({
      dataPath: "/data/garden",
      outputPath: "/outputs/garden",
      timelapse: {
        images: [],
        every: 0
      }
    });

    expect(args.includes("--timelapse-images")).toBe(false);
    expect(args.includes("--timelapse-every")).toBe(false);
  });

  it("always injects headless and train flags", () => {
    const args = buildLfsArgs({
      dataPath: "/data/garden",
      outputPath: "/outputs/garden"
    });

    expect(args).toContain("--headless");
    expect(args).toContain("--train");
  });

  it("maps v0.5.3 background and evaluation flags", () => {
    const args = buildLfsArgs({
      bgModulation: true,
      saveEvalImages: false,
    });

    expect(args).toContain("--bg-mode");
    expect(args[args.indexOf("--bg-mode") + 1]).toBe("modulation");
    expect(args).toContain("--no-save-eval-images");
    expect(args).not.toContain("--bg-modulation");
    expect(args).not.toContain("--save-eval-images");
  });

  it("does not emit removed v0.5.3-incompatible flags", () => {
    const legacyParams = {
      tileMode: 4,
      saveDepth: true,
      noInterop: true,
      bgModulation: false,
      saveEvalImages: true,
    } as unknown as TrainingParamsForm;

    const args = buildLfsArgs(legacyParams);

    expect(args).not.toContain("--tile-mode");
    expect(args).not.toContain("--save-depth");
    expect(args).not.toContain("--no-interop");
    expect(args).not.toContain("--bg-modulation");
    expect(args).not.toContain("--save-eval-images");
    expect(args).not.toContain("--no-save-eval-images");
    expect(args).not.toContain("--bg-mode");
  });
});
