import type { ReactNode } from "react";
import { Play, Clock, Database } from "lucide-react";
import type { TrainingJob } from "@/lib/types";
import { Link } from "react-router-dom";

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

export function DashboardOverview({
  jobs,
  datasetCount,
}: {
  jobs: TrainingJob[];
  datasetCount: number;
}) {
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

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
    </div>
  );
}