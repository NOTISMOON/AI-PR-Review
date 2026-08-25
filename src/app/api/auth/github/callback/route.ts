import { NextRequest, NextResponse } from "next/server";
import { oauthCallback } from "@/lib/auth/handlers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return oauthCallback("github", req);
}