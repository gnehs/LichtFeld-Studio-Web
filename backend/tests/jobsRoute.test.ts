import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function makeResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

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
