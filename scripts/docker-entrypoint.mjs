import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const dataRoot = process.env.DATA_ROOT || "/data";
const datasetsDir = process.env.DATASETS_DIR || path.join(dataRoot, "datasets");
const outputsDir = process.env.OUTPUTS_DIR || path.join(dataRoot, "outputs");
const logsDir = process.env.LOGS_DIR || path.join(dataRoot, "logs");
const dbPath = process.env.DB_PATH || path.join(dataRoot, "db", "app.db");

for (const dirPath of [dataRoot, datasetsDir, outputsDir, logsDir, path.dirname(dbPath)]) {
  ensureDir(dirPath);
}

const child = spawn("node", ["backend/dist/index.js"], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
