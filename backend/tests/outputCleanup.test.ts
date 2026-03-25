import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeJobOutputDir } from "../src/lib/outputCleanup.js";

describe("removeJobOutputDir", () => {
  it("removes job output directory under outputs root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-output-cleanup-"));
    const outputsRoot = path.join(root, "outputs");
    const outputDir = path.join(outputsRoot, "job-1");
    fs.mkdirSync(path.join(outputDir, "timelapse"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "model.ply"), "ply");

    const deleted = removeJobOutputDir(outputDir, outputsRoot);

    expect(deleted).toBe(true);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it("does not remove outputs root itself", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-output-cleanup-root-"));
    const outputsRoot = path.join(root, "outputs");
    fs.mkdirSync(outputsRoot, { recursive: true });

    const deleted = removeJobOutputDir(outputsRoot, outputsRoot);

    expect(deleted).toBe(false);
    expect(fs.existsSync(outputsRoot)).toBe(true);
  });

  it("does not remove directory outside outputs root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-output-cleanup-outside-"));
    const outputsRoot = path.join(root, "outputs");
    const outsideDir = path.join(root, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });

    const deleted = removeJobOutputDir(outsideDir, outputsRoot);

    expect(deleted).toBe(false);
    expect(fs.existsSync(outsideDir)).toBe(true);
  });
});
