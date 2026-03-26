import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import type { SystemMetrics, TrainingJob } from "@/lib/types";

describe("DashboardOverview", () => {
  test("renders job and system summary cards from props", () => {
    const jobs: TrainingJob[] = [
      {
        id: "job-1",
        status: "running",
        outputPath: "/tmp/job-1",
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z",
        startedAt: "2026-03-26T00:00:00.000Z",
        finishedAt: null,
        stopReason: null,
        paramsJson: "{}",
      },
      {
        id: "job-2",
        status: "queued",
        outputPath: "/tmp/job-2",
        createdAt: "2026-03-26T00:00:00.000Z",
        updatedAt: "2026-03-26T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        stopReason: null,
        paramsJson: "{}",
      },
    ];

    const systemMetrics: SystemMetrics = {
      gpu: {
        devices: [
          {
            index: 0,
            name: "RTX 4090",
            utilizationGpu: 87,
            temperatureC: 60,
            memoryTotalMiB: 24576,
            memoryUsedMiB: 12288,
            memoryUsedPercent: 50,
          },
        ],
        available: true,
      },
      memory: {
        totalGb: 64,
        usedGb: 48.2,
        usedPercent: 75,
      },
      ts: "2026-03-26T00:00:00.000Z",
    };

    const markup = renderToStaticMarkup(
      <DashboardOverview
        jobs={jobs}
        datasetCount={3}
        systemMetrics={systemMetrics}
      />,
    );

    expect(markup).toContain("訓練中");
    expect(markup).toContain(">1<");
    expect(markup).toContain("佇列");
    expect(markup).toContain("資料集");
    expect(markup).toContain("RTX 4090");
    expect(markup).toContain("12.0 / 24.0 GB");
    expect(markup).toContain("48.2");
    expect(markup).toContain("/ 64GB");
  });
});
