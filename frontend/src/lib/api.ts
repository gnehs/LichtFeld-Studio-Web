import type { DatasetFolderEntry, DatasetRecord, DiskGuardStatus, SplatSnapshot, TimelapseFrame, TrainingJob } from "./types";

export type UploadDatasetPhase = "preparing" | "uploading" | "processing" | "complete";

const TUS_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const TUS_RESUMABLE_VERSION = "1.0.0";
const TUS_UPLOAD_STORAGE_PREFIX = "lfs:tus-upload:";

/** 網路中斷後累計等待重試的最長毫秒數（不含 PATCH 本身耗時） */
const TUS_RETRY_BUDGET_MS = 30_000;
/** 每次重試間隔的初始值（ms），每次失敗後加倍，最長 10s */
const TUS_RETRY_BASE_DELAY_MS = 1_000;
const TUS_RETRY_MAX_DELAY_MS = 10_000;
/** 單一 PATCH chunk 允許的最長傳輸時間（ms） */
const TUS_PATCH_TIMEOUT_MS = 120_000;
/** 伺服器端遺失 upload 記錄後，最多自動重建並重新上傳的次數 */
const TUS_UPLOAD_MAX_RECREATES = 3;

interface UploadDatasetOptions {
  onProgress?: (progress: number) => void;
  onBytesProgress?: (loaded: number, total: number) => void;
  onPhaseChange?: (phase: UploadDatasetPhase) => void;
  onReconnecting?: (retryAt: number) => void;
  onReconnected?: () => void;
}

class HttpResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
  }
}

class TusPatchTimeoutError extends Error {
  constructor() {
    super(`PATCH request timed out after ${TUS_PATCH_TIMEOUT_MS}ms`);
    this.name = "TusPatchTimeoutError";
  }
}

/**
 * 伺服器端已遺失 upload 記錄（例如 volume reload 或容器回收後暫存檔消失）。
 * 這不是重試可解決的暫時性錯誤，需要重新建立 upload。
 */
function isMissingUploadError(error: unknown): boolean {
  return error instanceof HttpResponseError && error.status === 404;
}

async function parseRequestError(response: Response): Promise<string> {
  const body = await response.json().catch(() => undefined);
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return response.statusText;
}

async function createHttpResponseError(response: Response): Promise<HttpResponseError> {
  return new HttpResponseError(response.status, await parseRequestError(response));
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

function getUploadLength(headers: Headers): number | null {
  const rawLength = headers.get("Upload-Length") ?? headers.get("upload-length");
  if (!rawLength) {
    return null;
  }

  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
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
    throw await createHttpResponseError(response);
  }

  const uploadUrl = response.headers.get("Location") ?? response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Upload creation succeeded but response is missing upload URL");
  }

  const rawOffset = response.headers.get("Upload-Offset") ?? response.headers.get("upload-offset");
  const offset = rawOffset === null ? 0 : getUploadOffset(response.headers);
  if (offset === null) {
    throw new Error("Upload creation returned an invalid Upload-Offset");
  }

  return {
    uploadUrl,
    offset
  };
}

async function headTusUpload(uploadUrl: string, expectedLength: number): Promise<{ exists: boolean; offset: number }> {
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
    throw await createHttpResponseError(response);
  }

  const offset = getUploadOffset(response.headers);
  const uploadLength = getUploadLength(response.headers);
  if (offset === null) {
    throw new Error("Resumable upload response is missing a valid Upload-Offset");
  }
  if (uploadLength === null) {
    throw new Error("Resumable upload response is missing a valid Upload-Length");
  }
  if (uploadLength !== expectedLength) {
    throw new Error(`Upload-Length ${uploadLength} does not match file size ${expectedLength}`);
  }
  if (offset > expectedLength) {
    throw new Error("Upload-Offset exceeds file size");
  }

  return {
    exists: true,
    offset
  };
}

async function patchTusUpload(uploadUrl: string, offset: number, chunk: Blob): Promise<number> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new TusPatchTimeoutError());
    }, TUS_PATCH_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(uploadUrl, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Tus-Resumable": TUS_RESUMABLE_VERSION,
          "Upload-Offset": String(offset),
          "Content-Type": "application/offset+octet-stream"
        },
        body: chunk,
        signal: controller.signal
      }),
      timeoutPromise
    ]);

    const nextOffset = getUploadOffset(response.headers);
    if (response.status === 409) {
      if (nextOffset === null || nextOffset <= offset || nextOffset > offset + chunk.size) {
        throw new Error("Upload conflict returned an invalid Upload-Offset");
      }
      return nextOffset;
    }

    if (!response.ok) {
      throw await createHttpResponseError(response);
    }

    if (nextOffset !== null && (nextOffset <= offset || nextOffset > offset + chunk.size)) {
      throw new Error("Upload response returned an invalid Upload-Offset");
    }

    return nextOffset ?? offset + chunk.size;
  } catch (error) {
    if (controller.signal.aborted) {
      throw error instanceof TusPatchTimeoutError ? error : new TusPatchTimeoutError();
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function getTusUploadCompletePath(uploadUrl: string): string {
  const normalizedUrl = uploadUrl.replace(/\/+$/, "");
  return `${normalizedUrl}/complete`;
}

/** 判斷是否為可重試的網路/暫時性錯誤（非 HTTP 業務邏輯錯誤） */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TusPatchTimeoutError) {
    return true;
  }
  if (error instanceof HttpResponseError) {
    return error.status >= 500 && error.status <= 599;
  }
  if (error instanceof TypeError) {
    // fetch 網路失敗：TypeError: Failed to fetch / NetworkError
    return true;
  }
  return false;
}

/**
 * 帶有 retry budget 的 PATCH 執行器。
 * 在累計等待時間不超過 TUS_RETRY_BUDGET_MS 時，遭遇可重試錯誤會以 exponential backoff 持續重試。
 * PATCH 本身可能需要較長時間，不能把網路傳輸耗時算進等待預算，否則長請求在斷線後無法恢復。
 * 每次等待期間回呼 onReconnecting（傳入預計重試的時間戳）。
 */
async function patchTusUploadWithRetry(
  uploadUrl: string,
  offset: number,
  chunk: Blob,
  options?: Pick<UploadDatasetOptions, "onReconnecting" | "onReconnected">
): Promise<number> {
  let waitedMs = 0;
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

      const remainingBudgetMs = TUS_RETRY_BUDGET_MS - waitedMs;
      if (remainingBudgetMs <= 0) {
        // 已用完累計等待預算，直接拋出
        throw error;
      }

      const waitMs = Math.min(delay, remainingBudgetMs);
      const retryAt = Date.now() + waitMs;
      options?.onReconnecting?.(retryAt);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      waitedMs += waitMs;
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
    throw await createHttpResponseError(response);
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
    const restoredUploadUrl = storage?.getItem(fingerprint) ?? null;

    let recreateCount = 0;

    // 外層迴圈：當伺服器端因暫存檔消失回傳 404 時，自動重建 upload 並重新上傳，
    // 避免一次 volume reload / 容器回收就讓整筆上傳直接失敗。
    while (recreateCount <= TUS_UPLOAD_MAX_RECREATES) {
      options?.onPhaseChange?.("preparing");

      let uploadUrl: string | null = recreateCount === 0 ? restoredUploadUrl : null;
      let offset = 0;

      if (uploadUrl) {
        const headResult = await headTusUpload(uploadUrl, file.size);
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
        if (offset > file.size) {
          throw new Error("Upload creation returned an offset beyond file size");
        }
        storage?.setItem(fingerprint, uploadUrl);
      }

      try {
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

        const response = await fetch(getTusUploadCompletePath(uploadUrl), {
          method: "POST",
          credentials: "include"
        });

        if (!response.ok) {
          throw await createHttpResponseError(response);
        }

        const body = (await response.json()) as { item?: DatasetRecord };
        if (!body.item) {
          throw new Error("Upload succeeded but response is missing dataset item");
        }

        storage?.removeItem(fingerprint);
        options?.onPhaseChange?.("complete");
        return { item: body.item };
      } catch (error) {
        if (isMissingUploadError(error) && recreateCount < TUS_UPLOAD_MAX_RECREATES) {
          recreateCount += 1;
          storage?.removeItem(fingerprint);
          options?.onReconnecting?.(Date.now());
          continue;
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error("Upload failed after multiple restarts");
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
  retryJob: (id: string, gpu: string) => request<{ item: TrainingJob; resumed: true }>(`/api/jobs/${id}/retry`, { method: "POST", body: JSON.stringify({ gpu }) }),
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
  getSplatLatest: (id: string) => request<SplatSnapshot>(`/api/jobs/${id}/splat/latest`),
  disk: () => request<DiskGuardStatus>("/api/system/disk"),
};
