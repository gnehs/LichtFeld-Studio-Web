import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Notice } from "@/lib/app-types";

import type {
  DatasetFolderEntry,
  DatasetRecord,
  TrainingParamsForm,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  applyVisibleStrategyDefaults,
  getStrategyDefaults,
  shouldShowMaskSettings,
  UPSTREAM_MASK_FOLDERS,
  type CreateJobStrategyDefaults,
} from "./create-job-defaults";
import {
  getDatasetDisplayName,
  formatDatasetFolderLabel,
  formatDatasetFolderMeta,
  getDatasetFolderPreviewSrc,
  getDatasetNameByIdMap,
  getDatasetSelectItems,
} from "./create-job-dataset-select";
import { getCreateJobSelectionState } from "./create-job-selection-state";
import { cn } from "@/lib/utils";

function DatasetFolderPreview({
  folder,
  className,
}: {
  folder: DatasetFolderEntry;
  className?: string;
}) {
  const previewSrc = getDatasetFolderPreviewSrc(folder);
  const initials = folder.name.slice(0, 2).toUpperCase();

  return (
    <div
      className={cn(
        "glass-panel relative overflow-hidden rounded-lg border-0 bg-white/5",
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.16),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] text-[10px] font-semibold tracking-[0.28em] text-zinc-300">
        {initials || "DS"}
      </div>
      {previewSrc ? (
        <img
          className="relative z-10 h-full w-full object-cover"
          src={previewSrc}
          alt={`${folder.name} preview`}
          onError={(event) => {
            event.currentTarget.classList.add("hidden");
          }}
        />
      ) : null}
    </div>
  );
}

interface CreateWizardValues extends CreateJobStrategyDefaults {
  advancedJson: string;
}

function DatasetStructureGuide() {
  return (
    <div className="*: text-sm text-zinc-300">
      <p>
        資料集根目錄必須直接包含{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 text-xs">images/</code>{" "}
        與{" "}
        <code className="rounded bg-black/40 px-1 py-0.5 text-xs">sparse/</code>
        。
      </p>
      <pre className="scrollbar-dark mt-3 overflow-x-auto rounded-xl border border-white/8 bg-black/80 p-3 text-xs leading-5 text-zinc-100">{`dataset/
|- images/
|  |- 0001.jpg
|  |- 0002.jpg
|  \- ...
\- sparse/
   \- ...`}</pre>
      <p className="mt-2 text-xs text-zinc-400">
        不要多包一層外層資料夾，例如{" "}
        <code className="rounded bg-black/40 px-1 py-0.5">dataset/images</code>
        。
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-400">
        若需要遮罩，請在資料集根目錄額外放入
        <code className="rounded bg-black/40 px-1 py-0.5">masks/</code>
        資料夾；若
        <code className="rounded bg-black/40 px-1 py-0.5">images/</code>
        內的 PNG 含 alpha 通道，也會被視為可用的遮罩來源。
      </p>
    </div>
  );
}

function SourcePanel({
  title,
  description,
  active,
  actions,
  children,
}: {
  title: string;
  description: string;
  active: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`glass-panel rounded-[1.25rem] border-0 p-4 transition-colors ${active ? "bg-cyan-300/[0.05]" : "bg-black/20"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function ParameterPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-[1.25rem] border-0 bg-black/22 p-4">
      <div className="border-b border-white/8 pb-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-400">{description}</p>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function ParameterMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
      <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
        {label}
      </p>
      <div className="mt-2 text-lg font-semibold text-zinc-100">{value}</div>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function ToggleChip({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        `glass-panel flex items-center justify-between gap-3 rounded-[1rem] px-3 py-3 text-sm transition`,
        checked
          ? "bg-cyan-300/[0.08] text-zinc-100"
          : "bg-black/20 text-zinc-300",
      )}
    >
      <div>
        <span>{label}</span>
        <div>
          {description ? (
            <p className="mt-1 text-xs text-zinc-500">{description}</p>
          ) : null}
        </div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-zinc-500">{children}</p>;
}

export function CreateJobWizard({
  datasets,
  datasetFolders,
  onCancel,
  onCreated,
  onNotice,
  onRefreshDatasets,
}: {
  datasets: DatasetRecord[];
  datasetFolders: DatasetFolderEntry[];
  onCancel: () => void;
  onCreated: (jobId: string) => Promise<void>;
  onNotice: (notice: Notice) => void;
  onRefreshDatasets: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [form, setForm] = useState<CreateWizardValues>(() => ({
    ...getStrategyDefaults("mcmc"),
    advancedJson: "",
  }));
  const [submitting, setSubmitting] = useState(false);

  const createJobMutation = useMutation({
    mutationFn: (payload: { datasetId: string; params: TrainingParamsForm }) =>
      api.createJob(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });

  const selectableFolders = useMemo(
    () =>
      datasetFolders.filter(
        (folder) =>
          folder.isRegistered &&
          folder.health === "ready" &&
          Boolean(folder.datasetId),
      ),
    [datasetFolders],
  );
  const datasetNameById = useMemo(() => getDatasetNameByIdMap(datasets), [datasets]);
  const datasetSelectItems = useMemo(
    () => getDatasetSelectItems(datasetFolders, datasetNameById),
    [datasetFolders, datasetNameById],
  );
  const datasetSelectValueMap = useMemo(
    () =>
      new Map(
        datasetFolders.flatMap((folder) =>
          folder.datasetId
            ? [
                [
                  folder.datasetId,
                  {
                    name: getDatasetDisplayName(folder, datasetNameById),
                    meta: formatDatasetFolderMeta(folder),
                    label: formatDatasetFolderLabel(folder, datasetNameById),
                    folder,
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [datasetFolders, datasetNameById],
  );
  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );
  const selectedDatasetFolder = useMemo(
    () =>
      datasetFolders.find((folder) => folder.datasetId === selectedDatasetId) ??
      null,
    [datasetFolders, selectedDatasetId],
  );
  const showMaskSettings = shouldShowMaskSettings(
    selectedDatasetFolder?.hasMasks ?? false,
    selectedDatasetFolder?.hasAlphaImages ?? false,
  );
  const { activeDatasetId, activeDatasetLabel, canSubmit, blockingReason } =
    useMemo(
      () =>
        getCreateJobSelectionState({
          selectedDatasetId,
          selectedDatasetName: selectedDataset?.name ?? null,
          submitting,
        }),
      [selectedDataset?.name, selectedDatasetId, submitting],
    );

  const statusMessage = submitting
    ? { text: "任務建立中，請稍候...", isBlocking: false }
    : blockingReason
      ? { text: `目前無法建立：${blockingReason}`, isBlocking: true }
      : { text: "條件已齊備，可以建立任務。", isBlocking: false };

  useEffect(() => {
    if (selectableFolders.length === 0) {
      setSelectedDatasetId("");
      return;
    }
    const currentStillValid = selectableFolders.some(
      (folder) => folder.datasetId === selectedDatasetId,
    );
    if (!selectedDatasetId || !currentStillValid) {
      setSelectedDatasetId(selectableFolders[0].datasetId ?? "");
    }
  }, [selectableFolders, selectedDatasetId]);

  useEffect(() => {
    if (showMaskSettings) {
      return;
    }
    setForm((prev) => {
      if (
        prev.maskMode === "none" &&
        !prev.invertMasks &&
        !prev.noAlphaAsMask
      ) {
        return prev;
      }
      return {
        ...prev,
        maskMode: "none",
        invertMasks: false,
        noAlphaAsMask: false,
      };
    });
  }, [showMaskSettings]);

  const goStepTwo = async () => {
    if (!selectedDatasetId) {
      onNotice({ tone: "error", text: "請先選擇一個 dataset" });
      return;
    }

    setStep(2);
  };

  const updateForm = <K extends keyof CreateWizardValues>(
    key: K,
    value: CreateWizardValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    if (!activeDatasetId) {
      onNotice({ tone: "error", text: "請先選擇資料集" });
      setStep(1);
      return;
    }

    let advanced: Partial<TrainingParamsForm> = {};
    if (form.advancedJson.trim()) {
      try {
        const parsed = JSON.parse(form.advancedJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("進階參數必須是 JSON 物件");
        advanced = parsed as Partial<TrainingParamsForm>;
      } catch (error) {
        onNotice({
          tone: "error",
          text: `進階參數 JSON 格式錯誤：${(error as Error).message}`,
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const payloadParams: TrainingParamsForm = {
        ...advanced,
        iterations: form.iterations,
        strategy: form.strategy,
        shDegree: form.shDegree,
        shDegreeInterval: form.shDegreeInterval,
        maxCap: form.maxCap,
        minOpacity: form.minOpacity,
        stepsScaler: form.stepsScaler,
        tileMode: form.tileMode,
        random: form.random,
        initNumPts: form.initNumPts || undefined,
        initExtent: form.initExtent || undefined,
        images: form.images.trim() || undefined,
        testEvery: form.testEvery,
        resizeFactor: form.resizeFactor,
        maxWidth: form.maxWidth || undefined,
        noCpuCache: form.noCpuCache,
        noFsCache: form.noFsCache,
        eval: form.eval,
        saveEvalImages: form.saveEvalImages,
        saveDepth: form.saveDepth,
        gut: form.gut,
        undistort: form.undistort,
        maskMode: showMaskSettings ? form.maskMode : undefined,
        invertMasks: showMaskSettings ? form.invertMasks : undefined,
        noAlphaAsMask: showMaskSettings ? form.noAlphaAsMask : undefined,
        enableSparsity: form.enableSparsity,
        sparsifySteps: form.sparsifySteps || undefined,
        initRho: form.initRho || undefined,
        pruneRatio: form.pruneRatio || undefined,
        enableMip: form.enableMip,
        bilateralGrid: form.bilateralGrid,
        ppisp: form.ppisp,
        ppispController: form.ppispController,
        ppispFreeze: form.ppispFreeze,
        ppispSidecar: form.ppispSidecar.trim() || undefined,
        bgModulation: form.bgModulation,
      };

      delete payloadParams.dataPath;

      const res = await createJobMutation.mutateAsync({
        datasetId: activeDatasetId,
        params: payloadParams,
      });
      onNotice({ tone: "success", text: `任務 ${res.item.id} 建立成功` });
      await onCreated(res.item.id);
    } catch (error) {
      onNotice({
        tone: "error",
        text: `建立任務失敗：${(error as Error).message}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-zinc-50">建立新任務</h2>
        <Button variant="outline" onClick={onCancel}>
          返回任務清單
        </Button>
      </div>

      {step === 1 ? (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SourcePanel
              title="資料集來源"
              description="建立任務時只會選擇既有資料集；若還沒有資料集，請先前往資料集頁面新增。"
              active
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void onRefreshDatasets()
                        .then(() =>
                          onNotice({
                            tone: "success",
                            text: "資料集清單已重新整理",
                          }),
                        )
                        .catch((error) =>
                          onNotice({
                            tone: "error",
                            text: `重新整理資料集失敗：${(error as Error).message}`,
                          }),
                        );
                    }}
                  >
                    <RefreshCw className="size-4" /> 重新整理
                  </Button>
                  <Link
                    to="/datasets"
                    className={cn(
                      "glass-panel inline-flex items-center justify-center rounded-lg border-0 bg-background px-2.5 text-sm font-medium transition-all hover:bg-muted hover:text-foreground dark:bg-input/30 dark:hover:bg-input/50",
                    )}
                  >
                    前往資料集頁面新增資料集
                  </Link>
                </>
              }
            >
              <div>
                <Label>選擇資料集</Label>
                <Select
                  items={datasetSelectItems}
                  value={selectedDatasetId || null}
                  onValueChange={(value) => {
                    setSelectedDatasetId(value ?? "");
                  }}
                >
                  <SelectTrigger className="mt-2 min-h-12 w-full items-start py-2 whitespace-normal data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:items-start">
                    <SelectValue placeholder="請選擇可用 dataset">
                      {(value) => {
                        if (!value) {
                          return "請選擇可用 dataset";
                        }
                        const selected = datasetSelectValueMap.get(value as string);
                        if (!selected) {
                          return String(value);
                        }
                        return (
                          <span className="flex min-w-0 items-center gap-3 py-0.5 leading-tight">
                            <DatasetFolderPreview
                              folder={selected.folder}
                              className="h-10 w-14 shrink-0"
                            />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-sm text-zinc-100">
                                {selected.name}
                              </span>
                              <span className="truncate text-xs text-zinc-400">
                                {selected.meta}
                              </span>
                            </span>
                          </span>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>所有資料集</SelectLabel>
                      {datasetFolders.map((folder) => {
                        const disabled =
                          !folder.isRegistered ||
                          folder.health !== "ready" ||
                          !folder.datasetId;
                        return (
                          <SelectItem
                            key={folder.path}
                            value={folder.datasetId ?? `folder:${folder.path}`}
                            disabled={disabled}
                          >
                            <div className="flex items-center gap-3 py-0.5">
                              <DatasetFolderPreview
                                folder={folder}
                                className="h-10 w-14 shrink-0"
                              />
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-sm text-zinc-100">
                                  {getDatasetDisplayName(folder, datasetNameById)}
                                </span>
                                <span className="text-xs text-zinc-400">
                                  {formatDatasetFolderMeta(folder)}
                                </span>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-[1rem] border border-cyan-300/18 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50">
                新增資料集功能已移到資料集頁面。若目前沒有可用資料集，請先前往資料集頁面新增資料集，再回來建立任務。
              </div>

              {datasetFolders.length === 0 ? (
                <p className="text-sm text-amber-200">
                  目前沒有偵測到資料夾，請先前往資料集頁面新增資料集或確認 DATASETS_DIR。
                </p>
              ) : selectableFolders.length === 0 ? (
                <p className="text-sm text-amber-200">
                  目前沒有可建立任務的 dataset，請先排除資料集頁面的錯誤狀態或等待寫入完成。
                </p>
              ) : null}
            </SourcePanel>

            <SourcePanel
              title="資料集格式"
              description="建立任務前請先確認資料集根目錄結構正確，避免上傳或註冊後才發現格式不符。"
              active={false}
            >
              <DatasetStructureGuide />
            </SourcePanel>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void goStepTwo()}>下一步：參數設定</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <ParameterPanel
              title="資料集與命名"
              description="這裡只顯示目前要訓練的資料集；若要新增、重新命名或刪除資料集，請到資料集頁面處理。"
            >
              <div>
                <Label>目前資料集</Label>
                <Input className="mt-2" value={activeDatasetLabel} disabled />
              </div>
              <Link
                to="/datasets"
                className={cn(
                  "glass-panel inline-flex items-center justify-center rounded-lg border-0 bg-background px-2.5 py-2 text-sm font-medium transition-all hover:bg-muted hover:text-foreground dark:bg-input/30 dark:hover:bg-input/50",
                )}
              >
                前往資料集頁面管理資料集
              </Link>
            </ParameterPanel>

            <ParameterPanel
              title="核心訓練參數"
              description="先決定主要訓練強度與資料讀取策略，維持高頻操作的清楚度。"
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ParameterMetric
                  label="iterations"
                  value={form.iterations.toLocaleString()}
                  hint="steps"
                />
                <ParameterMetric
                  label="max cap"
                  value={form.maxCap.toLocaleString()}
                  hint="memory / density ceiling"
                />
                <ParameterMetric
                  label="resize"
                  value={String(form.resizeFactor)}
                  hint="input scale"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
                  <Label>Iterations</Label>
                  <input
                    type="range"
                    min={5000}
                    max={200000}
                    step={1000}
                    value={form.iterations}
                    onChange={(e) =>
                      updateForm("iterations", Number(e.target.value))
                    }
                    className="range-dark mt-3 w-full"
                  />
                </div>
                <div className="glass-panel rounded-[1rem] border-0 bg-black/30 p-4">
                  <Label>Max Cap</Label>
                  <input
                    type="range"
                    min={100000}
                    max={10000000}
                    step={50000}
                    value={form.maxCap}
                    onChange={(e) =>
                      updateForm("maxCap", Number(e.target.value))
                    }
                    className="range-dark mt-3 w-full"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Strategy</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["mcmc", "adc", "igs+", "lfs"] as const).map(
                      (strategy) => (
                        <Button
                          key={strategy}
                          className="uppercase"
                          variant={
                            form.strategy === strategy ? "default" : "outline"
                          }
                          onClick={() =>
                            setForm((prev) =>
                              applyVisibleStrategyDefaults(prev, strategy),
                            )
                          }
                          type="button"
                        >
                          {strategy}
                        </Button>
                      ),
                    )}
                  </div>
                  <FieldHint>訓練/密度化策略</FieldHint>
                </div>
                <div>
                  <Label>SH Degree</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={1}
                    value={form.shDegree}
                    onChange={(e) =>
                      updateForm("shDegree", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    球諧函數階數，控制外觀表達能力；值越高，顏色/光照表現越細，但成本也越高。
                  </FieldHint>
                </div>
                <div>
                  <Label>SH Degree Interval</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={100}
                    value={form.shDegreeInterval}
                    onChange={(e) =>
                      updateForm(
                        "shDegreeInterval",
                        Number(e.target.value || 0),
                      )
                    }
                  />
                  <FieldHint>
                    MCMC 會依間隔逐步提升 SH
                    階數；數值越小，越早增加外觀複雜度。
                  </FieldHint>
                </div>
                <div>
                  <Label>Min Opacity</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.minOpacity}
                    onChange={(e) =>
                      updateForm("minOpacity", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    不透明度下限，用來抑制過淡的高斯；調高可能讓模型更乾淨，但也可能吃掉細節。
                  </FieldHint>
                </div>
                <div>
                  <Label>Steps Scaler</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.stepsScaler}
                    onChange={(e) =>
                      updateForm("stepsScaler", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    依資料量放大訓練節奏；官方說明是依影像數量自動估算，調大通常代表更長的優化與延後某些階段切換。
                  </FieldHint>
                </div>
                <div>
                  <Label>Tile Mode</Label>
                  <Select
                    value={String(form.tileMode)}
                    onValueChange={(val) =>
                      updateForm("tileMode", Number(val) as 1 | 2 | 4)
                    }
                  >
                    <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>
                    大圖分塊渲染模式；較大的 tile
                    常有助於穩定處理高解析影像，但也會影響效能與記憶體行為。
                  </FieldHint>
                </div>
                <div>
                  <Label>Init Num Pts</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={1000}
                    value={form.initNumPts}
                    onChange={(e) =>
                      updateForm("initNumPts", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    隨機初始化時使用的點數；只有搭配 `--random` 才有意義。
                  </FieldHint>
                </div>
                <div>
                  <Label>Init Extent</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.initExtent}
                    onChange={(e) =>
                      updateForm("initExtent", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    隨機初始化邊界盒大小；值越大，初始點雲分布範圍越廣。
                  </FieldHint>
                </div>
                <div>
                  <Label>Images Folder</Label>
                  <Input
                    className="mt-2"
                    value={form.images}
                    onChange={(e) => updateForm("images", e.target.value)}
                    placeholder="例如：images"
                  />
                  <FieldHint>
                    官方 CLI 的 `--images` 是影像子資料夾名稱，預設為
                    `images`，不是檔名萬用字元。
                  </FieldHint>
                </div>
                <div>
                  <Label>Test Every</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={10}
                    value={form.testEvery}
                    onChange={(e) =>
                      updateForm("testEvery", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    每隔多少 iteration 做一次測試/評估；設太小會增加額外開銷。
                  </FieldHint>
                </div>
                <div>
                  <Label>Max Width</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={64}
                    value={form.maxWidth}
                    onChange={(e) =>
                      updateForm("maxWidth", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    限制輸入影像最大寬度（像素）；可用來降低顯存與加快訓練。
                  </FieldHint>
                </div>
                <div>
                  <Label>Resize Factor</Label>
                  <Select
                    value={String(form.resizeFactor)}
                    onValueChange={(val) =>
                      updateForm(
                        "resizeFactor",
                        val === "auto"
                          ? "auto"
                          : (Number(val) as 1 | 2 | 4 | 8),
                      )
                    }
                  >
                    <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto</SelectItem>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">1/2</SelectItem>
                      <SelectItem value="4">1/4</SelectItem>
                      <SelectItem value="8">1/8</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldHint>
                    先對訓練影像降採樣；分母越大，解析度越低，速度越快但細節可能減少。
                  </FieldHint>
                </div>
              </div>
            </ParameterPanel>

            <ParameterPanel
              title="資料處理與進階訓練"
              description="整理遮罩、稀疏化、MIP、PPISP 與背景調變相關選項。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                {showMaskSettings ? (
                  <div>
                    <Label>Mask Mode</Label>
                    <Select
                      value={form.maskMode}
                      onValueChange={(val) =>
                        updateForm(
                          "maskMode",
                          val as CreateWizardValues["maskMode"],
                        )
                      }
                    >
                      <SelectTrigger className="mt-2 h-10 w-full rounded-xl bg-black/30 hover:bg-black/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">none</SelectItem>
                        <SelectItem value="segment">segment</SelectItem>
                        <SelectItem value="ignore">ignore</SelectItem>
                        <SelectItem value="alpha_consistent">
                          alpha_consistent
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldHint>
                      決定如何使用注意力遮罩，例如分割、忽略背景或維持 alpha
                      一致性。
                    </FieldHint>
                  </div>
                ) : (
                  <div className="rounded-[1rem] border border-dashed border-white/10 bg-black/20 p-4 md:col-span-2">
                    <p className="text-sm text-zinc-200">
                      目前 dataset 未偵測到可自動讀取的 masks 資料夾，因此隱藏
                      mask 相關設定。
                    </p>
                    <FieldHint>
                      參考 upstream，自動搜尋的資料夾名稱包含{" "}
                      {UPSTREAM_MASK_FOLDERS.join(" / ")}；若影像本身帶有 RGBA
                      alpha，也會自動作為遮罩來源。
                    </FieldHint>
                  </div>
                )}
                <div>
                  <Label>Sparsify Steps</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step={100}
                    value={form.sparsifySteps}
                    onChange={(e) =>
                      updateForm("sparsifySteps", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    啟用 sparsity
                    後的剪枝/稀疏化節奏；通常數值越小，壓縮動作越頻繁。
                  </FieldHint>
                </div>
                <div>
                  <Label>Init Rho</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.initRho}
                    onChange={(e) =>
                      updateForm("initRho", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    稀疏化初始化強度參數；屬於進階壓縮調整，建議有實驗需求時再改。
                  </FieldHint>
                </div>
                <div>
                  <Label>Prune Ratio</Label>
                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    max={1}
                    step="0.01"
                    value={form.pruneRatio}
                    onChange={(e) =>
                      updateForm("pruneRatio", Number(e.target.value || 0))
                    }
                  />
                  <FieldHint>
                    每輪稀疏化要裁掉的比例；過高可能快速壓縮，但也可能犧牲品質。
                  </FieldHint>
                </div>
                <div>
                  <Label>PPISP Sidecar</Label>
                  <Input
                    className="mt-2"
                    value={form.ppispSidecar}
                    onChange={(e) => updateForm("ppispSidecar", e.target.value)}
                    placeholder="例如：/data/ppisp/sidecar.json"
                  />
                  <FieldHint>
                    PPISP 外觀模型 sidecar
                    路徑；這是少數仍需要外部來源的進階欄位。
                  </FieldHint>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ToggleChip
                  checked={form.random}
                  label="random"
                  description="改用隨機點初始化，而不是依既有重建結果起步。"
                  onChange={(checked) => updateForm("random", checked)}
                />
                <ToggleChip
                  checked={form.noCpuCache}
                  label="no-cpu-cache"
                  description="停用 RAM 影像快取；通常只在快取造成壓力時才關閉。"
                  onChange={(checked) => updateForm("noCpuCache", checked)}
                />
                <ToggleChip
                  checked={form.noFsCache}
                  label="no-fs-cache"
                  description="停用磁碟影像快取；通常只在快取造成壓力時才關閉。"
                  onChange={(checked) => updateForm("noFsCache", checked)}
                />
                {showMaskSettings ? (
                  <ToggleChip
                    checked={form.invertMasks}
                    label="invert-masks"
                    description="控制是否反轉遮罩。"
                    onChange={(checked) => updateForm("invertMasks", checked)}
                  />
                ) : null}
                {showMaskSettings ? (
                  <ToggleChip
                    checked={form.noAlphaAsMask}
                    label="no-alpha-as-mask"
                    description="停用 RGBA alpha 自動當作遮罩來源。"
                    onChange={(checked) => updateForm("noAlphaAsMask", checked)}
                  />
                ) : null}
                <ToggleChip
                  checked={form.enableSparsity}
                  label="enable-sparsity"
                  description="開啟模型壓縮/剪枝流程，適合想降低模型大小時使用。"
                  onChange={(checked) => updateForm("enableSparsity", checked)}
                />
                <ToggleChip
                  checked={form.enableMip}
                  label="enable-mip"
                  description="啟用 mip-splatting 抗鋸齒濾波，有助於高頻細節與縮放穩定性。"
                  onChange={(checked) => updateForm("enableMip", checked)}
                />
                <ToggleChip
                  checked={form.bilateralGrid}
                  label="bilateral-grid"
                  description="加入外觀嵌入，處理曝光或顏色不一致資料。"
                  onChange={(checked) => updateForm("bilateralGrid", checked)}
                />
                <ToggleChip
                  checked={form.ppisp}
                  label="ppisp"
                  description="啟用每相機外觀校正。"
                  onChange={(checked) => updateForm("ppisp", checked)}
                />
                <ToggleChip
                  checked={form.ppispController}
                  label="ppisp-controller"
                  description="新視角合成用控制器 CNN。"
                  onChange={(checked) => updateForm("ppispController", checked)}
                />
                <ToggleChip
                  checked={form.ppispFreeze}
                  label="ppisp-freeze"
                  description="從既有 sidecar 啟動時凍結部分高斯參數，避免外觀模型覆蓋原始幾何。"
                  onChange={(checked) => updateForm("ppispFreeze", checked)}
                />
                <ToggleChip
                  checked={form.bgModulation}
                  label="bg-modulation"
                  description="學習獨立背景顏色，對背景變化明顯的資料集較有幫助。"
                  onChange={(checked) => updateForm("bgModulation", checked)}
                />
              </div>
            </ParameterPanel>

            <ParameterPanel
              title="選用旗標"
              description="把常用布林選項整理成同樣尺寸的切換卡。"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ToggleChip
                  checked={form.eval}
                  label="eval"
                  description="訓練時同時跑評估流程，方便觀察品質指標。"
                  onChange={(checked) => updateForm("eval", checked)}
                />
                <ToggleChip
                  checked={form.saveEvalImages}
                  label="save-eval-images"
                  description="額外輸出評估影像或深度結果，會增加磁碟使用量。"
                  onChange={(checked) => updateForm("saveEvalImages", checked)}
                />
                <ToggleChip
                  checked={form.saveDepth}
                  label="save-depth"
                  description="額外輸出評估影像或深度結果，會增加磁碟使用量。"
                  onChange={(checked) => updateForm("saveDepth", checked)}
                />
                <ToggleChip
                  checked={form.gut}
                  label="gut"
                  description="啟用 3DGUT，適合失真相機模型；官方文件指出它不適用於 `adc` / `igs+`。"
                  onChange={(checked) => updateForm("gut", checked)}
                />
                <ToggleChip
                  checked={form.undistort}
                  label="undistort"
                  description="在訓練前先做影像畸變校正，適合需要標準 pinhole 訓練流程時使用。"
                  onChange={(checked) => updateForm("undistort", checked)}
                />
              </div>
            </ParameterPanel>

            <ParameterPanel
              title="進階 JSON 覆寫"
              description="僅在需要超出預設面板的參數時使用。"
            >
              <div>
                <Label>進階參數 JSON（可選）</Label>
                <Textarea
                  className="mt-2 min-h-[160px] font-mono text-xs"
                  placeholder='{"testEvery": 500, "enableMip": true}'
                  value={form.advancedJson}
                  onChange={(e) => updateForm("advancedJson", e.target.value)}
                />
              </div>
            </ParameterPanel>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <ParameterPanel
              title="建立任務摘要"
              description="送出前快速確認資料來源、策略與阻塞原因。"
            >
              <div className="space-y-3 text-sm text-zinc-300">
                <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                  <span className="text-zinc-500">dataset</span>
                  <span className="max-w-[60%] truncate text-right text-zinc-100">
                    {activeDatasetLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                  <span className="text-zinc-500">strategy</span>
                  <span className="text-zinc-100">{form.strategy}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                  <span className="text-zinc-500">iterations</span>
                  <span className="text-zinc-100">
                    {form.iterations.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/30 px-3 py-3">
                  <span className="text-zinc-500">mip / sparsity</span>
                  <span className="text-zinc-100">
                    {`${form.enableMip ? "mip on" : "mip off"} / ${form.enableSparsity ? "sparsity on" : "sparsity off"}`}
                  </span>
                </div>
              </div>
              <div
                className={`rounded-[1rem] border px-3 py-3 text-sm ${
                  submitting
                    ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                    : statusMessage.isBlocking
                      ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
                      : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                }`}
              >
                {statusMessage.text}
              </div>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  返回 Step 1
                </Button>
                <Button onClick={() => void submit()} disabled={!canSubmit}>
                  {submitting ? "建立中..." : "建立任務"}
                </Button>
              </div>
            </ParameterPanel>
          </div>
        </div>
      )}
    </div>
  );
}
