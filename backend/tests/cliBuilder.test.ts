import { describe, expect, it } from "vitest";
import { buildLfsArgs } from "../src/lib/cliBuilder.js";

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
});
