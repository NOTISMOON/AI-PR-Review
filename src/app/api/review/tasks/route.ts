import { NextRequest, NextResponse } from "next/server";
import { ensureReviewTables, listPendingReviewJobs } from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 审查处理中心队列：当前登录平台「已分析完成且尚未处理」的审查 */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureReviewTables();
    const jobs = await listPendingReviewJobs(r.ctx.dbUser.id, r.provider, 30);
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
