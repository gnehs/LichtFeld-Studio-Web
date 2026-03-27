import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "@/lib/api";

const CHUNK_SIZE = 64 * 1024 * 1024;

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
      "lfs:tus-upload:dataset.zip:67108872:1700000000000:garden-v2": "/api/datasets/upload/tus/upload-9"
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
