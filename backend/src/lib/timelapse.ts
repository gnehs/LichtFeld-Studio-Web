import fs from "node:fs";
import path from "node:path";
import type { TimelapseFrame } from "../types/models.js";

export interface ScannedTimelapse {
  cameraName: string;
  iteration: number;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

export function parseIterationFromFilename(filePath: string): number | null {
  const base = path.basename(filePath);
  const match = base.match(/(\d+)\.(jpg|jpeg|png)$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function toCameraName(relativeDir: string): string {
  return relativeDir.split(path.sep).join("/");
}

function collectTimelapseFrames(root: string, currentDir: string, frames: ScannedTimelapse[]) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const relativeDir = path.relative(root, currentDir);
  const cameraName = relativeDir ? toCameraName(relativeDir) : "";

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      collectTimelapseFrames(root, entryPath, frames);
      continue;
    }

    if (!entry.isFile() || !cameraName) {
      continue;
    }

    const iteration = parseIterationFromFilename(entryPath);
    if (iteration === null) {
      continue;
    }

    const stat = fs.statSync(entryPath);
    frames.push({
      cameraName,
      iteration,
      filePath: entryPath,
      sizeBytes: stat.size,
      createdAt: new Date(stat.mtimeMs).toISOString()
    });
  }
}

export function scanTimelapseDir(outputPath: string): ScannedTimelapse[] {
  const root = path.join(outputPath, "timelapse");
  if (!fs.existsSync(root)) {
    return [];
  }

  const cameras = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const frames: ScannedTimelapse[] = [];

  for (const cameraDir of cameras) {
    const cameraPath = path.join(root, cameraDir.name);
    collectTimelapseFrames(root, cameraPath, frames);
  }

  return frames.sort((a, b) => b.iteration - a.iteration);
}

export function toTimelapseFrame(jobId: string, scanned: ScannedTimelapse): Omit<TimelapseFrame, "id"> {
  return {
    jobId,
    cameraName: scanned.cameraName,
    iteration: scanned.iteration,
    filePath: scanned.filePath,
    sizeBytes: scanned.sizeBytes,
    createdAt: scanned.createdAt
  };
}
