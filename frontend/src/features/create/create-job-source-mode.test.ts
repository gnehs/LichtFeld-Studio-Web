import { describe, expect, test } from "vitest";
import {
  CREATE_JOB_SOURCE_MODE_BUTTONS,
  getCreateJobSourceModeState,
} from "@/features/create/create-job-source-mode";

describe("create job source mode", () => {
  test("offers existing dataset and upload zip source buttons", () => {
    expect(CREATE_JOB_SOURCE_MODE_BUTTONS).toEqual([
      { mode: "existing", label: "既有資料集" },
      { mode: "upload", label: "上傳 ZIP" },
    ]);
  });

  test("shows zip upload section only for upload mode", () => {
    expect(getCreateJobSourceModeState("existing")).toEqual({
      showExistingDatasetSelect: true,
      showUploadSection: false,
      showRefreshAction: true,
    });
    expect(getCreateJobSourceModeState("upload")).toEqual({
      showExistingDatasetSelect: false,
      showUploadSection: true,
      showRefreshAction: false,
    });
  });
});
