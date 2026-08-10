import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("config shared library path", () => {
  it("adds lichtfeld library directories to LD_LIBRARY_PATH", async () => {
    vi.resetModules();

    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ADMIN_PASSWORD_HASH: "test-hash",
      DATA_ROOT: "/tmp/lichtfeld-test-data",
      LD_LIBRARY_PATH: "/usr/local/lib"
    };

    try {
      await import("../src/config.js");
      expect(process.env.LD_LIBRARY_PATH).toBe("/opt/lichtfeld/lib:/opt/lichtfeld/lib64:/opt/lichtfeld/bin:/usr/local/lib");
    } finally {
      process.env = originalEnv;
      vi.resetModules();
    }
  });

  it("fails fast when Modal executor settings are incomplete", async () => {
    vi.resetModules();

    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ADMIN_PASSWORD_HASH: "test-hash",
      DATA_ROOT: "/tmp/lichtfeld-modal-config-test",
      TRAINING_EXECUTOR: "modal",
      PUBLIC_BASE_URL: "",
      MODAL_CONTROL_URL: "",
      MODAL_CONTROL_TOKEN: "",
      MODAL_CALLBACK_TOKEN: ""
    };

    try {
      await expect(import("../src/config.js")).rejects.toThrow("MODAL_CONTROL_URL");
    } finally {
      process.env = originalEnv;
      vi.resetModules();
    }
  });

  it("honors TUS_UPLOAD_DIR for tus staging", async () => {
    vi.resetModules();

    const originalEnv = process.env;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-config-tus-"));
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ADMIN_PASSWORD_HASH: "test-hash",
      DATA_ROOT: root,
      TUS_UPLOAD_DIR: path.join(root, "staging", "tus")
    };

    try {
      const { config } = await import("../src/config.js");
      expect(config.tusUploadDir).toBe(path.join(root, "staging", "tus"));
      expect(fs.existsSync(config.tusUploadDir)).toBe(true);
    } finally {
      process.env = originalEnv;
      vi.resetModules();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults tus staging to the datasets directory", async () => {
    vi.resetModules();

    const originalEnv = process.env;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-config-tus-default-"));
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ADMIN_PASSWORD_HASH: "test-hash",
      DATA_ROOT: root
    };

    try {
      const { config } = await import("../src/config.js");
      expect(config.tusUploadDir).toBe(path.join(root, "datasets", "_uploads", "tus"));
    } finally {
      process.env = originalEnv;
      vi.resetModules();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});