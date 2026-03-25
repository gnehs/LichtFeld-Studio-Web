import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobsPage } from "@/pages/JobsPage";
import { CreateJobPage } from "@/pages/CreateJobPage";
import type { DatasetFolderEntry, DatasetRecord, TrainingJob } from "@/lib/types";

describe("route pages", () => {
  test("jobs page renders route marker", () => {
    const jobs: TrainingJob[] = [];
    const markup = renderToStaticMarkup(
      <JobsPage
        jobs={jobs}
        insights={{}}
        nowMs={Date.now()}
        onCreate={vi.fn()}
        onRefresh={vi.fn(async () => {})}
        onStop={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
      />
    );

    expect(markup).toContain("data-route=\"jobs\"");
  });

  test("create page renders route marker", () => {
    const datasets: DatasetRecord[] = [];
    const datasetFolders: DatasetFolderEntry[] = [];
    const markup = renderToStaticMarkup(
      <CreateJobPage
        datasets={datasets}
        datasetFolders={datasetFolders}
        onCancel={vi.fn()}
        onCreated={vi.fn(async () => {})}
        onDatasetCreated={vi.fn()}
        onNotice={vi.fn()}
        onRefreshDatasets={vi.fn(async () => {})}
      />
    );

    expect(markup).toContain("data-route=\"create\"");
  });
});
