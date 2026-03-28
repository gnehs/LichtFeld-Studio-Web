import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { JobsPage } from "@/pages/JobsPage";
import { CreateJobPage } from "@/pages/CreateJobPage";
import { JobDetailPage } from "@/pages/JobDetailPage";
import { DatasetEditPage } from "@/pages/DatasetEditPage";
import { DatasetsPage } from "@/pages/DatasetsPage";
import type { DatasetFolderEntry, DatasetRecord, TrainingJob } from "@/lib/types";

function withQueryClient(node: ReactElement) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

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
        onOpenDetail={vi.fn()}
      />
    );

    expect(markup).toContain("data-route=\"jobs\"");
  });

  test("create page renders route marker", () => {
    const datasets: DatasetRecord[] = [];
    const datasetFolders: DatasetFolderEntry[] = [];
    const markup = renderToStaticMarkup(
      withQueryClient(
        <MemoryRouter>
          <CreateJobPage
            datasets={datasets}
            datasetFolders={datasetFolders}
            onCancel={vi.fn()}
            onCreated={vi.fn(async () => {})}
            onNotice={vi.fn()}
            onRefreshDatasets={vi.fn(async () => {})}
          />
        </MemoryRouter>,
      )
    );

    expect(markup).toContain("data-route=\"create\"");
  });

  test("job detail page renders route marker", () => {
    const markup = renderToStaticMarkup(
      withQueryClient(
        <MemoryRouter initialEntries={["/jobs/job-1"]}>
          <Routes>
            <Route path="/jobs/:id" element={<JobDetailPage onNotice={vi.fn()} />} />
          </Routes>
        </MemoryRouter>,
      )
    );

    expect(markup).toContain("data-route=\"job-detail\"");
  });

  test("dataset edit page renders loading state", () => {
    const markup = renderToStaticMarkup(
      withQueryClient(
        <MemoryRouter initialEntries={["/datasets/ds-1/edit"]}>
          <Routes>
            <Route path="/datasets/:id/edit" element={<DatasetEditPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );

    expect(markup).toContain("載入中");
  });

  test("datasets page renders route marker", () => {
    const markup = renderToStaticMarkup(
      withQueryClient(
        <MemoryRouter>
          <DatasetsPage datasets={[]} datasetFolders={[]} onNotice={vi.fn()} />
        </MemoryRouter>,
      ),
    );

    expect(markup).toContain('data-route="datasets"');
    expect(markup).toContain("資料集列表");
    expect(markup).toContain("新增資料集");
  });

  test("datasets page shows preview image and folder size", () => {
    const datasets: DatasetRecord[] = [
      {
        id: "ds-1",
        name: "garden",
        type: "registered",
        path: "/data/datasets/garden",
        createdAt: "2026-03-28T00:00:00.000Z",
      },
    ];
    const datasetFolders = [
      {
        name: "garden",
        path: "/data/datasets/garden",
        datasetId: "ds-1",
        isRegistered: true,
        health: "ready",
        reason: null,
        imageCount: 24,
        hasMasks: true,
        hasAlphaImages: false,
        previewImageRelativePath: "images/cam-a/0001.jpg",
        folderSizeBytes: 1048576,
      },
    ] as unknown as DatasetFolderEntry[];

    const markup = renderToStaticMarkup(
      withQueryClient(
        <MemoryRouter>
          <DatasetsPage
            datasets={datasets}
            datasetFolders={datasetFolders}
            onNotice={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );

    expect(markup).toContain("1.0 MB");
    expect(markup).toContain(
      "/api/datasets/folders/garden/preview?path=images%2Fcam-a%2F0001.jpg",
    );
  });
});
