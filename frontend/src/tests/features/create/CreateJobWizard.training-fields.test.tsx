// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CreateJobWizard } from "@/features/create/CreateJobWizard";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const datasets: DatasetRecord[] = [
  {
    id: "ds-123",
    name: "training-dataset",
    type: "registered",
    path: "/data/training-dataset",
    createdAt: "2026-03-26T00:00:00.000Z",
  },
];

const datasetFolders: DatasetFolderEntry[] = [
  {
    name: "training-dataset",
    path: "/data/training-dataset",
    datasetId: "ds-123",
    isRegistered: true,
    health: "ready",
    reason: null,
    imageCount: 2,
    folderSizeBytes: 1024,
    hasMasks: false,
    hasAlphaImages: false,
    previewImageRelativePath: null,
  },
];

function mountWizard(options: {
  initialValues?: {
    iterations?: number;
    stepsScaler?: number;
    enableSparsity?: boolean;
    sparsifySteps?: number;
  };
} = {}) {
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
            <MemoryRouter>
              <CreateJobWizard
                datasets={datasets}
                datasetFolders={datasetFolders}
                initialDatasetId="ds-123"
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
                onNotice={vi.fn()}
                onRefreshDatasets={vi.fn(async () => {})}
                initialValues={options.initialValues}
              />
            </MemoryRouter>
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });
    },
  };
}

describe("CreateJobWizard core training fields", () => {
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

  test("renders direct number inputs with precise supported bounds", async () => {
    const mounted = mountWizard();
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    const iterations = container.querySelector(
      "#create-job-iterations",
    ) as HTMLInputElement | null;
    const maxCap = container.querySelector(
      "#create-job-max-cap",
    ) as HTMLInputElement | null;

    expect(iterations?.type).toBe("number");
    expect(iterations?.min).toBe("1");
    expect(iterations?.max).toBe("1000000");
    expect(iterations?.step).toBe("1");
    expect(iterations?.value).toBe("30000");

    expect(maxCap?.type).toBe("number");
    expect(maxCap?.min).toBe("100000");
    expect(maxCap?.max).toBe("1000000000");
    expect(maxCap?.step).toBe("1");
    expect(maxCap?.value).toBe("5000000");

    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  test("shows effective scaled steps and a static Modal GPU SKU datalist", async () => {
    const mounted = mountWizard({
      initialValues: {
        iterations: 1_001,
        stepsScaler: 1.5,
        enableSparsity: true,
        sparsifySteps: 7,
      },
    });
    container = mounted.container;
    root = mounted.root;

    await mounted.render();
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("1,509");
    expect(container.querySelector("#create-job-gpu")).not.toBeNull();
    expect(container.querySelector("#create-job-gpu-skus")).not.toBeNull();
  });
});
