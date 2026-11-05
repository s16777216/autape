import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useRouteLoaderData } from "react-router-dom";
import { useGroupData } from "../hooks/useGroupData";
import { type ColumnDef, type ExpandedState } from "@tanstack/react-table";
import { DataTable } from "../../../components/custom/table/DataTable";
import { StatusBadge } from "../../../components/custom/StatusBadge";
import { NewGroupSheet } from "../components/NewGroupSheet";
import { GroupEditSheet } from "../components/GroupEditSheet";
import { api } from "../../../lib/api";
import {
  Plus,
  Play,
  Edit2,
  Trash2,
  FileText,
  Loader2,
  FolderPlus,
  FilePlus,
  FolderClosed,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import type { TestGroup, Testcase, Project } from "../../../types/api";

import TestCaseCreateDialog from "../components/TestCaseCreateDialog";
import GroupDeleteDialog from "../components/GroupDeleteDialog";
import TestCaseDeleteDialog from "../components/TestCaseDeleteDialog";
import Typography from "@/components/custom/Typography";

export interface ProjectTreeRow {
  id: string;
  name: string;
  type: "group" | "testcase" | "loading";
  itemCount: number;
  lastStatus?: "pending" | "running" | "passed" | "failed" | "error";
  parentId: string | null;
  children?: ProjectTreeRow[];
  originalData: TestGroup | Testcase | null;
}

export default function ProjectDetailView() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // 專案資訊 (改用 useRouteLoaderData)
  const activeProject = useRouteLoaderData("project-root") as Project | null;

  // 觸發專案全部執行
  const handleRunAllProject = async () => {
    if (!projectId) return;
    try {
      toast.info("正在初始化專案測試任務...");
      const res = await api.runProject(projectId);
      toast.success("專案測試任務已啟動！正在轉跳監控頁面...");
      navigate(`/project/${projectId}/tasks/${res.taskId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("啟動專案測試失敗：" + msg);
    }
  };

  // 觸發群組全部執行
  const handleRunGroup = useCallback(
    async (groupId: string) => {
      try {
        toast.info("正在初始化群組測試任務...");
        const res = await api.runGroup(groupId);
        toast.success("群組測試任務已啟動！正在轉跳監控頁面...");
        navigate(`/project/${projectId}/tasks/${res.taskId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("啟動群組測試失敗：" + msg);
      }
    },
    [projectId, navigate],
  );

  // 群組樹狀態
  const {
    groups,
    groupTree,
    handleCreateSubgroup,
    handleDeleteGroup,
    loadGroups,
    isLoading: loadingGroups,
  } = useGroupData(projectId);

  // 本地狀態管理
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // 懶加載測試案例快取與載入狀態
  const [testcasesMap, setTestcasesMap] = useState<Record<string, Testcase[]>>(
    {},
  );
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  // 1. 新增與編輯群組彈窗狀態
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [newGroupParentId, setNewGroupParentId] = useState<string | null>(null);
  const [groupToEdit, setGroupToEdit] = useState<TestGroup | null>(null);

  // 2. 新增測試案例彈窗狀態
  const [showNewTestCaseModal, setShowNewTestCaseModal] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [isSavingTestCase, setIsSavingTestCase] = useState(false);

  // 刪除群組 Dialog 狀態
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  // 刪除測試案例 Dialog 狀態
  const [deleteTestCaseId, setDeleteTestCaseId] = useState<string | null>(null);
  const [deleteTestCaseName, setDeleteTestCaseName] = useState("");
  const [isDeletingTestCase, setIsDeletingTestCase] = useState(false);

  const confirmDeleteGroup = async () => {
    if (!deleteGroupId) return;
    setIsDeletingGroup(true);
    try {
      await handleDeleteGroup(deleteGroupId);
      setDeleteGroupId(null);
    } finally {
      setIsDeletingGroup(false);
    }
  };

  const confirmDeleteTestCase = async () => {
    if (!deleteTestCaseId) return;
    setIsDeletingTestCase(true);
    try {
      await api.deleteTestcase(deleteTestCaseId);
      toast.success("測試案例刪除成功！");
      setDeleteTestCaseId(null);
      setDeleteTestCaseName("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("刪除測試案例失敗：" + msg);
    } finally {
      setIsDeletingTestCase(false);
    }
  };

  const triggerDeleteTestCase = useCallback(
    (tcId: string) => {
      let name = "";
      for (const gid of Object.keys(testcasesMap)) {
        const found = testcasesMap[gid]?.find((tc) => tc.id === tcId);
        if (found) {
          name = found.name;
          break;
        }
      }
      setDeleteTestCaseId(tcId);
      setDeleteTestCaseName(name);
    },
    [testcasesMap],
  );

  // 樹狀展開狀態
  const [expanded, setExpanded] = useState<ExpandedState>({});

  // 專案改變時清空狀態與展開
  useEffect(() => {
    Promise.resolve().then(() => {
      setTestcasesMap({});
      setLoadingMap({});
      setExpanded({});
      setSelectedGroupId("");
    });
  }, [projectId]);

  // 當 selectedGroupId 改變時，同步預選 targetGroupId
  const [prevSelectedGroupId, setPrevSelectedGroupId] =
    useState(selectedGroupId);
  if (selectedGroupId !== prevSelectedGroupId) {
    setPrevSelectedGroupId(selectedGroupId);
    if (selectedGroupId) {
      setTargetGroupId(selectedGroupId);
    }
  }

  // 統一的展開狀態變更與懶加載攔截器
  const handleExpandedChange = (
    updater: React.SetStateAction<ExpandedState>,
  ) => {
    let next: ExpandedState;
    if (typeof updater === "function") {
      next = updater(expanded);
    } else {
      next = updater;
    }

    setExpanded(next);

    const nextMap = next as Record<string, boolean>;
    const prevMap = expanded as Record<string, boolean>;

    // 觸發懶加載 side-effect
    Object.keys(nextMap).forEach((groupId) => {
      if (nextMap[groupId] && !prevMap[groupId]) {
        if (groupId.startsWith("loading-")) return;
        if (!testcasesMap[groupId] && !loadingMap[groupId]) {
          setLoadingMap((prev) => ({ ...prev, [groupId]: true }));
          api
            .getTestcases(groupId)
            .then((data) => {
              setTestcasesMap((prev) => ({ ...prev, [groupId]: data }));
            })
            .catch((err) => {
              console.error(`載入群組 ${groupId} 的測試案例失敗:`, err);
            })
            .finally(() => {
              setLoadingMap((prev) => ({ ...prev, [groupId]: false }));
            });
        }
      }
    });
  };

  // 當 refreshTrigger 改變時重新獲取當前已展開群組的測試案例 (以即時更新最新建立的測試案例)
  useEffect(() => {
    if (!projectId) return;

    const reloadActiveTestcases = async () => {
      const expandedMap = expanded as Record<string, boolean>;
      const activeGroupIds = Object.keys(expandedMap).filter(
        (id) => expandedMap[id],
      );
      if (activeGroupIds.length === 0) return;

      for (const groupId of activeGroupIds) {
        try {
          const data = await api.getTestcases(groupId);
          setTestcasesMap((prev) => ({ ...prev, [groupId]: data }));
        } catch (err) {
          console.error(`重新整理群組 ${groupId} 的測試案例失敗:`, err);
        }
      }
    };

    reloadActiveTestcases();
  }, [refreshTrigger, projectId, expanded]);

  // 處理群組展開與收合 (供外部或特殊情況直接觸發)
  const handleToggleExpand = (groupId: string) => {
    handleExpandedChange((prev) => {
      const prevMap = prev as Record<string, boolean>;
      return {
        ...prevMap,
        [groupId]: !prevMap[groupId],
      };
    });
  };

  // 處理整列點擊
  const handleRowClick = (row: ProjectTreeRow) => {
    if (row.type === "group") {
      setSelectedGroupId(row.id);
      handleToggleExpand(row.id);
    } else if (row.type === "testcase") {
      navigate(`/project/${projectId}/testCase/${row.id}`);
    }
  };

  // 建立巢狀的 Tree Rows 用於 DataTable 渲染
  const buildNestedTree = useCallback(function build(
    nodes: TestGroup[],
  ): ProjectTreeRow[] {
    return nodes.map((node) => {
      const hasLoaded = node.id in testcasesMap;
      const tcs = testcasesMap[node.id] || [];
      const isLoading = loadingMap[node.id] || false;
      const subGroupsCount = node.children?.length || 0;
      const tcCount = hasLoaded ? tcs.length : node.testcaseCount || 0;

      const childrenList: ProjectTreeRow[] = [];

      // 1. 如果正在載入且尚未有測試案例，塞入 loading 節點
      if (isLoading && tcs.length === 0) {
        childrenList.push({
          id: `loading-${node.id}`,
          name: "載入中...",
          type: "loading",
          itemCount: 0,
          parentId: node.id,
          originalData: null,
        });
      }

      // 2. 遞迴加入子群組
      if (node.children && node.children.length > 0) {
        childrenList.push(...build(node.children));
      }

      // 3. 加入該群組下的測試案例
      tcs.forEach((tc) => {
        const lastRun =
          tc.runs && tc.runs.length > 0
            ? tc.runs[tc.runs.length - 1]
            : undefined;
        childrenList.push({
          id: tc.id,
          name: tc.name,
          type: "testcase",
          itemCount: tc.steps?.length || 0,
          lastStatus: lastRun?.status,
          parentId: node.id,
          originalData: tc,
        });
      });

      return {
        id: node.id,
        name: node.name,
        type: "group",
        itemCount: subGroupsCount + tcCount,
        parentId: node.parentId || null,
        children: childrenList.length > 0 ? childrenList : undefined,
        originalData: node,
      };
    });
  }, [testcasesMap, loadingMap]);

  const nestedTree = useMemo(
    () => buildNestedTree(groupTree),
    [groupTree, buildNestedTree],
  );

  // 扁平化群組列表 (供測試案例 Dialog 下拉選單使用)
  const flatGroups = (() => {
    const flatten = (
      nodes: TestGroup[],
      depth = 0,
    ): { id: string; name: string; depth: number }[] => {
      let list: { id: string; name: string; depth: number }[] = [];
      nodes.forEach((node) => {
        list.push({ id: node.id, name: node.name, depth });
        if (node.children && node.children.length > 0) {
          list = list.concat(flatten(node.children, depth + 1));
        }
      });
      return list;
    };
    return flatten(groupTree);
  })();

  // 定義 DataTable 欄位結構
  const columns = useMemo<ColumnDef<ProjectTreeRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "名稱",
        cell: ({ row }) => {
          const { id, name, type } = row.original;
          const depth = row.depth;
          const isExpanded = row.getIsExpanded();

          if (type === "loading") {
            return (
              <div
                className="flex items-center gap-1.5 text-zinc-500 italic"
                style={{ paddingLeft: `${depth * 1.5}rem` }}
              >
                <Loader2 size={12} className="animate-spin text-zinc-500" />
                <span>載入測試案例中...</span>
              </div>
            );
          }

          return (
            <div
              className="flex items-center justify-between w-full group/row"
              style={{ paddingLeft: `${depth * 1.5}rem` }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {type === "group" ? (
                  isExpanded ? (
                    <FolderOpen size={16} className="text-yellow-400" />
                  ) : (
                    <FolderClosed size={16} className="text-yellow-400" />
                  )
                ) : (
                  <FileText size={15} className="text-blue-400" />
                )}

                <span className="truncate max-w-[280px]" title={name}>
                  {name}
                </span>
              </div>

              {/* 操作按鈕 */}
              {type === "group" ? (
                <div className="opacity-0 group-hover/row:opacity-100 flex items-center gap-0.5 transition-opacity duration-150 shrink-0">
                  <button
                    title="執行此群組所有測試案例"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunGroup(id);
                    }}
                    className="p-1.5 hover:bg-zinc-800 rounded text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    <Play size={12} className="fill-current" />
                  </button>
                  <button
                    title="編輯群組"
                    onClick={(e) => {
                      e.stopPropagation();
                      const g = groups.find((group) => group.id === id);
                      if (g) {
                        setGroupToEdit(g);
                        setNewGroupParentId(g.parentId || null);
                        setShowEditGroupModal(true);
                      }
                    }}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-100 transition-colors"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    title="新增子群組"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerAddGroup(id);
                    }}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-100 transition-colors"
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    title="建立測試案例"
                    onClick={(e) => {
                      e.preventDefault();
                      if (selectedGroupId) {
                        setTargetGroupId(selectedGroupId);
                      }
                      setShowNewTestCaseModal(true);
                    }}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-100 transition-colors"
                  >
                    <FilePlus size={12} />
                  </button>
                  <button
                    title="刪除群組"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteGroupId(id);
                    }}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                type === "testcase" && (
                  <div className="opacity-0 group-hover/row:opacity-100 flex items-center gap-0.5 transition-opacity duration-150 shrink-0">
                    <button
                      title="刪除測試案例"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerDeleteTestCase(id);
                      }}
                      className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "lastStatus",
        header: () => <div className="text-center">執行狀態</div>,
        cell: ({ row }) => {
          const status = row.original.lastStatus;
          if (row.original.type === "testcase" && status) {
            return (
              <div className="text-center">
                <div className="inline-flex">
                  <StatusBadge status={status} />
                </div>
              </div>
            );
          }
          return <div className="text-center text-zinc-600">-</div>;
        },
      },
      {
        accessorKey: "itemCount",
        header: () => <div className="text-center">子項目/步驟數</div>,
        cell: ({ row, getValue }) => {
          if (row.original.type === "loading") return "-";
          return (
            <div className="font-mono text-center text-zinc-500">
              {getValue<number>()}
            </div>
          );
        },
      },
    ],
    [handleRunGroup, groups, selectedGroupId, triggerDeleteTestCase],
  );

  // 處理新增群組觸發
  const triggerAddGroup = (parentId: string | null) => {
    setNewGroupParentId(parentId);
    setShowNewGroupModal(true);
  };

  return (
    <div className="flex-1 flex flex-col select-none p-8">
      {/* 頂部 Header & 麵包屑已移至全域 */}
      <div className="max-w-6xl w-full mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10">
        <div>
          <h2 className="text-3xl font-extrabold flex items-center gap-2">
            {activeProject ? activeProject.name : "載入專案中..."}
            {activeProject && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/project/${activeProject.id}/edit`)}
                className="h-7 w-7 ml-1 text-zinc-400"
                title="編輯專案資訊"
              >
                <Edit2 size={13} />
              </Button>
            )}
          </h2>
          <Typography type="p" className="text-zinc-400 mt-1.5 text-sm">
            {activeProject?.description}
          </Typography>
        </div>

        {/* 頂部操作按鈕 */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleRunAllProject}
            className="bg-emerald-700 hover:bg-emerald-600 text-white transition-all font-semibold px-4 py-5"
          >
            <Play size={14} fill="currentColor" /> 執行所有案例
          </Button>
          <Button
            variant="outline"
            onClick={() => triggerAddGroup(selectedGroupId || null)}
            className="border-zinc-800 hover:bg-zinc-900 text-zinc-300 hover:text-zinc-100 font-semibold px-4 py-5"
          >
            <Plus size={14} /> 建立新群組
          </Button>
          <Button
            onClick={() => {
              if (selectedGroupId) {
                setTargetGroupId(selectedGroupId);
              }
              setShowNewTestCaseModal(true);
            }}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200 font-semibold px-5 py-5"
          >
            <Plus size={14} /> 建立測試案例
          </Button>
        </div>
      </div>

      {/* 測試案例樹狀表格目錄 */}
      {loadingGroups ? (
        <div className="max-w-6xl w-full mx-auto border border-zinc-850 bg-zinc-900/30 rounded-2xl p-20 text-center text-sm text-zinc-500 italic">
          載入專案目錄中...
        </div>
      ) : groupTree.length === 0 ? (
        <div className="max-w-6xl w-full mx-auto border border-zinc-850 bg-zinc-900/30 rounded-2xl p-20 text-center text-sm text-zinc-500 italic">
          目前專案暫無群組，請點擊右上方「建立新群組」開始管理。
        </div>
      ) : (
        <DataTable
          data={nestedTree}
          columns={columns}
          getSubRows={(row) => row.children}
          getRowCanExpand={(row) => row.original.type === "group"}
          getRowId={(row) => row.id}
          expanded={expanded}
          onExpandedChange={handleExpandedChange}
          onRowClick={handleRowClick}
          showSearch={true}
          searchPlaceholder="搜尋目錄內容..."
        />
      )}

      {/* 新群組彈窗 */}
      <NewGroupSheet
        open={showNewGroupModal}
        onOpenChange={setShowNewGroupModal}
        parentId={newGroupParentId}
        onCreateGroup={async (name, parentId) => {
          const res = await handleCreateSubgroup(name, parentId);
          if (res) {
            if (parentId) {
              setExpanded((prev) => {
                const prevMap = prev as Record<string, boolean>;
                return { ...prevMap, [parentId]: true };
              });
            }
            setShowNewGroupModal(false);
          }
        }}
      />

      {/* 編輯群組彈窗 */}
      {groupToEdit && (
        <GroupEditSheet
          open={showEditGroupModal}
          onOpenChange={(open) => {
            setShowEditGroupModal(open);
            if (!open) {
              setGroupToEdit(null);
            }
          }}
          groupToEdit={groupToEdit}
          onUpdateGroup={async (
            name,
            initCookies,
            initLocalStorage,
            variables,
            systemPrompt,
            disableParentPrompt,
          ) => {
            try {
              await api.updateGroup(groupToEdit.id, {
                name,
                initCookies,
                initLocalStorage,
                variables,
                systemPrompt,
                disableParentPrompt,
              });
              if (projectId) {
                await loadGroups(projectId);
              }
              toast.success("群組更新成功！");
              setShowEditGroupModal(false);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              toast.error("更新群組失敗：" + msg);
            }
          }}
        />
      )}

      <TestCaseCreateDialog
        open={showNewTestCaseModal}
        onOpenChange={setShowNewTestCaseModal}
        targetGroupId={targetGroupId}
        setTargetGroupId={setTargetGroupId}
        flatGroups={flatGroups}
        isSaving={isSavingTestCase}
        onSubmit={async (
          name,
          targetGrpId,
          systemPrompt,
          disableParentPrompt,
        ) => {
          setIsSavingTestCase(true);
          try {
            const newTc = await api.createTestcase(targetGrpId, {
              name,
              steps: [],
              expected: "",
              systemPrompt,
              disableParentPrompt,
            });
            toast.success("測試案例建立成功！");
            setShowNewTestCaseModal(false);
            navigate(`/project/${projectId}/testCase/${newTc.id}`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error("建立測試案例失敗：" + msg);
          } finally {
            setIsSavingTestCase(false);
          }
        }}
      />

      <GroupDeleteDialog
        open={deleteGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupId(null);
        }}
        isDeleting={isDeletingGroup}
        onConfirm={confirmDeleteGroup}
      />

      <TestCaseDeleteDialog
        open={deleteTestCaseId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTestCaseId(null);
            setDeleteTestCaseName("");
          }
        }}
        testcaseName={deleteTestCaseName}
        isDeleting={isDeletingTestCase}
        onConfirm={confirmDeleteTestCase}
      />
    </div>
  );
}
