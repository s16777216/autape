import { Hono, Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../db.js";
import { User } from "../entities/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "e2e_manager_secret_key_change_me";

export const usersRouter = new Hono();

/** 鑑權中介軟體：驗證是否登入 */
export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, "access_token");
  if (!token) {
    return c.json({ error: "請先登入" }, 401);
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    c.set("jwtPayload", payload);
    await next();
  } catch (err) {
    return c.json({ error: "認證已過期，請重新登入" }, 401);
  }
}

/** 角色中介軟體：驗證是否為 admin */
export async function requireAdmin(c: Context, next: Next) {
  const payload = c.get("jwtPayload");
  if (!payload || payload.role !== "admin") {
    return c.json({ error: "權限不足：需要管理員權限" }, 403);
  }
  await next();
}

// GET /api/users - 僅 Admin 可取得所有使用者列表
usersRouter.get("/users", requireAuth, requireAdmin, async (c) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find({
      order: { createdAt: "ASC" },
    });
    // 過濾掉密碼雜湊再回傳
    const sanitized = users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }));
    return c.json(sanitized);
  } catch (error: any) {
    console.error("[API Error] GET /api/users 發生例外：", error);
    return c.json({ error: `獲取使用者列表失敗: ${error.message}` }, 500);
  }
});

// POST /api/users - 僅 Admin 可新增使用者
usersRouter.post("/users", requireAuth, requireAdmin, async (c) => {
  try {
    const { username, email, password, role } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: "帳號與密碼為必填欄位" }, 400);
    }

    const userRepo = AppDataSource.getRepository(User);
    const existing = await userRepo.findOne({ where: { username } });
    if (existing) {
      return c.json({ error: "使用者帳號已存在" }, 400);
    }

    const user = new User();
    user.username = username;
    user.email = email || `${username}@e2e.local`;
    user.passwordHash = await bcrypt.hash(password, 10);
    user.role = role === "admin" ? "admin" : "member";

    await userRepo.save(user);

    return c.json(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      201
    );
  } catch (error: any) {
    console.error("[API Error] POST /api/users 發生例外：", error);
    return c.json({ error: `新增使用者失敗: ${error.message}` }, 500);
  }
});
