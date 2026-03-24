import type { DatasetRecord, DiskGuardStatus, TimelapseFrame, TrainingJob } from "./types";

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
  uploadDataset: async (file: File, datasetName?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (datasetName) {
      form.append("datasetName", datasetName);
    }

    const response = await fetch("/api/datasets/upload", {
      method: "POST",
      credentials: "include",
      body: form
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? response.statusText);
    }
    return response.json() as Promise<{ item: DatasetRecord }>;
  },
  registerDatasetPath: (datasetName: string, targetPath: string) =>
    request<{ item: DatasetRecord }>("/api/datasets/register-path", {
      method: "POST",
      body: JSON.stringify({ datasetName, targetPath })
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
