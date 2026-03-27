import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestEnv = {
  datasetsDir: string;
  restore: () => void;
};

function setupTestEnv(): TestEnv {
  const originalEnv = process.env;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-service-"));
  const datasetsDir = path.join(root, "datasets");
  const outputsDir = path.join(root, "outputs");
  const logsDir = path.join(root, "logs");
  const dbPath = path.join(root, "db", "app.db");

  process.env = {
    ...originalEnv,
    DATA_ROOT: root,
    DATASETS_DIR: datasetsDir,
    OUTPUTS_DIR: outputsDir,
    LOGS_DIR: logsDir,
    DB_PATH: dbPath,
    DATASET_ALLOWED_ROOTS: datasetsDir,
    LFS_BIN_PATH: "/opt/lichtfeld/bin/LichtFeld-Studio",
    SESSION_SECRET: "test-session-secret"
  };

  return {
    datasetsDir,
    restore: () => {
      process.env = originalEnv;
      vi.resetModules();
    }
  };
}

afterEach(() => {
  vi.resetModules();
});

describe("datasetService previews", () => {
  it("includes nested preview image path when listing dataset folders", async () => {
    const env = setupTestEnv();
    const datasetPath = path.join(env.datasetsDir, "garden");
    fs.mkdirSync(path.join(datasetPath, "images", "cam-a"), { recursive: true });
    fs.mkdirSync(path.join(datasetPath, "sparse"), { recursive: true });
    fs.writeFileSync(path.join(datasetPath, "images", "cam-a", "0001.jpg"), "image");

    try {
      const { datasetService } = await import("../src/services/datasetService.js");
      const folders = datasetService.listDatasetFolders();

      expect(folders).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "garden",
          imageCount: 1,
          previewImageRelativePath: "cam-a/0001.jpg"
        })
      ]));
    } finally {
      env.restore();
    }
  });

  it("resolves nested preview image path inside the dataset images folder", async () => {
    const env = setupTestEnv();
    const datasetPath = path.join(env.datasetsDir, "garden");
    const previewPath = path.join(datasetPath, "images", "cam-a", "0001.jpg");
    fs.mkdirSync(path.join(datasetPath, "images", "cam-a"), { recursive: true });
    fs.mkdirSync(path.join(datasetPath, "sparse"), { recursive: true });
    fs.writeFileSync(previewPath, "image");

    try {
      const { datasetService } = await import("../src/services/datasetService.js");
      const resolved = datasetService.resolvePreviewImagePath({
        folderName: "garden",
        imageRelativePath: "cam-a/0001.jpg"
      });

      expect(resolved).toBe(previewPath);
    } finally {
      env.restore();
    }
  });
});
