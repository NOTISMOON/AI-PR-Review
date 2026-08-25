import { NextRequest, NextResponse } from "next/server";
import { ensureReviewTables, getReviewJob, listReviewIssues } from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** 单次审查详情（含完整结果 + 可采纳/忽略的问题列表） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  const { jobId: jobIdRaw } = await params;
  const jobId = Number(jobIdRaw);
  if (!Number.isInteger(jobId)) return NextResponse.json({ error: "invalid jobId" }, { status: 400 });

  try {
    await ensureReviewTables();
    const job = await getReviewJob(r.ctx.dbUser.id, jobId);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const issues = await listReviewIssues(r.ctx.dbUser.id, jobId);
    return NextResponse.json({ job, issues });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
