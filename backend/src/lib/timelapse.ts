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

export function scanTimelapseDir(outputPath: string): ScannedTimelapse[] {
  const root = path.join(outputPath, "timelapse");
  if (!fs.existsSync(root)) {
    return [];
  }

  const cameras = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const frames: ScannedTimelapse[] = [];

  for (const cameraDir of cameras) {
    const cameraPath = path.join(root, cameraDir.name);
    const files = fs
      .readdirSync(cameraPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(cameraPath, entry.name));

    for (const filePath of files) {
      const iteration = parseIterationFromFilename(filePath);
      if (iteration === null) {
        continue;
      }
      const stat = fs.statSync(filePath);
      frames.push({
        cameraName: cameraDir.name,
        iteration,
        filePath,
        sizeBytes: stat.size,
        createdAt: new Date(stat.mtimeMs).toISOString()
      });
    }
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
