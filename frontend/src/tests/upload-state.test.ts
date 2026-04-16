import { describe, expect, test } from "vitest";
import { calculateUploadSpeed, formatBytesPerSecond, formatUploadPhase, isDraggedFileZip, mergeUploadDraft, normalizeUploadProgress, shouldAllowStepTwoWhileUploading, shouldAutoStartUpload } from "@/upload-state";
import type { PendingUploadDraft } from "@/upload-state";

describe("upload state helpers", () => {
  test("allows moving to step two while upload is still running", () => {
    expect(shouldAllowStepTwoWhileUploading({ status: "uploading", file: new File(["zip"], "dataset.zip") })).toBe(true);
    expect(shouldAllowStepTwoWhileUploading({ status: "processing", file: new File(["zip"], "dataset.zip") } as any)).toBe(true);
  });

  test("auto starts upload when file is chosen and not yet uploaded", () => {
    expect(shouldAutoStartUpload({ status: "idle", file: new File(["zip"], "dataset.zip"), datasetId: null })).toBe(true);
    expect(shouldAutoStartUpload({ status: "uploading", file: new File(["zip"], "dataset.zip"), datasetId: null })).toBe(false);
    expect(shouldAutoStartUpload({ status: "idle", file: null, datasetId: null })).toBe(false);
    expect(shouldAutoStartUpload({ status: "idle", file: new File(["zip"], "dataset.zip"), datasetId: "ds-1" })).toBe(false);
  });

  test("normalizes progress into 0-1 range", () => {
    expect(normalizeUploadProgress(-1)).toBe(0);
    expect(normalizeUploadProgress(0.25)).toBe(0.25);
    expect(normalizeUploadProgress(2)).toBe(1);
  });

  test("merges name changes without dropping upload metadata", () => {
    const draft: PendingUploadDraft = {
      status: "uploading",
      file: new File(["zip"], "dataset.zip"),
      name: "garden-v1",
      progress: 0.3,
      datasetId: null,
      error: null,
      uploadedBytes: 120,
      totalBytes: 400,
      startedAt: 1000,
      retryAt: null,
    };

    expect(mergeUploadDraft(draft, { name: "garden-v2" })).toEqual({
      ...draft,
      name: "garden-v2"
    });
  });

  test("formats upload phase labels for tool-like status strips", () => {
    expect(formatUploadPhase("idle")).toBe("等待上傳");
    expect(formatUploadPhase("uploading")).toBe("背景上傳中");
    expect(formatUploadPhase("processing" as any as never)).toBe("伺服器驗證中");
    expect(formatUploadPhase("uploaded")).toBe("可建立任務");
    expect(formatUploadPhase("error")).toBe("需要重新上傳");
  });

  test("accepts zip files for drag and drop", () => {
    expect(isDraggedFileZip(new File(["zip"], "scene.zip"))).toBe(true);
    expect(isDraggedFileZip(new File(["zip"], "scene.tar"))).toBe(false);
    expect(isDraggedFileZip(null)).toBe(false);
  });

  test("calculates upload speed from bytes and time", () => {
    expect(calculateUploadSpeed(1024 * 1024, 1000, 2000)).toBe(1024 * 1024);
    expect(calculateUploadSpeed(0, 1000, 2000)).toBeNull();
  });

  test("formats bytes per second for telemetry display", () => {
    expect(formatBytesPerSecond(1024 * 1024)).toBe("1.0 MB/s");
    expect(formatBytesPerSecond(2048)).toBe("2.0 KB/s");
    expect(formatBytesPerSecond(0)).toBe("0 B/s");
    expect(formatBytesPerSecond(null)).toBe("—");
  });
});
