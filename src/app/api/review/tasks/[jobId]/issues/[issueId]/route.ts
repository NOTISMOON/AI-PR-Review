import { NextRequest, NextResponse } from "next/server";
import {
  ensureReviewTables,
  getReviewJob,
  listReviewIssues,
  updateReviewIssueStatus,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { getBotToken } from "@/lib/github/app";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import { postInlineComment, deleteInlineComment } from "@/lib/review/decisions";
import type { Risk } from "@/types/analysis";

export const runtime = "nodejs";

/** 采纳 / 忽略 / 取消（pending）某条审查建议。
 *  采纳时把建议回写给作者（GitHub 行内评论，Gitee 普通 PR 评论）。
 *  已忽略的建议不能直接采纳（需先取消忽略）；PR 已关闭/合并时跳过回写仅记录状态。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; issueId: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (r.provider !== "github" && r.provider !== "gitee") {
    return NextResponse.json({ error: "不支持的平台" }, { status: 400 });
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
  const status =
    body.status === "accepted" ? "accepted" : body.status === "dismissed" ? "dismissed" : body.status === "pending" ? "pending" : null;
  if (!status) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  try {
    await ensureReviewTables();
    const job = await getReviewJob(r.ctx.dbUser.id, jobId);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const issues = await listReviewIssues(r.ctx.dbUser.id, jobId);
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return NextResponse.json({ error: "issue_not_found" }, { status: 404 });

    // 已忽略的建议不能直接采纳，需先取消忽略（回 pending）
    if (status === "accepted" && issue.status === "dismissed") {
      return NextResponse.json({ error: "已忽略的建议请先取消忽略" }, { status: 400 });
    }

    let skippedWriteback = false;
    let writebackCommentId: string | null = null;
    if (status === "accepted") {
      const [owner, repo] = job.repoFullName.split("/");

      // PR 已关闭/合并时行内评论无法定位（缺 commit_id），跳过回写仅记录状态
      let prOpen = true;
      try {
        const pr =
          r.provider === "github"
            ? await github.getPull(r.token, owner, repo, job.prNumber)
            : await gitee.getPull(r.token, owner, repo, job.prNumber);
        prOpen = !pr?.merged && pr?.state === "open";
      } catch {
        /* 查询失败按打开处理 */
      }

      if (!prOpen) {
        skippedWriteback = true;
      } else if (issue.file && issue.line) {
        if (r.provider === "github") {
          // 行内评论作者自己也能发，无需机器人；已装 App 时优先用机器人，否则回退用户 token（不阻断）
          let token = r.token;
          const bot = await getBotToken(owner, repo);
          if (bot.ok) token = bot.token;

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
          const res = await postInlineComment(token, owner, repo, job.prNumber, risk);
          if (!res.ok) {
            const detail = res.message ? `：${res.message}` : "";
            return NextResponse.json(
              { error: `回写 GitHub 行内评论失败（HTTP ${res.status ?? "?"}）${detail}` },
              { status: 502 },
            );
          }
          writebackCommentId = res.commentId ?? null;
        } else {
          // Gitee：无行内评论接口，把建议作为 PR 评论回写
          const content = `${issue.title}（${issue.file}:${issue.line}）\n\n${issue.description ?? ""}${issue.suggestion ? `\n\n建议：${issue.suggestion}` : ""}`;
          const res = await gitee.createPullComment(r.token, owner, repo, job.prNumber, content);
          if (!res.ok) {
            const detail = res.message ? `：${res.message}` : "";
            return NextResponse.json(
              { error: `回写 Gitee 评论失败（HTTP ${res.status ?? "?"}）${detail}` },
              { status: 502 },
            );
          }
          writebackCommentId = res.commentId ?? null;
        }
      }
    }

    // 取消采纳：撤销已回写的评论（删除成功或评论已不存在 404 都视为已撤销）
    if (status === "pending" && issue.status === "accepted" && issue.commentId) {
      const [owner, repo] = job.repoFullName.split("/");
      let token = r.token;
      if (r.provider === "github") {
        const bot = await getBotToken(owner, repo);
        if (bot.ok) token = bot.token;
      }
      const del =
        r.provider === "github"
          ? await deleteInlineComment(token, owner, repo, issue.commentId)
          : await gitee.deletePullComment(token, owner, repo, issue.commentId);
      if (!del.ok && del.status !== 404) {
        const detail = del.message ? `：${del.message}` : "";
        return NextResponse.json(
          { error: `删除已回写评论失败（HTTP ${del.status ?? "?"}）${detail}，请稍后重试` },
          { status: 502 },
        );
      }
    }

    // commentIdArg：采纳时存回写评论 id；取消时清空；忽略不改动
    const commentIdArg =
      status === "accepted"
        ? writebackCommentId
        : status === "pending"
          ? null
          : undefined;
    await updateReviewIssueStatus(r.ctx.dbUser.id, issueId, status, commentIdArg);
    return NextResponse.json({ ok: true, status, skippedWriteback });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
