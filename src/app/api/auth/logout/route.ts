import { NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { revokeSession } from "@/lib/auth/handlers";

export const runtime = "nodejs";

const cookie = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: AUTH.isSecure,
  path: "/",
  maxAge,
});

async function doLogout(req: NextRequest) {
  await revokeSession(req);
  // 用相对 Location：浏览器基于当前页面域名解析，避免内网穿透把 Host 改写为 localhost 后跳到本地
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: "/login?logout=1" },
  });
  res.cookies.set(AUTH.cookieName.access, "", cookie(0));
  res.cookies.set(AUTH.cookieName.refresh, "", cookie(0));
  return res;
}

export async function GET(req: NextRequest) {
  return doLogout(req);
}

export async function POST(req: NextRequest) {
  return doLogout(req);
}
