import { describe, expect, test } from "vitest";
import {
  formatDatasetFolderMeta,
  getDatasetNameByIdMap,
  getDatasetSelectItems,
  isDatasetFolderSelectable,
} from "@/features/create/create-job-dataset-select";
import type { DatasetFolderEntry, DatasetRecord } from "@/lib/types";

describe("getDatasetSelectItems", () => {
  test("uses full dataset labels for select trigger", () => {
    const datasets: DatasetRecord[] = [
      {
        id: "ds-123",
        name: "garden-dataset",
        type: "registered",
        path: "/data/garden-folder",
        createdAt: "2026-03-26T00:00:00.000Z",
      },
    ];
    const datasetFolders: DatasetFolderEntry[] = [
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
      },
      {
        name: "uploading-folder",
        path: "/data/uploading-folder",
        datasetId: null,
        isRegistered: false,
        health: "uploading",
        reason: "upload in progress",
        imageCount: null,
        folderSizeBytes: 0,
        hasMasks: false,
        hasAlphaImages: false,
      },
    ];

    expect(getDatasetSelectItems(datasetFolders, getDatasetNameByIdMap(datasets))).toEqual([
      {
        value: "ds-123",
        label: "garden-dataset - 128 張相片 - 包含遮罩",
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
        folderSizeBytes: 1024,
        hasMasks: true,
        hasAlphaImages: false,
      }),
    ).toBe("128 張相片 - 包含遮罩");
  });

  test.each(["ready", "uploading", "stabilizing", "invalid"] as const)(
    "allows registered datasets to be selected with %s health",
    (health) => {
      expect(
        isDatasetFolderSelectable({
          name: "0805-as-202608051146",
          path: "/data/0805-as-202608051146",
          datasetId: "ds-stabilizing",
          isRegistered: true,
          health,
          reason: "dataset is still being written",
          imageCount: 128,
          folderSizeBytes: 1024,
          hasMasks: false,
          hasAlphaImages: false,
        }),
      ).toBe(true);
    },
  );

  test("keeps folders without a registered dataset disabled", () => {
    expect(
      isDatasetFolderSelectable({
        name: "unregistered-folder",
        path: "/data/unregistered-folder",
        datasetId: null,
        isRegistered: false,
        health: "ready",
        reason: null,
        imageCount: 128,
        folderSizeBytes: 1024,
        hasMasks: false,
        hasAlphaImages: false,
      }),
    ).toBe(false);
  });
});
