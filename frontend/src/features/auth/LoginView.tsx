import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loginMutation = useMutation({
    mutationFn: (nextPassword: string) => api.login(nextPassword),
    onSuccess: () => {
      setError(null);
      onLogin();
    },
    onError: (err) => {
      setError((err as Error).message);
    },
  });

  const submit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError(null);
    await loginMutation.mutateAsync(password);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
      <Card className="relative min-w-80 border-white/10 bg-black/55">
        <CardHeader>
          <CardTitle className="font-semibold text-zinc-50">
            LichtFeld Studio Web
          </CardTitle>
          <CardDescription>請輸入管理密碼以進入控制台。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
            />
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <Button
              className="w-full"
              type="submit"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "登入中..." : "登入"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
