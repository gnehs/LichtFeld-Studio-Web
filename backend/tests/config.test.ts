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
      expect(process.env.LD_LIBRARY_PATH).toBe("/opt/lichtfeld/lib:/opt/lichtfeld/lib64:/usr/local/lib");
    } finally {
      process.env = originalEnv;
      vi.resetModules();
    }
  });
});
