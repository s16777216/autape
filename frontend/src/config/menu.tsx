import type { ReactNode } from "react";
import { HomeIcon } from "@/components/icon/home";
import { FoldersIcon } from "@/components/icon/folders";
import { HistoryIcon } from "@/components/icon/history";
import { SettingsIcon } from "@/components/icon/settings";
import { Bot } from "lucide-react";
import { User as UserIcon } from "lucide-react";

export interface MenuItem {
  title: string;
  path: string;
  iconNode: ReactNode;
}

export const sidebarMenuItems: MenuItem[] = [
  {
    title: "首頁",
    path: "/",
    iconNode: <HomeIcon size={16} />,
  },
  {
    title: "專案管理",
    path: "/project",
    iconNode: <FoldersIcon size={16} />,
  },
  {
    title: "執行紀錄",
    path: "/tasks",
    iconNode: <HistoryIcon size={16} />,
  },
  {
    title: "系統設定",
    path: "/settings",
    iconNode: <SettingsIcon size={16} />,
  },
  {
    title: "使用者管理",
    path: "/users",
    iconNode: <UserIcon size={16} />,
  },
  {
    title: "模型管理",
    path: "/models",
    iconNode: <Bot size={16} />,
  },
];
