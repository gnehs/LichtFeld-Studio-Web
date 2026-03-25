import fs from "node:fs";
import path from "node:path";

export const UPLOAD_IN_PROGRESS_MARKER = ".lfs-uploading";
export const DATASET_STABLE_WINDOW_MS = 15000;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
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

function countDatasetImages(datasetPath: string): number {
  const imagesDir = path.join(datasetPath, "images");
  const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).length;
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

  const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const imagePath = path.join(imagesDir, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".png") continue;
    try {
      if (pngHasAlpha(imagePath)) {
        return true;
      }
    } catch {
      // Ignore unreadable image metadata and keep scanning.
    }
  }
  return false;
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
): { status: DatasetFolderHealth; reason: string | null; imageCount: number | null; hasMasks: boolean; hasAlphaImages: boolean } {
  const hasMasks = detectSupportedMaskFolder(datasetPath);
  const hasAlphaImages = detectAlphaImages(datasetPath);
  const markerPath = path.join(datasetPath, UPLOAD_IN_PROGRESS_MARKER);
  if (fs.existsSync(markerPath)) {
    return { status: "uploading", reason: "upload in progress marker exists", imageCount: null, hasMasks, hasAlphaImages };
  }

  const structure = validateDatasetStructure(datasetPath);
  if (!structure.valid) {
    return { status: "invalid", reason: structure.reason ?? "invalid structure", imageCount: null, hasMasks, hasAlphaImages };
  }

  const nowMs = options.nowMs ?? Date.now();
  const stableWindowMs = options.stableWindowMs ?? DATASET_STABLE_WINDOW_MS;
  const latestWriteMs = getLatestDatasetWriteMs(datasetPath);
  if (!latestWriteMs || nowMs - latestWriteMs < stableWindowMs) {
    return { status: "stabilizing", reason: "dataset is still being written", imageCount: countDatasetImages(datasetPath), hasMasks, hasAlphaImages };
  }

  return { status: "ready", reason: null, imageCount: countDatasetImages(datasetPath), hasMasks, hasAlphaImages };
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
