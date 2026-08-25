import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/github/session";
import { buildDashboard } from "@/lib/platform/dashboard";
import { cachedRead } from "@/lib/cache/redis";

export const runtime = "nodejs";

const CACHE_TTL = 300; // 外部数据（仓库/PR）短 TTL：5 分钟

/** GitHub 控制台聚合数据（仓库/PR/语言/Stars 统计，Redis 缓存） */
export async function GET(req: NextRequest) {
  const r = await resolveSession(req);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.token) return NextResponse.json({ error: "no_token" }, { status: 401 });

  try {
    const data = await cachedRead(`github:dashboard:${r.ctx.dbUser.id}`, CACHE_TTL, () =>
      buildDashboard("github", r.token!, r.ctx.user.login),
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}