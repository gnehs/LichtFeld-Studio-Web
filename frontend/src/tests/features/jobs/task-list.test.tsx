// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TaskList } from "@/features/jobs/TaskList";
import type { TrainingJob } from "@/lib/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function buildJob(id: string, status: TrainingJob["status"]): TrainingJob {
  return {
    id,
    status,
    outputPath: `/tmp/${id}`,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-03-26T00:00:00.000Z",
    finishedAt:
      status === "completed" ||
      status === "failed" ||
      status === "stopped_low_disk"
        ? "2026-03-26T01:00:00.000Z"
        : null,
    stopReason: status === "stopped_low_disk" ? "low disk" : null,
    paramsJson: JSON.stringify({ iterations: 1000 }),
  };
}

function mountTaskList(jobs: TrainingJob[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  return {
    container,
    root,
    async render() {
      await act(async () => {
        root.render(
          <TaskList
            jobs={jobs}
            insights={{}}
            nowMs={new Date("2026-03-26T01:30:00.000Z").getTime()}
            onCreate={vi.fn()}
            onRefresh={vi.fn(async () => {})}
            onStop={vi.fn(async () => {})}
            onDelete={vi.fn(async () => {})}
            onOpenDetail={vi.fn()}
            onRetry={vi.fn(async () => {})}
            onEdit={vi.fn()}
          />,
        );
        await Promise.resolve();
      });
    },
  };
}

function clickButtonByText(container: HTMLDivElement, text: string) {
  const button = Array.from(
    container.querySelectorAll('[data-slot="button"]'),
  ).find((item) => item.textContent?.trim().startsWith(text));

  expect(button).toBeTruthy();

  return act(async () => {
    button?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

describe("TaskList", () => {
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

  test("renders task cards and status filters", async () => {
    const mounted = mountTaskList([
      buildJob("job-running", "running"),
      buildJob("job-queued", "queued"),
      buildJob("job-completed", "completed"),
      buildJob("job-failed", "failed"),
    ]);
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    expect(container.textContent).toContain("全部");
    expect(container.textContent).toContain("訓練中");
    expect(container.textContent).toContain("佇列");
    expect(container.textContent).toContain("完成");
    expect(container.textContent).toContain("失敗");
    expect(container.querySelectorAll("[data-job-card]")).toHaveLength(4);
  });

  test("filters cards by selected status", async () => {
    const mounted = mountTaskList([
      buildJob("job-running", "running"),
      buildJob("job-completed", "completed"),
      buildJob("job-failed", "failed"),
      buildJob("job-stopped-low-disk", "stopped_low_disk"),
    ]);
    container = mounted.container;
    root = mounted.root;

    await mounted.render();

    await clickButtonByText(container, "完成");

    expect(container.querySelectorAll("[data-job-card]")).toHaveLength(1);
    expect(container.textContent).toContain("job-completed");
    expect(container.textContent).not.toContain("job-running");

    await clickButtonByText(container, "失敗");

    expect(container.querySelectorAll("[data-job-card]")).toHaveLength(2);
    expect(container.textContent).toContain("job-failed");
    expect(container.textContent).toContain("job-stopped-low-disk");
    expect(container.textContent).not.toContain("job-completed");
  });
});
