export type UploadStatus = "idle" | "uploading" | "reconnecting" | "processing" | "uploaded" | "error";

export interface PendingUploadDraft {
  status: UploadStatus;
  file: File | null;
  name: string;
  progress: number;
  datasetId: string | null;
  error: string | null;
  uploadedBytes: number;
  totalBytes: number;
  startedAt: number | null;
  /** reconnecting 時，預計下次重試的時間戳（ms） */
  retryAt: number | null;
}

export function normalizeUploadProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function shouldAllowStepTwoWhileUploading(draft: Pick<PendingUploadDraft, "status" | "file">): boolean {
  return Boolean(draft.file) && (draft.status === "uploading" || draft.status === "reconnecting" || draft.status === "processing" || draft.status === "uploaded");
}

export function shouldAutoStartUpload(draft: Pick<PendingUploadDraft, "status" | "file" | "datasetId">): boolean {
  return Boolean(draft.file) && draft.status === "idle" && !draft.datasetId;
}

export function isUploadInFlight(status: UploadStatus): boolean {
  return status === "uploading" || status === "reconnecting" || status === "processing";
}

export function mergeUploadDraft(draft: PendingUploadDraft, patch: Partial<PendingUploadDraft>): PendingUploadDraft {
  return {
    ...draft,
    ...patch
  };
}

export function formatUploadPhase(status: UploadStatus): string {
  if (status === "uploading") return "背景上傳中";
  if (status === "reconnecting") return "重新連線中";
  if (status === "processing") return "伺服器驗證中";
  if (status === "uploaded") return "可建立任務";
  if (status === "error") return "需要重新上傳";
  return "等待上傳";
}

/** 計算距離下次重試的剩餘秒數（無條件進位），用於 UI 顯示 */
export function calcRetrySecondsLeft(retryAt: number | null, nowMs: number): number | null {
  if (!retryAt) return null;
  const diff = retryAt - nowMs;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

export function isDraggedFileZip(file: File | null): boolean {
  if (!file) {
    return false;
  }

  return file.name.toLowerCase().endsWith(".zip");
}

export function calculateUploadSpeed(uploadedBytes: number, startedAt: number | null, now: number): number | null {
  if (!startedAt || uploadedBytes <= 0 || now <= startedAt) {
    return null;
  }

  return uploadedBytes / ((now - startedAt) / 1000);
}

export function formatBytesPerSecond(bytesPerSecond: number | null): string {
  if (bytesPerSecond === 0) {
    return "0 B/s";
  }

  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) {
    return "—";
  }

  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }

  return `${Math.round(bytesPerSecond)} B/s`;
}
