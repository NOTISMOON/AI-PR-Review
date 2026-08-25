import { NextRequest, NextResponse } from "next/server";
import {
  ensureReviewTables,
  getReviewJob,
  updateReviewDecision,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import {
  closePullRequest,
  postIssueComment,
  submitPullReview,
} from "@/lib/review/decisions";

export const runtime = "nodejs";

/** 用户决策：批准 / 请求变更（拒绝合并）/ 评论 / 关闭 PR */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (r.provider !== "github") {
    return NextResponse.json({ error: "自动审查目前仅支持 GitHub" }, { status: 400 });
  }
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { jobId: jobIdRaw } = await params;
  const jobId = Number(jobIdRaw);
  let body: { action?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (!["approve", "request_changes", "comment", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  try {
    await ensureReviewTables();
    const job = await getReviewJob(r.ctx.dbUser.id, jobId);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [owner, repo] = job.repoFullName.split("/");

    let decision = "";
    let ok = false;

    switch (action) {
      case "approve":
        ok = await submitPullReview(
          r.token,
          owner,
          repo,
          job.prNumber,
          "APPROVE",
          comment || "AI 审查通过，批准合并。",
        );
        decision = "APPROVED";
        break;
      case "request_changes":
        ok = await submitPullReview(
          r.token,
          owner,
          repo,
          job.prNumber,
          "REQUEST_CHANGES",
          comment || "AI 审查发现需修复的问题，请处理后再合并。",
        );
        decision = "REQUEST_CHANGES";
        break;
      case "comment":
        ok = await postIssueComment(r.token, owner, repo, job.prNumber, comment || "AI 审查评论");
        decision = "COMMENTED";
        break;
      case "dismiss":
        ok = await closePullRequest(r.token, owner, repo, job.prNumber);
        decision = "DISMISSED";
        break;
    }

    if (!ok) {
      return NextResponse.json({ error: "回写 GitHub 失败（可能权限不足）" }, { status: 502 });
    }
    await updateReviewDecision(r.ctx.dbUser.id, jobId, decision);
    return NextResponse.json({ ok: true, decision });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
