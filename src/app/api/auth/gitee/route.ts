import { NextRequest, NextResponse } from "next/server";
import { startOAuth } from "@/lib/auth/handlers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return startOAuth("gitee", req);
}