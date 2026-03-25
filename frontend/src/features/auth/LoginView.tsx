import { useState } from "react";
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

  const submit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    try {
      setError(null);
      await api.login(password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto  max-w-md px-4 py-12">
      <Card className="relative  overflow-hidden border-white/10 bg-black/55">
        <CardHeader>
          <CardTitle className="font-semibold text-zinc-50">
            LichtFeld-Studio Web
          </CardTitle>
          <CardDescription>請輸入管理密碼以進入暗色控制台。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <Button className="w-full" type="submit">
              Login
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
