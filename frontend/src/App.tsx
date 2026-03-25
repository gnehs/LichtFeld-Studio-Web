import { useCallback, useEffect, useState } from "react";
import { ImagePlus, ListChecks, LogOut } from "lucide-react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { api } from "@/lib/api";
import type { JobInsight, Notice } from "@/lib/app-types";
import type { DatasetFolderEntry, DatasetRecord, TrainingJob } from "@/lib/types";
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
  setAuthed,
  jobs
}: {
  datasets: DatasetRecord[];
  jobs: TrainingJob[];
  setAuthed: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const location = useLocation();
  const onJobsRoute = location.pathname === "/" || location.pathname.startsWith("/jobs");

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

  return (
    <div className="min-h-screen bg-app-base pb-8 text-zinc-100">
      <header className="border-b border-white/10 bg-black/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">LichtFeld-Studio 任務控制台</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant={onJobsRoute ? "default" : "outline"}>
              <Link to="/jobs">
                <ListChecks className="mr-2 h-4 w-4" /> 任務首頁
              </Link>
            </Button>
            <Button asChild variant={location.pathname === "/create" ? "default" : "outline"}>
              <Link to="/create">
                <ImagePlus className="mr-2 h-4 w-4" /> 建立任務
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.logout();
                setAuthed(false);
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-4 max-w-7xl space-y-4 px-4">
        {onJobsRoute ? (
          <section className="panel-grid noise-overlay relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="grid gap-3 md:grid-cols-[1.6fr_1fr]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">overview</p>
                <h2 className="mt-2 max-w-2xl text-2xl font-semibold leading-tight text-zinc-50">訓練控制台</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">即時監看任務進度、排隊狀態與資料集操作。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">running</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{runningCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">queued</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{queuedCount}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">datasets</p>
                  <div className="mt-2 text-2xl font-semibold text-zinc-50">{datasets.length}</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [datasetFolders, setDatasetFolders] = useState<DatasetFolderEntry[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [insights, setInsights] = useState<Record<string, JobInsight>>({});
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

  const refreshDatasets = useCallback(async () => {
    const res = await api.listDatasets();
    setDatasets(res.items);
    setDatasetFolders(res.folders ?? []);
  }, []);

  const refreshJobs = useCallback(async () => {
    const res = await api.listJobs();
    setJobs(res.items);

    if (res.items.length === 0) {
      setInsights({});
      return;
    }

    const settled = await Promise.allSettled(
      res.items.map(async (job) => {
        const latest = await api.getTimelapseLatest(job.id);
        const newest = latest.items.reduce<{ filePath: string | null; iteration: number | null }>(
          (acc, frame) => {
            if (!acc.iteration || frame.iteration > acc.iteration) {
              return { filePath: frame.filePath, iteration: frame.iteration };
            }
            return acc;
          },
          { filePath: null, iteration: null }
        );

        return {
          id: job.id,
          value: {
            latestFramePath: newest.filePath,
            latestIteration: newest.iteration
          }
        };
      })
    );

    const next: Record<string, JobInsight> = {};
    settled.forEach((result, index) => {
      const jobId = res.items[index]?.id;
      if (!jobId) return;
      if (result.status === "fulfilled") {
        next[result.value.id] = result.value.value;
      } else {
        next[jobId] = { latestFramePath: null, latestIteration: null };
      }
    });

    setInsights(next);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authed) return;

    let cancelled = false;

    const load = async () => {
      try {
        await Promise.all([refreshDatasets(), refreshJobs()]);
      } catch (error) {
        if (!cancelled && isUnauthorizedError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          try {
            await Promise.all([refreshDatasets(), refreshJobs()]);
            return;
          } catch (retryError) {
            if (!cancelled && isUnauthorizedError(retryError)) {
              setAuthed(false);
              return;
            }
            if (!cancelled) {
              setNoticeText({ tone: "error", text: `讀取資料失敗：${(retryError as Error).message}` });
            }
            return;
          }
        }
        if (!cancelled) {
          setNoticeText({ tone: "error", text: `讀取資料失敗：${(error as Error).message}` });
        }
      }
    };

    void load();

    const timer = setInterval(() => {
      void refreshJobs().catch((error) => {
        if (!cancelled && isUnauthorizedError(error)) {
          setAuthed(false);
          return;
        }
        if (!cancelled) {
          setNoticeText({ tone: "error", text: `任務更新失敗：${(error as Error).message}` });
        }
      });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authed, refreshDatasets, refreshJobs, setNoticeText]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!ready) {
    return <div className="p-8 text-zinc-300">Loading...</div>;
  }

  if (!authed) {
    return <LoginView onLogin={() => setAuthed(true)} />;
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={<DashboardShell datasets={datasets} jobs={jobs} setAuthed={setAuthed} />}
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
                onRefresh={refreshJobs}
                onStop={async (id) => {
                  try {
                    await api.stopJob(id);
                    setNoticeText({ tone: "success", text: `任務 ${id} 已送出停止指令` });
                    await refreshJobs();
                  } catch (error) {
                    setNoticeText({ tone: "error", text: `停止任務失敗：${(error as Error).message}` });
                  }
                }}
                onDelete={async (id) => {
                  const ok = window.confirm("確定要刪除此任務？\n按「確定」會保留 Timelapse 檔案。");
                  if (!ok) return;
                  try {
                    await api.deleteJob(id, false);
                    setNoticeText({ tone: "success", text: `任務 ${id} 已刪除` });
                    await refreshJobs();
                  } catch (error) {
                    setNoticeText({ tone: "error", text: `刪除失敗：${(error as Error).message}` });
                  }
                }}
                onOpenDetail={(id) => navigate(`/jobs/${id}`)}
              />
            }
          />
          <Route path="jobs/:id" element={<JobDetailPage onNotice={setNoticeText} />} />
          <Route
            path="create"
            element={
              <CreateJobPage
                datasets={datasets}
                datasetFolders={datasetFolders}
                onCancel={() => navigate("/jobs")}
                onDatasetCreated={(dataset) => {
                  setDatasets((prev) => {
                    const without = prev.filter((item) => item.id !== dataset.id);
                    return [dataset, ...without];
                  });
                }}
                onCreated={async () => {
                  await Promise.all([refreshDatasets(), refreshJobs()]);
                  navigate("/jobs");
                }}
                onNotice={setNoticeText}
                onRefreshDatasets={refreshDatasets}
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
