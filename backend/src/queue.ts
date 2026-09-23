import { AppDataSource } from "./db.js";
import { TestRun } from "./entities/TestRun.js";
import { BrowserManager } from "./browser.js";
import { E2EGraphBuilder } from "./graph.js";
import { TaskFSM } from "./queue/taskFSM.js";
import { Task } from "./entities/Task.js";
import { Project } from "./entities/Project.js";
import { TestGroup } from "./entities/TestGroup.js";
import { Testcase } from "./entities/Testcase.js";
import { mergeCookies, mergeLocalStorage, mergeVariables, interpolateString, interpolateObject, VariableItem, RunContext } from "./services/environmentService.js";

export class TaskQueue {
  private static instance: TaskQueue | null = null;

  public static getInstance(): TaskQueue {
    if (!TaskQueue.instance) {
      TaskQueue.instance = new TaskQueue();
    }
    return TaskQueue.instance;
  }

  private isRunning = false;
  private workerInterval: NodeJS.Timeout | null = null;

  /**
   * 掃描並清理超過指定分鐘數仍在 running 的超時任務
   */
  public async cleanupTimeoutJobs(timeoutMinutes: number = 5): Promise<number> {
    const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    try {
      const timeoutPayload = TaskFSM.timeout(timeoutMinutes);
      const result = await AppDataSource.createQueryBuilder()
        .update(TestRun)
        .set(timeoutPayload)
        .where("status = :status", { status: "running" })
        .andWhere("startedAt < :threshold", { threshold })
        .execute();

      const affected = result.affected || 0;
      if (affected > 0) {
        console.log(`[Queue] 成功清理超時卡死任務 ${affected} 筆。`);
      }
      return affected;
    } catch (e: any) {
      console.error("[Queue] 清理超時任務失敗：", e.message);
      return 0;
    }
  }

  /**
   * 利用 FOR UPDATE SKIP LOCKED 在交易中取得並鎖定下一個 pending 任務
   */
  public async fetchNextJob(): Promise<string | null> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 搜尋最早的一筆 pending 任務，並進行行鎖定（跳過其他已被鎖定的任務）
      const run = await queryRunner.manager
        .createQueryBuilder(TestRun, "run")
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .where("run.status = :status", { status: "pending" })
        .orderBy("run.createdAt", "ASC")
        .getOne();

      if (run) {
        const startPayload = TaskFSM.start();
        Object.assign(run, startPayload);
        await queryRunner.manager.save(run);
        await queryRunner.commitTransaction();
        return run.id;
      } else {
        await queryRunner.rollbackTransaction();
        return null;
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 執行指定任務，並整合 LangGraph 進行流程驅動
   */
  public async executeJob(runId: string): Promise<void> {
    console.log(`[Worker] 開始執行任務：${runId}`);

    const runContext: RunContext = { snapshots: new Map() };

    // 獲取任務詳情與其關聯的測試案例
    const run = await AppDataSource.getRepository(TestRun).findOne({
      where: { id: runId },
      relations: { testcase: true },
    });

    if (!run || !run.testcase) {
      console.error(`[Worker] 找不到任務或其測試案例：${runId}`);
      return;
    }

    const testcase = run.testcase;

    // 遞迴加載 Group 與 Project 繼承鏈
    const testcaseRepo = AppDataSource.getRepository(Testcase);
    const fullTestcase = await testcaseRepo.findOne({
      where: { id: testcase.id },
      relations: { group: true, steps: true },
      order: {
        steps: {
          stepIdx: "ASC"
        }
      }
    });

    if (!fullTestcase) {
      console.error(`[Worker] 找不到測試案例：${testcase.id}`);
      return;
    }
    if (!run.testcaseVersion && fullTestcase.version) {
      run.testcaseVersion = fullTestcase.version;
      await AppDataSource.getRepository(TestRun).update(run.id, { testcaseVersion: fullTestcase.version });
    }


    const groupsChain: TestGroup[] = [];
    let currentGroup = fullTestcase.group;
    let projectId: string | null = null;

    while (currentGroup) {
      const loadedGroup = await AppDataSource.getRepository(TestGroup).findOne({
        where: { id: currentGroup.id },
        relations: { parent: true, project: true }
      });
      if (!loadedGroup) {
        break;
      }
      groupsChain.unshift(loadedGroup);
      if (loadedGroup.project && !projectId) {
        projectId = loadedGroup.project.id;
      }
      currentGroup = loadedGroup.parent;
    }

    let project: Project | null = null;
    if (projectId) {
      project = await AppDataSource.getRepository(Project).findOne({
        where: { id: projectId }
      });
    }

    // 合併 Cookie 與 LocalStorage
    let mergedCookies: any = {};
    let mergedLocalStorage: any = {};

    if (project) {
      mergedCookies = mergeCookies(mergedCookies, project.initCookies);
      mergedLocalStorage = mergeLocalStorage(mergedLocalStorage, project.initLocalStorage);
    }

    for (const group of groupsChain) {
      mergedCookies = mergeCookies(mergedCookies, group.initCookies);
      mergedLocalStorage = mergeLocalStorage(mergedLocalStorage, group.initLocalStorage);
    }

    mergedCookies = mergeCookies(mergedCookies, fullTestcase.initCookies);
    mergedLocalStorage = mergeLocalStorage(mergedLocalStorage, fullTestcase.initLocalStorage);

    // 合併環境變數
    let mergedVariables: Record<string, VariableItem> = {};
    if (project && project.variables) {
      mergedVariables = mergeVariables(mergedVariables, project.variables);
    }
    for (const group of groupsChain) {
      if (group.variables) {
        mergedVariables = mergeVariables(mergedVariables, group.variables);
      }
    }
    if (fullTestcase.variables) {
      mergedVariables = mergeVariables(mergedVariables, fullTestcase.variables);
    }

    // 將合併後的環境變數解析成扁平的 Record<string, string> 以進行插值
    const flatVariables: Record<string, string> = {};
    for (const [key, item] of Object.entries(mergedVariables)) {
      flatVariables[key] = item ? item.value : "";
    }

    const undefinedVars: string[] = [];
    const onUndefined = (varName: string) => {
      if (!undefinedVars.includes(varName)) {
        undefinedVars.push(varName);
      }
    };

    mergedCookies = interpolateObject(mergedCookies, flatVariables, runContext, onUndefined);
    mergedLocalStorage = interpolateObject(mergedLocalStorage, flatVariables, runContext, onUndefined);

    const browserManager = new BrowserManager();

    try {
      // 初始化 Playwright 瀏覽器 (由全域資料庫設定控制)
      await browserManager.initBrowser();

      // 注入 Cookie 與 LocalStorage
      if (browserManager.context) {
        if (mergedCookies && Object.keys(mergedCookies).length > 0) {
          const playwrightCookies: any[] = [];
          for (const [domainAndPath, cookiesMap] of Object.entries(mergedCookies)) {
            if (!cookiesMap || typeof cookiesMap !== "object") continue;

            let cleanKey = domainAndPath.replace(/^https?:\/\//i, "");
            let domain = cleanKey;
            let path = "/";
            const firstSlashIndex = cleanKey.indexOf("/");
            
            if (firstSlashIndex !== -1) {
              domain = cleanKey.substring(0, firstSlashIndex);
              path = cleanKey.substring(firstSlashIndex);
              if (!path.startsWith("/")) {
                path = "/" + path;
              }
            }

            for (const [name, value] of Object.entries(cookiesMap)) {
              playwrightCookies.push({
                name,
                value: String(value),
                domain,
                path,
              });
            }
          }

          if (playwrightCookies.length > 0) {
            console.log(`[Worker] 正在注入 ${playwrightCookies.length} 個 Cookies`);
            await browserManager.context.addCookies(playwrightCookies);
          }
        }
        if (mergedLocalStorage && Object.keys(mergedLocalStorage).length > 0) {
          console.log(`[Worker] 正在注入 LocalStorage`);
          await browserManager.context.addInitScript((data) => {
            Object.entries(data).forEach(([key, val]) => {
              window.localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
            });
          }, mergedLocalStorage);
        }
      }

      const builder = await E2EGraphBuilder.create(browserManager);
      const graph = builder.buildGraph();

      let stepsArray: string[] = [];
      let expectedsArray: string[] = [];
      let interpolatedExpected = "";
      let interpolatedSystemPrompt: string | undefined = undefined;

      try {
        // 多層級前置提示詞繼承與截斷處理 (Project -> Groups Chain -> Testcase)
        const promptParts: string[] = [];
        if (project && project.systemPrompt) {
          promptParts.push(project.systemPrompt);
        }
        for (const group of groupsChain) {
          if (group.disableParentPrompt) {
            promptParts.length = 0; // 遇 disableParentPrompt 清空前面累積的上層 prompt
          }
          if (group.systemPrompt) {
            promptParts.push(group.systemPrompt);
          }
        }
        if (fullTestcase.disableParentPrompt) {
          promptParts.length = 0; // 遇 disableParentPrompt 清空前面累積的上層 prompt
        }
        if (fullTestcase.systemPrompt) {
          promptParts.push(fullTestcase.systemPrompt);
        }

        const rawMergedPrompt = promptParts.join("\n\n");
        if (rawMergedPrompt.trim()) {
          interpolatedSystemPrompt = interpolateString(rawMergedPrompt, flatVariables, runContext, onUndefined);
        }

        stepsArray = (fullTestcase.steps || []).map(s => interpolateString(s.action, flatVariables, runContext, onUndefined));
        expectedsArray = (fullTestcase.steps || []).map(s => interpolateString(s.expected || "", flatVariables, runContext, onUndefined));
        interpolatedExpected = interpolateString(testcase.expected, flatVariables, runContext, onUndefined);
      } catch (interpolateError: any) {
        console.error(`[Worker] 任務 ${runId} 變數插值失敗：`, interpolateError);
        try {
          const failPayload = TaskFSM.complete("FAIL", `變數插值失敗：${interpolateError.message}`);
          await AppDataSource.getRepository(TestRun).update(runId, failPayload);

          // 發布事件
          await AppDataSource.query(`SELECT pg_notify('test_run_logs', $1)`, [
            JSON.stringify({
              runId: runId,
              status: failPayload.status,
              finalResult: "FAIL",
              finalReason: failPayload.finalReason,
              event: "completed",
              timestamp: new Date().toISOString(),
            }),
          ]);
        } catch (dbErr: any) {
          console.error("[Worker] 寫入資料庫失敗狀態失敗：", dbErr.message);
        }
        return; // 中斷執行 (將執行 finally 以清理資源)
      }

      if (undefinedVars.length > 0) {
        console.warn(`[Worker] 偵測到未定義的環境變數：${undefinedVars.join(", ")}`);
      }

      const initialLogs = undefinedVars.map(varName => ({
        step_idx: 0,
        step_description: "變數解析校驗",
        action: "warning",
        result: `環境變數引用 "{{${varName}}}" 未定義，已保留原始佔位符。`,
        timestamp: new Date().toISOString(),
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }));

      const initial_state = {
        run_id: run.id,
        test_id: testcase.id,
        testcase_version: run.testcaseVersion ?? fullTestcase.version ?? 1,
        test_name: testcase.name,
        steps: stepsArray,
        step_expecteds: expectedsArray,
        expected: interpolatedExpected,
        system_prompt: interpolatedSystemPrompt,
        current_step_idx: 0,
        executor_turn_count: 0,
        executor_last_round_done: false,
        step_retry_count: 0,
        reports_dir: "",
        screenshots_paths: [],
        logs: initialLogs,
        final_result: "",
        final_reason: "",
      };

      await graph.invoke(initial_state, { recursionLimit: Infinity });
      console.log(`[Worker] 任務 ${runId} 執行成功結束。`);
    } catch (error: any) {
      console.error(`[Worker] 任務 ${runId} 執行時發生未預期異常：`, error);
      // 將狀態更新為 error
      try {
        const crashPayload = TaskFSM.crash(error.message);
        await AppDataSource.getRepository(TestRun).update(runId, crashPayload);

        // 發布事件
        await AppDataSource.query(`SELECT pg_notify('test_run_logs', $1)`, [
          JSON.stringify({
            runId: runId,
            status: crashPayload.status,
            finalResult: "ERROR",
            finalReason: crashPayload.finalReason,
            event: "completed",
            timestamp: new Date().toISOString(),
          }),
        ]);
      } catch (dbErr: any) {
        console.error("[Worker] 寫入資料庫錯誤狀態失敗：", dbErr.message);
      }
    } finally {
      try {
        await browserManager.closeBrowser();
      } catch (e) {}

      // 更新 Task 進度
      try {
        const freshRun = await AppDataSource.getRepository(TestRun).findOne({
          where: { id: runId },
          relations: { task: true }
        });
        if (freshRun && freshRun.task) {
          await this.updateTaskProgress(freshRun.task.id);
        }
      } catch (taskErr: any) {
        console.error(`[Worker] 更新 Task 進度失敗 taskId: ${runId}`, taskErr.message);
      }
    }
  }

  /**
   * 原子性更新 Task 的 doneCount，並在全部完成時計算 finalResult 與更新狀態
   */
  public async updateTaskProgress(taskId: string): Promise<void> {
    const taskRepo = AppDataSource.getRepository(Task);

    try {
      // 1. 原子性 update
      await AppDataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE task SET "doneCount" = "doneCount" + 1 WHERE id = $1`,
          [taskId]
        );
      });

      // 2. 獲取更新後的 Task 與關聯
      const task = await taskRepo.findOne({
        where: { id: taskId },
        relations: { runs: true }
      });

      if (!task) {
        console.error(`[TaskQueue] updateTaskProgress: 找不到 Task ${taskId}`);
        return;
      }

      // 3. 判斷是否全部完成
      if (task.doneCount < task.totalCount) {
        // 更新狀態為 running
        if (task.status === "pending") {
          task.status = "running";
          await taskRepo.save(task);
        }

        await AppDataSource.query(`SELECT pg_notify('task_updates', $1)`, [
          JSON.stringify({
            taskId: task.id,
            event: "progress",
            doneCount: task.doneCount,
            totalCount: task.totalCount,
            status: task.status
          })
        ]);
      } else {
        // 計算 status 且更新
        const allPassed = task.runs.every(r => r.status === "passed");
        task.status = allPassed ? "passed" : "failed";
        task.finishedAt = new Date();
        await taskRepo.save(task);

        await AppDataSource.query(`SELECT pg_notify('task_updates', $1)`, [
          JSON.stringify({
            taskId: task.id,
            event: "completed",
            doneCount: task.doneCount,
            totalCount: task.totalCount,
            status: task.status
          })
        ]);
      }
    } catch (err: any) {
      console.error(`[TaskQueue] updateTaskProgress 錯誤 Task ${taskId}：`, err.message);
    }
  }

  /**
   * 啟動背景 Worker 輪詢
   */
  public startWorker(intervalMs: number = 3000) {
    if (this.workerInterval) {
      console.warn("[Queue] Worker 已經在運行中。");
      return;
    }

    console.log("[Queue] 啟動背景 Worker 輪詢佇列...");
    this.workerInterval = setInterval(async () => {
      if (this.isRunning) return; // 併發限制為 1，如果有任務在執行則跳過

      this.isRunning = true;
      try {
        // 先清理超時任務
        await this.cleanupTimeoutJobs();

        // 領取下一個任務
        const runId = await this.fetchNextJob();
        if (runId) {
          await this.executeJob(runId);
        }
      } catch (error: any) {
        console.error("[Queue] Worker 輪詢執行出錯：", error);
      } finally {
        this.isRunning = false;
      }
    }, intervalMs);
  }

  public stopWorker() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
      console.log("[Queue] 停止背景 Worker 輪詢。");
    }
  }
}

