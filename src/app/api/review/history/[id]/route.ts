import { NextRequest, NextResponse } from "next/server";
import {
  deleteReviewJob,
  ensureReviewTables,
  getReviewJob,
} from "@/lib/db/mysql";
import { resolveWebhookSession } from "@/lib/platform/webhook";
import { cacheDelPattern } from "@/lib/cache/redis";

export const runtime = "nodejs";

/** 删除单条审查历史（连同其审查问题一并删除） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveWebhookSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    await ensureReviewTables();
    const job = await getReviewJob(r.ctx.dbUser.id, id);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await deleteReviewJob(r.ctx.dbUser.id, id);
    // 审查历史缓存局部失效，保证删除后刷新即见
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