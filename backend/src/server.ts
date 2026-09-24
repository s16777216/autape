import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { initDB } from "./db.js";
import { TaskQueue } from "./queue.js";

import { projectRouter } from "./routes/project.js";
import { groupRouter } from "./routes/group.js";
import { testcaseRouter } from "./routes/testcase.js";
import { runRouter } from "./routes/run.js";
import { taskRouter } from "./routes/task.js";
import { settingsRouter } from "./routes/settings.js";
import { modelsRouter } from "./routes/models.js";
import { exportImportRouter } from "./routes/exportImport.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";

const app = new Hono();

// 註冊子路由器，以保證與前端原有 API 路徑相容
app.route("/api/auth", authRouter);
app.route("/api/projects", projectRouter);
app.route("/api", exportImportRouter);
app.route("/api", groupRouter);
app.route("/api", testcaseRouter);
app.route("/api", runRouter);
app.route("/api", taskRouter);
app.route("/api", settingsRouter);
app.route("/api/models", modelsRouter);
app.route("/api", usersRouter);

// 託管前端編譯出來的靜態資源，並支援 SPA 路由
app.use("/*", serveStatic({
  root: "../frontend/dist",
  rewriteRequestPath: (path) => {
    if (path.includes(".") || path.startsWith("/api")) {
      return path;
    }
    return "/index.html";
  }
}));

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const queuePort = process.env.QUEUE_PORT
  ? parseInt(process.env.QUEUE_PORT)
  : 3002;

async function start() {
  // 1. 初始化資料庫連線與修復邏輯
  await initDB();

  // 2. 啟動背景 Worker 佇列
  const queue = TaskQueue.getInstance();
  queue.startWorker(queuePort);

  // 3. 啟動 Hono HTTP 伺服器
  console.log(`[Hono] 伺服器正在啟動，監聽 Port：${port}`);
  serve({
    fetch: app.fetch,
    port: port,
  });
}

start().catch((err) => {
  console.error("[Hono] 伺服器啟動失敗：", err);
  process.exit(1);
});
