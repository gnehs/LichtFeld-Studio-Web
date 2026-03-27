import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestEnv = {
  restore: () => void;
};

function setupTestEnv(): TestEnv {
  const originalEnv = process.env;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lfs-dataset-tus-"));
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
    restore: () => {
      process.env = originalEnv;
      vi.resetModules();
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

function buildTusMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");
}

function createValidDatasetZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("images/0001.jpg", Buffer.from("image"));
  zip.addFile("sparse/points3D.txt", Buffer.from("sparse"));
  return zip.toBuffer();
}

afterEach(() => {
  vi.resetModules();
});

describe("dataset tus upload route", () => {
  it("creates, resumes, and finalizes a tus zip upload", async () => {
    const env = setupTestEnv();
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash("secret-pass", 4);

    let server: import("node:http").Server | null = null;

    try {
      const started = await startServer();
      server = started.server;
      const { baseUrl } = started;

      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ password: "secret-pass" })
      });

      expect(loginResponse.status).toBe(200);
      const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("lfs.sid=");

      const zipBuffer = createValidDatasetZip();
      const half = Math.floor(zipBuffer.length / 2);

      const createResponse = await fetch(`${baseUrl}/api/datasets/upload/tus`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(zipBuffer.length),
          "Upload-Metadata": buildTusMetadata({
            filename: "garden.zip",
            datasetName: "garden-v2"
          })
        }
      });

      expect(createResponse.status).toBe(201);
      const uploadPath = createResponse.headers.get("location");
      expect(uploadPath).toBeTruthy();
      expect(createResponse.headers.get("upload-offset")).toBe("0");

      const firstPatch = await fetch(`${baseUrl}${uploadPath}`, {
        method: "PATCH",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": "0",
          "Content-Type": "application/offset+octet-stream"
        },
        body: new Uint8Array(zipBuffer.subarray(0, half))
      });

      expect(firstPatch.status).toBe(204);
      expect(firstPatch.headers.get("upload-offset")).toBe(String(half));

      const headResponse = await fetch(`${baseUrl}${uploadPath}`, {
        method: "HEAD",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0"
        }
      });

      expect(headResponse.status).toBe(200);
      expect(headResponse.headers.get("upload-offset")).toBe(String(half));
      expect(headResponse.headers.get("upload-length")).toBe(String(zipBuffer.length));

      const secondPatch = await fetch(`${baseUrl}${uploadPath}`, {
        method: "PATCH",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": String(half),
          "Content-Type": "application/offset+octet-stream"
        },
        body: new Uint8Array(zipBuffer.subarray(half))
      });

      expect(secondPatch.status).toBe(204);
      expect(secondPatch.headers.get("upload-offset")).toBe(String(zipBuffer.length));

      const completeResponse = await fetch(`${baseUrl}${uploadPath}/complete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(completeResponse.status).toBe(200);
      const body = (await completeResponse.json()) as {
        item: {
          id: string;
          name: string;
          path: string;
        };
      };
      expect(body.item.name).toBe("garden-v2");
      expect(path.basename(body.item.path)).toBe("garden-v2");
      expect(fs.existsSync(path.join(body.item.path, "images"))).toBe(true);
      expect(fs.existsSync(path.join(body.item.path, "sparse"))).toBe(true);

      const repeatComplete = await fetch(`${baseUrl}${uploadPath}/complete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(repeatComplete.status).toBe(200);
      expect(await repeatComplete.json()).toEqual(body);
    } finally {
      if (server) {
        await stopServer(server);
      }
      env.restore();
    }
  });

  it("expires tus temp uploads after 24 hours and removes stale files", async () => {
    const env = setupTestEnv();
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash("secret-pass", 4);

    let server: import("node:http").Server | null = null;

    try {
      const started = await startServer();
      server = started.server;
      const { baseUrl } = started;

      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ password: "secret-pass" })
      });

      const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("lfs.sid=");

      const createResponse = await fetch(`${baseUrl}/api/datasets/upload/tus`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": "10",
          "Upload-Metadata": buildTusMetadata({
            filename: "stale.zip",
            datasetName: "stale-dataset"
          })
        }
      });

      expect(createResponse.status).toBe(201);
      const uploadPath = createResponse.headers.get("location");
      expect(uploadPath).toBeTruthy();
      const uploadId = uploadPath?.split("/").pop();
      expect(uploadId).toBeTruthy();

      const tusDir = path.join(process.env.DATASETS_DIR ?? "", "_uploads", "tus");
      const recordPath = path.join(tusDir, `${uploadId}.json`);
      const zipPath = path.join(tusDir, `${uploadId}.zip`);
      const record = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as Record<string, unknown>;
      const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      fs.writeFileSync(
        recordPath,
        JSON.stringify(
          {
            ...record,
            createdAt: expiredAt,
            lastActivityAt: expiredAt
          },
          null,
          2
        )
      );

      const headResponse = await fetch(`${baseUrl}${uploadPath}`, {
        method: "HEAD",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0"
        }
      });

      expect(headResponse.status).toBe(404);
      expect(fs.existsSync(recordPath)).toBe(false);
      expect(fs.existsSync(zipPath)).toBe(false);
    } finally {
      if (server) {
        await stopServer(server);
      }
      env.restore();
    }
  });

  it("uses the zip filename as the default dataset folder name when metadata omits datasetName", async () => {
    const env = setupTestEnv();
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash("secret-pass", 4);

    let server: import("node:http").Server | null = null;

    try {
      const started = await startServer();
      server = started.server;
      const { baseUrl } = started;

      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ password: "secret-pass" })
      });

      const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("lfs.sid=");

      const zipBuffer = createValidDatasetZip();

      const createResponse = await fetch(`${baseUrl}/api/datasets/upload/tus`, {
        method: "POST",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(zipBuffer.length),
          "Upload-Metadata": buildTusMetadata({
            filename: "garden-default.zip"
          })
        }
      });

      expect(createResponse.status).toBe(201);
      const uploadPath = createResponse.headers.get("location");
      expect(uploadPath).toBeTruthy();

      const patchResponse = await fetch(`${baseUrl}${uploadPath}`, {
        method: "PATCH",
        headers: {
          cookie: cookie ?? "",
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": "0",
          "Content-Type": "application/offset+octet-stream"
        },
        body: new Uint8Array(zipBuffer)
      });

      expect(patchResponse.status).toBe(204);

      const completeResponse = await fetch(`${baseUrl}${uploadPath}/complete`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(completeResponse.status).toBe(200);
      const body = (await completeResponse.json()) as {
        item: {
          name: string;
          path: string;
        };
      };

      expect(body.item.name).toBe("garden-default");
      expect(path.basename(body.item.path)).toBe("garden-default");
    } finally {
      if (server) {
        await stopServer(server);
      }
      env.restore();
    }
  });
});
