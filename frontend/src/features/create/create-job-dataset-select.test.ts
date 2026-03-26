import { describe, expect, test } from "vitest";
import {
  formatDatasetFolderMeta,
  getDatasetSelectItems,
} from "@/features/create/create-job-dataset-select";
import type { DatasetFolderEntry } from "@/lib/types";

describe("getDatasetSelectItems", () => {
  test("uses full dataset labels for select trigger", () => {
    const datasetFolders: DatasetFolderEntry[] = [
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
      {
        name: "uploading-folder",
        path: "/data/uploading-folder",
        datasetId: null,
        isRegistered: false,
        health: "uploading",
        reason: "upload in progress",
        imageCount: null,
        hasMasks: false,
        hasAlphaImages: false,
      },
    ];

    expect(getDatasetSelectItems(datasetFolders)).toEqual([
      {
        value: "ds-123",
        label: "garden-folder - 128 張相片 - 包含遮罩",
      },
    ]);
  });

  test("shows mask support in folder meta", () => {
    expect(
      formatDatasetFolderMeta({
        name: "garden-folder",
        path: "/data/garden-folder",
        datasetId: "ds-123",
        isRegistered: true,
        health: "ready",
        reason: null,
        imageCount: 128,
        hasMasks: true,
        hasAlphaImages: false,
      }),
    ).toBe("128 張相片 - 包含遮罩");
  });
});
