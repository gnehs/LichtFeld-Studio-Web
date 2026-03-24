import path from "node:path";
import fs from "node:fs";

const dataRoot = process.env.DATA_ROOT ?? "/data";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

const datasetsDir = ensureDir(required("DATASETS_DIR", path.join(dataRoot, "datasets")));
const outputsDir = ensureDir(required("OUTPUTS_DIR", path.join(dataRoot, "outputs")));
const logsDir = ensureDir(required("LOGS_DIR", path.join(dataRoot, "logs")));
const dbPath = required("DB_PATH", path.join(dataRoot, "db", "app.db"));
ensureDir(path.dirname(dbPath));

const allowedRootsRaw = process.env.DATASET_ALLOWED_ROOTS ?? datasetsDir;

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  sessionSecret: required("SESSION_SECRET", "dev-session-secret"),
  adminPasswordHash: required("ADMIN_PASSWORD_HASH", "$2a$10$8QfQh49Fzi6zpbW6A2fBXeJvlaQt1zArQXd1LSeXfhBF3nf6/DrxW"),
  lfsBinPath: required("LFS_BIN_PATH", "LichtFeld-Studio"),
  lfsDefaultLogLevel: process.env.LFS_DEFAULT_LOG_LEVEL ?? "info",
  timelapseMinFreeGb: Number(process.env.TIMELAPSE_MIN_FREE_GB ?? 5),
  diskGuardIntervalMs: Number(process.env.DISK_GUARD_INTERVAL_MS ?? 15000),
  datasetsDir,
  outputsDir,
  logsDir,
  dbPath,
  allowedDatasetRoots: allowedRootsRaw.split(",").map((s) => path.resolve(s.trim())).filter(Boolean)
};
