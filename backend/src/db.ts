import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { DatasetRecord, JobRecord, JobStatus, TimelapseFrame } from "./types/models.js";

const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      dataset_id TEXT,
      status TEXT NOT NULL,
      output_path TEXT NOT NULL,
      args_json TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      pid INTEGER,
      exit_code INTEGER,
      error_message TEXT,
      stop_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS timelapse_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      camera_name TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, camera_name, iteration)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_timelapse_job_camera ON timelapse_frames(job_id, camera_name, iteration DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);

  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  if (!jobColumns.some((column) => column.name === "params_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN params_json TEXT NOT NULL DEFAULT '{}';");
  }
}

migrate();

function mapDataset(row: any): DatasetRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    path: row.path,
    createdAt: row.created_at
  };
}

function mapJob(row: any): JobRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    status: row.status,
    outputPath: row.output_path,
    argsJson: row.args_json,
    paramsJson: row.params_json ?? "{}",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    pid: row.pid,
    exitCode: row.exit_code,
    errorMessage: row.error_message,
    stopReason: row.stop_reason
  };
}

function mapFrame(row: any): TimelapseFrame {
  return {
    id: row.id,
    jobId: row.job_id,
    cameraName: row.camera_name,
    iteration: row.iteration,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at
  };
}

export const repo = {
  createDataset(dataset: DatasetRecord) {
    db.prepare(
      `INSERT INTO datasets (id, name, type, path, created_at) VALUES (@id, @name, @type, @path, @createdAt)`
    ).run({
      id: dataset.id,
      name: dataset.name,
      type: dataset.type,
      path: dataset.path,
      createdAt: dataset.createdAt
    });
    return dataset;
  },

  listDatasets() {
    return db.prepare("SELECT * FROM datasets ORDER BY created_at DESC").all().map(mapDataset);
  },

  getDataset(id: string) {
    const row = db.prepare("SELECT * FROM datasets WHERE id = ?").get(id);
    return row ? mapDataset(row) : null;
  },

  updateDatasetName(id: string, name: string) {
    db.prepare("UPDATE datasets SET name = ? WHERE id = ?").run(name, id);
    return this.getDataset(id);
  },

  updateDatasetPath(id: string, datasetPath: string) {
    db.prepare("UPDATE datasets SET path = ? WHERE id = ?").run(datasetPath, id);
    return this.getDataset(id);
  },

  listDatasetFileEntries(datasetPath: string) {
    const entries: Array<{ relativePath: string; kind: "image" | "mask"; sizeBytes: number; previewable: boolean }> = [];
    const visit = (root: string, kind: "image" | "mask") => {
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
      const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const nextPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(nextPath);
            continue;
          }
          if (!entry.isFile()) continue;
          entries.push({
            relativePath: path.relative(datasetPath, nextPath).split(path.sep).join("/"),
            kind,
            sizeBytes: fs.statSync(nextPath).size,
            previewable: kind === "image",
          });
        }
      };
      walk(root);
    };
    visit(path.join(datasetPath, "images"), "image");
    visit(path.join(datasetPath, "masks"), "mask");
    return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: "base" }));
  },

  deleteDataset(id: string) {
    db.prepare("DELETE FROM datasets WHERE id = ?").run(id);
  },

  getDatasetByPath(datasetPath: string) {
    const row = db.prepare("SELECT * FROM datasets WHERE path = ?").get(datasetPath);
    return row ? mapDataset(row) : null;
  },

  createJob(job: JobRecord) {
    db.prepare(
      `INSERT INTO jobs (id, dataset_id, status, output_path, args_json, params_json, created_at, updated_at, started_at, finished_at, pid, exit_code, error_message, stop_reason)
       VALUES (@id, @datasetId, @status, @outputPath, @argsJson, @paramsJson, @createdAt, @updatedAt, @startedAt, @finishedAt, @pid, @exitCode, @errorMessage, @stopReason)`
    ).run({
      id: job.id,
      datasetId: job.datasetId,
      status: job.status,
      outputPath: job.outputPath,
      argsJson: job.argsJson,
      paramsJson: job.paramsJson,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      pid: job.pid,
      exitCode: job.exitCode,
      errorMessage: job.errorMessage,
      stopReason: job.stopReason
    });
    return job;
  },

  updateJobStatus(id: string, status: JobStatus, patch: Partial<JobRecord> = {}) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE jobs SET
        status = @status,
        updated_at = @updatedAt,
        started_at = COALESCE(@startedAt, started_at),
        finished_at = COALESCE(@finishedAt, finished_at),
        pid = COALESCE(@pid, pid),
        exit_code = COALESCE(@exitCode, exit_code),
        error_message = COALESCE(@errorMessage, error_message),
        stop_reason = COALESCE(@stopReason, stop_reason)
      WHERE id = @id`
    ).run({
      id,
      status,
      updatedAt: now,
      startedAt: patch.startedAt ?? null,
      finishedAt: patch.finishedAt ?? null,
      pid: patch.pid ?? null,
      exitCode: patch.exitCode ?? null,
      errorMessage: patch.errorMessage ?? null,
      stopReason: patch.stopReason ?? null
    });
    return this.getJob(id);
  },

  getJob(id: string) {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row ? mapJob(row) : null;
  },

  listJobs() {
    return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all().map(mapJob);
  },

  deleteJob(jobId: string) {
    db.prepare("DELETE FROM timelapse_frames WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
  },

  insertTimelapseFrame(frame: Omit<TimelapseFrame, "id">) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO timelapse_frames
      (job_id, camera_name, iteration, file_path, size_bytes, created_at)
      VALUES (@jobId, @cameraName, @iteration, @filePath, @sizeBytes, @createdAt)`
    );
    const result = stmt.run({
      jobId: frame.jobId,
      cameraName: frame.cameraName,
      iteration: frame.iteration,
      filePath: frame.filePath,
      sizeBytes: frame.sizeBytes,
      createdAt: frame.createdAt
    });
    if (result.changes === 0) {
      return null;
    }
    const row = db.prepare("SELECT * FROM timelapse_frames WHERE rowid = ?").get(result.lastInsertRowid);
    return row ? mapFrame(row) : null;
  },

  listTimelapseCameras(jobId: string) {
    return db
      .prepare("SELECT camera_name as cameraName, COUNT(*) as frameCount, MAX(iteration) as lastIteration FROM timelapse_frames WHERE job_id = ? GROUP BY camera_name ORDER BY camera_name ASC")
      .all(jobId);
  },

  listTimelapseFrames(jobId: string, camera: string, cursor?: number, limit = 100) {
    if (cursor) {
      return db
        .prepare(
          "SELECT * FROM timelapse_frames WHERE job_id = ? AND camera_name = ? AND iteration < ? ORDER BY iteration DESC LIMIT ?"
        )
        .all(jobId, camera, cursor, limit)
        .map(mapFrame);
    }

    return db
      .prepare("SELECT * FROM timelapse_frames WHERE job_id = ? AND camera_name = ? ORDER BY iteration DESC LIMIT ?")
      .all(jobId, camera, limit)
      .map(mapFrame);
  },

  getTimelapseLatest(jobId: string) {
    return db
      .prepare(
        `SELECT t.*
         FROM timelapse_frames t
         INNER JOIN (
           SELECT camera_name, MAX(iteration) AS max_iteration
           FROM timelapse_frames
           WHERE job_id = ?
           GROUP BY camera_name
         ) latest
         ON latest.camera_name = t.camera_name AND latest.max_iteration = t.iteration
         WHERE t.job_id = ?
         ORDER BY t.camera_name ASC`
      )
      .all(jobId, jobId)
      .map(mapFrame);
  },

  getSession(sid: string) {
    const row = db.prepare("SELECT data_json, expires_at FROM sessions WHERE sid = ?").get(sid) as
      | { data_json: string; expires_at: string }
      | undefined;

    if (!row) {
      return null;
    }

    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      return null;
    }

    return JSON.parse(row.data_json);
  },

  persistSession(sid: string, dataJson: string, expiresAt: string) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (sid, data_json, expires_at, updated_at)
       VALUES (@sid, @dataJson, @expiresAt, @updatedAt)
       ON CONFLICT(sid) DO UPDATE SET
         data_json = excluded.data_json,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    ).run({
      sid,
      dataJson,
      expiresAt,
      updatedAt: now
    });
  },

  deleteExpiredSessions(expiresBefore: string) {
    const result = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(expiresBefore);
    return result.changes;
  },

  deleteSession(sid: string) {
    db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
  }
};

export const rawDb = db;
