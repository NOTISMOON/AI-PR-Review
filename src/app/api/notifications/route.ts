import { NextRequest, NextResponse } from "next/server";
import {
  countUnreadNotifications,
  ensureNotificationTables,
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 通知列表 + 未读数 */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureNotificationTables();
    const [items, unread] = await Promise.all([
      listNotifications(r.ctx.dbUser.id, 30),
      countUnreadNotifications(r.ctx.dbUser.id),
    ]);
    return NextResponse.json({ items, unread });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 全部标记已读 */
export async function POST(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureNotificationTables();
    await markAllNotificationsRead(r.ctx.dbUser.id);
    const unread = await countUnreadNotifications(r.ctx.dbUser.id);
    return NextResponse.json({ ok: true, unread });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
