import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { Router } from "express";
import { z } from "zod";
import { repo } from "../db.js";
import { registerSseClient } from "../sse.js";
import { jobService } from "../services/jobService.js";
import { config } from "../config.js";
import { removeJobLogFile, removeJobOutputDir } from "../lib/outputCleanup.js";

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
    strategy: z.enum(["mrnf", "mcmc", "igs+"]).optional(),
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

async function findLatestModelPly(rootDir: string): Promise<string | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  let bestPath: string | null = null;
  let bestMtime = -1;

  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "timelapse") return;
      const nested = await findLatestModelPly(fullPath);
      if (!nested) return;
      const stat = await fsPromises.stat(nested);
      if (stat.mtimeMs > bestMtime) {
        bestMtime = stat.mtimeMs;
        bestPath = nested;
      }
      return;
    }

    if (!entry.isFile()) return;
    if (!entry.name.toLowerCase().endsWith(".ply")) return;
    const stat = await fsPromises.stat(fullPath);
    if (stat.mtimeMs > bestMtime) {
      bestMtime = stat.mtimeMs;
      bestPath = fullPath;
    }
  }));

  return bestPath;
}

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
      `event: log\ndata: ${JSON.stringify({ type: "log", jobId: job.id, ts: new Date().toISOString(), data: { lines: history } })}\n\n`
    );
  }

  registerSseClient(job.id, res);
});

jobsRouter.get("/:id/model/download", async (req, res) => {
  const job = repo.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found" });
  }

  const outputRoot = path.resolve(job.outputPath);
  if (!fs.existsSync(outputRoot)) {
    return res.status(404).json({ message: "Model output not found" });
  }

  const modelPath = await findLatestModelPly(outputRoot);
  if (!modelPath) {
    return res.status(404).json({ message: "Model .ply not found" });
  }

  const downloadName = path.basename(modelPath);
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  return res.sendFile(modelPath);
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
  if ((resolved !== allowRoot && !resolved.startsWith(allowRoot + path.sep)) || !fs.existsSync(resolved)) {
    return res.status(404).json({ message: "Frame not found" });
  }

  return res.sendFile(resolved);
});
