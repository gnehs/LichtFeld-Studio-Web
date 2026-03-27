import { Link } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppHeader({
  onLogout,
  logoutPending,
}: {
  onLogout: () => Promise<void>;
  logoutPending: boolean;
}) {
  return (
    <header className="border-b border-white/10 bg-black/20 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
            LichtFeld Studio Web
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/jobs" className={cn(buttonVariants({ variant: "outline" }))}>
            任務
          </Link>
          <Link to="/datasets" className={cn(buttonVariants({ variant: "outline" }))}>
            資料集
          </Link>
          <Button variant="outline" onClick={() => void onLogout()} disabled={logoutPending}>
            <LogOut className="size-4" />
            {logoutPending ? "登出中..." : "登出"}
          </Button>
        </div>
      </div>
    </header>
  );
}
