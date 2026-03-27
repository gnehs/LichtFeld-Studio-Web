// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import { api } from "@/lib/api";
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
            <CreateJobWizard
              datasets={options.datasets ?? []}
              datasetFolders={options.datasetFolders ?? []}
              onCancel={vi.fn()}
              onCreated={vi.fn(async () => {})}
              onDatasetCreated={vi.fn()}
              onNotice={onNotice}
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

  test("asks for folder name after selecting a zip and prefills it from the zip filename", async () => {
    const uploadDatasetSpy = vi
      .spyOn(api, "uploadDataset")
      .mockImplementation(async () =>
        new Promise(() => undefined) as Promise<Awaited<ReturnType<typeof api.uploadDataset>>>,
      );
    const mounted = mountWizard({});
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const uploadButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.trim() === "上傳 ZIP");

    await act(async () => {
      uploadButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    const fileInput = container.querySelector(
      '#dataset-upload-input',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();

    const file = new File(["zip"], "garden-v2.zip", {
      type: "application/zip",
    });

    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const nameInput = container.querySelector(
      'input:not([type="file"])',
    ) as HTMLInputElement | null;

    expect(container.textContent).toContain("資料夾名稱");
    expect(container.textContent).toContain("拖移 ZIP 到這裡");
    expect(nameInput?.value).toBe("garden-v2");
    expect(uploadDatasetSpy).not.toHaveBeenCalled();
  });

  test("warns before upload when the chosen folder name already exists", async () => {
    const uploadDatasetSpy = vi.spyOn(api, "uploadDataset");
    const mounted = mountWizard({
      datasetFolders: [
        {
          name: "garden-v2",
          path: "/data/garden-v2",
          datasetId: "ds-existing",
          isRegistered: true,
          health: "ready",
          reason: null,
          imageCount: 128,
          hasMasks: false,
          hasAlphaImages: false,
        },
      ],
    });
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const uploadButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.trim() === "上傳 ZIP");

    await act(async () => {
      uploadButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    const fileInput = container.querySelector(
      '#dataset-upload-input',
    ) as HTMLInputElement | null;
    const file = new File(["zip"], "garden-v2.zip", {
      type: "application/zip",
    });

    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("資料夾名稱已存在");

    const nextButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.trim() === "下一步：參數設定");

    await act(async () => {
      nextButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(uploadDatasetSpy).not.toHaveBeenCalled();
    expect(mounted.onNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "error",
        text: "資料夾名稱已存在，請改用其他名稱",
      }),
    );
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
    expect(lines?.[0]?.textContent).toBe("garden-folder");
    expect(lines?.[1]?.textContent).toBe("128 張相片 - 包含遮罩");
    expect(preview?.getAttribute("src")).toBe(
      "/api/datasets/folders/garden-folder/preview?path=cam-a%2F0001.jpg",
    );
    expect(trigger?.className).toContain("data-[size=default]:h-auto");
    expect(trigger?.className).toContain("min-h-12");
  });
});
