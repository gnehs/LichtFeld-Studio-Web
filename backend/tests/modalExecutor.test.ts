import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

function configureModalEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-modal-executor-"));
  process.env.DATA_ROOT = root;
  process.env.DATASETS_DIR = path.join(root, "datasets");
  process.env.OUTPUTS_DIR = path.join(root, "outputs");
  process.env.LOGS_DIR = path.join(root, "logs");
  process.env.DB_PATH = path.join(root, "db", "app.db");
  process.env.DATASET_ALLOWED_ROOTS = path.join(root, "datasets");
  process.env.LFS_BIN_PATH = "/opt/lichtfeld/bin/LichtFeld-Studio";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ADMIN_PASSWORD_HASH =
    "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";
  process.env.TRAINING_EXECUTOR = "modal";
  process.env.PUBLIC_BASE_URL = "https://control.example.test/";
  process.env.MODAL_CONTROL_URL = "https://modal-control.example.test/";
  process.env.MODAL_CONTROL_TOKEN = "control-token";
  process.env.MODAL_CALLBACK_TOKEN = "callback-token";
  return root;
}

describe("modal training executor", () => {
  it("dispatches a job with its selected GPU and stores the remote call ID", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: true, callId: "fc-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { jobService } = await import("../src/services/jobService.js");
      const legacyOutputPath = path.join(root, "legacy-output");
      const job = await jobService.createJob({
        params: { outputPath: legacyOutputPath },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://modal-control.example.test/jobs/dispatch");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer control-token",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init.body))).toMatchObject({
        jobId: job.id,
        args: expect.arrayContaining(["--headless", "--train"]),
        gpu: "A10",
      });
      const args = JSON.parse(String(init.body)).args as string[];
      const outputPathIndex = args.indexOf("--output-path");
      expect(outputPathIndex).toBeGreaterThanOrEqual(0);
      expect(args[outputPathIndex + 1]).toBe(
        path.join(root, "outputs", `job-${job.id}`),
      );
      expect(job.outputPath).toBe(args[outputPathIndex + 1]);
      expect(job.outputPath).not.toBe(legacyOutputPath);
      expect(job.executor).toBe("modal");
      expect(job.remoteCallId).toBe("fc-123");
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("dispatches multiple Modal jobs without waiting for an earlier job to finish", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    let dispatchCount = 0;
    const fetchMock = vi.fn(async () => {
      dispatchCount += 1;
      return new Response(
        JSON.stringify({
          accepted: true,
          callId: `fc-parallel-${dispatchCount}`,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { jobService } = await import("../src/services/jobService.js");
      const [firstJob, secondJob] = await Promise.all([
        jobService.createJob({ params: {} }),
        jobService.createJob({ params: {} }),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(new Set([firstJob.remoteCallId, secondJob.remoteCallId])).toEqual(
        new Set(["fc-parallel-1", "fc-parallel-2"]),
      );
      expect(firstJob.status).toBe("queued");
      expect(secondJob.status).toBe("queued");
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("preserves an early running callback when dispatch returns the call ID", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    let resolveDispatch!: (response: Response) => void;
    let markDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const fetchMock = vi.fn(async () => {
      markDispatchStarted();
      return new Promise<Response>((resolve) => {
        resolveDispatch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { jobService } = await import("../src/services/jobService.js");
      const createPromise = jobService.createJob({ params: {} });
      await dispatchStarted;

      const queuedJob = jobService.listJobs()[0];
      expect(queuedJob).toBeDefined();
      jobService.recordRemoteStatus(queuedJob!.id, "running", {
        startedAt: "2026-08-05T00:00:00.000Z",
      });

      resolveDispatch(
        new Response(JSON.stringify({ accepted: true, callId: "fc-early" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const job = await createPromise;
      expect(job.status).toBe("running");
      expect(job.remoteCallId).toBe("fc-early");
      expect(jobService.getJob(job.id)).toMatchObject({
        status: "running",
        remoteCallId: "fc-early",
      });
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("skips the modal volume reload while a tus upload is unfinished", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    process.env.MODAL_VOLUME_HELPER_URL = "http://127.0.0.1:3001";
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { config } = await import("../src/config.js");
      const { tusUploadStore } = await import("../src/lib/tusUploadStore.js");
      const { reloadModalDataVolume } = await import("../src/services/modalExecutor.js");

      // While an unfinished upload exists, a reload must never reach the helper.
      const upload = tusUploadStore.createUpload({ uploadLength: 100, metadata: {} });
      await reloadModalDataVolume();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(tusUploadStore.hasUnfinishedUploads()).toBe(true);

      // Once the upload artifacts are gone, the reload is allowed again.
      fs.rmSync(path.join(config.tusUploadDir, `${upload.id}.json`), { force: true });
      fs.rmSync(path.join(config.tusUploadDir, `${upload.id}.zip`), { force: true });
      await reloadModalDataVolume();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:3001/data/reload");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.MODAL_VOLUME_HELPER_URL;
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("cancels a remote call through the control plane", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true, callId: "fc-456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { jobService } = await import("../src/services/jobService.js");
      const { config } = await import("../src/config.js");
      const job = await jobService.createJob({ params: {} });
      // Simulate a web process restarted with local defaults while the DB
      // still contains a remote Modal job from the previous process.
      config.trainingExecutor = "local";
      await expect(jobService.stopJob(job.id)).resolves.toBe(true);

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe("https://modal-control.example.test/jobs/cancel");
      expect(JSON.parse(String(init.body))).toEqual({
        jobId: job.id,
        callId: "fc-456",
      });
      expect(jobService.getJob(job.id)?.status).toBe("stopped");
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("retries a failed job on a larger GPU from its checkpoint", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ accepted: true, callId: "fc-retry" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { repo } = await import("../src/db.js");
      const { jobService } = await import("../src/services/jobService.js");
      const sourceOutput = path.join(root, "outputs", "job-source");
      const checkpoint = path.join(sourceOutput, "checkpoints", "checkpoint.resume");
      fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
      fs.writeFileSync(checkpoint, "checkpoint-data");
      const now = new Date().toISOString();
      repo.createJob({
        id: "job-source",
        datasetId: null,
        status: "failed",
        outputPath: sourceOutput,
        argsJson: "[]",
        paramsJson: JSON.stringify({ gpu: "A10", iterations: 30_000, init: "/data/init.ply" }),
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        pid: null,
        exitCode: 1,
        errorMessage: "CUDA out of memory",
        stopReason: null,
        executor: "modal",
        remoteCallId: "fc-source"
      });

      const result = await jobService.retryFailedModalJob("job-source", "L40S");
      const realCheckpoint = fs.realpathSync(checkpoint);
      expect(result.resumed).toBe(true);
      expect(result.item.id).not.toBe("job-source");
      expect(result.item.outputPath).not.toBe(sourceOutput);
      const retryParams = JSON.parse(result.item.paramsJson);
      expect(retryParams).toMatchObject({
        gpu: "L40S",
        iterations: 30_000,
        retryOfJobId: "job-source",
        resume: realCheckpoint
      });
      expect(retryParams).not.toHaveProperty("init");
      expect(jobService.hasActiveRetryDependents("job-source")).toBe(true);
      await expect(jobService.retryFailedModalJob("job-source", "H100"))
        .rejects.toThrow("active checkpoint retry already exists");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(init.body));
      expect(payload.gpu).toBe("L40S");
      expect(payload.args).toEqual(expect.arrayContaining(["--resume", realCheckpoint]));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("does not allocate a GPU when a failed job has no checkpoint", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { repo } = await import("../src/db.js");
      const { jobService } = await import("../src/services/jobService.js");
      const sourceOutput = path.join(root, "outputs", "job-no-checkpoint");
      fs.mkdirSync(sourceOutput, { recursive: true });
      const now = new Date().toISOString();
      repo.createJob({
        id: "job-no-checkpoint",
        datasetId: null,
        status: "failed",
        outputPath: sourceOutput,
        argsJson: "[]",
        paramsJson: JSON.stringify({ gpu: "A10" }),
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        pid: null,
        exitCode: 1,
        errorMessage: "CUDA out of memory",
        stopReason: null,
        executor: "modal",
        remoteCallId: "fc-no-checkpoint"
      });

      await expect(jobService.retryFailedModalJob("job-no-checkpoint", "L40S"))
        .rejects.toThrow("No checkpoint is available");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jobService.listJobs()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
