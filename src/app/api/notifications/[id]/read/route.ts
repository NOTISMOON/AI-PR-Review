import { NextRequest, NextResponse } from "next/server";
import {
  countUnreadNotifications,
  ensureNotificationTables,
  markNotificationRead,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 标记单条通知已读 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    await ensureNotificationTables();
    await markNotificationRead(r.ctx.dbUser.id, id);
    const unread = await countUnreadNotifications(r.ctx.dbUser.id);
    return NextResponse.json({ ok: true, unread });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
