import { describe, expect, test } from "vitest";
import {
  getCreateJobBlockingReason,
  getCreateJobSelectionState,
} from "@/features/create/create-job-selection-state";

describe("create job selection state", () => {
  test("returns selected dataset state when a dataset is chosen", () => {
    expect(
      getCreateJobSelectionState({
        selectedDatasetId: "ds-123",
        selectedDatasetName: "garden-dataset",
        submitting: false,
      }),
    ).toEqual({
      activeDatasetId: "ds-123",
      activeDatasetLabel: "garden-dataset",
      canSubmit: true,
      blockingReason: null,
    });
  });

  test("returns missing-selection state when no dataset is chosen", () => {
    expect(
      getCreateJobSelectionState({
        selectedDatasetId: "",
        selectedDatasetName: null,
        submitting: false,
      }),
    ).toEqual({
      activeDatasetId: "",
      activeDatasetLabel: "未選擇",
      canSubmit: false,
      blockingReason: "尚未選擇資料集",
    });
  });

  test("returns submitting state while creating a job", () => {
    expect(
      getCreateJobBlockingReason({
        selectedDatasetId: "ds-123",
        submitting: true,
      }),
    ).toBe("任務建立中");
  });
});
