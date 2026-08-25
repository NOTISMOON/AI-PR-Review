import { NextRequest, NextResponse } from "next/server";
import {
  deleteReviewJob,
  ensureReviewTables,
  getReviewJob,
  listReviewIssues,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import { cacheDelPattern } from "@/lib/cache/redis";

export const runtime = "nodejs";

/** 判断 404（PR/仓库不存在）错误，用于识别「对方取消/删除 PR」的场景 */
function isNotFound(err: unknown): boolean {
  return err instanceof Error && /\b404\b/.test(err.message);
}

/** 单次审查详情（含完整结果 + 可采纳/忽略的问题列表 + PR 实时状态 prState） */
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

    // 查询 PR 实时状态（open/closed/merged），用于前端联动：关闭/合并后禁用审批类操作
    let prState: string | null = null;
    // 对方取消/删除了 PR：详情确认不存在时置 true，前端据此自动移除此待审
    let prMissing = false;
    if (r.token) {
      try {
        const [owner, repo] = job.repoFullName.split("/");
        const pr =
          r.provider === "github"
            ? await github.getPull(r.token, owner, repo, job.prNumber)
            : await gitee.getPull(r.token, owner, repo, job.prNumber);
        prState = pr?.merged ? "merged" : pr?.state ?? null;
      } catch (e) {
        // 仅「确认不存在」（404）标记为缺失，其余错误视为未知（不阻断，不误删）
        if (isNotFound(e)) {
          prMissing = true;
        } else {
          /* 查询失败返回 null，前端按未知处理（不阻断） */
        }
      }
    }

    return NextResponse.json({ job, issues, prState, prMissing });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 删除某次审查（待审项「对方取消 PR」等场景下清理） */
export async function DELETE(
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
    await deleteReviewJob(r.ctx.dbUser.id, jobId);
    try {
      await cacheDelPattern(`review:history:${r.ctx.dbUser.id}:*`);
      await cacheDelPattern(`${r.provider}:repos:${r.ctx.dbUser.id}`);
    } catch {
      /* 缓存清理失败降级，不影响删除 */
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
