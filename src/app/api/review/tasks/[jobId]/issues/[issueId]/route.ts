import { NextRequest, NextResponse } from "next/server";
import {
  ensureReviewTables,
  getReviewJob,
  listReviewIssues,
  updateReviewIssueStatus,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { postInlineComment } from "@/lib/review/decisions";
import type { Risk } from "@/types/analysis";

export const runtime = "nodejs";

/** 采纳 / 忽略某条审查建议（采纳时把建议以行内 review comment 提交给作者） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; issueId: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (r.provider !== "github") {
    return NextResponse.json({ error: "自动审查目前仅支持 GitHub" }, { status: 400 });
  }
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  const { jobId: jobIdRaw, issueId: issueIdRaw } = await params;
  const jobId = Number(jobIdRaw);
  const issueId = Number(issueIdRaw);
  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const status = body.status === "accepted" ? "accepted" : body.status === "dismissed" ? "dismissed" : null;
  if (!status) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  try {
    await ensureReviewTables();
    const job = await getReviewJob(r.ctx.dbUser.id, jobId);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (status === "accepted") {
      const issues = await listReviewIssues(r.ctx.dbUser.id, jobId);
      const issue = issues.find((i) => i.id === issueId);
      if (issue?.file && issue.line) {
        const [owner, repo] = job.repoFullName.split("/");
        const risk: Risk = {
          id: String(issue.id),
          severity: "medium",
          title: issue.title,
          description: issue.description ?? "",
          file: issue.file,
          line: issue.line,
          code: issue.code ?? "",
          suggestion: issue.suggestion ?? "",
          confidence: "medium",
        };
        const ok = await postInlineComment(r.token, owner, repo, job.prNumber, risk);
        if (!ok) {
          return NextResponse.json({ error: "回写 GitHub 行内评论失败（可能行号不在 diff 中或权限不足）" }, { status: 502 });
        }
      }
    }

    await updateReviewIssueStatus(r.ctx.dbUser.id, issueId, status);
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
