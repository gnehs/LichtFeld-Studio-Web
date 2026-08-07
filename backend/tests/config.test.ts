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
});
