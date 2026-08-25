import { NextRequest } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { verifyAccessToken, type AuthUser } from "@/lib/auth/jwt";
import {
  getPlatformAccessToken,
  getPlatformUser,
} from "@/lib/db/mysql";

export interface SessionContext {
  user: AuthUser;
  dbUser: { id: number; login: string; accessTokenEnc?: string | null };
}

/** 从 cookie 解析当前登录身份，并读取其数据库记录（含解密的平台 token） */
export async function resolveSession(
  req: NextRequest,
): Promise<{ ctx: SessionContext; token: string | null } | { error: "unauthorized" | "no_db" | "provider" }> {
  const at = req.cookies.get(AUTH.cookieName.access)?.value;
  if (!at) return { error: "unauthorized" };
  const user = await verifyAccessToken(at);
  if (!user) return { error: "unauthorized" };

  const provider = user.provider;
  if (provider === "gitee") return { error: "provider" }; // 当前 GitHub 客户端仅适配 github

  const dbUser = await getPlatformUser(provider, user.providerUserId);
  if (!dbUser) return { error: "no_db" };

  const token = await getPlatformAccessToken(provider, user.providerUserId);
  return { ctx: { user, dbUser }, token };
}