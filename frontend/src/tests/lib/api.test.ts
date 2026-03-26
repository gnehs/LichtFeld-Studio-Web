import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "@/lib/api";

function progressEvent(init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
  return {
    lengthComputable: init?.lengthComputable ?? false,
    loaded: init?.loaded ?? 0,
    total: init?.total ?? 0
  } as ProgressEvent<EventTarget>;
}

function createMockUploadTarget() {
  const target: {
    onprogress: ((this: XMLHttpRequestUpload, event: ProgressEvent<EventTarget>) => void) | null;
    dispatchProgress: (event: ProgressEvent<EventTarget>) => void;
  } = {
    onprogress: null,
    dispatchProgress(event: ProgressEvent<EventTarget>) {
      const handler = target.onprogress;
      if (handler) {
        handler.call(target as unknown as XMLHttpRequestUpload, event);
      }
    }
  };

  return target as unknown as XMLHttpRequestUpload & {
    onprogress: ((this: XMLHttpRequestUpload, event: ProgressEvent<EventTarget>) => void) | null;
    dispatchProgress: (event: ProgressEvent<EventTarget>) => void;
  };
}

describe("uploadDataset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("reports progress and returns uploaded dataset", async () => {
    const open = vi.fn();
    const send = vi.fn(function sendMock(this: XMLHttpRequest) {
      Object.defineProperty(this, "readyState", { configurable: true, value: 4 });
      Object.defineProperty(this, "status", { configurable: true, value: 200 });
      Object.defineProperty(this, "responseText", {
        configurable: true,
        value: JSON.stringify({
          item: {
            id: "ds-1",
            name: "garden-v2",
            type: "upload",
            path: "/data/datasets/ds-1",
            createdAt: "2026-03-25T00:00:00.000Z"
          }
        })
      });
      (this.upload as XMLHttpRequestUpload & { dispatchProgress: (event: ProgressEvent<EventTarget>) => void }).dispatchProgress(
        progressEvent({ lengthComputable: true, loaded: 50, total: 100 })
      );
      this.onload?.(progressEvent());
    });

    class MockXHR {
      upload = createMockUploadTarget();
      onload: ((event: ProgressEvent<EventTarget>) => void) | null = null;
      onerror: ((event: ProgressEvent<EventTarget>) => void) | null = null;
      readyState = 0;
      status = 0;
      responseText = "";
      open = open;
      send = send;
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR as unknown as typeof XMLHttpRequest);

    const progress = vi.fn();
    const bytesProgress = vi.fn();
    const result = await api.uploadDataset(new File(["zip"], "dataset.zip"), "garden-v2", { onProgress: progress, onBytesProgress: bytesProgress });

    expect(open).toHaveBeenCalledWith("POST", "/api/datasets/upload", true);
    expect(bytesProgress).toHaveBeenCalledWith(50, 100);
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(result.item.id).toBe("ds-1");
  });

  test("rejects with parsed server message", async () => {
    const send = vi.fn(function sendMock(this: XMLHttpRequest) {
      Object.defineProperty(this, "readyState", { configurable: true, value: 4 });
      Object.defineProperty(this, "status", { configurable: true, value: 400 });
      Object.defineProperty(this, "responseText", { configurable: true, value: JSON.stringify({ message: "zip invalid" }) });
      this.onload?.(progressEvent());
    });

    class MockXHR {
      upload = createMockUploadTarget();
      onload: ((event: ProgressEvent<EventTarget>) => void) | null = null;
      onerror: ((event: ProgressEvent<EventTarget>) => void) | null = null;
      readyState = 0;
      status = 0;
      responseText = "";
      open() {}
      send = send;
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR as unknown as typeof XMLHttpRequest);

    await expect(api.uploadDataset(new File(["zip"], "dataset.zip"))).rejects.toThrow("zip invalid");
  });
});
