import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

describe("Modal-prepared splat artifacts", () => {
  it("serves GPU-prepared preview and export files without invoking the CPU converter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-modal-splat-artifacts-"));
    const outputPath = path.join(root, "outputs", "job-modal");
    const exportDir = path.join(outputPath, "modal-exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const htmlPath = path.join(exportDir, "model.html");
    const sogPath = path.join(exportDir, "model.sog");
    fs.writeFileSync(htmlPath, "<!doctype html><title>modal preview</title>");
    fs.writeFileSync(sogPath, "modal-sog");

    process.env = {
      ...originalEnv,
      DATA_ROOT: root,
      OUTPUTS_DIR: path.join(root, "outputs"),
      LOGS_DIR: path.join(root, "logs"),
      DB_PATH: path.join(root, "db", "app.db"),
      DATASETS_DIR: path.join(root, "datasets"),
      DATASET_ALLOWED_ROOTS: path.join(root, "datasets"),
      SESSION_SECRET: "test-secret",
      ADMIN_PASSWORD_HASH: "test-hash",
      LFS_BIN_PATH: path.join(root, "missing-lichtfeld-binary")
    };

    try {
      const { getSplatExportArtifact, getSplatSnapshot } = await import("../src/lib/splatArtifacts.js");

      await expect(getSplatSnapshot(outputPath)).resolves.toMatchObject({
        available: true,
        status: "ready",
        viewerPath: htmlPath,
        source: { path: htmlPath, type: "html" }
      });
      await expect(getSplatExportArtifact(outputPath, "sog")).resolves.toMatchObject({
        path: sogPath,
        format: "sog",
        source: { path: sogPath, type: "sog" }
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
