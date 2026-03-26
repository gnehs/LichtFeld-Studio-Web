import path from "node:path";
import fs from "node:fs";

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(match[2]);
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), "..", ".env"));

function ensureLibraryPath(paths: string[]) {
  const currentEntries = (process.env.LD_LIBRARY_PATH ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const nextEntries = [...paths, ...currentEntries].filter((entry, index, all) => all.indexOf(entry) === index);
  process.env.LD_LIBRARY_PATH = nextEntries.join(":");
}

ensureLibraryPath(["/opt/lichtfeld/lib", "/opt/lichtfeld/lib64", "/opt/lichtfeld/bin"]);

const dataRoot = process.env.DATA_ROOT ?? path.join(process.cwd(), "data");

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
  sessionCleanupIntervalMs: Number(process.env.SESSION_CLEANUP_INTERVAL_MS ?? 1000 * 60 * 60),
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
