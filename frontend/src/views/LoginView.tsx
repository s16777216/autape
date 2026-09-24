import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("請輸入帳號與密碼");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "登入失敗");
      }

      login(data);
      toast.success(`歡迎回來，${data.username}！`);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "登入發生錯誤");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6 space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Autape E2E Manager</h1>
          <p className="text-sm text-zinc-400">請登入您的帳號以繼續操作</p>
        </div>

        <Card className="border-zinc-800 bg-zinc-900/60 backdrop-blur shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg text-zinc-100">系統登入</CardTitle>
            <CardDescription className="text-zinc-400 text-xs">
              預設管理員帳號：<span className="font-mono text-indigo-300">admin</span> / 密碼：<span className="font-mono text-indigo-300">admin123</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">帳號 (Username)</label>
                <Input
                  type="text"
                  placeholder="輸入帳號"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-zinc-950/60 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">密碼 (Password)</label>
                <Input
                  type="password"
                  placeholder="輸入密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-zinc-950/60 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    登入中...
                  </>
                ) : (
                  "登入系統"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
