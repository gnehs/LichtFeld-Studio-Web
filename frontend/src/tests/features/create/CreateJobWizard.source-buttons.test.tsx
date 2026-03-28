// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function mountWizard(options: {
  datasets?: DatasetRecord[];
  datasetFolders?: DatasetFolderEntry[];
}) {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onNotice = vi.fn();

  return {
    container,
    onNotice,
    root,
    async render() {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <CreateJobWizard
                datasets={options.datasets ?? []}
                datasetFolders={options.datasetFolders ?? []}
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
                onNotice={onNotice}
                onRefreshDatasets={vi.fn(async () => {})}
              />
            </MemoryRouter>
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });
    },
  };
}

describe("CreateJobWizard source mode UI", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    class MockIntersectionObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    container = null;
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
  });

  test("renders existing dataset select with guidance to the datasets page", async () => {
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    expect(container.textContent).toContain("選擇資料集");
    expect(container.textContent).toContain("前往資料集頁面新增資料集");
    const datasetLink = Array.from(container.querySelectorAll("a")).find((link) =>
      link.textContent?.includes("新增資料集"),
    );

    expect(datasetLink?.getAttribute("href")).toBe("/datasets");
  });

  test("does not render upload zip controls inside create job wizard", async () => {
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    expect(container.textContent).not.toContain("上傳 ZIP");
    expect(container.textContent).not.toContain("拖移 ZIP 到這裡");
    expect(container.textContent).not.toContain("資料夾名稱");
  });

  test("shows mask guidance in dataset format panel", async () => {
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    expect(container.textContent).toContain("masks/");
    expect(container.textContent).not.toContain("segmentation");
    expect(container.textContent).toContain("alpha 通道");
  });

  test("shows selected dataset name in the trigger", async () => {
    const mounted = mountWizard({
      datasets: [
        {
          id: "ds-123",
          name: "garden-dataset",
          type: "registered",
          path: "/data/garden-folder",
          createdAt: "2026-03-26T00:00:00.000Z",
        },
      ],
      datasetFolders: [
        {
          name: "garden-folder",
          path: "/data/garden-folder",
          datasetId: "ds-123",
          isRegistered: true,
          health: "ready",
          reason: null,
          imageCount: 128,
          folderSizeBytes: 1024,
          hasMasks: true,
          hasAlphaImages: false,
          previewImageRelativePath: "cam-a/0001.jpg",
        },
      ] as unknown as DatasetFolderEntry[],
    });
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const value = container.querySelector('[data-slot="select-value"]');
    const content = value?.querySelector(":scope > span");
    const textBlock = content?.querySelector(":scope > span:last-child");
    const lines = textBlock?.querySelectorAll(":scope > span");
    const trigger = container.querySelector('[data-slot="select-trigger"]');
    const preview = content?.querySelector('img[alt="garden-folder preview"]');

    expect(lines).toHaveLength(2);
    expect(lines?.[0]?.textContent).toBe("garden-dataset");
    expect(lines?.[1]?.textContent).toBe("128 張相片 - 包含遮罩");
    expect(preview?.getAttribute("src")).toBe(
      "/api/datasets/folders/garden-folder/preview?path=cam-a%2F0001.jpg",
    );
    expect(trigger?.className).toContain("data-[size=default]:h-auto");
    expect(trigger?.className).toContain("min-h-12");
  });
});
