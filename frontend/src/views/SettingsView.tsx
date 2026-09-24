import { useState, useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Link } from "react-router-dom";

import { FormBlock, FormField } from "@/components/custom/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BaseDialog } from "@/components/custom/BaseDialog";
import {
  Loader2,
  ShieldAlert,
  Trash2,
  Bot,
  Database,
  RefreshCw,
  HardDrive,
  Image as ImageIcon,
} from "lucide-react";
import { api } from "../lib/api";
import type { DatabaseStorageMetrics } from "../types/api";
import Typography from "@/components/custom/Typography";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const settingsSchema = z.object({
  headless: z.boolean(),
  slowMo: z.coerce
    .number()
    .min(0, "動作延遲不能為負數")
    .max(3000, "動作延遲不能超過 3000ms"),
  defaultTimeout: z.coerce.number().min(1000, "超時時間至少需 1000ms"),
  viewportWidth: z.coerce
    .number()
    .min(320, "寬度至少為 320")
    .max(3840, "寬度最大為 3840"),
  viewportHeight: z.coerce
    .number()
    .min(240, "高度至少為 240")
    .max(2160, "高度最大為 2160"),
  sendFailureScreenshot: z.boolean(),
  enableReplay: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const aiConfigSchema = z.object({
  executorModelId: z.string().optional(),
  reportModelId: z.string().optional(),
});

type AiConfigFormData = z.infer<typeof aiConfigSchema>;

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  model: string;
}

export default function SettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const [settings, setSettings] = useState<SettingsFormData | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfigFormData | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [storageMetrics, setStorageMetrics] = useState<DatabaseStorageMetrics | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [refreshingStorage, setRefreshingStorage] = useState(false);

  const fetchStorageMetrics = async (isManual = false) => {
    if (isManual) {
      setRefreshingStorage(true);
    } else {
      setLoadingStorage(true);
    }
    try {
      const data = await api.getStorageMetrics();
      setStorageMetrics(data);
      if (isManual) {
        toast.success("儲存空間指標已更新");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "載入儲存指標失敗";
      if (isManual) {
        toast.error(message);
      }
    } finally {
      setLoadingStorage(false);
      setRefreshingStorage(false);
    }
  };

  const fetchSettings = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [settingsRes, modelsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/models"),
      ]);
      if (!settingsRes.ok) throw new Error("無法載入設定");
      const data = await settingsRes.json();
      if (modelsRes.ok) {
        setModels(await modelsRes.json());
      }
      setSettings({
        headless: data.headless,
        slowMo: Number(data.slowMo),
        defaultTimeout: Number(data.defaultTimeout),
        viewportWidth: Number(data.viewportWidth),
        viewportHeight: Number(data.viewportHeight),
        sendFailureScreenshot: data.sendFailureScreenshot ?? true,
        enableReplay: data.enableReplay ?? true,
      });
      // 載入 aiConfig
      const ai = data.aiConfig ?? {};
      setAiConfig({
        executorModelId: ai.executorModelId ?? "",
        reportModelId: ai.reportModelId ?? "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入設定失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSettings();
      fetchStorageMetrics();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const handleSave = async (data: SettingsFormData) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headless: data.headless,
          slowMo: data.slowMo,
          defaultTimeout: data.defaultTimeout,
          viewportWidth: data.viewportWidth,
          viewportHeight: data.viewportHeight,
          sendFailureScreenshot: data.sendFailureScreenshot,
          enableReplay: data.enableReplay,
        }),
      });
      if (!res.ok) throw new Error("無法儲存設定");
      toast.success("設定儲存成功");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "儲存設定失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAiConfig = async (data: AiConfigFormData) => {
    setSavingAi(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiConfig: {
            executorModelId: data.executorModelId || undefined,
            reportModelId: data.reportModelId || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error("無法儲存 AI 模型配置");
      toast.success("AI 模型配置已儲存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "儲存 AI 模型配置失敗");
    } finally {
      setSavingAi(false);
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/settings/history", { method: "DELETE" });
      if (!res.ok) throw new Error("無法清除歷史紀錄");
      toast.success("歷史紀錄已成功清除");
      setShowClearDialog(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清除歷史紀錄失敗");
    } finally {
      setClearing(false);
    }
  };

  if (loading || !settings || !aiConfig) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950 text-zinc-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        載入全域設定中...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 text-zinc-100 p-8 select-none">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">系統設定</h1>
      </div>


        <div className="mx-auto w-full space-y-10">
        {/* 區塊一：瀏覽器與執行參數 */}
        <FormBlock
          label="瀏覽器與執行參數"
          description="設定測試執行時的無頭模式、動作延遲、超時時間，以及瀏覽器的視窗尺寸。"
          formSchema={settingsSchema}
          defaultValues={settings}
          onSubmit={handleSave}
          submitText={saving ? "儲存中..." : "儲存設定"}
          submitIcon="save"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField
                name="headless"
                label="Headless 無頭模式"
                description="啟用時會在背景執行，停用時會彈出實體 Chrome 視窗"
              >
                {(field, id) => (
                  <div className="flex items-center mt-2">
                    <Switch
                      id={id}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              </FormField>
            </div>

            <FormField
              name="slowMo"
              label="SlowMo 動作延遲 (毫秒)"
              description="限制上限 3000ms，以防測試超時"
            >
              <Input type="number" placeholder="每個步驟之間的延遲毫秒數" />
            </FormField>

            <FormField
              name="defaultTimeout"
              label="預設等待超時 (毫秒)"
              description="Playwright 操作等待超時"
            >
              <Input type="number" placeholder="Playwright 操作等待超時" />
            </FormField>

            <FormField
              name="viewportWidth"
              label="視窗寬度 (Width)"
              description="限制範圍 320 ~ 3840"
            >
              <Input type="number" placeholder="例如 1280" />
            </FormField>

            <FormField
              name="viewportHeight"
              label="視窗高度 (Height)"
              description="限制範圍 240 ~ 2160"
            >
              <Input type="number" placeholder="例如 800" />
            </FormField>

            <div className="sm:col-span-2">
              <FormField
                name="sendFailureScreenshot"
                label="傳送失敗截圖給報告模型"
                description="若報告模型不支援多模態（非視覺模型），請關閉此項"
              >
                {(field, id) => (
                  <div className="flex items-center mt-2">
                    <Switch
                      id={id}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <FormField
                name="enableReplay"
                label="啟用歷史軌跡重放 (Replay Mode)"
                description="當開啟時，若相同測試案例版本先前已有成功紀錄，將優先重放歷史工具操作，降低 Token 成本並加速執行；重放失敗時自動無縫交棒給 LLM 修復"
              >
                {(field, id) => (
                  <div className="flex items-center mt-2">
                    <Switch
                      id={id}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </div>
                )}
              </FormField>
            </div>
          </div>
        </FormBlock>

        <Separator className="my-10" />

        {/* 區塊二：AI 模型配置 */}
        <FormBlock
          label="AI 模型配置"
          description="選擇執行器與報告器角色所使用的模型（請先到模型管理頁面建立模型設定）。"
          formSchema={aiConfigSchema}
          defaultValues={aiConfig}
          onSubmit={handleSaveAiConfig}
          submitText={savingAi ? "儲存中..." : "儲存設定"}
        >
          <div className="space-y-6">
            {models.length === 0 && (
              <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-950/30 border border-amber-800/40 rounded-md p-3">
                <Bot size={16} />
                尚無模型設定，請先到{" "}
                <Link
                  to="/models"
                  className="underline text-amber-300 hover:text-amber-100"
                >
                  模型管理
                </Link>{" "}
                頁面新增模型。
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <FormField
                name="executorModelId"
                label="執行器模型 *"
                description="負責逐步瀏覽器操作決策的模型，未設定時無法執行測試"
              >
                {(field, id) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue placeholder="選擇執行器模型…" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          <span className="ml-2 text-xs text-zinc-400">
                            {m.model}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                name="reportModelId"
                label="報告器模型（選填）"
                description="負責生成失敗總結的模型，未設定則跳過報告生成"
              >
                {(field, id) => (
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue placeholder="選擇報告器模型…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">不設定（跳過報告）</SelectItem>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          <span className="ml-2 text-xs text-zinc-400">
                            {m.model}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
          </div>
        </FormBlock>


        {/* 區塊三：儲存空間與資料庫狀態 */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          <div className="flex flex-col space-y-1">
            <h3 className="font-semibold text-lg text-zinc-100 flex items-center gap-2">
              <Database size={20} className="text-indigo-400" />
              儲存空間與資料庫狀態
            </h3>
            <p className="text-muted-foreground text-sm">
              監控 PostgreSQL 實體磁碟佔用水位，以及步驟截圖與失敗畫面的空間佔比。
            </p>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <Card className="border-zinc-800/80 bg-zinc-900/40">
              <CardContent className="p-6 space-y-6">
                {/* 頂部：標題與重新整理按鈕 */}
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                      <span>PostgreSQL 儲存分佈</span>
                      {loadingStorage && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      包含表格資料、TOAST 大型物件二進位檔與關聯索引
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={refreshingStorage || loadingStorage}
                    onClick={() => {
                      if (!refreshingStorage) {
                        fetchStorageMetrics(true);
                      }
                    }}
                    className="border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 hover:text-white text-zinc-300 text-xs cursor-pointer gap-1.5 transition-colors"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${refreshingStorage ? "animate-spin text-indigo-400" : ""}`}
                    />
                    重新整理
                  </Button>
                </div>

                {/* 指標卡片群組 (Bento Tiles) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* 指標 1：資料庫總大小 */}
                  <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="font-medium">資料庫實體總量</span>
                      <HardDrive size={16} className="text-zinc-400" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-100 tracking-tight">
                      {storageMetrics?.databaseSize ?? "0 B"}
                    </div>
                    <p className="text-[11px] text-zinc-500 font-mono">
                      {storageMetrics
                        ? `${storageMetrics.databaseSizeBytes.toLocaleString()} Bytes`
                        : "---"}
                    </p>
                  </div>

                  {/* 指標 2：截圖佔用體積 */}
                  <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="font-medium">截圖二進位體積</span>
                      <ImageIcon size={16} className="text-indigo-400" />
                    </div>
                    <div className="text-2xl font-bold text-indigo-400 tracking-tight">
                      {storageMetrics?.screenshots.size ?? "0 B"}
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      佔總體容量{" "}
                      <span className="text-indigo-300 font-semibold font-mono">
                        {storageMetrics?.screenshots.percentage ?? 0}%
                      </span>
                    </p>
                  </div>

                  {/* 指標 3：截圖張數 */}
                  <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="font-medium">儲存截圖總張數</span>
                      <Bot size={16} className="text-zinc-400" />
                    </div>
                    <div className="text-2xl font-bold text-zinc-100 tracking-tight">
                      {storageMetrics ? `${storageMetrics.screenshots.count.toLocaleString()} 張` : "0 張"}
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      含步驟截圖與失敗畫面
                    </p>
                  </div>
                </div>

                {/* 空間分佈視覺長條圖 (Indigo vs Zinc) */}
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1.5 text-indigo-400 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                        截圖資料 ({storageMetrics?.screenshots.percentage ?? 0}%)
                      </span>
                      <span className="text-zinc-600">|</span>
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-zinc-600 inline-block" />
                        日誌、表格與索引 (
                        {storageMetrics
                          ? Math.max(0, parseFloat((100 - storageMetrics.screenshots.percentage).toFixed(1)))
                          : 100}
                        %)
                      </span>
                    </div>
                    <span className="text-zinc-400 font-mono text-xs hidden sm:inline">
                      {storageMetrics?.screenshots.size ?? "0 B"} / {storageMetrics?.databaseSize ?? "0 B"}
                    </span>
                  </div>

                  <div className="h-3 w-full rounded-full bg-zinc-800/90 overflow-hidden flex p-0.5 border border-zinc-700/50">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-500 rounded-full"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, storageMetrics?.screenshots.percentage ?? 0)
                        )}%`,
                      }}
                    />
                    <div className="h-full bg-zinc-700/80 transition-all duration-500 flex-1 rounded-r-full" />
                  </div>

                  {storageMetrics && storageMetrics.screenshots.count === 0 && (
                    <p className="text-xs text-zinc-500 italic">
                      目前無任何截圖佔用空間（0 B / 0 張截圖）
                    </p>
                  )}
                </div>

                {/* 關鍵資料表實體排行 & 後續 retention 預留排版 */}
                <div className="pt-2 border-t border-zinc-800/60 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 主要資料表實體佔用 */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-zinc-400">
                      主要資料表排行 (含 TOAST & 索引)
                    </div>
                    <div className="space-y-1.5">
                      {storageMetrics?.tables && storageMetrics.tables.length > 0 ? (
                        storageMetrics.tables.map((tbl) => (
                          <div
                            key={tbl.tableName}
                            className="flex items-center justify-between text-xs py-1 px-2 rounded bg-zinc-950/30 border border-zinc-800/40"
                          >
                            <span className="font-mono text-zinc-300">{tbl.tableName}</span>
                            <span className="text-zinc-400 font-mono">{tbl.size}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-zinc-500 py-1">暫無表格排行資料</div>
                      )}
                    </div>
                  </div>

                  {/* 預留版面：未來 screenshot-retention 提案控制項 */}
                  <div className="rounded-lg border border-dashed border-zinc-800/80 bg-zinc-950/20 p-3 flex flex-col justify-between space-y-2">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                        截圖生命週期管理
                      </div>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        支援設定「截圖保留天數」與定期定時清理過期二進位圖片，保持資料庫輕量敏捷。
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-500">
                      <span>狀態：已規劃 (screenshot-retention)</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <Separator className="my-10" />

        {/* 危險區域 */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
          <div className="flex flex-col space-y-1">
            <h3 className="font-semibold text-lg text-red-400">危險區域</h3>
            <p className="text-muted-foreground text-sm">
              此處的操作具備破壞性且不可逆，請謹慎執行。
            </p>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <Card className="border-red-900/30 bg-red-950/10">
              <CardContent>
                <div className="flex justify-between gap-4 max-lg:flex-col lg:items-center">
                  <div className="space-y-1">
                    <Typography type="h6" className="text-red-400">
                      清除歷史紀錄
                    </Typography>
                    <Typography type="p" className="text-zinc-400">
                      一鍵清除資料庫中的所有測試執行歷史、步驟截圖與日誌。
                    </Typography>
                  </div>
                  <Button
                    id="clear-history-btn"
                    type="button"
                    variant="destructive"
                    onClick={() => setShowClearDialog(true)}
                    className="bg-red-950/40 border border-red-800/60 hover:bg-red-900 hover:text-white cursor-pointer"
                  >
                    <Trash2 size={16} className="mr-2" />
                    清除歷史紀錄
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </div>

      <BaseDialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        title={
          <span className="text-red-400 flex items-center gap-2">
            <ShieldAlert size={20} /> 清除所有執行歷史紀錄
          </span>
        }
        description="此操作是不可逆的破壞性變更。"
        height="220px"
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button
              variant="outline"
              onClick={() => setShowClearDialog(false)}
              className="bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-100 cursor-pointer"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearHistory}
              disabled={clearing}
              className="cursor-pointer"
            >
              {clearing ? (
                <Loader2 className="animate-spin mr-2" size={16} />
              ) : null}
              確定清除
            </Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-300 py-2">
          您確定要刪除資料庫中的所有測試運行紀錄（TestRun）、步驟明細與截圖資料嗎？這將會清空所有歷史資料。
        </p>
      </BaseDialog>
    </div>
  );
}
