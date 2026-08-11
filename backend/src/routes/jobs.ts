import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import archiver from "archiver";
import { Router } from "express";
import { z } from "zod";
import { repo } from "../db.js";
import { registerSseClient } from "../sse.js";
import { jobService } from "../services/jobService.js";
import { config } from "../config.js";
import { removeJobLogFile, removeJobOutputDir } from "../lib/outputCleanup.js";
import { logger } from "../lib/logger.js";
import { DEFAULT_SPLAT_EXPORT_FORMAT, ensureViewerPathAllowed, getSplatExportArtifact, getSplatSnapshot, parseSplatExportFormat } from "../lib/splatArtifacts.js";

const createJobSchema = z.object({
  datasetId: z.string().optional(),
  params: z.object({
    dataPath: z.string().optional(),
    outputPath: z.string().optional(),
    configPath: z.string().optional(),
    configJson: z.string().optional(),
    resume: z.string().optional(),
    init: z.string().optional(),
    importCameras: z.string().optional(),
    iterations: z.number().int().positive().optional(),
    gpu: z.string().trim().min(1).max(32).optional(),
    strategy: z.enum(["mrnf", "mcmc", "igs+"]).optional(),
    maxCap: z.number().int().positive().optional(),
    gut: z.boolean().optional(),
    eval: z.boolean().optional(),
    saveEvalImages: z.boolean().optional(),
    timelapse: z
      .object({
        images: z.array(z.string().min(1)).default([]),
        every: z.number().int().positive().default(1000)
      })
      .optional()
  }).passthrough()
});

const retryJobSchema = z.object({
  gpu: z.string().trim().min(1).max(32)
});

export const jobsRouter = Router();

jobsRouter.get("/", async (_req, res) => {
  try {
    await jobService.syncRemoteJobs();
  } catch (error) {
    logger.warn("Modal artifact sync failed while listing jobs", logger.errFields(error));
  }
  res.json({ items: jobService.listJobs() });
});

jobsRouter.get("/:id", async (req, res) => {
  try {
    await jobService.syncRemoteJobs();
  } catch (error) {
    logger.warn("Modal artifact sync failed while reading job", {
      job_id: req.params.id,
      ...logger.errFields(error)
    });
  }
  const item = jobService.getJob(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Job not found" });
  }
  return res.json({ item });
});

jobsRouter.post("/", async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  try {
    const item = await jobService.createJob(parsed.data);
    return res.json({ item });
  } catch (error) {
    const status = config.trainingExecutor === "modal" ? 502 : 400;
    return res.status(status).json({ message: (error as Error).message });
  }
});

jobsRouter.post("/:id/stop", async (req, res) => {
  try {
    const stopped = await jobService.stopJob(req.params.id, "stopped");
    if (!stopped) {
      return res.status(404).json({ message: "Job not found or not stoppable" });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ message: `Failed to stop remote job: ${(error as Error).message}` });
  }
});

jobsRouter.post("/:id/retry", async (req, res) => {
  const parsed = retryJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  try {
    return res.json(await jobService.retryFailedModalJob(req.params.id, parsed.data.gpu));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "Job not found") return res.status(404).json({ message });
    const conflicts = new Set([
      "Only failed jobs can be retried with a larger GPU",
      "GPU upgrades are only available for Modal jobs",
      "No checkpoint is available for this failed job",
      "Selected GPU is not a larger compatible option",
      "Modal training executor is not available",
      "An active checkpoint retry already exists for this job"
    ]);
    return res.status(conflicts.has(message) ? 409 : 400).json({ message });
  }
});

jobsRouter.delete("/:id", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  if (job.status === "running") {
    return res.status(409).json({ message: "Running job cannot be deleted" });
  }

  if (jobService.hasActiveRetryDependents(job.id)) {
    return res.status(409).json({ message: "Job output is required by an active checkpoint retry" });
  }

  const deletedOutput = removeJobOutputDir(job.outputPath, config.outputsDir);
  if (!deletedOutput && fs.existsSync(path.resolve(job.outputPath))) {
    return res.status(400).json({
      message: "Refuse to delete output directory outside OUTPUTS_DIR"
    });
  }

  const deletedLog = removeJobLogFile(job.id, config.logsDir);
  jobService.clearLogLines(job.id);
  repo.deleteJob(job.id);
  return res.json({ success: true, deletedOutput, deletedLog });
});

jobsRouter.get("/:id/logs/stream", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const history = jobService.getLogLines(job.id);
  if (history.length > 0) {
    res.write(
      `event: log\ndata: ${JSON.stringify({ type: "log", jobId: job.id, ts: new Date().toISOString(), data: { lines: history, replace: true } })}\n\n`
    );
  }

  registerSseClient(job.id, res);
});

jobsRouter.get("/:id/model/download", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const format = parseSplatExportFormat(req.query.format);
  if (!format) {
    return res.status(400).json({ message: "Unsupported model format. Use one of: sog, ply, spz, html" });
  }

  const outputRoot = path.resolve(job.outputPath);
  if (!fs.existsSync(outputRoot)) {
    return res.status(404).json({ message: "Model output not found" });
  }

  let artifact: Awaited<ReturnType<typeof getSplatExportArtifact>>;
  try {
    artifact = await getSplatExportArtifact(outputRoot, format);
  } catch (error) {
    return res.status(500).json({ message: `Failed to prepare ${format.toUpperCase()} export: ${(error as Error).message}` });
  }

  if (!artifact) {
    return res.status(404).json({ message: "Model output not found" });
  }

  const resolvedModelPath = path.resolve(artifact.path);
  if (!ensureViewerPathAllowed(resolvedModelPath, outputRoot) || !fs.existsSync(resolvedModelPath)) {
    return res.status(404).json({ message: "Model export not found" });
  }

  const downloadName = resolvedModelPath.includes(`${path.sep}.web-preview${path.sep}`)
    ? `${job.id}-model.${artifact.format}`
    : path.basename(resolvedModelPath);
  res.setHeader("X-LFS-Default-Format", DEFAULT_SPLAT_EXPORT_FORMAT);
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  return res.sendFile(resolvedModelPath);
});

jobsRouter.get("/:id/splat/latest", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const snapshot = await getSplatSnapshot(job.outputPath);
  if (!snapshot.available) {
    return res.json(snapshot);
  }

  return res.json({
    available: true,
    status: snapshot.status,
    message: snapshot.message,
    viewerUrl: snapshot.viewerPath ? `/api/jobs/${job.id}/splat/viewer?mtime=${Math.round(snapshot.source.mtimeMs)}` : null,
    source: {
      type: snapshot.source.type,
      filename: path.basename(snapshot.source.path),
      mtimeMs: snapshot.source.mtimeMs,
      sizeBytes: snapshot.source.sizeBytes,
      iteration: snapshot.source.iteration
    }
  });
});

jobsRouter.get("/:id/splat/viewer", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const snapshot = await getSplatSnapshot(job.outputPath);
  if (!snapshot.available) {
    return res.status(404).json({ message: snapshot.message });
  }
  if (snapshot.status !== "ready" || !snapshot.viewerPath) {
    return res.status(409).json({ message: snapshot.message ?? "Splat viewer is not ready" });
  }

  const resolvedViewerPath = path.resolve(snapshot.viewerPath);
  if (!ensureViewerPathAllowed(resolvedViewerPath, path.resolve(job.outputPath)) || !fs.existsSync(resolvedViewerPath)) {
    return res.status(404).json({ message: "Splat viewer not found" });
  }

  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(resolvedViewerPath);
});

jobsRouter.get("/:id/timelapse/cameras", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const items = repo.listTimelapseCameras(job.id);
  return res.json({ items });
});

jobsRouter.get("/:id/timelapse/frames", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const camera = String(req.query.camera ?? "").trim();
  if (!camera) {
    return res.status(400).json({ message: "camera is required" });
  }

  const cursorRaw = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = cursorRaw && Number.isFinite(cursorRaw) ? cursorRaw : undefined;
  const items = repo.listTimelapseFrames(job.id, camera, cursor);
  const nextCursor = items.length > 0 ? items[items.length - 1].iteration : null;

  return res.json({ items, nextCursor });
});

jobsRouter.get("/:id/timelapse/latest", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  try {
    const items = repo.getTimelapseLatest(job.id);
    const disk = await jobService.getDiskStatus(job.outputPath);
    return res.json({ items, disk });
  } catch (error) {
    return res.status(500).json({ message: `Failed to read disk status: ${(error as Error).message}` });
  }
});

jobsRouter.get("/:id/timelapse/download", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const camera = String(req.query.camera ?? "all");
  const timelapseRoot = path.join(job.outputPath, "timelapse");

  if (!fs.existsSync(timelapseRoot)) {
    return res.status(404).json({ message: "No timelapse output" });
  }

  // Level 1 (fastest) is sufficient for already-compressed image formats (JPEG/PNG).
  const archive = archiver("zip", { zlib: { level: 1 } });
  archive.on("error", (err) => {
    res.status(500).end(err.message);
  });

  if (camera === "all") {
    res.setHeader("Content-Disposition", `attachment; filename="${job.id}-timelapse-all.zip"`);
    archive.directory(timelapseRoot, "timelapse");
  } else {
    const target = path.join(timelapseRoot, camera);
    if ((target !== path.resolve(timelapseRoot) && !target.startsWith(path.resolve(timelapseRoot) + path.sep)) || !fs.existsSync(target)) {
      return res.status(404).json({ message: "Camera timelapse not found" });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${job.id}-timelapse-${camera}.zip"`);
    archive.directory(target, camera);
  }

  res.setHeader("Content-Type", "application/zip");
  archive.pipe(res);
  archive.finalize();
});

jobsRouter.get("/:id/timelapse/frame", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const filePath = String(req.query.path ?? "");
  if (!filePath) {
    return res.status(400).json({ message: "path is required" });
  }

  const resolved = path.resolve(filePath);
  const allowRoot = path.resolve(path.join(job.outputPath, "timelapse"));
  if (resolved !== allowRoot && !resolved.startsWith(allowRoot + path.sep)) {
    return res.status(404).json({ message: "Frame not found" });
  }

  if (!fs.existsSync(resolved) && job.executor === "modal") {
    let reloadError: unknown;
    for (let attempt = 0; attempt < 3 && !fs.existsSync(resolved); attempt += 1) {
      try {
        // Modal containers keep a snapshot of mounted Volumes. A live frame can
        // be committed by the GPU worker after this web container was started.
        await jobService.reloadRemoteVolume();
        reloadError = undefined;
      } catch (error) {
        reloadError = error;
      }
      if (!fs.existsSync(resolved) && attempt < 2) {
        // reload() can briefly fail with "volume busy" while another response
        // still has a file open. Keep this request alive and retry.
        await delay(100 * (attempt + 1));
      }
    }
    if (reloadError && !fs.existsSync(resolved)) {
      logger.warn("Modal volume reload failed while serving timelapse frame", {
        job_id: job.id,
        ...logger.errFields(reloadError)
      });
    }
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ message: "Frame not found" });
  }

  return res.sendFile(resolved);
});
