// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DatasetEditPage } from "@/pages/DatasetEditPage";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

function createDatasetEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    relativePath: `images/cam-a/${String(index + 1).padStart(4, "0")}.jpg`,
    kind: "image" as const,
    sizeBytes: 1024 + index,
    previewable: true,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushUi(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("renders dataset edit page route", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/datasets/ds-1/edit"]}>
          <Routes>
            <Route path="/datasets/:id/edit" element={<DatasetEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  await act(async () => {
    await flushUi(10);
  });

  expect(container.textContent).toContain("載入中");
  root.unmount();
  container.remove();
});

it("renders loaded previews with dataset file URLs and preview modes", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.datasets.detail("ds-1"), {
    item: {
      id: "ds-1",
      name: "garden",
      type: "registered",
      path: "/data/datasets/garden",
      createdAt: "2026-03-28T00:00:00.000Z",
      folderSizeBytes: 123456,
      imageCount: 1,
      hasMasks: true,
      hasAlphaImages: false,
      previewImageRelativePath: "images/cam-a/0001.jpg",
      health: "ready",
      reason: null,
      maskSource: "separate_mask",
    },
  });
  queryClient.setQueryData(queryKeys.datasets.files("ds-1"), {
    item: {
      items: [
        {
          relativePath: "images/cam-a/0001.jpg",
          kind: "image",
          sizeBytes: 1024,
          previewable: true,
        },
        {
          relativePath: "masks/cam-a/0001.png",
          kind: "mask",
          sizeBytes: 512,
          previewable: true,
        },
      ],
    },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/datasets/ds-1/edit"]}>
          <Routes>
            <Route path="/datasets/:id/edit" element={<DatasetEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await flushUi();
  });

  expect(container.textContent).toContain("圖片檢視器");
  expect(container.textContent).toContain("遮罩");
  expect(container.textContent).toContain("疊圖");
  const maskPreview = container.querySelector(
    'img[alt="garden css mask preview"]',
  ) as HTMLImageElement | null;
  expect(maskPreview?.getAttribute("src")).toBe(
    "/api/datasets/ds-1/file?path=masks%2Fcam-a%2F0001.png",
  );
  expect(maskPreview?.getAttribute("style") ?? "").not.toContain(
    "mask-mode: luminance",
  );

  const editButton = container
    .querySelector("svg.lucide-pencil")
    ?.closest("button") as HTMLButtonElement | null;

  await act(async () => {
    editButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await flushUi();
  });

  expect(document.body.textContent).toContain("新的資料夾名稱");

  root.unmount();
  container.remove();
});

it("limits rendered dataset file buttons when there are many files", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const files = createDatasetEntries(200);

  queryClient.setQueryData(queryKeys.datasets.detail("ds-1"), {
    item: {
      id: "ds-1",
      name: "garden",
      type: "registered",
      path: "/data/datasets/garden",
      createdAt: "2026-03-28T00:00:00.000Z",
      folderSizeBytes: 123456,
      imageCount: files.length,
      hasMasks: false,
      hasAlphaImages: false,
      previewImageRelativePath: files[0]?.relativePath ?? null,
      health: "ready",
      reason: null,
      maskSource: "alpha",
    },
  });
  queryClient.setQueryData(queryKeys.datasets.files("ds-1"), {
    item: {
      items: files,
    },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/datasets/ds-1/edit"]}>
          <Routes>
            <Route path="/datasets/:id/edit" element={<DatasetEditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await flushUi(6);
  });

  const fileButtons = Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent?.includes("images/cam-a/") ?? false,
  );

  expect(fileButtons.length).toBeGreaterThan(0);
  expect(fileButtons.length).toBeLessThan(files.length);

  const fileListScroller = container.querySelector(
    ".max-h-168.overflow-auto",
  ) as HTMLDivElement | null;

  expect(fileListScroller).not.toBeNull();
  expect(fileListScroller?.getAttribute("style") ?? "").not.toContain(
    "contain: strict",
  );

  root.unmount();
  container.remove();
});
