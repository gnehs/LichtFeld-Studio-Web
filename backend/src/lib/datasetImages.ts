import fs from "node:fs";
import path from "node:path";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

const MAX_COLMAP_IMAGE_NAME_BYTES = 4096;

function toDatasetImageName(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function uniqueSortedImageNames(names: string[]): string[] {
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function normalizeColmapImageName(name: string): string {
  return name.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function resolveColmapImagePath(datasetPath: string, imageName: string): string | null {
  const normalized = normalizeColmapImageName(imageName);
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    return null;
  }

  const candidates = [
    path.join(datasetPath, normalized),
    path.join(datasetPath, "images", normalized)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function collectDatasetImageRelativePaths(imagesDir: string, currentDir: string, results: string[]) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectDatasetImageRelativePaths(imagesDir, entryPath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    results.push(toDatasetImageName(path.relative(imagesDir, entryPath)));
  }
}

export function listDatasetImageRelativePaths(imagesDir: string): string[] {
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    return [];
  }

  const results: string[] = [];
  collectDatasetImageRelativePaths(imagesDir, imagesDir, results);
  return uniqueSortedImageNames(results);
}

export function pickDatasetPreviewImageRelativePath(imagesDir: string): string | null {
  return listDatasetImageRelativePaths(imagesDir)[0] ?? null;
}

function listColmapSparseDirs(datasetPath: string): string[] {
  const sparseDir = path.join(datasetPath, "sparse");
  if (!fs.existsSync(sparseDir) || !fs.statSync(sparseDir).isDirectory()) {
    return [];
  }

  const dirs = [sparseDir];
  for (const entry of fs.readdirSync(sparseDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      dirs.push(path.join(sparseDir, entry.name));
    }
  }
  return dirs;
}

function readColmapImagesTxt(filePath: string): string[] {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const names: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const fields = trimmed.split(/\s+/);
    if (fields.length < 10) {
      continue;
    }

    const imageName = normalizeColmapImageName(fields.slice(9).join(" "));
    if (isImageName(imageName)) {
      names.push(imageName);
    }
  }

  return names;
}

function readNullTerminatedString(buffer: Buffer, offset: number): { value: string; nextOffset: number } | null {
  const end = buffer.indexOf(0, offset);
  if (end === -1 || end - offset > MAX_COLMAP_IMAGE_NAME_BYTES) {
    return null;
  }

  return {
    value: buffer.toString("utf8", offset, end),
    nextOffset: end + 1
  };
}

function readColmapImagesBin(filePath: string): string[] {
  const buffer = fs.readFileSync(filePath);
  const names: string[] = [];
  let offset = 0;

  if (buffer.length < 8) {
    return [];
  }

  const imageCount = Number(buffer.readBigUInt64LE(offset));
  offset += 8;

  for (let index = 0; index < imageCount; index += 1) {
    const fixedBytes = 4 + 8 * 4 + 8 * 3 + 4;
    if (offset + fixedBytes > buffer.length) {
      return [];
    }

    offset += fixedBytes;
    const imageName = readNullTerminatedString(buffer, offset);
    if (!imageName) {
      return [];
    }
    offset = imageName.nextOffset;

    if (isImageName(imageName.value)) {
      names.push(normalizeColmapImageName(imageName.value));
    }

    if (offset + 8 > buffer.length) {
      return [];
    }
    const pointCount = Number(buffer.readBigUInt64LE(offset));
    offset += 8;

    const pointsBytes = pointCount * (8 + 8 + 8);
    if (!Number.isSafeInteger(pointsBytes) || offset + pointsBytes > buffer.length) {
      return [];
    }
    offset += pointsBytes;
  }

  return names;
}

export function listColmapDatasetImageNames(datasetPath: string): string[] {
  const names: string[] = [];

  for (const sparseDir of listColmapSparseDirs(datasetPath)) {
    const binPath = path.join(sparseDir, "images.bin");
    if (fs.existsSync(binPath) && fs.statSync(binPath).isFile()) {
      names.push(...readColmapImagesBin(binPath));
    }

    const textPath = path.join(sparseDir, "images.txt");
    if (fs.existsSync(textPath) && fs.statSync(textPath).isFile()) {
      names.push(...readColmapImagesTxt(textPath));
    }
  }

  return uniqueSortedImageNames(
    names.filter((name) => resolveColmapImagePath(datasetPath, name) !== null)
  );
}
