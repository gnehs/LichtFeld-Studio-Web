import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "@/lib/api";

const CHUNK_SIZE = 8 * 1024 * 1024;

type StorageState = Record<string, string>;

function createStorageMock(initialState: StorageState = {}) {
  const state: StorageState = { ...initialState };

  return {
    getItem(key: string) {
      return key in state ? state[key] : null;
    },
    setItem(key: string, value: string) {
      state[key] = value;
    },
    removeItem(key: string) {
      delete state[key];
    },
    clear() {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
    },
    dump() {
      return { ...state };
    }
  };
}

function createFakeFile(size: number, calls: Array<[number, number]>) {
  return {
    name: "dataset.zip",
    size,
    type: "application/zip",
    lastModified: 1700000000000,
    slice(start: number, end: number) {
      const boundedEnd = Math.min(end, size);
      calls.push([start, boundedEnd]);
      return new Blob([new Uint8Array(Math.max(0, boundedEnd - start))], {
        type: "application/zip"
      });
    }
  } as unknown as File;
}

function createResponse(options: {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  json?: unknown;
}) {
  return {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 400),
    statusText: options.statusText ?? (options.ok ? "OK" : "Bad Request"),
    headers: new Headers(options.headers),
    json: async () => options.json ?? {}
  } as Response;
}

describe("uploadDataset", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("creates a new fetch-based tus upload, patches chunks, and finalizes dataset", async () => {
    const sliceCalls: Array<[number, number]> = [];
    const file = createFakeFile(CHUNK_SIZE + 8, sliceCalls);
    const storage = createStorageMock();
    vi.stubGlobal("localStorage", storage);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-1",
            "Upload-Offset": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": String(CHUNK_SIZE) }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": String(CHUNK_SIZE + 8) }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          json: {
            item: {
              id: "ds-1",
              name: "garden-v2",
              type: "upload",
              path: "/data/datasets/ds-1",
              createdAt: "2026-03-25T00:00:00.000Z"
            }
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const progress = vi.fn();
    const bytesProgress = vi.fn();
    const phaseChange = vi.fn();

    const result = await api.uploadDataset(file, "garden-v2", {
      onProgress: progress,
      onBytesProgress: bytesProgress,
      onPhaseChange: phaseChange
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/datasets/upload/tus",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(CHUNK_SIZE + 8)
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/datasets/upload/tus/upload-1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: expect.objectContaining({
          "Upload-Offset": "0",
          "Content-Type": "application/offset+octet-stream"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/datasets/upload/tus/upload-1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: expect.objectContaining({
          "Upload-Offset": String(CHUNK_SIZE)
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/datasets/upload/tus/upload-1/complete",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(sliceCalls).toEqual([
      [0, CHUNK_SIZE],
      [CHUNK_SIZE, CHUNK_SIZE + 8]
    ]);
    expect(bytesProgress).toHaveBeenNthCalledWith(1, CHUNK_SIZE, CHUNK_SIZE + 8);
    expect(bytesProgress).toHaveBeenNthCalledWith(2, CHUNK_SIZE + 8, CHUNK_SIZE + 8);
    expect(progress).toHaveBeenNthCalledWith(1, CHUNK_SIZE / (CHUNK_SIZE + 8));
    expect(progress).toHaveBeenNthCalledWith(2, 1);
    expect(phaseChange.mock.calls.map(([phase]) => phase)).toEqual([
      "preparing",
      "uploading",
      "uploading",
      "processing",
      "complete"
    ]);
    expect(storage.dump()).toEqual({});
    expect(result.item.id).toBe("ds-1");
  });

  test("resumes a previous upload from local storage before finalizing dataset", async () => {
    const sliceCalls: Array<[number, number]> = [];
    const file = createFakeFile(CHUNK_SIZE + 8, sliceCalls);
    const storage = createStorageMock({
      "lfs:tus-upload:dataset.zip:8388616:1700000000000:garden-v2": "/api/datasets/upload/tus/upload-9"
    });
    vi.stubGlobal("localStorage", storage);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 200,
          headers: {
            "Upload-Offset": String(CHUNK_SIZE),
            "Upload-Length": String(CHUNK_SIZE + 8)
          }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": String(CHUNK_SIZE + 8) }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          json: {
            item: {
              id: "ds-2",
              name: "garden-v2",
              type: "upload",
              path: "/data/datasets/ds-2",
              createdAt: "2026-03-25T00:00:00.000Z"
            }
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await api.uploadDataset(file, "garden-v2");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/datasets/upload/tus/upload-9",
      expect.objectContaining({
        method: "HEAD",
        credentials: "include",
        headers: expect.objectContaining({ "Tus-Resumable": "1.0.0" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/datasets/upload/tus/upload-9",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/datasets/upload/tus/upload-9/complete",
      expect.objectContaining({ method: "POST" })
    );
    expect(sliceCalls).toEqual([[CHUNK_SIZE, CHUNK_SIZE + 8]]);
    expect(result.item.id).toBe("ds-2");
    expect(storage.dump()).toEqual({});
  });

  test("retries a failed chunk after a long request without consuming the backoff budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const file = createFakeFile(CHUNK_SIZE, []);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-retry",
            "Upload-Offset": "0"
          }
        })
      )
      .mockImplementationOnce(async () => {
        // Simulate a PATCH that spends longer than the retry budget before its
        // socket closes. The first retry should still be allowed.
        vi.setSystemTime(31_000);
        throw new TypeError("Failed to fetch");
      })
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": String(CHUNK_SIZE) }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          json: {
            item: {
              id: "ds-retry",
              name: "retry-dataset",
              type: "upload",
              path: "/data/datasets/retry-dataset",
              createdAt: "2026-03-25T00:00:00.000Z"
            }
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();

    const uploadPromise = api.uploadDataset(file, "retry-dataset", {
      onReconnecting,
      onReconnected
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(uploadPromise).resolves.toMatchObject({ item: { id: "ds-retry" } });
    expect(onReconnecting).toHaveBeenCalledWith(32_000);
    expect(onReconnected).toHaveBeenCalledOnce();
  });

  test("caps cumulative retry backoff at 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const file = createFakeFile(1, []);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-budget",
            "Upload-Offset": "0"
          }
        })
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    vi.stubGlobal("fetch", fetchMock);
    const onReconnecting = vi.fn();
    const uploadPromise = api.uploadDataset(file, "budget-dataset", {
      onReconnecting
    });
    const rejection = expect(uploadPromise).rejects.toThrow("Failed to fetch");

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const waitMs of [1_000, 2_000, 4_000, 8_000, 10_000, 5_000]) {
      await vi.advanceTimersByTimeAsync(waitMs);
    }

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(onReconnecting.mock.calls.map(([retryAt]) => retryAt)).toEqual([
      1_000,
      3_000,
      7_000,
      15_000,
      25_000,
      30_000
    ]);
  });

  test("retries a PATCH 5xx response by HTTP status when the body has no status number", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const file = createFakeFile(1, []);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-5xx",
            "Upload-Offset": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          json: { message: "temporary outage" }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": "1" }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          json: {
            item: {
              id: "ds-5xx",
              name: "status-retry",
              type: "upload",
              path: "/data/datasets/status-retry",
              createdAt: "2026-03-25T00:00:00.000Z"
            }
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    const uploadPromise = api.uploadDataset(file, "status-retry", {
      onReconnecting,
      onReconnected
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(uploadPromise).resolves.toMatchObject({ item: { id: "ds-5xx" } });
    expect(onReconnecting).toHaveBeenCalledWith(1_000);
    expect(onReconnected).toHaveBeenCalledOnce();
  });

  test("aborts and retries a PATCH that exceeds the 120-second timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const file = createFakeFile(1, []);
    let firstPatchSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-timeout",
            "Upload-Offset": "0"
          }
        })
      )
      .mockImplementationOnce((_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        firstPatchSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      })
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": "1" }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          json: {
            item: {
              id: "ds-timeout",
              name: "timeout-retry",
              type: "upload",
              path: "/data/datasets/timeout-retry",
              createdAt: "2026-03-25T00:00:00.000Z"
            }
          }
        })
      );

    vi.stubGlobal("fetch", fetchMock);
    const onReconnecting = vi.fn();
    const uploadPromise = api.uploadDataset(file, "timeout-retry", { onReconnecting });

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(firstPatchSignal?.aborted).toBe(true);
    expect(onReconnecting).toHaveBeenCalledWith(121_000);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(uploadPromise).resolves.toMatchObject({ item: { id: "ds-timeout" } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["0", String(4 + 1)])("rejects a 409 response with an invalid offset %s", async (conflictOffset) => {
    const file = createFakeFile(4, []);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-offset",
            "Upload-Offset": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 409,
          headers: { "Upload-Offset": conflictOffset },
          json: { message: "Upload offset mismatch" }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(api.uploadDataset(file, "invalid-offset")).rejects.toThrow("invalid Upload-Offset");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects a resumable upload when HEAD Upload-Length does not match the file", async () => {
    const file = createFakeFile(CHUNK_SIZE, []);
    const storage = createStorageMock({
      [`lfs:tus-upload:dataset.zip:${CHUNK_SIZE}:1700000000000:length-mismatch`]: "/api/datasets/upload/tus/upload-length"
    });
    vi.stubGlobal("localStorage", storage);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      createResponse({
        ok: true,
        status: 200,
        headers: {
          "Upload-Offset": "0",
          "Upload-Length": String(CHUNK_SIZE + 1)
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.uploadDataset(file, "length-mismatch")).rejects.toThrow("does not match file size");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.dump()).toEqual({
      [`lfs:tus-upload:dataset.zip:${CHUNK_SIZE}:1700000000000:length-mismatch`]: "/api/datasets/upload/tus/upload-length"
    });
  });

  test("rejects a resumable upload when HEAD offset exceeds the file size", async () => {
    const file = createFakeFile(4, []);
    const storage = createStorageMock({
      "lfs:tus-upload:dataset.zip:4:1700000000000:offset-too-large": "/api/datasets/upload/tus/upload-offset-too-large"
    });
    vi.stubGlobal("localStorage", storage);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      createResponse({
        ok: true,
        status: 200,
        headers: {
          "Upload-Offset": "5",
          "Upload-Length": "4"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.uploadDataset(file, "offset-too-large")).rejects.toThrow("Upload-Offset exceeds file size");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects with parsed server message from complete step", async () => {
    const file = createFakeFile(4, []);
    const storage = createStorageMock();
    vi.stubGlobal("localStorage", storage);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 201,
          headers: {
            Location: "/api/datasets/upload/tus/upload-2",
            "Upload-Offset": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: true,
          status: 204,
          headers: { "Upload-Offset": "4" }
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: { message: "zip invalid" }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(api.uploadDataset(file, "garden-v2")).rejects.toThrow("zip invalid");
  });
});
