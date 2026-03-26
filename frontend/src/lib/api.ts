import { Upload } from "tus-js-client";
import type { DatasetFolderEntry, DatasetRecord, DiskGuardStatus, SystemMetrics, TimelapseFrame, TrainingJob } from "./types";

export type UploadDatasetPhase = "preparing" | "uploading" | "processing" | "complete";

interface UploadDatasetOptions {
  onProgress?: (progress: number) => void;
  onBytesProgress?: (loaded: number, total: number) => void;
  onPhaseChange?: (phase: UploadDatasetPhase) => void;
}

async function parseRequestError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.message ?? response.statusText;
}

function getTusUploadCompletePath(uploadUrl: string): string {
  const normalizedUrl = uploadUrl.replace(/\/+$/, "");
  return `${normalizedUrl}/complete`;
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
  uploadDataset: async (file: File, datasetName?: string, options?: UploadDatasetOptions) => {
    return new Promise<{ item: DatasetRecord }>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: "/api/datasets/upload/tus",
        retryDelays: [0, 1000, 3000, 5000],
        metadata: {
          filename: file.name,
          filetype: file.type || "application/zip",
          ...(datasetName?.trim() ? { datasetName: datasetName.trim() } : {})
        },
        removeFingerprintOnSuccess: true,
        onBeforeRequest(req) {
          const underlying = req.getUnderlyingObject();
          if (underlying && typeof underlying === "object" && "withCredentials" in underlying) {
            (underlying as XMLHttpRequest).withCredentials = true;
          }
        },
        onError(error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onProgress(bytesUploaded, bytesTotal) {
          options?.onPhaseChange?.("uploading");
          options?.onBytesProgress?.(bytesUploaded, bytesTotal);
          options?.onProgress?.(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0);
        },
        async onSuccess() {
          try {
            if (!upload.url) {
              throw new Error("Upload succeeded but server did not return upload URL");
            }

            options?.onPhaseChange?.("processing");
            options?.onBytesProgress?.(file.size, file.size);
            options?.onProgress?.(1);

            const response = await fetch(getTusUploadCompletePath(upload.url), {
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

            options?.onPhaseChange?.("complete");
            resolve({ item: body.item });
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });

      options?.onPhaseChange?.("preparing");
      upload
        .findPreviousUploads()
        .then((previousUploads) => {
          const latestUpload = previousUploads[0];
          if (latestUpload) {
            upload.resumeFromPreviousUpload(latestUpload);
          }
          upload.start();
        })
        .catch((error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
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
