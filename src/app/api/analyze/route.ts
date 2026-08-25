import { NextRequest, NextResponse } from "next/server";
import { parsePRUrl } from "@/lib/github";
import { resolveSession } from "@/lib/github/session";
import { runReviewSafe, type ReviewDepth } from "@/lib/review/graph";
import { ensureSettingTables, getSettingJson } from "@/lib/db/mysql";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * AI 审查入口：LangGraph 编排（准备上下文 → 四维度并行分析 → 汇总 → 验证 → 生成 GitHub Review）。
 * 模型从已配置的环境变量（registry）自动选择，不再依赖前端传 customModels。
 */
export async function POST(request: NextRequest) {
  const r = await resolveSession(request);
  if ("error" in r) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { prUrl?: unknown; depth?: unknown; writeReview?: unknown; githubToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const prUrl = typeof body.prUrl === "string" ? body.prUrl.trim() : "";
  const parsed = parsePRUrl(prUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: "URL 格式不正确，请输入标准的 GitHub PR URL（https://github.com/owner/repo/pull/123）" },
      { status: 400 },
    );
  }

  const depth: ReviewDepth =
    body.depth === "fast" || body.depth === "deep" ? body.depth : "standard";
  const writeReview = body.writeReview === true;
  const token = typeof body.githubToken === "string" && body.githubToken ? body.githubToken : r.token;

  try {
    // 全局设置中的首选模型（空则自动选择）
    let preferredModel: string | null = null;
    try {
      await ensureSettingTables();
      const ai = await getSettingJson<{ model?: string }>(r.ctx.dbUser.id, "ai");
      preferredModel = ai?.model?.trim() ? ai.model.trim() : null;
    } catch {
      /* 读取设置失败不影响 */
    }

    const result = await runReviewSafe(
      {
        owner: parsed.owner,
        repo: parsed.repo,
        prNumber: parsed.prNumber,
        depth,
        token,
        writeReview,
        userId: r.ctx.dbUser.id,
        platform: "github",
        preferredModel,
      },
      null,
    );

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ data: result.response, writtenReview: result.writtenReview });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
