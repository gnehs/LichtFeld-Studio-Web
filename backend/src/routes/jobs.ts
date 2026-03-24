import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { Router } from "express";
import { z } from "zod";
import { repo } from "../db.js";
import { registerSseClient } from "../sse.js";
import { jobService } from "../services/jobService.js";

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
    strategy: z.enum(["mcmc", "adc", "igs+"]).optional(),
    maxCap: z.number().int().positive().optional(),
    gut: z.boolean().optional(),
    eval: z.boolean().optional(),
    saveEvalImages: z.boolean().optional(),
    timelapse: z
      .object({
        images: z.array(z.string().min(1)).default([]),
        every: z.number().int().positive().default(50)
      })
      .optional()
  }).passthrough()
});

export const jobsRouter = Router();

jobsRouter.get("/", (_req, res) => {
  res.json({ items: jobService.listJobs() });
});

jobsRouter.get("/:id", (req, res) => {
  const item = jobService.getJob(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Job not found" });
  }
  return res.json({ item });
});

jobsRouter.post("/", (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  try {
    const item = jobService.createJob(parsed.data);
    return res.json({ item });
  } catch (error) {
    return res.status(400).json({ message: (error as Error).message });
  }
});

jobsRouter.post("/:id/stop", (req, res) => {
  const stopped = jobService.stopJob(req.params.id, "stopped");
  if (!stopped) {
    return res.status(404).json({ message: "Job not found or not stoppable" });
  }
  return res.json({ success: true });
});

jobsRouter.delete("/:id", (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  if (job.status === "running") {
    return res.status(409).json({ message: "Running job cannot be deleted" });
  }

  const deleteTimelapse = String(req.query.deleteTimelapse ?? "false") === "true";
  if (deleteTimelapse) {
    const dir = path.join(job.outputPath, "timelapse");
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  repo.deleteJob(job.id);
  return res.json({ success: true, deleteTimelapse });
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
      `event: log\ndata: ${JSON.stringify({ type: "log", jobId: job.id, ts: new Date().toISOString(), data: { lines: history } })}\n\n`
    );
  }

  registerSseClient(job.id, res);
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

  const items = repo.getTimelapseLatest(job.id);
  const disk = await jobService.getDiskStatus(job.outputPath);
  return res.json({ items, disk });
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

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(err.message);
  });

  if (camera === "all") {
    res.setHeader("Content-Disposition", `attachment; filename="${job.id}-timelapse-all.zip"`);
    archive.directory(timelapseRoot, "timelapse");
  } else {
    const target = path.join(timelapseRoot, camera);
    if (!target.startsWith(path.resolve(timelapseRoot)) || !fs.existsSync(target)) {
      return res.status(404).json({ message: "Camera timelapse not found" });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${job.id}-timelapse-${camera}.zip"`);
    archive.directory(target, camera);
  }

  res.setHeader("Content-Type", "application/zip");
  archive.pipe(res);
  archive.finalize();
});

jobsRouter.get("/:id/timelapse/frame", (req, res) => {
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
  if (!resolved.startsWith(allowRoot) || !fs.existsSync(resolved)) {
    return res.status(404).json({ message: "Frame not found" });
  }

  return res.sendFile(resolved);
});
