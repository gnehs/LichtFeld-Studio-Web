// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DatasetsPage } from "@/pages/DatasetsPage";
import { api } from "@/lib/api";
import type { DatasetFolderEntry } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function mountDatasetsPage(options?: { datasetFolders?: DatasetFolderEntry[] }) {
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
              <DatasetsPage
                datasets={[]}
                datasetFolders={options?.datasetFolders ?? []}
                onNotice={onNotice}
              />
            </MemoryRouter>
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });
    },
  };
}

describe("DatasetsPage upload panel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
  });

  test("prefills dataset name from the selected zip filename", async () => {
    const uploadDatasetSpy = vi
      .spyOn(api, "uploadDataset")
      .mockImplementation(async () =>
        new Promise(() => undefined) as Promise<Awaited<ReturnType<typeof api.uploadDataset>>>,
      );
    const mounted = mountDatasetsPage();
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

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

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.getAttribute("type") !== "file",
    ) as HTMLInputElement | undefined;

    expect(container.textContent).toContain("資料集名稱");
    expect(nameInput?.value).toBe("garden-v2");
    expect(uploadDatasetSpy).not.toHaveBeenCalled();
  });

  test("blocks upload when the chosen dataset name already exists", async () => {
    const uploadDatasetSpy = vi.spyOn(api, "uploadDataset");
    const mounted = mountDatasetsPage({
      datasetFolders: [
        {
          name: "garden-v2",
          path: "/data/garden-v2",
          datasetId: "ds-existing",
          isRegistered: true,
          health: "ready",
          reason: null,
          imageCount: 128,
          folderSizeBytes: 1024,
          hasMasks: false,
          hasAlphaImages: false,
        },
      ],
    });
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

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

    expect(container.textContent).toContain("資料集名稱已存在");

    const uploadButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.trim() === "開始上傳");

    await act(async () => {
      uploadButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(uploadDatasetSpy).not.toHaveBeenCalled();
    expect(mounted.onNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "error",
        text: "資料集名稱已存在，請改用其他名稱",
      }),
    );
  });

  test("shows first-chunk progress text and disables controls while reconnecting", async () => {
    let uploadOptions: Parameters<typeof api.uploadDataset>[2] | undefined;
    const uploadDatasetSpy = vi
      .spyOn(api, "uploadDataset")
      .mockImplementation(async (_file, _datasetName, options) => {
        uploadOptions = options;
        return new Promise(() => undefined) as Promise<
          Awaited<ReturnType<typeof api.uploadDataset>>
        >;
      });
    const mounted = mountDatasetsPage();
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const fileInput = container.querySelector(
      "#dataset-upload-input",
    ) as HTMLInputElement | null;
    const file = new File([new Uint8Array(8 * 1024 * 1024)], "garden-v2.zip", {
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

    const uploadButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.includes("開始上傳")) as
      | HTMLButtonElement
      | undefined;

    await act(async () => {
      uploadButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadDatasetSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("正在上傳第一個資料分段...");
    expect(uploadButton?.disabled).toBe(true);

    await act(async () => {
      uploadOptions?.onReconnecting?.(Date.now() + 1_000);
      await Promise.resolve();
    });

    expect(container.textContent).toMatch(/網路中斷，將於 \d+ 秒後重試\.\.\./);
    expect(uploadButton?.disabled).toBe(true);

    const reselectButton = Array.from(
      container.querySelectorAll('[data-slot="button"]'),
    ).find((button) => button.textContent?.includes("重新選擇")) as
      | HTMLButtonElement
      | undefined;
    expect(reselectButton?.disabled).toBe(true);
  });
});
