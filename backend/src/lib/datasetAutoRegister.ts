import fs from "node:fs";
import path from "node:path";

export const UPLOAD_IN_PROGRESS_MARKER = ".lfs-uploading";
export const DATASET_STABLE_WINDOW_MS = 15000;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

export type DatasetFolderHealth = "ready" | "uploading" | "stabilizing" | "invalid";

export function validateDatasetStructure(datasetPath: string): { valid: boolean; reason?: string } {
  const sparseDir = path.join(datasetPath, "sparse");
  const imagesDir = path.join(datasetPath, "images");
  if (!fs.existsSync(sparseDir)) {
    return { valid: false, reason: "Missing sparse/ directory" };
  }
  if (!fs.existsSync(imagesDir)) {
    return { valid: false, reason: "Missing images/ directory" };
  }
  return { valid: true };
}

function getLatestDatasetWriteMs(datasetPath: string): number {
  const candidates = [datasetPath, path.join(datasetPath, "images"), path.join(datasetPath, "sparse")];
  let latest = 0;
  for (const target of candidates) {
    try {
      const stat = fs.statSync(target);
      latest = Math.max(latest, stat.mtimeMs);
    } catch {
      // Ignore missing paths, structure validation handles completeness checks.
    }
  }
  return latest;
}

function countDatasetImages(datasetPath: string): number {
  const imagesDir = path.join(datasetPath, "images");
  const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).length;
}

export function inspectDatasetFolder(
  datasetPath: string,
  options: { nowMs?: number; stableWindowMs?: number } = {}
): { status: DatasetFolderHealth; reason: string | null; imageCount: number | null } {
  const markerPath = path.join(datasetPath, UPLOAD_IN_PROGRESS_MARKER);
  if (fs.existsSync(markerPath)) {
    return { status: "uploading", reason: "upload in progress marker exists", imageCount: null };
  }

  const structure = validateDatasetStructure(datasetPath);
  if (!structure.valid) {
    return { status: "invalid", reason: structure.reason ?? "invalid structure", imageCount: null };
  }

  const nowMs = options.nowMs ?? Date.now();
  const stableWindowMs = options.stableWindowMs ?? DATASET_STABLE_WINDOW_MS;
  const latestWriteMs = getLatestDatasetWriteMs(datasetPath);
  if (!latestWriteMs || nowMs - latestWriteMs < stableWindowMs) {
    return { status: "stabilizing", reason: "dataset is still being written", imageCount: countDatasetImages(datasetPath) };
  }

  return { status: "ready", reason: null, imageCount: countDatasetImages(datasetPath) };
}

export function evaluateDatasetForAutoRegister(
  datasetPath: string,
  options: { nowMs?: number; stableWindowMs?: number } = {}
): { ok: true } | { ok: false; reason: string } {
  const inspected = inspectDatasetFolder(datasetPath, options);
  if (inspected.status !== "ready") {
    return { ok: false, reason: inspected.reason ?? "dataset is not ready" };
  }

  return { ok: true };
}
