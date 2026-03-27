import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

function setupTestEnv() {
  const originalEnv = process.env;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-editor-"));
  const datasetsDir = path.join(root, "datasets");
  process.env = { ...originalEnv, DATA_ROOT: root, DATASETS_DIR: datasetsDir, OUTPUTS_DIR: path.join(root, "outputs"), LOGS_DIR: path.join(root, "logs"), DB_PATH: path.join(root, "db", "app.db"), DATASET_ALLOWED_ROOTS: datasetsDir, SESSION_SECRET: "secret", LFS_BIN_PATH: "/bin/true" };
  return { root, datasetsDir, restore: () => { process.env = originalEnv; vi.resetModules(); } };
}

afterEach(() => { vi.resetModules(); });

describe("dataset editor", () => {
  it("loads details and files", async () => {
    const env = setupTestEnv();
    const datasetPath = path.join(env.datasetsDir, "garden");
    fs.mkdirSync(path.join(datasetPath, "images", "cam-a"), { recursive: true });
    fs.mkdirSync(path.join(datasetPath, "masks"), { recursive: true });
    fs.writeFileSync(path.join(datasetPath, "images", "cam-a", "0001.jpg"), "a");
    fs.writeFileSync(path.join(datasetPath, "masks", "0001.png"), "b");
    fs.mkdirSync(path.join(env.root, "db"), { recursive: true });

    try {
      const { repo } = await import("../src/db.js");
      repo.createDataset({ id: "ds-1", name: "garden", type: "registered", path: datasetPath, createdAt: new Date().toISOString() });
      const { datasetService } = await import("../src/services/datasetService.js");
      const detail = datasetService.getDatasetDetail("ds-1");
      const files = datasetService.listDatasetFiles("ds-1");

      expect(detail?.name).toBe("garden");
      expect(detail?.folderSizeBytes).toBeGreaterThan(0);
      expect(files?.items).toHaveLength(2);
      expect(
        datasetService.resolveDatasetFilePath("ds-1", "images/cam-a/0001.jpg"),
      ).toBe(path.join(datasetPath, "images", "cam-a", "0001.jpg"));
      expect(
        datasetService.resolveDatasetFilePath("ds-1", "masks/0001.png"),
      ).toBe(path.join(datasetPath, "masks", "0001.png"));
    } finally { env.restore(); }
  });

  it("renames and deletes dataset folder", async () => {
    const env = setupTestEnv();
    const datasetPath = path.join(env.datasetsDir, "garden");
    fs.mkdirSync(path.join(datasetPath, "images"), { recursive: true });
    fs.mkdirSync(path.join(env.root, "db"), { recursive: true });
    fs.writeFileSync(path.join(datasetPath, "images", "0001.jpg"), "a");

    try {
      const { repo } = await import("../src/db.js");
      repo.createDataset({ id: "ds-1", name: "garden", type: "registered", path: datasetPath, createdAt: new Date().toISOString() });
      const { datasetService } = await import("../src/services/datasetService.js");
      const renamed = datasetService.renameDataset("ds-1", "garden-renamed");
      expect(renamed?.name).toBe("garden-renamed");
      expect(fs.existsSync(path.join(env.datasetsDir, "garden-renamed"))).toBe(true);

      const deleted = datasetService.deleteDataset("ds-1", "garden-renamed");
      expect(deleted.id).toBe("ds-1");
      expect(fs.existsSync(path.join(env.datasetsDir, "garden-renamed"))).toBe(false);
    } finally { env.restore(); }
  });
});
