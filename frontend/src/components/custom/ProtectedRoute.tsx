import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  requiredRole?: "admin" | "member";
}

export default function ProtectedRoute({ requiredRole }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <Loader2 className="animate-spin mr-2" size={24} />
        正在驗證登入狀態...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole === "admin" && user.role !== "admin") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-200 p-6">
        <h1 className="text-xl font-bold text-red-400 mb-2">403 - 權限不足</h1>
        <p className="text-sm text-zinc-400 mb-4">您沒有權限存取此頁面，此功能僅限系統管理員（Admin）使用。</p>
        <a href="/" className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md text-sm transition-colors">
          返回首頁
        </a>
      </div>
    );
  }

  return <Outlet />;
}
