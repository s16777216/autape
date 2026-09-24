import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import RootLayout from "./layouts/RootLayout";
import WelcomeView from "./views/WelcomeView";
import TestCaseDetailView from "./features/projects/pages/TestCaseDetailView";
import SSEConsoleView from "./views/SSEConsoleView";
import TaskDetailView from "./views/TaskDetailView";
import HistoryView from "./views/HistoryView";
import SettingsView from "./views/SettingsView";
import ModelManageView from "./views/ModelManageView";
import TestFormView from "./views/TestFormView";
import ProjectImportView from "./views/ProjectImportView";
import LoginView from "./views/LoginView";
import ProtectedRoute from "./components/custom/ProtectedRoute";
import UserManagementView from "./views/UserManagementView";
import {
  ProjectListView,
  ProjectCreateView,
  ProjectEditView,
  ProjectDetailView,
} from "./features/projects";

import type { RouteHandle } from "./types/breadcrumb";
import { projectLoader, testcaseLoader, taskLoader } from "./lib/loaders";
import { FoldersIcon } from "./components/icon/folders";
import { FolderPlusIcon } from "./components/icon/folder-plus";
import { HistoryIcon } from "./components/icon/history";
import { FileTextIcon } from "./components/icon/file-text";
import { SettingsIcon } from "./components/icon/settings";
import { SquarePen, Bot, User as UserIcon } from "lucide-react";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginView />,
  },
  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <RootLayout />,
        children: [
          {
            index: true,
            element: <WelcomeView />,
          },
          {
            path: "project",
            element: <Outlet />,
            handle: {
              label: "專案管理",
              iconNode: <FoldersIcon size={14} />,
            } satisfies RouteHandle,
            children: [
              {
                index: true,
                element: <ProjectListView />,
              },
              {
                path: "new",
                element: <ProjectCreateView />,
                handle: {
                  label: "建立新專案",
                  iconNode: <FolderPlusIcon size={14} />,
                } satisfies RouteHandle,
              },
              {
                path: ":projectId",
                id: "project-root",
                loader: projectLoader,
                element: <Outlet />,
                handle: {
                  label: (data) => data?.name ?? "載入中...",
                } satisfies RouteHandle<typeof projectLoader>,
                children: [
                  {
                    index: true,
                    element: <ProjectDetailView />,
                  },
                  {
                    path: "edit",
                    element: <ProjectEditView />,
                    handle: {
                      label: "編輯專案",
                      iconNode: <SquarePen size={14} />,
                    } satisfies RouteHandle,
                  },
                  {
                    path: "testCase/:testCaseId",
                    loader: testcaseLoader,
                    element: <TestCaseDetailView />,
                    handle: {
                      label: (data) => data?.name ?? "載入中...",
                      iconNode: <FileTextIcon size={14} />,
                    } satisfies RouteHandle<typeof testcaseLoader>,
                  },
                  {
                    path: "run/:runId",
                    element: <SSEConsoleView />,
                    handle: {
                      label: (_data, params) =>
                        `執行 #${params.runId ? params.runId.substring(0, 8) : "..."}`,
                      icon: "play",
                    } satisfies RouteHandle,
                  },
                  {
                    path: "tasks/:taskId",
                    loader: taskLoader,
                    element: <TaskDetailView />,
                    handle: {
                      label: (_data, params) =>
                        `批次 #${params.taskId ? params.taskId.substring(0, 8) : "..."}`,
                      iconNode: <HistoryIcon size={14} />,
                    } satisfies RouteHandle<typeof taskLoader>,
                  },
                ],
              },
            ],
          },
          {
            path: "tasks",
            element: <HistoryView />,
            handle: {
              label: "執行紀錄",
              iconNode: <HistoryIcon size={14} />,
            } satisfies RouteHandle,
          },
          {
            path: "projects/import",
            element: <ProjectImportView />,
            handle: {
              label: "匯入專案",
              iconNode: <FolderPlusIcon size={14} />,
            } satisfies RouteHandle,
          },
          {
            path: "settings",
            element: <SettingsView />,
            handle: {
              label: "系統設定",
              iconNode: <SettingsIcon size={14} />,
            } satisfies RouteHandle,
          },
{
              path: "users",
              element: <ProtectedRoute requiredRole="admin" />,
              handle: {
                label: "使用者管理",
                iconNode: <UserIcon size={14} />,
              } satisfies RouteHandle,
              children: [
                {
                  index: true,
                  element: <UserManagementView />,
                },
              ],
            },
          {
            path: "models",
            element: <ModelManageView />,
            handle: {
              label: "模型管理",
              iconNode: <Bot size={14} />,
            } satisfies RouteHandle,
          },
          {
            path: "testform",
            element: <TestFormView />,
            handle: {
              label: "測試表單",
              icon: "test-tube",
            } satisfies RouteHandle,
          },
          {
            path: "*",
            element: <Navigate to="/" replace />,
          },
        ],
      },
    ],
  },
]);
