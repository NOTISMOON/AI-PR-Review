import { NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { oauthCallback } from "@/lib/auth/handlers";
import type { OAuthProvider } from "@/lib/auth/jwt";

export const runtime = "nodejs";

/**
 * 兼容旧项目登记的回调路径（如 GITHUB_REDIRECT_URI=.../callback）。
 * 从 startOAuth 写入的 provider cookie 判断是哪个平台。
 */
export async function GET(req: NextRequest) {
  const p = req.cookies.get(AUTH.cookieName.provider)?.value;
  const provider: OAuthProvider = p === "gitee" ? "gitee" : "github";
  return oauthCallback(provider, req);
}