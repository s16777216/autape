import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BaseDialog } from "@/components/custom/BaseDialog";
import { DataTable } from "@/components/custom/table/DataTable";
import Typography from "@/components/custom/Typography";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, UserPlus, Shield, User as UserIcon, Plus } from "lucide-react";
import { toast } from "sonner";

interface UserItem {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
}

const columns: ColumnDef<UserItem>[] = [
  {
    accessorKey: "username",
    header: "帳號",
    cell: ({ row }) => {
      const u = row.original;
      return (
        <span className="font-medium text-zinc-100 flex items-center gap-2">
          {u.role === "admin" ? (
            <Shield size={16} className="text-indigo-400" />
          ) : (
            <UserIcon size={16} className="text-zinc-400" />
          )}
          {u.username}
        </span>
      );
    },
  },
  {
    accessorKey: "email",
    header: "電子郵件",
    cell: ({ row }) => (
      <span className="text-zinc-300 font-mono text-xs">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "role",
    header: "權限",
    cell: ({ row }) => {
      const role = row.original.role;
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            role === "admin"
              ? "bg-indigo-950 text-indigo-300 border border-indigo-800/50"
              : "bg-zinc-800 text-zinc-300 border border-zinc-700/50"
          }`}
        >
          {role.toUpperCase()}
        </span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: "建立時間",
    cell: ({ row }) => (
      <span className="text-zinc-400 text-xs">
        {new Date(row.original.createdAt).toLocaleString()}
      </span>
    ),
  },
];

export default function UserManagementView() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(() => {
    fetch("/api/users")
      .then(async (res) => {
        if (!res.ok) throw new Error("無法取得使用者列表");
        setUsers(await res.json());
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "載入使用者失敗");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) {
      toast.error("帳號與密碼為必填");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "新增使用者失敗");

      toast.success(`成功建立使用者：${data.username}`);
      setShowAddDialog(false);
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("member");
      fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 text-zinc-100 p-8 select-none">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <UserIcon size={28} />
          <Typography type="h3">使用者管理</Typography>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus size={16} className="mr-2" /> 新增使用者
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-zinc-400">
          <Loader2 className="animate-spin mr-2" size={20} />
          載入成員列表中...
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-zinc-500 gap-4">
          <UserIcon size={48} className="text-zinc-700" />
          <Typography type="p">
            尚無成員資料，點擊右上角「新增使用者」開始建立。
          </Typography>
        </div>
      ) : (
        <DataTable columns={columns} data={users}></DataTable>
      )}

      <BaseDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        title={
          <span className="flex items-center gap-2 text-indigo-400">
            <UserPlus size={20} /> 新增系統使用者
          </span>
        }
        description="建立新的平台成員帳號與初始密碼。"
        height="320px"
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddDialog(false)}
              className="bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-100 cursor-pointer"
            >
              取消
            </Button>
            <Button
              type="submit"
              form="add-user-form"
              disabled={submitting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
            >
              {submitting && <Loader2 className="animate-spin mr-2" size={16} />}
              確認建立
            </Button>
          </div>
        }
      >
        <form id="add-user-form" onSubmit={handleCreateUser} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">帳號 *</label>
              <Input
                required
                placeholder="例如 john_doe"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">電子郵件</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">密碼 *</label>
              <Input
                required
                type="password"
                placeholder="至少 6 位密碼"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-zinc-100"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">權限</label>
              <Select value={newRole} onValueChange={(val) => setNewRole(val as "admin" | "member")}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">一般成員</SelectItem>
                  <SelectItem value="admin">系統管理員</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </form>
      </BaseDialog>
    </div>
  );
}
