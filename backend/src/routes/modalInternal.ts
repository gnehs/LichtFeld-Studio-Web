import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { jobService } from "../services/jobService.js";
import type { JobStatus } from "../types/models.js";

const eventSchema = z.object({
  type: z.enum(["job.status", "log", "timelapse.frame.created", "timelapse.scan.completed"]),
  ts: z.string().optional(),
  data: z.unknown()
});

const terminalStatuses = new Set<JobStatus>(["completed", "failed", "stopped", "stopped_low_disk"]);
const knownStatuses = new Set<JobStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
  "stopped_low_disk"
]);

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Constant-time comparison even when token lengths differ. */
function tokensEqual(actual: string, expected: string): boolean {
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTerminalStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && knownStatuses.has(value as JobStatus) && terminalStatuses.has(value as JobStatus);
}

export const modalInternalRouter = Router();

modalInternalRouter.post("/jobs/:id/events", async (req, res) => {
  const token = parseBearerToken(req.header("authorization"));
  if (!config.modalCallbackToken || !token || !tokensEqual(token, config.modalCallbackToken)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  const jobId = req.params.id;
  const job = jobService.getJob(jobId);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const { type, data } = parsed.data;

  if (type === "job.status") {
    if (!isRecord(data) || typeof data.status !== "string" || !knownStatuses.has(data.status as JobStatus)) {
      return res.status(400).json({ message: "Invalid job.status payload" });
    }

    const status = data.status as JobStatus;
    if (isTerminalStatus(status)) {
      try {
        await jobService.reloadRemoteVolume();
      } catch (error) {
        logger.warn("Modal volume reload failed after terminal event", {
          job_id: jobId,
          ...logger.errFields(error)
        });
      }
    }

    jobService.recordRemoteStatus(jobId, status, data);
    return res.json({ ok: true });
  }

  try {
    if (type === "log") {
      if (!isRecord(data) || !Array.isArray(data.lines)) {
        return res.status(400).json({ message: "Invalid log payload" });
      }
      jobService.appendRemoteLog(jobId, data.lines.map((line) => String(line)));
    } else if (type === "timelapse.frame.created") {
      jobService.recordRemoteTimelapseFrame(jobId, data);
    } else {
      jobService.emitRemoteTimelapseScan(jobId, data);
    }
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : String(error) });
  }

  return res.json({ ok: true });
});

export { tokensEqual as modalCallbackTokensEqual };
