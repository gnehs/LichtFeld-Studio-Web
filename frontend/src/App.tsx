import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CircleIndicator } from "@/components/CircleIndicator";
import { LogOut } from "lucide-react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Toaster, toast } from "sonner";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { JobInsight, Notice } from "@/lib/app-types";
import type { DatasetRecord, SystemMetrics, TrainingJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { LoginView } from "@/features/auth/LoginView";
import { JobsPage } from "@/pages/JobsPage";
import { CreateJobPage } from "@/pages/CreateJobPage";
import { JobDetailPage } from "@/pages/JobDetailPage";

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && /unauthorized/i.test(error.message);
}

function DashboardShell({
  datasets,
  jobs,
  systemMetrics,
  onLogout,
  logoutPending,
}: {
  datasets: DatasetRecord[];
  jobs: TrainingJob[];
  systemMetrics: SystemMetrics | null;
  onLogout: () => Promise<void>;
  logoutPending: boolean;
}) {
  const location = useLocation();
  const onJobsRoute =
    location.pathname === "/" || location.pathname.startsWith("/jobs");

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const gpu = systemMetrics?.gpu.devices[0] ?? null;
  const vramText =
    gpu?.memoryUsedMiB !== null &&
    gpu?.memoryUsedMiB !== undefined &&
    gpu?.memoryTotalMiB !== null &&
    gpu?.memoryTotalMiB !== undefined
      ? `${(gpu.memoryUsedMiB / 1024).toFixed(1)} / ${(gpu.memoryTotalMiB / 1024).toFixed(1)} GB`
      : "-";

  return (
    <div className="bg-app-base min-h-screen pb-8 text-zinc-100">
      <header className="border-b border-white/10 bg-black/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
              LichtFeld Studio Web
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void onLogout()}
              disabled={logoutPending}
            >
              <LogOut className="size-4" />
              {logoutPending ? "登出中..." : "登出"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-4 max-w-7xl space-y-4 px-4">
        {onJobsRoute ? (
          <div className="flex w-full flex-wrap justify-center gap-2">
            <div className="min-w-20 rounded-full border border-white/8 bg-black/30 px-4 py-2">
              <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                訓練中
              </p>
              <div className="text-sm font-semibold text-zinc-50">
                {runningCount}
              </div>
            </div>
            <div className="min-w-20 rounded-full border border-white/8 bg-black/30 px-4 py-2">
              <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                佇列
              </p>
              <div className="text-sm font-semibold text-zinc-50">
                {queuedCount}
              </div>
            </div>
            <div className="min-w-20 rounded-full border border-white/8 bg-black/30 px-4 py-2">
              <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                資料集
              </p>
              <div className="text-sm font-semibold text-zinc-50">
                {datasets.length}
              </div>
            </div>
            <div className="flex min-w-30 items-center gap-3 rounded-full border border-white/8 bg-black/30 py-2 pr-4 pl-2">
              <CircleIndicator
                progress={gpu?.utilizationGpu ?? 0}
                size={32}
                color="var(--chart-1)"
              />
              <div>
                <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                  {gpu?.name ? gpu.name : "GPU"}
                </p>
                <div className="text-sm font-semibold text-zinc-50">
                  {gpu?.utilizationGpu ?? "-"}
                </div>
              </div>
            </div>
            <div className="flex min-w-30 items-center gap-3 rounded-full border border-white/8 bg-black/30 py-2 pr-4 pl-2">
              <CircleIndicator
                progress={
                  gpu?.memoryUsedPercent !== null &&
                  gpu?.memoryUsedPercent !== undefined
                    ? gpu.memoryUsedPercent
                    : 0
                }
                size={32}
                color="var(--chart-1)"
              />
              <div>
                <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                  VRAM
                </p>
                <div className="text-sm font-semibold text-zinc-50">
                  {vramText}
                </div>
              </div>
            </div>
            <div className="flex min-w-30 items-center gap-3 rounded-full border border-white/8 bg-black/30 py-2 pr-4 pl-2">
              <CircleIndicator
                progress={systemMetrics ? systemMetrics.memory.usedPercent : 0}
                size={32}
                color="var(--chart-1)"
              />
              <div>
                <p className="text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
                  RAM
                </p>
                <div className="text-sm font-semibold text-zinc-50">
                  {systemMetrics
                    ? `${systemMetrics.memory.usedGb.toFixed(1)} / ${systemMetrics.memory.totalGb.toFixed(1)} GB`
                    : "-"}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const setNoticeText = useCallback((next: Notice) => {
    if (next.tone === "success") {
      toast.success(next.text);
      return;
    }
    if (next.tone === "error") {
      toast.error(next.text);
      return;
    }
    toast.message(next.text);
  }, []);

  const guardAuth = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        if (isUnauthorizedError(error)) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
        }
        throw error;
      }
    },
    [queryClient],
  );

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  });

  const authed = meQuery.data?.authenticated === true;

  const datasetsQuery = useQuery({
    queryKey: queryKeys.datasets.all,
    queryFn: () => guardAuth(() => api.listDatasets()),
    enabled: authed,
  });

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: () => guardAuth(() => api.listJobs()),
    enabled: authed,
    refetchInterval: 5_000,
  });

  const systemMetricsQuery = useQuery({
    queryKey: queryKeys.system.metrics,
    queryFn: () => guardAuth(() => api.systemMetrics()),
    enabled: authed,
    refetchInterval: 5_000,
  });

  const jobs = jobsQuery.data?.items ?? [];
  const datasets = datasetsQuery.data?.items ?? [];
  const datasetFolders = datasetsQuery.data?.folders ?? [];
  const systemMetrics = systemMetricsQuery.data ?? null;

  const insightQueries = useQueries({
    queries: jobs.map((job) => ({
      queryKey: queryKeys.jobs.timelapseLatest(job.id),
      queryFn: () => guardAuth(() => api.getTimelapseLatest(job.id)),
      enabled: authed,
      staleTime: 3_000,
      refetchInterval: 5_000,
      retry: 0,
    })),
  });

  const insights = useMemo<Record<string, JobInsight>>(() => {
    return jobs.reduce<Record<string, JobInsight>>((acc, job, index) => {
      const latest = insightQueries[index]?.data?.items ?? [];
      const newest = latest.reduce<{
        filePath: string | null;
        iteration: number | null;
      }>(
        (current, frame) => {
          if (
            current.iteration === null ||
            frame.iteration > current.iteration
          ) {
            return { filePath: frame.filePath, iteration: frame.iteration };
          }
          return current;
        },
        { filePath: null, iteration: null },
      );
      acc[job.id] = {
        latestFramePath: newest.filePath,
        latestIteration: newest.iteration,
      };
      return acc;
    }, {});
  }, [jobs, insightQueries]);

  const logoutMutation = useMutation({
    mutationFn: () => guardAuth(() => api.logout()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      queryClient.removeQueries({ queryKey: queryKeys.jobs.all });
      queryClient.removeQueries({ queryKey: queryKeys.datasets.all });
      queryClient.removeQueries({ queryKey: queryKeys.system.metrics });
    },
    onError: (error) => {
      setNoticeText({
        tone: "error",
        text: `登出失敗：${(error as Error).message}`,
      });
    },
  });

  const stopJobMutation = useMutation({
    mutationFn: (id: string) => guardAuth(() => api.stopJob(id)),
    onSuccess: async (_result, id) => {
      setNoticeText({ tone: "success", text: `任務 ${id} 已送出停止指令` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.timelapseLatest(id),
      });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => guardAuth(() => api.deleteJob(id, false)),
    onSuccess: async (_result, id) => {
      setNoticeText({ tone: "success", text: `任務 ${id} 已刪除` });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (datasetsQuery.error) {
      setNoticeText({
        tone: "error",
        text: `讀取資料集失敗：${(datasetsQuery.error as Error).message}`,
      });
    }
  }, [datasetsQuery.error, datasetsQuery.errorUpdatedAt, setNoticeText]);

  useEffect(() => {
    if (jobsQuery.error) {
      setNoticeText({
        tone: "error",
        text: `讀取任務失敗：${(jobsQuery.error as Error).message}`,
      });
    }
  }, [jobsQuery.error, jobsQuery.errorUpdatedAt, setNoticeText]);

  useEffect(() => {
    if (systemMetricsQuery.error) {
      setNoticeText({
        tone: "error",
        text: `讀取系統資訊失敗：${(systemMetricsQuery.error as Error).message}`,
      });
    }
  }, [
    setNoticeText,
    systemMetricsQuery.error,
    systemMetricsQuery.errorUpdatedAt,
  ]);

  if (meQuery.isPending) {
    return <div className="p-8 text-zinc-300">Loading...</div>;
  }

  if (!authed) {
    return (
      <LoginView
        onLogin={() =>
          void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me })
        }
      />
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardShell
              datasets={datasets}
              jobs={jobs}
              systemMetrics={systemMetrics}
              onLogout={async () => {
                await logoutMutation.mutateAsync();
              }}
              logoutPending={logoutMutation.isPending}
            />
          }
        >
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route
            path="jobs"
            element={
              <JobsPage
                jobs={jobs}
                insights={insights}
                nowMs={nowMs}
                onCreate={() => navigate("/create")}
                onRefresh={async () => {
                  await jobsQuery.refetch({ throwOnError: true });
                }}
                onStop={async (id) => {
                  try {
                    await stopJobMutation.mutateAsync(id);
                  } catch (error) {
                    setNoticeText({
                      tone: "error",
                      text: `停止任務失敗：${(error as Error).message}`,
                    });
                  }
                }}
                onDelete={async (id) => {
                  const ok = window.confirm(
                    "確定要刪除此任務？\n按「確定」會保留 Timelapse 檔案。",
                  );
                  if (!ok) return;
                  try {
                    await deleteJobMutation.mutateAsync(id);
                  } catch (error) {
                    setNoticeText({
                      tone: "error",
                      text: `刪除失敗：${(error as Error).message}`,
                    });
                  }
                }}
                onOpenDetail={(id) => navigate(`/jobs/${id}`)}
              />
            }
          />
          <Route
            path="jobs/:id"
            element={<JobDetailPage onNotice={setNoticeText} />}
          />
          <Route
            path="create"
            element={
              <CreateJobPage
                datasets={datasets}
                datasetFolders={datasetFolders}
                onCancel={() => navigate("/jobs")}
                onDatasetCreated={(dataset) => {
                  void dataset;
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.datasets.all,
                  });
                }}
                onCreated={async () => {
                  await Promise.all([
                    queryClient.invalidateQueries({
                      queryKey: queryKeys.datasets.all,
                    }),
                    queryClient.invalidateQueries({
                      queryKey: queryKeys.jobs.all,
                    }),
                  ]);
                  navigate("/jobs");
                }}
                onNotice={setNoticeText}
                onRefreshDatasets={async () => {
                  await datasetsQuery.refetch({ throwOnError: true });
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}

export default App;
