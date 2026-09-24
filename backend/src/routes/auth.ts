import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../db.js";
import { User } from "../entities/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "e2e_manager_secret_key_change_me";

export const authRouter = new Hono();

// POST /api/auth/login
authRouter.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: "請提供帳號與密碼" }, 400);
    }

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { username } });
    if (!user) {
      return c.json({ error: "帳號或密碼錯誤" }, 401);
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return c.json({ error: "帳號或密碼錯誤" }, 401);
    }

    // 簽發 JWT Token (效期 24 小時)
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // 寫入 HttpOnly Cookie
    setCookie(c, "access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return c.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
  } catch (error: any) {
    return c.json({ error: `登入失敗: ${error.message}` }, 500);
  }
});

// GET /api/auth/me
authRouter.get("/me", async (c) => {
  try {
    const token = getCookie(c, "access_token");
    if (!token) {
      return c.json({ error: "尚未登入" }, 401);
    }

    const payload = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: string };
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: payload.id } });
    if (!user) {
      return c.json({ error: "使用者不存在" }, 401);
    }

    return c.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
  } catch (error: any) {
    return c.json({ error: "未授權或 Token 已過期" }, 401);
  }
});

// POST /api/auth/logout
authRouter.post("/logout", async (c) => {
  deleteCookie(c, "access_token", { path: "/" });
  return c.json({ message: "登出成功" });
});
