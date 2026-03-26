import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestEnv = {
  root: string;
  dbPath: string;
  restore: () => void;
};

type SessionPayload = {
  cookie: {
    expires: Date;
    originalMaxAge: number;
    httpOnly: boolean;
    path: string;
  };
  authenticated: boolean;
};

function setupTestEnv(): TestEnv {
  const originalEnv = process.env;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-session-store-"));
  const datasetsDir = path.join(root, "datasets");
  const outputsDir = path.join(root, "outputs");
  const logsDir = path.join(root, "logs");
  const dbPath = path.join(root, "db", "app.db");

  process.env = {
    ...originalEnv,
    DATA_ROOT: root,
    DATASETS_DIR: datasetsDir,
    OUTPUTS_DIR: outputsDir,
    LOGS_DIR: logsDir,
    DB_PATH: dbPath,
    DATASET_ALLOWED_ROOTS: datasetsDir,
    LFS_BIN_PATH: "/opt/lichtfeld/bin/LichtFeld-Studio",
    SESSION_SECRET: "test-session-secret"
  };

  return {
    root,
    dbPath,
    restore: () => {
      process.env = originalEnv;
      vi.resetModules();
    }
  };
}

function buildSession(expires: string): SessionPayload {
  return {
    authenticated: true,
    cookie: {
      expires: new Date(expires),
      originalMaxAge: 1000 * 60 * 60,
      httpOnly: true,
      path: "/"
    }
  };
}

async function startServer() {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const nextServer = app.listen(0, "127.0.0.1", () => resolve(nextServer));
  });
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function stopServer(server: import("node:http").Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function setStoreSession(store: any, sid: string, session: SessionPayload) {
  return new Promise<void>((resolve, reject) => {
    store.set(sid, session, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function destroyStoreSession(store: any, sid: string) {
  return new Promise<void>((resolve, reject) => {
    store.destroy(sid, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function touchStoreSession(store: any, sid: string, session: SessionPayload) {
  return new Promise<void>((resolve, reject) => {
    store.touch(sid, session, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

afterEach(() => {
  vi.resetModules();
});

describe("sqlite session store", () => {
  it("keeps login sessions after the app restarts", async () => {
    const env = setupTestEnv();
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash("secret-pass", 4);

    try {
      const first = await startServer();
      const loginResponse = await fetch(`${first.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ password: "secret-pass" })
      });

      expect(loginResponse.status).toBe(200);
      const setCookie = loginResponse.headers.get("set-cookie");
      expect(setCookie).toContain("lfs.sid=");

      await stopServer(first.server);
      vi.resetModules();

      const db = new DatabaseSync(env.dbPath);
      const row = db.prepare("SELECT sid, data_json FROM sessions").get() as
        | { sid: string; data_json: string }
        | undefined;
      expect(row?.sid).toBeTruthy();
      expect(JSON.parse(row?.data_json ?? "{}")).toMatchObject({ authenticated: true });

      const second = await startServer();
      const meResponse = await fetch(`${second.baseUrl}/api/auth/me`, {
        headers: {
          cookie: setCookie!.split(";", 1)[0]
        }
      });

      expect(meResponse.status).toBe(200);
      expect(await meResponse.json()).toEqual({ authenticated: true });

      await stopServer(second.server);
      db.close();
    } finally {
      env.restore();
    }
  });

  it("removes persisted sessions when destroy is called", async () => {
    const env = setupTestEnv();

    try {
      const { createSqliteSessionStore } = await import("../src/lib/sessionStore.js");
      const store = createSqliteSessionStore();
      await setStoreSession(store, "destroy-me", buildSession("2030-01-01T00:00:00.000Z"));

      await destroyStoreSession(store, "destroy-me");

      const db = new DatabaseSync(env.dbPath);
      const row = db.prepare("SELECT sid FROM sessions WHERE sid = ?").get("destroy-me");
      expect(row).toBeUndefined();
      db.close();
    } finally {
      env.restore();
    }
  });

  it("updates the stored expiry when a session is touched", async () => {
    const env = setupTestEnv();

    try {
      const { createSqliteSessionStore } = await import("../src/lib/sessionStore.js");
      const store = createSqliteSessionStore();
      await setStoreSession(store, "touch-me", buildSession("2030-01-01T00:00:00.000Z"));

      await touchStoreSession(store, "touch-me", buildSession("2031-02-03T04:05:06.000Z"));

      const db = new DatabaseSync(env.dbPath);
      const row = db.prepare("SELECT expires_at FROM sessions WHERE sid = ?").get("touch-me") as
        | { expires_at: string }
        | undefined;
      expect(row?.expires_at).toBe("2031-02-03T04:05:06.000Z");
      db.close();
    } finally {
      env.restore();
    }
  });

  it("deletes expired sessions during cleanup", async () => {
    const env = setupTestEnv();

    try {
      const { createSqliteSessionStore, cleanupExpiredSessions } = await import("../src/lib/sessionStore.js");
      const store = createSqliteSessionStore();
      await setStoreSession(store, "expired-session", buildSession("2020-01-01T00:00:00.000Z"));
      await setStoreSession(store, "active-session", buildSession("2035-01-01T00:00:00.000Z"));

      cleanupExpiredSessions("2024-01-01T00:00:00.000Z");

      const db = new DatabaseSync(env.dbPath);
      const remaining = db.prepare("SELECT sid FROM sessions ORDER BY sid ASC").all() as Array<{ sid: string }>;
      expect(remaining).toEqual([{ sid: "active-session" }]);
      db.close();
    } finally {
      env.restore();
    }
  });

  it("runs periodic cleanup on an interval", async () => {
    const env = setupTestEnv();
    vi.useFakeTimers();

    try {
      const { createSqliteSessionStore, startSessionCleanup } = await import("../src/lib/sessionStore.js");
      const store = createSqliteSessionStore();
      await setStoreSession(store, "expired-session", buildSession("2020-01-01T00:00:00.000Z"));
      await setStoreSession(store, "active-session", buildSession("2035-01-01T00:00:00.000Z"));

      const cleanup = startSessionCleanup(1000);
      vi.advanceTimersByTime(1000);

      const db = new DatabaseSync(env.dbPath);
      const remaining = db.prepare("SELECT sid FROM sessions ORDER BY sid ASC").all() as Array<{ sid: string }>;
      expect(remaining).toEqual([{ sid: "active-session" }]);
      db.close();
      cleanup.stop();
    } finally {
      vi.useRealTimers();
      env.restore();
    }
  });
});
