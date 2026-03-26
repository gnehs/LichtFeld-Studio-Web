// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

  return {
    container,
    root,
    async render() {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <CreateJobWizard
              datasets={options.datasets ?? []}
              datasetFolders={options.datasetFolders ?? []}
              onCancel={vi.fn()}
              onCreated={vi.fn(async () => {})}
              onDatasetCreated={vi.fn()}
              onNotice={vi.fn()}
              onRefreshDatasets={vi.fn(async () => {})}
            />
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

  test("renders existing dataset and upload zip buttons inside source panel", async () => {
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const sourcePanel = Array.from(container.querySelectorAll("section")).find(
      (section) => section.textContent?.includes("資料集來源"),
    );
    const buttonTexts = Array.from(
      sourcePanel?.querySelectorAll('[data-slot="button"]') ?? [],
      (button) => button.textContent?.trim() ?? "",
    );

    expect(buttonTexts).toContain("既有資料集");
    expect(buttonTexts).toContain("上傳 ZIP");
  });

  test("does not show quick param button in upload zip mode", async () => {
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const uploadButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.trim() === "上傳 ZIP");

    expect(uploadButton).toBeTruthy();

    await act(async () => {
      uploadButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("拖移 ZIP 到這裡");
    expect(container.textContent).not.toContain("先調整參數");
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

  test("shows selected dataset trigger in two lines", async () => {
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
          hasMasks: true,
          hasAlphaImages: false,
        },
      ],
    });
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const value = container.querySelector('[data-slot="select-value"]');
    const content = value?.querySelector(":scope > span");
    const lines = content?.querySelectorAll(":scope > span");
    const trigger = container.querySelector('[data-slot="select-trigger"]');

    expect(lines).toHaveLength(2);
    expect(lines?.[0]?.textContent).toBe("garden-folder");
    expect(lines?.[1]?.textContent).toBe("128 張相片 - 包含遮罩");
    expect(trigger?.className).toContain("data-[size=default]:h-auto");
    expect(trigger?.className).toContain("min-h-12");
  });
});
