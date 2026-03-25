import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

describe("jobService disk status", () => {
  it("resolves relative target path before checkDiskSpace", async () => {
    vi.resetModules();

    const checkDiskSpaceMock = vi.fn(async () => ({
      diskPath: "/",
      free: 20 * 1024 * 1024 * 1024,
      size: 100 * 1024 * 1024 * 1024
    }));

    vi.doMock("check-disk-space", () => ({
      default: checkDiskSpaceMock
    }));

    const { jobService } = await import("../src/services/jobService.js");
    await jobService.getDiskStatus("data/outputs/job-1");

    expect(checkDiskSpaceMock).toHaveBeenCalledWith(path.resolve("data/outputs/job-1"));
  });

  it("writes spawn errors to the job log file", async () => {
    vi.resetModules();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-job-service-"));
    const datasetsDir = path.join(root, "datasets");
    const outputsDir = path.join(root, "outputs");
    const logsDir = path.join(root, "logs");
    const dbPath = path.join(root, "db", "app.db");
    const datasetPath = path.join(datasetsDir, "garden");
    fs.mkdirSync(path.join(datasetPath, "images"), { recursive: true });
    fs.mkdirSync(path.join(datasetPath, "sparse"), { recursive: true });
    fs.writeFileSync(path.join(datasetPath, "images", "0001.png"), "image");

    process.env.DATA_ROOT = root;
    process.env.DATASETS_DIR = datasetsDir;
    process.env.OUTPUTS_DIR = outputsDir;
    process.env.LOGS_DIR = logsDir;
    process.env.DB_PATH = dbPath;
    process.env.DATASET_ALLOWED_ROOTS = datasetsDir;
    process.env.LFS_BIN_PATH = "/opt/lichtfeld/bin/LichtFeld-Studio";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";

    let childRef: EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      pid: number;
    };

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
          pid: number;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        child.pid = 4321;
        childRef = child;
        return child;
      }),
    }));

    const { jobService } = await import("../src/services/jobService.js");
    const job = jobService.createJob({
      params: {
        dataPath: datasetPath,
      },
    });

    childRef!.emit("error", new Error("libmissing.so not found"));
    childRef!.emit("close", 127);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const logPath = path.join(logsDir, `${job.id}.log`);
    const logContent = fs.readFileSync(logPath, "utf-8");

    expect(logContent).toContain("[spawn-error] libmissing.so not found");
  });
});
