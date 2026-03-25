import fs from "node:fs";
import path from "node:path";
import type { TimelapseConfig } from "../types/models.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const DEFAULT_TIMELAPSE_EVERY = 100;
const DEFAULT_TIMELAPSE_IMAGE_COUNT = 2;

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

function sanitizeImageNames(images: string[] | undefined): string[] {
  if (!images || images.length === 0) {
    return [];
  }
  return images.map((image) => image.trim()).filter(Boolean);
}

export function pickTimelapseImagesFromDataset(dataPath: string | undefined, count = DEFAULT_TIMELAPSE_IMAGE_COUNT): string[] {
  if (!dataPath) {
    return [];
  }

  const imagesDir = path.join(dataPath, "images");
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    return [];
  }

  const names = fs
    .readdirSync(imagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return names.slice(0, Math.max(1, count));
}

export function buildAutoTimelapse(params: {
  dataPath?: string;
  every?: number;
  existingImages?: string[];
  imageCount?: number;
}): TimelapseConfig | undefined {
  const imageCount = toPositiveInt(params.imageCount, DEFAULT_TIMELAPSE_IMAGE_COUNT);
  const autoImages = pickTimelapseImagesFromDataset(params.dataPath, imageCount);
  const fallbackImages = sanitizeImageNames(params.existingImages);
  const images = autoImages.length > 0 ? autoImages : fallbackImages;

  if (images.length === 0) {
    return undefined;
  }

  return {
    images,
    every: toPositiveInt(params.every, DEFAULT_TIMELAPSE_EVERY)
  };
}
