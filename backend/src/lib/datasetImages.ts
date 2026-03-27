import fs from "node:fs";
import path from "node:path";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

function toDatasetImageName(filePath: string): string {
  return filePath.split(path.sep).join("/");
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
  return results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function pickDatasetPreviewImageRelativePath(imagesDir: string): string | null {
  return listDatasetImageRelativePaths(imagesDir)[0] ?? null;
}
