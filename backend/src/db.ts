import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();
import { DataSource } from "typeorm";
import { Project } from "./entities/Project.js";
import { TestGroup } from "./entities/TestGroup.js";
import { Testcase } from "./entities/Testcase.js";
import { TestRun } from "./entities/TestRun.js";
import { TestLog } from "./entities/TestLog.js";
import { Task } from "./entities/Task.js";
import { TestRunStep } from "./entities/TestRunStep.js";
import { TestcaseStep } from "./entities/TestcaseStep.js";
import { SystemSetting } from "./entities/SystemSetting.js";
import { ModelSetting } from "./entities/ModelSetting.js";
import { User } from "./entities/User.js";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL;

export const AppDataSource = new DataSource({
  type: "postgres",
  url: databaseUrl || "postgres://postgres:postgres@localhost:5432/e2e_manager",
  synchronize: true, // 自動同步 Schema 到資料庫
  logging: false,
  entities: [Project, TestGroup, Testcase, TestRun, TestLog, Task, TestRunStep, TestcaseStep, SystemSetting, ModelSetting, User],
  extra: {
    max: 1, // 限制連線池大小為 1，防範 WSL2 Mirrored 網路的 TCP 重複連線 bug
  },
  subscribers: [],
  migrations: [],
});

/**
 * 初始化資料庫連線並執行啟動修復邏輯
 */
export async function initDB() {
  console.log("[DB] 正在初始化資料庫連線... URL 為:", (AppDataSource.options as any).url || (AppDataSource.options as any).host);
  
  // 自動資料遷移備份
  let migratedStepsBackup: Array<{ id: string; steps: any }> = [];
  const tempDS = new DataSource({
    type: "postgres",
    url: databaseUrl || "postgres://postgres:postgres@localhost:5432/e2e_manager",
    synchronize: false,
    logging: false,
    extra: { max: 1 }
  });
  try {
    await tempDS.initialize();
    const queryRunner = tempDS.createQueryRunner();
    const tableExists = await queryRunner.hasTable("testcase");
    if (tableExists) {
      const tableHasSteps = await queryRunner.hasColumn("testcase", "steps");
      if (tableHasSteps) {
        console.log("[DB Migration] 檢測到舊有的 simple-json steps 欄位，正在讀取並備份測試案例步驟...");
        migratedStepsBackup = await queryRunner.query(`SELECT id, steps FROM testcase WHERE steps IS NOT NULL`);
      }
    }

    const taskTableExists = await queryRunner.hasTable("task");
    if (taskTableExists) {
      const hasFinalResult = await queryRunner.hasColumn("task", "finalResult");
      if (hasFinalResult) {
        console.log("[DB Migration] 檢測到舊有的 Task.finalResult 欄位，正在進行數據升級...");
        await queryRunner.query(
          `UPDATE task SET status = 'passed' WHERE status = 'done' AND "finalResult" = 'PASS'`
        );
        await queryRunner.query(
          `UPDATE task SET status = 'failed' WHERE status = 'done' AND "finalResult" = 'FAIL'`
        );
        await queryRunner.query(
          `UPDATE task SET status = 'error' WHERE status = 'done' AND "finalResult" IS NULL`
        );
        console.log("[DB Migration] 既存 Task 資料轉換完成。");
      }
    }

    await queryRunner.release();
  } catch (e: any) {
    console.error("[DB Migration] 臨時資料備份失敗：", e.message);
  } finally {
    if (tempDS.isInitialized) {
      await tempDS.destroy();
    }
  }

  let retries = 5;
  while (retries > 0) {
    try {
      await AppDataSource.initialize();
      break;
    } catch (err: any) {
      retries--;
      console.error(`[DB] 連線失敗：${err.message}，剩餘重試次數：${retries}`);
      if (retries === 0) throw err;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log("[DB] 資料庫連線初始化成功。");

  // 初始化全域設定預設值
  try {
    const settingRepo = AppDataSource.getRepository(SystemSetting);
    const count = await settingRepo.count();
    if (count === 0) {
      const defaultSetting = new SystemSetting();
      await settingRepo.save(defaultSetting);
      console.log("[DB] 檢測到系統設定為空，已成功寫入預設設定。");
    }
  } catch (err: any) {
    console.error("[DB] 初始化系統設定失敗：", err.message);
  }

  // 初始化預設管理員帳號
  try {
    const userRepo = AppDataSource.getRepository(User);
    const userCount = await userRepo.count();
    if (userCount === 0) {
      const adminUser = new User();
      adminUser.username = "admin";
      adminUser.email = "admin@e2e.local";
      adminUser.passwordHash = await bcrypt.hash("admin123", 10);
      adminUser.role = "admin";
      await userRepo.save(adminUser);
      console.log("[DB] 檢測到使用者表為空，已成功建立預設管理員帳號 (admin / admin123)。");
    }
  } catch (err: any) {
    console.error("[DB] 初始化預設管理員失敗：", err.message);
  }

  // 寫入步驟遷移資料
  if (migratedStepsBackup.length > 0) {
    console.log(`[DB Migration] 發現 ${migratedStepsBackup.length} 筆測試案例需要步驟遷移...`);
    try {
      const testcaseStepRepo = AppDataSource.getRepository(TestcaseStep);
      for (const item of migratedStepsBackup) {
        let stepsArray: any[] = [];
        try {
          stepsArray = typeof item.steps === "string" ? JSON.parse(item.steps) : item.steps;
        } catch (e) {
          console.error(`[DB Migration] 解析 id 為 ${item.id} 的 steps 欄位失敗:`, e);
        }
        if (Array.isArray(stepsArray)) {
          const existingCount = await testcaseStepRepo.count({ where: { testcase: { id: item.id } } });
          if (existingCount === 0) {
            console.log(`[DB Migration] 正在為測試案例 (ID: ${item.id}) 寫入 ${stepsArray.length} 個步驟...`);
            for (let i = 0; i < stepsArray.length; i++) {
              const stepText = stepsArray[i];
              if (typeof stepText === "string" && stepText.trim() !== "") {
                const stepEntity = new TestcaseStep();
                stepEntity.testcase = { id: item.id } as any;
                stepEntity.stepIdx = i;
                stepEntity.action = stepText;
                await testcaseStepRepo.save(stepEntity);
              }
            }
          } else {
            console.log(`[DB Migration] 測試案例 (ID: ${item.id}) 已有步驟定義，跳過寫入。`);
          }
        }
      }
      console.log("[DB Migration] 資料遷移完成。");
    } catch (migrationErr: any) {
      console.error("[DB Migration] 寫入步驟遷移資料時發生錯誤：", migrationErr.message);
    }
  }

  // 執行啟動修復邏輯：將狀態處於 running 或 pending 的任務重置為 error
  console.log("[DB] 正在檢查並清理異常遺留的任務...");
  try {
    const result = await AppDataSource.createQueryBuilder()
      .update(TestRun)
      .set({
        status: "error",
        finalResult: "ERROR",
        finalReason: "伺服器重啟，未完成之任務強制終止",
        finishedAt: new Date(),
      })
      .where("status IN (:...statuses)", { statuses: ["running", "pending"] })
      .execute();

    if (result.affected && result.affected > 0) {
      console.log(`[DB] 成功清理重置了 ${result.affected} 筆未完成的遺留 TestRun。`);
    }

    // 同步重置未完成的 Task
    const taskResult = await AppDataSource.createQueryBuilder()
      .update(Task)
      .set({
        status: "failed",
        finishedAt: new Date(),
      })
      .where("status IN (:...statuses)", { statuses: ["running", "pending"] })
      .execute();

    if (taskResult.affected && taskResult.affected > 0) {
      console.log(`[DB] 成功清理重置了 ${taskResult.affected} 筆未完成的遺留 Task。`);
    } else {
      console.log("[DB] 無遺留卡死任務，清理完成。");
    }
  } catch (error: any) {
    console.error("[DB] 清理遺留任務時發生錯誤：", error.message);
  }
}
