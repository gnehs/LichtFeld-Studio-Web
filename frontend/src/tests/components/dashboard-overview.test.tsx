import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import type { TrainingJob } from "@/lib/types";

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

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardOverview jobs={jobs} datasetCount={3} />
      </MemoryRouter>,
    );

    expect(markup).toContain("訓練中");
    expect(markup).toContain(">1<");
    expect(markup).toContain("佇列");
    expect(markup).toContain("資料集");
  });

  test("does not render host hardware metrics", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardOverview jobs={[]} datasetCount={2} />
      </MemoryRouter>,
    );

    expect(markup).toContain("資料集");
    expect(markup).not.toContain("GPU");
    expect(markup).not.toContain("VRAM");
    expect(markup).not.toContain("RAM");
  });
});