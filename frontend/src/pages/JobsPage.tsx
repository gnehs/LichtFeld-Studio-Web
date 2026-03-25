import { TaskList } from "@/features/jobs/TaskList";
import type { JobInsight } from "@/lib/app-types";
import type { TrainingJob } from "@/lib/types";

export function JobsPage({
  jobs,
  insights,
  nowMs,
  onCreate,
  onRefresh,
  onStop,
  onDelete
}: {
  jobs: TrainingJob[];
  insights: Record<string, JobInsight>;
  nowMs: number;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <section data-route="jobs">
      <TaskList jobs={jobs} insights={insights} nowMs={nowMs} onCreate={onCreate} onRefresh={onRefresh} onStop={onStop} onDelete={onDelete} />
    </section>
  );
}
