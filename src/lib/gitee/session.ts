import { NextRequest } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { verifyAccessToken, type AuthUser } from "@/lib/auth/jwt";
import { getPlatformAccessToken, getPlatformUser } from "@/lib/db/mysql";

export interface GiteeSessionContext {
  user: AuthUser;
  dbUser: { id: number; login: string; accessTokenEnc?: string | null };
}

/** 从 cookie 解析当前 Gitee 登录身份，并读取其解密后的平台 token */
export async function resolveGiteeSession(
  req: NextRequest,
): Promise<{ ctx: GiteeSessionContext; token: string | null } | { error: "unauthorized" | "no_db" }> {
  const at = req.cookies.get(AUTH.cookieName.access)?.value;
  if (!at) return { error: "unauthorized" };
  const user = await verifyAccessToken(at);
  if (!user || user.provider !== "gitee") return { error: "unauthorized" };

  const dbUser = await getPlatformUser("gitee", user.providerUserId);
  if (!dbUser) return { error: "no_db" };

  const token = await getPlatformAccessToken("gitee", user.providerUserId);
  return { ctx: { user, dbUser }, token };
}