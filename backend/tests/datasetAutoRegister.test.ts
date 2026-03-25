import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATASET_STABLE_WINDOW_MS,
  UPLOAD_IN_PROGRESS_MARKER,
  evaluateDatasetForAutoRegister,
  inspectDatasetFolder
} from "../src/lib/datasetAutoRegister.js";

function createDatasetRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-auto-"));
  fs.mkdirSync(path.join(root, "images"), { recursive: true });
  fs.mkdirSync(path.join(root, "sparse"), { recursive: true });
  return root;
}

describe("dataset auto register guard", () => {
  it("returns invalid when upload marker exists", () => {
    const datasetPath = createDatasetRoot();
    fs.writeFileSync(path.join(datasetPath, UPLOAD_IN_PROGRESS_MARKER), "1");

    const result = evaluateDatasetForAutoRegister(datasetPath, {
      nowMs: Date.now() + DATASET_STABLE_WINDOW_MS + 1
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("upload in progress");
  });

  it("returns invalid when dataset was modified recently", () => {
    const datasetPath = createDatasetRoot();

    const result = evaluateDatasetForAutoRegister(datasetPath, {
      nowMs: Date.now()
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("still being written");
  });

  it("returns valid after stable window elapsed", () => {
    const datasetPath = createDatasetRoot();

    const result = evaluateDatasetForAutoRegister(datasetPath, {
      nowMs: Date.now() + DATASET_STABLE_WINDOW_MS + 1
    });

    expect(result).toEqual({ ok: true });
  });

  it("reports image count when folder is ready", () => {
    const datasetPath = createDatasetRoot();
    fs.writeFileSync(path.join(datasetPath, "images", "0001.jpg"), "image");
    fs.writeFileSync(path.join(datasetPath, "images", "0002.png"), "image");
    fs.writeFileSync(path.join(datasetPath, "images", "README.txt"), "text");

    const result = inspectDatasetFolder(datasetPath, {
      nowMs: Date.now() + DATASET_STABLE_WINDOW_MS + 1
    });

    expect(result.status).toBe("ready");
    expect(result.imageCount).toBe(2);
    expect(result.reason).toBeNull();
  });

  it("reports invalid reason for malformed dataset", () => {
    const datasetPath = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-auto-invalid-"));
    fs.mkdirSync(path.join(datasetPath, "images"), { recursive: true });

    const result = inspectDatasetFolder(datasetPath);

    expect(result.status).toBe("invalid");
    expect(result.reason).toContain("Missing sparse/");
    expect(result.imageCount).toBeNull();
  });
});
