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

/**
 * Async incremental scan: only reads files with iteration > sinceIteration.
 * Falls back to full scan if sinceIteration is -1.
 */
async function collectTimelapseFramesAsync(
  root: string,
  currentDir: string,
  frames: ScannedTimelapse[],
  sinceIteration: number
) {
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  const relativeDir = path.relative(root, currentDir);
  const cameraName = relativeDir ? toCameraName(relativeDir) : "";

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await collectTimelapseFramesAsync(root, entryPath, frames, sinceIteration);
      continue;
    }

    if (!entry.isFile() || !cameraName) {
      continue;
    }

    const iteration = parseIterationFromFilename(entryPath);
    if (iteration === null || iteration <= sinceIteration) {
      continue;
    }

    const stat = await fs.promises.stat(entryPath);
    frames.push({
      cameraName,
      iteration,
      filePath: entryPath,
      sizeBytes: stat.size,
      createdAt: new Date(stat.mtimeMs).toISOString()
    });
  }
}

/**
 * Async incremental scan of the timelapse directory.
 * @param outputPath  - Job output path containing a "timelapse/" subdirectory.
 * @param sinceIteration - Only return frames with iteration > this value (-1 = full scan).
 */
export async function scanTimelapseDir(outputPath: string, sinceIteration = -1): Promise<ScannedTimelapse[]> {
  const root = path.join(outputPath, "timelapse");
  try {
    await fs.promises.access(root);
  } catch {
    return [];
  }

  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const cameras = entries.filter((entry) => entry.isDirectory());
  const frames: ScannedTimelapse[] = [];

  await Promise.all(
    cameras.map((cameraDir) =>
      collectTimelapseFramesAsync(root, path.join(root, cameraDir.name), frames, sinceIteration)
    )
  );

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
