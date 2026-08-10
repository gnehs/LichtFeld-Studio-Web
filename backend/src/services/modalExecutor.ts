import { config } from "../config.js";
import type { JobRecord } from "../types/models.js";
import { logger } from "../lib/logger.js";
import { tusUploadStore } from "../lib/tusUploadStore.js";

interface DispatchResponse {
  accepted?: boolean;
  callId?: string;
  jobId?: string;
}

interface CancelResponse {
  accepted?: boolean;
  jobId?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function modalUrl(pathname: string): string {
  return `${config.modalControlUrl}${pathname}`;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.modalControlToken
      ? { Authorization: `Bearer ${config.modalControlToken}` }
      : {})
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : response.statusText || `Modal control request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function postVolumeHelper(pathname: "/data/commit" | "/data/reload"): Promise<void> {
  if (!config.modalVolumeHelperUrl) {
    return;
  }

  const response = await fetch(`${config.modalVolumeHelperUrl}${pathname}`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const payload = await parseResponseBody(response);
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : response.statusText || `Modal volume helper failed (${response.status})`;
    throw new Error(message);
  }
}

/**
 * Persist the shared data volume before the trainer starts. A failure is
 * intentionally propagated so a GPU worker cannot start against stale data.
 */
export async function commitModalDataVolume(): Promise<void> {
  await postVolumeHelper("/data/commit");
}

/**
 * Refresh the API container's view of the shared data volume. Callers should
 * catch errors because a stale view must not prevent a terminal job status
 * from being recorded.
 */
export async function reloadModalDataVolume(): Promise<void> {
  if (tusUploadStore.isUploadInProgress() || tusUploadStore.hasUnfinishedUploads()) {
    logger.debug("Skipping modal volume reload because a TUS upload is unfinished");
    return;
  }
  await postVolumeHelper("/data/reload");
}

export async function dispatchModalJob(job: JobRecord): Promise<{ callId: string }> {
  await commitModalDataVolume();

  let args: string[];
  let params: { gpu?: unknown } = {};
  try {
    args = JSON.parse(job.argsJson) as string[];
  } catch {
    throw new Error(`Job ${job.id} has invalid args JSON`);
  }

  try {
    params = JSON.parse(job.paramsJson) as { gpu?: unknown };
  } catch {
    throw new Error(`Job ${job.id} has invalid params JSON`);
  }

  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error(`Job ${job.id} has invalid training arguments`);
  }

  const payload = await postJson<DispatchResponse>(modalUrl("/jobs/dispatch"), {
    jobId: job.id,
    args,
    ...(typeof params.gpu === "string" && { gpu: params.gpu })
  });

  if (!payload?.accepted || typeof payload.callId !== "string" || payload.callId.length === 0) {
    throw new Error("Modal control plane did not accept the training job");
  }

  if (payload.jobId && payload.jobId !== job.id) {
    throw new Error(`Modal control plane returned unexpected job ID: ${payload.jobId}`);
  }

  return { callId: payload.callId };
}

export async function cancelModalJob(job: JobRecord): Promise<void> {
  if (!job.remoteCallId) {
    throw new Error(`Job ${job.id} has no remote call ID`);
  }

  const payload = await postJson<CancelResponse>(modalUrl("/jobs/cancel"), {
    jobId: job.id,
    callId: job.remoteCallId
  });

  if (payload?.accepted === false) {
    throw new Error("Modal control plane did not accept the cancellation");
  }
  if (payload?.jobId && payload.jobId !== job.id) {
    throw new Error(`Modal control plane returned unexpected job ID: ${payload.jobId}`);
  }
}
