import { NextRequest, NextResponse } from "next/server";
import { AUTH, requestUsesHttps } from "@/lib/auth/config";
import { refreshAccessToken } from "@/lib/auth/handlers";

export const runtime = "nodejs";

const cookie = (maxAge: number, secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge,
});

/** 用 refresh_token（cookie + Redis）换取新的 access_token，并轮换 refresh_token */
export async function POST(req: NextRequest) {
  const result = await refreshAccessToken(req);
  if (!result) {
    return NextResponse.json({ error: "invalid_refresh" }, { status: 401 });
  }

  const secure = requestUsesHttps(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH.cookieName.access, result.access, cookie(AUTH.accessTtlSec, secure));
  res.cookies.set(AUTH.cookieName.refresh, result.refresh, cookie(AUTH.refreshTtlSec, secure));
  return res;
}