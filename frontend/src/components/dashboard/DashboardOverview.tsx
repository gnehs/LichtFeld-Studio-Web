import type { ReactNode } from "react";
import { CircleIndicator } from "@/components/CircleIndicator";
import { Play, Clock, Database, Gpu, MemoryStick } from "lucide-react";
import type { SystemMetrics, TrainingJob } from "@/lib/types";

const metricLabelClass = "text-[10px] text-zinc-500 leading-[1em] ";

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
      className={`glass-panel flex items-center gap-2 rounded-full py-1 pr-4 pl-1 max-md:w-full md:min-w-24`}
    >
      <div className="glass-panel grid size-8 shrink-0 place-content-center rounded-full">
        <div className="icon-mask">{icon}</div>
      </div>
      <div className="relative flex flex-col gap-0.5 text-shadow-sm">
        <p className={metricLabelClass}>{label}</p>
        <div className="bg-linear-to-b from-zinc-100 to-zinc-400 bg-clip-text font-mono text-sm leading-[1em] font-semibold text-transparent">
          {value}
        </div>
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
      className={`glass-panel flex items-center gap-2 overflow-hidden rounded-full py-1 pr-4 pl-1 max-md:w-full md:min-w-30`}
    >
      <CircleIndicator
        progress={progress}
        size={28}
        color="var(--chart-1)"
        trackColor="rgba(255, 255, 255, 0.05)"
      />
      <div className="relative flex flex-col gap-0.5 text-shadow-sm">
        <p className={metricLabelClass}>{label}</p>
        <div className="bg-linear-to-b from-zinc-100 to-zinc-400 bg-clip-text font-mono text-sm leading-[1em] font-semibold text-transparent">
          {value}
        </div>
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
  const gpuUtilization = gpu?.utilizationGpu;

  const summaryCards = [
    {
      label: "訓練中",
      value: runningCount,
      icon: <Play size={16} className="text-green-400" strokeWidth={2.5} />,
    },
    {
      label: "佇列",
      value: queuedCount,
      icon: <Clock size={16} className="text-yellow-400" strokeWidth={2.5} />,
    },
    {
      label: "資料集",
      value: datasetCount,
      icon: <Database size={16} className="text-blue-400" strokeWidth={2.5} />,
    },
  ];

  const usageCards = [
    {
      label: gpu?.name || "GPU",
      value:
        gpuUtilization !== null && gpuUtilization !== undefined
          ? `${gpuUtilization}%`
          : "-",
      progress: gpuUtilization ?? 0,
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
            <span>{(gpu.memoryUsedMiB / 1024).toFixed(1)}</span>
            <span className="mx-0.5 text-[10px]">/</span>
            <span className="text-[10px]">
              {(gpu.memoryTotalMiB / 1024).toFixed(1)}GB
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
          <span className="mx-0.5 text-[10px]">/</span>
          <span className="text-[10px]">{systemMetrics.memory.totalGb}GB</span>
        </>
      ) : (
        "-"
      ),
      progress: systemMetrics?.memory.usedPercent ?? 0,
      icon: <MemoryStick size={32} className="text-white" />,
    },
  ];

  return (
    <div className="mb-4 flex flex-wrap justify-between gap-2 border-b border-white/10 pb-4">
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
