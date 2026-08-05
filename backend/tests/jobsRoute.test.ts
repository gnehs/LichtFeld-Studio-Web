import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type MockResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  filePath: string | null;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => MockResponse;
  sendFile: (filePath: string) => MockResponse;
};

type StreamResponse = MockResponse & {
  writes: string[];
  writableEnded: boolean;
  destroyed: boolean;
  flushHeaders: () => void;
  write: (chunk: string) => boolean;
  on: (event: string, listener: () => void) => StreamResponse;
  once: (event: string, listener: () => void) => StreamResponse;
  emitClose: () => void;
};

function makeResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    filePath: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    sendFile(filePath) {
      this.filePath = filePath;
      return this;
    }
  };
}

function makeStreamResponse(): StreamResponse {
  const listeners = new Set<() => void>();
  return {
    ...makeResponse(),
    writes: [],
    writableEnded: false,
    destroyed: false,
    flushHeaders() {},
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    },
    on(event: string, listener: () => void) {
      if (event === "close") listeners.add(listener as () => void);
      return this;
    },
    once(event: string, listener: () => void) {
      if (event === "close") listeners.add(listener as () => void);
      return this;
    },
    emitClose() {
      for (const listener of listeners) listener();
    },
  } as StreamResponse;
}

describe("jobs log stream route", () => {
  it("marks the initial history event as a replacement", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-jobs-route-log-stream-"));
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");
    process.env.DATA_ROOT = root;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    const { jobsRouter } = await import("../src/routes/jobs.js");
    const { repo } = await import("../src/db.js");
    const { jobService } = await import("../src/services/jobService.js");

    const layer = jobsRouter.stack.find((entry) => {
      const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      return route?.path === "/:id/logs/stream" && route.methods?.get;
    });
    const handler = layer?.route?.stack?.[0]?.handle;
    if (!handler) throw new Error("Log stream handler not found");

    fs.mkdirSync(logsDir, { recursive: true });
    const outputPath = path.join(outputsDir, "job-log-stream-1");
    repo.createJob({
      id: "job-log-stream-1",
      datasetId: null,
      status: "running",
      outputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      pid: null,
      exitCode: null,
      errorMessage: null,
      stopReason: null,
    });
    fs.writeFileSync(path.join(logsDir, "job-log-stream-1.log"), "first line\nsecond line\n");
    expect(jobService.getLogLines("job-log-stream-1")).toEqual(["first line", "second line"]);

    const response = makeStreamResponse();
    await handler({ params: { id: "job-log-stream-1" } } as any, response as any, vi.fn());

    expect(response.writes).toHaveLength(1);
    const payload = JSON.parse(response.writes[0].split("data: ")[1].trim()) as {
      data?: { lines?: string[]; replace?: boolean };
    };
    expect(payload.data).toEqual({ lines: ["first line", "second line"], replace: true });
    response.emitClose();
  });
});

describe("jobs delete route", () => {
  it("removes the job output folder and log when deleting a finished job", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-jobs-route-delete-"));
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");

    process.env.DATA_ROOT = root;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    const { jobsRouter } = await import("../src/routes/jobs.js");
    const { repo } = await import("../src/db.js");
    const { jobService } = await import("../src/services/jobService.js");

    const layer = jobsRouter.stack.find((entry) => {
      const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      return route?.path === "/:id" && route.methods?.delete;
    });
    const handler = layer?.route?.stack?.[0]?.handle;

    if (!handler) {
      throw new Error("Delete handler not found");
    }

    const outputPath = path.join(outputsDir, "job-route-delete-1");
    const logPath = path.join(logsDir, "job-route-delete-1.log");

    fs.mkdirSync(path.join(outputPath, "timelapse", "cam-01"), { recursive: true });
    fs.writeFileSync(path.join(outputPath, "timelapse", "cam-01", "0001.png"), "frame");
    fs.writeFileSync(path.join(outputPath, "model.ply"), "ply");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(logPath, "first line\nsecond line\n");

    repo.createJob({
      id: "job-route-delete-1",
      datasetId: null,
      status: "completed",
      outputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: new Date().toISOString(),
      pid: null,
      exitCode: 0,
      errorMessage: null,
      stopReason: null
    });

    expect(jobService.getLogLines("job-route-delete-1")).toEqual(["first line", "second line"]);

    const response = makeResponse();
    await handler({ params: { id: "job-route-delete-1" } } as any, response as any, vi.fn());

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ success: true, deletedOutput: true, deletedLog: true });
    expect(repo.getJob("job-route-delete-1")).toBeNull();
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(logPath)).toBe(false);
    expect(jobService.getLogLines("job-route-delete-1")).toEqual([]);
  });
});

describe("jobs timelapse frame route", () => {
  it("reloads a Modal Volume and retries a frame that is not in the web container snapshot yet", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-jobs-route-timelapse-"));
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");
    process.env.DATA_ROOT = root;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    const { jobsRouter } = await import("../src/routes/jobs.js");
    const { repo } = await import("../src/db.js");
    const { jobService } = await import("../src/services/jobService.js");

    const layer = jobsRouter.stack.find((entry) => {
      const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      return route?.path === "/:id/timelapse/frame" && route.methods?.get;
    });
    const handler = layer?.route?.stack?.[0]?.handle;
    if (!handler) throw new Error("Timelapse frame handler not found");

    const outputPath = path.join(outputsDir, "job-timelapse-1");
    const framePath = path.join(outputPath, "timelapse", "cam-01", "0001.png");
    repo.createJob({
      id: "job-timelapse-1",
      datasetId: null,
      status: "running",
      outputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      pid: null,
      exitCode: null,
      errorMessage: null,
      stopReason: null,
      executor: "modal"
    });

    const reload = vi
      .spyOn(jobService, "reloadRemoteVolume")
      .mockRejectedValueOnce(new Error("volume busy"))
      .mockImplementationOnce(async () => {
        fs.mkdirSync(path.dirname(framePath), { recursive: true });
        fs.writeFileSync(framePath, "frame");
      });

    const response = makeResponse();
    await handler(
      { params: { id: "job-timelapse-1" }, query: { path: framePath } } as any,
      response as any,
      vi.fn()
    );

    expect(reload).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(response.filePath).toBe(framePath);
  });
});

describe("jobs splat route", () => {
  it("reports the newest HTML splat viewer snapshot", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-jobs-route-splat-"));
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");

    process.env.DATA_ROOT = root;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    const { jobsRouter } = await import("../src/routes/jobs.js");
    const { repo } = await import("../src/db.js");

    const layer = jobsRouter.stack.find((entry) => {
      const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      return route?.path === "/:id/splat/latest" && route.methods?.get;
    });
    const handler = layer?.route?.stack?.[0]?.handle;

    if (!handler) {
      throw new Error("Splat latest handler not found");
    }

    const outputPath = path.join(outputsDir, "job-splat-1");
    fs.mkdirSync(outputPath, { recursive: true });
    const viewerPath = path.join(outputPath, "viewer.html");
    fs.writeFileSync(viewerPath, "<!doctype html><title>splat</title>");

    repo.createJob({
      id: "job-splat-1",
      datasetId: null,
      status: "completed",
      outputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: new Date().toISOString(),
      pid: null,
      exitCode: 0,
      errorMessage: null,
      stopReason: null
    });

    const response = makeResponse();
    await handler({ params: { id: "job-splat-1" } } as any, response as any, vi.fn());

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      available: true,
      status: "ready",
      viewerUrl: expect.stringContaining("/api/jobs/job-splat-1/splat/viewer"),
      source: {
        type: "html",
        filename: "viewer.html",
        iteration: null
      }
    });
  });

  it("downloads SOG by default and supports explicit PLY downloads", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-jobs-route-model-format-"));
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");

    process.env.DATA_ROOT = root;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    const { jobsRouter } = await import("../src/routes/jobs.js");
    const { repo } = await import("../src/db.js");

    const layer = jobsRouter.stack.find((entry) => {
      const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      return route?.path === "/:id/model/download" && route.methods?.get;
    });
    const handler = layer?.route?.stack?.[0]?.handle;

    if (!handler) {
      throw new Error("Model download handler not found");
    }

    const outputPath = path.join(outputsDir, "job-format-1");
    fs.mkdirSync(outputPath, { recursive: true });
    const sogPath = path.join(outputPath, "splat_1000.sog");
    fs.writeFileSync(sogPath, "sog");

    repo.createJob({
      id: "job-format-1",
      datasetId: null,
      status: "completed",
      outputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: new Date().toISOString(),
      pid: null,
      exitCode: 0,
      errorMessage: null,
      stopReason: null
    });

    const defaultResponse = makeResponse();
    await handler({ params: { id: "job-format-1" }, query: {} } as any, defaultResponse as any, vi.fn());

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.filePath).toBe(sogPath);
    expect(defaultResponse.headers["Content-Disposition"]).toBe('attachment; filename="splat_1000.sog"');

    const plyOutputPath = path.join(outputsDir, "job-format-2");
    fs.mkdirSync(plyOutputPath, { recursive: true });
    const plyPath = path.join(plyOutputPath, "splat_1000.ply");
    fs.writeFileSync(plyPath, "ply");

    repo.createJob({
      id: "job-format-2",
      datasetId: null,
      status: "completed",
      outputPath: plyOutputPath,
      argsJson: "[]",
      paramsJson: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: new Date().toISOString(),
      pid: null,
      exitCode: 0,
      errorMessage: null,
      stopReason: null
    });

    const plyResponse = makeResponse();
    await handler({ params: { id: "job-format-2" }, query: { format: "ply" } } as any, plyResponse as any, vi.fn());

    expect(plyResponse.statusCode).toBe(200);
    expect(plyResponse.filePath).toBe(plyPath);
    expect(plyResponse.headers["Content-Disposition"]).toBe('attachment; filename="splat_1000.ply"');
  });
});
