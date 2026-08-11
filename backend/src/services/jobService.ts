import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as checkDiskSpaceModule from "check-disk-space";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { repo } from "../db.js";
import { buildAutoTimelapse } from "../lib/autoTimelapse.js";
import { buildLfsArgs } from "../lib/cliBuilder.js";
import { computeEffectiveIterations } from "../lib/trainingParams.js";
import { isLargerCompatibleModalGpu, normalizeTrainingGpu } from "../lib/gpuSelection.js";
import { findResumeCheckpoint } from "../lib/resumeCheckpoint.js";
import { logger } from "../lib/logger.js";
import { scanTimelapseDir, toTimelapseFrame } from "../lib/timelapse.js";
import { emitJobEvent } from "../sse.js";
import {
  cancelModalJob,
  dispatchModalJob,
  reloadModalDataVolume
} from "./modalExecutor.js";
import type { DiskGuardStatus, JobRecord, JobStatus, TrainingParamsForm } from "../types/models.js";

export interface CreateJobInput {
  datasetId?: string;
  params: TrainingParamsForm;
}

export interface RetryJobResult {
  item: JobRecord;
  resumed: true;
}

const LOG_LIMIT = 5000;
const REMOTE_STATUS_FILE = ".web-status.json";
const REMOTE_LOG_FILE = ".web-training.log";
const REMOTE_SYNC_INTERVAL_MS = 2_000;
const checkDiskSpace = checkDiskSpaceModule.default as unknown as (directoryPath: string) => Promise<{
  diskPath: string;
  free: number;
  size: number;
}>;

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function isModalConfigPathAllowed(targetPath: string): boolean {
  return [config.outputsDir, ...config.allowedDatasetRoots].some((rootPath) => isPathWithinRoot(targetPath, rootPath));
}

class JobService {
  private queue: string[] = [];
  private activeJobId: string | null = null;
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private logs = new Map<string, string[]>();
  private timelapseIntervals = new Map<string, NodeJS.Timeout>();
  private timelapseMaxIterations = new Map<string, number>(); // jobId -> max iteration seen so far
  private diskGuardIntervals = new Map<string, NodeJS.Timeout>();
  private stopReasons = new Map<string, string>();
  private remoteTimelapseMaxIterations = new Map<string, number>();
  private remoteSyncPromise: Promise<void> | null = null;
  private lastRemoteSyncAt = 0;
  private retryingJobIds = new Set<string>();

  listJobs() {
    return repo.listJobs();
  }

  getJob(id: string) {
    return repo.getJob(id);
  }

  hasActiveRetryDependents(jobId: string): boolean {
    return repo.listJobs().some((candidate) => {
      if (candidate.status !== "queued" && candidate.status !== "running") return false;
      try {
        const params = JSON.parse(candidate.paramsJson) as TrainingParamsForm;
        return params.retryOfJobId === jobId;
      } catch {
        return false;
      }
    });
  }

  getLogLines(jobId: string) {
    const buffered = this.logs.get(jobId);
    if (buffered && buffered.length > 0) {
      return buffered;
    }

    const persistedLogPath = path.join(config.logsDir, `${jobId}.log`);
    if (fs.existsSync(persistedLogPath)) {
      const persisted = fs
        .readFileSync(persistedLogPath, "utf-8")
        .split(/[\r\n]+/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
      if (persisted.length > 0) {
        this.logs.set(jobId, persisted);
        return persisted;
      }
    }

    const job = repo.getJob(jobId);
    if (job?.errorMessage) {
      return [`[error] ${job.errorMessage}`];
    }

    return [];
  }

  /**
   * Pull worker-authored artifacts only while the web app is already serving
   * a user request. The GPU worker never has to wake the scale-to-zero web
   * container just to deliver progress.
   */
  async syncRemoteJobs(): Promise<void> {
    if (config.trainingExecutor !== "modal") return;
    if (Date.now() - this.lastRemoteSyncAt < REMOTE_SYNC_INTERVAL_MS) return;
    if (this.remoteSyncPromise) return this.remoteSyncPromise;

    this.remoteSyncPromise = (async () => {
      await reloadModalDataVolume();
      this.lastRemoteSyncAt = Date.now();
      const jobs = repo.listJobs().filter(
        (job) => job.executor === "modal" && !["completed", "failed", "stopped", "stopped_low_disk"].includes(job.status)
      );
      await Promise.all(jobs.map((job) => this.ingestRemoteArtifacts(job)));
    })().finally(() => {
      this.remoteSyncPromise = null;
    });
    return this.remoteSyncPromise;
  }

  private async ingestRemoteArtifacts(job: JobRecord): Promise<void> {
    const statusPath = path.join(job.outputPath, REMOTE_STATUS_FILE);
    if (fs.existsSync(statusPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as Record<string, unknown>;
        const status = data.status;
        if (
          typeof status === "string" &&
          ["queued", "running", "completed", "failed", "stopped", "stopped_low_disk"].includes(status)
        ) {
          const current = repo.getJob(job.id);
          if (current?.status !== status) {
            this.recordRemoteStatus(job.id, status as JobStatus, data);
          }
        }
      } catch (error) {
        logger.warn("Unable to read Modal worker status artifact", {
          job_id: job.id,
          ...logger.errFields(error)
        });
      }
    }

    const remoteLogPath = path.join(job.outputPath, REMOTE_LOG_FILE);
    const persistedLogPath = path.join(config.logsDir, `${job.id}.log`);
    if (fs.existsSync(remoteLogPath)) {
      const copiedBytes = fs.existsSync(persistedLogPath) ? fs.statSync(persistedLogPath).size : 0;
      const remoteBytes = fs.readFileSync(remoteLogPath);
      if (remoteBytes.length > copiedBytes) {
        const appended = remoteBytes.subarray(copiedBytes).toString("utf-8");
        this.appendRemoteLog(job.id, appended.split(/\r?\n/));
      }
    }

    const sinceIteration = this.remoteTimelapseMaxIterations.get(job.id) ?? -1;
    const frames = await scanTimelapseDir(job.outputPath, sinceIteration);
    let newestIteration = sinceIteration;
    for (const frame of frames) {
      const inserted = repo.insertTimelapseFrame(toTimelapseFrame(job.id, frame));
      if (inserted) {
        emitJobEvent({
          type: "timelapse.frame.created",
          jobId: job.id,
          ts: new Date().toISOString(),
          data: inserted
        });
      }
      newestIteration = Math.max(newestIteration, frame.iteration);
    }
    this.remoteTimelapseMaxIterations.set(job.id, newestIteration);
  }

  clearLogLines(jobId: string) {
    this.logs.delete(jobId);
  }

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const jobId = nanoid();
    const dataset = input.datasetId ? repo.getDataset(input.datasetId) : null;
    const isModalExecutor = config.trainingExecutor === "modal";
    const params: TrainingParamsForm = { ...input.params };
    params.gpu = normalizeTrainingGpu(params.gpu, config.trainingExecutor);

    if (!params.dataPath && dataset) {
      params.dataPath = dataset.path;
    }

    if (isModalExecutor) {
      // Retry payloads may contain an old output directory. Modal jobs always
      // get a fresh, shared-volume path derived from their newly allocated ID.
      params.outputPath = path.join(config.outputsDir, `job-${jobId}`);
    } else if (!params.outputPath) {
      params.outputPath = path.join(config.outputsDir, `job-${Date.now()}`);
    }

    params.timelapse = buildAutoTimelapse({
      dataPath: params.dataPath,
      every: params.timelapse?.every,
      existingImages: params.timelapse?.images
    });
    params.effectiveIterations = computeEffectiveIterations(params);

    let configPathToWrite: string | null = null;
    if (isModalExecutor) {
      if (params.configJson !== undefined) {
        // Ignore a stale configPath from a retry when fresh JSON is supplied.
        configPathToWrite = path.join(params.outputPath, "web-config.json");
        params.configPath = configPathToWrite;
      } else if (params.configPath) {
        const resolvedConfigPath = path.resolve(params.configPath);
        if (!isModalConfigPathAllowed(resolvedConfigPath)) {
          throw new Error("configPath must be inside DATASET_ALLOWED_ROOTS or OUTPUTS_DIR");
        }
        params.configPath = resolvedConfigPath;
      }
    } else if (params.configJson && !params.configPath) {
      configPathToWrite = path.join(params.outputPath, "web-config.json");
      params.configPath = configPathToWrite;
    }

    fs.mkdirSync(params.outputPath, { recursive: true });
    if (configPathToWrite) {
      fs.writeFileSync(configPathToWrite, params.configJson ?? "", "utf-8");
    }

    const args = buildLfsArgs(params);

    const now = new Date().toISOString();
    const job: JobRecord = {
      id: jobId,
      datasetId: dataset?.id ?? null,
      status: "queued",
      outputPath: params.outputPath,
      argsJson: JSON.stringify(args),
      paramsJson: JSON.stringify(params),
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      pid: null,
      exitCode: null,
      errorMessage: null,
      stopReason: null,
      executor: config.trainingExecutor,
      remoteCallId: null
    };

    repo.createJob(job);

    if (config.trainingExecutor === "modal") {
      this.emitStatus(job.id, "queued", { executor: "modal" });
      return this.startModalJob(job);
    }

    this.queue.push(job.id);
    this.emitStatus(job.id, "queued", { executor: "local", queueLength: this.queue.length });
    this.maybeStartNext();
    return repo.getJob(job.id)!;
  }

  async retryFailedModalJob(jobId: string, gpu: string): Promise<RetryJobResult> {
    const source = repo.getJob(jobId);
    if (!source) throw new Error("Job not found");
    if (source.status !== "failed") {
      throw new Error("Only failed jobs can be retried with a larger GPU");
    }
    if (source.executor !== "modal") {
      throw new Error("GPU upgrades are only available for Modal jobs");
    }
    if (config.trainingExecutor !== "modal") {
      throw new Error("Modal training executor is not available");
    }
    if (!isPathWithinRoot(source.outputPath, config.outputsDir)) {
      throw new Error("Failed job output is outside OUTPUTS_DIR");
    }
    if (this.retryingJobIds.has(source.id) || this.hasActiveRetryDependents(source.id)) {
      throw new Error("An active checkpoint retry already exists for this job");
    }

    this.retryingJobIds.add(source.id);
    try {
      let params: TrainingParamsForm;
      try {
        const parsed = JSON.parse(source.paramsJson) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid params");
        params = { ...(parsed as TrainingParamsForm) };
      } catch {
        throw new Error("Failed job has invalid training parameters");
      }

      const nextGpu = normalizeTrainingGpu(gpu, "modal");
      if (!nextGpu || !isLargerCompatibleModalGpu(params.gpu, nextGpu)) {
        throw new Error("Selected GPU is not a larger compatible option");
      }
      const resume = await findResumeCheckpoint(source.outputPath);
      if (!resume) throw new Error("No checkpoint is available for this failed job");

      params.gpu = nextGpu;
      params.retryOfJobId = source.id;
      params.resume = resume;
      delete params.init;

      const item = await this.createJob({ datasetId: source.datasetId ?? undefined, params });
      return { item, resumed: true };
    } finally {
      this.retryingJobIds.delete(source.id);
    }
  }

  private async startModalJob(job: JobRecord): Promise<JobRecord> {
    try {
      const { callId } = await dispatchModalJob(job);
      // Preserve any state already synchronized from the worker artifact while
      // persisting the FunctionCall ID.
      const current = repo.getJob(job.id);
      const status = current?.status ?? job.status;
      const updated = repo.updateJobStatus(job.id, status, {
        executor: "modal",
        remoteCallId: callId
      });
      this.emitStatus(job.id, status, { executor: "modal", remoteCallId: callId });
      return updated ?? current ?? job;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const updated = repo.updateJobStatus(job.id, "failed", {
        executor: "modal",
        finishedAt: new Date().toISOString(),
        errorMessage
      });
      this.emitStatus(job.id, "failed", { executor: "modal", errorMessage });
      throw error;
    }
  }

  async getDiskStatus(targetPath = config.outputsDir): Promise<DiskGuardStatus> {
    const diskCheckTarget = path.resolve(targetPath);
    const result = await checkDiskSpace(diskCheckTarget);
    const freeGb = Number((result.free / 1024 / 1024 / 1024).toFixed(2));
    return {
      freeGb,
      thresholdGb: config.timelapseMinFreeGb,
      action: freeGb < config.timelapseMinFreeGb ? "stop" : "ok"
    };
  }

  async stopJob(jobId: string, reason = "stopped"): Promise<boolean> {
    const existingJob = repo.getJob(jobId);
    if (existingJob?.executor === "modal") {
      return this.stopModalJob(jobId, reason);
    }

    const proc = this.processes.get(jobId);
    this.stopReasons.set(jobId, reason);

    if (!proc) {
      const job = repo.getJob(jobId);
      if (!job) {
        return false;
      }
      if (job.status === "queued") {
        this.queue = this.queue.filter((id) => id !== jobId);
        repo.updateJobStatus(jobId, reason === "stopped_low_disk" ? "stopped_low_disk" : "stopped", {
          finishedAt: new Date().toISOString(),
          stopReason: reason
        });
        this.emitStatus(jobId, reason === "stopped_low_disk" ? "stopped_low_disk" : "stopped", {
          stopReason: reason
        });
        return true;
      }
      return false;
    }

    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 7000);

    return true;
  }

  private async stopModalJob(jobId: string, reason = "stopped"): Promise<boolean> {
    const job = repo.getJob(jobId);
    if (!job) {
      return false;
    }

    const terminalStatuses: JobStatus[] = ["completed", "failed", "stopped", "stopped_low_disk"];
    if (terminalStatuses.includes(job.status)) {
      return false;
    }

    if (job.remoteCallId) {
      await cancelModalJob(job);
    }

    const status: JobStatus = reason === "stopped_low_disk" ? "stopped_low_disk" : "stopped";
    repo.updateJobStatus(jobId, status, {
      executor: "modal",
      finishedAt: new Date().toISOString(),
      stopReason: reason
    });
    this.emitStatus(jobId, status, { executor: "modal", stopReason: reason });
    return true;
  }

  private maybeStartNext() {
    if (this.activeJobId || this.queue.length === 0) {
      return;
    }

    const jobId = this.queue.shift();
    if (!jobId) {
      return;
    }

    const job = repo.getJob(jobId);
    if (!job) {
      this.maybeStartNext();
      return;
    }

    this.activeJobId = job.id;
    this.startJob(job);
  }

  private startJob(job: JobRecord) {
    const args = JSON.parse(job.argsJson) as string[];
    let selectedGpu: string | undefined;
    try {
      selectedGpu = (JSON.parse(job.paramsJson) as TrainingParamsForm).gpu;
    } catch {
      selectedGpu = undefined;
    }
    const logPath = path.join(config.logsDir, `${job.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    let spawnErrorMessage: string | null = null;

    const writeJobLog = (chunk: string) => {
      logStream.write(chunk);
      this.appendLog(job.id, chunk);
    };

    const child = spawn(config.lfsBinPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOG_LEVEL: config.lfsDefaultLogLevel,
        ...(selectedGpu ? { CUDA_VISIBLE_DEVICES: selectedGpu } : {})
      }
    });

    this.processes.set(job.id, child);
    this.logs.set(job.id, []);
    repo.updateJobStatus(job.id, "running", {
      startedAt: new Date().toISOString(),
      pid: child.pid ?? null
    });
    this.emitStatus(job.id, "running", { pid: child.pid, command: [config.lfsBinPath, ...args] });

    this.startTimelapsePolling(job.id, job.outputPath);
    this.startDiskGuard(job.id, job.outputPath);

    child.stdout.on("data", (chunk) => {
      writeJobLog(chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      writeJobLog(chunk.toString());
    });

    child.on("error", (error) => {
      spawnErrorMessage = error.message;
      writeJobLog(`[spawn-error] ${error.message}\n`);
    });

    child.on("close", (code, signal) => {
      logStream.end();
      this.stopTimelapsePolling(job.id);
      this.stopDiskGuard(job.id);
      this.processes.delete(job.id);

      const reason = this.stopReasons.get(job.id);
      this.stopReasons.delete(job.id);

      let status: JobStatus = "completed";
      let errorMessage: string | null = null;

      if (reason === "stopped_low_disk") {
        status = "stopped_low_disk";
      } else if (reason === "stopped") {
        status = "stopped";
      } else if (code !== 0 || spawnErrorMessage) {
        status = "failed";
        if (spawnErrorMessage) {
          errorMessage = spawnErrorMessage;
        } else if (signal) {
          errorMessage = `Process terminated by signal ${signal}`;
        } else if (code !== null) {
          errorMessage = `Process exited with code ${code}`;
        } else {
          errorMessage = "Process exited before reporting an exit code";
        }
      }

      repo.updateJobStatus(job.id, status, {
        finishedAt: new Date().toISOString(),
        exitCode: code ?? null,
        errorMessage,
        stopReason: reason ?? null
      });

      if (reason === "stopped_low_disk") {
        emitJobEvent({
          type: "job.stopped.low_disk",
          jobId: job.id,
          ts: new Date().toISOString(),
          data: {
            thresholdGb: config.timelapseMinFreeGb,
            message: "Disk free space below threshold, job stopped."
          }
        });
      }

      this.emitStatus(job.id, status, {
        exitCode: code,
        errorMessage,
        stopReason: reason
      });

      this.activeJobId = null;
      this.maybeStartNext();
    });
  }

  private appendLog(jobId: string, chunk: string) {
    // LichtFeld's headless progress bar redraws with CR only. Treat both CR
    // and LF as record delimiters so local Docker jobs stream progress just
    // like Modal jobs do.
    const lines = chunk.split(/[\r\n]+/).filter(Boolean);
    const buffer = this.logs.get(jobId) ?? [];
    buffer.push(...lines);
    if (buffer.length > LOG_LIMIT) {
      buffer.splice(0, buffer.length - LOG_LIMIT);
    }
    this.logs.set(jobId, buffer);

    emitJobEvent({
      type: "log",
      jobId,
      ts: new Date().toISOString(),
      data: { lines }
    });
  }

  /** Persist and broadcast log lines received from the remote Modal worker. */
  appendRemoteLog(jobId: string, lines: string[]) {
    const normalized = lines.map((line) => String(line)).filter((line) => line.length > 0);
    if (normalized.length === 0) {
      return;
    }

    const logPath = path.join(config.logsDir, `${jobId}.log`);
    fs.appendFileSync(logPath, `${normalized.join("\n")}\n`, "utf-8");
    this.appendLog(jobId, `${normalized.join("\n")}\n`);
  }

  /** Apply a status event emitted by the remote Modal worker. */
  recordRemoteStatus(jobId: string, status: JobStatus, data: Record<string, unknown> = {}) {
    const current = repo.getJob(jobId);
    if (!current) {
      return null;
    }

    const terminalStatuses: JobStatus[] = ["completed", "failed", "stopped", "stopped_low_disk"];
    if (terminalStatuses.includes(current.status) && current.status !== status) {
      return current;
    }

    const patch: Partial<JobRecord> = { executor: "modal" };
    if (typeof data.callId === "string" && data.callId.length > 0) {
      patch.remoteCallId = data.callId;
    }

    if (status === "running") {
      patch.startedAt = typeof data.startedAt === "string" ? data.startedAt : new Date().toISOString();
    }

    if (terminalStatuses.includes(status)) {
      patch.finishedAt = typeof data.finishedAt === "string" ? data.finishedAt : new Date().toISOString();
      if (typeof data.exitCode === "number" || data.exitCode === null) {
        patch.exitCode = data.exitCode;
      }
      if (typeof data.errorMessage === "string" || data.errorMessage === null) {
        patch.errorMessage = data.errorMessage;
      }
      if (typeof data.stopReason === "string" || data.stopReason === null) {
        patch.stopReason = data.stopReason;
      }
    }

    const updated = repo.updateJobStatus(jobId, status, patch);
    if (status === "stopped_low_disk") {
      emitJobEvent({
        type: "job.stopped.low_disk",
        jobId,
        ts: new Date().toISOString(),
        data: {
          thresholdGb: config.timelapseMinFreeGb,
          message: "Disk free space below threshold, job stopped."
        }
      });
    }
    this.emitStatus(jobId, status, { executor: "modal", ...data });
    return updated;
  }

  /** Insert and broadcast a timelapse frame emitted by the remote worker. */
  recordRemoteTimelapseFrame(jobId: string, data: unknown) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid timelapse frame payload");
    }

    const frame = data as {
      cameraName?: unknown;
      iteration?: unknown;
      filePath?: unknown;
      sizeBytes?: unknown;
      createdAt?: unknown;
    };
    if (
      typeof frame.cameraName !== "string" ||
      typeof frame.iteration !== "number" ||
      !Number.isInteger(frame.iteration) ||
      typeof frame.filePath !== "string" ||
      typeof frame.sizeBytes !== "number" ||
      !Number.isFinite(frame.sizeBytes) ||
      typeof frame.createdAt !== "string"
    ) {
      throw new Error("Invalid timelapse frame payload");
    }

    const inserted = repo.insertTimelapseFrame({
      jobId,
      cameraName: frame.cameraName,
      iteration: frame.iteration,
      filePath: frame.filePath,
      sizeBytes: Number(frame.sizeBytes),
      createdAt: frame.createdAt
    });
    if (inserted) {
      emitJobEvent({
        type: "timelapse.frame.created",
        jobId,
        ts: new Date().toISOString(),
        data: inserted
      });
    }
    return inserted;
  }

  emitRemoteTimelapseScan(jobId: string, data: unknown) {
    emitJobEvent({
      type: "timelapse.scan.completed",
      jobId,
      ts: new Date().toISOString(),
      data
    });
  }

  async reloadRemoteVolume(): Promise<void> {
    await reloadModalDataVolume();
  }

  private startTimelapsePolling(jobId: string, outputPath: string) {
    this.timelapseMaxIterations.set(jobId, -1);

    const poll = async () => {
      const sinceIteration = this.timelapseMaxIterations.get(jobId) ?? -1;
      let scanned: Awaited<ReturnType<typeof scanTimelapseDir>>;
      try {
        scanned = await scanTimelapseDir(outputPath, sinceIteration);
      } catch {
        return;
      }
      let inserted = 0;
      let newMax = sinceIteration;

      for (const frame of scanned) {
        const insertedFrame = repo.insertTimelapseFrame(toTimelapseFrame(jobId, frame));
        if (insertedFrame) {
          inserted += 1;
          emitJobEvent({
            type: "timelapse.frame.created",
            jobId,
            ts: new Date().toISOString(),
            data: insertedFrame
          });
        }
        if (frame.iteration > newMax) {
          newMax = frame.iteration;
        }
      }

      if (newMax > sinceIteration) {
        this.timelapseMaxIterations.set(jobId, newMax);
      }

      emitJobEvent({
        type: "timelapse.scan.completed",
        jobId,
        ts: new Date().toISOString(),
        data: { inserted, scanned: scanned.length }
      });
    };

    const timer = setInterval(() => { void poll(); }, 2000);
    this.timelapseIntervals.set(jobId, timer);
  }

  private stopTimelapsePolling(jobId: string) {
    const timer = this.timelapseIntervals.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timelapseIntervals.delete(jobId);
    }
    this.timelapseMaxIterations.delete(jobId);
  }

  private startDiskGuard(jobId: string, targetPath: string) {
    const timer = setInterval(async () => {
      try {
        const status = await this.getDiskStatus(targetPath);
        if (status.action === "stop") {
          this.stopJob(jobId, "stopped_low_disk");
        }
      } catch (error) {
        this.appendLog(jobId, `[disk-guard-error] ${(error as Error).message}\n`);
      }
    }, config.diskGuardIntervalMs);

    this.diskGuardIntervals.set(jobId, timer);
  }

  private stopDiskGuard(jobId: string) {
    const timer = this.diskGuardIntervals.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.diskGuardIntervals.delete(jobId);
    }
  }

  private emitStatus(jobId: string, status: JobStatus, data: Record<string, unknown> = {}) {
    emitJobEvent({
      type: "job.status",
      jobId,
      ts: new Date().toISOString(),
      data: { status, ...data }
    });
  }
}

export const jobService = new JobService();
