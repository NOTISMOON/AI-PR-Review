import { NextRequest, NextResponse } from "next/server";
import { resolveGiteeSession } from "@/lib/gitee/session";
import { buildDashboard } from "@/lib/platform/dashboard";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

const CACHE_TTL = 300; // 外部数据（仓库/PR）短 TTL：5 分钟

/** Gitee 控制台聚合数据（仓库/PR/语言/Stars 统计，Redis 缓存） */
export async function GET(req: NextRequest) {
  const r = await resolveGiteeSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const data = await cachedRead(`gitee:dashboard:${r.ctx.dbUser.id}`, CACHE_TTL, () =>
      buildDashboard("gitee", r.token!, r.ctx.user.login),
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}