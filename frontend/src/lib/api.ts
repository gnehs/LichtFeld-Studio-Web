import type { DatasetRecord, DiskGuardStatus, TimelapseFrame, TrainingJob } from "./types";

interface UploadDatasetOptions {
  onProgress?: (progress: number) => void;
  onBytesProgress?: (loaded: number, total: number) => void;
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

  listDatasets: () => request<{ items: DatasetRecord[] }>("/api/datasets"),
  uploadDataset: async (file: File, datasetName?: string, options?: UploadDatasetOptions) => {
    const form = new FormData();
    form.append("file", file);
    if (datasetName) {
      form.append("datasetName", datasetName);
    }

    return new Promise<{ item: DatasetRecord }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/datasets/upload", true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        options?.onBytesProgress?.(event.loaded, event.total);
        options?.onProgress?.(event.loaded / event.total);
      };

      xhr.onerror = () => {
        reject(new Error("Network error"));
      };

      xhr.onload = () => {
        let body: { item?: DatasetRecord; message?: string } = {};
        try {
          body = xhr.responseText ? (JSON.parse(xhr.responseText) as { item?: DatasetRecord; message?: string }) : {};
        } catch {
          body = {};
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(body.message ?? `HTTP ${xhr.status}`));
          return;
        }

        if (!body.item) {
          reject(new Error("Upload succeeded but response is missing dataset item"));
          return;
        }

        options?.onProgress?.(1);
        resolve({ item: body.item });
      };

      xhr.send(form);
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
  deleteJob: (id: string, deleteTimelapse = false) =>
    request<{ success: boolean }>(`/api/jobs/${id}?deleteTimelapse=${deleteTimelapse ? "true" : "false"}`, { method: "DELETE" }),

  getTimelapseCameras: (id: string) => request<{ items: Array<{ cameraName: string; frameCount: number; lastIteration: number }> }>(`/api/jobs/${id}/timelapse/cameras`),
  getTimelapseFrames: (id: string, camera: string, cursor?: number) => {
    const params = new URLSearchParams({ camera });
    if (cursor) {
      params.set("cursor", String(cursor));
    }
    return request<{ items: TimelapseFrame[]; nextCursor: number | null }>(`/api/jobs/${id}/timelapse/frames?${params.toString()}`);
  },
  getTimelapseLatest: (id: string) => request<{ items: TimelapseFrame[]; disk: DiskGuardStatus }>(`/api/jobs/${id}/timelapse/latest`),
  disk: () => request<DiskGuardStatus>("/api/system/disk")
};
