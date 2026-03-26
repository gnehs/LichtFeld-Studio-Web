import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as checkDiskSpaceModule from "check-disk-space";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { repo } from "../db.js";
import { buildAutoTimelapse } from "../lib/autoTimelapse.js";
import { buildLfsArgs } from "../lib/cliBuilder.js";
import { scanTimelapseDir, toTimelapseFrame } from "../lib/timelapse.js";
import { emitJobEvent } from "../sse.js";
import type { DiskGuardStatus, JobRecord, JobStatus, TrainingParamsForm } from "../types/models.js";

export interface CreateJobInput {
  datasetId?: string;
  params: TrainingParamsForm;
}

const LOG_LIMIT = 5000;
const checkDiskSpace = checkDiskSpaceModule.default as unknown as (directoryPath: string) => Promise<{
  diskPath: string;
  free: number;
  size: number;
}>;

class JobService {
  private queue: string[] = [];
  private activeJobId: string | null = null;
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private logs = new Map<string, string[]>();
  private timelapseIntervals = new Map<string, NodeJS.Timeout>();
  private diskGuardIntervals = new Map<string, NodeJS.Timeout>();
  private stopReasons = new Map<string, string>();

  listJobs() {
    return repo.listJobs();
  }

  getJob(id: string) {
    return repo.getJob(id);
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
        .split(/\r?\n/)
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

  clearLogLines(jobId: string) {
    this.logs.delete(jobId);
  }

  createJob(input: CreateJobInput) {
    const dataset = input.datasetId ? repo.getDataset(input.datasetId) : null;
    const params: TrainingParamsForm = { ...input.params };

    if (!params.dataPath && dataset) {
      params.dataPath = dataset.path;
    }

    if (!params.outputPath) {
      params.outputPath = path.join(config.outputsDir, `job-${Date.now()}`);
    }

    params.timelapse = buildAutoTimelapse({
      dataPath: params.dataPath,
      every: params.timelapse?.every,
      existingImages: params.timelapse?.images
    });

    fs.mkdirSync(params.outputPath, { recursive: true });

    if (params.configJson && !params.configPath) {
      const configPath = path.join(params.outputPath, "web-config.json");
      fs.writeFileSync(configPath, params.configJson, "utf-8");
      params.configPath = configPath;
    }

    const args = buildLfsArgs(params);

    const now = new Date().toISOString();
    const job: JobRecord = {
      id: nanoid(),
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
      stopReason: null
    };

    repo.createJob(job);
    this.queue.push(job.id);
    this.emitStatus(job.id, "queued", { queueLength: this.queue.length });
    this.maybeStartNext();
    return repo.getJob(job.id)!;
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

  stopJob(jobId: string, reason = "stopped") {
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
        LOG_LEVEL: config.lfsDefaultLogLevel
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
    const lines = chunk.split(/\r?\n/).filter(Boolean);
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

  private startTimelapsePolling(jobId: string, outputPath: string) {
    const timer = setInterval(() => {
      const scanned = scanTimelapseDir(outputPath);
      let inserted = 0;

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
      }

      emitJobEvent({
        type: "timelapse.scan.completed",
        jobId,
        ts: new Date().toISOString(),
        data: { inserted, scanned: scanned.length }
      });
    }, 2000);

    this.timelapseIntervals.set(jobId, timer);
  }

  private stopTimelapsePolling(jobId: string) {
    const timer = this.timelapseIntervals.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timelapseIntervals.delete(jobId);
    }
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
