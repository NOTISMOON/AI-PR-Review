import { NextRequest, NextResponse } from "next/server";
import { ensureWebhookTables, listWebhookEvents } from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 最近触发记录（当前登录平台） */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureWebhookTables();
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit") || 30), 1), 100);
    const logs = await listWebhookEvents(r.ctx.dbUser.id, r.provider, limit);
    return NextResponse.json({ logs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
