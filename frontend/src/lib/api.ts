import type { DatasetFolderEntry, DatasetRecord, DiskGuardStatus, SystemMetrics, TimelapseFrame, TrainingJob } from "./types";

export type UploadDatasetPhase = "preparing" | "uploading" | "processing" | "complete";

const TUS_UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024;
const TUS_RESUMABLE_VERSION = "1.0.0";
const TUS_UPLOAD_STORAGE_PREFIX = "lfs:tus-upload:";

/** 網路中斷後最長等待重試的毫秒數 */
const TUS_RETRY_BUDGET_MS = 30_000;
/** 每次重試間隔的初始值（ms），每次失敗後加倍，最長 10s */
const TUS_RETRY_BASE_DELAY_MS = 1_000;
const TUS_RETRY_MAX_DELAY_MS = 10_000;

interface UploadDatasetOptions {
  onProgress?: (progress: number) => void;
  onBytesProgress?: (loaded: number, total: number) => void;
  onPhaseChange?: (phase: UploadDatasetPhase) => void;
  onReconnecting?: (retryAt: number) => void;
  onReconnected?: () => void;
}

async function parseRequestError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.message ?? response.statusText;
}

function getUploadStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function getTusUploadFingerprint(file: File, datasetName?: string): string {
  return `${TUS_UPLOAD_STORAGE_PREFIX}${file.name}:${file.size}:${file.lastModified}:${datasetName?.trim() ?? ""}`;
}

function encodeTusMetadataValue(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function buildTusMetadataHeader(file: File, datasetName?: string): string {
  const metadata = [
    `filename ${encodeTusMetadataValue(file.name)}`,
    `filetype ${encodeTusMetadataValue(file.type || "application/zip")}`
  ];

  if (datasetName?.trim()) {
    metadata.push(`datasetName ${encodeTusMetadataValue(datasetName.trim())}`);
  }

  return metadata.join(",");
}

function getUploadOffset(headers: Headers): number | null {
  const rawOffset = headers.get("Upload-Offset") ?? headers.get("upload-offset");
  if (!rawOffset) {
    return null;
  }

  const offset = Number(rawOffset);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

async function createTusUpload(file: File, datasetName?: string): Promise<{ uploadUrl: string; offset: number }> {
  const response = await fetch("/api/datasets/upload/tus", {
    method: "POST",
    credentials: "include",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "Upload-Length": String(file.size),
      "Upload-Metadata": buildTusMetadataHeader(file, datasetName)
    }
  });

  if (!response.ok) {
    throw new Error(await parseRequestError(response));
  }

  const uploadUrl = response.headers.get("Location") ?? response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Upload creation succeeded but response is missing upload URL");
  }

  return {
    uploadUrl,
    offset: getUploadOffset(response.headers) ?? 0
  };
}

async function headTusUpload(uploadUrl: string): Promise<{ exists: boolean; offset: number }> {
  const response = await fetch(uploadUrl, {
    method: "HEAD",
    credentials: "include",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION
    }
  });

  if (response.status === 404) {
    return { exists: false, offset: 0 };
  }

  if (!response.ok) {
    throw new Error(await parseRequestError(response));
  }

  return {
    exists: true,
    offset: getUploadOffset(response.headers) ?? 0
  };
}

async function patchTusUpload(uploadUrl: string, offset: number, chunk: Blob): Promise<number> {
  const response = await fetch(uploadUrl, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "Upload-Offset": String(offset),
      "Content-Type": "application/offset+octet-stream"
    },
    body: chunk
  });

  const nextOffset = getUploadOffset(response.headers);
  if (response.status === 409 && nextOffset !== null) {
    return nextOffset;
  }

  if (!response.ok) {
    throw new Error(await parseRequestError(response));
  }

  return nextOffset ?? offset + chunk.size;
}

function getTusUploadCompletePath(uploadUrl: string): string {
  const normalizedUrl = uploadUrl.replace(/\/+$/, "");
  return `${normalizedUrl}/complete`;
}

/** 判斷是否為可重試的網路/暫時性錯誤（非 HTTP 業務邏輯錯誤） */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // fetch 網路失敗：TypeError: Failed to fetch / NetworkError
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // 後端回傳 5xx 暫時性錯誤
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) {
      return true;
    }
  }
  return false;
}

/**
 * 帶有 retry budget 的 PATCH 執行器。
 * 在 TUS_RETRY_BUDGET_MS 內遭遇可重試錯誤時，會以 exponential backoff 持續重試。
 * 每次等待期間回呼 onReconnecting（傳入預計重試的時間戳）。
 */
async function patchTusUploadWithRetry(
  uploadUrl: string,
  offset: number,
  chunk: Blob,
  options?: Pick<UploadDatasetOptions, "onReconnecting" | "onReconnected">
): Promise<number> {
  const budgetDeadline = Date.now() + TUS_RETRY_BUDGET_MS;
  let delay = TUS_RETRY_BASE_DELAY_MS;
  let isFirstAttempt = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const nextOffset = await patchTusUpload(uploadUrl, offset, chunk);
      if (!isFirstAttempt) {
        options?.onReconnected?.();
      }
      return nextOffset;
    } catch (error) {
      if (!isRetryableError(error)) {
        throw error;
      }

      const now = Date.now();
      const retryAt = now + delay;
      if (retryAt > budgetDeadline) {
        // 超出重試預算，直接拋出
        throw error;
      }

      options?.onReconnecting?.(retryAt);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, TUS_RETRY_MAX_DELAY_MS);
      isFirstAttempt = false;
    }
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ authenticated: boolean }>("/api/auth/me"),
  login: (password: string) => request<{ success: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),

  listDatasets: () => request<{ items: DatasetRecord[]; folders: DatasetFolderEntry[] }>("/api/datasets"),
  getDataset: (id: string) => request<{ item: import("./types").DatasetDetail }>(`/api/datasets/${id}`),
  getDatasetFiles: (id: string) => request<{ item: { items: import("./types").DatasetFileEntry[] } }>(`/api/datasets/${id}/files`),
  uploadDataset: async (file: File, datasetName?: string, options?: UploadDatasetOptions) => {
    const storage = getUploadStorage();
    const fingerprint = getTusUploadFingerprint(file, datasetName);
    options?.onPhaseChange?.("preparing");

    let uploadUrl = storage?.getItem(fingerprint) ?? null;
    let offset = 0;

    if (uploadUrl) {
      const headResult = await headTusUpload(uploadUrl);
      if (headResult.exists) {
        offset = headResult.offset;
      } else {
        storage?.removeItem(fingerprint);
        uploadUrl = null;
      }
    }

    if (!uploadUrl) {
      const created = await createTusUpload(file, datasetName);
      uploadUrl = created.uploadUrl;
      offset = created.offset;
      storage?.setItem(fingerprint, uploadUrl);
    }

    while (offset < file.size) {
      options?.onPhaseChange?.("uploading");
      const chunk = file.slice(offset, offset + TUS_UPLOAD_CHUNK_SIZE);
      const nextOffset = await patchTusUploadWithRetry(uploadUrl, offset, chunk, {
        onReconnecting: options?.onReconnecting,
        onReconnected: options?.onReconnected
      });
      if (nextOffset <= offset) {
        throw new Error("Upload did not make progress");
      }
      offset = nextOffset;
      options?.onBytesProgress?.(offset, file.size);
      options?.onProgress?.(file.size > 0 ? offset / file.size : 0);
    }

    options?.onPhaseChange?.("processing");
    options?.onBytesProgress?.(file.size, file.size);
    options?.onProgress?.(1);

    try {
      const response = await fetch(getTusUploadCompletePath(uploadUrl), {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await parseRequestError(response));
      }

      const body = (await response.json()) as { item?: DatasetRecord };
      if (!body.item) {
        throw new Error("Upload succeeded but response is missing dataset item");
      }

      storage?.removeItem(fingerprint);
      options?.onPhaseChange?.("complete");
      return { item: body.item };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
  registerDatasetPath: (datasetName: string, targetPath: string) =>
    request<{ item: DatasetRecord }>("/api/datasets/register-path", {
      method: "POST",
      body: JSON.stringify({ datasetName, targetPath })
    }),
  renameDataset: (id: string, datasetName: string) =>
    request<{ item: DatasetRecord }>(`/api/datasets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ datasetName })
    }),
  deleteDataset: (id: string, confirmName: string) =>
    request<{ success: boolean; deleted: { id: string; path: string } }>(`/api/datasets/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmName })
    }),

  listJobs: () => request<{ items: TrainingJob[] }>("/api/jobs"),
  createJob: (payload: unknown) => request<{ item: TrainingJob }>("/api/jobs", { method: "POST", body: JSON.stringify(payload) }),
  getJob: (id: string) => request<{ item: TrainingJob }>(`/api/jobs/${id}`),
  stopJob: (id: string) => request<{ success: boolean }>(`/api/jobs/${id}/stop`, { method: "POST" }),
  deleteJob: (id: string) => request<{ success: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),

  getTimelapseCameras: (id: string) => request<{ items: Array<{ cameraName: string; frameCount: number; lastIteration: number }> }>(`/api/jobs/${id}/timelapse/cameras`),
  getTimelapseFrames: (id: string, camera: string, cursor?: number) => {
    const params = new URLSearchParams({ camera });
    if (cursor) {
      params.set("cursor", String(cursor));
    }
    return request<{ items: TimelapseFrame[]; nextCursor: number | null }>(`/api/jobs/${id}/timelapse/frames?${params.toString()}`);
  },
  getTimelapseLatest: (id: string) => request<{ items: TimelapseFrame[]; disk: DiskGuardStatus }>(`/api/jobs/${id}/timelapse/latest`),
  disk: () => request<DiskGuardStatus>("/api/system/disk"),
  systemMetrics: () => request<SystemMetrics>("/api/system/metrics")
};
