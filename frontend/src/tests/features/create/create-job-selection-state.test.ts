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
      submitting: false,
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
      submitting: false,
    });
  });

  test("canSubmit is false while submitting even if dataset is selected", () => {
    const result = getCreateJobSelectionState({
      selectedDatasetId: "ds-123",
      selectedDatasetName: "garden-dataset",
      submitting: true,
    });
    expect(result.canSubmit).toBe(false);
    expect(result.blockingReason).toBeNull();
    expect(result.submitting).toBe(true);
  });

  test("blockingReason does not include submitting state", () => {
    expect(
      getCreateJobBlockingReason({ selectedDatasetId: "ds-123" }),
    ).toBeNull();
    expect(
      getCreateJobBlockingReason({ selectedDatasetId: "" }),
    ).toBe("尚未選擇資料集");
  });
});
