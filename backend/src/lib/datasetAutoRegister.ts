import fs from "node:fs";
import path from "node:path";

export const UPLOAD_IN_PROGRESS_MARKER = ".lfs-uploading";
export const DATASET_STABLE_WINDOW_MS = 15000;

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

export function evaluateDatasetForAutoRegister(
  datasetPath: string,
  options: { nowMs?: number; stableWindowMs?: number } = {}
): { ok: true } | { ok: false; reason: string } {
  const markerPath = path.join(datasetPath, UPLOAD_IN_PROGRESS_MARKER);
  if (fs.existsSync(markerPath)) {
    return { ok: false, reason: "upload in progress marker exists" };
  }

  const structure = validateDatasetStructure(datasetPath);
  if (!structure.valid) {
    return { ok: false, reason: structure.reason ?? "invalid structure" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const stableWindowMs = options.stableWindowMs ?? DATASET_STABLE_WINDOW_MS;
  const latestWriteMs = getLatestDatasetWriteMs(datasetPath);
  if (!latestWriteMs || nowMs - latestWriteMs < stableWindowMs) {
    return { ok: false, reason: "dataset is still being written" };
  }

  return { ok: true };
}
