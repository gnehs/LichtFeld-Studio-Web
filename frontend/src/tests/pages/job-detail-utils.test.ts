import { describe, expect, test } from "vitest";
import type { TimelapseFrame, TrainingJob } from "@/lib/types";
import {
  computeProgress,
  parseLichtFeldProgressLog,
  sortFramesAscending,
} from "@/pages/job-detail-utils";

describe("job detail utils", () => {
  test("computes progress based on params iterations", () => {
    const job: TrainingJob = {
      id: "j1",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      outputPath: "/tmp/out",
      stopReason: null,
      paramsJson: JSON.stringify({ iterations: 1000 })
    };

    const result = computeProgress(job, 250);
    expect(result.targetIterations).toBe(1000);
    expect(result.latestIteration).toBe(250);
    expect(result.ratio).toBe(0.25);
  });

  test("returns null ratio when iterations unavailable", () => {
    const job: TrainingJob = {
      id: "j2",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      outputPath: "/tmp/out",
      stopReason: null,
      paramsJson: "{}"
    };

    const result = computeProgress(job, 250);
    expect(result.targetIterations).toBe(null);
    expect(result.ratio).toBeNull();
  });

  test("parses the maximum LichtFeld iteration and total despite ANSI redraws", () => {
    const result = parseLichtFeldProgressLog([
      "\u001b[2K\r 100/1,000 | Loss: 0.42",
      "200/1000 | Loss: 0.21",
      "not a progress line",
    ]);

    expect(result).toEqual({ latestIteration: 200, targetIterations: 1000 });
  });

  test("marks completed jobs as fully complete even without iteration metadata", () => {
    const job: TrainingJob = {
      id: "j3",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outputPath: "/tmp/out",
      stopReason: null,
      paramsJson: "{}",
    };

    const result = computeProgress(job, null);
    expect(result.latestIteration).toBe(0);
    expect(result.targetIterations).toBeNull();
    expect(result.ratio).toBe(1);
  });

  test("sorts frames from old to new for playback", () => {
    const frames: TimelapseFrame[] = [
      { id: 1, jobId: "j", cameraName: "a", iteration: 300, filePath: "3.png", sizeBytes: 1, createdAt: "2025-01-01" },
      { id: 2, jobId: "j", cameraName: "a", iteration: 100, filePath: "1.png", sizeBytes: 1, createdAt: "2025-01-01" },
      { id: 3, jobId: "j", cameraName: "a", iteration: 200, filePath: "2.png", sizeBytes: 1, createdAt: "2025-01-01" }
    ];

    const sorted = sortFramesAscending(frames);
    expect(sorted.map((frame) => frame.iteration)).toEqual([100, 200, 300]);
  });
});
