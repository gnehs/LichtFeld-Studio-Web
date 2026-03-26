import type { ReactNode } from "react";
import { CircleIndicator } from "@/components/CircleIndicator";
import { Play, Clock, Database, Gpu, MemoryStick } from "lucide-react";
import type { SystemMetrics, TrainingJob } from "@/lib/types";

const baseCardClass = "rounded-full border border-white/8 bg-black/30";
const metricLabelClass = "text-[10px] text-zinc-500 leading-3";

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div
      className={`py-1.5 pr-4 pl-1.5 max-md:w-full md:min-w-24 ${baseCardClass} flex items-center gap-2`}
    >
      <div className="grid size-8 shrink-0 place-content-center rounded-full border border-white/10 bg-linear-to-b from-white/10 to-white/5">
        <div className="relative">
          <div className="drop-shadow-2xl">{icon}</div>
          <div className="absolute inset-0 opacity-20 blur-xs">{icon}</div>
        </div>
      </div>
      <div>
        <p className={metricLabelClass}>{label}</p>
        <div className="text-sm font-semibold text-zinc-50">{value}</div>
      </div>
    </div>
  );
}

function UsageCard({
  label,
  value,
  progress,
  icon,
}: {
  label: string;
  value: ReactNode;
  progress: number;
  icon: ReactNode;
}) {
  return (
    <div
      className={`relative flex items-center gap-2 overflow-hidden py-1.5 pr-4 pl-1.5 max-md:w-full md:min-w-30 ${baseCardClass}`}
    >
      <CircleIndicator progress={progress} size={28} color="var(--chart-1)" />
      <div>
        <p className={metricLabelClass}>{label}</p>
        <div className="text-sm font-semibold text-zinc-50">{value}</div>
      </div>
      <div className="absolute right-2 bottom-0 m-auto opacity-10">{icon}</div>
    </div>
  );
}

export function DashboardOverview({
  jobs,
  datasetCount,
  systemMetrics,
}: {
  jobs: TrainingJob[];
  datasetCount: number;
  systemMetrics: SystemMetrics | null;
}) {
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const gpu = systemMetrics?.gpu.devices[0] ?? null;

  const summaryCards = [
    {
      label: "訓練中",
      value: runningCount,
      icon: <Play size={16} className="text-green-400" />,
    },
    {
      label: "佇列",
      value: queuedCount,
      icon: <Clock size={16} className="text-yellow-400" />,
    },
    {
      label: "資料集",
      value: datasetCount,
      icon: <Database size={16} className="text-blue-400" />,
    },
  ];

  const usageCards = [
    {
      label: gpu?.name || "GPU",
      value: gpu?.utilizationGpu ? `${gpu.utilizationGpu}%` : "-",
      progress: gpu?.utilizationGpu ?? 0,
      icon: <Gpu size={32} className="text-white" />,
    },
    {
      label: "VRAM",
      value:
        gpu?.memoryUsedMiB !== null &&
        gpu?.memoryUsedMiB !== undefined &&
        gpu?.memoryTotalMiB !== null &&
        gpu?.memoryTotalMiB !== undefined ? (
          <>
            <span>{(gpu.memoryUsedMiB / 1024).toFixed(1)}GB</span>
            <span className="text-xs opacity-75">
              {" "}
              / {(gpu.memoryTotalMiB / 1024).toFixed(1)}GB
            </span>
          </>
        ) : (
          "-"
        ),
      progress: gpu?.memoryUsedPercent ?? 0,
      icon: <MemoryStick size={32} className="text-white" />,
    },
    {
      label: "RAM",
      value: systemMetrics ? (
        <>
          <span>{systemMetrics.memory.usedGb.toFixed(1)}</span>
          <span className="text-xs opacity-75">
            {" "}
            / {systemMetrics.memory.totalGb}GB
          </span>
        </>
      ) : (
        "-"
      ),
      progress: systemMetrics?.memory.usedPercent ?? 0,
      icon: <MemoryStick size={32} className="text-white" />,
    },
  ];

  return (
    <div className="flex flex-wrap justify-between gap-2">
      <div className="grid grid-cols-3 flex-wrap items-center justify-center gap-2 max-md:w-full md:flex">
        {summaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 justify-center gap-2 max-md:w-full md:flex md:flex-wrap">
        {usageCards.map((card) => (
          <UsageCard
            key={card.label}
            label={card.label}
            value={card.value}
            progress={card.progress}
            icon={card.icon}
          />
        ))}
      </div>
    </div>
  );
}
