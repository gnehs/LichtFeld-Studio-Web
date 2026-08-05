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

function configureModalEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-modal-callback-"));
  process.env.DATA_ROOT = root;
  process.env.DATASETS_DIR = path.join(root, "datasets");
  process.env.OUTPUTS_DIR = path.join(root, "outputs");
  process.env.LOGS_DIR = path.join(root, "logs");
  process.env.DB_PATH = path.join(root, "db", "app.db");
  process.env.DATASET_ALLOWED_ROOTS = path.join(root, "datasets");
  process.env.LFS_BIN_PATH = "/opt/lichtfeld/bin/LichtFeld-Studio";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ADMIN_PASSWORD_HASH = "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW";
  process.env.TRAINING_EXECUTOR = "modal";
  process.env.PUBLIC_BASE_URL = "https://control.example.test";
  process.env.MODAL_CONTROL_URL = "https://modal-control.example.test";
  process.env.MODAL_CONTROL_TOKEN = "control-token";
  process.env.MODAL_CALLBACK_TOKEN = "callback-token";
  return root;
}

async function loadCallbackHandler() {
  const { modalInternalRouter } = await import("../src/routes/modalInternal.js");
  const layer = modalInternalRouter.stack.find((entry) => {
    const route = entry.route as { path?: string; methods?: Record<string, boolean> } | undefined;
    return route?.path === "/jobs/:id/events" && route.methods?.post;
  });
  const handler = layer?.route?.stack?.[0]?.handle;
  if (!handler) throw new Error("Modal callback handler not found");
  return handler as (req: any, res: MockResponse, next: (error?: unknown) => void) => Promise<unknown>;
}

function callbackRequest(body: unknown, authorization = "Bearer callback-token") {
  return {
    params: { id: "job-modal-callback" },
    body,
    header(name: string) {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    }
  };
}

function createJobRecord(outputsDir: string) {
  return {
    id: "job-modal-callback",
    datasetId: null,
    status: "queued" as const,
    outputPath: path.join(outputsDir, "job-modal-callback"),
    argsJson: "[]",
    paramsJson: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    errorMessage: null,
    stopReason: null,
    executor: "modal" as const,
    remoteCallId: "fc-callback"
  };
}

describe("Modal callback route", () => {
  it("rejects an invalid callback token", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();

    try {
      const handler = await loadCallbackHandler();
      const response = makeResponse();
      await handler(
        callbackRequest({ type: "log", data: { lines: ["ignored"] } }, "Bearer wrong-token"),
        response,
        vi.fn()
      );
      expect(response.statusCode).toBe(401);
    } finally {
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("updates status and persists log callback events", async () => {
    vi.resetModules();
    const originalEnv = process.env;
    const root = configureModalEnv();

    try {
      const { repo } = await import("../src/db.js");
      const { jobService } = await import("../src/services/jobService.js");
      const handler = await loadCallbackHandler();
      const outputsDir = path.join(root, "outputs");
      repo.createJob(createJobRecord(outputsDir));

      const statusResponse = makeResponse();
      await handler(
        callbackRequest({
          type: "job.status",
          ts: new Date().toISOString(),
          data: { status: "running", callId: "fc-callback", startedAt: "2026-08-05T00:00:00.000Z" }
        }),
        statusResponse,
        vi.fn()
      );
      expect(statusResponse.statusCode).toBe(200);
      expect(repo.getJob("job-modal-callback")).toMatchObject({ status: "running", remoteCallId: "fc-callback" });

      const logResponse = makeResponse();
      await handler(
        callbackRequest({
          type: "log",
          ts: new Date().toISOString(),
          data: { stream: "stdout", lines: ["remote line 1", "remote line 2"] }
        }),
        logResponse,
        vi.fn()
      );
      expect(logResponse.statusCode).toBe(200);
      expect(jobService.getLogLines("job-modal-callback")).toEqual(["remote line 1", "remote line 2"]);
      expect(fs.readFileSync(path.join(root, "logs", "job-modal-callback.log"), "utf-8")).toBe(
        "remote line 1\nremote line 2\n"
      );
    } finally {
      process.env = originalEnv;
      fs.rmSync(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
