import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { parseIterationFromFilename, scanTimelapseDir } from "../src/lib/timelapse.js";

describe("timelapse parser", () => {
  it("parses iteration from filename", () => {
    expect(parseIterationFromFilename("/tmp/000100.jpg")).toBe(100);
    expect(parseIterationFromFilename("/tmp/not-a-frame.txt")).toBeNull();
  });

  it("scans timelapse folder structure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-timelapse-"));
    const outputPath = root;
    const cameraDir = path.join(root, "timelapse", "IMG_6672");
    fs.mkdirSync(cameraDir, { recursive: true });
    fs.writeFileSync(path.join(cameraDir, "000100.jpg"), "a");
    fs.writeFileSync(path.join(cameraDir, "000200.jpg"), "b");

    const frames = scanTimelapseDir(outputPath);
    expect(frames.length).toBe(2);
    expect(frames[0].cameraName).toBe("IMG_6672");
    expect(frames[0].iteration).toBe(200);
  });
});
