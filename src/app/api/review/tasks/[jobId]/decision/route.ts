import { NextRequest, NextResponse } from "next/server";
import {
  ensureReviewTables,
  getReviewJob,
  updateReviewDecision,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { getBotToken } from "@/lib/github/app";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import {
  closePullRequest,
  giteeApprovePull,
  giteeClosePull,
  giteeCommentPull,
  giteeRequestChanges,
  postIssueComment,
  submitPullReview,
  type GitHubResult,
} from "@/lib/review/decisions";

export const runtime = "nodejs";

/** 用户决策：批准 / 请求变更（软拒绝）/ 评论 / 关闭 PR（硬关闭）。
 *  别人的 PR：一律用原生 API（用户 token，GitHub 允许审批他人 PR）。
 *  自己的 PR：评论/关闭用原生 API；批准/请求变更需 GitHub App 机器人（未安装则提示）。Gitee 无此限制，全部原生 API。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (r.provider !== "github" && r.provider !== "gitee") {
    return NextResponse.json({ error: "不支持的平台" }, { status: 400 });
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

    // 判断当前 PR 是否为「当前登录用户」发起（GitHub：作者不能审批自己的 PR）
    let isOwnPr = false;
    if (r.provider === "github") {
      try {
        const pr = await github.getPull(r.token, owner, repo, job.prNumber);
        isOwnPr = pr?.user?.login === r.ctx.user.login;
      } catch {
        /* 查询失败按非本人处理，避免阻断 */
      }
    }

    let decision = "";
    let res: GitHubResult = { ok: false };

    if (r.provider === "github") {
      // 需要机器人：自己的 PR + 批准/请求变更（GitHub 禁止作者审批自己的 PR）
      const needsBot =
        isOwnPr && (action === "approve" || action === "request_changes");
      let token = r.token;
      if (needsBot) {
        const bot = await getBotToken(owner, repo);
        if (bot.ok) {
          token = bot.token;
        } else {
          // 项目为 strict:false，对象字面量联合在 else 里不做判别收窄，
          // 故用可选字段断言读取失败原因（避免 TS2339：另一分支无该属性）
          const reason = (bot as { reason?: string }).reason;
          const message = (bot as { message?: string }).message;
          if (reason === "not_configured" || reason === "key_missing") {
            return NextResponse.json(
              { error: "审批自己的 PR 需配置 GitHub App（当前平台未配置 App 或私钥）" },
              { status: 502 },
            );
          }
          if (reason === "not_installed") {
            return NextResponse.json(
              { error: message || "审批自己的 PR 需先安装 GitHub App 到该仓库" },
              { status: 502 },
            );
          }
          return NextResponse.json({ error: message || "GitHub App 不可用" }, { status: 502 });
        }
      }

      switch (action) {
        case "approve":
          res = await submitPullReview(token, owner, repo, job.prNumber, "APPROVE", comment || "AI 审查通过，批准合并。");
          decision = "APPROVED";
          break;
        case "request_changes":
          res = await submitPullReview(token, owner, repo, job.prNumber, "REQUEST_CHANGES", comment || "AI 审查发现需修复的问题，请处理后再合并。");
          decision = "REQUEST_CHANGES";
          break;
        case "comment":
          res = await postIssueComment(token, owner, repo, job.prNumber, comment || "AI 审查评论");
          decision = "COMMENTED";
          break;
        case "dismiss":
          res = await closePullRequest(token, owner, repo, job.prNumber);
          decision = "DISMISSED";
          break;
      }
    } else {
      // Gitee：用用户 token（权限全开，无作者限制）；打回映射为评论说明问题
      switch (action) {
        case "approve":
          res = await giteeApprovePull(r.token, owner, repo, job.prNumber, comment || undefined);
          decision = "APPROVED";
          break;
        case "request_changes":
          res = await giteeRequestChanges(r.token, owner, repo, job.prNumber, comment || undefined);
          decision = "REQUEST_CHANGES";
          break;
        case "comment":
          res = await giteeCommentPull(r.token, owner, repo, job.prNumber, comment || undefined);
          decision = "COMMENTED";
          break;
        case "dismiss":
          res = await giteeClosePull(r.token, owner, repo, job.prNumber);
          decision = "DISMISSED";
          break;
      }
    }

    if (!res.ok) {
      // 透传平台真实错误，便于准确定位（而非笼统报"权限不足"）
      const detail = res.message ? `：${res.message}` : "";
      return NextResponse.json(
        { error: `回写失败（HTTP ${res.status ?? "?"}）${detail}` },
        { status: 502 },
      );
    }
    await updateReviewDecision(r.ctx.dbUser.id, jobId, decision);
    return NextResponse.json({ ok: true, decision });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
