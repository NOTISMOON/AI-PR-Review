import { NextRequest, NextResponse } from "next/server";
import { resolveGiteeSession } from "@/lib/gitee/session";
import { buildDashboard } from "@/lib/platform/dashboard";
import { cachedRead, cacheDelPattern } from "@/lib/cache/redis";
import { ensureReviewTables, getReviewStats, listReviewJobs } from "@/lib/db/mysql";

export const runtime = "nodejs";

const CACHE_TTL = 300; // 外部数据（仓库/PR）短 TTL：5 分钟

/** 组装控制台数据：平台聚合（仓库/PR/语言）+ 审查洞察 + 待处理审查队列 */
async function buildControlData(userId: number, token: string, login: string, useCache: boolean) {
  const cacheKey = `gitee:dashboard:${userId}`;
  const data = useCache
    ? await cachedRead(cacheKey, CACHE_TTL, () => buildDashboard("gitee", token, login))
    : await buildDashboard("gitee", token, login);
  await ensureReviewTables();
  const [reviewStats, jobs] = await Promise.all([
    getReviewStats(userId, "gitee"),
    listReviewJobs(userId, "gitee", 10),
  ]);
  return {
    ...data,
    reviewStats,
    pendingReviews: jobs.filter((j) => j.decision === "PENDING").slice(0, 5),
  };
}

/** Gitee 控制台聚合数据（Redis 缓存） */
export async function GET(req: NextRequest) {
  const r = await resolveGiteeSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const data = await buildControlData(r.ctx.dbUser.id, r.token, r.ctx.user.login, true);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** 同步数据：清除 dashboard/contributions 缓存并重新拉取 */
export async function POST(req: NextRequest) {
  const r = await resolveGiteeSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    await cacheDelPattern("gitee:dashboard:*");
    await cacheDelPattern("gitee:contributions:*");
    const data = await buildControlData(r.ctx.dbUser.id, r.token, r.ctx.user.login, false);
    return NextResponse.json({ ...data, synced: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
