import fs from "node:fs";
import path from "node:path";
import type { TimelapseConfig } from "../types/models.js";
import { listColmapDatasetImageNames, listDatasetImageRelativePaths } from "./datasetImages.js";

const DEFAULT_TIMELAPSE_EVERY = 100;
const DEFAULT_TIMELAPSE_IMAGE_COUNT = 2;
type RandomSource = () => number;

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

function randomUnit(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 0.999999999));
}

export function pickSpreadImageNames(names: string[], count: number, random: RandomSource = Math.random): string[] {
  if (names.length === 0) {
    return [];
  }

  const targetCount = Math.min(names.length, Math.max(1, Math.round(count)));
  if (targetCount >= names.length) {
    return [...names];
  }

  const step = names.length / targetCount;
  const rotation = Math.floor(randomUnit(random) * names.length);
  const phase = randomUnit(random);
  const indexes = new Set<number>();

  for (let slot = 0; slot < targetCount; slot += 1) {
    const index = (rotation + Math.floor((slot + phase) * step)) % names.length;
    indexes.add(index);
  }

  if (indexes.size < targetCount) {
    for (let index = 0; indexes.size < targetCount && index < names.length; index += 1) {
      indexes.add((rotation + index) % names.length);
    }
  }

  return Array.from(indexes, (index) => names[index]);
}

export function pickTimelapseImagesFromDataset(
  dataPath: string | undefined,
  count = DEFAULT_TIMELAPSE_IMAGE_COUNT,
  random: RandomSource = Math.random
): string[] {
  if (!dataPath) {
    return [];
  }

  const imagesDir = path.join(dataPath, "images");
  if (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory()) {
    return [];
  }

  const names = listColmapDatasetImageNames(dataPath);
  if (names.length > 0) {
    return pickSpreadImageNames(names, count, random);
  }

  return pickSpreadImageNames(listDatasetImageRelativePaths(imagesDir), count, random);
}

export function buildAutoTimelapse(params: {
  dataPath?: string;
  every?: number;
  existingImages?: string[];
  imageCount?: number;
  random?: RandomSource;
}): TimelapseConfig | undefined {
  const imageCount = toPositiveInt(params.imageCount, DEFAULT_TIMELAPSE_IMAGE_COUNT);
  const autoImages = pickTimelapseImagesFromDataset(params.dataPath, imageCount, params.random);
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
