import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("jobService disk status", () => {
  it("resolves relative target path before checkDiskSpace", async () => {
    vi.resetModules();

    const checkDiskSpaceMock = vi.fn(async () => ({
      diskPath: "/",
      free: 20 * 1024 * 1024 * 1024,
      size: 100 * 1024 * 1024 * 1024
    }));

    vi.doMock("check-disk-space", () => ({
      default: checkDiskSpaceMock
    }));

    const { jobService } = await import("../src/services/jobService.js");
    await jobService.getDiskStatus("data/outputs/job-1");

    expect(checkDiskSpaceMock).toHaveBeenCalledWith(path.resolve("data/outputs/job-1"));
  });
});
