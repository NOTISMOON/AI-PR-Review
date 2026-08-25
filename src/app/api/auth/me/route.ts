import { NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/auth/config";
import { verifyAccessToken } from "@/lib/auth/jwt";

export const runtime = "nodejs";

/** 返回当前登录身份（由 access_token cookie 读取） */
export async function GET(req: NextRequest) {
  const at = req.cookies.get(AUTH.cookieName.access)?.value;
  const user = at ? await verifyAccessToken(at) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(user);
}