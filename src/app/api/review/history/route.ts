import { NextRequest, NextResponse } from "next/server";
import {
  ensureReviewTables,
  getReviewHistoryKpi,
  listReviewHistory,
  type ReviewHistoryData,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

const CACHE_TTL = 60; // 历史列表短 TTL：1 分钟

/** 审查历史：分页列表 + 筛选 + 搜索 + KPI（Redis 缓存） */
export async function GET(req: NextRequest) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1) || 1);
  const pageSize = Math.min(Math.max(Number(sp.get("pageSize") || 10) || 10, 1), 50);
  const filter = ["all", "risky", "suggestion", "written"].includes(sp.get("filter") || "")
    ? (sp.get("filter") as string)
    : "all";
  const q = (sp.get("q") || "").trim();

  try {
    await ensureReviewTables();
    const cacheKey = `review:history:${r.ctx.dbUser.id}:${r.provider}:${page}:${pageSize}:${filter}:${q || "none"}`;
    const data = await cachedRead(cacheKey, CACHE_TTL, async () => {
      const [list, kpi] = await Promise.all([
        listReviewHistory(r.ctx.dbUser.id, r.provider, { page, pageSize, filter, q }),
        getReviewHistoryKpi(r.ctx.dbUser.id, r.provider),
      ]);
      return { items: list.items, total: list.total, page: list.page, pageSize: list.pageSize, kpi };
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
