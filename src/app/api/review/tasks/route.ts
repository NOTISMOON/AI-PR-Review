import { NextRequest, NextResponse } from "next/server";
import { ensureReviewTables, listReviewJobs } from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 审查处理中心队列：当前登录平台最近的自动审查结果 */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  try {
    await ensureReviewTables();
    const jobs = await listReviewJobs(r.ctx.dbUser.id, r.provider, 30);
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
