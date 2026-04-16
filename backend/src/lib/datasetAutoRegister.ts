import fs from "node:fs";
import path from "node:path";
import { listDatasetImageRelativePaths, pickDatasetPreviewImageRelativePath } from "./datasetImages.js";

export const UPLOAD_IN_PROGRESS_MARKER = ".lfs-uploading";
export const DATASET_STABLE_WINDOW_MS = 15000;
const UPSTREAM_MASK_FOLDERS = ["masks", "mask", "segmentation", "dynamic_masks"] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

export function countDatasetImages(datasetPath: string): number {
  const imagesDir = path.join(datasetPath, "images");
  return listDatasetImageRelativePaths(imagesDir).length;
}

export function countDatasetMasks(datasetPath: string): number {
  for (const folderName of UPSTREAM_MASK_FOLDERS) {
    const masksDir = path.join(datasetPath, folderName);
    if (fs.existsSync(masksDir) && fs.statSync(masksDir).isDirectory()) {
      return listDatasetImageRelativePaths(masksDir).length;
    }
  }
  return 0;
}

export function getDatasetDirMtimes(datasetPath: string): { imagesDirMtime: number; masksDirMtime: number; folderMtime: number } {
  const imagesDir = path.join(datasetPath, "images");
  let imagesDirMtime = 0;
  let masksDirMtime = 0;
  let folderMtime = 0;
  try { imagesDirMtime = fs.statSync(imagesDir).mtimeMs; } catch { /* missing */ }
  try { folderMtime = fs.statSync(datasetPath).mtimeMs; } catch { /* missing */ }
  for (const folderName of UPSTREAM_MASK_FOLDERS) {
    const masksDir = path.join(datasetPath, folderName);
    try {
      const mtime = fs.statSync(masksDir).mtimeMs;
      if (mtime > 0) { masksDirMtime = mtime; break; }
    } catch { /* missing */ }
  }
  return { imagesDirMtime, masksDirMtime, folderMtime };
}

function pngHasAlpha(filePath: string): boolean {
  const file = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(33);
    const bytesRead = fs.readSync(file, header, 0, header.length, 0);
    if (bytesRead < header.length) {
      return false;
    }
    if (!header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return false;
    }

    const colorType = header[25];
    if (colorType === 4 || colorType === 6) {
      return true;
    }

    if (colorType !== 0 && colorType !== 2 && colorType !== 3) {
      return false;
    }

    const stat = fs.fstatSync(file);
    let offset = 33;
    while (offset + 8 <= stat.size) {
      const chunkHeader = Buffer.alloc(8);
      const chunkHeaderBytes = fs.readSync(file, chunkHeader, 0, chunkHeader.length, offset);
      if (chunkHeaderBytes < chunkHeader.length) {
        return false;
      }

      const chunkLength = chunkHeader.readUInt32BE(0);
      const chunkType = chunkHeader.toString("ascii", 4, 8);
      if (chunkType === "tRNS") {
        return true;
      }
      offset += 8 + chunkLength + 4;
      if (chunkType === "IDAT" || chunkType === "IEND") {
        break;
      }
    }
    return false;
  } finally {
    fs.closeSync(file);
  }
}

function detectAlphaImages(datasetPath: string): boolean {
  const imagesDir = path.join(datasetPath, "images");
  if (!fs.existsSync(imagesDir)) {
    return false;
  }

  // Only check the first PNG image to avoid scanning all files on every request.
  const imagePaths = listDatasetImageRelativePaths(imagesDir);
  const firstPng = imagePaths.find((p) => path.extname(p).toLowerCase() === ".png");
  if (!firstPng) {
    return false;
  }
  try {
    return pngHasAlpha(path.join(imagesDir, firstPng));
  } catch {
    return false;
  }
}

function detectSupportedMaskFolder(datasetPath: string): boolean {
  return UPSTREAM_MASK_FOLDERS.some((folderName) => {
    const target = path.join(datasetPath, folderName);
    try {
      return fs.statSync(target).isDirectory();
    } catch {
      return false;
    }
  });
}

export function inspectDatasetFolder(
  datasetPath: string,
  options: { nowMs?: number; stableWindowMs?: number } = {}
): {
  status: DatasetFolderHealth;
  reason: string | null;
  imageCount: number | null;
  hasMasks: boolean;
  hasAlphaImages: boolean;
  previewImageRelativePath: string | null;
} {
  const previewImageRelativePath = pickDatasetPreviewImageRelativePath(path.join(datasetPath, "images"));
  const hasMasks = detectSupportedMaskFolder(datasetPath);
  const hasAlphaImages = detectAlphaImages(datasetPath);
  const markerPath = path.join(datasetPath, UPLOAD_IN_PROGRESS_MARKER);
  if (fs.existsSync(markerPath)) {
    return { status: "uploading", reason: "upload in progress marker exists", imageCount: null, hasMasks, hasAlphaImages, previewImageRelativePath };
  }

  const structure = validateDatasetStructure(datasetPath);
  if (!structure.valid) {
    return { status: "invalid", reason: structure.reason ?? "invalid structure", imageCount: null, hasMasks, hasAlphaImages, previewImageRelativePath };
  }

  const nowMs = options.nowMs ?? Date.now();
  const stableWindowMs = options.stableWindowMs ?? DATASET_STABLE_WINDOW_MS;
  const latestWriteMs = getLatestDatasetWriteMs(datasetPath);
  if (!latestWriteMs || nowMs - latestWriteMs < stableWindowMs) {
    return { status: "stabilizing", reason: "dataset is still being written", imageCount: countDatasetImages(datasetPath), hasMasks, hasAlphaImages, previewImageRelativePath };
  }

  return { status: "ready", reason: null, imageCount: countDatasetImages(datasetPath), hasMasks, hasAlphaImages, previewImageRelativePath };
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
