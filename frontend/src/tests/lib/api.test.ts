import { afterEach, describe, expect, test, vi } from "vitest";

const tusMock = vi.hoisted(() => ({
  instances: [] as Array<{
    file: File;
    options: Record<string, unknown>;
    url: string | null;
    findPreviousUploads: ReturnType<typeof vi.fn>;
    resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }>,
  previousUploads: [] as Array<{ uploadUrl: string; creationTime?: string }>,
  startHandler: null as null | ((instance: {
    file: File;
    options: Record<string, unknown>;
    url: string | null;
    findPreviousUploads: ReturnType<typeof vi.fn>;
    resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }) => Promise<void> | void)
}));

vi.mock("tus-js-client", () => ({
  Upload: class MockUpload {
    file: File;
    options: Record<string, unknown>;
    url: string | null = null;
    findPreviousUploads = vi.fn(async () => tusMock.previousUploads);
    resumeFromPreviousUpload = vi.fn();
    start = vi.fn(async () => {
      if (!tusMock.startHandler) {
        throw new Error("Missing start handler");
      }
      await tusMock.startHandler(this as unknown as (typeof tusMock.instances)[number]);
    });

    constructor(file: File, options: Record<string, unknown>) {
      this.file = file;
      this.options = options;
      tusMock.instances.push(this as unknown as (typeof tusMock.instances)[number]);
    }
  }
}));

import { api } from "@/lib/api";

describe("uploadDataset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    tusMock.instances.length = 0;
    tusMock.previousUploads = [];
    tusMock.startHandler = null;
  });

  test("uses tus upload, resumes previous upload, and finalizes dataset", async () => {
    tusMock.previousUploads = [{ uploadUrl: "/api/datasets/upload/tus/upload-1" }];
    tusMock.startHandler = async (instance) => {
      const xhr = { withCredentials: false };
      await (instance.options.onBeforeRequest as ((req: { getUnderlyingObject: () => { withCredentials: boolean } }) => Promise<void> | void) | undefined)?.({
        getUnderlyingObject: () => xhr
      });
      expect(xhr.withCredentials).toBe(true);
      (instance.options.onProgress as ((uploaded: number, total: number) => void) | undefined)?.(50, 100);
      instance.url = "/api/datasets/upload/tus/upload-1";
      await (instance.options.onSuccess as (() => Promise<void> | void) | undefined)?.();
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          item: {
            id: "ds-1",
            name: "garden-v2",
            type: "upload",
            path: "/data/datasets/ds-1",
            createdAt: "2026-03-25T00:00:00.000Z"
          }
        })
      })) as unknown as typeof fetch
    );

    const progress = vi.fn();
    const bytesProgress = vi.fn();
    const phaseChange = vi.fn();
    const result = await api.uploadDataset(new File(["zip"], "dataset.zip"), "garden-v2", {
      onProgress: progress,
      onBytesProgress: bytesProgress,
      onPhaseChange: phaseChange
    } as any);

    expect(tusMock.instances).toHaveLength(1);
    expect(tusMock.instances[0]?.resumeFromPreviousUpload).toHaveBeenCalledWith(tusMock.previousUploads[0]);
    expect(bytesProgress).toHaveBeenCalledWith(50, 100);
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(progress).toHaveBeenCalledWith(1);
    expect(phaseChange.mock.calls.map(([phase]) => phase)).toEqual(["preparing", "uploading", "processing", "complete"]);
    expect(fetch).toHaveBeenCalledWith("/api/datasets/upload/tus/upload-1/complete", {
      credentials: "include",
      method: "POST"
    });
    expect(result.item.id).toBe("ds-1");
  });

  test("rejects with parsed server message from complete step", async () => {
    tusMock.startHandler = async (instance) => {
      instance.url = "/api/datasets/upload/tus/upload-2";
      await (instance.options.onSuccess as (() => Promise<void> | void) | undefined)?.();
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ message: "zip invalid" })
      })) as unknown as typeof fetch
    );

    await expect(api.uploadDataset(new File(["zip"], "dataset.zip"))).rejects.toThrow("zip invalid");
  });
});
